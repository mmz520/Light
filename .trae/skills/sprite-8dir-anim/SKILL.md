---
name: "sprite-8dir-anim"
description: "Unified generation spec for matchstick-assembled characters, shared equipment, and frame-animated monsters (Don't Starve dark-gothic steampunk style). Invoke when creating character body parts, shared heads/equipment, or monster sprite sheets for the game."
---

# 《饥荒》式角色 · 装备 · 怪物 统一生成 Skill

> 本 Skill 是本项目 **所有角色资源的唯一标准**。覆盖三种产出：
> 1. **角色素体**（4 根火柴棒：arm / torso_U / torso_L / leg，全项目共享，新角色只换头）
> 2. **装备**（全角色共用，手套/武器共用 1 张图，背包/帽子/鞋子 4 方向）
> 3. **怪物（enemy）**（完整帧动画大图，一动作一张，不拆部件）
>
> 生成方式：**素体 = 一张图一根火柴棒；头 / 装备 / 敌人 = 大图 + 网格排布 + 脚本裁剪**。切分、缩放、对齐全部由脚本负责，大模型只管画。

---

## 0. 统一生成范式

### 0.1 两种出图方式

| 产出 | 方式 | 说明 |
|------|------|------|
| 素体部件（arm / torso_U / torso_L / leg） | **一图一部件** | 每张图只画一根火柴棒，居中，无网格线 |
| 头 / 4 方向装备 | **2×2 网格大图** | 格序 S(左上) E(右上) N(左下) W(右下) |
| 敌人 | **1×N 横向帧条带** | 一个动作一张，帧按列排布 |

大图上画极细浅灰网格线帮助模型定位，脚本按格切分；单图则整图去底裁剪。

### 0.2 对齐规则（由脚本负责，模型不用管像素）

- 画布 512×512；脚底线 `FOOT_Y = 412`、怪物地面线 `GROUND_Y = 376` 为全项目硬编码常量。
- 大模型只需保证：**部件/帧完整、居中、不触边、无地面无阴影无文字**。
- 脚本负责：去底 → 裁包围盒 → 统一缩放 → 按解剖堆叠位置摆进画布（arm/leg 由引擎镜像复用左右侧）。
- 装备摆放：hat=头顶、back=躯干后、hand=腕部、foot=脚底、weapon=手侧，由脚本按角色几何推算。

### 0.3 网格大图的 Prompt 固定段

```
[LAYOUT RULES]
- Equal-sized cells separated by thin light-gray lines on a pure white background.
- Same subject, same scale, same floor line in every cell (for animation sheets).
- NO text, NO numbers, NO shadows, NO ground drawing.
```

### 0.4 方向与参考链

- 头：一张 2×2 大图同时出 S/E/N/W（同图内天然一致）。
- 4 方向装备：一张 2×2 大图同时出 S/E/N/W。
- 敌人：先出 idle（无参考），再以 idle 为参考依次出 walk → attack → hit → death。
- 旧的 S→E→N→W 跨图参考链不再使用（方向已在同一张图内）。

### 0.5 大图规格（全项目统一）

| 参数 | 值 | 说明 |
|------|-----|------|
| 网格尺寸 | **512×512**（网格大图按 1024 画布 2×2 等分） | 每格一个部件/一帧 |
| 画布 | 网格大图 1024×1024；敌人条带 1536×1024 | — |
| 背景 | **纯白 + 极细浅灰色网格线**（仅用于定位，脚本裁掉） | — |

---

## 1. 角色身体部件（分块组装，全项目共享）

### 1.0 风格锁（最高优先级，违反则全部重画）

**角色素体 = 4 根火柴棒**：全部裸体（无衣物、无手、无脚、无装备），左右侧由引擎镜像复用，因此**每种火柴棒只出一张图**。整体色调**偏黑**，画风是《饥荒》原作那种**暗黑哥特 + 蒸汽朋克手绘感**。

