/**
 * useHistory —— 可撤销状态的通用 Hook（快照式，结构性共享，不深拷贝）
 *
 * 设计要点：
 *   · 所有写入走 set(next, mergeKey?)，每次写入把旧值压入 past 栈、清空 future；
 *   · mergeKey 相同且间隔 < MERGE_WINDOW_MS 的连续写入合并为一步 —— 拖拽 gizmo、
 *     连续拖关键帧这类高频操作只产生一条历史记录，回退时一次到位；
 *   · undo / redo 在 past / future 两个栈之间搬移当前值；
 *   · reset 用于"换文档"（启动加载 / 导入文件），清空历史。
 *
 * 数据为不可变更新（spread），快照间共享未改动的子树，内存开销远低于深拷贝。
 */
import { useCallback, useRef, useState } from 'react';

/** 历史最大步数（超出丢弃最早的记录） */
const MAX_HISTORY = 120;
/** 同一 mergeKey 的连续写入在此时间窗内合并为一步 */
const MERGE_WINDOW_MS = 600;

interface HistoryRefs<T> {
  past: T[];
  future: T[];
  lastKey: string | null;
  lastAt: number;
}

export interface HistoryApi<T> {
  value: T | null;
  /** 写入新值；mergeKey 用于合并连续手势 */
  set: (next: T | ((prev: T | null) => T | null), mergeKey?: string) => void;
  undo: () => void;
  redo: () => void;
  /** 换文档：直接设置并清空历史 */
  reset: (v: T | null) => void;
  canUndo: boolean;
  canRedo: boolean;
  /** 可回退步数（用于调试 / 状态显示） */
  undoDepth: number;
  redoDepth: number;
}

export function useHistory<T>(initial: T | null = null): HistoryApi<T> {
  const [value, setValue] = useState<T | null>(initial);
  const valueRef = useRef<T | null>(initial);
  const hist = useRef<HistoryRefs<T>>({ past: [], future: [], lastKey: null, lastAt: 0 });
  /** 仅用于触发"栈深度变化"时的重渲染（值本身未变时也需要刷新按钮可用态） */
  const [, forceRender] = useState(0);

  const set = useCallback((next: T | ((prev: T | null) => T | null), mergeKey?: string) => {
    const prev = valueRef.current;
    const val = typeof next === 'function' ? (next as (p: T | null) => T | null)(prev) : next;
    if (val == null || val === prev) return;

    const now = Date.now();
    const h = hist.current;
    const merge = mergeKey != null && mergeKey === h.lastKey && now - h.lastAt < MERGE_WINDOW_MS;

    if (prev != null) {
      if (!merge) {
        h.past.push(prev);
        if (h.past.length > MAX_HISTORY) h.past.shift();
      }
      h.future.length = 0;
    }
    h.lastKey = mergeKey ?? null;
    h.lastAt = now;

    valueRef.current = val;
    setValue(val);
    forceRender(n => n + 1);
  }, []);

  const undo = useCallback(() => {
    const h = hist.current;
    const prev = h.past.pop();
    if (prev === undefined) return;
    if (valueRef.current != null) h.future.push(valueRef.current);
    h.lastKey = null;
    valueRef.current = prev;
    setValue(prev);
    forceRender(n => n + 1);
  }, []);

  const redo = useCallback(() => {
    const h = hist.current;
    const next = h.future.pop();
    if (next === undefined) return;
    if (valueRef.current != null) h.past.push(valueRef.current);
    h.lastKey = null;
    valueRef.current = next;
    setValue(next);
    forceRender(n => n + 1);
  }, []);

  const reset = useCallback((v: T | null) => {
    hist.current = { past: [], future: [], lastKey: null, lastAt: 0 };
    valueRef.current = v;
    setValue(v);
    forceRender(n => n + 1);
  }, []);

  return {
    value,
    set,
    undo,
    redo,
    reset,
    canUndo: hist.current.past.length > 0,
    canRedo: hist.current.future.length > 0,
    undoDepth: hist.current.past.length,
    redoDepth: hist.current.future.length,
  };
}
