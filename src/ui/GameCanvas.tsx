import { useEffect, useRef, useState } from 'react';
import { Game } from '@/game/core/Game';
import type { GameEvents } from '@/game/types';

type Stats = GameEvents['stats'];

export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const game = new Game({ canvas });
    const offStats = game.bus.on('stats', setStats);
    const offError = game.bus.on('game:error', ({ message }) => setError(message));

    game.init().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });

    // 调试入口（供自动化检查读取运行时状态）
    (window as unknown as { __game?: Game }).__game = game;

    return () => {
      offStats();
      offError();
      game.dispose();
    };
  }, []);

  return (
    <div className="stage">
      <canvas ref={canvasRef} className="scene-canvas" />

      <div className="hud">
        <div className="hud-title">STEAM PUNK — 工程师</div>
        <div className="hud-row">
          <span>动作</span>
          <b>{stats?.action ?? '-'}</b>
          <span>方向</span>
          <b>{stats?.dir ?? '-'}</b>
        </div>
        <div className="hud-row">
          <span>坐标</span>
          <b>
            {stats ? `${stats.x} , ${stats.z}` : '-'}
          </b>
          <span>FPS</span>
          <b>{stats?.fps ?? '-'}</b>
        </div>
        <div className="hud-tip">WASD 移动 · Shift 疾跑 · 空格 攻击</div>
      </div>

      {error && <div className="error-panel">加载失败：{error}</div>}
    </div>
  );
}
