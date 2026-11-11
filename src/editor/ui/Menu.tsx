/**
 * 通用下拉菜单 / 右键菜单
 *
 * 同一套 items 结构既给顶部菜单栏，也给资源浏览器右键菜单。
 * 有 submenu 的项 hover 展开二级菜单。
 */
import { useEffect, useRef, useState } from 'react';
import { T, FONT } from './theme';

export interface MenuItem {
  /** 分隔线 / 分组标题 */
  type?: 'item' | 'sep' | 'header';
  label?: string;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  /** 勾选态（用于"显示网格"这类开关） */
  checked?: boolean;
  submenu?: MenuItem[];
  onClick?: () => void;
}

const itemStyle = (disabled?: boolean, danger?: boolean, checked?: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 10px 5px 22px',
  fontSize: 12.5,
  fontFamily: FONT,
  color: disabled ? T.dimmer : danger ? T.danger : T.text,
  cursor: disabled ? 'default' : 'default',
  position: 'relative',
  background: 'transparent',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  opacity: disabled ? 0.6 : 1,
  fontWeight: checked ? 600 : 400,
});

interface ListProps {
  items: MenuItem[];
  onClose: () => void;
  /** 右侧弹出（子菜单） */
  side?: boolean;
}

export function MenuList({ items, onClose, side }: ListProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const subRef = useRef<HTMLDivElement>(null);

  return (
    <div
      style={{
        minWidth: 190,
        background: T.bg2,
        border: `1px solid ${T.line}`,
        borderRadius: 5,
        padding: '4px 0',
        boxShadow: '0 8px 26px rgba(0,0,0,.55)',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((it, i) => {
        if (it.type === 'sep') {
          return <div key={i} style={{ height: 1, background: T.lineSoft, margin: '4px 0' }} />;
        }
        if (it.type === 'header') {
          return (
            <div key={i} style={{ padding: '5px 10px 3px', fontSize: 10.5, letterSpacing: '.08em', color: T.dimmer, textTransform: 'uppercase' }}>
              {it.label}
            </div>
          );
        }
        const hasSub = !!it.submenu?.length;
        return (
          <div
            key={i}
            style={{ position: 'relative' }}
            onMouseEnter={() => {
              setHoverIdx(i);
              setOpenIdx(hasSub && !it.disabled ? i : null);
            }}
          >
            <div
              style={{
                ...itemStyle(it.disabled, it.danger, it.checked),
                background: hoverIdx === i && !it.disabled ? T.bg4 : 'transparent',
              }}
              onClick={() => {
                if (it.disabled || hasSub) return;
                it.onClick?.();
                onClose();
              }}
            >
              <span style={{ position: 'absolute', left: 8, color: T.accent }}>{it.checked ? '✓' : ''}</span>
              <span style={{ flex: 1 }}>{it.label}</span>
              {it.hint && <span style={{ color: T.dimmer, fontSize: 11 }}>{it.hint}</span>}
              {hasSub && <span style={{ color: T.dimmer }}>›</span>}
            </div>
            {hasSub && openIdx === i && (
              <div
                ref={subRef}
                style={{ position: 'absolute', left: '100%', top: -5, paddingLeft: 2, zIndex: 10 }}
              >
                <MenuList items={it.submenu!} onClose={onClose} side />
              </div>
            )}
          </div>
        );
      })}
      {side ? null : null}
    </div>
  );
}

/** 顶部菜单栏的一个下拉按钮 */
export function MenuButton({ label, active, onOpen }: { label: string; active: boolean; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onOpen}
      style={{
        padding: '3px 10px',
        borderRadius: 3,
        fontSize: 12.5,
        fontFamily: FONT,
        cursor: 'default',
        color: T.text,
        background: active || hover ? T.bg3 : 'transparent',
        userSelect: 'none',
      }}
    >
      {label}
    </div>
  );
}

/** 右键菜单（跟随指针位置，超出窗口自动回弹） */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 8),
      y: Math.min(y, window.innerHeight - r.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 9999 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuList items={items} onClose={onClose} />
    </div>
  );
}
