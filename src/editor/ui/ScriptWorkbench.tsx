/**
 * 脚本编辑器（W3）
 *
 * 左：CodeMirror 代码区（TS 语法高亮 + 补全 + hover 说明 + 语法错误波浪线）
 * 右：API 速查（点一条插到光标处）+ 挂载了本脚本的对象列表
 *
 * 补全数据来自 src/editor/code/apiModel.ts —— 和 API 文档、右栏速查同源，
 * 加 API 只改那一处（以及 docs 里的 md）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { editorStore, useEditor } from '../model/store';
import { checkScriptSyntax } from '../../runtime/scripts';
import { compileComponentSource } from '../../runtime/scriptCompiler';
import { CodeEditor, type CodeEditorHandle } from '../code/CodeEditor';
import { sidebarGroups } from '../code/apiModel';
import type { Diagnostic } from '@codemirror/lint';
import { T, btnStyle, inputStyle, sectionTitle } from './theme';

/** 自动保存的防抖间隔（毫秒）；比 store 的 800ms 合并窗口短，连续打字算一次撤销 */
const AUTOSAVE_MS = 600;
/** 语法检查的防抖间隔 */
const CHECK_MS = 320;

interface SyntaxState {
  ok: boolean;
  error: string | null;
  ranges: { start: number; length: number }[];
}

