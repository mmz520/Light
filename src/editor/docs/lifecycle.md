# 组件与生命周期

一个节点挂了几份组件脚本，就有几个独立的实例。实例之间互不干扰，靠事件总线通信。

## 何时调用哪个方法

| 方法 | 编辑态 | 播放态 | 调用次数 | 用途 |
| --- | --- | --- | --- | --- |
| `onMount()` | ✅ | ✅ | 每实例 1 次 | 把节点上的已有数据读进字段（位置、血量、动画 id…） |
| `onFieldChange(key, value)` | ✅ | ✅ | 每次改字段 | 把面板改动写回节点 / three 对象 |
| `onStart()` | ❌ | ✅ | 每实例 1 次 | 创建运行时资源（网格、灯光、计时器） |
| `onUpdate(dt)` | ❌ | ✅ | 每帧 | 逻辑与动画，`dt` 单位是秒 |
| `onEvent(type, payload)` | ❌ | ✅ | 每次收到事件 | 响应 `Event.emit` / `this.emit` |
| `onDestroy()` | ❌ | ✅ | 每实例 1 次 | 释放 `onStart` 里创建的东西 |

**为什么 `onMount` 要读节点数据**：属性面板显示的是字段值，字段默认值是脚本里写的常量。
如果不读，面板上永远显示脚本默认值，跟节点真实数据对不上。

```ts
onMount() {
  this.x = this.node.x;
  this.z = this.node.z;
}
```

**为什么 `onFieldChange` 要写回节点**：字段本身只是组件自己的内存值，改它不会影响场景。
要让场景跟着动，必须调 `this.setNode(...)` / `this.setCharacter(...)` / `this.setMapui(...)`。

```ts
onFieldChange(key: string, value: any) {
  if (key === 'x' || key === 'z') this.setNode({ [key]: Number(value) || 0 });
}
```

## 播放态与编辑态的区别

`this.playing` 可以直接判断：

```ts
onUpdate(dt: number) {
  if (!this.playing) return;      // 理论上不会进这里，onUpdate 只在播放时调
}
```

实际差异：

- 编辑态改了字段 → 会重新创建实例、调 `onFieldChange`，**不会**调 `onStart` / `onUpdate`。
- 播放中改字段 → 只影响新实例，**正在运行的实例不会自动同步**。要即时生效请停止后重新播放。
- 停止播放 → `onDestroy` 逐个调用，然后清空事件订阅。

## 实例出错会发生什么

- `onStart` 抛错：该组件启动失败，其余组件继续启动（控制台有警告）。
- `onUpdate` 抛错：这个实例会被从运行列表里摘掉，不再每帧调用，避免刷屏。
- `onEvent` 抛错：只影响那一次派发，其它组件照常收到。

所以关键逻辑要自己 `try / catch`，不要把整个组件的生命周期交给一个可能抛错的调用。

## 示例：计时器 + 自动掉血

```ts
@Component('饥饿计时', { icon: '⏳', order: 90 })
export default class HungerComponent extends LightComponent {
  @Group('计时', 10) @Label('每秒掉多少') @Num(0, 10, 0.1) rate = 1;
  @Group('计时', 10) @Label('低于多少报警') @Num(0, 100, 1) warnAt = 20;

  @Hidden() elapsed = 0;
  @Hidden() warned = false;

  onStart() {
    this.elapsed = 0;
    this.warned = false;
  }

  onUpdate(dt: number) {
    this.elapsed += dt;
    if (this.elapsed < 1) return;        // 每满 1 秒结算一次
    this.elapsed -= 1;

    const c = this.node.character;
    if (!c) return;
    const next = Math.max(0, c.satiation - this.rate);
    this.setCharacter({ satiation: next });

    if (!this.warned && next <= this.warnAt) {
      this.warned = true;
      this.emit('饥饿警告', { nodeId: this.node.id, satiation: next });
    }
  }
}
```

> 定时逻辑累加 `dt` 比 `setInterval` 稳：播放暂停 / 掉帧时不会积压，也不会在 `onDestroy` 之后还在跑。
