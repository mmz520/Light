/**
 * 状态机编辑器（流程图）
 *
 * 一个状态 = 一段动画 + 一种位移方式；连线 = 流转条件。
 * 条件是任意可嵌套的布尔树（与 / 或 / 非 + 数值比较 + 标志位 + 事件），
 * 所以以后加攻击 / 受击 / 技能只要加状态和连线，不用改数据结构。
 */
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { editorStore, useEditor } from '../model/store';
import { conditionFromList, conditionList, conditionText, newVarCondition } from '../model/statemachine';
import {
  SM_VAR_OPS,
  type ControllerAsset,
  type CtrlVariable,
  type ProjectDoc,
  type SmCondition,
  type SmState,
  type SmTransition,
  type SmVarOp,
} from '../model/types';
import { RefSlot } from './AssetPicker';
import { T, btnStyle, inputStyle, sectionTitle } from './theme';

const NODE_W = 176;

interface StateNodeData extends Record<string, unknown> {
  label: string;
  clip: string;
  animName: string;
  move: 'none' | 'forward';
  entry: boolean;
}

const nodeTypes = { smState: StateCard };

/**
 * 连线坐标来自 RF 对节点的测量（ResizeObserver）。桌面端窗口「先隐藏后显示」时
 * 这套观察器偶尔一次都不回调，连线就永远不出。这里作为 ReactFlow 的子节点挂在
 * provider 内部，用官方的 useUpdateNodeInternals 催 RF 重测几次。正常环境下它
 * 只是无害的重复测量。
 */
function MeasureNudge({ idKey }: { idKey: string }) {
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    const ids = idKey ? idKey.split(',') : [];
    if (ids.length === 0) return;
    const timers = [0, 150, 400, 900].map((d) => window.setTimeout(() => updateNodeInternals(ids), d));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [idKey, updateNodeInternals]);
  return null;
}

