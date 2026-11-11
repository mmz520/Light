/**
 * 小地图内容：把场景里的地皮 + 实体对象俯视画进一张 canvas
 *
 * 两种视野：
 *   1. 全景（span 为 null）：所有地面求包围盒，整体缩放居中铺满画布；
 *   2. 跟随角色（span + getCenter）：以 getCenter() 返回的实时位置为中心，
 *      可视跨度 = span 世界单位 —— 显示范围档位越小 span 越小，放大倍数越大；
 *      角色一动视野就跟着走（播放中每帧取运行时位置）。
 *
 * 地皮每格一个色块（该类配置色，VOID 留透明）；实体按对象上的
 * minimapShow 决定画不画；角色还能挂一个「图组」作为图标（minimapIcon = 图组 id），
 * 没挂就用该类别的默认圆点。
 */
import { useEffect, useRef } from 'react';

import { GROUND_TYPES, groundTiles } from '../model/ground';
import { MINIMAP_ICON_PX, sceneKindMeta, type ProjectDoc } from '../model/types';
import { texturePreviewUrl } from './AssetPicker';

export interface MinimapGround {
  x0: number;
  z0: number;
  cell: number;
  w: number;
  h: number;
  tiles: Uint8Array;
  colors: string[];
}

export interface MinimapBounds {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** 收集所有已生成的地面与整体包围盒（工程数据变化时才算一遍） */
export function collectMinimapGrounds(project: ProjectDoc): { grounds: MinimapGround[]; bounds: MinimapBounds | null } {
  const grounds: MinimapGround[] = [];
  let bx0 = Infinity;
  let bz0 = Infinity;
  let bx1 = -Infinity;
  let bz1 = -Infinity;
  for (const n of project.scene) {
    if (n.kind !== 'ground' || !n.ground) continue;
    const m = groundTiles(n.ground);
    if (!m) continue;
    const cell = n.ground.cell > 0 ? n.ground.cell : 1;
    const halfW = (m.w * cell) / 2;
    const halfH = (m.h * cell) / 2;
    const x0 = n.x - halfW;
    const z0 = n.z - halfH;
    grounds.push({
      x0,
      z0,
      cell,
      w: m.w,
      h: m.h,
      tiles: m.tiles,
      colors: GROUND_TYPES.map((t) => n.ground!.types[t.id]?.color || t.color),
    });
    bx0 = Math.min(bx0, x0);
    bz0 = Math.min(bz0, z0);
    bx1 = Math.max(bx1, x0 + m.w * cell);
    bz1 = Math.max(bz1, z0 + m.h * cell);
  }
  return { grounds, bounds: grounds.length > 0 ? { x0: bx0, z0: bz0, x1: bx1, z1: bz1 } : null };
}

/* ------------------------------------------------------------------ */
/* 图标绘制                                                            */
/* ------------------------------------------------------------------ */

/** 图组预览图缓存：URL → 已解码的 Image。onload 之前先画默认圆点，加载完自动重画 */
const iconImgCache = new Map<string, { img: HTMLImageElement; ready: boolean; waiters: (() => void)[] }>();

function getIconImage(url: string, onReady: () => void): HTMLImageElement | null {
  if (!url) return null;
  let rec = iconImgCache.get(url);
  if (!rec) {
    const img = new Image();
    const created = { img, ready: false, waiters: [] as (() => void)[] };
    img.onload = () => {
      created.ready = true;
      for (const w of created.waiters.splice(0)) w();
    };
    img.src = url;
    iconImgCache.set(url, created);
    rec = created;
  }
  if (!rec.ready) {
    if (!rec.waiters.includes(onReady)) rec.waiters.push(onReady);
    return null;
  }
  return rec.img;
}

/** 默认图标：一个小圆点（没配图组的对象都用它） */
function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/**
 * 图组图标：按原图比例缩到 MINIMAP_ICON_PX 见方，底下垫一层暗色光晕 + 细边，
 * 保证在任何地皮颜色上都看得清。图标不随朝向旋转（角色朝向用箭头另说）。
 */
function drawTextureIcon(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, dpr: number): void {
  const maxSide = MINIMAP_ICON_PX * dpr;
  const nw = img.naturalWidth || img.width || 1;
  const nh = img.naturalHeight || img.height || 1;
  const k = maxSide / Math.max(nw, nh);
  const w = Math.max(4 * dpr, nw * k);
  const h = Math.max(4 * dpr, nh * k);

  const halo = Math.hypot(w, h) / 2 + 1.6 * dpr;
  ctx.beginPath();
  ctx.arc(x, y, halo, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(14,11,9,.66)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(232,222,205,.55)';
  ctx.lineWidth = Math.max(1, dpr * 0.9);
  ctx.stroke();

  ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
}


export function MinimapCanvas({
  project,
  px,
  span,
  getCenter,
}: {
  project: ProjectDoc;
  px: number;
  /** 可视跨度（世界单位，宽 = 高）；null / 未传 = 全图全景 */
  span?: number | null;
  /** 每帧取镜头中心（角色实时位置）；null = 用全景或静态中心 */
  getCenter?: (() => { x: number; z: number } | null) | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // 工程数据（地皮包围盒 + 实体列表）随 project 缓存，rAF 循环里只读
  const dataRef = useRef<{ grounds: MinimapGround[]; bounds: MinimapBounds | null; nodes: ProjectDoc['scene'] }>({
    grounds: [],
    bounds: null,
    nodes: [],
  });
  const centerFnRef = useRef(getCenter);
  centerFnRef.current = getCenter;
  // 图组 id → 预览图 URL（小地图图标用；project 变才重算）
  const texUrlRef = useRef<Map<string, string>>(new Map());

  /* 工程数据变化时重算缓存 */
  const nodes = project.scene;
  useEffect(() => {
    const { grounds, bounds } = collectMinimapGrounds(project);
    dataRef.current = { grounds, bounds, nodes };
    const urls = new Map<string, string>();
    for (const t of project.textures) urls.set(t.id, texturePreviewUrl(project, t));
    texUrlRef.current = urls;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, nodes]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || px <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.max(1, Math.round(px * dpr));
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const draw = (center: { x: number; z: number } | null) => {
      const { grounds, bounds, nodes } = dataRef.current;
      ctx.clearRect(0, 0, size, size);
      if (grounds.length === 0 || !bounds) return;

      // 视野：跟随模式 = size / span；全景 = 包围盒等比缩放居中
      const follow = center !== null && typeof span === 'number' && span > 0;
      let scale: number;
      let ox: number;
      let oz: number;
      if (follow) {
        const s = span!;
        scale = size / s;
        ox = size / 2 - center!.x * scale;
        oz = size / 2 - center!.z * scale;
      } else {
        const bSpan = Math.max(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0) || 1;
        scale = size / bSpan;
        ox = (size - (bounds.x1 - bounds.x0) * scale) / 2 - bounds.x0 * scale;
        oz = (size - (bounds.z1 - bounds.z0) * scale) / 2 - bounds.z0 * scale;
      }
      const wx0 = -ox / scale;
      const wz0 = -oz / scale;
      const wx1 = (size - ox) / scale;
      const wz1 = (size - oz) / scale;

      /* 地皮格子：只画窗口内的 */
      for (const g of grounds) {
        const cs = Math.max(1, g.cell * scale);
        const gx0 = Math.max(0, Math.floor((wx0 - g.x0) / g.cell));
        const gx1 = Math.min(g.w - 1, Math.ceil((wx1 - g.x0) / g.cell));
        const gy0 = Math.max(0, Math.floor((wz0 - g.z0) / g.cell));
        const gy1 = Math.min(g.h - 1, Math.ceil((wz1 - g.z0) / g.cell));
        for (let y = gy0; y <= gy1; y++) {
          for (let x = gx0; x <= gx1; x++) {
            const v = g.tiles[y * g.w + x];
            if (v >= 7) continue; // VOID：轮廓外留透明
            ctx.fillStyle = g.colors[v] ?? '#666';
            ctx.fillRect(Math.floor(ox + (g.x0 + x * g.cell) * scale), Math.floor(oz + (g.z0 + y * g.cell) * scale), Math.ceil(cs), Math.ceil(cs));
          }
        }
      }

      /* 实体对象：minimapShow === false 的不画；有图组图标的画图组，否则画默认圆点 */
      for (const n of nodes) {
        if (n.kind === 'ground' || n.kind === 'group' || n.kind === 'mapui' || n.kind === 'time' || n.kind === 'weather') continue;
        if (n.minimapShow === false) continue;
        const mx = ox + n.x * scale;
        const my = oz + n.z * scale;
        const r = (n.kind === 'character' ? 3.2 : 2.4) * dpr;
        const iconUrl = n.minimapIcon ? texUrlRef.current.get(n.minimapIcon) ?? '' : '';
        const img = iconUrl ? getIconImage(iconUrl, () => draw(center)) : null;
        if (img) {
          drawTextureIcon(ctx, img, mx, my, dpr);
        } else {
          drawDot(ctx, mx, my, r, sceneKindMeta(n.kind).color);
        }
      }
    };

    // 有 getCenter（跟随角色）：rAF 每帧重画；否则只画一遍
    if (centerFnRef.current) {
      let raf = 0;
      const loop = () => {
        draw(centerFnRef.current ? centerFnRef.current() : null);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(raf);
    }
    draw(null);
  }, [project, px, span, nodes]);

  return <canvas ref={ref} data-mapui-canvas="" style={{ width: px, height: px, display: 'block' }} />;
}
