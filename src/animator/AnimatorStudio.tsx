import { useEffect, useRef, useState, useCallback } from 'react';
import {
  AnimatorProject,
  Clip,
  Keyframe,
  PartDef,
  PartPose,
  Track,
  sampleClip,
} from './types';
import { PartCanvas } from './PartCanvas';
import { Timeline } from './Timeline';
import { PartTree } from './PartTree';
import { PosePanel } from './PosePanel';
import { ClipPanel } from './ClipPanel';

type Mode = 'select' | 'record' | 'play';

const DEFAULT_PARTS: PartDef[] = [
  { id: 'body', label: '身体', texturePath: '', defaultPose: { x: 0, y: 0, rot: 0, scale: 1 }, zIndex: 2 },
  { id: 'head', label: '头', texturePath: '', defaultPose: { x: 0, y: -30, rot: 0, scale: 1 }, zIndex: 3 },
  { id: 'arm_L', label: '左臂', texturePath: '', defaultPose: { x: -20, y: -10, rot: 0, scale: 1 }, zIndex: 2 },
  { id: 'arm_R', label: '右臂', texturePath: '', defaultPose: { x: 20, y: -10, rot: 0, scale: 1 }, zIndex: 2 },
  { id: 'leg_L', label: '左腿', texturePath: '', defaultPose: { x: -10, y: 30, rot: 0, scale: 1 }, zIndex: 1 },
  { id: 'leg_R', label: '右腿', texturePath: '', defaultPose: { x: 10, y: 30, rot: 0, scale: 1 }, zIndex: 1 },
  { id: 'weapon', label: '武器', texturePath: '', defaultPose: { x: 35, y: -10, rot: 0, scale: 1 }, zIndex: 3 },
];

function newClip(name: string, duration: number, parts: PartDef[]): Clip {
  const tracks: Track[] = parts.map(p => ({
    partId: p.id,
    keys: [{ t: 0, pose: { ...p.defaultPose }, ease: 'linear' }],
  }));
  return { name, duration, loop: 'loop', tracks };
}

function newProject(targetId: string, direction: 'S' | 'E' | 'N' | 'W'): AnimatorProject {
  const parts = DEFAULT_PARTS;
  return {
    version: 1,
    targetId,
    direction,
    parts,
    clips: {
      idle: newClip('idle', 2.0, parts),
      walk: newClip('walk', 1.2, parts),
      attack: newClip('attack', 0.8, parts),
    },
    fps: 60,
  };
}

