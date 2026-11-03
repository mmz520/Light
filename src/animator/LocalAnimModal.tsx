/**
 * LocalAnimModal —— 新建 / 编辑局部动画
 *
 * · 帧图动画：从图库按顺序点选帧图 + 设置 fps → 时长 = 帧数 / fps 自动计算
 * · 关键帧动画：作用于单个节点，时长手动设置，创建后在时间轴 / gizmo 里录关键帧
 * · 传入 initial 时为"编辑帧图序列"模式（只针对帧图型）
 */
import { useEffect, useState } from 'react';
import { LocalAnim, LocalFramesAnim, MetadataImage, PartDef } from './types';
import { assetUrl } from './Viewport3D';

interface Props {
  open: boolean;
  images: MetadataImage[];
  parts: PartDef[];
  /** 新建时的默认名称 */
  defaultName: string;
  /** 传入则进入编辑模式（仅帧图型支持重新选图/改 fps） */
  initial?: LocalFramesAnim | null;
  onCreate: (a: LocalAnim) => void;
  onUpdate: (a: LocalFramesAnim) => void;
  onClose: () => void;
}

export function LocalAnimModal({ open, images, parts, defaultName, initial, onCreate, onUpdate, onClose }: Props) {
  const [kind, setKind] = useState<'frames' | 'keys'>('frames');
  const [name, setName] = useState(defaultName);
  const [partId, setPartId] = useState(parts[0]?.id ?? '');
  const [fps, setFps] = useState(8);
  const [duration, setDuration] = useState(0.5);
  const [loop, setLoop] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  // 打开时重置表单
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setKind('frames');
      setName(initial.name);
      setPartId(initial.partId);
      setFps(initial.fps);
      setLoop(initial.loop);
      setPicked([...initial.images]);
    } else {
      setKind('frames');
      setName(defaultName);
      setPartId(parts[0]?.id ?? '');
      setFps(8);
      setDuration(0.5);
      setLoop(false);
      setPicked([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial, defaultName]);

  if (!open) return null;

  const togglePick = (path: string) => {
    setPicked(p => (p.includes(path) ? p.filter(x => x !== path) : [...p, path]));
  };

  const framesDur = picked.length > 0 ? picked.length / Math.max(0.01, fps) : 0;

  const submit = () => {
    if (initial) {
      onUpdate({ ...initial, images: picked, fps: Math.max(0.1, fps), loop });
      onClose();
      return;
    }
    const id = `loc_${Math.random().toString(36).slice(2, 8)}`;
    const trimmed = name.trim() || defaultName;
    if (kind === 'frames') {
      if (picked.length === 0) { alert('请至少选择 1 张帧图'); return; }
      onCreate({ id, name: trimmed, kind: 'frames', partId, images: picked, fps: Math.max(0.1, fps), loop, start: 0 });
    } else {
      const part = parts.find(p => p.id === partId);
      const base = part?.defaultPose ?? { x: 0, y: 0, rot: 0, scale: 1 };
      onCreate({
        id, name: trimmed, kind: 'keys', partId,
        duration: Math.max(0.1, duration), loop, start: 0,
        keys: [{ t: 0, pose: { ...base }, ease: 'linear' }],
      });
    }
    onClose();
  };

  const label: React.CSSProperties = { fontSize: 11, color: '#9a9aa2', flexShrink: 0 };
  const input: React.CSSProperties = {
    background: '#1a1a1e', border: '1px solid #444', borderRadius: 4,
    color: '#ddd', fontSize: 12, padding: '4px 6px', fontFamily: 'inherit',
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 620, maxHeight: '80vh', background: '#232328', border: '1px solid #444',
          borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 8px 40px rgba(0,0,0,.6)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', padding: '10px 14px',
          borderBottom: '1px solid #333', fontWeight: 600,
        }}>
          <span style={{ flex: 1 }}>{initial ? '编辑帧图序列' : '新建局部动画'}</span>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: '#999',
            fontSize: 18, cursor: 'pointer', lineHeight: 1,
          }}>×</button>
        </div>

        {/* 参数区 */}
        <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid #333' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={label}>名称</span>
            <input value={name} onChange={e => setName(e.target.value)} style={{ ...input, flex: 1 }} />
          </div>
          {!initial && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={label}>类型</span>
              {([['frames', '帧图动画'], ['keys', '关键帧动画']] as const).map(([k, txt]) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  style={{
                    padding: '3px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 4,
                    border: '1px solid ' + (kind === k ? '#6cf' : '#444'),
                    background: kind === k ? '#173242' : '#1a1a1e', color: kind === k ? '#6cf' : '#bbb',
                  }}
                >{txt}</button>
              ))}
              <span style={label}>节点</span>
              <select value={partId} onChange={e => setPartId(e.target.value)} style={{ ...input, flex: 1 }}>
                {parts.map(p => <option key={p.id} value={p.id}>{p.label}（{p.id}）</option>)}
              </select>
            </div>
          )}
          {initial && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={label}>节点</span>
              <span style={{ fontSize: 12, color: '#ccc' }}>
                {parts.find(p => p.id === initial.partId)?.label ?? initial.partId}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={label}>{kind === 'frames' || initial ? '帧率' : '时长'}</span>
            {(kind === 'frames' || initial) ? (
              <>
                <input
                  type="number" min={0.1} step={0.5} value={fps}
                  onChange={e => setFps(parseFloat(e.target.value) || 1)}
                  style={{ ...input, width: 70 }}
                />
                <span style={label}>帧/秒</span>
              </>
            ) : (
              <input
                type="number" min={0.1} step={0.1} value={duration}
                onChange={e => setDuration(parseFloat(e.target.value) || 0.1)}
                style={{ ...input, width: 70 }}
              />
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', marginLeft: 8 }}>
              <input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} />
              循环播放
            </label>
            <span style={{ fontSize: 11, color: '#6cf', marginLeft: 'auto' }}>
              时长 {(initial || kind === 'frames' ? framesDur : duration).toFixed(2)}s
            </span>
          </div>
        </div>

        {/* 帧图选择网格 */}
        <div style={{ padding: '10px 14px', overflow: 'auto', flex: 1 }}>
          <div style={{ fontSize: 11, color: '#8a8a92', marginBottom: 8 }}>
            {initial ? '点击帧图调整序列（按点击顺序播放）' : kind === 'frames' ? '按播放顺序点击选择帧图' : '关键帧动画不使用帧图，创建后在时间轴与视口中录制'}
          </div>
          {(kind === 'frames' || initial) && (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 8,
            }}>
              {images.map(img => {
                const idx = picked.indexOf(img.path);
                return (
                  <div
                    key={img.id}
                    onClick={() => togglePick(img.path)}
                    style={{
                      cursor: 'pointer', position: 'relative',
                      border: '1px solid ' + (idx >= 0 ? '#6cf' : '#3a3a40'), borderRadius: 6,
                      background: '#1b1b1f', padding: 5, textAlign: 'center',
                      outline: idx >= 0 ? '1px solid #6cf' : 'none',
                    }}
                    title={img.path}
                  >
                    {idx >= 0 && (
                      <span style={{
                        position: 'absolute', top: 2, left: 4, fontSize: 10, fontWeight: 700,
                        color: '#000', background: '#6cf', borderRadius: '50%',
                        width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>{idx + 1}</span>
                    )}
                    <div style={{
                      height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      backgroundImage:
                        'linear-gradient(45deg,#2a2a30 25%,transparent 25%,transparent 75%,#2a2a30 75%),' +
                        'linear-gradient(45deg,#2a2a30 25%,transparent 25%,transparent 75%,#2a2a30 75%)',
                      backgroundSize: '12px 12px', backgroundPosition: '0 0, 6px 6px', borderRadius: 4,
                      overflow: 'hidden', marginBottom: 4,
                    }}>
                      <img
                        src={assetUrl(img.path)} alt={img.label}
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                        draggable={false}
                      />
                    </div>
                    <div style={{ fontSize: 10, color: '#bbb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {img.label}
                    </div>
                  </div>
                );
              })}
              {images.length === 0 && (
                <div style={{ opacity: .5, padding: 20, gridColumn: '1 / -1', textAlign: 'center' }}>
                  图库里没有可用图片
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '10px 14px', borderTop: '1px solid #333', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '5px 14px', background: '#333', color: '#ccc', border: '1px solid #444',
            borderRadius: 4, cursor: 'pointer', fontSize: 12,
          }}>取消</button>
          <button onClick={submit} style={{
            padding: '5px 16px', background: '#3b5', color: '#000', border: 'none',
            borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 700,
          }}>{initial ? '保存' : '创建'}</button>
        </div>
      </div>
    </div>
  );
}
