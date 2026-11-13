/**
 * 从当前脚本源码里抽符号（自己写的字段 / 方法 / 变量 / 类）。
 *
 * 为什么用 TypeScript 自己解析：类型检查已经为了编译脚本把 typescript 拉进来了，
 * 直接用它建 AST 比正则稳得多，还能顺手把字段类型、@Label / @Hint 的文本读出来，
 * 补全列表里显示的就是「血条 · 血量」，而不是一个没头没脑的 blood。
 *
 * 解析是同步的（createSourceFile 很快），但 typescript 模块本身是懒加载：
 * 第一次调用会 await，之后走缓存。
 */
import type { ApiEntry } from './apiModel';

export interface DocSymbols {
  /** 顶层符号：类 / 函数 / 变量 / 接口 —— 在根位置补全 */
  root: ApiEntry[];
  /** 类成员 —— 在 `this.` 后面补全 */
  members: ApiEntry[];
}

const EMPTY: DocSymbols = { root: [], members: [] };

let tsPromise: Promise<any> | null = null;

/** 懒加载 typescript（和 scriptCompiler 共用同一个 chunk） */
function loadTs(): Promise<any> {
  if (!tsPromise) tsPromise = import('typescript').then((m: any) => m?.default ?? m);
  return tsPromise;
}

/** 已经加载好时同步解析，没加载好就返回 null（调用方降级到静态 API 表） */
let loadedTs: any = null;
void loadTs().then((ts) => {
  loadedTs = ts;
});

const cache = new Map<string, DocSymbols>();
const CACHE_MAX = 24;

function remember(key: string, value: DocSymbols): DocSymbols {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, value);
  return value;
}

/** 取字符串字面量的值（@Label('血量') 里的 '血量'） */
function literalText(ts: any, node: any): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return node.text;
  if (ts.isObjectLiteralExpression?.(node)) return null;
  return null;
}

interface DecoratorInfo {
  names: string[];
  label: string | null;
  hint: string | null;
}

function decoratorsOf(ts: any, node: any): DecoratorInfo {
  const info: DecoratorInfo = { names: [], label: null, hint: null };
  if (!ts.canHaveDecorators?.(node)) return info;
  const mods = ts.getDecorators(node) ?? [];
  for (const dec of mods) {
    if (!ts.isDecorator(dec)) continue;
    let expr = dec.expression;
    // @Group('基础') 是 CallExpression；@Hidden 也可能写成不带括号（少见，编译会报错）
    if (ts.isCallExpression(expr)) {
      const callee = expr.expression;
      const name = callee?.getText?.() ?? '';
      if (name) info.names.push(name);
      if (name === 'Label' || name === 'Hint') {
        const v = literalText(ts, expr.arguments?.[0]);
        if (v !== null) {
          if (name === 'Label') info.label = v;
          else info.hint = v;
        }
      }
    } else {
      const name = expr?.getText?.() ?? '';
      if (name) info.names.push(name);
    }
  }
  return info;
}

/** 成员名（考虑私有 / 字符串键） */
function memberName(ts: any, node: any): string | null {
  const n = node.name;
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isPrivateIdentifier(n)) return n.text ?? n.getText?.() ?? null;
  return null;
}

function makeMemberEntry(ts: any, node: any, kind: ApiEntry['kind']): ApiEntry | null {
  const name = memberName(ts, node);
  if (!name || name.startsWith('#')) return null;
  const dec = decoratorsOf(ts, node);
  let typeText: string;
  let doc: string;
  if (kind === 'method') {
    const params: string = node.parameters?.map((p: any) => p.getText().replace(/\s+/g, ' ')).join(', ') ?? '';
    const ret = node.type ? `: ${node.type.getText().replace(/\s+/g, ' ')}` : '';
    typeText = `(${params})${ret}`;
    const desc = [dec.label, dec.hint].filter(Boolean).join(' · ');
    doc = desc || '自己写的方法';
  } else {
    typeText = node.type ? node.type.getText().replace(/\s+/g, ' ') : inferTypeOf(ts, node.initializer);
    const desc = [dec.label, dec.hint].filter(Boolean).join(' · ');
    doc = desc || '自己写的字段（会出现在属性面板）';
  }
  const hide = dec.names.includes('Hidden') ? '（面板里隐藏）' : '';
  return {
    name,
    kind,
    type: typeText,
    doc: `${doc}${hide}`,
    hint: dec.names.length ? dec.names.map((x) => `@${x}`).join(' ') : undefined,
  };
}

/** 没写类型标注时按初始值猜一个（面板字段的常见写法） */
function inferTypeOf(ts: any, init: any): string {
  if (!init) return 'any';
  if (ts.isNumericLiteral(init)) return 'number';
  if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init) || ts.isTemplateExpression(init)) return 'string';
  if (init.kind === ts.SyntaxKind.TrueKeyword || init.kind === ts.SyntaxKind.FalseKeyword) return 'boolean';
  if (ts.isArrayLiteralExpression(init)) return 'unknown[]';
  if (ts.isObjectLiteralExpression(init)) return 'object';
  if (ts.isNewExpression(init)) return init.expression?.getText?.() ?? 'object';
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return 'function';
  return 'any';
}

function parseWith(ts: any, source: string): DocSymbols {
  const sf = ts.createSourceFile('script.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const root: ApiEntry[] = [];
  const members: ApiEntry[] = [];

  const visitStatements = (statements: any[]) => {
    for (const st of statements) {
      // export default class / export function 也是这些节点
      if (ts.isClassDeclaration(st) && st.name) {
        root.push({ name: st.name.text, kind: 'class', type: 'class', doc: '脚本里的类' });
        for (const member of st.members ?? []) {
          if (ts.isPropertyDeclaration(member)) {
            const e = makeMemberEntry(ts, member, 'property');
            if (e) members.push(e);
          } else if (ts.isMethodDeclaration(member)) {
            const e = makeMemberEntry(ts, member, 'method');
            if (e) members.push(e);
          } else if (ts.isGetAccessor(member) || ts.isSetAccessor(member)) {
            const e = makeMemberEntry(ts, member, 'property');
            if (e) members.push(e);
          }
        }
      } else if (ts.isFunctionDeclaration(st) && st.name) {
        root.push({ name: st.name.text, kind: 'function', type: 'function', doc: '脚本里的函数' });
      } else if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) {
        const name = st.name?.text;
        if (name) root.push({ name, kind: 'type', type: ts.isEnumDeclaration(st) ? 'enum' : 'type', doc: '自己定义的类型' });
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList?.declarations ?? []) {
          const name = d.name && ts.isIdentifier(d.name) ? d.name.text : null;
          if (name) root.push({ name, kind: 'variable', type: d.type ? d.type.getText() : '变量', doc: '自己定义的变量' });
        }
      } else if (ts.isExportAssignment(st) || ts.isExportDeclaration(st)) {
        // 忽略
      }
    }
  };

  visitStatements(sf.statements ?? []);
  return { root, members };
}

/** 解析（异步：会把 typescript 拉起来） */
export async function docSymbols(source: string): Promise<DocSymbols> {
  const hit = cache.get(source);
  if (hit) return hit;
  const ts = await loadTs();
  try {
    return remember(source, parseWith(ts, source));
  } catch {
    return EMPTY;
  }
}

/** 同步版本：typescript 还没加载好时返回 null */
export function docSymbolsSync(source: string): DocSymbols | null {
  const hit = cache.get(source);
  if (hit) return hit;
  if (!loadedTs) return null;
  try {
    return remember(source, parseWith(loadedTs, source));
  } catch {
    return EMPTY;
  }
}
