---
name: "sprite-8dir-anim"
description: "8-direction high-quality character frame animation generation spec (no flip/mirror/reuse). Invoke when creating sprite sheets, frame sequences, or character animation assets for the game."
---

# 2D 角色 8 方向高质量帧动画生成 Skill

> 本 Skill 是本项目角色精灵图资源的**唯一标准**。所有角色帧动画产出（无论外包、AI 生成、管线脚本输出）必须满足本文约束，任一门禁未通过即视为不合格。

---

## 0. 硬性约束（不可协商）

- 8 方向**全部独立绘制**：禁止旋转生成、禁止镜像复用、禁止斜向复用水平/垂直帧。
- 方向集合固定，角度以摄像机为基准（朝下为 0°，顺时针递增）：

  | 方向 | 全称 | 朝向角度 |
  |------|------|---------|
  | S    | 下/朝镜头   | 0°      |
  | SE   | 右下       | 45°     |
  | E    | 右         | 90°     |
  | NE   | 右上       | 135°    |
  | N    | 上/背对     | 180°    |
  | NW   | 左上       | 225°    |
  | W    | 左         | 270°    |
  | SW   | 左下       | 315°    |

- 8 方向规格完全一致：帧数、帧率、画布、轴心、脚底基准线逐方向对齐。
- 不对称元素独立体现：武器手、披风、单侧护甲/装饰、发型分缝在 8 方向下各自朝向正确，**不依赖翻转**。
- **一动画一精灵图（强制）**：大模型**必须一次性直接生成整张精灵表**（`1×N` 横向切片）。禁止先逐帧独立生成再用脚本拼接——拼接会丢失一致性。如果模型不支持，退而求其次逐帧生成时，每帧必须同时传入前一帧作参考（逐帧参考链），且最终仍以 `1×N` 精灵表形式交付。
- **角色参考来自 idle 首帧**：不预生成独立正视图 ref。先生成 idle 精灵表（基准方向），然后用 PIL 从 idle 第 1 帧抠出角色存为 `keyframes/character_keyframe.png`，作为后续所有方向所有动作的统一角色参考。
- **逐帧参考链（fallback）**：同一动画内，若无法一次性生成整张精灵表，每生成第 N 帧时必须同时传入第 N-1 帧作为参考图，保证姿态连续。跨动作共享 character_keyframe.png，跨方向各自独立重绘。

---

## 1. 输入契约（生成前必须收集）

### 1.1 角色与风格
- 角色名 / 角色 ID
- 美术风格：像素风 / 手绘卡通 / 写实厚涂 / 矢量
- 抗锯齿：像素风必须关闭；其他按风格统一
- 颜色模式：sRGB（默认）
- **不对称特征清单**：持武器手、披风侧、单侧护甲/装饰、发型分缝——8 方向下逐方向确认朝向

### 1.2 视角与透视
- 摄像机视角：正俯视 / 斜 45° 等距 / 伪 3D 纵深（8 方向必须明确）
- 透视规则：各方向躯体压缩比、脚底与地面接触关系、斜向方向的透视缩短比例
- 基准方向：通常 E 或 S，其余 7 方向相对基准的角度与透视规则

### 1.3 动作清单（逐动作逐方向）

字段与示例：
- 动作名：`walk`（必填）
- 帧数：`8`（必填）
- 帧率：`12 FPS`（必填）
- 是否循环：`是`（必填）
- 关键姿态描述：左脚前迈、右臂后摆（建议）
- 方向覆盖：**全部 8 方向**（本 Skill 固定全 8 向，必填）

基础动作模板（按游戏状态机分类，按需裁剪）：

| 分类 | 动作 |
|------|------|
| 站立类 | `idle` |
| 运动类 | `walk`、`run`、`dash` |
| 战斗类 | `attack_light`、`attack_heavy`、`cast` |
| 受击类 | `hit`、`death` |
| 跳跃类 | `jump_start`、`jump_air`、`jump_land` |

### 1.4 画布与技术规格
- 画布尺寸：**统一**，按所有动作所有方向最大包围盒确定（如 256×256）
- 轴心点：脚底中心，给出像素坐标（如 (128, 236)）
- 脚底基准线 Y 坐标
- 安全边距：2–4 px
- 透明通道：必须
- 交付格式：PNG 序列 + 精灵表 + 帧数据 JSON
- 图集上限：2048×2048 或 4096×4096
- 过滤方式：像素风 Point/Nearest，手绘风按项目

