# 快速开始

组件脚本是**一个 TypeScript class**，继承 `LightComponent`。你用注解把想调的变量暴露到属性面板，
在生命周期方法里写逻辑；编辑器负责实例化、注入节点数据、在播放时驱动每一帧。

## 一个脚本的完整流程

1. 选中一个场景对象（左侧「场景对象」）。
2. 右侧属性检查器底部点「添加脚本」→ 选择脚本资产（新建的脚本默认就在「脚本」目录里）。
3. 在脚本编辑器里写代码，**保存后立刻生效**：属性面板按注解重排，播放时用新的类。
4. 点场景上方的 ▶ 播放，`onStart` / `onUpdate` 开始跑。

> 编辑态只调用 `onMount`（读节点数据）和 `onFieldChange`（面板改值），不会跑 `onUpdate`。
> 想让逻辑只在运行时执行，写在 `onStart` / `onUpdate` 里即可。

## 最小可运行示例

给节点挂一个立方体，播放时让它自转：

```ts
@Component('旋转立方', { icon: '🧊', order: 100, desc: '演示 three.js 与生命周期' })
export default class SpinBoxComponent extends LightComponent {
  @Group('外观', 10) @Label('边长') @Num(0.1, 4, 0.1) size = 0.6;
  @Group('外观', 10) @Label('颜色') @Color() color = '#c9873a';
  @Group('动态', 20) @Label('转速（弧度/秒）') @Num(0, 10, 0.1) speed = 1.2;

  @Hidden() mesh: any = null;

  onStart() {
    const THREE = this.three;
    if (!THREE || !this.object3d) return;
    const geo = new THREE.BoxGeometry(this.size, this.size, this.size);
    const mat = new THREE.MeshStandardMaterial({ color: this.color });
    this.mesh = new THREE.Mesh(geo, mat);
    this.object3d.add(this.mesh);
    this.log('立方体已挂到', this.node.name);
  }

  onUpdate(dt: number) {
    if (this.mesh) this.mesh.rotation.y += dt * this.speed;
  }

  onDestroy() {
    if (!this.mesh) return;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh = null;
  }
}
```

## 三条硬规则

- **一个脚本 = 一个组件类**，用 `export default class X extends LightComponent` 导出。
- **不能用 `import` / `require`**。装饰器和 `Event` 已经注入到脚本作用域，three.js 从 `this.three` 拿。
- **字段值必须可 JSON 序列化**。字段值会存进工程文件，函数、three 对象、DOM 元素存不进去；
  这类东西用 `@Hidden()` 标成内部字段，运行时再创建。

## 该看哪一栏

| 你的问题 | 看这里 |
| --- | --- |
| 注解怎么写、面板怎么分组 | 属性面板 · 显示控制注解 / 控件注解 |
| 怎么改节点位置、血量、小地图 | 运行时 API · 节点与工程数据 |
| 怎么加模型、粒子、灯光 | 运行时 API · three.js 场景 |
| 摄像机怎么跟随、45 度角怎么关 | 运行时 API · 摄像机 |
| 两个脚本怎么通信 | 运行时 API · 事件总线 |
| 为什么我的逻辑编辑时不跑 | 组件与生命周期 |
| 系统自带的变换 / 角色脚本做了什么 | 参考 · 内置组件脚本 |
