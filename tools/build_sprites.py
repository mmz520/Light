#!/usr/bin/env python3
"""
精灵表后处理脚本 v2 —— 自动检测行列边界 + 方向映射 + 镜像补全

修复问题:
- 源图角色超出 280px 单元格导致裁切丢失 (改用投影检测真实边界)
- player 只有 6 方向, 通过镜像补全 8 方向
- enemy2 行顺序与标准顺序不一致, 重新映射

标准 8 方向行顺序 (从上到下):
  DOWN, DOWN-LEFT, LEFT, UP-LEFT, UP, UP-RIGHT, RIGHT, DOWN-RIGHT
"""

import sys
from pathlib import Path
import numpy as np
from PIL import Image

OUT_COLS = 15  # 15 帧
OUT_ROWS = 8   # 8 方向
PING_PONG = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4]

BG_THRESHOLD = 240  # RGB 三通道都 >= 240 视为白底
PADDING = 6         # 统一单元格留白


def detect_bands(proj: np.ndarray, gap_thresh: int = 20, min_h: int = 50):
    """从投影数组中检测内容带 (返回 [(start, end), ...])"""
    bands = []
    in_fg = False
    start = 0
    for i in range(len(proj)):
        if proj[i] > gap_thresh and not in_fg:
            in_fg = True
            start = i
        elif proj[i] <= gap_thresh and in_fg:
            in_fg = False
            if i - start >= min_h:
                bands.append((start, i))
    if in_fg and len(proj) - start >= min_h:
        bands.append((start, len(proj)))
    return bands


def detect_cols(hproj: np.ndarray, gap_thresh: int = 10, min_w: int = 80):
    """检测列边界, 过滤噪声小段"""
    segments = detect_bands(hproj, gap_thresh, min_w)
    return segments


def remove_white(cell_rgb: np.ndarray) -> np.ndarray:
    """白底抠图 -> RGBA
    使用连通域分析从边界出发, 只移除与边界连通的背景区域,
    避免误删角色内部的白色/浅色细节 (如眼睛、牙齿、高光)
    """
    from scipy.ndimage import label, binary_dilation
    h, w = cell_rgb.shape[:2]
    alpha = np.ones((h, w), dtype=np.uint8) * 255

    # 潜在背景: 三通道都较亮的像素
    bg_like = (cell_rgb[:, :, 0] >= 200) & \
              (cell_rgb[:, :, 1] >= 200) & \
              (cell_rgb[:, :, 2] >= 200)

    # 连通域标记
    labeled, n = label(bg_like)
    # 找出所有与边界接触的连通域 -> 这些是背景
    border_labels = set()
    border_labels.update(labeled[0, :])        # 上边
    border_labels.update(labeled[-1, :])       # 下边
    border_labels.update(labeled[:, 0])        # 左边
    border_labels.update(labeled[:, -1])       # 右边
    border_labels.discard(0)  # 0 是非背景

    bg_mask = np.isin(labeled, list(border_labels))
    alpha[bg_mask] = 0

    # 边缘羽化: 对紧邻透明区的不透明像素, 按亮度降低 alpha
    transparent = alpha == 0
    dilated = binary_dilation(transparent, iterations=1)
    edge_mask = dilated & ~transparent

    if edge_mask.any():
        ys, xs = np.where(edge_mask)
        brightness = (cell_rgb[ys, xs, 0].astype(np.float32) +
                      cell_rgb[ys, xs, 1].astype(np.float32) +
                      cell_rgb[ys, xs, 2].astype(np.float32)) / 3.0
        # 越接近白色, alpha 越低 (羽化过渡)
        bright_mask = brightness >= 200
        if bright_mask.any():
            t = (brightness[bright_mask] - 200) / 55.0  # 200->0, 255->1
            alpha_vals = np.maximum(0, (255 * (1 - t * 0.7)).astype(np.uint8))
            alpha[ys[bright_mask], xs[bright_mask]] = alpha_vals

    return np.dstack([cell_rgb, alpha])


