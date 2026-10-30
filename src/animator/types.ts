/**
 * Block Animator 数据模型 —— 身体分块动画录制器
 *
 * 整个运行时消费链路：
 *   Project.clips[name].tracks[partId].keyframes  →  Animator.getClip(name)  →  引擎 CharacterAssembler 播放
 *
 * 这里的类型既要满足编辑器录制/回放，也要满足游戏 runtime 播放。
 * 关键帧数据本身就是 runtime 直接消费的数据结构（没有编辑器专有字段）。
 *
 * 层级约定：部件组成父子骨架（PartDef.parent）。
 * 关键帧里的 x/y/rot/scale 一律是 **相对父节点** 的局部变换；
 * 父节点发生任何变化（移动/旋转/缩放/动画插值），子节点都会跟随父节点变换，
 * 而子节点记录的相对偏移保持不变。
 */

/** 单个部件某一帧的变换快照 —— 相对父节点的局部变换（根部件相对角色原点） */
export interface PartPose {
  /** 相对父节点的 X 偏移（世界单位，+X 向右） */
  x: number;
  /** 相对父节点的 Y 偏移（世界单位，+Y 向上） */
  y: number;
  /** 旋转（度），绕 Z 轴，逆时针为正 */
  rot: number;
  /** 均匀缩放（Z 轴缩放也用它） */
  scale: number;
  /** 相对父节点的 Z 偏移（世界单位，朝相机为 +Z）；老数据缺省按 0 */
  z?: number;
  /** 绕 X 轴旋转（度）；老数据缺省按 0 */
  rotX?: number;
  /** 绕 Y 轴旋转（度）；老数据缺省按 0 */
  rotY?: number;
  /** X 轴附加缩放（乘在 scale 上，缺省 1） */
  scaleX?: number;
  /** Y 轴附加缩放（乘在 scale 上，缺省 1） */
  scaleY?: number;
}

/** 3D 扩展字段读取（缺省回退） */
export const poseZ = (p: PartPose) => p.z ?? 0;
export const poseRotX = (p: PartPose) => p.rotX ?? 0;
export const poseRotY = (p: PartPose) => p.rotY ?? 0;
export const poseScaleX = (p: PartPose) => (p.scaleX ?? 1) * p.scale;
export const poseScaleY = (p: PartPose) => (p.scaleY ?? 1) * p.scale;
export const poseScaleZ = (p: PartPose) => p.scale;

