/**
 * 组件脚本框架 —— 属性面板由脚本驱动
 *
 * 一个「组件脚本」= 一个 TS class（继承 LightComponent），用注解声明要暴露到属性面板的公共变量：
 *
 *   @Component('角色', { icon: '👤', order: 20 })
 *   export default class CharacterComponent extends LightComponent {
 *     @Group('基础') @Label('角色名') @Str() name = '';
 *     @Group('数值', 20) @Label('血量') @Num(0, 200, 1) blood = 100;
 *     @Group('资源') @Label('动画') @Asset('animation') animationId: string | null = null;
 *     @Hidden() internalFlag = false;
 *
 *     onStart() { this.log('上线'); }
 *     onEvent(type: string, payload?: any) { ... }
 *   }
 *
 * 注解分两类：
 *   · 显示控制：@Group(name, order) @Hidden() @Label(text) @Hint(text) @Order(n)
 *   · 控件类型：@Num(min,max,step) @Int() @Bool() @Str() @Text() @Enum([...]) @Color()
 *              @Asset(kind, {multiple}) @Panel(id) @Json()
 * 没写控件注解时按字段默认值推断（number → 数值 / boolean → 开关 / string → 单行文本 / 数组 → 列表）。
 *
 * 装饰器用 TS 的 legacy 语义（experimentalDecorators），脚本编译时临时开启，不影响宿主工程配置。
 */

/** 属性面板里一个字段的控件类型 */
export type FieldKind =
  | 'number'
  | 'int'
  | 'bool'
  | 'string'
  | 'text'
  | 'color'
  | 'enum'
  | 'asset'
  | 'assets'
  | 'list'
  | 'panel'
  | 'json';

/** 可被 @Asset 引用的资源种类（group = 图组，即四向/单张图组资产） */
export type AssetRefKind =
  | 'image'
  | 'texture'
  | 'group'
  | 'animation'
  | 'statemachine'
  | 'controller'
  | 'script';

export interface EnumOption {
  value: string | number;
  label: string;
}

/** 字段元数据（属性面板据此渲染一个控件） */
export interface FieldMeta {
  key: string;
  kind: FieldKind;
  label: string;
  group: string;
  /** 分组的排序权重（小的在前） */
  groupOrder: number;
  order: number;
  hidden: boolean;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: EnumOption[];
  assetKind?: AssetRefKind;
  /** @Asset 多选：字段值是 id 数组 */
  multiple?: boolean;
  /** @Panel 指向宿主内置面板 id */
  panel?: string;
  /** @List 元素控件类型 */
  itemKind?: FieldKind;
  /** 是否显式声明过控件类型（没声明时按默认值推断） */
  explicit?: boolean;
}

/** 组件元数据 */
export interface ComponentMeta {
  /** 显示名（注释里的 @Component 第一参数） */
  name: string;
  desc: string;
  icon: string;
  order: number;
  fields: FieldMeta[];
}

const META_KEY = '__lightComponentMeta';

/** 取（必要时创建）组件元数据。target 是 prototype（legacy 装饰器）或构造函数 */
function metaOf(target: object | Function): ComponentMeta {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctor: any = typeof target === 'function' ? target : (target as any).constructor;
  let meta: ComponentMeta | undefined = ctor[META_KEY];
  if (!meta) {
    meta = { name: String(ctor?.name ?? '组件'), desc: '', icon: '', order: 100, fields: [] };
    ctor[META_KEY] = meta;
  }
  return meta;
}

function fieldOf(target: object | Function, key: string): FieldMeta {
  const meta = metaOf(target);
  let f = meta.fields.find((x) => x.key === key);
  if (!f) {
    f = { key, kind: 'string', label: key, group: '默认', groupOrder: 100, order: meta.fields.length, hidden: false };
    meta.fields.push(f);
  }
  return f;
}

type FieldDecorator = (target: object, key: string) => void;

const makeField = (fn: (f: FieldMeta) => void): FieldDecorator => (target, key) => fn(fieldOf(target, key));

/** 标记控件类型（显式声明后不再按默认值推断） */
const setKind = (f: FieldMeta, kind: FieldKind): void => {
  f.kind = kind;
  f.explicit = true;
};

/* ------------------------------------------------------------------ */
/* 显示控制注解                                                        */
/* ------------------------------------------------------------------ */

