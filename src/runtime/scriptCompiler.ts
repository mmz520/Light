/**
 * 组件脚本编译：TS 源码 → 可直接执行的 JS class
 *
 * 为什么在运行时编译：脚本是工程里的资产，用户随时在编辑器里改，
 * 所以属性面板与播放前都要拿到最新的类定义。这里用 typescript 的 transpileModule
 * （只转译、不做类型检查）把 TS 编成 CommonJS，再用 new Function 求值。
 *
 * 依赖按需动态加载：只有工程里真的存在组件脚本时才把 typescript 拉进内存。
 */
import {
  Asset,
  Bool,
  Color,
  Component,
  Enum,
  Event,
  Group,
  Hidden,
  Hint,
  Int,
  Json,
  Label,
  LightComponent,
  List,
  Num,
  Order,
  Panel,
  Str,
  Text,
} from './component';

export interface CompiledScript {
  js: string;
  /** 编译错误（TS 诊断）；null = 通过 */
  error: string | null;
  /** 错误在源码里的位置（字符偏移），编辑器用来画波浪线 */
  ranges: { start: number; length: number }[];
}

/** 注入到脚本作用域的全局名字（脚本里直接写 @Group(...) 就能用） */
const SCRIPT_GLOBALS: Record<string, unknown> = {
  LightComponent,
  Component,
  Group,
  Hidden,
  Label,
  Hint,
  Order,
  Num,
  Int,
  Bool,
  Str,
  Text,
  Color,
  Enum,
  Asset,
  Json,
  List,
  Panel,
  Event,
};

let tsModule: Promise<any> | null = null;

/** 懒加载 typescript（dev 下 vite 首次会预打包，约 1~2 秒） */
async function loadTs(): Promise<any> {
  if (!tsModule) {
    tsModule = import('typescript').then((m: any) => m?.default ?? m);
  }
  return tsModule;
}

/** 极简字符串哈希（缓存键用） */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const compileCache = new Map<string, CompiledScript>();

/**
 * 把 TS 源码编译成 JS（带缓存）。
 * 出错时返回 error，调用方决定怎么展示（属性面板会给红字提示，不影响其它组件）。
 */
export async function compileComponentSource(source: string): Promise<CompiledScript> {
  const key = hash(source);
  const hit = compileCache.get(key);
  if (hit) return hit;

  const ts = await loadTs();
  const out = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
      useDefineForClassFields: true,
      esModuleInterop: true,
      removeComments: false,
      isolatedModules: true,
    },
    reportDiagnostics: true,
    fileName: 'component.ts',
  });

  const diags = (out.diagnostics ?? []) as { category: number; messageText: string | { messageText?: string }; start?: number; length?: number }[];
  const errors = diags.filter((d) => d.category === 1); // ts.DiagnosticCategory.Error
  if (errors.length > 0) {
    const msg = errors
      .map((d) => (typeof d.messageText === 'string' ? d.messageText : (d.messageText?.messageText ?? '语法错误')))
      .join('；');
    const res: CompiledScript = {
      js: '',
      error: msg,
      ranges: errors
        .filter((d) => typeof d.start === 'number' && d.start >= 0)
        .map((d) => ({ start: d.start as number, length: Math.max(1, d.length ?? 1) })),
    };
    compileCache.set(key, res);
    return res;
  }

  let js = out.outputText;
  // 没写 export default 时兜底：把源码里第一个 class 当成默认导出
  if (!/exports\.default|module\.exports\s*=/.test(js)) {
    const guessed = /class\s+([A-Za-z_$][\w$]*)/.exec(source)?.[1];
    if (guessed) js += `\ntry { exports.default = ${guessed}; } catch (e) {}`;
  }

  const res: CompiledScript = { js, error: null, ranges: [] };
  compileCache.set(key, res);
  return res;
}

export interface EvaluatedComponent {
  /** 组件类；求值失败时为 null */
  cls: (new (...args: any[]) => LightComponent) | null;
  error: string | null;
}

/**
 * 执行编译产物，取回组件类。
 * 注：这是「用户自己的可信代码」，与旧的 quickjs 沙箱脚本不同 —— 组件脚本要能操作 three 对象，
 * 只能跑在主线程。脚本里 import / require 被显式禁用，避免意外加载模块。
 */
export function evaluateComponent(js: string): EvaluatedComponent {
  const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
  try {
    const names = Object.keys(SCRIPT_GLOBALS);
    const values = names.map((n) => SCRIPT_GLOBALS[n]);
    // eslint-disable-next-line no-new-func
    const factory = new Function(
      ...names,
      'exports',
      'module',
      'require',
      `"use strict";\n${js}`,
    );
    factory(...values, moduleObj.exports, moduleObj, (spec: string) => {
      throw new Error(`组件脚本里不能用 import / require（${spec}）：API 已内置，直接调用即可`);
    });
    const exported = moduleObj.exports as { default?: unknown };
    const cls = (exported.default ?? moduleObj.exports) as unknown;
    if (typeof cls !== 'function') {
      return { cls: null, error: '脚本没有导出组件类（需要 export default class X extends LightComponent）' };
    }
    return { cls: cls as new (...args: any[]) => LightComponent, error: null };
  } catch (e) {
    return { cls: null, error: (e as Error)?.message ?? String(e) };
  }
}
