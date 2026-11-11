---
name: "sprite-8dir-anim"
description: "Unified generation spec for matchstick-assembled characters, shared equipment, and paper-doll monsters animated by keyframes (skeleton templates: humanoid10 / humanoid5 / beast5 / custom). Invoke when creating character body parts, shared heads/equipment, or monster part sheets for the game."
---

# 《饥荒》式角色 · 装备 · 怪物 统一生成 Skill

> 本 Skill 是本项目 **所有角色资源的唯一标准**。覆盖三种产出：
> 1. **角色素体**（4 根火柴棒：arm / torso_U / torso_L / leg，全项目共享，新角色只换头）
> 2. **装备**（全角色共用，手套/武器共用 1 张图，背包/帽子/鞋子 4 方向）
> 3. **怪物（enemy）**（**纸娃娃拆件 + 关键帧动画**，按骨架模板拆成部件出图，动画在编辑器里 K 帧）
>
> 生成方式：**一张图只画一个部件（或一个部件的 4 方向 2×2）**。切分、缩放、对齐全部由脚本负责，大模型只管画。
> 角色与怪物共用同一套「部件图 → 骨架 → 关键帧 → 导出 JSON」的管线，只有骨架模板（§3.2）不同。

---

## 0. 统一生成范式

### 0.1 两种出图方式

| 产出 | 方式 | 说明 |
|------|------|------|
| 素体部件（arm / torso_U / torso_L / leg） | **一图一部件** | 每张图只画一根火柴棒，居中，无网格线 |
| 头 / 4 方向装备 | **2×2 网格大图** | 格序 S(左上) E(右上) N(左下) W(右下) |
| 怪物部件 | **2×2 网格大图（每部件一张）** | 一个部件一张大图，格序同上；怪物按模板拆件，见 §3 |

大图上画极细浅灰网格线帮助模型定位，脚本按格切分；单图则整图去底裁剪。

### 0.2 对齐规则（由脚本负责，模型不用管像素）

- 画布 512×512；脚底线 `FOOT_Y = 412`、怪物地面线同为 `FOOT_Y = 412`（全项目统一，不再有 376 的怪物专用线）。
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
- 怪物：按模板（§3.2）**逐部件**出 2×2 方向大图；先 body（无参考），再 head / 四肢 / 尾（参考同怪物 body 的 S 格，保证配色与比例一致）。
- 怪物动作不再生成帧图：**动画在编辑器里用关键帧完成**（§3.6），部件图只承载"静态造型"。
- 旧的 S→E→N→W 跨图参考链不再使用（方向已在同一张图内）。

### 0.5 大图规格（全项目统一）

| 参数 | 值 | 说明 |
|------|-----|------|
| 网格尺寸 | **512×512**（网格大图按 1024 画布 2×2 等分） | 每格一个部件 |
| 画布 | 全部 2×2 大图统一 **1024×1024**（角色头/装备/怪物部件一致） | 不再有帧条带 |
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
- 敌人（enemy）**不复用**这套火柴棒素体——每个怪物按自己的骨架模板（§3.2）拆件出图，但同样遵守「一图一部件 / 512 网格 / 锚点对齐」的规矩。

### 1.2 出图规格

- 素体：单图 1024×1024，部件竖直、居中、占画面高度约 60–70%，四周留白。
- 头 / 4 方向装备 / 怪物部件：2×2 网格大图 1024×1024，格序 S(左上) E(右上) N(左下) W(右下)。

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

## 3. 怪物 enemy（纸娃娃拆件 + 关键帧动画）

### 3.0 范式：怪物 = 角色同款管线

怪物**不再生成帧动画条带**，改为和角色完全一样的管线：

```
部件 2×2 方向大图  →  脚本裁件  →  骨架（按模板，§3.2）  →  编辑器 K 关键帧  →  导出 project JSON
```

