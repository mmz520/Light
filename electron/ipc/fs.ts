import { shell } from 'electron';

import { CH } from '../../src/shared/ipc';
import type { ListOptions, ReadOptions, WriteOptions } from '../../src/shared/ipc';
import * as fsops from '../lib/fsops';
import { handle } from '../lib/ipc';

export function registerFsIpc(): void {
  handle(CH.fsReadText, (p: string, opts?: ReadOptions) => fsops.readText(p, opts));
  handle(CH.fsReadJson, (p: string) => fsops.readJson(p));
  handle(CH.fsWriteText, (p: string, content: string, opts?: WriteOptions) => fsops.writeText(p, content, opts));
  handle(CH.fsWriteJson, (p: string, data: unknown, opts?: WriteOptions) => fsops.writeJson(p, data, opts));
  handle(CH.fsExists, (p: string) => fsops.exists(p));
  handle(CH.fsStat, (p: string) => fsops.statOf(p));
  handle(CH.fsList, (p: string, opts?: ListOptions) => fsops.listDir(p, opts));
  handle(CH.fsTree, (p: string, opts?: ListOptions) => fsops.treeOf(p, opts));
  handle(CH.fsMkdirp, (p: string) => fsops.mkdirp(p));
  handle(CH.fsRename, (from: string, to: string) => fsops.renamePath(from, to));
  handle(CH.fsCopy, (from: string, to: string) => fsops.copyPath(from, to));
  handle(CH.fsRemove, (p: string) => fsops.removePath(p));
  handle(CH.fsReadBinary, (p: string) => fsops.readBinary(p));
  handle(CH.fsWriteBinary, (p: string, base64: string) => fsops.writeBinary(p, base64));
  handle(CH.fsHash, (p: string) => fsops.hashFile(p));

  // 安全删除：走系统回收站，误删可还原
  handle(CH.fsTrash, async (paths: string | string[]) => {
    const list = Array.isArray(paths) ? paths : [paths];
    for (const p of list) {
      await shell.trashItem(fsops.resolvePath(p));
    }
  });
}