```
[STYLE LOCK — Don't Starve dark-gothic steampunk, NOT realistic, NOT cute]
- Matchstick body parts: a simple straight stick, slightly tapered, with small rounded bulbous ends.
  NO ball-and-socket joints, NO hands, NO fingers, NO feet, NO toes, NO clothing, NO belt, NO weapon.
- Dark gothic hand-drawn look: thick scratchy black ink outlines, subtle cross-hatch shading strokes.
- Flat, muted, DESATURATED and DARK palette: charcoal black, dark brown, dark navy, aged brass.
  The parts must read DARK overall — not pale, not bright, not clean-vector cute.
- NO gradients, NO 3D render, NO painterly rendering, NO texture noise, NO realistic anatomy.
- Single part floating alone, centered, pure white background, NO text, NO shadows, NO ground.
```

对照检查：偏白偏亮、有关节球、有手脚、带衣物、写实厚涂、3D 渲染感 → 一律判废重画（见 §8）。

### 1.1 公共部件清单（强制 4 张图，全部火柴棒状）

| 文件（`role/common/`） | 名称 | 引擎复用 | 画法 |
|------------------------|------|----------|------|
| `arm.png`     | 手臂火柴棒 | upper_arm_L/R、forearm_L/R（镜像 + 缩放） | 一根直棒，两端小圆头，粗细均匀 |
| `torso_U.png` | 上身火柴棒 | 胸 / 上躯干 | 比手臂粗的短棒 |
| `torso_L.png` | 下身火柴棒 | 腹 / 髋 | 同上 |
| `leg.png`     | 腿火柴棒   | thigh_L/R、calf_L/R（镜像 + 缩放） | 一根直棒，两端小圆头 |

- 头不在此列：每个角色单独生成（§1.5）；脖子由头与上身自然衔接，不单独出图。
- 手 = `equipment/hand`，脚 = `equipment/foot`，衣物 = 覆盖 torso 的装备。**素体上绝不允许出现这些东西**。
- 敌人（enemy）**不适用**火柴棒拆件：敌人是完整的帧动画大图（§3）。

### 1.2 出图规格

- 素体：单图 1024×1024，部件竖直、居中、占画面高度约 60–70%，四周留白。
- 头 / 4 方向装备：2×2 网格大图 1024×1024，格序 S(左上) E(右上) N(左下) W(右下)。
- 敌人：1×N 横向帧条带 1536×1024，帧数 = 该动作的帧数。

### 1.3 部件在图内的位置

单图部件必须**居中、完整、不触边、无地面阴影**。脚本会去底、裁空白并统一缩放，模型**不需要**关心锚点像素坐标。

### 1.4 素体生成流程

1. 按 §1.0 STYLE LOCK 生成 4 张火柴棒单图（可并行；风格一致性靠 STYLE LOCK，必要时互为参考图）。
2. 脚本 `tools/build_sprites.py` 去底、裁剪、缩放，落到 `public/assets/sprites/role/common/`（4 个 PNG，无方向子目录）。
3. 全项目只有这一套素体；新增角色**不需要**重新生成素体。

### 1.5 新角色生成流程（极简）

新角色 = **只生成一张 2×2 头部大图**（S/E/N/W 四格，风格参考素体与既有角色）。脚本裁出 4 张头小图落到 `public/assets/sprites/role/{char_id}/`，素体从 `role/common/` 复用。

### 1.6 角色 Z 层（S 方向示例，其他方向由引擎镜像/调整）

`back → leg(大腿×2) → leg(小腿×2) → torso_L → torso_U → arm(上臂×2) → arm(前臂×2) → foot(×2) → hand(×2) → head → hat → weapon`

> 同一张 `arm.png` 既当上臂也当前臂（前臂可由引擎缩放约 0.85），`leg.png` 既当大腿也当小腿。Z 顺序存到 manifest 的 `zOrderS`，引擎按方向查。

### 1.7 素体单图 Prompt 模板（以 arm 为例）