---

## 2. 生成流程（大模型生图版本）

> **核心策略**：大模型生图极易出现角色漂移、衔接断裂，本节规定参考图链 + prompt 三段拆分 + 一动画一精灵图三条硬性生成策略。外包/手绘可参考 Step 2-4 的动作分解逻辑，但**一动画一精灵图**和**参考图链**对大模型生图是强制的。

### Step 0：先生成 idle 精灵表 → 从首帧抠出角色参考图

**不预生成独立正视图 ref**。先用 CharacterLock + ViewLock（基准方向，通常 E 或 S）生成一张 idle 精灵表，再从中抠角色参考。

**流程**：
1. 用 CharacterLock + ViewLock(基准方向) + idle 动作描述，**一次性生成整张 idle 精灵表**
2. 用 PIL 从该精灵表的**第 1 帧**（frame 1，index 0）切出角色区域 → 存为 `character_{id}/keyframes/character_keyframe.png`
3. manifest.json 记录 `characterKeyframe.path` + `characterKeyframe.hash`
4. 后续所有方向、所有动作生成必须**显式带上这张 keyframe 图作为参考**

**为什么这样做**：
- 独立正视图 ref 和最终精灵表中的角色可能存在"换脸"漂移
- idle 首帧就是游戏中角色的实际初始姿态，从此抠出的 keyframe 天然和所有动作衔接
- 省掉一张额外 ref 图的生成成本

**使用规则**：
- character_keyframe.png 只在 idle 的第 1 帧抠，**不随其他动作更新**
- 一旦锁定不可修改，若需改必须重新走完整生成流程

### Step 1：规格校验 + Prompt 模板锁定

#### 1.1 规格校验（进入生成前）
- 画布容纳所有动作所有方向最大包围盒
- 轴心、脚底基准线全帧全方向一致
- 8 方向命名完整统一
- 动作清单覆盖状态机所需状态
- **不通过打回，不进入生成**

#### 1.2 Prompt 三段拆分（强制）
所有大模型生图 prompt 必须拆为以下三段，**CharacterLock 段在所有批次中完全复用，一字不改**：

```
[CharacterLock —— 角色锁，全文复用]
{id} steam-punk engineer: adult male, short dark brown hair with left-side part, round wire-rimmed glasses, navy blue overalls with brass rivets, brown leather tool belt with tool pouch on LEFT hip, RIGHT hand holds metallic open-end wrench, copper pipes on right shoulder, brown leather work boots. Hand-painted digital art style, sRGB, soft anti-aliasing, transparent background, full body, feet aligned to bottom baseline, centered composition.

[ViewLock —— 视角锁，仅改变方向描述]
Facing East (right, 90°, pure side profile).
// Facing South (facing camera, front view).
// Facing Southeast (45° isometric, half-front).
// ... 8 方向各自一条

[ActionDesc —— 动作描述]
Walking animation, frame 3 of 8: left foot at maximum forward position, right foot pushing off ground.
// Idle breathing, frame 6 of 8: max exhale, chest fully lowered.
// Attack light, frame 3 of 6: wrench at peak swing, body leaning forward.
// ... 逐帧描述
```

### Step 2：模型直接生成整张精灵表（唯一允许的主流程）

**每个动作每个方向 → 一次 GenerateImage 调用 → 一张完整的 1×N 横向切片精灵图**。不允许后处理拼接。

**主流程 Prompt 模板**（以 idle_E 8 帧为例）：
```
[CharacterLock —— 全文复用，一字不改]
[ViewLock —— Facing East, 90° pure side profile]

CRITICAL RULES — READ FIRST:
- Generate a SINGLE HORIZONTAL STRIP sprite sheet, 8 frames in one ROW, nothing else.
- NO numbered labels, NO frame numbers, NO circles, NO boxes, NO text, NO annotations, NO watermarks.
- Every frame shows the EXACT SAME CHARACTER. Same face, same hair, same clothes, same weapon hand.
- All frames have the SAME SIZE, SAME CANVAS, SAME FOOT BASELINE Y coordinate.
- TRANSPARENT BACKGROUND ONLY — no ground, no shadows, no scenery, no environment.

Frame 1: [详细的姿态描述]
Frame 2: ...
Frame 3: ...
...
Frame 8: [最后一帧描述，循环动作要求 NOT identical to frame 1]
```

