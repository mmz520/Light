/**
 * 骨架模板 —— 与 .trae/skills/sprite-8dir-anim/templates.json 对齐。
 *
 * 模板给的是 512 画布内的摆放（cx + bottom/top + h，px）；
 * 这里换算成"相对父节点中心"的世界单位偏移，存进动画资产的节点里，
 * 这样动画 JSON 自包含，不依赖外部模板文件。
 */
import type { AnimNode, SkeletonId } from './types';
import { shortId } from './types';

/** 512px 画布对应的世界高度 */
export const CANVAS_WORLD = 2;
export const PART_GRID = 512;
export const ANCHOR_FOOT_Y = 412;

const PX = CANVAS_WORLD / PART_GRID;

/** 素体槽位：派生动画时这些节点的贴图会被保留 */
export const BODY_SLOTS = new Set(['arm', 'leg', 'torso_U', 'torso_L', 'body']);

interface TplNode {
  id: string;
  label: string;
  parent: string | null;
  slot: string;
  pivot: AnimNode['pivot'];
  /** 画布内：cx + (bottom 或 top) + h */
  cx: number;
  bottom?: number;
  top?: number;
  h: number;
  z: number;
  mirror?: boolean;
  scale?: number;
}

const HUMANOID10: TplNode[] = [
  { id: 'thigh_L', label: '左大腿', parent: 'torso_L', slot: 'leg', pivot: 'top', cx: 232, bottom: 344, h: 90, z: 1 },
  { id: 'thigh_R', label: '右大腿', parent: 'torso_L', slot: 'leg', pivot: 'top', cx: 280, bottom: 344, h: 90, z: 2, mirror: true },
  { id: 'calf_L', label: '左小腿', parent: 'thigh_L', slot: 'leg', pivot: 'top', cx: 232, bottom: 412, h: 76, z: 3, scale: 0.85 },
  { id: 'calf_R', label: '右小腿', parent: 'thigh_R', slot: 'leg', pivot: 'top', cx: 280, bottom: 412, h: 76, z: 4, mirror: true, scale: 0.85 },
  { id: 'torso_L', label: '下身', parent: null, slot: 'torso_L', pivot: 'bottom', cx: 256, bottom: 262, h: 60, z: 5 },
  { id: 'torso_U', label: '上身', parent: 'torso_L', slot: 'torso_U', pivot: 'bottom', cx: 256, bottom: 212, h: 70, z: 6 },
  { id: 'upper_arm_L', label: '左上臂', parent: 'torso_U', slot: 'arm', pivot: 'top', cx: 218, top: 160, h: 75, z: 8 },
  { id: 'upper_arm_R', label: '右上臂', parent: 'torso_U', slot: 'arm', pivot: 'top', cx: 294, top: 160, h: 75, z: 9, mirror: true },
  { id: 'forearm_L', label: '左下臂', parent: 'upper_arm_L', slot: 'arm', pivot: 'top', cx: 218, top: 225, h: 64, z: 10, scale: 0.85 },
  { id: 'forearm_R', label: '右下臂', parent: 'upper_arm_R', slot: 'arm', pivot: 'top', cx: 294, top: 225, h: 64, z: 11, mirror: true, scale: 0.85 },
  { id: 'back', label: '背包', parent: 'torso_U', slot: 'back', pivot: 'bottom', cx: 256, bottom: 272, h: 100, z: 7 },
  { id: 'foot_L', label: '左脚', parent: 'calf_L', slot: 'foot', pivot: 'bottom', cx: 232, bottom: 412, h: 50, z: 12 },
  { id: 'foot_R', label: '右脚', parent: 'calf_R', slot: 'foot', pivot: 'bottom', cx: 280, bottom: 412, h: 50, z: 13, mirror: true },
  { id: 'hand_L', label: '左手', parent: 'forearm_L', slot: 'hand', pivot: 'bottom', cx: 218, bottom: 293, h: 44, z: 14 },
  { id: 'hand_R', label: '右手', parent: 'forearm_R', slot: 'hand', pivot: 'bottom', cx: 294, bottom: 293, h: 44, z: 15, mirror: true },
  { id: 'head', label: '头部', parent: 'torso_U', slot: 'head', pivot: 'bottom', cx: 256, bottom: 150, h: 110, z: 16 },
  { id: 'hat', label: '帽子', parent: 'head', slot: 'hat', pivot: 'bottom', cx: 256, bottom: 74, h: 50, z: 17 },
  { id: 'weapon', label: '武器', parent: 'forearm_R', slot: 'weapon', pivot: 'bottom', cx: 302, bottom: 291, h: 95, z: 18 },
];