| 对比项 | 旧范式（已废弃） | 新范式 |
|--------|-----------------|--------|
| 出图 | 一个动作一张 1×N 帧条带 | 一个部件一张 2×2 方向大图 |
| 动画 | 帧图逐帧播放 | 关键帧驱动骨架（与角色同一套数据结构） |
| 改动成本 | 改动作要重画整条 | 只调关键帧，不重画 |
| 方向一致性 | 跨方向靠参考链 | 同一张 2×2 内天然一致 |
| 运行时 | `dirFrames[dir][action][]` 帧数组 | `parts + clips`，与角色共用播放器 |

**收益**：一个怪物的 3~6 张部件图 → 复用出全部 4 方向 × 5 动作；新增动作零成本。

### 3.1 关节、附加件与 pivot

- **关节（joint）**：参与关键帧动画的躯干/肢体节点，数量由模板决定（10 / 5 / 5 / 自定义）。
- **附加件（attachment）**：头、尾、帽子、武器等挂在关节上的部件，**不计入关节数**，但同样要单独出图。
- 每个部件必须声明旋转轴（pivot），否则旋转会「甩飞」：

| 部件类型 | pivot | 该部件在自己 512 网格内的锚点 |
|----------|-------|------------------------------|
| 肢体段（上臂/前臂/大腿/小腿/兽腿） | **顶端中心**（肩 / 肘 / 髋 / 膝） | (256, 100)，即距顶 100 |
| 躯干 / 身体（人形） | **底端中心**（腰 / 髋） | (256, 412)，即距底 100 |
| 头 | **底端中心**（颈） | (256, 412) |
| 兽形身体（水平体块） | **中心** | (256, 256) |
| 尾巴 / 武器等水平件 | **根部**（与父件连接的一端） | 用 `pivot: "left"` / `"right"`，锚点 = 该端中点；布局里的 `cx` 表示**根部 X**（不是中心） |

> 脚本只认「部件在画布内的包围盒 + pivot 类型」，模型不用算像素，只需保证**部件竖直/水平摆正、关节端朝向锚点**。

### 3.2 四种骨架模板

> 机器可读版本：本 Skill 目录下的 **`templates.json`**（关节 / 父子 / 图像槽 / pivot / 布局 / z / 默认 clip 全在里面）。下面各表与它一一对应；编辑器与脚本**都直接读这份文件**，改模板只改这一处。

| 模板 id | 名称 | 关节数 | 关节与父子关系 | 适用 |
|---------|------|--------|----------------|------|
| `humanoid10` | 10 关节人形 | 10 | `torso_L` → `torso_U` → {`upper_arm_L/R` → `forearm_L/R`}；`torso_L` → {`thigh_L/R` → `calf_L/R`} | 与当前角色同款骨架；人形怪、精英怪、BOSS |
| `humanoid5` | 5 关节人形 | 5 | `body` → {`arm_L`, `arm_R`, `leg_L`, `leg_R`} | 小体量人形小怪，一段式四肢 |
| `beast5` | 5 关节兽形 | 5 | `body` → {`leg_FL`, `leg_FR`, `leg_BL`, `leg_BR`} | 四足兽（犬/猪/虫），一段式四腿 |
| `custom` | 自定义 | N | 由 `templates.json` 的 `joints[]` 给出任意父子关系 | 多足、浮空、机械体、触手等特殊怪 |

**镜像复用（强制）**：同一模板里成对的肢体（L/R、FL/FR/BL/BR）**只画一张图**，另一侧水平镜像。因此肢体图必须去掉一切左右特征与写实细节（同 §2.1.1 的 L2 / L4 铁律）。

---

#### 3.2.1 `humanoid10` —— 10 关节人形（当前骨架，其余模板的基准）

**关节（10）**：`torso_L`、`torso_U`、`upper_arm_L/R`、`forearm_L/R`、`thigh_L/R`、`calf_L/R`
**附加件**：`head`(4 方向)、`hat`、`back`、`hand_L/R`、`foot_L/R`、`weapon`