**Prompt 里必须明确告诉模型**："NO numbered labels, NO frame numbers, NO text, NO watermarks" — Seedream 等模型默认会在多帧图上加编号标注，这是目前最严重的后处理问题。**必须显式禁止**。

**逐帧参考链（仅在模型实在不支持一次出整张精灵表时的 fallback）**：
如果模型明确拒绝多帧精灵图，退而逐帧生成时，**每生成第 N 帧必须把第 N-1 帧作为参考图**。但即便逐帧生成，**最终交付形式仍必须是 1×N 精灵表**（PIL 拼接）——但这种情况视为不合格打回，应换模型。

### Step 3：8 方向独立展开
- 逐方向独立重绘，**禁止镜像翻转、禁止旋转裁剪**
- 每个方向单独用 Step 2 的方式生成自己的精灵表
- 跨方向共享同一套 CharacterLock（保证角色一致性），ViewLock 改成对应方向
- 每完成一个方向做方向一致性检查：身高、脚底、武器手、披风朝向、比例

### Step 4：动作衔接与循环校验
- 循环动作：首尾姿态连续但不重复（首尾帧差异在"阈值区间"内，不应完全相同也不应完全不相关）
- 单次动作：明确起止帧，起止帧与循环动作的 idel 衔接姿态一致
- 所有方向所有动作的结束姿态，与 idle 动作的起始姿态**自然衔接**（无跳变）

### Step 5：技术处理
- 透明背景、Alpha 预乘确认、无黑边
- 像素风关闭抗锯齿与 mipmap
- 从精灵表自动切帧：用固定帧宽 `canvasW / cols` 和帧高 `canvasH / rows`（或行数=1）切分
- 导出 PNG 序列 + 精灵表 + 帧数据 JSON（每帧矩形、轴心、时长、循环标记）

### Step 6：元数据
- 生成 manifest.json：角色 ID、ref 图路径与 hash、方向集合、每个动作每个方向的帧数/帧率/循环标记、画布尺寸、轴心坐标、脚底基准线、命名规则、图集划分

---

## 3. 质量门禁（QA Gate，逐项通过，任一失败打回）

### 3.1 8 方向专项门禁

| # | 检查项 | 通过标准 | 失败信号 / 反模式检测启发式 |
|---|--------|---------|---------------------------|
| D1 | 8 方向独立绘制 | 无旋转生成、无镜像复用、无斜向复用 | ① 某方向帧相对对称方向呈镜像（逐像素水平翻转相似度 > 0.95）；② 某方向帧可由相邻方向单应性矩阵变换得到 |
| D2 | 规格一致 | 8 方向帧数、帧率、画布、轴心完全一致 | 任一方向帧数差 1 帧以上、画布尺寸差 1 px 以上、轴心差 1 px 以上 |
| D3 | 斜向透视正确 | 无旋转锯齿、无比例失真 | 斜向方向肢体细长/压扁超出设定压缩比 ±10%；边缘出现旋转锯齿 |
| D4 | 不对称元素朝向 | 武器手、披风、单侧装饰 8 方向各自朝向正确 | 持武器手在 S/SE/E/NE 四个方向都出现在画面同一侧（应随方向切换） |
| D5 | 方向切换过渡 | 相邻方向切换姿态连续，无跳变 | 连续方向（E→NE→N）关键帧整体轮廓相似度跳变 > 阈值 |
| D6 | 循环独立无缝 | 每个方向循环动作首尾连续 | 首尾帧差异极小但不相同（若完全相同则是"首尾同图"打回） |
| D7 | 图集划分合规 | 未突破 2048×2048 或 4096×4096，帧数据可正确切分 | 精灵表尺寸超出上限；帧矩形越界或重叠 |

### 3.2 通用门禁

| # | 检查项 | 通过标准 |
|---|--------|---------|
| G1 | 画布一致 | 所有帧画布尺寸一致 |
| G2 | 轴心一致 | 所有帧轴心像素坐标一致 |
| G3 | 脚底基准线一致 | 站立类动作（idle/walk）脚底基准线 Y 一致 |
| G4 | 循环首尾无缝 | 循环动作首尾姿态连续但不重复，无停顿帧 |
| G5 | 裁切安全 | 最大动作帧未被裁切，安全边距 ≥ 2 px |
| G6 | 透明干净 | 透明背景无黑边/白边 |
| G7 | 命名统一 | `{ID}_{动作}_{方向}_{序号4位}.png`，序号从 0001 起 |
| G8 | 动作词表统一 | 动作枚举不出现同义词（如同时用 walk 和 walking） |
| G9 | manifest 一致 | manifest 声明与实际文件一一对应 |

