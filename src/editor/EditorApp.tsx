/**
 * 编辑器外壳：菜单栏 + 四区布局（层级 / 预览 / 属性 / 资源浏览器）+ 浮动动画窗口
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { desk, isDesktop } from '../platform/desk';
import { editorStore, useEditor, type Selection } from './model/store';
import { preloadComponents } from '../runtime/scriptRegistry';
import { useDocSync } from './model/docSync';
import { windowCaption } from './popup/PopupWindow';
import { sceneKindMeta, scriptFileOf, type AssetRef, type ImageAsset, type ProjectDoc, type SceneNode } from './model/types';
import { AnimationWorkbench } from './ui/AnimationWorkbench';
import { StateMachineWorkbench } from './ui/StateMachineWorkbench';
import { ControllerWorkbench } from './ui/ControllerWorkbench';
import { ScriptWorkbench } from './ui/ScriptWorkbench';
import { ApiHelpWindow } from './ui/ApiHelp';
import type { EditorWindowKind } from '../shared/ipc';
import { AssetBrowser } from './ui/AssetBrowser';
import { CropDialog } from './ui/CropDialog';
import { Code, ConfirmDialog, InfoDialog, PromptDialog } from './ui/Dialogs';
import { FloatingWindow, type WinRect } from './ui/FloatingWindow';
import { Hierarchy } from './ui/Hierarchy';
import { Inspector, SceneInspector } from './ui/Inspector';
import { MenuBar, type MenuActions } from './ui/MenuBar';
import { SceneView } from './ui/SceneView';
import { NewProjectDialog, Welcome } from './ui/Welcome';
import { T, FONT } from './ui/theme';

interface EditorWin {
  id: string;
  kind: EditorWindowKind;
  refId: string;
  rect: WinRect;
  z: number;
}

/** 桌面版默认用真实 OS 窗口；浏览器版 / 自检模式（?inline-windows=1）用页内浮窗 */
const INLINE_WINDOWS =
  !isDesktop || new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).has('inline-windows');

