/**
 * 独立的编辑器窗口（真实 OS 窗口）。
 *
 * 以前动画 / 状态机 / 控制器 / 脚本编辑器都是主窗口里自绘的浮动 div，
 * 出不了主窗口，没法拖到第二块显示器。这里改成真正的 BrowserWindow：
 *
 *   - 外观不变：无系统边框，标题栏仍由渲染层自绘（沿用同一个浮动窗口头部样式），
 *     只是标题栏变成可拖拽区域（-webkit-app-region: drag）；
 *   - 状态同步：每个窗口都跑同一套 store，任何一边改动后把工程快照推给主进程，
 *     主进程中继给其它窗口（发送方不回灌），收到的一方直接替换文档且不回推，避免环路。
 *
 * 同一 kind + refId 只会有一个窗口，重复打开 = 聚焦。
 */
import { BrowserWindow, ipcMain, screen, shell } from 'electron';
import path from 'node:path';

import { CH } from '../../src/shared/ipc';
import type { EditorWindowInitPayload, EditorWindowOpenOptions, EditorWindowRef, DeskResult } from '../../src/shared/ipc';
import { handle, toErrorInfo } from '../lib/ipc';

interface Ctx {
  /** 主窗口（关掉它要连带关掉所有编辑器窗口） */
  getMain: () => BrowserWindow | null;
  /** 渲染层入口：dev 是 http URL，打包后是 dist/index.html 的绝对路径 */
  getEntry: () => { url?: string; file?: string };
}

interface Entry {
  win: BrowserWindow;
  ref: EditorWindowRef;
  /** 最近一次已知的工程快照；弹窗就绪时发给它 */
  doc: unknown;
  ready: boolean;
}

const windows = new Map<string, Entry>();
/** 每种编辑器窗口记住上次的位置尺寸，下次同一块屏幕同一处打开 */
const lastBounds = new Map<string, { x: number; y: number; width: number; height: number }>();
/** 主进程收到的最后一份工程快照（后开的窗口直接拿它当初始文档） */
let lastDoc: unknown = null;

let ctx: Ctx = { getMain: () => null, getEntry: () => ({}) };

const keyOf = (ref: EditorWindowRef) => `${ref.kind}:${ref.refId}`;

const isRef = (v: unknown): v is EditorWindowRef => {
  const r = v as EditorWindowRef | null;
  return !!r && typeof r.kind === 'string' && typeof r.refId === 'string';
};

/** 新窗口的初始位置：主窗口所在屏幕居中 + 按已开窗口数错开 */
function initialBounds(title: string): { x: number; y: number; width: number; height: number } {
  const saved = lastBounds.get(title);
  if (saved) return saved;
  const main = ctx.getMain();
  const w = 1100;
  const h = 760;
  if (!main || main.isDestroyed()) {
    const area = screen.getPrimaryDisplay().workArea;
    return { x: area.x + Math.round((area.width - w) / 2), y: area.y + Math.round((area.height - h) / 2), width: w, height: h };
  }
  const b = main.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  const step = windows.size * 28;
  const x = Math.min(Math.max(area.x + 40, b.x + 60 + step), area.x + area.width - w - 40);
  const y = Math.min(Math.max(area.y + 40, b.y + 60 + step), area.y + area.height - h - 40);
  return { x, y, width: w, height: h };
}

function loadInto(win: BrowserWindow, ref: EditorWindowRef): void {
  const entry = ctx.getEntry();
  if (entry.url) {
    const u = new URL(entry.url);
    u.searchParams.set('pop', ref.kind);
    u.searchParams.set('ref', ref.refId);
    win.loadURL(u.toString()).catch(() => undefined);
  } else if (entry.file) {
    win.loadFile(entry.file, { query: { pop: ref.kind, ref: ref.refId } }).catch(() => undefined);
  }
}

export function closeAll(): void {
  for (const [, entry] of windows) {
    if (!entry.win.isDestroyed()) entry.win.close();
  }
  windows.clear();
}

/** 换工程 / 主窗口关闭时调用：旧工程的窗口没有意义了 */
export function resetEditorWindows(): void {
  closeAll();
  lastDoc = null;
}

export function editorWindowCount(): number {
  return windows.size;
}

export function registerEditorWindowIpc(context: Ctx): void {
  ctx = context;

  handle(CH.editorWinOpen, (opts: EditorWindowOpenOptions) => {
    const ref: EditorWindowRef = { kind: opts.kind, refId: opts.refId };
    const hit = windows.get(keyOf(ref));
    if (hit && !hit.win.isDestroyed()) {
      hit.win.show();
      hit.win.focus();
      return ref;
    }

    const win = new BrowserWindow({
      ...initialBounds(opts.title),
      minWidth: 760,
      minHeight: 520,
      show: false,
      frame: false,
      thickFrame: true,
      backgroundColor: '#14110e',
      title: opts.title,
      autoHideMenuBar: true,
      webPreferences: {
        // 打包后本文件被编进 dist-electron/main.cjs，__dirname 就是 dist-electron
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: true,
        spellcheck: false,
      },
    });

    const entry: Entry = { win, ref, doc: opts.project ?? lastDoc, ready: false };
    windows.set(keyOf(ref), entry);

    win.once('ready-to-show', () => win.show());
    const remember = (): void => {
      if (!win.isDestroyed() && !win.isMaximized() && !win.isMinimized()) lastBounds.set(opts.title, win.getBounds());
    };
    win.on('resize', remember);
    win.on('move', remember);
    win.on('closed', () => {
      windows.delete(keyOf(ref));
      const m = ctx.getMain();
      if (m && !m.isDestroyed()) m.webContents.send(CH.editorWinClosed, ref);
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });

    loadInto(win, ref);
    return ref;
  });

  // 弹窗挂载完成：把当前工程快照发给它
  handle(CH.editorWinReady, (refRaw: EditorWindowRef) => {
    if (!isRef(refRaw)) return;
    const entry = windows.get(keyOf(refRaw));
    if (!entry || entry.win.isDestroyed()) return;
    entry.ready = true;
    const payload: EditorWindowInitPayload = { ...refRaw, project: entry.doc ?? lastDoc };
    entry.win.webContents.send(CH.editorWinInit, payload);
  });

  // 任何窗口改了工程 → 记下最新快照并转发给「其它」窗口（发送方不回灌，避免环路）
  ipcMain.handle(CH.editorWinDoc, async (e, project: unknown): Promise<DeskResult<void>> => {
    try {
      lastDoc = project;
      for (const [, entry] of windows) {
        if (entry.win.isDestroyed()) continue;
        entry.doc = project;
        if (entry.win.webContents.id === e.sender.id) continue;
        if (entry.ready) entry.win.webContents.send(CH.editorWinDoc, project);
      }
      const main = ctx.getMain();
      if (main && !main.isDestroyed() && main.webContents.id !== e.sender.id) {
        main.webContents.send(CH.editorWinDoc, project);
      }
      return { ok: true, data: undefined };
    } catch (err) {
      return { ok: false, error: toErrorInfo(err) };
    }
  });

  handle(CH.editorWinClose, (refRaw?: EditorWindowRef) => {
    if (refRaw && isRef(refRaw)) {
      const entry = windows.get(keyOf(refRaw));
      if (entry && !entry.win.isDestroyed()) entry.win.close();
      return;
    }
    closeAll();
  });

  handle(CH.editorWinCloseAll, () => {
    closeAll();
  });
}
