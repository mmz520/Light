import { useState } from 'react';
import { GameCanvas } from '@/ui/GameCanvas';
import { AnimatorStudio } from '@/animator/AnimatorStudio';

export default function App() {
  const [mode, setMode] = useState<'game' | 'animator'>('game');
  if (mode === 'animator') {
    // 动画编辑器：不再显示左上角的模式切换按钮，头部自带"返回"
    return <AnimatorStudio onBack={() => setMode('game')} />;
  }
  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <GameCanvas />
      <button
        onClick={() => setMode('animator')}
        style={{
          position: 'fixed', top: 10, right: 10, zIndex: 9999,
          padding: '6px 14px', background: '#333', color: '#ddd', border: '1px solid #555',
          borderRadius: 4, cursor: 'pointer', fontSize: 13,
        }}
      >动画编辑器</button>
    </div>
  );
}