export function AnimatorStudio() {
  const [project, setProject] = useState<AnimatorProject>(() => newProject('engineer_spanner', 'S'));
  const [activeClipName, setActiveClipName] = useState<string>('idle');
  const [selectedPartIds, setSelectedPartIds] = useState<string[]>(['body']);
  const [mode, setMode] = useState<Mode>('select');
  const [cursorT, setCursorT] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const projectRef = useRef(project);
  projectRef.current = project;

  const clip = project.clips[activeClipName];

  /** 更新某个 clip */
  const updateClip = useCallback((name: string, mutator: (c: Clip) => Clip) => {
    setProject(p => ({ ...p, clips: { ...p.clips, [name]: mutator(p.clips[name]) } }));
  }, []);

  /** 在活动 clip 的指定时间点为指定部件写一个关键帧 */
  const setKeyframesAt = useCallback((t: number, partPoses: Record<string, PartPose>) => {
    updateClip(activeClipName, c => {
      const tracks = c.tracks.map(tr => {
        const pose = partPoses[tr.partId];
        if (!pose) return tr;
        const filtered = tr.keys.filter(k => Math.abs(k.t - t) > 1e-3);
        const keys: Keyframe[] = [...filtered, { t, pose: { ...pose }, ease: 'easeOutQuad' as const }].sort((a, b) => a.t - b.t);
        return { ...tr, keys };
      });
      return { ...c, tracks };
    });
  }, [activeClipName, updateClip]);

  /** 删除活动 clip 指定时间点的关键帧 */
  const deleteKeyframesAt = useCallback((t: number) => {
    updateClip(activeClipName, c => {
      const tracks = c.tracks.map(tr => ({ ...tr, keys: tr.keys.filter(k => Math.abs(k.t - t) > 1e-3) }));
      return { ...c, tracks };
    });
  }, [activeClipName, updateClip]);

  /** 播放循环 */
  useEffect(() => {
    if (!isPlaying) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setCursorT(t => {
        let next = t + dt;
        if (next > clip.duration) {
          if (clip.loop === 'loop') next -= clip.duration;
          else if (clip.loop === 'pingpong') next = clip.duration * 2 - next;
          else { setIsPlaying(false); return clip.duration; }
        }
        if (next < 0) next += clip.duration;
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, clip]);

  /** 导出 JSON */
  const handleSave = () => {
    const data = JSON.stringify(project, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.targetId}_${project.direction}_anim.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** 导入 JSON */
  const handleLoad = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const p = JSON.parse(reader.result as string) as AnimatorProject;
          setProject(p);
          const first = Object.keys(p.clips)[0];
          if (first) setActiveClipName(first);
          setCursorT(0);
        } catch (e) { alert('加载失败: ' + (e as Error).message); }
      };
      reader.readAsText(f);
    };
    input.click();
  };

  /** 新增 clip */
  const handleAddClip = () => {
    const name = prompt('新 clip 名:', `anim_${Object.keys(project.clips).length}`);
    if (!name || project.clips[name]) return;
    updateClip(activeClipName, c => c); // 确保 setProject 捕获
    setProject(p => ({ ...p, clips: { ...p.clips, [name]: newClip(name, 1.0, p.parts) } }));
    setActiveClipName(name);
    setCursorT(0);
  };

  /** 删除 clip */
  const handleDeleteClip = () => {
    const names = Object.keys(project.clips);
    if (names.length <= 1) { alert('至少保留一个 clip'); return; }
    if (!confirm(`删除 clip "${activeClipName}"?`)) return;
    setProject(p => {
      const next = { ...p.clips };
      delete next[activeClipName];
      return { ...p, clips: next };
    });
    const remaining = Object.keys(project.clips).filter(n => n !== activeClipName);
    setActiveClipName(remaining[0]);
  };

  /** 活动时间点所有部件的当前 pose */
  const currentPoses = sampleClip(clip, cursorT);

  /** 把当前时间点 pose 写为关键帧 */
  const handleRecord = () => {
    const poses = sampleClip(clip, cursorT);
    // 让用户在画布上调整后再点 "Add Key" 会更灵活，但录制模式下可以直接自动写
    setKeyframesAt(cursorT, poses);
  };

  /** 从外部图片目录导入 texturePath 到 part */
  const handleImportImages = async () => {
    const dir = prompt('输入角色部件图片目录（相对 public/assets/）', 'sprites/engineer_spanner/body');
    if (!dir) return;
    setProject(p => {
      const parts = p.parts.map(part => ({
        ...part,
        texturePath: `${dir}/${part.id}.png`,
      }));
      return { ...p, parts };
    });
  };

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '240px 1fr 260px',
      gridTemplateRows: 'auto 1fr 220px',
      gridTemplateAreas: `
        "top   top    top"
        "left  canvas right"
        "bottom bottom bottom"
      `,
      height: '100vh',
      background: '#1e1e22',
      color: '#e4e4e8',
      fontFamily: 'system-ui, sans-serif',
      fontSize: 13,
    }}>
      {/* 顶部工具栏 */}
      <div style={{ gridArea: 'top', display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #333', background: '#25252a' }}>
        <b>Block Animator</b>
        <span style={{ opacity: .5 }}>target: {project.targetId} · dir: {project.direction}</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setIsPlaying(p => !p)} disabled={mode === 'record'}>
          {isPlaying ? '■ 停' : '▶ 播'}
        </button>
        <button onClick={() => { setCursorT(0); setIsPlaying(false); }}>⏮ 回到 0</button>
        <button onClick={() => setMode('record')} style={{ background: mode === 'record' ? '#d33' : undefined }}>● 录制</button>
        <button onClick={() => setMode('select')}>↓ 选择</button>
        <button onClick={handleRecord}>Add Key @ {cursorT.toFixed(2)}s</button>
        <button onClick={handleImportImages}>导入部件图</button>
        <button onClick={handleSave}>保存 JSON</button>
        <button onClick={handleLoad}>加载 JSON</button>
      </div>

      {/* 左：部件树 */}
      <div style={{ gridArea: 'left', borderRight: '1px solid #333', overflow: 'auto' }}>
        <PartTree
          parts={project.parts}
          selected={selectedPartIds}
          onSelect={ids => setSelectedPartIds(ids)}
        />
      </div>

      {/* 中：画布 */}
      <div style={{ gridArea: 'canvas', position: 'relative' }}>
        <PartCanvas
          parts={project.parts}
          poses={currentPoses}
          selected={selectedPartIds}
          onSelect={setSelectedPartIds}
          onPoseChange={(partId, pose) => {
            // 实时改活动时间点的 pose（不自动写关键帧，录制模式例外）
            if (mode === 'record') {
              setKeyframesAt(cursorT, { [partId]: pose });
            } else {
              setProject(p => {
                const c = p.clips[activeClipName];
                const tracks = c.tracks.map(tr => {
                  if (tr.partId !== partId) return tr;
                  const t = cursorT;
                  const keys = tr.keys.filter(k => Math.abs(k.t - t) > 1e-3);
                  keys.push({ t, pose, ease: 'linear' });
                  keys.sort((a, b) => a.t - b.t);
                  return { ...tr, keys };
                });
                return { ...p, clips: { ...p.clips, [activeClipName]: { ...c, tracks } } };
              });
            }
          }}
        />
      </div>

      {/* 右：属性面板 */}
      <div style={{ gridArea: 'right', borderLeft: '1px solid #333', overflow: 'auto' }}>
        <ClipPanel
          clip={clip}
          allClips={project.clips}
          activeClipName={activeClipName}
          onSwitch={setActiveClipName}
          onAdd={handleAddClip}
          onDelete={handleDeleteClip}
          onUpdate={(name, mut) => updateClip(name, mut)}
        />
        <PosePanel
          parts={project.parts}
          selectedIds={selectedPartIds}
          poses={currentPoses}
          clip={clip}
          cursorT={cursorT}
          onSetEase={(partId, ease) => {
            updateClip(activeClipName, c => ({
              ...c,
              tracks: c.tracks.map(tr =>
                tr.partId !== partId ? tr : {
                  ...tr,
                  keys: tr.keys.map(k => Math.abs(k.t - cursorT) < 1e-3 ? { ...k, ease } : k),
                },
              ),
            }));
          }}
          onSetLoop={(loop, loopStart) => updateClip(activeClipName, c => ({ ...c, loop, loopStart }))}
          onSetDuration={d => updateClip(activeClipName, c => ({ ...c, duration: Math.max(0.1, d) }))}
          onDeleteThisKeyframe={() => deleteKeyframesAt(cursorT)}
        />
      </div>

      {/* 下：时间轴 */}
      <div style={{ gridArea: 'bottom', borderTop: '1px solid #333', background: '#222226', overflow: 'auto' }}>
        <Timeline
          clip={clip}
          parts={project.parts}
          cursorT={cursorT}
          onCursorChange={setCursorT}
          onAddKeyframe={(partId, t) => {
            const poses = sampleClip(clip, t);
            setKeyframesAt(t, { [partId]: poses[partId] });
          }}
          onDeleteKeyframe={(partId, t) => {
            updateClip(activeClipName, c => ({
              ...c,
              tracks: c.tracks.map(tr => tr.partId !== partId ? tr : { ...tr, keys: tr.keys.filter(k => Math.abs(k.t - t) > 1e-3) }),
            }));
          }}
        />
      </div>
    </div>
  );
}
