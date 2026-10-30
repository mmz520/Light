/**
 * PosePanel —— 右侧属性面板
 *
 * · Clip 时长/循环
 * · 选中节点的变换（可编辑，写回当前时间点关键帧）
 * · zIndex（渲染层级）
 * · 节点贴图选择（网格预览，来自 metadata.json）
 * · 覆盖"贴图"：独立位移/旋转/缩放，不影响子节点
 * · 记录显示/隐藏行为
 */
import { useState } from 'react';
import {
  Clip, EaseName, LoopMode, MetadataImage, OverlayDef, PartDef, PartPose, defaultOverlay,
} from './types';
import { TexturePicker } from './TexturePicker';
import { assetUrl } from './Viewport3D';

interface Props {
  part: PartDef | null;
  pose: PartPose | null;
  visible: boolean;
  clip: Clip;
  cursorT: number;
  images: MetadataImage[];
  onPoseChange: (field: keyof PartPose, value: number) => void;
  onZIndexChange: (z: number) => void;
  onSetTexture: (path: string) => void;
  onOverlayChange: (overlay: OverlayDef) => void;
  onOverlayClear: () => void;
  onSetVisibility: (visible: boolean) => void;
  onSetEase: (ease: EaseName) => void;
  onSetLoop: (loop: LoopMode, loopStart?: number) => void;
  onSetDuration: (d: number) => void;
  onDeleteThisKeyframe: () => void;
}

const EASES: EaseName[] = ['linear', 'easeInQuad', 'easeOutQuad', 'easeInOutQuad', 'easeOutBack', 'easeOutElastic'];

