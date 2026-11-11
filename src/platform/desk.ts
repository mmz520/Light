/**
 * 渲染进程访问本地能力的统一入口。
 *
 * - Electron 下：window.desk 由 preload 注入，直接透传。
 * - 浏览器下：只有只读能力（fetch /content 下的 JSON），写操作抛 DeskError，
 *   以便 `npm run dev:web` 仍能看图调动画。
 *
 * 业务代码只 import { desk } from '@/platform/desk'，不要直接摸 window.desk。
 */
import type {
  AppInfo,
  AppPaths,
  BinaryResult,
  DeskApi,
  DeskBridge,
  DeskResult,
  FileEntry,
  FileStat,
  ListOptions,
  MenuAction,
  MessageBoxOptions,
  OpenDialogOptions,
  ProjectInfo,
  ReadOptions,
  RecentProject,
  SaveDialogOptions,
  TreeNode,
  WatchEvent,
  WatchOptions,
  WriteOptions,
  WriteResult,
} from '../shared/ipc';

declare global {
  interface Window {
    desk?: DeskBridge;
  }
}

export class DeskError extends Error {
  readonly code: string;
  readonly path?: string;

  constructor(info: { code: string; message: string; path?: string }) {
    super(info.message);
    this.name = 'DeskError';
    this.code = info.code;
    this.path = info.path;
  }
}

const bridge: DeskBridge | undefined = typeof window !== 'undefined' ? window.desk : undefined;

export const isDesktop = Boolean(bridge);

function unwrap<T>(res: DeskResult<T>): T {
  if (res && res.ok) return res.data;
  throw new DeskError(res?.error ?? { code: 'EUNKNOWN', message: '未知的桌面端错误' });
}

function desktopOnly(what: string): DeskError {
  return new DeskError({
    code: 'EWEBONLY',
    message: `「${what}」需要桌面版（Electron）。请用 npm run dev 启动。`,
  });
}

/** 浏览器模式下把绝对/相对路径折成 public 下的 URL */
function webUrl(p: string): string {
  let s = p.split('\\').join('/');
  const idx = s.indexOf('/public/');
  if (idx >= 0) s = s.slice(idx + '/public'.length);
  if (!s.startsWith('/')) s = `/${s}`;
  return s;
}

async function fetchText(p: string): Promise<string> {
  const res = await fetch(webUrl(p));
  if (!res.ok) throw new DeskError({ code: `HTTP${res.status}`, message: `读取失败：${p}`, path: p });
  return res.text();
}

const webPath: DeskApi['path'] = {
  join: (...parts: string[]) => parts.join('/').replace(/\/{2,}/g, '/'),
  resolve: (...parts: string[]) => webUrl(parts.join('/')),
  relative: (from: string, to: string) => to.replace(from, '').replace(/^\/+/, ''),
  basename: (p: string) => p.split(/[\\/]/).pop() ?? p,
  dirname: (p: string) => p.split(/[\\/]/).slice(0, -1).join('/') || '.',
  extname: (p: string) => {
    const base = p.split(/[\\/]/).pop() ?? '';
    const i = base.lastIndexOf('.');
    return i <= 0 ? '' : base.slice(i);
  },
  normalize: (p: string) => p.replace(/\/{2,}/g, '/'),
  toPosix: (p: string) => p.split('\\').join('/'),
  sep: '/',
};

const fsApi: DeskApi['fs'] = {
  readText: async (p: string, opts?: ReadOptions) => {
    if (!bridge) return fetchText(p);
    return unwrap(await bridge.fs.readText(p, opts));
  },
  readJson: async <T = unknown>(p: string) => {
    if (!bridge) return JSON.parse(await fetchText(p)) as T;
    return unwrap(await bridge.fs.readJson(p)) as T;
  },
  writeText: async (p: string, content: string, opts?: WriteOptions): Promise<WriteResult> => {
    if (!bridge) throw desktopOnly('写入文件');
    return unwrap(await bridge.fs.writeText(p, content, opts));
  },
  writeJson: async (p: string, data: unknown, opts?: WriteOptions): Promise<WriteResult> => {
    if (!bridge) throw desktopOnly('写入 JSON');
    return unwrap(await bridge.fs.writeJson(p, data, opts));
  },
  exists: async (p: string): Promise<boolean> => {
    if (!bridge) {
      try {
        return (await fetch(webUrl(p))).ok;
      } catch {
        return false;
      }
    }
    return unwrap(await bridge.fs.exists(p));
  },
  stat: async (p: string): Promise<FileStat | null> => {
    if (!bridge) return null;
    return unwrap(await bridge.fs.stat(p));
  },
  list: async (p: string, opts?: ListOptions): Promise<FileEntry[]> => {
    if (!bridge) throw desktopOnly('遍历文件夹');
    return unwrap(await bridge.fs.list(p, opts));
  },
  tree: async (p: string, opts?: ListOptions): Promise<TreeNode> => {
    if (!bridge) throw desktopOnly('读取目录树');
    return unwrap(await bridge.fs.tree(p, opts));
  },
  mkdirp: async (p: string): Promise<string> => {
    if (!bridge) throw desktopOnly('创建文件夹');
    return unwrap(await bridge.fs.mkdirp(p));
  },
  rename: async (from: string, to: string): Promise<string> => {
    if (!bridge) throw desktopOnly('重命名');
    return unwrap(await bridge.fs.rename(from, to));
  },
  copy: async (from: string, to: string): Promise<string> => {
    if (!bridge) throw desktopOnly('复制文件');
    return unwrap(await bridge.fs.copy(from, to));
  },
  remove: async (p: string): Promise<void> => {
    if (!bridge) throw desktopOnly('删除文件');
    return unwrap(await bridge.fs.remove(p));
  },
  trash: async (paths: string | string[]): Promise<void> => {
    if (!bridge) throw desktopOnly('移入回收站');
    return unwrap(await bridge.fs.trash(paths));
  },
  readBinary: async (p: string): Promise<BinaryResult> => {
    if (!bridge) throw desktopOnly('读取二进制');
    return unwrap(await bridge.fs.readBinary(p));
  },
  writeBinary: async (p: string, base64: string): Promise<WriteResult> => {
    if (!bridge) throw desktopOnly('写入二进制');
    return unwrap(await bridge.fs.writeBinary(p, base64));
  },
  hash: async (p: string): Promise<string> => {
    if (!bridge) throw desktopOnly('计算文件哈希');
    return unwrap(await bridge.fs.hash(p));
  },
};

