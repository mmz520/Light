# 饥荒风格 2D 生存游戏重构计划（Vite + React + TS）

> 目标：把现有单文件 `index.html`（全局脚本式 three.js，约 2360 行）重构为 **Vite + React 18 + TypeScript** 的**面向对象分层架构**，消除"改一处 three.js 逻辑就踩回旧坑"的问题。
> 本文按**组件（类）**为单位列出封装计划，是后续实施的唯一基线。

---

## 1. 现状盘点

| 项 | 现状 |
|---|---|
| 入口 | `index.html` 单文件，内联 `<script type="module">`，无构建工具、无类型 | 
| three.js | 本地 `vendor/three.module.js`，裸 `import`，无 npm 依赖管理 |
| 全局状态 | `scene / camera / renderer / keys / gameState / playerData / cells / drops / threats / queue / projectiles` 全部模块级变量（`index.html:L467-L505`） |
| 渲染 | 角色用 `THREE.Sprite` 广告牌 + `texture.offset/repeat` 切帧（`L1099-L1159`），另有 Canvas2D 降级渲染器（`L681-L760`） |
| 玩法 | 格子世界、资源采集、掉落稀有度、建造（篝火/工作台）、合成队列、威胁刷怪、攻击判定、背包/小地图、昼夜光照、迷雾、移动端摇杆 |
| 美术 | 旧图 `player_walk.png / player_action.png / enemy1.png / enemy2.png`（由 `tools/build_sprites.py` 用镜像补齐 6→8 方向，**违反 Skill 反模式 R2**） |
| 新资源 | `sprite_ani/character_engineer_spanner/`：idle 8 方向全齐（8192×1024 PNG）、walk 4/8 方向（E/W/S/N，jpg）、attack 0 张、keyframe 已抠出 |

### 现有代码的主要问题
1. 无模块边界：UI、渲染、玩法、资源加载混在一个文件，改动画必碰渲染。
2. 状态散落：玩家/敌人/AI 状态用字符串 + 布尔标记，切换逻辑散在 `animate()`（`L1998-L2360`，约 360 行单函数）。
3. 资源后处理违规：旧资源用镜像/复用来凑 8 方向，角色一致性差，重生成时必然返工。
4. 无法测试：所有逻辑依赖 `document` 与全局 `scene`。

---

## 2. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 构建 | Vite 5 | 快、原生 TS、`public/` 静态资源、HMR |
| UI | React 18 + TS strict | 仅负责 HUD/菜单；**不进入每帧循环** |
| 3D/2D 渲染 | three.js（npm `three` + `@types/three`） | 延续现有 Sprite 广告牌方案，避免美术资源重做 |
| 状态桥 | 自研 `EventBus` + `useGameStore`（订阅式，10Hz 节流） | 规避"每帧 setState 触发 React 重渲染"这一旧坑 |
| 样式 | CSS Modules | 迁移现有内联样式，零新依赖 |
| 测试 | Vitest（纯逻辑层） | 帧索引/方向映射/伤害结算可回归 |
| 资源管线 | Python(Pillow) 脚本 | 大图 → 裁帧 → 去底 → 打图集 → JSON |

---

## 3. 目录与分层

