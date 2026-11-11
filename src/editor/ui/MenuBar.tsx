/**
 * 顶部菜单栏 —— 文件 / 编辑 / 视图 / 窗口 / 帮助，全部带二级菜单。
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { desk } from '../../platform/desk';
import { useEditor } from '../model/store';
import { MenuList, type MenuItem } from './Menu';
import { T, FONT } from './theme';

export interface MenuActions {
  openProject: () => void;
  newProject: () => void;
  importImages: () => void;
  save: () => void;
  closeProject: () => void;
  quit: () => void;
  undo: () => void;
  redo: () => void;
  renameSelected: () => void;
  deleteSelected: () => void;
  togglePanel: (panel: 'left' | 'right' | 'bottom') => void;
  reload: () => void;
  devTools: () => void;
  closeAllWindows: () => void;
  showAbout: () => void;
  showStructure: () => void;
}

interface Props {
  actions: MenuActions;
  panels: { left: boolean; right: boolean; bottom: boolean };
  windowCount: number;
}

/** 无边框窗口：整条栏可拖动，交互元素要标 no-drag 才能收到鼠标事件 */
const DRAG: CSSProperties = { WebkitAppRegion: 'drag' } as CSSProperties;
const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export function MenuBar({ actions, panels, windowCount }: Props) {
  const state = useEditor();
  const [open, setOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const inProject = state.status === 'ready';
  const hasSelection = !!state.selection;

  const menus: { id: string; label: string; items: MenuItem[] }[] = [
    {
      id: 'file',
      label: '文件',
      items: [
        { label: '新建项目…', onClick: actions.newProject },
        { label: '打开文件夹…', hint: 'Ctrl+O', onClick: actions.openProject },
        { type: 'sep' },
        { label: '导入贴图…', hint: 'Ctrl+I', disabled: !inProject, onClick: actions.importImages },
        { type: 'sep' },
        { label: '保存', hint: 'Ctrl+S', disabled: !inProject, onClick: actions.save },
        { type: 'sep' },
        { label: '关闭工程', disabled: !inProject, onClick: actions.closeProject },
        { label: '退出', hint: 'Ctrl+Q', onClick: actions.quit },
      ],
    },
    {
      id: 'edit',
      label: '编辑',
      items: [
        { label: '撤销', hint: 'Ctrl+Z', disabled: !state.canUndo, onClick: actions.undo },
        { label: '重做', hint: 'Ctrl+Shift+Z', disabled: !state.canRedo, onClick: actions.redo },
        { type: 'sep' },
        { label: '重命名资源…', hint: 'F2', disabled: !hasSelection, onClick: actions.renameSelected },
        { label: '删除资源', hint: 'Delete', disabled: !hasSelection, danger: true, onClick: actions.deleteSelected },
      ],
    },
    {
      id: 'view',
      label: '视图',
      items: [
        { type: 'header', label: '面板' },
        { label: '场景对象', checked: panels.left, onClick: () => actions.togglePanel('left') },
        { label: '属性检查器', checked: panels.right, onClick: () => actions.togglePanel('right') },
        { label: '资源浏览器', checked: panels.bottom, onClick: () => actions.togglePanel('bottom') },
        { type: 'sep' },
        { label: '重新加载界面', hint: 'Ctrl+R', onClick: actions.reload },
        { label: '开发者工具', hint: 'F12', onClick: actions.devTools },
      ],
    },
    {
      id: 'window',
      label: '窗口',
      items: [
        { label: `关闭所有动画窗口${windowCount ? `（${windowCount}）` : ''}`, disabled: windowCount === 0, onClick: actions.closeAllWindows },
      ],
    },
    {
      id: 'help',
      label: '帮助',
      items: [
        { label: '工程文件结构说明', onClick: actions.showStructure },
        { type: 'sep' },
        { label: '关于 Light Editor', onClick: actions.showAbout },
      ],
    },
  ];

  return (
    <div
      ref={barRef}
      style={{
        height: 30,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '0 6px',
        background: T.bg2,
        borderBottom: `1px solid ${T.line}`,
        fontFamily: FONT,
        position: 'relative',
        zIndex: 60,
        userSelect: 'none',
        ...DRAG,
      }}
    >
      {menus.map((m) => (
        <div key={m.id} style={{ position: 'relative' }}>
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen((cur) => (cur === m.id ? null : m.id));
            }}
            onMouseEnter={() => {
              if (open) setOpen(m.id);
            }}
            style={{
              ...NO_DRAG,
              padding: '3px 10px',
              borderRadius: 3,
              fontSize: 12.5,
              color: T.text,
              cursor: 'default',
              background: open === m.id ? T.bg4 : 'transparent',
            }}
          >
            {m.label}
          </div>
          {open === m.id && (
            <div style={{ ...NO_DRAG, position: 'absolute', left: 0, top: '100%', paddingTop: 3 }}>
              <MenuList items={m.items} onClose={() => setOpen(null)} />
            </div>
          )}
        </div>
      ))}

      <div style={{ flex: 1, height: '100%' }} />

      <div style={{ ...NO_DRAG, fontSize: 11.5, color: T.dimmer, display: 'flex', gap: 10, alignItems: 'center', paddingRight: 10 }}>
        {state.project && (
          <>
            <span style={{ color: T.dim }}>{state.project.name}</span>
            <span>·</span>
            <span>
              {state.project.images.length} 图片 / {state.project.textures.length} 贴图 / {state.project.animations.length} 动画
            </span>
            <span>·</span>
            <SaveBadge />
          </>
        )}
      </div>

      <WindowControls />
    </div>
  );
}

/** 自绘窗口按钮：隐藏 / 全屏 / 退出 */
function WindowControls() {
  const [full, setFull] = useState(false);
  const [hover, setHover] = useState<'min' | 'full' | 'close' | null>(null);

  const btn = (key: 'min' | 'full' | 'close', title: string, icon: string, onClick: () => void, danger?: boolean) => (
    <div
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(key)}
      onMouseLeave={() => setHover(null)}
      style={{
        ...NO_DRAG,
        width: 40,
        height: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        lineHeight: 1,
        color: danger ? '#f3e6dc' : T.dim,
        background: hover === key ? (danger ? T.danger : T.bg4) : 'transparent',
        cursor: 'default',
        transition: 'background .12s',
      }}
    >
      {icon}
    </div>
  );

  return (
    <div style={{ ...NO_DRAG, display: 'flex', alignItems: 'stretch', height: 30, marginLeft: 4 }}>
      {btn('min', '隐藏窗口', '─', () => void desk.window.minimize())}
      {btn('full', full ? '退出全屏' : '全屏', full ? '❐' : '□', () => {
        setFull((v) => !v);
        void desk.window.toggleFullscreen();
      })}
      {btn('close', '退出', '✕', () => void desk.window.close(), true)}
    </div>
  );
}

function SaveBadge() {
  const { saveState } = useEditor();
  const map = {
    idle: { text: '就绪', color: T.dimmer },
    saving: { text: '保存中…', color: T.accent },
    saved: { text: '已保存', color: T.ok },
    error: { text: '保存失败', color: T.danger },
  } as const;
  const it = map[saveState];
  return <span style={{ color: it.color }}>{it.text}</span>;
}
