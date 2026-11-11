/**
 * 动画编辑器（浮窗内容）
 *
 * 布局：节点树 / 三维视口 / 节点属性 + 底部时间轴。
 * 所有修改直接写进工程的动画资产，由 store 负责自动保存。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PartTree } from '../../animator/PartTree';
import { Timeline } from '../../animator/Timeline';
import { Viewport3D, type ViewportTool } from '../../animator/Viewport3D';
import { sampleClip, type Clip, type Keyframe, type OverlayDef, type PartPose } from '../../animator/types';
import { animationParts } from '../model/resolve';
import { editorStore, useEditor } from '../model/store';
import { CLIP_PRESETS, DIRS, DIR_HINT, type AnimNode, type Dir, type ProjectDoc } from '../model/types';
import { GroupSlot } from './AssetPicker';
import { T, btnStyle, inputStyle } from './theme';

const ZERO: PartPose = { x: 0, y: 0, rot: 0, scale: 1 };

export function AnimationWorkbench({ animId }: { animId: string }) {
  const state = useEditor();
  const project = state.project;
  const anim = project?.animations.find((a) => a.id === animId);
  if (!project || !anim) {
    return <div style={{ padding: 20, color: T.dimmer, fontSize: 12 }}>动画已被删除</div>;
  }
  return <Workbench key={animId} project={project} animId={animId} />;
}

function Workbench({ project, animId }: { project: ProjectDoc; animId: string }) {
  const anim = project.animations.find((a) => a.id === animId)!;
  const clipNames = Object.keys(anim.clips);
  const [clipName, setClipName] = useState(clipNames[0] ?? '');
  const [cursorT, setCursorT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dir, setDir] = useState<Dir>('S');
  const [tool, setTool] = useState<ViewportTool>('move');
  const [frameClip, setFrameClip] = useState<{ poses: Record<string, PartPose>; visibility: Record<string, boolean> } | null>(null);

  useEffect(() => {
    if (!anim.clips[clipName] && clipNames[0]) setClipName(clipNames[0]);
  }, [anim.clips, clipName, clipNames]);

  const clip: Clip | undefined = anim.clips[clipName];
  const parts = useMemo(() => animationParts(project, anim, dir), [project, anim, dir]);
  const sampled = useMemo(
    () => (clip ? sampleClip(clip, cursorT) : { poses: {} as Record<string, PartPose>, visibility: {} as Record<string, boolean> }),
    [clip, cursorT],
  );

  const playRef = useRef({ clip, playing });
  playRef.current = { clip, playing };

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const c = playRef.current.clip;
      if (c) {
        setCursorT((prev) => {
          let next = prev + dt;
          if (next > c.duration) {
            if (c.loop === 'loop') next = next % Math.max(0.001, c.duration);
            else if (c.loop === 'pingpong') next = c.duration - (next - c.duration);
            else {
              setPlaying(false);
              return c.duration;
            }
          }
          return next;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const updateClip = (fn: (c: Clip) => void, mergeKey?: string) => {
    editorStore.mutateAnimation(
      animId,
      (a) => {
        const target = a.clips[clipName];
        if (target) fn(target);
      },
      mergeKey ?? `clip:${animId}:${clipName}`,
    );
  };

  const writePoseKey = (partId: string, pose: PartPose) => {
    updateClip((c) => {
      const tr = c.tracks.find((t) => t.partId === partId);
      if (!tr) return;
      const keys = tr.keys.filter((k) => Math.abs(k.t - cursorT) > 1e-3);
      keys.push({ t: cursorT, pose: { ...pose }, ease: 'easeOutQuad' });
      keys.sort((a, b) => a.t - b.t);
      tr.keys = keys;
    }, `pose:${partId}`);
  };

  const addKeyAt = (partId: string, t: number) => {
    if (!clip) return;
    const snap = sampleClip(clip, t);
    const pose = snap.poses[partId] ?? ZERO;
    updateClip((c) => {
      const tr = c.tracks.find((x) => x.partId === partId);
      if (!tr) return;
      const keys = tr.keys.filter((k) => Math.abs(k.t - t) > 1e-3);
      keys.push({ t, pose: { ...pose }, ease: 'easeOutQuad' });
      keys.sort((a, b) => a.t - b.t);
      tr.keys = keys;
    });
  };

  const selNodeId = selectedId ? selectedId.split('#')[0] : null;
  const selNode = anim.nodes.find((n) => n.id === selNodeId) ?? null;

  return (
    <div
      style={{
        height: '100%',
        display: 'grid',
        gridTemplateColumns: '196px 1fr 248px',
        gridTemplateRows: '30px 1fr 210px',
        gridTemplateAreas: `
          "bar bar bar"
          "tree scene insp"
          "timeline timeline timeline"
        `,
        background: T.bg1,
        minHeight: 0,
      }}
    >
      {/* 工具条 */}
      <div
        style={{
          gridArea: 'bar',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 8px',
          borderBottom: `1px solid ${T.lineSoft}`,
          background: T.bg2,
        }}
      >
        <button onClick={() => setPlaying((p) => !p)} title={playing ? '暂停' : '播放'} style={{ ...btnStyle, width: 28, padding: '2px 0' }}>
          {playing ? '⏸' : '▶'}
        </button>
        <button
          onClick={() => {
            setPlaying(false);
            setCursorT(0);
          }}
          title="停止"
          style={{ ...btnStyle, width: 28, padding: '2px 0' }}
        >
          ⏹
        </button>
        <select value={clipName} onChange={(e) => { setClipName(e.target.value); setCursorT(0); }} style={{ ...inputStyle, width: 96 }}>
          {clipNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: T.dimmer, width: 84 }}>
          {cursorT.toFixed(2)} / {clip ? clip.duration.toFixed(2) : '0'}s
        </span>

        <div style={{ display: 'flex', gap: 2 }}>
          {(['move', 'rotate', 'scale'] as ViewportTool[]).map((k, i) => (
            <button
              key={k}
              onClick={() => setTool(k)}
              title={['移动 (W)', '旋转 (E)', '缩放 (R)'][i]}
              style={{
                ...btnStyle,
                padding: '2px 7px',
                fontSize: 11,
                background: tool === k ? T.accent : T.bg3,
                color: tool === k ? '#1a1410' : T.text,
                border: 'none',
              }}
            >
              {['移动', '旋转', '缩放'][i]}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5, color: T.dimmer }}>方向</span>
        <div style={{ display: 'flex', gap: 2 }}>
          {DIRS.map((d) => (
            <button
              key={d}
              onClick={() => setDir(d)}
              title={DIR_HINT[d]}
              style={{
                ...btnStyle,
                padding: '2px 6px',
                fontSize: 11,
                background: dir === d ? T.accent : T.bg3,
                color: dir === d ? '#1a1410' : T.text,
                border: 'none',
              }}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* 节点树 */}
      <div style={{ gridArea: 'tree', borderRight: `1px solid ${T.lineSoft}`, overflow: 'auto', minHeight: 0 }}>
        <div style={{ padding: '6px 8px 2px', fontSize: 10.5, color: T.dimmer, letterSpacing: '.06em' }}>骨架节点</div>
        <PartTree parts={parts} selectedId={selNodeId} onSelect={(id) => setSelectedId(id)} />
      </div>

      {/* 视口 */}
      <div style={{ gridArea: 'scene', position: 'relative', overflow: 'hidden', minHeight: 0 }}>
        <Viewport3D
          parts={parts}
          poses={sampled.poses}
          visibility={sampled.visibility}
          selectedId={selectedId}
          tool={tool}
          onToolChange={setTool}
          onSelect={setSelectedId}
          onPoseChange={(partId, pose) => writePoseKey(partId, pose)}
          onOverlayChange={(partId, overlay: OverlayDef) => {
            editorStore.mutateAnimation(animId, (a) => {
              const node = a.nodes.find((n) => n.id === partId);
              if (!node?.overlay) return;
              node.overlay.offsetX = overlay.offsetX;
              node.overlay.offsetY = overlay.offsetY;
              node.overlay.offsetZ = overlay.offsetZ ?? 0;
              node.overlay.rot = overlay.rot;
              node.overlay.scale = overlay.scale;
            }, `ov:${partId}`);
          }}
        />
      </div>

      {/* 右侧属性 */}
      <div style={{ gridArea: 'insp', borderLeft: `1px solid ${T.lineSoft}`, overflow: 'auto', minHeight: 0 }}>
        {selNode ? (
          <NodePanel animId={animId} node={selNode} dir={dir} project={project} />
        ) : (
          <div style={{ padding: 14, color: T.dimmer, fontSize: 11.5, lineHeight: 1.8 }}>
            在左侧节点树或视口里选中一个节点，
            <br />
            可以给它指定图组与覆盖物图组。
          </div>
        )}
        <ClipPanel
          animId={animId}
          clipName={clipName}
          clip={clip}
          onChange={updateClip}
          onSelectClip={(n) => {
            setClipName(n);
            setCursorT(0);
          }}
        />
      </div>

      {/* 时间轴 */}
      <div style={{ gridArea: 'timeline', borderTop: `1px solid ${T.lineSoft}`, overflow: 'hidden', minHeight: 0 }}>
        {clip ? (
          <Timeline
            clip={clip}
            parts={parts}
            cursorT={cursorT}
            isPlaying={playing}
            fps={anim.fps}
            onCursorChange={setCursorT}
            onPlayToggle={() => setPlaying((p) => !p)}
            onStop={() => {
              setPlaying(false);
              setCursorT(0);
            }}
            onAddKeyframe={addKeyAt}
            onDeleteKeyframe={(partId, t) => {
              updateClip((c) => {
                const tr = c.tracks.find((x) => x.partId === partId);
                if (tr) tr.keys = tr.keys.filter((k) => Math.abs(k.t - t) > 1e-3);
              });
            }}
            onMoveKeyframe={(partId, fromT, toT) => {
              updateClip((c) => {
                const tr = c.tracks.find((x) => x.partId === partId);
                if (!tr) return;
                const key = tr.keys.find((k) => Math.abs(k.t - fromT) < 1e-3);
                if (!key) return;
                tr.keys = tr.keys.filter((k) => Math.abs(k.t - fromT) > 1e-3 && Math.abs(k.t - toT) > 1e-3);
                tr.keys.push({ ...key, t: toT });
                tr.keys.sort((a, b) => a.t - b.t);
              }, `kf:${partId}`);
            }}
            hasFrameClipboard={!!frameClip}
            onCopyFrame={(t) => {
              if (!clip) return;
              const s = sampleClip(clip, t);
              setFrameClip({ poses: s.poses, visibility: s.visibility });
            }}
            onPasteFrame={(t) => {
              if (!frameClip) return;
              updateClip((c) => {
                for (const tr of c.tracks) {
                  const pose = frameClip.poses[tr.partId];
                  if (!pose) continue;
                  const key: Keyframe = { t, pose: { ...pose }, ease: 'easeOutQuad' };
                  const vis = frameClip.visibility[tr.partId];
                  if (vis !== undefined) key.visible = vis;
                  const keys = tr.keys.filter((k) => Math.abs(k.t - t) > 1e-3);
                  keys.push(key);
                  keys.sort((a, b) => a.t - b.t);
                  tr.keys = keys;
                }
              });
            }}
            locals={[]}
            selectedLocalId={null}
            onSelectLocal={() => undefined}
            onMoveLocal={() => undefined}
            onMoveLocalKey={() => undefined}
            onDeleteLocalKey={() => undefined}
            onDeleteLocal={() => undefined}
            onToggleLocalLoop={() => undefined}
            onAddLocal={() => undefined}
          />
        ) : (
          <div style={{ padding: 16, color: T.dimmer, fontSize: 12 }}>这个动画还没有片段</div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function NodePanel({ animId, node, dir, project }: { animId: string; node: AnimNode; dir: Dir; project: ProjectDoc }) {
  const setNode = (patch: Partial<AnimNode>, mergeKey?: string) =>
    editorStore.updateNode(animId, node.id, patch, mergeKey);


  const setOverlay = (patch: Partial<NonNullable<AnimNode['overlay']>>, mergeKey?: string) => {
    editorStore.mutateAnimation(
      animId,
      (a) => {
        const n = a.nodes.find((x) => x.id === node.id);
        if (n?.overlay) Object.assign(n.overlay, patch);
      },
      mergeKey ?? `ov:${node.id}`,
    );
  };

  const ov = node.overlay;

  return (
    <div style={{ padding: '10px 12px', borderBottom: `1px solid ${T.lineSoft}` }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 2 }}>{node.label}</div>
      <div style={{ fontSize: 10.5, color: T.dimmer, marginBottom: 10 }}>
        {node.id} · 槽位 {node.slot} · 层级 {node.z}
      </div>

      <div style={{ fontSize: 11, color: T.dim, marginBottom: 3 }}>节点图组</div>
      <div style={{ marginBottom: 12 }}>
        <GroupSlot
          project={project}
          thumbSize={34}
          value={{ id: node.textureId, color: node.textureColor ?? null }}
          onChange={(v) => setNode({ textureId: v.id, textureColor: v.color ?? null })}
        />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={!!ov}
          onChange={(e) => {
            if (e.target.checked) {
              setNode({
                overlay: {
                  id: `ov_${node.id}`,
                  textureId: null,
                  textureColor: null,
                  offsetX: 0,
                  offsetY: 0,
                  offsetZ: 0,
                  rot: 0,
                  scale: 1,
                  zIndex: null,
                },
              });
            } else {
              setNode({ overlay: null });
            }
          }}
        />
        覆盖物图组
      </label>

      {ov && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 8 }}>
            <GroupSlot
              project={project}
              thumbSize={34}
              value={{ id: ov.textureId, color: ov.textureColor ?? null }}
              onChange={(v) => setOverlay({ textureId: v.id, textureColor: v.color ?? null })}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <Num label="X" value={ov.offsetX} onChange={(v) => setOverlay({ offsetX: v })} />
            <Num label="Y" value={ov.offsetY} onChange={(v) => setOverlay({ offsetY: v })} />
            <Num label="Z" value={ov.offsetZ} onChange={(v) => setOverlay({ offsetZ: v })} />
            <Num label="旋转" value={ov.rot} onChange={(v) => setOverlay({ rot: v })} />
            <Num label="缩放" value={ov.scale} step={0.05} onChange={(v) => setOverlay({ scale: v })} />
            <Num
              label="层级"
              value={ov.zIndex ?? node.z}
              onChange={(v) => setOverlay({ zIndex: v })}
            />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <Num label="基准 X" value={node.layout.x} step={0.005} onChange={(v) => setNode({ layout: { ...node.layout, x: v } }, `lay:${node.id}`)} />
        <Num label="基准 Y" value={node.layout.y} step={0.005} onChange={(v) => setNode({ layout: { ...node.layout, y: v } }, `lay:${node.id}`)} />
        <Num label="高度" value={node.layout.h} step={0.005} onChange={(v) => setNode({ layout: { ...node.layout, h: Math.max(0.01, v) } }, `lay:${node.id}`)} />
        <Num label="层级 z" value={node.z} onChange={(v) => setNode({ z: v })} />
      </div>

      <div style={{ fontSize: 10, color: T.dimmer, marginTop: 8, lineHeight: 1.6 }}>
        当前方向 {dir}：四向图组会自动切换。
      </div>
    </div>
  );
}

function Num({
  label,
  value,
  onChange,
  step = 0.01,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label style={{ fontSize: 10.5, color: T.dim }}>
      {label}
      <input
        type="number"
        value={Number(value.toFixed(4))}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ...inputStyle, marginTop: 2 }}
      />
    </label>
  );
}

/* ------------------------------------------------------------------ */

function ClipPanel({
  animId,
  clipName,
  clip,
  onChange,
  onSelectClip,
}: {
  animId: string;
  clipName: string;
  clip: Clip | undefined;
  onChange: (fn: (c: Clip) => void, mergeKey?: string) => void;
  onSelectClip: (name: string) => void;
}) {
  const [nameDraft, setNameDraft] = useState(clipName);
  const [focused, setFocused] = useState(false);
  if (!focused && nameDraft !== clipName) setNameDraft(clipName);

  if (!clip) return null;

  const commitName = () => {
    const next = nameDraft.trim();
    if (!next || next === clipName) {
      setNameDraft(clipName);
      return;
    }
    let ok = false;
    editorStore.mutateAnimation(animId, (a) => {
      if (a.clips[next]) return;
      const c = a.clips[clipName];
      if (!c) return;
      delete a.clips[clipName];
      c.name = next;
      a.clips[next] = c;
      ok = true;
    });
    if (ok) onSelectClip(next);
    else setNameDraft(clipName);
  };

  return (
    <div style={{ padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: T.dimmer, letterSpacing: '.06em', marginBottom: 6 }}>片段</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commitName();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          style={inputStyle}
          title="片段名"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
        <Num
          label="时长(s)"
          value={clip.duration}
          step={0.05}
          onChange={(v) => onChange((c) => { c.duration = Math.max(0.05, v); })}
        />
        <label style={{ fontSize: 10.5, color: T.dim }}>
          循环
          <select
            value={clip.loop}
            onChange={(e) => onChange((c) => { c.loop = e.target.value as Clip['loop']; })}
            style={{ ...inputStyle, marginTop: 2 }}
          >
            <option value="loop">循环</option>
            <option value="once">单次</option>
            <option value="pingpong">往返</option>
          </select>
        </label>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {CLIP_PRESETS.map((p) => (
          <button
            key={p.name}
            onClick={() => {
              let added = false;
              editorStore.mutateAnimation(animId, (a) => {
                if (a.clips[p.name]) return;
                a.clips[p.name] = {
                  name: p.name,
                  duration: p.duration,
                  loop: p.loop,
                  tracks: a.nodes.map((n) => ({
                    partId: n.id,
                    keys: [{ t: 0, pose: { ...ZERO }, ease: 'linear' as const }],
                  })),
                };
                added = true;
              });
              if (added) onSelectClip(p.name);
            }}
            title={`添加 ${p.label} 片段`}
            style={{ ...btnStyle, padding: '2px 6px', fontSize: 10.5 }}
          >
            +{p.name}
          </button>
        ))}
      </div>
    </div>
  );
}
