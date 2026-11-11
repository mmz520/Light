/**
 * 首屏 —— 没有打开过工程，或上次打开的文件夹已经不在了。
 */
import { useEffect, useState } from 'react';
import { desk, isDesktop } from '../../platform/desk';
import { errText, editorStore, useEditor } from '../model/store';
import { T, FONT, btnStyle, inputStyle } from './theme';

export function Welcome() {
  const { note, busy, recent } = useWelcomeData();
  const [creating, setCreating] = useState(false);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: `radial-gradient(1200px 700px at 50% 35%, #241d16 0%, ${T.bg0} 65%)`,
        color: T.text,
        fontFamily: FONT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 22,
        userSelect: 'none',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: '.42em',
            color: T.accentSoft,
            textTransform: 'uppercase',
            marginBottom: 12,
          }}
        >
          Don't Starve · Steampunk
        </div>
        <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: '.06em' }}>Light Editor</div>
        <div style={{ marginTop: 10, color: T.dim, fontSize: 13 }}>
          类饥荒生存游戏编辑器 · 贴图 / 动画 / 世界
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button
          onClick={() => void editorStore.openProjectDialog()}
          disabled={!isDesktop}
          style={{
            ...btnStyle,
            padding: '11px 26px',
            fontSize: 13,
            background: T.accent,
            color: '#1a1410',
            border: 'none',
            fontWeight: 700,
            opacity: isDesktop ? 1 : 0.5,
          }}
        >
          打开文件夹
        </button>
        <button
          onClick={() => setCreating(true)}
          disabled={!isDesktop}
          style={{
            ...btnStyle,
            padding: '11px 26px',
            fontSize: 13,
            opacity: isDesktop ? 1 : 0.5,
          }}
        >
          新建项目
        </button>
      </div>

      {note && (
        <div style={{ color: T.dimmer, fontSize: 12, maxWidth: 620, textAlign: 'center', lineHeight: 1.6 }}>{note}</div>
      )}
      {busy && <div style={{ color: T.accent, fontSize: 12 }}>{busy}</div>}

      {recent.length > 0 && (
        <div style={{ marginTop: 6, width: 520 }}>
          <div style={{ fontSize: 10.5, letterSpacing: '.1em', color: T.dimmer, textTransform: 'uppercase', marginBottom: 6 }}>
            最近打开
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {recent.slice(0, 6).map((r) => (
              <button
                key={r.root}
                onClick={() => void editorStore.openProject(r.root)}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 10,
                  textAlign: 'left',
                  background: 'transparent',
                  border: `1px solid transparent`,
                  borderRadius: 4,
                  padding: '7px 10px',
                  color: T.text,
                  cursor: 'pointer',
                  fontFamily: FONT,
                  fontSize: 12.5,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = T.bg2;
                  e.currentTarget.style.borderColor = T.line;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = 'transparent';
                }}
              >
                <span style={{ fontWeight: 600 }}>{r.name}</span>
                <span style={{ color: T.dimmer, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.root}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ position: 'absolute', bottom: 16, color: T.dimmer, fontSize: 11 }}>
        v0.2 · 工程内所有文件保存在你选择的文件夹里
      </div>

      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function useWelcomeData() {
  const state = useEditor();
  return { note: state.welcomeNote, busy: state.busy, recent: state.recent };
}

/* ------------------------------------------------------------------ */
/* 新建项目                                                            */
/* ------------------------------------------------------------------ */

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [parent, setParent] = useState<string>('');
  const [name, setName] = useState('我的工程');
  const [sample, setSample] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const paths = await desk.app.paths();
        setParent(paths.documents || paths.home);
      } catch {
        /* 浏览器模式：留空 */
      }
    })();
  }, []);

  const pick = async () => {
    try {
      const dirs = await desk.dialog.open({ title: '选择工程存放位置', directory: true, defaultPath: parent });
      if (dirs[0]) setParent(dirs[0]);
    } catch (e) {
      setError(errText(e));
    }
  };

  const create = async () => {
    if (!parent || !name.trim()) {
      setError('请填写位置与名称');
      return;
    }
    setWorking(true);
    setError(null);
    try {
      await editorStore.createProject(parent, name.trim(), sample);
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(8,6,4,.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 500,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 520,
          background: T.bg1,
          border: `1px solid ${T.line}`,
          borderRadius: 7,
          boxShadow: '0 24px 60px rgba(0,0,0,.65)',
          padding: 20,
          color: T.text,
          fontFamily: FONT,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>新建项目</div>

        <div style={{ fontSize: 11.5, color: T.dim, marginBottom: 5 }}>存放位置</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input value={parent} onChange={(e) => setParent(e.target.value)} style={inputStyle} placeholder="选择一个空文件夹的父目录" />
          <button onClick={() => void pick()} style={{ ...btnStyle, whiteSpace: 'nowrap' }}>
            浏览…
          </button>
        </div>

        <div style={{ fontSize: 11.5, color: T.dim, marginBottom: 5 }}>项目名称（将创建同名文件夹）</div>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, marginBottom: 14 }} />

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: T.text, marginBottom: 6 }}>
          <input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} />
          包含示例资源（工程师素体 + 装备 + 一条待机动画）
        </label>
        <div style={{ fontSize: 11, color: T.dimmer, marginBottom: 16, lineHeight: 1.6 }}>
          工程目录固定为 metadata.json + assets/images、assets/textures、assets/animations。
          {parent && (
            <>
              <br />
              将创建：{parent.replace(/[\\/]+$/, '')}
              {'\\'}
              {name || '…'}
            </>
          )}
        </div>

        {error && <div style={{ color: T.danger, fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={btnStyle}>
            取消
          </button>
          <button
            onClick={() => void create()}
            disabled={working}
            style={{ ...btnStyle, background: T.accent, color: '#1a1410', border: 'none', fontWeight: 700 }}
          >
            {working ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
