/**
 * 轻量 Markdown 渲染器。
 *
 * 只覆盖文档里实际用到的语法：标题、段落、列表、代码块（简易高亮 + 复制）、表格、
 * 引用块、分隔线、行内代码 / 粗体 / 链接。不引第三方依赖，配色跟编辑器主题一致。
 *
 * 用 React 元素拼装（不用 innerHTML），文档内容即使带 < > 也不会变成 HTML。
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { desk, isDesktop } from '../../platform/desk';
import { T, FONT } from './theme';

const MONO = "Consolas, 'JetBrains Mono', 'SF Mono', monospace";

/* ------------------------------------------------------------------ */
/* 块解析                                                              */
/* ------------------------------------------------------------------ */

type Block =
  | { t: 'h'; level: number; text: string; hid?: string }
  | { t: 'p'; text: string }
  | { t: 'list'; ordered: boolean; items: { text: string; indent: number }[] }
  | { t: 'code'; lang: string; code: string }
  | { t: 'quote'; lines: string[] }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'hr' };

export interface OutlineItem {
  id: string;
  level: number;
  text: string;
}

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((s) => s.trim());

const isTableSep = (line: string): boolean => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');

function parse(source: string): { blocks: Block[]; outline: OutlineItem[] } {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  const outline: OutlineItem[] = [];
  let hidSeq = 0;
  let i = 0;

  const pushHeading = (level: number, text: string) => {
    const hid = level >= 2 ? `h${hidSeq++}` : undefined;
    blocks.push({ t: 'h', level, text, hid });
    if (hid && level <= 3) outline.push({ id: hid, level, text });
  };

  while (i < lines.length) {
    const line = lines[i];

    // 代码围栏
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] || '';
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过收尾围栏
      blocks.push({ t: 'code', lang, code: buf.join('\n') });
      continue;
    }

    // 空行
    if (!line.trim()) {
      i++;
      continue;
    }

    // 标题
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      pushHeading(h[1].length, h[2].trim());
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*---+\s*$/.test(line)) {
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }

    // 表格：当前行像表格，下一行是分隔行
    if (line.trim().startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ t: 'table', head, rows });
      continue;
    }

    // 引用块
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push({ t: 'quote', lines: buf });
      continue;
    }

    // 列表（- / * / 1.）
    const li = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /^\s*\d+\./.test(line);
      const items: { text: string; indent: number }[] = [];
      while (i < lines.length) {
        const m = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        if (/^\s*\d+\./.test(lines[i]) !== ordered) break;
        items.push({ text: m[2], indent: Math.floor(m[1].length / 2) });
        i++;
      }
      blocks.push({ t: 'list', ordered, items });
      continue;
    }

    // 段落：连续的普通行合并
    const buf: string[] = [line.trim()];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (!next.trim()) break;
      if (/^\s*(#{1,4}\s|```|>|\||[-*]\s|\d+\.\s|---+\s*$)/.test(next)) break;
      buf.push(next.trim());
      i++;
    }
    blocks.push({ t: 'p', text: buf.join(' ') });
  }

  return { blocks, outline };
}

/** 只取大纲（供页面顶部的「本页目录」用） */
export function outlineOf(source: string): OutlineItem[] {
  return parse(source).outline;
}

/* ------------------------------------------------------------------ */
/* 行内                                                                */
/* ------------------------------------------------------------------ */

const inlineCodeStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize: 11.5,
  background: T.bg3,
  border: `1px solid ${T.lineSoft}`,
  borderRadius: 3,
  padding: '0 4px',
  color: '#d8b45a',
  whiteSpace: 'nowrap',
};

function renderInline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-i${n++}`;
    if (tok.startsWith('`')) {
      out.push(
        <code key={k} style={inlineCodeStyle}>
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith('**')) {
      out.push(
        <strong key={k} style={{ color: '#f3ead9', fontWeight: 600 }}>
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (link) {
        const [, label, url] = link;
        out.push(
          <a
            key={k}
            href={url}
            onClick={(e) => {
              if (!/^https?:/i.test(url)) return;
              e.preventDefault();
              if (isDesktop) void desk.app.openExternal(url);
              else window.open(url, '_blank', 'noopener');
            }}
            style={{ color: T.accent, textDecoration: 'none', borderBottom: `1px solid ${T.accentSoft}` }}
          >
            {label}
          </a>,
        );
      } else {
        out.push(tok);
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ------------------------------------------------------------------ */
/* 代码高亮                                                            */
/* ------------------------------------------------------------------ */

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'class', 'extends', 'return', 'if', 'else', 'for', 'while', 'do',
  'new', 'this', 'super', 'export', 'default', 'import', 'from', 'try', 'catch', 'finally', 'throw',
  'typeof', 'instanceof', 'in', 'of', 'void', 'null', 'undefined', 'true', 'false', 'private', 'public',
  'protected', 'readonly', 'static', 'async', 'await', 'switch', 'case', 'break', 'continue', 'interface',
  'type', 'enum', 'as', 'any', 'number', 'string', 'boolean',
]);

const TOKEN_RE =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|(@[A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)/g;

function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = TOKEN_RE.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const tok = m[0];
    let color: string | undefined;
    if (m[1]) color = '#6d6153';
    else if (m[2]) color = '#9fb37a';
    else if (m[3]) color = '#9ec3d8';
    else if (m[4]) color = '#d8b45a';
    else if (m[5] && KEYWORDS.has(m[5])) color = '#d08b52';
    else if (m[5] && /^[A-Z]/.test(m[5])) color = '#cdb489';
    out.push(
      color ? (
        <span key={`t${n++}`} style={{ color, fontStyle: m[1] ? 'italic' : undefined }}>
          {tok}
        </span>
      ) : (
        tok
      ),
    );
    last = m.index + tok.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // 剪贴板不可用时退回到临时 textarea
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* 放弃 */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      style={{
        position: 'relative',
        margin: '10px 0 14px',
        background: T.bg0,
        border: `1px solid ${T.lineSoft}`,
        borderRadius: 5,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 26,
          padding: '0 8px 0 10px',
          background: T.bg1,
          borderBottom: `1px solid ${T.lineSoft}`,
        }}
      >
        <span style={{ fontSize: 10, color: T.dimmer, letterSpacing: '.06em', textTransform: 'uppercase' }}>{lang || 'code'}</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => void copy()}
          data-copy-code
          style={{
            background: 'transparent',
            border: 'none',
            color: copied ? T.ok : T.dimmer,
            fontSize: 10,
            cursor: 'pointer',
            padding: '2px 4px',
            fontFamily: FONT,
          }}
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '10px 12px',
          overflowX: 'auto',
          fontFamily: MONO,
          fontSize: 11.5,
          lineHeight: '18px',
          color: T.text,
          tabSize: 2,
        }}
      >
        <code>{highlight(code)}</code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

