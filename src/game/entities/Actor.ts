import type { AnimationBank } from '@/game/animation/AnimationBank';
import { AnimationController } from '@/game/animation/AnimationController';
import { Entity } from '@/game/entities/Entity';
import { ActorSprite } from '@/game/render/ActorSprite';
import type { DirId } from '@/game/types';

/**
 * 可动生物基类：状态机（动作）+ 8 方向朝向 + 动画播放器。
 * Player / Enemy 只描述"做什么"，不重复写帧与 UV 逻辑。
 */
export abstract class Actor extends Entity {
  readonly characterId: string;
  readonly sprite: ActorSprite;
  protected readonly controller = new AnimationController();
  protected readonly bank: AnimationBank;
  protected action = 'idle';
  protected dir: DirId = 'S';

  constructor(bank: AnimationBank, characterId: string) {
    super();
    this.bank = bank;
    this.characterId = characterId;
    const def = bank.getCharacter(characterId);
    this.sprite = new ActorSprite(bank, characterId, def.displayHeight);
    this.setAction('idle', true);
  }

  get currentAction(): string {
    return this.action;
  }

  get currentDir(): DirId {
    return this.dir;
  }

  get currentFrame(): number {
    return this.controller.currentFrame;
  }

  /** 切换动作：同动作不重入，缺失动作时静默保持（便于资产未齐时降级） */
  protected setAction(action: string, restart = false): void {
    if (!this.bank.hasAction(this.characterId, action)) return;
    const def = this.bank.getAction(this.characterId, action);
    if (this.controller.play(action, def, restart)) {
      this.action = action;
      this.sprite.setAction(action, def);
      this.bank.preloadAction(this.characterId, action);
    }
  }

  protected face(dir: DirId): void {
    if (dir === this.dir) return;
    this.dir = dir;
    this.sprite.setDirection(dir);
  }

  override update(dt: number): void {
    super.update(dt);
    this.controller.update(dt);
    this.sprite.setDirection(this.dir);
    this.sprite.setFrame(this.controller.currentFrame);
    this.sprite.tick();
    this.sprite.setPosition(this.x, this.z);
  }

  override dispose(): void {
    this.sprite.dispose();
    super.dispose();
  }
}
