/**
 * 纯 Node 的文件/文件夹操作 —— 不 import electron，便于单测与被其它入口复用。
 * 所有路径都先 resolve 成绝对路径，失败抛带 code 的 Error，由 IPC 层统一包装。
 */
import fsp from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import type {
  BinaryResult,
  FileEntry,
  FileStat,
  ListOptions,
  ReadOptions,
  TreeNode,
  WriteOptions,
  WriteResult,
} from '../../src/shared/ipc';

/** 永远跳过的重目录，避免一开工程就扫爆 */
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg']);

export function fail(code: string, message: string, p?: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  if (p) err.path = p;
  return err;
}

export function resolvePath(p: string): string {
  if (typeof p !== 'string' || p.trim() === '') throw fail('EINVAL', '路径为空');
  if (p.includes('\0')) throw fail('EINVAL', '路径包含非法字符');
  return path.resolve(p);
}

export function mimeOf(p: string): string {
  const ext = path.extname(p).slice(1).toLowerCase();
  const table: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    json: 'application/json; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
  };
  return table[ext] ?? 'application/octet-stream';
}

/* ------------------------------------------------------------------ */
/* 读                                                                  */
/* ------------------------------------------------------------------ */

export async function readText(p: string, opts: ReadOptions = {}): Promise<string> {
  const abs = resolvePath(p);
  const buf = await fsp.readFile(abs);
  if (opts.encoding === 'base64') return buf.toString('base64');
  const text = buf.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export async function readJson<T = unknown>(p: string): Promise<T> {
  const abs = resolvePath(p);
  const text = await readText(abs);
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const msg = (err as Error).message;
    throw fail('EJSONPARSE', `JSON 解析失败：${path.basename(abs)} — ${msg}`, abs);
  }
}

export async function readBinary(p: string): Promise<BinaryResult> {
  const abs = resolvePath(p);
  const buf = await fsp.readFile(abs);
  return { base64: buf.toString('base64'), size: buf.byteLength, mime: mimeOf(abs) };
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(resolvePath(p));
    return true;
  } catch {
    return false;
  }
}

