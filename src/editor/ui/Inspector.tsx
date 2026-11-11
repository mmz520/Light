/**
 * 右侧属性检查器 —— 按选中资源类型切换
 */
import { useEffect, useRef, useState } from 'react';
import { editorStore, type Selection } from '../model/store';
import { imageCssUrl, imageUrl, textureById, textureImage } from '../model/resolve';
import { isDesktop, desk } from '../../platform/desk';
import {
  CHARACTER_STATS,
  DIRS,
  DIR_HINT,
  DIR_LABEL,
  MAPUI_RANGE_STEPS,
  SKELETON_TEMPLATES,
  TEXTURE_TEMPLATES,
  croppedSize,
  sceneKindMeta,
  scriptFileOf,
  textureFilled,
  type ControllerAsset,
  type ScriptAsset,
  type Dir,
  type ImageAsset,
  type ProjectDoc,
  type SceneNode,
  type StateMachineAsset,
  type TextureAsset,
  type TextureTemplate,
} from '../model/types';
import { GroundPanel } from './GroundPanel';
import { GroupSlot, RefSlot, ScriptSlot, TexSlot } from './AssetPicker';
import { SceneIcon } from './SceneIcons';
import { T, btnStyle, inputStyle, sectionTitle } from './theme';

interface Props {
  project: ProjectDoc;
  selection: Selection | null;
  onCropImage: (image: ImageAsset) => void;
  onOpenAnimation: (id: string) => void;
  onOpenStateMachine: (id: string) => void;
  onOpenController: (id: string) => void;
  onOpenScript: (id: string) => void;
}

export function Inspector({ project, selection, onCropImage, onOpenAnimation, onOpenStateMachine, onOpenController, onOpenScript }: Props) {
  if (!selection) {
    return <Placeholder text="在底部资源浏览器里选中一个资源" />;
  }
  if (selection.kind === 'image') {
    const img = project.images.find((i) => i.id === selection.id);
    if (!img) return <Placeholder text="资源不存在" />;
    return <ImageInspector project={project} image={img} onCrop={() => onCropImage(img)} />;
  }
  if (selection.kind === 'texture') {
    const tex = project.textures.find((t) => t.id === selection.id);
    if (!tex) return <Placeholder text="资源不存在" />;
    return <TextureInspector project={project} tex={tex} />;
  }
  if (selection.kind === 'statemachine') {
    const sm = project.stateMachines.find((s) => s.id === selection.id);
    if (!sm) return <Placeholder text="资源不存在" />;
    return <StateMachineInspector project={project} sm={sm} onOpen={() => onOpenStateMachine(sm.id)} />;
  }
  if (selection.kind === 'controller') {
    const ctrl = project.controllers.find((c) => c.id === selection.id);
    if (!ctrl) return <Placeholder text="资源不存在" />;
    return <ControllerInspector ctrl={ctrl} onOpen={() => onOpenController(ctrl.id)} />;
  }
  if (selection.kind === 'script') {
    const sc = project.scripts.find((s) => s.id === selection.id);
    if (!sc) return <Placeholder text="资源不存在" />;
    return <ScriptInspector project={project} script={sc} onOpen={() => onOpenScript(sc.id)} />;
  }
  const anim = project.animations.find((a) => a.id === selection.id);
  if (!anim) return <Placeholder text="资源不存在" />;
  return <AnimationInspector project={project} animId={anim.id} onOpen={() => onOpenAnimation(anim.id)} />;
}

/* ------------------------------------------------------------------ */
/* 状态机                                                              */
/* ------------------------------------------------------------------ */

function StateMachineInspector({ project, sm, onOpen }: { project: ProjectDoc; sm: StateMachineAsset; onOpen: () => void }) {
  const ctrl = project.controllers.find((c) => c.id === sm.controllerId) ?? null;
  return (
    <div style={{ padding: '10px 12px' }}>
      <div style={sectionTitle}>状态机</div>
      <Field label="名称">
        <NameInput kind="statemachine" id={sm.id} name={sm.name} />
      </Field>
      <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.9 }}>
        <div>{sm.states.length} 个状态 · {sm.transitions.length} 条流转</div>
        <div style={{ color: T.dimmer, fontSize: 10.5 }}>初始状态：{sm.states.find((s) => s.entry)?.name ?? '未设置'}</div>
      </div>

      <Field label="变量来源（控制器）" hint={ctrl ? `条件里可用：${ctrl.vars.map((v) => v.name).join('、') || '（该控制器还没有变量）'}` : '没有绑控制器时，运行时用角色的第一个控制器'}>
        <RefSlot
          project={project}
          kind="controller"
          value={sm.controllerId}
          onChange={(id) => editorStore.updateStateMachine(sm.id, { controllerId: id })}
        />
      </Field>

      <button onClick={onOpen} style={{ ...btnStyle, width: '100%', marginTop: 12, background: T.accent, color: '#1a1410', border: 'none', fontWeight: 700 }}>
        打开流程图
      </button>

      <div style={{ ...sectionTitle, marginTop: 14 }}>状态</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {sm.states.map((st) => (
          <span
            key={st.id}
            title={st.desc || st.name}
            style={{
              fontSize: 10.5,
              padding: '2px 6px',
              borderRadius: 3,
              border: `1px solid ${st.entry ? '#8aa872' : T.line}`,
              color: st.entry ? '#a9c98c' : T.dim,
              background: T.bg2,
            }}
          >
            {st.name}
            {st.move === 'forward' ? ' · 前进' : ''}
          </span>
        ))}
      </div>

      <div style={{ marginTop: 14, fontSize: 10.5, color: T.dimmer, lineHeight: 1.8 }}>
        状态机描述角色的一整套行为：状态绑动画片段，连线写条件（控制器变量 与标准值比较）。
        攻击 / 受击 / 技能等行为以后直接加状态和连线即可。
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 控制器                                                              */
/* ------------------------------------------------------------------ */