const HUMANOID5: TplNode[] = [
  { id: 'leg_L', label: '左腿', parent: 'body', slot: 'leg', pivot: 'top', cx: 232, bottom: 412, h: 150, z: 1 },
  { id: 'leg_R', label: '右腿', parent: 'body', slot: 'leg', pivot: 'top', cx: 280, bottom: 412, h: 150, z: 2, mirror: true },
  { id: 'body', label: '躯干', parent: null, slot: 'body', pivot: 'bottom', cx: 256, bottom: 262, h: 140, z: 3 },
  { id: 'arm_L', label: '左臂', parent: 'body', slot: 'arm', pivot: 'top', cx: 214, top: 140, h: 130, z: 4 },
  { id: 'arm_R', label: '右臂', parent: 'body', slot: 'arm', pivot: 'top', cx: 298, top: 140, h: 130, z: 5, mirror: true },
  { id: 'head', label: '头部', parent: 'body', slot: 'head', pivot: 'bottom', cx: 256, bottom: 118, h: 100, z: 6 },
  { id: 'hat', label: '帽子', parent: 'head', slot: 'hat', pivot: 'bottom', cx: 256, bottom: 58, h: 50, z: 7 },
  { id: 'hand_L', label: '左手', parent: 'arm_L', slot: 'hand', pivot: 'bottom', cx: 214, bottom: 272, h: 44, z: 8 },
  { id: 'hand_R', label: '右手', parent: 'arm_R', slot: 'hand', pivot: 'bottom', cx: 298, bottom: 272, h: 44, z: 9, mirror: true },
  { id: 'weapon', label: '武器', parent: 'arm_R', slot: 'weapon', pivot: 'bottom', cx: 306, bottom: 270, h: 95, z: 10 },
];

const BEAST5: TplNode[] = [
  { id: 'leg_BL', label: '左后腿', parent: 'body', slot: 'leg', pivot: 'top', cx: 224, bottom: 412, h: 130, z: 1 },
  { id: 'leg_BR', label: '右后腿', parent: 'body', slot: 'leg', pivot: 'top', cx: 288, bottom: 412, h: 130, z: 2, mirror: true },
  { id: 'body', label: '躯干', parent: null, slot: 'body', pivot: 'center', cx: 256, bottom: 300, h: 130, z: 3 },
  { id: 'leg_FL', label: '左前腿', parent: 'body', slot: 'leg', pivot: 'top', cx: 204, bottom: 412, h: 130, z: 4 },
  { id: 'leg_FR', label: '右前腿', parent: 'body', slot: 'leg', pivot: 'top', cx: 308, bottom: 412, h: 130, z: 5, mirror: true },
  { id: 'tail', label: '尾巴', parent: 'body', slot: 'tail', pivot: 'left', cx: 330, bottom: 250, h: 70, z: 0 },
  { id: 'head', label: '头部', parent: 'body', slot: 'head', pivot: 'bottom', cx: 256, bottom: 168, h: 90, z: 6 },
];

const CUSTOM: TplNode[] = [
  { id: 'body', label: '躯干', parent: null, slot: 'body', pivot: 'bottom', cx: 256, bottom: 262, h: 140, z: 1 },
  { id: 'head', label: '头部', parent: 'body', slot: 'head', pivot: 'bottom', cx: 256, bottom: 118, h: 90, z: 2 },
];

const TEMPLATE_NODES: Record<SkeletonId, TplNode[]> = {
  humanoid10: HUMANOID10,
  humanoid5: HUMANOID5,
  beast5: BEAST5,
  custom: CUSTOM,
};

/** 画布内绝对中心（x 右为正，y 上为正；脚底线 y=0） */
function absCenter(n: TplNode): { x: number; y: number } {
  const cy = n.bottom !== undefined ? n.bottom - n.h / 2 : (n.top ?? 0) + n.h / 2;
  return {
    x: (n.cx - PART_GRID / 2) * PX,
    y: (ANCHOR_FOOT_Y - cy) * PX,
  };
}

/** 由模板 id 生成节点列表（layout 已换算成相对父节点的偏移） */
export function buildNodes(template: SkeletonId): AnimNode[] {
  const tpl = TEMPLATE_NODES[template] ?? CUSTOM;
  const byId = new Map(tpl.map((n) => [n.id, n]));
  const absCache = new Map<string, { x: number; y: number }>();

  const absOf = (id: string): { x: number; y: number } => {
    const cached = absCache.get(id);
    if (cached) return cached;
    const n = byId.get(id);
    if (!n) return { x: 0, y: 0 };
    const abs = absCenter(n);
    absCache.set(id, abs);
    return abs;
  };

  return tpl.map((n) => {
    const abs = absOf(n.id);
    const parentAbs = n.parent ? absOf(n.parent) : { x: 0, y: 0 };
    return {
      id: n.id,
      label: n.label,
      parent: n.parent,
      slot: n.slot,
      pivot: n.pivot,
      z: n.z,
      layout: {
        x: abs.x - parentAbs.x,
        y: abs.y - parentAbs.y,
        h: n.h * PX,
      },
      mirror: !!n.mirror,
      scale: n.scale ?? 1,
      textureId: null,
      overlay: null,
      body: BODY_SLOTS.has(n.slot),
    } satisfies AnimNode;
  });
}

/** 新节点的默认覆盖物 */
export function newOverlay(): AnimNode['overlay'] {
  return {
    id: shortId('ov'),
    textureId: null,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    rot: 0,
    scale: 1,
    zIndex: null,
  };
}

export const TEMPLATE_IDS: SkeletonId[] = ['humanoid10', 'humanoid5', 'beast5', 'custom'];
