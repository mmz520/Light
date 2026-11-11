import { BrowserWindow, app, dialog, shell } from 'electron';
import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { CH } from '../../src/shared/ipc';
import type { AppInfo, AppPaths } from '../../src/shared/ipc';
import { handle } from '../lib/ipc';
import * as projectStore from '../lib/project-store';

/** 内置示例素材（resources/. app 内的 assets/sprites）：打包后在 asar 的 dist 里 */
function findSamples(): string | null {
  const candidates = [
    path.join(app.getAppPath(), 'public', 'assets', 'sprites'),
    path.join(app.getAppPath(), 'dist', 'assets', 'sprites'),
    path.join(process.resourcesPath ?? '', 'assets', 'sprites'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, 'manifest.json'))) return c;
    } catch {
      /* 忽略 */
    }
  }
  return null;
}

export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

export function registerAppIpc(): void {
  handle(CH.appInfo, (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? '',
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged,
      userData: app.getPath('userData'),
      locale: app.getLocale(),
      cwd: process.cwd(),
    };
  });

  handle(CH.appPaths, (): AppPaths => ({
    home: app.getPath('home'),
    documents: app.getPath('documents'),
    desktop: app.getPath('desktop'),
    downloads: app.getPath('downloads'),
    userData: app.getPath('userData'),
    temp: app.getPath('temp'),
    appRoot: app.getAppPath(),
    samples: findSamples(),
  }));

  handle(CH.appReveal, async (p: string) => {
    shell.showItemInFolder(p);
  });

  handle(CH.appOpenExternal, async (url: string) => {
    if (!/^https?:\/\//i.test(url)) {
      const err = new Error('只允许打开 http(s) 链接') as NodeJS.ErrnoException;
      err.code = 'EINVAL';
      throw err;
    }
    await shell.openExternal(url);
  });

  // 用 VS Code 打开文件：优先 PATH 里的 code 命令；拉不起来就退回系统默认编辑器
  handle(CH.appOpenInEditor, async (p: string) => {
    const abs = path.resolve(String(p));
    const viaCode = await new Promise<boolean>((resolve) => {
      try {
        exec(`code ${JSON.stringify(abs)}`, { timeout: 8000 }, (err) => resolve(!err));
      } catch {
        resolve(false);
      }
    });
    if (viaCode) return true;
    const err = await shell.openPath(abs);
    if (err) throw new Error(err);
    return false;
  });

  handle(CH.appRestart, () => {
    app.relaunch();
    app.exit(0);
  });

  handle(CH.appQuit, () => {
    app.quit();
  });

  /* ------------------------- 工程 ------------------------- */

  handle(CH.projectGet, () => projectStore.getProject());

  handle(CH.projectOpen, async (root: string) => {
    const info = await projectStore.openProject(root);
    broadcast(CH.menuAction, 'project:changed');
    return info;
  });

  handle(CH.projectOpenDialog, async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const res = win
      ? await dialog.showOpenDialog(win, {
          title: '打开工程文件夹',
          properties: ['openDirectory', 'createDirectory'],
        })
      : await dialog.showOpenDialog({ title: '打开工程文件夹', properties: ['openDirectory'] });
    if (res.canceled || res.filePaths.length === 0) return null;
    const info = await projectStore.openProject(res.filePaths[0]);
    broadcast(CH.menuAction, 'project:changed');
    return info;
  });

  handle(CH.projectClose, async () => {
    await projectStore.closeProject();
    broadcast(CH.menuAction, 'project:changed');
  });

  handle(CH.projectRecent, () => projectStore.getRecent());
  handle(CH.projectRecentClear, () => projectStore.clearRecent());
}
