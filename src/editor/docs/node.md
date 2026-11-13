# 节点与工程数据

组件通过 `this.node` / `this.project` 读数据，通过 `setNode` / `setCharacter` / `setMapui` 写数据。
写入会进撤销历史，并标记工程为「未保存」——所以不要在 `onUpdate` 里每帧写，会污染历史。

## `this.node`（当前场景对象）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 唯一 id，不要改 |
| `name` | `string` | 对象名（Hierarchy 里显示的名字） |
| `kind` | `'group' \| 'ground' \| 'cover' \| 'enemy' \| 'character' \| 'camera' \| 'mapui'` | 对象类型，决定面板显示什么 |
| `parentId` | `string \| null` | 父节点，`null` = 根层 |
| `order` | `number` | 同层排序 |
| `x` / `z` | `number` | 世界坐标（俯视平面） |
| `character?` | `CharacterConfig` | 只有角色有：`name` `blood` `satiation` `mental` `speed` `attack` `animationId` `stateMachineId` `controllerIds` |
| `mapui?` | `MapUiConfig` | 只有地图元素有：`sx` `sy` `shape` `range` `size` `decorId` |
| `ground?` | `GroundConfig` | 只有地皮有：生成参数 |
| `minimapShow?` | `boolean` | 是否显示在小地图上 |
| `minimapIcon?` | `string \| null` | 小地图图标（图组 id） |
| `scriptIds?` | `string[]` | 挂载的钩子脚本 |
| `componentIds?` | `string[]` | 挂载的组件脚本 |
| `components?` | `Record<string, Record<string, unknown>>` | 组件字段值（自动维护，别手改） |

## `this.project`（整个工程，只读）

常用集合：`images` `textures` `animations` `stateMachines` `controllers` `scripts` `scene`，
以及 `name`、`root`（工程磁盘路径）。

```ts
// 按名字找另一个对象（只读）
const boss = this.project.scene.find((n) => n.name === 'Boss');
if (boss) this.log('Boss 在', boss.x, boss.z);
```

## 三个写入口

```ts
// 1) 节点顶层字段：位置、名字、小地图开关…
this.setNode({ x: 3.5, z: -2, minimapShow: false });

// 2) 角色配置（只有 kind === 'character' 生效）
this.setCharacter({ blood: 80, animationId: 'anim_xxx' });

// 3) 地图元素配置（只有 kind === 'mapui' 生效）
this.setMapui({ size: 260, shape: 'rect' });
```

三者传的都是 **部分字段**，内部做浅合并，不会覆盖其它字段。同一次操作里连续调用会合并成一条撤销记录。

> **不要直接改 `this.node.x`**：那是内存对象上的裸写入，界面不会重渲染、工程不会标记未保存、
> 撤销也回不去。凡是「用户应该能看见并保存」的改动，一律走上面的入口。

## 示例：把小地图开关和图标接到面板

```ts
@Component('小地图', { icon: '🗺', order: 30 })
export default class MinimapComponent extends LightComponent {
  @Group('显示', 10) @Label('在地图上显示') @Bool() show = true;
  @Group('显示', 10) @Label('显示图标') @Asset('group') @Hint('不选就是默认圆点') iconId: string | null = null;

  onMount() {
    this.show = this.node.minimapShow ?? true;
    this.iconId = this.node.minimapIcon ?? null;
  }

  onFieldChange(key: string, value: any) {
    if (key === 'show') this.setNode({ minimapShow: !!value });
    else if (key === 'iconId') this.setNode({ minimapIcon: (value as string) || null });
  }
}
```

## 示例：血量低于一半时缩小一点

```ts
onUpdate() {
  const c = this.node.character;
  const obj = this.object3d;
  if (!c || !obj) return;
  const ratio = Math.max(0.35, c.blood / 100);
  obj.scale.set(ratio, ratio, 1);
}
```

这里读 `this.node.character` 而不是字段：字段只在面板改值时更新，节点数据才是运行时的真实值。