def content_bbox(rgba: np.ndarray):
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > 0)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def paste_alpha(dst: np.ndarray, src: np.ndarray, x: int, y: int):
    """按 alpha 混合粘贴 src 到 dst 的 (x,y)"""
    sh, sw = src.shape[:2]
    dh, dw = dst.shape[:2]
    if x < 0 or y < 0 or x + sw > dw or y + sh > dh:
        return
    dst_slice = dst[y:y + sh, x:x + sw]
    src_a = src[:, :, 3:4].astype(np.float32) / 255.0
    new_rgb = (src[:, :, :3].astype(np.float32) * src_a +
               dst_slice[:, :, :3].astype(np.float32) * (1 - src_a))
    dst_slice[:, :, :3] = new_rgb.astype(np.uint8)
    dst_slice[:, :, 3] = np.maximum(dst_slice[:, :, 3], src[:, :, 3])


def process(src_path: Path, out_path: Path, dir_map: list, mirror_map: dict = None):
    """
    dir_map: 长度为 OUT_ROWS 的列表, dir_map[out_row] = src_row_index
             表示输出第 out_row 行使用源图第 src_row 行的内容
    mirror_map: {out_row: True} 表示该行需要水平镜像
    """
    print(f"[处理] {src_path.name}")
    src = Image.open(src_path).convert("RGB")
    arr = np.array(src)
    H, W = arr.shape[:2]

    bg = (arr[:, :, 0] >= BG_THRESHOLD) & (arr[:, :, 1] >= BG_THRESHOLD) & (arr[:, :, 2] >= BG_THRESHOLD)
    fg = ~bg

    # 1. 检测行边界 (垂直投影)
    vproj = fg.sum(axis=1)
    row_bands = detect_bands(vproj)
    print(f"  检测到 {len(row_bands)} 行: {[(s, e) for s, e in row_bands]}")

    # 2. 检测列边界 (使用内容最多的那一行的水平投影, 避免多行列合并)
    best_row_idx = 0
    best_count = 0
    for ri, (rys, rye) in enumerate(row_bands):
        cnt = fg[rys:rye, :].sum()
        if cnt > best_count:
            best_count = cnt
            best_row_idx = ri
    rys, rye = row_bands[best_row_idx]
    hproj = fg[rys:rye, :].sum(axis=0)
    col_bands = detect_cols(hproj)
    if len(col_bands) < 4:
        # 退而求其次: 用所有行的水平投影
        hproj = fg.sum(axis=0)
        col_bands = detect_cols(hproj)
    print(f"  检测到 {len(col_bands)} 列: {[(s, e) for s, e in col_bands]}")

    n_src_rows = len(row_bands)
    n_src_cols = len(col_bands)

    # 3. 提取所有单元格 + 抠图 + bbox
    cells = []  # cells[src_row][src_col] = rgba
    bboxes = []
    for ri, (rys, rye) in enumerate(row_bands):
        row_cells = []
        for ci, (cxs, cxe) in enumerate(col_bands):
            cell_rgb = arr[rys:rye, cxs:cxe]
            rgba = remove_white(cell_rgb)
            row_cells.append(rgba)
            bboxes.append(content_bbox(rgba))
        cells.append(row_cells)

    # 4. 计算统一单元格尺寸 (取所有内容 bbox 的最大宽高 + padding)
    cw_list = [b[2] - b[0] for b in bboxes if b]
    ch_list = [b[3] - b[1] for b in bboxes if b]
    max_cw = max(cw_list) + PADDING * 2
    max_ch = max(ch_list) + PADDING * 2
    max_cw = (max_cw + 1) // 2 * 2
    max_ch = (max_ch + 1) // 2 * 2
    print(f"  统一单元格: {max_cw}x{max_ch} (内容最大 {max(cw_list)}x{max(ch_list)})")

    # 5. 构建输出图
    out_w = max_cw * OUT_COLS
    out_h = max_ch * OUT_ROWS
    out = Image.new("RGBA", (out_w, out_h), (0, 0, 0, 0))
    out_arr = np.array(out)

    for out_row in range(OUT_ROWS):
        src_row = dir_map[out_row]
        need_mirror = mirror_map and mirror_map.get(out_row, False)

        for oc in range(OUT_COLS):
            sc = PING_PONG[oc]
            if sc >= n_src_cols:
                continue
            rgba = cells[src_row][sc]
            bbox = bboxes[src_row * n_src_cols + sc]
            if bbox is None:
                continue

            x0, y0, x1, y1 = bbox
            content = rgba[y0:y1, x0:x1]

            # 水平镜像
            if need_mirror:
                content = np.flip(content, axis=1).copy()

            ch_c = y1 - y0
            cw_c = x1 - x0

            # 底部对齐 + 水平居中
            dest_x0 = (max_cw - cw_c) // 2
            dest_y0 = max_ch - PADDING - ch_c
            if dest_x0 < 0:
                dest_x0 = 0
            if dest_y0 < 0:
                dest_y0 = 0

            ox = oc * max_cw
            oy = out_row * max_ch
            paste_alpha(out_arr, content, ox + dest_x0, oy + dest_y0)

    out_img = Image.fromarray(out_arr, "RGBA")
    out_img.save(out_path, "PNG")
    print(f"  输出 {out_path.name}: {out_w}x{out_h} (cell {max_cw}x{max_ch})")

    # 6. 验证: 检查输出单元格是否触边
    print("  验证裁剪边界:")
    touch_any = False
    for r in range(OUT_ROWS):
        for c in range(OUT_COLS):
            cell = out_arr[r * max_ch:(r + 1) * max_ch, c * max_cw:(c + 1) * max_cw]
            bbox = content_bbox(cell)
            if bbox is None:
                continue
            x0, y0, x1, y1 = bbox
            touches = []
            if x0 <= 1: touches.append('L')
            if x1 >= max_cw - 2: touches.append('R')
            if y0 <= 1: touches.append('T')
            if y1 >= max_ch - 2: touches.append('B')
            if touches:
                touch_any = True
                print(f"    r{r}c{c}: 触边 {''.join(touches)} bbox=({x0},{y0},{x1},{y1})")
    if not touch_any:
        print("    全部 OK, 无触边")


