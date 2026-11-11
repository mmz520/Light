import { BrowserWindow, Menu, app, shell } from 'electron';
import path from 'node:path';

import { CH } from '../src/shared/ipc';
import { registerAppIpc, broadcast } from './ipc/app';
import { registerDialogIpc } from './ipc/dialog';
import { registerFsIpc } from './ipc/fs';
import { closeAllWatchers, registerWatchIpc } from './ipc/watch';
import { handle, toErrorInfo } from './lib/ipc';
import { handleAssetProtocol, registerAssetScheme } from './lib/protocol';
import * as projectStore from './lib/project-store';

const devServerUrl = process.env.DESK_DEV_SERVER_URL;
const isSelfTest = process.argv.includes('--selftest');
const isSmoke = process.argv.includes('--smoke');
const isShot = process.argv.includes('--shot');
/** 人工复现：跑完整自检流程，但连线不渲染时把窗口留在现场（不退出） */
const isLive = process.argv.includes('--live');
/** 录演示动图：建示例工程 → 播放 → 模拟 WASD → 抓帧 */
const isRecord = process.argv.includes('--record');

// 自动化模式用独立 profile：既不和用户正在用的实例抢单实例锁，也不共用缓存目录
if (isShot || isLive || isSmoke || isRecord) {
  app.setPath('userData', path.join(app.getPath('temp'), 'light-verify-profile'));
}

let mainWindow: BrowserWindow | null = null;

registerAssetScheme();

/* ------------------------------------------------------------------ */
/* 窗口                                                                */
/* ------------------------------------------------------------------ */

