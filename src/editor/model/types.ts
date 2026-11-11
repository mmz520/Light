/**
 * 编辑器数据模型
 *
 * 工程 = 一个文件夹，固定三种文件：
 *   metadata.json                 索引（所有资产的清单 + 工程信息）
 *   assets/images/<id>.png        图片本体
 *   assets/textures/<id>.json     贴图资产
 *   assets/animations/<id>.json   动画资产
 *
 * 资产与文件不是一一对应：
 *   图片 1 个文件 → 1 个资产
 *   贴图 1 个 json → 引用 1 张（单向）或最多 4 张（四向）图片
 *   动画 1 个 json → 引用若干贴图（每个节点 1 张 + 覆盖物）
 */

import type { Clip } from '../../animator/types';
import type { GroundConfig } from './ground';

export type AssetKind = 'image' | 'texture' | 'animation' | 'statemachine' | 'controller' | 'script';

/**
 * 目录能装的东西 = 资产 + 三种场景实体。
 * 场景实体（角色 / 敌人 / 地面覆盖物）目前只占住目录，还没有具体资产结构，
 * 先让固定目录在元数据里存在，后面的实体模板直接挂进这三个目录。
 */
export type FolderKind = AssetKind | 'character' | 'enemy' | 'cover';

/**
 * 资产所属"文件夹"（虚拟分组）。
 * 只是 metadata.json 里的一个名称字段 —— 磁盘上并没有真的建这些文件夹，
 * 所有图片仍然在同目录 assets/images 下。
 */
export const DEFAULT_FOLDER = '默认';

/** 第一层目录固定，不允许增删（顺序即显示顺序）。
 *  命名约定：贴图 = 单张贴图（图片文件）；图组 = 一组贴图的配置（四向/裁剪等）。 */
export const FIXED_FOLDERS: { name: string; kind: FolderKind }[] = [
  { name: '贴图', kind: 'image' },
  { name: '图组', kind: 'texture' },
  { name: '动画', kind: 'animation' },
  { name: '状态机', kind: 'statemachine' },
  { name: '控制器', kind: 'controller' },
  { name: '脚本', kind: 'script' },
  { name: '角色', kind: 'character' },
  { name: '敌人', kind: 'enemy' },
  { name: '地面覆盖物', kind: 'cover' },
];

/** 资产类型 → 它所属的固定目录名 */
export const FOLDER_OF_KIND: Record<AssetKind, string> = {
  image: '贴图',
  texture: '图组',
  animation: '动画',
  statemachine: '状态机',
  controller: '控制器',
  script: '脚本',
};

/** 老工程根目录名 → 新名（图片→贴图、贴图→图组） */
export const LEGACY_FOLDER_RENAME: Record<string, string> = {
  图片: '贴图',
  贴图: '图组',
};

/** 目录路径迁移：只换第一层根名，子路径原样保留（'图片/角色'→'贴图/角色'） */
export function migrateFolderPath(path: string): string {
  const parts = path.split('/');
  const mapped = LEGACY_FOLDER_RENAME[parts[0]];
  if (!mapped) return path;
  parts[0] = mapped;
  return parts.join('/');
}

/** 四方向：下 / 右 / 上 / 左 */
export type Dir = 'S' | 'E' | 'N' | 'W';
export const DIRS: Dir[] = ['S', 'E', 'N', 'W'];
export const DIR_LABEL: Record<Dir, string> = { S: '下', E: '右', N: '上', W: '左' };
export const DIR_HINT: Record<Dir, string> = {
  S: '朝向镜头（正面）',
  E: '朝向屏幕右侧（侧面）',
  N: '背对镜头（背面）',
  W: '朝向屏幕左侧（侧面）',
};

/** 图片裁剪（原图像素坐标；null = 用整张图） */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ------------------------------------------------------------------ */
/* 图片                                                                */
/* ------------------------------------------------------------------ */

export interface ImageAsset {
  id: string;
  name: string;
  /** 虚拟目录路径（不是磁盘目录） */
  folder: string;
  /** 相对工程根的 posix 路径，如 assets/images/img_ab12.png */
  file: string;
  /** 原图像素尺寸 */
  width: number;
  height: number;
  /** 非破坏性裁剪 */
  crop: CropRect | null;
  /** 平铺拉伸策略：default = 直接平铺（现状）；aspect = 平铺时保持原图形状不变形；nine = 九宫格 */
  tiling?: ImageTiling;
  /** 九宫格四条线（归一化 0~1，相对裁剪后图片）：线条外的边缘区在平铺/拉伸时不变形 */
  nine?: ImageNine | null;
  createdAt: number;
}

export type ImageTiling = 'default' | 'aspect' | 'nine';

export interface ImageNine {
  /** 左线 / 上线 / 右线 / 下线，距对应边的归一化距离 */
  l: number;
  t: number;
  r: number;
  b: number;
}

/** 归一化图片属性：老工程没有 tiling / nine 字段，补上默认值 */
export function normalizeImageTiling(img: Partial<ImageAsset>): { tiling: ImageTiling; nine: ImageNine | null } {
  const tiling: ImageTiling = img.tiling === 'aspect' || img.tiling === 'nine' ? img.tiling : 'default';
  const n = img.nine;
  const nine =
    n && [n.l, n.t, n.r, n.b].every((v) => Number.isFinite(v) && v >= 0 && v <= 0.45)
      ? { l: n.l, t: n.t, r: n.r, b: n.b }
      : tiling === 'nine'
        ? { l: 0.25, t: 0.25, r: 0.25, b: 0.25 }
        : null;
  return { tiling, nine };
}