const dialogApi: DeskApi['dialog'] = {
  open: async (opts?: OpenDialogOptions): Promise<string[]> => {
    if (!bridge) throw desktopOnly('文件选择对话框');
    return unwrap(await bridge.dialog.open(opts));
  },
  save: async (opts?: SaveDialogOptions): Promise<string | null> => {
    if (!bridge) throw desktopOnly('保存对话框');
    return unwrap(await bridge.dialog.save(opts));
  },
  message: async (opts: MessageBoxOptions): Promise<number> => {
    if (!bridge) throw desktopOnly('原生消息框');
    return unwrap(await bridge.dialog.message(opts));
  },
};

const projectApi: DeskApi['project'] = {
  get: async (): Promise<ProjectInfo | null> => {
    if (!bridge) return null;
    return unwrap(await bridge.project.get());
  },
  open: async (root: string): Promise<ProjectInfo> => {
    if (!bridge) throw desktopOnly('打开工程');
    return unwrap(await bridge.project.open(root));
  },
  openDialog: async (): Promise<ProjectInfo | null> => {
    if (!bridge) throw desktopOnly('打开工程');
    return unwrap(await bridge.project.openDialog());
  },
  close: async (): Promise<void> => {
    if (!bridge) return;
    unwrap(await bridge.project.close());
  },
  recent: async (): Promise<RecentProject[]> => {
    if (!bridge) return [];
    return unwrap(await bridge.project.recent());
  },
  recentClear: async (): Promise<void> => {
    if (!bridge) return;
    unwrap(await bridge.project.recentClear());
  },
};

const appApi: DeskApi['app'] = {
  info: async (): Promise<AppInfo> => {
    if (!bridge) throw desktopOnly('读取应用信息');
    return unwrap(await bridge.app.info());
  },
  paths: async (): Promise<AppPaths> => {
    if (!bridge) throw desktopOnly('读取系统目录');
    return unwrap(await bridge.app.paths());
  },
  reveal: async (p: string): Promise<void> => {
    if (!bridge) throw desktopOnly('在文件管理器中显示');
    return unwrap(await bridge.app.reveal(p));
  },
  openExternal: async (url: string): Promise<void> => {
    if (!bridge) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    return unwrap(await bridge.app.openExternal(url));
  },
  openInEditor: async (p: string): Promise<boolean> => {
    if (!bridge) throw desktopOnly('用外部编辑器打开');
    return unwrap(await bridge.app.openInEditor(p));
  },
  restart: async (): Promise<void> => {
    if (!bridge) return;
    unwrap(await bridge.app.restart());
  },
  quit: async (): Promise<void> => {
    if (!bridge) return;
    unwrap(await bridge.app.quit());
  },
};

const watchApi: DeskApi['watch'] = {
  start: async (root: string, opts?: WatchOptions): Promise<string> => {
    if (!bridge) throw desktopOnly('监听文件变化');
    return unwrap(await bridge.watch.start(root, opts));
  },
  stop: async (id: string): Promise<void> => {
    if (!bridge) return;
    unwrap(await bridge.watch.stop(id));
  },
  onChange: (cb: (ev: WatchEvent) => void) => (bridge ? bridge.onWatchEvent(cb) : () => {}),
};

const windowApi: DeskApi['window'] = {
  minimize: async () => {
    if (bridge) unwrap(await bridge.window.minimize());
  },
  maximize: async () => {
    if (bridge) unwrap(await bridge.window.maximize());
  },
  close: async () => {
    if (bridge) unwrap(await bridge.window.close());
  },
  isMaximized: async () => (bridge ? unwrap(await bridge.window.isMaximized()) : false),
  setTitle: async (title: string) => {
    if (bridge) unwrap(await bridge.window.setTitle(title));
    if (typeof document !== 'undefined') document.title = title;
  },
  toggleDevTools: async () => {
    if (bridge) unwrap(await bridge.window.toggleDevTools());
  },
  toggleFullscreen: async () => {
    if (bridge) unwrap(await bridge.window.toggleFullscreen());
  },
};

export const desk: DeskApi = {
  env: bridge?.env ?? {
    isDesktop: false,
    platform: 'web',
    arch: 'web',
    versions: {},
  },
  path: bridge?.path ?? webPath,
  toAssetUrl: (p: string) => (bridge ? bridge.toAssetUrl(p) : webUrl(p)),
  fs: fsApi,
  dialog: dialogApi,
  project: projectApi,
  app: appApi,
  watch: watchApi,
  window: windowApi,
  onMenuAction: (cb: (action: MenuAction) => void) => (bridge ? bridge.onMenuAction(cb) : () => {}),
  onFileDrop: (cb: (paths: string[], pos: { x: number; y: number }) => void) =>
    bridge ? bridge.onFileDrop(cb) : () => {},
};

/** 便捷：把工程内相对路径转成绝对路径 */
export function projectPath(root: string, rel: string): string {
  return desk.path.resolve(root, rel.split('/').join(desk.path.sep || '/'));
}

export default desk;
