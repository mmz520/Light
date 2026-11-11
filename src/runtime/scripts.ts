/**
 * 脚本 VM（W3）
 *
 * 沙箱：quickjs-emscripten（RELEASE_SYNC 单文件变体，wasm 以 base64 内嵌，Node / 浏览器 / Electron 通吃）。
 * 防死循环：中断器读预算时间戳（每次调用钩子前刷新），超过 budget 立刻打断脚本。
 * 错误隔离：某个实例的钩子抛错后该实例停用（记一条日志），不影响其他实例与主循环。
 *
 * 脚本约定（见 editor/model/types.ts 的 SCRIPT_TEMPLATE）：
 *   function onStart(self, Light) {}
 *   function onUpdate(self, Light, dt) {}
 *   function onEvent(self, Light, name, data) {}
 *   function onDestroy(self, Light) {}
 * self 是挂载实例的读写句柄（x / z / face / name / vars），钩子返回后宿主把改动拉回运行时。
 * Light 是白名单 API：log / input / emit / on / time / find。
 *
 * quickjs 宿主函数语义（实测确认）：
 *   - 传给宿主的参数是 QuickJSHandle（宿主用 ctx.dump 取值，生命周期由 VM 管理）；
 *   - 宿主返回值必须是 QuickJSHandle（普通布尔会崩），返回 undefined = undefined。
 */
import { newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten-core';
// 单文件变体：wasm base64 内嵌，不需要运行时去找 .wasm 资源
import singlefileVariant from '@jitl/quickjs-singlefile-cjs-release-sync';

/** 宿主侧的实体句柄：由 SceneRuntime（或导出宿主）实现，脚本改动直接落到它身上 */
export interface ScriptSelf {
  nodeId: string;
  name: string;
  x: number;
  z: number;
  /** 朝向：1 右 / -1 左 */
  face: number;
  /** 控制器变量表（与运行时共享同一对象） */
  vars: Record<string, number>;
}

/** 宿主环境能力（SceneRuntime 提供；导出宿主可另写一份） */
export interface ScriptWorld {
  /** 每帧由运行时刷新的输入状态 */
  input: { isDown(key: string): boolean; pressed(key: string): boolean };
  log(...args: unknown[]): void;
  /** 参与脚本的全部实体（供 Light.find 查询） */
  entities(): ScriptSelf[];
}

interface Instance {
  /** 脚本资产 id */
  scriptId: string;
  /** 脚本名（日志前缀） */
  scriptName: string;
  self: ScriptSelf;
  hooks: Partial<Record<'onStart' | 'onUpdate' | 'onEvent' | 'onDestroy', QuickJSHandle>>;
  /** 抛错后停用，不再调用任何钩子 */
  dead: boolean;
}

const HOOK_NAMES = ['onStart', 'onUpdate', 'onEvent', 'onDestroy'] as const;
/** 单次钩子调用的 CPU 预算（毫秒），超过视为死循环直接中断 */
const HOOK_BUDGET_MS = 64;
/** HUD 日志环形缓冲上限 */
const LOG_CAP = 120;
/** emit 递归派发深度上限（两个脚本互发信号时防无限递归） */
const EMIT_DEPTH_MAX = 8;

export class ScriptVM {
  private ctx: QuickJSContext | null = null;
  private instances: Instance[] = [];
  /** 事件名 → (实例, 回调句柄) 订阅表 */
  private subs = new Map<string, { inst: Instance; fn: QuickJSHandle }[]>();
  /** 正在执行钩子的实例（Light.on 归属用） */
  private current: Instance | null = null;
  /** 当前钩子调用的截止时间戳（中断器读它；Infinity = 不限时，编译期 / 空闲期） */
  private deadline = Infinity;
  /** emit 递归深度 */
  private emitDepth = 0;
  private startTime = 0;
  private input: ScriptWorld['input'] = { isDown: () => false, pressed: () => false };
  private world: ScriptWorld | null = null;
  private disposed = false;

  /** HUD / 探针读取的日志（带 [脚本] 前缀） */
  logs: string[] = [];

  static async create(): Promise<ScriptVM> {
    const vm = new ScriptVM();
    const mod = await newQuickJSWASMModuleFromVariant(singlefileVariant);
    vm.ctx = mod.newContext();
    vm.ctx.runtime.setInterruptHandler(() => Date.now() > vm.deadline);
    vm.setupLight();
    return vm;
  }

  /** 挂载环境：播放开始时调用一次 */
  bind(world: ScriptWorld): void {
    this.world = world;
    this.input = world.input;
    this.startTime = Date.now();
  }

  /**
   * 编译脚本并给一个实体建实例。
   * 同一份脚本可以挂到多个实体上（每次调用各建一个实例）。
   * 返回 false = 编译失败（日志里有原因）。
   */
  mount(scriptId: string, scriptName: string, code: string, self: ScriptSelf): boolean {
    const ctx = this.ctx;
    if (!ctx || this.disposed) return false;
    let hooks: Instance['hooks'];
    try {
      // 包一层 IIFE：只回收四个钩子函数，脚本里的其它顶层变量不外泄
      const src = `(function(){ ${code}\n;return { ${HOOK_NAMES.map(
        (h) => `${h}: typeof ${h} === 'function' ? ${h} : null`,
      ).join(', ')} }; })()`;
      // 编译 + 顶层执行也给预算（顶层一般是 function 声明，几乎瞬时）
      this.deadline = Date.now() + 2000;
      const ret = ctx.unwrapResult(ctx.evalCode(src));
      hooks = {};
      for (const h of HOOK_NAMES) {
        // 函数对象没法 dump 成宿主值，用 typeof 判断再取句柄
        const fn = ctx.getProp(ret, h);
        try {
          if (ctx.typeof(fn) === 'function') hooks[h] = fn;
          else fn.dispose();
        } catch {
          fn.dispose();
        }
      }
      ret.dispose();
    } catch (e) {
      this.pushLog(`${scriptName} 编译失败：${(e as Error).message}`);
      return false;
    } finally {
      this.deadline = Infinity;
    }
    if (Object.keys(hooks).length === 0) {
      this.pushLog(`${scriptName} 没有定义任何钩子（onStart / onUpdate / onEvent / onDestroy）`);
      return false;
    }
    this.instances.push({ scriptId, scriptName, self, hooks, dead: false });
    return true;
  }

  /** 调用全部实例的 onStart */
  start(): void {
    for (const inst of [...this.instances]) this.call(inst, 'onStart');
  }

  /** 每帧：onUpdate(dt) */
  tick(dt: number): void {
    for (const inst of [...this.instances]) this.call(inst, 'onUpdate', dt);
  }

  /** 广播事件给所有实例的 onEvent 与 Light.on 订阅者（data 必须是可 JSON 化的宿主值） */
  emit(name: string, data?: unknown): void {
    if (this.emitDepth >= EMIT_DEPTH_MAX) {
      this.pushLog(`事件「${name}」派发深度超过 ${EMIT_DEPTH_MAX}，已丢弃（可能存在循环触发）`);
      return;
    }
    this.emitDepth++;
    try {
      for (const inst of [...this.instances]) this.call(inst, 'onEvent', name, data);
      const subs = this.subs.get(name);
      if (subs) {
        for (const sub of [...subs]) {
          if (sub.inst.dead) continue;
          this.invokeFn(sub.inst, sub.fn, [data]);
        }
      }
    } finally {
      this.emitDepth--;
    }
  }

  /** 调用全部实例的 onDestroy 并释放沙箱（播放结束时） */
  destroy(): void {
    if (this.disposed) return;
    for (const inst of [...this.instances]) this.call(inst, 'onDestroy');
    for (const inst of this.instances) for (const fn of Object.values(inst.hooks)) fn?.dispose();
    this.instances = [];
    for (const subs of this.subs.values()) for (const s of subs) s.fn.dispose();
    this.subs.clear();
    this.disposed = true;
    try {
      this.ctx?.dispose();
    } catch {
      /* 重复释放忽略 */
    }
    this.ctx = null;
  }

  /* ---------------- 内部 ---------------- */

  /** 单个钩子调用：参数 = (self, Light, ...)；错误停用实例 */
  private call(inst: Instance, hook: keyof Instance['hooks'], ...extras: unknown[]): void {
    const fn = inst.hooks[hook];
    if (fn) this.invokeFn(inst, fn, extras);
  }

  private invokeFn(inst: Instance, fn: QuickJSHandle, extras: unknown[]): void {
    const ctx = this.ctx;
    if (!ctx || inst.dead || this.disposed) return;
    const temp: QuickJSHandle[] = [];
    const prev = this.current;
    this.current = inst;
    const prevDeadline = this.deadline;
    this.deadline = Date.now() + HOOK_BUDGET_MS;
    try {
      const selfObj = this.pushSelf(inst.self);
      temp.push(selfObj);
      const lightObj = ctx.getProp(ctx.global, 'Light');
      temp.push(lightObj);
      const qArgs: QuickJSHandle[] = [selfObj, lightObj];
      for (const e of extras) qArgs.push(this.toHandle(e, temp));
      const ret = ctx.callFunction(fn, ctx.undefined, ...qArgs);
      ret.dispose();
      this.pullSelf(selfObj, inst.self);
    } catch (e) {
      inst.dead = true;
      this.pushLog(`${inst.scriptName} ${hookError(e)}`);
    } finally {
      this.deadline = prevDeadline;
      this.current = prev;
      for (const h of temp) h.dispose();
    }
  }

  /** 宿主值 → 沙箱句柄（全部进 sink，由调用方统一释放；对象走 JSON 边界） */
  private toHandle(v: unknown, sink: QuickJSHandle[]): QuickJSHandle {
    const ctx = this.ctx!;
    if (v === undefined || v === null) return ctx.undefined;
    const t = typeof v;
    if (t === 'number') {
      const h = ctx.newNumber(v as number);
      sink.push(h);
      return h;
    }
    if (t === 'string') {
      const h = ctx.newString(v as string);
      sink.push(h);
      return h;
    }
    if (t === 'boolean') return v ? ctx.true : ctx.false;
    const parsed = ctx.unwrapResult(ctx.evalCode(`(${JSON.stringify(v)})`));
    sink.push(parsed);
    return parsed;
  }

  /** 建沙箱里的 self 对象（每次调用重建；字段量固定且小，开销可接受） */
  private pushSelf(s: ScriptSelf): QuickJSHandle {
    const ctx = this.ctx!;
    const obj = ctx.newObject();
    // setProp 会复制引用：临时句柄用完立刻释放，否则每帧漏一堆
    const put = (key: string, make: () => QuickJSHandle) => {
      const h = make();
      ctx.setProp(obj, key, h);
      h.dispose();
    };
    put('nodeId', () => ctx.newString(s.nodeId));
    put('name', () => ctx.newString(s.name));
    put('x', () => ctx.newNumber(s.x));
    put('z', () => ctx.newNumber(s.z));
    put('face', () => ctx.newNumber(s.face));
    const vars = ctx.newObject();
    try {
      for (const [k, v] of Object.entries(s.vars)) {
        const h = ctx.newNumber(v);
        ctx.setProp(vars, k, h);
        h.dispose();
      }
      ctx.setProp(obj, 'vars', vars);
    } finally {
      vars.dispose();
    }
    return obj;
  }

  /** 把脚本对 self 的改动拉回宿主 */
  private pullSelf(obj: QuickJSHandle, s: ScriptSelf): void {
    const ctx = this.ctx!;
    const num = (k: string, fallback: number): number => {
      const h = ctx.getProp(obj, k);
      const d = ctx.dump(h);
      h.dispose();
      return typeof d === 'number' && Number.isFinite(d) ? d : fallback;
    };
    s.x = num('x', s.x);
    s.z = num('z', s.z);
    s.face = num('face', s.face) >= 0 ? 1 : -1;
    const varsH = ctx.getProp(obj, 'vars');
    const dump = ctx.dump(varsH);
    varsH.dispose();
    if (dump && typeof dump === 'object') {
      for (const [k, v] of Object.entries(dump as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v) && k in s.vars) s.vars[k] = v;
      }
    }
  }

  /** Light 白名单 API（注意：宿主函数参数是句柄，取值用 dump；返回值必须是句柄） */
  private setupLight(): void {
    const ctx = this.ctx!;
    const light = ctx.newObject();
    // setProp 复制引用：所有临时句柄挂完立刻释放，否则运行时退出时 wasm 断言崩溃
    const put = (target: QuickJSHandle, key: string, make: () => QuickJSHandle) => {
      const h = make();
      ctx.setProp(target, key, h);
      h.dispose();
    };

    put(light, 'log', () =>
      ctx.newFunction('log', (...args: QuickJSHandle[]) => {
        const parts = args.map((h) => {
          try {
            const d = ctx.dump(h);
            return typeof d === 'string' ? d : JSON.stringify(d) ?? String(d);
          } catch {
            return '?';
          }
        });
        this.pushLog(parts.join(' '));
      }),
    );

    const input = ctx.newObject();
    put(input, 'isDown', () =>
      ctx.newFunction('isDown', (keyH: QuickJSHandle) => (this.input.isDown(dumpStr(ctx, keyH)) ? ctx.true : ctx.false)),
    );
    put(input, 'pressed', () =>
      ctx.newFunction('pressed', (keyH: QuickJSHandle) => (this.input.pressed(dumpStr(ctx, keyH)) ? ctx.true : ctx.false)),
    );
    put(light, 'input', () => input);

    put(light, 'emit', () =>
      ctx.newFunction('emit', (nameH: QuickJSHandle, dataH: QuickJSHandle) => {
        const name = dumpStr(ctx, nameH);
        if (!name) return ctx.undefined;
        const payload = safeDump(ctx, dataH);
        this.emit(name, payload);
        return ctx.undefined;
      }),
    );

    put(light, 'on', () =>
      ctx.newFunction('on', (nameH: QuickJSHandle, fnH: QuickJSHandle) => {
        const name = dumpStr(ctx, nameH);
        // fnH 是回调句柄：订阅期间由本 VM 持有（destroy 时统一释放），这里不能 dispose
        if (name && this.current && fnH.alive) {
          const list = this.subs.get(name) ?? [];
          list.push({ inst: this.current, fn: fnH });
          this.subs.set(name, list);
        }
        return ctx.undefined;
      }),
    );

    put(light, 'time', () =>
      ctx.newFunction('time', () => ctx.newNumber((Date.now() - this.startTime) / 1000)),
    );

    put(light, 'find', () =>
      ctx.newFunction('find', (nameH: QuickJSHandle) => {
        const want = dumpStr(ctx, nameH);
        const arr = ctx.newArray();
        let i = 0;
        for (const e of this.world?.entities() ?? []) {
          if (e.name !== want) continue;
          const o = ctx.newObject();
          const set = (key: string, make: () => QuickJSHandle) => {
            const h = make();
            ctx.setProp(o, key, h);
            h.dispose();
          };
          set('name', () => ctx.newString(e.name));
          set('x', () => ctx.newNumber(e.x));
          set('z', () => ctx.newNumber(e.z));
          ctx.setProp(arr, String(i++), o);
          o.dispose();
        }
        return arr;
      }),
    );

    ctx.setProp(ctx.global, 'Light', light);
    light.dispose();
  }

  pushLog(msg: string): void {
    const line = `[脚本] ${msg}`.slice(0, 300);
    this.logs.push(line);
    if (this.logs.length > LOG_CAP) this.logs.splice(0, this.logs.length - LOG_CAP);
    this.world?.log(msg);
  }
}

function dumpStr(ctx: QuickJSContext, h: QuickJSHandle): string {
  try {
    const d = ctx.dump(h);
    return typeof d === 'string' ? d : d == null ? '' : String(d);
  } catch {
    return '';
  }
}

function safeDump(ctx: QuickJSContext, h: QuickJSHandle): unknown {
  try {
    return ctx.dump(h);
  } catch {
    return null;
  }
}

function hookError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  // quickjs 的中断异常很长，只留关键信息
  return msg.includes('Interrupted') ? `执行超时（>${HOOK_BUDGET_MS}ms，可能死循环）` : msg.slice(0, 200);
}

/** 编辑态静态检查：只验语法，绝不执行（这条约定是 W12 导出的前提） */
export function checkScriptSyntax(code: string): { ok: boolean; error: string | null } {
  if (!code.trim()) return { ok: true, error: null };
  try {
    // Function 构造器只做解析（不调用），编辑器进程从未执行脚本内容
    // eslint-disable-next-line no-new-func
    new Function(code);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
