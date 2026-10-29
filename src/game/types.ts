/**
 * 全局类型与常量。
 * 方向集合与 Skill（sprite-8dir-anim）完全一致：以摄像机为基准，朝下为 S。
 */

export const DIRECTION_ORDER = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'] as const;
export type DirId = (typeof DIRECTION_ORDER)[number];

/** 与 DIRECTION_ORDER 对应的屏幕角度（弧度），0 指向 +Z（朝向镜头下方） */
export const DIRECTION_ANGLE: Record<DirId, number> = {
  S: 0,
  SE: Math.PI / 4,
  E: Math.PI / 2,
  NE: (Math.PI * 3) / 4,
  N: Math.PI,
  NW: (-Math.PI * 3) / 4,
  W: -Math.PI / 2,
  SW: -Math.PI / 4,
};

export type ActionId =
  | 'idle'
  | 'walk'
  | 'run'
  | 'attack'
  | 'hit'
  | 'death'
  | 'work';

export interface Vec2 {
  x: number;
  z: number;
}

export interface InputSnapshot {
  moveX: number;
  moveZ: number;
  run: boolean;
  attack: boolean;
}

export interface GameEvents extends Record<string, unknown> {
  'game:ready': { characterId: string };
  'game:error': { message: string };
  stats: {
    fps: number;
    action: string;
    dir: DirId;
    frame: number;
    x: number;
    z: number;
    textures: number;
  };
}
