#!/usr/bin/env python3
"""占位精灵生成器：按 .trae/skills/sprite-8dir-anim/SKILL.md 的新目录结构，
在 public/assets/sprites/ 下生成结构合规、可直接联调的简单占位资源。

真实流程应为：大模型生成大图 → tools/build_sprites.py 网格裁剪。
本脚本只是"无生图模型时先简单生成"的占位实现，后续逐项用正式产物替换即可。

规范要点（与 SKILL.md 对齐）：
- 部件网格 512x512，锚点：脚底/部件底 = (256, 412)（距底 100）；head/hat 顶锚 = (256, 100)（距顶 100）。
- 敌人运行时格式：enemy/<id>/<action>/<DIR>.png 横向帧条带，单元格 384x384，地面线 y=376。
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "assets" / "sprites"

GRID = 512
CELL = 384
MARGIN = 8
FOOT_Y = 412          # 距网格底 100
NECK_TOP_Y = 100      # 距网格顶 100
GROUND_Y = CELL - MARGIN

DIRS4 = ["S", "E", "N", "W"]
DIRS8 = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"]

BODY_SLOTS = [
    "head", "neck", "torso_U", "torso_L",
    "upper_arm_L", "upper_arm_R", "forearm_L", "forearm_R",
    "thigh_L", "thigh_R", "calf_L", "calf_R",
]

ENEMY_ACTIONS = {
    "idle": {"frames": 6, "fps": 8, "loop": True},
    "walk": {"frames": 8, "fps": 14, "loop": True},
    "attack": {"frames": 5, "fps": 16, "loop": False},
    "hit": {"frames": 3, "fps": 20, "loop": False},
    "death": {"frames": 6, "fps": 10, "loop": False},
}

# ---- 调色板（Don't Starve 风：厚黑描边 + 平涂）----
OUTLINE = (38, 32, 26, 255)
JACKET = (146, 94, 48, 255)
NAVY = (52, 64, 96, 255)
SKIN = (238, 198, 156, 255)
LEATHER = (110, 66, 38, 255)
BOOT = (88, 52, 30, 255)
BRASS = (190, 140, 50, 255)
STEEL = (168, 176, 186, 255)
RUST = (150, 84, 48, 255)
RUST_DARK = (112, 60, 34, 255)
GLOVE = (176, 116, 62, 255)
HAIR = (86, 58, 34, 255)
EYE = (255, 210, 80, 255)
BELT = (70, 44, 24, 255)


def new_cell(size: int = GRID):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def rod(d: ImageDraw.ImageDraw, p0, p1, w, fill):
    """带黑描边的细杆（Don't Starve 线状肢体）。"""
    d.line([p0, p1], fill=OUTLINE, width=w + 6)
    d.line([p0, p1], fill=fill, width=w)


def ball(d: ImageDraw.ImageDraw, cx, cy, r, fill):
    d.ellipse([cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3], fill=OUTLINE)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)


def blob(d: ImageDraw.ImageDraw, box, fill, radius=16):
    d.rounded_rectangle(box, radius=radius, fill=OUTLINE)
    d.rounded_rectangle(
        [box[0] + 4, box[1] + 4, box[2] - 4, box[3] - 4],
        radius=max(4, radius - 4), fill=fill,
    )


# ================= 角色公共部件（role/common/<dir>/<slot>.png） =================

