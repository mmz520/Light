---
name: "sprite-8dir-anim"
description: "8-direction high-quality character body-part sprite generation spec. Invoke when creating sprite sheets, body-part chunks, or character assets for the game."
---

# 2D 角色 8 方向身体分块（Part-Sprite）生成 Skill

> 本 Skill 是本项目角色精灵图资源的**唯一标准**。与传统"帧动画精灵表"完全不同：**一个角色 = 多块身体分图（头、躯干、上臂、前臂、腿、脚、武器）**，每块独立绘制、独立打包，由引擎代码负责在运行时组装成完整角色。**本 Skill 不涉及任何帧动画**。

---

## 0. 核心范式（先理解再动手）

| 项目 | 本 Skill（身体分块） | 已废弃（帧动画） |
|------|---------------------|------------------|
| 一个角色产出 | `N 块身体部件 × 8 方向` 静态图 | `M 个动作 × 8 方向 × F 帧` 动画条带 |
| 动画来源 | 引擎在运行时对各部件做 IK / 骨架插值 / 位置切换 | 美术手绘每一帧 |
| 新增动作 | 零成本（加一组关键姿态 pose.json，让引擎插值） | 重画 M×F 张图 |
| 方向成本 | 8 × N 张静态图，每块独立绘制不镜像 | 8 × M × F 张，且斜向方向独立重绘 |
| 武器/披风/背包 | 独立部件，可与角色解耦替换 | 绑定在整张图里，换武器就得重画所有帧 |
| 美术修改 | 改一块头 = 改 8 张小图 | 改头 = 重画所有动作所有方向所有帧 |

**本 Skill 不产出任何帧图、不产出任何精灵条带、不讨论帧数/帧率/循环/首尾连续**。这些属于已废弃范式。

---

## 1. 硬性约束（不可协商）

- **8 方向全部独立绘制**：禁止旋转生成、禁止镜像复用、禁止斜向复用水平/垂直。方向集合固定，角度以摄像机为基准（朝下为 0°，顺时针递增）：

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

- **每块部件 8 方向规格完全一致**：画布、轴心（挂点）、脚底基准线逐部件逐方向对齐。
- **不对称元素独立体现**：武器手、披风、单侧护甲、发型分缝在 8 方向下各自朝向正确，**不依赖翻转**。
- **一块部件一张图**：大模型**必须一次性直接生成该部件在该方向下的完整图**。禁止拼接多张小图。
- **CharacterLock 统一参考**：先生成一张角色整体 pose（基准方向），PIL 抠出存为 `keyframes/character_keyframe.png`，后续所有部件所有方向生成**必须显式带上这张图作参考**。

---

## 2. 身体分块清单（模板）

每个角色先填下面这张表，**确认分块后再进入生成**。字段 `slot` 是引擎挂点名，与代码常量一致：

| slot | 名称 | 典型内容 | 可独立替换 |
|------|------|---------|----------|
| `head` | 头 | 脸型、头发、眼镜、护目镜、头盔 | 发型/护目镜单独换 |
| `torso` | 躯干 | 夹克、工装、护甲主体 | 不独立换 |
| `upper_arm_L` | 左上臂 | 上臂 + 肩甲 | 不独立换 |
| `upper_arm_R` | 右上臂 | 上臂 + 肩甲 + **武器挂点** | 不独立换 |
| `forearm_L` | 左前臂 | 前臂 + 手套 | 不独立换 |
| `forearm_R` | 右前臂 | 前臂 + 手套 | 不独立换 |
| `weapon_R` | 右手武器 | 扳手 / 镐 / 枪 | ✅ 武器可换 |
| `weapon_L` | 左手武器 |  watering can / 盾 | ✅ 副手武器可换 |
| `hip_pack_L` | 左胯包 | 工具袋 | ✅ |
| `hip_pack_R` | 右胯包 | 不装东西时为空 | ✅ |
| `back_gear` | 背部装置 | 黄铜齿轮 + 铜管 | ✅ |
| `leg_L` | 左腿 | 裤腿 + 靴子 | 不独立换 |
| `leg_R` | 右腿 | 裤腿 + 靴子 | 不独立换 |
| `cape` | 披风（可选） | 披风本体 | ✅ |

**可独立替换部件**（`weapon_R / weapon_L / cape / back_gear / hip_pack_*`）在后续扩展时可单独增删，不影响角色主体。

