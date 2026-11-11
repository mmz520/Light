import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import './build-electron.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { default: electronPath } = await import('electron');

const server = await createServer({
  root,
  configFile: path.join(root, 'vite.config.ts'),
  mode: 'development',
});
await server.listen();

const url = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port ?? 5173}/`;
console.log(`[dev] renderer: ${url}`);

const child = spawn(electronPath, [path.join(root, '.')], {
  cwd: root,
  stdio: 'inherit',
  env: (() => {
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      DESK_DEV_SERVER_URL: url,
    };
    // 见 scripts/run-electron.mjs 的说明
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
  })(),
});

let closing = false;
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  try {
    await server.close();
  } catch {
    /* ignore */
  }
  process.exit(code);
}

child.on('exit', (code) => void shutdown(code ?? 0));
child.on('error', (err) => {
  console.error('[dev] 启动 Electron 失败：', err.message);
  void shutdown(1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (!child.killed) child.kill();
    void shutdown(0);
  });
}
