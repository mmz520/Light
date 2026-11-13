/**
 * 脚本编辑器的补全与悬浮说明。
 *
 * 补全分三层：
 *   1. CodeMirror 自带的 TS/JS 能力（关键字、本地变量、语法树里的成员）—— 由 lang-javascript 提供
 *   2. 本文件：按「点号接收者」给出 API 成员（this. / this.node. / this.camera.pose. / Event. …）
 *   3. 当前文档里自己写的字段与方法（typescript AST 抽出来，带 @Label 文本）
 *
 * 补全项的文档面板、hover 提示、右栏速查读的是同一份 apiModel，不会出现三处说法不一致。
 */
import { snippetCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { hoverTooltip, type Tooltip } from '@codemirror/view';
import { findEntry, classBodyEntries, rootEntries, scopeOfChain, type ApiEntry } from './apiModel';
import { docSymbols, docSymbolsSync } from './scriptSymbols';
import { FONT, T } from '../ui/theme';

/** 补全弹窗右侧的说明文字 */
function infoOf(e: ApiEntry): string {
  return e.hint ? `${e.doc}\n\n${e.hint}` : e.doc;
}

function toOption(e: ApiEntry, boost: number): Completion {
  const base = { label: e.name, type: e.kind, detail: e.type, info: infoOf(e), boost };
  if (e.snippet) return snippetCompletion(e.snippet, base);
  return base;
}

/** 组件脚本 / 钩子脚本的补全源。
 * hook = true 时用旧式 self / Light 那套（两种脚本的 API 不通用）。
 */
export function scriptApiCompletions(opts: { hook: boolean }): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const { state } = context;
    const doc = state.doc.toString();

    // 字符串 / 注释里不弹
    const node = syntaxTree(state).resolveInner(context.pos, -1);
    if (/String|Comment|Template/.test(node.name)) return null;

    // 光标前的词：可能带 @（注解）
    const word = context.matchBefore(/@?[A-Za-z_$][\w$]*/);
    const hasWord = !!word;
    const typedAt = !!word && word.text.startsWith('@');

    // 没有词也不是刚敲完点号 / 手动触发 → 不弹
    const prevChar = context.pos > 0 ? state.sliceDoc(context.pos - 1, context.pos) : '';
    if (!hasWord && prevChar !== '.' && !context.explicit) return null;

    const from = typedAt ? word!.from + 1 : hasWord ? word!.from : context.pos;
    const before = state.sliceDoc(Math.max(0, from - 160), from);

    // 注解：只给装饰器
    if (typedAt || prevChar === '@') {
      const items = rootEntries(opts.hook)
        .filter((e) => isDecorator(e))
        .map((e) => toOption(e, 30));
      return { from: typedAt ? word!.from + 1 : from, options: items, validFor: /^[\w$]*$/ };
    }

    // 点号链：this.node. 里的 this.node
    const chainMatch = /((?:[A-Za-z_$][\w$]*\s*\.\s*)*)$/.exec(before);
    const chainText = chainMatch?.[1] ?? '';
    const chain = chainText
      .split('.')
      .map((s) => s.trim())
      .filter(Boolean);

    const symbols = docSymbolsSync(doc) ?? (await docSymbols(doc));

    if (chain.length > 0) {
      const scope = scopeOfChain(chain);
      // 不认识的接收者（用户自己的变量）：交给其它补全源，别乱塞
      if (!scope) return null;
      const own = scope.id === 'this' ? symbols.members : [];
      const options = [...own.map((e) => toOption(e, (scope.boost ?? 0) + 12)), ...scope.entries.map((e) => toOption(e, scope.boost ?? 0))];
      return { from, options, validFor: /^[\w$]*$/ };
    }

    if (!hasWord && !context.explicit) return null;

    // 类体这一层（不在方法体里）：补全生命周期钩子与字段片段
    const inClassBody = !opts.hook && atClassMemberLevel(node);
    const ownNames = new Set(symbols.members.map((e) => e.name));
    const bodyEntries = inClassBody ? classBodyEntries().filter((e) => !ownNames.has(e.name)) : [];

    // 根位置：装饰器 + 全局对象 + 骨架片段 + 生命周期 + 自己写的顶层符号
    const options = [
      ...rootEntries(opts.hook).map((e) => toOption(e, isDecorator(e) ? 20 : 5)),
      ...bodyEntries.map((e) => toOption(e, 26)),
      ...symbols.root.map((e) => toOption(e, 30)),
    ];
    return { from, options, validFor: /^[\w$]*$/ };
  };
}

/** 语法树节点（只用到 name / parent，避免直接依赖 @lezer/common） */
type TreeNode = { name: string; parent: TreeNode | null } | null;

