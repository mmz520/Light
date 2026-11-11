/**
 * 左侧「场景对象」面板 —— 当前场景里有哪些东西
 *
 * 树形列表：空节点用来分组，其余四种是真实对象。
 * 拖拽一行可以改顺序（上下）或改层级（拖进某个节点的中间），
 * 右键有新建 / 重命名 / 复制 / 粘贴 / 删除，快捷键见底部提示。
 */
import { useMemo, useRef, useState } from 'react';
import { editorStore, useEditor } from '../model/store';
import { childrenOf, flattenScene } from '../model/scene';
import { SCENE_KINDS, sceneKindMeta, type ProjectDoc, type SceneNode } from '../model/types';
import { ContextMenu, type MenuItem } from './Menu';
import { SceneIcon } from './SceneIcons';
import { T } from './theme';

interface Props {
  project: ProjectDoc;
  onRenameScene: (node: SceneNode) => void;
}

type DropPos = 'before' | 'after' | 'inside';

export function Hierarchy({ project, onRenameScene }: Props) {
  const { sceneSelection, sceneClipboard } = useEditor();
  const rows = useMemo(() => flattenScene(project.scene), [project.scene]);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: DropPos } | null>(null);
  const dragId = useRef<string | null>(null);

  const openMenu = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const addItems = (parentId: string | null): MenuItem[] =>
    SCENE_KINDS.map((k) => ({
      label: k.name,
      hint: k.id === 'group' ? '分组' : k.id === 'mapui' ? '屏幕UI' : k.id === 'time' || k.id === 'weather' ? '全局' : undefined,
      onClick: () => editorStore.addSceneNode(k.id, undefined, parentId),
    }));

  const nodeMenu = (node: SceneNode): MenuItem[] => [
    { label: '新建子对象', submenu: addItems(node.id) },
    { type: 'sep' },
    { label: '重命名…', hint: 'F2', onClick: () => onRenameScene(node) },
    { label: '复制', hint: 'Ctrl+C', onClick: () => editorStore.copySceneNode(node.id) },
    {
      label: '粘贴到此处',
      hint: 'Ctrl+V',
      disabled: !sceneClipboard,
      onClick: () => editorStore.pasteSceneNode(node.id),
    },
    { label: '复制一份', hint: 'Ctrl+D', onClick: () => editorStore.duplicateSceneNode(node.id) },
    { type: 'sep' },
    { label: '删除', hint: 'Del', danger: true, onClick: () => editorStore.deleteSceneNode(node.id) },
  ];

  const blankMenu = (): MenuItem[] => [
    { label: '新建对象', submenu: addItems(null) },
    { type: 'sep' },
    {
      label: '粘贴',
      hint: 'Ctrl+V',
      disabled: !sceneClipboard,
      onClick: () => editorStore.pasteSceneNode(null),
    },
  ];

  /* ---------------- 拖拽 ---------------- */

  /** 从资源浏览器拖来的脚本 id（text/plain 里是 `script:<id>,...` 这种 refKey 列表） */
  const scriptIdsFrom = (dt: DataTransfer): string[] =>
    (dt.getData('text/plain') || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('script:'))
      .map((s) => s.slice('script:'.length));

  const hasScriptDrag = (dt: DataTransfer): boolean => Array.from(dt.types).includes('application/x-light-asset-script');

  const poseOf = (e: React.DragEvent): DropPos => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / Math.max(1, rect.height);
    return ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'inside';
  };

  const onRowDragOver = (e: React.DragEvent, node: SceneNode) => {
    if (!dragId.current) {
      // 资源浏览器拖来的脚本：挂到这一行上
      if (!hasScriptDrag(e.dataTransfer)) return;
      e.preventDefault();
      // 资源浏览器设的是 effectAllowed = 'move'，dropEffect 必须一致，否则浏览器拒绝放置
      e.dataTransfer.dropEffect = 'move';
      if (drop?.id !== node.id || drop.pos !== 'inside') setDrop({ id: node.id, pos: 'inside' });
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const pos = poseOf(e);
    if (drop?.id !== node.id || drop.pos !== pos) setDrop({ id: node.id, pos });
  };

  const onRowDrop = (e: React.DragEvent, node: SceneNode) => {
    e.preventDefault();
    e.stopPropagation();
    // 脚本资产拖到对象上 = 给这个对象挂脚本（去重追加，可多次拖）
    const scriptIds = scriptIdsFrom(e.dataTransfer);
    if (scriptIds.length > 0) {
      const next = [...(node.scriptIds ?? [])];
      for (const sid of scriptIds) if (!next.includes(sid)) next.push(sid);
      editorStore.setNodeScripts(node.id, next);
      editorStore.selectScene(node.id);
      dragId.current = null;
      setDrop(null);
      return;
    }
    const id = dragId.current;
    const pos = poseOf(e);
    dragId.current = null;
    setDrop(null);
    if (!id || id === node.id) return;
    if (pos === 'inside') {
      editorStore.moveSceneNode(id, node.id, null);
      return;
    }
    const sibs = childrenOf(project.scene, node.parentId);
    const i = sibs.findIndex((s) => s.id === node.id);
    const beforeId = pos === 'before' ? node.id : (sibs[i + 1]?.id ?? null);
    editorStore.moveSceneNode(id, node.parentId, beforeId);
  };

  const childCount = (id: string) => project.scene.filter((n) => n.parentId === id).length;

  return (
    <div
      style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.bg1, minHeight: 0 }}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('[data-scene-row]')) return;
        openMenu(e, blankMenu());
      }}
    >
      <div
        style={{
          height: 30,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 8px 0 10px',
          borderBottom: `1px solid ${T.lineSoft}`,
          background: T.bg2,
        }}
      >
        <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: T.dimmer }}>场景对象</span>
        <span style={{ fontSize: 10.5, color: T.dimmer }}>{project.scene.length}</span>
        <div style={{ flex: 1 }} />
        <button
          title="新增对象"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.left, y: r.bottom + 2, items: blankMenu() });
          }}
          style={{
            width: 18,
            height: 16,
            background: 'transparent',
            border: `1px solid ${T.line}`,
            borderRadius: 3,
            color: T.dim,
            fontSize: 12,
            lineHeight: 1,
            padding: 0,
            cursor: 'pointer',
          }}
        >
          +
        </button>
      </div>

      <div
        style={{ flex: 1, overflow: 'auto', minHeight: 0, paddingBottom: 24 }}
        onDragOver={(e) => {
          if (!dragId.current) return;
          e.preventDefault();
          if (drop) setDrop(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          const id = dragId.current;
          dragId.current = null;
          setDrop(null);
          if (id) editorStore.moveSceneNode(id, null, null);
        }}
      >
        {rows.length === 0 && (
          <div style={{ padding: '18px 14px', textAlign: 'center' }}>
            <div
              style={{
                width: 46,
                height: 46,
                margin: '0 auto 10px',
                borderRadius: 8,
                border: `1px dashed ${T.line}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: T.dimmer,
              }}
            >
              <SceneIcon kind="group" size={20} />
            </div>
            <div style={{ fontSize: 11.5, color: T.dim, marginBottom: 5 }}>场景里还没有对象</div>
            <div style={{ fontSize: 10.5, color: T.dimmer, lineHeight: 1.8 }}>
              在中间场景里右键新增
              <br />
              也可以点右上角的 +
            </div>
          </div>
        )}

        {rows.map(({ node, depth }) => {
          const meta = sceneKindMeta(node.kind);
          const active = sceneSelection === node.id;
          const kids = childCount(node.id);
          const hasKids = kids > 0 || node.kind === 'group';
          const opened = node.open !== false;
          const dropHere = drop?.id === node.id;
          return (
            <div
              key={node.id}
              data-scene-row
              data-node-id={node.id}
              draggable
              onDragStart={(e) => {
                dragId.current = node.id;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', node.id);
              }}
              onDragEnd={() => {
                dragId.current = null;
                setDrop(null);
              }}
              onDragOver={(e) => onRowDragOver(e, node)}
              onDragLeave={() => setDrop((d) => (d?.id === node.id ? null : d))}
              onDrop={(e) => onRowDrop(e, node)}
              onClick={() => editorStore.selectScene(node.id)}
              onDoubleClick={() => onRenameScene(node)}
              onContextMenu={(e) => {
                editorStore.selectScene(node.id);
                openMenu(e, nodeMenu(node));
              }}
              title={`${node.name}（${meta.name}）${meta.desc ? `\n${meta.desc}` : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                height: 24,
                paddingRight: 8,
                paddingLeft: 8 + depth * 13,
                fontSize: 11.5,
                color: active ? T.text : T.dim,
                background: active ? T.sel : 'transparent',
                borderLeft: `2px solid ${active ? T.accent : 'transparent'}`,
                borderTop: dropHere && drop.pos === 'before' ? `1px solid ${T.accent}` : '1px solid transparent',
                borderBottom: dropHere && drop.pos === 'after' ? `1px solid ${T.accent}` : '1px solid transparent',
                boxShadow: dropHere && drop.pos === 'inside' ? `inset 0 0 0 1px ${T.accent}` : 'none',
                cursor: 'default',
                userSelect: 'none',
                position: 'relative',
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = T.bg2;
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = 'transparent';
              }}
            >
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasKids) editorStore.setSceneNodeOpen(node.id, !opened);
                }}
                style={{ width: 9, color: T.dimmer, cursor: hasKids ? 'pointer' : 'default', fontSize: 9 }}
              >
                {hasKids ? (opened ? '▾' : '▸') : ''}
              </span>
              <span style={{ color: meta.color, display: 'flex' }}>
                <SceneIcon kind={node.kind} size={13} />
              </span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
              {kids > 0 && <span style={{ fontSize: 10, color: T.dimmer }}>{kids}</span>}
            </div>
          );
        })}
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: '6px 10px',
          borderTop: `1px solid ${T.lineSoft}`,
          fontSize: 10.5,
          color: T.dimmer,
          lineHeight: 1.7,
        }}
      >
        拖拽改顺序 / 拖到行中间改层级 · Del 删除 · Ctrl+C/V 复制粘贴
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
