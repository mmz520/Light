/**
 * 组件面板 —— 按脚本的字段元数据渲染属性
 *
 * 一个节点挂了哪些组件脚本，就渲染几个区块；每个区块内按 @Group 分组，
 * 每个字段按注解（@Num / @Bool / @Asset …）或默认值类型选控件。
 * 控件样式沿用原来的 Field / 按钮 / 资源槽，保证观感不变。
 */
import { useEffect, useState } from 'react';
import type { FieldMeta } from '../../runtime/component';
import type { ProjectDoc, SceneNode, ScriptAsset } from '../model/types';
import type { LoadedComponent } from '../../runtime/scriptRegistry';
import { applyComponentField, instantiate, readFieldValues } from '../model/componentHost';
import { editorStore } from '../model/store';
import { isDesktop } from '../../platform/desk';
import { GroupSlot, RefSlot, TexSlot } from './AssetPicker';
import { GroundPanel } from './GroundPanel';
import { T, btnStyle, inputStyle, sectionTitle } from './theme';

interface Props {
  project: ProjectDoc;
  node: SceneNode;
  components: { script: ScriptAsset; loaded: LoadedComponent }[];
  onOpenScript: (id: string) => void;
}

export function ComponentPanel({ project, node, components, onOpenScript }: Props) {
  if (components.length === 0) {
    return (
      <div style={{ fontSize: 10.5, color: T.dimmer, lineHeight: 1.8 }}>
        这个对象还没有挂组件脚本。点下面的「＋ 添加脚本」新建一个。
      </div>
    );
  }

  return (
    <div>
      {components.map(({ script, loaded }, i) => (
        <ComponentSection
          key={script.id}
          project={project}
          node={node}
          script={script}
          loaded={loaded}
          onOpenScript={onOpenScript}
          divided={i > 0}
        />
      ))}
    </div>
  );
}