**分块原则**：
- 边界在关节处（肩、肘、髋、膝），避免切到中间造成拼缝。
- 上层（头、上躯干、武器）遮挡下层（腿、前臂、胯包），Z 顺序固定：`back_gear → cape → leg → torso → hip_pack → forearm → upper_arm → weapon → head`。
- 每块图 **自身就是完整的独立精灵**，无需依赖其他块的透明区域即可单独预览。

---

## 3. 输入契约（生成前必须收集）

### 3.1 角色与风格
- 角色名 / 角色 ID
- 美术风格：像素风 / 手绘卡通 / 写实厚涂 / 矢量
- Don't Starve 风格关键特征：厚黑描边、平涂 cel shading、头大身小（头:身 ≈ 1:3.5）、黄铜/锈/深蓝调色板
- 抗锯齿：像素风必须关闭；其他按风格统一
- 颜色模式：sRGB（默认）
- **不对称特征清单**：持武器手、披风侧、单侧护甲、发型分缝——8 方向下逐方向确认朝向
- 部件清单确认（第 2 节模板）

### 3.2 视角与透视
- 摄像机视角：正俯视 / 斜 45° 等距 / 伪 3D 纵深（8 方向必须明确）
- 透视规则：各方向躯体压缩比、脚底与地面接触关系、斜向方向的透视缩短比例
- 基准方向：通常 E 或 S，其余 7 方向相对基准的角度与透视规则

### 3.3 画布与技术规格
- 每块部件**单独定画布**：按该部件所有方向的最大包围盒 + 安全边距（2–4 px）确定，不同 slot 画布可以不同
- 每个 slot 自己的挂点（anchor）：部件被挂到哪个位置（例如 `torso` 挂在脚底中心 `(0, footY)`，`head` 挂在 `torso` 顶部中心）
- 挂点坐标：每个 slot 的 anchor **全方向必须一致**（否则部件在方向切换时会跳）
- 脚底基准线 Y：`leg` 部件锚点，其他部件相对它定位
- 透明通道：必须
- 交付格式：PNG（单张静态图）+ manifest.json
- 过滤方式：像素风 Point/Nearest，手绘风按项目

---

## 4. 生成流程

### Step 0：先生成角色整体 pose（基准方向）→ 抠 character_keyframe

**不预生成独立正视图 ref**。先用 CharacterLock + ViewLock（基准方向，通常 E 或 S）生成一张**单帧完整角色姿态图**（不是动画），再从中抠角色参考。

**流程**：
1. CharacterLock + ViewLock(基准方向) + 站立姿态描述，**一次性生成一张完整角色静态图**
2. PIL 抠出角色 → 存为 `character_{id}/keyframes/character_keyframe.png`
3. manifest.json 记录 `characterKeyframe.path` + `characterKeyframe.hash`
4. 后续所有部件、所有方向生成**必须显式带上这张 keyframe 图作为参考**

**使用规则**：
- character_keyframe.png 只生成一次，锁定不可修改
- 若需改角色外观必须重新走完整流程

### Step 1：规格校验 + Prompt 模板锁定

#### 1.1 规格校验（进入生成前）
- 每个 slot 的画布、anchor 全方向一致
- 8 方向命名完整统一
- 部件边界在关节处
- CharacterLock 段一字不改
- **不通过打回，不进入生成**

#### 1.2 Prompt 三段拆分（强制）
所有大模型生图 prompt 必须拆为以下三段，**CharacterLock 段在所有批次中完全复用，一字不改**：

```
[CharacterLock —— 角色锁，全文复用]
{id} steam-punk engineer: adult male, short dark brown hair with left-side part, round wire-rimmed glasses, navy blue overalls with brass rivets, brown leather tool belt with tool pouch on LEFT hip, RIGHT hand holds metallic open-end wrench, copper pipes on right shoulder, brown leather work boots. Hand-painted digital art style, sRGB, soft anti-aliasing, transparent background.

[ViewLock —— 视角锁，仅改变方向描述]
Facing East (right, 90°, pure side profile).
// Facing South (facing camera, front view).
// Facing Southeast (45° isometric, half-front).
// ... 8 方向各自一条

[PartDesc —— 本次生成的部件描述]
Only the head slot: face, hair, glasses, goggles. No body, no arms, no legs. Painted on transparent background. Upper boundary just above hair, lower boundary at neck joint. Anchor at neck center.
```

### Step 2：逐部件逐方向独立生成（主流程）

**每个 slot 每个方向 → 一次 GenerateImage 调用 → 一张完整静态图**。不拼接。

