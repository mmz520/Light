/**
 * 控制器模型工具
 *
 * 控制器只做一件事：按键事件 → 变量。状态机只读变量做比较，两边完全解耦。
 * 加攻击 / 技能 / 菜单时，新加一个控制器就行，状态机条件里引用它的变量。
 *
 * 默认控制器（移动）用「计数 + 边界」实现多键同时按：
 *   moving  每个移动键按下 +1、松开 -1，下限 0 → 按住任意一个键就 > 0，全松开才 = 0
 *   dirX    左 -1 / 右 +1，夹在 [-1, 1]，左右同按会互相抵消
 *   dirY    下 -1 / 上 +1，同上
 */
import type { ControllerAsset, CtrlBinding, CtrlOp, CtrlVariable } from './types';
import { shortId } from './types';

/** 默认移动控制器的变量 id（固定，状态机条件直接引用，跨工程也认） */
export const V_MOVING = 'v_moving';
export const V_DIR_X = 'v_dirx';
export const V_DIR_Y = 'v_diry';

export function newVariable(name: string, init = 0): CtrlVariable {
  return { id: shortId('v'), name, init };
}

function bind(
  key: string,
  trigger: CtrlBinding['trigger'],
  variableId: string,
  op: CtrlOp,
  value: number,
  min: number | null,
  max: number | null,
  mods: Partial<Pick<CtrlBinding, 'ctrl' | 'shift' | 'alt'>> = {},
): CtrlBinding {
  return {
    id: shortId('b'),
    key,
    trigger,
    ctrl: !!mods.ctrl,
    shift: !!mods.shift,
    alt: !!mods.alt,
    variableId,
    op,
    value,
    min,
    max,
  };
}

/** 方向键族：哪些键推这个轴、往哪个方向推 */
const AXES: { keys: string[]; varId: string; dir: 1 | -1 }[] = [
  { keys: ['KeyW', 'ArrowUp'], varId: V_DIR_Y, dir: 1 },
  { keys: ['KeyS', 'ArrowDown'], varId: V_DIR_Y, dir: -1 },
  { keys: ['KeyA', 'ArrowLeft'], varId: V_DIR_X, dir: -1 },
  { keys: ['KeyD', 'ArrowRight'], varId: V_DIR_X, dir: 1 },
];

/**
 * 默认「移动控制器」：WASD + 方向键推 moving / dirX / dirY。
 * moving 用计数 + 下限 0，保证同时按多个键松开一个时仍然是移动中。
 */
export function makeMoveController(name = '移动控制器'): ControllerAsset {
  const vars: CtrlVariable[] = [
    { id: V_MOVING, name: 'moving', init: 0 },
    { id: V_DIR_X, name: 'dirX', init: 0 },
    { id: V_DIR_Y, name: 'dirY', init: 0 },
  ];

  const bindings: CtrlBinding[] = [];
  for (const axis of AXES) {
    // 方向变量只在这条轴的 [min, max] 区间内变化：按 + 方向就夹在 [0, 1]，按 - 方向夹在 [-1, 0]
    const lo = axis.dir > 0 ? 0 : -1;
    const hi = axis.dir > 0 ? 1 : 0;
    for (const key of axis.keys) {
      // moving：按下 +1 / 松开 -1，永远不小于 0
      bindings.push(bind(key, 'down', V_MOVING, '+', 1, 0, null));
      bindings.push(bind(key, 'up', V_MOVING, '-', 1, 0, null));
      // 方向：按下推 ±1，松开推回来
      bindings.push(bind(key, 'down', axis.varId, '+', axis.dir, lo, hi));
      bindings.push(bind(key, 'up', axis.varId, '-', axis.dir, lo, hi));
    }
  }

  return {
    id: shortId('ctrl'),
    name,
    folder: '控制器',
    vars,
    bindings,
    createdAt: Date.now(),
  };
}

/** 空白控制器：一个 moveX 变量 + 一条示例事件，方便照着手改 */
export function makeBlankController(name = '新建控制器'): ControllerAsset {
  const v = newVariable('value', 0);
  return {
    id: shortId('ctrl'),
    name,
    folder: '控制器',
    vars: [v],
    bindings: [bind('KeyW', 'down', v.id, '+', 1, null, null)],
    createdAt: Date.now(),
  };
}

/** 把数值夹到该绑定的上下限里（null = 不限制） */
export function clampValue(v: number, min: number | null, max: number | null): number {
  let n = v;
  if (min !== null && Number.isFinite(min)) n = Math.max(min, n);
  if (max !== null && Number.isFinite(max)) n = Math.min(max, n);
  return n;
}

/** 在一个原值上应用运算符 */
export function applyOp(current: number, op: CtrlOp, value: number): number {
  switch (op) {
    case '=':
      return value;
    case '+':
      return current + value;
    case '-':
      return current - value;
    case '*':
      return current * value;
    case '/':
      return value === 0 ? current : current / value;
    default:
      return current;
  }
}

/** 变量表初值：id → 数字 */
export function initVariables(ctrl: ControllerAsset | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of ctrl?.vars ?? []) out[v.id] = Number.isFinite(v.init) ? v.init : 0;
  return out;
}

/** 把一条绑定作用到变量表上（就地修改） */
export function applyBinding(vars: Record<string, number>, b: CtrlBinding): void {
  if (!b.variableId) return;
  const current = vars[b.variableId];
  const base = Number.isFinite(current) ? current : 0;
  vars[b.variableId] = clampValue(applyOp(base, b.op, b.value), b.min, b.max);
}

/** 变量名（状态机条件显示用；找不到回落到 id） */
export function variableName(ctrl: ControllerAsset | null | undefined, varId: string): string {
  return ctrl?.vars.find((v) => v.id === varId)?.name ?? varId ?? '（未选变量）';
}

/** 删变量时连带删掉指向它的事件 */
export function removeVariableSafely(ctrl: ControllerAsset, varId: string): { vars: CtrlVariable[]; bindings: CtrlBinding[] } {
  return {
    vars: ctrl.vars.filter((v) => v.id !== varId),
    bindings: ctrl.bindings.filter((b) => b.variableId !== varId),
  };
}
