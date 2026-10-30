import { PartDef } from './types';

interface Props {
  parts: PartDef[];
  selected: string[];
  onSelect: (ids: string[]) => void;
}

export function PartTree({ parts, selected, onSelect }: Props) {
  const grouped = [
    { label: '背部层', ids: ['backpack', 'cape'] },
    { label: '身体主体', ids: ['body', 'torso_U', 'torso_L', 'neck'] },
    { label: '手臂', ids: ['upper_arm_L', 'upper_arm_R', 'forearm_L', 'forearm_R'] },
    { label: '腿', ids: ['thigh_L', 'thigh_R', 'calf_L', 'calf_R'] },
    { label: '头 & 装备', ids: ['head', 'hat', 'weapon', 'gloves', 'shoes'] },
  ];
  const allIds = new Set(parts.map(p => p.id));
  return (
    <div style={{ padding: 8 }}>
      <div style={{ fontWeight: 600, marginBottom: 8, opacity: .8 }}>部件</div>
      {grouped.map(g => {
        const visible = g.ids.filter(id => allIds.has(id));
        if (visible.length === 0) return null;
        return (
          <div key={g.label} style={{ marginBottom: 8 }}>
            <div style={{ opacity: .5, fontSize: 11, padding: '2px 4px' }}>{g.label}</div>
            {visible.map(id => {
              const p = parts.find(x => x.id === id)!;
              const sel = selected.includes(id);
              return (
                <div
                  key={id}
                  onClick={() => onSelect(sel ? selected.filter(x => x !== id) : [...selected, id])}
                  style={{
                    padding: '4px 10px',
                    cursor: 'pointer',
                    background: sel ? '#3b5' : 'transparent',
                    borderRadius: 4,
                    userSelect: 'none',
                  }}
                >
                  {p.label} <span style={{ opacity: .4, fontSize: 11 }}>{id}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
