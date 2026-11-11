/**
 * 资源选择组件（两套，命名与底部目录一致）
 *
 * 约定：贴图 = 单张贴图（「贴图」目录的图片资产）；图组 = 一组贴图的配置（「图组」目录，四向/裁剪等）。
 *
 * - TexSlot 贴图选择器：选「贴图」目录的单张贴图，带预设纯色 + 调色盘；
 *   传 loopable 时槽位行上直接有「重复」开关 —— 不重复 = 整块只贴一张，
 *   拉伸方式由贴图属性里的「单张拉伸策略」决定（拉伸 / 等比 / 九宫格）。
 *   地皮 / 边界贴图 / 地图元素装饰等地方用它。
 * - GroupSlot 图组选择器：选「图组」目录的图组，不带纯色。动画属性专用。
 *
 * 两个选择器都支持：点击缩略图打开弹窗选择、✕ 一键清除、
 * 从底部资源浏览器把「贴图 / 图组」目录里的资产直接拖到槽位上赋值。
 *
 * 选中的值统一是 { id, color?, loop? }：id 有值用资源，color 有值用纯色，两者互斥；
 * loop 只在 loopable 时有意义（undefined = 重复贴满）。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { animationParts, imageCssUrl } from '../model/resolve';
import {
  textureFilled,
  type AnimationAsset,
  type AssetKind,
  type ControllerAsset,
  type ImageAsset,
  type ProjectDoc,
  type ScriptAsset,
  type StateMachineAsset,
  type TextureAsset,
} from '../model/types';
import { T, FONT, btnStyle, inputStyle } from './theme';

export interface SlotValue {
  id: string | null;
  color?: string | null;
  /** 贴图选择器（loopable）用：true/undefined = 重复贴满；false = 整块只贴一张（拉伸策略生效） */
  loop?: boolean;
}

/** 单张模式（不重复）下的拉伸策略名，与贴图属性里的「单张拉伸策略」一致 */
export function tilingModeName(img: ImageAsset | null | undefined): string {
  const t = img?.tiling ?? 'default';
  return t === 'aspect' ? '等比' : t === 'nine' ? '九宫格' : '拉伸';
}

/** 图组资产的预览图：单向用 image，四向优先 S，其次 E / N / W */
export function texturePreviewUrl(project: ProjectDoc, tex: TextureAsset | null | undefined): string {
  if (!tex) return '';
  const id = tex.template === 'single' ? tex.image : (tex.dirs.S ?? tex.dirs.E ?? tex.dirs.N ?? tex.dirs.W ?? null);
  const img = project.images.find((i) => i.id === id);
  return img ? imageCssUrl(project, img) : '';
}

/** 纯色预设（偏自然地表 / 材质，够用又不喧宾夺主） */
const PRESET_COLORS = [
  '#5d7a45',
  '#7a8c4a',
  '#a3a35c',
  '#c2b280',
  '#b08d57',
  '#8a6a45',
  '#c9c2b4',
  '#e3e0d8',
  '#6f8f9b',
  '#4a6b7c',
  '#5a4a63',
  '#3a3532',
];

const checker = `repeating-conic-gradient(${T.bg0} 0% 25%, #191512 0% 50%) 8px 8px`;

/* ------------------------------------------------------------------ */
/* 贴图选择器 TexSlot（单张贴图 + 纯色 + 可选重复开关）                    */
/* ------------------------------------------------------------------ */

interface TexProps {
  project: ProjectDoc;
  value: SlotValue;
  /** 左侧小标记 */
  badge?: string;
  /** 空值时的占位名 */
  label?: string;
  hint?: string;
  /** 槽位行上显示「重复」开关（地皮 / 边界 / 装饰这类"铺在元素上"的用法） */
  loopable?: boolean;
  /** 是否允许纯色（默认允许；纯色没有意义的用法可以关掉） */
  allowColor?: boolean;
  thumbSize?: number;
  onChange: (v: SlotValue) => void;
}

