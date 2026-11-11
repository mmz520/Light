/**
 * 图片裁剪 —— 非破坏性：把裁剪框存进图片资源（assets 里的 metadata 索引），
 * 渲染时按 UV 取源区域；也可以"应用到图片"直接把结果写回 PNG。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { imageUrl } from '../model/resolve';
import type { CropRect, ImageAsset, ProjectDoc } from '../model/types';
import { T, FONT, btnStyle, inputStyle } from './theme';

interface Props {
  project: ProjectDoc;
  image: ImageAsset;
  onConfirm: (crop: CropRect | null) => void;
  /** 把这块裁剪框写回图片文件（破坏性）：必须带上当前框，不能只靠 store 里的旧值 */
  onBake: (crop: CropRect) => void;
  onClose: () => void;
}

const VIEW_MAX_W = 620;
const VIEW_MAX_H = 460;
const MIN = 8;

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | null;

export function CropDialog({ project, image, onConfirm, onBake, onClose }: Props) {
  const [crop, setCrop] = useState<CropRect>(
    image.crop ?? { x: 0, y: 0, w: image.width, h: image.height },
  );
  const dragRef = useRef<{ mode: DragMode; sx: number; sy: number; start: CropRect } | null>(null);
  const [dragging, setDragging] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const view = useMemo(() => {
    const s = Math.min(VIEW_MAX_W / image.width, VIEW_MAX_H / image.height, 1.6);
    return { s, w: image.width * s, h: image.height * s };
  }, [image.width, image.height]);

  const begin = (mode: DragMode) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { mode, sx: e.clientX, sy: e.clientY, start: { ...crop } };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || !d.mode) return;
      const dx = (e.clientX - d.sx) / view.s;
      const dy = (e.clientY - d.sy) / view.s;
      const s = d.start;
      let next = { ...s };
      if (d.mode === 'move') {
        next.x = clamp(s.x + dx, 0, image.width - s.w);
        next.y = clamp(s.y + dy, 0, image.height - s.h);
      } else {
        if (d.mode.includes('w')) {
          const nx = clamp(s.x + dx, 0, s.x + s.w - MIN);
          next.w = s.x + s.w - nx;
          next.x = nx;
        }
        if (d.mode.includes('e')) {
          next.w = clamp(s.w + dx, MIN, image.width - s.x);
        }
        if (d.mode.includes('n')) {
          const ny = clamp(s.y + dy, 0, s.y + s.h - MIN);
          next.h = s.y + s.h - ny;
          next.y = ny;
        }
        if (d.mode.includes('s')) {
          next.h = clamp(s.h + dy, MIN, image.height - s.y);
        }
      }
      setCrop(roundRect(next));
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, image.width, image.height, view.s]);

  const setField = (k: keyof CropRect, v: number) => {
    setCrop((c) => {
      const next = { ...c, [k]: v };
      next.w = clamp(next.w, MIN, image.width);
      next.h = clamp(next.h, MIN, image.height);
      next.x = clamp(next.x, 0, image.width - next.w);
      next.y = clamp(next.y, 0, image.height - next.h);
      return roundRect(next);
    });
  };

  const isFull = crop.x === 0 && crop.y === 0 && crop.w === image.width && crop.h === image.height;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6,5,4,.62)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 700,
        fontFamily: FONT,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: T.bg1,
          border: `1px solid ${T.line}`,
          borderRadius: 7,
          boxShadow: '0 24px 60px rgba(0,0,0,.7)',
          padding: 14,
          color: T.text,
          display: 'flex',
          gap: 16,
        }}
      >
        <div
          ref={boxRef}
          style={{
            width: view.w,
            height: view.h,
            position: 'relative',
            background: `repeating-conic-gradient(${T.bg0} 0% 25%, #191512 0% 50%) 50% / 12px 12px`,
            border: `1px solid ${T.line}`,
            userSelect: 'none',
            touchAction: 'none',
          }}
        >
          <img
            src={imageUrl(project, image)}
            alt=""
            draggable={false}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'auto' }}
          />
          {/* 裁剪框外遮罩 */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, right: 0, height: crop.y * view.s, background: 'rgba(0,0,0,.55)' }} />
            <div style={{ position: 'absolute', left: 0, bottom: 0, right: 0, height: (image.height - crop.y - crop.h) * view.s, background: 'rgba(0,0,0,.55)' }} />
            <div style={{ position: 'absolute', left: 0, top: crop.y * view.s, width: crop.x * view.s, height: crop.h * view.s, background: 'rgba(0,0,0,.55)' }} />
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: crop.y * view.s,
                width: (image.width - crop.x - crop.w) * view.s,
                height: crop.h * view.s,
                background: 'rgba(0,0,0,.55)',
              }}
            />
          </div>
          {/* 裁剪框 */}
          <div
            onPointerDown={begin('move')}
            style={{
              position: 'absolute',
              left: crop.x * view.s,
              top: crop.y * view.s,
              width: crop.w * view.s,
              height: crop.h * view.s,
              border: `1px solid ${T.accent}`,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0)',
              cursor: dragging ? 'grabbing' : 'grab',
            }}
          >
            {(['nw', 'ne', 'sw', 'se'] as const).map((h) => (
              <div
                key={h}
                onPointerDown={begin(h)}
                style={{
                  position: 'absolute',
                  width: 10,
                  height: 10,
                  background: T.accent,
                  borderRadius: 1,
                  left: h.includes('w') ? -5 : undefined,
                  right: h.includes('e') ? -5 : undefined,
                  top: h.includes('n') ? -5 : undefined,
                  bottom: h.includes('s') ? -5 : undefined,
                  cursor: h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize',
                }}
              />
            ))}
          </div>
        </div>

        <div style={{ width: 220, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>裁剪图片</div>
          <div style={{ fontSize: 11, color: T.dimmer, lineHeight: 1.6 }}>
            原图 {image.width}×{image.height}
            <br />
            裁剪 {Math.round(crop.w)}×{Math.round(crop.h)}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {(['x', 'y', 'w', 'h'] as const).map((k) => (
              <label key={k} style={{ fontSize: 11, color: T.dim }}>
                {k.toUpperCase()}
                <input
                  type="number"
                  value={Math.round(crop[k])}
                  onChange={(e) => setField(k, Number(e.target.value) || 0)}
                  style={{ ...inputStyle, marginTop: 2 }}
                />
              </label>
            ))}
          </div>

          <button onClick={() => setCrop({ x: 0, y: 0, w: image.width, h: image.height })} style={btnStyle}>
            重置为整图
          </button>

          <div style={{ flex: 1 }} />

          <div style={{ fontSize: 10.5, color: T.dimmer, lineHeight: 1.6 }}>
            「确定」只记录裁剪区域，原图不改；「应用到图片」会把裁剪结果写回 PNG。
          </div>
          <button
            onClick={() => {
              onBake(roundRect(crop));
              onClose();
            }}
            disabled={isFull}
            style={{ ...btnStyle, opacity: isFull ? 0.45 : 1 }}
          >
            应用到图片
          </button>
          <button
            onClick={() => {
              onConfirm(isFull ? null : roundRect(crop));
              onClose();
            }}
            style={{ ...btnStyle, background: T.accent, color: '#1a1410', border: 'none', fontWeight: 700 }}
          >
            确定
          </button>
          <button onClick={onClose} style={btnStyle}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

function roundRect(r: CropRect): CropRect {
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
}
