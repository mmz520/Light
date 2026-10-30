#!/usr/bin/env python3
"""把 Seedream 生成的 1×N 源精灵表 → 运行时图集（按方向拆条带）。

源图:  sprite_ani/<character>/sheets/<character>_<action>_<DIR>_sheet.(png|jpg)  宽 = 帧数 × 帧宽
产物:  public/assets/sprites/<character>/<action>/<DIR>.png   横向 N 帧，单元格 CELL×CELL
       public/assets/sprites/manifest.json

处理要点（都是踩过的坑）：
1. 模型画出的"透明棋盘格"其实是像素，必须去底：低饱和 + 高亮度 + 从边缘 flood fill，
   这样角色内部的浅色（护目镜高光、银色扳手）不会被误删。
2. 源图底部常有手绘地面阴影线、帧间有分隔线，会污染包围盒；
   用形态学开运算把细线去掉再算包围盒。
3. 同一动作的 8 个方向共用一套包围盒与缩放，保证跨方向角色大小一致。
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT / "sprite_ani"
OUT_DIR = ROOT / "public" / "assets" / "sprites"

DIRS = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"]
CELL = 384
MARGIN = 8

CHARACTERS: dict[str, dict] = {
    "engineer_spanner": {
        "displayHeight": 2.6,
        "actions": {
            "idle": {"frames": 8, "fps": 10, "loop": True},
            "walk": {"frames": 8, "fps": 12, "loop": True},
            "run": {"frames": 6, "fps": 15, "loop": True},
            "attack": {"frames": 6, "fps": 18, "loop": False, "eventFrames": [3]},
            "hit": {"frames": 3, "fps": 20, "loop": False},
            "death": {"frames": 8, "fps": 10, "loop": False},
            "work": {"frames": 6, "fps": 12, "loop": False, "eventFrames": [3]},
        },
    },
    "rust_hound": {
        "displayHeight": 1.35,
        "actions": {
            "idle": {"frames": 6, "fps": 8, "loop": True},
            "run": {"frames": 8, "fps": 14, "loop": True},
            "attack": {"frames": 5, "fps": 16, "loop": False, "eventFrames": [3]},
            "hit": {"frames": 3, "fps": 20, "loop": False},
            "death": {"frames": 6, "fps": 10, "loop": False},
        },
    },
}


def find_sheet(character: str, action: str, direction: str) -> Path | None:
    candidates = [
        SRC_DIR / f"character_{character}" / "sheets",
        SRC_DIR / character / "sheets",
    ]
    for base in candidates:
        for ext in (".png", ".jpg", ".jpeg"):
            p = base / f"{character}_{action}_{direction}_sheet{ext}"
            if p.exists():
                return p
    return None


def remove_background(rgb: np.ndarray) -> np.ndarray:
    """返回 0/255 的 alpha。

    背景判定分两类：
    1. 与图像边缘连通的"低饱和高亮"区域（含模型画出的棋盘格）
    2. 被墨线包围的纯白区域（如洒水壶提手内的空白），不依赖连通性
    角色内部的浅色细节被粗黑描边保护，不会被误删。
    """
    arr = rgb.astype(np.int16)
    mx = arr.max(axis=2)
    mn = arr.min(axis=2)
    candidate = (mn > 180) & ((mx - mn) < 22)
    pure_white = (mn > 246) & ((mx - mn) <= 10)

    labels, _ = ndimage.label(candidate)
    border = np.concatenate([labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]])
    border_ids = {int(v) for v in np.unique(border) if v != 0}
    if border_ids:
        bg = np.isin(labels, list(border_ids))
    else:
        bg = np.zeros_like(candidate)

    bg |= pure_white
    # 孤立的小白点（噪点）也一并去掉
    open_px = (bg.astype(np.uint8) * 255)
    open_px = cv2.morphologyEx(open_px, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    bg |= open_px > 0

    alpha = np.where(bg, 0, 255).astype(np.uint8)
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
    alpha[alpha < 24] = 0
    return alpha


def clean_frame(rgba: np.ndarray, border: int = 8) -> np.ndarray:
    """逐帧清理源图残留：面板分隔线（贴边）+ 细长地面阴影笔画 + 邻帧串入的碎片。"""
    out = rgba.copy()
    alpha = out[..., 3]
    alpha[:, :border] = 0
    alpha[:, -border:] = 0
    alpha[:border, :] = 0
    alpha[-border:, :] = 0

    mask = (alpha > 128).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    frame_w = out.shape[1]
    for label in range(1, count):
        w = stats[label, cv2.CC_STAT_WIDTH]
        h = stats[label, cv2.CC_STAT_HEIGHT]
        left = stats[label, cv2.CC_STAT_LEFT]
        # 细长横线（地面阴影） / 细长竖线（面板分隔） / 极小碎片（邻帧串入）
        is_thin_h = w > 60 and h < 16
        is_thin_v = h > 200 and w < 12
        is_fragment = (w < 40 and h < 40) and (left < border + 32 or left > frame_w - border - 40)
        if is_thin_h or is_thin_v or is_fragment:
            alpha[labels == label] = 0
    return out


def frame_bbox(alphas: list[np.ndarray]) -> tuple[int, int, int, int]:
    """跨帧合并包围盒；用开运算去掉地面阴影线与帧间分隔细线。"""
    union = np.zeros_like(alphas[0], dtype=np.uint8)
    kernel = np.ones((9, 9), np.uint8)
    for alpha in alphas:
        solid = cv2.morphologyEx((alpha > 128).astype(np.uint8), cv2.MORPH_OPEN, kernel)
        union |= solid
    ys, xs = np.nonzero(union)
    if len(xs) == 0:
        return 0, 0, alphas[0].shape[1] - 1, alphas[0].shape[0] - 1
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def build_action(character: str, action: str, cfg: dict, warnings: list[str]) -> bool:
    frames = int(cfg["frames"])
    sheets: dict[str, tuple[np.ndarray, np.ndarray]] = {}

    for direction in DIRS:
        path = find_sheet(character, action, direction)
        if path is None:
            warnings.append(f"跳过 {character}/{action}/{direction}: 源图缺失")
            return False
        img = Image.open(path).convert("RGB")
        if img.width % frames != 0:
            warnings.append(
                f"{path.name} 宽 {img.width} 不能被帧数 {frames} 整除，跳过该动作"
            )
            return False
        rgb = np.asarray(img)
        fw = img.width // frames
        alpha = remove_background(rgb)
        rgba = np.dstack([rgb, alpha])
        frame_list = [
            clean_frame(rgba[:, i * fw : (i + 1) * fw]) for i in range(frames)
        ]
        sheets[direction] = frame_list  # type: ignore[assignment]

    # 用第一个方向先算基础尺寸
    first = sheets[DIRS[0]]
    x0, y0, x1, y1 = frame_bbox([f[..., 3] for f in first])
    bw, bh = x1 - x0 + 1, y1 - y0 + 1

    # 跨方向统一包围盒（取并集，保证 8 个方向角色大小一致）
    for direction in DIRS[1:]:
        bx0, by0, bx1, by1 = frame_bbox([f[..., 3] for f in sheets[direction]])
        x0 = min(x0, bx0)
        y0 = min(y0, by0)
        x1 = max(x1, bx1)
        y1 = max(y1, by1)
    bw, bh = x1 - x0 + 1, y1 - y0 + 1

    # 以高度为准做缩放（角色身高跨方向一致），仅在超宽时才降比例
    scale = (CELL * 0.92) / bh
    if bw * scale > CELL * 0.98:
        scale = (CELL * 0.98) / bw
    out_w = int(round(bw * scale))
    out_h = int(round(bh * scale))
    paste_x = (CELL - out_w) // 2
    paste_y = CELL - MARGIN - out_h

    action_dir = OUT_DIR / character / action
    action_dir.mkdir(parents=True, exist_ok=True)

    for direction in DIRS:
        strip = np.zeros((CELL, CELL * frames, 4), dtype=np.uint8)
        for index, frame in enumerate(sheets[direction]):
            crop = frame[y0 : y1 + 1, x0 : x1 + 1]
            resized = cv2.resize(
                crop, (out_w, out_h), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
            )
            left = index * CELL + paste_x
            strip[paste_y : paste_y + out_h, left : left + out_w] = resized
        Image.fromarray(strip, mode="RGBA").save(action_dir / f"{direction}.png")

    print(
        f"  ✓ {character}/{action}: {frames} 帧 × 8 方向  "
        f"(bbox {bw}×{bh} → {out_w}×{out_h})"
    )
    return True


def main() -> int:
    warnings: list[str] = []
    manifest = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "cell": {"w": CELL, "h": CELL, "pivotX": CELL // 2, "pivotY": CELL - MARGIN},
        "characters": {},
    }

    for character, char_cfg in CHARACTERS.items():
        actions_out: dict[str, dict] = {}
        for action, cfg in char_cfg["actions"].items():
            if build_action(character, action, cfg, warnings):
                actions_out[action] = cfg
        if actions_out:
            manifest["characters"][character] = {
                "displayHeight": char_cfg["displayHeight"],
                "actions": actions_out,
            }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    for warning in warnings:
        print(f"  ! {warning}")
    print(f"\nmanifest → {OUT_DIR / 'manifest.json'}")
    print(f"角色: {list(manifest['characters'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
