import { app } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';

import type { ProjectInfo, RecentProject } from '../../src/shared/ipc';

/** 持久化在 userData/desk-state.json，只存「界面偏好 + 最近工程」，不存游戏数据 */
interface DeskState {
  project: ProjectInfo | null;
  recent: RecentProject[];
  window?: { x?: number; y?: number; width: number; height: number; maximized: boolean };
}

const MAX_RECENT = 10;

let state: DeskState = { project: null, recent: [] };
let stateFile = '';

function statePath(): string {
  if (!stateFile) stateFile = path.join(app.getPath('userData'), 'desk-state.json');
  return stateFile;
}

async function persist(): Promise<void> {
  try {
    await fsp.mkdir(path.dirname(statePath()), { recursive: true });
    await fsp.writeFile(statePath(), JSON.stringify(state, null, 2), 'utf8');
  } catch {
    /* 状态写不进去不该阻塞编辑器 */
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    const st = await fsp.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

export async function loadState(): Promise<void> {
  try {
    const raw = await fsp.readFile(statePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<DeskState>;
    state = {
      project: parsed.project ?? null,
      recent: Array.isArray(parsed.recent) ? parsed.recent.slice(0, MAX_RECENT) : [],
      window: parsed.window,
    };
  } catch {
    state = { project: null, recent: [] };
  }

  // 工程目录被删/改名后自动失效
  if (state.project && !(await isDir(state.project.root))) state.project = null;
  state.recent = state.recent.filter((r) => r && r.root);

  if (!state.project) {
    const fallback = await defaultRoot();
    if (fallback) await openProject(fallback, { silent: true });
  }
}

/** 首次启动的默认工程：开发时=仓库根；打包后=文档目录 */
async function defaultRoot(): Promise<string | null> {
  const envRoot = process.env.DESK_PROJECT_ROOT;
  if (envRoot && (await isDir(envRoot))) return envRoot;
  if (!app.isPackaged) {
    const repo = app.getAppPath();
    if (await isDir(path.join(repo, 'src'))) return repo;
  }
  const docs = app.getPath('documents');
  return (await isDir(docs)) ? docs : null;
}

export function getProject(): ProjectInfo | null {
  return state.project;
}

export function getRecent(): RecentProject[] {
  return state.recent.slice();
}

export async function openProject(root: string, opts: { silent?: boolean } = {}): Promise<ProjectInfo> {
  if (typeof root !== 'string' || !root.trim()) {
    const err = new Error('工程路径为空') as NodeJS.ErrnoException;
    err.code = 'EINVAL';
    throw err;
  }
  const abs = path.resolve(root);
  if (!(await isDir(abs))) {
    const err = new Error(`不是有效文件夹：${abs}`) as NodeJS.ErrnoException;
    err.code = 'ENOTDIR';
    err.path = abs;
    throw err;
  }

  const info: ProjectInfo = { root: abs, name: path.basename(abs), openedAt: Date.now() };
  state.project = info;
  state.recent = [info, ...state.recent.filter((r) => r.root !== abs)].slice(0, MAX_RECENT);
  if (!opts.silent) await persist();
  return info;
}

export async function closeProject(): Promise<void> {
  state.project = null;
  await persist();
}

export async function clearRecent(): Promise<void> {
  state.recent = [];
  await persist();
}

export function getWindowBounds(): DeskState['window'] {
  return state.window;
}

export async function saveWindowBounds(bounds: NonNullable<DeskState['window']>): Promise<void> {
  state.window = bounds;
  await persist();
}
