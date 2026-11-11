import fs from 'node:fs';
import path from 'node:path';

import { CH } from '../../src/shared/ipc';
import type { WatchChangeType, WatchEvent, WatchOptions } from '../../src/shared/ipc';
import { resolvePath } from '../lib/fsops';
import { handle } from '../lib/ipc';
import { broadcast } from './app';

interface WatchHandle {
  close: () => void;
}

const watchers = new Map<string, WatchHandle>();
let seq = 0;

export function registerWatchIpc(): void {
  handle(CH.watchStart, async (root: string, opts: WatchOptions = {}) => {
    const abs = resolvePath(root);
    const id = `w${++seq}`;
    const exts = opts.extensions?.length
      ? new Set(opts.extensions.map((e) => e.toLowerCase().replace(/^\./, '')))
      : null;
    const debounceMs = opts.debounce ?? 120;
    const pending = new Map<string, WatchEvent>();
    let timer: NodeJS.Timeout | null = null;

    const flush = () => {
      timer = null;
      if (pending.size === 0) return;
      const batch = [...pending.values()];
      pending.clear();
      broadcast(CH.watchEvent, batch);
    };

    const watcher = fs.watch(abs, { recursive: opts.recursive !== false }, (_event, filename) => {
      if (!filename) return;
      const full = path.resolve(abs, filename.toString());
      // 工程根可能包含 node_modules，递归监听时噪声极大，直接忽略
      if (/(^|[\\/])(node_modules|\.git|dist|dist-electron)([\\/]|$)/.test(full)) return;
      const ext = path.extname(full).slice(1).toLowerCase();
      if (exts && !exts.has(ext)) return;

      let type: WatchChangeType = 'change';
      try {
        // 文件不存在 = 被删除；存在但最近创建（这里退化为 change）
        type = fs.existsSync(full) ? 'change' : 'unlink';
      } catch {
        type = 'change';
      }

      pending.set(full, {
        watchId: id,
        type,
        path: full,
        rel: path.relative(abs, full).split(path.sep).join('/'),
      });
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    });

    watcher.on('error', () => {
      /* 目录被删时主动关闭 */
      watchers.delete(id);
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
    });

    watchers.set(id, {
      close: () => {
        if (timer) clearTimeout(timer);
        timer = null;
        pending.clear();
        watcher.close();
      },
    });

    return id;
  });

  handle(CH.watchStop, async (id: string) => {
    const w = watchers.get(id);
    if (w) {
      w.close();
      watchers.delete(id);
    }
  });
}

export function closeAllWatchers(): void {
  for (const [, w] of watchers) {
    try {
      w.close();
    } catch {
      /* ignore */
    }
  }
  watchers.clear();
}