export function PosePanel({
  part, pose, visible, clip, cursorT, images,
  onPoseChange, onZIndexChange, onSetTexture, onOverlayChange, onOverlayClear,
  onSetVisibility, onSetEase, onSetLoop, onSetDuration, onDeleteThisKeyframe,
}: Props) {
  const [picker, setPicker] = useState<null | 'part' | 'overlay'>(null);
  const track = part ? clip.tracks.find(t => t.partId === part.id) : undefined;
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
      <button onClick={onDeleteThisKeyframe} disabled={!kfAtCursor} style={{ ...BUTTON, marginBottom: 16, opacity: kfAtCursor ? 1 : .4 }}>
        删除此时间点关键帧
      </button>

      {part && pose ? (
        <>
          <SectionTitle>部件：{part.label} ({part.id})</SectionTitle>

          {/* 变换（相对父节点，写回当前时间点） */}
          <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
            <Field label="X (相对父)">
              <input type="number" step={0.02} value={round(pose.x)}
                     onChange={e => onPoseChange('x', parseFloat(e.target.value) || 0)} style={INPUT} />
            </Field>
            <Field label="Y (相对父)">
              <input type="number" step={0.02} value={round(pose.y)}
                     onChange={e => onPoseChange('y', parseFloat(e.target.value) || 0)} style={INPUT} />
            </Field>
            <Field label="Z (前后)">
              <input type="number" step={0.02} value={round(pose.z ?? 0)}
                     onChange={e => onPoseChange('z', parseFloat(e.target.value) || 0)} style={INPUT} />
            </Field>
            <Field label="旋转 Z°">
              <input type="number" step={1} value={round(pose.rot, 1)}
                     onChange={e => onPoseChange('rot', parseFloat(e.target.value) || 0)} style={INPUT} />
            </Field>
            <Field label="旋转 X°">
              <input type="number" step={1} value={round(pose.rotX ?? 0, 1)}
                     onChange={e => onPoseChange('rotX', parseFloat(e.target.value) || 0)} style={INPUT} />
            </Field>
            <Field label="旋转 Y°">
              <input type="number" step={1} value={round(pose.rotY ?? 0, 1)}
                     onChange={e => onPoseChange('rotY', parseFloat(e.target.value) || 0)} style={INPUT} />
            </Field>
            <Field label="缩放 (Z)">
              <input type="number" step={0.05} min={0.05} value={round(pose.scale, 3)}
                     onChange={e => onPoseChange('scale', Math.max(0.05, parseFloat(e.target.value) || 1))} style={INPUT} />
            </Field>
            <Field label="缩放 X">
              <input type="number" step={0.05} min={0.05} value={round(pose.scaleX ?? 1, 3)}
                     onChange={e => onPoseChange('scaleX', Math.max(0.05, parseFloat(e.target.value) || 1))} style={INPUT} />
            </Field>
            <Field label="缩放 Y">
              <input type="number" step={0.05} min={0.05} value={round(pose.scaleY ?? 1, 3)}
                     onChange={e => onPoseChange('scaleY', Math.max(0.05, parseFloat(e.target.value) || 1))} style={INPUT} />
            </Field>
            <Field label="zIndex">
              <input type="number" step={1} value={part.zIndex}
                     onChange={e => onZIndexChange(parseInt(e.target.value, 10) || 0)} style={INPUT} />
            </Field>
          </div>

          {/* 显示 / 隐藏行为 */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, opacity: .7, marginBottom: 4 }}>
              可见性：<b style={{ color: visible ? '#5d5' : '#e55' }}>{visible ? '显示' : '隐藏'}</b>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => onSetVisibility(true)} style={{ ...SMALL_BTN, background: '#2a5a2a', flex: 1 }}>
                ● 记录显示 @当前
              </button>
              <button onClick={() => onSetVisibility(false)} style={{ ...SMALL_BTN, background: '#7a2a2a', flex: 1 }}>
                ● 记录隐藏 @当前
              </button>
            </div>
          </div>

          {/* 节点贴图 */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, opacity: .7, marginBottom: 4 }}>节点贴图</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Thumb path={part.texturePath} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                <button onClick={() => setPicker('part')} style={SMALL_BTN}>从图库选择…</button>
                {part.texturePath && (
                  <button onClick={() => onSetTexture('')} style={{ ...SMALL_BTN, background: '#444' }}>清除</button>
                )}
              </div>
            </div>
            {part.texturePath && (
              <div style={{ fontSize: 10, opacity: .45, marginTop: 3, wordBreak: 'break-all' }}>{part.texturePath}</div>
            )}
          </div>

          {/* 覆盖"贴图" */}
          <div style={{ marginBottom: 14, borderTop: '1px solid #333', paddingTop: 10 }}>
            <div style={{ fontSize: 11, opacity: .7, marginBottom: 4 }}>
              覆盖贴图（跟随本节点，不影响子节点）
            </div>
            {!part.overlay && (
              <button
                onClick={() => onOverlayChange(defaultOverlay(''))}
                style={{ ...SMALL_BTN, width: '100%' }}
              >
                + 添加覆盖贴图
              </button>
            )}
            {part.overlay && (
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <Thumb path={part.overlay.texturePath} fallback="#6cf" />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                    <button onClick={() => setPicker('overlay')} style={SMALL_BTN}>从图库选择…</button>
                    <button onClick={onOverlayClear} style={{ ...SMALL_BTN, background: '#732' }}>移除覆盖</button>
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  <Field label="偏移 X">
                    <input type="number" step={0.02} value={round(part.overlay.offsetX)}
                           onChange={e => onOverlayChange({ ...part.overlay!, offsetX: parseFloat(e.target.value) || 0 })} style={INPUT} />
                  </Field>
                  <Field label="偏移 Y">
                    <input type="number" step={0.02} value={round(part.overlay.offsetY)}
                           onChange={e => onOverlayChange({ ...part.overlay!, offsetY: parseFloat(e.target.value) || 0 })} style={INPUT} />
                  </Field>
                  <Field label="偏移 Z">
                    <input type="number" step={0.02} value={round(part.overlay.offsetZ ?? 0)}
                           onChange={e => onOverlayChange({ ...part.overlay!, offsetZ: parseFloat(e.target.value) || 0 })} style={INPUT} />
                  </Field>
                  <Field label="旋转 Z°">
                    <input type="number" step={1} value={round(part.overlay.rot, 1)}
                           onChange={e => onOverlayChange({ ...part.overlay!, rot: parseFloat(e.target.value) || 0 })} style={INPUT} />
                  </Field>
                  <Field label="旋转 X°">
                    <input type="number" step={1} value={round(part.overlay.rotX ?? 0, 1)}
                           onChange={e => onOverlayChange({ ...part.overlay!, rotX: parseFloat(e.target.value) || 0 })} style={INPUT} />
                  </Field>
                  <Field label="旋转 Y°">
                    <input type="number" step={1} value={round(part.overlay.rotY ?? 0, 1)}
                           onChange={e => onOverlayChange({ ...part.overlay!, rotY: parseFloat(e.target.value) || 0 })} style={INPUT} />
                  </Field>
                  <Field label="缩放 (Z)">
                    <input type="number" step={0.05} min={0.05} value={round(part.overlay.scale, 3)}
                           onChange={e => onOverlayChange({ ...part.overlay!, scale: Math.max(0.05, parseFloat(e.target.value) || 1) })} style={INPUT} />
                  </Field>
                  <Field label="缩放 X">
                    <input type="number" step={0.05} min={0.05} value={round(part.overlay.scaleX ?? 1, 3)}
                           onChange={e => onOverlayChange({ ...part.overlay!, scaleX: Math.max(0.05, parseFloat(e.target.value) || 1) })} style={INPUT} />
                  </Field>
                  <Field label="缩放 Y">
                    <input type="number" step={0.05} min={0.05} value={round(part.overlay.scaleY ?? 1, 3)}
                           onChange={e => onOverlayChange({ ...part.overlay!, scaleY: Math.max(0.05, parseFloat(e.target.value) || 1) })} style={INPUT} />
                  </Field>
                </div>
              </>
            )}
          </div>

          <Field label="缓动（当前关键帧）">
            <select value={kfAtCursor?.ease ?? 'linear'}
                    onChange={e => onSetEase(e.target.value as EaseName)}
                    disabled={!kfAtCursor} style={INPUT}>
              {EASES.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </Field>
          <div style={{ fontSize: 10, opacity: .5, marginTop: 6 }}>
            修改 X/Y/旋转/缩放 会写入当前时间点的关键帧；父节点变化时子节点保持相对偏移。
          </div>
        </>
      ) : (
        <div style={{ opacity: .5 }}>选择一个节点查看属性</div>
      )}

      <TexturePicker
        open={picker !== null}
        title={picker === 'overlay' ? '选择覆盖贴图' : '选择节点贴图'}
        images={images}
        onPick={path => {
          if (picker === 'overlay') onOverlayChange({ ...(part?.overlay ?? defaultOverlay(path)), texturePath: path });
          else onSetTexture(path);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
    </div>
  );
}

