import { Component } from '@/game/entities/Entity';

/**
 * 运动组件：只负责速度积分，不关心是谁在推它。
 */
export class MotionComponent extends Component {
  vx = 0;
  vz = 0;
  /** 加速度（单位/秒²），0 表示瞬时速度 */
  acceleration = 0;

  setVelocity(vx: number, vz: number): void {
    this.vx = vx;
    this.vz = vz;
  }

  stop(): void {
    this.vx = 0;
    this.vz = 0;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  update(dt: number): void {
    this.entity.x += this.vx * dt;
    this.entity.z += this.vz * dt;
  }
}