| 节点 | 父 | 图像槽 | pivot | cx | bottom / top | h | z |
|------|----|--------|-------|----|--------------|---|----|
| `thigh_L` | `torso_L` | `leg`（共用，镜像） | top | 232 | bottom 344 | 90 | 1 |
| `thigh_R` | `torso_L` | `leg`（共用，镜像） | top | 280 | bottom 344 | 90 | 2 |
| `calf_L` | `thigh_L` | `leg`（共用，缩放 0.85） | top | 232 | bottom 412 | 76 | 3 |
| `calf_R` | `thigh_R` | `leg`（共用，缩放 0.85） | top | 280 | bottom 412 | 76 | 4 |
| `torso_L` | —（根） | `torso_L` | bottom | 256 | bottom 262 | 60 | 5 |
| `torso_U` | `torso_L` | `torso_U` | bottom | 256 | bottom 212 | 70 | 6 |
| `back` | `torso_U` | 装备 `back` | bottom | 256 | bottom 272 | 100 | 7 |
| `upper_arm_L` | `torso_U` | `arm`（共用） | top | 218 | top 160 | 75 | 8 |
| `upper_arm_R` | `torso_U` | `arm`（共用，镜像） | top | 294 | top 160 | 75 | 9 |
| `forearm_L` | `upper_arm_L` | `arm`（缩放 0.85） | top | 218 | top 225 | 64 | 10 |
| `forearm_R` | `upper_arm_R` | `arm`（缩放 0.85，镜像） | top | 294 | top 225 | 64 | 11 |
| `foot_L` | `calf_L` | 装备 `foot` | bottom | 232 | bottom 412 | 50 | 12 |
| `foot_R` | `calf_R` | 装备 `foot`（镜像） | bottom | 280 | bottom 412 | 50 | 13 |
| `hand_L` | `forearm_L` | 装备 `hand` | bottom | 218 | bottom 293 | 44 | 14 |
| `hand_R` | `forearm_R` | 装备 `hand`（镜像） | bottom | 294 | bottom 293 | 44 | 15 |
| `head` | `torso_U` | `head`（4 方向） | bottom | 256 | bottom 150 | 110 | 16 |
| `hat` | `head` | 装备 `hat` | bottom | 256 | bottom 74 | 50 | 17 |
| `weapon` | `forearm_R` | 装备 `weapon` | bottom | 302 | bottom 291 | 95 | 18 |

---

#### 3.2.2 `humanoid5` —— 5 关节人形（一段式四肢）

**关节（5）**：`body`（根）、`arm_L`、`arm_R`、`leg_L`、`leg_R`
**附加件**：`head`(4 方向)、`hat`、`hand_L/R`、`weapon`

| 节点 | 父 | 图像槽 | pivot | cx | bottom / top | h | z |
|------|----|--------|-------|----|--------------|---|----|
| `leg_L` | `body` | `leg`（共用，镜像） | top | 232 | bottom 412 | 150 | 1 |
| `leg_R` | `body` | `leg`（共用，镜像） | top | 280 | bottom 412 | 150 | 2 |
| `body` | —（根） | `body`（4 方向） | bottom | 256 | bottom 262 | 140 | 3 |
| `arm_L` | `body` | `arm`（共用） | top | 214 | top 140 | 130 | 4 |
| `arm_R` | `body` | `arm`（共用，镜像） | top | 298 | top 140 | 130 | 5 |
| `head` | `body` | `head`（4 方向） | bottom | 256 | bottom 118 | 100 | 6 |
| `hat` | `head` | 装备 `hat` | bottom | 256 | bottom 58 | 50 | 7 |
| `hand_L` | `arm_L` | 装备 `hand` | bottom | 214 | bottom 272 | 44 | 8 |
| `hand_R` | `arm_R` | 装备 `hand`（镜像） | bottom | 298 | bottom 272 | 44 | 9 |
| `weapon` | `arm_R` | 装备 `weapon` | bottom | 306 | bottom 270 | 95 | 10 |

> 一段式四肢：**没有肘/膝**，走路靠整条腿摆 + 身体起伏；不要为了"像人"擅自加关节（见 §8 R21）。

---

#### 3.2.3 `beast5` —— 5 关节兽形（四足）

**关节（5）**：`body`（根）、`leg_FL`、`leg_FR`、`leg_BL`、`leg_BR`
**附加件**：`head`(4 方向)、`tail`（可选）