function Thumb({ path, fallback }: { path: string; fallback?: string }) {
  return (
    <div style={{
      width: 44, height: 44, flexShrink: 0, borderRadius: 4, border: '1px solid #444',
      background: path
        ? '#111'
        : (fallback ?? '#333'),
      backgroundImage: path
        ? 'linear-gradient(45deg,#2a2a30 25%,transparent 25%,transparent 75%,#2a2a30 75%),' +
          'linear-gradient(45deg,#2a2a30 25%,transparent 25%,transparent 75%,#2a2a30 75%)'
        : undefined,
      backgroundSize: '10px 10px', backgroundPosition: '0 0, 5px 5px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }}>
      {path
        ? <img src={assetUrl(path)} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} draggable={false} />
        : <span style={{ fontSize: 9, opacity: .5 }}>无</span>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, opacity: .6, marginBottom: 8 }}>{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', alignItems: 'center', gap: 8 }}>
      <div style={{ fontSize: 11, opacity: .7 }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

function round(v: number, digits = 2): number {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

const INPUT: React.CSSProperties = {
  width: '100%', padding: '4px 8px', background: '#2a2a30', color: '#e4e4e8',
  border: '1px solid #444', borderRadius: 4, fontSize: 12, boxSizing: 'border-box',
};
const BUTTON: React.CSSProperties = {
  width: '100%', padding: '6px 10px', background: '#3a6', color: '#fff',
  border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12,
};
const SMALL_BTN: React.CSSProperties = {
  padding: '4px 8px', background: '#3a6', color: '#fff',
  border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11,
};