function ComponentSection({
  project,
  node,
  script,
  loaded,
  onOpenScript,
  divided,
}: {
  project: ProjectDoc;
  node: SceneNode;
  script: ScriptAsset;
  loaded: LoadedComponent;
  onOpenScript: (id: string) => void;
  /** 不是第一个区块时加分隔线 */
  divided?: boolean;
}) {
  // 每次渲染重建实例：字段值以「脚本默认值 ← node.components ← onMount 读到的节点数据」为准
  const inst = loaded.cls ? instantiate(node, project, loaded) : null;
  const values = inst ? readFieldValues(inst, loaded) : { ...loaded.defaults };

  const visible = loaded.fields.filter((f) => !f.hidden);
  const groups: { group: string; order: number; fields: FieldMeta[] }[] = [];
  for (const f of visible) {
    let g = groups.find((x) => x.group === f.group);
    if (!g) {
      g = { group: f.group, order: f.groupOrder, fields: [] };
      groups.push(g);
    }
    g.fields.push(f);
  }
  groups.sort((a, b) => a.order - b.order);

  const setField = (key: string, value: unknown) => {
    applyComponentField(node, project, loaded, key, value);
  };

  const detach = () => {
    const ids = (node.componentIds ?? []).filter((x) => x !== script.id);
    editorStore.setNodeComponents(node.id, ids);
  };

  return (
    <div
      data-component={script.preset ?? script.id}
      style={{
        marginBottom: 8,
        ...(divided ? { borderTop: `1px solid ${T.lineSoft}`, paddingTop: 8 } : {}),
      }}
    >
      <div style={{ ...sectionTitle, display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontSize: 12 }}>{loaded.meta.icon || '🧩'}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {loaded.meta.name}
        </span>
        {/* 预设脚本只有开发环境（桌面版）能编辑 */}
        {(!script.preset || isDesktop) && (
          <button
            onClick={() => onOpenScript(script.id)}
            title="打开脚本源码"
            style={{ ...btnStyle, padding: '1px 5px', fontSize: 10 }}
          >
            编辑
          </button>
        )}
        {script.preset ? (
          <span
            title="系统组件：按对象类型自动挂载，不能卸载"
            style={{ padding: '1px 4px', fontSize: 9.5, color: T.dimmer, border: `1px solid ${T.lineSoft}`, borderRadius: 3 }}
          >
            系统
          </span>
        ) : (
          <button onClick={detach} title="从对象上卸载这个组件" style={{ ...btnStyle, padding: '1px 6px', fontSize: 10, color: T.dimmer }}>
            ✕
          </button>
        )}
      </div>

      {loaded.error && (
        <div
          data-component-error
          style={{ fontSize: 10, color: T.danger, lineHeight: 1.6, marginBottom: 8, wordBreak: 'break-word' }}
        >
          编译失败：{loaded.error}
        </div>
      )}

      {!loaded.error && loaded.meta.desc && (
        <div style={{ fontSize: 9.5, color: T.dimmer, marginBottom: 6, lineHeight: 1.6 }}>{loaded.meta.desc}</div>
      )}

      {groups.map((g) => (
        <div key={g.group} style={{ marginBottom: 4 }}>
          {g.group !== '默认' && (
            <div style={{ fontSize: 10, color: T.dimmer, margin: '6px 0 4px', letterSpacing: '.04em' }}>{g.group}</div>
          )}
          {g.fields.map((f) => (
            <FieldRow
              key={f.key}
              project={project}
              node={node}
              field={f}
              value={values[f.key]}
              onChange={(v) => setField(f.key, v)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 单个字段                                                            */
/* ------------------------------------------------------------------ */

function FieldRow({
  project,
  node,
  field,
  value,
  onChange,
}: {
  project: ProjectDoc;
  node: SceneNode;
  field: FieldMeta;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  // 内置面板：整块交给宿主组件
  if (field.kind === 'panel') {
    if (field.panel === 'ground') {
      return (
        <div data-panel="ground" style={{ margin: '2px -10px 6px' }}>
          <GroundPanel project={project} node={node} />
        </div>
      );
    }
    return null;
  }

  return (
    <div style={{ marginBottom: 10 }} data-field={field.key}>
      <div style={{ fontSize: 11, color: T.dim, marginBottom: 3 }}>{field.label}</div>
      <Control project={project} field={field} value={value} onChange={onChange} />
      {field.hint && <div style={{ fontSize: 9.5, color: T.dimmer, marginTop: 3, lineHeight: 1.6 }}>{field.hint}</div>}
    </div>
  );
}

function Control({
  project,
  field,
  value,
  onChange,
}: {
  project: ProjectDoc;
  field: FieldMeta;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.kind) {
    case 'number':
    case 'int':
      return (
        <NumberInput
          value={Number(value ?? 0)}
          min={field.min}
          max={field.max}
          step={field.step ?? (field.kind === 'int' ? 1 : 1)}
          onChange={(v) => onChange(v)}
        />
      );

    case 'bool':
      return <Toggle value={!!value} onChange={(v) => onChange(v)} />;

    case 'text':
      return <TextArea value={String(value ?? '')} onChange={onChange} />;

    case 'color':
      return <ColorInput value={String(value ?? '')} onChange={onChange} />;

    case 'enum':
      return <EnumControl field={field} value={value} onChange={onChange} />;

    case 'asset':
      return <AssetControl project={project} field={field} value={value as string | null} onChange={(v) => onChange(v)} />;

    case 'assets':
      return (
        <MultiAssetControl
          project={project}
          field={field}
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={(ids) => onChange(ids)}
        />
      );

    case 'json':
    case 'list':
      return <JsonControl value={value} onChange={onChange} />;

    default:
      return (
        <input
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      );
  }
}

function NumberInput({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v);
  };
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        commit(e.target.value);
      }}
      onBlur={() => setText(String(value))}
      style={inputStyle}
    />
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {[
        { v: true, name: '开' },
        { v: false, name: '关' },
      ].map((o) => (
        <button
          key={String(o.v)}
          onClick={() => onChange(o.v)}
          style={{
            ...btnStyle,
            flex: 1,
            fontSize: 10.5,
            color: value === o.v ? '#1a1410' : T.text,
            background: value === o.v ? T.accent : T.bg3,
            borderColor: value === o.v ? T.accent : T.line,
          }}
        >
          {o.name}
        </button>
      ))}
    </div>
  );
}

function TextArea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <textarea
      value={text}
      rows={3}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(text)}
      style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
    />
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 34, height: 24, padding: 0, border: `1px solid ${T.line}`, borderRadius: 4, background: 'transparent' }}
      />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="#rrggbb" style={{ ...inputStyle, flex: 1 }} />
    </div>
  );
}

function EnumControl({
  field,
  value,
  onChange,
}: {
  field: FieldMeta;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const options = field.options ?? [];
  if (options.length <= 4) {
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            style={{
              ...btnStyle,
              flex: 1,
              fontSize: 10.5,
              color: value === o.value ? '#1a1410' : T.text,
              background: value === o.value ? T.accent : T.bg3,
              borderColor: value === o.value ? T.accent : T.line,
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, fontSize: 11 }}>
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function AssetControl({
  project,
  field,
  value,
  onChange,
}: {
  project: ProjectDoc;
  field: FieldMeta;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const kind = field.assetKind;
  if (kind === 'group') {
    return (
      <GroupSlot
        project={project}
        value={{ id: value ?? null }}
        thumbSize={36}
        label="选择图组"
        onChange={(v) => onChange(v.id)}
      />
    );
  }
  if (kind === 'texture' || kind === 'image') {
    return (
      <TexSlot
        project={project}
        value={{ id: value ?? null, color: null, loop: true }}
        thumbSize={36}
        loopable
        label={`选择${kind === 'image' ? '图片' : '贴图'}`}
        onChange={(v) => onChange(v.id)}
      />
    );
  }
  if (kind === 'animation' || kind === 'statemachine' || kind === 'controller') {
    return (
      <RefSlot
        project={project}
        kind={kind}
        value={value ?? null}
        thumbSize={36}
        onChange={(id) => onChange(id)}
      />
    );
  }
  return <div style={{ fontSize: 10.5, color: T.dimmer }}>不支持的资源类型：{kind}</div>;
}

function MultiAssetControl({
  project,
  field,
  value,
  onChange,
}: {
  project: ProjectDoc;
  field: FieldMeta;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const kind = field.assetKind;
  const rows = value.map((id, i) => (
    <div key={`${id}-${i}`} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {kind === 'controller' ? (
          <RefSlot project={project} kind="controller" value={id} thumbSize={30} onChange={() => undefined} />
        ) : (
          <div style={{ fontSize: 10.5, color: T.dim }}>{id}</div>
        )}
      </div>
      <button
        onClick={() => onChange(value.filter((_, idx) => idx !== i))}
        title="移除"
        style={{ ...btnStyle, padding: '1px 6px', fontSize: 10, color: T.dimmer }}
      >
        ✕
      </button>
    </div>
  ));

  return (
    <div>
      {rows}
      <select
        value=""
        onChange={(e) => {
          const id = e.target.value;
          if (id && !value.includes(id)) onChange([...value, id]);
        }}
        style={{ ...inputStyle, fontSize: 10.5, padding: '3px 4px' }}
      >
        <option value="">＋ 添加…</option>
        {kind === 'controller' &&
          project.controllers
            .filter((c) => !value.includes(c.id))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}（{c.vars.length} 变量）
              </option>
            ))}
      </select>
    </div>
  );
}

function JsonControl({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const pretty = JSON.stringify(value ?? null, null, 2);
  const [text, setText] = useState(pretty);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(pretty);
    setBad(false);
  }, [pretty]);
  return (
    <div>
      <textarea
        value={text}
        rows={4}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          try {
            onChange(JSON.parse(text || 'null'));
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
        style={{
          ...inputStyle,
          resize: 'vertical',
          fontFamily: 'Consolas, monospace',
          fontSize: 10.5,
          lineHeight: 1.5,
          borderColor: bad ? T.danger : T.line,
        }}
      />
      {bad && <div style={{ fontSize: 9.5, color: T.danger, marginTop: 2 }}>JSON 格式不对，改好再离开输入框</div>}
    </div>
  );
}
