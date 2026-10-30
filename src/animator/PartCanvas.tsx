import { useRef, useEffect } from 'react';
import { PartDef, PartPose } from './types';

interface Props {
  parts: PartDef[];
  poses: Record<string, PartPose>;
  selected: string[];
  onSelect: (ids: string[]) => void;
  onPoseChange: (partId: string, pose: PartPose) => void;
}

const GRID = 30;

/**
 * 画布：每个 part 画一个矩形占位（没有贴图时用颜色块 + 标签），
 * 拖拽修改 x/y，R 键旋转，S 键缩放，或直接拖变换手柄。
 */
export function PartCanvas({ parts, poses, selected, onSelect, onPoseChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef<{ partId: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1a1a1e'; ctx.fillRect(0, 0, w, h);

    // 网格
    ctx.strokeStyle = '#2a2a30'; ctx.lineWidth = 1;
    for (let x = 0; x < w; x += GRID) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += GRID) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    // 世界原点（画布中心）
    const cx = w / 2, cy = h / 2;
    ctx.strokeStyle = '#444'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();

    // 按 zIndex 排序绘制
    const sorted = [...parts].sort((a, b) => a.zIndex - b.zIndex);
    for (const p of sorted) {
      const pose = poses[p.id] ?? p.defaultPose;
      const wx = cx + pose.x * GRID;
      const wy = cy - pose.y * GRID;
      const isSel = selected.includes(p.id);
      const size = 50 * pose.scale;
      ctx.save();
      ctx.translate(wx, wy);
      ctx.rotate((-pose.rot * Math.PI) / 180);
      ctx.fillStyle = isSel ? '#4b7' : PART_COLOR(p.id);
      ctx.globalAlpha = 0.85;
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = isSel ? '#fff' : '#777';
      ctx.lineWidth = isSel ? 2 : 1;
      ctx.strokeRect(-size / 2, -size / 2, size, size);
      ctx.fillStyle = '#fff';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.rotate((pose.rot * Math.PI) / 180); // 把文字转回不旋转
      ctx.fillText(p.label, 0, 0);
      ctx.restore();
    }
  });

  const getPartAt = (mx: number, my: number): string | null => {
    const c = canvasRef.current!;
    const cx = c.clientWidth / 2, cy = c.clientHeight / 2;
    // 反向绘制顺序（上层先命中）
    const sorted = [...parts].sort((a, b) => b.zIndex - a.zIndex);
    for (const p of sorted) {
      const pose = poses[p.id] ?? p.defaultPose;
      const wx = cx + pose.x * GRID, wy = cy - pose.y * GRID;
      const size = 50 * pose.scale;
      const dx = mx - wx, dy = my - wy;
      if (Math.abs(dx) < size / 2 && Math.abs(dy) < size / 2) return p.id;
    }
    return null;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = getPartAt(mx, my);
    if (!hit) { onSelect([]); return; }
    if (!selected.includes(hit)) onSelect([hit]);
    const p = parts.find(x => x.id === hit)!;
    const pose = poses[hit] ?? p.defaultPose;
    draggingRef.current = { partId: hit, startX: mx, startY: my, origX: pose.x, origY: pose.y };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!draggingRef.current) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const d = draggingRef.current;
    const dx = (mx - d.startX) / GRID;
    const dy = -(my - d.startY) / GRID; // y 向上为正
    onPoseChange(d.partId, { ...(poses[d.partId] ?? parts.find(x => x.id === d.partId)!.defaultPose), x: d.origX + dx, y: d.origY + dy });
  };

  const onMouseUp = () => { draggingRef.current = null; };

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{ width: '100%', height: '100%', display: 'block', cursor: draggingRef.current ? 'grabbing' : 'default' }}
    />
  );
}

function PART_COLOR(id: string): string {
  const palette = ['#556b2f', '#8b4513', '#2f4f4f', '#4b0082', '#55691e', '#8b7355', '#6b4423', '#3a5f5f', '#4a4e69'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
