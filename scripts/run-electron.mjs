import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { default: electronPath } = await import('electron');

/**
 * 启动 Electron。
 * 某些环境（如 WorkBuddy / VSCode 终端）会带 ELECTRON_RUN_AS_NODE=1，
 * 那会让 electron.exe 退化成纯 Node，导致 require('electron').app 为 undefined，
 * 这里显式剔除。
 */
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = [root, ...process.argv.slice(2)];

const child = spawn(electronPath, args, { cwd: root, stdio: 'inherit', env });

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill());
}