**主流程 Prompt 模板**（以 head_SE 为例）：
```
[CharacterLock —— 全文复用，一字不改]
[ViewLock —— Facing Southeast, 45° isometric, half-front]

CRITICAL RULES — READ FIRST:
- Draw ONLY ONE SINGLE STATIC IMAGE of ONE BODY PART.
- NO numbered labels, NO frame numbers, NO circles, NO boxes, NO text, NO annotations, NO watermarks.
- Transparent background ONLY — no ground, no shadows, no scenery, no environment.
- Same scale, same art style, same outline thickness as the reference character_keyframe.

Part: head
Contents: spiky messy dark brown hair, brass aviator goggles on forehead, large round glasses, big hooked nose, stubble beard.
Cut boundary: upper edge above top hair, lower edge at neck joint (just below beard).
Anchor point at neck center (the point where head attaches to torso).
Facing Southeast means the face is in three-quarter view, nose and beard pointing toward the lower-right.
```

**Prompt 里必须显式禁止**：text / labels / watermarks / environment / 多帧。Seedream 等模型默认会加编号与场景，这是最严重的后处理问题。

### Step 3：8 方向独立展开
- 逐方向独立重绘，**禁止镜像翻转、禁止旋转裁剪**
- 每个方向单独用 Step 2 的方式生成自己的部件图
- 跨方向共享同一套 CharacterLock（保证角色一致性），ViewLock 改成对应方向
- 每完成一个方向做方向一致性检查：比例、描边粗细、anchor 位置、不对称元素朝向

### Step 4：部件拼接自检
- PIL 把 `torso + head + arms + legs + weapon` 按 Z 顺序拼到一起
- 拼完后与 character_keyframe 比较轮廓 SSIM（≥ 0.90 通过）
- 拼缝处无明显错位、无白边、无上下飘
- 跨方向切换时部件对齐稳定，不跳变

### Step 5：技术处理
- 透明背景、Alpha 预乘确认、无黑边
- 像素风关闭抗锯齿与 mipmap
- 导出 PNG + manifest.json

### Step 6：元数据
- 生成 manifest.json：角色 ID、ref 图路径与 hash、方向集合、每个 slot 的画布尺寸与 anchor、部件边界描述、Z 顺序
- 每个 slot 可选附一张 `anchor_marker.png`（仅用于人眼校验，不进运行时）

---

## 5. 质量门禁（QA Gate，逐项通过，任一失败打回）

### 5.1 8 方向专项门禁

| # | 检查项 | 通过标准 | 失败信号 / 反模式检测启发式 |
|---|--------|---------|---------------------------|
| D1 | 8 方向独立绘制 | 无旋转生成、无镜像复用、无斜向复用 | ① 某方向部件相对对称方向呈镜像（逐像素水平翻转相似度 > 0.95）；② 某方向可由相邻方向单应性变换得到 |
| D2 | anchor 全方向一致 | 同一 slot 的 anchor 像素坐标 8 方向完全一致 | 任一方向 anchor 差 1 px 以上 |
| D3 | 斜向透视正确 | 无旋转锯齿、无比例失真 | 斜向肢体细长/压扁超出设定压缩比 ±10%；边缘出现旋转锯齿 |
| D4 | 不对称元素朝向 | 武器手、披风、单侧装饰 8 方向各自朝向正确 | 持武器手在 S/SE/E/NE 四方向都出现在画面同一侧（应随方向切换） |
| D5 | 方向切换对齐 | 相邻方向切换部件整体对齐稳定 | 连续方向整体轮廓相似度跳变 > 阈值 |

### 5.2 部件专项门禁

| # | 检查项 | 通过标准 |
|---|--------|---------|
| P1 | 边界在关节处 | 部件切分不穿透肌肉/骨骼，关节处留白 2–3 px 避免拼缝 |
| P2 | 上层遮挡关系正确 | `back_gear` 在最下、`weapon/head` 在最上，Z 顺序符合第 2 节模板 |
| P3 | 单部件无多余内容 | 生成 head 时只有头，不夹带躯干/武器 |
| P4 | 单部件无缺漏 | 所有声明 slot 在 8 方向都有文件 |
| P5 | 跨 slot 风格一致 | 描边粗细、配色、cel shading 风格一致 |
| P6 | 拼接无跳变 | 拼接后整体轮廓与 character_keyframe SSIM ≥ 0.90 |

### 5.3 通用门禁

| # | 检查项 | 通过标准 |
|---|--------|---------|
| G1 | 透明干净 | 透明背景无黑边/白边 |
| G2 | 命名统一 | 目录：`{slot}/{dir}.png`；dir 固定 8 值 |
| G3 | manifest 一致 | manifest 声明与实际文件一一对应 |
| G4 | 画布合理 | 每个 slot 画布按该部件 8 方向最大包围盒定，无多余 1024px 空白 |