def main():
    assets = Path("assets")

    # Player walk: 6 rows -> 8 directions (mirror LEFT->RIGHT, DOWN-LEFT->DOWN-RIGHT)
    # Source rows: 0=DOWN, 1=DOWN-LEFT, 2=LEFT, 3=UP-LEFT, 4=UP, 5=UP-RIGHT
    # Output rows: 0=DOWN, 1=DOWN-LEFT, 2=LEFT, 3=UP-LEFT, 4=UP, 5=UP-RIGHT, 6=RIGHT, 7=DOWN-RIGHT
    player_dir_map = [0, 1, 2, 3, 4, 5, 2, 1]
    player_mirror = {6: True, 7: True}  # RIGHT=mirror(LEFT), DOWN-RIGHT=mirror(DOWN-LEFT)

    # Enemy1 (hound): 8 rows already in correct order
    e1_dir_map = [0, 1, 2, 3, 4, 5, 6, 7]

    # Enemy2 (beast): rows are [DOWN-LEFT, LEFT, UP-LEFT, UP, UP-RIGHT, RIGHT, DOWN-RIGHT, DOWN]
    # Need to map to standard order
    e2_dir_map = [7, 0, 1, 2, 3, 4, 5, 6]

    targets = [
        ("player_walk_1.jpg", "player_walk.png", player_dir_map, player_mirror),
        ("player_action_1.jpg", "player_action.png", player_dir_map, player_mirror),
        ("enemy1_hound_1.jpg", "enemy1.png", e1_dir_map, None),
        ("enemy2_beast_1.jpg", "enemy2.png", e2_dir_map, None),
    ]

    for src_name, out_name, dir_map, mirror in targets:
        src = assets / src_name
        if not src.exists():
            print(f"[跳过] 缺少 {src}")
            continue
        process(src, Path(out_name), dir_map, mirror)

    print("完成")


if __name__ == "__main__":
    main()
