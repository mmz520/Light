---
name: "sprite-8dir-anim"
description: "Unified generation spec for block-assembled characters, shared equipment, and frame-animated monsters (Don't Starve style). Invoke when creating character body parts, shared heads/equipment, or monster sprite sheets for the game."
---

# 《饥荒》式角色 · 装备 · 怪物 统一生成 Skill

> 本 Skill 是本项目 **所有角色资源的唯一标准**。覆盖三种产出：
> 1. **角色身体部件**（分块组装，身体全项目共享，新角色只换头）
> 2. **装备**（全角色共用，武器/手套共用 1 张图，其他 4 方向）
> 3. **怪物**（帧动画，4 方向 5 动作，一方向走完再进下一个）
>
> 三种产出统一使用 **"一个方向一张大图 + 等宽高网格排布 + 脚本裁剪"** 的生成方式，大模型不需要理解部件边界——只要按网格画，脚本负责一切切分与对齐。

---

## 0. 统一生成范式（三种产出通用）

### 0.1 大图 + 网格裁剪

**一个方向 = 一张大图**。大模型把该方向下的所有内容（角色身体部件 / 装备 / 怪物某动作的所有帧）按等宽高的网格排布在一张图上。**大图上不画网格线**——网格只在 prompt 里告诉模型"每行几格、每列几格"，脚本根据 `gridSize` 参数切分。

```
示例：角色身体 S 方向大图
┌─────┬─────┬─────┬─────┐
│ 头  │ 脖  │     │     │  ← 1 行 12 格（9 个部件 + 3 个占位）
├─────┼─────┼─────┼─────┤     每格都是正方形 512×512
│上躯干│下躯干│     │     │
├─────┼─────┼─────┼─────┤
│上臂_L│上臂_R│     │     │
├─────┼─────┼─────┼─────┤
│下臂_L│下臂_R│     │     │
├─────┼─────┼─────┼─────┤
│大腿_L│大腿_R│     │     │
├─────┼─────┼─────┼─────┤
│小腿_L│小腿_R│     │     │
└─────┴─────┴─────┴─────┘
```

### 0.2 关键对齐规则（强制 —— 堆叠时 0 位移直接拼出角色）

**目标**：脚本裁剪完所有小图后，把它们放到同一个画布上、**引擎不做任何 per-part 位移**，直接按 Z 顺序叠就得到正确的角色形象。以下 4 条全部必须遵守：

1. **同一方向大图内，所有部件的脚底对齐线（foot baseline）必须落在大图完全相同的像素 Y 坐标**。这是最外层约束——整张图里所有部件的脚踩在同一水平线上。

2. **网格内锚点 Y 坐标强制统一**。每个部件画在自己的 512×512 网格内时，**脚底距网格底部固定 100 像素**（即部件自身锚点 `localFootY = gridSize - 100 = 412`，从网格顶数下来是第 412 行，从网格底往上数是第 100 行）。脖子类部件（head / neck）则规定**脖子顶距网格顶部固定 100 像素**（`localNeckTopY = 100`）。**这个值（100）是全项目硬编码常量，脚本和引擎都按此读取**。

3. **所有部件必须围绕自己的锚点居中**——锚点在网格内 x 方向居中（x=256），y 方向落在上面规定的 412 / 100。四周留出的透明边距由模型按部件实际形态自动调整，**模型不能为了"好看"把脚往上抬、不能让脖子飘得太高**。

4. **部件自身锚点定义**（每个部件都明确自己哪个位置算"脚底"）：
   | slot | 锚点 | 在网格内的固定位置 |
   |------|------|------------------|
   | calf_L / calf_R | 靴底中心 | y = 412 距底 100 |
   | thigh_L / thigh_R | （延伸）大腿下沿 → 自然接 calf 的膝球，锚点仍归 calf | — |
   | forearm_L / forearm_R | 手掌中心 | 部件底部，距底 100 |
   | upper_arm_L / upper_arm_R | 肩球中心 | 部件底部，距底 100 |
   | torso_U | 底腰带边缘（接 torso_L） | y = 412 距底 100 |
   | torso_L | 底腰带边缘（接 thigh） | y = 412 距底 100 |
   | neck | 脖子下端（接 torso_U 顶） | y = 412 距底 100 |
   | head | 脖子顶（接 neck 顶） | y = 100 距顶 100（head 用 neck 顶作锚点，因为 head 底部不是脚） |
   | weapon / gloves | 握柄中心 | y = 412 距底 100 |