### 5.4 大模型生成专项门禁

| # | 检查项 | 通过标准 | 失败信号 |
|---|--------|---------|---------|
| A1 | character_keyframe 存在 | `keyframes/character_keyframe.png` 存在且 manifest 中 `characterKeyframe.hash` 匹配 | 缺 keyframe；keyframe 不是从基准方向 pose 抠出 |
| A2 | CharacterLock 一致 | 所有批次 prompt 的 CharacterLock 段完全相同（一字不差） | 不同批次 prompt 出现描述差异 |
| A3 | 跨部件角色一致 | 不同 slot 拼回的完整角色与 keyframe 特征相似度 ≥ 0.9 | 头长不像 keyframe 的头、躯干配色漂移 |
| A4 | 无文本水印 | 图内无文字、无编号、无 watermark | OCR 检出 |

---

## 6. 命名与文件组织

```
character_{id}/
├── manifest.json
├── keyframes/
│   └── character_keyframe.png   ← 基准方向完整角色 pose 抠出，所有部件所有方向共享的角色参考
└── parts/                       ← 每类部件一个子目录
    ├── head/
    │   ├── S.png   SE.png   E.png   NE.png   N.png   NW.png   W.png   SW.png
    │   └── manifest.json        ← 本 slot 的 canvas、anchor、Z 顺序
    ├── torso/
    │   └── ...
    ├── upper_arm_R/
    │   └── ...
    ├── weapon_R/
    │   └── ...
    └── ...
```

- 目录**保持最简**：只保留 manifest + keyframes + parts 三层。不生成 `sheets/`、`source/`、`preview/`、`qa/` 等冗余目录
- `dir` 固定 8 值：S / SE / E / NE / N / NW / W / SW
- 禁止任何方向缺失或复用其他方向文件

**与已废弃范式对比**：
```
# 已废弃（帧动画）
character_{id}/
├── keyframes/character_keyframe.png
└── sheets/
    ├── {id}_walk_S_sheet.png     ← 8 帧横向条带
    ├── {id}_walk_SE_sheet.png
    └── ...

# 本 Skill（身体分块）
character_{id}/
├── keyframes/character_keyframe.png
└── parts/
    ├── head/S.png SE.png ...
    ├── torso/S.png SE.png ...
    └── weapon_R/S.png SE.png ...
```

---

## 7. 预期生成产物（完整描述）

### 7.1 产物总览
一次完整生成产出一套角色的 **8 方向身体分块资源包**：N 块部件 × 8 方向静态 PNG、manifest 清单、拼接自检结果。所有产物围绕同一个角色 ID 组织，目录结构固定。

### 7.2 manifest.json（最小模板）
```jsonc
{
  "characterId": "engineer_spanner",
  "style": "don_t_starve_hand_drawn_steam_punk",
  "characterKeyframe": {
    "path": "keyframes/character_keyframe.png",
    "hash": "sha256:abcd..."
  },
  "directions": ["S","SE","E","NE","N","NW","W","SW"],
  "footBaselineY": 950,
  "colorMode": "sRGB",
  "antialias": true,
  "zOrder": [
    "back_gear", "cape",
    "leg_L", "leg_R",
    "torso",
    "hip_pack_L", "hip_pack_R",
    "forearm_L", "forearm_R",
    "upper_arm_L", "upper_arm_R",
    "weapon_L", "weapon_R",
    "head"
  ],
  "parts": {
    "head": {
      "canvas": { "w": 512, "h": 512 },
      "anchor": { "x": 256, "y": 480 },   // 挂在脖子中心，相对该部件画布
      "cutBoundary": "neck joint",
      "replaceable": false
    },
    "weapon_R": {
      "canvas": { "w": 384, "h": 384 },
      "anchor": { "x": 60, "y": 340 },    // 挂在右上臂挂点
      "replaceable": true,
      "slot": "weapon"
    }
    // ... 其他 part
  }
}
```

### 7.3 拼接自检产物（CSV 示例）

| part | dir | anchor 一致 | 画布合理 | 无镜像复用 | 拼接轮廓 SSIM | 检查结论 |
|------|-----|------------|---------|----------|--------------|---------|
| head | S   | ✓          | ✓       | ✓        | 0.96         | 通过    |
| head | SE  | ✓          | ✓       | ✓        | 0.94         | 通过    |
| ...  | ... | ...        | ...     | ...      | ...          | ...     |

- 拼接自检是 8 方向高质量交付的**验收凭证**，缺失即视为交付不完整

