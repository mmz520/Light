import { Clip, LoopMode } from './types';

interface Props {
  clip: Clip;
  allClips: Record<string, Clip>;
  activeClipName: string;
  onSwitch: (name: string) => void;
  onAdd: () => void;
  onDelete: () => void;
  onUpdate: (name: string, mut: (c: Clip) => Clip) => void;
}

export function ClipPanel({ clip, allClips, activeClipName, onSwitch, onAdd, onDelete }: Props) {
  const names = Object.keys(allClips);
  return (
    <div style={{ padding: 12, borderBottom: '1px solid #333' }}>
      <div style={{ fontSize: 11, opacity: .6, marginBottom: 6 }}>动画 Clip</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {names.map(n => (
          <button key={n} onClick={() => onSwitch(n)} style={{
            padding: '3px 10px', borderRadius: 4, border: '1px solid #444',
            background: n === activeClipName ? '#4b7' : 'transparent',
            color: n === activeClipName ? '#000' : '#e4e4e8',
            fontSize: 12, cursor: 'pointer',
          }}>
            {n}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
        <button onClick={onAdd} style={SMALL}>+ 新增</button>
        <button onClick={onDelete} style={{ ...SMALL, background: '#732' }}>删除</button>
      </div>
      <div style={{ fontSize: 10, opacity: .45, marginTop: 6 }}>
        {clip.duration.toFixed(2)}s · {clip.loop} · {clip.tracks.length} tracks
      </div>
    </div>
  );
}

const SMALL: React.CSSProperties = {
  padding: '3px 8px', fontSize: 11, background: '#3a6', color: '#fff',
  border: 'none', borderRadius: 3, cursor: 'pointer',
};
// 把 LoopMode 作为 re-export 类型（避免 TS 未使用告警）
export type _Lm = LoopMode;
