# 长期记忆（项目约定）

## 工作方式

- **当尝试一件事超过 5 次没成功，则暂时终止任务，并告知用户遇到了什么问题、卡在哪里、解决不了。** 不要继续闷头换方案硬试。

## 交互约定

- 不要每改一点就冒烟测试。改动很小时不测试，直接提示用户自行验证；只有改动较多、准备收尾时才跑 `npm run shot` 全量自检。

## 硬性约定：脚本 API 文档必须同步（用户明确要求，2026-11-12）

- **每次新增 / 修改 / 删除任何脚本 API**（装饰器、生命周期钩子、this 成员、Event、内置组件脚本、钩子脚本 Light/self API），**必须同步更新两处**：① `src/editor/code/apiModel.ts`（代码编辑器的补全 / hover / 右栏速查唯一数据源）；② `src/editor/docs/` 下对应的 Markdown 文档（含解释和示例）。新开一类 API 就加一篇 md 并在 `src/editor/docs/index.ts` 的 `DOC_GROUPS` 里登记。
- 文档渲染入口：帮助菜单「脚本 API 参考」（快捷键 F1），真实窗口 kind=`'help'`（refId=`script-api`，不需要工程快照）；页内浮窗与脚本编辑器右栏「完整文档」按钮也走同一组件 `src/editor/ui/ApiHelp.tsx`。
- md 构建时以 `?raw` 内联进 bundle，路径写死在 docs/index.ts，不要挪目录；渲染器是自写的 `src/editor/ui/Markdown.tsx`（无第三方依赖）。

## 技术要点

- 桌面端所有本地图片统一走 `gameasset://local/?p=<absPath>` 协议；裁剪参数 `?c=x,y,w,h`（原图像素）下沉在 `electron/lib/protocol.ts` 用 `nativeImage.crop()` 处理。CSS（background/border-image）与 three 自定义 uniform sampler（地皮 uT0~uT6）都能覆盖；three 自带的 `texture.offset/repeat` 只对材质内置 map 槽生效，对自定义 sampler 完全无效。
- 虚拟目录只是 metadata.json 里的名称字段，磁盘上不建目录。
- `window.__editor` = store 本体，`window.__editorUi` = UI 驱动句柄（openAnimation / openStateMachine / closeWindows / select ...），供 electron/lib/verify.ts 自检脚本驱动。
- **git push 必须绕开环境里注入的代理**（`HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:<port>` 会返回 `Empty reply` / `CONNECT tunnel failed, response 502`）。正确写法：`env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy git push origin main`。同理 `npm install` 也要清代理并显式 `--registry=https://registry.npmjs.org/`（本机 npmmirror 直连不通）。

## 记忆索引

- 完整项目上下文（目录结构 / 动画编辑器要点 / zIndex 结论 / 模块速览 / 待办）见同目录 `PROJECT_CONTEXT.md`（2026-11-12 整理），其他任务优先引用该文件。
