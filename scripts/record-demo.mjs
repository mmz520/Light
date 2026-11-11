/**
 * 录演示动图：Electron 里跑一遍演示并抓帧 → Python(Pillow) 合成 GIF。
 * 用法：npm run record
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit' });

const shot = run(process.execPath, ['scripts/run-electron.mjs', '--record']);
if (shot.status !== 0) {
  console.error('[record] 抓帧失败，退出码', shot.status);
  process.exit(shot.status ?? 1);
}

const frameDir = path.join(os.tmpdir(), 'light-record-frames');
const out = path.resolve('.verify/demo.gif');
const gif = run(process.env.PYTHON || 'python', ['scripts/frames-to-gif.py', frameDir, out, '96']);
process.exit(gif.status ?? 1);
