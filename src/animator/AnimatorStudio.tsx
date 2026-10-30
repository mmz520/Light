import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  AnimatorProject,
  Clip,
  DIR_TABS,
  DirTab,
  DirectionEntry,
  ImageMetadata,
  Keyframe,
  MetadataImage,
  OverlayDef,
  PartDef,
  PartLayout,
  PartPose,
  SpriteManifest,
  sampleClip,
} from './types';
import { Viewport3D, ViewportTool, assetUrl } from './Viewport3D';
import { Timeline } from './Timeline';
import { PartTree } from './PartTree';
import { PosePanel } from './PosePanel';
import { ClipPanel } from './ClipPanel';

/**
 * 部件骨架（v4 资源体系）
 *
 * 素材是"居中的原始部件小图"（role/common/arm、leg、torso_U、torso_L + 头部整图 + 装备），
 * 摆放位置由 manifest.layoutS 给出（512 画布、脚底基准线 anchorFootY）。
 * 这里把画布坐标换算成世界单位，并存成每个节点的基准布局：
 *   layout.x / layout.y = 部件中心相对父节点中心的偏移（父节点变换时子节点自然跟随）
 *   layout.h            = 部件高度，宽度按贴图宽高比自动换算
 */
const PART_CANVAS_SIZE = 2; // 512px 画布映射到的世界尺寸
const SPRITES_PREFIX = 'assets/sprites/';

/** 骨架节点：贴图来源 body=共享素体 / head=角色头图 / slot=装备槽 */
interface SkeletonNode {
  id: string;
  label: string;
  parent: string | null;
  src: { kind: 'body'; part: string } | { kind: 'head' } | { kind: 'slot'; slot: string };
}

/** 父节点必须排在子节点之前（用于累加世界坐标） */
const SKELETON_NODES: SkeletonNode[] = [
  { id: 'torso_L', label: '身体下半部分', parent: null, src: { kind: 'body', part: 'torso_L' } },
  { id: 'torso_U', label: '身体上半部分', parent: 'torso_L', src: { kind: 'body', part: 'torso_U' } },
  { id: 'back', label: '背包', parent: 'torso_U', src: { kind: 'slot', slot: 'back' } },
  { id: 'head', label: '头', parent: 'torso_U', src: { kind: 'head' } },
  { id: 'hat', label: '帽子', parent: 'head', src: { kind: 'slot', slot: 'hat' } },
  { id: 'upper_arm_L', label: '左上臂', parent: 'torso_U', src: { kind: 'body', part: 'arm' } },
  { id: 'forearm_L', label: '左下臂', parent: 'upper_arm_L', src: { kind: 'body', part: 'arm' } },
  { id: 'hand_L', label: '左手', parent: 'forearm_L', src: { kind: 'slot', slot: 'hand' } },
  { id: 'upper_arm_R', label: '右上臂', parent: 'torso_U', src: { kind: 'body', part: 'arm' } },
  { id: 'forearm_R', label: '右下臂', parent: 'upper_arm_R', src: { kind: 'body', part: 'arm' } },
  { id: 'hand_R', label: '右手', parent: 'forearm_R', src: { kind: 'slot', slot: 'hand' } },
  { id: 'weapon', label: '武器', parent: 'hand_R', src: { kind: 'slot', slot: 'weapon' } },
  { id: 'thigh_L', label: '左大腿', parent: 'torso_L', src: { kind: 'body', part: 'leg' } },
  { id: 'calf_L', label: '左小腿', parent: 'thigh_L', src: { kind: 'body', part: 'leg' } },
  { id: 'foot_L', label: '左脚', parent: 'calf_L', src: { kind: 'slot', slot: 'foot' } },
  { id: 'thigh_R', label: '右大腿', parent: 'torso_L', src: { kind: 'body', part: 'leg' } },
  { id: 'calf_R', label: '右小腿', parent: 'thigh_R', src: { kind: 'body', part: 'leg' } },
  { id: 'foot_R', label: '右脚', parent: 'calf_R', src: { kind: 'slot', slot: 'foot' } },
];

