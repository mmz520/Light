# 长期记忆（项目约定）

## 工作方式

- **当尝试一件事超过 5 次没成功，则暂时终止任务，并告知用户遇到了什么问题、卡在哪里、解决不了。** 不要继续闷头换方案硬试。

## 交互约定

- 不要每改一点就冒烟测试。改动很小时不测试，直接提示用户自行验证；只有改动较多、准备收尾时才跑 `npm run shot` 全量自检。

## 技术要点

- 桌面端所有本地图片统一走 `gameasset://local/?p=<absPath>` 协议；裁剪参数 `?c=x,y,w,h`（原图像素）下沉在 `electron/lib/protocol.ts` 用 `nativeImage.crop()` 处理。CSS（background/border-image）与 three 自定义 uniform sampler（地皮 uT0~uT6）都能覆盖；three 自带的 `texture.offset/repeat` 只对材质内置 map 槽生效，对自定义 sampler 完全无效。
- 虚拟目录只是 metadata.json 里的名称字段，磁盘上不建目录。
- `window.__editor` = store 本体，`window.__editorUi` = UI 驱动句柄（openAnimation / openStateMachine / closeWindows / select ...），供 electron/lib/verify.ts 自检脚本驱动。