**脚本裁剪后的引擎侧行为**（伪代码）：
```ts
// 引擎拿所有部件，全部对齐到 world Y = footBaselineY
for (const part of allParts) {
  // part.localFootY 从裁剪后的小图像素直接读出（恒定 412）
  // 引擎把 part.localFootY 对齐到 world.footBaselineY
  // 不需要每个 part 自己的 offset
  part.y = world.footBaselineY - part.localFootY
  // head 用 neck 顶：part.y = world.footBaselineY + neckLengthPixels - part.localNeckTopY
}
```

**脚本自检**：裁剪完后，PIL 把所有部件按上面规则叠到一起，计算拼接结果与 character_keyframe 的 SSIM，≥ 0.90 才算通过。SSIM < 0.90 说明有部件锚点没对齐 → 整方向大图打回重画。

### 0.3 Prompt 里怎么写这条（强制照抄）

```
[ALIGNMENT RULES — VIOLATE OR RE-DRAW]
- Every part lives in its own 512x512 grid cell.
- EACH PART'S ANCHOR POINT (defined below) MUST land on EXACTLY pixel coordinate (256, 412) INSIDE its own cell.
  (Grid top = 0, bottom = 512. 412 means 100px from grid bottom.)
- Head/neck parts whose anchor is a neck-top: anchor MUST land on (256, 100) — 100px from grid TOP.
- DO NOT move the part up or down inside its cell. DO NOT center the part around some arbitrary point.
  The anchor point IS the only allowed vertical reference.
- After you finish drawing, if you cut out each 512x512 cell and stacked all cutouts on top of each other
  with no offset, the 12 cutouts should reassemble into a complete, naturally standing person
  — foot on floor, head on neck, no gaps, no overlap artifacts at joints.
```
**把这段复制进每一张大图的 Prompt 末尾**，一个字都不要改。这是大模型唯一能遵守对齐规则的手段。

### 0.4 方向顺序（强制 S → E → N → W）

所有多方向产出（角色、装备、怪物）**必须按 下→右→上→左 的顺序依次生成**：

| 顺序 | 方向 | 说明 |
|------|------|------|
| 1    | S 下 | 朝镜头（第一帧，无参考图，纯 CharacterLock） |
| 2    | E 右 | 必须用 **S 方向已完成的大图** 作参考 |
| 3    | N 上 | 必须用 **E 方向已完成的大图** 作参考 |
| 4    | W 左 | 必须用 **N 方向已完成的大图** 作参考 |

这样做的原因：模型逐方向参考能保证同方向内角色比例、配色、不对称元素（武器手、发型分缝）自然过渡，不会每个方向都像换了个角色。

### 0.5 大图规格（全项目统一）

| 参数 | 值 | 说明 |
|------|-----|------|
| 网格尺寸 | **512×512** | 正方形，每格都是一个部件/一帧 |
| 大图尺寸 | 由网格数决定 | 例如 3 列 × 6 行 → 1536 × 3072 |
| 透明通道 | 必须 | 大图除角色外全部透明 |
| 背景 | **纯白 + 极细浅灰色网格线**（仅用于大模型定位，脚本裁掉） |

**Prompt 里固定写**：`Grid cells are 512x512. The whole image is a white canvas with 512px light gray grid lines drawn ONLY to help placement — final cutouts must have transparent backgrounds.`

---

## 1. 角色身体部件（分块组装，全项目共享）

### 1.1 部件清单（强制 12 块）

所有角色身体共用，新角色**只生成 8 方向的头**即可。清单固定：

| 编号 | slot | 名称 | Don't Starve 风格说明 |
|------|------|------|---------------------|
| 0  | `head`       | 头       | 含脸型、头发、眼镜/护目镜 |
| 1  | `neck`       | 脖子     | **线状物**——细杆 + 关节球 |
| 2  | `torso_U`    | 上躯干   | 夹克/工装上半 |
| 3  | `torso_L`    | 下躯干   | 裤子上半 / 腰带 |
| 4  | `upper_arm_L` | 左上臂   | **线状物**——肩到肘的细杆 + 肘球 |
| 5  | `upper_arm_R` | 右上臂   | **线状物**——肩到肘的细杆 + 肘球 |
| 6  | `forearm_L`  | 左前臂   | **线状物**——肘到腕的细杆 + 腕球 + 手套 |
| 7  | `forearm_R`  | 右前臂   | **线状物**——肘到腕的细杆 + 腕球 + 手套 |
| 8  | `thigh_L`    | 左大腿   | **线状物**——胯到膝的细杆 + 膝球 |
| 9  | `thigh_R`    | 右大腿   | **线状物**——胯到膝的细杆 + 膝球 |
| 10 | `calf_L`     | 左小腿   | **线状物**——膝到踝的细杆 + 踝球 + 靴子 |
| 11 | `calf_R`     | 右小腿   | **线状物**——膝到踝的细杆 + 踝球 + 靴子 |

