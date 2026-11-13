# Light 项目上下文（跨任务记忆 / 2026-11-12 整理）

> 用途：在其他任务/会话中快速恢复本项目上下文。更细的改动史见同目录 `2026-10-30.md` ~ `2026-11-05.md` 日志。

## 1. 项目概况

- 路径 `E:/Projects/Web/Light`，类饥荒生存游戏编辑器（动画/世界/数据），React 18 + Vite 5 + TypeScript + three.js 0.160，Electron 桌面端。
- npm scripts：`dev`（Electron 桌面）、`dev:web`（vite :5173）、`build`、`selftest`、`typecheck`；验证用 `npm run shot`（内置 puppeteer 全量自检截图）。
- 顶层散放的 `arm.png / head.png / leg.png / torso.png` 是用户手工素材。

## 2. 目录结构（当前）

- `src/animator/` —— 2.5D 角色动画编辑器（详见 §3）
- `src/game/` —— 游戏运行时（core/Game、render/ActorSprite、animation/AnimationBank、entities、world、systems）
- `src/editor/` —— 编辑器主体：`EditorApp.tsx` + `model/`（store/folders 等）+ `ui/`（SceneView/Inspector/AssetBrowser/AssetPicker/MinimapCanvas 等）
- `src/runtime/` —— 场景运行时与脚本系统（sceneRuntime.ts、scripts.ts）
- `src/platform/desk.ts`、`src/shared/ipc.ts`、`electron/`（13 个 ts，含 lib/protocol.ts、lib/verify.ts 自检脚本）
- 资源：`public/assets/sprites/manifest.json`（v4，唯一真实数据源）+ role/enemy/equipment/overlays 子目录；`public/animations/engineer_spanner_anim.json`（动画编辑器启动自动加载）
- 工具：`tools/build_sprites.py`、`tools/build_animations.mjs`；生图 skill：`.trae/skills/sprite-8dir-anim/`（SKILL.md + templates.json，怪物纸娃娃范式、humanoid10/5、beast5、custom 模板）

## 3. 动画编辑器（src/animator）要点

- 数据模型：`AnimatorProject{version:2, targetId, fps, directions:Record<'S'|'E'|'N'|'W', DirectionEntry>}`；`PartDef{id,label,parent,texturePath,layout?,zIndex,overlay?}`；`PartPose{x,y,z,rot,rotX,rotY,scale,scaleX,scaleY}`；`OverlayDef`（zIndex 缺省=节点 zIndex+0.1）。
- 局部动画（Clip.localAnims）：帧图型 `kind:'frames'`（时长=帧数/fps）与关键帧型 `kind:'keys'`；循环型不在刻度条显示，非循环型显示色块可拖 start，关键帧型显示黄菱形。辅助 `localAnimDuration()` / `sampleLocalAnims()`；激活期间帧图型走 Viewport3D 的 `frameOverrides` 换 mesh 贴图，关键帧型经 `routePoseChange` 把 gizmo 修改写入局部关键帧。
- Viewport3D：每 part 一个 THREE.Group 按 parent 挂层级；`renderOrder = part.zIndex`（mesh）、overlay 独立；材质 `transparent+depthTest:false`，靠 renderOrder 排序；贴图就绪后按真实宽高比修 mesh 宽度；左侧纵向工具栏第一项为覆盖物显隐开关。调试句柄 `window.__viewport`（nodes Map 含 mesh.renderOrder）。
- Timeline：左栏 236px、红线右键菜单复制/粘贴帧、吸附下拉；`sortedParts` 按 zIndex 排序。
- 历史：`useHistory.ts` 快照栈（上限 120、mergeKey 合并连续操作：`pose:<partId>` / `kf:<partId>` / `lk:<id>` / `la:<id>`），Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y。
- 调试句柄：`window.__animator = { project, activeDir, activeClipName, images, seek(clip,t,dir), undo, redo, canUndo, canRedo }`。

## 4. 已验证结论（勿重复验证）

- **zIndex 链路是通的**：面板输入 → `updatePart` → parts 重建 → `mesh.renderOrder` → three 透明排序生效。对照实验：thigh_L 0→90 视口 4258 像素重排，改回 0 与原图逐像素 0 差异。用户若报"没作用"，先排查：①改的是无贴图空部件（初始只有 10 个素体挂图，head/hat/hand/foot/weapon 等全透明）；②parts 按 S/E/N/W 各存一份， zIndex 只对当前方向生效；③覆盖物 zIndex 是另一个输入框（不设则默认节点+0.1）。
- 验证方法：vite :5174 + puppeteer-core（chrome 路径 `process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe'`，headless + `--enable-unsafe-swiftshader`）；截图对照必须**单变量、选中态一致**，否则 gizmo/描边会污染像素 diff。探针脚本用完即删（`tools/_*`）。
- three 贴图协议：three 自带 `texture.offset/repeat` 只对内置 map 槽生效，自定义 uniform sampler 无效；桌面端本地图片统一走 `gameasset://local/?p=<absPath>`（裁剪 `?c=x,y,w,h` 在 electron/lib/protocol.ts 用 nativeImage.crop()）。

## 5. 编辑器/世界模块速览（详见 11-04/11-05 日志）

- 资源体系约定：**贴图=单张图，图组=四向/单张图组资产**；选贴图带纯色选项，图组不带；动画属性用图组选择器，其余用贴图选择器。AssetPicker 的 TexSlot/GroupSlot/SlotShell/AssetDialog、DRAG_TYPE 含 tex/group/script，dropEffect 统一 'move'。
- 新增 AssetKind/FolderKind 必须同步 `src/editor/model/folders.ts` 的 `KIND_ORDER`，否则左栏静默丢整类资产。
- 地皮：一律自由形+外缘 CA 平滑；21 组边界图集（MAX_GROUND_EDGES=21，纹理单元上限 16）；GroundConfig.gen=渲染代数，重建签名看 gen 不看 seed/长度。
- 小地图：MapUiConfig 用屏幕像素坐标 sx/sy+size(48~640)；角色图标=图组选择器；MinimapCanvas 与相机无关；默认边框已改为圆形铜环且必须挂「贴图」资产。
- 脚本：双击=内置脚本编辑器，右键菜单才进 VS Code；挂载交互=「＋添加脚本」→空槽→点选/拖入；场景 token（data-scene-token）支持脚本拖放。
- 自检：`window.__editor`=store、`window.__editorUi`=UI 句柄；`npm run shot` 需先清残留 electron 进程（占 user-data 会秒退）。

## 6. 工作约定（必须遵守）

- **同一件事尝试超过 5 次未成功 → 停止，向用户说明卡点，不要闷头换方案硬试。**
- 改动很小不冒烟测试，提示用户自验；改动多/收尾时才跑 `npm run shot`。
- 不要在一次问答里重复同样的 GUI/探针操作：先读状态定位，再决定是否需要视觉验证；同类验证最多一轮。
- 收尾清理临时文件、停掉后台 dev server；有持久价值的结论追加当日 `.workbuddy/memory/YYYY-MM-DD.md`。

## 7. 遗留待办

1. 编辑器读取 `templates.json` 的骨架模板选择器（当前硬编码 humanoid10）。
2. `build_sprites.py` 的 `--mode monster_parts` 裁剪实现；manifest.enemies 仍是旧 actions 帧定义。
3. 生图消耗额度（5–10 credits/张）执行前需告知用户；生图前必加载用户级技能 `dontstarve-art`。
