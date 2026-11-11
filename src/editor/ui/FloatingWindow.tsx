/**
 * 浮动窗口 —— 无遮罩、可拖拽移动、可拖边角改变大小，限制最小宽高。
 *
 * 用于"双击动画资源打开动画编辑器"：窗口之外的地方保持可交互，
 * 因此这里不渲染任何全屏覆盖层，只有窗口本身。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { T, FONT } from './theme';

export const WIN_MIN_W = 760;
export const WIN_MIN_H = 520;

export interface WinRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  title: string;
  subtitle?: string;
  rect: WinRect;
  zIndex: number;
  onRectChange: (r: WinRect) => void;
  onClose: () => void;
  onFocus: () => void;
  children: ReactNode;
  /** 标题栏右侧的额外按钮 */
  headerExtra?: ReactNode;
}

type DragKind = 'move' | 'e' | 's' | 'se' | 'w' | 'sw' | 'n' | 'ne' | 'nw';

export function FloatingWindow({
  title,
  subtitle,
  rect,
  zIndex,
  onRectChange,
  onClose,
  onFocus,
  children,
  headerExtra,
}: Props) {
  const dragRef = useRef<{ kind: DragKind; sx: number; sy: number; rect: WinRect } | null>(null);
  const [dragging, setDragging] = useState(false);
  const rectRef = useRef(rect);
  rectRef.current = rect;

  const clamp = useCallback((r: WinRect): WinRect => {
    const maxW = Math.max(WIN_MIN_W, window.innerWidth - 40);
    const maxH = Math.max(WIN_MIN_H, window.innerHeight - 40);
    const w = Math.min(Math.max(WIN_MIN_W, r.w), maxW);
    const h = Math.min(Math.max(WIN_MIN_H, r.h), maxH);
    const x = Math.min(Math.max(-w + 120, r.x), window.innerWidth - 120);
    const y = Math.min(Math.max(0, r.y), window.innerHeight - 60);
    return { x, y, w, h };
  }, []);

  const start = (kind: DragKind) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onFocus();
    dragRef.current = { kind, sx: e.clientX, sy: e.clientY, rect: { ...rectRef.current } };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      const r = { ...d.rect };
      switch (d.kind) {
        case 'move':
          r.x = d.rect.x + dx;
          r.y = d.rect.y + dy;
          break;
        case 'e':
          r.w = d.rect.w + dx;
          break;
        case 's':
          r.h = d.rect.h + dy;
          break;
        case 'se':
          r.w = d.rect.w + dx;
          r.h = d.rect.h + dy;
          break;
        case 'w':
          r.x = d.rect.x + dx;
          r.w = d.rect.w - dx;
          break;
        case 'n':
          r.y = d.rect.y + dy;
          r.h = d.rect.h - dy;
          break;
        case 'sw':
          r.x = d.rect.x + dx;
          r.w = d.rect.w - dx;
          r.h = d.rect.h + dy;
          break;
        case 'ne':
          r.y = d.rect.y + dy;
          r.w = d.rect.w + dx;
          r.h = d.rect.h - dy;
          break;
        case 'nw':
          r.x = d.rect.x + dx;
          r.y = d.rect.y + dy;
          r.w = d.rect.w - dx;
          r.h = d.rect.h - dy;
          break;
      }
      // 拖左边/上边时窗口最小尺寸要从锚点方向补回来
      if (d.kind.includes('w') && r.w < WIN_MIN_W) {
        r.x = d.rect.x + d.rect.w - WIN_MIN_W;
        r.w = WIN_MIN_W;
      }
      if (d.kind.includes('n') && r.h < WIN_MIN_H) {
        r.y = d.rect.y + d.rect.h - WIN_MIN_H;
        r.h = WIN_MIN_H;
      }
      onRectChange(clamp(r));
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
  }, [dragging, clamp, onRectChange]);

  const handle = (kind: DragKind, style: React.CSSProperties) => (
    <div onPointerDown={start(kind)} style={{ position: 'absolute', zIndex: 3, ...style }} />
  );

  return (
    <div
      style={{
        position: 'fixed',
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        zIndex,
        display: 'flex',
        flexDirection: 'column',
        background: T.bg1,
        border: `1px solid ${T.line}`,
        borderRadius: 6,
        boxShadow: '0 18px 50px rgba(0,0,0,.6)',
        overflow: 'hidden',
        fontFamily: FONT,
        color: T.text,
      }}
      onPointerDown={onFocus}
    >
      {/* 标题栏：拖动移动 */}
      <div
        onPointerDown={start('move')}
        onDoubleClick={onClose}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 34,
          flexShrink: 0,
          padding: '0 6px 0 12px',
          background: T.bg3,
          borderBottom: `1px solid ${T.line}`,
          cursor: dragging ? 'grabbing' : 'grab',
          userSelect: 'none',
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.accent, flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{title}</span>
        {subtitle && <span style={{ fontSize: 11, color: T.dimmer, whiteSpace: 'nowrap' }}>{subtitle}</span>}
        <div style={{ flex: 1 }} />
        {headerExtra}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          title="关闭"
          style={{
            width: 24,
            height: 22,
            background: 'transparent',
            color: T.dim,
            border: 'none',
            borderRadius: 3,
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>{children}</div>

      {/* 缩放手柄：四边 + 四角（角在最上层） */}
      {handle('e', { right: 0, top: 6, bottom: 6, width: 6, cursor: 'ew-resize' })}
      {handle('w', { left: 0, top: 6, bottom: 6, width: 6, cursor: 'ew-resize' })}
      {handle('s', { bottom: 0, left: 6, right: 6, height: 6, cursor: 'ns-resize' })}
      {handle('n', { top: 34, left: 6, right: 6, height: 5, cursor: 'ns-resize' })}
      {handle('se', { right: 0, bottom: 0, width: 14, height: 14, cursor: 'nwse-resize' })}
      {handle('sw', { left: 0, bottom: 0, width: 14, height: 14, cursor: 'nesw-resize' })}
      {handle('ne', { right: 0, top: 34, width: 14, height: 14, cursor: 'nesw-resize' })}
      {handle('nw', { left: 0, top: 34, width: 14, height: 14, cursor: 'nwse-resize' })}

      <div
        style={{
          position: 'absolute',
          right: 2,
          bottom: 2,
          width: 10,
          height: 10,
          pointerEvents: 'none',
          backgroundImage: `linear-gradient(135deg, transparent 45%, ${T.dimmer} 45%, ${T.dimmer} 55%, transparent 55%)`,
          backgroundSize: '4px 4px',
          opacity: 0.8,
        }}
      />
    </div>
  );
}