/** 装备槽中文名（图库分组 + 节点名兜底） */
const SLOT_LABEL: Record<string, string> = {
  hat: '帽子', back: '背包', hand: '手套', foot: '鞋子', weapon: '武器',
};

/** 初始是否只加载火柴棒（素体）图片；设 false 则连带头部与装备一起加载 */
const INITIAL_BODY_ONLY = true;

/**
 * 启动时自动加载的工程文件（相对 public/）。
 * 由 `node tools/build_animations.mjs` 生成；设为 null 则退回空工程。
 */
const AUTO_LOAD_PROJECT = 'animations/engineer_spanner_anim.json';

/** manifest 里 S 方向布局（back 在 S 方向用背带位置 back_S） */
function manifestLayout(manifest: SpriteManifest, id: string) {
  const L = manifest.sharedBodies.layoutS;
  const raw = L[id] ?? (id === 'back' ? L['back_S'] : undefined);
  if (!raw) return null;
  const cy = raw.bottom !== undefined ? raw.bottom - raw.h / 2 : (raw.top ?? 0) + raw.h / 2;
  return { cx: raw.cx, cy, h: raw.h };
}

/** 装备贴图：按槽位 + 方向解析（共享图直接用 path） */
function equipTexture(manifest: SpriteManifest, slot: string, dir: DirTab): string {
  const char = manifest.characters?.[0];
  const wantId = char?.equipment?.[slot];
  const eq = (manifest.equipment ?? []).find(e => e.slot === slot && (!wantId || e.id === wantId))
    ?? (manifest.equipment ?? []).find(e => e.slot === slot);
  if (!eq) return '';
  const rel = eq.sharedImage ? eq.path : eq.pathByDirection?.[dir];
  return rel ? SPRITES_PREFIX + rel : '';
}

/** 按 manifest 的骨架顺序与布局构建一套部件（每个方向一套） */
function makeSkeleton(dir: DirTab, manifest: SpriteManifest): PartDef[] {
  const grid = manifest.partGrid ?? 512;
  const anchor = manifest.anchorFootY ?? grid * 0.8;
  const px = PART_CANVAS_SIZE / grid; // 1 画布像素 = 多少世界单位
  const zOrder = manifest.sharedBodies.zOrderS ?? [];
  const char = manifest.characters?.[0];

  const centerOf = new Map<string, { x: number; y: number }>();
  const parts: PartDef[] = [];

  SKELETON_NODES.forEach((node, i) => {
    // 贴图：初始只挂火柴棒（素体）图片。
    // 头部 / 帽子 / 背包 / 手套 / 鞋子 / 武器 的节点保留（骨架结构不变、可随时从右侧图库挂图），
    // 但初始不加载图片 —— 先把火柴棒骨架摆好，再逐个挂装饰。
    let texturePath = '';
    if (node.src.kind === 'body') {
      texturePath = `${SPRITES_PREFIX}${manifest.sharedBodies.path}/${node.src.part}.png`;
    } else if (!INITIAL_BODY_ONLY) {
      texturePath = node.src.kind === 'head'
        ? (char ? `${SPRITES_PREFIX}${char.headPath}/${dir}.png` : '')
        : equipTexture(manifest, node.src.slot, dir);
    }

    // 画布布局 → 世界坐标（画布中心为 x=0，脚底线为 y=0）
    const lay = manifestLayout(manifest, node.id);
    let layout: PartLayout | null = null;
    if (lay) {
      const world = { x: (lay.cx - grid / 2) * px, y: (anchor - lay.cy) * px };
      const parentWorld = (node.parent && centerOf.get(node.parent)) || { x: 0, y: 0 };
      layout = { x: world.x - parentWorld.x, y: world.y - parentWorld.y, h: lay.h * px };
      centerOf.set(node.id, world);
    }

    const zIdx = zOrder.indexOf(node.id);
    parts.push({
      id: node.id,
      label: node.label,
      parent: node.parent,
      texturePath,
      size: PART_CANVAS_SIZE,
      layout,
      defaultPose: { x: 0, y: 0, rot: 0, scale: 1 },
      zIndex: zIdx >= 0 ? zIdx : zOrder.length + i,
      overlay: null,
    });
  });
  return parts;
}

