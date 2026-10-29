/**
 * 类型化事件总线：编译期校验事件名与载荷结构，替代旧代码里的全局回调。
 */
export type Listener<P> = (payload: P) => void;

export class EventBus<M extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof M, Set<Listener<never>>>();

  on<K extends keyof M>(type: K, listener: Listener<M[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(type, listener);
  }

  once<K extends keyof M>(type: K, listener: Listener<M[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  off<K extends keyof M>(type: K, listener: Listener<M[K]>): void {
    this.listeners.get(type)?.delete(listener as Listener<never>);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of [...set]) {
      (listener as Listener<M[K]>)(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
