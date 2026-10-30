/**
 * PartTree —— 部件层级树：按 PartDef.parent 缩进展示，点选节点；
 * 有子节点的项可以收起/展开（▸/▾）。
 */
import { useState } from 'react';
import { PartDef } from './types';

interface Props {
  parts: PartDef[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function PartTree({ parts, selectedId, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const childrenOf = new Map<string | null, PartDef[]>();
  for (const p of parts) {
    const key = p.parent && parts.some(x => x.id === p.parent) ? p.parent : null;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(p);
  }

  const toggle = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const renderNode = (p: PartDef, depth: number): React.ReactNode => {
    const sel = selectedId === p.id;
    const kids = collapsed.has(p.id) ? [] : (childrenOf.get(p.id) ?? []);
    const hasKids = (childrenOf.get(p.id) ?? []).length > 0;
    return (
      <div key={p.id}>
        <div
          onClick={() => onSelect(p.id)}
          style={{
            padding: '4px 8px',
            paddingLeft: 4 + depth * 14,
            cursor: 'pointer',
            background: sel ? '#3b5' : 'transparent',
            borderRadius: 4,
            userSelect: 'none',
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          {/* 收起/展开箭头 */}
          <span
            onClick={e => { if (hasKids) { e.stopPropagation(); toggle(p.id); } }}
            style={{
              width: 14, flexShrink: 0, textAlign: 'center', fontSize: 10,
              cursor: hasKids ? 'pointer' : 'default', opacity: hasKids ? 0.9 : 0.2,
            }}
            title={hasKids ? (collapsed.has(p.id) ? '展开子节点' : '收起子节点') : ''}
          >
            {hasKids ? (collapsed.has(p.id) ? '▸' : '▾') : '·'}
          </span>
          <span style={{
            width: 8, height: 8, borderRadius: 2, flexShrink: 0,
            background: p.texturePath ? '#6cf' : '#666',
          }} title={p.texturePath ? '已设置贴图' : '未设置贴图'} />
          <span>{p.label}</span>
          <span style={{ opacity: .35, fontSize: 10 }}>{p.id}</span>
          {p.overlay && <span style={{ fontSize: 9, color: '#6cf' }} title="有覆盖贴图">▣</span>}
        </div>
        {kids.map(k => renderNode(k, depth + 1))}
      </div>
    );
  };

  return (
    <div style={{ padding: 8 }}>
      <div style={{ fontWeight: 600, marginBottom: 8, opacity: .8, display: 'flex', alignItems: 'center' }}>
        <span style={{ flex: 1 }}>部件层级</span>
        <button
          onClick={() => setCollapsed(new Set())}
          style={{ background: 'transparent', border: 'none', color: '#8a8a92', fontSize: 10, cursor: 'pointer' }}
          title="展开全部"
        >全部展开</button>
      </div>
      {(childrenOf.get(null) ?? []).map(p => renderNode(p, 0))}
    </div>
  );
}