/** 分组（属性面板里的折叠标题）；order 越小越靠前 */
export function Group(name: string, order = 100): FieldDecorator {
  return makeField((f) => {
    f.group = name;
    f.groupOrder = order;
  });
}

/** 面板里不显示这个字段（运行时仍可用） */
export function Hidden(target: object, key: string): void {
  fieldOf(target, key).hidden = true;
}

/** 显示名（中文标签） */
export function Label(text: string): FieldDecorator {
  return makeField((f) => {
    f.label = text;
  });
}

/** 字段下方的说明文字 */
export function Hint(text: string): FieldDecorator {
  return makeField((f) => {
    f.hint = text;
  });
}

/** 同组内的排序（小的在前） */
export function Order(n: number): FieldDecorator {
  return makeField((f) => {
    f.order = n;
  });
}

/* ------------------------------------------------------------------ */
/* 控件类型注解                                                        */
/* ------------------------------------------------------------------ */

/** 数值（可选滑条范围） */
export function Num(min?: number, max?: number, step = 1): FieldDecorator {
  return makeField((f) => {
    setKind(f, 'number');
    if (min !== undefined) f.min = min;
    if (max !== undefined) f.max = max;
    f.step = step;
  });
}

/** 整数（步长固定 1） */
export function Int(min?: number, max?: number): FieldDecorator {
  return makeField((f) => {
    setKind(f, 'int');
    f.step = 1;
    if (min !== undefined) f.min = min;
    if (max !== undefined) f.max = max;
  });
}

/** 开关 */
export function Bool(): FieldDecorator {
  return makeField((f) => {
    setKind(f, 'bool');
  });
}

/** 单行文本 */
export function Str(): FieldDecorator {
  return makeField((f) => {
    setKind(f, 'string');
  });
}

/** 多行文本 */
export function Text(): FieldDecorator {
  return makeField((f) => {
    setKind(f, 'text');
  });
}

/** 颜色（#rrggbb 字符串） */
export function Color(): FieldDecorator {
  return makeField((f) => {
    setKind(f, 'color');
  });
}

/** 下拉枚举：传 [{value,label}] 或 ['a','b'] */
export function Enum(options: EnumOption[] | string[]): FieldDecorator {
  return makeField((f) => {
    setKind(f, 'enum');
    f.options = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  });
}

/**
 * 资源引用：值存 id（multiple 时存 id 数组）。
 * kind: image / texture / group(图组) / animation / statemachine / controller / script
 */
export function Asset(kind: AssetRefKind, opts: { multiple?: boolean; hint?: string } = {}): FieldDecorator {
  return makeField((f) => {
    setKind(f, opts.multiple ? 'assets' : 'asset');
    f.assetKind = kind;
    f.multiple = !!opts.multiple;
    if (opts.hint) f.hint = opts.hint;
  });
}

/** 任意可 JSON 序列化的对象 / 数组（用 JSON 文本框编辑） */
export function Json(): FieldDecorator {
  return makeField((f) => {
    setKind(f, 'json');
  });
}

/** 数组（元素用 itemKind 指定的控件渲染；默认按值推断） */
export function List(itemKind?: FieldKind): FieldDecorator {
  return makeField((f) => {
    setKind(f, 'list');
    if (itemKind) f.itemKind = itemKind;
  });
}

/** 交给宿主内置面板渲染（如 'ground' 地皮生成器、'controllers' 控制器列表） */
export function Panel(id: string): FieldDecorator {
  return makeField((f) => {
    setKind(f, 'panel');
    f.panel = id;
  });
}

/** 类注解：组件在属性面板里的标题 / 图标 / 顺序 */
export function Component(name: string, opts: { desc?: string; icon?: string; order?: number } = {}) {
  return (ctor: Function): void => {
    const m = metaOf(ctor);
    m.name = name;
    if (opts.desc) m.desc = opts.desc;
    if (opts.icon) m.icon = opts.icon;
    if (opts.order !== undefined) m.order = opts.order;
  };
}

/** 读取组件的元数据（宿主与属性面板用） */
export function componentMetaOf(ctor: Function): ComponentMeta {
  return metaOf(ctor);
}

/* ------------------------------------------------------------------ */
/* 事件总线                                                            */
/* ------------------------------------------------------------------ */

export type LightEventHandler = (payload?: any) => void;