**躯干 4 方向要求合理**：模型画 torso_U / torso_L 时，要让它在等距投影下从 S/E/N/W 4 个角度都看起来自然，不是严格的正面/侧面轮廓——这是 Don't Starve 等距透视的精髓。

### 1.2 一方向大图布局

每个方向一张大图，所有部件按固定顺序填入网格。**S 方向布局模板**（其他方向同布局，只是部件内容按方向变）：

```
列  0       1        2         3
行0  head   neck     (空)      (空)
行1  torso_U torso_L (空)      (空)
行2  upper_arm_L    upper_arm_R  (空)  (空)
行3  forearm_L      forearm_R    (空)  (空)
行4  thigh_L        thigh_R      (空)  (空)
行5  calf_L         calf_R       (空)  (空)
```

大图尺寸 = 4 列 × 512 × 6 行 × 512 = **2048 × 3072**。

**所有部件的脚底对齐线（foot baseline）落在大图统一的某个 Y**（例如 S 方向，`calf_L / calf_R` 的脚底正好在该列网格底部 20px 处；其他行的部件脚基线也对齐到大图中的同一 Y）。

### 1.3 部件自身在网格内的位置

每个部件画在自己的 512×512 网格内时，**必须占据网格的中央，四周留有均匀透明边距**。这样脚本裁剪后，部件自身的局部坐标系的脚底（或脖子顶，依部件而定）就能叠到统一的 foot baseline 上。Prompt 里显式写：

> `Each body part is centered in its 512x512 cell with equal transparent padding on all sides. No part touches a grid edge.`

### 1.4 角色身体生成流程

1. **S 方向**：CharacterLock（身体描述） + ViewLock(S) + 布局模板 + 规格，一次性生成 S 方向大图（无参考图）
2. **E 方向**：CharacterLock + ViewLock(E) + 布局模板 + 规格 + **把刚生成的 S 方向大图作为参考图** 传给模型
3. **N 方向**：同 2，参考图换成刚生成的 E 方向大图
4. **W 方向**：同 2，参考图换成刚生成的 N 方向大图

**12 块部件 × 4 方向 = 48 张小图**，由一个 Python 脚本统一裁剪，产出 `parts/{dir}/{slot}.png`。

### 1.5 新角色生成流程（极简）

新角色 = **只生成 4 方向的 head 大图**（布局简化为 1 行 4 列：head_S / head_E / head_N / head_W）。生成规则同 1.4 的顺序与参考链。其余 11 块身体部件直接从 `shared_bodies/` 目录复用。

### 1.6 角色身体 Z 层（方向不同，层级不同）

分块拼接时，不同方向的遮罩顺序不同（典型示例，按玩家面向为右 → W 方向时左右镜像）：

| 方向 | Z 顺序（后画在上） |
|------|-------------------|
| S 下 | `thigh_L → thigh_R → calf_L → calf_R → torso_L → torso_U → neck → upper_arm_L → upper_arm_R → forearm_L → forearm_R → head` |
| E 右 | `thigh_L → torso → calf_R → forearm_R → head → (mirror L/R)` |
| N 上 | 所有前后腿顺序反过来，前臂在后 |
| W 左 | 与 E 右镜像对称 |

**Z 顺序存到 manifest 的 `zOrderByDirection` 字段**，引擎按方向查。

### 1.7 角色身体大图 Prompt 模板（以 S 方向为例）

