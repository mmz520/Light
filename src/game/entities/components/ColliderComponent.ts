import { Component } from '@/game/entities/Entity';

/**
 * 碰撞/边界组件：圆形包围盒 + 世界边界夹取。
 * 多个实体之间的推挤由 MovementSystem 统一处理。
 */
export class ColliderComponent extends Component {
  radius: number;

  constructor(radius = 0.4) {
    super();
    this.radius = radius;
  }

  update(): void {
    /* 由 MovementSystem 驱动，这里不做事 */
  }

  clampToBounds(bound: number): void {
    this.entity.x = Math.max(-bound, Math.min(bound, this.entity.x));
    this.entity.z = Math.max(-bound, Math.min(bound, this.entity.z));
  }
}