### 3.3 风格门禁

| # | 检查项 | 通过标准 |
|---|--------|---------|
| S1 | 抗锯齿匹配 | 像素风关闭，手绘/厚涂开启 |
| S2 | 颜色模式匹配 | sRGB |
| S3 | 跨方向风格一致 | 角色比例、配色、描边粗细跨方向一致 |

### 3.4 大模型生成专项门禁（AI 生图必过）

| # | 检查项 | 通过标准 | 失败信号 |
|---|--------|---------|---------|
| A1 | 角色 keyframe 存在 | `keyframes/character_keyframe.png` 存在且 manifest 中 `characterKeyframe.hash` 匹配 | 缺 keyframe；keyframe hash 与 manifest 不一致；keyframe 不是从 idle 第 1 帧抠出 |
| A2 | CharacterLock 一致 | 所有批次 prompt 的 CharacterLock 段完全相同（一字不差） | 不同批次 prompt 出现描述差异（如"wire-rimmed glasses" vs "round glasses"） |
| A3 | 同一动画角色一致 | 同一动作同一方向的所有帧，SSIM ≥ 0.85 | 连续帧角色比例、配色、发型明显漂移 |
| A4 | 跨动作角色一致 | 不同动作但同方向（如 walk_E vs idle_E），角色 ref 特征相似度 ≥ 0.9 | walk_E 的角色长得和 idle_E 不像了（脸、发型、身材漂移） |
| A5 | 首尾帧连续 | 循环动作首尾帧 SSIM 在 [0.55, 0.95] 区间 | < 0.55 跳变；= 1.0 停顿（完全相同） |
| A6 | 一动画一精灵图 | 每个动作每个方向产出一张精灵表，非逐帧拼接 | 目录下是 8 张独立帧图而非一张精灵表 |
| A7 | 脚底基准线稳定 | 同一动画所有帧脚底 Y 坐标差异 ≤ 2px | 脚在画面里上下飘 |

---

## 4. 命名与文件组织

```
character_{id}/
├── manifest.json
├── keyframes/
│   └── character_keyframe.png    ← 从 idle 第 1 帧抠出，所有方向/动作共享的角色参考
└── sheets/
    ├── {id}_{action}_{dir}_sheet.png     ← 模型直接生成的 1×N 横向切片精灵表
    └── {id}_{action}_{dir}_sheet.json   ← 帧数据（帧矩形、轴心、时长）
```

- 目录**保持最简**：只保留 manifest + keyframes + sheets 三层。不生成 sprites/、source/、preview/、qa/ 等冗余目录
- `dir` 固定 8 值：S / SE / E / NE / N / NW / W / SW
- 禁止任何方向缺失或复用其他方向文件

---

## 5. 预期生成产物（完整描述）

### 5.1 产物总览
一次完整生成产出一套角色的 8 方向帧动画资源包：8 方向序列帧、精灵表与帧数据、manifest 清单、方向一致性检查表、每个动作每个方向的预览视频。所有产物围绕同一个角色 ID 组织，目录结构固定。

### 5.2 目录结构产物
第 4 节所述目录。`{dir}` 必须完整覆盖 S/SE/E/NE/N/NW/W/SW，不允许缺失或空目录。

### 5.3 序列帧产物
- 帧数与该动作清单声明一致，**8 方向帧数完全相同**
- 画布尺寸全角色全方向全帧统一
- 轴心像素坐标全帧全方向一致，位于脚底中心
- 透明背景，无黑边白边，像素风关闭抗锯齿与 mipmap
- 循环动作首尾姿态连续但不重复
- 斜向方向独立绘制，透视压缩正确
- 不对称元素各方向朝向正确
- 命名示例：`hero_walk_NE_0003.png`

### 5.4 精灵表与帧数据产物
每个动作每个方向一张精灵表 PNG + 一份帧数据 JSON。帧数据 JSON 至少包含：
```jsonc
{
  "action": "walk",
  "dir": "SE",
  "fps": 12,
  "loop": true,
  "frameCount": 8,
  "frames": [
    { "x": 0,    "y": 0,   "w": 128, "h": 128, "anchorX": 64, "anchorY": 120, "durationMs": 83 },
    { "x": 128,  "y": 0,   "w": 128, "h": 128, "anchorX": 64, "anchorY": 120, "durationMs": 83 }
    // ...
  ]
}
```
- 帧数据必须能直接驱动引擎切分与播放，不依赖人工二次标注