/** 旧版骨架（无 manifest 时回退）：整幅 512 画布叠加 */
function makeSkeletonLegacy(dir: DirTab, availablePaths: Set<string>): PartDef[] {
  const tex = (id: string) => {
    const p = `assets/sprites/role/common/${dir}/${id}.png`;
    return availablePaths.has(p) ? p : '';
  };
  const P = (id: string, label: string, parent: string | null, zIndex: number): PartDef => ({
    id, label, parent,
    texturePath: tex(id),
    size: PART_CANVAS_SIZE,
    layout: null,
    defaultPose: { x: 0, y: 0, rot: 0, scale: 1 },
    zIndex,
    overlay: null,
  });
  return [
    P('torso_L', '身体下半部分', null, 5),
    P('torso_U', '身体上半部分', 'torso_L', 6),
    P('head', '头', 'torso_U', 9),
    P('upper_arm_L', '左上臂', 'torso_U', 4),
    P('upper_arm_R', '右上臂', 'torso_U', 8),
    P('forearm_L', '左下臂', 'upper_arm_L', 4),
    P('forearm_R', '右下臂', 'upper_arm_R', 8),
    P('thigh_L', '左大腿', 'torso_L', 2),
    P('thigh_R', '右大腿', 'torso_L', 3),
    P('calf_L', '左小腿', 'thigh_L', 2),
    P('calf_R', '右小腿', 'thigh_R', 3),
  ];
}

/** 图库：由 manifest 派生出实际存在的素材清单（素体 / 头部 / 装备） */
function imagesFromManifest(manifest: SpriteManifest): MetadataImage[] {
  const out: MetadataImage[] = [];
  const char = manifest.characters?.[0];
  const dirs = manifest.directions ?? DIR_TABS.map(d => d.tab);

  for (const part of Object.keys(manifest.sharedBodies.parts ?? {})) {
    out.push({
      id: `body_${part}`,
      label: `素体 · ${part}`,
      path: `${SPRITES_PREFIX}${manifest.sharedBodies.path}/${part}.png`,
      group: '素体部件',
    });
  }
  if (char) {
    for (const d of dirs) {
      out.push({ id: `head_${d}`, label: `头部 ${d}`, path: `${SPRITES_PREFIX}${char.headPath}/${d}.png`, group: '头部' });
    }
  }
  for (const eq of manifest.equipment ?? []) {
    const group = `装备 · ${SLOT_LABEL[eq.slot] ?? eq.slot}`;
    if (eq.sharedImage) {
      if (eq.path) out.push({ id: eq.id, label: `${eq.id}（通用）`, path: SPRITES_PREFIX + eq.path, group });
    } else {
      for (const d of dirs) {
        const p = eq.pathByDirection?.[d];
        if (p) out.push({ id: `${eq.id}_${d}`, label: `${eq.id} ${d}`, path: SPRITES_PREFIX + p, group });
      }
    }
  }
  return out;
}

function newClip(name: string, duration: number, parts: PartDef[]): Clip {
  const tracks = parts.map(p => ({
    partId: p.id,
    keys: [{ t: 0, pose: { ...p.defaultPose }, ease: 'linear' as const }],
  }));
  return { name, duration, loop: 'loop', tracks };
}

function newDirectionEntry(dir: DirTab, manifest: SpriteManifest | null, availablePaths: Set<string>): DirectionEntry {
  const parts = manifest ? makeSkeleton(dir, manifest) : makeSkeletonLegacy(dir, availablePaths);
  return {
    parts,
    clips: {
      idle: newClip('idle', 2.0, parts),
      walk: newClip('walk', 1.2, parts),
      attack: newClip('attack', 0.8, parts),
    },
  };
}