/** 裁剪后的像素尺寸 */
export function croppedSize(img: ImageAsset): { w: number; h: number } {
  const c = img.crop;
  if (!c) return { w: img.width, h: img.height };
  return { w: Math.max(1, c.w), h: Math.max(1, c.h) };
}

/**
 * 裁剪 → 归一化 UV（three.js 用；原点在左下角）。
 * 返回 { u, v, w, h }，配合 texture.offset / repeat 使用。
 */
export function cropToUv(img: ImageAsset): { u: number; v: number; w: number; h: number } | null {
  const c = img.crop;
  if (!c || img.width <= 0 || img.height <= 0) return null;
  const w = c.w / img.width;
  const h = c.h / img.height;
  return { u: c.x / img.width, v: 1 - (c.y + c.h) / img.height, w, h };
}

/* ------------------------------------------------------------------ */
/* 贴图                                                                */
/* ------------------------------------------------------------------ */

/** 单向：一张图，不区分方向；四向：S/E/N/W 各一张 */
export type TextureTemplate = 'single' | 'four';

export interface TextureTemplateMeta {
  id: TextureTemplate;
  name: string;
  desc: string;
}

export const TEXTURE_TEMPLATES: TextureTemplateMeta[] = [
  { id: 'single', name: '单向图组', desc: '一张贴图通用，常用于武器、手套等不区分朝向的部件' },
  { id: 'four', name: '四向图组', desc: 'S / E / N / W 各一张贴图，用于角色头、帽子、背包等' },
];

export interface TextureAsset {
  id: string;
  name: string;
  /** 虚拟目录路径（不是磁盘目录） */
  folder: string;
  template: TextureTemplate;
  /** 单向模板使用；四向时忽略 */
  image: string | null;
  /** 四向模板使用；单向时忽略 */
  dirs: Record<Dir, string | null>;
  createdAt: number;
}

export function emptyDirs(): Record<Dir, string | null> {
  return { S: null, E: null, N: null, W: null };
}

/** 贴图在某方向上的图片 id（单向模板忽略方向） */
export function textureImageFor(tex: TextureAsset, dir: Dir): string | null {
  if (tex.template === 'single') return tex.image;
  return tex.dirs[dir] ?? null;
}

/** 该贴图是否已配置足够（至少一张图） */
export function textureFilled(tex: TextureAsset): boolean {
  if (tex.template === 'single') return !!tex.image;
  return DIRS.some((d) => !!tex.dirs[d]);
}

/* ------------------------------------------------------------------ */
/* 动画                                                                */
/* ------------------------------------------------------------------ */

/** 骨架模板（与 skill 的 templates.json 对应） */
export type SkeletonId = 'humanoid10' | 'humanoid5' | 'beast5' | 'custom';

export interface SkeletonMeta {
  id: SkeletonId;
  name: string;
  desc: string;
}

export const SKELETON_TEMPLATES: SkeletonMeta[] = [
  { id: 'humanoid10', name: '10 关节人形', desc: '有肘有膝的完整人形：角色、精英怪、BOSS' },
  { id: 'humanoid5', name: '5 关节人形', desc: '一段式四肢的小体型人形怪' },
  { id: 'beast5', name: '5 关节兽形', desc: '四足兽（犬 / 猪 / 虫），一段式四腿' },
  { id: 'custom', name: '自定义空白', desc: '只给一根躯干，节点自行添加' },
];

export interface AnimNodeOverlay {
  id: string;
  textureId: string | null;
  /** 纯色（textureId 为空时生效，与贴图互斥） */
  textureColor?: string | null;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  rot: number;
  scale: number;
  /** null = 压在所属节点之上 */
  zIndex: number | null;
}

/** 动画节点（骨架关节或挂在关节上的附加件） */
export interface AnimNode {
  id: string;
  label: string;
  parent: string | null;
  /** 图像槽位：同 slot 的节点在派生时共享"素体"判定 */
  slot: string;
  pivot: 'top' | 'bottom' | 'center' | 'left';
  /** 渲染层级，大的在上 */
  z: number;
  /** 基准布局（世界单位；x/y 相对父节点中心） */
  layout: { x: number; y: number; h: number };
  /** 由骨架声明的镜像节点（贴图左右翻转） */
  mirror: boolean;
  /** 共用贴图时的缩放系数（前臂/小腿 0.85） */
  scale: number;
  /** 节点主贴图（贴图资产 id） */
  textureId: string | null;
  /** 纯色（textureId 为空时生效，与贴图互斥） */
  textureColor?: string | null;
  /** 覆盖物贴图（贴图资产 id） */
  overlay: AnimNodeOverlay | null;
  /** 素体节点：派生新动画时保留其贴图 */
  body: boolean;
}

export interface AnimationAsset {
  id: string;
  name: string;
  /** 虚拟目录路径（不是磁盘目录） */
  folder: string;
  template: SkeletonId;
  /** 编辑帧率（时间轴吸附用） */
  fps: number;
  nodes: AnimNode[];
  /** 片段名 → 片段（复用 animator 的 Clip 结构） */
  clips: Record<string, Clip>;
  createdAt: number;
}