```
public/assets/
  atlas/{charId}_{action}.png        # 运行时图集：列=帧，行=8方向
  atlas/{charId}_{action}.json      # 帧数据（w/h/fps/loop/anchor/事件帧）
  manifest.json                     # 角色清单（角色→动作→方向→clip）
sprite_ani/                         # 生成源图（不进 public，体积大）
tools/
  build_atlas.py                    # 源精灵表 → 运行时图集
  check_sprites.py                  # 动画门禁（帧数/方向/尺寸/baseline）
src/
  main.tsx  App.tsx
  game/
    core/        Game / GameLoop / EventBus / AssetLoader / GameTime / ServiceLocator
    world/       World / Terrain / WorldGrid / FogOfWar / DayNightCycle / CameraRig
    world/objects/ WorldObject / ResourceNode / Campfire / Structure / Drop / Projectile
    entities/    Entity / Component / Actor / Player / Enemy / Hound
    entities/components/ Health / Motion / Collider / Combat / Inventory / Brain
    animation/   SpriteSheet / AnimationClip / AnimationBank / AnimationController / DirectionMapper
    render/      RenderSystem / ActorSprite / DepthSorter / DebugOverlay
    systems/     InputSystem / MovementSystem / AISystem / CombatSystem / InteractionSystem / SpawnSystem
  ui/
    GameCanvas.tsx  Hud.tsx  HealthBar.tsx  InventoryPanel.tsx  CraftPanel.tsx
    Minimap.tsx  TouchControls.tsx  LoadingScreen.tsx  useGameStore.ts
```

**依赖方向（单向，禁止反向 import）**

```
ui → game/core → systems → entities/world → animation/render → three
```

实体层**不得**直接 `import three`，唯一例外：`ActorSprite`、`Terrain`、`CameraRig`（渲染适配层）。

---

## 4. 组件封装计划（按组件）

### 4.1 core（引擎骨架）

| 类 | 职责 | 关键接口 | 依赖 |
|---|---|---|---|
| `Game` | 总装配与生命周期；创建 renderer/scene/camera，注册 systems，`start/pause/resume/dispose` | `ctor(canvas, assets)`、`update(dt)`、`render()`、`services` | 全部 |
| `GameLoop` | rAF + 固定步长（1/60 逻辑 tick）+ 渲染；`dt` 上限裁剪（切标签页回来不瞬移） | `start(cb)`、`stop()` | — |
| `EventBus` | 类型化事件总线（`TypedEvents` 映射，编译期校验） | `on/off/emit/once` | — |
| `AssetLoader` | Promise 化加载 image/json；统一 `sRGB + Nearest + ClampToEdge`；进度回调 | `loadImage(url)`、`loadJSON(url)`、`onProgress` | — |
| `GameTime` | 游戏内时间、昼夜相位 | `phase`、`dayIndex`、`tick(dt)` | — |
| `ServiceLocator` | 依赖注入容器（构造注入，替代全局变量） | `register/resolve` | — |

### 4.2 world（场景）

| 类 | 职责 | 关键接口 | 依赖 |
|---|---|---|---|
| `World` | 实体根容器；增删查、空间网格索引、按 y 排序输出渲染列表 | `add/remove/query(rect)`、`entities` | 实体基类 |
| `Terrain` | 地面 mesh、世界尺寸、世界↔格子坐标换算（单点实现，杜绝各处魔法数） | `worldToGrid/ gridToWorld`、`bounds` | three |
| `WorldGrid` | 格子划分、资源点注册、邻近查询 | `cellAt(x,z)`、`neighbors()` | — |
| `FogOfWar` | 探索遮罩、可见区域更新 | `reveal(pos,r)`、`isVisible` | — |
| `DayNightCycle` | 环境光/方向光/雾随 `GameTime.phase` 插值 | `update(phase)` | three |
| `CameraRig` | 跟随目标 + 阻尼平滑 + 边界夹取 + 屏幕震动 | `follow(target)`、`shake(amp)`、`update(dt)` | three |

### 4.3 world/objects（场景上的组件）

统一基类 `WorldObject`：`position` / `radius` / `interactable` / `update(dt)` / `dispose()`。

| 类 | 职责 |
|---|---|
| `ResourceNode`（抽象） | 资源点基类：hp、掉落表、被采集反馈 |
| `TreeNode` / `RockNode` / `BushNode` | 继承 `ResourceNode`，各自掉落与采集动画 |
| `Campfire` | 燃烧计时、光照半径衰减、添柴加时 |
| `Structure` | 建造物通用基类（工作台/墙/箱子） |
| `Drop` | 地面掉落物（拾取半径、浮动动画） |
| `Projectile` | 远程投射物（直线飞行、命中回调） |