| 节点 | 父 | 图像槽 | pivot | cx | bottom / top | h | z |
|------|----|--------|-------|----|--------------|---|----|
| `tail` | `body` | `tail`（可选，4 方向） | left（根部） | 330 | bottom 250 | 70 | 0 |
| `leg_BL` | `body` | `leg`（共用，镜像） | top | 224 | bottom 412 | 130 | 1 |
| `leg_BR` | `body` | `leg`（共用，镜像） | top | 288 | bottom 412 | 130 | 2 |
| `body` | —（根） | `body`（4 方向） | center | 256 | bottom 300 | 130 | 3 |
| `leg_FL` | `body` | `leg`（共用） | top | 204 | bottom 412 | 130 | 4 |
| `leg_FR` | `body` | `leg`（共用，镜像） | top | 308 | bottom 412 | 130 | 5 |
| `head` | `body` | `head`（4 方向） | bottom | 256 | bottom 168 | 90 | 6 |

> 前后腿共用一个 `leg` 图：**后腿组 z 在 body 之下（被身体挡住），前腿组 z 在 body 之上**。前腿 cx 略宽（204/308）、后腿略窄（224/288），S 方向才有纵深。

---

#### 3.2.4 `custom` —— 自定义模板

关节数量、父子关系、图像槽、pivot、布局全部由模板 JSON 给出（编辑器与脚本共用同一份），格式见下方；`templates.json` 里的前三个模板就是它的三个实例。

```jsonc
{
  "id": "custom_my_monster",
  "name": "自定义（示例：三节触手怪）",
  "kind": "custom",
  "joints": [
    // id / parent / 图像槽 / pivot / 该方向布局（512 画布，S 方向为准）
    { "id": "body",  "parent": null,   "slot": "body",  "pivot": "bottom",
      "layout": { "cx": 256, "bottom": 300, "h": 120 }, "z": 1 },
    { "id": "tail1", "parent": "body", "slot": "tail",  "pivot": "top",
      "layout": { "cx": 320, "top": 210, "h": 80 },  "z": 0 },
    { "id": "tail2", "parent": "tail1","slot": "tail",  "pivot": "top",
      "layout": { "cx": 372, "top": 268, "h": 70 },  "z": -1 }
  ],
  "attachments": [
    { "id": "head", "parent": "body", "slot": "head", "pivot": "bottom",
      "layout": { "cx": 256, "bottom": 170, "h": 90 }, "z": 2 }
  ]
}
```

- `slot` 相同的关节**共用同一张部件图**（如 `leg` 被 4 条腿共用）；`slot` 命名即 `parts/{slot}/` 目录名。
- `layout` 里的 `bottom`/`top` 二选一，`h` 为目标像素高度，宽度按贴图宽高比自动算。
- 自定义模板允许关节数为 1~任意；但**成对肢体仍必须共用张图 + 镜像**，否则四方向四套图会失控。

---

### 3.3 怪物部件出图规范

1. **一图一部件**：每张 2×2 大图只画一个部件（body 就只画 body，不带头、不带腿）。
2. **单件、无配对**：四肢图只画一条腿/一只臂，左右由引擎镜像（同 §2.1.1 L1/L2）。
3. **关节端要"可旋转"**：
   - 肢体段上端（pivot 端）画**关节球 / 铆钉/ 皮套**，作为视觉铰链，且球心对准锚点；
   - 下端做圆头，并**往上段里探入 6–10px**（重叠区），这样旋转 ±45° 不会露缝；
   - 躯干分两段时，接缝在腰线，**上段压住下段**。
4. **体量**：怪物部件允许有厚度（不是火柴棒），但必须 **平涂 + 厚黑描边 + 少量排线**，禁止渐变、3D 渲染、真实毛发（§3.5）。
5. **方向**：2×2 四格同尺寸、同部件、脚/根部对齐同一条基准线；S 面朝镜头、E 朝右、N 背对、W 朝左。

### 3.4 怪物造型要求（极简卡通，禁止写实）