/** 动画动作预设（新增片段时的默认时长与循环方式） */
export const CLIP_PRESETS = [
  { name: 'idle', duration: 2.0, loop: 'loop' as const, label: '待机' },
  { name: 'walk', duration: 0.8, loop: 'loop' as const, label: '行走' },
  { name: 'attack', duration: 0.6, loop: 'once' as const, label: '攻击' },
  { name: 'hit', duration: 0.4, loop: 'once' as const, label: '受击' },
  { name: 'death', duration: 1.2, loop: 'once' as const, label: '死亡' },
];

/* ------------------------------------------------------------------ */
/* 角色                                                                */
/* ------------------------------------------------------------------ */

/** 角色数值字段（也是状态机条件里可以比较的量） */
export type CharacterStatKey = 'blood' | 'satiation' | 'mental' | 'speed' | 'attack';

export interface CharacterStatMeta {
  key: CharacterStatKey;
  name: string;
  min: number;
  max: number;
  step: number;
  hint: string;
}

export const CHARACTER_STATS: CharacterStatMeta[] = [
  { key: 'blood', name: '血量', min: 0, max: 1000, step: 1, hint: '归零即死亡（受击扣血等行为后续接）' },
  { key: 'satiation', name: '饥饿', min: 0, max: 1000, step: 1, hint: '归零开始掉血' },
  { key: 'mental', name: '理智', min: 0, max: 1000, step: 1, hint: '过低触发精神类行为' },
  { key: 'speed', name: '移速', min: 0, max: 20, step: 0.1, hint: '世界单位 / 秒，行走状态按它前进' },
  { key: 'attack', name: '攻击', min: 0, max: 1000, step: 1, hint: '伤害基数' },
];

/** 运行时标志位：状态机条件里当布尔量用（后续行为扩展往这里加） */
export interface CharacterFlagMeta {
  key: string;
  name: string;
}

export const CHARACTER_FLAGS: CharacterFlagMeta[] = [
  { key: 'moving', name: '有移动输入' },
  { key: 'attacking', name: '正在攻击' },
  { key: 'hurt', name: '受击' },
  { key: 'dead', name: '死亡' },
  { key: 'casting', name: '释放技能' },
];

/** 角色配置（挂在角色场景对象上） */
export interface CharacterConfig {
  /** 名字（可留空，回落到场景对象名） */
  name: string;
  blood: number;
  satiation: number;
  mental: number;
  speed: number;
  attack: number;
  /** 默认动画：状态里没单独指定时用它 */
  animationId: string | null;
  /** 状态机资产 id */
  stateMachineId: string | null;
  /** 控制器资产 id 列表（可以有多个：移动 + 战斗 + 菜单…运行时全部生效） */
  controllerIds: string[];
}

export function defaultCharacter(): CharacterConfig {
  return {
    name: '',
    blood: 100,
    satiation: 100,
    mental: 100,
    speed: 1,
    attack: 50,
    animationId: null,
    stateMachineId: null,
    controllerIds: [],
  };
}

/** 读盘兜底：老工程没有 character 字段；数值非法就回默认，别让 UI 拿到 NaN */
export function normalizeCharacter(raw: Partial<CharacterConfig> | null | undefined): CharacterConfig {
  const base = defaultCharacter();
  if (!raw) return base;
  const num = (v: unknown, fallback: number, meta?: CharacterStatMeta): number => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    if (!meta) return n;
    return Math.min(meta.max, Math.max(meta.min, n));
  };
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    blood: num(raw.blood, base.blood, CHARACTER_STATS[0]),
    satiation: num(raw.satiation, base.satiation, CHARACTER_STATS[1]),
    mental: num(raw.mental, base.mental, CHARACTER_STATS[2]),
    speed: num(raw.speed, base.speed, CHARACTER_STATS[3]),
    attack: num(raw.attack, base.attack, CHARACTER_STATS[4]),
    animationId: typeof raw.animationId === 'string' && raw.animationId ? raw.animationId : null,
    stateMachineId: typeof raw.stateMachineId === 'string' && raw.stateMachineId ? raw.stateMachineId : null,
    controllerIds: Array.isArray(raw.controllerIds) ? raw.controllerIds.filter((v): v is string => typeof v === 'string' && !!v) : [],
  };
}

/* ------------------------------------------------------------------ */
/* 控制器                                                              */
/* ------------------------------------------------------------------ */

/**
 * 控制器 = 角色身上的一层「输入 → 变量」逻辑，和状态机解耦：
 *   按键事件改变量（+1 / -1 / = 1 …），状态机只读变量做比较。
 * 这样加技能 / 攻击 / 菜单只需要加控制器和状态机，不用改代码。
 */

/** 赋值运算符：= 覆盖，其余在原值上计算 */
export type CtrlOp = '=' | '+' | '-' | '*' | '/';

export const CTRL_OPS: { key: CtrlOp; name: string; hint: string }[] = [
  { key: '=', name: '=', hint: '直接赋值为这个数' },
  { key: '+', name: '+', hint: '在原值上加' },
  { key: '-', name: '-', hint: '在原值上减' },
  { key: '*', name: '×', hint: '乘以这个数' },
  { key: '/', name: '÷', hint: '除以这个数' },
];

/** 触发方式（修饰键 ctrl/shift/alt 单独开关，可以和任意触发方式组合） */
export type CtrlTrigger = 'down' | 'up' | 'double' | 'longpress';

