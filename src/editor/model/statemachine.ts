/**
 * 状态机模型工具
 *
 * 设计目标是「可扩展」：一个状态 = 一段动画 + 一种位移方式，流转挂在连线上。
 * 条件的主写法是「控制器变量 比较 标准值」（> = <），变量来自角色绑定的控制器；
 * 早期的输入事件 / 数值 / 标志位条件仍保留解析能力，老工程不会打不开。
 */
import type {
  AnimationAsset,
  CharacterStatKey,
  ControllerAsset,
  CtrlVariable,
  SmCompareOp,
  SmCondition,
  SmInputAction,
  SmInputEvent,
  SmState,
  SmTransition,
  SmVarOp,
  StateMachineAsset,
} from './types';
import {
  CHARACTER_STATS,
  SM_INPUT_ACTIONS,
  SM_KEY_OPTIONS,
  SM_MOUSE_BUTTONS,
  defaultInput,
  inputEventId,
  shortId,
} from './types';
import { V_MOVING, makeMoveController } from './controller';

/** 默认的「行走中」输入事件：按住任意移动键 */
export function moveHeldInput(): SmInputEvent {
  return { device: 'keyboard', key: 'move', button: 'left', action: 'held' };
}

/** 默认的「没有任何输入」事件 */
export function noInputEvent(): SmInputEvent {
  return { device: 'none', key: '', button: 'left', action: 'down' };
}

/** 新建状态：坐标由调用方给（流程图里落点） */
export function newSmState(name: string, x: number, y: number, patch: Partial<SmState> = {}): SmState {
  return {
    id: shortId('st'),
    name,
    x,
    y,
    animationId: null,
    clip: null,
    move: 'none',
    entry: false,
    color: null,
    desc: '',
    ...patch,
  };
}

function clipOf(anim: AnimationAsset | null | undefined, prefer: string): string | null {
  if (!anim) return null;
  const names = Object.keys(anim.clips ?? {});
  if (names.includes(prefer)) return prefer;
  return names[0] ?? null;
}

/**
 * 默认状态机：待机 ⇄ 行走。
 *
 * 条件是「控制器变量 moving」：按住移动键时 moving > 0 → 切到行走（状态本身按方向走、
 * 播放 walk 片段）；全部松手 moving = 0 → 回待机。攻击 / 受击 / 技能照这个套路加。
 */
export function makeDefaultStateMachine(
  anim: AnimationAsset | null,
  controller: ControllerAsset | null = null,
  name = '默认状态机',
): StateMachineAsset {
  const ctrl = controller ?? makeMoveController();
  const idleClip = clipOf(anim, 'idle');
  const walkClip = clipOf(anim, 'walk') ?? idleClip;
  const idle = newSmState('待机', 90, 90, { animationId: anim?.id ?? null, clip: idleClip, entry: true });
  // 两个状态必须纵向错开：正反两条贝塞尔若在同一水平线上会完全重合，看起来像"没有线"
  const walk = newSmState('行走', 400, 250, { animationId: anim?.id ?? null, clip: walkClip, move: 'forward' });
  return {
    id: shortId('sm'),
    name,
    folder: '状态机',
    controllerId: ctrl.id,
    states: [idle, walk],
    transitions: [
      { id: shortId('tr'), from: idle.id, to: walk.id, condition: { kind: 'var', varId: V_MOVING, op: '>', value: 0 } },
      { id: shortId('tr'), from: walk.id, to: idle.id, condition: { kind: 'var', varId: V_MOVING, op: '=', value: 0 } },
    ],
    createdAt: Date.now(),
  };
}

/** 空白状态机：只有「待机」一个初始状态 */
export function makeBlankStateMachine(anim: AnimationAsset | null, name = '新建状态机'): StateMachineAsset {
  const state = newSmState('待机', 120, 120, { animationId: anim?.id ?? null, clip: clipOf(anim, 'idle'), entry: true });
  return { id: shortId('sm'), name, folder: '状态机', controllerId: null, states: [state], transitions: [], createdAt: Date.now() };
}