- 视觉上的零部件**控制在 5 个以内**（头 + 身体 + 腿 + 尾巴/武器 + 1 个标志性特征）。`humanoid10` 只是把同一条腿/臂拆成两段关节，不等于造型变复杂。
- 不要画复杂机械结构、多层装甲、可拆卸附件——每次生成会不一致，且拆件后接缝对不上。
- 画风与角色一致：《饥荒》暗黑哥特手绘——厚黑描边（略抖动）、排线阴影、平涂、**暗色调**（炭黑 / 暗棕 / 暗 navy / 旧黄铜），无渐变、无噪点。
- 造型"憨中带邪"：大圆眼、粗短腿、块面化身体，不要解剖准确的野兽。
- 机械部分只保留 **1–2 个简单形状**（一个齿轮 + 一根细管），不要铆钉阵列、管线网。

### 3.5 关键帧动画规范（四个模板通用）

怪物与角色共用同一套 clip 结构与编辑器，动作清单固定：

| clip | 时长 | 循环 | 关键姿势 |
|------|------|------|----------|
| `idle` | 2.0s | ✅ | 呼吸起伏（身体 ±2px、头微低）+ 四肢静止；首尾帧不完全相同但可无缝循环 |
| `walk` | 0.8s | ✅ | 四足：**对角步**（FL+BR → FR+BL）；人形：左右交替；身体随步伐上下 3–5px |
| `attack` | 0.6s | ❌ | 蓄力（后坐 + 抬头）→ **命中帧在第 40–50%**（前扑 / 挥击）→ 收招 |
| `hit` | 0.4s | ❌ | 后仰 + 后退 6–10px，末帧回弹过冲 |
| `death` | 1.2s | ❌ | 失去支撑 → 侧倒 / 前扑 → 触地回弹 → 末帧贴地静止 |

运动规则（必须遵守，否则动作会"飘"）：

- 每段肢体的 `pose.rot` 绕**自己的 pivot** 旋转，引擎已按 pivot 处理补偿；不要用整段平移伪造摆动。
- 子节点（小腿/前臂/头/尾）**只跟随父节点**，不要给子节点写与父节点同向的位移来"装作"整体移动。
- 死亡末帧必须**真的贴地**（躯干中心 y 降到接近地面），不要靠缩放假装倒地。

> 生成好部件后，在编辑器里按模板建骨架、K 帧，导出 `public/animations/{mon_id}_anim.json`（与角色动画 JSON 同格式；可参考 `tools/build_animations.mjs` 的做法）。

### 3.6 怪物部件 Prompt 模板（以 `beast5` 的 body 为例）

```
[CharacterLock —— 整只怪物的长相，全文复用，一字不改]
Rust Hound (锈蚀猎犬): chunky cartoon four-legged dog, big round glowing yellow eye, dark rust-brown
flat fur (single flat tone, NO fur strands), one simple brass gear on the shoulder, one thin copper
pipe on the back, stubby legs, curled wire tail. Only 5 parts. Dark gothic Don't Starve style:
thick scratchy black ink outline, muted dark palette (dark rust, charcoal, aged brass), subtle
cross-hatch shading. NO bright colors, NO realism, NO rivet arrays.

[PartLock —— 本图只画这一段]
BODY ONLY of the rust hound: the chunky horizontal torso block, seen from the side/three-quarter.
NO head, NO legs, NO tail, NO eyes, NO gear, NO pipe. Just the body block with its belly seam.

[Pivot]
The body rotates around its CENTER. Draw it centered in its cell, horizontal, level.

[Layout — 2×2 grid, thin light-gray separators, pure white background]
  top-left = S (front view)  | top-right = E (facing right)
  bottom-left = N (back)     | bottom-right = W (facing left)

[CRITICAL]
- ONE body only per cell. Same body, same scale, same vertical position in all four cells.
- In S/N the body is seen head-on (narrower silhouette); in E/W it is a long horizontal block.
- NO text, NO numbers, NO shadows, NO ground, NO other parts.

[ALIGNMENT RULES]
- Each cell is 512×512. The body's CENTER must land at exactly (256, 256) in every cell.
- Cut out all four cells and stack them with no offset: the body must line up perfectly.
```