```
[STYLE LOCK —— §1.0 那段原文照抄，一字不改]

[SUBJECT]
One single matchstick-shaped ARM segment: a simple straight vertical stick, slightly tapered,
small rounded bulbous ends, uniform thickness. Dark charcoal-brown flat fill, thick scratchy
black ink outline, subtle cross-hatch shading. Don't Starve dark-gothic steampunk style.
NO ball joints, NO hands, NO clothing. Centered, about 65% of the canvas height,
nothing touching the canvas edges, NO text, NO shadow, NO ground.
```

`torso_U` / `torso_L` / `leg` 用同一模板，只替换 SUBJECT 行（更粗的短棒 / 一根直棒）。

---

## 2. 装备（全角色共用）

### 2.1 装备清单（强制 5 类，一个物品一个文件夹）

最终产物目录为 `public/assets/sprites/equipment/`，其下**只有 5 个类别文件夹**：`back`（背包）、`hat`（帽子）、`hand`（手套）、`foot`（鞋子）、`weapon`（武器）。每个类别下一个物品一个文件夹。清单固定：

| 类别文件夹 | slot | 名称 | 生成方式 | 件数 / 左右 | 原因 |
|-----------|------|------|---------|-----------|------|
| `equipment/back/` | `back`   | 背包 | 4 方向 2×2 大图（**S 只出背带 / E·N·W 只出包体，见 2.1.2**） | 单个 | 背部可见性随方向变化 |
| `equipment/hat/`  | `hat`    | 帽子 | 4 方向 2×2 大图 | 单个 | 帽子方向变化明显 |
| `equipment/hand/` | `hand`   | 手套 | **1 张共用图（single.png）** | **单只 · 握拳 · 不分左右** | 左右镜像复用，见 2.1.1 |
| `equipment/foot/` | `foot`   | 鞋子 | 4 方向 2×2 大图（**每格只画 1 只**） | **单只 · 不分左右** | 鞋头朝向随方向变，左右镜像复用 |
| `equipment/weapon/` | `weapon` | 武器 | **1 张共用图** | 单件 | Shank 式武器挂手，4 方向共用 |

> 注意：不再生成 cape / clothes 等其他装备类别；如需新增类别，必须先扩充本表和目录结构。

### 2.1.1 铁律：鞋子与手套「单只 + 不分左右 + 风格化」

**L1 —— 永远只画单只，绝不出「一双 / 一对」。**
Prompt 里必须写 `ONE single item only — NOT a pair, NOT two items side by side`。模型非常爱画一双并排的靴子，这是最高频废图原因（见 §8 R16）。

**L2 —— 不分左右，左右肢体共用同一张图 + 水平镜像。**
引擎渲染时左/右肢体都读同一张 PNG，其中一侧做 `scaleX = -1`。因此**图里不能有任何能被镜像识破的左右特征**：鞋子不能有左右不同的鞋型/磨损位置，手套不能有偏侧的拇指排布。

**L3 —— 手套永远是握拳状。**
五指收拢成一个拳头的整块剪影，OK；张开的掌、五指分开的手，NO —— 镜像后张开的手会变成「反手」，穿帮明显。Prompt 固定写 `a CLENCHED FIST, all fingers curled into the palm, no separated fingers`。

**L4 —— 因为不分左右，造型必须风格化，不能写实。**
去掉一切「真东西才有的细节」：鞋带孔、缝线、皮革纹理、鞋底花纹、指甲、指节分缝、金属拉丝。只保留 **大色块 + 厚黑描边 + 少量排线**。简到「镜像后完全看不出左右」才算合格。写实细节越多，镜像复用穿帮越严重。

### 2.1.2 背包的背带规则（按方向区分，不是每个方向都画完整背包）

背包在角色**背后**，不同方向可见的东西完全不同：

| 方向 | 观众看到 | 该方向该画什么 |
|------|---------|--------------|
| **S**（角色面朝镜头） | 包体被整个身体挡住，只有两条肩带从肩头绕到身前 | **只画两条背带**，不画包体 |
| **E / W**（侧面） | 包体侧影，背带夹在包与背之间看不见 | **只画包体**，不画背带 |
| **N**（角色背对镜头） | 包体完整朝向观众，背带被包压在下面 | **只画包体**，不画背带 |

