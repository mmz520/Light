import { DIRECTION_ANGLE, DIRECTION_ORDER, type DirId } from '@/game/types';

/**
 * 世界方向向量 → 8 方向索引。
 * 全项目唯一实现：任何地方需要"往哪转"都走这里，杜绝各处自定义角度。
 */
export class DirectionMapper {
  /** 输入屏幕方向向量（x 右, z 下），返回最近的方向 */
  static fromVector(x: number, z: number): DirId {
    if (x === 0 && z === 0) return 'S';
    const angle = Math.atan2(x, z);
    return DirectionMapper.fromAngle(angle);
  }

  static fromAngle(angle: number): DirId {
    const normalized = DirectionMapper.normalize(angle);
    let best: DirId = 'S';
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const dir of DIRECTION_ORDER) {
      const delta = Math.abs(DirectionMapper.normalize(normalized - DIRECTION_ANGLE[dir]));
      if (delta < bestDelta) {
        bestDelta = delta;
        best = dir;
      }
    }
    return best;
  }

  static indexOf(dir: DirId): number {
    return DIRECTION_ORDER.indexOf(dir);
  }

  private static normalize(angle: number): number {
    let a = angle % (Math.PI * 2);
    if (a > Math.PI) a -= Math.PI * 2;
    if (a < -Math.PI) a += Math.PI * 2;
    return a;
  }
}
