#!/usr/bin/env python3
"""把 seedream 生成的 4列x8行 精灵表处理成 4列x8行 均匀网格 + 透明背景 PNG。

源图特征(新版): 纯白底、有浅灰网格线、4列、通常8行(偶尔7行)。
处理:
1. 按浅灰网格线/固定列宽切成 4 列, 每格内缩 10px 去掉网格线
2. 逐行检测实际行带(可能出现 7 行), 不足 8 行时用最后一行补齐
3. 每帧裁出内容包围盒, 居中贴到统一单元格
4. 白底转透明
"""
import os
import numpy as np
from PIL import Image

SRC_DIR = '/workspace/assets'
OUT_DIR = '/workspace'
COLS, ROWS = 4, 8

FILES = [
    ('pwalk_v4.jpg',   'player_walk.png'),
    ('paction_v4.jpg', 'player_action.png'),
    ('ehound_v4.jpg',  'enemy1.png'),
    ('ebeast_v4.jpg',  'enemy2.png'),
]


def ink_mask(arr):
    rgb = arr[:, :, :3].astype(np.int16)
    lum = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    # 墨迹: 明显偏暗 或 明显有色; 浅灰网格线(lum~205, sat~0)被排除
    return (lum < 190) | (sat > 50)


def detect_rows(mask, h, min_frac=0.55):
    """检测行带: 用整行墨迹计数找连续的 >0 区域"""
    proj = mask.sum(axis=1)
    th = max(3, int(mask.shape[1] * 0.002))
    bands, inb, s = [], False, 0
    for y, v in enumerate(proj):
        if v > th and not inb:
            s, inb = y, True
        elif v <= th and inb:
            bands.append((s, y))
            inb = False
    if inb:
        bands.append((s, h))
    # 合并过近的带(间隔 < 8px)
    merged = []
    for b in bands:
        if merged and b[0] - merged[-1][1] < 10:
            merged[-1] = (merged[-1][0], b[1])
        else:
            merged.append(list(b))
    bands = [tuple(b) for b in merged if b[1] - b[0] > h * 0.04]
    return bands


def to_rgba(arr):
    rgb = arr.astype(np.int16)
    lum = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    # 白底 + 浅灰网格线(lum~200, 几乎无彩度) 都去掉
    bg = (lum > 206) & (sat < 24)
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([arr, alpha]).astype(np.uint8), 'RGBA')


def process(src_name, dst_name):
    src = Image.open(os.path.join(SRC_DIR, src_name)).convert('RGB')
    arr = np.array(src)
    h, w = arr.shape[:2]
    mask = ink_mask(arr)

    bands = detect_rows(mask, h)
    print(f'{src_name}: 检测到 {len(bands)} 行 -> {[(b[1]-b[0]) for b in bands]}')
    if not bands:
        print('  !! 没检测到行, 跳过')
        return
    # 补齐到 8 行(用最后一行重复)
    while len(bands) < ROWS:
        bands.append(bands[-1])
    bands = bands[:ROWS]

    full = to_rgba(arr)
    alpha = np.array(full)[:, :, 3]

    inset_y = max(6, h // 400)
    cell_x = w / COLS

    boxes = []
    for r in range(ROWS):
        y0, y1 = bands[r]
        y0 += inset_y
        y1 -= inset_y
        for c in range(COLS):
            x0 = int(round(c * cell_x)) + 2
            x1 = int(round((c + 1) * cell_x)) - 2
            sub = alpha[y0:y1, x0:x1] > 30
            ys, xs = np.where(sub)
            if len(xs) == 0:
                boxes.append(None)
                continue
            boxes.append((x0 + xs.min(), y0 + ys.min(),
                          x0 + xs.max() + 1, y0 + ys.max() + 1))

    valid = [b for b in boxes if b]
    cw = max(b[2] - b[0] for b in valid) + 16
    ch = max(b[3] - b[1] for b in valid) + 16
    sheet = Image.new('RGBA', (cw * COLS, ch * ROWS), (0, 0, 0, 0))

    for idx, bb in enumerate(boxes):
        if not bb:
            continue
        r, c = divmod(idx, COLS)
        piece = full.crop(bb)
        px = c * cw + (cw - piece.width) // 2
        py = r * ch + (ch - piece.height) // 2
        sheet.paste(piece, (px, py), piece)

    out = os.path.join(OUT_DIR, dst_name)
    sheet.save(out)
    print(f'  -> {dst_name}: 单元格 {cw}x{ch}, 整图 {sheet.width}x{sheet.height}')


if __name__ == '__main__':
    for s, d in FILES:
        process(s, d)
