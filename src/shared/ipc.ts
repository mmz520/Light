/**
 * 桌面端（Electron）IPC 契约 —— 主进程与渲染进程共用。
 *
 * 渲染进程不直接接触 Node，全部能力经 window.desk 暴露（见 src/platform/desk.ts）。
 * 主进程在 electron/ipc/*.ts 注册同名通道。
 *
 * 约定：所有 invoke 通道都返回 DeskResult<T>，失败不抛异常，由渲染侧包装层转成 DeskError。
 */

export const CH = {
  // app / 生命周期
  appInfo: 'desk:app:info',
  appPaths: 'desk:app:paths',
  appReveal: 'desk:app:reveal',
  appOpenExternal: 'desk:app:openExternal',
  appOpenInEditor: 'desk:app:openInEditor',
  appRestart: 'desk:app:restart',
  appQuit: 'desk:app:quit',

  // 工程（当前打开的文件夹）
  projectGet: 'desk:project:get',
  projectOpen: 'desk:project:open',
  projectOpenDialog: 'desk:project:openDialog',
  projectClose: 'desk:project:close',
  projectRecent: 'desk:project:recent',
  projectRecentClear: 'desk:project:recentClear',

  // 文件系统
  fsReadText: 'desk:fs:readText',
  fsReadJson: 'desk:fs:readJson',
  fsWriteText: 'desk:fs:writeText',
  fsWriteJson: 'desk:fs:writeJson',
  fsExists: 'desk:fs:exists',
  fsStat: 'desk:fs:stat',
  fsList: 'desk:fs:list',
  fsTree: 'desk:fs:tree',
  fsMkdirp: 'desk:fs:mkdirp',
  fsRename: 'desk:fs:rename',
  fsCopy: 'desk:fs:copy',
  fsRemove: 'desk:fs:remove',
  fsTrash: 'desk:fs:trash',
  fsReadBinary: 'desk:fs:readBinary',
  fsWriteBinary: 'desk:fs:writeBinary',
  fsHash: 'desk:fs:hash',

  // 对话框
  dialogOpen: 'desk:dialog:open',
  dialogSave: 'desk:dialog:save',
  dialogMessage: 'desk:dialog:message',

  // 文件监听
  watchStart: 'desk:watch:start',
  watchStop: 'desk:watch:stop',
  watchEvent: 'desk:watch:event', // main → renderer

  // 菜单 / 窗口
  menuAction: 'desk:menu:action', // main → renderer
  winMinimize: 'desk:win:minimize',
  winMaximize: 'desk:win:maximize',
  winClose: 'desk:win:close',
  winIsMaximized: 'desk:win:isMaximized',
  winSetTitle: 'desk:win:setTitle',
  winToggleDevTools: 'desk:win:devtools',
  winToggleFullscreen: 'desk:win:fullscreen',

  // 独立的编辑器窗口（动画 / 状态机 / 控制器 / 脚本）——真实 OS 窗口
  editorWinOpen: 'desk:editorWin:open',
  editorWinClose: 'desk:editorWin:close',
  editorWinCloseAll: 'desk:editorWin:closeAll',
  editorWinReady: 'desk:editorWin:ready', // renderer → main：弹窗已挂载，请发初始文档
  editorWinInit: 'desk:editorWin:init', // main → renderer：初始文档
  editorWinDoc: 'desk:editorWin:doc', // 双向：工程快照广播
  editorWinClosed: 'desk:editorWin:closed', // main → renderer：某个窗口被关掉
} as const;

/* ------------------------------------------------------------------ */
/* 基础类型                                                            */
/* ------------------------------------------------------------------ */

export interface DeskErrorInfo {
  code: string;
  message: string;
  path?: string;
}

export type DeskResult<T> = { ok: true; data: T } | { ok: false; error: DeskErrorInfo };

export type EntryKind = 'file' | 'dir';

export interface FileEntry {
  path: string;
  name: string;
  kind: EntryKind;
  /** 相对于本次 list 的根目录，使用 / 分隔 */
  rel: string;
  /** 小写扩展名，不含点；目录为 '' */
  ext: string;
  size: number;
  /** 毫秒时间戳 */
  mtime: number;
}

