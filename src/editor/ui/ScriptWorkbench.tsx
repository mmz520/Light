/**
 * 脚本编辑器（W3）
 *
 * 左：代码编辑区（等宽字体 + 行号；编辑态绝不执行脚本，只做语法检查）
 * 右：API 速查 + 挂载了本脚本的对象列表
 *
 * 运行时约定见 src/runtime/scripts.ts：脚本定义 onStart / onUpdate / onEvent / onDestroy 钩子，
 * self 是实例句柄，Light 是白名单 API。
 */
import { useMemo, useState } from 'react';
import { editorStore, useEditor } from '../model/store';
import { checkScriptSyntax } from '../../runtime/scripts';
import { T, btnStyle, inputStyle, sectionTitle } from './theme';

const API_DOC: { sig: string; desc: string }[] = [
  { sig: 'function onStart(self, Light)', desc: '播放开始，每个实例一次' },
  { sig: 'function onUpdate(self, Light, dt)', desc: '每帧调用，dt 秒' },
  { sig: 'function onEvent(self, Light, name, data)', desc: '收到 Light.emit 的信号' },
  { sig: 'function onDestroy(self, Light)', desc: '播放结束，每个实例一次' },
  { sig: 'self.x / self.z / self.face', desc: '实例位置与朝向（可写）' },
  { sig: 'self.vars.变量名', desc: '控制器变量（可读写）' },
  { sig: 'Light.log(...)', desc: '输出到播放日志' },
  { sig: 'Light.input.isDown(key)', desc: '按键是否按住（如 "KeyW"）' },
  { sig: 'Light.input.pressed(key)', desc: '这一帧刚按下' },
  { sig: 'Light.emit(name, data?)', desc: '广播事件' },
  { sig: 'Light.on(name, fn)', desc: '订阅事件，fn(data)' },
  { sig: 'Light.time()', desc: '播放开始至今秒数' },
  { sig: 'Light.find(name)', desc: '按对象名查实体（只读快照）' },
];

export function ScriptWorkbench({ scriptId }: { scriptId: string }) {
  const { project } = useEditor();
  const script = project?.scripts.find((s) => s.id === scriptId) ?? null;
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [codeDraft, setCodeDraft] = useState<string | null>(null);

  const code = codeDraft ?? script?.code ?? '';
  const lines = useMemo(() => code.split('\n').length, [code]);
  const syntax = useMemo(() => checkScriptSyntax(code), [code]);

  /** 挂载了本脚本的对象 */
  const mountedOn = useMemo(() => {
    if (!project || !script) return [];
    return project.scene.filter((n) => (n.scriptIds ?? []).includes(script.id));
  }, [project, script]);

  if (!project || !script) {
    return <div style={{ padding: 20, color: T.dimmer, fontSize: 12 }}>脚本已被删除</div>;
  }

  const commitCode = () => {
    if (codeDraft !== null && codeDraft !== script.code) {
      editorStore.mutateScript(script.id, (s) => {
        s.code = codeDraft;
      }, `script-code:${script.id}`);
    }
    setCodeDraft(null);
  };

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
          {lines} 行 · 挂载于 {mountedOn.length} 个对象
        </span>
        <div style={{ flex: 1 }} />
        {syntax.ok ? (
          <span data-syntax-ok style={{ fontSize: 10, color: '#7fae7f' }}>✓ 语法检查通过</span>
        ) : (
          <span data-syntax-error style={{ fontSize: 10, color: '#c4553f', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={syntax.error ?? ''}>
            ✗ {syntax.error}
          </span>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 代码区 */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '8px 12px 4px', borderBottom: `1px solid ${T.lineSoft}`, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ ...sectionTitle, margin: 0, flex: 1 }}>代码（编辑态不执行，只做语法检查）</span>
            {codeDraft !== null && (
              <>
                <button onClick={commitCode} style={{ ...btnStyle, padding: '2px 10px', fontSize: 10.5 }} data-code-commit>
                  保存
                </button>
                <button
                  onClick={() => setCodeDraft(null)}
                  style={{ ...btnStyle, padding: '2px 8px', fontSize: 10.5, color: T.dimmer }}
                >
                  还原
                </button>
              </>
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', minHeight: 0, padding: '8px 12px 14px', gap: 0 }}>
            {/* 行号 */}
            <div
              style={{
                width: 34,
                flexShrink: 0,
                textAlign: 'right',
                paddingRight: 8,
                paddingTop: 8,
                fontFamily: 'Consolas, monospace',
                fontSize: 11,
                lineHeight: '15px',
                color: T.dimmer,
                borderRight: `1px solid ${T.lineSoft}`,
                background: T.bg1,
                borderRadius: '4px 0 0 4px',
                overflow: 'hidden',
                userSelect: 'none',
              }}
            >
              {Array.from({ length: Math.min(lines, 500) }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              data-script-code
              value={code}
              spellCheck={false}
              onChange={(e) => setCodeDraft(e.target.value)}
              onBlur={commitCode}
              onKeyDown={(e) => {
                // Tab 缩进：编辑器里最常见的诉求
                if (e.key === 'Tab') {
                  e.preventDefault();
                  const el = e.currentTarget;
                  const [a, b] = [el.selectionStart, el.selectionEnd];
                  const next = code.slice(0, a) + '  ' + code.slice(b);
                  setCodeDraft(next);
                  requestAnimationFrame(() => {
                    el.selectionStart = el.selectionEnd = a + 2;
                  });
                }
              }}
              style={{
                flex: 1,
                minHeight: 0,
                resize: 'none',
                border: `1px solid ${T.lineSoft}`,
                borderLeft: 'none',
                borderRadius: '0 4px 4px 0',
                background: T.bg1,
                color: T.text,
                fontFamily: 'Consolas, monospace',
                fontSize: 11.5,
                lineHeight: '15px',
                padding: '8px 10px',
                outline: 'none',
                whiteSpace: 'pre',
                overflow: 'auto',
              }}
            />
          </div>
        </div>

        {/* 右栏 */}
        <div style={{ width: 252, flexShrink: 0, borderLeft: `1px solid ${T.line}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '8px 10px', borderBottom: `1px solid ${T.lineSoft}` }}>
            <span style={{ ...sectionTitle, margin: 0 }}>API 速查</span>
          </div>
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: '6px 10px 14px' }}>
            {API_DOC.map((d) => (
              <div key={d.sig} style={{ marginBottom: 7 }}>
                <div style={{ fontFamily: 'Consolas, monospace', fontSize: 10, color: T.accent, wordBreak: 'break-all' }}>{d.sig}</div>
                <div style={{ fontSize: 9.5, color: T.dimmer, lineHeight: 1.5 }}>{d.desc}</div>
              </div>
            ))}
          </div>
          <div style={{ borderTop: `1px solid ${T.lineSoft}`, padding: '8px 10px', flexShrink: 0 }}>
            <span style={{ ...sectionTitle, margin: 0 }}>挂载于</span>
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
