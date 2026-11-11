/**
 * 地面（地皮）生成参数面板
 *
 * 点场景里的某一块地面 → 右侧属性栏显示它自己的面板。
 * 每块地面各有一套参数和一张已生成的地图，互不影响。
 * 参数改动只写进这块地面的配置，不会实时重算；
 * 要看到新地图必须点"重新生成地图"。
 */
import type { ReactNode } from 'react';

import {
  GROUND_MAX,
  GROUND_MIN,
  GROUND_TYPES,
  MAX_GROUND_EDGES,
  defaultGroundConfig,
  groundEdgeKey,
  ratioPercents,
  groundTiles,
  tileCounts,
  type GroundEdge,
  type GroundTypeId,
} from '../model/ground';
import { editorStore, useEditor } from '../model/store';
import { type ProjectDoc, type SceneNode } from '../model/types';
import { TexSlot } from './AssetPicker';
import { T, btnStyle, inputStyle } from './theme';

const rowStyle = { borderBottom: `1px solid ${T.lineSoft}`, padding: '7px 0' } as const;

function MiniLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 10, letterSpacing: '.06em', color: T.dimmer, textTransform: 'uppercase', marginBottom: 4 }}>{children}</div>;
}

export function GroundPanel({ project: fallbackProject, node }: { project: ProjectDoc; node: SceneNode }) {
  const state = useEditor();
  const project = state.project ?? fallbackProject;
  // 拿工程里的最新节点，避免用渲染时捕获的旧对象
  const live = project.scene.find((n) => n.id === node.id) ?? node;
  const cfg = live.ground ?? defaultGroundConfig();
  const nodeId = live.id;
  const percents = ratioPercents(cfg);
  const map = groundTiles(cfg);
  const counts = map ? tileCounts(map.tiles) : null;
  const totalRatio = GROUND_TYPES.reduce((s, t) => s + Math.max(0, cfg.types[t.id]?.ratio ?? 0), 0);
  const activeTypes = GROUND_TYPES.filter((t) => cfg.types[t.id].ratio > 0);
  const missing = activeTypes.filter((t) => !cfg.types[t.id].textureId && !cfg.types[t.id].color);
  const missingImage = activeTypes.filter((t) => {
    const id = cfg.types[t.id].textureId;
    if (!id) return false;
    // 贴图槽引用的是「贴图」目录的图片资产；老数据可能还是图组 id，能解析到图就算配好
    return !project.images.some((x) => x.id === id) && !project.textures.some((x) => x.id === id);
  });

  const setRatio = (id: GroundTypeId, value: number) => {
    editorStore.setGroundType(nodeId, id, { ratio: Math.max(0, Math.min(400, Math.round(value))) }, `ground-ratio:${nodeId}:${id}`);
  };

  /* ---------- 边界中间贴图 ---------- */

  /** 找一组还没配过的地皮组合（优先当前有占比的类型） */
  const nextEdgePair = (): [GroundTypeId, GroundTypeId] | null => {
    const active = GROUND_TYPES.filter((t) => cfg.types[t.id].ratio > 0).map((t) => t.id);
    const pool = active.length >= 2 ? active : GROUND_TYPES.map((t) => t.id);
    const used = new Set(cfg.edges.map((e) => groundEdgeKey(e.a, e.b)));
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        if (!used.has(groundEdgeKey(pool[i], pool[j]))) return [pool[i], pool[j]];
      }
    }
    return null;
  };

  /** 改一侧的地皮：撞上自己就与另一侧互换；撞上已有组合就忽略 */
  const changeEdgeType = (edge: GroundEdge, side: 'a' | 'b', value: GroundTypeId) => {
    let a = side === 'a' ? value : edge.a;
    let b = side === 'b' ? value : edge.b;
    if (a === b) {
      if (side === 'a') b = edge.a;
      else a = edge.b;
    }
    const key = groundEdgeKey(a, b);
    if (cfg.edges.some((x) => x.id !== edge.id && groundEdgeKey(x.a, x.b) === key)) return;
    editorStore.setGroundEdge(nodeId, edge.id, { a, b });
  };

  const freePair = nextEdgePair();

  return (
    <div data-ground-panel="" style={{ padding: '0 10px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 0 4px' }}>
        <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: T.dimmer }}>地皮生成</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: map ? T.ok : T.dimmer }}>
          {map ? `已生成 ${cfg.w}×${cfg.h}` : '尚未生成'}
        </span>
      </div>

      <div style={{ fontSize: 10.5, color: T.dimmer, lineHeight: 1.7, marginBottom: 8 }}>
        参数修改不会实时生效 —— 点下面的「重新生成地图」才会重算。
        {cfg.w * cfg.h > 1000000 && (
          <span style={{ color: '#c9a35c' }}>
            {`当前 ${cfg.w}×${cfg.h} 约 ${Math.round((cfg.w * cfg.h) / 10000) / 100}M 格，生成可能要等几十秒，存档也会变大。`}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <MiniLabel>种子</MiniLabel>
          <input
            type="number"
            value={cfg.seed}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) editorStore.setGround(nodeId, { seed: Math.round(v) }, `ground-seed:${nodeId}`);
            }}
            style={inputStyle}
          />
        </div>
        <div style={{ width: 42 + 42 + 14 }}>
          <MiniLabel>尺寸</MiniLabel>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="number"
              min={GROUND_MIN}
              max={GROUND_MAX}
              value={cfg.w}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) editorStore.setGround(nodeId, { w: Math.min(GROUND_MAX, Math.max(GROUND_MIN, Math.round(v))) }, `ground-size:${nodeId}`);
              }}
              style={{ ...inputStyle, padding: '3px 4px', textAlign: 'center' }}
            />
            <span style={{ fontSize: 10, color: T.dimmer }}>×</span>
            <input
              type="number"
              min={GROUND_MIN}
              max={GROUND_MAX}
              value={cfg.h}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) editorStore.setGround(nodeId, { h: Math.min(GROUND_MAX, Math.max(GROUND_MIN, Math.round(v))) }, `ground-size:${nodeId}`);
              }}
              style={{ ...inputStyle, padding: '3px 4px', textAlign: 'center' }}
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <button
          onClick={() => editorStore.setGround(nodeId, { seed: Math.floor(Math.random() * 99999999) })}
          style={{ ...btnStyle, padding: '3px 8px', fontSize: 11, flex: 1 }}
        >
          随机种子
        </button>
        <button
          onClick={() => {
            const preset: Record<GroundTypeId, number> = { grass: 34, forest: 20, desert: 12, gobi: 10, snow: 8, swamp: 8, water: 12 };
            const types = { ...cfg.types };
            for (const t of GROUND_TYPES) types[t.id] = { ...types[t.id], ratio: preset[t.id] };
            editorStore.setGround(nodeId, { w: 48, h: 48, cell: 1, types });
          }}
          style={{ ...btnStyle, padding: '3px 8px', fontSize: 11, flex: 1 }}
        >
          重置参数
        </button>
      </div>

      <div style={{ marginTop: 10, fontSize: 10.5, color: T.dim, display: 'flex', justifyContent: 'space-between' }}>
        <span>类型占比（权重合计 {totalRatio}）</span>
        <span style={{ color: T.dimmer }}>归一化后生效</span>
      </div>

      {GROUND_TYPES.map((t) => {
        const s = cfg.types[t.id];
        const pct = percents[t.id] * 100;
        const got = counts ? (counts[t.id] / Math.max(1, map ? map.tiles.length : 1)) * 100 : null;
        return (
          <div key={t.id} style={{ ...rowStyle, opacity: s.ratio > 0 ? 1 : 0.55 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: t.color, border: `1px solid rgba(0,0,0,.4)`, flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, color: T.text, flex: 1 }}>{t.name}</span>
              <span style={{ fontSize: 10, color: T.dimmer, minWidth: 58, textAlign: 'right' }}>
                归一 {pct.toFixed(1)}%
                {got !== null ? ` · 实 ${got.toFixed(0)}%` : ''}
              </span>
              <input
                type="number"
                min={0}
                max={400}
                value={s.ratio}
                onChange={(e) => setRatio(t.id, Number(e.target.value))}
                style={{ ...inputStyle, width: 52, padding: '2px 4px', textAlign: 'center' }}
                title="占比权重，可以合计超过 100（生成时归一化）"
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.min(100, s.ratio)}
                onChange={(e) => setRatio(t.id, Number(e.target.value))}
                style={{ flex: 1, accentColor: T.accent, height: 14 }}
              />
            </div>

            <div style={{ marginTop: 6 }}>
              <TexSlot
                project={project}
                loopable
                thumbSize={34}
                value={{ id: s.textureId, color: s.color ?? null, loop: s.loop ?? true }}
                onChange={(v) =>
                  editorStore.setGroundType(nodeId, t.id, { textureId: v.id, color: v.color ?? null, loop: v.loop ?? true }, `ground-tex:${nodeId}:${t.id}`)
                }
              />
            </div>
          </div>
        );
      })}

      {missing.length > 0 && (
        <div style={{ fontSize: 10, color: T.dimmer, marginTop: 8, lineHeight: 1.7 }}>
          {missing.length} 种地皮还没选贴图，会先用类型配色 + 程序纹理。贴图在底部「贴图」目录里导入。
          {missingImage.length > 0 && <span style={{ color: T.danger }}> 其中 {missingImage.length} 个贴图还没配图片。</span>}
        </div>
      )}

      {/* 边界中间贴图：两种地皮之间单独指定一条手绘边 */}
      <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${T.lineSoft}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: T.dimmer, flex: 1 }}>
            边界中间贴图
          </span>
          <span style={{ fontSize: 10, color: T.dimmer }}>
            {cfg.edges.length}/{MAX_GROUND_EDGES}
          </span>
          <button
            data-ground-edge-add
            onClick={() => {
              if (freePair) editorStore.addGroundEdge(nodeId, freePair[0], freePair[1]);
            }}
            disabled={!freePair}
            title={freePair ? '新增一条边界贴图' : '没有可新增的组合了'}
            style={{ ...btnStyle, padding: '2px 8px', fontSize: 11, opacity: freePair ? 1 : 0.4 }}
          >
            新增
          </button>
        </div>
        <div style={{ fontSize: 10, color: T.dimmer, lineHeight: 1.7, margin: '5px 0 7px' }}>
          给指定两种地皮一条手绘边（贴图的 alpha 决定边多宽多碎）。没配的组合继续按算法混合邻格贴图。
        </div>

        {cfg.edges.map((e) => (
          <div
            key={e.id}
            data-ground-edge
            style={{ border: `1px solid ${T.lineSoft}`, borderRadius: 4, padding: 6, marginBottom: 6, background: T.bg2 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <select
                value={e.a}
                onChange={(ev) => changeEdgeType(e, 'a', ev.target.value as GroundTypeId)}
                title="这一侧的地皮"
                style={{ ...inputStyle, flex: 1, minWidth: 0, padding: '2px 4px', fontSize: 11 }}
              >
                {GROUND_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <span style={{ fontSize: 10, color: T.dimmer, flexShrink: 0 }}>↔</span>
              <select
                value={e.b}
                onChange={(ev) => changeEdgeType(e, 'b', ev.target.value as GroundTypeId)}
                title="另一侧的地皮"
                style={{ ...inputStyle, flex: 1, minWidth: 0, padding: '2px 4px', fontSize: 11 }}
              >
                {GROUND_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                data-ground-edge-del
                onClick={() => editorStore.removeGroundEdge(nodeId, e.id)}
                title="删除这一组"
                style={{ ...btnStyle, padding: '2px 6px', fontSize: 11, color: T.dimmer, flexShrink: 0 }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginTop: 5 }}>
              <TexSlot
                project={project}
                loopable
                thumbSize={30}
                label="未设置 · 走算法过渡"
                hint="沿这两种地皮的交界铺开的贴图"
                value={{ id: e.textureId, color: e.color ?? null, loop: e.loop ?? true }}
                onChange={(v) => editorStore.setGroundEdge(nodeId, e.id, { textureId: v.id, color: v.color ?? null, loop: v.loop ?? true })}
              />
            </div>
          </div>
        ))}

        {cfg.edges.length === 0 && (
          <div style={{ fontSize: 10, color: T.dimmer, lineHeight: 1.7 }}>
            还没配 —— 所有交界都按算法过渡（邻格贴图按权重混合）。
          </div>
        )}
      </div>

      <button
        onClick={() => editorStore.regenerateGround(nodeId)}
        style={{
          ...btnStyle,
          width: '100%',
          marginTop: 12,
          background: T.accent,
          color: '#1a1410',
          border: 'none',
          fontWeight: 700,
        }}
      >
        重新生成地图
      </button>

      <div style={{ fontSize: 10, color: T.dimmer, marginTop: 6, lineHeight: 1.8 }}>
        生成顺序和饥荒一致：按占比分地盘 → 噪声代价场生长出有机轮廓 → 高优先级地皮吃边并磨圆尖角 → 最后才铺贴图。
        {map && (
          <>
            <br />
            当前 {cfg.w}×{cfg.h} 格，每格 {cfg.cell} 场景单位。
          </>
        )}
      </div>
    </div>
  );
}