**四肢（`leg`，单张共用）追加段**：

```
- Draw ONE single leg only — NOT a pair, NOT four legs.
- Upper end = pivot end: round joint ball / leather socket, aligned to the TOP-CENTER of the cell
  (256, 100). Lower end = rounded hoof/paw.
- The leg must read the same when mirrored horizontally: no left/right specific shape, no scars.
- Same leg is reused for all four legs with horizontal mirroring — keep it symmetric.
```

**头（`head`，4 方向）追加段**：

```
- HEAD ONLY — no neck stump, no body, no shoulders.
- Bottom-center of the head (neck joint) must land at (256, 412) in every cell.
- S = facing viewer, E = facing right (profile), N = back of head, W = facing left (profile).
```

### 3.7 生成流程（完整示例：`rust_hound` / `beast5`）

```
0. 选模板：beast5（body + 4 腿），附加件 head、tail
1. GenerateImage → parts/body.png        （2×2 四方向，无参考，CharacterLock + PartLock(body)）
2. GenerateImage → parts/head.png        （2×2，参考 parts/body.png 的 S 格）
3. GenerateImage → parts/leg.png         （单张，2×2 也用同一造型的四格，或直接单格共用）
4. GenerateImage → parts/tail.png        （可选，2×2）
5. 脚本裁件 → public/assets/sprites/enemy/rust_hound/parts/{body,head,leg,tail}/
6. 编辑器：新建工程 → 选模板 beast5 → 自动建 5 关节骨架 + 附加件
7. K 帧：idle(2.0s loop) / walk(0.8s loop) / attack(0.6s once) / hit(0.4s once) / death(1.2s once)
8. 导出 → public/animations/rust_hound_anim.json
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

# 怪物部件（每部件一张 2×2 方向大图 → 裁成 parts/{slot}/{S,E,N,W}.png）
python tools/build_sprites.py --mode monster_parts --in sprite_ani/monsters/{mon_id}/parts/ --out public/assets/sprites/enemy/{mon_id}/parts/ --template beast5 --grid 512
```

脚本功能：
1. 识别 `--mode`，读入 manifest 里的 `gridSize` 和布局参数；怪物模式读 `templates.json` 的模板（关节 / 图像槽 / pivot / 布局）
2. 按网格裁出所有部件，自动保存到 `public/assets/sprites/` 下的规范目录；同 `slot` 的多个关节只裁一份，其余复用
3. 按 pivot 类型（top / bottom / center）把部件摆进 512 画布，脚底线统一 `FOOT_Y = 412`
4. 自动计算 `footBaselineY`（角色：calf_L / calf_R 的脚底 Y；怪物：最低的腿部件脚底 Y）
5. 自动生成/更新 `public/assets/sprites/manifest.json`（部件坐标、挂点、Z 层、模板 id）

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
└── monsters/{mon_id}/                  ← 怪物部件大图
    └── parts/
        ├── body.png                    ← 每个部件一张 2×2 大图（S/E/N/W 四格）
        ├── head.png
        └── leg.png                     ← 成对肢体只画一份（镜像复用）
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
└── enemy/                              ← 怪物：一个怪物一个文件夹（纸娃娃部件）
    └── rust_hound/
        └── parts/                       ← 按图像槽分文件夹
            ├── body/   S.png  E.png  N.png  W.png
            ├── head/   S.png  E.png  N.png  W.png
            ├── leg/    single.png       ← 成对肢体：一张图 + 镜像复用
            └── tail/   S.png  E.png  N.png  W.png
