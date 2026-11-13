# 钩子脚本（旧式）

这是组件脚本之前的老方案：一段普通 JS，导出几个固定的函数钩子。
它跑在 quickjs 沙箱里，**拿不到 three 场景，也不能操作节点数据**，只适合做纯逻辑。
新脚本建议用组件脚本（TS class），这里保留兼容。

## 生命周期钩子

```js
function onStart(self, Light) {}
function onUpdate(self, Light, dt) {}
function onEvent(self, Light, name, data) {}
function onDestroy(self, Light) {}
```

| 钩子 | 时机 |
| --- | --- |
| `onStart(self, Light)` | 播放开始，每个实例一次 |
| `onUpdate(self, Light, dt)` | 每帧，`dt` 单位秒 |
| `onEvent(self, Light, name, data)` | 收到 `Light.emit(name, data)` |
| `onDestroy(self, Light)` | 播放结束 |

## `self`

| 成员 | 说明 |
| --- | --- |
| `self.x` / `self.z` | 实例在平面上的位置（可写，只影响运行时） |
| `self.face` | 朝向（可写） |
| `self.vars.变量名` | 控制器变量，可读可写 |

## `Light`

| 成员 | 说明 |
| --- | --- |
| `Light.log(...args)` | 输出到播放日志 |
| `Light.input.isDown(key)` | 按键是否按住 |
| `Light.input.pressed(key)` | 这一帧是否刚按下 |
| `Light.emit(name, data?)` | 广播给所有钩子脚本实例 |
| `Light.on(name, fn)` | 订阅事件 |
| `Light.time()` | 播放开始至今的秒数 |
| `Light.find(name)` | 按名字查实体，返回 `[{ name, x, z }]` |

## 示例：到点喊话

```js
let spoken = false;

function onUpdate(self, Light, dt) {
  const t = Light.time();
  if (!spoken && t > 5) {
    spoken = true;
    Light.log('五分钟到了');
    Light.emit('say', { text: '天黑了，快回家' });
  }
}

function onEvent(self, Light, name, data) {
  if (name !== 'say') return;
  Light.log('收到：' + data.text);
}
```

## 与组件脚本的差别

| | 钩子脚本 | 组件脚本 |
| --- | --- | --- |
| 语言 | JS（沙箱） | TS class（主线程编译） |
| 属性面板 | ❌ | ✅ 装饰器驱动 |
| 访问 three | ❌ | ✅ `this.three` / `this.object3d` |
| 读写节点数据 | ❌ | ✅ `setNode` / `setCharacter` / `setMapui` |
| 事件 | `Light.emit`（只在钩子脚本之间） | `Event.emit`（只在组件之间） |
| 适合 | 快速逻辑验证 | 正式功能 |
