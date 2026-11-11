/**
 * 演示录屏（--record）
 *
 * 新建一个示例工程 → 点运行 → 按时间表模拟 WASD → 逐帧抓"场景画面"→ 存成 PNG 序列。
 * 合成动图由 scripts/frames-to-gif.py 完成（环境里没有 ffmpeg）。
 *
 * 只在开发/自查时用，不参与正常启动路径。
 */
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const FRAME_MS = 110; // ≈9fps（capturePage 会随画面复杂度变慢，按实测余量取）
const DURATION_MS = 6600;
const OUT_W = 640;

/** 按键时间表：[相对毫秒, down|up, KeyboardEvent.code] */
const KEYS: [number, 'down' | 'up', string][] = [
  [300, 'down', 'KeyW'],
  [1300, 'up', 'KeyW'],
  [1400, 'down', 'KeyD'],
  [2350, 'up', 'KeyD'],
  [2450, 'down', 'KeyS'],
  [3200, 'up', 'KeyS'],
  [3300, 'down', 'KeyA'],
  [4100, 'up', 'KeyA'],
  [4200, 'down', 'KeyW'],
  [4200, 'down', 'KeyD'], // 斜向
  [4950, 'up', 'KeyW'],
  [4950, 'up', 'KeyD'],
  [5400, 'down', 'KeyD'],
  [5900, 'up', 'KeyD'],
];

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function runRecord(win: BrowserWindow, outDir: string): Promise<boolean> {
  const parent = path.join(app.getPath('temp'), 'light-editor-record');
  const frameDir = path.join(app.getPath('temp'), 'light-record-frames');
  await fs.rm(parent, { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(frameDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(parent, { recursive: true });
  await fs.mkdir(frameDir, { recursive: true });
  await fs.mkdir(outDir, { recursive: true }).catch(() => undefined);

  await waitForLoad(win);
  win.setSize(1500, 940);
  win.center();
  await sleep(900);

  // 1. 建演示工程（带示例素材：角色、动画、控制器、状态机）
  const created = await win.webContents.executeJavaScript(`(async () => {
    try {
      await window.__editor.createProject(${JSON.stringify(parent)}, 'Demo', true);
      const s = window.__editor.getSnapshot();
      return { ok: s.status === 'ready', status: s.status, err: s.error || null };
    } catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
  })()`);
  console.log('[record] 建工程:', JSON.stringify(created));
  if (!created?.ok) return false;

  await sleep(2600);
  await win.webContents.executeJavaScript('window.__editorUi && window.__editorUi.closeWindows && window.__editorUi.closeWindows()');
  await sleep(500);

  // 2. 取"场景面板"（含工具条上的运行状态 HUD）的屏幕区域，只录这块
  const rect = (await win.webContents.executeJavaScript(`(() => {
    const host = document.querySelector('[data-scene-host]');
    if (!host) return null;
    const root = host.parentElement && host.parentElement.parentElement;
    const r = (root || host).getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  })()`)) as Rect | null;
  if (!rect || rect.width < 200 || rect.height < 200) {
    console.error('[record] 找不到场景面板', rect);
    return false;
  }
  console.log('[record] 录制区域:', JSON.stringify(rect));

  // 3. 开播
  await win.webContents.executeJavaScript(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('title') || '').includes('运行场景'));
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(800);

  const before = await charMetrics(win);
  console.log('[record] 播放前角色指标:', JSON.stringify(before));

  // 4. 注入按键时间表（在页面内按真实时间派发，抓帧节奏不受影响）
  await win.webContents.executeJavaScript(`(() => {
    const seq = ${JSON.stringify(KEYS)};
    window.__recKeys = seq.map(([t, type, code]) => setTimeout(() => {
      window.dispatchEvent(new KeyboardEvent(type === 'down' ? 'keydown' : 'keyup', { code, bubbles: true, cancelable: true }));
    }, t));
    return seq.length;
  })()`);

  // 5. 逐帧抓图
  const frames: { file: string; t: number }[] = [];
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < DURATION_MS) {
    const started = Date.now();
    const img = await win.webContents.capturePage(rect);
    const small = img.resize({ width: OUT_W });
    const file = path.join(frameDir, `f${String(i).padStart(3, '0')}.png`);
    await fs.writeFile(file, small.toPNG());
    frames.push({ file, t: started - t0 });
    i += 1;
    const wait = FRAME_MS - (Date.now() - started);
    if (wait > 0) await sleep(wait);
  }

  const after = await charMetrics(win);
  console.log('[record] 结束时角色指标:', JSON.stringify(after));
  console.log('[record] 帧数:', frames.length, '耗时(ms):', Date.now() - t0);

  // 6. 收尾：松开所有键、停播
  await win.webContents.executeJavaScript(`(() => {
    for (const [, , code] of ${JSON.stringify(KEYS)}) {
      window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }));
    }
    const stop = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('title') || '').includes('停止'));
    if (stop) stop.click();
    return true;
  })()`);
  await sleep(400);

  // 7. 帧时间表（每帧实际停留时长 → GIF 的 delay）
  const meta = frames.map((f, idx) => {
    const next = frames[idx + 1];
    const dt = next ? next.t - f.t : FRAME_MS;
    return { file: f.file, delay: Math.max(30, Math.round(dt)) };
  });
  const metaPath = path.join(frameDir, 'frames.json');
  await fs.writeFile(metaPath, JSON.stringify({ width: OUT_W, frames: meta }, null, 2));

  // 8. 留一张代表帧做快速核对
  const mid = frames[Math.floor(frames.length * 0.45)];
  if (mid) await fs.copyFile(mid.file, path.join(outDir, 'record-frame.png')).catch(() => undefined);

  console.log('[record] 帧目录:', frameDir);
  return frames.length > 20;
}

async function charMetrics(win: BrowserWindow): Promise<unknown> {
  return win.webContents
    .executeJavaScript('window.__charMetrics || null')
    .catch(() => null);
}

function waitForLoad(win: BrowserWindow): Promise<void> {
  if (!win.webContents.isLoading()) return Promise.resolve();
  return new Promise((resolve) => win.webContents.once('did-finish-load', () => resolve()));
}
