/**
 * 脚本 API 帮助窗口
 *
 * 左：按用途分组的栏目（快速开始 / 属性面板 / 运行时 API / 参考）
 * 右：Markdown 正文，顶部有本页目录，代码块可一键复制
 *
 * 文档源在 src/editor/docs/*.md，构建时内联；新增 API 必须同步更新对应 md。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { DEFAULT_DOC_ID, DOC_GROUPS, DOC_PAGES, findDoc } from '../docs';
import { Markdown, outlineOf } from './Markdown';
import { T, FONT, inputStyle } from './theme';

const MONO = "Consolas, 'JetBrains Mono', monospace";

export function ApiHelpWindow({ initialDoc }: { initialDoc?: string }) {
  const [active, setActive] = useState(initialDoc && DOC_PAGES.some((p) => p.id === initialDoc) ? initialDoc : DEFAULT_DOC_ID);
  const [query, setQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const page = findDoc(active);
  const outline = useMemo(() => outlineOf(page.body), [page]);

  const hits = useMemo(() => {
    const kw = query.trim().toLowerCase();
    if (!kw) return null;
    return new Set(DOC_PAGES.filter((p) => `${p.title}${p.summary}${p.body}`.toLowerCase().includes(kw)).map((p) => p.id));
  }, [query]);

  /* 切页回到顶部 */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [active]);

  const go = (id: string): void => {
    setActive(id);
  };

  const idx = DOC_PAGES.findIndex((p) => p.id === page.id);
  const prev = idx > 0 ? DOC_PAGES[idx - 1] : null;
  const next = idx >= 0 && idx < DOC_PAGES.length - 1 ? DOC_PAGES[idx + 1] : null;

  return (
    <div style={{ height: '100%', display: 'flex', background: T.bg1, color: T.text, fontFamily: FONT, minHeight: 0 }}>
      {/* 左栏：栏目 */}
      <div
        style={{
          width: 238,
          flexShrink: 0,
          borderRight: `1px solid ${T.line}`,
          background: T.bg2,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <div style={{ padding: '10px 10px 8px', borderBottom: `1px solid ${T.lineSoft}`, flexShrink: 0 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索：事件 / 装饰器 / three…"
            spellCheck={false}
            data-help-search
            style={{ ...inputStyle, fontSize: 11.5, padding: '5px 8px' }}
          />
          <div style={{ marginTop: 6, fontSize: 9.5, color: T.dimmer }}>
            {hits ? `命中 ${hits.size} 篇 / 共 ${DOC_PAGES.length} 篇` : `${DOC_PAGES.length} 篇 · 覆盖脚本全部 API`}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '8px 0 16px' }}>
          {DOC_GROUPS.map((g) => {
            const pages = hits ? g.pages.filter((p) => hits.has(p.id)) : g.pages;
            return (
              <div key={g.id} style={{ marginBottom: 6 }}>
                <div style={{ padding: '6px 12px 4px', fontSize: 10, letterSpacing: '.08em', color: T.dimmer, textTransform: 'uppercase' }}>
                  {g.title}
                </div>
                {pages.length === 0 && <div style={{ padding: '2px 12px 6px', fontSize: 10, color: T.dimmer, opacity: 0.6 }}>无匹配</div>}
                {pages.map((p) => {
                  const on = p.id === page.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => go(p.id)}
                      data-help-item={p.id}
                      style={{
                        position: 'relative',
                        margin: '1px 6px',
                        padding: '6px 10px 6px 12px',
                        borderRadius: 4,
                        cursor: 'default',
                        background: on ? T.sel : 'transparent',
                        borderLeft: `2px solid ${on ? T.accent : 'transparent'}`,
                      }}
                    >
                      <div style={{ fontSize: 12, color: on ? T.text : T.dim, fontWeight: on ? 600 : 400 }}>{p.title}</div>
                      <div
                        style={{
                          fontSize: 9.5,
                          color: T.dimmer,
                          lineHeight: 1.5,
                          marginTop: 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {p.summary}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* 右栏：正文 */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, background: T.bg1 }}>
        <div
          style={{
            flexShrink: 0,
            padding: '0 22px',
            height: 34,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderBottom: `1px solid ${T.lineSoft}`,
            background: T.bg2,
          }}
        >
          <span style={{ fontSize: 10.5, color: T.dimmer }}>脚本 API</span>
          <span style={{ fontSize: 10.5, color: T.dimmer }}>›</span>
          <span style={{ fontSize: 10.5, color: T.dimmer }}>{page.group}</span>
          <span style={{ fontSize: 10.5, color: T.dimmer }}>›</span>
          <span style={{ fontSize: 11, color: T.text }}>{page.title}</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 9.5, color: T.dimmer }}>
            文档在 src/editor/docs/{page.id}.md
          </span>
        </div>

        <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 26px 40px' }}>
          <div style={{ maxWidth: 880 }}>
            {outline.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  padding: '8px 10px',
                  marginBottom: 16,
                  background: T.bg0,
                  border: `1px solid ${T.lineSoft}`,
                  borderRadius: 5,
                }}
              >
                <span style={{ fontSize: 10, color: T.dimmer, marginRight: 2, lineHeight: '20px' }}>本页目录</span>
                {outline.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => document.getElementById(o.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: o.level === 2 ? T.dim : T.dimmer,
                      fontSize: 10.5,
                      fontFamily: FONT,
                      cursor: 'pointer',
                      padding: '1px 5px',
                      borderRadius: 3,
                      lineHeight: '18px',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = T.bg3;
                      e.currentTarget.style.color = T.text;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = o.level === 2 ? T.dim : T.dimmer;
                    }}
                  >
                    {o.text}
                  </button>
                ))}
              </div>
            )}

            <Markdown source={page.body} />

            {/* 上一篇 / 下一篇 */}
            <div style={{ display: 'flex', gap: 10, marginTop: 28, paddingTop: 14, borderTop: `1px solid ${T.lineSoft}` }}>
              {prev ? <NavCard dir="上一" title={prev.title} onClick={() => go(prev.id)} /> : <div style={{ flex: 1 }} />}
              {next ? <NavCard dir="下一" title={next.title} onClick={() => go(next.id)} align="right" /> : <div style={{ flex: 1 }} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const navStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '8px 12px',
  background: T.bg2,
  border: `1px solid ${T.lineSoft}`,
  borderRadius: 5,
  cursor: 'default',
};

function NavCard({ dir, title, onClick, align }: { dir: string; title: string; onClick: () => void; align?: 'right' }) {
  return (
    <div
      onClick={onClick}
      style={{ ...navStyle, textAlign: align ?? 'left' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = T.accentSoft;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = T.lineSoft;
      }}
    >
      <div style={{ fontSize: 9.5, color: T.dimmer }}>{dir}篇</div>
      <div style={{ fontSize: 12, color: T.text, marginTop: 2, fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title}
      </div>
    </div>
  );
}