```

要点：
- `role/` 根目录下**只有公共部件（common/，4 根火柴棒）和各角色文件夹**；角色文件夹里**只有头部**，不出现身体部件。
- `equipment/` 下**只有 back / hat / hand / foot / weapon 五个文件夹**，不存在其他类别；每个物品独立成文件夹。
- `enemy/` 每个怪物独立文件夹，内部**只有 `parts/`**（每个图像槽一个子文件夹）；**不再有 `idle/`、`walk/` 帧条带**——动作由 `public/animations/{mon_id}_anim.json` 的关键帧描述。
- 怪物动画 JSON 与角色动画 JSON 结构完全一致（`directions → clips → tracks`），引擎共用一套播放器。

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
      "template": "beast5",            // 骨架模板：humanoid10 / humanoid5 / beast5 / custom
      "path": "enemy/rust_hound",
      "animPath": "animations/rust_hound_anim.json",  // 关键帧动画（与角色同格式）
      "footBaselineY": 412,            // 全方向统一脚底线
      "parts": {
        "body": { "dirs": { "S": "enemy/rust_hound/parts/body/S.png", "E": ".../E.png",
                            "N": ".../N.png", "W": ".../W.png" }, "pivot": "center" },
        "head": { "dirs": { "S": ".../head/S.png", "E": ".../E.png",
                            "N": ".../N.png", "W": ".../W.png" }, "pivot": "bottom" },
        "leg":  { "shared": true, "mirrored": true,
                  "path": "enemy/rust_hound/parts/leg/single.png", "pivot": "top" },
        "tail": { "dirs": { "S": ".../tail/S.png" }, "pivot": "top", "optional": true }
      },
      "layoutS": {                     // 与角色同格式：cx + bottom/top + h（512 画布）
        "body":  { "cx": 256, "bottom": 300, "h": 130 },
        "head":  { "cx": 256, "bottom": 168, "h": 90 },
        "leg_FL": { "cx": 204, "bottom": 412, "h": 130 },
        "leg_FR": { "cx": 308, "bottom": 412, "h": 130 },
        "leg_BL": { "cx": 224, "bottom": 412, "h": 130 },
        "leg_BR": { "cx": 288, "bottom": 412, "h": 130 },
        "tail":  { "cx": 352, "bottom": 250, "h": 70 }
      },
      "zOrderS": ["tail", "leg_BL", "leg_BR", "body", "leg_FL", "leg_FR", "head"]
    }
  ]
}
```

---

## 7. 质量门禁（QA Gate）

| # | 类型 | 检查项 | 通过标准 |
|---|------|--------|---------|
| Q1 | 对齐 | 同一方向大图所有部件脚 baseline Y 差 ≤ 2px | 裁剪后所有部件叠到一起脚不飘 |
| Q2 | 对齐 | 怪物同方向所有部件脚 baseline Y 差 ≤ 2px（腿一律 `FOOT_Y=412`） | 走路时怪不飘、不陷地 |
| Q3 | 对齐 | 装备 4 方向挂载点与角色身体挂点差 ≤ 2px | 帽子不飘、武器不入手 |
| Q4 | 模型 | 前一方向 → 后一方向的参考链完整 | E 一定参考 S、N 一定参考 E |
| Q5 | 模型 | 怪物零部件 ≤ 5 个 | 复杂度清单通过 |
| Q6 | 模型 | 角色脖子/四肢是 Don't Starve 线状物（细杆+关节球） | 无厚肉块 |
| Q7 | 模型 | 躯干 4 方向都合理（等距投影，不是正面/侧面轮廓） | 从 E/W 方向看 torso_U 不至于完全变形 |
| Q8 | 网格 | 所有大图 `width % gridSize === 0 && height % gridSize === 0` | 脚被裁一半 |
| Q9 | 网格 | 所有部件/帧图尺寸精确 = gridSize | 脚本裁剪无偏差 |
| Q10 | 透明 | 裁剪后透明区无黑边、无纯白棋盘格残留 | 无白边 |
| Q11 | 跨方向 | 同一部件 4 个方向格 SSIM ≥ 0.80（造型/配色一致，只有朝向不同） | S 和 E 的猎犬长得不像同一只 |
| Q12 | 文字 | 图内无编号、无文字、无 watermark | OCR 检出 → 重绘 |
| Q13 | 对称 | 角色身体左/上臂（及大腿/小腿）不对称元素（武器手侧）方向变化合理 | 持武器手在 S/SE/E 都在画面同一侧 |
| Q14 | 装备 | hand/foot 装备的裁剪能**替换** forearm / calf 对应区域 | 不遮挡 head/neck/torso |
| Q15 | 怪物 | 模板关节 + 附加件**无缺件**（beast5 = body/4 腿/head[/tail]） | 编辑器骨架不出现空节点 |
| Q16 | 动作 | 5 个 clip 齐全，attack 命中关键帧落在 40–50% 处 | 有前摇无出招 / 只有 idle |
| Q17 | 装备 | 每个 foot 格内**只有 1 只鞋**，每张 hand 图内**只有 1 只握拳手套** | 单只、无左右差异 |
| Q18 | 装备 | back 的 S 图只有背带（无包体），E/N/W 只有包体（无背带） | 逐图核对，靠文件名不能验证 |
| Q19 | 怪物 | 相邻部件在关节处**重叠 6–10px**，上段末端有关节球/铰链 | 旋转 ±45° 不露缝、不断肢 |
| Q20 | 怪物 | 成对肢体（L/R、FL/FR/BL/BR）**只出一张图**且无左右特征 | 镜像后看不出左右 |
| Q21 | 怪物 | 怪物动作以**关键帧 JSON** 交付（`animations/{mon_id}_anim.json`），编辑器可打开回放 | 仍交帧条带 → 打回 |

