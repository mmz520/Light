import { shell } from 'electron';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as fsops from './fsops';

interface Case {
  name: string;
  ok: boolean;
  detail?: string;
}

/**
 * 无窗口自检：验证 IPC 背后所有 fs 能力是否可用。
 * 用法：npm run selftest
 */
export async function runSelfTest(): Promise<boolean> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'light-desk-test-'));
  const cases: Case[] = [];

  const check = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      cases.push({ name, ok: true });
    } catch (err) {
      cases.push({ name, ok: false, detail: (err as Error).message });
    }
  };

  const textFile = path.join(root, 'nested', 'deep', 'note.txt');
  const jsonFile = path.join(root, 'project.json');
  const binFile = path.join(root, 'pixel.bin');
  const copied = path.join(root, 'copy', 'note.txt');
  const renamed = path.join(root, 'copy', 'note-renamed.txt');
  const payload = 'hello 世界\nline2';

  await check('writeText 自动建父目录', async () => {
    const r = await fsops.writeText(textFile, payload);
    if (r.bytes !== Buffer.byteLength(payload, 'utf8')) throw new Error(`字节数不符：${r.bytes}`);
    if (!r.created) throw new Error('应标记为新建');
  });

  await check('readText 往返一致', async () => {
    const got = await fsops.readText(textFile);
    if (got !== payload) throw new Error('内容不一致');
  });

  await check('writeJson / readJson', async () => {
    await fsops.writeJson(jsonFile, { a: 1, b: ['x'], 中文: true });
    const back = await fsops.readJson<{ a: number; 中文: boolean }>(jsonFile);
    if (back.a !== 1 || back.中文 !== true) throw new Error('反序列化值不对');
  });

  await check('readJson 坏文件给出 EJSONPARSE', async () => {
    const bad = path.join(root, 'bad.json');
    await fsops.writeText(bad, '{oops');
    try {
      await fsops.readJson(bad);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EJSONPARSE') throw err;
      return;
    }
    throw new Error('坏 JSON 未报错');
  });

  await check('exists / stat', async () => {
    if (!(await fsops.exists(textFile))) throw new Error('exists 返回 false');
    const st = await fsops.statOf(textFile);
    if (!st || st.kind !== 'file') throw new Error('stat 不对');
    if ((await fsops.statOf(path.join(root, 'nope.txt'))) !== null) throw new Error('缺失文件应返回 null');
  });

  await check('list 递归 + 扩展名过滤', async () => {
    const all = await fsops.listDir(root, { recursive: true });
    if (all.length < 3) throw new Error(`条目太少：${all.length}`);
    const jsonOnly = await fsops.listDir(root, { recursive: true, extensions: ['json'] });
    if (!jsonOnly.every((e) => e.ext === 'json')) throw new Error('扩展名过滤失效');
    if (!jsonOnly.some((e) => e.name === 'project.json')) throw new Error('未找到 project.json');
    const dirs = await fsops.listDir(root, { recursive: true, includeDirs: true });
    if (!dirs.some((e) => e.kind === 'dir' && e.name === 'nested')) throw new Error('目录未列出');
  });

  await check('tree 目录树', async () => {
    const t = await fsops.treeOf(root, { depth: 3, includeFiles: true });
    if (t.kind !== 'dir' || !t.children || t.children.length === 0) throw new Error('树为空');
    const flat: string[] = [];
    const walk = (n: typeof t) => {
      flat.push(n.rel);
      n.children?.forEach(walk);
    };
    walk(t);
    if (!flat.some((r) => r.endsWith('note.txt'))) throw new Error('树里缺 note.txt');
  });

  await check('copy / rename', async () => {
    await fsops.copyPath(textFile, copied);
    if ((await fsops.readText(copied)) !== payload) throw new Error('复制内容不对');
    await fsops.renamePath(copied, renamed);
    if (!(await fsops.exists(renamed))) throw new Error('重命名失败');
    if (await fsops.exists(copied)) throw new Error('旧路径仍存在');
  });

  await check('hash 稳定', async () => {
    const a = await fsops.hashFile(textFile);
    const b = await fsops.hashFile(textFile);
    if (a !== b || a.length !== 64) throw new Error('hash 不稳定');
  });

  await check('二进制读写', async () => {
    const base64 = Buffer.from([0, 1, 2, 250, 255]).toString('base64');
    await fsops.writeBinary(binFile, base64);
    const back = await fsops.readBinary(binFile);
    if (back.base64 !== base64) throw new Error('二进制不一致');
    if (back.mime !== 'application/octet-stream') throw new Error(`mime 不对：${back.mime}`);
  });

  await check('trash 走系统回收站', async () => {
    const tmp = path.join(root, 'to-trash.txt');
    await fsops.writeText(tmp, 'bye');
    await shell.trashItem(tmp);
    if (await fsops.exists(tmp)) throw new Error('文件未移走');
  });

  await check('remove 递归删除', async () => {
    await fsops.removePath(root);
    if (await fsops.exists(root)) throw new Error('目录仍在');
  });

  const failed = cases.filter((c) => !c.ok);
  console.log('\n========== desk selftest ==========');
  for (const c of cases) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
  }
  console.log(`-----------------------------------`);
  console.log(`${cases.length - failed.length}/${cases.length} passed\n`);
  return failed.length === 0;
}
