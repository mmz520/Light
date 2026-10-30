import { Clip, EaseName, LoopMode, PartDef, PartPose } from './types';

interface Props {
  parts: PartDef[];
  selectedIds: string[];
  poses: Record<string, PartPose>;
  clip: Clip;
  cursorT: number;
  onSetEase: (partId: string, ease: EaseName) => void;
  onSetLoop: (loop: LoopMode, loopStart?: number) => void;
  onSetDuration: (d: number) => void;
  onDeleteThisKeyframe: () => void;
}

const EASES: EaseName[] = ['linear', 'easeInQuad', 'easeOutQuad', 'easeInOutQuad', 'easeOutBack', 'easeOutElastic'];

export function PosePanel({ parts, selectedIds, poses, clip, cursorT, onSetEase, onSetLoop, onSetDuration, onDeleteThisKeyframe }: Props) {
  const sel = selectedIds[0];
  const part = parts.find(p => p.id === sel);
  const pose = sel && poses[sel];
  const track = sel ? clip.tracks.find(t => t.partId === sel) : undefined;
  const kfAtCursor = track?.keys.find(k => Math.abs(k.t - cursorT) < 1e-3);

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 11, opacity: .6, marginBottom: 8 }}>Clip</div>
      <div style={{ display: 'grid', gap: 6, marginBottom: 16 }}>
        <Field label="时长 (秒)">
          <input type="number" min={0.1} step={0.1} value={clip.duration.toFixed(2)}
                 onChange={e => onSetDuration(parseFloat(e.target.value))}
                 style={INPUT} />
        </Field>
        <Field label="循环模式">
          <select value={clip.loop} onChange={e => onSetLoop(e.target.value as LoopMode, clip.loopStart)} style={INPUT}>
            <option value="once">once（一次）</option>
            <option value="loop">loop（循环）</option>
            <option value="pingpong">pingpong（往返）</option>
          </select>
        </Field>
        {clip.loop !== 'once' && (
          <Field label="循环起点 (秒)">
            <input type="number" min={0} step={0.05} value={(clip.loopStart ?? 0).toFixed(2)}
                   onChange={e => onSetLoop(clip.loop, parseFloat(e.target.value))}
                   style={INPUT} />
          </Field>
        )}
      </div>

      <div style={{ fontSize: 11, opacity: .6, marginBottom: 8, marginTop: 8 }}>
        当前时间 {cursorT.toFixed(3)}s {kfAtCursor ? '· 有关键帧' : '· 无关键帧'}
      </div>
      <button onClick={onDeleteThisKeyframe} disabled={!kfAtCursor} style={{ ...BUTTON, marginBottom: 16 }}>
        删除此时间点关键帧
      </button>

      {sel && part && pose && (
        <>
          <div style={{ fontSize: 11, opacity: .6, marginBottom: 8 }}>部件：{part.label} ({part.id})</div>
          <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
            <Field label="X">
              <input type="number" step={0.1} value={pose.x.toFixed(2)} readOnly style={{ ...INPUT, background: '#2a2a30' }} />
            </Field>
            <Field label="Y">
              <input type="number" step={0.1} value={pose.y.toFixed(2)} readOnly style={{ ...INPUT, background: '#2a2a30' }} />
            </Field>
            <Field label="旋转°">
              <input type="number" step={1} value={pose.rot.toFixed(1)} readOnly style={{ ...INPUT, background: '#2a2a30' }} />
            </Field>
            <Field label="缩放">
              <input type="number" step={0.05} value={pose.scale.toFixed(2)} readOnly style={{ ...INPUT, background: '#2a2a30' }} />
            </Field>
          </div>
          <Field label="缓动（当前关键帧）">
            <select value={kfAtCursor?.ease ?? 'linear'}
                    onChange={e => onSetEase(sel, e.target.value as EaseName)}
                    disabled={!kfAtCursor} style={INPUT}>
              {EASES.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </Field>
          <div style={{ fontSize: 10, opacity: .5, marginTop: 6 }}>
            提示：X/Y/旋转/缩放 直接在画布上拖拽；或在录制模式下自动写关键帧。
          </div>
        </>
      )}

      {!sel && <div style={{ opacity: .5 }}>选择一个部件查看属性</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', alignItems: 'center', gap: 8 }}>
      <div style={{ fontSize: 11, opacity: .7 }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

const INPUT: React.CSSProperties = {
  width: '100%', padding: '4px 8px', background: '#2a2a30', color: '#e4e4e8',
  border: '1px solid #444', borderRadius: 4, fontSize: 12, boxSizing: 'border-box',
};
const BUTTON: React.CSSProperties = {
  width: '100%', padding: '6px 10px', background: '#3a6', color: '#fff',
  border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12,
};