/**
 * 两个状态在同一水平线上且互为起终点时，A→B 与 B→A 的两条贝塞尔互为镜像、完全重合，
 * 视觉上等于「只有一条线」，甚至看起来像没连线。这里把靠后的那个往下错开。
 * 就地修改，返回是否发生改动。
 */
export function staggerOverlappingStates(sm: StateMachineAsset): boolean {
  let changed = false;
  for (const tr of sm.transitions) {
    const a = sm.states.find((s) => s.id === tr.from);
    const b = sm.states.find((s) => s.id === tr.to);
    if (!a || !b || a === b) continue;
    // 已经错开了就不用管；纯上下排列（x 相同）也不会重合
    if (Math.abs(a.y - b.y) >= 40 || Math.abs(a.x - b.x) < 40) continue;
    // 只有"互相连线"才会重合，单向连线没问题
    if (!sm.transitions.some((t) => t.from === tr.to && t.to === tr.from)) continue;
    const later = sm.states.indexOf(a) > sm.states.indexOf(b) ? a : b;
    later.y = Math.min(a.y, b.y) + 160;
    changed = true;
  }
  return changed;
}

/** 条件默认值（新建连线 / 新建条件时用）：moving > 0 */
export function defaultCondition(): SmCondition {
  return { kind: 'var', varId: V_MOVING, op: '>', value: 0 };
}

/** 新建一条变量条件：没有变量时给个占位 id，界面上会显示「未选变量」 */
export function newVarCondition(varId = ''): SmCondition {
  return { kind: 'var', varId, op: '>', value: 0 };
}

function statName(key: CharacterStatKey): string {
  return CHARACTER_STATS.find((s) => s.key === key)?.name ?? key;
}

function flagName(key: string): string {
  return (
    {
      moving: '移动中',
      attacking: '攻击中',
      hurt: '受击',
      dead: '死亡',
      casting: '施法中',
    }[key] ?? key
  );
}

function keyName(code: string): string {
  return SM_KEY_OPTIONS.find((k) => k.key === code)?.name ?? code;
}

function buttonName(key: string): string {
  return SM_MOUSE_BUTTONS.find((b) => b.key === key)?.name ?? key;
}

function actionName(key: SmInputAction): string {
  return SM_INPUT_ACTIONS.find((a) => a.key === key)?.name ?? key;
}

/** 一条输入事件 → 一句话 */
export function inputText(e: SmInputEvent): string {
  if (e.device === 'none') return '无输入';
  if (e.device === 'mouse') return `鼠标 ${buttonName(e.button)} ${actionName(e.action)}`;
  return `键盘 ${keyName(e.key)} ${actionName(e.action)}`;
}

/** 条件 → 一句话（连线标签 / 面板标题用；嵌套也能读） */
export function conditionText(cond: SmCondition | null | undefined, vars?: CtrlVariable[]): string {
  if (!cond) return '总是';
  switch (cond.kind) {
    case 'group': {
      if (cond.items.length === 0) return cond.op === 'and' ? '（空与）' : '（空或）';
      const joiner = cond.op === 'and' ? ' 且 ' : ' 或 ';
      const body = cond.items.map((c) => conditionText(c, vars)).join(joiner);
      return cond.items.length > 1 ? `(${body})` : body;
    }
    case 'not':
      return `非 ${conditionText(cond.item, vars)}`;
    case 'var': {
      const name = vars?.find((v) => v.id === cond.varId)?.name ?? (cond.varId || '未选变量');
      return `${name} ${cond.op} ${cond.value}`;
    }
    case 'input':
      return inputText(cond.input);
    case 'stat':
      return `${statName(cond.key)} ${cond.op} ${cond.value}`;
    case 'flag':
      return cond.value ? flagName(cond.key) : `无「${flagName(cond.key)}」`;
    default:
      return '?';
  }
}