export function TexSlot({ project, value, badge, label, hint, loopable, allowColor = true, thumbSize = 40, onChange }: TexProps) {
  const [open, setOpen] = useState(false);
  const img = value.id ? (project.images.find((i) => i.id === value.id) ?? null) : null;
  const color = value.color ?? null;
  const url = img ? imageCssUrl(project, img) : '';
  const empty = !value.id && !color;
  const name = img?.name ?? (color ? '纯色' : (label ?? '选择贴图'));
  const loop = value.loop ?? true;
  const sub =
    hint ??
    (color
      ? `纯色 ${color.toUpperCase()}`
      : img
        ? `贴图 · ${loopable ? (loop ? '重复贴满' : `单张 · ${tilingModeName(img)}`) : '来自「贴图」目录'}`
        : loopable
          ? '点图框选贴图 / 纯色'
          : '点图框从「贴图」目录选，或选纯色');

  return (
    <>
      <SlotShell
        data-asset-slot
        data-slot-kind="tex"
        badge={badge}
        thumbSize={thumbSize}
        color={color}
        url={url}
        empty={empty}
        emptyText="空"
        name={name}
        sub={sub}
        title={empty ? '点这里选择' : `${name}（点击更换）`}
        accept={['image']}
        onDropRef={(id) => onChange({ id, color: null, loop: value.loop })}
        onOpen={() => setOpen(true)}
        onClear={() => onChange({ id: null, color: null, loop: undefined })}
      >
        {/* 重复开关直接放在槽位行上：勾选 = 重复贴满；不勾 = 单张（拉伸策略见贴图属性） */}
        {loopable && img && (
          <label
            title={
              loop
                ? '贴图重复贴满整块地面（点击改为单张铺满）'
                : '整块地面只贴一张，拉伸方式由贴图属性里的「单张拉伸策略」决定（点击改为重复）'
            }
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: T.dim, cursor: 'pointer', flexShrink: 0, userSelect: 'none' }}
          >
            <input
              data-loop-toggle
              type="checkbox"
              checked={loop}
              onChange={(e) => onChange({ id: value.id, color, loop: e.target.checked })}
              style={{ accentColor: T.accent, margin: 0 }}
            />
            重复
          </label>
        )}
      </SlotShell>
      {open && (
        <AssetDialog
          project={project}
          mode="tex"
          allowColor={allowColor}
          currentId={value.id}
          currentColor={color}
          currentLoop={loop}
          onPick={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 图组选择器 GroupSlot（选图组，无纯色，动画属性专用）                   */
/* ------------------------------------------------------------------ */

interface GroupProps {
  project: ProjectDoc;
  value: SlotValue;
  badge?: string;
  label?: string;
  hint?: string;
  thumbSize?: number;
  onChange: (v: SlotValue) => void;
}

export function GroupSlot({ project, value, badge, label, hint, thumbSize = 40, onChange }: GroupProps) {
  const [open, setOpen] = useState(false);
  const tex = value.id ? (project.textures.find((t) => t.id === value.id) ?? null) : null;
  const url = tex ? texturePreviewUrl(project, tex) : '';
  const empty = !value.id;
  const name = tex?.name ?? (label ?? '选择图组');
  const sub = hint ?? (tex ? `图组 · ${tex.template === 'single' ? '单向' : '四向'}` : '点图框从「图组」目录选');

  return (
    <>
      <SlotShell
        data-asset-slot
        data-slot-kind="group"
        badge={badge}
        thumbSize={thumbSize}
        color={null}
        url={url}
        empty={empty}
        emptyText="空"
        name={name}
        sub={sub}
        title={empty ? '点这里选择' : `${name}（点击更换）`}
        accept={['texture']}
        onDropRef={(id) => onChange({ id })}
        onOpen={() => setOpen(true)}
        onClear={() => onChange({ id: null })}
      />
      {open && (
        <AssetDialog
          project={project}
          mode="group"
          currentId={value.id}
          onPick={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 槽位外壳（两个选择器共用的外观）                                      */
/* 点击缩略图打开弹窗；✕ 清除；可当拖拽落点接资源浏览器拖来的资产。        */
/* ------------------------------------------------------------------ */

/** 从拖拽数据里解析资源浏览器放进来的引用（"kind:id,kind:id"） */
function parseDropRefs(e: React.DragEvent): { kind: AssetKind; id: string }[] {
  const raw = e.dataTransfer.getData('text/plain');
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => {
      const i = s.indexOf(':');
      return i > 0 ? { kind: s.slice(0, i) as AssetKind, id: s.slice(i + 1) } : null;
    })
    .filter((r): r is { kind: AssetKind; id: string } => !!r && !!r.id);
}

/** 各资源种类对应的拖拽标记类型（dragover 阶段唯一可读的信息） */
const DRAG_TYPE: Record<string, string> = {
  image: 'application/x-light-asset-image',
  texture: 'application/x-light-asset-texture',
  animation: 'application/x-light-asset-animation',
  statemachine: 'application/x-light-asset-statemachine',
  controller: 'application/x-light-asset-controller',
  script: 'application/x-light-asset-script',
};

function SlotShell({
  badge,
  thumbSize,
  color,
  url,
  empty,
  emptyText,
  thumbText,
  alwaysClear,
  name,
  sub,
  title,
  accept,
  onDropRef,
  onOpen,
  onClear,
  children,
  ...rest
}: {
  badge?: string;
  thumbSize: number;
  color: string | null;
  url: string;
  empty: boolean;
  emptyText: string;
  /** 有值时缩略图中间显示的文字（脚本这类没有缩略图的资源用） */
  thumbText?: string;
  /** 空槽也显示 ✕（用来取消一个还没填的空槽） */
  alwaysClear?: boolean;
  name: string;
  sub: string;
  title: string;
  /** 接受哪些资源种类（贴图选择器收 image，图组选择器收 texture） */
  accept?: AssetKind[];
  /** 拖进来第一个匹配的资产 */
  onDropRef?: (id: string) => void;
  onOpen: () => void;
  onClear: () => void;
  children?: ReactNode;
  'data-asset-slot'?: boolean | string;
  'data-slot-kind'?: boolean | string;
}) {
  const [over, setOver] = useState(false);
  /** 只有拖的种类匹配时才允许放置和高亮：贴图槽只认贴图，图组槽只认图组 */
  const dragMatches = (e: React.DragEvent) => {
    if (!accept) return false;
    const types = e.dataTransfer.types;
    return accept.some((k) => DRAG_TYPE[k] !== undefined && types.includes(DRAG_TYPE[k]));
  };

  return (
    <div
      {...rest}
      onDragOver={(e) => {
        if (!onDropRef || !dragMatches(e)) return;
        e.preventDefault();
        e.stopPropagation();
        // effectAllowed = move（资源浏览器设定），dropEffect 必须一致，否则浏览器拒绝放置
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        if (!onDropRef) return;
        const refs = parseDropRefs(e);
        const hit = refs.find((r) => accept?.includes(r.kind));
        if (hit) onDropRef(hit.id);
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 6px',
        border: `1px solid ${over ? T.accent : T.lineSoft}`,
        borderRadius: 4,
        background: over ? T.sel : T.bg2,
      }}
    >
      {badge && <span style={{ width: 13, fontWeight: 700, color: T.accent, fontSize: 11.5, flexShrink: 0 }}>{badge}</span>}
      <div
        data-slot-thumb
        onClick={onOpen}
        title={title}
        style={{
          width: thumbSize,
          height: thumbSize,
          flexShrink: 0,
          borderRadius: 3,
          overflow: 'hidden',
          cursor: 'pointer',
          background: color ?? checker,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${T.line}`,
        }}
      >
        {!color && url ? (
          <img src={url} alt="" draggable={false} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        ) : null}
        {empty && <span style={{ fontSize: 9, color: T.dimmer }}>{emptyText}</span>}
        {!empty && thumbText && (
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.02em', color: T.accent, opacity: 0.9 }}>{thumbText}</span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11.5, color: empty ? T.dimmer : T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name}
        </div>
        <div style={{ fontSize: 9.5, color: T.dimmer, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
      </div>
      {children}
      {(!empty || alwaysClear) && (
        <button onClick={onClear} title="清空" style={{ ...btnStyle, padding: '2px 6px', fontSize: 11, color: T.dimmer, flexShrink: 0 }}>
          ✕
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 选择器弹窗                                                          */
/* ------------------------------------------------------------------ */

function AssetDialog({
  project,
  mode,
  allowColor,
  currentId,
  currentColor,
  currentLoop,
  onPick,
  onClose,
}: {
  project: ProjectDoc;
  mode: 'tex' | 'group';
  /** 贴图模式：是否显示纯色区 */
  allowColor?: boolean;
  currentId: string | null;
  currentColor?: string | null;
  currentLoop?: boolean;
  onPick: (v: SlotValue) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const isTex = mode === 'tex';
  const loop = currentLoop ?? true;

  const list = useMemo(() => {
    const key = q.trim().toLowerCase();
    const items = isTex ? project.images : project.textures;
    return items.filter((i) => !key || i.name.toLowerCase().includes(key));
  }, [project.images, project.textures, q, isTex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6,5,4,.62)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 900,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-asset-dialog
        style={{
          width: 640,
          maxWidth: '92vw',
          height: 500,
          maxHeight: '86vh',
          background: T.bg1,
          border: `1px solid ${T.line}`,
          borderRadius: 7,
          boxShadow: '0 24px 60px rgba(0,0,0,.7)',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: FONT,
          color: T.text,
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${T.line}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{isTex ? '选择贴图' : '选择图组'}</span>
          <span style={{ fontSize: 10.5, color: T.dimmer }}>
            {isTex ? '只能选「贴图」目录里的单张贴图' : '只能选「图组」目录里的图组'}
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ ...btnStyle, padding: '3px 8px' }}>
            关闭
          </button>
        </div>

        <div style={{ padding: '8px 14px 6px' }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={isTex ? '搜索贴图名…' : '搜索图组名…'}
            style={inputStyle}
            autoFocus
          />
        </div>

        {isTex && allowColor && (
          <div style={{ padding: '4px 14px 8px', borderBottom: `1px solid ${T.lineSoft}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: T.dim }}>纯色</span>
              <span style={{ fontSize: 10, color: T.dimmer }}>预设颜色，或打开调色盘自选</span>
              {currentColor && <span style={{ fontSize: 10, color: T.accent }}>当前 {currentColor.toUpperCase()}</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  title={c.toUpperCase()}
                  onClick={() => {
                    onPick({ id: null, color: c, loop });
                    onClose();
                  }}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    background: c,
                    cursor: 'pointer',
                    border: currentColor === c ? `2px solid ${T.accent}` : `1px solid ${T.line}`,
                  }}
                />
              ))}
              <label
                style={{
                  ...btnStyle,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '2px 8px',
                  marginLeft: 4,
                  fontSize: 11,
                }}
                title="打开调色盘"
              >
                <input
                  type="color"
                  value={currentColor ?? '#5d7a45'}
                  onChange={(e) => {
                    onPick({ id: null, color: e.target.value, loop });
                    onClose();
                  }}
                  style={{ width: 20, height: 18, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                />
                调色盘
              </label>
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px 14px', display: 'flex', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start' }}>
          <button
            onClick={() => {
              onPick({ id: null, color: null, loop });
              onClose();
            }}
            style={{
              width: 92,
              height: 96,
              borderRadius: 5,
              border: `1px dashed ${currentId || currentColor ? T.line : T.accent}`,
              background: currentId || currentColor ? T.bg2 : T.bg3,
              color: T.dim,
              cursor: 'pointer',
              fontSize: 11,
              fontFamily: FONT,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>⃠</span>
            不设置
          </button>

          {list.map((item) => {
            const url = isTex ? imageCssUrl(project, item as ImageAsset) : texturePreviewUrl(project, item as TextureAsset);
            const filled = isTex ? true : textureFilled(item as TextureAsset);
            const active = currentId === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onPick(isTex ? { id: item.id, color: null, loop } : { id: item.id });
                  onClose();
                }}
                title={item.name}
                style={{
                  width: 92,
                  height: 96,
                  borderRadius: 5,
                  border: active ? `1.5px solid ${T.accent}` : `1px solid ${T.line}`,
                  background: active ? T.sel : T.bg2,
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  fontFamily: FONT,
                  opacity: filled ? 1 : 0.55,
                }}
              >
                <div
                  style={{
                    width: '100%',
                    height: 58,
                    borderRadius: 3,
                    overflow: 'hidden',
                    background: checker,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {url ? (
                    <img src={url} alt="" draggable={false} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                  ) : (
                    <span style={{ fontSize: 9.5, color: T.dimmer }}>{isTex ? '无图' : '未设置'}</span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: T.text,
                    width: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    textAlign: 'center',
                  }}
                >
                  {item.name}
                </div>
              </button>
            );
          })}

          {list.length === 0 && (
            <div style={{ width: '100%', textAlign: 'center', padding: '28px 0', fontSize: 11.5, color: T.dimmer, lineHeight: 1.9 }}>
              {isTex ? '「贴图」目录里还没有资源' : '「图组」目录里还没有资源'}
              <br />
              {isTex ? '先在底部资源浏览器里导入贴图，再回来选' : '先在底部资源浏览器里新建图组，再回来选'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* 资源引用槽（动画 / 状态机）                                          */
/* 同一套壳：点击缩略图弹选择器，也可以从底部资源浏览器直接拖进来赋值。      */
/* ------------------------------------------------------------------ */

export type RefKind = 'animation' | 'statemachine' | 'controller';

interface RefProps {
  project: ProjectDoc;
  kind: RefKind;
  value: string | null;
  badge?: string;
  label?: string;
  hint?: string;
  thumbSize?: number;
  /** 右侧「编辑」按钮（打开动画 / 状态机 / 控制器编辑器） */
  onEdit?: (id: string) => void;
  onChange: (id: string | null) => void;
}

export function RefSlot({ project, kind, value, badge, label, hint, thumbSize = 40, onEdit, onChange }: RefProps) {
  const [open, setOpen] = useState(false);
  const anim = kind === 'animation' ? project.animations.find((a) => a.id === value) ?? null : null;
  const sm = kind === 'statemachine' ? project.stateMachines.find((s) => s.id === value) ?? null : null;
  const ctrl = kind === 'controller' ? project.controllers.find((c) => c.id === value) ?? null : null;
  const item = anim ?? sm ?? ctrl;
  const thumb = anim ? animationThumb(project, anim) : '';
  const sub =
    hint ??
    (anim
      ? `动画 · ${Object.keys(anim.clips ?? {}).length} 个片段`
      : sm
        ? `状态机 · ${sm.states.length} 状态 / ${sm.transitions.length} 流转`
        : ctrl
          ? `控制器 · ${ctrl.vars.length} 变量 / ${ctrl.bindings.length} 事件`
          : kind === 'animation'
            ? '点这里选「动画」目录里的动画'
            : kind === 'statemachine'
              ? '点这里选「状态机」目录里的状态机'
              : '点这里选「控制器」目录里的控制器');
  const placeholder = kind === 'animation' ? '选择动画' : kind === 'statemachine' ? '选择状态机' : '选择控制器';

  return (
    <>
      <SlotShell
        data-asset-slot
        data-slot-kind={kind}
        badge={badge}
        thumbSize={thumbSize}
        color={null}
        url={thumb}
        empty={!item}
        emptyText="空"
        name={item?.name ?? label ?? placeholder}
        sub={sub}
        title={item ? `${item.name}（点击更换）` : '点这里选择，也可以从资源浏览器拖进来'}
        accept={[kind]}
        onDropRef={(id) => onChange(id)}
        onOpen={() => setOpen(true)}
        onClear={() => onChange(null)}
      >
        {onEdit && item && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(item.id);
            }}
            style={{ ...btnStyle, padding: '2px 6px', fontSize: 10.5, flexShrink: 0 }}
          >
            编辑
          </button>
        )}
      </SlotShell>
      {open && <RefDialog project={project} kind={kind} currentId={value} onPick={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}

/** 动画缩略图：取层级最高的一张部件贴图 */
export function animationThumb(project: ProjectDoc, anim: AnimationAsset): string {
  const parts = animationParts(project, anim, 'S');
  const withTex = parts.filter((p) => p.texturePath).sort((a, b) => b.zIndex - a.zIndex);
  return withTex[0]?.texturePath ?? '';
}

function RefDialog({
  project,
  kind,
  currentId,
  onPick,
  onClose,
}: {
  project: ProjectDoc;
  kind: RefKind;
  currentId: string | null;
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const isAnim = kind === 'animation';
  const isCtrl = kind === 'controller';
  const list: (AnimationAsset | StateMachineAsset | ControllerAsset)[] = useMemo(() => {
    const key = q.trim().toLowerCase();
    const items: (AnimationAsset | StateMachineAsset | ControllerAsset)[] = isAnim
      ? project.animations
      : isCtrl
        ? project.controllers
        : project.stateMachines;
    return items.filter((i) => !key || i.name.toLowerCase().includes(key));
  }, [project.animations, project.stateMachines, project.controllers, q, isAnim, isCtrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6,5,4,.62)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 900,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-ref-dialog
        style={{
          width: 620,
          maxWidth: '92vw',
          height: 460,
          maxHeight: '86vh',
          background: T.bg1,
          border: `1px solid ${T.line}`,
          borderRadius: 7,
          boxShadow: '0 24px 60px rgba(0,0,0,.7)',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: FONT,
          color: T.text,
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${T.line}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{isAnim ? '选择动画' : isCtrl ? '选择控制器' : '选择状态机'}</span>
          <span style={{ fontSize: 10.5, color: T.dimmer }}>
            来自底部「{isAnim ? '动画' : isCtrl ? '控制器' : '状态机'}」目录
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ ...btnStyle, padding: '3px 8px' }}>
            关闭
          </button>
        </div>

        <div style={{ padding: '8px 14px 6px' }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={isAnim ? '搜索动画名…' : isCtrl ? '搜索控制器名…' : '搜索状态机名…'}
            style={inputStyle}
            autoFocus
          />
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px 14px', display: 'flex', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start' }}>
          <button
            onClick={() => {
              onPick(null);
              onClose();
            }}
            style={{
              width: 96,
              height: 92,
              borderRadius: 5,
              border: `1px dashed ${currentId ? T.line : T.accent}`,
              background: currentId ? T.bg2 : T.bg3,
              color: T.dim,
              cursor: 'pointer',
              fontSize: 11,
              fontFamily: FONT,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>⃠</span>
            不设置
          </button>

          {list.map((item) => {
            const active = currentId === item.id;
            const thumb = isAnim ? animationThumb(project, item as AnimationAsset) : '';
            const sub = isAnim
              ? `${Object.keys((item as AnimationAsset).clips ?? {}).length} 个片段`
              : isCtrl
                ? `${(item as ControllerAsset).vars.length} 变量 / ${(item as ControllerAsset).bindings.length} 事件`
                : `${(item as StateMachineAsset).states.length} 状态 / ${(item as StateMachineAsset).transitions.length} 流转`;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onPick(item.id);
                  onClose();
                }}
                title={item.name}
                style={{
                  width: 96,
                  height: 92,
                  borderRadius: 5,
                  border: active ? `1.5px solid ${T.accent}` : `1px solid ${T.line}`,
                  background: active ? T.sel : T.bg2,
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  fontFamily: FONT,
                  alignItems: 'center',
                }}
              >
                <div
                  style={{
                    width: '100%',
                    height: 50,
                    borderRadius: 3,
                    overflow: 'hidden',
                    background: checker,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {thumb ? (
                    <img src={thumb} alt="" draggable={false} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                  ) : (
                    <span style={{ fontSize: 9.5, color: T.dimmer }}>{isAnim ? '无贴图' : isCtrl ? '变量表' : '流程图'}</span>
                  )}
                </div>
                <div style={{ fontSize: 10.5, color: T.text, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.name}
                </div>
                <div style={{ fontSize: 9, color: T.dimmer }}>{sub}</div>
              </button>
            );
          })}

          {list.length === 0 && (
            <div style={{ width: '100%', textAlign: 'center', padding: '28px 0', fontSize: 11.5, color: T.dimmer, lineHeight: 1.9 }}>
              {isAnim ? '「动画」目录里还没有动画' : isCtrl ? '「控制器」目录里还没有控制器' : '「状态机」目录里还没有状态机'}
              <br />
              先在底部资源浏览器里新建，再回来选
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 脚本槽 ScriptSlot（选「脚本」目录里的脚本）                            */
/* 和贴图 / 图组 / 动画槽位同一套外观：                                */
/*   · 点击缩略图 → 打开脚本选择弹窗                                   */
/*   · 从底部资源浏览器把脚本拖到槽位上 → 直接赋值                       */
/*   · value 为 null 时就是一个空槽，用来「先加一个空 item 再填」         */
/* ------------------------------------------------------------------ */

interface ScriptProps {
  project: ProjectDoc;
  value: string | null;
  badge?: string;
  label?: string;
  hint?: string;
  /** 空槽时的提示语（挂在节点上的空槽和资源引用的空槽文案不同） */
  emptyHint?: string;
  /** 空槽也显示 ✕（取消一个还没填的空槽） */
  alwaysClear?: boolean;
  thumbSize?: number;
  /** 打开内置脚本编辑器 */
  onEdit?: (id: string) => void;
  /** 用 VS Code 打开源码（桌面端才传） */
  onOpenInEditor?: (id: string) => void;
  /** 选择弹窗里「＋ 新建脚本」，返回新脚本 id */
  onCreate?: () => string | null;
  onChange: (id: string | null) => void;
}

export function ScriptSlot({
  project,
  value,
  badge,
  label,
  hint,
  emptyHint,
  alwaysClear,
  thumbSize = 40,
  onEdit,
  onOpenInEditor,
  onCreate,
  onChange,
}: ScriptProps) {
  const [open, setOpen] = useState(false);
  const s = value ? (project.scripts.find((x) => x.id === value) ?? null) : null;
  const lines = s ? s.code.split('\n').length : 0;

  return (
    <>
      <SlotShell
        data-asset-slot
        data-slot-kind="script"
        badge={badge}
        thumbSize={thumbSize}
        color={null}
        url=""
        empty={!s}
        emptyText="空"
        thumbText="JS"
        alwaysClear={alwaysClear}
        name={s?.name ?? label ?? '选择脚本'}
        sub={hint ?? (s ? `脚本 · ${lines} 行 JS` : (emptyHint ?? '点这里选「脚本」目录里的脚本，或从资源浏览器拖进来'))}
        title={s ? `${s.name}（点击更换）` : '点这里选择脚本，也可以从资源浏览器拖进来'}
        accept={['script']}
        onDropRef={(id) => onChange(id)}
        onOpen={() => setOpen(true)}
        onClear={() => onChange(null)}
      >
        {s && onEdit && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(s.id);
            }}
            title="打开内置脚本编辑器"
            style={{ ...btnStyle, padding: '2px 6px', fontSize: 10.5, flexShrink: 0 }}
          >
            编辑
          </button>
        )}
        {s && onOpenInEditor && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenInEditor(s.id);
            }}
            title="用 VS Code / 系统默认编辑器打开源码"
            style={{ ...btnStyle, padding: '2px 6px', fontSize: 10.5, flexShrink: 0 }}
          >
            VS Code
          </button>
        )}
      </SlotShell>
      {open && (
        <ScriptDialog
          project={project}
          currentId={value}
          onPick={onChange}
          onCreate={onCreate}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ScriptDialog({
  project,
  currentId,
  onPick,
  onCreate,
  onClose,
}: {
  project: ProjectDoc;
  currentId: string | null;
  onPick: (id: string | null) => void;
  /** 新建脚本并返回新 id（null = 建不了） */
  onCreate?: () => string | null;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const list: ScriptAsset[] = useMemo(() => {
    const key = q.trim().toLowerCase();
    return project.scripts.filter((s) => !key || s.name.toLowerCase().includes(key));
  }, [project.scripts, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6,5,4,.62)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 900,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-script-dialog
        style={{
          width: 620,
          maxWidth: '92vw',
          height: 460,
          maxHeight: '86vh',
          background: T.bg1,
          border: `1px solid ${T.line}`,
          borderRadius: 7,
          boxShadow: '0 24px 60px rgba(0,0,0,.7)',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: FONT,
          color: T.text,
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${T.line}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>选择脚本</span>
          <span style={{ fontSize: 10.5, color: T.dimmer }}>来自底部「脚本」目录</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => {
              const id = onCreate ? onCreate() : null;
              if (id) {
                onPick(id);
                onClose();
              }
            }}
            title="在「脚本」目录里新建一个脚本并选中"
            style={{ ...btnStyle, padding: '3px 8px' }}
          >
            ＋ 新建脚本
          </button>
          <button onClick={onClose} style={{ ...btnStyle, padding: '3px 8px' }}>
            关闭
          </button>
        </div>

        <div style={{ padding: '8px 14px 6px' }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索脚本名…"
            style={inputStyle}
            autoFocus
          />
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px 14px', display: 'flex', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start' }}>
          <button
            onClick={() => {
              onPick(null);
              onClose();
            }}
            style={{
              width: 96,
              height: 92,
              borderRadius: 5,
              border: `1px dashed ${currentId ? T.line : T.accent}`,
              background: currentId ? T.bg2 : T.bg3,
              color: T.dim,
              cursor: 'pointer',
              fontSize: 11,
              fontFamily: FONT,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>⃠</span>
            不设置
          </button>

          {list.map((item) => {
            const active = currentId === item.id;
            const lines = item.code.split('\n').length;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onPick(item.id);
                  onClose();
                }}
                title={item.name}
                style={{
                  width: 96,
                  height: 92,
                  borderRadius: 5,
                  border: active ? `1.5px solid ${T.accent}` : `1px solid ${T.line}`,
                  background: active ? T.sel : T.bg2,
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  fontFamily: FONT,
                  alignItems: 'center',
                }}
              >
                <div
                  style={{
                    width: '100%',
                    height: 50,
                    borderRadius: 3,
                    background: T.bg0,
                    border: `1px solid ${T.lineSoft}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    color: T.accent,
                    fontSize: 15,
                    fontWeight: 700,
                    letterSpacing: '.02em',
                  }}
                >
                  JS
                </div>
                <div style={{ fontSize: 10.5, color: T.text, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.name}
                </div>
                <div style={{ fontSize: 9, color: T.dimmer }}>{lines} 行</div>
              </button>
            );
          })}

          {list.length === 0 && (
            <div style={{ width: '100%', textAlign: 'center', padding: '28px 0', fontSize: 11.5, color: T.dimmer, lineHeight: 1.9 }}>
              「脚本」目录里还没有脚本
              <br />
              点上面的「＋ 新建脚本」，或去底部资源浏览器新建
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