/**
 * 光标是否在「类体成员」这一层。
 * 走进方法体 / 语句块（Block）之后再插一个方法是非法的，所以往上先遇到 Block 就不算。
 */
function atClassMemberLevel(node: TreeNode): boolean {
  let cur = node;
  while (cur) {
    if (cur.name === 'ClassBody') return true;
    if (cur.name === 'Block') return false;
    cur = cur.parent;
  }
  return false;
}

function isDecorator(e: ApiEntry): boolean {
  return e.kind === 'function' && /^(Component|Group|Label|Hint|Order|Hidden|Num|Int|Bool|Str|Text|Color|Enum|Asset|Json|List|Panel)$/.test(e.name);
}

/* ------------------------------------------------------------------ */
/* 悬浮说明                                                            */
/* ------------------------------------------------------------------ */

interface TokenHit {
  from: number;
  to: number;
  text: string;
  /** 前面的点号链（不含自己） */
  chain: string[];
}

/** 找光标处的标识符 + 它的点号链 */
function tokenAt(state: { doc: { lineAt: (p: number) => { from: number; text: string } } }, pos: number): TokenHit | null {
  const line = state.doc.lineAt(pos);
  const off = pos - line.from;
  const text = line.text;
  const re = /[A-Za-z_$][\w$]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const s = m.index;
    const e = s + m[0].length;
    if (off < s || off > e) continue;
    const before = text.slice(0, s);
    const chainMatch = /((?:[A-Za-z_$][\w$]*\s*\.\s*)*)$/.exec(before);
    const chain = (chainMatch?.[1] ?? '')
      .split('.')
      .map((x) => x.trim())
      .filter(Boolean);
    return { from: line.from + s, to: line.from + e, text: m[0], chain };
  }
  return null;
}

function tooltipDom(title: string, type: string | undefined, doc: string, hint: string | undefined, tag: string): HTMLElement {
  const dom = document.createElement('div');
  dom.style.cssText = `max-width:340px;padding:7px 10px 8px;font:11px/1.65 ${FONT};color:${T.text};background:${T.bg2};`;

  const head = document.createElement('div');
  head.style.cssText = `display:flex;align-items:baseline;gap:7px;font-family:Consolas,monospace;font-size:11.5px;`;
  const name = document.createElement('span');
  name.textContent = title;
  name.style.cssText = `color:${T.accent};font-weight:600;`;
  head.appendChild(name);
  if (type) {
    const t = document.createElement('span');
    t.textContent = type;
    t.style.cssText = `color:${T.dim};font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
    head.appendChild(t);
  }
  dom.appendChild(head);

  const body = document.createElement('div');
  body.textContent = doc;
  body.style.cssText = `margin-top:3px;color:${T.text};`;
  dom.appendChild(body);

  if (hint) {
    const h = document.createElement('div');
    h.textContent = hint;
    h.style.cssText = `margin-top:3px;color:${T.dimmer};font-size:10px;`;
    dom.appendChild(h);
  }

  const foot = document.createElement('div');
  foot.textContent = tag;
  foot.style.cssText = `margin-top:4px;color:${T.dimmer};font-size:9.5px;letter-spacing:.04em;`;
  dom.appendChild(foot);
  return dom;
}

/** hover 显示类型与说明 */
export function scriptHover(opts: { hook: boolean }) {
  return hoverTooltip((view, pos): Tooltip | null => {
    const hit = tokenAt(view.state, pos);
    if (!hit) return null;

    const scopeIds: string[] = [];
    if (hit.chain.length > 0) {
      const scope = scopeOfChain(hit.chain);
      if (scope) scopeIds.push(scope.id);
    }
    // 兜底：不认识接收者时也认得出通用成员（this.xxx 写错前缀也能提示）
    scopeIds.push(...(opts.hook ? ['self', 'Light'] : ['this', 'node', 'camera', 'Event', 'three']));

    const found = findEntry(hit.text, scopeIds);
    if (found) {
      return {
        pos: hit.from,
        end: hit.to,
        above: true,
        create: () => ({ dom: tooltipDom(hit.text, found.entry.type, found.entry.doc, found.entry.hint, found.scope) }),
      };
    }

    // 自己写的字段 / 方法
    const symbols = docSymbolsSync(view.state.doc.toString());
    const own = [...(symbols?.members ?? []), ...(symbols?.root ?? [])].find((e) => e.name === hit.text);
    if (own) {
      return {
        pos: hit.from,
        end: hit.to,
        above: true,
        create: () => ({ dom: tooltipDom(hit.text, own.type, own.doc, own.hint, hit.chain.length > 0 ? '本脚本的成员' : '本脚本') }),
      };
    }
    return null;
  });
}