### 4.4 entities（角色 / 怪物）

| 类 | 职责 | 关键接口 |
|---|---|---|
| `Entity` | 基类：id、transform、组件容器、`alive`、`update/dispose` | `addComponent/getComponent` |
| `Component` | 组件基类：`attach(entity)/update(dt)/detach()` | — |
| `Actor extends Entity` | 可动生物：状态机 + 动画控制器 + 8 方向朝向 | `setState()`、`face(dir)` |
| `Player extends Actor` | 输入意图→状态；交互（采集/建造/拾取/使用道具） | `applyIntent(intent)` |
| `Enemy extends Actor` | 通用敌对生物：仇恨目标、受击、死亡掉落 | `setTarget(entity)` |
| `Hound extends Enemy` | 敌人实现：巡逻→追击→攻击→撤退 的 FSM 行为 | — |

**组件池（可复用于 Player 与 Enemy）**

| 组件 | 职责 |
|---|---|
| `HealthComponent` | hp/maxHp、`damage()`、无敌帧、`died` 事件 |
| `MotionComponent` | 速度/加速度/摩擦/朝向向量（纯数据 + 积分） |
| `ColliderComponent` | 半径、碰撞图层、与地形边界/实体推挤 |
| `CombatComponent` | 攻击范围/伤害/冷却，**由动画事件帧触发结算** |
| `InventoryComponent` | 背包槽位、增减、堆叠 |
| `BrainComponent` | AI 决策接口，策略可替换（巡逻/追击/逃跑） |

### 4.5 animation（动画，唯一入口）

| 类 | 职责 |
|---|---|
| `SpriteSheet` | 加载 manifest + 图集，算出帧宽高/列行/8 方向行索引 |
| `AnimationClip` | 一个动作的元数据：帧数、fps、loop、事件帧（如 attack 第 3 帧结算） |
| `DirectionMapper` | 世界方向向量 → 8 方向索引（含相机朝向补偿），**全项目唯一实现** |
| `AnimationController` | 播放/切换/中断；同状态不重入（避免重置帧）；派发动画事件 |
| `AnimationBank` | 角色 → 动作 → 方向 → clip 注册表；预加载与校验 |

### 4.6 render

| 类 | 职责 |
|---|---|
| `ActorSprite` | **唯一接触 three 的实体适配器**：Sprite/SpriteMaterial、UV 更新、贴地缩放、阴影 |
| `RenderSystem` | 每帧：更新相机 → y-sort → 更新 sprite UV/位置 → 光照 → `renderer.render` |
| `DepthSorter` | 透明精灵正确遮挡（`depthWrite=false` + 按 y 排序） |
| `DebugOverlay` | 显示碰撞圈/状态/帧号（开发期） |

### 4.7 systems

| 系统 | 顺序 | 职责 |
|---|---|---|
| `InputSystem` | 1 | 键鼠/触摸 → `InputSnapshot`（移动向量、动作位）；`blur` 清空按键 |
| `AISystem` | 2 | 驱动 `BrainComponent`，产出意图 |
| `MovementSystem` | 3 | 积分位移、边界夹取、实体推挤、更新 8 方向朝向 |
| `CombatSystem` | 4 | 消费动画事件 → 命中判定、伤害、击退、死亡 |
| `InteractionSystem` | 5 | 最近可交互对象、采集/建造/拾取/使用 |
| `SpawnSystem` | 6 | 按昼夜与威胁度刷新敌人、清理死亡实体 |
| `RenderSystem` | 7 | 见上 |

### 4.8 ui（React，只读）