function newProject(manifest: SpriteManifest | null, availablePaths: Set<string>): AnimatorProject {
  const charId = manifest?.characters?.[0]?.id ?? 'engineer_spanner';
  return {
    version: 2,
    targetId: charId,
    fps: 60,
    directions: {
      S: newDirectionEntry('S', manifest, availablePaths),
      E: newDirectionEntry('E', manifest, availablePaths),
      N: newDirectionEntry('N', manifest, availablePaths),
      W: newDirectionEntry('W', manifest, availablePaths),
    },
  };
}

/** 兼容旧版 v1 工程（单方向） */
function migrateProject(p: AnimatorProject, manifest: SpriteManifest | null, availablePaths: Set<string>): AnimatorProject {
  if (p.directions) return p;
  const legacy = p as unknown as { parts: PartDef[]; clips: Record<string, Clip> };
  return {
    ...p,
    version: 2,
    directions: {
      S: { parts: legacy.parts, clips: legacy.clips },
      E: newDirectionEntry('E', manifest, availablePaths),
      N: newDirectionEntry('N', manifest, availablePaths),
      W: newDirectionEntry('W', manifest, availablePaths),
    },
  };
}

/** 加载工程后校正节点集合：与当前骨架不一致时用骨架重建 part 定义，动画数据保留 */
function alignParts(
  directions: AnimatorProject['directions'],
  manifest: SpriteManifest | null,
  availablePaths: Set<string>,
): AnimatorProject['directions'] {
  const out = {} as AnimatorProject['directions'];
  for (const tab of DIR_TABS) {
    const dir = directions[tab.tab];
    if (!dir) continue;
    const skeleton = manifest ? makeSkeleton(tab.tab, manifest) : makeSkeletonLegacy(tab.tab, availablePaths);
    const sameSet =
      dir.parts.length === skeleton.length &&
      skeleton.every(s => dir.parts.some(p => p.id === s.id));
    out[tab.tab] = sameSet ? dir : { ...dir, parts: skeleton };
  }
  return out;
}

