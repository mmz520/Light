import { BrowserWindow, dialog } from 'electron';

import { CH } from '../../src/shared/ipc';
import type { MessageBoxOptions, OpenDialogOptions, SaveDialogOptions } from '../../src/shared/ipc';
import { handle } from '../lib/ipc';

function parentWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

export function registerDialogIpc(): void {
  /** 返回选中的路径数组；取消返回空数组（不视为错误） */
  handle(CH.dialogOpen, async (opts: OpenDialogOptions = {}) => {
    const win = parentWindow();
    const properties: Array<'openFile' | 'openDirectory' | 'multiSelections'> = [
      opts.directory ? 'openDirectory' : 'openFile',
    ];
    if (opts.multi) properties.push('multiSelections');

    const res = await (win
      ? dialog.showOpenDialog(win, {
          title: opts.title,
          defaultPath: opts.defaultPath,
          filters: opts.filters,
          properties,
        })
      : dialog.showOpenDialog({
          title: opts.title,
          defaultPath: opts.defaultPath,
          filters: opts.filters,
          properties,
        }));

    return res.canceled ? [] : res.filePaths;
  });

  handle(CH.dialogSave, async (opts: SaveDialogOptions = {}) => {
    const win = parentWindow();
    const target = opts.defaultPath ?? opts.defaultName;
    const res = await (win
      ? dialog.showSaveDialog(win, { title: opts.title, defaultPath: target, filters: opts.filters })
      : dialog.showSaveDialog({ title: opts.title, defaultPath: target, filters: opts.filters }));
    return res.canceled || !res.filePath ? null : res.filePath;
  });

  handle(CH.dialogMessage, async (opts: MessageBoxOptions) => {
    const win = parentWindow();
    const payload = {
      type: opts.type ?? ('info' as const),
      title: opts.title,
      message: opts.message,
      detail: opts.detail,
      buttons: opts.buttons ?? ['确定'],
      defaultId: opts.defaultId ?? 0,
      cancelId: opts.cancelId,
      noLink: true,
    };
    const res = win ? await dialog.showMessageBox(win, payload) : await dialog.showMessageBox(payload);
    return res.response;
  });
}