Prompt 里固定写：
- S 格：`Backpack STRAPS ONLY (two leather shoulder straps) — the pack body is hidden behind the character's body, DO NOT draw the pack body, DO NOT draw any buckle plate.`
- E / N / W 格：`Backpack BODY ONLY — NO shoulder straps, NO loose strap ends.`

### 2.2 装备大图布局

**需要 4 方向的装备**（back/hat/foot）：一张 **2×2 网格大图**（1024×1024），格序固定 **S = 左上、E = 右上、N = 左下、W = 右下**，格间由细浅灰线分隔。

**共用 1 张图的装备**（hand/weapon）：一张图 1 格，无方向。

装备 Prompt 模板结构：风格参考（可选，取已有装备/素体）→ 装备描述 → 2×2 布局 + 格序 → 件数与左右约束（§2.1.1 L1/L2）→ 细节禁令。

### 2.3 装备挂载点

**挂载逻辑**：装备的锚点必须与它挂载/替换的角色身体部件的锚点**像素坐标完全一致**（都在各自 512×512 网格内），这样装备叠上去也是 0 位移。

| 装备 slot | 挂载/替换的身体部件 | 装备自己的锚点（在装备网格内） |
|----------|-------------------|------------------------------|
| `hat`    | 挂在 head 的 neck 顶 | 锚点在装备网格距顶 100（head 自己锚距顶 100） |
| `back`   | 挂在 torso_U 背部 | 锚点距底 100（同 torso_U）；S 方向的 `back` 只有背带，锚点同躯干肩部 |
| `hand`   | **替换** forearm_L + forearm_R 的手套部分 | 锚点距底 100；**同一张图左右复用，其中一侧水平镜像** |
| `foot`   | **替换** calf_L + calf_R 的靴子部分 | 锚点距底 100，覆盖 calf 的下半部；**同一张图左右复用，其中一侧水平镜像** |
| `weapon` | 挂在 forearm_R 的手掌中心 | 锚点距底 100 |

**镜像复用规则（强制）**：`hand` / `foot` 的图**只有一份**，引擎渲染左右两个肢体时各读一次，其中一侧 `scaleX = -1`。所以同一件装备在左腿/右腿、左手/右手上**外观完全对称**——这就是为什么鞋子和手套必须去掉一切左右差异和写实细节（§2.1.1）。

### 2.4 装备 Prompt 模板示例（hat 4 方向大图）

装备的 Prompt 结构：**风格参考（可选）→ 装备描述 → 2×2 布局与格序 → 件数/左右约束 → 细节禁令**。

```
[StyleRef]
Use the reference image ONLY for art style (Don't Starve dark-gothic steampunk: thick scratchy black ink
outline, flat fills, subtle cross-hatch, muted DARK palette). Do NOT copy its subject.

[SubjectLock —— 装备专属，全文复用]
Engineer leather cap: worn dark-brown leather, brass rivets along the brim, one brass goggle strap,
one tiny copper pressure valve on the side. Gloomy, hand-drawn, STYLIZED.

[Layout — 2×2 grid, thin light-gray separators, pure white background]
  top-left = S (facing viewer) | top-right = E (facing right)
  bottom-left = N (back)       | bottom-right = W (facing left)

[CRITICAL]
- ONLY the cap — NO head underneath. It must look like it floats when cut out alone.
- Each cell faces its own direction. Same scale in all four cells.
- NO text, NO labels, NO shadows, NO ground.

[ALIGNMENT RULES — 与 §0.3 角色身体那段完全相同，原文照抄]
...
```

**鞋子（foot）专用补充**（拼在 [CRITICAL] 里）：