function createWindow(): void {
  const saved = projectStore.getWindowBounds();

  mainWindow = new BrowserWindow({
    width: saved?.width ?? 1600,
    height: saved?.height ?? 1000,
    x: saved?.x,
    y: saved?.y,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    // 无系统边框：标题栏由渲染层自绘（隐藏 / 全屏 / 退出）
    frame: false,
    thickFrame: true,
    backgroundColor: '#14110e',
    title: 'Light Editor',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // preload 需要 node:path 做同步路径工具，因此关掉 sandbox（仍开 contextIsolation）
      sandbox: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  if (saved?.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', () => {
    if (!mainWindow) return;
    // 复现模式不改用户的窗口位置存档
    if (isLive) return;
    const maximized = mainWindow.isMaximized();
    const b = mainWindow.getNormalBounds();
    void projectStore.saveWindowBounds({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      maximized,
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外链走系统浏览器，不在应用内跳走
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isDevUrl = devServerUrl && url.startsWith(devServerUrl);
    if (!isDevUrl) event.preventDefault();
  });

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

/* ------------------------------------------------------------------ */
/* 菜单                                                                */
/* ------------------------------------------------------------------ */

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开工程文件夹…',
          accelerator: 'CmdOrCtrl+O',
          click: () => broadcast(CH.menuAction, 'menu:open-project'),
        },
        {
          label: '保存',
          accelerator: 'CmdOrCtrl+S',
          click: () => broadcast(CH.menuAction, 'menu:save'),
        },
        { type: 'separator' },
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        {
          label: '开发者工具',
          accelerator: 'F12',
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ */
/* 窗口控制 IPC                                                        */
/* ------------------------------------------------------------------ */

function registerWindowIpc(): void {
  handle(CH.winMinimize, () => mainWindow?.minimize());
  handle(CH.winMaximize, () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  handle(CH.winClose, () => mainWindow?.close());
  handle(CH.winIsMaximized, () => mainWindow?.isMaximized() ?? false);
  handle(CH.winSetTitle, (title: string) => mainWindow?.setTitle(title));
  handle(CH.winToggleDevTools, () => mainWindow?.webContents.toggleDevTools());
  handle(CH.winToggleFullscreen, () => {
    if (!mainWindow) return;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function onReady(): Promise<void> {
  handleAssetProtocol();
  await projectStore.loadState();

  registerFsIpc();
  registerDialogIpc();
  registerAppIpc();
  registerWatchIpc();
  registerWindowIpc();

  buildMenu();
  createWindow();

  if (isSmoke) void runWindowSmoke();
  if (isLive && mainWindow) {
    // 复现成功时 runShot 的 promise 永不 resolve，窗口就留在失败现场；
    // 返回（=没复现）则 exit(3)，外层脚本据此重试。
    void import('./lib/verify').then(async ({ runShot }) => {
      await runShot(mainWindow!, path.join(app.getAppPath(), '.verify'), { holdOnBroken: true });
      console.log('[live] NOT REPRO: 这次连线正常，退出以便重试');
      app.exit(3);
    });
  }
  if (isShot && mainWindow) {
    void import('./lib/verify').then(async ({ runShot }) => {
      const ok = await runShot(mainWindow!, path.join(app.getAppPath(), '.verify'));
      app.exit(ok ? 0 : 1);
    });
  }
  if (isRecord && mainWindow) {
    void import('./lib/record').then(async ({ runRecord }) => {
      const ok = await runRecord(mainWindow!, path.join(app.getAppPath(), '.verify'));
      app.exit(ok ? 0 : 1);
    });
  }
}

/** 集成冒烟：真实窗口里验证 preload 是否注入、几个关键 API 是否通 */
async function runWindowSmoke(): Promise<void> {
  const win = mainWindow;
  if (!win) {
    console.error('[smoke] no window');
    app.exit(1);
    return;
  }
  const run = async () => {
    try {
      const result = await win.webContents.executeJavaScript(`(async () => {
        const out = { bridge: !!window.desk, isDesktop: window.desk?.env?.isDesktop ?? false };
        if (!window.desk) return out;
        try {
          const info = await window.desk.app.info();
          out.appName = info.ok ? info.data.name : undefined;
          out.electron = info.ok ? info.data.electron : undefined;
          out.infoOk = info.ok;
        } catch (e) { out.infoError = String(e); }
        try {
          const proj = await window.desk.project.get();
          out.project = proj && proj.ok ? proj.data && proj.data.root : null;
          const root = proj && proj.ok && proj.data ? proj.data.root : null;
          if (root) {
            const list = await window.desk.fs.list(root, { depth: 1 });
            out.listOk = list.ok;
            out.listCount = list.ok ? list.data.length : 0;
          }

          // 内置示例素材的绝对路径（app 根目录），不依赖当前打开的工程
          // 注意：smoke 里拿到的是未解包的 DeskResult
          const paths = await window.desk.app.paths();
          const sampleRoot = paths.ok ? paths.data.samples : null;
          if (sampleRoot) {
            const manifest = await window.desk.fs.readJson(sampleRoot + '/manifest.json');
            out.manifestOk = manifest.ok;
            // gameasset:// 必须真能取到图，否则编辑器里所有贴图都是空的
            const res = await fetch(window.desk.toAssetUrl(sampleRoot + '/role/common/arm.png'));
            out.assetStatus = res.status;
            out.assetType = res.headers.get('content-type');
            out.assetBytes = (await res.arrayBuffer()).byteLength;
          }
        } catch (e) { out.projectError = String(e); }
        try {
          const tree = await window.desk.fs.tree('.', { depth: 1 });
          out.treeOk = tree.ok;
        } catch (e) { out.treeError = String(e); }
        out.assetUrl = window.desk.toAssetUrl('C:/tmp/a b/图.png');
        return out;
      })()`);

      console.log('\n========== window smoke ==========');
      console.log(JSON.stringify(result, null, 2));

      const ok =
        result.bridge === true &&
        result.isDesktop === true &&
        result.listOk === true &&
        result.treeOk === true &&
        result.manifestOk === true &&
        result.assetStatus === 200 &&
        result.assetBytes > 100;
      console.log(`----------------------------------`);
      console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
      app.exit(ok ? 0 : 1);
    } catch (err) {
      console.error('[smoke] 执行失败', toErrorInfo(err));
      app.exit(1);
    }
  };

  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => void run());
  else void run();
}

if (isSelfTest) {
  app.whenReady().then(async () => {
    const { runSelfTest } = await import('./lib/selftest');
    const ok = await runSelfTest();
    app.exit(ok ? 0 : 1);
  });
} else if (isLive || isShot || isRecord) {
  // 自动化模式绕过单实例锁：用户自己的编辑器通常开着，不能被踢掉
  app.whenReady().then(onReady).catch((err) => {
    console.error('[auto] 启动失败', toErrorInfo(err));
    app.exit(1);
  });
} else {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });

    app.whenReady().then(onReady).catch((err) => {
      console.error('[main] 启动失败', toErrorInfo(err));
      app.exit(1);
    });

    app.on('window-all-closed', () => {
      closeAllWatchers();
      if (process.platform !== 'darwin') app.quit();
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    app.on('before-quit', () => closeAllWatchers());
  }
}
