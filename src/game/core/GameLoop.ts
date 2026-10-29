/**
 * 固定步长游戏循环。
 * - 逻辑固定 1/60 s 步进，渲染每帧一次（带插值系数）
 * - 单帧 dt 上限 0.25 s：切标签页回来不会瞬移（旧代码在这里踩过坑）
 */
export class GameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;

  constructor(
    private readonly fixedStep: number,
    private readonly onTick: (dt: number) => void,
    private readonly onRender: (alpha: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    const frame = (now: number) => {
      if (!this.running) return;
      const elapsed = Math.min((now - this.last) / 1000, 0.25);
      this.last = now;
      this.acc += elapsed;
      let guard = 0;
      while (this.acc >= this.fixedStep && guard < 8) {
        this.onTick(this.fixedStep);
        this.acc -= this.fixedStep;
        guard++;
      }
      this.onRender(this.acc / this.fixedStep);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }
}
