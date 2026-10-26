#!/usr/bin/env python3
"""
精灵表后处理脚本 —— 符合行业标准的 8 方向 × 15 帧精灵表生成

输入: assets/*_1.jpg (6 列 × 8 行, 白底 AI 生成图)
输出: *.png (15 列 × 8 行, 透明背景, 等大单元格, 底部对齐)

处理步骤:
1. 按 6×8 网格切分源图
2. 抠除白底 -> 透明 (alpha 通道)
3. 计算所有单元格内容包围盒, 取最大宽高 + 留白作为统一单元格尺寸
4. 8 个方向各自做 ping-pong 扩展: 6 帧 -> 15 帧
   序列: 0,1,2,3,4,5,4,3,2,1,0,1,2,3,4  (平滑循环, 无跳变)
5. 每帧底部对齐 (脚掌在同一水平线), 水平居中
6. 输出 15×8 的 PNG
"""

import sys
from pathlib import Path
import numpy as np
from PIL import Image

# 源图网格
SRC_COLS = 6
SRC_ROWS = 8

# 输出网格 (15 帧 × 8 方向)
OUT_COLS = 15
OUT_ROWS = 8

# ping-pong 序列: 6 帧扩展为 15 帧
PING_PONG = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4]

# 抠图: 认为接近白色的像素为背景
BG_THRESHOLD = 240  # RGB 三通道都 >= 240 视为白底
PADDING = 6         # 统一单元格额外留白 (像素)


def remove_white(cell_rgb: np.ndarray) -> np.ndarray:
    """白底抠图, 返回 RGBA"""
    h, w = cell_rgb.shape[:2]
    alpha = np.ones((h, w), dtype=np.uint8) * 255
    # 三通道都接近白色 -> 透明
    bg_mask = (cell_rgb[:, :, 0] >= BG_THRESHOLD) & \
              (cell_rgb[:, :, 1] >= BG_THRESHOLD) & \
              (cell_rgb[:, :, 2] >= BG_THRESHOLD)
    alpha[bg_mask] = 0
    # 边缘半透明羽化, 避免锯齿
    rgba = np.dstack([cell_rgb, alpha])
    return rgba


def content_bbox(rgba: np.ndarray):
    """返回非透明区域的包围盒 (x0,y0,x1,y1) 或 None"""
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > 0)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def process(src_path: Path, out_path: Path):
    print(f"[处理] {src_path.name}")
    src = Image.open(src_path).convert("RGB")
    W, H = src.size
    cw, ch = W // SRC_COLS, H // SRC_ROWS
    assert W % SRC_COLS == 0 and H % SRC_ROWS == 0, \
        f"源图尺寸 {W}x{H} 不能被 {SRC_COLS}x{SRC_ROWS} 整除"

    arr = np.array(src)

    # 1. 切分 + 抠图
    cells = []  # [row][col] = RGBA ndarray
    bboxes = []
    for r in range(SRC_ROWS):
        row_cells = []
        for c in range(SRC_COLS):
            cell_rgb = arr[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]
            rgba = remove_white(cell_rgb)
            row_cells.append(rgba)
            bbox = content_bbox(rgba)
            bboxes.append(bbox)
        cells.append(row_cells)

    # 2. 计算统一单元格尺寸
    cw_list = [b[2] - b[0] for b in bboxes if b]
    ch_list = [b[3] - b[1] for b in bboxes if b]
    max_cw = max(cw_list) + PADDING * 2
    max_ch = max(ch_list) + PADDING * 2
    # 取偶数, 避免缩放亚像素
    max_cw = (max_cw + 1) // 2 * 2
    max_ch = (max_ch + 1) // 2 * 2
    print(f"  源单元格 {cw}x{ch} -> 统一单元格 {max_cw}x{max_ch} (内容最大 {max(cw_list)}x{max(ch_list)})")

    # 3. 构建输出图
    out_w = max_cw * OUT_COLS
    out_h = max_ch * OUT_ROWS
    out = Image.new("RGBA", (out_w, out_h), (0, 0, 0, 0))
    out_arr = np.array(out)

    for r in range(OUT_ROWS):
        src_row = r % SRC_ROWS
        for oc in range(OUT_COLS):
            sc = PING_PONG[oc]
            rgba = cells[src_row][sc]
            bbox = bboxes[src_row * SRC_COLS + sc]
            if bbox is None:
                continue
            x0, y0, x1, y1 = bbox
            content = rgba[y0:y1, x0:x1]
            ch_c = y1 - y0
            cw_c = x1 - x0

            # 底部对齐 (脚掌在单元格底部), 水平居中
            dest_x0 = (max_cw - cw_c) // 2
            dest_y0 = max_ch - PADDING - ch_c  # 底部留 PADDING

            if dest_x0 < 0:
                dest_x0 = 0
            if dest_y0 < 0:
                dest_y0 = 0

            ox = oc * max_cw
            oy = r * max_ch
            # 按 alpha 混合粘贴
            dst_slice = out_arr[oy + dest_y0:oy + dest_y0 + ch_c,
                                ox + dest_x0:ox + dest_x0 + cw_c]
            src_a = content[:, :, 3:4].astype(np.float32) / 255.0
            dst_rgb = dst_slice[:, :, :3].astype(np.float32)
            new_rgb = (content[:, :, :3].astype(np.float32) * src_a +
                       dst_rgb * (1 - src_a))
            dst_slice[:, :, :3] = new_rgb.astype(np.uint8)
            dst_slice[:, :, 3] = np.maximum(dst_slice[:, :, 3], content[:, :, 3])

    out_img = Image.fromarray(out_arr, "RGBA")
    out_img.save(out_path, "PNG")
    print(f"  输出 {out_path.name}: {out_w}x{out_h} ({OUT_COLS}x{OUT_ROWS}, cell {max_cw}x{max_ch})")


def main():
    assets = Path("assets")
    targets = [
        ("player_walk_1.jpg", "player_walk.png"),
        ("player_action_1.jpg", "player_action.png"),
        ("enemy1_hound_1.jpg", "enemy1.png"),
        ("enemy2_beast_1.jpg", "enemy2.png"),
    ]
    for src_name, out_name in targets:
        src = assets / src_name
        if not src.exists():
            print(f"[跳过] 缺少 {src}")
            continue
        process(src, Path(out_name))
    print("完成")


if __name__ == "__main__":
    main()
