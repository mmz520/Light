import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 打包主进程与 preload。
 * 输出 CJS（.cjs）：package.json 是 "type": "module"，用 .cjs 后缀避免 ESM 解析问题。
 */
export async function buildElectron({ sourcemap = true } = {}) {
  const common = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
    sourcemap,
    legalComments: 'none',
    absWorkingDir: root,
    logLevel: 'warning',
  };

  await build({
    ...common,
    entryPoints: ['electron/main.ts'],
    outfile: 'dist-electron/main.cjs',
  });

  await build({
    ...common,
    entryPoints: ['electron/preload.ts'],
    outfile: 'dist-electron/preload.cjs',
  });

  console.log('[electron] dist-electron/main.cjs  dist-electron/preload.cjs');
}

await buildElectron();
