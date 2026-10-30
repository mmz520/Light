/**
 * Block Animator 数据模型 —— 身体分块动画录制器
 *
 * 整个运行时消费链路：
 *   Project.clips[name].tracks[partId].keyframes  →  Animator.getClip(name)  →  引擎 CharacterAssembler 播放
 *
 * 这里的类型既要满足编辑器录制/回放，也要满足游戏 runtime 播放。
 * 关键帧数据本身就是 runtime 直接消费的数据结构（没有编辑器专有字段）。
 */

/** 单个部件某一帧的变换快照 —— 这就是 runtime 插值的原始数据 */
export interface PartPose {
  /** 世界坐标（单位：引擎内的网格 unit，通常 = 1 格 = 1 米） */
  x: number;
  y: number;
  /** 旋转（度） */
  rot: number;
  /** 均匀缩放 */
  scale: number;
}

/** 关键帧：某时间点的一个 pose */
export interface Keyframe {
  /** 时间（秒），相对 clip 起点 */
  t: number;
  pose: PartPose;
  /** 缓动函数名，runtime 用 ease 名查表 */
  ease: EaseName;
}

/** 一个部件在一条 clip 里的轨道 */
export interface Track {
  partId: string;
  /** 关键帧按 t 升序存储 */
  keys: Keyframe[];
}

/** clip 的循环模式 */
export type LoopMode = 'once' | 'loop' | 'pingpong';

/** clip 是一段可独立播放的动作（idle / walk / attack ...） */
export interface Clip {
  name: string;
  /** 总时长（秒） */
  duration: number;
  loop: LoopMode;
  /** 循环起始时间（秒） —— 从第几秒开始 loop，用于"攻击前摇+循环主体+收招"这类三段 clip */
  loopStart?: number;
  /** 动作事件帧（相对 clip 起点的秒） —— 攻击判定、footstep 音效等 */
  events?: { t: number; type: string; payload?: Record<string, unknown> }[];
  tracks: Track[];
}

/** 一个角色/怪物的完整动画项目 */
export interface AnimatorProject {
  version: 1;
  /** 角色/怪物 ID（对应 sprite_ani/manifest.json 里的 characterId 或 monsterId） */
  targetId: string;
  /** 方向：一个 project 只负责一个方向，跨方向的 clip 分开录 */
  direction: 'S' | 'E' | 'N' | 'W';
  /** 部件清单 —— 编辑器用它渲染部件树，runtime 只认 clip 里出现过的 partId */
  parts: PartDef[];
  clips: Record<string, Clip>;
  /** 编辑时 FPS，runtime 用不到但保留方便重录 */
  fps: number;
}

/** 部件定义（编辑器用） */
export interface PartDef {
  id: string;
  /** 显示名 */
  label: string;
  /** 贴图路径（相对 public/assets/） */
  texturePath: string;
  /** 该部件默认 pose（录制起点用） */
  defaultPose: PartPose;
  /** 层级排序（数值大的画在上层） */
  zIndex: number;
}

/** 缓动函数名 —— runtime 和编辑器共用一个查表 */
export type EaseName =
  | 'linear'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeOutBack'
  | 'easeOutElastic';

/** 插值：给定 track 和时间，返回该时刻 pose */
export function sampleTrack(track: Track, t: number): PartPose {
  if (track.keys.length === 0) return { x: 0, y: 0, rot: 0, scale: 1 };
  if (track.keys.length === 1) return { ...track.keys[0].pose };
  // 找 t 落在哪个区间
  let i = 1;
  while (i < track.keys.length - 1 && track.keys[i].t < t) i++;
  const a = track.keys[i - 1];
  const b = track.keys[i];
  if (t <= a.t) return { ...a.pose };
  if (t >= b.t) return { ...b.pose };
  const u = (t - a.t) / (b.t - a.t);
  const e = EASE_TABLE[b.ease] ?? EASE_TABLE.linear;
  const k = e(u);
  return {
    x: a.pose.x + (b.pose.x - a.pose.x) * k,
    y: a.pose.y + (b.pose.y - a.pose.y) * k,
    rot: a.pose.rot + (b.pose.rot - a.pose.rot) * k,
    scale: a.pose.scale + (b.pose.scale - a.pose.scale) * k,
  };
}

const EASE_TABLE: Record<EaseName, (u: number) => number> = {
  linear: u => u,
  easeInQuad: u => u * u,
  easeOutQuad: u => u * (2 - u),
  easeInOutQuad: u => (u < 0.5 ? 2 * u * u : -1 + (4 - 2 * u) * u),
  easeOutBack: u => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
  },
  easeOutElastic: u => {
    if (u === 0 || u === 1) return u;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * u) * Math.sin((u * 10 - 0.75) * c4) + 1;
  },
};

/** 采样 clip 到任意时间，返回所有部件的 pose */
export function sampleClip(clip: Clip, tRaw: number): Record<string, PartPose> {
  const { duration, loop, loopStart = 0 } = clip;
  let t = tRaw;
  if (loop === 'loop') {
    if (t > loopStart) {
      const loopLen = duration - loopStart;
      t = loopStart + ((t - loopStart) % loopLen);
    } else if (t < 0) {
      t = duration + (t % duration);
    }
  } else if (loop === 'pingpong') {
    const full = duration * 2;
    const m = ((t % full) + full) % full;
    t = m <= duration ? m : full - m;
  } else {
    t = Math.max(0, Math.min(t, duration));
  }
  const out: Record<string, PartPose> = {};
  for (const track of clip.tracks) out[track.partId] = sampleTrack(track, t);
  return out;
}