export function EditorApp() {
  const state = useEditor();
  useDocSync();
  const [leftW, setLeftW] = useState(224);
  const [rightW, setRightW] = useState(306);
  const [bottomH, setBottomH] = useState(226);
  const [panels, setPanels] = useState({ left: true, right: true, bottom: true });

  const [windows, setWindows] = useState<EditorWin[]>([]);
  const zRef = useRef(20);
  const [newProject, setNewProject] = useState(false);
  const [rename, setRename] = useState<{ kind: Selection['kind']; id: string; name: string } | null>(null);
  const [sceneRename, setSceneRename] = useState<SceneNode | null>(null);
  const [confirm, setConfirm] = useState<{ kind: Selection['kind']; id: string; name: string } | null>(null);
  const [confirmMany, setConfirmMany] = useState<AssetRef[] | null>(null);
  const [cropping, setCropping] = useState<ImageAsset | null>(null);
  const [about, setAbout] = useState(false);
  const [structure, setStructure] = useState(false);

  const projectRoot = state.project?.root ?? null;

  useEffect(() => {
    void editorStore.boot();
  }, []);

  // 预设组件脚本：打开工程后确保它们存在，并给还没有组件的老节点挂上默认组件（幂等）。
  // 注意：必须放在所有提前 return（booting / welcome）之前 —— hooks 不能在条件分支后面，
  // 否则首帧 booting 提前 return 后 hooks 数量变化，React 直接崩掉整棵树（白屏，React #310）。
  const componentSig = (state.project?.scripts ?? [])
    .filter((sc) => sc.kind !== 'hook')
    .map((sc) => `${sc.id}:${sc.code.length}`)
    .join(',');
  useEffect(() => {
    editorStore.ensurePresetComponents();
  }, [projectRoot]);
  useEffect(() => {
    if (!projectRoot) return;
    void preloadComponents((state.project?.scripts ?? []).filter((sc) => sc.kind !== 'hook'));
    // componentSig 变了说明有脚本新建/改码，重新编译（loadComponent 内部按源码缓存）
  }, [componentSig, projectRoot]);

  /* 真实窗口：关掉一个就同步窗口计数；换工程则整批关掉 */
  useEffect(() => {
    if (INLINE_WINDOWS) return;
    return desk.editorWindow.onClosed((ref) => {
      setWindows((ws) => ws.filter((w) => !(w.kind === ref.kind && w.refId === ref.refId)));
    });
  }, []);
  useEffect(() => {
    if (INLINE_WINDOWS) return;
    setWindows([]);
    void desk.editorWindow.closeAll();
  }, [projectRoot]);

  /* 主进程菜单 → 界面 */
  useEffect(() => {
    if (!isDesktop) return;
    return desk.onMenuAction((action) => {
      if (action === 'menu:open-project') void editorStore.openProjectDialog();
      if (action === 'menu:save') void editorStore.saveNow();
    });
  }, []);

  const openWindow = useCallback((kind: EditorWin['kind'], refId: string) => {
    if (!INLINE_WINDOWS) {
      const cap = windowCaption(editorStore.project, kind, refId);
      void desk.editorWindow
        .open({
          kind,
          refId,
          title: cap.title,
          subtitle: cap.subtitle,
          project: editorStore.project ?? undefined,
        })
        .catch(() => undefined);
      // 只记一份引用，用来算窗口数量 / 统一关闭；真正的窗口在主进程
      setWindows((ws) => (ws.some((w) => w.kind === kind && w.refId === refId) ? ws : [...ws, { id: `${kind}:${refId}`, kind, refId, rect: { x: 0, y: 0, w: 0, h: 0 }, z: 0 }]));
      return;
    }
    setWindows((ws) => {
      const z = ++zRef.current;
      const hit = ws.find((w) => w.kind === kind && w.refId === refId);
      if (hit) return ws.map((w) => (w.kind === kind && w.refId === refId ? { ...w, z } : w));
      const idx = ws.length;
      const w = Math.min(1180, Math.max(820, window.innerWidth - 160));
      const h = Math.min(780, Math.max(560, window.innerHeight - 180));
      return [
        ...ws,
        {
          id: `${refId}-${Date.now()}`,
          kind,
          refId,
          z,
          rect: {
            x: Math.max(24, Math.round((window.innerWidth - w) / 2) + idx * 26),
            y: Math.max(40, Math.round((window.innerHeight - h) / 2) + idx * 24),
            w,
            h,
          },
        },
      ];
    });
  }, []);

  const openAnimation = useCallback((animId: string) => openWindow('animation', animId), [openWindow]);
  const openStateMachine = useCallback((smId: string) => openWindow('statemachine', smId), [openWindow]);
  const openController = useCallback((ctrlId: string) => openWindow('controller', ctrlId), [openWindow]);
  const openScript = useCallback((scriptId: string) => openWindow('script', scriptId), [openWindow]);
  /** 帮助 → 脚本 API 参考：只读文档窗口，不需要工程快照 */
  const openApiHelp = useCallback(() => openWindow('help', 'script-api'), [openWindow]);

  /* F1：任何时候都能打开脚本 API 文档（欢迎页也可以） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F1') return;
      e.preventDefault();
      openApiHelp();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openApiHelp]);

  /** 双击脚本资产：桌面端用 VS Code（退回系统默认编辑器）打开源码文件；拉不起来就回内置编辑器 */
  const openScriptExternal = useCallback(
    async (scriptId: string) => {
      const p = editorStore.project;
      const s = p?.scripts.find((x) => x.id === scriptId);
      if (!p || !s) return;
      if (isDesktop) {
        try {
          const viaCode = await desk.app.openInEditor(desk.path.join(p.root, scriptFileOf(p.scripts, s)));
          if (viaCode) return;
        } catch {
          /* 打开失败，落到内置编辑器 */
        }
      }
      openScript(scriptId);
    },
    [openScript],
  );

  /* VS Code 侧保存脚本后回灌：监听 assets/scripts 目录，内容变了就读回来 */
  useEffect(() => {
    if (!isDesktop || !projectRoot) return;
    let stopped = false;
    let watchId: string | null = null;
    let unsub: (() => void) | null = null;
    void (async () => {
      const dir = desk.path.join(projectRoot, 'assets', 'scripts');
      try {
        await desk.fs.mkdirp(dir);
        watchId = await desk.watch.start(dir, { extensions: ['js'], debounce: 200 });
      } catch {
        return;
      }
      if (stopped || !watchId) return;
      unsub = desk.watch.onChange((ev) => {
        if (ev.watchId !== watchId || ev.type === 'unlink') return;
        const p = editorStore.project;
        if (!p) return;
        const fileRel = 'assets/scripts/' + (ev.rel ? ev.rel.split('\\').join('/') : '');
        const s = p.scripts.find((x) => scriptFileOf(p.scripts, x) === fileRel);
        if (!s) return;
        void (async () => {
          try {
            const code = await desk.fs.readText(desk.path.join(projectRoot, fileRel));
            if (code !== s.code) {
              editorStore.mutateScript(s.id, (x) => {
                x.code = code;
              }, `script-ext:${s.id}`);
            }
          } catch {
            /* 文件刚被删等瞬态错误忽略 */
          }
        })();
      });
    })();
    return () => {
      stopped = true;
      unsub?.();
      if (watchId) void desk.watch.stop(watchId).catch(() => {});
    };
  }, [projectRoot]);

  /* 自动化/调试句柄：脚本可以驱动创建工程、打开动画窗口 */
  useEffect(() => {
    const w = window as unknown as { __editor?: unknown; __editorUi?: unknown };
    w.__editor = editorStore;
    w.__editorUi = {
      openAnimation,
      openStateMachine,
      openController,
      openScript,
      closeWindows: () => {
        setWindows([]);
        if (!INLINE_WINDOWS) void desk.editorWindow.closeAll();
      },
      select: (kind: string, id: string) => editorStore.select(kind as Selection['kind'], id),
      selectScene: (id: string | null) => editorStore.selectScene(id),
      setPanels,
    };
  }, [openAnimation, openStateMachine, openController, openScript]);

  /* 快捷键 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        void editorStore.saveNow();
        return;
      }
      if (mod && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        void editorStore.openProjectDialog();
        return;
      }
      if (typing) return;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) editorStore.redo();
        else editorStore.undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        editorStore.redo();
        return;
      }
      // 场景对象：Del / Ctrl+C / Ctrl+V / Ctrl+D / F2
      const sceneId = state.sceneSelection;
      if (mod && (e.key === 'c' || e.key === 'C') && sceneId) {
        e.preventDefault();
        editorStore.copySceneNode(sceneId);
        return;
      }
      if (mod && (e.key === 'v' || e.key === 'V') && (sceneId || state.sceneClipboard)) {
        e.preventDefault();
        editorStore.pasteSceneNode();
        return;
      }
      if (mod && (e.key === 'd' || e.key === 'D') && sceneId) {
        e.preventDefault();
        editorStore.duplicateSceneNode(sceneId);
        return;
      }
      if (e.key === 'F2' && sceneId) {
        e.preventDefault();
        const node = editorStore.sceneNode(sceneId);
        if (node) setSceneRename(node);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sceneId) {
        e.preventDefault();
        editorStore.deleteSceneNode(sceneId);
        return;
      }
      if (e.key === 'F2' && state.selection) {
        e.preventDefault();
        const name = selectedName();
        if (name) setRename({ kind: state.selection.kind, id: state.selection.id, name });
      }
      if (e.key === 'Delete' && state.selection) {
        e.preventDefault();
        const name = selectedName();
        if (name) setConfirm({ kind: state.selection.kind, id: state.selection.id, name });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.selection, state.sceneSelection, state.sceneClipboard, state.project]);

  function selectedName(): string | null {
    const p = state.project;
    const sel = state.selection;
    if (!p || !sel) return null;
    const list =
      sel.kind === 'image'
        ? p.images
        : sel.kind === 'texture'
          ? p.textures
          : sel.kind === 'animation'
            ? p.animations
            : sel.kind === 'controller'
              ? p.controllers
              : sel.kind === 'script'
                ? p.scripts
                : p.stateMachines;
    return list.find((x) => x.id === sel.id)?.name ?? null;
  }

  /* 页内浮窗层（桌面版走真实窗口；欢迎页只可能开帮助窗口） */
  const floating = INLINE_WINDOWS ? (
    <FloatingWindows
      windows={windows}
      project={state.project}
      onRectChange={(id, rect) => setWindows((ws) => ws.map((x) => (x.id === id ? { ...x, rect } : x)))}
      onClose={(id) => setWindows((ws) => ws.filter((x) => x.id !== id))}
      onFocus={(id) => {
        const z = ++zRef.current;
        setWindows((ws) => ws.map((x) => (x.id === id ? { ...x, z } : x)));
      }}
      onOpenDocs={openApiHelp}
    />
  ) : null;

  const actions: MenuActions = {
    openProject: () => void editorStore.openProjectDialog(),
    newProject: () => setNewProject(true),
    importImages: () => void editorStore.importImagesDialog(),
    save: () => void editorStore.saveNow(),
    closeProject: () => void editorStore.closeProject(),
    quit: () => void desk.app.quit(),
    undo: () => editorStore.undo(),
    redo: () => editorStore.redo(),
    renameSelected: () => {
      const name = selectedName();
      if (state.selection && name) setRename({ kind: state.selection.kind, id: state.selection.id, name });
    },
    deleteSelected: () => {
      const name = selectedName();
      if (state.selection && name) setConfirm({ kind: state.selection.kind, id: state.selection.id, name });
    },
    togglePanel: (p) => setPanels((v) => ({ ...v, [p]: !v[p] })),
    reload: () => window.location.reload(),
    devTools: () => void desk.window.toggleDevTools(),
    closeAllWindows: () => {
      setWindows([]);
      if (!INLINE_WINDOWS) void desk.editorWindow.closeAll();
    },
    showAbout: () => setAbout(true),
    showStructure: () => setStructure(true),
    showApiHelp: () => openApiHelp(),
  };

  /* ---------------- 首屏 ---------------- */

  if (state.status === 'booting') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.bg0, color: T.dimmer, fontFamily: FONT, fontSize: 12.5 }}>
        {state.busy ?? '正在启动…'}
      </div>
    );
  }

  if (state.status === 'welcome' || !state.project) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.bg0 }}>
        <MenuBar actions={actions} panels={panels} windowCount={windows.length} />
        <div style={{ flex: 1, minHeight: 0 }}>
          <Welcome />
        </div>
        {floating}
        {newProject && <NewProjectDialog onClose={() => setNewProject(false)} />}
        {confirmMany && (
        <ConfirmDialog
          title="删除资源"
          danger
          confirmText="删除"
          message={
            <>
              将从工程里移除选中的 {confirmMany.length} 个资源。
              <br />
              文件会被移到系统回收站；被其它资产引用的会跳过并提示。
            </>
          }
          onCancel={() => setConfirmMany(null)}
          onConfirm={() => {
            void (async () => {
              for (const ref of confirmMany) await editorStore.deleteAsset(ref.kind, ref.id);
            })();
            setConfirmMany(null);
          }}
        />
      )}
      {about && <AboutDialog onClose={() => setAbout(false)} />}
      </div>
    );
  }

  const project = state.project;
  const sceneNode = project.scene.find((n) => n.id === state.sceneSelection) ?? null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.bg0, color: T.text, fontFamily: FONT, overflow: 'hidden' }}>
      <MenuBar actions={actions} panels={panels} windowCount={windows.length} />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {panels.left && (
          <>
            <div style={{ width: leftW, flexShrink: 0, borderRight: `1px solid ${T.lineSoft}`, minHeight: 0 }}>
              <Hierarchy project={project} onRenameScene={setSceneRename} />
            </div>
            <VSplitter onDelta={(dx) => setLeftW((w) => clamp(w + dx, 180, 380))} />
          </>
        )}

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: T.bg0 }}>
          <SceneView project={project} selectedId={state.sceneSelection} onRenameScene={setSceneRename} />
        </div>

        {panels.right && (
          <>
            <VSplitter onDelta={(dx) => setRightW((w) => clamp(w - dx, 260, 480))} />
            <div
              style={{
                width: rightW,
                flexShrink: 0,
                background: T.bg1,
                borderLeft: `1px solid ${T.line}`,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
              }}
            >
              <PanelHeader
                title="属性"
                note={
                  sceneNode
                    ? sceneKindMeta(sceneNode.kind).name
                    : state.selection
                      ? selectionKindName(state.selection.kind)
                      : '未选中'
                }
              />
              <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                {sceneNode ? (
                  <SceneInspector project={project} node={sceneNode} onOpenScript={openScript} />
                ) : (
                  <Inspector
                    project={project}
                    selection={state.selection}
                    onCropImage={(img) => setCropping(img)}
                    onOpenAnimation={openAnimation}
                    onOpenStateMachine={openStateMachine}
                    onOpenController={openController}
                    onOpenScript={openScript}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {panels.bottom && (
        <>
          <HSplitter onDelta={(dy) => setBottomH((h) => clamp(h - dy, 130, 440))} />
          <div style={{ height: bottomH, flexShrink: 0, borderTop: `1px solid ${T.line}`, background: T.bg1, minHeight: 0 }}>
            <AssetBrowser
              project={project}
              selection={state.selection}
              onSelect={(kind, id) => editorStore.select(kind, id)}
              onOpenAnimation={openAnimation}
              onOpenStateMachine={openStateMachine}
              onOpenController={openController}
              onOpenScript={openScript}
              onOpenScriptInVscode={(id) => void openScriptExternal(id)}
              onAddStateMachine={(folder) => editorStore.addStateMachine(folder)}
              onAddController={(folder) => editorStore.addController(folder)}
              onAddScript={(folder) => editorStore.addScript(folder)}
              onAddTexture={(tpl, folder) => editorStore.addTexture(tpl, folder)}
              onAddAnimation={(tpl, folder) => editorStore.addAnimation(tpl, folder)}
              onAddAnimationFrom={(id, folder) => editorStore.addAnimationFrom(id, folder)}
              onImportImages={(folder) => void editorStore.importImagesDialog(folder)}
              onAddFolder={(parent, name) => editorStore.addFolder(parent, name)}
              onRenameFolder={(path, name) => editorStore.renameFolder(path, name)}
              onDeleteFolder={(path) => void editorStore.deleteFolder(path)}
              onMoveAssets={(refs, folder) => void editorStore.moveAssets(refs, folder)}
              onRename={(kind, id, name) => setRename({ kind, id, name })}
              onDelete={(kind, id) => setConfirm({ kind, id, name: '' })}
              onDeleteMany={(refs) => setConfirmMany(refs)}
              onCropImage={(id) => {
                const img = project.images.find((i) => i.id === id);
                if (img) setCropping(img);
              }}
            />
          </div>
        </>
      )}

      {/* 浮动编辑窗口：动画 / 状态机 / 控制器 / 脚本 / 帮助（页内模式；桌面版是真实窗口） */}
      {floating}

      {/* 弹窗 */}
      {newProject && <NewProjectDialog onClose={() => setNewProject(false)} />}
      {cropping && (
        <CropDialog
          project={project}
          image={cropping}
          onConfirm={(crop) => editorStore.updateImage(cropping.id, { crop })}
          onBake={(crop) => void editorStore.bakeCrop(cropping.id, crop)}
          onClose={() => setCropping(null)}
        />
      )}
      {rename && (
        <PromptDialog
          title="重命名资源"
          label="名称"
          defaultValue={rename.name}
          onCancel={() => setRename(null)}
          onSubmit={(v) => {
            editorStore.renameAsset(rename.kind, rename.id, v);
            setRename(null);
          }}
        />
      )}
      {sceneRename && (
        <PromptDialog
          title={`重命名${sceneKindMeta(sceneRename.kind).name}`}
          label="名称"
          defaultValue={sceneRename.name}
          onCancel={() => setSceneRename(null)}
          onSubmit={(v) => {
            editorStore.renameSceneNode(sceneRename.id, v);
            setSceneRename(null);
          }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title="删除资源"
          danger
          confirmText="删除"
          message={
            <>
              将从工程里移除「{confirm.name || confirm.id}」。
              <br />
              文件会被移到系统回收站，metadata.json 同步更新。
            </>
          }
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            void editorStore.deleteAsset(confirm.kind, confirm.id);
            setConfirm(null);
          }}
        />
      )}
      {confirmMany && (
        <ConfirmDialog
          title="删除资源"
          danger
          confirmText="删除"
          message={
            <>
              将从工程里移除选中的 {confirmMany.length} 个资源。
              <br />
              文件会被移到系统回收站；被其它资产引用的会跳过并提示。
            </>
          }
          onCancel={() => setConfirmMany(null)}
          onConfirm={() => {
            void (async () => {
              for (const ref of confirmMany) await editorStore.deleteAsset(ref.kind, ref.id);
            })();
            setConfirmMany(null);
          }}
        />
      )}
      {about && <AboutDialog onClose={() => setAbout(false)} />}
      {structure && <StructureDialog onClose={() => setStructure(false)} />}
      <ErrorToast />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 面板标题栏                                                          */
/* ------------------------------------------------------------------ */

function PanelHeader({ title, note }: { title: string; note?: string }) {
  return (
    <div
      style={{
        height: 30,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 10px',
        borderBottom: `1px solid ${T.lineSoft}`,
        background: T.bg2,
      }}
    >
      <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: T.dimmer }}>{title}</span>
      {note && <span style={{ fontSize: 10.5, color: T.dimmer }}>· {note}</span>}
    </div>
  );
}

function selectionKindName(kind: Selection['kind']): string {
  return kind === 'image' ? '图片' : kind === 'texture' ? '贴图' : kind === 'animation' ? '动画' : kind === 'controller' ? '控制器' : kind === 'script' ? '脚本' : '状态机';
}

/* ------------------------------------------------------------------ */
/* 拖拽分割条                                                          */
/* ------------------------------------------------------------------ */

function VSplitter({ onDelta }: { onDelta: (dx: number) => void }) {
  const [active, setActive] = useState(false);
  const last = useRef(0);
  return (
    <div
      onPointerDown={(e) => {
        e.preventDefault();
        last.current = e.clientX;
        setActive(true);
        const move = (ev: PointerEvent) => {
          onDelta(ev.clientX - last.current);
          last.current = ev.clientX;
        };
        const up = () => {
          setActive(false);
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
      style={{ width: 5, flexShrink: 0, cursor: 'col-resize', background: active ? T.accent : 'transparent' }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = T.line;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    />
  );
}

function HSplitter({ onDelta }: { onDelta: (dy: number) => void }) {
  const [active, setActive] = useState(false);
  const last = useRef(0);
  return (
    <div
      onPointerDown={(e) => {
        e.preventDefault();
        last.current = e.clientY;
        setActive(true);
        const move = (ev: PointerEvent) => {
          onDelta(ev.clientY - last.current);
          last.current = ev.clientY;
        };
        const up = () => {
          setActive(false);
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
      style={{ height: 5, flexShrink: 0, cursor: 'row-resize', background: active ? T.accent : 'transparent' }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = T.line;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    />
  );
}

/* ------------------------------------------------------------------ */

function ErrorToast() {
  const { error } = useEditor();
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => editorStore.clearError(), 7000);
    return () => clearTimeout(t);
  }, [error]);
  if (!error) return null;
  return (
    <div
      onClick={() => editorStore.clearError()}
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        maxWidth: 420,
        background: T.bg3,
        border: `1px solid ${T.danger}`,
        borderRadius: 5,
        padding: '10px 12px',
        color: T.text,
        fontSize: 12,
        boxShadow: '0 10px 30px rgba(0,0,0,.6)',
        zIndex: 9998,
        cursor: 'pointer',
        lineHeight: 1.6,
      }}
    >
      {error}
    </div>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <InfoDialog title="关于 Light Editor" onClose={onClose}>
      <div style={{ fontSize: 13, color: T.text, marginBottom: 8 }}>Light Editor · v0.2</div>
      类饥荒生存游戏的编辑器：图片 / 贴图 / 动画三层资产，全部以 JSON 存在你选择的工程文件夹里。
      <br />
      桌面端基于 Electron，读写本地文件；动画编辑器以浮动窗口形式打开，可同时编辑多条动画。
    </InfoDialog>
  );
}

function StructureDialog({ onClose }: { onClose: () => void }) {
  return (
    <InfoDialog title="工程文件结构" onClose={onClose} width={620}>
      一个工程 = 一个文件夹，文件位置固定，根目录的 metadata.json 是唯一索引。
      <Code>{`<工程根目录>/
  metadata.json                 # 索引：工程信息 + 全部资产清单
  assets/
    images/<id>.png             # 图片本体（导入时复制进来）
    textures/<id>.json          # 贴图：引用 1 张（单向）或 4 张（四向）图片
    animations/<id>.json        # 动画：骨架 + 节点贴图绑定 + 关键帧`}</Code>
      映射关系不是一一对应：一张贴图引用 1–4 张图片；一条动画引用若干张贴图（每个节点一张主贴图，可再加覆盖物）。
      <br />
      删除资源时只动对应的 json/png，并把条目从 metadata.json 里去掉。
    </InfoDialog>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * 页内浮窗层（浏览器模式 / 自检模式）。
 * 桌面版这里是真实 OS 窗口，由主进程管理；两边外观与内容一致。
 */
function FloatingWindows({
  windows,
  project,
  onRectChange,
  onClose,
  onFocus,
  onOpenDocs,
}: {
  windows: EditorWin[];
  project: ProjectDoc | null;
  onRectChange: (id: string, rect: WinRect) => void;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  onOpenDocs: () => void;
}) {
  return (
    <>
      {windows.map((w) => {
        const cap =
          w.kind === 'help'
            ? { title: '脚本 API 参考', subtitle: '快速开始 · 属性面板 · 运行时 API' }
            : project
              ? windowCaption(project, w.kind, w.refId)
              : { title: '编辑器', subtitle: '' };
        return (
          <FloatingWindow
            key={w.id}
            title={cap.title}
            subtitle={cap.subtitle}
            rect={w.rect}
            zIndex={w.z}
            onRectChange={(rect) => onRectChange(w.id, rect)}
            onClose={() => onClose(w.id)}
            onFocus={() => onFocus(w.id)}
          >
            {w.kind === 'help' ? (
              <ApiHelpWindow />
            ) : !project ? null : w.kind === 'animation' ? (
              <AnimationWorkbench animId={w.refId} />
            ) : w.kind === 'controller' ? (
              <ControllerWorkbench ctrlId={w.refId} />
            ) : w.kind === 'script' ? (
              <ScriptWorkbench scriptId={w.refId} onOpenDocs={onOpenDocs} />
            ) : (
              <StateMachineWorkbench smId={w.refId} />
            )}
          </FloatingWindow>
        );
      })}
    </>
  );
}