const headingStyle = (level: number): CSSProperties => {
  if (level === 1) return { fontSize: 20, fontWeight: 600, color: '#f3ead9', margin: '0 0 4px', letterSpacing: '.01em' };
  if (level === 2)
    return {
      fontSize: 14.5,
      fontWeight: 600,
      color: T.text,
      margin: '26px 0 10px',
      paddingBottom: 6,
      borderBottom: `1px solid ${T.lineSoft}`,
    };
  if (level === 3) return { fontSize: 12.8, fontWeight: 600, color: '#e6d8c3', margin: '18px 0 6px' };
  return { fontSize: 12, fontWeight: 600, color: T.dim, margin: '14px 0 6px' };
};

export function Markdown({ source }: { source: string }) {
  const { blocks } = useMemo(() => parse(source), [source]);
  return (
    <div style={{ fontFamily: FONT, fontSize: 12.5, lineHeight: 1.9, color: T.text }}>
      {blocks.map((b, bi) => {
        const key = `b${bi}`;
        switch (b.t) {
          case 'h':
            return (
              <div key={key} id={b.hid} style={{ ...headingStyle(b.level), scrollMarginTop: 12 }}>
                {renderInline(b.text, key)}
              </div>
            );
          case 'p':
            return (
              <p key={key} style={{ margin: '8px 0', color: T.text }}>
                {renderInline(b.text, key)}
              </p>
            );
          case 'list':
            return (
              <ul
                key={key}
                style={{
                  margin: '8px 0',
                  paddingLeft: 20,
                  listStyle: b.ordered ? 'decimal' : 'disc',
                  color: T.dim,
                }}
              >
                {b.items.map((it, ii) => (
                  <li key={`${key}-${ii}`} style={{ margin: '3px 0', paddingLeft: it.indent ? it.indent * 14 : 0, color: T.text }}>
                    {renderInline(it.text, `${key}-${ii}`)}
                  </li>
                ))}
              </ul>
            );
          case 'code':
            return <CodeBlock key={key} code={b.code} lang={b.lang} />;
          case 'quote':
            return (
              <div
                key={key}
                style={{
                  margin: '10px 0',
                  padding: '8px 12px',
                  borderLeft: `2px solid ${T.accentSoft}`,
                  background: 'rgba(201,135,58,.06)',
                  borderRadius: '0 4px 4px 0',
                  color: T.dim,
                  fontSize: 12,
                  lineHeight: 1.85,
                }}
              >
                {b.lines.map((l, li) => (
                  <div key={`${key}-${li}`}>{l ? renderInline(l, `${key}-${li}`) : null}</div>
                ))}
              </div>
            );
          case 'table':
            return (
              <div key={key} style={{ margin: '10px 0 14px', overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11.8, fontFamily: FONT }}>
                  <thead>
                    <tr>
                      {b.head.map((c, ci) => (
                        <th
                          key={`${key}-h${ci}`}
                          style={{
                            textAlign: 'left',
                            padding: '6px 10px',
                            background: T.bg2,
                            color: T.dim,
                            fontWeight: 600,
                            borderBottom: `1px solid ${T.line}`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {renderInline(c, `${key}-h${ci}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, ri) => (
                      <tr key={`${key}-r${ri}`}>
                        {b.head.map((_, ci) => (
                          <td
                            key={`${key}-r${ri}c${ci}`}
                            style={{
                              padding: '5px 10px',
                              borderBottom: `1px solid ${T.lineSoft}`,
                              color: T.text,
                              verticalAlign: 'top',
                            }}
                          >
                            {renderInline(r[ci] ?? '', `${key}-r${ri}c${ci}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'hr':
            return <div key={key} style={{ height: 1, background: T.lineSoft, margin: '18px 0' }} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