```
- Draw ONE single shoe per cell — NOT a pair, NOT two shoes side by side. Ever.
- Same single shoe shape in all four cells; only the facing changes (S = toe toward viewer,
  E = toe right, N = heel toward viewer, W = toe left).
- No left or right variant, no mirrored-specific wear, no laces holes, no stitching, no sole tread.
  Keep it STYLIZED: 2–3 flat color blocks + thick black outline + a few hatch strokes only.
```

**手套（hand）专用**（单张 single.png，无方向）：

```
ONE single work glove on a pure white background, a CLENCHED FIST — all fingers curled into the palm,
no separated fingers, no open palm, no thumb sticking out sideways. Worn dark leather, one brass
knuckle plate, wide cuff. STYLIZED only: 3 flat color blocks + thick black outline + light hatching,
NO stitching, NO knuckle seams, NO fingernail, NO skin, NO arm. Not a pair. NO text, NO shadow.
```

**背包（back）专用**（2×2，注意 S 与其余三格内容不同）：

```
- top-left = S: STRAPS ONLY — two leather shoulder straps hanging from the shoulders.
  The pack BODY is hidden behind the character's body: DO NOT draw the pack body, DO NOT draw a buckle plate.
- top-right = E / bottom-left = N / bottom-right = W: PACK BODY ONLY.
  NO shoulder straps at all, NO loose strap ends, NO dangling buckles.
```

---

## 3. 敌人 enemy（帧动画，不分块）

### 3.1 生成范式

敌人（enemy）不使用分块——**直接生成帧动画大图**。一方向内，先走完所有动作（站立 → 行走 → 攻击 → 受击 → 死亡）再进下一个方向。

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

### 3.4 怪物造型要求（极简卡通，禁止写实）

- 零部件**控制在 5 个以内**（头、身体、腿、尾巴/武器、1 个标志性特征）
- 不要画复杂机械结构、多层装甲、可拆卸附件——AI 多次生成时会不一致
- **画风与角色素体一致**：《饥荒》暗黑哥特手绘风——厚黑描边（略抖动）、带排线阴影、平涂、**暗色调**（炭黑/暗棕/暗navy/旧黄铜），无渐变、无纹理噪点、无真实毛丝
- 造型要"憨中带邪"：大圆眼、粗短腿、块面化的身体，不要解剖准确的野兽
- 机械部分只保留 **1–2 个简单形状**（一个圆齿轮 + 一根细管），不要画铆钉阵列、管线网
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
Rust Hound (锈蚀猎犬): chunky cartoon four-legged dog, big round glowing yellow eye, dark rust-brown flat fur (single flat tone, NO fur strands), one simple brass gear on the shoulder, one thin copper pipe on the back, stubby legs, curled wire tail. Only 5 parts. Dark gothic Don't Starve style: thick scratchy black ink outline, muted dark palette (dark rust, charcoal, aged brass), subtle cross-hatch shading. NO bright colors, NO realism, NO rivet arrays.

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

三种产出共用一套脚本，统一入口。**大图等中间产物留在 `sprite_ani/` 工作目录，最终裁剪/合成结果必须落到 `public/assets/sprites/`**：

```bash
# 角色身体（4 方向大图 → 裁剪出 48 张小图 → 公共部件）
python tools/build_sprites.py --mode character_body --in sprite_ani/bodies/ --out public/assets/sprites/role/common/ --grid 512

# 角色头（4 方向大图 → 裁剪出 4 张 head 小图 → 每个角色自己的文件夹）
python tools/build_sprites.py --mode character_head --in sprite_ani/heads/{char_id}/ --out public/assets/sprites/role/{char_id}/ --grid 512

# 装备（back/hat/foot = 4 方向大图；hand/weapon = 1 张图）
python tools/build_sprites.py --mode equipment --in sprite_ani/equipment/{slot}/{item_id}/ --out public/assets/sprites/equipment/{slot}/{item_id}/ --grid 512

# 敌人（一方向内 5 张大图 → 每动作每方向合成一条横向帧条带）
python tools/build_sprites.py --mode monster --in sprite_ani/monsters/{mon_id}/ --out public/assets/sprites/enemy/{mon_id}/ --grid 512
```

