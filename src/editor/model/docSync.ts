/**
 * 多窗口文档同步（浏览器版无副作用）。
 *
 * 主窗口和每个独立编辑器窗口都跑同一套 store：
 *   - 本地改动 → 节流 60ms 后把工程快照推给主进程 → 主进程转发给其它窗口；
 *   - 收到别人的快照 → store.applyRemote（记一步历史、不回推）。
 * 快照是整份 ProjectDoc 的 JSON，够简单也不会出现增量补丁对不齐的问题；
 * 拖动关键帧这种高频改动靠节流压到 ~16 次/秒。
 */
import { useEffect } from 'react';
import type { ProjectDoc } from './types';
import { editorStore } from './store';
import { desk, isDesktop } from '../../platform/desk';

export function useDocSync(): void {
  // 推送本地改动
  useEffect(() => {
    if (!isDesktop) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingDoc: ProjectDoc | null = null;
    const off = editorStore.onProjectChange((p) => {
      pendingDoc = p;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const doc = pendingDoc;
        pendingDoc = null;
        if (doc) void desk.editorWindow.pushDoc(doc);
      }, 60);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, []);

  // 应用别人的改动
  useEffect(() => {
    if (!isDesktop) return;
    return desk.editorWindow.onDoc((project) => {
      if (project && typeof project === 'object') editorStore.applyRemote(project as ProjectDoc);
    });
  }, []);
}