```
[CharacterLock —— 全文复用]
Steam-punk engineer body (NO head, head generated separately): brown leather jacket, navy blue overalls with brass rivets, brown leather tool belt on LEFT hip, copper pipes on right shoulder, brown leather work boots. Limbs and neck drawn as Don't Starve style — thin rods + round ball joints at shoulder, elbow, wrist, hip, knee, ankle. Hand-painted digital art, thick black outlines, flat cel shading, sRGB. Transparent background.

[ViewLock —— Facing South, directly toward camera, 0°]
Looking straight down. Legs stand shoulder-width apart, both hands hang at sides. All body parts face the viewer directly.

[Layout]
One BIG image. Grid cells 512x512 square. Layout:
  Row 0:  [head] [neck] [empty] [empty]
  Row 1:  [torso_U] [torso_L] [empty] [empty]
  Row 2:  [upper_arm_L] [upper_arm_R] [empty] [empty]
  Row 3:  [forearm_L] [forearm_R] [empty] [empty]
  Row 4:  [thigh_L] [thigh_R] [empty] [empty]
  Row 5:  [calf_L] [calf_R] [empty] [empty]

[CRITICAL]
- Grid cells are 512x512.
- Draw ONLY these 12 body parts. NO head face/hair — head is generated separately.
- Every part is CENTERED in its cell with equal transparent padding.
- All 12 parts MUST share the SAME foot baseline Y coordinate in the BIG image.
- Neck, arms, forearms, thighs, calves are thin rods + round ball joints.
- Torso_U and torso_L must look reasonable from all 4 directions — use isometric projection, not pure front/side.
- Transparent background ONLY for the cutout parts.
- NO numbered labels, NO text, NO watermarks, NO environment.

[ALIGNMENT RULES — VIOLATE OR RE-DRAW]
- Every part lives in its own 512x512 grid cell.
- EACH PART'S ANCHOR POINT MUST land on EXACTLY pixel coordinate (256, 412) INSIDE its own cell.
  (Grid top = 0, bottom = 512. 412 means 100px from grid bottom.)
- For head/neck parts whose anchor is a neck-top: anchor MUST land on (256, 100) — 100px from grid TOP.
- DO NOT move the part up or down inside its cell. DO NOT center the part around some arbitrary point.
  The anchor point IS the only allowed vertical reference.
- After you finish drawing, if you cut out each 512x512 cell and stacked all cutouts on top of each other
  with Z-order but NO offset, the 12 cutouts should reassemble into a complete, naturally standing person
  — foot on floor, head on neck, no gaps, no overlap artifacts at joints.
```

---

## 2. 装备（全角色共用）

### 2.1 装备清单

| slot | 名称 | 生成方式 | 原因 |
|------|------|---------|------|
| `hat`      | 帽子   | 4 方向（S→E→N→W，前一方向参考） | 帽子方向变化明显 |
| `cape`     | 披风   | 4 方向 | 披风背面在 N 方向可见 |
| `clothes`  | 衣服   | 4 方向 | 外层外套替换身体 torso 的显示 |
| `shoes`    | 鞋子   | 4 方向 | 靴筒方向变化 |
| `backpack` | 背包   | 4 方向 | 背部可见性 |
| `gloves`   | 手套   | **1 张共用图** | 手套小、方向变化微 |
| `weapon`   | 武器   | **1 张共用图** | Shank 式武器挂手，4 方向共用 |

### 2.2 装备大图布局

**需要 4 方向的装备**（hat/cape/clothes/shoes/backpack）：每个装备一张大图，4 行 1 列布局（S / E / N / W 各占一行），每格 512×512。大图尺寸 = 512 × 2048。

**共用 1 张图的装备**（weapon/gloves）：一张图 1 格 512×512，无方向。

装备 Prompt 模板结构同角色身体（CharacterLock → ViewLock → Layout → CRITICAL + 前一方向作参考）。

### 2.3 装备挂载点

**挂载逻辑**：装备的锚点必须与它挂载/替换的角色身体部件的锚点**像素坐标完全一致**（都在各自 512×512 网格内），这样装备叠上去也是 0 位移。

| 装备 slot | 挂载/替换的身体部件 | 装备自己的锚点（在装备网格内） |
|----------|-------------------|------------------------------|
| `hat`      | 挂在 head 的 neck 顶 | 锚点在装备网格距顶 100（head 自己锚距顶 100） |
| `cape`     | 挂在 torso_U 背部 | 锚点距底 100（同 torso_U） |
| `backpack` | 挂在 torso_U 背部 | 锚点距底 100 |
| `clothes`  | **替换** torso_U + torso_L | 锚点距底 100，覆盖这两个 body slot 的显示 |
| `shoes`    | **替换** calf_L + calf_R 的靴子部分 | 锚点距底 100，覆盖 calf 的下半部 |
| `gloves`   | **替换** forearm_L + forearm_R 的手套部分 | 锚点距底 100 |
| `weapon`   | 挂在 forearm_R 的手掌中心 | 锚点距底 100 |