def draw_body_part(slot: str, dir_key: str) -> Image.Image:
    img, d = new_cell()
    cx, fy = 256, FOOT_Y
    narrow = dir_key in ("E", "W")
    spread = 20 if narrow else 44        # 双腿/双臂横向间距
    arm_x = 18 if narrow else 96

    def side_x(which: str) -> int:
        off = spread if slot.startswith(("thigh", "calf")) else arm_x
        return cx - off if which.endswith("_L") else cx + off

    if slot == "head":
        # 锚点 (256, 100)：下巴/脖子接口在 y=100，头向上画
        cy = NECK_TOP_Y - 50
        d.ellipse([cx - 52, cy - 52, cx + 52, cy + 52], fill=OUTLINE)
        d.ellipse([cx - 48, cy - 48, cx + 48, cy + 48], fill=SKIN)
        d.pieslice([cx - 48, cy - 48, cx + 48, cy + 48], 180, 360, fill=HAIR)
        if dir_key != "N":
            gx = 0 if dir_key == "S" else (14 if dir_key == "E" else -14)
            for ex in (-20 + gx, 20 + gx):
                d.ellipse([cx + ex - 13, cy - 6, cx + ex + 13, cy + 18], fill=OUTLINE)
                d.ellipse([cx + ex - 10, cy - 3, cx + ex + 10, cy + 15], fill=BRASS)
                d.ellipse([cx + ex - 5, cy + 1, cx + ex + 5, cy + 11], fill=(120, 180, 220, 255))

    elif slot == "neck":
        rod(d, (cx, fy), (cx, fy - 70), 12, SKIN)
        ball(d, cx, fy - 70, 8, SKIN)

    elif slot == "torso_U":
        blob(d, [cx - 70, fy - 150, cx + 70, fy], JACKET, 18)
        d.rectangle([cx - 66, fy - 60, cx + 66, fy - 46], fill=(120, 74, 38, 255))
        if dir_key == "S":
            d.line([cx, fy - 140, cx, fy - 66], fill=OUTLINE, width=5)

    elif slot == "torso_L":
        blob(d, [cx - 58, fy - 130, cx + 58, fy], NAVY, 14)
        d.rectangle([cx - 58, fy - 44, cx + 58, fy - 30], fill=BELT)
        ball(d, cx, fy - 37, 7, BRASS)

    elif slot.startswith("upper_arm"):
        x = side_x(slot)
        rod(d, (x, fy - 104), (x, fy), 14, JACKET)
        ball(d, x, fy - 104, 12, JACKET)

    elif slot.startswith("forearm"):
        x = side_x(slot)
        rod(d, (x, fy - 100), (x, fy - 30), 12, JACKET)
        ball(d, x, fy - 22, 14, SKIN)  # 手

    elif slot.startswith("thigh"):
        x = side_x(slot)
        rod(d, (x, fy - 116), (x, fy), 16, NAVY)
        ball(d, x, fy - 116, 11, NAVY)
        ball(d, x, fy - 8, 9, NAVY)

    elif slot.startswith("calf"):
        x = side_x(slot)
        rod(d, (x, fy - 104), (x, fy - 26), 14, LEATHER)
        ball(d, x, fy - 104, 10, LEATHER)
        blob(d, [x - 24, fy - 34, x + 28, fy], BOOT, 8)  # 靴子

    return img


def build_role_common():
    for dir_key in DIRS4:
        out_dir = OUT / "role" / "common" / dir_key
        out_dir.mkdir(parents=True, exist_ok=True)
        for slot in BODY_SLOTS:
            draw_body_part(slot, dir_key).save(out_dir / f"{slot}.png")
    print("  role/common: 4 dirs x 12 parts")


def build_character_head(char_id: str):
    """角色头：同公共 head 画法，但发型/配色不同以示区分。"""
    for dir_key in DIRS4:
        img, d = new_cell()
        cx, cy = 256, NECK_TOP_Y - 50
        d.ellipse([cx - 54, cy - 54, cx + 54, cy + 54], fill=OUTLINE)
        d.ellipse([cx - 50, cy - 50, cx + 50, cy + 50], fill=SKIN)
        d.pieslice([cx - 50, cy - 50, cx + 50, cy + 50], 200, 340, fill=(64, 42, 24, 255))
        if dir_key != "N":
            gx = 0 if dir_key == "S" else (16 if dir_key == "E" else -16)
            for ex in (-22 + gx, 22 + gx):
                d.ellipse([cx + ex - 14, cy - 8, cx + ex + 14, cy + 18], fill=OUTLINE)
                d.ellipse([cx + ex - 11, cy - 5, cx + ex + 11, cy + 15], fill=BRASS)
                d.ellipse([cx + ex - 6, cy, cx + ex + 6, cy + 10], fill=(150, 200, 240, 255))
        out_dir = OUT / "role" / char_id
        out_dir.mkdir(parents=True, exist_ok=True)
        img.save(out_dir / f"{dir_key}.png")
    print(f"  role/{char_id}: 4 dir heads")


