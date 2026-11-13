# three.js 场景

组件脚本直接跑在渲染进程主线程，拿到的是**编辑器视口里的那个 three 场景**，不是副本。
所以脚本加的东西立刻能在视口里看到，播放结束后要自己清理。

## 三个入口

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `this.three` | `typeof THREE \| null` | three 命名空间，`new this.three.Mesh(...)`。视口没就绪时是 `null` |
| `this.scene` | `THREE.Scene \| null` | 当前 three 场景，可以往上加灯 / 网格 / 粒子 |
| `this.object3d` | `THREE.Object3D \| null` | **这个节点的锚点**，位置已按 `node.x` / `node.z` 摆好 |

节点锚点是个空的 `Object3D`，本身不可见。往上 `add` 模型、`PointLight`、`Sprite` 才会有画面。
锚点适合放「跟着这个对象走」的东西；全场唯一的效果（全局光照、雾、后期）挂 `this.scene`。

## 示例：篝火（灯光 + 呼吸）

```ts
@Component('篝火', { icon: '🔥', order: 35 })
export default class CampfireComponent extends LightComponent {
  @Group('火焰', 10) @Label('亮度') @Num(0, 8, 0.1) brightness = 2;
  @Group('火焰', 10) @Label('半径') @Num(0.5, 12, 0.1) radius = 3;
  @Group('火焰', 10) @Label('颜色') @Color() color = '#ff9a3c';

  @Hidden() light: any = null;
  @Hidden() t = 0;

  onStart() {
    const THREE = this.three;
    if (!THREE || !this.object3d) return;
    this.light = new THREE.PointLight(this.color, this.brightness, this.radius, 2);
    this.light.position.set(0, 1.2, 0);
    this.object3d.add(this.light);
  }

  onFieldChange(key: string) {
    if (!this.light) return;
    if (key === 'brightness') this.light.intensity = this.brightness;
    if (key === 'radius') this.light.distance = this.radius;
    if (key === 'color') this.light.color.set(this.color);
  }

  onUpdate(dt: number) {
    if (!this.light) return;
    this.t += dt;
    // 用噪声感的正弦抖动模拟火苗
    const f = 0.85 + Math.sin(this.t * 7.3) * 0.1 + Math.sin(this.t * 13.7) * 0.05;
    this.light.intensity = this.brightness * f;
  }

  onDestroy() {
    if (!this.light) return;
    this.light.removeFromParent();
    this.light.dispose?.();
    this.light = null;
  }
}
```

## 清理清单（`onDestroy` 里做）

| 创建了什么 | 怎么清理 |
| --- | --- |
| `Mesh` / `Sprite` / `Line` | `obj.removeFromParent()` |
| `Geometry` | `geo.dispose()` |
| `Material` / `Texture` | `mat.dispose()` / `tex.dispose()` |
| `PointLight` | `removeFromParent()`，灯光没有几何体要释放 |
| 自己 `Event.on` 的订阅 | 调返回的取消函数 |

不清理的后果不是立刻报错，而是**每次播放都多一份**：反复播放几十次后帧率掉下来，或者灯越叠越亮。

## 几个容易踩的点

- **位置别硬写**：锚点位置由节点数据决定，实例创建时同步一次。`onStart` 里改 `object3d.position`
  会和场景里的摆放位置打架；要挪对象请用 `this.setNode({ x, z })`。
- **不要在 `onUpdate` 里 `new`**：几何体、材质、向量都是每帧新建的话，GC 压力很大。放到 `onStart`
  里建一次，`onUpdate` 只改属性。
- **编辑态没有 `onStart`**：想在编辑时就看见效果，把创建逻辑抽成一个方法，`onStart` 和
  `onFieldChange` 都调它（注意先判断是否已经创建过）。
- **`this.three` 可能为 `null`**：视口还没初始化（比如打开工程第一帧）时拿不到，必须判空。
- 场景是共享的：脚本对 `this.scene.fog`、`this.scene.background` 这类全局属性的修改会影响整个编辑器视图。