脚本功能：
1. 识别 `--mode`，读入 manifest 里的 `gridSize` 和布局参数
2. 按网格裁出所有部件 / 帧，自动保存到 `public/assets/sprites/` 下的规范目录
3. 自动计算 `footBaselineY`（对 4 方向角色身体，找 calf_L / calf_R 的脚底 Y 作为该方向统一 baseline）
4. 自动生成/更新 `public/assets/sprites/manifest.json`（部件坐标、挂点、Z 层、帧列表）

---

## 5. 目录结构（强制）

### 5.1 工作目录（大图 / 中间产物，`sprite_ani/`）

大模型生成的大图、参考图等中间产物放在项目根的 `sprite_ani/`，**不进入最终产物**：

```
sprite_ani/
├── bodies/                             ← 角色身体 4 方向大图
│   ├── S_big.png  E_big.png  N_big.png  W_big.png
├── heads/{char_id}/                    ← 每个角色的头 4 方向大图
├── equipment/{slot}/{item_id}/         ← 装备大图（slot ∈ back/hat/hand/foot）
└── monsters/{mon_id}/                  ← 敌人大图
    └── S/  idle.png walk.png attack.png hit.png death.png （E/N/W 同构）
```

### 5.2 最终产物（`public/assets/sprites/`，强制）

**所有最终生成的文件统一放在 `public/assets/sprites/`**，结构如下：

```
public/assets/sprites/
├── manifest.json                       ← 项目总清单（所有角色、装备、敌人索引）
│
├── role/                               ← 角色
│   ├── common/                         ← 公共部件：4 根火柴棒（全角色共享，无方向）
│   │   └── arm.png  torso_U.png  torso_L.png  leg.png
│   ├── engineer_spanner/               ← 每个角色一个文件夹，里面只有头部
│   │   ├── S.png  E.png  N.png  W.png  ← 4 方向 head 小图
│   └── <char_id>/
│       └── S.png  E.png  N.png  W.png
│
├── equipment/                          ← 装备（全角色共用），只有 5 个类别文件夹
│   ├── back/                           ← 背包：一个背包一个文件夹（S=只有背带 / E·N·W=只有包体）
│   │   └── gearpack/
│   │       └── S.png  E.png  N.png  W.png
│   ├── hat/                            ← 帽子：一个帽子一个文件夹
│   │   └── engineer_cap/
│   │       └── S.png  E.png  N.png  W.png
│   ├── hand/                           ← 手套：一个手套一个文件夹（共用 1 张图，握拳、单只、不分左右）
│   │   └── work_gloves/
│   │       └── single.png
│   ├── foot/                           ← 鞋子：一个鞋子一个文件夹（4 方向，每方向 1 只、不分左右）
│   │   └── steel_boots/
│   │       └── S.png  E.png  N.png  W.png
│   └── weapon/                         ← 武器：一把武器一个文件夹（共用 1 张图，无方向）
│       └── wrench/
│           └── single.png
│
└── enemy/                              ← 敌人：一个敌人一个文件夹
    └── rust_hound/
        ├── idle/                       ← 一个动作一个文件夹，内部按现在的来
        │   ├── S.png  SE.png  E.png  NE.png  N.png  NW.png  W.png  SW.png
        │   └── （每个 <DIR>.png 内部是该动作该方向的横向 N 帧条带，单元格 CELL×CELL）
        ├── walk/
        │   └── <DIR>.png ...
        ├── attack/
        ├── hit/
        └── death/
```

要点：
- `role/` 根目录下**只有公共部件（common/，4 根火柴棒）和各角色文件夹**；角色文件夹里**只有头部**，不出现身体部件。
- `equipment/` 下**只有 back / hat / hand / foot / weapon 五个文件夹**，不存在其他类别；每个物品独立成文件夹。
- `enemy/` 每个敌人独立文件夹，内部结构与现有运行时格式一致：`<动作>/<方向>.png` 横向帧条带。

---

## 6. manifest.json（项目总清单最小模板，位于 public/assets/sprites/manifest.json）

