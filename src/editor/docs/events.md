# 事件总线

组件之间不互相引用，用一个全局事件总线通信。发送用 `Event.emit` 或 `this.emit`，
接收用 `onEvent(type, payload)` 或 `Event.on(type, fn)`。

## API

| 写法 | 说明 |
| --- | --- |
| `Event.emit(type, payload?)` | 全局广播（脚本作用域里直接用，不用 import） |
| `Event.on(type, fn)` | 订阅，返回**取消函数** |
| `Event.off(type, fn)` | 取消订阅（也可以用返回的函数） |
| `Event.clear()` | 清空所有订阅（慎用，会把别的脚本的订阅一起清掉） |
| `this.emit(type, payload?)` | 和 `Event.emit` 完全等价 |
| `this.on(type, fn)` | 和 `Event.on` 完全等价 |
| `onEvent(type, payload?)` | 组件方法：收到**任何**广播时调用 |

## 派发范围

- `onEvent` 发给**所有正在播放的组件实例**，包括发送者自己。收到不相关的事件要自己按 `type` 过滤。
- 只在播放态派发。编辑态 `Event.emit` 不会有 `onEvent` 接收者（但 `Event.on` 的订阅仍然有效）。
- 某个实例的 `onEvent` 抛错只影响它自己那一次调用，不会中断其它实例。

## 示例：角色死亡 → 掉装备 + 提示

发送方（角色组件）：

```ts
onUpdate() {
  if (this.blood > 0) return;
  if (this.dead) return;          // 只广播一次
  this.dead = true;
  this.emit('combat:death', { nodeId: this.node.id, name: this.node.name, blood: this.blood });
}
```

接收方：

```ts
@Component('死亡掉落', { icon: '💀', order: 80 })
export default class DeathLootComponent extends LightComponent {
  @Group('掉落', 10) @Label('掉几件') @Int(0, 8) count = 2;
  @Group('掉落', 10) @Label('提示文字') @Str() tip = '你死了';

  onEvent(type: string, payload: any) {
    if (type !== 'combat:death') return;
    this.log('收到死亡事件：', payload?.name);
    // 只有自己这个对象死了才处理，别人的死亡不关我事
    if (payload?.nodeId !== this.node.id) return;
    this.setNode({ minimapShow: false });
    this.emit('ui:toast', { text: this.tip, count: this.count });
  }
}
```

## 用 `Event.on` 手动订阅

需要「不是组件生命周期」的时机（比如只在某个条件下才关心）时用它：

```ts
onStart() {
  this.offToast = Event.on('ui:toast', (payload: any) => {
    console.log('提示：', payload?.text);
  });
}

onDestroy() {
  this.offToast?.();
  this.offToast = null;
}
```

`Event.on` 的订阅不会自动清理，**一定要在 `onDestroy` 里取消**，否则停止播放后回调还在往外冒。

## 命名与 payload 约定

- 事件名建议带域前缀：`combat:death`、`ui:toast`、`world:weather`。中文名也能用（`'角色死亡'`），
  但前缀式更好搜、更不容易撞。
- payload 用普通对象，别塞 three 对象或 DOM 节点；它是跨脚本传递的数据，越简单越好。
- 需要「谁发的」就带上 `nodeId`，接收方据此过滤。
- 事件没有返回值，也没有请求-响应语义。要拿结果，用「发一个请求事件 + 对方回一个应答事件」。
