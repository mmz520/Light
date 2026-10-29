import type { InputSnapshot } from '@/game/types';

const MOVE_KEYS: Record<string, { x: number; z: number }> = {
  KeyW: { x: 0, z: -1 },
  ArrowUp: { x: 0, z: -1 },
  KeyS: { x: 0, z: 1 },
  ArrowDown: { x: 0, z: 1 },
  KeyA: { x: -1, z: 0 },
  ArrowLeft: { x: -1, z: 0 },
  KeyD: { x: 1, z: 0 },
  ArrowRight: { x: 1, z: 0 },
};

/**
 * 输入系统：键盘 → 归一化意图快照。
 * 失焦/切页时清空按键，解决旧代码"切回来人物一直跑"的坑。
 */
export class InputSystem {
  private readonly pressed = new Set<string>();
  private attackQueued = false;
  private attached = false;

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (MOVE_KEYS[e.code] || e.code === 'Space' || e.code === 'KeyJ' || e.code === 'ShiftLeft') {
      e.preventDefault();
    }
    if (e.repeat) return;
    this.pressed.add(e.code);
    if (e.code === 'Space' || e.code === 'KeyJ') this.attackQueued = true;
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.pressed.delete(e.code);
  };

  private readonly onBlur = () => {
    this.pressed.clear();
    this.attackQueued = false;
  };

  attach(target: Window = window): void {
    if (this.attached) return;
    this.attached = true;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);
  }

  detach(target: Window = window): void {
    if (!this.attached) return;
    this.attached = false;
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    target.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
  }

  setTouchMove(x: number, z: number): void {
    this.touchX = x;
    this.touchZ = z;
  }

  private touchX = 0;
  private touchZ = 0;

  snapshot(): InputSnapshot {
    let x = 0;
    let z = 0;
    for (const code of this.pressed) {
      const dir = MOVE_KEYS[code];
      if (dir) {
        x += dir.x;
        z += dir.z;
      }
    }
    x += this.touchX;
    z += this.touchZ;

    const attack = this.attackQueued;
    this.attackQueued = false;

    return {
      moveX: Math.max(-1, Math.min(1, x)),
      moveZ: Math.max(-1, Math.min(1, z)),
      run: this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight'),
      attack,
    };
  }
}