function ControllerInspector({ ctrl, onOpen }: { ctrl: ControllerAsset; onOpen: () => void }) {
  return (
    <div style={{ padding: '10px 12px' }}>
      <div style={sectionTitle}>控制器</div>
      <Field label="名称">
        <NameInput kind="controller" id={ctrl.id} name={ctrl.name} />
      </Field>
      <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.9 }}>
        <div>{ctrl.vars.length} 个变量 · {ctrl.bindings.length} 条按键事件</div>
      </div>

      <button onClick={onOpen} style={{ ...btnStyle, width: '100%', marginTop: 12, background: T.accent, color: '#1a1410', border: 'none', fontWeight: 700 }}>
        打开控制器
      </button>

      <div style={{ ...sectionTitle, marginTop: 14 }}>变量</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {ctrl.vars.map((v) => (
          <span
            key={v.id}
            style={{ fontSize: 10.5, padding: '2px 6px', borderRadius: 3, border: `1px solid ${T.line}`, color: T.dim, background: T.bg2 }}
          >
            {v.name} = {v.init}
          </span>
        ))}
        {ctrl.vars.length === 0 && <span style={{ fontSize: 10.5, color: T.dimmer }}>还没有变量</span>}
      </div>

      <div style={{ marginTop: 14, fontSize: 10.5, color: T.dimmer, lineHeight: 1.8 }}>
        控制器把按键变成变量（按下 / 弹起 / 双击 / 长按，可加 Ctrl / Shift / Alt），
        状态机只读变量做比较 —— 一个控制器可以被多个状态机复用。
      </div>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return <div style={{ padding: 20, color: T.dimmer, fontSize: 12, textAlign: 'center' }}>{text}</div>;
}

function ScriptInspector({ project, script, onOpen }: { project: ProjectDoc; script: ScriptAsset; onOpen: () => void }) {
  const mountedOn = project.scene.filter((n) => (n.scriptIds ?? []).includes(script.id));
  return (
    <div style={{ padding: '10px 12px' }}>
      <div style={sectionTitle}>脚本</div>
      <Field label="名称">
        <NameInput kind="script" id={script.id} name={script.name} />
      </Field>
      <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.9 }}>
        <div>{script.code.split('\n').length} 行 JS · 挂载于 {mountedOn.length} 个对象</div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        <button onClick={onOpen} style={{ ...btnStyle, flex: 1, background: T.accent, color: '#1a1410', border: 'none', fontWeight: 700 }}>
          内置编辑器
        </button>
        {isDesktop && (
          <button
            data-vscode-script
            onClick={() => void desk.app.openInEditor(desk.path.join(project.root, scriptFileOf(project.scripts, script)))}
            title="用 VS Code / 系统默认编辑器打开源码文件"
            style={{ ...btnStyle, flex: 1 }}
          >
            VS Code 打开
          </button>
        )}
      </div>

      <div style={{ ...sectionTitle, marginTop: 14 }}>挂载于</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {mountedOn.map((n) => (
          <span
            key={n.id}
            data-script-mount
            style={{ fontSize: 10.5, padding: '2px 6px', borderRadius: 3, border: `1px solid ${T.line}`, color: T.dim, background: T.bg2 }}
          >
            {n.name}
          </span>
        ))}
        {mountedOn.length === 0 && <span style={{ fontSize: 10.5, color: T.dimmer }}>还没有对象挂载（场景属性面板里可挂）</span>}
      </div>

      <div style={{ marginTop: 14, fontSize: 10.5, color: T.dimmer, lineHeight: 1.8 }}>
        脚本在播放时于 quickjs 沙箱里运行：定义 onStart / onUpdate / onEvent / onDestroy 钩子即可参与游戏；
        编辑态只做语法检查、绝不执行。
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: T.dim, marginBottom: 3 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 9.5, color: T.dimmer, marginTop: 3, lineHeight: 1.6 }}>{hint}</div>}
    </div>
  );
}

function NameInput({ kind, id, name }: { kind: Selection['kind']; id: string; name: string }) {
  const [value, setValue] = useState(name);
  const [focused, setFocused] = useState(false);
  // 外部改名后同步
  if (!focused && value !== name) setValue(name);
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (value.trim() && value !== name) editorStore.renameAsset(kind, id, value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      style={inputStyle}
    />
  );
}

/* ------------------------------------------------------------------ */
/* 图片                                                                */
/* ------------------------------------------------------------------ */

/** 单张拉伸策略：只在引用处关闭「重复」（整块只贴一张）时生效 */
const TILING_MODES: { id: 'default' | 'aspect' | 'nine'; name: string; desc: string }[] = [
  { id: 'default', name: '拉伸', desc: '单张拉伸铺满整个元素（可能变形）' },
  { id: 'aspect', name: '等比', desc: '保持原状不变形：等比缩放、居中裁切铺满（圆形仍是圆形）' },
  { id: 'nine', name: '九宫格', desc: '拖动四条线，边缘区拉伸时保持原状不变形，中间区拉伸补满' },
];

