/**
 * 场景运行时（runtime-core 的第一个成员）
 *
 * 一帧里做三件事：
 *   1. 按键事件写控制器变量（控制器只负责改变量）
 *   2. 状态机读变量做判断，决定当前状态（状态 = 动画片段 + 位移方式）
 *   3. 按当前状态推进位移，并采样动画关键帧 → 部件姿势
 *
 * 纯逻辑层：零 DOM / 零 React / 零 three 依赖，可在 Node 里无头运行（scripts/runtime-headless.mjs 验证）。
 * 时间由注入的 now() 提供（默认 performance.now），导出的 player 宿主可换成自己的时钟。
 *
 * 运行时状态完全独立于工程数据：退出播放不会把角色位置写回工程。
 * 位置坐标与场景节点一致（x 向右、z 向下），dirY > 0 表示向屏幕上方走。
 */
import { sampleClip, type PartPose } from '../animator/types';
import { applyBinding, initVariables, V_DIR_X, V_DIR_Y } from '../editor/model/controller';
import { entryState, evalCondition } from '../editor/model/statemachine';
import type { CharacterConfig, ControllerAsset, ProjectDoc, SceneNode, StateMachineAsset } from '../editor/model/types';
import { ScriptVM, type ScriptSelf, type ScriptWorld } from './scripts';

/** 双击判定窗口 / 长按触发阈值（毫秒） */
const DOUBLE_MS = 300;
const LONGPRESS_MS = 400;
/** 移速换算：角色 speed=1 时每秒走 3 个场景单位（地块一般 1 单位一格） */
const SPEED_SCALE = 3;
/** 斜向移动归一化后不再额外加速 */
const DIAG = Math.SQRT1_2;

export interface Mods {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export const NO_MODS: Mods = { ctrl: false, shift: false, alt: false };

export interface PlayCharState {
  nodeId: string;
  x: number;
  z: number;
  /** 1 = 朝右，-1 = 朝左（贴图水平翻转） */
  face: 1 | -1;
  /** 当前状态的名字（界面上显示用） */
  stateName: string;
  stateId: string;
  /** 当前播放的动画片段名 */
  clip: string | null;
  /** 片段内时间（秒） */
  time: number;
}

export class SceneRuntime {
  readonly doc: ProjectDoc;
  readonly node: SceneNode;
  readonly char: CharacterConfig;
  readonly ctrl: ControllerAsset | null;
  readonly sm: StateMachineAsset | null;
  /** 控制器变量：id → 值 */
  readonly vars: Record<string, number>;
  readonly state: PlayCharState;
  /** 每帧采样出的部件姿势与可见性 */
  poses: Record<string, PartPose> = {};
  visibility: Record<string, boolean> = {};
  /** 1 世界单位 = 多少屏幕像素（由 SceneView 按相机距离算） */
  pxPerUnit = 52;
  /** 竖直方向的每单位像素：立体相机俯视时竖直轴被压缩 cos(pitch)，纸片人的高度得跟这个走 */
  pxPerUnitY = 52;
  /** 角色静态总高（世界单位），由精灵按动画部件量出来后写回；相机用它来取景 */
  charHeight = 1.6;

  /** 按住中的键：key → 记录（长按判定用） */
  private held = new Map<string, { since: number; longFired: boolean }>();
  /** 上次按下的时间：双击判定用 */
  private lastTap = new Map<string, number>();

  /* ---------------- 脚本（W3） ---------------- */

  /** 脚本 VM：SceneView / 导出宿主在播放前用 attachScripts() 挂进来（create 是异步的） */
  scriptVm: ScriptVM | null = null;
  /** 每个挂了脚本的节点一个适配器；角色节点的 x/z 会写回运行时 */
  private scriptSelves: ScriptSelf[] = [];
  private downKeys = new Set<string>();
  private pressedThisFrame = new Set<string>();

  /** 编译并挂载工程里全部脚本（播放前调用；startScripts() 再触发 onStart） */
  attachScripts(vm: ScriptVM): void {
    const world: ScriptWorld = {
      input: {
        isDown: (k) => this.downKeys.has(k),
        pressed: (k) => this.pressedThisFrame.has(k),
      },
      log: (...args) => console.log('[脚本]', ...args),
      entities: () => this.scriptSelves,
    };
    vm.bind(world);
    for (const n of this.doc.scene) {
      const ids = n.scriptIds ?? [];
      if (ids.length === 0) continue;
      const isChar = n.kind === 'character';
      // 角色节点：vars 共享控制器变量表；其它节点给自己的一份
      const self: ScriptSelf = {
        nodeId: n.id,
        name: n.name,
        x: isChar ? this.state.x : n.x,
        z: isChar ? this.state.z : n.z,
        face: this.state.face,
        vars: isChar ? this.vars : {},
      };
      for (const sid of ids) {
        const sc = this.doc.scripts.find((s) => s.id === sid);
        if (!sc) continue;
        vm.mount(sc.id, sc.name, sc.code, self);
      }
      this.scriptSelves.push(self);
    }
    this.scriptVm = vm;
  }

