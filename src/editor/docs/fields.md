# 控件注解

控件注解决定字段用什么控件渲染。**没写控件注解的字段会按默认值推断**，不会消失。

| 注解 | 字段值类型 | 面板控件 | 说明 |
| --- | --- | --- | --- |
| `@Num(min?, max?, step?)` | `number` | 数字输入框 | 超出 min/max 会被钳到边界，`step` 只影响输入框步进 |
| `@Int(min?, max?)` | `number` | 数字输入框 | 同上，步长固定 1 |
| `@Bool()` | `boolean` | 开 / 关按钮 | 值是布尔，不是 0/1 |
| `@Str()` | `string` | 单行输入框 | 默认控件，可省略 |
| `@Text()` | `string` | 多行文本框 | 失焦时提交，适合长描述 |
| `@Color()` | `string` | 取色器 + 文本框 | 值格式 `#rrggbb` |
| `@Enum(options)` | `string` \| `number` | ≤4 项按钮组，>4 项下拉 | 两种写法：`['a','b']` 或 `[{ value, label }]` |
| `@Asset(kind, opts?)` | `string \| null` | 资源选择器 | 值存资源 **id**；`{ multiple: true }` 时是 `string[]` |
| `@Json()` | 任意可序列化对象 | JSON 文本框 | 对象 / 数组都行，提交时校验 JSON |
| `@List(itemKind?)` | 数组 | JSON 文本框 | 与 `@Json()` 同款编辑器，元素控件暂未细分 |
| `@Panel(id)` | 无（占位字段） | 宿主内置面板 | 目前支持 `'ground'`（地皮生成器） |

**默认推断规则**（没写控件注解时）：

| 默认值 | 推断出的控件 |
| --- | --- |
| `boolean` | `@Bool()` |
| `number` | `@Num()` |
| `string` | `@Str()` |
| 数组 | `@List()` |
| 对象 | `@Json()` |

## `@Asset` 可用的资源种类

| kind | 对应目录 | 值 |
| --- | --- | --- |
| `'image'` | 图片 | 图片资产 id |
| `'texture'` | 贴图 | 贴图资产 id |
| `'group'` | 图组 | 图组资产 id（小地图图标用它） |
| `'animation'` | 动画 | 动画资产 id |
| `'statemachine'` | 状态机 | 状态机资产 id |
| `'controller'` | 控制器 | 控制器资产 id |
| `'script'` | 脚本 | 脚本资产 id |

## 示例：每种控件都用一遍

```ts
@Component('演示控件', { icon: '🧪', order: 120 })
export default class DemoComponent extends LightComponent {
  @Group('文本', 10) @Label('名字') @Str() @Hint('单行') name = '';
  @Group('文本', 10) @Label('描述') @Text() desc = '';
  @Group('文本', 10) @Label('主题色') @Color() tint = '#c9873a';

  @Group('数值', 20) @Label('整数') @Int(0, 999) count = 3;
  @Group('数值', 20) @Label('小数') @Num(0, 1, 0.01) ratio = 0.5;
  @Group('数值', 20) @Label('开关') @Bool() enabled = true;

  @Group('选择', 30) @Label('两三个选项') @Enum(['近', '中', '远']) range = '近';
  @Group('选择', 30) @Label('很多选项') @Enum([
    { value: 'idle', label: '待机' },
    { value: 'walk', label: '行走' },
    { value: 'run', label: '奔跑' },
    { value: 'attack', label: '攻击' },
    { value: 'hurt', label: '受伤' },
  ]) state = 'idle';

  @Group('资源', 40) @Label('默认动画') @Asset('animation') animationId: string | null = null;
  @Group('资源', 40) @Label('控制器（可多选）') @Asset('controller', { multiple: true }) controllerIds: string[] = [];

  @Group('高级', 50) @Label('掉落表') @Json() loot = [{ item: 'twigs', chance: 0.5 }];
  @Group('高级', 50) @Label('标签') @List() tags: string[] = [];
}
```

## 注意

- `@Asset` 存的是 **id**，不是名字。资源改名不会影响已保存的值，资源删掉则值变成悬空 id（读出来是 `null` 更安全，用 `?? null` 兜底）。
- `@Color()` 只接受 `#rrggbb`；写 `red` 或 `rgba(...)` 时取色器会回落到白色，但文本框内容原样保存。
- `@Panel('ground')` 的字段本身不显示控件，值用来占位；地皮参数由 `GroundPanel` 直接读写节点。
- 数字字段收到 `null` / 空字符串时不要直接参与运算，先 `Number(value) || 0`。