### 2.4 装备 Prompt 模板示例（hat 4 方向大图）

装备的 Prompt 结构和角色身体完全相同，ALIGNMENT RULES 也是§0.3 那段原文复用。唯一区别是布局（4 行 1 列）和 CharacterLock 内容。

```
[CharacterLock —— 装备专属，全文复用]
Engineer brass helmet with small round goggles on front, black leather chin strap, 3 brass rivets on side. Don't Starve thick black outlines, flat cel shading.

[ViewLock —— Facing South]
...（4 方向各自一段）

[Layout]
One BIG image. 4 rows × 1 column of 512x512 cells.
  Row 0: hat_S
  Row 1: hat_E
  Row 2: hat_N
  Row 3: hat_W

[CRITICAL]
- Grid cells 512x512.
- ONLY draw the hat — NO head underneath. Hat looks like it floats when cut out alone.
- 4 directions, each hat must look correct facing its direction. S = 头盔正面向镜头，E = 头盔侧面朝右，N = 头盔背部，W = 侧面朝左。
- Transparent background ONLY. NO labels.

[ALIGNMENT RULES — 与 §0.3 角色身体那段完全相同，原文照抄]
...
```

---

## 3. 怪物（帧动画，不分块）

### 3.1 生成范式

怪物不使用分块——**直接生成帧动画大图**。一方向内，先走完所有动作（站立 → 行走 → 攻击 → 受击 → 死亡）再进下一个方向。

**方向顺序**：S → E → N → W（与角色相同）
**动作顺序（一方向内）**：`idle` → `walk` → `attack` → `hit` → `death`

### 3.2 一方向内的参考链

- 该方向第一张图 = idle（用 CharacterLock + ViewLock(方向)，无参考）
- 该方向 walk / attack / hit / death 的参考图 = **该方向 idle 的第一帧**

跨方向参考链不变：E 参考 S，N 参考 E，W 参考 N（但只参考 idle 图，因为前一方向的 idle 已经确定了怪物比例与配色）。

### 3.3 一方向内 5 张大图布局

一个方向 = **5 张大图**，每张图 = 一个动作的所有帧，帧按 1 行多列排布，每帧都是 512×512 网格。

| 动作 | 帧数 | 大图尺寸（列×512 × 1行×512） | 说明 |
|------|------|---------------------------|------|
| idle   | 6    | 3072 × 512                | 循环，呼吸 |
| walk   | 8    | 4096 × 512                | 循环，步态 |
| attack | 5    | 2560 × 512                | 非循环，第 3 帧命中 |
| hit    | 3    | 1536 × 512                | 非循环，退后 |
| death  | 6    | 3072 × 512                | 非循环，倒地 |

**所有大图网格尺寸相同（512×512）**，脚本统一切。同一方向内 5 张大图的怪物脚底对齐线必须一致（不同动作下怪的脚不飘）。

### 3.4 怪物造型要求（简洁生动）

- 零部件**控制在 5 个以内**（头、身体、腿、尾巴/武器、1 个标志性特征）
- 不要画复杂机械结构、多层装甲、可拆卸附件——AI 多次生成时会不一致
- Don't Starve 风格：厚黑描边、平涂 cel shading、头大身小（头:身 ≈ 1:3）、蓝/绿/棕/红调色板
- 运动方式明确（走、跑、跳、爬行）

### 3.5 怪物生成流程（完整示例）

```
方向 S：
  1. GenerateImage → monster_idle_S.png（无参考，CharacterLock + ViewLock(S) + idle 描述）
  2. GenerateImage → monster_walk_S.png（参考：monster_idle_S.png 第 1 帧）
  3. GenerateImage → monster_attack_S.png（参考：monster_idle_S.png 第 1 帧）
  4. GenerateImage → monster_hit_S.png（参考：monster_idle_S.png 第 1 帧）
  5. GenerateImage → monster_death_S.png（参考：monster_idle_S.png 第 1 帧）

方向 E：
  6. GenerateImage → monster_idle_E.png（参考：monster_idle_S.png）
  7. GenerateImage → monster_walk_E.png（参考：monster_idle_E.png 第 1 帧）
  ...
依此类推 N → W
```

### 3.6 怪物大图 Prompt 模板（monster_idle_S.png）