export interface FileStat {
  path: string;
  kind: EntryKind;
  size: number;
  mtime: number;
  ctime: number;
  readonly: boolean;
}

export interface TreeNode {
  path: string;
  name: string;
  kind: EntryKind;
  rel: string;
  /** 仅目录有 children */
  children?: TreeNode[];
}

export interface ListOptions {
  /** 递归遍历子目录 */
  recursive?: boolean;
  /** 递归最大深度，默认 8 */
  depth?: number;
  /** 只保留这些扩展名（不含点），如 ['png','json'] */
  extensions?: string[];
  /** 是否返回文件，默认 true */
  includeFiles?: boolean;
  /** 是否返回目录条目，默认 false */
  includeDirs?: boolean;
  /** 是否包含 . 开头的隐藏项，默认 false */
  includeHidden?: boolean;
  /** 最多返回多少条，默认 20000（防止误扫大目录卡死） */
  limit?: number;
  sort?: 'name' | 'mtime' | 'size';
  dirsFirst?: boolean;
}

export interface ReadOptions {
  encoding?: 'utf8' | 'base64';
}

export interface WriteOptions {
  /** 自动创建父目录，默认 true */
  mkdirp?: boolean;
  /** 先写临时文件再改名（防半截文件），默认 true */
  atomic?: boolean;
  /** JSON 缩进，默认 2 */
  indent?: number;
  /** 覆盖前备份为 .bak */
  backup?: boolean;
}

export interface WriteResult {
  path: string;
  bytes: number;
  created: boolean;
}

export interface BinaryResult {
  /** base64 编码内容 */
  base64: string;
  size: number;
  mime: string;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  multi?: boolean;
  directory?: boolean;
  filters?: FileFilter[];
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  defaultName?: string;
  filters?: FileFilter[];
}

export interface MessageBoxOptions {
  title?: string;
  message: string;
  detail?: string;
  type?: 'none' | 'info' | 'warning' | 'error' | 'question';
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
}

export interface ProjectInfo {
  root: string;
  name: string;
  openedAt: number;
}

export type RecentProject = ProjectInfo;

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
  userData: string;
  locale: string;
  cwd: string;
}

export interface AppPaths {
  home: string;
  documents: string;
  desktop: string;
  downloads: string;
  userData: string;
  temp: string;
  appRoot: string;
  /** 内置示例素材目录（首次新建工程可复制进去）；找不到为 null */
  samples: string | null;
}

export interface WatchOptions {
  recursive?: boolean;
  extensions?: string[];
  /** 合并抖动毫秒，默认 120 */
  debounce?: number;
}

export type WatchChangeType = 'add' | 'change' | 'unlink';

export interface WatchEvent {
  watchId: string;
  type: WatchChangeType;
  path: string;
  rel: string;
}

export type MenuAction =
  | 'menu:open-project'
  | 'menu:save'
  | 'menu:reload'
  | 'menu:toggle-devtools'
  | 'project:changed';

/* ------------------------------------------------------------------ */
/* 渲染进程实际使用的 API（已解包，失败抛 DeskError）                  */
/* ------------------------------------------------------------------ */

export interface DeskPathApi {
  join: (...parts: string[]) => string;
  resolve: (...parts: string[]) => string;
  relative: (from: string, to: string) => string;
  basename: (p: string, ext?: string) => string;
  dirname: (p: string) => string;
  extname: (p: string) => string;
  /** path.normalize：折叠 . / .. 与重复分隔符 */
  normalize: (p: string) => string;
  /** 统一成 / 分隔，便于写进 JSON */
  toPosix: (p: string) => string;
  sep: string;
}

export interface DeskFsApi {
  readText: (path: string, opts?: ReadOptions) => Promise<string>;
  readJson: <T = unknown>(path: string) => Promise<T>;
  writeText: (path: string, content: string, opts?: WriteOptions) => Promise<WriteResult>;
  writeJson: (path: string, data: unknown, opts?: WriteOptions) => Promise<WriteResult>;
  exists: (path: string) => Promise<boolean>;
  stat: (path: string) => Promise<FileStat | null>;
  list: (path: string, opts?: ListOptions) => Promise<FileEntry[]>;
  tree: (path: string, opts?: ListOptions) => Promise<TreeNode>;
  mkdirp: (path: string) => Promise<string>;
  rename: (from: string, to: string) => Promise<string>;
  copy: (from: string, to: string) => Promise<string>;
  /** 直接删除（不可恢复），优先用 trash */
  remove: (path: string) => Promise<void>;
  /** 移到系统回收站（安全删除） */
  trash: (paths: string | string[]) => Promise<void>;
  readBinary: (path: string) => Promise<BinaryResult>;
  writeBinary: (path: string, base64: string) => Promise<WriteResult>;
  hash: (path: string) => Promise<string>;
}