  /** 播放开始：跑一遍 onStart（每次点 ▶ 都算一次新的播放） */
  startScripts(): void {
    this.scriptVm?.start();
  }

  /** 释放脚本沙箱（运行时整个丢弃时调用） */
  disposeScripts(): void {
    this.scriptVm?.destroy();
    this.scriptVm = null;
    this.scriptSelves = [];
  }

  /** 时钟：默认 performance.now；无头测试 / 导出宿主可注入自己的单调时钟 */
  private readonly now: () => number;

  constructor(doc: ProjectDoc, node: SceneNode, opts?: { now?: () => number }) {
    this.now = opts?.now ?? (() => performance.now());
    this.doc = doc;
    this.node = node;
    this.char = node.character!;
    const sm = doc.stateMachines.find((s) => s.id === this.char.stateMachineId) ?? null;
    this.sm = sm;
    // 变量来源：状态机指定的控制器 → 角色绑的第一个 → 工程第一个
    this.ctrl =
      doc.controllers.find((c) => c.id === sm?.controllerId) ??
      doc.controllers.find((c) => this.char.controllerIds.includes(c.id)) ??
      doc.controllers[0] ??
      null;
    this.vars = initVariables(this.ctrl);
    const entry = sm ? entryState(sm) : null;
    this.state = {
      nodeId: node.id,
      x: node.x,
      z: node.z,
      face: 1,
      stateId: entry?.id ?? '',
      stateName: entry?.name ?? '—',
      clip: entry?.clip ?? null,
      time: 0,
    };
    this.sample();
  }

  /** 当前状态对象 */
  get currentState() {
    return this.sm?.states.find((s) => s.id === this.state.stateId) ?? null;
  }

  /* ---------------- 输入 ---------------- */

  keyDown(key: string, mods: Mods = NO_MODS): void {
    const now = this.now();
    this.downKeys.add(key);
    this.pressedThisFrame.add(key);
    this.fire(key, 'down', mods, now);
    // 双击：同一键两次按下间隔 < 300ms
    const last = this.lastTap.get(key) ?? 0;
    if (last && now - last < DOUBLE_MS) {
      this.fire(key, 'double', mods, now);
      this.lastTap.delete(key);
    } else {
      this.lastTap.set(key, now);
    }
    this.held.set(key, { since: now, longFired: false });
  }

  keyUp(key: string, mods: Mods = NO_MODS): void {
    this.fire(key, 'up', mods, this.now());
    this.held.delete(key);
    this.downKeys.delete(key);
  }

  /** 滚轮：上下各算一个"键"，只在滚的时候触发一次 */
  wheel(up: boolean, mods: Mods = NO_MODS): void {
    this.fire(up ? 'mouse:wheelUp' : 'mouse:wheelDown', 'down', mods, this.now());
  }

  /** 窗口失焦：把所有按住中的键补一次「弹起」，免得角色一直往前走 */
  releaseAll(): void {
    for (const key of [...this.held.keys()]) this.keyUp(key, NO_MODS);
    this.held.clear();
    this.lastTap.clear();
  }

  /** 重新开始：位置回到节点、变量恢复初值、回到初始状态 */
  reset(): void {
    this.releaseAll();
    this.state.x = this.node.x;
    this.state.z = this.node.z;
    this.state.face = 1;
    this.state.time = 0;
    for (const k of Object.keys(this.vars)) delete this.vars[k];
    Object.assign(this.vars, initVariables(this.ctrl));
    const entry = this.sm ? entryState(this.sm) : null;
    this.state.stateId = entry?.id ?? '';
    this.state.stateName = entry?.name ?? '—';
    this.state.clip = entry?.clip ?? null;
    // 脚本实例的位置也回原点（onStart 由 startScripts() 在每次开播时重跑）
    for (const s of this.scriptSelves) {
      const n = this.doc.scene.find((x) => x.id === s.nodeId);
      s.x = n?.x ?? 0;
      s.z = n?.z ?? 0;
      s.face = 1;
    }
    this.sample();
  }

  /** 触发某个键的某类事件：把匹配的绑定全部作用到变量上 */
  private fire(key: string, trigger: 'down' | 'up' | 'double' | 'longpress', mods: Mods, _now: number): void {
    if (!this.ctrl) return;
    for (const b of this.ctrl.bindings) {
      if (b.key !== key || b.trigger !== trigger) continue;
      // 修饰键：绑定了就必须按住；没绑定则忽略
      if (b.ctrl && !mods.ctrl) continue;
      if (b.shift && !mods.shift) continue;
      if (b.alt && !mods.alt) continue;
      applyBinding(this.vars, b);
    }
  }