```
[CharacterLock —— 全文复用，一字不改]
Rust Hound (锈蚀猎犬): small four-legged wolf-like creature, rust-brown fur with brass gears embedded in shoulders, glowing yellow eyes, exposed steel ribs on left side, curled brass wire tail. Simple 5-part silhouette. Thick black outlines, flat cel shading, Don't Starve style, sRGB.

[ViewLock —— Facing South, directly toward camera, 0°]
Looking straight down. Hound stands in idle breathing pose, legs planted firmly.

[Layout]
One BIG image. 1 row × 6 columns of 512x512 cells.
  [frame 1] [frame 2] [frame 3] [frame 4] [frame 5] [frame 6]
All frames show THE SAME hound, same size, same pose variation.

[CRITICAL]
- Grid cells are 512x512 square. All cells same size.
- Idle animation, 6 frames, loopable. Frame 1 is base pose, frame 3 is max breath-in, frame 6 returns to base but NOT identical to frame 1.
- Same hound in all 6 frames. Same brass gears, same rust fur pattern, same glowing eyes.
- All 6 frames share the SAME foot baseline Y coordinate.
- Transparent background ONLY. NO numbered labels, NO text, NO watermarks, NO environment.
- Keep the hound simple — no more than 5 distinct parts visible.

[MONSTER ALIGNMENT RULES — VIOLATE OR RE-DRAW]
- Every frame lives in its own 512x512 grid cell.
- IN EVERY SINGLE FRAME, the hound's ground-contact point (feet / leg bottoms / whatever part touches the floor) MUST land on EXACTLY pixel coordinate (256, 412) inside its cell.
  (Grid top = 0, bottom = 512. 412 means 100px from grid bottom.)
- Feet can lift during walk/attack — but the "landing point" (where feet would normally touch ground) must stay at (256, 412).
- After you finish, if you cut out each 512x512 frame and stacked all 6 cutouts on top of each other with no offset,
  all 6 hounds should appear to stand on the SAME horizontal floor — no frame floats, no frame sinks.
```

### 3.7 怪物 Prompt 模板（monster_walk_S.png，参考 idle 第一帧）

```
[CharacterLock —— 复用 monster_idle_S 的 CharacterLock 段，一字不改]
[ViewLock —— 同上]
[Layout —— 1 row × 8 columns of 512x512 cells]
[CRITICAL —— 同上 + 以下新增]
- THIS GENERATION USES monster_idle_S.png frame 1 as visual reference.
- 8 frames walk animation, loopable. Front-left leg forward on frame 2, front-right leg forward on frame 6.

[MONSTER ALIGNMENT RULES — SAME AS monster_idle_S]
- Ground-contact point in every frame lands at (256, 412) in its cell.
- Feet lift naturally during gait, but the reference ground point does not move up/down.
- No frame floats, no frame sinks when all 8 frames are stacked at no offset.
```

---

## 4. 脚本管线（`tools/build_sprites.py`）

三种产出共用一套脚本，统一入口：

```bash
# 角色身体（4 方向大图 → 裁剪出 48 张小图）
python tools/build_sprites.py --mode character_body --in sprite_ani/bodies/ --out sprite_ani/bodies_cut/ --grid 512

# 角色头（4 方向大图 → 裁剪出 4 张 head 小图）
python tools/build_sprites.py --mode character_head --in sprite_ani/heads/{char_id}/ --out sprite_ani/heads/{char_id}/cut/ --grid 512

# 装备（hat/cape/clothes/shoes/backpack = 4 方向大图；weapon/gloves = 1 张图）
python tools/build_sprites.py --mode equipment --in sprite_ani/equipment/{eq_type}/ --out sprite_ani/equipment_cut/{eq_type}/ --grid 512

# 怪物（一方向内 5 张大图 → 裁剪出全部帧）
python tools/build_sprites.py --mode monster --in sprite_ani/monsters/{mon_id}/ --out sprite_ani/monsters/{mon_id}/cut/ --grid 512
```

脚本功能：
1. 识别 `--mode`，读入 manifest 里的 `gridSize` 和布局参数
2. 按网格裁出所有部件 / 帧，自动保存到规范目录
3. 自动计算 `footBaselineY`（对 4 方向角色身体，找 calf_L / calf_R 的脚底 Y 作为该方向统一 baseline）
4. 自动生成/更新 `manifest.json`（部件坐标、挂点、Z 层、帧列表）

---

## 5. 目录结构（强制）