### 5.5 manifest.json 产物（最小模板）
```jsonc
{
  "characterId": "hero",
  "style": "don_t_starve_hand_drawn_steam_punk",
  "viewingAngle": "side_profile",
  "characterKeyframe": {                       // 从 idle 首帧抠出的角色参考
    "path": "keyframes/character_keyframe.png",
    "hash": "sha256:abcd..."                   // 抠帧后计算
  },
  "promptLock": {                               // 锁定的 CharacterLock 段（所有批次复用）
    "characterLock": "steam-punk engineer in Don't Starve style: ...",
    "viewLocks": { "S": "...", "SE": "...", "E": "...", "NE": "...", "N": "...", "NW": "...", "W": "...", "SW": "..." },
    "lastUpdated": "2026-10-28T12:00:00Z"
  },
  "perspective": {
    "baseDirection": "E",
    "compression": { "S": 1.0, "SE": 0.9, "E": 0.85, "NE": 0.9, "N": 1.0, "NW": 0.9, "W": 0.85, "SW": 0.9 }
  },
  "directions": ["S","SE","E","NE","N","NW","W","SW"],
  "canvas": { "w": 1024, "h": 1024 },
  "anchor": { "x": 512, "y": 950 },
  "footBaselineY": 950,
  "colorMode": "sRGB",
  "antialias": true,
  "loopActions": {
    "idle":    { "frames": 8, "fps": 10, "loop": true  },
    "walk":    { "frames": 8, "fps": 12, "loop": true  }
  },
  "singleActions": {
    "attack_light": { "frames": 6, "fps": 24, "loop": false }
  },
  "namingRule": "{characterId}_{action}_{dir}_sheet.png",
  "atlasLimit": 4096
}
```
- manifest 必须与实际文件**逐一对应**
- `characterKeyframe.hash` 和 `promptLock` 一旦锁定不可修改

### 5.6 方向一致性检查表产物（CSV 示例）

| action | dir | 身高一致 | 脚底Y一致 | 轴心一致 | 武器手朝向 | 披风朝向 | 透视压缩 | 循环首尾差 | 检查结论 |
|--------|-----|---------|----------|---------|----------|---------|---------|----------|---------|
| walk   | S   | ✓       | ✓        | ✓       | 右手-右下 | 背后-下 | 1.0      | 连续不相同 | 通过   |
| walk   | SE  | ✓       | ✓        | ✓       | 右手-前   | 后-右下 | 0.90     | 连续不相同 | 通过   |
| ...    | ... | ...     | ...      | ...     | ...      | ...     | ...      | ...      | ...    |

- 该表是 8 方向高质量交付的**验收凭证**，缺失即视为交付不完整

### 5.7 预览产物
每个动作每个方向一段 GIF 或短视频，覆盖全部 8 方向 × 全部动作。不允许只抽几个方向做预览。

### 5.8 源文件产物（可选）
按合同交付 PSD / Aseprite / 工程源文件，保留分层信息。manifest 中注明源文件存放位置。

### 5.9 产物验收标准（必须同时满足）
1. 8 方向目录齐全，无缺失、无复用、无旋转生成、无镜像
2. 所有帧画布、轴心、脚底基准线一致
3. 循环动作首尾无缝，无重复帧停顿
4. 斜向方向透视正确，不对称元素朝向正确
5. 精灵表与帧数据可直接被引擎导入播放
6. manifest 与实际文件完全对应
7. 方向一致性检查表填写完整
8. 预览覆盖全部动作全部方向

### 5.10 产物边界说明（非此即打回）
本 Skill **不产出**：
- 多方向之外的翻转复用版本
- 旋转生成的中间帧
- 非 8 方向的简化方向组（如 4 方向）
- 未在动作清单中声明的动作

---

## 6. 交付物清单

| # | 交付物 | 必交/可选 | 说明 |
|---|--------|----------|------|
| 1 | PNG 序列帧（按动作/方向分文件夹） | 必交 | 8 方向齐全 |
| 2 | 精灵表 + 帧数据 JSON | 必交 | 每帧矩形、轴心、时长、循环标记 |
| 3 | manifest.json | 必交 | 第 5.5 节模板 |
| 4 | 方向一致性检查表 | 必交 | 第 5.6 节格式 |
| 5 | 动作预览 GIF/视频 | 必交 | 每方向每动作一段 |
| 6 | 源文件（PSD/Aseprite/工程） | 可选 | 按合同 |

