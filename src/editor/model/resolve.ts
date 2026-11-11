/**
 * 资产解析：id → 文件 URL / PartDef
 *
 * 编辑器内部只存 id，渲染时才解析成 gameasset:// URL（桌面端）或 /路径（浏览器端）。
 */
import type { OverlayDef, PartDef, PartPose } from '../../animator/types';
import { desk, isDesktop } from '../../platform/desk';
import {
  cropToUv,
  textureImageFor,
  DIRS,
  type AnimNode,
  type AnimationAsset,
  type Dir,
  type ImageAsset,
  type ProjectDoc,
  type TextureAsset,
} from './types';

const EMPTY_POSE: PartPose = { x: 0, y: 0, rot: 0, scale: 1 };

export function imageById(doc: ProjectDoc, id: string | null | undefined): ImageAsset | null {
  if (!id) return null;
  return doc.images.find((i) => i.id === id) ?? null;
}

export function textureById(doc: ProjectDoc, id: string | null | undefined): TextureAsset | null {
  if (!id) return null;
  return doc.textures.find((t) => t.id === id) ?? null;
}

export function animationById(doc: ProjectDoc, id: string | null | undefined): AnimationAsset | null {
  if (!id) return null;
  return doc.animations.find((a) => a.id === id) ?? null;
}

/** 图片资产 → 可直接放进 src 的 URL */
export function imageUrl(doc: ProjectDoc, image: ImageAsset | null): string {
  if (!image) return '';
  const abs = `${doc.root}/${image.file}`.split('/').join(desk.path.sep);
  return desk.toAssetUrl(abs);
}

export function imageUrlById(doc: ProjectDoc, id: string | null | undefined): string {
  return imageUrl(doc, imageById(doc, id));
}

/**
 * 图片资产 → CSS 场景用 URL（<img> / background-image / border-image）。
 *
 * 非破坏性裁剪只存了像素框，3D 那边靠 UV 取源区域；CSS 没法按 UV 取，
 * 所以把裁剪框带进协议参数（?c=x,y,w,h），由主进程先裁好再返回。
 * 裁剪一变 URL 就变，顺带绕开浏览器图片缓存。
 */
export function imageCssUrl(doc: ProjectDoc, image: ImageAsset | null): string {
  if (!image) return '';
  const base = imageUrl(doc, image);
  const c = image.crop;
  if (!c || !isDesktop) return base;
  const rect = [c.x, c.y, c.w, c.h].map((v) => Math.max(0, Math.round(v))).join(',');
  return `${base}${base.includes('?') ? '&' : '?'}c=${rect}`;
}

export function imageCssUrlById(doc: ProjectDoc, id: string | null | undefined): string {
  return imageCssUrl(doc, imageById(doc, id));
}

/** 3D 部件用的贴图：路径 + 需要额外按 UV 取的矩形（矩形为 null 表示贴图本身就是裁好的） */
export interface RenderTexture {
  path: string;
  rect: { u: number; v: number; w: number; h: number } | null;
}

/**
 * 3D 渲染取图：桌面端直接拿协议裁好的图（采样坐标不用换算，任何自定义 sampler 都不会漏裁剪）；
 * 浏览器端没有协议裁剪，退回「原图 + UV 矩形」。
 *
 * 之前 3D 一律传 UV 矩形，靠 texture.offset/repeat 生效 —— 这只对材质内置 map 槽有效，
 * 自定义 uniform 的 sampler（地皮着色器）根本不吃，所以那条链路的裁剪一直是失效的。
 */
export function renderTexture(doc: ProjectDoc, image: ImageAsset | null): RenderTexture {
  if (!image) return { path: '', rect: null };
  if (isDesktop && image.crop) return { path: imageCssUrl(doc, image), rect: null };
  return { path: imageUrl(doc, image), rect: cropToUv(image) };
}

/**
 * 地图元素装饰贴图 → URL。
 * decorId 是「贴图」目录的贴图资产 id（老工程可能是图片 id，兜底直连）。
 * 走贴图资产解析 = 四向查表 / 裁剪后处理全部生效。
 */