---

## 8. 反模式（打回规则）

| # | 反模式 | 处置 |
|---|--------|------|
| R1 | 方向顺序打乱（先 E 再 S） | 按 S→E→N→W 重走参考链 |
| R2 | 生成后一方向时未传前一方向参考图 | 退回，补上参考 |
| R3 | 怪物仍出帧动画条带，或只出部件不做关键帧动作 | 退回：部件出图 + 编辑器 K 帧，交 `anim.json` |
| R4 | 怪物部件数超过模板关节数（如 beast5 画了 6 条腿 / humanoid10 多画一套关节） | 按模板删减，重画 |
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
| R20 | 怪物画成**整只**（一张图里身体+头+腿全画上） | 退回：一图一部件，按模板拆件（§3.3） |
| R21 | 5 关节模板擅自加肘/膝/腕（画成 2 段式肢体） | 退回：`humanoid5`/`beast5` 是一段式四肢；要关节请用 `humanoid10` 或 `custom` |
| R22 | 部件图里带阴影、地面、或把两个部件混画在一起 | 退回重画：单件、无阴影、无地面 |
| R23 | 关节端没做重叠/关节球，旋转后露缝断肢 | 退回：上段画关节球，下段探入 6–10px（§3.3） |

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

// 怪物动作顺序（与角色同名的 5 个 clip，均以关键帧驱动）
export const MONSTER_ACTION_ORDER = ['idle', 'walk', 'attack', 'hit', 'death'] as const;

// 骨架模板（怪物与角色共用；关节 / 图像槽 / pivot / 布局见 templates.json）
export const SKELETON_TEMPLATES = ['humanoid10', 'humanoid5', 'beast5', 'custom'] as const;
export const JOINT_COUNT = { humanoid10: 10, humanoid5: 5, beast5: 5 } as const;

// 部件旋转轴：肢体绕顶端、躯干/头绕底端、兽身绕中心
export type PivotKind = 'top' | 'bottom' | 'center' | 'left' | 'right'; // left/right：水平件（尾巴/武器）以根部为轴
```

角色/装备/怪物 三种渲染组件在引擎里的结构（伪代码）。**怪物与角色共用同一套 `parts + clips`**：
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
  template: 'humanoid10' | 'humanoid5' | 'beast5' | 'custom'
  /** 静态骨架：与角色 PartDef 等价（id / parent / zIndex / texturePath / layout / pivot） */
  parts: PartDef[]
  /** 关键帧动画：与角色完全相同的 Clip 结构（4 方向 × 5 clip） */
  clips: Record<DirKey, Record<ActionKey, Clip>>
  footBaselineY: number
}
```

> 运行时只认 `parts + clips`，不关心这是"角色"还是"怪物"——两者走同一个组装器与播放器。