export interface DeskDialogApi {
  open: (opts?: OpenDialogOptions) => Promise<string[]>;
  save: (opts?: SaveDialogOptions) => Promise<string | null>;
  message: (opts: MessageBoxOptions) => Promise<number>;
}

export interface DeskProjectApi {
  get: () => Promise<ProjectInfo | null>;
  open: (root: string) => Promise<ProjectInfo>;
  openDialog: () => Promise<ProjectInfo | null>;
  close: () => Promise<void>;
  recent: () => Promise<RecentProject[]>;
  recentClear: () => Promise<void>;
}

export interface DeskAppApi {
  info: () => Promise<AppInfo>;
  paths: () => Promise<AppPaths>;
  reveal: (path: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  /** 用系统默认 JS 编辑器（优先 VS Code）打开文件；返回是否成功拉起 VS Code */
  openInEditor: (path: string) => Promise<boolean>;
  restart: () => Promise<void>;
  quit: () => Promise<void>;
}

export interface DeskWatchApi {
  start: (root: string, opts?: WatchOptions) => Promise<string>;
  stop: (watchId: string) => Promise<void>;
  onChange: (cb: (ev: WatchEvent) => void) => () => void;
}

export interface DeskWindowApi {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  setTitle: (title: string) => Promise<void>;
  toggleDevTools: () => Promise<void>;
  toggleFullscreen: () => Promise<void>;
}

/* ------------------------------------------------------------------ */
/* 独立编辑器窗口（真实 OS 窗口，可以拖到别的显示器）                   */
/* ------------------------------------------------------------------ */

/**
 * 独立窗口类型：动画 / 状态机 / 控制器 / 脚本编辑器，以及只读的脚本 API 帮助。
 * help 窗口不需要工程快照，主进程照样按 kind:refId 去重。
 */
export type EditorWindowKind = 'animation' | 'statemachine' | 'controller' | 'script' | 'help';

export interface EditorWindowRef {
  kind: EditorWindowKind;
  refId: string;
}

/** 主窗口 → 主进程：开一个编辑器窗口 */
export interface EditorWindowOpenOptions extends EditorWindowRef {
  title: string;
  subtitle?: string;
  /** 打开时的工程快照（新窗口直接拿它初始化，省一次磁盘读） */
  project?: unknown;
}

/** 主进程 → 弹窗：初始文档（工程快照 + 要编辑的资源 id） */
export interface EditorWindowInitPayload extends EditorWindowRef {
  /** 工程快照（ProjectDoc 的 JSON 形态；shared 层不依赖编辑器模型，因此写 unknown） */
  project: unknown;
}

export interface DeskEditorWindowApi {
  /** 打开（或聚焦）一个真实窗口；同一 kind+refId 只会有一个 */
  open: (opts: EditorWindowOpenOptions) => Promise<EditorWindowRef>;
  /** 关闭某个窗口；不传则关闭全部 */
  close: (ref?: EditorWindowRef) => Promise<void>;
  closeAll: () => Promise<void>;
  /** 弹窗挂载完成 → 申请初始文档 */
  ready: (ref: EditorWindowRef) => Promise<void>;
  /** 把工程快照广播给其它窗口 */
  pushDoc: (project: unknown) => Promise<void>;
  onInit: (cb: (payload: EditorWindowInitPayload) => void) => () => void;
  onDoc: (cb: (project: unknown) => void) => () => void;
  onClosed: (cb: (ref: EditorWindowRef) => void) => () => void;
}

export interface DeskApi {
  env: {
    isDesktop: boolean;
    platform: string;
    arch: string;
    versions: Record<string, string>;
  };
  path: DeskPathApi;
  /** 本地绝对路径 → 可直接放进 <img src> 的 URL（桌面端走 gameasset:// 协议） */
  toAssetUrl: (path: string) => string;
  fs: DeskFsApi;
  dialog: DeskDialogApi;
  project: DeskProjectApi;
  app: DeskAppApi;
  watch: DeskWatchApi;
  window: DeskWindowApi;
  /** 独立的编辑器窗口（真实 OS 窗口）；浏览器模式没有这个能力 */
  editorWindow: DeskEditorWindowApi;
  onMenuAction: (cb: (action: MenuAction) => void) => () => void;
  /** 拖文件到窗口：拿到真实绝对路径（Electron 里 File.path 已废弃） */
  onFileDrop: (cb: (paths: string[], pos: { x: number; y: number }) => void) => () => void;
}

/* ------------------------------------------------------------------ */
/* preload 暴露的原始桥（返回 DeskResult，不解包）                     */
/* ------------------------------------------------------------------ */

type R<T> = Promise<DeskResult<T>>;

export interface DeskBridge {
  env: DeskApi['env'];
  path: DeskPathApi;
  toAssetUrl: (path: string) => string;
  fs: {
    readText: (path: string, opts?: ReadOptions) => R<string>;
    readJson: (path: string) => R<unknown>;
    writeText: (path: string, content: string, opts?: WriteOptions) => R<WriteResult>;
    writeJson: (path: string, data: unknown, opts?: WriteOptions) => R<WriteResult>;
    exists: (path: string) => R<boolean>;
    stat: (path: string) => R<FileStat | null>;
    list: (path: string, opts?: ListOptions) => R<FileEntry[]>;
    tree: (path: string, opts?: ListOptions) => R<TreeNode>;
    mkdirp: (path: string) => R<string>;
    rename: (from: string, to: string) => R<string>;
    copy: (from: string, to: string) => R<string>;
    remove: (path: string) => R<void>;
    trash: (paths: string | string[]) => R<void>;
    readBinary: (path: string) => R<BinaryResult>;
    writeBinary: (path: string, base64: string) => R<WriteResult>;
    hash: (path: string) => R<string>;
  };
  dialog: {
    open: (opts?: OpenDialogOptions) => R<string[]>;
    save: (opts?: SaveDialogOptions) => R<string | null>;
    message: (opts: MessageBoxOptions) => R<number>;
  };
  project: {
    get: () => R<ProjectInfo | null>;
    open: (root: string) => R<ProjectInfo>;
    openDialog: () => R<ProjectInfo | null>;
    close: () => R<void>;
    recent: () => R<RecentProject[]>;
    recentClear: () => R<void>;
  };
  app: {
    info: () => R<AppInfo>;
    paths: () => R<AppPaths>;
    reveal: (path: string) => R<void>;
    openExternal: (url: string) => R<void>;
    openInEditor: (path: string) => R<boolean>;
    restart: () => R<void>;
    quit: () => R<void>;
  };
  watch: {
    start: (root: string, opts?: WatchOptions) => R<string>;
    stop: (watchId: string) => R<void>;
  };
  window: {
    minimize: () => R<void>;
    maximize: () => R<void>;
    close: () => R<void>;
    isMaximized: () => R<boolean>;
    setTitle: (title: string) => R<void>;
    toggleDevTools: () => R<void>;
    toggleFullscreen: () => R<void>;
  };
  editorWindow: {
    open: (opts: EditorWindowOpenOptions) => R<EditorWindowRef>;
    close: (ref?: EditorWindowRef) => R<void>;
    closeAll: () => R<void>;
    ready: (ref: EditorWindowRef) => R<void>;
    pushDoc: (project: unknown) => R<void>;
    onInit: (cb: (payload: EditorWindowInitPayload) => void) => () => void;
    onDoc: (cb: (project: unknown) => void) => () => void;
    onClosed: (cb: (ref: EditorWindowRef) => void) => () => void;
  };
  onWatchEvent: (cb: (ev: WatchEvent) => void) => () => void;
  onMenuAction: (cb: (action: MenuAction) => void) => () => void;
  onFileDrop: (cb: (paths: string[], pos: { x: number; y: number }) => void) => () => void;
}