/**
 * 全局事件总线。脚本里两种写法等价：
 *   Event.emit('角色死亡', { id: this.node.id });
 *   this.emit('角色死亡', { id: this.node.id });
 * 接收方实现 onEvent(type, payload) 或 Event.on(type, fn)。
 */
export class EventBus {
  private handlers = new Map<string, Set<LightEventHandler>>();
  /** 监听所有事件（组件运行时的 onEvent 派发用） */
  private anyHandlers = new Set<(type: string, payload?: unknown) => void>();

  /** 订阅全部事件，回调拿到 (type, payload) */
  onAny(fn: (type: string, payload?: unknown) => void): () => void {
    this.anyHandlers.add(fn);
    return () => this.anyHandlers.delete(fn);
  }

  on(type: string, fn: LightEventHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn);
    return () => this.off(type, fn);
  }

  off(type: string, fn: LightEventHandler): void {
    this.handlers.get(type)?.delete(fn);
  }

  emit(type: string, payload?: unknown): void {
    const set = this.handlers.get(type);
    // 复制一份：回调里可能增删订阅
    for (const fn of [...(set ?? [])]) {
      try {
        fn(payload);
      } catch (e) {
        console.error('[脚本] 事件回调出错：', type, e);
      }
    }
    for (const fn of [...this.anyHandlers]) {
      try {
        fn(type, payload);
      } catch (e) {
        console.error('[脚本] 事件派发出错：', type, e);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
    this.anyHandlers.clear();
  }
}

/** 全局唯一总线 */
export const eventBus = new EventBus();

/** 脚本里可直接用的全局静态对象：Event.emit(type, payload) */
export const Event = {
  emit: (type: string, payload?: unknown): void => eventBus.emit(type, payload),
  on: (type: string, fn: LightEventHandler): (() => void) => eventBus.on(type, fn),
  off: (type: string, fn: LightEventHandler): void => eventBus.off(type, fn),
  clear: (): void => eventBus.clear(),
};

/* ------------------------------------------------------------------ */
/* 组件基类                                                            */
/* ------------------------------------------------------------------ */

/**
 * 运行时相机（播放态由视口提供，编辑态为 null）。
 *
 * 摄像机组件每帧把想要的位姿写进 pose，视口渲染循环读它来摆相机；
 * follow / autoDistance 是视口算好的只读数据，用来做跟随与默认距离。
 * 多个摄像机组件同时存在时用 claimedBy 抢占用权，只有一个生效。
 */
export interface CameraRig {
  /** 相机位姿：注视点（世界坐标）+ 俯仰角 / 环绕角（弧度）+ 到注视点的距离 */
  pose: { x: number; y: number; z: number; pitch: number; yaw: number; distance: number };
  /** 只读：当前跟随目标（运行时玩家）的位置与身高 */
  follow: { x: number; y: number; z: number; height: number };
  /** 只读：按角色身高算出的「能看清角色」的推荐距离 */
  autoDistance: number;
  /** 哪个摄像机节点接管了相机；null = 还没人接管（视口用内置默认） */
  claimedBy: string | null;
}

/** 宿主注入的上下文：脚本通过它访问节点、工程、three 与控制台 */
export interface ComponentContext {
  node: import('../editor/model/types').SceneNode;
  project: import('../editor/model/types').ProjectDoc;
  /** three 场景（编辑器视口 / 运行时） */
  scene: import('three').Scene | null;
  /** three 命名空间，脚本可直接 new this.three.Mesh(...) */
  three: typeof import('three') | null;
  /** 该节点在 three 场景里的锚点对象（可能为 null） */
  object3d: import('three').Object3D | null;
  /** 运行时相机（播放时由视口提供；编辑态为 null）。摄像机组件读写它来摆相机 */
  camera: CameraRig | null;
  log: (...args: unknown[]) => void;
  emit: (type: string, payload?: unknown) => void;
  /** 播放开始至今的秒数；编辑态返回 0 */
  time: () => number;
  /** 按键状态（仅播放态） */
  input?: { isDown(key: string): boolean; pressed(key: string): boolean };
  /** 按名字查场景节点（只读快照） */
  find?: (name: string) => { id: string; name: string; x: number; z: number }[];
  /** 写节点顶层字段（x / z / name / minimapShow / minimapIcon …），会进撤销历史 */
  patchNode: (patch: Record<string, unknown>) => void;
  /** 写角色配置（name / blood / speed / animationId / stateMachineId / controllerIds …） */
  setCharacter: (patch: Record<string, unknown>) => void;
  /** 写地图元素配置（sx / sy / shape / range / size / decorId …） */
  setMapui: (patch: Record<string, unknown>) => void;
  /** true = 运行时播放；false = 编辑态（属性面板驱动） */
  playing: boolean;
}

/**
 * 所有组件脚本的基类。
 * 生命周期钩子都是可选的 —— 只写自己需要的那几个。
 */
export class LightComponent {
  /** 宿主注入，不要自己赋值 */
  ctx!: ComponentContext;

  get node() {
    return this.ctx.node;
  }
  get project() {
    return this.ctx.project;
  }
  get scene() {
    return this.ctx.scene;
  }
  get three() {
    return this.ctx.three;
  }
  /** 该节点在 three 场景里的锚点（可挂模型 / 灯 / 粒子） */
  get object3d() {
    return this.ctx.object3d;
  }
  /** 运行时相机（仅播放态有值）：摄像机组件用它摆画面 */
  get camera() {
    return this.ctx.camera;
  }
  get playing() {
    return this.ctx.playing;
  }

  /** 写日志（播放时进播放日志，编辑态进控制台） */
  log(...args: unknown[]): void {
    this.ctx.log(...args);
  }

  /** 广播事件 */
  emit(type: string, payload?: unknown): void {
    this.ctx.emit(type, payload);
  }

  /** 写节点顶层字段（位置 / 名称 / 小地图开关…） */
  setNode(patch: Record<string, unknown>): void {
    this.ctx.patchNode(patch);
  }

  /** 写角色配置（只有角色节点有） */
  setCharacter(patch: Record<string, unknown>): void {
    this.ctx.setCharacter(patch);
  }

  /** 写地图元素配置（只有地图元素节点有） */
  setMapui(patch: Record<string, unknown>): void {
    this.ctx.setMapui(patch);
  }

  /** 订阅事件（返回取消函数） */
  on(type: string, fn: LightEventHandler): () => void {
    return Event.on(type, fn);
  }

  /**
   * 挂载后立刻调用一次（编辑态与播放态都会调用）。
   * 用来把节点上已有的数据（位置 / 角色数值 / 小地图设置…）灌进字段，
   * 这样属性面板显示的是真实值，而不是脚本里的默认值。
   */
  onMount?(): void;
  /** 播放开始（编辑态不会调用） */
  onStart?(): void;
  /** 每帧（编辑态不会调用） */
  onUpdate?(dt: number): void;
  /**
   * 收到事件。type = 事件名，payload = 数据（可能没有）。
   * 与 Event.emit / this.emit 配对。
   */
  onEvent?(type: string, payload?: any): void;
  /** 播放结束 / 组件卸载 */
  onDestroy?(): void;
  /** 字段值被属性面板改动后调用（可选，用于把值同步到 three 对象） */
  onFieldChange?(key: string, value: unknown): void;
}

/** 宿主侧读取一个组件实例的可见字段（按声明顺序排好） */
export function visibleFieldsOf(instance: object, meta: ComponentMeta): FieldMeta[] {
  const order = new Map<string, number>();
  let i = 0;
  for (const k of Object.keys(instance)) order.set(k, i++);
  return meta.fields
    .filter((f) => !f.hidden)
    .map((f, idx) => ({ f, idx }))
    .sort((a, b) => {
      const oa = a.f.order !== undefined ? a.f.order : order.get(a.f.key) ?? a.idx;
      const ob = b.f.order !== undefined ? b.f.order : order.get(b.f.key) ?? b.idx;
      return oa - ob;
    })
    .map((x) => x.f);
}

/** 分组排序后的可见字段：Map<组名, 字段[]>（按 groupOrder 排） */
export function groupedFieldsOf(instance: object, meta: ComponentMeta): { group: string; order: number; fields: FieldMeta[] }[] {
  const fields = visibleFieldsOf(instance, meta);
  const groups = new Map<string, { group: string; order: number; fields: FieldMeta[] }>();
  for (const f of fields) {
    let g = groups.get(f.group);
    if (!g) {
      g = { group: f.group, order: f.groupOrder, fields: [] };
      groups.set(f.group, g);
    }
    g.fields.push(f);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}

/** 按默认值推断控件类型（没写控件注解时用） */
export function inferKind(value: unknown): FieldKind {
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'list';
  if (value !== null && typeof value === 'object') return 'json';
  return 'string';
}
