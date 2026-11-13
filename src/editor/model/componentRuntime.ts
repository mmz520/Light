/**
 * 组件运行时（播放态）
 *
 * 点 ▶ 时把场景里所有节点的组件脚本实例化出来，跑 onStart / onUpdate / onEvent / onDestroy；
 * 事件通过全局 EventBus 广播（Event.emit 或 this.emit 都能触发）。
 *
 * 与 quickjs 钩子脚本（老式）并存：那种脚本仍由 ScriptVM 执行。
 */
import type { ProjectDoc } from './types';
import type { LightComponent } from '../../runtime/component';
import { eventBus } from '../../runtime/component';
import { peekComponent } from '../../runtime/scriptRegistry';
import { buildContext } from './componentHost';

interface LiveComponent {
  nodeId: string;
  scriptId: string;
  name: string;
  inst: LightComponent;
}

export class ComponentRuntime {
  private live: LiveComponent[] = [];
  private offAny: (() => void) | null = null;
  private startedAt = 0;
  private running = false;

  /** 启动：实例化全部组件并派发 onStart */
  start(project: ProjectDoc): void {
    this.stop();
    this.running = true;
    this.startedAt = performance.now();

    for (const node of project.scene) {
      for (const scriptId of node.componentIds ?? []) {
        const loaded = peekComponent(scriptId);
        if (!loaded || !loaded.cls || loaded.error) continue;
        try {
          const ctx = buildContext(node, project, true);
          ctx.time = () => (performance.now() - this.startedAt) / 1000;
          const inst = new loaded.cls();
          inst.ctx = ctx;
          const saved = node.components?.[scriptId] ?? null;
          if (saved) Object.assign(inst as unknown as Record<string, unknown>, saved);
          inst.onMount?.();
          inst.onStart?.();
          this.live.push({ nodeId: node.id, scriptId, name: loaded.meta.name, inst });
        } catch (e) {
          console.warn('[脚本] 组件启动失败：', loaded.meta.name, e);
        }
      }
    }

    // 全局事件 → 每个组件的 onEvent
    this.offAny = eventBus.onAny((type, payload) => {
      for (const item of [...this.live]) {
        try {
          item.inst.onEvent?.(type, payload);
        } catch (e) {
          console.warn('[脚本] onEvent 出错：', item.name, type, e);
        }
      }
    });
  }

  /** 每帧 */
  tick(dt: number): void {
    if (!this.running) return;
    for (const item of [...this.live]) {
      try {
        item.inst.onUpdate?.(dt);
      } catch (e) {
        console.warn('[脚本] onUpdate 出错：', item.name, e);
        // 出错不反复刷屏：把它从列表里摘掉
        this.live = this.live.filter((x) => x !== item);
      }
    }
  }

  /** 停止：onDestroy + 清理订阅 */
  stop(): void {
    if (!this.running && this.live.length === 0) {
      this.offAny?.();
      this.offAny = null;
      return;
    }
    for (const item of [...this.live]) {
      try {
        item.inst.onDestroy?.();
      } catch (e) {
        console.warn('[脚本] onDestroy 出错：', item.name, e);
      }
    }
    this.live = [];
    this.offAny?.();
    this.offAny = null;
    this.running = false;
  }

  /** 热更新：脚本改了之后重新起一遍（属性面板里改字段不用重启） */
  reload(project: ProjectDoc): void {
    if (!this.running) return;
    this.start(project);
  }

  get count(): number {
    return this.live.length;
  }
}