| 组件 | 职责 |
|---|---|
| `GameCanvas` | 挂载 `Game`，卸载时 `dispose()`（防 HMR 内存泄漏/重复 canvas） |
| `useGameStore` | `EventBus` → 外部 store（`useSyncExternalStore`），**10Hz 节流** |
| `Hud` | 血量/饥饿/时间/天数 |
| `InventoryPanel` / `CraftPanel` | 背包与合成（对应现有 `updateInvPanel`、`queue`） |
| `Minimap` | Canvas 2D 小地图（对应 `updateMinimap`） |
| `TouchControls` | 摇杆 + 动作键（对应 `setupMobile`） |
| `LoadingScreen` | `AssetLoader.onProgress` |

---

## 5. 动画规范（参考《饥荒》）

### 5.1 动作清单

| 角色 | 动作 | 帧数 | FPS | 循环 | 说明 |
|---|---|---|---|---|---|
| 工程师（主角） | `idle` | 8 | 10 | 是 | 呼吸+扳手轻晃（已有 8 方向） |
| | `walk` | 8 | 12 | 是 | 基础移动（E/W/S/N 已有，其余待补） |
| | `run` | 6 | 15 | 是 | 疾跑（饥荒跑步姿态：前倾、大摆臂） |
| | `attack` | 6 | 18 | 否 | 扳手挥击，**第 3 帧判定** |
| | `hit` | 3 | 20 | 否 | 受击后仰 + 闪红 |
| | `death` | 8 | 10 | 否 | 倒地，末帧保持 |
| | `work` | 6 | 12 | 否 | 砍/敲（饥荒 chop），**第 4 帧判定** |
| 猎犬（敌人） | `idle` | 6 | 8 | 是 | 低吼待机 |
| | `run` | 8 | 14 | 是 | 四足奔跑 |
| | `attack` | 5 | 16 | 否 | 扑咬，**第 3 帧判定** |
| | `hit` | 3 | 20 | 否 | 受击退缩 |
| | `death` | 6 | 10 | 否 | 倒地消散 |

> 全部 **8 方向独立绘制**（Skill 硬约束），禁止镜像/旋转复用。合计：工程师 `7×8=56` 张，猎犬 `5×8=40` 张。

### 5.2 运行时动画数据流

```
InputSystem → Intent → ActorStateMachine → AnimationController.play(clip, dir)
                                            ↓ 事件帧
                                     CombatSystem.resolveHit()
ActorSprite.update(clip, frame, dir) → Texture.offset/repeat
```

### 5.3 资源管线（解决体积问题）

源图 8192×1024、96 张原始表 ≈ 上百 MB，**不可直接上 web**。必须经 `tools/build_atlas.py`：
1. 按帧宽 = `width / N` 切帧 → 2. 去底（近白/近透明→透明）→ 3. 统一裁到 512×512（脚底锚点对齐）→ 4. 8 方向为行、帧为列重排 → 5. 导出 PNG 图集 + JSON（帧宽高、fps、loop、事件帧、anchor）。
预期单动作图集 ≈ 4096×4096 内，浏览器可承受。

---

## 6. 分阶段工作计划