# ================= 装备（equipment/<slot>/<item>/） =================

def build_equipment():
    # hat: 锚点距顶 100（帽檐下沿在 y=100）
    for dir_key in DIRS4:
        img, d = new_cell()
        cx, by = 256, NECK_TOP_Y
        d.ellipse([cx - 82, by - 96, cx + 82, by - 8], fill=OUTLINE)      # 盔顶
        d.ellipse([cx - 76, by - 90, cx + 76, by - 14], fill=BRASS)
        blob(d, [cx - 92, by - 12, cx + 92, by + 10], BRASS, 6)           # 帽檐
        if dir_key != "N":
            gx = 0 if dir_key == "S" else (20 if dir_key == "E" else -20)
            d.ellipse([cx + gx - 30, by - 74, cx + gx + 30, by - 30], fill=OUTLINE)
            d.ellipse([cx + gx - 25, by - 69, cx + gx + 25, by - 35], fill=(90, 70, 40, 255))
        for rx in (-40, 0, 40):
            ball(d, cx + rx, by - 88, 5, (220, 176, 80, 255))
        (OUT / "equipment" / "hat" / "engineer_helmet").mkdir(parents=True, exist_ok=True)
        img.save(OUT / "equipment" / "hat" / "engineer_helmet" / f"{dir_key}.png")

    # back 背包: 锚点距底 100
    for dir_key in DIRS4:
        img, d = new_cell()
        cx, fy = 256, FOOT_Y
        w = 120 if dir_key == "N" else (72 if dir_key == "S" else 100)
        blob(d, [cx - w // 2, fy - 150, cx + w // 2, fy], LEATHER, 20)
        d.rectangle([cx - w // 2 + 8, fy - 92, cx + w // 2 - 8, fy - 74], fill=BELT)
        ball(d, cx, fy - 60, 26, BRASS)                                    # 齿轮
        ball(d, cx, fy - 60, 10, (120, 84, 26, 255))
        for tx in (-w // 2 + 10, w // 2 - 10):                             # 背带
            d.line([cx + tx, fy - 150, cx + tx, fy - 30], fill=OUTLINE, width=10)
        (OUT / "equipment" / "back" / "brass_gears").mkdir(parents=True, exist_ok=True)
        img.save(OUT / "equipment" / "back" / "brass_gears" / f"{dir_key}.png")

    # hand 手套: 1 张共用图，锚点距底 100
    img, d = new_cell()
    cx, fy = 256, FOOT_Y
    blob(d, [cx - 44, fy - 112, cx + 44, fy], GLOVE, 26)
    blob(d, [cx + 34, fy - 84, cx + 74, fy - 44], GLOVE, 18)               # 拇指
    d.rectangle([cx - 48, fy - 116, cx + 48, fy - 92], fill=BELT)
    (OUT / "equipment" / "hand" / "work_gloves").mkdir(parents=True, exist_ok=True)
    img.save(OUT / "equipment" / "hand" / "work_gloves" / "single.png")

    # foot 鞋子: 锚点距底 100
    for dir_key in DIRS4:
        img, d = new_cell()
        cx, fy = 256, FOOT_Y
        if dir_key in ("E", "W"):
            s = 1 if dir_key == "E" else -1
            blob(d, [cx - 22, fy - 120, cx + 22, fy - 34], BOOT, 8)        # 靴筒
            blob(d, [min(cx - 22, cx + s * 54), fy - 40, max(cx - 22, cx + s * 54), fy], BOOT, 10)  # 靴头
            d.rectangle([min(cx - 22, cx + s * 54), fy - 10, max(cx - 22, cx + s * 54), fy], fill=(50, 30, 18, 255))
        else:
            for bx in (cx - 34, cx + 34):
                blob(d, [bx - 22, fy - 120, bx + 22, fy - 34], BOOT, 8)
                blob(d, [bx - 26, fy - 40, bx + 26, fy], BOOT, 10)
        (OUT / "equipment" / "foot" / "steel_boots").mkdir(parents=True, exist_ok=True)
        img.save(OUT / "equipment" / "foot" / "steel_boots" / f"{dir_key}.png")

    # weapon 武器(扳手): 1 张共用图，锚点距底 100
    img, d = new_cell()
    cx, fy = 256, FOOT_Y
    rod(d, (cx, fy - 40), (cx, fy - 190), 20, STEEL)
    d.ellipse([cx - 44, fy - 268, cx + 44, fy - 180], fill=OUTLINE)
    d.ellipse([cx - 38, fy - 262, cx + 38, fy - 186], fill=STEEL)
    d.rectangle([cx - 12, fy - 268, cx + 12, fy - 210], fill=(0, 0, 0, 0))  # 开口
    ball(d, cx, fy - 120, 10, BRASS)
    (OUT / "equipment" / "weapon" / "wrench").mkdir(parents=True, exist_ok=True)
    img.save(OUT / "equipment" / "weapon" / "wrench" / "single.png")

    print("  equipment: hat x4, back x4, foot x4, hand x1, weapon x1")


# ================= 敌人（enemy/<id>/<action>/<DIR>.png 横向帧条带） =================

def enemy_pose(action: str, i: int, frames: int) -> dict:
    p = i / max(1, frames - 1)
    if action == "idle":
        return {"bob": abs(math.sin(2 * math.pi * i / frames)) * 3, "leg": 0.0,
                "lunge": 0.0, "dead": 0.0}
    if action == "walk":
        return {"bob": abs(math.cos(2 * math.pi * i / frames)) * 4,
                "leg": math.sin(2 * math.pi * i / frames), "lunge": 0.0, "dead": 0.0}
    if action == "attack":
        return {"bob": 0.0, "leg": 0.25, "lunge": math.sin(math.pi * p) * 28, "dead": 0.0}
    if action == "hit":
        return {"bob": 10 * math.sin(math.pi * p), "leg": -0.2, "lunge": 0.0, "dead": 0.0}
    return {"bob": 0.0, "leg": 0.0, "lunge": 0.0, "dead": p}  # death


def draw_hound_side(img: Image.Image, prm: dict, eye: bool = True):
    d = ImageDraw.Draw(img)
    cx, gy = 192, GROUND_Y
    dx = prm["lunge"]
    dead = prm["dead"]
    if dead > 0.9:  # 倒地
        d.ellipse([cx - 78, gy - 36, cx + 74, gy - 4], fill=OUTLINE)
        d.ellipse([cx - 72, gy - 31, cx + 68, gy - 9], fill=RUST)
        d.ellipse([cx + 52, gy - 34, cx + 86, gy - 8], fill=OUTLINE)
        d.ellipse([cx + 55, gy - 31, cx + 83, gy - 11], fill=RUST)
        d.line([cx - 14, gy - 24, cx - 2, gy - 20], fill=OUTLINE, width=4)
        d.line([cx + 10, gy - 22, cx + 22, gy - 26], fill=OUTLINE, width=4)
        return
    by = gy - 66 + prm["bob"] + dead * 26
    lofs = prm["leg"] * 16
    for lx, ph in ((cx - 30, 1), (cx - 16, -1), (cx + 14, -1), (cx + 28, 1)):
        swing = lofs * ph
        d.line([lx, by + 12, lx + swing, gy - 4], fill=OUTLINE, width=11)
        d.line([lx, by + 12, lx + swing, gy - 4], fill=RUST_DARK, width=6)
    d.ellipse([cx - 48, by - 24, cx + 48, by + 24], fill=OUTLINE)
    d.ellipse([cx - 43, by - 19, cx + 43, by + 19], fill=RUST)
    for rx in (-26, -12, 2, 16):  # 左侧外露钢肋
        d.line([rx, by - 14, rx, by + 8], fill=STEEL, width=3)
    ball(d, cx - 12, by - 16, 8, BRASS)  # 肩部齿轮
    tail = [(cx - 46, by - 10), (cx - 62, by - 26 + prm["leg"] * 6), (cx - 58, by - 44)]
    d.line(tail, fill=OUTLINE, width=9, joint="curve")
    d.line(tail, fill=BRASS, width=4, joint="curve")
    hx, hy = cx + 44 + dx * 0.6, by - 20 - dead * 16
    d.ellipse([hx - 28, hy - 26, hx + 28, hy + 26], fill=OUTLINE)
    d.ellipse([hx - 23, hy - 21, hx + 23, hy + 21], fill=RUST)
    d.ellipse([hx + 12 + dx * 0.4, hy + 2, hx + 44 + dx * 0.4, hy + 16], fill=OUTLINE)   # 嘴
    d.ellipse([hx + 15 + dx * 0.4, hy + 5, hx + 41 + dx * 0.4, hy + 13], fill=RUST_DARK)
    if eye:
        d.ellipse([hx + 0, hy - 12, hx + 12, hy - 2], fill=OUTLINE)
        d.ellipse([hx + 2, hy - 10, hx + 10, hy - 4], fill=EYE)
    d.polygon([(hx - 18, hy - 20), (hx - 8, hy - 40), (hx - 2, hy - 18)], fill=OUTLINE)  # 耳
    d.polygon([(hx - 16, hy - 20), (hx - 9, hy - 34), (hx - 4, hy - 18)], fill=RUST)


def draw_hound_front(img: Image.Image, prm: dict, back: bool = False):
    d = ImageDraw.Draw(img)
    cx, gy = 192, GROUND_Y
    dead = prm["dead"]
    by = gy - 60 + prm["bob"] + dead * 26
    lofs = prm["leg"] * 14
    for lx, ph in ((cx - 34, 1), (cx - 18, -1), (cx + 18, -1), (cx + 34, 1)):
        swing = lofs * ph
        d.line([lx, by + 10, lx + swing, gy - 4], fill=OUTLINE, width=11)
        d.line([lx, by + 10, lx + swing, gy - 4], fill=RUST_DARK, width=6)
    d.ellipse([cx - 44, by - 26, cx + 44, by + 26], fill=OUTLINE)
    d.ellipse([cx - 39, by - 21, cx + 39, by + 21], fill=RUST)
    d.ellipse([cx - 34, by - 44, cx + 34, by + 8], fill=OUTLINE)
    d.ellipse([cx - 29, by - 39, cx + 29, by + 3], fill=RUST)
    if back:
        d.line([cx - 20, by - 30, cx + 20, by - 18], fill=BRASS, width=5)  # 背部齿轮
        ball(d, cx, by - 26, 8, BRASS)
    else:
        for ex in (-14, 14):
            d.ellipse([cx + ex - 7, by - 34, cx + ex + 7, by - 22], fill=OUTLINE)
            d.ellipse([cx + ex - 5, by - 32, cx + ex + 5, by - 24], fill=EYE)
        d.ellipse([cx - 10, by - 14, cx + 10, by - 2], fill=OUTLINE)       # 鼻
        for ex in (-26, 26):                                               # 耳
            d.polygon([(cx + ex - 6, by - 36), (cx + ex, by - 56), (cx + ex + 6, by - 36)], fill=OUTLINE)
    tail = [(cx + 38, by + 6), (cx + 58, by - 8), (cx + 54, by - 28)]
    d.line(tail, fill=OUTLINE, width=9, joint="curve")
    d.line(tail, fill=BRASS, width=4, joint="curve")


def build_enemy(mon_id: str):
    for action, cfg in ENEMY_ACTIONS.items():
        frames = cfg["frames"]
        # 先画 E（右侧视）/ S（正面）/ N（背面）基准帧
        base: dict[str, list[Image.Image]] = {"E": [], "S": [], "N": []}
        for i in range(frames):
            prm = enemy_pose(action, i, frames)
            e = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
            draw_hound_side(e, prm)
            base["E"].append(e)
            s = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
            draw_hound_front(s, prm, back=False)
            base["S"].append(s)
            n = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
            draw_hound_front(n, prm, back=True)
            base["N"].append(n)

        mirrored = {d: [f.transpose(Image.FLIP_LEFT_RIGHT) for f in base["E"]] for d in ("W",)}
        del mirrored

        def frames_for(dir_key: str) -> list[Image.Image]:
            if dir_key in ("SE", "NE"):
                return base["E"]
            if dir_key in ("SW", "NW"):
                return [f.transpose(Image.FLIP_LEFT_RIGHT) for f in base["E"]]
            if dir_key == "W":
                return [f.transpose(Image.FLIP_LEFT_RIGHT) for f in base["E"]]
            return base[dir_key]

        for dir_key in DIRS8:
            strip = Image.new("RGBA", (CELL * frames, CELL), (0, 0, 0, 0))
            for i, f in enumerate(frames_for(dir_key)):
                strip.paste(f, (i * CELL, 0))
            out_dir = OUT / "enemy" / mon_id / action
            out_dir.mkdir(parents=True, exist_ok=True)
            strip.save(out_dir / f"{dir_key}.png")
    print(f"  enemy/{mon_id}: 5 actions x 8 dirs strips")


# ================= manifest =================

def build_manifest():
    def path_by_dir(rel: str) -> dict:
        return {d: f"{rel}/{d}.png" for d in DIRS4}

    manifest = {
        "version": 2,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "note": "PLACEHOLDER assets generated by tools/gen_placeholder_sprites.py; replace with real generated sprites.",
        "gridSize": GRID,
        "cell": {"w": CELL, "h": CELL, "pivotX": CELL // 2, "pivotY": GROUND_Y},
        "directions": DIRS4,
        "directions8": DIRS8,
        "sharedBodies": {
            "path": "role/common",
            "anchorFootY": FOOT_Y,
            "anchorNeckTopY": NECK_TOP_Y,
            "zOrderByDirection": {
                "S": ["thigh_L", "thigh_R", "calf_L", "calf_R", "torso_L", "torso_U",
                      "neck", "upper_arm_L", "upper_arm_R", "forearm_L", "forearm_R", "head"],
                "E": ["thigh_L", "torso_L", "calf_R", "torso_U", "neck", "upper_arm_R",
                      "forearm_R", "head", "calf_L", "upper_arm_L", "forearm_L"],
                "N": ["calf_L", "calf_R", "thigh_L", "thigh_R", "torso_L", "torso_U",
                      "neck", "head", "forearm_L", "forearm_R", "upper_arm_L", "upper_arm_R"],
                "W": "mirror_of_E",
            },
        },
        "characters": [
            {
                "id": "engineer_spanner",
                "headPath": "role/engineer_spanner",
                "bodyRef": "sharedBodies",
                "equipment": {
                    "hat": "engineer_helmet",
                    "back": "brass_gears",
                    "hand": "work_gloves",
                    "foot": "steel_boots",
                    "weapon": "wrench",
                },
            }
        ],
        "equipment": [
            {"id": "engineer_helmet", "slot": "hat", "sharedImage": False,
             "pathByDirection": path_by_dir("equipment/hat/engineer_helmet")},
            {"id": "brass_gears", "slot": "back", "sharedImage": False,
             "pathByDirection": path_by_dir("equipment/back/brass_gears")},
            {"id": "steel_boots", "slot": "foot", "sharedImage": False,
             "pathByDirection": path_by_dir("equipment/foot/steel_boots")},
            {"id": "work_gloves", "slot": "hand", "sharedImage": True,
             "path": "equipment/hand/work_gloves/single.png"},
            {"id": "wrench", "slot": "weapon", "sharedImage": True,
             "path": "equipment/weapon/wrench/single.png"},
        ],
        "enemies": [
            {
                "id": "rust_hound",
                "path": "enemy/rust_hound",
                "displayHeight": 1.35,
                "actions": ENEMY_ACTIONS,
            }
        ],
    }
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("  manifest.json")


def main() -> int:
    print("生成占位精灵 → public/assets/sprites/")
    build_role_common()
    build_character_head("engineer_spanner")
    build_equipment()
    build_enemy("rust_hound")
    build_manifest()
    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
