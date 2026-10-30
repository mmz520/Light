import { useRef, useState, useEffect } from 'react';
import { Clip, PartDef } from './types';

interface Props {
  clip: Clip;
  parts: PartDef[];
  cursorT: number;
  onCursorChange: (t: number) => void;
  onAddKeyframe: (partId: string, t: number) => void;
  onDeleteKeyframe: (partId: string, t: number) => void;
}

const TRACK_H = 28;
const HEADER_W = 140;
const TICKS = 10;

export function Timeline({ clip, parts, cursorT, onCursorChange, onAddKeyframe, onDeleteKeyframe }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [draggingCursor, setDraggingCursor] = useState(false);
  const [dragKf, setDragKf] = useState<{ partId: string; origT: number; startX: number } | null>(null);
  const [scale, setScale] = useState(120); // px per second

  useEffect(() => {
    if (dragKf) {
      const onMove = (e: MouseEvent) => {
        const newT = dragKf.origT + (e.clientX - dragKf.startX) / scale;
        if (newT < 0 || newT > clip.duration) return;
        // 删除旧关键帧 + 在新 t 写新的（值不变） —— 用 onDeleteKeyframe + 外部传入 pose 重写
        // 这里简化：直接走删除+新增的外层逻辑
        onDeleteKeyframe(dragKf.partId, dragKf.origT);
        onAddKeyframe(dragKf.partId, newT);
        setDragKf({ ...dragKf, origT: newT, startX: e.clientX });
      };
      const onUp = () => setDragKf(null);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }
  }, [dragKf, scale, clip.duration, onAddKeyframe, onDeleteKeyframe]);

  const totalW = clip.duration * scale;

  const rulerOnMouseDown = (e: React.MouseEvent) => {
    if (!rulerRef.current) return;
    const rect = rulerRef.current.getBoundingClientRect();
    const t = Math.max(0, Math.min(clip.duration, (e.clientX - rect.left) / scale));
    onCursorChange(t);
    setDraggingCursor(true);
  };

  useEffect(() => {
    if (!draggingCursor) return;
    const onMove = (e: MouseEvent) => {
      if (!rulerRef.current) return;
      const rect = rulerRef.current.getBoundingClientRect();
      const t = Math.max(0, Math.min(clip.duration, (e.clientX - rect.left + scrollRef.current!.scrollLeft) / scale));
      onCursorChange(t);
    };
    const onUp = () => setDraggingCursor(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [draggingCursor, clip.duration, scale, onCursorChange]);

  const onRowContext = (e: React.MouseEvent, partId: string) => {
    e.preventDefault();
    const row = rowRefs.current[partId];
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const localX = e.clientX - rect.left + scrollRef.current!.scrollLeft;
    const t = Math.max(0, Math.min(clip.duration, localX / scale));
    onAddKeyframe(partId, t);
  };

  const sortedParts = [...parts].sort((a, b) => a.zIndex - b.zIndex);
  const trackById = new Map(clip.tracks.map(tr => [tr.partId, tr]));

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* 左：轨道名 */}
      <div style={{ width: HEADER_W, flexShrink: 0, borderRight: '1px solid #333', background: '#1e1e22', overflow: 'hidden' }}>
        <div style={{ height: TRACK_H * 2, borderBottom: '1px solid #333', padding: '4px 8px', fontSize: 11, opacity: .6 }}>Clip: <b>{clip.name}</b> · {clip.duration.toFixed(2)}s · {clip.loop}</div>
        {sortedParts.map(p => (
          <div key={p.id} style={{ height: TRACK_H, padding: '4px 8px', borderBottom: '1px solid #2a2a30', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, background: '#4b7', borderRadius: 2 }} />
            <span style={{ fontSize: 12 }}>{p.label}</span>
            <span style={{ fontSize: 10, opacity: .4 }}>{p.id}</span>
          </div>
        ))}
      </div>

      {/* 右：时间轴 */}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        {/* 时间尺 */}
        <div ref={rulerRef} onMouseDown={rulerOnMouseDown} style={{ height: TRACK_H, position: 'relative', width: totalW, background: '#24242a', cursor: 'ew-resize', borderBottom: '1px solid #333' }}>
          {Array.from({ length: TICKS + 1 }).map((_, i) => {
            const t = (clip.duration / TICKS) * i;
            return (
              <div key={i} style={{
                position: 'absolute', left: t * scale, top: 0, bottom: 0,
                borderLeft: '1px solid #444', paddingLeft: 3, fontSize: 10, color: '#999',
              }}>{t.toFixed(1)}s</div>
            );
          })}
          {/* cursor */}
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: cursorT * scale - 1,
            width: 2, background: '#e33', pointerEvents: 'none', zIndex: 10,
          }} />
        </div>

        {/* 轨道行 */}
        {sortedParts.map(p => {
          const track = trackById.get(p.id);
          return (
            <div
              key={p.id}
              ref={el => (rowRefs.current[p.id] = el)}
              onContextMenu={e => onRowContext(e, p.id)}
              style={{
                position: 'relative', height: TRACK_H, width: totalW,
                borderBottom: '1px solid #2a2a30', background: '#1f1f24',
              }}
              title="右键添加关键帧"
            >
              {track?.keys.map(k => (
                <div
                  key={k.t}
                  onMouseDown={e => {
                    e.stopPropagation();
                    setDragKf({ partId: p.id, origT: k.t, startX: e.clientX });
                  }}
                  onDoubleClick={e => { e.stopPropagation(); onDeleteKeyframe(p.id, k.t); }}
                  style={{
                    position: 'absolute', left: k.t * scale - 4, top: TRACK_H / 2 - 4,
                    width: 8, height: 8, background: '#4b7',
                    cursor: 'grab', borderRadius: 2, zIndex: 5,
                  }}
                  title={`t=${k.t.toFixed(3)}s, ${k.ease}`}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* 缩放控制 */}
      <div style={{ width: 160, borderLeft: '1px solid #333', padding: 10, background: '#1e1e22' }}>
        <div style={{ fontSize: 11, opacity: .6, marginBottom: 6 }}>缩放 (px/s)</div>
        <input type="range" min={40} max={600} value={scale} onChange={e => setScale(+e.target.value)} style={{ width: '100%' }} />
        <div style={{ fontSize: 10, opacity: .5, marginTop: 4 }}>{scale} px/s</div>
        <div style={{ fontSize: 10, opacity: .6, marginTop: 14 }}>提示</div>
        <div style={{ fontSize: 10, opacity: .5, lineHeight: 1.6, marginTop: 2 }}>
          · 右键轨道添加关键帧<br />
          · 拖动红指针改时间<br />
          · 拖动方块改关键帧时间<br />
          · 双击方块删除关键帧
        </div>
      </div>
    </div>
  );
}
