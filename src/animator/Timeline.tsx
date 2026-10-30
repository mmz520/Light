/**
 * Timeline —— 底部时间轴
 *
 * · 表头（播放控制 + 刻度条）position: sticky 吸顶：上下滚动轨道时不跟着滚
 * · 表头左栏与轨道名左栏同宽，纵向对齐
 * · 刻度条自动铺满可用宽度（按容器宽度自适应 px/s）
 * · 红色播放指针贯穿刻度条 + 全部帧条（表头一段 + 轨道区一段，视觉上连续）
 * · 关键帧：拖动移动（保留 pose），双击删除，右键轨道添加
 *   - 绿色 = 普通关键帧；红色 = 记录了"隐藏"；蓝色 = 记录了"显示"
 * · 播放指针 / 关键帧支持最小步长吸附（下拉框可切换，步长 = 帧数 / fps）
 */
import { useEffect, useRef, useState } from 'react';
import { Clip, PartDef } from './types';

interface Props {
  clip: Clip;
  parts: PartDef[];
  cursorT: number;
  isPlaying: boolean;
  fps: number;
  onCursorChange: (t: number) => void;
  onPlayToggle: () => void;
  onStop: () => void;
  onAddKeyframe: (partId: string, t: number) => void;
  onDeleteKeyframe: (partId: string, t: number) => void;
  onMoveKeyframe: (partId: string, fromT: number, toT: number) => void;
  /** 帧剪贴板是否已有内容 */
  hasFrameClipboard: boolean;
  onCopyFrame: (t: number) => void;
  onPasteFrame: (t: number) => void;
}

const TRACK_H = 24;
const HEADER_W = 236;

/** 播放指针/关键帧的最小步长（吸附档位，单位：帧；0 = 不吸附） */
const SNAP_OPTIONS = [
  { label: '不吸附', frames: 0 },
  { label: '1 帧', frames: 1 },
  { label: '2 帧', frames: 2 },
  { label: '5 帧', frames: 5 },
  { label: '10 帧', frames: 10 },
];

/** 选一个"好看"的刻度步长，让整条时间轴不超过 ~12 个刻度 */
function niceStep(duration: number): number {
  const steps = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 15, 30, 60, 120];
  for (const s of steps) if (duration / s <= 12) return s;
  return 300;
}

