/**
 * 场景对象图标（空节点 / 地面 / 覆盖物 / 敌人 / 角色）
 * 统一 24×24 线性风格，颜色由外部传入，和资源浏览器的图标同调。
 */
import type { SceneKind } from '../model/types';

export function SceneIcon({ kind, size = 14, color }: { kind: SceneKind; size?: number; color?: string }) {
  const s = { fill: 'none', stroke: color ?? 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ display: 'block', flexShrink: 0 }}>
      {kind === 'group' && (
        <>
          <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="2.4" {...s} strokeDasharray="3 2.4" opacity=".85" />
          <path d="M12 8.2v7.6M8.2 12h7.6" {...s} strokeWidth={1.4} opacity=".7" />
        </>
      )}

      {kind === 'ground' && (
        <>
          <path d="M12 3.6 21 8.4 12 13.2 3 8.4z" {...s} />
          <path d="M3 8.4v7.2l9 4.8 9-4.8V8.4" {...s} opacity=".65" />
          <path d="M12 13.2v7.2" {...s} opacity=".45" />
        </>
      )}

      {kind === 'cover' && (
        <>
          <path d="M6.4 19.6c0-3.4.9-6.8 2.6-8.6.6 2.2.9 4.9.9 8.6" {...s} />
          <path d="M11.9 19.6c0-4 .5-7.6 2-10.4 1 2.8 1.4 6.4 1.4 10.4" {...s} opacity=".9" />
          <path d="M16.9 19.6c0-2.4.5-4.4 1.6-5.8.5 1.6.7 3.5.7 5.8" {...s} opacity=".7" />
          <path d="M3.4 19.8h17.2" {...s} opacity=".55" />
        </>
      )}

      {kind === 'enemy' && (
        <>
          <path d="M6.6 7.4 4.2 4.6c-.4 2 .2 3.6 1.4 4.6M17.4 7.4l2.4-2.8c.4 2-.2 3.6-1.4 4.6" {...s} />
          <path d="M12 5.6c3.6 0 6.2 2.8 6.2 6.4 0 4-2.8 6.4-6.2 6.4s-6.2-2.4-6.2-6.4c0-3.6 2.6-6.4 6.2-6.4z" {...s} />
          <path d="M9.4 11.4h1.6M13 11.4h1.6" {...s} strokeWidth={2} />
          <path d="M9.4 15.4c1.8-1 3.4-1 5.2 0" {...s} strokeWidth={1.4} opacity=".8" />
        </>
      )}

      {kind === 'character' && (
        <>
          <circle cx="12" cy="7.6" r="3.4" {...s} />
          <path d="M4.8 20.4c.6-4.2 3.6-6.6 7.2-6.6s6.6 2.4 7.2 6.6" {...s} />
          <path d="M8.6 20.4h6.8" {...s} opacity=".45" />
        </>
      )}

      {kind === 'mapui' && (
        <>
          <rect x="4" y="4" width="16" height="16" rx="3" {...s} strokeDasharray="2.6 2.2" opacity=".9" />
          <circle cx="12" cy="12" r="4.2" {...s} strokeWidth={1.4} opacity=".75" />
          <path d="M12 4v2.6M12 17.4V20M4 12h2.6M17.4 12H20" {...s} strokeWidth={1.4} opacity=".6" />
        </>
      )}
      {kind === 'time' && (
        <>
          <circle cx="12" cy="12" r="8.2" {...s} />
          <path d="M12 7.4V12l3.2 2" {...s} />
          <path d="M12 2.6v1.6M12 19.8v1.6M2.6 12h1.6M19.8 12h1.6" {...s} strokeWidth={1.3} opacity=".55" />
        </>
      )}

      {kind === 'weather' && (
        <>
          <path d="M7.6 15.4a3.6 3.6 0 0 1 .5-7.2 5 5 0 0 1 9.4 1.5 3.1 3.1 0 0 1-.4 5.7" {...s} />
          <path d="M8.6 18.2 7.6 20.4M12 18.2l-1 2.2M15.4 18.2l-1 2.2" {...s} strokeWidth={1.5} opacity=".75" />
        </>
      )}

      {kind === 'camera' && (
        <>
          <path d="M3.4 8.2h11.2v8.2H3.4z" {...s} />
          <path d="M14.6 11.2l5.6-2.6v7.4l-5.6-2.6z" {...s} />
          <circle cx="7.4" cy="12.3" r="2.2" {...s} strokeWidth={1.4} opacity=".75" />
        </>
      )}
    </svg>
  );
}