function ImageInspector({ project, image, onCrop }: { project: ProjectDoc; image: ImageAsset; onCrop: () => void }) {
  const size = croppedSize(image);
  const tiling = image.tiling ?? 'default';
  return (
    <div style={{ padding: '10px 12px' }}>
      <div style={sectionTitle}>图片</div>
      <Field label="名称">
        <NameInput kind="image" id={image.id} name={image.name} />
      </Field>
      <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.8 }}>
        <div>文件：{image.file}</div>
        <div>
          原图：{image.width} × {image.height}
        </div>
        <div>
          实际：{size.w} × {size.h}
          {image.crop ? '（已裁剪）' : ''}
        </div>
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <button onClick={onCrop} style={{ ...btnStyle, flex: 1 }}>
          裁剪…
        </button>
        <button
          onClick={() => editorStore.updateImage(image.id, { crop: null })}
          disabled={!image.crop}
          style={{ ...btnStyle, opacity: image.crop ? 1 : 0.4 }}
        >
          还原
        </button>
      </div>

      <Field label="单张拉伸策略">
        <div style={{ display: 'flex', gap: 6 }}>
          {TILING_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() =>
                editorStore.updateImage(
                  image.id,
                  // 切到九宫格时立刻写入默认四线值，避免渲染端拿到 null 回退默认切片
                  m.id === 'nine' ? { tiling: 'nine', nine: image.nine ?? { l: 0.25, t: 0.25, r: 0.25, b: 0.25 } } : { tiling: m.id },
                )
              }
              title={m.desc}
              style={{
                ...btnStyle,
                flex: 1,
                background: tiling === m.id ? T.accent : T.bg3,
                color: tiling === m.id ? '#1a1410' : T.text,
                border: 'none',
                fontWeight: tiling === m.id ? 700 : 400,
              }}
            >
              {m.name}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 10, color: T.dimmer, marginTop: 4, lineHeight: 1.5 }}>
          只在引用处关闭「重复」（整块只贴一张）时生效。{TILING_MODES.find((m) => m.id === tiling)?.desc}
        </div>
      </Field>

      {tiling === 'nine' && <NineSliceEditor project={project} image={image} />}

      <div style={{ marginTop: 14, fontSize: 10.5, color: T.dimmer, lineHeight: 1.7 }}>
        裁剪是非破坏性的：只记录裁剪框，图片文件不变。所有引用这张图的贴图会自动跟着变。
      </div>

      <div
        style={{
          marginTop: 12,
          border: `1px solid ${T.lineSoft}`,
          borderRadius: 4,
          padding: 6,
          background: `repeating-conic-gradient(${T.bg0} 0% 25%, #191512 0% 50%) 50% / 12px 12px`,
          height: 200,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            backgroundImage: `url(${imageUrl(project, image)})`,
            backgroundRepeat: 'no-repeat',
            ...cropBackground(image),
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 九宫格编辑器：四条可拖动的线，线条外 = 平铺时不变形的边缘区            */
/* ------------------------------------------------------------------ */

type NineEdge = 'l' | 'r' | 't' | 'b';

function NineSliceEditor({ project, image }: { project: ProjectDoc; image: ImageAsset }) {
  const size = croppedSize(image);
  const nine = image.nine ?? { l: 0.25, t: 0.25, r: 0.25, b: 0.25 };
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<NineEdge | null>(null);
  const [, force] = useState(0);

  // 按裁剪后宽高比算预览框尺寸（面板宽约 190px 可用）
  const scale = Math.min(190 / size.w, 180 / size.h);
  const dispW = Math.max(40, Math.round(size.w * scale));
  const dispH = Math.max(40, Math.round(size.h * scale));

  useEffect(() => {
    const apply = (cx: number, cy: number) => {
      const el = boxRef.current;
      const edge = dragRef.current;
      if (!el || !edge) return;
      const rect = el.getBoundingClientRect();
      const nx = (cx - rect.left) / rect.width;
      const ny = (cy - rect.top) / rect.height;
      const next = { ...nine };
      // 每条线各自钳位在 0~0.45（注意 r/b 的值是 1-nx / 1-ny，不能统一钳 nx）
      if (edge === 'l') next.l = Math.min(0.45, Math.max(0, nx));
      else if (edge === 'r') next.r = Math.min(0.45, Math.max(0, 1 - nx));
      else if (edge === 't') next.t = Math.min(0.45, Math.max(0, ny));
      else next.b = Math.min(0.45, Math.max(0, 1 - ny));
      // 中间区至少留 10%，四线彼此不越界
      next.l = Math.min(next.l, 1 - next.r - 0.1);
      next.r = Math.min(next.r, 1 - next.l - 0.1);
      next.t = Math.min(next.t, 1 - next.b - 0.1);
      next.b = Math.min(next.b, 1 - next.t - 0.1);
      editorStore.updateImage(image.id, { nine: next }, `image-nine:${image.id}`);
    };
    const onMove = (e: PointerEvent) => apply(e.clientX, e.clientY);
    const onUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        force((v) => v + 1);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  });

  // 线：外层透明热区（好抓）+ 中间一条 1.5px 实线
  const line = (edge: NineEdge): React.CSSProperties => {
    const vertical = edge === 'l' || edge === 'r';
    const at = edge === 'l' ? nine.l : edge === 'r' ? 1 - nine.r : edge === 't' ? nine.t : 1 - nine.b;
    return {
      position: 'absolute',
      [vertical ? 'left' : 'top']: `${at * 100}%`,
      ...(vertical
        ? { top: 0, height: '100%', width: 9, marginLeft: -4.5, cursor: 'ew-resize' }
        : { left: 0, width: '100%', height: 9, marginTop: -4.5, cursor: 'ns-resize' }),
      touchAction: 'none',
    } as React.CSSProperties;
  };
  const lineBar = (edge: NineEdge): React.CSSProperties => {
    const vertical = edge === 'l' || edge === 'r';
    return {
      position: 'absolute',
      ...(vertical
        ? { left: '50%', top: 0, width: 1.5, height: '100%', marginLeft: -0.75 }
        : { top: '50%', left: 0, height: 1.5, width: '100%', marginTop: -0.75 }),
      background: T.accent,
      pointerEvents: 'none',
    } as React.CSSProperties;
  };

  // 线条外（边缘区）的浅色遮罩，一眼看出"不被拉伸"的范围
  const shade: React.CSSProperties = { position: 'absolute', background: 'rgba(0,0,0,.38)', pointerEvents: 'none' };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: T.dim, marginBottom: 4 }}>九宫格切片（拖动四条线）</div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: 6,
          border: `1px solid ${T.lineSoft}`,
          borderRadius: 4,
          background: `repeating-conic-gradient(${T.bg0} 0% 25%, #191512 0% 50%) 50% / 12px 12px`,
        }}
      >
        <div
          ref={boxRef}
          data-nine-editor
          style={{
            position: 'relative',
            width: dispW,
            height: dispH,
            backgroundImage: `url(${imageUrl(project, image)})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: '100% 100%',
            ...cropBackground(image),
            imageRendering: 'pixelated',
            userSelect: 'none',
          }}
        >
          {/* 边缘区遮罩：上 / 下 / 左 / 右四条 */}
          <div style={{ ...shade, left: 0, right: 0, top: 0, height: `${nine.t * 100}%` }} />
          <div style={{ ...shade, left: 0, right: 0, bottom: 0, height: `${nine.b * 100}%` }} />
          <div style={{ ...shade, left: 0, width: `${nine.l * 100}%`, top: `${nine.t * 100}%`, bottom: `${nine.b * 100}%` }} />
          <div style={{ ...shade, right: 0, width: `${nine.r * 100}%`, top: `${nine.t * 100}%`, bottom: `${nine.b * 100}%` }} />
          {/* 四条可拖动的线（热区 + 细线） */}
          {(['l', 'r', 't', 'b'] as NineEdge[]).map((e) => (
            <div key={e} data-nine-line={e} onPointerDown={() => (dragRef.current = e)} style={line(e)} title="拖动调整边界线">
              <div style={lineBar(e)} />
            </div>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 10, color: T.dimmer, marginTop: 4, lineHeight: 1.6 }}>
        边 {Math.round(nine.l * 100)}% / {Math.round(nine.t * 100)}% / {Math.round(nine.r * 100)}% / {Math.round(nine.b * 100)}%
        （左 / 上 / 右 / 下）
      </div>
    </div>
  );
}

/** 按裁剪框做背景定位，让预览只显示裁剪后的区域 */
function cropBackground(image: ImageAsset): React.CSSProperties {
  const c = image.crop;
  if (!c) {
    return { backgroundSize: 'contain', backgroundPosition: 'center' };
  }
  const sizeX = (image.width / c.w) * 100;
  const sizeY = (image.height / c.h) * 100;
  const posX = image.width === c.w ? 0 : (c.x / (image.width - c.w)) * 100;
  const posY = image.height === c.h ? 0 : (c.y / (image.height - c.h)) * 100;
  return {
    backgroundSize: `${sizeX}% ${sizeY}%`,
    backgroundPosition: `${posX}% ${posY}%`,
  };
}

/* ------------------------------------------------------------------ */
/* 贴图                                                                */
/* ------------------------------------------------------------------ */

function TextureInspector({ project, tex }: { project: ProjectDoc; tex: TextureAsset }) {
  const slotRow = (key: 'image' | Dir, label: string, hint: string, imageId: string | null) => (
    <div key={key} style={{ marginBottom: 6 }}>
      <TexSlot
        project={project}
        allowColor={false}
        badge={key === 'image' ? '1' : key}
        label={label}
        hint={hint}
        value={{ id: imageId }}
        onChange={(v) => editorStore.setTextureSlot(tex.id, key, v.id)}
      />
    </div>
  );

  return (
    <div style={{ padding: '10px 12px' }}>
      <div style={sectionTitle}>图组</div>
      <Field label="名称">
        <NameInput kind="texture" id={tex.id} name={tex.name} />
      </Field>

      <Field label="模板">
        <div style={{ display: 'flex', gap: 6 }}>
          {TEXTURE_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => editorStore.setTextureTemplate(tex.id, t.id as TextureTemplate)}
              title={t.desc}
              style={{
                ...btnStyle,
                flex: 1,
                background: tex.template === t.id ? T.accent : T.bg3,
                color: tex.template === t.id ? '#1a1410' : T.text,
                border: 'none',
                fontWeight: tex.template === t.id ? 700 : 400,
              }}
            >
              {t.name}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 10, color: T.dimmer, marginTop: 4, lineHeight: 1.5 }}>
          {TEXTURE_TEMPLATES.find((t) => t.id === tex.template)?.desc}
        </div>
      </Field>

      <div style={{ ...sectionTitle, paddingLeft: 0 }}>图片槽位</div>
      {tex.template === 'single'
        ? slotRow('image', '未设置', '整张图通用（不分方向）', tex.image)
        : DIRS.map((d) => slotRow(d, '未设置', DIR_HINT[d], tex.dirs[d]))}

      {!textureFilled(tex) && (
        <div style={{ fontSize: 11, color: T.danger, marginTop: 4 }}>至少设置一张图，否则引用它的动画节点不会显示。</div>
      )}

      {tex.template === 'four' && (
        <div style={{ marginTop: 14 }}>
          <div style={{ ...sectionTitle, paddingLeft: 0 }}>四向预览</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {DIRS.map((d) => {
              const img = textureImage(project, tex, d);
              return (
                <div
                  key={d}
                  style={{
                    border: `1px solid ${T.lineSoft}`,
                    borderRadius: 3,
                    padding: 4,
                    background: `repeating-conic-gradient(${T.bg0} 0% 25%, #191512 0% 50%) 50% / 10px 10px`,
                    height: 96,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                  }}
                >
                  {img ? (
                    <img src={imageCssUrl(project, img)} alt="" style={{ maxHeight: 66, maxWidth: '100%' }} />
                  ) : (
                    <span style={{ color: T.dimmer, fontSize: 10 }}>缺</span>
                  )}
                  <span style={{ fontSize: 9.5, color: T.dimmer }}>
                    {d} · {DIR_LABEL[d]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 动画                                                                */
/* ------------------------------------------------------------------ */

function AnimationInspector({ project, animId, onOpen }: { project: ProjectDoc; animId: string; onOpen: () => void }) {
  const anim = project.animations.find((a) => a.id === animId)!;
  const tpl = SKELETON_TEMPLATES.find((s) => s.id === anim.template);
  const boundNodes = anim.nodes.filter((n) => n.textureId).length;
  const overlayCount = anim.nodes.filter((n) => n.overlay?.textureId).length;

  return (
    <div style={{ padding: '10px 12px' }}>
      <div style={sectionTitle}>动画</div>
      <Field label="名称">
        <NameInput kind="animation" id={anim.id} name={anim.name} />
      </Field>

      <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.9 }}>
        <div>骨架：{tpl?.name ?? anim.template}</div>
        <div>
          节点：{anim.nodes.length}（已挂贴图 {boundNodes}）
        </div>
        <div>覆盖物：{overlayCount}</div>
        <div>帧率：{anim.fps} fps</div>
      </div>

      <button
        onClick={onOpen}
        style={{ ...btnStyle, width: '100%', marginTop: 12, background: T.accent, color: '#1a1410', border: 'none', fontWeight: 700 }}
      >
        打开动画编辑器
      </button>
      <div style={{ fontSize: 10, color: T.dimmer, marginTop: 6, textAlign: 'center' }}>或在底部资源上右键 → 编辑动画</div>

      <div style={{ ...sectionTitle, paddingLeft: 0, marginTop: 10 }}>片段</div>
      {Object.entries(anim.clips).map(([name, clip]) => (
        <div
          key={name}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 6px',
            borderBottom: `1px solid ${T.lineSoft}`,
            fontSize: 11.5,
          }}
        >
          <span style={{ flex: 1 }}>{name}</span>
          <span style={{ color: T.dimmer }}>{clip.duration.toFixed(2)}s</span>
          <span style={{ color: T.dimmer }}>{clip.loop === 'loop' ? '循环' : clip.loop === 'once' ? '单次' : '往返'}</span>
          <span style={{ color: T.dimmer }}>{clip.tracks.length} 轨</span>
        </div>
      ))}

      <div style={{ ...sectionTitle, paddingLeft: 0, marginTop: 12 }}>节点贴图</div>
      {anim.nodes.map((n) => {
        const tex = textureById(project, n.textureId);
        return (
          <div key={n.id} style={{ display: 'flex', gap: 6, fontSize: 11, padding: '2px 0', color: tex ? T.dim : T.dimmer }}>
            <span style={{ width: 92, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tex?.name ?? '—'}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 场景对象属性                                                        */
/* ------------------------------------------------------------------ */

export function SceneInspector({
  project,
  node,
  onOpenStateMachine,
  onOpenController,
  onOpenScript,
}: {
  project: ProjectDoc;
  node: SceneNode;
  onOpenStateMachine: (id: string) => void;
  onOpenController: (id: string) => void;
  onOpenScript: (id: string) => void;
}) {
  const meta = sceneKindMeta(node.kind);
  const parent = node.parentId ? project.scene.find((n) => n.id === node.parentId) : null;
  const kids = project.scene.filter((n) => n.parentId === node.id);
  const [name, setName] = useState(node.name);
  const [focused, setFocused] = useState(false);
  const [scriptDropHot, setScriptDropHot] = useState(false);
  /** 「＋ 添加脚本」点出来的空槽数量：空槽还没填脚本时是 UI 状态，不写进工程数据 */
  const [pendingScripts, setPendingScripts] = useState(0);
  if (!focused && name !== node.name) setName(node.name);

  // 换到别的对象时丢掉没填的空槽
  useEffect(() => {
    setPendingScripts(0);
  }, [node.id]);

  const scriptIds = node.scriptIds ?? [];

  /** 往节点上追加脚本（去重） */
  const attachScripts = (ids: string[]) => {
    const next = [...scriptIds];
    for (const id of ids) if (id && !next.includes(id)) next.push(id);
    if (next.length !== scriptIds.length) editorStore.setNodeScripts(node.id, next);
  };

  /** 换 / 卸已挂槽位上的脚本 */
  const replaceScriptAt = (index: number, id: string | null) => {
    const next = [...scriptIds];
    if (id) next[index] = id;
    else next.splice(index, 1);
    editorStore.setNodeScripts(node.id, next.filter((x, i) => !!x && next.indexOf(x) === i));
  };

  const commitName = () => {
    setFocused(false);
    if (name.trim() && name !== node.name) editorStore.renameSceneNode(node.id, name);
  };

  return (
    <div style={{ padding: '10px 10px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <span style={{ color: meta.color, display: 'flex' }}>
          <SceneIcon kind={node.kind} size={16} />
        </span>
        <span style={{ fontSize: 12, color: T.text }}>{meta.name}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: T.dimmer }}>
          {node.kind === 'mapui'
            ? '屏幕UI'
            : node.kind === 'time' || node.kind === 'weather' || node.kind === 'camera'
              ? '全局'
              : meta.solid
                ? '实体'
                : '分组'}
        </span>
      </div>

      <Field label="名称">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          style={inputStyle}
        />
      </Field>

      {/* 时间 / 天气是全局设置，摆位置没意义，改成说明占位 */}
      {node.kind === 'mapui' && node.mapui && (
        <Field label="屏幕位置 X / Y（像素，拖框也能改）">
          <div style={{ display: 'flex', gap: 6 }}>
            {(['sx', 'sy'] as const).map((axis) => (
              <input
                key={axis}
                type="number"
                step={1}
                value={axis === 'sx' ? node.mapui!.sx : node.mapui!.sy}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) editorStore.setMapui(node.id, axis === 'sx' ? { sx: v } : { sy: v }, `mapui-pos:${node.id}`);
                }}
                style={{ ...inputStyle, flex: 1 }}
              />
            ))}
          </div>
        </Field>
      )}
      {node.kind !== 'time' && node.kind !== 'weather' && node.kind !== 'mapui' && (
        <Field label="位置 X / Z（场景单位，0.5 网格吸附）">
          <div style={{ display: 'flex', gap: 6 }}>
            {(['x', 'z'] as const).map((axis) => (
              <input
                key={axis}
                type="number"
                step={0.5}
                value={axis === 'x' ? node.x : node.z}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) editorStore.moveSceneNodeTo(node.id, axis === 'x' ? v : node.x, axis === 'z' ? v : node.z);
                }}
                style={{ ...inputStyle, flex: 1 }}
              />
            ))}
          </div>
        </Field>
      )}

      {(node.kind === 'time' || node.kind === 'weather' || node.kind === 'camera') && (
        <div
          style={{
            margin: '4px 0 2px',
            padding: '9px 10px',
            border: `1px dashed ${T.line}`,
            borderRadius: 5,
            fontSize: 11,
            color: T.dim,
            lineHeight: 1.9,
          }}
        >
          <div style={{ color: T.text, fontSize: 11.5, marginBottom: 4 }}>
            {node.kind === 'time' ? '时间系统（仅占位）' : node.kind === 'weather' ? '天气系统（仅占位）' : '摄像头（仅占位）'}
          </div>
          {node.kind === 'time'
            ? '之后会挂：四季（春 / 夏 / 秋 / 冬）循环、白天黑夜切换。现在只把对象放进场景，参数和运行时逻辑都还没做。'
            : node.kind === 'weather'
              ? '之后会挂：晴 / 雨 / 雪 / 雾等天气切换与表现。现在只把对象放进场景，参数和运行时逻辑都还没做。'
              : '运行时相机固定 45° 俯角、跟随角色。这个节点先占位：之后挂跟随目标 / 角度 / 距离等参数，现在点「▶」运行用的是内置的跟随相机。'}
        </div>
      )}

      {node.kind === 'character' && (
        <div style={{ margin: '6px -10px 2px', borderTop: `1px solid ${T.lineSoft}`, padding: '10px 10px 0' }}>
          <div style={sectionTitle}>角色</div>
          <Field label="角色名（留空就用上面的对象名）">
            <input
              value={node.character?.name ?? ''}
              placeholder="未命名"
              onChange={(e) => editorStore.setCharacter(node.id, { name: e.target.value }, `char-name:${node.id}`)}
              style={inputStyle}
            />
          </Field>

          <Field label="动画">
            <RefSlot
              project={project}
              kind="animation"
              value={node.character?.animationId ?? null}
              onChange={(id) => editorStore.setCharacter(node.id, { animationId: id })}
            />
          </Field>

          <Field label="状态机" hint="变量来源由状态机自己决定，见状态机属性">
            <RefSlot
              project={project}
              kind="statemachine"
              value={node.character?.stateMachineId ?? null}
              onChange={(id) => editorStore.setCharacter(node.id, { stateMachineId: id })}
              onEdit={onOpenStateMachine}
            />
          </Field>

          <Field label="控制器（可多个，运行时全部生效）" hint="按键 → 变量；状态机读变量判断流转">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(node.character?.controllerIds ?? []).map((cid) => {
                const c = project.controllers.find((x) => x.id === cid) ?? null;
                return (
                  <div
                    key={cid}
                    data-char-controller
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      border: `1px solid ${T.lineSoft}`,
                      borderRadius: 4,
                      padding: '4px 6px',
                      background: T.bg2,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: c ? T.text : T.dimmer, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c?.name ?? '（控制器已删除）'}
                    </span>
                    <span style={{ fontSize: 9.5, color: T.dimmer }}>{c ? `${c.vars.length} 变量` : ''}</span>
                    {c && (
                      <button onClick={() => onOpenController(c.id)} style={{ ...btnStyle, padding: '1px 6px', fontSize: 10 }}>
                        编辑
                      </button>
                    )}
                    <button
                      onClick={() =>
                        editorStore.setCharacterControllers(
                          node.id,
                          (node.character?.controllerIds ?? []).filter((x) => x !== cid),
                        )
                      }
                      title="解绑这个控制器"
                      style={{ ...btnStyle, padding: '1px 6px', fontSize: 10, color: T.dimmer }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              <select
                value=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) return;
                  editorStore.setCharacterControllers(node.id, [...(node.character?.controllerIds ?? []), id]);
                }}
                style={{ ...inputStyle, fontSize: 10.5, padding: '3px 4px' }}
              >
                <option value="">＋ 添加控制器…</option>
                {project.controllers
                  .filter((c) => !(node.character?.controllerIds ?? []).includes(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}（{c.vars.length} 变量 / {c.bindings.length} 事件）
                    </option>
                  ))}
              </select>
            </div>
          </Field>

          {/* 小地图：显示开关 + 图标（minimapShow / minimapIcon 存在节点上） */}
          <div style={{ ...sectionTitle, marginTop: 12 }}>小地图</div>
          <Field label="在地图上显示">
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { v: true, name: '显示' },
                { v: false, name: '隐藏' },
              ].map((o) => (
                <button
                  key={String(o.v)}
                  onClick={() => editorStore.setNodeMinimap(node.id, { minimapShow: o.v })}
                  style={{
                    ...btnStyle,
                    flex: 1,
                    fontSize: 10.5,
                    color: (node.minimapShow ?? true) === o.v ? '#1a1410' : T.text,
                    background: (node.minimapShow ?? true) === o.v ? T.accent : T.bg3,
                    borderColor: (node.minimapShow ?? true) === o.v ? T.accent : T.line,
                  }}
                >
                  {o.name}
                </button>
              ))}
            </div>
          </Field>
          <Field label="显示图标" hint="从小地图用哪个「图组」当图标；不选就是默认圆点。也可以从底部资源把图组拖到槽上">
            <div data-minimap-icon>
              <GroupSlot
                project={project}
                value={{ id: node.minimapIcon ?? null }}
                thumbSize={36}
                label="选择图组"
                hint={
                  node.minimapIcon
                    ? `图组 · ${project.textures.find((t) => t.id === node.minimapIcon)?.name ?? '（已删除）'}`
                    : '点图框选「图组」目录里的图组'
                }
                onChange={(v) => editorStore.setNodeMinimap(node.id, { minimapIcon: v.id })}
              />
            </div>
          </Field>

          <div style={{ ...sectionTitle, marginTop: 12 }}>数值</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {CHARACTER_STATS.map((stat) => (
              <label key={stat.key} title={stat.hint} style={{ fontSize: 10.5, color: T.dim }}>
                {stat.name}
                <input
                  type="number"
                  min={stat.min}
                  max={stat.max}
                  step={stat.step}
                  value={node.character?.[stat.key] ?? 0}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) editorStore.setCharacter(node.id, { [stat.key]: v }, `char-${stat.key}:${node.id}`);
                  }}
                  style={{ ...inputStyle, marginTop: 2 }}
                />
              </label>
            ))}
          </div>
          <div style={{ fontSize: 9.5, color: T.dimmer, marginTop: 6, lineHeight: 1.7 }}>
            字段：blood / satiation / mental / speed / attack；状态机条件里可以直接比较这些量。
          </div>
        </div>
      )}

      {node.kind === 'ground' && (
        <div style={{ margin: '6px -10px 2px', borderTop: `1px solid ${T.lineSoft}` }}>
          <GroundPanel project={project} node={node} />
        </div>
      )}

      {node.kind === 'mapui' && node.mapui && (
        <>
          <Field label="形状">
            <div style={{ display: 'flex', gap: 6 }}>
              {(
                [
                  { id: 'circle', label: '圆形' },
                  { id: 'rect', label: '方形' },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  onClick={() => editorStore.setMapui(node.id, { shape: s.id })}
                  style={{
                    ...btnStyle,
                    flex: 1,
                    fontSize: 11,
                    color: node.mapui!.shape === s.id ? '#1a1410' : T.text,
                    background: node.mapui!.shape === s.id ? T.accent : T.bg3,
                    borderColor: node.mapui!.shape === s.id ? T.accent : T.line,
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="显示范围（档位）">
            <div style={{ display: 'flex', gap: 4 }}>
              {MAPUI_RANGE_STEPS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => editorStore.setMapui(node.id, { range: s.id })}
                  title={s.radius === Infinity ? '永远显示' : `玩家进入 ${s.radius} 单位内才显示`}
                  style={{
                    ...btnStyle,
                    flex: 1,
                    fontSize: 11,
                    padding: '4px 0',
                    color: node.mapui!.range === s.id ? '#1a1410' : T.text,
                    background: node.mapui!.range === s.id ? T.accent : T.bg3,
                    borderColor: node.mapui!.range === s.id ? T.accent : T.line,
                  }}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: T.dimmer, marginTop: 4 }}>
              {node.mapui.range === 'always' ? '游戏运行时永远显示' : `运行时玩家进入 ${MAPUI_RANGE_STEPS.find((s) => s.id === node.mapui!.range)?.radius} 单位内才显示（编辑器里不预览）`}
            </div>
          </Field>

          <Field label={`框大小（${node.mapui.size}px）`}>
            <input
              type="range"
              min={48}
              max={640}
              step={4}
              value={node.mapui.size}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) editorStore.setMapui(node.id, { size: v }, `mapui-size:${node.id}`);
              }}
              style={{ width: '100%', accentColor: T.accent }}
            />
          </Field>

          <Field label="装饰贴图（沿框边装饰）">
            <TexSlot
              project={project}
              loopable
              thumbSize={36}
              label="内置样式"
              hint="从「贴图」目录选装饰贴图"
              value={{ id: node.mapui.decorId, color: node.mapui.decorColor ?? null, loop: node.mapui.decorLoop ?? true }}
              onChange={(v) => editorStore.setMapui(node.id, { decorId: v.id, decorColor: v.color ?? null, decorLoop: v.loop ?? true })}
            />
          </Field>
        </>
      )}

      <Field label="层级">
        <div style={{ fontSize: 11.5, color: parent ? T.text : T.dimmer }}>{parent ? `${parent.name}（${sceneKindMeta(parent.kind).name}）` : '场景根层'}</div>
        {parent && (
          <button onClick={() => editorStore.moveSceneNode(node.id, null, null)} style={{ ...btnStyle, marginTop: 6, width: '100%', fontSize: 11 }}>
            移到根层
          </button>
        )}
      </Field>

      <Field label={`子对象（${kids.length}）`}>
        <div style={{ fontSize: 11.5, color: kids.length ? T.dim : T.dimmer, lineHeight: 1.8 }}>
          {kids.length ? kids.map((k) => k.name).join('、') : '没有子对象 —— 可以在左侧把别的对象拖进来'}
        </div>
      </Field>

      {/* 脚本：任何节点都能挂，运行时按顺序实例化；固定放在属性最底部 */}
      <div
        data-node-script-zone
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.types).includes('application/x-light-asset-script')) return;
          e.preventDefault();
          // 资源浏览器设的是 effectAllowed = 'move'，dropEffect 必须一致，否则浏览器拒绝放置
          e.dataTransfer.dropEffect = 'move';
          if (!scriptDropHot) setScriptDropHot(true);
        }}
        onDragLeave={() => setScriptDropHot(false)}
        onDrop={(e) => {
          setScriptDropHot(false);
          const ids = (e.dataTransfer.getData('text/plain') || '')
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.startsWith('script:'))
            .map((s) => s.slice('script:'.length));
          if (ids.length === 0) return;
          e.preventDefault();
          const next = [...(node.scriptIds ?? [])];
          for (const sid of ids) if (!next.includes(sid)) next.push(sid);
          editorStore.setNodeScripts(node.id, next);
        }}
        style={{
          margin: '10px -10px 2px',
          borderTop: `1px solid ${scriptDropHot ? T.accent : T.lineSoft}`,
          padding: '10px 10px 0',
          background: scriptDropHot ? 'rgba(201,135,58,.08)' : 'transparent',
        }}
      >
        <div style={sectionTitle}>脚本</div>
        <Field
          label={`脚本（${scriptIds.length}）`}
          hint="JS 生命周期钩子；编辑态不执行脚本。点「＋ 添加脚本」出一个空槽，点空槽选，或把脚本从资源浏览器拖进空槽 / 这个区块"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {scriptIds.map((sid, i) => (
              <div key={sid} data-node-script>
                <ScriptSlot
                  project={project}
                  value={sid}
                  badge={String(i + 1)}
                  onEdit={(id) => onOpenScript(id)}
                  onOpenInEditor={
                    isDesktop
                      ? (id) => {
                          const s = project.scripts.find((x) => x.id === id);
                          if (s) void desk.app.openInEditor(desk.path.join(project.root, scriptFileOf(project.scripts, s)));
                        }
                      : undefined
                  }
                  onCreate={() => editorStore.addScript(undefined, undefined, { select: false })}
                  onChange={(id) => replaceScriptAt(i, id)}
                />
              </div>
            ))}

            {/* 「＋ 添加脚本」点出来的空槽：填上脚本就变成真实挂载项，✕ 可以取消这个空槽 */}
            {Array.from({ length: pendingScripts }).map((_, i) => (
              <div key={`pending-script-${i}`} data-node-script-empty>
                <ScriptSlot
                  project={project}
                  value={null}
                  badge="＋"
                  alwaysClear
                  emptyHint="空槽 · 点这里选脚本，或把脚本拖到这一行"
                  onCreate={() => editorStore.addScript(undefined, undefined, { select: false })}
                  onChange={(id) => {
                    if (id) attachScripts([id]);
                    setPendingScripts((n) => Math.max(0, n - 1));
                  }}
                />
              </div>
            ))}

            <button
              data-add-node-script
              onClick={() => setPendingScripts((n) => n + 1)}
              title="在下面加一个空的脚本槽，再点它选脚本，或把脚本拖进去；可以连点加多个"
              style={{ ...btnStyle, fontSize: 10.5, padding: '4px 8px', whiteSpace: 'nowrap', width: '100%' }}
            >
              ＋ 添加脚本
            </button>
          </div>
        </Field>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
        <button onClick={() => editorStore.duplicateSceneNode(node.id)} style={{ ...btnStyle, flex: 1, fontSize: 11 }}>
          复制一份
        </button>
        <button
          onClick={() => editorStore.deleteSceneNode(node.id)}
          style={{ ...btnStyle, flex: 1, fontSize: 11, color: T.danger, borderColor: T.danger }}
        >
          删除
        </button>
      </div>

      <div style={{ fontSize: 10, color: T.dimmer, marginTop: 10, lineHeight: 1.8 }}>
        拖场景里的标记改位置；在左侧列表里拖拽改顺序与层级。
      </div>
    </div>
  );
}