```
sprite_ani/
├── manifest.json                     ← 项目总清单（所有角色、装备、怪物索引）
├── shared_bodies/                    ← 所有角色共享的身体部件（4 方向 × 12 块）
│   ├── S_big.png                     ← S 方向大图（角色身体）
│   ├── E_big.png                     ← E 方向大图
│   ├── N_big.png
│   ├── W_big.png
│   └── cut/                          ← 脚本裁剪后的小图
│       ├── S/  head.png neck.png torso_U.png torso_L.png ... (12 张)
│       ├── E/  ...
│       ├── N/  ...
│       └── W/  ...
│
├── heads/                            ← 每个角色只需要生成 4 方向的头
│   ├── engineer_spanner/
│   │   ├── S_big.png E_big.png N_big.png W_big.png
│   │   └── cut/  S.png E.png N.png W.png   (每方向 1 张)
│   └── rust_hound_master/
│       └── ...
│
├── equipment/                        ← 装备（全角色共用）
│   ├── hat/engineer_helmet/
│   │   ├── S_big.png E_big.png N_big.png W_big.png
│   │   └── cut/ S.png E.png N.png W.png
│   ├── cape/red_cape/
│   ├── clothes/leather_coat/
│   ├── shoes/steel_boots/
│   ├── backpack/brass_gears/
│   ├── gloves/work_gloves/           ← 共用 1 张图
│   │   ├── big.png                   ← 一张图即成品，无方向
│   │   └── cut/ single.png
│   └── wrench/                       ← 共用 1 张图
│       ├── big.png
│       └── cut/ single.png
│
└── monsters/                         ← 怪物（帧动画）
    └── rust_hound/
        ├── S/                        ← S 方向 5 张大图
        │   ├── idle.png walk.png attack.png hit.png death.png
        │   └── cut/  idle/ 6帧 walk/ 8帧 attack/ 5帧 hit/ 3帧 death/ 6帧
        ├── E/ ...
        ├── N/ ...
        └── W/ ...
```

---

## 6. manifest.json（项目总清单最小模板）

```jsonc
{
  "project": "dont_starve_steampunk",
  "gridSize": 512,                     // 全项目统一网格
  "directions": ["S", "E", "N", "W"],  // 4 方向顺序
  "sharedBodies": {
    "path": "shared_bodies/cut",
    "footBaselineByDirection": { "S": 2860, "E": 2858, "N": 2862, "W": 2860 },
    "zOrderByDirection": { ... }       // 见第 1.6 节
  },
  "characters": [
    {
      "id": "engineer_spanner",
      "headPath": "heads/engineer_spanner/cut",
      "bodyRef": "sharedBodies",
      "equipment": { "hat": null, "gloves": "work_gloves", "weapon": "wrench", "backpack": "brass_gears" }
    }
  ],
  "equipment": [
    {
      "id": "wrench",
      "slot": "weapon",
      "sharedImage": true,             // 只有一张图，无方向
      "path": "equipment/wrench/cut/single.png"
    },
    {
      "id": "engineer_helmet",
      "slot": "hat",
      "sharedImage": false,
      "pathByDirection": { "S": ".../S.png", "E": ".../E.png", "N": ".../N.png", "W": ".../W.png" }
    }
  ],
  "monsters": [
    {
      "id": "rust_hound",
      "path": "monsters/rust_hound/cut",
      "footBaselineByDirection": { "S": 410, "E": 412, "N": 410, "W": 410 },
      "actions": {
        "idle":   { "frames": 6, "fps": 8, "loop": true  },
        "walk":   { "frames": 8, "fps": 14, "loop": true  },
        "attack": { "frames": 5, "fps": 16, "loop": false },
        "hit":    { "frames": 3, "fps": 20, "loop": false },
        "death":  { "frames": 6, "fps": 10, "loop": false }
      }
    }
  ]
}
```

---

## 7. 质量门禁（QA Gate）