| 阶段 | 内容 | 交付物 | 验收 |
|---|---|---|---|
| **P0 规格冻结** | 确认动作清单、画布/锚点/帧率常量；写 `public/assets/manifest.json` 结构 | `PLAN.md` 定稿、manifest 模板 | 动作表与目录约定签字确认 |
| **P1 脚手架** | `vite + react-ts` 初始化，路径别名 `@/`，ESLint/Prettier，`three` 依赖，空场景跑通 | 可 `npm run dev` 的工程 | 页面渲染空场景无报错、HMR 正常 |
| **P2 引擎骨架** | `Game / GameLoop / EventBus / AssetLoader / CameraRig / RenderSystem / InputSystem` | 固定步长循环 + 相机跟随 + 空白地面 | 60fps、窗口缩放无变形、切标签页不瞬移 |
| **P3 角色渲染** | `SpriteSheet / AnimationBank / DirectionMapper / AnimationController / ActorSprite`；接入工程师 idle 8 方向 | 8 方向 idle 可切换播放 | 8 方向无错帧/无串行、脚底不漂移 |
| **P4 移动与状态机** | `Motion / Collider / ActorStateMachine / MovementSystem`；键盘+摇杆；idle↔walk↔run | 可操控角色移动 | 动画与位移速度匹配（无滑步）、方向切换平滑 |
| **P5 敌人** | `Enemy / Hound / BrainComponent / Health / Combat / CombatSystem / AISystem`；动画事件判定 | 猎犬巡逻→追击→攻击→受击→死亡 | 伤害只在事件帧生效；死亡走完整动画 |
| **P6 场景组件** | `Terrain / WorldGrid / FogOfWar / DayNightCycle / ResourceNode(Tree/Rock/Bush) / Campfire / Structure / Drop / Projectile` | 可采集、可建造、昼夜/迷雾 | 每个组件独立 `update()`，可单独开关 |
| **P7 UI 迁移** | `GameCanvas / useGameStore / Hud / InventoryPanel / CraftPanel / Minimap / TouchControls / LoadingScreen` | React HUD 全量替换内联 UI | 每帧不触发 React 重渲染（DevTools 验证） |
| **P8 资产生成** | 补齐工程师 `walk` 剩余 4 方向、`run/attack/hit/death/work` 全 8 方向；生成猎犬全动作；跑 `build_atlas.py` | 96 张源表 → 运行时图集 + manifest | 每动作图集帧数/方向/锚点校验通过 |
| **P9 门禁与收尾** | `tools/check_sprites.py`（帧数/方向/尺寸/baseline/首尾帧差异）、性能分析、`npm run build` | 校验报告、构建产物、README 使用说明 | 全门禁绿灯 + 生产构建可运行 |

> 顺序原则：**先容器后内容**（P2 骨架 → P3 角色 → P5 敌人 → P6 场景），任一阶段未过验收不进入下一阶段。

---

## 7. 已知坑位与护栏（针对"重走旧错"）

| # | 旧坑 | 护栏设计 |
|---|---|---|
| 1 | UV `offset/repeat` 算错 → 串帧/黑格 | 全部收敛到 `ActorSprite.updateFrame()`，加 Vitest 快照 |
| 2 | 8 方向索引与贴图行序不一致 | `DirectionMapper` 唯一实现 + 映射表常量 + 单测 |
| 3 | Sprite 世界尺寸与像素比例错 → 角色大小跳变 | `Terrain` 提供唯一 `pixelsPerUnit`，禁止各处写魔法数 |
| 4 | 相机跟随抖动/透视贴地错位 | `CameraRig` 固定步长 + 阻尼；正交相机替代透视（可选） |
| 5 | 半透明精灵遮挡错误 | `depthWrite=false` + `alphaTest` + `DepthSorter` 按 y 排序 |
| 6 | 每帧 `setState` → React 卡顿 | EventBus + `useGameStore` 10Hz 节流 |
| 7 | 资源路径大小写/相对路径在构建后 404 | 资源统一放 `public/`，`base: './'`，路径常量集中 |
| 8 | 切出窗口后按键卡住、回来瞬移 | `blur/visibilitychange` 清空输入；`dt` 上限 0.1s |
| 9 | 攻击判定与动画不同步 | 判定只由 `AnimationClip.eventFrames` 触发 |
| 10 | 状态机切换重置动画 → 抽搐 | 同状态不重入；切换保留 0.1s 混合窗口 |
| 11 | 旧资源镜像凑 8 方向 → 返工 | 生成阶段强制 8 方向独立（Skill 反模式 R2 门禁） |
| 12 | 单文件 2360 行 `animate()` | 拆为 7 个 System，单函数 ≤ 80 行；超出即拆分 |
| 13 | HMR 重复创建 canvas/泄漏 | `GameCanvas` 卸载 `dispose()` + `renderer.dispose()` |
| 14 | 大图集内存溢出（8192px） | 图集裁到 512/帧 + 单动作一张图 + 按需加载 |

---

## 8. 角色设计（饥荒风格）