export function mapuiDecorUrl(doc: ProjectDoc, id: string | null | undefined): string {
  const tex = textureById(doc, id);
  if (tex) {
    const img = textureImage(doc, tex, 'S') ?? DIRS.map((d) => textureImage(doc, tex, d)).find((x) => x) ?? null;
    // 边框是纯 CSS 渲染（background / border-image），必须走带裁剪的 URL
    if (img) return imageCssUrl(doc, img);
  }
  return imageCssUrlById(doc, id);
}

/** 贴图 + 方向 → 图片资产（未配置返回 null） */
export function textureImage(doc: ProjectDoc, texture: TextureAsset | null, dir: Dir): ImageAsset | null {
  if (!texture) return null;
  return imageById(doc, textureImageFor(texture, dir));
}

/** 贴图 + 方向 → URL */
export function textureUrl(doc: ProjectDoc, textureId: string | null | undefined, dir: Dir): string {
  return imageUrl(doc, textureImage(doc, textureById(doc, textureId), dir));
}

/** 贴图 + 方向 → 裁剪 UV */
export function textureRect(doc: ProjectDoc, textureId: string | null | undefined, dir: Dir) {
  const img = textureImage(doc, textureById(doc, textureId), dir);
  return img ? cropToUv(img) : null;
}

/** 节点主贴图在指定方向上的 URL */
export function nodeUrl(doc: ProjectDoc, node: AnimNode, dir: Dir): string {
  return textureUrl(doc, node.textureId, dir);
}

/**
 * 动画资产 + 方向 → Viewport3D 的 PartDef 列表。
 * 方向只影响贴图选择（贴图资产可以是四向的），骨架与关键帧不区分方向。
 */
export function animationParts(doc: ProjectDoc, anim: AnimationAsset, dir: Dir): PartDef[] {
  return anim.nodes.map((node) => {
    const img = textureImage(doc, textureById(doc, node.textureId), dir);
    const tex = renderTexture(doc, img);
    const ovImg = node.overlay ? textureImage(doc, textureById(doc, node.overlay.textureId), dir) : null;
    const ovTex = renderTexture(doc, ovImg);
    const overlay: OverlayDef | null = node.overlay
      ? {
          texturePath: ovTex.path,
          textureColor: node.overlay.textureColor ?? null,
          offsetX: node.overlay.offsetX,
          offsetY: node.overlay.offsetY,
          rot: node.overlay.rot,
          scale: node.overlay.scale,
          offsetZ: node.overlay.offsetZ,
          zIndex: node.overlay.zIndex ?? undefined,
          scaleX: node.mirror ? -1 : 1,
          // 覆盖物的裁剪要按它自己的图算，拿主贴图的裁剪框会串
          textureRect: ovTex.rect,
        }
      : null;

    return {
      id: node.id,
      label: node.label,
      parent: node.parent,
      texturePath: tex.path,
      color: img ? null : node.textureColor ?? null,
      layout: node.layout,
      defaultPose: { ...EMPTY_POSE },
      zIndex: node.z,
      overlay,
      mirror: node.mirror,
      textureRect: tex.rect,
    } satisfies PartDef;
  });
}

/** 节点上有哪些贴图引用（删除贴图时用于检测引用） */
export function animationReferences(anim: AnimationAsset, textureId: string): string[] {
  const hits: string[] = [];
  for (const n of anim.nodes) {
    if (n.textureId === textureId) hits.push(`${n.label}（主贴图）`);
    if (n.overlay?.textureId === textureId) hits.push(`${n.label}（覆盖物）`);
  }
  return hits;
}

/** 贴图引用了哪些图片（删除图片时用于检测引用） */
export function textureReferences(tex: TextureAsset, imageId: string): string[] {
  if (tex.template === 'single') return tex.image === imageId ? ['单向'] : [];
  return (['S', 'E', 'N', 'W'] as Dir[]).filter((d) => tex.dirs[d] === imageId).map((d) => `${d} 向`);
}