/** 关键帧：某时间点的一个 pose */
export interface Keyframe {
  /** 时间（秒），相对 clip 起点 */
  t: number;
  pose: PartPose;
  /** 缓动函数名，runtime 用 ease 名查表 */
  ease: EaseName;
  /**
   * 显示/隐藏行为：undefined = 该帧不改变可见性；
   * true/false = 在该时刻显式记录"显示/隐藏"，采样时按最近的显式记录生效。
   */
  visible?: boolean;
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

/**
 * 节点"贴图"覆盖物：贴在该节点上的一张图，可独立移动/旋转/缩放。
 * 跟随节点（父级）变换一起动，但它自己的位移/旋转/缩放 **不影响任何子节点**。
 */
export interface OverlayDef {
  /** 覆盖图片路径（相对 public/，来自 metadata.json） */
  texturePath: string;
  /** 相对节点的偏移 */
  offsetX: number;
  offsetY: number;
  /** 相对节点的旋转（度） */
  rot: number;
  /** 相对节点的缩放（乘在节点基准尺寸上） */
  scale: number;
  /** 相对节点的 Z 偏移（缺省 0） */
  offsetZ?: number;
  /** 绕 X / Y 轴旋转（度，缺省 0） */
  rotX?: number;
  rotY?: number;
  /** X / Y 轴附加缩放（乘在 scale 上，缺省 1） */
  scaleX?: number;
  scaleY?: number;
}

/** 一个角色/怪物的完整动画项目 */
export interface AnimatorProject {
  version: 2;
  /** 角色/怪物 ID（对应 sprite_ani/manifest.json 里的 characterId 或 monsterId） */
  targetId: string;
  /** 每个方向标签页一套独立的部件骨架与 clip */
  directions: Record<DirTab, DirectionEntry>;
  /** 编辑时 FPS，runtime 用不到但保留方便重录 */
  fps: number;
}

/**
 * 方向标签页：下(S) / 右(E) / 上(N) / 左(W)
 * 每个标签下都有一套完整的部件节点（独立录制、独立贴图）。
 */
export type DirTab = 'S' | 'E' | 'N' | 'W';

export const DIR_TABS: { tab: DirTab; label: string }[] = [
  { tab: 'S', label: '下' },
  { tab: 'E', label: '右' },
  { tab: 'N', label: '上' },
  { tab: 'W', label: '左' },
];

/** 一个方向的编辑上下文：一套节点 + 一组 clip */
export interface DirectionEntry {
  parts: PartDef[];
  clips: Record<string, Clip>;
}

/** metadata.json 里的一张可用图片 */
export interface MetadataImage {
  id: string;
  label: string;
  /** 相对 public/ 的路径 */
  path: string;
  /** 分组（图库选择器里按组展示） */
  group?: string;
}

/** public/metadata.json 顶层结构 */
export interface ImageMetadata {
  version: number;
  count?: number;
  images: MetadataImage[];
}

/**
 * 部件在视口中的基准布局（世界单位）。
 *
 * 素材是"居中的原始部件小图"，它在 512 画布上的摆放位置由 manifest.layoutS 给出；
 * 这里已经换算成世界单位，只保留渲染需要的信息：
 *   - x / y：部件中心相对 **父节点中心** 的偏移（保证父节点变换时子节点跟随）
 *   - h：部件高度（宽度按贴图原始宽高比自动换算）
 */
export interface PartLayout {
  x: number;
  y: number;
  h: number;
}

/** 部件定义（编辑器用） */
export interface PartDef {
  id: string;
  /** 显示名 */
  label: string;
  /** 父部件 id；根部件为 null。pose 里的 x/y 永远相对父节点 */
  parent: string | null;
  /** 贴图路径（相对 public/，来自 manifest；空 = 用占位块） */
  texturePath: string;
  /** 视口内占位/贴图的基准边长（世界单位；无 layout 时使用） */
  size?: number;
  /** 基准布局（世界单位）；null/缺省 = 旧版整幅画布模式 */
  layout?: PartLayout | null;
  /** 该部件默认 pose（录制起点用） */
  defaultPose: PartPose;
  /** 层级排序（数值大的画在上一层） */
  zIndex: number;
  /** 节点"贴图"覆盖物（可选） */
  overlay?: OverlayDef | null;
}

/* ---------------- public/assets/sprites/manifest.json（v4 资源清单） ---------------- */

/** 部件在 512 画布上的位置：cx 中心 X，bottom/top 边缘 Y，h 目标高度 */
export interface ManifestLayoutItem {
  cx: number;
  bottom?: number;
  top?: number;
  h: number;
}

export interface ManifestEquipment {
  id: string;
  /** hat / back / hand / foot / weapon */
  slot: string;
  /** 单张共享图（不区分方向） */
  sharedImage?: boolean;
  /** 共享图路径（sharedImage 时有效） */
  path?: string;
  /** 各方向独立图路径（sharedImage=false 时有效） */
  pathByDirection?: Partial<Record<DirTab, string>>;
}

export interface SpriteManifest {
  version: number;
  /** 单部件画布尺寸（px），默认 512 */
  partGrid?: number;
  /** 脚底基准线（画布 y，px） */
  anchorFootY?: number;
  directions?: DirTab[];
  sharedBodies: {
    /** 共享素体目录（相对 assets/sprites/） */
    path: string;
    /** 素体部件 → 源图高度（px） */
    parts: Record<string, number>;
    /** S 方向在画布中的布局（四方向共用） */
    layoutS: Record<string, ManifestLayoutItem>;
    /** 叠加顺序（由下到上） */
    zOrderS: string[];
  };
  characters?: {
    id: string;
    /** 头部图目录（相对 assets/sprites/），每方向一张 */
    headPath: string;
    equipment?: Record<string, string>;
  }[];
  equipment?: ManifestEquipment[];
}

/** 缓动函数名 —— runtime 和编辑器共用一个查表 */
export type EaseName =
  | 'linear'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeOutBack'
  | 'easeOutElastic';

/** 插值：给定 track 和时间，返回该时刻相对父节点的 pose */
export function sampleTrack(track: Track, t: number): PartPose {
  const ZERO: PartPose = { x: 0, y: 0, rot: 0, scale: 1 };
  if (track.keys.length === 0) return { ...ZERO };
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
  /** 可选字段插值：两侧都没定义则不输出，单侧缺省按 def */
  const lo = (av: number | undefined, bv: number | undefined, def: number): number | undefined =>
    av === undefined && bv === undefined ? undefined : (av ?? def) + ((bv ?? def) - (av ?? def)) * k;
  return {
    x: a.pose.x + (b.pose.x - a.pose.x) * k,
    y: a.pose.y + (b.pose.y - a.pose.y) * k,
    rot: a.pose.rot + (b.pose.rot - a.pose.rot) * k,
    scale: a.pose.scale + (b.pose.scale - a.pose.scale) * k,
    z: lo(a.pose.z, b.pose.z, 0),
    rotX: lo(a.pose.rotX, b.pose.rotX, 0),
    rotY: lo(a.pose.rotY, b.pose.rotY, 0),
    scaleX: lo(a.pose.scaleX, b.pose.scaleX, 1),
    scaleY: lo(a.pose.scaleY, b.pose.scaleY, 1),
  };
}

/** 采样显示/隐藏：取 t 之前最近一个显式记录的 visible；没有记录则默认显示 */
export function sampleVisibility(track: Track, t: number): boolean {
  let vis = true;
  for (const k of track.keys) {
    if (k.t <= t + 1e-6 && k.visible !== undefined) vis = k.visible;
  }
  return vis;
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

export interface SampleResult {
  /** 每个部件相对父节点的局部 pose */
  poses: Record<string, PartPose>;
  /** 每个部件的显示/隐藏 */
  visibility: Record<string, boolean>;
}

/** 采样 clip 到任意时间，返回所有部件的局部 pose（相对父节点）与可见性 */
export function sampleClip(clip: Clip, tRaw: number): SampleResult {
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
  const poses: Record<string, PartPose> = {};
  const visibility: Record<string, boolean> = {};
  for (const track of clip.tracks) {
    poses[track.partId] = sampleTrack(track, t);
    visibility[track.partId] = sampleVisibility(track, t);
  }
  return { poses, visibility };
}

/** 新建覆盖物默认值 */
export function defaultOverlay(texturePath: string): OverlayDef {
  return { texturePath, offsetX: 0, offsetY: 0, rot: 0, scale: 1 };
}
