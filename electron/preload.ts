import { contextBridge, ipcRenderer, webUtils } from 'electron';
import path from 'node:path';

import { CH } from '../src/shared/ipc';
import type {
  DeskBridge,
  DeskResult,
  ListOptions,
  MenuAction,
  MessageBoxOptions,
  OpenDialogOptions,
  ReadOptions,
  SaveDialogOptions,
  WatchEvent,
  WatchOptions,
  WriteOptions,
} from '../src/shared/ipc';

function invoke<T>(channel: string, ...args: unknown[]): Promise<DeskResult<T>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<DeskResult<T>>;
}

const bridge: DeskBridge = {
  env: {
    isDesktop: true,
    platform: process.platform,
    arch: process.arch,
    versions: {
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? '',
    },
  },

  path: {
    join: (...parts: string[]) => path.join(...parts),
    resolve: (...parts: string[]) => path.resolve(...parts),
    relative: (from: string, to: string) => path.relative(from, to),
    basename: (p: string, ext?: string) => path.basename(p, ext),
    dirname: (p: string) => path.dirname(p),
    extname: (p: string) => path.extname(p),
    normalize: (p: string) => path.normalize(p),
    toPosix: (p: string) => p.split(path.sep).join('/'),
    sep: path.sep,
  },

  // 用 ?p= 传绝对路径，规避盘符/空格/中文在 URL 中的转义问题
  toAssetUrl: (p: string) => `gameasset://local/?p=${encodeURIComponent(path.resolve(p))}`,

  fs: {
    readText: (p: string, opts?: ReadOptions) => invoke<string>(CH.fsReadText, p, opts),
    readJson: (p: string) => invoke<unknown>(CH.fsReadJson, p),
    writeText: (p: string, content: string, opts?: WriteOptions) =>
      invoke(CH.fsWriteText, p, content, opts),
    writeJson: (p: string, data: unknown, opts?: WriteOptions) =>
      invoke(CH.fsWriteJson, p, data, opts),
    exists: (p: string) => invoke<boolean>(CH.fsExists, p),
    stat: (p: string) => invoke(CH.fsStat, p),
    list: (p: string, opts?: ListOptions) => invoke(CH.fsList, p, opts),
    tree: (p: string, opts?: ListOptions) => invoke(CH.fsTree, p, opts),
    mkdirp: (p: string) => invoke<string>(CH.fsMkdirp, p),
    rename: (from: string, to: string) => invoke<string>(CH.fsRename, from, to),
    copy: (from: string, to: string) => invoke<string>(CH.fsCopy, from, to),
    remove: (p: string) => invoke<void>(CH.fsRemove, p),
    trash: (paths: string | string[]) => invoke<void>(CH.fsTrash, paths),
    readBinary: (p: string) => invoke(CH.fsReadBinary, p),
    writeBinary: (p: string, base64: string) => invoke(CH.fsWriteBinary, p, base64),
    hash: (p: string) => invoke<string>(CH.fsHash, p),
  },

  dialog: {
    open: (opts?: OpenDialogOptions) => invoke<string[]>(CH.dialogOpen, opts),
    save: (opts?: SaveDialogOptions) => invoke<string | null>(CH.dialogSave, opts),
    message: (opts: MessageBoxOptions) => invoke<number>(CH.dialogMessage, opts),
  },

  project: {
    get: () => invoke(CH.projectGet),
    open: (root: string) => invoke(CH.projectOpen, root),
    openDialog: () => invoke(CH.projectOpenDialog),
    close: () => invoke<void>(CH.projectClose),
    recent: () => invoke(CH.projectRecent),
    recentClear: () => invoke<void>(CH.projectRecentClear),
  },

  app: {
    info: () => invoke(CH.appInfo),
    paths: () => invoke(CH.appPaths),
    reveal: (p: string) => invoke<void>(CH.appReveal, p),
    openExternal: (url: string) => invoke<void>(CH.appOpenExternal, url),
    openInEditor: (p: string) => invoke<boolean>(CH.appOpenInEditor, p),
    restart: () => invoke<void>(CH.appRestart),
    quit: () => invoke<void>(CH.appQuit),
  },

  watch: {
    start: (root: string, opts?: WatchOptions) => invoke<string>(CH.watchStart, root, opts),
    stop: (id: string) => invoke<void>(CH.watchStop, id),
  },

  window: {
    minimize: () => invoke<void>(CH.winMinimize),
    maximize: () => invoke<void>(CH.winMaximize),
    close: () => invoke<void>(CH.winClose),
    isMaximized: () => invoke<boolean>(CH.winIsMaximized),
    setTitle: (title: string) => invoke<void>(CH.winSetTitle, title),
    toggleDevTools: () => invoke<void>(CH.winToggleDevTools),
    toggleFullscreen: () => invoke<void>(CH.winToggleFullscreen),
  },

  onWatchEvent: (cb: (ev: WatchEvent) => void) => {
    const listener = (_e: unknown, payload: WatchEvent | WatchEvent[]) => {
      if (Array.isArray(payload)) payload.forEach(cb);
      else cb(payload);
    };
    ipcRenderer.on(CH.watchEvent, listener);
    return () => ipcRenderer.off(CH.watchEvent, listener);
  },

  onMenuAction: (cb: (action: MenuAction) => void) => {
    const listener = (_e: unknown, action: MenuAction) => cb(action);
    ipcRenderer.on(CH.menuAction, listener);
    return () => ipcRenderer.off(CH.menuAction, listener);
  },

  onFileDrop: (cb: (paths: string[], pos: { x: number; y: number }) => void) => {
    dropListeners.add(cb);
    return () => {
      dropListeners.delete(cb);
    };
  },
};

/* ------------------------------------------------------------------ */
/* 拖拽文件：拿真实路径                                                */
/* Electron 32+ 已移除 File.path，必须用 webUtils.getPathForFile      */
/* ------------------------------------------------------------------ */

const dropListeners = new Set<(paths: string[], pos: { x: number; y: number }) => void>();

window.addEventListener(
  'dragover',
  (e) => {
    // 必须拦掉，否则 Electron 会把窗口导航到被拖入的文件
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  },
  true,
);

window.addEventListener(
  'drop',
  (e) => {
    e.preventDefault();
    const dt = e.dataTransfer;
    if (!dt) return;
    const files = Array.from(dt.files ?? []);
    if (files.length === 0) return;
    const paths = files
      .map((f) => {
        try {
          return webUtils.getPathForFile(f);
        } catch {
          return '';
        }
      })
      .filter(Boolean);
    if (paths.length === 0) return;
    const pos = { x: e.clientX, y: e.clientY };
    for (const cb of dropListeners) cb(paths, pos);
  },
  true,
);

contextBridge.exposeInMainWorld('desk', bridge);
