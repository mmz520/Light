/**
 * 控制器编辑器
 *
 * 左：变量表（名字 / 初始值 / 状态机引用次数）
 * 右：按键事件表（按键 → 触发方式 → 修饰键 → 变量 → 运算符 → 数值 → 上下限）
 *
 * 控制器不直接操作状态机：它只负责「按键改变量」，状态机读变量。
 * 这样加攻击 / 技能 / 菜单只要新建控制器即可。
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { editorStore, useEditor } from '../model/store';
import { bindingText } from '../model/types';
import {
  CONTROLLER_KEYS,
  CTRL_KEY_GROUPS,
  CTRL_OPS,
  CTRL_TRIGGERS,
  type ControllerAsset,
  type CtrlBinding,
  type CtrlOp,
  type CtrlTrigger,
} from '../model/types';
import { stateMachineVarRefs } from '../model/statemachine';
import { T, btnStyle, inputStyle, sectionTitle } from './theme';

const sel = { ...inputStyle, padding: '2px 4px', fontSize: 10.5 } as CSSProperties;
const num = { ...inputStyle, padding: '2px 4px', fontSize: 10.5, width: 62 } as CSSProperties;

export function ControllerWorkbench({ ctrlId }: { ctrlId: string }) {
  const { project } = useEditor();
  const ctrl = project?.controllers.find((c) => c.id === ctrlId) ?? null;
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  /** 变量被哪些状态机引用：删变量前提示用 */
  const usage = useMemo(() => {
    const map: Record<string, number> = {};
    if (!project || !ctrl) return map;
    for (const sm of project.stateMachines) {
      if (sm.controllerId !== ctrl.id) continue;
      for (const v of stateMachineVarRefs(sm)) map[v] = (map[v] ?? 0) + 1;
    }
    return map;
  }, [project, ctrl]);

  if (!project || !ctrl) {
    return <div style={{ padding: 20, color: T.dimmer, fontSize: 12 }}>控制器已被删除</div>;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.bg0, minHeight: 0 }}>
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
          value={nameDraft ?? ctrl.name}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            if (nameDraft && nameDraft.trim() && nameDraft !== ctrl.name) editorStore.renameAsset('controller', ctrl.id, nameDraft);
            setNameDraft(null);
          }}
          title="控制器名称"
          style={{ ...inputStyle, width: 170, padding: '3px 6px', fontSize: 11.5 }}
        />
        <span style={{ fontSize: 10, color: T.dimmer }}>
          {ctrl.vars.length} 个变量 · {ctrl.bindings.length} 条按键事件
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: T.dimmer }}>按键改变量，状态机读变量做判断</span>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 变量 */}
        <div style={{ width: 236, flexShrink: 0, borderRight: `1px solid ${T.line}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '8px 10px', borderBottom: `1px solid ${T.lineSoft}`, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ ...sectionTitle, margin: 0, flex: 1 }}>变量</span>
            <button
              data-add-var
              onClick={() => editorStore.addCtrlVariable(ctrl.id)}
              style={{ ...btnStyle, padding: '2px 7px', fontSize: 10.5 }}
            >
              ＋ 变量
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: '6px 8px 14px' }}>
            {ctrl.vars.map((v) => (
              <div
                key={v.id}
                data-ctrl-var
                style={{
                  border: `1px solid ${T.lineSoft}`,
                  borderRadius: 4,
                  padding: '5px 6px',
                  marginBottom: 6,
                  background: T.bg2,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    value={v.name}
                    onChange={(e) => editorStore.updateCtrlVariable(ctrl.id, v.id, { name: e.target.value }, `ctrlvarname:${v.id}`)}
                    title="变量名（状态机条件里显示它）"
                    style={{ ...sel, flex: 1, minWidth: 0 }}
                  />
                  <input
                    type="number"
                    value={v.init}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) editorStore.updateCtrlVariable(ctrl.id, v.id, { init: n }, `ctrlvarinit:${v.id}`);
                    }}
                    title="初始值"
                    style={{ ...num, width: 54 }}
                  />
                  <button
                    onClick={() => {
                      if (usage[v.id]) {
                        const ok = window.confirm(`变量「${v.name}」正被状态机的 ${usage[v.id]} 条条件引用，删除会一并清掉这些条件。继续？`);
                        if (!ok) return;
                      }
                      editorStore.removeCtrlVariable(ctrl.id, v.id);
                    }}
                    title="删除变量"
                    style={{ ...btnStyle, padding: '1px 5px', fontSize: 10, color: T.dimmer }}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ fontSize: 9.5, color: T.dimmer, marginTop: 3 }}>
                  {usage[v.id] ? `被 ${usage[v.id]} 条条件引用` : '未被状态机使用'}
                </div>
              </div>
            ))}
            {ctrl.vars.length === 0 && (
              <div style={{ fontSize: 10.5, color: T.dimmer, lineHeight: 1.8, padding: '6px 2px' }}>
                还没有变量。状态机的条件要比较变量，先加一个（比如 moving）。
              </div>
            )}
          </div>
        </div>

        {/* 按键事件 */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${T.lineSoft}`, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ ...sectionTitle, margin: 0, flex: 1 }}>按键事件</span>
            <button
              data-add-binding
              disabled={ctrl.vars.length === 0}
              onClick={() => editorStore.addCtrlBinding(ctrl.id)}
              style={{ ...btnStyle, padding: '2px 8px', fontSize: 10.5, opacity: ctrl.vars.length === 0 ? 0.5 : 1 }}
            >
              ＋ 按键事件
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: '8px 12px 18px' }}>
            {ctrl.bindings.length === 0 && (
              <div style={{ fontSize: 10.5, color: T.dimmer, lineHeight: 1.8 }}>
                还没有按键事件。加一条：选按键 → 选触发方式 → 选变量 → 设运算符与数值。
              </div>
            )}
            {ctrl.bindings.map((b) => (
              <BindingRow key={b.id} ctrl={ctrl} binding={b} />
            ))}
            {ctrl.bindings.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 10, color: T.dimmer, lineHeight: 1.8 }}>
                运算在变量原值上做：原值 0、运算符 +、数字 1 → 变量变成 1；运算符 = 时直接赋成这个数字。
                最大值 / 最小值留空表示不限制；填了就在边界上截断（比如 moving 下限 0，松开一个键不会变负数）。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BindingRow({ ctrl, binding }: { ctrl: ControllerAsset; binding: CtrlBinding }) {
  const patch = (p: Partial<CtrlBinding>, key?: string) => editorStore.updateCtrlBinding(ctrl.id, binding.id, p, key);
  const numOrNull = (raw: string): number | null => {
    if (raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  return (
    <div
      data-ctrl-binding
      style={{
        border: `1px solid ${T.lineSoft}`,
        borderRadius: 4,
        padding: '6px 8px',
        marginBottom: 6,
        background: T.bg2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
        {/* 按键 */}
        <select value={binding.key} onChange={(e) => patch({ key: e.target.value })} style={{ ...sel, width: 132 }} title="按键 / 鼠标键">
          {CTRL_KEY_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {CONTROLLER_KEYS.filter((k) => k.group === group).map((k) => (
                <option key={k.key} value={k.key}>
                  {k.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {/* 触发方式 */}
        <select
          value={binding.trigger}
          onChange={(e) => patch({ trigger: e.target.value as CtrlTrigger })}
          style={{ ...sel, width: 66 }}
          title="触发方式"
        >
          {CTRL_TRIGGERS.map((t) => (
            <option key={t.key} value={t.key} title={t.hint}>
              {t.name}
            </option>
          ))}
        </select>

        {/* 修饰键 */}
        {(
          [
            { key: 'ctrl' as const, name: 'Ctrl' },
            { key: 'shift' as const, name: 'Shift' },
            { key: 'alt' as const, name: 'Alt' },
          ]
        ).map((m) => (
          <label
            key={m.key}
            title={`要求同时按住 ${m.name}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 10,
              color: binding[m.key] ? T.accent : T.dimmer,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={binding[m.key]}
              onChange={(e) => patch({ [m.key]: e.target.checked } as Partial<CtrlBinding>)}
              style={{ accentColor: T.accent, margin: 0 }}
            />
            {m.name}+
          </label>
        ))}

        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 9.5, color: T.dimmer, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {bindingText(binding, ctrl.vars)}
        </span>
        <button
          onClick={() => editorStore.removeCtrlBinding(ctrl.id, binding.id)}
          title="删除这条事件"
          style={{ ...btnStyle, padding: '1px 6px', fontSize: 10, color: T.dimmer, flexShrink: 0 }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        {/* 变量 */}
        <select
          value={binding.variableId}
          onChange={(e) => patch({ variableId: e.target.value })}
          style={{ ...sel, width: 108, color: binding.variableId ? T.text : T.dimmer }}
          title="要修改的变量"
        >
          <option value="">选变量</option>
          {ctrl.vars.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>

        {/* 运算符 */}
        <select
          value={binding.op}
          onChange={(e) => patch({ op: e.target.value as CtrlOp })}
          style={{ ...sel, width: 52 }}
          title="运算符"
        >
          {CTRL_OPS.map((op) => (
            <option key={op.key} value={op.key} title={op.hint}>
              {op.name}
            </option>
          ))}
        </select>

        <input
          type="number"
          value={binding.value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) patch({ value: n }, `ctrlbindval:${binding.id}`);
          }}
          title="运算数"
          style={num}
        />

        <span style={{ fontSize: 10, color: T.dimmer }}>最小</span>
        <input
          type="number"
          value={binding.min ?? ''}
          placeholder="不限"
          onChange={(e) => patch({ min: numOrNull(e.target.value) }, `ctrlbindmin:${binding.id}`)}
          title="最小值（留空不限制，运算到边界就停在边界）"
          style={{ ...num, width: 58 }}
        />
        <span style={{ fontSize: 10, color: T.dimmer }}>最大</span>
        <input
          type="number"
          value={binding.max ?? ''}
          placeholder="不限"
          onChange={(e) => patch({ max: numOrNull(e.target.value) }, `ctrlbindmax:${binding.id}`)}
          title="最大值（留空不限制）"
          style={{ ...num, width: 58 }}
        />
      </div>
    </div>
  );
}

/** 供其它面板显示「这条状态机用哪个控制器」 */
export function controllerLabel(ctrl: ControllerAsset | null | undefined): string {
  if (!ctrl) return '未绑定控制器';
  return `${ctrl.name} · ${ctrl.vars.length} 变量`;
}