/** 条件 → 列表（编辑器用）：op:'and' 的分组展开成多项，其余视为单项 */
export function conditionList(cond: SmCondition | null | undefined): SmCondition[] {
  if (!cond) return [];
  if (cond.kind === 'group' && cond.op === 'and') return cond.items;
  return [cond];
}

/** 列表 → 条件（空列表 = 无条件；多项自动包成 op:'and' 的分组） */
export function conditionFromList(items: SmCondition[]): SmCondition | null {
  if (items.length === 0) return null;
  if (items.length === 1) return items[0];
  return { kind: 'group', op: 'and', items };
}

/** 条件里用到的标志位（给运行时订阅用） */
export function conditionFlags(cond: SmCondition | null | undefined, out = new Set<string>()): Set<string> {
  if (!cond) return out;
  if (cond.kind === 'group') cond.items.forEach((c) => conditionFlags(c, out));
  else if (cond.kind === 'not') conditionFlags(cond.item, out);
  else if (cond.kind === 'flag') out.add(cond.key);
  return out;
}

export interface ConditionContext {
  stats: Record<CharacterStatKey, number>;
  flags: Record<string, boolean>;
  /** 控制器变量表：id → 当前值（运行时由控制器写入） */
  vars?: Record<string, number>;
  /** 输入事件表：key 用 inputEventId()，例如 'keyboard:KeyW:down'、'none'（老条件兼容） */
  events?: Record<string, boolean>;
}

/** 运行时求值（编辑器暂不跑，留给游戏侧复用；也给自动化测试用） */
export function evalCondition(cond: SmCondition | null | undefined, ctx: ConditionContext): boolean {
  if (!cond) return true;
  switch (cond.kind) {
    case 'group':
      return cond.op === 'and' ? cond.items.every((c) => evalCondition(c, ctx)) : cond.items.some((c) => evalCondition(c, ctx));
    case 'not':
      return !evalCondition(cond.item, ctx);
    case 'var':
      return compareVar(ctx.vars?.[cond.varId] ?? 0, cond.op, cond.value);
    case 'stat': {
      const v = ctx.stats[cond.key] ?? 0;
      return compare(v, cond.op, cond.value);
    }
    case 'flag':
      return (ctx.flags[cond.key] ?? false) === cond.value;
    case 'input':
      return !!ctx.events?.[inputEventId(cond.input)];
    default:
      return false;
  }
}

function compareVar(a: number, op: SmVarOp, b: number): boolean {
  if (op === '>') return a > b;
  if (op === '<') return a < b;
  return a === b;
}

function compare(a: number, op: SmCompareOp, b: number): boolean {
  switch (op) {
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '==':
      return a === b;
    case '!=':
      return a !== b;
    default:
      return false;
  }
}

/** 状态机里所有用到的动画 id（删除动画前做引用检查） */
export function stateMachineAnimationRefs(sm: StateMachineAsset): { state: string; animationId: string }[] {
  return sm.states.filter((s) => !!s.animationId).map((s) => ({ state: s.name, animationId: s.animationId! }));
}

/* ------------------------------------------------------------------ */
/* 条件树编辑（不可变，方便直接喂给 React 状态）                          */
/* ------------------------------------------------------------------ */

/** 把条件树里某个路径上的节点替换掉 */
export function replaceConditionAt(root: SmCondition | null, path: number[], next: SmCondition | null): SmCondition | null {
  if (path.length === 0) return next;
  if (!root) return root;
  const [head, ...rest] = path;
  if (root.kind === 'group') {
    const items = [...root.items];
    const child = replaceConditionAt(items[head] ?? null, rest, next);
    if (child) items[head] = child;
    else items.splice(head, 1);
    return { ...root, items };
  }
  if (root.kind === 'not') {
    const child = replaceConditionAt(root.item, rest, next);
    return child ? { ...root, item: child } : root;
  }
  return root;
}

