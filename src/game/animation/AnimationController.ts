import type { ActionDef } from './SpriteManifest';

export interface TickResult {
  frameChanged: boolean;
  /** 本 tick 进入的事件帧（用于攻击判定等） */
  events: number[];
  finished: boolean;
}

/**
 * 单动作播放器：帧推进、循环、事件帧派发。
 * 状态机只改这里的 action，帧索引不对外暴露，避免分散计算。
 */
export class AnimationController {
  private action = '';
  private def: ActionDef = { frames: 1, fps: 10, loop: true };
  private frame = 0;
  private elapsed = 0;
  private finished = false;

  get currentAction(): string {
    return this.action;
  }

  get currentFrame(): number {
    return this.frame;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /** 播放动作；同动作默认不重入（避免抽搐），需要重播时显式 restart */
  play(action: string, def: ActionDef, restart = false): boolean {
    if (!restart && action === this.action && !this.finished) return false;
    this.action = action;
    this.def = def;
    this.frame = 0;
    this.elapsed = 0;
    this.finished = false;
    return true;
  }

  update(dt: number): TickResult {
    const events: number[] = [];
    if (this.finished || this.def.frames <= 0) {
      return { frameChanged: false, events, finished: this.finished };
    }

    const frameDuration = 1 / Math.max(1, this.def.fps);
    this.elapsed += dt;
    let changed = false;

    while (this.elapsed >= frameDuration) {
      this.elapsed -= frameDuration;
      const next = this.frame + 1;
      if (next >= this.def.frames) {
        if (this.def.loop) {
          this.frame = 0;
          changed = true;
        } else {
          this.frame = this.def.frames - 1;
          this.finished = true;
          this.elapsed = 0;
          break;
        }
      } else {
        this.frame = next;
        changed = true;
      }
      if (this.def.eventFrames?.includes(this.frame)) events.push(this.frame);
    }

    return { frameChanged: changed, events, finished: this.finished };
  }
}
