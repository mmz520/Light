/**
 * 独立编辑器窗口（真实 OS 窗口）里的界面。
 *
 * 外观和以前在主窗口里弹出的浮动窗口完全一致：同一条深色标题栏（圆点 + 标题 + 副标题 + ✕），
 * 只是标题栏加了 -webkit-app-region: drag，整块窗口由 Windows / macOS 管理，
 * 可以拖到第二块显示器、被系统贴边、单独最小化。
 *
 * 数据来自主窗口：挂载后向主进程申请初始快照，之后双向同步（见 useDocSync）。
 * 帮助窗口是唯一的例外：只读文档，不参与工程同步。
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { SKELETON_TEMPLATES, type ProjectDoc } from '../model/types';
import { editorStore, useEditor } from '../model/store';
import { useDocSync } from '../model/docSync';
import { desk, isDesktop } from '../../platform/desk';
import type { EditorWindowKind } from '../../shared/ipc';
import { AnimationWorkbench } from '../ui/AnimationWorkbench';
import { StateMachineWorkbench } from '../ui/StateMachineWorkbench';
import { ControllerWorkbench } from '../ui/ControllerWorkbench';
import { ScriptWorkbench } from '../ui/ScriptWorkbench';
import { ApiHelpWindow } from '../ui/ApiHelp';
import { T, FONT } from '../ui/theme';

const DRAG = { WebkitAppRegion: 'drag' } as CSSProperties;
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties;

/** 标题栏文字（和主窗口里浮动窗口用同一套规则） */
export function windowCaption(project: ProjectDoc | null, kind: EditorWindowKind, refId: string): { title: string; subtitle: string } {
  // 帮助窗口不依赖工程：没打开工程也能查 API
  if (kind === 'help') return { title: '脚本 API 参考', subtitle: '快速开始 · 属性面板 · 运行时 API' };
  if (!project) return { title: '编辑器', subtitle: '' };
  switch (kind) {
    case 'animation': {
      const a = project.animations.find((x) => x.id === refId);
      return {
        title: a?.name ?? '动画',
        subtitle: SKELETON_TEMPLATES.find((t) => t.id === a?.template)?.name ?? '',
      };
    }
    case 'controller':
      return { title: project.controllers.find((x) => x.id === refId)?.name ?? '控制器', subtitle: '变量 · 按键事件' };
    case 'script': {
      const s = project.scripts.find((x) => x.id === refId);
      return { title: s?.name ?? '脚本', subtitle: s?.kind === 'hook' ? '钩子脚本 · JS' : '组件脚本 · TS class' };
    }
    default:
      return { title: project.stateMachines.find((x) => x.id === refId)?.name ?? '状态机', subtitle: '流程图 · 状态 / 流转条件' };
  }
}

export function PopupWindow({ kind, refId }: { kind: EditorWindowKind; refId: string }) {
  // 帮助窗口完全不碰工程数据：不走 store、不做文档同步、不申请快照
  if (kind === 'help') return <HelpPopup refId={refId} />;
  return <ProjectPopup kind={kind} refId={refId} />;
}

/** 帮助窗口：只读文档 */
function HelpPopup({ refId }: { refId: string }) {
  useEffect(() => {
    if (isDesktop) void desk.window.setTitle('脚本 API 参考 — Light Editor');
  }, []);
  return (
    <Chrome
      title="脚本 API 参考"
      subtitle="快速开始 · 属性面板 · 运行时 API"
      onClose={() => void desk.editorWindow.close({ kind: 'help', refId })}
    >
      <ApiHelpWindow />
    </Chrome>
  );
}

function ProjectPopup({ kind, refId }: { kind: EditorWindowKind; refId: string }) {
  const state = useEditor();
  const project = state.project;
  const [waiting, setWaiting] = useState(true);
  useDocSync();

  // 调试/自动化句柄（和主窗口的 window.__editor 一致）
  useEffect(() => {
    (window as unknown as { __editor?: unknown }).__editor = editorStore;
  }, []);

  // 挂载后向主进程要初始快照
  useEffect(() => {
    let alive = true;
    const off = desk.editorWindow.onInit((payload) => {
      if (!alive) return;
      if (payload.kind !== kind || payload.refId !== refId) return;
      if (!payload.project) return;
      editorStore.bootFromSnapshot(payload.project as ProjectDoc);
      setWaiting(false);
    });
    void desk.editorWindow.ready({ kind, refId });
    return () => {
      alive = false;
      off();
    };
  }, [kind, refId]);

  // 窗口内的撤销 / 重做（各窗口有自己的历史，远端快照也会记一步）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'z') {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) editorStore.redo();
        else editorStore.undo();
      } else if (k === 'y') {
        if (typing) return;
        e.preventDefault();
        editorStore.redo();
      } else if (k === 's') {
        // 窗口副本不落盘，交给主窗口统一保存
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cap = windowCaption(project, kind, refId);
  // 标题栏跟随资源改名
  useEffect(() => {
    if (isDesktop) void desk.window.setTitle(`${cap.title} — Light Editor`);
  }, [cap.title]);

  if (waiting || !project) {
    return (
      <Chrome title={cap.title} subtitle={cap.subtitle} onClose={() => void desk.editorWindow.close({ kind, refId })}>
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.dimmer, fontSize: 12 }}>
          正在从主窗口同步工程…
        </div>
      </Chrome>
    );
  }

  return (
    <Chrome title={cap.title} subtitle={cap.subtitle} onClose={() => void desk.editorWindow.close({ kind, refId })}>
      {kind === 'animation' ? (
        <AnimationWorkbench animId={refId} />
      ) : kind === 'controller' ? (
        <ControllerWorkbench ctrlId={refId} />
      ) : kind === 'script' ? (
        <ScriptWorkbench scriptId={refId} />
      ) : (
        <StateMachineWorkbench smId={refId} />
      )}
    </Chrome>
  );
}

/** 真实的窗口外框：自绘标题栏（同时是系统拖拽区）+ 内容区 */
function Chrome({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg1, fontFamily: FONT, color: T.text }}>
      <div
        style={{
          ...DRAG,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 34,
          flexShrink: 0,
          padding: '0 6px 0 12px',
          background: T.bg3,
          borderBottom: `1px solid ${T.line}`,
          userSelect: 'none',
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.accent, flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{title}</span>
        {subtitle && <span style={{ fontSize: 11, color: T.dimmer, whiteSpace: 'nowrap' }}>{subtitle}</span>}
        <div style={{ flex: 1 }} />
        <button
          style={{ ...NO_DRAG, width: 24, height: 22, background: 'transparent', color: T.dim, border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
          onClick={onClose}
          title="关闭"
        >
          ✕
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>{children}</div>
    </div>
  );
}