---

## 7. 反模式清单（打回规则）

| # | 反模式 | 根因 | 检测手段 | 处置 |
|---|--------|------|---------|------|
| R1 | 旋转生成斜向帧 | 斜向帧由正方向旋转 45° 得来 | 斜向帧边缘锯齿、肢体比例失真、单应性匹配通过 | 直接打回，逐方向独立重绘 |
| R2 | 镜像复用左右方向 | W = 水平翻转 E；NW = 翻转 NE | 逐像素水平翻转相似度 > 0.95，且武器手/披风在左右都画面同侧 | 直接打回，独立重绘 |
| R3 | 斜向复用水平/垂直帧 | SE 复用 E 或 S 的关键帧 | SE 关键帧可由 E 或 S 做一次缩放/裁剪得到 | 直接打回，独立重绘 |
| R4 | 8 方向规格不一致 | 某方向帧数/轴心/画布与其他方向不同 | 帧数差 ≥1、轴心差 ≥1px、画布尺寸差 ≥1px | 打回重做该方向 |
| R5 | 画布按单帧定尺寸 | 攻击/死亡帧比 idle 大导致裁切 | 最大包围盒超出画布安全边距 < 2px | 重新定画布 |
| R6 | 循环首尾同图 | 首尾帧完全相同，播放停顿一帧 | 首尾帧像素差异 < 阈值 | 调整为连续但不同 |
| R7 | 缺方向或方向文件复用 | 某方向缺失或引用其他方向文件 | 目录列表缺 dir；帧内容是另一方向的缩放 | 补齐 |
| R8 | 只交精灵表不交帧数据 | 引擎无法自动切分 | 缺 `{id}{action}{dir}_sheet.json` | 补齐帧数据 |
| R9 | 不交方向一致性表 | 方向间跳变无追溯 | 缺 `qa/direction_consistency_checklist.csv` | 补齐检查表 |
| R10 | 逐帧独立生成导致角色漂移 | 每帧独立 prompt，无参考图链，模型对同一角色理解逐渐偏移 | 连续帧脸、发型、身材漂移 SSIM < 0.85 | 退回 Step 0 重走 idle → keyframe 流程，所有批次带上 keyframe 作参考 |
| R11 | 一动画拆成多张独立帧再拼接 | 逐帧生成 PNG 而非一次性精灵表 | 目录是 frame_01.png...frame_08.png 而不是 sheet.png | 退回 Step 2 重新生成精灵表 |
| R12 | 跨批次 CharacterLock prompt 不一致 | 不同动作用了不同版本的角色描述词 | prompt 文本 diff 出现措辞差异 | 锁定 CharacterLock 段，重新生成受影响批次 |

---

## 8. 管线自动化检查建议

以下门禁项可转为**脚本化自动检查**，建议后续补充 `qa/check_sprites.py`：

| 脚本可检项 | 方法 |
|-----------|------|
| 画布一致性 | PIL `.size` 读取所有帧 diff |
| 轴心一致性 | 读取帧数据 JSON 中 `anchorX/anchorY` |
| 命名正则 | 正则 `^{ID}_{action}_{dir}_\d{4}\.png$` |
| manifest ↔ 文件 | glob 文件列表 vs manifest.files 差集 |
| 首尾帧差异 | SSIM / MSE 计算循环动作首尾帧相似度（应在"连续"阈值内但不为 1） |
| 方向文件完整性 | glob 8 个 dir 全存在且非空 |
| 无镜像复用 | 对称方向帧与其水平翻转帧的 MSE 应明显高于两个独立方向之间的 MSE |
| 透明无黑边 | 检查 alpha<255 区域的 RGB 是否接近黑色 |

---

## 9. 使用方式

- **Agent Skill**：第 1 节做输入表单，第 2–3 节做生成与校验，第 7 节做打回规则
- **外包需求书**：第 1 节填表 + 第 3 节门禁 + 第 5–6 节产物与交付物直接发美术
- **管线脚本**：第 3 节门禁转自动化检查，见第 8 节建议
- **代码审查基线**：任何 sprite 相关 PR 必须附方向一致性检查表（第 5.6 节）作为验收凭证
