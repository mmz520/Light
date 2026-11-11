/**
 * 资产构造与派生
 */
import type { Clip, PartPose, Track } from '../../animator/types';
import {
  CLIP_PRESETS,
  DEFAULT_FOLDER,
  emptyDirs,
  shortId,
  uniqueName,
  type AnimNode,
  type AnimationAsset,
  type CropRect,
  type Dir,
  type ImageAsset,
  type SkeletonId,
  type TextureAsset,
  type TextureTemplate,
} from './types';
import { buildNodes } from './templates';

const ZERO_POSE: PartPose = { x: 0, y: 0, rot: 0, scale: 1 };

export function makeClip(name: string, duration: number, loop: Clip['loop'], nodes: AnimNode[]): Clip {
  const tracks: Track[] = nodes.map((n) => ({
    partId: n.id,
    keys: [{ t: 0, pose: { ...ZERO_POSE }, ease: 'linear' as const }],
  }));
  return { name, duration, loop, tracks };
}

/** 新建动画：按骨架模板铺节点，带 idle / walk / attack 三个空片段 */
export function newAnimation(name: string, template: SkeletonId, folder = DEFAULT_FOLDER): AnimationAsset {
  const nodes = buildNodes(template);
  const clips: Record<string, Clip> = {};
  for (const p of CLIP_PRESETS.slice(0, 3)) {
    clips[p.name] = makeClip(p.name, p.duration, p.loop, nodes);
  }
  return {
    id: shortId('anim'),
    name,
    folder,
    template,
    fps: 30,
    nodes,
    clips,
    createdAt: Date.now(),
  };
}

/**
 * 以另一个动画为模板新建：复用骨架与全部关键帧，清掉所有贴图，只保留素体。
 * （素体节点 arm / leg / torso_U / torso_L / body 的贴图保留，其余节点与覆盖物清空）
 */
export function deriveAnimation(base: AnimationAsset, name: string, folder = base.folder): AnimationAsset {
  const nodes: AnimNode[] = base.nodes.map((n) => ({
    ...n,
    layout: { ...n.layout },
    textureId: n.body ? n.textureId : null,
    textureColor: n.body ? (n.textureColor ?? null) : null,
    overlay: null,
  }));
  const clips: Record<string, Clip> = {};
  for (const [key, clip] of Object.entries(base.clips)) {
    clips[key] = {
      ...clip,
      tracks: clip.tracks.map((t) => ({
        partId: t.partId,
        keys: t.keys.map((k) => ({
          ...k,
          pose: { ...k.pose },
        })),
      })),
      localAnims: clip.localAnims?.map((a) => ({ ...a })),
    };
  }
  return {
    id: shortId('anim'),
    name,
    folder,
    template: base.template,
    fps: base.fps,
    nodes,
    clips,
    createdAt: Date.now(),
  };
}

export function newTexture(name: string, template: TextureTemplate, taken: string[], folder = DEFAULT_FOLDER): TextureAsset {
  return {
    id: shortId('tex'),
    name: uniqueName(name, taken),
    folder,
    template,
    image: null,
    dirs: emptyDirs(),
    createdAt: Date.now(),
  };
}

export function newImageAsset(
  name: string,
  file: string,
  width: number,
  height: number,
  taken: string[],
  folder = DEFAULT_FOLDER,
): ImageAsset {
  return {
    id: shortId('img'),
    name: uniqueName(name, taken),
    folder,
    file,
    width,
    height,
    crop: null,
    createdAt: Date.now(),
  };
}

/** 给贴图模板切换方向集合时补齐字段 */
export function switchTextureTemplate(tex: TextureAsset, template: TextureTemplate): TextureAsset {
  if (tex.template === template) return tex;
  if (template === 'single') {
    // 四向 → 单向：优先用 S，其次 E/N/W
    const first = tex.dirs.S ?? tex.dirs.E ?? tex.dirs.N ?? tex.dirs.W ?? tex.image;
    return { ...tex, template, image: first };
  }
  // 单向 → 四向：把已有图铺到 S
  return { ...tex, template, dirs: { ...tex.dirs, S: tex.dirs.S ?? tex.image } };
}

/** 名字 → 是否被同类资产占用（用于右键新建时给默认名） */
export function assetNames(list: { name: string }[]): string[] {
  return list.map((a) => a.name);
}

export type { Dir, CropRect };
