/**
 * 无头运行时自检：把 runtime-core + 模型层打包成 Node 可执行的 cjs 并运行，
 * 证明 src/runtime 不依赖 DOM / React / three（W1 验收 + W2 迁移链验收）。
 * 用法：node scripts/runtime-headless.mjs
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const outDir = mkdtempSync(join(tmpdir(), 'light-headless-'));
try {
  await build({
    entryPoints: ['scripts/runtime-headless/entry.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: join(outDir, 'bundle.cjs'),
    logLevel: 'silent',
  });
  const require = createRequire(import.meta.url);
  require(join(outDir, 'bundle.cjs'));
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