**主角：蒸汽朋克工程师**
- 手绘描边（粗黑墨线）+ 赛璐璐平涂，低饱和棕/橙/灰；头大身短（1:3.5 比例）
- 额顶黄铜护目镜、右肩铜管、背部黄铜齿轮；右手银色呆扳手、左手黄铜洒水壶
- 深蓝背带工装裤 + 棕色皮夹克 + 皮质工具腰带（左胯工具包）
- 状态：`idle / walk / run / attack / hit / death / work`

**敌人：锈蚀猎犬（Rust Hound）**
- 延续饥荒猎犬轮廓：瘦长四足、背部骨刺、獠牙外露
- 蒸汽朋克化：颈部黄铜项圈、背部铆接铜板、关节外露齿轮、口中喷薄蒸汽
- 配色：锈红 + 铜绿 + 暗褐，与主角同色系但更脏更暗
- 状态：`idle / run / attack / hit / death`

---

## 9. 已确认的取舍（2026-10-29 定稿）

1. **迁移范围**：分阶段全量迁移（P1→P9），旧 `index.html` 迁入 `legacy/` 仅作参考，不再维护。
2. **动画规模**：全量 7+5 动作，共 96 张精灵表（工程师 56 + 猎犬 40）。
3. **敌人造型**：锈蚀猎犬（饥荒猎犬轮廓 + 蒸汽朋克黄铜/齿轮改造）。
4. **资产策略**：旧根目录贴图（`player_walk.png` 等镜像凑 8 方向的产物）**全部弃用**，只使用 `sprite_ani/` 下 8 方向独立生成的资产。

---

## 10. 执行进度（持续更新）

| 阶段 | 状态 | 备注 |
|---|---|---|
| P0 规格冻结 | ✅ 完成 | 动作清单/尺寸/锚点/manifest 结构已落地 |
| P1 脚手架 | ✅ 完成 | Vite5 + React18 + TS strict，`npm run dev` 可跑 |
| P2 引擎骨架 | ✅ 完成 | 固定步长循环 / EventBus / AssetLoader / CameraRig / RenderSystem / InputSystem |
| P3 角色渲染 | ✅ 完成 | 工程师 idle 8 方向，帧→UV 只在 `ActorSprite` |
| P4 移动与状态机 | ✅ 完成 | WASD+Shift 移动、idle↔walk 切换、8 方向朝向（无头 Chrome 实测 60fps） |
| P5 敌人 | 待开始 | 依赖锈蚀猎犬资产 |
| P6 场景组件 | 待开始 | — |
| P7 UI 迁移 | 待开始 | 目前只有调试 HUD |
| P8 资产生成 | 进行中 | 工程师 idle 8/8、walk 8/8 已完成；run/attack/hit/death/work 0；猎犬 0 |
| P9 门禁与收尾 | 待开始 | — |

### 已验证事实（无头 Chrome + Vite dev）
- 页面 1280×800、稳定 60fps，控制台无 error/warning
- 按 D → `动作 walk / 方向 E`；按 W → `动作 walk / 方向 N`；坐标持续变化
- 角色透明背景干净（棋盘格已去除），脚底贴地、阴影正确
- 已知待办：`attack` 动作尚未生成，空格暂时不会切换动画

### 资产生成约定（复用，勿改）
- `image_size`：8 帧 `8192x1024`；6 帧 `6144x1024`；5 帧 `5120x1024`；3 帧 `3072x1024`（总像素须 ≥ 3,686,400）
- 通图 Prompt 首句固定为：`CRITICAL: NO numbered labels, NO frame numbers, NO circles, NO boxes, NO text, NO annotations, NO watermarks.`
- CharacterLock 全文复用，8 方向各自 WriteLock 描述独立重绘，禁止镜像/旋转
- GenerateImage 输出恒为 `.jpg`，落盘后需 `build_atlas.py` 统一去底（含模型画出的棋盘格底）