  /* ---------------- 每帧 ---------------- */

  tick(dt: number): void {
    const step = Math.min(0.05, Math.max(0, dt));
    this.state.time += step;

    // 长按：按住超过阈值触发一次
    const now = this.now();
    for (const [key, info] of this.held) {
      if (info.longFired || now - info.since < LONGPRESS_MS) continue;
      this.fire(key, 'longpress', NO_MODS, now);
      info.longFired = true;
    }

    // 状态机流转：当前状态的出边逐条求值，第一条成立就切
    if (this.sm) {
      for (const tr of this.sm.transitions) {
        if (tr.from !== this.state.stateId) continue;
        const ok = evalCondition(tr.condition, { stats: this.stats(), flags: {}, vars: this.vars });
        if (!ok) continue;
        this.enter(tr.to);
        break;
      }
    }

    // 位移：状态说「前进」时按控制器的方向变量走
    const st = this.currentState;
    if (st?.move === 'forward') {
      const dx = this.vars[V_DIR_X] ?? 0;
      const dz = this.vars[V_DIR_Y] ?? 0;
      if (dx !== 0 || dz !== 0) {
        // 斜向不加速：两个轴都有值时各取 0.707
        const kx = dx !== 0 && dz !== 0 ? Math.sign(dx) * DIAG : dx;
        const kz = dx !== 0 && dz !== 0 ? Math.sign(dz) * DIAG : dz;
        const speed = (this.char.speed || 1) * SPEED_SCALE;
        this.state.x += kx * speed * step;
        // dirY > 0 = 向屏幕上方 = 世界 z 减小
        this.state.z -= kz * speed * step;
        if (dx !== 0) this.state.face = dx > 0 ? 1 : -1;
      }
    }

    // 脚本：先同步 self（角色位置）→ 跑 onUpdate → 把脚本改动拉回来
    const vm = this.scriptVm;
    if (vm) {
      for (const s of this.scriptSelves) {
        const n = this.doc.scene.find((x) => x.id === s.nodeId);
        if (n?.kind === 'character') {
          s.x = this.state.x;
          s.z = this.state.z;
          s.face = this.state.face;
        }
      }
      vm.tick(step);
      // 角色节点的 self 让脚本写回了位置 / 朝向
      for (const s of this.scriptSelves) {
        const n = this.doc.scene.find((x) => x.id === s.nodeId);
        if (n?.kind === 'character') {
          this.state.x = s.x;
          this.state.z = s.z;
          if (s.face !== this.state.face) this.state.face = s.face >= 0 ? 1 : -1;
        }
      }
    }

    this.sample();
    // pressed 只在「这一帧」成立：tick 收尾统一清空
    this.pressedThisFrame.clear();
  }

  /** 切到某个状态：换片段、重置时间 */
  private enter(stateId: string): void {
    if (stateId === this.state.stateId) return;
    this.state.stateId = stateId;
    this.state.time = 0;
    const st = this.sm?.states.find((s) => s.id === stateId);
    this.state.stateName = st?.name ?? '—';
    this.state.clip = this.clipOf(st);
    this.sample();
  }

  /** 当前状态对应的动画与片段 */
  private clipOf(st: { animationId: string | null; clip: string | null } | null | undefined) {
    const anim = this.anim();
    if (!anim) return null;
    const names = Object.keys(anim.clips ?? {});
    if (st?.clip && names.includes(st.clip)) return st.clip;
    return names[0] ?? null;
  }

  anim() {
    const id = this.currentState?.animationId ?? this.char.animationId;
    return this.doc.animations.find((a) => a.id === id) ?? this.doc.animations[0] ?? null;
  }

  private stats() {
    return {
      blood: this.char.blood,
      satiation: this.char.satiation,
      mental: this.char.mental,
      speed: this.char.speed,
      attack: this.char.attack,
    };
  }

  /** 采样当前片段到 poses / visibility */
  private sample(): void {
    const anim = this.anim();
    if (!anim) {
      this.poses = {};
      this.visibility = {};
      return;
    }
    const name = this.clipOf(this.currentState) ?? this.state.clip;
    this.state.clip = name;
    const clip = name ? anim.clips[name] : undefined;
    if (!clip) {
      this.poses = {};
      this.visibility = {};
      return;
    }
    const sampled = sampleClip(clip, this.state.time);
    this.poses = sampled.poses;
    this.visibility = sampled.visibility;
  }
}
