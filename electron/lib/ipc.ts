import { ipcMain } from 'electron';

import type { DeskErrorInfo, DeskResult } from '../../src/shared/ipc';

export function toErrorInfo(err: unknown): DeskErrorInfo {
  const e = err as NodeJS.ErrnoException;
  return {
    code: (e && e.code) || 'EUNKNOWN',
    message: (e && e.message) || String(err),
    path: e && e.path ? String(e.path) : undefined,
  };
}

/** 统一注册 invoke 通道：永不抛异常，一律返回 DeskResult */
export function handle<TArgs extends unknown[], TResult>(
  channel: string,
  fn: (...args: TArgs) => TResult | Promise<TResult>,
): void {
  ipcMain.handle(channel, async (_evt, ...args) => {
    try {
      return { ok: true as const, data: await fn(...(args as unknown as TArgs)) };
    } catch (err) {
      return { ok: false as const, error: toErrorInfo(err) };
    }
  });
}

export type { DeskResult };