路径均相对 `public/assets/sprites/`：

```jsonc
{
  "project": "dont_starve_steampunk",
  "gridSize": 512,                     // 全项目统一网格
  "directions": ["S", "E", "N", "W"],  // 4 方向顺序
  "sharedBodies": {
    "path": "role/common",             // 4 根火柴棒：arm.png / torso_U.png / torso_L.png / leg.png（无方向）
    "zOrderS": [ "back", "leg:thigh_L", "leg:thigh_R", "leg:calf_L", "leg:calf_R",
                 "torso_L", "torso_U", "arm:upper_arm_L", "arm:upper_arm_R",
                 "arm:forearm_L", "arm:forearm_R", "foot", "hand", "head", "hat", "weapon" ]
  },
  "characters": [
    {
      "id": "engineer_spanner",
      "headPath": "role/engineer_spanner",   // 角色文件夹里只有头部
      "bodyRef": "sharedBodies",
      "equipment": { "hat": "engineer_helmet", "hand": "work_gloves", "back": "brass_gears", "foot": "steel_boots", "weapon": "wrench" }
    }
  ],
  "equipment": [
    {
      "id": "wrench",
      "slot": "weapon",
      "sharedImage": true,             // 只有一张图，无方向
      "path": "equipment/weapon/wrench/single.png"
    },
    {
      "id": "work_gloves",
      "slot": "hand",
      "sharedImage": true,             // 只有一张图，无方向
      "mirrored": true,                // 左右复用同一张图，一侧 scaleX = -1
      "pose": "fist",                  // 永远握拳
      "path": "equipment/hand/work_gloves/single.png"
    },
    {
      "id": "steel_boots",
      "slot": "foot",
      "sharedImage": false,
      "mirrored": true,                // 每方向 1 只，左右复用 + 镜像
      "pathByDirection": { "S": "equipment/foot/steel_boots/S.png", "E": ".../E.png", "N": ".../N.png", "W": ".../W.png" }
    },
    {
      "id": "gearpack",
      "slot": "back",
      "sharedImage": false,
      "strapOnlyDirs": ["S"],          // S 方向只画背带（包体被身体遮住），其余方向只有包体
      "pathByDirection": { "S": "equipment/back/gearpack/S.png", "E": ".../E.png", "N": ".../N.png", "W": ".../W.png" }
    },
    {
      "id": "engineer_helmet",
      "slot": "hat",
      "sharedImage": false,
      "pathByDirection": { "S": "equipment/hat/engineer_helmet/S.png", "E": ".../E.png", "N": ".../N.png", "W": ".../W.png" }
    }
  ],
  "enemies": [
    {
      "id": "rust_hound",
      "path": "enemy/rust_hound",      // <动作>/<方向>.png 横向帧条带
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
| Q14 | 装备 | hand/foot 装备的裁剪能**替换** forearm / calf 对应区域 | 不遮挡 head/neck/torso |
| Q15 | 怪物 | 怪物一方向内 5 张大图完整产出，无缺失动作 | — |
| Q16 | 怪物 | 怪物 attack 帧包含命中帧（通常第 3 帧） | 无攻击前摇后没出招 |
| Q17 | 装备 | 每个 foot 格内**只有 1 只鞋**，每张 hand 图内**只有 1 只握拳手套** | 单只、无左右差异 |
| Q18 | 装备 | back 的 S 图只有背带（无包体），E/N/W 只有包体（无背带） | 逐图核对，靠文件名不能验证 |

---

## 8. 反模式（打回规则）

| # | 反模式 | 处置 |
|---|--------|------|
| R1 | 方向顺序打乱（先 E 再 S） | 按 S→E→N→W 重走参考链 |
| R2 | 生成后一方向时未传前一方向参考图 | 退回，补上参考 |
| R3 | 怪物在同一方向里跳过某动作生成下一个方向 | 退回，补齐动作 |
| R4 | 怪物零部件 > 5 个 | 简化，重画 |
| R5 | 四肢不是火柴棒（画成有体积的圆柱、带关节球、带手/脚） | 退回，改成一根直棒 + 圆头 |
| R6 | 部件在网格里偏置（没居中） | 模型重画 |
| R7 | 大图网格非正方形或网格尺寸不一致 | 重画 |
| R8 | 脚 baseline 跨部件不一致 | 重画该方向大图 |
| R9 | 模型加了编号/文字/水印 | 重画，Prompt 里加强禁止词 |
| R10 | 躯干 4 方向看某一方向完全变形 | 重画，加强 isometric projection 描述 |
| R11 | 手套/武器（hand/weapon）也生成了 4 方向，或装备生成了 back/hat/hand/foot/weapon 以外的类别 | 退回，hand/weapon 只用 1 张共用图，装备只允许 5 类 |
| R12 | 新角色生成了身体部件 | 退回，新角色只需要 head 4 方向 |
| R13 | 素体上画了衣物/手套/靴子/腰带/武器/手/脚/关节球，或火柴棒多于 4 张 | 退回重画，素体只有 arm/torso_U/torso_L/leg 四根棒 |
| R14 | 画风写实或过亮（厚涂、渐变、3D 渲染感、明亮配色、干净矢量感） | 退回重画，按 §1.0 STYLE LOCK 暗黑哥特蒸汽朋克 |
| R15 | 敌人画得过细（多层装甲、复杂机械结构、真实毛皮） | 简化到 ≤5 个部件、3 色以内、平涂 |
| R16 | **鞋子画成一双/一对并排**，或区分了左右脚 | 退回重画，永远**单只**，左右侧由引擎镜像复用 |
| R17 | **手套张掌 / 五指分开 / 带拇指偏侧**，或画成一对 | 退回重画，永远**握拳**、单只、左右通用 |
| R18 | 鞋子/手套带写实细节（鞋带孔、缝线、鞋底花纹、皮革纹理、指节分缝、指甲） | 退回，去掉细节，只保留大色块 + 厚描边 + 少量排线 |
| R19 | 背包 E/N/W 方向画了背带，或 S 方向画了完整背包 | 退回：S 只出背带，E/N/W 只出包体（§2.1.2） |

---

## 9. 与引擎侧的接口约定（写进代码常量）

```typescript
// 素体公共部件（role/common/ 下，强制只有这 4 张，无方向）
export const SHARED_PARTS = ['arm', 'torso_U', 'torso_L', 'leg'] as const;
// 引擎复用：arm → upper_arm_L/R + forearm_L/R（前臂可缩放 0.85）；leg → thigh_L/R + calf_L/R

