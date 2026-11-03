/**
 * LocalAnimPanel —— 右侧属性面板的"局部动画"区
 *
 * · 列出当前 clip 的全部局部动画（循环的带 ∞ 标记，点击可选中编辑）
 * · 选中后编辑：名称 / 节点 / 起始时间 / 循环 / fps（帧图型）/ 时长（关键帧型）
 * · 关键帧型：在视口/属性里改 pose 后用"记录关键帧"写入局部时间点
 */
import { LocalAnim, localAnimDuration, PartDef, PartPose } from './types';

interface Props {
  locals: LocalAnim[];
  parts: PartDef[];
  selected: LocalAnim | null;
  cursorT: number;
  /** 选中局部动画节点的当前 pose（记录关键帧用） */
  sampledPose: PartPose | null;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, mut: (a: LocalAnim) => LocalAnim) => void;
  onDelete: (id: string) => void;
  onRecordKey: (id: string) => void;
  onDeleteKey: (id: string, t: number) => void;
  onEditFrames: (a: LocalFrames) => void;
  onAdd: () => void;
}

type LocalFrames = Extract<LocalAnim, { kind: 'frames' }>;

export function LocalAnimPanel({
  locals, parts, selected, cursorT, sampledPose, onSelect, onUpdate, onDelete, onRecordKey, onDeleteKey, onEditFrames, onAdd,
}: Props) {
  const label: React.CSSProperties = { fontSize: 11, color: '#9a9aa2', flexShrink: 0, width: 52 };
  const input: React.CSSProperties = {
    background: '#1a1a1e', border: '1px solid #444', borderRadius: 4,
    color: '#ddd', fontSize: 12, padding: '3px 6px', fontFamily: 'inherit', width: 70,
  };
  const btn: React.CSSProperties = {
    padding: '3px 8px', fontSize: 11, cursor: 'pointer', borderRadius: 4,
    border: '1px solid #444', background: '#2a2a30', color: '#ccc', fontFamily: 'inherit',
  };

  const partLabel = (id: string) => parts.find(p => p.id === id)?.label ?? id;

  return (
    <div style={{ borderTop: '1px solid #333', background: '#232327', padding: '8px 10px' }}>
      {/* 标题 + 列表 */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <b style={{ fontSize: 12 }}>局部动画</b>
        <span style={{ fontSize: 10, opacity: .45, marginLeft: 6 }}>{locals.length}</span>
        <button onClick={onAdd} style={{ ...btn, marginLeft: 'auto', color: '#5d5', borderColor: '#3a8a3a' }}>＋ 新建</button>
      </div>
      {locals.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: selected ? 8 : 0 }}>
          {locals.map(a => {
            const active = selected?.id === a.id;
            return (
              <div
                key={a.id}
                onClick={() => onSelect(active ? null : a.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px',
                  borderRadius: 4, cursor: 'pointer', fontSize: 11,
                  background: active ? '#173242' : 'transparent',
                  border: '1px solid ' + (active ? '#386' : 'transparent'),
                  color: active ? '#8df' : '#ccc',
                }}
              >
                <span style={{ color: a.kind === 'frames' ? '#e8a' : '#ea6', fontSize: 10, flexShrink: 0 }}>
                  {a.kind === 'frames' ? '▤' : '◆'}
                </span>
                <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
                {a.loop && <span title="循环（不占时间轴）" style={{ color: '#fb0', fontSize: 10 }}>∞</span>}
                <span style={{ opacity: .4, fontSize: 10 }}>{partLabel(a.partId)}</span>
                <span style={{ opacity: .4, fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
                  {localAnimDuration(a).toFixed(2)}s
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* 选中后的属性编辑 */}
      {selected && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid #333', paddingTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={label}>名称</span>
            <input
              value={selected.name}
              onChange={e => onUpdate(selected.id, a => ({ ...a, name: e.target.value }))}
              style={{ ...input, flex: 1, width: 'auto' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={label}>节点</span>
            <select
              value={selected.partId}
              onChange={e => onUpdate(selected.id, a => ({ ...a, partId: e.target.value }))}
              style={{ ...input, flex: 1, width: 'auto' }}
            >
              {parts.map(p => <option key={p.id} value={p.id}>{p.label}（{p.id}）</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={label}>开始</span>
            <input
              type="number" min={0} step={0.05} value={+selected.start.toFixed(3)}
              onChange={e => onUpdate(selected.id, a => ({ ...a, start: Math.max(0, parseFloat(e.target.value) || 0) }))}
              style={input}
            />
            <span style={label}>
              {selected.kind === 'frames' ? '帧率' : '时长'}
            </span>
            {selected.kind === 'frames' ? (
              <input
                type="number" min={0.1} step={0.5} value={selected.fps}
                onChange={e => onUpdate(selected.id, a => (a.kind === 'frames' ? { ...a, fps: Math.max(0.1, parseFloat(e.target.value) || 1) } : a))}
                style={input}
              />
            ) : (
              <input
                type="number" min={0.1} step={0.1} value={+selected.duration.toFixed(3)}
                onChange={e => onUpdate(selected.id, a => (a.kind === 'keys' ? { ...a, duration: Math.max(0.1, parseFloat(e.target.value) || 0.1) } : a))}
                style={input}
              />
            )}
            {selected.kind === 'frames' && (
              <button onClick={() => onEditFrames(selected as LocalFrames)} style={btn}>选帧图</button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selected.loop}
                onChange={e => onUpdate(selected.id, a => ({ ...a, loop: e.target.checked }))}
              />
              循环播放{selected.loop ? '（不占时间轴）' : ''}
            </label>
            <span style={{ fontSize: 11, color: '#6cf', marginLeft: 'auto' }}>
              时长 {localAnimDuration(selected).toFixed(2)}s
            </span>
          </div>

          {selected.kind === 'keys' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <button
                onClick={() => onRecordKey(selected.id)}
                disabled={!sampledPose}
                style={{ ...btn, color: '#5d5', borderColor: '#3a8a3a', opacity: sampledPose ? 1 : .4 }}
                title="把该节点当前的 pose 写入局部动画（局部时间 = 当前时间 − 开始时间）"
              >◆ 记录关键帧</button>
              <button
                onClick={() => onDeleteKey(selected.id, cursorT - selected.start)}
                disabled={cursorT < selected.start - 1e-6 || cursorT > selected.start + selected.duration + 1e-6}
                style={{
                  ...btn, color: '#e55', borderColor: '#8a3a3a',
                  opacity: cursorT >= selected.start - 1e-6 && cursorT <= selected.start + selected.duration + 1e-6 ? 1 : .4,
                }}
                title="删除当前时间所在的局部关键帧"
              >
                删除当前帧
              </button>
              <span style={{ fontSize: 10, opacity: .5 }}>共 {selected.keys.length} 帧</span>
            </div>
          )}
          {selected.kind === 'keys' && (
            <div style={{ fontSize: 10, opacity: .5, lineHeight: 1.5 }}>
              提示：把红色指针移到该动画范围内（{selected.start.toFixed(2)}s ~ {(selected.start + selected.duration).toFixed(2)}s），
              在视口中拖动节点「{partLabel(selected.partId)}」即可直接写局部关键帧。
            </div>
          )}

          <button
            onClick={() => { onDelete(selected.id); onSelect(null); }}
            style={{ ...btn, color: '#e55', borderColor: '#8a3a3a', alignSelf: 'flex-start' }}
          >删除此局部动画</button>
        </div>
      )}
    </div>
  );
}