### 7.4 产物验收标准（必须同时满足）
1. 所有声明 slot 在 8 方向目录齐全，无缺失、无复用、无旋转生成、无镜像
2. 同一 slot 的 anchor 8 方向像素坐标一致
3. 拼接成完整角色后，跨方向切换对齐稳定
4. 斜向方向透视正确，不对称元素朝向正确
5. manifest 与实际文件完全对应
6. 拼接自检 CSV 填写完整

### 7.5 产物边界说明（非此即打回）
本 Skill **不产出**：
- 任何帧图、任何动画条带、任何 action 目录
- 多方向之外的翻转复用版本
- 旋转生成的中间图
- 未在部件清单声明的 slot

---

## 8. 交付物清单

| # | 交付物 | 必交/可选 | 说明 |
|---|--------|----------|------|
| 1 | 每 slot 8 方向 PNG | 必交 | `parts/{slot}/{dir}.png` |
| 2 | manifest.json | 必交 | 第 7.2 节模板 |
| 3 | 拼接自检 CSV | 必交 | 第 7.3 节格式 |
| 4 | 源文件（PSD/Aseprite/工程） | 可选 | 保留分层信息 |

---

## 9. 反模式清单（打回规则）

| # | 反模式 | 根因 | 处置 |
|---|--------|------|------|
| R1 | 旋转生成斜向部件 | 斜向由正方向旋转 45° 得来 | 直接打回，逐方向独立重绘 |
| R2 | 镜像复用左右方向 | W = 水平翻转 E；NW = 翻转 NE | 直接打回，独立重绘 |
| R3 | 斜向复用水平/垂直方向 | SE 复用 E 或 S | 直接打回，独立重绘 |
| R4 | anchor 跨方向不一致 | 方向切换时部件上下跳 | 打回重做该 slot |
| R5 | 部件边界穿透关节 | head 把肩膀也画进来、forearm 包含上臂 | 重新切分 |
| R6 | 一个 slot 夹带其他 slot 内容 | 生成 head 时夹带 torso | 重绘该部件 |
| R7 | 画布过大浪费 | 小部件用 1024×1024 图 | 重定画布 |
| R8 | 跨批次 CharacterLock prompt 不一致 | 不同部件用了不同版本的角色描述词 | 锁定 CharacterLock，重做 |

---

## 10. 管线自动化检查建议

以下门禁项可转为**脚本化自动检查**：

| 脚本可检项 | 方法 |
|-----------|------|
| anchor 全方向一致 | PIL 读取各 slot 的 manifest.json `anchor` 字段 diff |
| 命名正则 | 正则 `^parts/{slot}/(S|SE|E|NE|N|NW|W|SW)\.png$` |
| manifest ↔ 文件 | glob 文件列表 vs manifest.parts 差集 |
| 无镜像复用 | 对称方向部件与其水平翻转的 MSE 应明显高于两个独立方向间的 MSE |
| 无旋转生成 | 单应性匹配 + 边缘锯齿检测 |
| 透明无黑边 | 检查 alpha<255 区域的 RGB 是否接近黑色 |
| 拼接轮廓 SSIM | PIL 按 Z 顺序粘贴后，与 character_keyframe 计算 SSIM |
| 跨部件风格一致 | 描边粗细 / 主色 k-means 聚类一致度 |

---

## 11. 使用方式

- **Agent Skill**：第 2–3 节填表，第 4–5 节生成与校验，第 9 节打回规则
- **外包需求书**：第 2–3 节填表 + 第 5 节门禁 + 第 7–8 节产物与交付物直接发美术
- **管线脚本**：第 5 节门禁 + 第 10 节建议转自动化
- **代码审查基线**：任何 sprite 相关 PR 必须附拼接自检 CSV（第 7.3 节）作为验收凭证
- **与已废弃帧动画的关系**：已废弃的 `build_atlas.py`、帧条带、帧率、循环、首尾连续等全部不再使用。引擎侧改用 `CharacterAssembler` 组件，在运行时按 Z 顺序把部件贴到一起

---

## 12. 何时回到帧动画（极少数特例）

只有两类东西**必须用帧动画**、不适合身体分块：
1. **整角色特效**：整个角色爆炸、传送门消失、被抓进箱子——此时部件概念不适用
2. **粒子发射器挂点**：虽然粒子是独立系统，但挂在哪个身体部位上需要在代码里用 slot 名字绑定（与本 Skill 的 slot 命名一致）

这两类属于 FX 范畴，单独交付，不替换身体分块主流程。