export async function statOf(p: string): Promise<FileStat | null> {
  const abs = resolvePath(p);
  try {
    const st = await fsp.stat(abs);
    return {
      path: abs,
      kind: st.isDirectory() ? 'dir' : 'file',
      size: st.size,
      mtime: st.mtimeMs,
      ctime: st.ctimeMs,
      readonly: (st.mode & 0o200) === 0,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* 写                                                                  */
/* ------------------------------------------------------------------ */

export async function writeText(p: string, content: string, opts: WriteOptions = {}): Promise<WriteResult> {
  const abs = resolvePath(p);
  if (typeof content !== 'string') throw fail('EINVAL', '内容必须是字符串', abs);

  const created = !(await exists(abs));
  if (opts.mkdirp !== false) await fsp.mkdir(path.dirname(abs), { recursive: true });
  if (opts.backup && !created) {
    try {
      await fsp.copyFile(abs, `${abs}.bak`);
    } catch {
      /* 备份失败不阻塞主流程 */
    }
  }

  if (opts.atomic === false) {
    await fsp.writeFile(abs, content, 'utf8');
  } else {
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    try {
      await fsp.writeFile(tmp, content, 'utf8');
      await fsp.rename(tmp, abs);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }
  return { path: abs, bytes: Buffer.byteLength(content, 'utf8'), created };
}

export async function writeJson(p: string, data: unknown, opts: WriteOptions = {}): Promise<WriteResult> {
  const indent = opts.indent ?? 2;
  let text: string;
  try {
    text = JSON.stringify(data, null, indent) + '\n';
  } catch (err) {
    throw fail('EJSONSTRINGIFY', `JSON 序列化失败：${(err as Error).message}`);
  }
  return writeText(p, text, opts);
}

export async function writeBinary(p: string, base64: string, opts: WriteOptions = {}): Promise<WriteResult> {
  const abs = resolvePath(p);
  if (typeof base64 !== 'string') throw fail('EINVAL', 'base64 内容无效', abs);
  const buf = Buffer.from(base64, 'base64');
  const created = !(await exists(abs));
  if (opts.mkdirp !== false) await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buf);
  return { path: abs, bytes: buf.byteLength, created };
}

/* ------------------------------------------------------------------ */
/* 目录                                                                */
/* ------------------------------------------------------------------ */

function makeEntry(abs: string, kind: 'file' | 'dir', root: string, size: number, mtime: number): FileEntry {
  return {
    path: abs,
    name: path.basename(abs),
    kind,
    rel: path.relative(root, abs).split(path.sep).join('/'),
    ext: kind === 'dir' ? '' : path.extname(abs).slice(1).toLowerCase(),
    size,
    mtime,
  };
}

export async function listDir(root: string, opts: ListOptions = {}): Promise<FileEntry[]> {
  const absRoot = resolvePath(root);
  const st = await fsp.stat(absRoot);
  if (!st.isDirectory()) throw fail('ENOTDIR', `不是文件夹：${absRoot}`, absRoot);

  const exts = opts.extensions?.length
    ? new Set(opts.extensions.map((e) => e.toLowerCase().replace(/^\./, '')))
    : null;
  const includeFiles = opts.includeFiles !== false;
  const includeDirs = opts.includeDirs === true;
  const includeHidden = opts.includeHidden === true;
  const maxDepth = opts.recursive ? opts.depth ?? 8 : 0;
  const limit = opts.limit ?? 20000;

  const dirsOut: FileEntry[] = [];
  const filePaths: string[] = [];
  const seen = new Set<string>();

  async function walk(dir: string, depth: number): Promise<void> {
    if (dirsOut.length + filePaths.length >= limit) return;
    let ents;
    try {
      ents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      const full = path.join(dir, ent.name);
      if (seen.has(full)) continue;
      seen.add(full);

      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        if (!includeHidden && ent.name.startsWith('.')) continue;
        if (includeDirs) dirsOut.push(makeEntry(full, 'dir', absRoot, 0, 0));
        if (depth < maxDepth) await walk(full, depth + 1);
        continue;
      }

      if (!includeFiles) continue;
      if (!includeHidden && ent.name.startsWith('.')) continue;
      const ext = path.extname(ent.name).slice(1).toLowerCase();
      if (exts && !exts.has(ext)) continue;
      filePaths.push(full);
      if (dirsOut.length + filePaths.length >= limit) return;
    }
  }

  await walk(absRoot, 0);

  // 批量 stat，避免大目录串行 IO
  const files: FileEntry[] = [];
  const CHUNK = 128;
  for (let i = 0; i < filePaths.length; i += CHUNK) {
    const slice = filePaths.slice(i, i + CHUNK);
    const stats = await Promise.all(
      slice.map(async (f) => {
        try {
          const s = await fsp.stat(f);
          return makeEntry(f, 'file', absRoot, s.size, s.mtimeMs);
        } catch {
          return null;
        }
      }),
    );
    for (const s of stats) if (s) files.push(s);
  }

  const sort = opts.sort ?? 'name';
  const cmp = (a: FileEntry, b: FileEntry) => {
    if (opts.dirsFirst && a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    if (sort === 'mtime') return b.mtime - a.mtime;
    if (sort === 'size') return b.size - a.size;
    return a.rel.localeCompare(b.rel, 'zh-Hans-CN', { numeric: true });
  };

  return [...dirsOut, ...files].sort(cmp);
}

export async function treeOf(root: string, opts: ListOptions = {}): Promise<TreeNode> {
  const absRoot = resolvePath(root);
  const st = await fsp.stat(absRoot);
  if (!st.isDirectory()) throw fail('ENOTDIR', `不是文件夹：${absRoot}`, absRoot);

  const depthLimit = opts.depth ?? 4;
  const includeHidden = opts.includeHidden === true;
  const includeFiles = opts.includeFiles === true;
  const exts = opts.extensions?.length
    ? new Set(opts.extensions.map((e) => e.toLowerCase().replace(/^\./, '')))
    : null;

  async function walk(dir: string, rel: string, depth: number): Promise<TreeNode> {
    const node: TreeNode = {
      path: dir,
      name: path.basename(dir) || dir,
      kind: 'dir',
      rel,
      children: [],
    };
    if (depth >= depthLimit) {
      delete node.children;
      return node;
    }
    let ents;
    try {
      ents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      delete node.children;
      return node;
    }
    ents.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }));
    for (const ent of ents) {
      if (!includeHidden && ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        node.children!.push(await walk(full, childRel, depth + 1));
      } else if (includeFiles) {
        const ext = path.extname(ent.name).slice(1).toLowerCase();
        if (exts && !exts.has(ext)) continue;
        node.children!.push({ path: full, name: ent.name, kind: 'file', rel: childRel });
      }
    }
    return node;
  }

  return walk(absRoot, '', 0);
}

export async function mkdirp(p: string): Promise<string> {
  const abs = resolvePath(p);
  await fsp.mkdir(abs, { recursive: true });
  return abs;
}

export async function renamePath(from: string, to: string): Promise<string> {
  const a = resolvePath(from);
  const b = resolvePath(to);
  await fsp.mkdir(path.dirname(b), { recursive: true });
  await fsp.rename(a, b);
  return b;
}

export async function copyPath(from: string, to: string): Promise<string> {
  const a = resolvePath(from);
  const b = resolvePath(to);
  await fsp.mkdir(path.dirname(b), { recursive: true });
  await fsp.cp(a, b, { recursive: true, force: true, errorOnExist: false });
  return b;
}

export async function removePath(p: string): Promise<void> {
  const abs = resolvePath(p);
  await fsp.rm(abs, { recursive: true, force: true, maxRetries: 3 });
}

export async function hashFile(p: string): Promise<string> {
  const abs = resolvePath(p);
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = createReadStream(abs);
    s.on('error', reject);
    s.on('data', (chunk) => h.update(chunk));
    s.on('end', () => resolve(h.digest('hex')));
  });
}
