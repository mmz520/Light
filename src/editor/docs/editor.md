# 代码编辑器

脚本编辑器基于 CodeMirror 内置了一套顺手的编辑能力：TS 语法高亮、补全、悬浮说明、
语法错误波浪线、自动保存。这篇文章讲它怎么用，以及补全的数据从哪来。

## 功能一览

| 功能 | 触发方式 |
| --- | --- |
| 语法高亮 | 自动（组件脚本按 TS，钩子脚本按 JS） |
| 成员补全 | 输入 `this.` / `this.node.` / `this.camera.` / `Event.` 后自动弹出 |
| 生命周期补全 | 类体里（不在方法体内）敲 `onU`、`onS` 等自动弹出六个钩子的完整片段 |
| 字段片段 | 类体里敲 `field` 插入一条带注解的字段（分组 + 中文名 + 数值控件），改注解换控件类型 |
| 注解补全 | 输入 `@` 后自动弹出装饰器列表 |
| 关键字 / 片段 | 输入 `function`、`for`、`const` 等时自动弹出 |
| 手动唤出补全 | `Ctrl+Space` |
| 悬浮说明 | 鼠标悬停在名字上，显示类型 + 说明 |
| 语法错误 | 停手约 0.3 秒后检查；出错的位置画虚线、行号前有红点，工具条显示红字 |
| 自动保存 | 停手约 0.6 秒自动写回工程（也有「保存」按钮和 `Ctrl+S`） |
| 代码片段 | 补全里选「class」（组件骨架）或「onStart」（钩子骨架）整段插入 |
| 右栏速查 | 按 API 名搜索，点一条就插到光标处 |

## 补全能认出的接收者

按点号链决定给什么：

| 输入 | 给出 |
| --- | --- |
| `this.` | 基类成员（node / project / scene / three / object3d / camera / log / setNode …）+ **你自己写的字段与方法**（带 `@Label` 的中文名） |
| `this.node.` | 节点字段（id / name / kind / x / z / character / mapui …） |
| `this.project.` | 工程资产列表（scene / images / textures / animations …） |
| `this.camera.` | 相机（pose / follow / autoDistance / claimedBy） |
| `this.camera.pose.` | 位姿字段（x / y / z / pitch / yaw / distance） |
| `Event.` | emit / on / off / clear |
| `this.three.` | 常用 three 类（Vector3 / Mesh / Group / 材质 / 灯光 …） |
| `this.object3d.` / `this.scene.` | Object3D / Scene 的常用成员 |
| `this.ctx.input.` | isDown / pressed |
| `@` | 全部装饰器（Component / Group / Label / Num / Asset …） |
| 类体里敲 `onU` / `onS` / `onM` … | 对应生命周期钩子的完整片段：`onUpdate(dt: number) { … }`，回车整段插入（已经写过的钩子不再重复提示） |
| 类体里敲 `field` | 带注解的字段片段（分组 + 中文名 + 数值控件） |

钩子脚本（旧式 JS）里则是 `self.`、`Light.` 和四个钩子函数（敲 `onS` 也能直接插 `function onStart(self, Light) { … }`）。

## 补全数据从哪来

- **静态 API**（装饰器、this 成员、节点 / 工程字段、相机、three 常用项）来自
  `src/editor/code/apiModel.ts` —— 补全、悬浮说明、右栏速查读的是同一份数据。
- **你自己写的字段与方法**：编辑器用 TypeScript 把当前脚本解析成语法树抽出来的，
  所以能带上类型和 `@Label('血量')` 的中文文本；改完代码立刻生效，不用重启。

## 常见问题

**补全没弹？** 先确认输入的是点号或 `@`；也可以 `Ctrl+Space` 手动唤出。字符串和注释里不会弹。

**想关掉自动补全？** 按 `Esc` 关闭当前弹窗；它只在你输入时出现，不会主动打断。

**波浪线位置不对？** 检查显示的是「语法检查通过」还是红字 —— 检查有约 0.3 秒防抖，
打字过程中短暂显示旧结果是正常的。

**撤销（Ctrl+Z）能撤多远？** 自动保存把连续输入合并成一步，撤一次回退到上一段停顿处。
