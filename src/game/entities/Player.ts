import type { AnimationBank } from '@/game/animation/AnimationBank';
import { DirectionMapper } from '@/game/animation/DirectionMapper';
import { ColliderComponent } from '@/game/entities/components/ColliderComponent';
import { MotionComponent } from '@/game/entities/components/MotionComponent';
import type { InputSystem } from '@/game/systems/InputSystem';
import { Actor } from './Actor';

export const WALK_SPEED = 2.4;
export const RUN_SPEED = 4.8;
export const WORLD_BOUND = 20;

/**
 * 主角：工程师。输入意图 → 速度 / 朝向 / 动作。
 */
export class Player extends Actor {
  private readonly motion: MotionComponent;
  private readonly collider: ColliderComponent;

  constructor(bank: AnimationBank, private readonly input: InputSystem) {
    super(bank, 'engineer_spanner');
    this.motion = this.add(new MotionComponent());
    this.collider = this.add(new ColliderComponent(0.45));
    this.sprite.setPosition(0, 0);
  }

  override update(dt: number): void {
    const intent = this.input.snapshot();
    const attacking = this.currentAction === 'attack' && !this.controller.isFinished;

    if (attacking) {
      this.motion.stop();
    } else if (intent.attack) {
      this.motion.stop();
      this.setAction('attack', true);
    } else {
      const len = Math.hypot(intent.moveX, intent.moveZ);
      if (len > 0.01) {
        const nx = intent.moveX / len;
        const nz = intent.moveZ / len;
        const speed = intent.run ? RUN_SPEED : WALK_SPEED;
        this.motion.setVelocity(nx * speed, nz * speed);
        this.face(DirectionMapper.fromVector(nx, nz));
        this.setAction(intent.run ? 'run' : 'walk');
      } else {
        this.motion.stop();
        this.setAction('idle');
      }
    }

    super.update(dt);
    this.collider.clampToBounds(WORLD_BOUND);
  }
}
