/**
 * 场景里的角色精灵（纸片人）
 *
 * 角色本体是 2D 分层部件，不是三维模型：
 *   - 整棵部件树挂在 HTML 层，天然永远正对摄像机（billboard），不会被 3D 相机"侧着看"；
 *   - 根元素由 SceneView 每帧摆到角色的地面投影点上，脚底贴地；
 *   - 整棵树只做 **一次统一缩放**：局部坐标用"画布像素"（512 画布 = 2 世界单位），
 *     缩放系数 = 每世界单位的屏幕像素 / 256。这样任何一个部件都不会单独算错比例。
 *
 * 局部尺寸一旦固定，跟相机距离无关，只有 k 随相机变 —— 这是纸片人不"消失"的关键。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PartDef } from '../../animator/types';
import { animationParts } from '../model/resolve';
import type { ProjectDoc } from '../model/types';
import type { SceneRuntime } from '../../runtime/sceneRuntime';

/** 动画画布：512 像素 = 2 世界单位（与 templates.ts 的 CANVAS_WORLD / PART_GRID 一致） */
const LOCAL_PER_UNIT = 256;

export function CharacterSprite({ project, runtime }: { project: ProjectDoc; runtime: SceneRuntime }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const partRefs = useRef(new Map<string, HTMLDivElement>());
  const imgRefs = useRef(new Map<string, HTMLImageElement>());
  /** 状态切换可能换到另一条动画资产，这时要重建部件 */
  const [animKey, setAnimKey] = useState(() => runtime.anim()?.id ?? '');

  const parts = useMemo(() => {
    const a = runtime.anim();
    return a ? animationParts(project, a, 'S') : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, animKey]);

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, PartDef[]>();
    for (const p of parts) {
      const key = p.parent && parts.some((x) => x.id === p.parent) ? p.parent : null;
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return map;
  }, [parts]);

  /** 角色总高（世界单位）：沿父链累加静态偏移，取最高的顶边 */
  const charHeight = useMemo(() => {
    const byId = new Map(parts.map((p) => [p.id, p]));
    let top = 0;
    for (const p of parts) {
      let y = 0;
      let cur: PartDef | undefined = p;
      let guard = 0;
      while (cur && guard++ < 40) {
        y += cur.layout?.y ?? 0;
        cur = cur.parent ? byId.get(cur.parent) : undefined;
      }
      top = Math.max(top, y + (p.layout?.h ?? 0));
    }
    // 兜底：模板里脚底线在 512 画布的第 412 行 → 约 1.6 世界单位
    return top > 0.4 ? top : 1.6;
  }, [parts]);

  /** 有没有真正画得出来的贴图；部件全是空槽时给个占位块，免得"什么都没有" */
  const blank = parts.length > 0 && parts.every((p) => !p.texturePath && !p.color);

  useEffect(() => {
    runtime.charHeight = charHeight;
  }, [charHeight, runtime]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      // 动画资产换了就重建部件
      const id = runtime.anim()?.id ?? '';
      if (id !== animKey) setAnimKey(id);

      // 统一缩放：横向 1 世界单位 = pxPerUnit 像素；纵向还要按俯角压缩（纸片人是竖直平面）
      const sx = Math.max(1, runtime.pxPerUnit || 52) / LOCAL_PER_UNIT;
      const sy = Math.max(1, runtime.pxPerUnitY || 52) / LOCAL_PER_UNIT;
      const root = rootRef.current;
      if (root) {
        root.style.transform = `scale(${sx}, ${sy})`;
        root.style.opacity = runtime.pxPerUnit > 0 ? '1' : '0';
      }

      for (const p of parts) {
        const el = partRefs.current.get(p.id);
        if (el) {
          const lay = p.layout ?? { x: 0, y: 0, h: 1 };
          const pose = runtime.poses[p.id] ?? p.defaultPose;
          const x = lay.x + (pose.x ?? 0);
          const y = lay.y + (pose.y ?? 0);
          const scale = pose.scale ?? 1;
          el.style.transform = `translate(${x * LOCAL_PER_UNIT}px, ${-y * LOCAL_PER_UNIT}px) rotate(${pose.rot ?? 0}deg) scale(${scale})`;
          el.style.opacity = runtime.visibility[p.id] === false ? '0' : '1';
        }
        const img = imgRefs.current.get(p.id);
        if (img) img.style.height = `${Math.max(2, (p.layout?.h ?? 0.2) * LOCAL_PER_UNIT)}px`;
      }

      // 朝向：整棵树水平翻转（绕脚底锚点）
      const inner = innerRef.current;
      if (inner) inner.style.transform = `scaleX(${runtime.state.face})`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [parts, runtime, animKey]);

  /**
   * 部件的局部坐标系与动画编辑器（Viewport3D）完全一致：
   *   - layout.x/y 是"中心到父中心"的偏移 → 部件 div 的原点就是部件中心，旋转绕中心；
   *   - 贴图以中心对齐挂在原点上（-50%, -50%），宽度按贴图真实比例，mirror 时水平翻转；
   *   - 覆盖物是"以偏移点为中心"的一块方形（边长 = 部件高 × scale，贴图拉伸填满）。
   * pivot 字段只用于烘焙序列帧（SpriteManifest），预览与运行时都不参与定位。
   */
  const renderPart = (p: PartDef) => {
    const lay = p.layout ?? { x: 0, y: 0, h: 1 };
    const h = Math.max(2, (lay.h || 0.2) * LOCAL_PER_UNIT);
    const flip = p.mirror ? -1 : 1;
    const ov = p.overlay;
    return (
      <div
        key={p.id}
        ref={(el) => {
          if (el) partRefs.current.set(p.id, el);
          else partRefs.current.delete(p.id);
        }}
        data-char-part
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          transformOrigin: '0 0',
          zIndex: p.zIndex,
          willChange: 'transform',
        }}
      >
        {p.texturePath ? (
          <img
            ref={(el) => {
              if (el) imgRefs.current.set(p.id, el);
              else imgRefs.current.delete(p.id);
            }}
            src={p.texturePath}
            alt=""
            draggable={false}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transform: 'translate(-50%, -50%) scaleX(' + flip + ')',
              height: h,
              width: 'auto',
              maxWidth: 'none',
              imageRendering: 'pixelated',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        ) : p.color ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transform: `translate(-50%, -50%) scaleX(${flip})`,
              width: h * 0.42,
              height: h,
              background: p.color,
              borderRadius: 3,
              opacity: 0.9,
            }}
          />
        ) : null}

        {ov?.texturePath && (
          <img
            src={ov.texturePath}
            alt=""
            draggable={false}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: h * ov.scale,
              height: h * ov.scale,
              objectFit: 'fill',
              transform: `translate(calc(-50% + ${ov.offsetX * LOCAL_PER_UNIT}px), calc(-50% + ${-ov.offsetY * LOCAL_PER_UNIT}px)) rotate(${ov.rot}deg)`,
              zIndex: ov.zIndex ?? 1,
              pointerEvents: 'none',
              imageRendering: 'pixelated',
            }}
          />
        )}

        {(childrenOf.get(p.id) ?? []).map(renderPart)}
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      data-char-sprite
      data-char-sprite-height={charHeight.toFixed(3)}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        transformOrigin: '0 0',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      {/* 脚下的落影：让角色看起来确实站在地面上（随角色一起缩放） */}
      <div
        data-char-shadow
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transform: 'translate(-50%, -50%)',
          width: 44,
          height: 16,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,.55), rgba(0,0,0,0) 70%)',
        }}
      />

      <div ref={innerRef} style={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0' }}>
        {blank ? (
          // 动画部件还没贴图：画个纸片人占位，至少能看见角色在哪、多大
          <div data-char-placeholder style={{ position: 'absolute', left: 0, top: 0 }}>
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                transform: 'translate(-50%, -100%)',
                width: 72,
                height: 132,
                borderRadius: '34px 34px 12px 12px',
                background: 'linear-gradient(180deg, #c9a06a, #8a6a44)',
                opacity: 0.75,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: -132,
                transform: 'translate(-50%, -100%)',
                width: 62,
                height: 62,
                borderRadius: '50%',
                background: '#e0c39a',
                opacity: 0.85,
              }}
            />
          </div>
        ) : (
          (childrenOf.get(null) ?? []).map(renderPart)
        )}
      </div>
    </div>
  );
}
