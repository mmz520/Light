# 播放态与每帧逻辑

## 时间

`onUpdate(dt)` 的 `dt` 是**距上一帧的秒数**（约 0.016），不是毫秒，也不是累计时间。

```ts
@Hidden() total = 0;

onUpdate(dt: number) {
  this.total += dt;              // 累计播放时长
  if (this.total > 30) {         // 30 秒后做点什么
    this.emit('world:nightfall');
    this.total = 0;
  }
}
```

需要「每 N 秒一次」就累加到阈值再减掉，别用 `setInterval`：
`setInterval` 不受暂停影响，`onDestroy` 之后还会继续跑，容易在停止播放后改已经没了的实例。

## `this.playing`

| 值 | 含义 |
| --- | --- |
| `true` | 运行时播放（`onStart` / `onUpdate` / `onEvent` 会调用） |
| `false` | 编辑态（只有 `onMount` / `onFieldChange`） |

一般用不到它——生命周期本身已经把两种状态分开了。它适合写在共享方法里做分支：

```ts
refreshVisual() {
  if (!this.playing) return;     // 编辑态不碰运行时资源
  this.mesh.material.color.set(this.color);
}
```

## 日志

```ts
this.log('血量', this.blood, '位置', this.node.x, this.node.z);
```

播放时输出到播放日志面板，编辑态输出到控制台；前缀自动带上对象名，形如 `[Boss] 血量 80`。

不要在高频路径里无条件打日志：`onUpdate` 里每帧一条，日志面板很快就卡了。要么加条件，
要么只打一次。

## 播放流程

1. 点 ▶ 播放 → 遍历所有节点 → 按 `componentIds` 顺序实例化 → `onMount` → `onStart`。
2. 每帧 → `onUpdate(dt)`（组件）与 quickjs 钩子脚本各自驱动。
3. 点 ⏹ / 暂停 → `onDestroy` → 清空事件订阅 → 组件实例全部丢弃。

暂停与停止的区别：暂停只是不再 `tick`，实例还活着；停止会走 `onDestroy`，再播放是全新实例
（字段值会从节点数据 + `onMount` 重新灌一遍）。

## 性能

| 建议 | 原因 |
| --- | --- |
| `onUpdate` 里只做数学和属性赋值 | 组件数量 × 60 帧，任何分配都会被放大 |
| 几何体 / 材质 / 向量在 `onStart` 里建好 | 避免每帧 `new` 触发 GC |
| 大范围查找放 `onStart` 或缓存 | `project.scene.find` 每帧跑一次是 O(n) |
| 需要节流的逻辑用累加 `dt` | 比 `Date.now()` 少一次系统调用，也更稳 |

## 与老钩子脚本共存

同一个节点可以既挂组件脚本（TS class）又挂钩子脚本（`function onStart(self, Light)`）。
两者各自独立运行，**事件也不互通**：组件脚本的 `Event` 总线只派发给组件实例，
钩子脚本的 `Light.emit` 只派发给钩子实例。同一类脚本之间才建议用事件通信。

新写的逻辑建议用组件脚本：有属性面板、有类型检查、有装饰器分组。
