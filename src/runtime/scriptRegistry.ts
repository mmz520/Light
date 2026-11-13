/**
 * 组件脚本注册表：脚本资产 → 可实例化的组件类 + 字段元数据
 *
 * 属性面板要同步渲染元数据，所以这里分两层：
 *   · loadComponent(script)  异步编译（typescript 按需加载），完成后 notify 让界面重渲染
 *   · peekComponent(id)      同步取已编译结果（没编译好就是 null，面板显示「编译中」）
 */
import type { ComponentContext, ComponentMeta, FieldMeta, LightComponent } from './component';
import { componentMetaOf, inferKind } from './component';
import { compileComponentSource, evaluateComponent } from './scriptCompiler';
import type { ScriptAsset } from '../editor/model/types';

export interface LoadedComponent {
  scriptId: string;
  /** 编译时的源码（变了就重新编译） */
  code: string;
  cls: new (...args: any[]) => LightComponent;
  meta: ComponentMeta;
  /** 编译/求值错误 */
  error: string | null;
  /** 字段元数据（已按默认值推断控件类型） */
  fields: FieldMeta[];
  /** 字段默认值（新建实例时的初值） */
  defaults: Record<string, unknown>;
}

const cache = new Map<string, LoadedComponent>();
const inflight = new Map<string, Promise<LoadedComponent>>();
const listeners = new Set<() => void>();

/** 订阅「某个脚本编译完成 / 失败」，返回取消函数 */
export function onComponentRegistryChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(): void {
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch (e) {
      console.error('[脚本] 注册表通知出错', e);
    }
  }
}

/** 同步取（没编译过返回 null） */
export function peekComponent(scriptId: string): LoadedComponent | null {
  return cache.get(scriptId) ?? null;
}

/** 源码改了 → 丢掉缓存，下次渲染重新编译 */
export function invalidateComponent(scriptId: string): void {
  if (cache.delete(scriptId)) notify();
}

/** 把 meta.fields 按实例默认值补全控件类型（没写 @Num/@Str 等注解时自动推断） */
function resolveFields(meta: ComponentMeta, defaults: Record<string, unknown>): FieldMeta[] {
  return meta.fields.map((f) => {
    if (f.explicit) return { ...f };
    const kind = inferKind(defaults[f.key]);
    const out: FieldMeta = { ...f, kind };
    if (kind === 'number') out.step = 1;
    return out;
  });
}

/** 编译 + 求值一个组件脚本（同一份源码只编一次） */
export async function loadComponent(script: ScriptAsset): Promise<LoadedComponent> {
  const hit = cache.get(script.id);
  if (hit && hit.code === script.code) return hit;
  const running = inflight.get(script.id);
  if (running) return running;

  const task = (async (): Promise<LoadedComponent> => {
    const compiled = await compileComponentSource(script.code);
    if (compiled.error || !compiled.js) {
      const failed: LoadedComponent = {
        scriptId: script.id,
        code: script.code,
        cls: null as unknown as new (...args: any[]) => LightComponent,
        meta: { name: script.name, desc: '', icon: '', order: 100, fields: [] },
        error: compiled.error ?? '编译失败',
        fields: [],
        defaults: {},
      };
      cache.set(script.id, failed);
      notify();
      return failed;
    }

    const evaluated = evaluateComponent(compiled.js);
    if (!evaluated.cls) {
      const failed: LoadedComponent = {
        scriptId: script.id,
        code: script.code,
        cls: null as unknown as new (...args: any[]) => LightComponent,
        meta: { name: script.name, desc: '', icon: '', order: 100, fields: [] },
        error: evaluated.error ?? '求值失败',
        fields: [],
        defaults: {},
      };
      cache.set(script.id, failed);
      notify();
      return failed;
    }

    const meta = componentMetaOf(evaluated.cls);
    // 构造一个临时实例读默认值（构造器里不要依赖 ctx）
    let defaults: Record<string, unknown> = {};
    try {
      const probe = new evaluated.cls();
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(probe)) {
        const v = (probe as unknown as Record<string, unknown>)[k];
        if (typeof v !== 'function') out[k] = v;
      }
      defaults = out;
    } catch (e) {
      // 构造器报错不至于让整个面板挂掉，字段就退回注解里的默认控件
      console.warn('[脚本] 组件构造失败：', script.name, e);
    }

    const loaded: LoadedComponent = {
      scriptId: script.id,
      code: script.code,
      cls: evaluated.cls,
      meta,
      error: null,
      fields: resolveFields(meta, defaults),
      defaults,
    };
    cache.set(script.id, loaded);
    notify();
    return loaded;
  })();

  inflight.set(script.id, task);
  try {
    return await task;
  } finally {
    inflight.delete(script.id);
  }
}

/** 批量预编译（打开工程 / 挂载脚本后调用） */
export async function preloadComponents(scripts: ScriptAsset[]): Promise<void> {
  await Promise.all(scripts.map((s) => loadComponent(s).catch(() => null)));
}

/** 创建实例并注入上下文 + 已保存的字段值 */
export function createComponent(
  loaded: LoadedComponent,
  ctx: ComponentContext,
  values?: Record<string, unknown> | null,
): LightComponent {
  const inst = new loaded.cls();
  inst.ctx = ctx;
  applyValues(inst, values);
  return inst;
}

/** 把存下来的字段值写进实例（多余的键忽略，缺失的用默认值） */
export function applyValues(inst: LightComponent, values?: Record<string, unknown> | null): void {
  if (!values) return;
  const target = inst as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(values)) {
    if (!(k in target)) continue;
    target[k] = v;
  }
}

/** 把实例的字段读成可序列化的普通对象（存进节点） */
export function readValues(inst: LightComponent, fields: FieldMeta[]): Record<string, unknown> {
  const target = inst as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = target[f.key];
    if (typeof v === 'function') continue;
    out[f.key] = v;
  }
  return out;
}