export const CTRL_TRIGGERS: { key: CtrlTrigger; name: string; hint: string }[] = [
  { key: 'down', name: '按下', hint: '按下瞬间触发一次' },
  { key: 'up', name: '弹起', hint: '松开瞬间触发一次' },
  { key: 'double', name: '双击', hint: '0.3 秒内连按两下' },
  { key: 'longpress', name: '长按', hint: '按住超过 0.4 秒触发一次' },
];

/** 控制器变量：运行时是一个数字，状态机拿它做比较 */
export interface CtrlVariable {
  id: string;
  /** 变量名（状态机条件里显示它） */
  name: string;
  /** 初始值 */
  init: number;
}

/** 一条按键事件：按键 + 触发方式 → 改某个变量 */
export interface CtrlBinding {
  id: string;
  /** CONTROLLER_KEYS 里的 key（键盘 'KeyW'，鼠标 'mouse:left'） */
  key: string;
  trigger: CtrlTrigger;
  /** 修饰键要求：为 true 时必须同时按住 */
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** 目标变量 id */
  variableId: string;
  op: CtrlOp;
  /** 运算数 */
  value: number;
  /** 下限（null = 不限制） */
  min: number | null;
  /** 上限（null = 不限制） */
  max: number | null;
}

export interface ControllerAsset {
  id: string;
  name: string;
  folder: string;
  vars: CtrlVariable[];
  bindings: CtrlBinding[];
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* 脚本                                                                */
/* ------------------------------------------------------------------ */

/**
 * JS 脚本资产（W3）。
 * 一份脚本 = 一段 JS 源码，通过定义生命周期钩子参与运行时：
 *   function onStart(self, Light) {}   播放开始（每实例一次）
 *   function onUpdate(self, Light, dt) {}  每帧
 *   function onEvent(self, Light, name, data) {}  收到信号
 *   function onDestroy(self, Light) {}  播放结束（每实例一次）
 * 编辑态绝不执行脚本，只做语法检查；运行态在受限环境里实例化。
 */
export interface ScriptAsset {
  id: string;
  name: string;
  folder: string;
  /** 脚本源码 */
  code: string;
  createdAt: number;
}

/** 文件名安全化：脚本名 → 磁盘上的 .js 基名（路径非法字符换成下划线） */
export function sanitizeFileBase(name: string): string {
  const base = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  return base || '脚本';
}

/**
 * 脚本源码在工程里的相对路径（assets/scripts/<名字>.js）。
 * 脚本名在工程内唯一（renameAsset 保证），这里再按基名兜底去重， VS Code 里能按名字认文件。
 */
export function scriptFileOf(scripts: { id: string; name: string }[], s: { id: string; name: string }): string {
  const base = sanitizeFileBase(s.name);
  const taken = new Set(scripts.filter((x) => x.id !== s.id).map((x) => sanitizeFileBase(x.name).toLowerCase()));
  let name = base;
  let i = 2;
  while (taken.has(name.toLowerCase())) {
    name = `${base}-${i}`;
    i += 1;
  }
  return `${FOLDERS.scripts}/${name}.js`;
}

/** v1 内置脚本模板（新建脚本时给一份可运行的骨架，降低上手门槛） */
export const SCRIPT_TEMPLATE = `// 脚本以「钩子函数」参与运行时，不用的钩子删掉即可。
// self  = 挂载本脚本的场景对象（x / z / face / name / vars）
// Light = 全局 API（log / input / emit / on / time / find）
// 完整 API 速查见编辑器右侧面板。

function onStart(self, Light) {
  Light.log(self.name + ' 上线');
}

function onUpdate(self, Light, dt) {
  // 每帧调用；dt 是这一帧的秒数。
  // 示例：按住 W 时向上走（取消注释即可生效）
  // if (Light.input.isDown('KeyW')) self.z -= dt * 2;
}

function onEvent(self, Light, name, data) {
  // Light.emit('xxx', {...}) 发出的信号会送到这里
}

function onDestroy(self, Light) {
  // 播放结束、实例销毁时调用
}
`;

/** 键位表分组 */
export type CtrlKeyGroup = '移动键' | '字母' | '数字' | '功能键' | '符号' | '鼠标';

export interface CtrlKeyOption {
  key: string;
  name: string;
  group: CtrlKeyGroup;
}

const KB = (key: string, name: string, group: CtrlKeyGroup): CtrlKeyOption => ({ key, name, group });

/** 全量键位表：键盘字母 / 数字 / 功能键 / 方向 / 符号 + 鼠标五个键 */
export const CONTROLLER_KEYS: CtrlKeyOption[] = [
  // 移动键放最前面，最常用
  KB('KeyW', 'W', '移动键'),
  KB('KeyA', 'A', '移动键'),
  KB('KeyS', 'S', '移动键'),
  KB('KeyD', 'D', '移动键'),
  KB('ArrowUp', '↑ 上', '移动键'),
  KB('ArrowDown', '↓ 下', '移动键'),
  KB('ArrowLeft', '← 左', '移动键'),
  KB('ArrowRight', '→ 右', '移动键'),
  ...Array.from({ length: 26 }, (_, i) => {
    const ch = String.fromCharCode(65 + i);
    return KB(`Key${ch}`, ch, '字母' as CtrlKeyGroup);
  }),
  ...Array.from({ length: 10 }, (_, i) => KB(`Digit${i}`, `${i}`, '数字')),
  ...Array.from({ length: 12 }, (_, i) => KB(`F${i + 1}`, `F${i + 1}`, '功能键')),
  KB('Space', '空格', '功能键'),
  KB('Enter', '回车', '功能键'),
  KB('Escape', 'Esc', '功能键'),
  KB('Tab', 'Tab', '功能键'),
  KB('Backspace', '退格', '功能键'),
  KB('ShiftLeft', 'Shift', '功能键'),
  KB('ControlLeft', 'Ctrl', '功能键'),
  KB('AltLeft', 'Alt', '功能键'),
  KB('Minus', '-', '符号'),
  KB('Equal', '=', '符号'),
  KB('BracketLeft', '[', '符号'),
  KB('BracketRight', ']', '符号'),
  KB('Semicolon', ';', '符号'),
  KB('Quote', "'", '符号'),
  KB('Comma', ',', '符号'),
  KB('Period', '.', '符号'),
  KB('Slash', '/', '符号'),
  KB('Backslash', '\\', '符号'),
  KB('Backquote', '`', '符号'),
  KB('mouse:left', '鼠标左键', '鼠标'),
  KB('mouse:right', '鼠标右键', '鼠标'),
  KB('mouse:middle', '鼠标中键', '鼠标'),
  KB('mouse:wheelUp', '滚轮上滚', '鼠标'),
  KB('mouse:wheelDown', '滚轮下滚', '鼠标'),
];

/** 键位分组顺序（选择器里按这个分组显示） */
export const CTRL_KEY_GROUPS: CtrlKeyGroup[] = ['移动键', '字母', '数字', '功能键', '符号', '鼠标'];

export function ctrlKeyName(key: string): string {
  return CONTROLLER_KEYS.find((k) => k.key === key)?.name ?? key;
}

export function ctrlTriggerName(t: CtrlTrigger): string {
  return CTRL_TRIGGERS.find((x) => x.key === t)?.name ?? t;
}

export function ctrlOpName(op: CtrlOp): string {
  return CTRL_OPS.find((x) => x.key === op)?.name ?? op;
}

/** 新建变量的默认名字 */
export function defaultVariable(index: number): CtrlVariable {
  return { id: shortId('v'), name: `var${index + 1}`, init: 0 };
}

export function defaultBinding(variableId: string): CtrlBinding {
  return {
    id: shortId('b'),
    key: 'KeyW',
    trigger: 'down',
    ctrl: false,
    shift: false,
    alt: false,
    variableId,
    op: '+',
    value: 1,
    min: null,
    max: null,
  };
}

/** 一条绑定 → 一句话（资源浏览器 / 列表里用） */
export function bindingText(b: CtrlBinding, vars: CtrlVariable[]): string {
  const mods = `${b.ctrl ? 'Ctrl+' : ''}${b.shift ? 'Shift+' : ''}${b.alt ? 'Alt+' : ''}`;
  const name = vars.find((v) => v.id === b.variableId)?.name ?? '（未选变量）';
  const range = b.min === null && b.max === null ? '' : ` [${b.min ?? '-∞'}, ${b.max ?? '+∞'}]`;
  return `${mods}${ctrlKeyName(b.key)} ${ctrlTriggerName(b.trigger)} → ${name} ${ctrlOpName(b.op)} ${b.value}${range}`;
}

/* ------------------------------------------------------------------ */
/* 状态机                                                              */
/* ------------------------------------------------------------------ */

/** 条件种类 */
export type SmConditionKind = SmCondition['kind'];

/** 比较运算符 */
export type SmCompareOp = '>' | '>=' | '<' | '<=' | '==' | '!=';

export const SM_COMPARE_OPS: SmCompareOp[] = ['>', '>=', '<', '<=', '==', '!='];

/**
 * 变量比较运算符（状态机条件的标准写法）：
 * 变量来自角色绑定的控制器，> = < 三种就够描述「移动中输入 > 0」「松开 = 0」这类流转。
 */
export type SmVarOp = '>' | '=' | '<';

export const SM_VAR_OPS: { key: SmVarOp; name: string; hint: string }[] = [
  { key: '>', name: '>', hint: '变量大于标准值' },
  { key: '=', name: '=', hint: '变量等于标准值' },
  { key: '<', name: '<', hint: '变量小于标准值' },
];

/* ---- 输入事件条件（条件列表的最小单元）---- */

/** 事件来源：键盘 / 鼠标 / 无输入（没有任何输入，用于"松手回待机"这类条件） */
export type SmInputDevice = 'keyboard' | 'mouse' | 'none';

/** 事件动作 */
export type SmInputAction = 'down' | 'up' | 'held' | 'longpress' | 'double';

export const SM_INPUT_DEVICES: { key: SmInputDevice; name: string }[] = [
  { key: 'keyboard', name: '键盘事件' },
  { key: 'mouse', name: '鼠标事件' },
  { key: 'none', name: '无输入' },
];

export const SM_INPUT_ACTIONS: { key: SmInputAction; name: string; hint: string }[] = [
  { key: 'down', name: '按下', hint: '按下瞬间成立一帧' },
  { key: 'up', name: '弹起', hint: '松开瞬间成立一帧' },
  { key: 'held', name: '按住', hint: '按住期间持续成立（行走靠这个）' },
  { key: 'longpress', name: '长按', hint: '按住超过 0.4 秒成立一次' },
  { key: 'double', name: '双击', hint: '0.3 秒内连按两下' },
];

/** 键盘可选键；key 用 KeyboardEvent.code，'move' 是「任意移动键」预设 */
export const SM_KEY_OPTIONS: { key: string; name: string }[] = [
  { key: 'move', name: '任意移动键（WASD / 方向键）' },
  { key: 'KeyW', name: 'W' },
  { key: 'KeyA', name: 'A' },
  { key: 'KeyS', name: 'S' },
  { key: 'KeyD', name: 'D' },
  { key: 'ArrowUp', name: '↑ 上方向键' },
  { key: 'ArrowDown', name: '↓ 下方向键' },
  { key: 'ArrowLeft', name: '← 左方向键' },
  { key: 'ArrowRight', name: '→ 右方向键' },
  { key: 'Space', name: '空格' },
  { key: 'ShiftLeft', name: 'Shift' },
  { key: 'ControlLeft', name: 'Ctrl' },
  { key: 'KeyE', name: 'E' },
  { key: 'KeyQ', name: 'Q' },
  { key: 'KeyR', name: 'R' },
  { key: 'KeyF', name: 'F' },
  { key: 'Digit1', name: '1' },
  { key: 'Digit2', name: '2' },
  { key: 'Digit3', name: '3' },
  { key: 'Digit4', name: '4' },
  { key: 'Escape', name: 'Esc' },
  { key: 'Enter', name: '回车' },
];

/** 鼠标可选键（滚轮单独作为两个"键"，动作给按下即可） */
export const SM_MOUSE_BUTTONS: { key: string; name: string }[] = [
  { key: 'left', name: '左键' },
  { key: 'right', name: '右键' },
  { key: 'middle', name: '中键' },
  { key: 'wheelUp', name: '滚轮上滚' },
  { key: 'wheelDown', name: '滚轮下滚' },
];

/** 一条输入事件：设备 + 键 + 动作 */
export interface SmInputEvent {
  device: SmInputDevice;
  /** keyboard 用（KeyboardEvent.code，或 'move' 预设）；mouse/none 忽略 */
  key: string;
  /** mouse 用（left / right / middle / wheelUp / wheelDown）；其它忽略 */
  button: string;
  action: SmInputAction;
}

export function defaultInput(): SmInputEvent {
  return { device: 'keyboard', key: 'KeyW', button: 'left', action: 'down' };
}

/** 把一条输入事件压成唯一标识，运行时用作事件表的 key */
export function inputEventId(e: SmInputEvent): string {
  if (e.device === 'none') return 'none';
  const target = e.device === 'keyboard' ? e.key : e.button;
  return `${e.device}:${target}:${e.action}`;
}

/**
 * 流转条件：
 *   var    变量比较：控制器变量 moveX > 0（状态机条件的主写法）
 *   group  与 / 或，装任意多个子条件（多条条件是且的关系 = op:'and' 的 group）
 *   not    取反
 *   input  兼容早期版本：一条输入事件（键盘 W 按下 / 无输入）
 *   stat   兼容早期版本：角色数值比较 blood > 20
 *   flag   兼容早期版本：标志位
 */
export type SmCondition =
  | { kind: 'var'; varId: string; op: SmVarOp; value: number }
  | { kind: 'group'; op: 'and' | 'or'; items: SmCondition[] }
  | { kind: 'not'; item: SmCondition }
  | { kind: 'input'; input: SmInputEvent }
  | { kind: 'stat'; key: CharacterStatKey; op: SmCompareOp; value: number }
  | { kind: 'flag'; key: string; value: boolean };

/** 状态（流程图的节点）：一个状态 = 一段可循环的动画 + 移动方式 */
export interface SmState {
  id: string;
  name: string;
  /** 流程图坐标 */
  x: number;
  y: number;
  /** 动画资产 id（null = 用角色默认动画） */
  animationId: string | null;
  /** 动画片段名（walk / idle / attack…）；null = 第一个片段 */
  clip: string | null;
  /** 这个状态下的位移方式：forward = 按角色移速朝当前朝向走 */
  move: 'none' | 'forward';
  /** 初始状态（有且建议只有一个） */
  entry: boolean;
  /** 状态卡片颜色（可选，纯展示） */
  color?: string | null;
  desc?: string;
}

/** 流转（流程图的连线）：条件满足就切到目标状态 */
export interface SmTransition {
  id: string;
  from: string;
  to: string;
  /** null = 无条件，进入源状态的下一帧立刻切走 */
  condition: SmCondition | null;
}

export interface StateMachineAsset {
  id: string;
  name: string;
  folder: string;
  /**
   * 条件里的变量取自哪个控制器。
   * null = 运行时用「引用这台状态机的角色」绑定的第一个控制器（常见做法）。
   */
  controllerId: string | null;
  states: SmState[];
  transitions: SmTransition[];
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* 场景对象                                                            */
/* ------------------------------------------------------------------ */

/**
 * 场景里的对象类型。空节点只是分组用的容器，其余四种才是世界里真实存在的东西。
 * 对象之间靠 parentId / order 组成一棵树 —— 既能改顺序，也能改层级。
 */
export type SceneKind = 'group' | 'ground' | 'cover' | 'enemy' | 'character' | 'mapui' | 'time' | 'weather' | 'camera';

/** 地图元素（屏幕 UI）的参数 */
export interface MapUiConfig {
  /**
   * 显示范围档位：玩家离这个元素多远时才显示。
   * always = 永远显示；near / mid / far 对应 6 / 14 / 26 世界单位。
   * 这是运行时可见性逻辑 —— 编辑器里永远显示，不在 3D 空间里预览。
   */
  range: 'always' | 'near' | 'mid' | 'far';
  /** 框的形状 */
  shape: 'circle' | 'rect';
  /** 框大小（屏幕像素，宽 = 高） */
  size: number;
  /** 屏幕位置（像素）：框左上角在视口里的坐标，跟 3D 空间无关 */
  sx: number;
  sy: number;
  /** 装饰贴图（「贴图」目录的图片资产 id）：沿框边装饰；null = 用纯色 / 内置样式 */
  decorId: string | null;
  /** 装饰纯色（没选贴图时用作框线颜色；选了贴图时忽略） */
  decorColor?: string | null;
  /** true = 沿框边环绕拼接；false/undefined = 整张图铺满这个框（拉伸策略生效，默认，圆环就是一个环） */
  decorLoop?: boolean;
}

export const MAPUI_RANGE_STEPS: { id: MapUiConfig['range']; name: string; radius: number }[] = [
  { id: 'always', name: '始终', radius: Infinity },
  { id: 'near', name: '近', radius: 6 },
  { id: 'mid', name: '中', radius: 14 },
  { id: 'far', name: '远', radius: 26 },
];

export function defaultMapui(): MapUiConfig {
  // 边框默认「单张」：一张圆环图铺满整个框，正好套一圈；重复拼接会变成好几圈
  return { range: 'mid', shape: 'circle', size: 200, sx: 24, sy: 24, decorId: null, decorColor: null, decorLoop: false };
}

/** 读盘兜底 */
export function normalizeMapui(raw: Partial<MapUiConfig> | null | undefined): MapUiConfig {
  const base = defaultMapui();
  if (!raw) return base;
  // 老版本 size 是世界单位（1.5~40）：按 1 单位 ≈ 24px 迁移成屏幕像素
  const rawSize = Number(raw.size);
  const size = Number.isFinite(rawSize) ? Math.min(640, Math.max(48, rawSize <= 40 ? rawSize * 24 : rawSize)) : base.size;
  return {
    range: MAPUI_RANGE_STEPS.some((s) => s.id === raw.range) ? (raw.range as MapUiConfig['range']) : base.range,
    shape: raw.shape === 'rect' ? 'rect' : 'circle',
    size,
    sx: Number.isFinite(raw.sx) ? Math.min(8000, Math.max(-2000, Number(raw.sx))) : base.sx,
    sy: Number.isFinite(raw.sy) ? Math.min(8000, Math.max(-2000, Number(raw.sy))) : base.sy,
    decorId: typeof raw.decorId === 'string' && raw.decorId ? raw.decorId : null,
    decorColor: typeof raw.decorColor === 'string' && raw.decorColor ? raw.decorColor : null,
    decorLoop: raw.decorLoop === true,
  };
}

export interface SceneKindMeta {
  id: SceneKind;
  name: string;
  /** 新建时的名字前缀 */
  baseName: string;
  color: string;
  desc: string;
  /** 是否为新对象在场景里画实体标记（空节点不占空间） */
  solid: boolean;
}

export const SCENE_KINDS: SceneKindMeta[] = [
  { id: 'group', name: '空节点', baseName: '空节点', color: '#9a8b78', desc: '只用来分组归纳，本身不画东西', solid: false },
  { id: 'ground', name: '地面', baseName: '地面', color: '#a98452', desc: '一块可站立的地皮', solid: true },
  { id: 'cover', name: '地面覆盖物', baseName: '覆盖物', color: '#7f9a6a', desc: '草丛 / 石头 / 花，摆在地面上', solid: true },
  { id: 'enemy', name: '敌人', baseName: '敌人', color: '#c4553f', desc: '会主动攻击的生物', solid: true },
  { id: 'character', name: '角色', baseName: '角色', color: '#8ba4bd', desc: '玩家可以操作的角色', solid: true },
  { id: 'mapui', name: '地图元素', baseName: '地图元素', color: '#c9a35c', desc: '屏幕 UI：小地图框、罗盘、区域标题', solid: false },
  // 摄像头：占位节点，运行时相机跟随角色；参数（跟随目标 / 角度 / 距离）后续接
  { id: 'camera', name: '摄像头', baseName: '摄像头', color: '#7fb0a8', desc: '运行时相机：固定跟随角色、45° 俯角 —— 占位，参数未实现', solid: false },
  // 时间 / 天气：先只做成可添加的占位对象，参数与运行时逻辑都还没接
  { id: 'time', name: '时间', baseName: '时间', color: '#b08ac4', desc: '四季（春 / 夏 / 秋 / 冬）与白天黑夜循环 —— 占位，未实现', solid: false },
  { id: 'weather', name: '天气', baseName: '天气', color: '#7fa8c0', desc: '晴 / 雨 / 雪 / 雾等天气 —— 占位，未实现', solid: false },
];

export function sceneKindMeta(kind: SceneKind): SceneKindMeta {
  return SCENE_KINDS.find((k) => k.id === kind) ?? SCENE_KINDS[0];
}

export interface SceneNode {
  id: string;
  name: string;
  kind: SceneKind;
  /** null = 场景根层 */
  parentId: string | null;
  /** 同一层里的排序（小的在前） */
  order: number;
  /** 世界坐标（俯视平面的 x / z，y 由类型决定） */
  x: number;
  z: number;
  /** 分组是否展开（渲染用，存在数据里省得每次切工程都展开） */
  open?: boolean;
  /**
   * 只有 kind === 'ground' 才有：这块地面自己的地皮生成配置。
   * 一个场景可以摆很多块地面，各自尺寸、贴图、生成结果都不一样。
   */
  ground?: GroundConfig;
  /** 只有 kind === 'mapui' 才有：屏幕 UI 元素的参数 */
  mapui?: MapUiConfig;
  /** 只有 kind === 'character' 才有：角色数值 / 动画 / 状态机 */
  character?: CharacterConfig;
  /** 挂载的脚本资产 id 列表（任何节点都能挂；运行时按顺序实例化） */
  scriptIds?: string[];
  /** 小地图上是否显示这个对象（默认显示；false = 从小地图上隐藏） */
  minimapShow?: boolean;
  /**
   * 小地图上这个对象用的图标：**图组 id**（「图组」目录里的资产）。
   * 空 = 用默认圆点。图标不带朝向（朝向由运行时自己画箭头，图标是静态立绘）。
   */
  minimapIcon?: string | null;
}

/** 小地图图标的建议尺寸（世界单位→画布像素之间的视觉大小，icon 按最长边等比缩到这个值） */
export const MINIMAP_ICON_PX = 13;

/* ------------------------------------------------------------------ */
/* 工程                                                                */
/* ------------------------------------------------------------------ */

export const PROJECT_FORMAT = 'light-project';
/** 工程格式版本：结构变更时 +1，并在 migrations.ts 里补一条迁移 */
export const PROJECT_VERSION = 2;

/** metadata.json 里的索引条目 */
export interface ImageIndexEntry {
  id: string;
  name: string;
  folder?: string;
  file: string;
  width: number;
  height: number;
  crop: CropRect | null;
  /** 平铺拉伸策略（缺省 = default） */
  tiling?: ImageTiling;
  /** 九宫格四线（缺省 = null） */
  nine?: ImageNine | null;
}

export interface TextureIndexEntry {
  id: string;
  name: string;
  folder?: string;
  template: TextureTemplate;
  file: string;
}

export interface AnimationIndexEntry {
  id: string;
  name: string;
  folder?: string;
  template: SkeletonId;
  file: string;
}

export interface StateMachineIndexEntry {
  id: string;
  name: string;
  folder?: string;
  file: string;
}

export interface ControllerIndexEntry {
  id: string;
  name: string;
  folder?: string;
  file: string;
}

export interface ScriptIndexEntry {
  id: string;
  name: string;
  folder?: string;
  /** 老工程（v2 早期）没有这个字段 */
  createdAt?: number;
  file: string;
}

/** <root>/metadata.json */
export interface ProjectMetaFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 虚拟目录路径（"贴图/装备"；顺序即列表顺序；资产按 folder 字段归入） */
  folders: string[];
  /** 目录路径 → 该目录能放什么（资产类型 / 场景实体） */
  folderKinds?: Record<string, FolderKind>;
  /** 场景对象树（扁平存储，用 parentId/order 表达层级与顺序） */
  scene?: SceneNode[];
  /** 地面（地皮）生成参数与已生成的结果 */
  ground?: GroundConfig;
  assets: {
    images: ImageIndexEntry[];
    textures: TextureIndexEntry[];
    animations: AnimationIndexEntry[];
    stateMachines?: StateMachineIndexEntry[];
    controllers?: ControllerIndexEntry[];
    scripts?: ScriptIndexEntry[];
  };
}

/** 渲染进程里的完整工程（含所有资产详情） */
export interface ProjectDoc {
  root: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 虚拟目录路径（只是分组名，不对应磁盘文件夹） */
  folders: string[];
  /** 目录路径 → 目录类型（一个目录只放一种东西） */
  folderKinds: Record<string, FolderKind>;
  images: ImageAsset[];
  textures: TextureAsset[];
  animations: AnimationAsset[];
  stateMachines: StateMachineAsset[];
  controllers: ControllerAsset[];
  scripts: ScriptAsset[];
  /** 场景对象树 */
  scene: SceneNode[];
  /** 地皮：参数 + 生成结果（结果是一串按行编码的格子，存在 metadata.json 里） */
  ground: GroundConfig;
}

export interface AssetRef {
  kind: AssetKind;
  id: string;
}

export const FOLDERS = {
  images: 'assets/images',
  textures: 'assets/textures',
  animations: 'assets/animations',
  stateMachines: 'assets/statemachines',
  controllers: 'assets/controllers',
  scripts: 'assets/scripts',
} as const;

export function shortId(prefix: string): string {
  const s = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${s}${Date.now().toString(36).slice(-3)}`;
}

/** 让名字在同类资产里唯一（追加 2/3/...） */
export function uniqueName(base: string, taken: string[]): string {
  const trimmed = base.trim() || '未命名';
  if (!taken.includes(trimmed)) return trimmed;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${trimmed} ${i}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${trimmed}_${Date.now()}`;
}