// 方向顺序（生成与逻辑共用）
export const DIRECTION_ORDER = ['S', 'E', 'N', 'W'] as const;

// 装备类别文件夹（public/assets/sprites/equipment/ 下，强制只有这 5 个）
export const EQUIPMENT_SLOTS = ['back', 'hat', 'hand', 'foot', 'weapon'] as const;
export const EQUIPMENT_SHARED = new Set(['hand', 'weapon'] as const); // 无方向共用图

// 左右镜像复用：这些 slot 只有一张图，左右肢体各读一次，其中一侧 scaleX = -1
// 因此这两类装备必须"单只 + 不分左右 + 去写实"（§2.1.1）
export const MIRRORED_SLOTS = new Set(['hand', 'foot'] as const);

// 背包背带方向特例：S 方向只有背带，其余方向只有包体（§2.1.2）
export const BACK_STRAP_ONLY_DIRS = new Set(['S'] as const);

// 敌人动作顺序
export const MONSTER_ACTION_ORDER = ['idle', 'walk', 'attack', 'hit', 'death'] as const;
```

角色/装备/怪物 三种渲染组件在引擎里的结构（伪代码）：
```ts
type Character = {
  head: { dir: DirKey, texture: THREE.Texture }        // 角色独有
  body: Record<DirKey, Record<BodySlot, THREE.Texture>> // 来自 role/common（公共部件）
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
