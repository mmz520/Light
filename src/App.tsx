import { useState } from 'react';
import { GameCanvas } from '@/ui/GameCanvas';
import { AnimatorStudio } from '@/animator/AnimatorStudio';

export default function App() {
  const [mode, setMode] = useState<'game' | 'animator'>('game');
  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <div style={{
        position: 'fixed', top: 10, right: 10, zIndex: 9999,
        display: 'flex', gap: 6,
      }}>
        <button
          onClick={() => setMode('game')}
          style={mode === 'game' ? ACTIVE : IDLE}
        >游戏</button>
        <button
          onClick={() => setMode('animator')}
          style={mode === 'animator' ? ACTIVE : IDLE}
        >动画编辑器</button>
      </div>
      {mode === 'game' ? <GameCanvas /> : <AnimatorStudio />}
    </div>
  );
}

const ACTIVE: React.CSSProperties = {
  padding: '6px 14px', background: '#4b7', color: '#000', border: 'none',
  borderRadius: 4, cursor: 'pointer', fontSize: 13,
};
const IDLE: React.CSSProperties = {
  padding: '6px 14px', background: '#333', color: '#ddd', border: '1px solid #555',
  borderRadius: 4, cursor: 'pointer', fontSize: 13,
};