export function AnimatorStudio({ onBack }: { onBack: () => void }) {
  const [availablePaths, setAvailablePaths] = useState<Set<string>>(() => new Set());
  const [images, setImages] = useState<MetadataImage[]>([]);
  const [project, setProject] = useState<AnimatorProject | null>(null);
  const [activeDir, setActiveDir] = useState<DirTab>('S');
  const [activeClipName, setActiveClipName] = useState<string>('idle');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<ViewportTool>('move');
  const [cursorT, setCursorT] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // 加载资源清单：优先 assets/sprites/manifest.json（v4 素体+装备布局），失败回退旧 metadata.json 图库
  const [manifest, setManifest] = useState<SpriteManifest | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      let m: SpriteManifest | null = null;
      try {
        const r = await fetch(assetUrl(`${SPRITES_PREFIX}manifest.json`));
        if (r.ok) m = (await r.json()) as SpriteManifest;
      } catch {
        m = null;
      }
      if (!alive) return;

      let imgs: MetadataImage[] = m ? imagesFromManifest(m) : [];
      if (!m) {
        // 兼容旧资源：metadata.json 的平铺图库 + 旧骨架
        try {
          const meta = (await fetch(assetUrl('metadata.json')).then(r => r.json())) as ImageMetadata;
          imgs = meta.images ?? [];
        } catch {
          imgs = [];
        }
      }
      if (!alive) return;
      setManifest(m);
      setImages(imgs);
      const paths = new Set(imgs.map(i => i.path));
      setAvailablePaths(paths);

      // 启动自动加载：优先读 AUTO_LOAD_PROJECT，失败则用 manifest 新建空工程
      let boot: AnimatorProject | null = null;
      if (AUTO_LOAD_PROJECT) {
        try {
          const r = await fetch(assetUrl(AUTO_LOAD_PROJECT));
          if (r.ok) {
            const loaded = migrateProject(JSON.parse(await r.text()) as AnimatorProject, m, paths);
            // 节点集合与当前骨架不一致时以骨架为准（避免轨道指向已不存在的节点）
            boot = { ...loaded, directions: alignParts(loaded.directions, m, paths) };
          }
        } catch {
          boot = null;
        }
      }
      if (!alive) return;
      setProject(boot ?? newProject(m, paths));
      if (boot) setActiveClipName(prev => (boot!.directions[activeDir]?.clips[prev] ? prev : 'idle'));
    };
    load();
    return () => { alive = false; };
  }, []);

  const entry = project?.directions[activeDir];
  const clip = entry?.clips[activeClipName] ?? entry?.clips[Object.keys(entry?.clips ?? {})[0] ?? ''];

  useEffect(() => {
    if (entry && !entry.clips[activeClipName]) {
      const first = Object.keys(entry.clips)[0];
      if (first) setActiveClipName(first);
    }
  }, [entry, activeClipName]);

  // W/E/R 切换工具
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'w' || e.key === 'W') setTool('move');
      else if (e.key === 'e' || e.key === 'E') setTool('rotate');
      else if (e.key === 'r' || e.key === 'R') setTool('scale');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const projectRef = useRef(project);
  projectRef.current = project;

  // 调试句柄（供自动化检查读取/驱动编辑器状态）
  useEffect(() => {
    (window as unknown as { __animator?: unknown }).__animator = {
      project, activeDir, activeClipName, images: images.length,
      // 自动化用：跳到指定 clip / 时间点（停止播放）
      seek: (clipName: string | undefined, t: number | undefined, dir?: DirTab) => {
        if (dir) setActiveDir(dir);
        if (clipName) setActiveClipName(clipName);
        if (t !== undefined) { setIsPlaying(false); setCursorT(t); }
      },
    };
  }, [project, activeDir, activeClipName, images]);

  /** 更新当前方向某个 clip */
  const updateClip = useCallback((name: string, mutator: (c: Clip) => Clip) => {
    setProject(p => {
      if (!p) return p;
      const dir = p.directions[activeDir];
      return {
        ...p,
        directions: { ...p.directions, [activeDir]: { ...dir, clips: { ...dir.clips, [name]: mutator(dir.clips[name]) } } },
      };
    });
  }, [activeDir]);

  /** 更新当前方向部件定义（贴图 / zIndex / 覆盖图） */
  const updatePart = useCallback((partId: string, mut: (p: PartDef) => PartDef) => {
    setProject(p => {
      if (!p) return p;
      const dir = p.directions[activeDir];
      return {
        ...p,
        directions: { ...p.directions, [activeDir]: { ...dir, parts: dir.parts.map(x => (x.id === partId ? mut(x) : x)) } },
      };
    });
  }, [activeDir]);

  /** 在活动 clip 的指定时间点为多个部件写关键帧 */
  const setKeyframesAt = useCallback((t: number, partPoses: Record<string, PartPose>) => {
    updateClip(activeClipName, c => ({
      ...c,
      tracks: c.tracks.map(tr => {
        const pose = partPoses[tr.partId];
        if (!pose) return tr;
        const filtered = tr.keys.filter(k => Math.abs(k.t - t) > 1e-3);
        const keys: Keyframe[] = [...filtered, { t, pose: { ...pose }, ease: 'easeOutQuad' as const }].sort((a, b) => a.t - b.t);
        return { ...tr, keys };
      }),
    }));
  }, [activeClipName, updateClip]);

  /** 写单个部件在当前时间点的关键帧 */
  const writeKeyAt = useCallback((partId: string, pose: PartPose) => {
    updateClip(activeClipName, c => ({
      ...c,
      tracks: c.tracks.map(tr => {
        if (tr.partId !== partId) return tr;
        const keys = tr.keys.filter(k => Math.abs(k.t - cursorT) > 1e-3);
        keys.push({ t: cursorT, pose: { ...pose }, ease: 'linear' });
        keys.sort((a, b) => a.t - b.t);
        return { ...tr, keys };
      }),
    }));
  }, [activeClipName, cursorT, updateClip]);

  /** 记录显示/隐藏行为（合并进当前时间点关键帧） */
  const setVisibilityAt = useCallback((partId: string, visible: boolean) => {
    updateClip(activeClipName, c => ({
      ...c,
      tracks: c.tracks.map(tr => {
        if (tr.partId !== partId) return tr;
        const idx = tr.keys.findIndex(k => Math.abs(k.t - cursorT) < 1e-3);
        if (idx >= 0) {
          const keys = [...tr.keys];
          keys[idx] = { ...keys[idx], visible };
          return { ...tr, keys };
        }
        const pose = sampledRef.current?.poses[partId] ?? { x: 0, y: 0, rot: 0, scale: 1 };
        const keys = [...tr.keys, { t: cursorT, pose, ease: 'linear' as const, visible }].sort((a, b) => a.t - b.t);
        return { ...tr, keys };
      }),
    }));
  }, [activeClipName, cursorT, updateClip]);

  const deleteKeyframesAt = useCallback((t: number) => {
    updateClip(activeClipName, c => ({
      ...c,
      tracks: c.tracks.map(tr => ({ ...tr, keys: tr.keys.filter(k => Math.abs(k.t - t) > 1e-3) })),
    }));
  }, [activeClipName, updateClip]);

  /** 帧剪贴板：右键红线复制的一整帧（所有部件的 pose + 显隐） */
  const [frameClip, setFrameClip] = useState<{ poses: Record<string, PartPose>; visibility: Record<string, boolean> } | null>(null);

  const copyFrame = useCallback((t: number) => {
    if (!clip) return;
    const s = sampleClip(clip, t);
    setFrameClip({ poses: s.poses, visibility: s.visibility });
  }, [clip]);

  const pasteFrame = useCallback((t: number) => {
    const snap = frameClip;
    if (!snap) return;
    updateClip(activeClipName, c => ({
      ...c,
      tracks: c.tracks.map(tr => {
        const pose = snap.poses[tr.partId];
        if (!pose) return tr;
        const key: Keyframe = { t, pose: { ...pose }, ease: 'easeOutQuad' };
        const vis = snap.visibility[tr.partId];
        if (vis !== undefined) key.visible = vis;
        const filtered = tr.keys.filter(k => Math.abs(k.t - t) > 1e-3);
        return { ...tr, keys: [...filtered, key].sort((a, b) => a.t - b.t) };
      }),
    }));
  }, [activeClipName, frameClip, updateClip]);

  const moveKeyframe = useCallback((partId: string, fromT: number, toT: number) => {
    updateClip(activeClipName, c => ({
      ...c,
      tracks: c.tracks.map(tr => {
        if (tr.partId !== partId) return tr;
        const key = tr.keys.find(k => Math.abs(k.t - fromT) < 1e-3);
        if (!key) return tr;
        const keys = tr.keys.filter(k => Math.abs(k.t - fromT) > 1e-3 && Math.abs(k.t - toT) > 1e-3);
        keys.push({ ...key, t: toT });
        keys.sort((a, b) => a.t - b.t);
        return { ...tr, keys };
      }),
    }));
  }, [activeClipName, updateClip]);

  // 播放循环
  useEffect(() => {
    if (!isPlaying || !clip) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setCursorT(t => {
        let next = t + dt;
        if (next > clip.duration) {
          if (clip.loop === 'loop') next -= clip.duration;
          else if (clip.loop === 'pingpong') next = clip.duration * 2 - next;
          else { setIsPlaying(false); return clip.duration; }
        }
        if (next < 0) next += clip.duration;
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, clip]);

  /** 采样当前时间点（相对父节点的 pose + 可见性） */
  const sampled = useMemo(
    () => (clip ? sampleClip(clip, cursorT) : { poses: {}, visibility: {} }),
    [clip, cursorT],
  );
  const sampledRef = useRef(sampled);
  sampledRef.current = sampled;

  const selectedPartId = selectedId && selectedId.includes('#') ? selectedId.split('#')[0] : selectedId;
  const selectedPart = entry?.parts.find(p => p.id === selectedPartId) ?? null;

  // 导出 JSON
  const handleSave = () => {
    if (!project) return;
    const data = JSON.stringify(project, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.targetId}_anim.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 导入 JSON
  const handleLoad = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const p = migrateProject(JSON.parse(reader.result as string), manifest, availablePaths);
          setProject(p);
          setActiveClipName(Object.keys(p.directions[activeDir].clips)[0] ?? 'idle');
          setCursorT(0);
          setIsPlaying(false);
        } catch (e) { alert('加载失败: ' + (e as Error).message); }
      };
      reader.readAsText(f);
    };
    input.click();
  };

  /** 新增 clip（当前方向） */
  const handleAddClip = () => {
    if (!project || !entry) return;
    const name = prompt('新 clip 名:', `anim_${Object.keys(entry.clips).length}`);
    if (!name || entry.clips[name]) return;
    setProject(p => {
      if (!p) return p;
      const dir = p.directions[activeDir];
      return {
        ...p,
        directions: { ...p.directions, [activeDir]: { ...dir, clips: { ...dir.clips, [name]: newClip(name, 1.0, dir.parts) } } },
      };
    });
    setActiveClipName(name);
    setCursorT(0);
  };

  /** 删除 clip（当前方向） */
  const handleDeleteClip = () => {
    if (!project || !entry) return;
    const names = Object.keys(entry.clips);
    if (names.length <= 1) { alert('至少保留一个 clip'); return; }
    if (!confirm(`删除 clip "${activeClipName}"?`)) return;
    setProject(p => {
      if (!p) return p;
      const dir = p.directions[activeDir];
      const next = { ...dir.clips };
      delete next[activeClipName];
      return { ...p, directions: { ...p.directions, [activeDir]: { ...dir, clips: next } } };
    });
    setActiveClipName(names.filter(n => n !== activeClipName)[0]);
  };

  if (!project || !entry || !clip) {
    return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', background: '#1e1e22' }}>加载中…</div>;
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '240px 1fr 280px',
      gridTemplateRows: 'auto 1fr 300px',
      gridTemplateAreas: `
        "top   top    top"
        "left  canvas right"
        "bottom bottom bottom"
      `,
      height: '100vh',
      background: '#1e1e22',
      color: '#e4e4e8',
      fontFamily: 'system-ui, sans-serif',
      fontSize: 13,
    }}>
      {/* 顶部：返回按钮 + 工具栏 */}
      <div style={{ gridArea: 'top', display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #333', background: '#25252a' }}>
        <button
          onClick={onBack}
          style={{ padding: '5px 14px', background: '#3a5f8a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
          title="返回游戏"
        >← 返回</button>
        <b>Block Animator</b>
        <span style={{ opacity: .5 }}>
          {project.targetId} · {DIR_TABS.find(d => d.tab === activeDir)?.label}({activeDir})
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setKeyframesAt(cursorT, sampled.poses)}>◆ Add Key @ {cursorT.toFixed(2)}s</button>
        <button onClick={handleSave}>保存 JSON</button>
        <button onClick={handleLoad}>加载 JSON</button>
      </div>

      {/* 左：方向标签页 + 部件层级树 */}
      <div style={{ gridArea: 'left', borderRight: '1px solid #333', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid #333', background: '#25252a', flexShrink: 0 }}>
          {DIR_TABS.map(({ tab, label }) => (
            <button
              key={tab}
              onClick={() => { setActiveDir(tab); setSelectedId(null); setCursorT(0); setIsPlaying(false); }}
              style={{
                flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer', fontSize: 12,
                background: activeDir === tab ? '#3b5' : 'transparent',
                color: activeDir === tab ? '#000' : '#bbb',
                fontWeight: activeDir === tab ? 700 : 400,
                borderBottom: activeDir === tab ? '2px solid #3b5' : '2px solid transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ overflow: 'auto' }}>
          <PartTree
            parts={entry.parts}
            selectedId={selectedPartId}
            onSelect={id => setSelectedId(id)}
          />
        </div>
      </div>

      {/* 中：3D 视口 */}
      <div style={{ gridArea: 'canvas', position: 'relative', overflow: 'hidden' }}>
        <Viewport3D
          parts={entry.parts}
          poses={sampled.poses}
          visibility={sampled.visibility}
          selectedId={selectedId}
          tool={tool}
          onToolChange={setTool}
          onSelect={setSelectedId}
          onPoseChange={(partId, pose) => writeKeyAt(partId, pose)}
          onOverlayChange={(partId, overlay: OverlayDef) => updatePart(partId, p => ({ ...p, overlay }))}
        />
      </div>

      {/* 右：属性面板 */}
      <div style={{ gridArea: 'right', borderLeft: '1px solid #333', overflow: 'auto' }}>
        <ClipPanel
          clip={clip}
          allClips={entry.clips}
          activeClipName={activeClipName}
          onSwitch={setActiveClipName}
          onAdd={handleAddClip}
          onDelete={handleDeleteClip}
          onUpdate={(name, mut) => updateClip(name, mut)}
        />
        <PosePanel
          part={selectedPart}
          pose={selectedPartId ? sampled.poses[selectedPartId] ?? null : null}
          visible={selectedPartId ? sampled.visibility[selectedPartId] !== false : true}
          clip={clip}
          cursorT={cursorT}
          images={images}
          onPoseChange={(field, value) => {
            if (!selectedPartId) return;
            const pose = { ...(sampled.poses[selectedPartId] ?? selectedPart!.defaultPose), [field]: value };
            writeKeyAt(selectedPartId, pose);
          }}
          onZIndexChange={z => selectedPartId && updatePart(selectedPartId, p => ({ ...p, zIndex: z }))}
          onSetTexture={path => selectedPartId && updatePart(selectedPartId, p => ({ ...p, texturePath: path }))}
          onOverlayChange={overlay => selectedPartId && updatePart(selectedPartId, p => ({ ...p, overlay }))}
          onOverlayClear={() => selectedPartId && updatePart(selectedPartId, p => ({ ...p, overlay: null }))}
          onSetVisibility={v => selectedPartId && setVisibilityAt(selectedPartId, v)}
          onSetEase={ease => {
            if (!selectedPartId) return;
            updateClip(activeClipName, c => ({
              ...c,
              tracks: c.tracks.map(tr =>
                tr.partId !== selectedPartId ? tr : {
                  ...tr,
                  keys: tr.keys.map(k => (Math.abs(k.t - cursorT) < 1e-3 ? { ...k, ease } : k)),
                },
              ),
            }));
          }}
          onSetLoop={(loop, loopStart) => updateClip(activeClipName, c => ({ ...c, loop, loopStart }))}
          onSetDuration={d => updateClip(activeClipName, c => ({ ...c, duration: Math.max(0.1, d) }))}
          onDeleteThisKeyframe={() => deleteKeyframesAt(cursorT)}
        />
      </div>

      {/* 下：时间轴（自身负责纵向滚动，表头吸顶） */}
      <div style={{ gridArea: 'bottom', borderTop: '1px solid #333', background: '#222226', overflow: 'hidden' }}>
        <Timeline
          clip={clip}
          parts={entry.parts}
          cursorT={cursorT}
          isPlaying={isPlaying}
          fps={project.fps}
          onCursorChange={setCursorT}
          onPlayToggle={() => setIsPlaying(p => !p)}
          onStop={() => { setIsPlaying(false); setCursorT(0); }}
          onAddKeyframe={(partId, t) => {
            const s = sampleClip(clip, t);
            setKeyframesAt(t, { [partId]: s.poses[partId] });
          }}
          onDeleteKeyframe={(partId, t) => {
            updateClip(activeClipName, c => ({
              ...c,
              tracks: c.tracks.map(tr => (tr.partId !== partId ? tr : { ...tr, keys: tr.keys.filter(k => Math.abs(k.t - t) > 1e-3) })),
            }));
          }}
          onMoveKeyframe={moveKeyframe}
          hasFrameClipboard={!!frameClip}
          onCopyFrame={copyFrame}
          onPasteFrame={pasteFrame}
        />
      </div>
    </div>
  );
}