function StateCard({ data, selected }: NodeProps) {
  const d = data as unknown as StateNodeData;
  return (
    <div
      data-sm-state
      style={{
        width: NODE_W,
        borderRadius: 6,
        border: `1.5px solid ${selected ? T.accent : d.entry ? '#8aa872' : T.line}`,
        background: T.bg2,
        boxShadow: selected ? `0 0 0 1px ${T.accent}, 0 6px 16px rgba(0,0,0,.45)` : '0 4px 12px rgba(0,0,0,.35)',
        padding: '8px 10px',
        fontFamily: 'inherit',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ width: 9, height: 9, background: T.accent, border: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: T.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {d.label}
        </span>
        {d.entry && (
          <span style={{ fontSize: 9, color: '#1a1410', background: '#8aa872', borderRadius: 3, padding: '1px 4px', fontWeight: 700 }}>
            初始
          </span>
        )}
      </div>
      <div style={{ fontSize: 10, color: T.dimmer, marginTop: 4, lineHeight: 1.5 }}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>动画：{d.animName || '未绑定'}</div>
        <div>片段：{d.clip || '首个'} · {d.move === 'forward' ? '前进' : '原地'}</div>
      </div>
      <Handle type="source" position={Position.Right} style={{ width: 9, height: 9, background: T.accent, border: 'none' }} />
    </div>
  );
}

type Sel = { kind: 'state'; id: string } | { kind: 'transition'; id: string } | null;

export function StateMachineWorkbench({ smId }: { smId: string }) {
  const state = useEditor();
  const project = state.project;
  const sm = project?.stateMachines.find((s) => s.id === smId) ?? null;
  const [sel, setSel] = useState<Sel>(null);
  /** 拖拽中的临时坐标：拖动时不写 store，松手才落库（避免每帧整工程克隆） */
  const [drag, setDrag] = useState<Record<string, { x: number; y: number }>>({});
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const nodes = useMemo<Node[]>(() => {
    if (!sm) return [];
    return sm.states.map((st) => {
      const anim = st.animationId ? project!.animations.find((a) => a.id === st.animationId) ?? null : null;
      const pos = drag[st.id] ?? { x: st.x, y: st.y };
      return {
        id: st.id,
        type: 'smState',
        position: pos,
        // 显式给初始尺寸：连线绘制依赖节点测量，个别环境下 ResizeObserver 不触发会导致连线永远画不出来
        initialWidth: NODE_W,
        initialHeight: 64,
        style: { width: NODE_W },
        selected: sel?.kind === 'state' && sel.id === st.id,
        data: {
          label: st.name,
          clip: st.clip ?? Object.keys(anim?.clips ?? {})[0] ?? '',
          animName: anim?.name ?? '',
          move: st.move,
          entry: st.entry,
        } satisfies StateNodeData,
      };
    });
  }, [sm, project, drag, sel]);

  const edges = useMemo<Edge[]>(() => {
    if (!sm) return [];
    return sm.transitions.map((tr) => ({
      id: tr.id,
      source: tr.from,
      target: tr.to,
      selected: sel?.kind === 'transition' && sel.id === tr.id,
      // 默认的贝塞尔曲线（平滑过渡），不用 smoothstep 的直角折线
      type: 'default',
      markerEnd: { type: MarkerType.ArrowClosed, color: T.accent, width: 16, height: 16 },
      style: { stroke: sel?.kind === 'transition' && sel.id === tr.id ? T.accent : '#7d6a52', strokeWidth: 1.6 },
    }));
  }, [sm, sel]);

  if (!project || !sm) {
    return <div style={{ padding: 20, color: T.dimmer, fontSize: 12 }}>状态机已被删除</div>;
  }

  /**
   * 条件变量的来源：状态机自己绑的控制器 → 引用它的角色的第一个控制器 → 工程第一个控制器。
   * 状态机可以在属性面板里显式绑定，没绑也能跟着角色走，省得每个状态机都配一遍。
   */
  const owner = project.scene.find((n) => n.kind === 'character' && n.character?.stateMachineId === sm.id);
  const ctrl: ControllerAsset | null =
    project.controllers.find((c) => c.id === sm.controllerId) ??
    project.controllers.find((c) => (owner?.character?.controllerIds ?? []).includes(c.id)) ??
    project.controllers[0] ??
    null;
  const vars = ctrl?.vars ?? [];

  const selectedState = sel?.kind === 'state' ? sm.states.find((s) => s.id === sel.id) ?? null : null;
  const selectedTr = sel?.kind === 'transition' ? sm.transitions.find((t) => t.id === sel.id) ?? null : null;

  const onNodesChange = (changes: NodeChange[]) => {
    const next: Record<string, { x: number; y: number }> = {};
    for (const c of changes) {
      if (c.type === 'position' && c.position) next[c.id] = { x: c.position.x, y: c.position.y };
    }
    if (Object.keys(next).length > 0) setDrag((prev) => ({ ...prev, ...next }));
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    const doomed = changes.filter((c) => c.type === 'remove').map((c) => c.id);
    for (const id of doomed) editorStore.removeSmTransition(sm.id, id);
  };

  const onConnect = (conn: Connection) => {
    if (!conn.source || !conn.target) return;
    const id = editorStore.addSmTransition(sm.id, conn.source, conn.target);
    if (id) setSel({ kind: 'transition', id });
  };

  return (
    <div style={{ height: '100%', display: 'flex', minHeight: 0, background: T.bg0 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* 工具条 */}
        <div
          style={{
            height: 36,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 10px',
            borderBottom: `1px solid ${T.lineSoft}`,
            background: T.bg1,
          }}
        >
          <input
            value={nameDraft ?? sm.name}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              if (nameDraft && nameDraft.trim() && nameDraft !== sm.name) editorStore.renameAsset('statemachine', sm.id, nameDraft);
              setNameDraft(null);
            }}
            title="状态机名称"
            style={{ ...inputStyle, width: 160, padding: '3px 6px', fontSize: 11.5 }}
          />
          <button
            style={{ ...btnStyle, padding: '3px 9px' }}
            onClick={() => {
              const wrap = wrapRef.current;
              // 斜向错落，保证任意两个状态都不会落在同一水平线上（否则正反连线会重合）
              const i = sm.states.length;
              const x = wrap ? 120 + (i % 3) * 240 : 120;
              const y = wrap ? 90 + i * 95 : 90;
              const id = editorStore.addSmState(sm.id, x, y);
              if (id) setSel({ kind: 'state', id });
            }}
          >
            ＋ 状态
          </button>
          <span style={{ fontSize: 10, color: T.dimmer }}>
            {sm.states.length} 状态 · {sm.transitions.length} 流转 · 拖圆点连线，点线改条件，Delete 删除
          </span>
        </div>

        <div ref={wrapRef} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={(_, node) => {
              editorStore.updateSmState(sm.id, node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) }, `sm-move:${sm.id}`);
              setDrag((prev) => {
                const next = { ...prev };
                delete next[node.id];
                return next;
              });
            }}
            onNodeClick={(_, node) => setSel({ kind: 'state', id: node.id })}
            onEdgeClick={(_, edge) => setSel({ kind: 'transition', id: edge.id })}
            onPaneClick={() => setSel(null)}

            onNodesDelete={(gone) => {
              for (const n of gone) editorStore.removeSmState(sm.id, n.id);
              setSel(null);
            }}
            // 给自检脚本留一个实例句柄，方便查节点测量状态（正常交互不依赖它）
            onInit={(inst) => {
              (window as unknown as { __rfInst?: unknown }).__rfInst = inst;
            }}
            proOptions={{ hideAttribution: true }}
            defaultViewport={{ x: 40, y: 20, zoom: 1 }}
            minZoom={0.3}
            maxZoom={1.8}
            deleteKeyCode={['Delete', 'Backspace']}
            style={{ background: T.bg0 }}
          >
            <MeasureNudge idKey={sm.states.map((s) => s.id).join(',')} />
            <Background color="#2a231b" gap={18} />
            <Controls showInteractive={false} style={{ background: T.bg1, border: `1px solid ${T.line}`, borderRadius: 5 }} />
          </ReactFlow>
        </div>
      </div>

      {/* 右侧：选中项属性 */}
      <div
        style={{
          width: 296,
          flexShrink: 0,
          borderLeft: `1px solid ${T.line}`,
          background: T.bg1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <div style={{ padding: '8px 12px', borderBottom: `1px solid ${T.lineSoft}`, fontSize: 11.5, color: T.text }}>
          {selectedState ? '状态' : selectedTr ? '流转条件' : '状态机'}
        </div>
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: '10px 12px 18px' }}>
          {selectedState && (
            <StatePanel
              state={selectedState}
              project={project}
              onChange={(patch, mergeKey) => editorStore.updateSmState(sm.id, selectedState.id, patch, mergeKey)}
              onEntry={() => editorStore.setSmEntry(sm.id, selectedState.id)}
              onDelete={() => {
                editorStore.removeSmState(sm.id, selectedState.id);
                setSel(null);
              }}
            />
          )}
          {selectedTr && (
            <TransitionPanel
              sm={sm}
              transition={selectedTr}
              vars={vars}
              controller={ctrl}
              onChange={(patch, mergeKey) => editorStore.updateSmTransition(sm.id, selectedTr.id, patch, mergeKey)}
              onDelete={() => {
                editorStore.removeSmTransition(sm.id, selectedTr.id);
                setSel(null);
              }}
            />
          )}
          {!selectedState && !selectedTr && <OverviewPanel sm={sm} vars={vars} controller={ctrl} />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 状态属性                                                            */
/* ------------------------------------------------------------------ */

function StatePanel({
  state,
  project,
  onChange,
  onEntry,
  onDelete,
}: {
  state: SmState;
  project: ProjectDoc;
  onChange: (patch: Partial<SmState>, mergeKey?: string) => void;
  onEntry: () => void;
  onDelete: () => void;
}) {
  const anim = project.animations.find((a) => a.id === state.animationId) ?? null;
  const clips = Object.keys(anim?.clips ?? {});
  return (
    <>
      <Block label="状态名">
        <input
          value={state.name}
          onChange={(e) => onChange({ name: e.target.value }, `sm-name:${state.id}`)}
          style={inputStyle}
        />
      </Block>

      <Block label="动画" hint="不选就用角色自身的默认动画">
        <RefSlot
          project={project}
          kind="animation"
          value={state.animationId}
          onChange={(id) => onChange({ animationId: id, clip: null })}
          thumbSize={34}
        />
      </Block>

      <Block label="播放片段">
        <select
          value={state.clip ?? ''}
          onChange={(e) => onChange({ clip: e.target.value || null })}
          style={inputStyle}
          disabled={clips.length === 0}
        >
          <option value="">{clips[0] ? `首个（${clips[0]}）` : '（这个动画没有片段）'}</option>
          {clips.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Block>

      <Block label="位移">
        <div style={{ display: 'flex', gap: 6 }}>
          {(
            [
              { id: 'none', name: '原地' },
              { id: 'forward', name: '按移速前进' },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              onClick={() => onChange({ move: m.id })}
              style={{
                ...btnStyle,
                flex: 1,
                background: state.move === m.id ? T.accent : T.bg3,
                color: state.move === m.id ? '#1a1410' : T.text,
                border: 'none',
                fontWeight: state.move === m.id ? 700 : 400,
              }}
            >
              {m.name}
            </button>
          ))}
        </div>
      </Block>

      <Block label="初始状态">
        <button
          onClick={onEntry}
          disabled={state.entry}
          style={{ ...btnStyle, width: '100%', opacity: state.entry ? 0.55 : 1 }}
        >
          {state.entry ? '当前就是初始状态' : '设为初始状态'}
        </button>
      </Block>

      <Block label="备注">
        <textarea
          value={state.desc ?? ''}
          onChange={(e) => onChange({ desc: e.target.value }, `sm-desc:${state.id}`)}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
        />
      </Block>

      <button onClick={onDelete} style={{ ...btnStyle, width: '100%', marginTop: 10, color: '#d98b7a' }}>
        删除这个状态
      </button>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 流转属性                                                            */
/* ------------------------------------------------------------------ */

function TransitionPanel({
  sm,
  transition,
  vars,
  controller,
  onChange,
  onDelete,
}: {
  sm: { id: string; states: SmState[] };
  transition: SmTransition;
  vars: CtrlVariable[];
  controller: ControllerAsset | null;
  onChange: (patch: Partial<SmTransition>, mergeKey?: string) => void;
  onDelete: () => void;
}) {
  const from = sm.states.find((s) => s.id === transition.from);
  const to = sm.states.find((s) => s.id === transition.to);
  const items = conditionList(transition.condition);

  /** 条件列表整体回写：0 条 = 无条件，1 条 = 单条，多条 = op:'and' 分组（且） */
  const setItems = (next: SmCondition[]) =>
    onChange({ condition: conditionFromList(next) }, `sm-cond:${transition.id}`);

  return (
    <>
      <div style={{ fontSize: 11.5, color: T.dim, marginBottom: 10, lineHeight: 1.7 }}>
        从 <b style={{ color: T.text }}>{from?.name ?? '?'}</b> 到 <b style={{ color: T.text }}>{to?.name ?? '?'}</b>
        <div style={{ fontSize: 10, color: T.dimmer, marginTop: 4 }}>{conditionText(transition.condition, vars)}</div>
        <div style={{ fontSize: 10, color: T.dimmer, marginTop: 3 }}>
          变量来源：
          <span style={{ color: controller ? T.dim : '#d98b7a' }}>{controller ? controller.name : '未绑定控制器'}</span>
        </div>
      </div>

      {items.length === 0 ? (
        <div
          style={{
            border: `1px dashed ${T.line}`,
            borderRadius: 5,
            padding: '10px 12px',
            fontSize: 11,
            color: T.dimmer,
            lineHeight: 1.7,
          }}
        >
          无条件：进入源状态后立刻切到目标状态。
          <button
            onClick={() => setItems([newVarCondition(vars[0]?.id ?? '')])}
            style={{ ...btnStyle, width: '100%', marginTop: 8 }}
          >
            ＋ 添加条件
          </button>
        </div>
      ) : (
        <>
          {items.map((c, i) => (
            <Fragment key={i}>
              {i > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0 6px' }}>
                  <div style={{ flex: 1, height: 1, background: T.lineSoft }} />
                  <span style={{ fontSize: 9.5, color: T.accent }}>且</span>
                  <div style={{ flex: 1, height: 1, background: T.lineSoft }} />
                </div>
              )}
              <ConditionRow
                cond={c}
                vars={vars}
                onChange={(next) => setItems(items.map((it, k) => (k === i ? next : it)))}
                onRemove={() => setItems(items.filter((_, k) => k !== i))}
              />
            </Fragment>
          ))}
          <button
            onClick={() => setItems([...items, newVarCondition(vars[0]?.id ?? '')])}
            style={{ ...btnStyle, width: '100%', marginTop: 6 }}
          >
            ＋ 添加条件（且）
          </button>
        </>
      )}

      {vars.length === 0 && (
        <div style={{ marginTop: 8, fontSize: 10, color: '#d98b7a', lineHeight: 1.7 }}>
          这个状态机还没有可用变量：先在「控制器」目录建一个控制器（或给角色绑一个），再回来加条件。
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 10, color: T.dimmer, lineHeight: 1.7 }}>
        多条条件是「且」的关系：全部成立才流转。每条条件 = 控制器变量 与 标准值 做 &gt; / = / &lt; 比较。
      </div>

      <button onClick={onDelete} style={{ ...btnStyle, width: '100%', marginTop: 12, color: '#d98b7a' }}>
        删除这条流转
      </button>
    </>
  );
}

/**
 * 一条条件：变量（来自控制器）→ 运算符（&gt; = &lt;）→ 标准值。
 * 老数据里的输入事件 / 数值 / 标志位条件只读展示，可以删掉。
 */
function ConditionRow({
  cond,
  vars,
  onChange,
  onRemove,
}: {
  cond: SmCondition;
  vars: CtrlVariable[];
  onChange: (next: SmCondition) => void;
  onRemove: () => void;
}) {
  const removeBtn = (
    <button
      onClick={onRemove}
      title="删除这条条件"
      style={{ ...btnStyle, padding: '1px 6px', fontSize: 10, color: T.dimmer, flexShrink: 0 }}
    >
      ✕
    </button>
  );
  const row: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    border: `1px solid ${T.lineSoft}`,
    borderRadius: 4,
    padding: '5px 6px',
    marginBottom: 6,
  };

  if (cond.kind !== 'var') {
    return (
      <div style={row} data-cond-row>
        <span
          style={{ flex: 1, fontSize: 10.5, color: T.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {conditionText(cond)}
        </span>
        <span style={{ fontSize: 9, color: T.dimmer, flexShrink: 0 }}>旧条件</span>
        {removeBtn}
      </div>
    );
  }

  const s = { ...inputStyle, padding: '2px 4px', fontSize: 10.5 } as CSSProperties;
  const unknown = !!cond.varId && !vars.some((v) => v.id === cond.varId);

  return (
    <div style={row} data-cond-row>
      <select
        value={cond.varId}
        onChange={(e) => onChange({ ...cond, varId: e.target.value })}
        style={{ ...s, flex: 1, minWidth: 0, color: cond.varId ? T.text : T.dimmer }}
        title="变量（来自控制器）"
      >
        <option value="">选变量</option>
        {vars.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
        {unknown && <option value={cond.varId}>（变量已删除）</option>}
      </select>

      <select
        value={cond.op}
        onChange={(e) => onChange({ ...cond, op: e.target.value as SmVarOp })}
        style={{ ...s, width: 42 }}
        title="逻辑判断"
      >
        {SM_VAR_OPS.map((o) => (
          <option key={o.key} value={o.key} title={o.hint}>
            {o.name}
          </option>
        ))}
      </select>

      <input
        type="number"
        value={cond.value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange({ ...cond, value: n });
        }}
        title="标准值"
        style={{ ...s, width: 58 }}
      />

      {removeBtn}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 概览                                                                */
/* ------------------------------------------------------------------ */

function OverviewPanel({
  sm,
  vars,
  controller,
}: {
  sm: { states: SmState[]; transitions: SmTransition[] };
  vars: CtrlVariable[];
  controller: ControllerAsset | null;
}) {
  return (
    <>
      <div style={sectionTitle}>流程图说明</div>
      <div style={{ fontSize: 11, color: T.dim, lineHeight: 1.9 }}>
        <div>· 方块 = 状态，一条状态就是「一段动画 + 原地/前进」；</div>
        <div>· 连线 = 流转，点连线在右侧写条件；</div>
        <div>· 从节点右侧圆点拖到另一个节点即可连线；</div>
        <div>· 选中节点/连线按 Delete 删除。</div>
      </div>

      <div style={{ ...sectionTitle, marginTop: 16 }}>可用变量</div>
      <div style={{ fontSize: 10.5, color: T.dimmer, lineHeight: 1.9 }}>
        <div>{controller ? `来自控制器「${controller.name}」` : '未绑定控制器（运行时用角色的第一个控制器）'}</div>
        <div style={{ color: vars.length ? T.dim : '#d98b7a' }}>
          {vars.length ? vars.map((v) => `${v.name} = ${v.init}`).join('、') : '（没有变量，去「控制器」目录加一个）'}
        </div>
      </div>

      <div style={{ ...sectionTitle, marginTop: 16 }}>当前规模</div>
      <div style={{ fontSize: 11, color: T.dim }}>
        {sm.states.length} 个状态 · {sm.transitions.length} 条流转
      </div>
      <div style={{ marginTop: 10, fontSize: 10, color: T.dimmer, lineHeight: 1.8 }}>
        后续加攻击 / 受击 / 技能：在流程图上加状态（绑动画片段）再加连线条件即可，数据结构不用动。
      </div>
    </>
  );
}

function Block({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10.5, color: T.dim, marginBottom: 3 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 9.5, color: T.dimmer, marginTop: 3, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}