export function ScriptWorkbench({ scriptId, onOpenDocs }: { scriptId: string; onOpenDocs?: () => void }) {
  const { project } = useEditor();
  const script = project?.scripts.find((s) => s.id === scriptId) ?? null;
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [codeDraft, setCodeDraft] = useState<string | null>(null);
  const [syntax, setSyntax] = useState<SyntaxState>({ ok: true, error: null, ranges: [] });
  const [filter, setFilter] = useState('');
  const editorRef = useRef<CodeEditorHandle>(null);

  const code = codeDraft ?? script?.code ?? '';
  const lines = useMemo(() => code.split('\n').length, [code]);
  const isComponent = script?.kind !== 'hook';
  const dirty = codeDraft !== null && codeDraft !== (script?.code ?? '');

  /* 语法检查（防抖）：组件脚本走 TS 编译器，钩子脚本走 JS 语法检查 */
  useEffect(() => {
    let dead = false;
    const timer = window.setTimeout(() => {
      if (!isComponent) {
        const r = checkScriptSyntax(code);
        if (!dead) setSyntax({ ok: r.ok, error: r.error, ranges: [] });
        return;
      }
      void compileComponentSource(code).then((r) => {
        if (!dead) setSyntax({ ok: !r.error, error: r.error, ranges: r.ranges ?? [] });
      });
    }, CHECK_MS);
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, [code, isComponent]);

  /* 自动保存：停手 600ms 后写回工程（和手动「保存」走同一条路径） */
  const commit = (text: string) => {
    if (!script || text === script.code) return;
    editorStore.mutateScript(
      script.id,
      (s) => {
        s.code = text;
      },
      `script-code:${script.id}`,
    );
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    if (!dirty || codeDraft === null) return;
    const timer = window.setTimeout(() => {
      commitRef.current(codeDraft);
      setCodeDraft(null);
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [codeDraft, dirty]);

  /** 挂载了本脚本的对象 */
  const mountedOn = useMemo(() => {
    if (!project || !script) return [];
    return project.scene.filter((n) => (n.scriptIds ?? []).includes(script.id));
  }, [project, script]);

  /** 语法错误 → 行内波浪线 */
  const diagnostics = useMemo<Diagnostic[]>(() => {
    if (syntax.ok || !syntax.error) return [];
    const len = code.length;
    if (len === 0) return [];
    const list = (syntax.ranges ?? [])
      .map((r) => {
        let from = Math.max(0, Math.min(r.start, len));
        let to = Math.max(0, Math.min(r.start + r.length, len));
        if (to <= from) {
          // 位置在行尾 / 越界：标到最后一个字符上，保证能看见
          from = Math.max(0, Math.min(from, len - 1));
          to = len;
        }
        return { from, to, severity: 'error' as const, message: syntax.error! };
      })
      .filter((d) => d.to > d.from);
    // 没有位置信息：整篇标红，至少能定位到编辑区
    return list.length > 0 ? list : [{ from: 0, to: len, severity: 'error' as const, message: syntax.error }];
  }, [syntax, code]);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const raw = sidebarGroups(!isComponent);
    if (!q) return raw;
    return raw
      .map((g) => ({ title: g.title, entries: g.entries.filter((e) => e.name.toLowerCase().includes(q) || e.doc.toLowerCase().includes(q)) }))
      .filter((g) => g.entries.length > 0);
  }, [filter, isComponent]);

  if (!project || !script) {
    return <div style={{ padding: 20, color: T.dimmer, fontSize: 12 }}>脚本已被删除</div>;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.bg0, minHeight: 0 }}>
      {/* 工具条 */}
      <div
        style={{
          height: 36,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px',
          borderBottom: `1px solid ${T.lineSoft}`,
          background: T.bg1,
        }}
      >
        <input
          value={nameDraft ?? script.name}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            if (nameDraft && nameDraft.trim() && nameDraft !== script.name) editorStore.renameAsset('script', script.id, nameDraft);
            setNameDraft(null);
          }}
          title="脚本名称"
          style={{ ...inputStyle, width: 170, padding: '3px 6px', fontSize: 11.5 }}
        />
        <span style={{ fontSize: 10, color: T.dimmer }}>
          {isComponent ? '组件脚本 · TS class' : '钩子脚本 · JS'} · {lines} 行 · 挂载于 {mountedOn.length} 个对象
        </span>
        <div style={{ flex: 1 }} />
        {dirty ? (
          <span data-code-dirty style={{ fontSize: 10, color: T.dim }}>
            ● 未保存
          </span>
        ) : (
          <span data-code-saved style={{ fontSize: 10, color: T.dimmer }}>
            ✓ 已保存
          </span>
        )}
        {syntax.ok ? (
          <span data-syntax-ok style={{ fontSize: 10, color: '#7fae7f' }}>
            ✓ 语法检查通过
          </span>
        ) : (
          <span
            data-syntax-error
            style={{ fontSize: 10, color: '#c4553f', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={syntax.error ?? ''}
          >
            ✗ {syntax.error}
          </span>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 代码区 */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '6px 12px', borderBottom: `1px solid ${T.lineSoft}`, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ ...sectionTitle, margin: 0, padding: 0, flex: 1 }}>
              代码（自动保存 · Ctrl+Space 补全 · Ctrl+S 立即保存）
            </span>
            <button
              onClick={() => {
                commit(code);
                setCodeDraft(null);
              }}
              style={{ ...btnStyle, padding: '2px 10px', fontSize: 10.5 }}
              data-code-commit
            >
              保存
            </button>
            <button
              onClick={() => setCodeDraft(null)}
              disabled={!dirty}
              style={{ ...btnStyle, padding: '2px 8px', fontSize: 10.5, color: dirty ? T.dimmer : T.line }}
              title="放弃未保存的改动"
            >
              还原
            </button>
          </div>
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <CodeEditor
              ref={editorRef}
              value={code}
              mode={isComponent ? 'ts' : 'js'}
              diagnostics={diagnostics}
              onChange={(next) => setCodeDraft(next)}
              onSave={() => {
                commit(code);
                setCodeDraft(null);
              }}
            />
          </div>
        </div>

        {/* 右栏 */}
        <div style={{ width: 258, flexShrink: 0, borderLeft: `1px solid ${T.line}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '8px 10px 6px', borderBottom: `1px solid ${T.lineSoft}`, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ ...sectionTitle, margin: 0, padding: 0, flex: 1 }}>API 速查</span>
            {onOpenDocs && (
              <button onClick={onOpenDocs} data-open-docs title="打开完整的脚本 API 文档" style={{ ...btnStyle, padding: '1px 6px', fontSize: 10 }}>
                完整文档
              </button>
            )}
          </div>
          <div style={{ padding: '6px 8px', borderBottom: `1px solid ${T.lineSoft}` }}>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜索 API…"
              style={{ ...inputStyle, padding: '3px 6px', fontSize: 10.5 }}
            />
          </div>
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: '2px 10px 14px' }}>
            {groups.map((g) => (
              <div key={g.title}>
                <div
                  style={{
                    fontSize: 9.5,
                    letterSpacing: '.08em',
                    color: T.accentSoft,
                    margin: '9px 0 4px',
                    textTransform: 'uppercase',
                  }}
                >
                  {g.title}
                </div>
                {g.entries.map((e) => (
                  <div
                    key={`${g.title}:${e.name}`}
                    onClick={() => editorRef.current?.insert(e.name)}
                    title={`点击插入 ${e.name}\n\n${e.doc}`}
                    style={{ cursor: 'pointer', marginBottom: 6, borderRadius: 3, padding: '1px 2px' }}
                    onMouseEnter={(ev) => {
                      ev.currentTarget.style.background = T.bg2;
                    }}
                    onMouseLeave={(ev) => {
                      ev.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ fontFamily: 'Consolas, monospace', fontSize: 10, color: T.accent, wordBreak: 'break-all' }}>
                      {e.name}
                      {e.type && <span style={{ color: T.dimmer }}> {e.type}</span>}
                    </div>
                    <div style={{ fontSize: 9.5, color: T.dimmer, lineHeight: 1.5 }}>{e.doc}</div>
                  </div>
                ))}
              </div>
            ))}
            {groups.length === 0 && <div style={{ fontSize: 10, color: T.dimmer, marginTop: 8 }}>没有匹配的 API</div>}
          </div>
          <div style={{ borderTop: `1px solid ${T.lineSoft}`, padding: '8px 10px', flexShrink: 0 }}>
            <span style={{ ...sectionTitle, margin: 0, padding: 0 }}>挂载于</span>
            <div style={{ marginTop: 5 }}>
              {mountedOn.length === 0 && <div style={{ fontSize: 10, color: T.dimmer }}>还没有对象挂载这个脚本（在场景属性面板里添加）</div>}
              {mountedOn.map((n) => (
                <div key={n.id} style={{ fontSize: 10.5, color: T.text, lineHeight: 1.7 }}>
                  · {n.name}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
