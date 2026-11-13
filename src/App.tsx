import { EditorApp } from '@/editor/EditorApp';
import { PopupWindow } from '@/editor/popup/PopupWindow';
import type { EditorWindowKind } from '@/shared/ipc';

const POPUP_KINDS: EditorWindowKind[] = ['animation', 'statemachine', 'controller', 'script', 'help'];

/**
 * 入口分流：
 *   ?pop=<kind>&ref=<id>  → 独立编辑器窗口（真实 OS 窗口，由主进程打开）
 *   其它                  → 正常的主编辑器界面
 */
export default function App() {
  const params = new URLSearchParams(window.location.search);
  const pop = params.get('pop');
  const ref = params.get('ref') ?? '';
  if (pop && ref && (POPUP_KINDS as string[]).includes(pop)) {
    return <PopupWindow kind={pop as EditorWindowKind} refId={ref} />;
  }
  return <EditorApp />;
}