/**
 * 老数据迁移：早期的「移动输入」类条件（标志位 moving / 输入事件「按住移动键」/「无输入」）
 * 换成等价的变量条件（moving > 0 / moving = 0），这样在新面板里能直接改。
 * 其它形状的条件（数值比较、标志位、具体按键）原样保留，面板里显示为只读旧条件。
 */
export function migrateConditions(sm: StateMachineAsset): boolean {
  let changed = false;
  const toVar = (op: SmVarOp, value: number): SmCondition => {
    changed = true;
    return { kind: 'var', varId: V_MOVING, op, value };
  };
  const convert = (c: SmCondition): SmCondition => {
    const raw = c as unknown as { kind: string; name?: string };
    // 更早的版本：{kind:'event', name}
    if (raw.kind === 'event') {
      changed = true;
      return { kind: 'input', input: { ...defaultInput(), key: raw.name || 'KeyW' } };
    }
    if (c.kind === 'flag' && c.key === 'moving' && c.value) return toVar('>', 0);
    if (c.kind === 'not' && c.item.kind === 'flag' && c.item.key === 'moving' && c.item.value) return toVar('=', 0);
    if (c.kind === 'input') {
      if (c.input.device === 'none') return toVar('=', 0);
      // 「按住移动键」= 有移动输入
      if (c.input.action === 'held' && (c.input.key === 'move' || c.input.device === 'keyboard')) return toVar('>', 0);
      return c;
    }
    if (c.kind === 'group') return { ...c, items: c.items.map(convert) };
    if (c.kind === 'not') return { ...c, item: convert(c.item) };
    return c;
  };
  for (const tr of sm.transitions) {
    if (tr.condition) tr.condition = convert(tr.condition);
  }
  return changed;
}

/** 条件里引用到的变量 id（删变量时用来提示） */
export function conditionVars(cond: SmCondition | null | undefined, out = new Set<string>()): Set<string> {
  if (!cond) return out;
  if (cond.kind === 'var') out.add(cond.varId);
  else if (cond.kind === 'group') cond.items.forEach((c) => conditionVars(c, out));
  else if (cond.kind === 'not') conditionVars(cond.item, out);
  return out;
}

/** 状态机里所有条件引用的变量 id */
export function stateMachineVarRefs(sm: StateMachineAsset): Set<string> {
  const out = new Set<string>();
  for (const tr of sm.transitions) conditionVars(tr.condition, out);
  return out;
}

/** 删掉某个变量后，把引用它的条件一并清理（返回是否有改动） */
export function dropVarConditions(sm: StateMachineAsset, varId: string): boolean {
  let changed = false;
  const walk = (c: SmCondition): SmCondition | null => {
    if (c.kind === 'var') {
      if (c.varId !== varId) return c;
      changed = true;
      return null;
    }
    if (c.kind === 'group') {
      const items = c.items.map(walk).filter((x): x is SmCondition => !!x);
      if (items.length !== c.items.length) changed = true;
      return { ...c, items };
    }
    if (c.kind === 'not') {
      const item = walk(c.item);
      if (!item) {
        changed = true;
        return null;
      }
      return { ...c, item };
    }
    return c;
  };
  for (const tr of sm.transitions) {
    if (!tr.condition) continue;
    const next = walk(tr.condition);
    if (next !== tr.condition) tr.condition = next;
  }
  return changed;
}

/** 连线是否与某个状态相连（删状态时连带删连线） */
export function transitionsOf(sm: StateMachineAsset, stateId: string): SmTransition[] {
  return sm.transitions.filter((t) => t.from === stateId || t.to === stateId);
}

/** 入口状态（没有标记就取第一个） */
export function entryState(sm: StateMachineAsset): SmState | null {
  return sm.states.find((s) => s.entry) ?? sm.states[0] ?? null;
}
