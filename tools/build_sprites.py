#!/usr/bin/env python3
"""大图 → 裁剪对齐 → public/assets/sprites/ 正式产物（SKILL.md 火柴棒方案）。

输入: sprite_ani/ 下生图模型大图
  - sprite_ani/parts/{arm,torso_U,torso_L,leg}/    一图一火柴棒（素体，无方向）
  - sprite_ani/heads/<char_id>/                    2x2 头部大图（S/E/N/W）
  - sprite_ani/equipment/<slot>/<item>/            2x2 装备大图 或 单图
  - sprite_ani/monsters/<id>/sheets/<action>/      1xN 敌人帧条带

输出:
  - public/assets/sprites/role/common/{arm,torso_U,torso_L,leg}.png   居中素体
  - public/assets/sprites/role/<char_id>/{S,E,N,W}.png                头（居中）
  - public/assets/sprites/equipment/<slot>/<item>/...                 装备（居中）
  - public/assets/sprites/enemy/<id>/<action>/S.png                   横向帧条带
  - public/assets/sprites/manifest.json                               布局/帧/装备索引
  - sprite_ani/preview/character_S_preview.png                        零位移合成预览

对齐模型: 素体/装备文件都是"居中的原始部件"，摆放位置由 manifest.layoutS 提供
（512 画布、脚底线 y=412），引擎按 zOrder 叠加即可得到完整角色。
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "sprite_ani"
OUT = ROOT / "public" / "assets" / "sprites"

GRID = 512
FOOT_Y = 412
CELL = 384
GROUND_Y = CELL - 8
DIRS4 = ["S", "E", "N", "W"]

# 素体部件的规范高度（画布空间像素）；arm/leg 被引擎复用为上下臂/大小腿
PART_H = {"arm": 75, "torso_U": 70, "torso_L": 60, "leg": 90, "head": 110}
EQUIP_H = {"hat": 50, "back": 100, "back_strap": 96, "hand": 44, "foot": 50, "weapon": 95}


def equip_h(slot: str, d: str | None = None) -> int:
    """背带方向（back 的 S）用背带专属高度，其余用 slot 默认高度。"""
    if slot == "back" and d == "S":
        return EQUIP_H["back_strap"]
    return EQUIP_H[slot]

# S 方向布局（512 画布）。cx/bottom/top 为部件在画布中的摆放位置。
def _layout() -> dict:
    leg_h, calf_h = PART_H["leg"], round(PART_H["leg"] * 0.85)
    arm_h, farm_h = PART_H["arm"], round(PART_H["arm"] * 0.85)
    thigh_b = FOOT_Y - calf_h + 8
    torsoL_b = thigh_b - leg_h + 8
    torsoU_b = torsoL_b - PART_H["torso_L"] + 10
    top_y = torsoU_b - PART_H["torso_U"] + 10
    head_b = top_y - 16
    head_top = head_b - PART_H["head"]
    uarm_top = top_y + 8
    farm_top = uarm_top + arm_h - 10
    wrist = farm_top + farm_h
    return {
        "thigh_L": {"cx": 232, "bottom": thigh_b, "h": leg_h},
        "thigh_R": {"cx": 280, "bottom": thigh_b, "h": leg_h},
        "calf_L": {"cx": 232, "bottom": FOOT_Y, "h": calf_h},
        "calf_R": {"cx": 280, "bottom": FOOT_Y, "h": calf_h},
        "torso_L": {"cx": 256, "bottom": torsoL_b, "h": PART_H["torso_L"]},
        "torso_U": {"cx": 256, "bottom": torsoU_b, "h": PART_H["torso_U"]},
        "upper_arm_L": {"cx": 198, "top": uarm_top, "h": arm_h},
        "upper_arm_R": {"cx": 314, "top": uarm_top, "h": arm_h},
        "forearm_L": {"cx": 198, "top": farm_top, "h": farm_h},
        "forearm_R": {"cx": 314, "top": farm_top, "h": farm_h},
        "head": {"cx": 256, "bottom": head_b, "h": PART_H["head"]},
        "hat": {"cx": 256, "bottom": head_top + 34, "h": EQUIP_H["hat"]},
        "back": {"cx": 256, "bottom": torsoL_b + 10, "h": EQUIP_H["back"]},
        # S 方向背包只有两条肩带（包体被身体挡住），从肩头往下垂
        "back_S": {"cx": 256, "top": top_y + 4, "h": EQUIP_H["back_strap"]},
        "foot_L": {"cx": 232, "bottom": FOOT_Y, "h": EQUIP_H["foot"]},
        "foot_R": {"cx": 280, "bottom": FOOT_Y, "h": EQUIP_H["foot"]},
        "hand_L": {"cx": 198, "bottom": wrist + 4, "h": EQUIP_H["hand"]},
        "hand_R": {"cx": 314, "bottom": wrist + 4, "h": EQUIP_H["hand"]},
        "weapon": {"cx": 322, "bottom": wrist + 2, "h": EQUIP_H["weapon"]},
        "_meta": {"top_y": top_y, "wrist_y": wrist},
    }


LAYOUT = _layout()

# S 方向 Z 序：back 在 S 方向只有背带，必须压在躯干之上（手臂之下）
Z_ORDER_S = ["thigh_L", "thigh_R", "calf_L", "calf_R", "torso_L", "torso_U", "back",
             "upper_arm_L", "upper_arm_R", "forearm_L", "forearm_R",
             "foot_L", "foot_R", "hand_L", "hand_R", "head", "hat", "weapon"]

# 预览/引擎的摆放位置别名（S 方向 back 走背带位置）
POS_ALIAS = {"back": "back_S"}

ENEMY_ACTIONS = ["idle", "walk", "attack", "hit", "death"]


# ---------------- 基础工具 ----------------

def latest_png(folder: Path) -> Path | None:
    files = sorted(folder.glob("*.png")) if folder.is_dir() else []
    return files[-1] if files else None


def remove_bg(rgb: np.ndarray) -> np.ndarray:
    arr = rgb.astype(np.int16)
    mx, mn = arr.max(axis=2), arr.min(axis=2)
    strict = (mn > 236) & ((mx - mn) < 14)
    loose = (mn > 198) & ((mx - mn) < 22)
    labels, _ = ndimage.label(loose)
    border = np.concatenate([labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]])
    border_ids = {int(v) for v in np.unique(border) if v != 0}
    bg = strict.copy()
    if border_ids:
        bg |= np.isin(labels, list(border_ids))
    alpha = ndimage.binary_opening(np.where(bg, 0, 255) > 0, np.ones((2, 2)))
    return (alpha * 255).astype(np.uint8)


def _drop_lines(alpha: np.ndarray) -> np.ndarray:
    """去掉细长的水平/垂直残留线（网格线、分隔线）。"""
    mask = alpha > 128
    labels, n = ndimage.label(mask)
    if n == 0:
        return alpha
    H, W = mask.shape
    out = alpha.copy()
    for sl in ndimage.find_objects(labels):
        if sl is None:
            continue
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        if (w > 0.5 * W and h < max(6, 0.04 * H)) or (h > 0.5 * H and w < max(6, 0.04 * W)):
            out[sl][labels[sl] > 0] = 0
    return out


def load_trimmed(path: Path, min_side: int = 24) -> Image.Image | None:
    img = Image.open(path).convert("RGB")
    rgb = np.asarray(img)
    alpha = _drop_lines(remove_bg(rgb))
    ys, xs = np.nonzero(alpha > 128)
    if len(xs) == 0:
        return None
    if (xs.max() - xs.min()) < min_side and (ys.max() - ys.min()) < min_side:
        return None
    out = np.dstack([rgb, alpha])[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    return Image.fromarray(out, "RGBA")


def scale_h(img: Image.Image, target_h: int) -> Image.Image:
    w = max(1, round(img.width * target_h / img.height))
    return img.resize((w, target_h), Image.LANCZOS)


def grid_cell(path: Path, r: int, c: int, rows: int, cols: int) -> Image.Image | None:
    img = Image.open(path).convert("RGB")
    W, H = img.width // cols, img.height // rows
    tmp = Path("_cell_tmp.png")
    img.crop((c * W, r * H, (c + 1) * W, (r + 1) * H)).save(tmp)
    return load_trimmed(tmp)


def save_part(part: Image.Image, target_h: int, out_path: Path):
    """部件统一缩放到规范高度后，紧裁剪直接存盘（无画布留白）。"""
    p = scale_h(part, target_h)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    p.save(out_path)


EQUIP_CELL_MAP = {"S": (0, 0), "E": (0, 1), "N": (1, 0), "W": (1, 1)}


# ---------------- 素体 + 头 + 装备 ----------------

def build_character():
    # 1) 4 根火柴棒 → role/common/（居中、规范高度、无方向）
    for name, h in PART_H.items():
        if name == "head":
            continue
        src = latest_png(SRC / "parts" / name)
        if not src:
            print(f"  ! 缺少素体源图: parts/{name}")
            continue
        part = load_trimmed(src)
        if part:
            save_part(part, h, OUT / "role" / "common" / f"{name}.png")
    print("  role/common: arm/torso_U/torso_L/leg")

    # 2) 头 2x2 → role/<char_id>/{S,E,N,W}.png（居中、规范高度）
    char_id = "engineer_spanner"
    head_sheet = latest_png(SRC / "heads" / char_id)
    if head_sheet:
        for d in DIRS4:
            r, c = EQUIP_CELL_MAP[d]
            cell = grid_cell(head_sheet, r, c, 2, 2)
            if cell:
                save_part(cell, PART_H["head"], OUT / "role" / char_id / f"{d}.png")
        print(f"  role/{char_id}: 4 dir heads")

    # 3) 装备
    equip_specs = [
        ("hat", "engineer_cap", True),
        ("back", "gearpack", True),
        ("foot", "boots", True),
        ("hand", "gloves", False),
        ("weapon", "wrench", False),
    ]
    for slot, item, has_dirs in equip_specs:
        src = latest_png(SRC / "equipment" / slot / item)
        if not src:
            print(f"  ! 缺少装备源图: equipment/{slot}/{item}")
            continue
        out_base = OUT / "equipment" / slot / item
        if has_dirs:
            for d in DIRS4:
                r, c = EQUIP_CELL_MAP[d]
                cell = grid_cell(src, r, c, 2, 2)
                if cell:
                    save_part(cell, equip_h(slot, d), out_base / f"{d}.png")
        else:
            part = load_trimmed(src)
            if part:
                save_part(part, EQUIP_H[slot], out_base / "single.png")
    print("  equipment: hat/back/foot x4, hand/weapon x1")

    # 4) 零位移合成预览
    preview = Image.new("RGBA", (GRID, GRID), (0, 0, 0, 0))
    files = {
        "thigh_L": OUT / "role" / "common" / "leg.png",
        "thigh_R": OUT / "role" / "common" / "leg.png",
        "calf_L": OUT / "role" / "common" / "leg.png",
        "calf_R": OUT / "role" / "common" / "leg.png",
        "torso_L": OUT / "role" / "common" / "torso_L.png",
        "torso_U": OUT / "role" / "common" / "torso_U.png",
        "upper_arm_L": OUT / "role" / "common" / "arm.png",
        "upper_arm_R": OUT / "role" / "common" / "arm.png",
        "forearm_L": OUT / "role" / "common" / "arm.png",
        "forearm_R": OUT / "role" / "common" / "arm.png",
        "head": OUT / "role" / "engineer_spanner" / "S.png",
        "hat": OUT / "equipment" / "hat" / "engineer_cap" / "S.png",
        "back": OUT / "equipment" / "back" / "gearpack" / "S.png",
        "foot_L": OUT / "equipment" / "foot" / "boots" / "S.png",
        "foot_R": OUT / "equipment" / "foot" / "boots" / "S.png",
        "hand_L": OUT / "equipment" / "hand" / "gloves" / "single.png",
        "hand_R": OUT / "equipment" / "hand" / "gloves" / "single.png",
        "weapon": OUT / "equipment" / "weapon" / "wrench" / "single.png",
    }
    for z in Z_ORDER_S:
        f = files.get(z)
        pos = LAYOUT.get(POS_ALIAS.get(z, z))
        if not f or not f.exists() or pos is None:
            continue
        part = Image.open(f).convert("RGBA")
        h = pos.get("h", part.height)
        part = scale_h(part, h)
        if "bottom" in pos:
            x, y = pos["cx"] - part.width // 2, pos["bottom"] - part.height
        else:
            x, y = pos["cx"] - part.width // 2, pos["top"]
        preview.alpha_composite(part, (max(0, x), max(0, y)))
    pv = SRC / "preview"
    pv.mkdir(exist_ok=True)
    preview.save(pv / "character_S_preview.png")
    print("  preview → sprite_ani/preview/character_S_preview.png")


# ---------------- 敌人（自动按空隙分帧） ----------------

def split_frames(img: Image.Image) -> list[Image.Image]:
    rgb = np.asarray(img.convert("RGB"))
    alpha = remove_bg(rgb)
    col_has = (alpha > 128).any(axis=0)
    runs, start = [], None
    for x, v in enumerate(col_has):
        if v and start is None:
            start = x
        elif not v and start is not None:
            if x - start > 24:
                runs.append((start, x))
            start = None
    if start is not None and len(col_has) - start > 24:
        runs.append((start, len(col_has)))
    frames = []
    for x0, x1 in runs:
        sub = np.dstack([rgb, alpha])[:, x0:x1]
        ys, xs = np.nonzero(sub[..., 3] > 128)
        if len(xs) == 0:
            continue
        f = sub[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
        frames.append(Image.fromarray(f, "RGBA"))
    return frames


def build_enemy(mon_id: str) -> dict:
    actions_out = {}
    for action in ENEMY_ACTIONS:
        src = latest_png(SRC / "monsters" / mon_id / "sheets" / action)
        if not src:
            print(f"  ! 缺少敌人源图: {action}")
            continue
        frames = split_frames(Image.open(src))
        if not frames:
            continue
        max_h = max(f.height for f in frames)
        max_w = max(f.width for f in frames)
        scale = min((CELL - 24) / max_h, (CELL - 24) / max_w, 1.6)
        out_dir = OUT / "enemy" / mon_id / action
        out_dir.mkdir(parents=True, exist_ok=True)
        strip = Image.new("RGBA", (CELL * len(frames), CELL), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            w, h = max(1, round(f.width * scale)), max(1, round(f.height * scale))
            strip.alpha_composite(f.resize((w, h), Image.LANCZOS),
                                  (i * CELL + (CELL - w) // 2, GROUND_Y - h))
        strip.save(out_dir / "S.png")
        actions_out[action] = len(frames)
        print(f"  enemy/{mon_id}/{action}: {len(frames)} frames")
    return actions_out


# ---------------- manifest ----------------

def build_manifest(enemy_actions: dict):
    def pbd(rel):
        return {d: f"{rel}/{d}.png" for d in DIRS4}

    layout_public = {k: v for k, v in LAYOUT.items() if not k.startswith("_")}
    manifest = {
        "version": 4,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "partGrid": GRID,
        "anchorFootY": FOOT_Y,
        "cell": {"w": CELL, "h": CELL, "pivotX": CELL // 2, "pivotY": GROUND_Y},
        "directions": DIRS4,
        "sharedBodies": {
            "path": "role/common",
            "parts": {"arm": PART_H["arm"], "torso_U": PART_H["torso_U"],
                      "torso_L": PART_H["torso_L"], "leg": PART_H["leg"]},
            "layoutS": layout_public,
            "zOrderS": Z_ORDER_S,
        },
        "characters": [{
            "id": "engineer_spanner",
            "headPath": "role/engineer_spanner",
            "bodyRef": "sharedBodies",
            "equipment": {"hat": "engineer_cap", "back": "gearpack",
                          "hand": "gloves", "foot": "boots", "weapon": "wrench"},
        }],
        "equipment": [
            {"id": "engineer_cap", "slot": "hat", "sharedImage": False,
             "pathByDirection": pbd("equipment/hat/engineer_cap")},
            {"id": "gearpack", "slot": "back", "sharedImage": False,
             "strapOnlyDirs": ["S"],       # S 只有背带（包体被身体挡住），其余方向只有包体
             "pathByDirection": pbd("equipment/back/gearpack")},
            {"id": "boots", "slot": "foot", "sharedImage": False,
             "mirrored": True,             # 每方向仅 1 只，左右复用 + 一侧镜像
             "pathByDirection": pbd("equipment/foot/boots")},
            {"id": "gloves", "slot": "hand", "sharedImage": True,
             "mirrored": True,             # 单只握拳，左右复用 + 一侧镜像
             "pose": "fist",
             "path": "equipment/hand/gloves/single.png"},
            {"id": "wrench", "slot": "weapon", "sharedImage": True,
             "path": "equipment/weapon/wrench/single.png"},
        ],
        "enemies": [{
            "id": "rust_hound",
            "path": "enemy/rust_hound",
            "displayHeight": 1.35,
            "actions": {
                "idle": {"frames": enemy_actions.get("idle", 6), "fps": 8, "loop": True},
                "walk": {"frames": enemy_actions.get("walk", 8), "fps": 14, "loop": True},
                "attack": {"frames": enemy_actions.get("attack", 5), "fps": 16,
                           "loop": False, "eventFrames": [3]},
                "hit": {"frames": enemy_actions.get("hit", 3), "fps": 20, "loop": False},
                "death": {"frames": enemy_actions.get("death", 6), "fps": 10, "loop": False},
            },
        }],
    }
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("  manifest.json (v4)")


def main() -> int:
    print("build_sprites: 大图 → public/assets/sprites/")
    build_character()
    enemy_actions = build_enemy("rust_hound")
    build_manifest(enemy_actions)
    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