| # | 类型 | 检查项 | 通过标准 |
|---|------|--------|---------|
| Q1 | 对齐 | 同一方向大图所有部件脚 baseline Y 差 ≤ 2px | 裁剪后所有部件叠到一起脚不飘 |
| Q2 | 对齐 | 怪物同一方向 5 张大图脚 baseline 一致 | 攻击时怪不往上跳 |
| Q3 | 对齐 | 装备 4 方向挂载点与角色身体挂点差 ≤ 2px | 帽子不飘、武器不入手 |
| Q4 | 模型 | 前一方向 → 后一方向的参考链完整 | E 一定参考 S、N 一定参考 E |
| Q5 | 模型 | 怪物零部件 ≤ 5 个 | 复杂度清单通过 |
| Q6 | 模型 | 角色脖子/四肢是 Don't Starve 线状物（细杆+关节球） | 无厚肉块 |
| Q7 | 模型 | 躯干 4 方向都合理（等距投影，不是正面/侧面轮廓） | 从 E/W 方向看 torso_U 不至于完全变形 |
| Q8 | 网格 | 所有大图 `width % gridSize === 0 && height % gridSize === 0` | 脚被裁一半 |
| Q9 | 网格 | 所有部件/帧图尺寸精确 = gridSize | 脚本裁剪无偏差 |
| Q10 | 透明 | 裁剪后透明区无黑边、无纯白棋盘格残留 | 无白边 |
| Q11 | 跨方向 | 跨方向怪物 idle 第 1 帧 SSIM ≥ 0.80 | S 和 E 的猎犬长得不像同一只 |
| Q12 | 文字 | 图内无编号、无文字、无 watermark | OCR 检出 → 重绘 |
| Q13 | 对称 | 角色身体左/上臂（及大腿/小腿）不对称元素（武器手侧）方向变化合理 | 持武器手在 S/SE/E 都在画面同一侧 |
| Q14 | 装备 | 衣服装备的裁剪能**替换** torso_U + torso_L 区域 | 不遮挡 head/neck/limbs |
| Q15 | 怪物 | 怪物一方向内 5 张大图完整产出，无缺失动作 | — |
| Q16 | 怪物 | 怪物 attack 帧包含命中帧（通常第 3 帧） | 无攻击前摇后没出招 |

---

## 8. 反模式（打回规则）

| # | 反模式 | 处置 |
|---|--------|------|
| R1 | 方向顺序打乱（先 E 再 S） | 按 S→E→N→W 重走参考链 |
| R2 | 生成后一方向时未传前一方向参考图 | 退回，补上参考 |
| R3 | 怪物在同一方向里跳过某动作生成下一个方向 | 退回，补齐动作 |
| R4 | 怪物零部件 > 5 个 | 简化，重画 |
| R5 | 脖子/四肢是厚肉块 | 退回，改成细杆 + 关节球 |
| R6 | 部件在网格里偏置（没居中） | 模型重画 |
| R7 | 大图网格非正方形或网格尺寸不一致 | 重画 |
| R8 | 脚 baseline 跨部件不一致 | 重画该方向大图 |
| R9 | 模型加了编号/文字/水印 | 重画，Prompt 里加强禁止词 |
| R10 | 躯干 4 方向看某一方向完全变形 | 重画，加强 isometric projection 描述 |
| R11 | 武器/手套也生成了 4 方向 | 退回，武器手套只用 1 张共用图 |
| R12 | 新角色生成了身体部件 | 退回，新角色只需要 head 4 方向 |

---

## 9. 与引擎侧的接口约定（写进代码常量）

```typescript
// 角色身体 slot 名
export const BODY_SLOTS = [
  'head', 'neck',
  'torso_U', 'torso_L',
  'upper_arm_L', 'upper_arm_R',
  'forearm_L', 'forearm_R',
  'thigh_L', 'thigh_R',
  'calf_L', 'calf_R',
] as const;

// 方向顺序（生成与逻辑共用）
export const DIRECTION_ORDER = ['S', 'E', 'N', 'W'] as const;

// 装备 slot 名
export const EQUIPMENT_SLOTS = ['hat', 'cape', 'clothes', 'shoes', 'backpack', 'gloves', 'weapon'] as const;
export const EQUIPMENT_SHARED = new Set(['gloves', 'weapon']); // 无方向共用图

// 怪物动作顺序
export const MONSTER_ACTION_ORDER = ['idle', 'walk', 'attack', 'hit', 'death'] as const;
```

角色/装备/怪物 三种渲染组件在引擎里的结构（伪代码）：
```ts
type Character = {
  head: { dir: DirKey, texture: THREE.Texture }        // 角色独有
  body: Record<DirKey, Record<BodySlot, THREE.Texture>> // 来自 shared_bodies
  equipment: Partial<Record<EquipmentSlot, { dir?: DirKey, texture: THREE.Texture }>>
  zOrder: Record<DirKey, BodySlot[]>
  footBaselineY: Record<DirKey, number>
}

type Monster = {
  id: string
  dirFrames: Record<DirKey, Record<ActionKey, THREE.Texture[]>> // 4 方向 × 5 动作 × N 帧
  actionLoop: Partial<Record<ActionKey, boolean>>
  footBaselineY: Record<DirKey, number>
}
```