export function Timeline({
  clip, parts, cursorT, isPlaying, fps, onCursorChange, onPlayToggle, onStop, onAddKeyframe, onDeleteKeyframe, onMoveKeyframe,
  hasFrameClipboard, onCopyFrame, onPasteFrame,
}: Props) {
  const rulerRef = useRef<HTMLDivElement>(null);
  const [rulerW, setRulerW] = useState(0);
  const [dragKf, setDragKf] = useState<{ partId: string; origT: number; startX: number } | null>(null);
  const [draggingCursor, setDraggingCursor] = useState(false);
  const [snapIdx, setSnapIdx] = useState(0); // 默认不吸附
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null); // 红线右键菜单
  const snapFrames = SNAP_OPTIONS[snapIdx]?.frames ?? 0;

  // 右键菜单：点别处 / Esc / 滚动即关闭
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', close);
    };
  }, [menu]);

  /** 打开红线右键菜单（避免超出视口） */
  const openMenu = (clientX: number, clientY: number) => {
    const W = 170, H = 74;
    setMenu({
      x: Math.min(clientX, window.innerWidth - W - 8),
      y: Math.min(clientY, window.innerHeight - H - 8),
    });
  };

  /** 按最小步长吸附到帧网格（frames=0 时不吸附） */
  const snapT = (t: number) => {
    if (snapFrames <= 0 || fps <= 0) return t;
    const frame = snapFrames / fps;
    return Math.round(t / frame) * frame;
  };

  // 刻度条铺满：px/s 由容器宽度决定（表头与轨道同宽，共用同一 scale）
  useEffect(() => {
    const el = rulerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRulerW(el.clientWidth));
    ro.observe(el);
    setRulerW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const scale = rulerW > 0 && clip.duration > 0 ? rulerW / clip.duration : 100;
  const totalW = Math.max(rulerW, 0);
  const step = niceStep(clip.duration);
  const ticks: number[] = [];
  for (let t = 0; t <= clip.duration + 1e-6; t += step) ticks.push(Math.min(t, clip.duration));

  // 拖动播放指针
  const seekFromEvent = (clientX: number) => {
    if (!rulerRef.current) return;
    const rect = rulerRef.current.getBoundingClientRect();
    const t = Math.max(0, Math.min(clip.duration, (clientX - rect.left) / scale));
    onCursorChange(snapT(t));
  };

  useEffect(() => {
    if (!draggingCursor) return;
    const onMove = (e: MouseEvent) => seekFromEvent(e.clientX);
    const onUp = () => setDraggingCursor(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingCursor, scale, clip.duration, snapFrames]);

  // 拖动关键帧（保留 pose，只改时间）
  useEffect(() => {
    if (!dragKf) return;
    const onMove = (e: MouseEvent) => {
      const raw = Math.max(0, Math.min(clip.duration, dragKf.origT + (e.clientX - dragKf.startX) / scale));
      const newT = snapT(raw);
      if (Math.abs(newT - dragKf.origT) > 1e-4) {
        onMoveKeyframe(dragKf.partId, dragKf.origT, newT);
        setDragKf({ ...dragKf, origT: newT, startX: e.clientX });
      }
    };
    const onUp = () => setDragKf(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragKf, scale, clip.duration, onMoveKeyframe, snapFrames]);

  const sortedParts = [...parts].sort((a, b) => a.zIndex - b.zIndex);
  const trackById = new Map(clip.tracks.map(tr => [tr.partId, tr]));

  const addKeyOnRow = (e: React.MouseEvent, partId: string) => {
    e.preventDefault();
    const rect = rulerRef.current!.getBoundingClientRect();
    const t = Math.max(0, Math.min(clip.duration, (e.clientX - rect.left) / scale));
    onAddKeyframe(partId, snapT(t));
  };

  const ICON_BTN: React.CSSProperties = {
    width: 26, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#1a1a1e', border: '1px solid #444', borderRadius: 4,
    cursor: 'pointer', fontSize: 11, lineHeight: 1, color: '#ddd', padding: 0, flexShrink: 0,
  };

  const MENU_ITEM: React.CSSProperties = {
    display: 'flex', alignItems: 'center', width: '100%',
    background: 'transparent', border: 'none', borderRadius: 4,
    padding: '6px 8px', textAlign: 'left', fontSize: 12, color: '#ddd',
    cursor: 'pointer', fontFamily: 'inherit',
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', background: '#222226' }}>
      {/* ===== 吸顶表头：播放控制 + 刻度条（上下滚动时固定） ===== */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 30, display: 'flex',
        background: '#1e1e22', borderBottom: '1px solid #333',
      }}>
        {/* 左：播放控制 */}
        <div style={{
          width: HEADER_W, flexShrink: 0, height: TRACK_H, display: 'flex', alignItems: 'center',
          gap: 5, padding: '0 8px', borderRight: '1px solid #333', boxSizing: 'border-box',
        }}>
          <button title="回到开头" onClick={onStop} style={{ ...ICON_BTN, color: '#6cf', borderColor: '#3a5f8a' }}>⏮</button>
          <button
            title={isPlaying ? '暂停' : '播放'}
            onClick={onPlayToggle}
            style={{ ...ICON_BTN, color: isPlaying ? '#fb0' : '#5d5', borderColor: isPlaying ? '#8a6d1a' : '#3a8a3a', fontSize: 13 }}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button title="停止并回到开头" onClick={onStop} style={{ ...ICON_BTN, color: '#e55', borderColor: '#8a3a3a' }}>⏹</button>
          <select
            title="红色指针与关键帧的最小移动步长"
            value={snapIdx}
            onChange={e => setSnapIdx(parseInt(e.target.value, 10))}
            style={{
              fontSize: 11, color: '#ccc', background: '#1a1a1e',
              border: '1px solid #444', borderRadius: 4, height: 20, padding: '0 2px', cursor: 'pointer',
            }}
          >
            {SNAP_OPTIONS.map((o, i) => (
              <option key={o.frames} value={i}>{o.label}</option>
            ))}
          </select>
          <span style={{ fontSize: 11, opacity: .55, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
            {cursorT.toFixed(2)}s
          </span>
        </div>

        {/* 右：刻度条 */}
        <div
          ref={rulerRef}
          onMouseDown={e => { if (e.button !== 0) return; seekFromEvent(e.clientX); setDraggingCursor(true); }}
          style={{
            flex: 1, height: TRACK_H, position: 'relative', overflow: 'hidden',
            background: '#24242a', cursor: 'ew-resize',
          }}
        >
          {totalW > 0 && ticks.map((t, i) => (
            <div key={i} style={{
              position: 'absolute', left: t * scale, top: 0, bottom: 0,
              borderLeft: '1px solid #444', paddingLeft: 3, fontSize: 9, color: '#999',
              pointerEvents: 'none',
            }}>{t.toFixed(step < 1 ? 2 : 1)}s</div>
          ))}
          {/* 指针（表头段：含顶部三角 + 右键热区） */}
          {totalW > 0 && (
            <div
              onMouseDown={e => { if (e.button === 2) { e.stopPropagation(); e.preventDefault(); } }}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); openMenu(e.clientX, e.clientY); }}
              title="右键：复制 / 粘贴当前帧"
              style={{
                position: 'absolute', top: 0, bottom: 0, left: cursorT * scale - 6,
                width: 12, cursor: 'context-menu', zIndex: 21,
              }}
            >
              <div style={{
                position: 'absolute', left: 5, top: 0, bottom: 0, width: 2,
                background: '#e33', pointerEvents: 'none', boxShadow: '0 0 4px rgba(255,60,60,.8)',
              }}>
                <div style={{
                  position: 'absolute', top: 0, left: -4, width: 10, height: 8,
                  background: '#e33', clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
                }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== 轨道区（随内容滚动） ===== */}
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        {/* 左：轨道名 */}
        <div style={{
          width: HEADER_W, flexShrink: 0, borderRight: '1px solid #333',
          background: '#1e1e22', boxSizing: 'border-box',
        }}>
          {sortedParts.map(p => (
            <div key={p.id} style={{
              height: TRACK_H, padding: '0 8px', borderBottom: '1px solid #2a2a30',
              display: 'flex', alignItems: 'center', gap: 6, boxSizing: 'border-box',
            }}>
              <div style={{ width: 8, height: 8, background: '#4b7', borderRadius: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                {p.label}
                <span style={{ fontSize: 9, opacity: .4, marginLeft: 3 }}>{p.id}</span>
              </span>
            </div>
          ))}
        </div>

        {/* 右：帧条 */}
        <div style={{ flex: 1, position: 'relative', background: '#19191d', minWidth: 0 }}>
          {sortedParts.map(p => {
            const track = trackById.get(p.id);
            return (
              <div
                key={p.id}
                onContextMenu={e => addKeyOnRow(e, p.id)}
                style={{
                  position: 'relative', height: TRACK_H, width: totalW,
                  borderBottom: '1px solid #2a2a30', background: '#1f1f24', boxSizing: 'border-box',
                }}
                title="右键添加关键帧"
              >
                {track?.keys.map(k => {
                  const kfColor = k.visible === false ? '#e55' : k.visible === true ? '#6cf' : '#4b7';
                  return (
                    <div
                      key={k.t}
                      onMouseDown={e => { e.stopPropagation(); setDragKf({ partId: p.id, origT: k.t, startX: e.clientX }); }}
                      onDoubleClick={e => { e.stopPropagation(); onDeleteKeyframe(p.id, k.t); }}
                      style={{
                        position: 'absolute', left: k.t * scale - 4, top: TRACK_H / 2 - 4,
                        width: 8, height: 8, background: kfColor,
                        cursor: 'grab', borderRadius: 2, zIndex: 5,
                      }}
                      title={`t=${k.t.toFixed(3)}s · ${k.ease}${k.visible !== undefined ? ` · ${k.visible ? '显示' : '隐藏'}` : ''}`}
                    />
                  );
                })}
              </div>
            );
          })}

          {/* 指针（轨道段：贯穿全部帧条 + 右键热区） */}
          {totalW > 0 && (
            <div
              onMouseDown={e => { if (e.button === 2) { e.stopPropagation(); e.preventDefault(); } }}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); openMenu(e.clientX, e.clientY); }}
              title="右键：复制 / 粘贴当前帧"
              style={{
                position: 'absolute', top: 0, bottom: 0, left: cursorT * scale - 6,
                width: 12, cursor: 'context-menu', zIndex: 21,
              }}
            >
              <div style={{
                position: 'absolute', left: 5, top: 0, bottom: 0, width: 2,
                background: '#e33', pointerEvents: 'none', boxShadow: '0 0 4px rgba(255,60,60,.8)',
              }} />
            </div>
          )}
        </div>
      </div>

      {/* 红线右键菜单：复制 / 粘贴当前帧 */}
      {menu && (
        <div
          onMouseDown={e => e.stopPropagation()}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
          style={{
            position: 'fixed', left: menu.x, top: menu.y, zIndex: 200,
            background: '#232327', border: '1px solid #4a4a52', borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,.55)', padding: 4, minWidth: 164,
            fontSize: 12, color: '#ddd', userSelect: 'none',
          }}
        >
          <div style={{ padding: '2px 8px 5px', fontSize: 10, opacity: .45 }}>
            当前帧 t = {cursorT.toFixed(2)}s
          </div>
          <button
            onClick={() => { onCopyFrame(cursorT); setMenu(null); }}
            style={MENU_ITEM}
          >
            <span style={{ color: '#6cf', width: 14, display: 'inline-block' }}>⧉</span>复制当前帧
          </button>
          <button
            disabled={!hasFrameClipboard}
            onClick={() => { if (hasFrameClipboard) { onPasteFrame(cursorT); setMenu(null); } }}
            style={{
              ...MENU_ITEM,
              opacity: hasFrameClipboard ? 1 : .35,
              cursor: hasFrameClipboard ? 'pointer' : 'not-allowed',
            }}
          >
            <span style={{ color: '#5d5', width: 14, display: 'inline-block' }}>⎘</span>粘贴到当前帧
          </button>
        </div>
      )}
    </div>
  );
}
