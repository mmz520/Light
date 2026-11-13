/**
 * 中间场景视图 —— 当前游戏世界里有什么
 *
 * three.js 只负责地面 / 网格 / 机位；场景对象用 HTML 标记浮在上面（按相机投影定位），
 * 这样图标、名字和界面风格一致，拖拽也不用做三维拾取。
 *
 * 右键：新增对象 / 粘贴；拖标记：改位置；左键拖空白：转视角。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GROUND_TYPES, groundTiles } from '../model/ground';
import { editorStore, useEditor } from '../model/store';
import { MAPUI_RANGE_STEPS, sceneKindMeta, SCENE_KINDS, type ProjectDoc, type SceneKind, type SceneNode } from '../model/types';
import { mapuiDecorUrl } from '../model/resolve';
import { SceneRuntime } from '../../runtime/sceneRuntime';
import { ScriptVM } from '../../runtime/scripts';
import { anchorPositionOf, attachViewportScene, setCameraRig } from '../model/componentHost';
import { ComponentRuntime } from '../model/componentRuntime';
import type { CameraRig } from '../../runtime/component';
import { CharacterSprite } from './CharacterSprite';
import { PromptDialog } from './Dialogs';
import { MinimapCanvas } from './MinimapCanvas';
import { buildGroundLayer, type GroundLayer } from './groundMesh';
import { ContextMenu, type MenuItem } from './Menu';
import { SceneIcon } from './SceneIcons';
import { T, btnStyle } from './theme';

interface Props {
  project: ProjectDoc;
  selectedId: string | null;
  onRenameScene: (node: SceneNode) => void;
}

/** 资源浏览器拖脚本时带上的类型标记（dragover 阶段只能读 types） */
const SCRIPT_DRAG_TYPE = 'application/x-light-asset-script';

/** 从拖拽数据里挑出脚本 id（"script:id,script:id2"） */
function scriptIdsFromDrop(e: React.DragEvent): string[] {
  return (e.dataTransfer.getData('text/plain') || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('script:'))
    .map((s) => s.slice('script:'.length))
    .filter(Boolean);
}

export function SceneView({ project, selectedId, onRenameScene }: Props) {
  const { sceneClipboard } = useEditor();
  const hostRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const tokens = useRef(new Map<string, HTMLDivElement>());
  const nodesRef = useRef<SceneNode[]>(project.scene);
  nodesRef.current = project.scene;

  const resetRef = useRef<() => void>(() => undefined);
  const pickRef = useRef<((cx: number, cy: number) => { x: number; z: number } | null) | null>(null);
  const [playing, setPlaying] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [adding, setAdding] = useState<SceneKind | null>(null);
  const [showGrid, setShowGrid] = useState<boolean | null>(null);
  /** 正被脚本拖拽悬停的对象（视口里的标记） */
  const [scriptHotNode, setScriptHotNode] = useState<string | null>(null);
  /** 运行时的状态摘要（每 150ms 采一次，用来显示「行走 · x,z」） */
  const [hud, setHud] = useState<{ state: string; x: number; z: number; scriptLog: string | null; pitchDeg: number; claimed: boolean } | null>(null);

  const playingRef = useRef(false);
  playingRef.current = playing;
  const charWrapRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  /** 播放态的组件脚本运行时（onStart / onUpdate / onEvent） */
  const componentRuntimeRef = useRef<ComponentRuntime | null>(null);
  if (!componentRuntimeRef.current) componentRuntimeRef.current = new ComponentRuntime();

  /** 角色运行时：编辑态也建一个（静态站在节点位置），播放时才逐帧推进 */
  const runtime = useMemo(() => {
    const node = project.scene.find((n) => n.kind === 'character') ?? null;
    return node ? new SceneRuntime(project, node) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);
  runtimeRef.current = runtime;

  /**
   * 播放中的实时位置（小地图标记用）：
   * 角色走的是运行时状态（位置不写回工程），其它对象取三维锚点的实际位置（脚本可能挪过它）。
   * 编辑态返回 null → 小地图用节点上的静态 x/z。
   */
  const liveNodePos = (nodeId: string): { x: number; z: number } | null => {
    if (!playingRef.current) return null;
    const rt = runtimeRef.current;
    if (rt && rt.state.nodeId === nodeId) return { x: rt.state.x, z: rt.state.z };
    return anchorPositionOf(nodeId);
  };

  /* 脚本 VM：随工程创建（异步加载 wasm），随工程切换销毁 */
  useEffect(() => {
    if (!runtime) return;
    let vm: ScriptVM | null = null;
    let cancelled = false;
    void ScriptVM.create()
      .then((created) => {
        if (cancelled) {
          created.destroy();
          return;
        }
        vm = created;
        runtime.attachScripts(created);
        // VM 是异步 attach 的：若播放已经先开始（startScripts 落空），这里补跑 onStart
        if (playingRef.current) created.start();
      })
      .catch((e) => console.error('[脚本] VM 创建失败', e));
    return () => {
      cancelled = true;
      vm?.destroy();
      runtime.disposeScripts();
    };
  }, [runtime]);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const groundLayers = useRef<Map<string, GroundLayer>>(new Map());
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const lastMapSig = useRef('');
  const projectRef = useRef(project);
  projectRef.current = project;

  const groundNodes = project.scene.filter((n) => n.kind === 'ground');
  /** 小地图跟随的中心：场景里的第一个角色（播放中用运行时实时位置） */
  const followCharNode = project.scene.find((n) => n.kind === 'character') ?? null;
  const mappedGrounds = groundNodes.filter((n) => n.ground && groundTiles(n.ground));
  const hasMap = mappedGrounds.length > 0;
  const gridOn = showGrid ?? !hasMap;

  /** 只反映"地图内容"的签名：变了才重建几何（拖位置不重建）。
   *  除了尺寸，还要带上每类贴图与边界贴图 —— 换贴图也得重挂材质。
   *  注意：不能含 seed（点"随机种子"只改参数，地面不该有变化），
   *  也不能用 map.length（重新生成后长度通常不变，会导致 3D 地面不刷新）—— 用 gen 代数。 */
  const groundSig = groundNodes
    .map((n) => {
      const c = n.ground;
      if (!c) return n.id;
      // 贴图的平铺拉伸策略（tiling / nine）也参与签名：改策略要触发地面重建
      const tileKey = (textureId: string | null | undefined) => {
        if (!textureId) return '';
        const img = project.images.find((i) => i.id === textureId);
        const nine = img?.nine;
        return `${img?.tiling ?? 'default'}~${nine ? `${nine.l},${nine.t},${nine.r},${nine.b}` : ''}`;
      };
      const types = GROUND_TYPES.map((t) => `${c.types[t.id]?.textureId ?? ''}~${c.types[t.id]?.color ?? ''}~${c.types[t.id]?.loop ?? true}~${tileKey(c.types[t.id]?.textureId)}`).join(',');
      const edges = (c.edges ?? []).map((e) => `${e.a}>${e.b}:${e.textureId ?? ''}:${e.loop ?? true}:${tileKey(e.textureId)}`).join(',');
      return `${n.id}:${c.cell}:${c.w}x${c.h}:g${c.gen ?? 0}:${types}:${edges}`;
    })
    .join('|');
  /** 只反映位置：变了只挪 group，不重新拼几何 */
  const groundPosSig = groundNodes.map((n) => `${n.id}:${n.x},${n.z}`).join('|');
  /** 只反映"生成结果"的签名：变了才把视角拉回全景 */
  const mappedSig = mappedGrounds.map((n) => `${n.id}:${n.ground!.w}x${n.ground!.h}:g${n.ground!.gen ?? 0}`).join('|');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth || 1, host.clientHeight || 1);
    renderer.setClearColor(0x100d0a, 1);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    // 组件脚本可以通过 this.scene / this.three 直接操作这个场景
    attachViewportScene(scene);
    scene.fog = new THREE.Fog(0x100d0a, 42, 150);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshBasicMaterial({ color: 0x14100d }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.012;
    scene.add(ground);

    const grid = new THREE.GridHelper(48, 48, 0x6a5233, 0x2b241d);
    const gm = grid.material as THREE.LineBasicMaterial;
    gm.transparent = true;
    gm.opacity = 0.85;
    gridRef.current = grid;
    scene.add(grid);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.58, 0.7, 56),
      new THREE.MeshBasicMaterial({ color: 0x8a5f2b, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);

    const view = { dist: 17, yaw: Math.PI / 4, pitch: 0.62 };
    const target = new THREE.Vector3(0, 0.5, 0);

    /**
     * 运行时相机：摄像机组件（系统脚本）通过 this.camera 读写它，
     * 渲染循环每帧把 pose 套到视口相机上。没组件接管就走内置默认。
     */
    const rig: CameraRig = {
      pose: { x: target.x, y: target.y, z: target.z, pitch: Math.PI / 4, yaw: 0, distance: view.dist },
      follow: { x: 0, y: 0.5, z: 0, height: 1.8 },
      autoDistance: view.dist,
      claimedBy: null,
    };
    setCameraRig(rig);
    // 调试 / 自检句柄：读当前相机位姿与接管状态
    (window as unknown as { __camera?: CameraRig }).__camera = rig;

    const apply = () => {
      const { dist, yaw, pitch } = view;
      camera.position.set(
        target.x + dist * Math.cos(pitch) * Math.sin(yaw),
        target.y + dist * Math.sin(pitch),
        target.z + dist * Math.cos(pitch) * Math.cos(yaw),
      );
      camera.lookAt(target);
    };

    const reset = () => {
      // 视野按所有地面的包围范围算（多块地面分散摆放时也能一次看全）
      let half = 24;
      for (const n of nodesRef.current) {
        if (n.kind !== 'ground' || !n.ground) continue;
        const cell = n.ground.cell || 1;
        half = Math.max(half, Math.abs(n.x) + (n.ground.w * cell) / 2, Math.abs(n.z) + (n.ground.h * cell) / 2);
      }
      view.dist = Math.min(160, Math.max(14, half * 2 * 0.95));
      view.yaw = Math.PI / 4;
      view.pitch = 0.62;
      apply();
    };
    resetRef.current = reset;

    // 屏幕坐标 → 地面（y=0）交点：拖标记、算落点都用它
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    pickRef.current = (cx, cy) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -(((cy - rect.top) / rect.height) * 2 - 1));
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, z: hit.z } : null;
    };

    let drag: { x: number; y: number; moved: boolean } | null = null;
    const el = renderer.domElement;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // 播放时相机固定跟随角色，不接受拖拽转视角（滚轮缩放仍然可以）
      if (playingRef.current) return;
      drag = { x: e.clientX, y: e.clientY, moved: false };
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      drag.x = e.clientX;
      drag.y = e.clientY;
      view.yaw -= dx * 0.006;
      view.pitch = Math.min(1.32, Math.max(0.13, view.pitch + dy * 0.005));
      apply();
    };
    const onUp = (e: PointerEvent) => {
      const wasClick = drag && !drag.moved;
      drag = null;
      el.style.cursor = 'grab';
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (!wasClick) return;
      // 点地面 → 选中那块地面对象（右侧就出它自己的生成参数）；点空地 → 取消选中
      const at = pickRef.current?.(e.clientX, e.clientY);
      let hitId: string | null = null;
      if (at) {
        // 后画的压在先画的上面，所以从后往前找
        const grounds = nodesRef.current.filter((n) => n.kind === 'ground' && n.ground && n.ground.map);
        for (let i = grounds.length - 1; i >= 0; i--) {
          const n = grounds[i];
          const g = n.ground!;
          const hx = (g.w * (g.cell || 1)) / 2;
          const hz = (g.h * (g.cell || 1)) / 2;
          if (Math.abs(at.x - n.x) <= hx && Math.abs(at.z - n.z) <= hz) {
            hitId = n.id;
            break;
          }
        }
      }
      if (hitId) editorStore.selectScene(hitId);
      else editorStore.selectScene(null);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      view.dist = Math.min(160, Math.max(5, view.dist * (1 + Math.sign(e.deltaY) * 0.11)));
      apply();
    };
    const onDbl = () => reset();

    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onDbl);

    // 把每个对象的标记按相机投影摆到屏幕上
    const v = new THREE.Vector3();
    const place = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      for (const node of nodesRef.current) {
        const node_el = tokens.current.get(node.id);
        if (!node_el) continue;
        v.set(node.x, 0.02, node.z).project(camera);
        const sx = (v.x * 0.5 + 0.5) * w;
        const sy = (-v.y * 0.5 + 0.5) * h;
        if (v.z > 1) {
          node_el.style.display = 'none';
          continue;
        }
        node_el.style.display = '';
        node_el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
      }

      // 角色精灵：脚底锚点摆到角色的投影点上，并按相机到角色的实际距离换算像素比例
      const rt = runtimeRef.current;
      const wrap = charWrapRef.current;
      if (rt && wrap) {
        v.set(rt.state.x, 0, rt.state.z).project(camera);
        const sx = (v.x * 0.5 + 0.5) * w;
        const sy = (-v.y * 0.5 + 0.5) * h;
        if (v.z > 1) {
          wrap.style.display = 'none';
        } else {
          wrap.style.display = '';
          wrap.style.transform = `translate(${sx}px, ${sy}px)`;
        }
        // 透视投影：距离 d 处，视口高度覆盖的世界高度 = 2 * d * tan(fov/2)
        // 注意要用"相机到角色"的距离，不能用相机到视点中心的 dist（编辑态两者差很远）
        v.set(rt.state.x, 0, rt.state.z);
        const d = Math.max(1, camera.position.distanceTo(v));
        const worldH = 2 * d * Math.tan((camera.fov * Math.PI) / 360);
        rt.pxPerUnit = h / Math.max(0.001, worldH);
        // 纸片人是竖直的平面：横向按透视比例；纵向还要乘 cos(俯角)，
        // 否则角色会比地面的格子显得"偏高"，看起来像浮在地上。
        rt.pxPerUnitY = rt.pxPerUnit * Math.cos(view.pitch);
        // 探针 / 录屏用：角色在屏幕上的位置和高度
        (window as unknown as { __charMetrics?: unknown }).__charMetrics = {
          pxPerUnit: Number(rt.pxPerUnit.toFixed(2)),
          pxPerUnitY: Number(rt.pxPerUnitY.toFixed(2)),
          charHeight: Number(rt.charHeight.toFixed(3)),
          screenH: Math.round(rt.charHeight * rt.pxPerUnitY),
          ground: [Math.round(sx), Math.round(sy)],
          viewport: [w, h],
          pitchDeg: Math.round((view.pitch * 180) / Math.PI),
          at: [Number(rt.state.x.toFixed(2)), Number(rt.state.z.toFixed(2))],
          state: rt.state.stateName,
          face: rt.state.face,
        };
      }
    };

    let raf = 0;
    let lastT = performance.now();
    /** 进入播放后只收一次相机距离 */
    let playDistSet = false;
    const loop = () => {
      const now = performance.now();
      const dt = (now - lastT) / 1000;
      lastT = now;

      const rt = runtimeRef.current;
      if (playingRef.current && rt) {
        rt.tick(dt);

        // 运行时相机：先把「跟随目标」同步给组件，组件再基于它算缓动
        // 让角色大约占屏幕高度的 1/3：dist = charH·cos(45°) / (2·tan(fov/2)·占比)
        const autoDist = (rt.charHeight * Math.cos(Math.PI / 4)) / (2 * Math.tan((camera.fov * Math.PI) / 360) * 0.32);
        rig.follow.x = rt.state.x;
        rig.follow.y = rt.charHeight * 0.5;
        rig.follow.z = rt.state.z;
        rig.follow.height = rt.charHeight;
        rig.autoDistance = Math.min(18, Math.max(4.5, autoDist));

        componentRuntimeRef.current?.tick(dt);

        if (rig.claimedBy) {
          // 摄像机组件接管：完全按它给的位姿（45° / 俯视、距离、缓动后的注视点）
          view.pitch = rig.pose.pitch;
          view.yaw = rig.pose.yaw;
          view.dist = Math.max(1, rig.pose.distance);
          target.set(rig.pose.x, rig.pose.y, rig.pose.z);
          playDistSet = true;
        } else {
          // 没有摄像机对象：内置默认 —— 45° 俯角、正对屏幕正上方、角色在画面正中
          if (!playDistSet) {
            // 进入播放后只收一次相机距离（编辑视角可能拉得很远，跟着角色走太远看不清）
            view.dist = rig.autoDistance;
            playDistSet = true;
          }
          view.yaw = 0;
          view.pitch = Math.PI / 4;
          // 视点高度取角色身高的一半 → 角色整体（脚到头）正好居中
          target.set(rt.state.x, rt.charHeight * 0.5, rt.state.z);
        }
      } else {
        playDistSet = false;
        // 退出播放：交出相机控制权，下次播放重新由组件抢
        rig.claimedBy = null;
      }
      apply();
      renderer.render(scene, camera);
      place();
      raf = requestAnimationFrame(loop);
    };

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    resize();
    apply();
    loop();

    const ro = new ResizeObserver(resize);
    ro.observe(host);

    return () => {
      cancelAnimationFrame(raf);
      attachViewportScene(null);
      setCameraRig(null);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDbl);
      renderer.dispose();
      el.remove();
      for (const layer of groundLayers.current.values()) layer.dispose();
      groundLayers.current.clear();
      sceneRef.current = null;
      gridRef.current = null;
    };
  }, []);

  /* ---------------- 播放：键盘 / 鼠标 → 控制器变量 ---------------- */

  useEffect(() => {
    if (!playing) return;
    const rt = runtimeRef.current;
    const host = hostRef.current;
    if (!rt || !host) return;

    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    const mods = (e: KeyboardEvent | MouseEvent) => ({ ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey });
    const btnKey = (button: number) =>
      button === 0 ? 'mouse:left' : button === 1 ? 'mouse:middle' : button === 2 ? 'mouse:right' : '';

    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      // 方向键 / 空格会滚动页面，播放时吃掉
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      rt.keyDown(e.code, mods(e));
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      rt.keyUp(e.code, mods(e));
    };
    const onMouseDown = (e: MouseEvent) => {
      const key = btnKey(e.button);
      if (key) rt.keyDown(key, mods(e));
    };
    const onMouseUp = (e: MouseEvent) => {
      const key = btnKey(e.button);
      if (key) rt.keyUp(key, mods(e));
    };
    const onWheel = (e: WheelEvent) => rt.wheel(e.deltaY < 0, { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
    const onBlur = () => rt.releaseAll();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    host.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      host.removeEventListener('wheel', onWheel);
      window.removeEventListener('blur', onBlur);
      rt.releaseAll();
    };
  }, [playing]);

  /* 进入 / 退出播放：重置角色位置、跑脚本 onStart、恢复全景视角 */
  useEffect(() => {
    if (playing) {
      runtimeRef.current?.reset();
      runtimeRef.current?.startScripts();
      componentRuntimeRef.current?.start(projectRef.current);
      return;
    }
    componentRuntimeRef.current?.stop();
    resetRef.current?.();
  }, [playing]);

  /* 播放时每 150ms 采一次运行时状态，显示在工具条上 */
  useEffect(() => {
    if (!playing) {
      setHud(null);
      return;
    }
    const t = window.setInterval(() => {
      const rt = runtimeRef.current;
      if (rt) {
        const logs = rt.scriptVm?.logs ?? [];
        // 相机角度跟着实际位姿走（摄像机组件接管后可能不是 45°）
        const cam = (window as unknown as { __camera?: CameraRig }).__camera;
        setHud({
          state: rt.state.stateName,
          x: rt.state.x,
          z: rt.state.z,
          scriptLog: logs.length > 0 ? logs[logs.length - 1] : null,
          pitchDeg: Math.round(((((cam?.claimedBy ? cam.pose.pitch : Math.PI / 4) * 180) / Math.PI) * 10) / 10),
          claimed: !!cam?.claimedBy,
        });
      }
    }, 150);
    return () => window.clearInterval(t);
  }, [playing]);

  /* ---------------- 地皮网格：只在生成结果 / 尺寸 / 贴图变化时重建 ---------------- */

  const texSig = project.textures
    .map((t) => `${t.id}:${t.image ?? ''}:${t.dirs.S ?? ''}${t.dirs.E ?? ''}${t.dirs.N ?? ''}${t.dirs.W ?? ''}`)
    .join(',');
  const imgSig = project.images
    .map((i) => `${i.id}:${i.file}:${i.crop ? `${i.crop.x},${i.crop.y},${i.crop.w},${i.crop.h}` : ''}`)
    .join(',');

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    for (const layer of groundLayers.current.values()) layer.dispose();
    groundLayers.current.clear();

    const doc = projectRef.current;
    let maxSpan = 48;
    let maxCell = 1;

    doc.scene.forEach((node, i) => {
      if (node.kind !== 'ground' || !node.ground) return;
      const map = groundTiles(node.ground);
      if (!map) return;
      const layer = buildGroundLayer(doc, node.ground, map);
      // 多块地面可能重叠，按顺序给一点点高度差，避免 z-fighting 闪烁
      layer.group.position.set(node.x, i * 0.0015, node.z);
      scene.add(layer.group);
      groundLayers.current.set(node.id, layer);
      const cell = node.ground.cell || 1;
      maxSpan = Math.max(maxSpan, map.w * cell, map.h * cell);
      maxCell = cell;
    });

    // 网格跟着最大的那块地面走（一条线一格）；没有地图时是 48×48 的参考网格
    if (gridRef.current) {
      scene.remove(gridRef.current);
      gridRef.current.geometry.dispose();
      (gridRef.current.material as THREE.Material).dispose();
    }
    const grid = new THREE.GridHelper(maxSpan, Math.max(2, Math.round(maxSpan / maxCell)), 0x6a5233, 0x2b241d);
    const gm = grid.material as THREE.LineBasicMaterial;
    gm.transparent = true;
    gm.opacity = 0.7;
    grid.position.y = 0.004;
    grid.visible = gridOn;
    gridRef.current = grid;
    scene.add(grid);

    // 有新的地面生成了（首次生成 / 改大小）就把视角拉回到能看全
    if (mappedSig !== lastMapSig.current) {
      lastMapSig.current = mappedSig;
      resetRef.current?.();
    }

    return () => {
      for (const layer of groundLayers.current.values()) layer.dispose();
      groundLayers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groundSig, texSig, imgSig]);

  /* 地面对象被拖动时只挪位置，不重新拼几何 */
  useEffect(() => {
    const nodes = projectRef.current.scene.filter((n) => n.kind === 'ground');
    nodes.forEach((n, i) => {
      const layer = groundLayers.current.get(n.id);
      if (layer) layer.group.position.set(n.x, i * 0.0015, n.z);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groundPosSig, groundSig]);

  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = gridOn;
  }, [gridOn]);

  /* ---------------- 拖标记改位置 ---------------- */

  const startMove = (e: React.PointerEvent, node: SceneNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    editorStore.selectScene(node.id);
    const move = (ev: PointerEvent) => {
      const at = pickRef.current?.(ev.clientX, ev.clientY);
      if (at) editorStore.moveSceneNodeTo(node.id, at.x, at.z);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** 拖地图元素改的是"屏幕位置"（像素），跟 3D 拾取无关 */
  const startMoveScreen = (e: React.PointerEvent, node: SceneNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    editorStore.selectScene(node.id);
    const s0 = node.mapui;
    if (!s0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const move = (ev: PointerEvent) => {
      editorStore.setMapui(node.id, { sx: Math.round(s0.sx + ev.clientX - startX), sy: Math.round(s0.sy + ev.clientY - startY) }, `mapui-pos:${node.id}`);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* ---------------- 菜单 ---------------- */

  const addItems = (): MenuItem[] =>
    SCENE_KINDS.map((k) => ({
      label: `${k.name}…`,
      hint: k.id === 'group' ? '分组' : k.id === 'mapui' ? '屏幕UI' : k.id === 'time' || k.id === 'weather' ? '全局' : undefined,
      onClick: () => setAdding(k.id),
    }));

  const node_menu = (node: SceneNode): MenuItem[] => [
    { label: '重命名…', hint: 'F2', onClick: () => onRenameScene(node) },
    { label: '复制', hint: 'Ctrl+C', onClick: () => editorStore.copySceneNode(node.id) },
    {
      label: '粘贴到此处',
      hint: 'Ctrl+V',
      disabled: !sceneClipboard,
      onClick: () => editorStore.pasteSceneNode(node.kind === 'group' ? node.id : node.parentId),
    },
    { label: '复制一份', hint: 'Ctrl+D', onClick: () => editorStore.duplicateSceneNode(node.id) },
    { type: 'sep' },
    { label: '删除', hint: 'Del', danger: true, onClick: () => editorStore.deleteSceneNode(node.id) },
  ];

  const viewMenu = (): MenuItem[] => [
    { label: '新建对象', submenu: addItems() },
    { type: 'sep' },
    { label: '粘贴', hint: 'Ctrl+V', disabled: !sceneClipboard, onClick: () => editorStore.pasteSceneNode(null) },
    { type: 'sep' },
    { label: '重置视角', onClick: () => resetRef.current() },
  ];

  const addingMeta = adding ? sceneKindMeta(adding) : null;
  const solid = project.scene.filter((n) => sceneKindMeta(n.kind).solid).length;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.bg0, minHeight: 0 }}>
      {/* 工具条 */}
      <div
        style={{
          height: 34,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px',
          borderBottom: `1px solid ${T.lineSoft}`,
          background: T.bg2,
        }}
      >
        <span style={{ fontSize: 11.5, color: T.dim, letterSpacing: '.04em' }}>场景</span>
        <button
          onClick={() => setPlaying((p) => !p)}
          title={playing ? '停止运行' : '运行场景'}
          style={{
            ...btnStyle,
            width: 30,
            padding: '3px 0',
            color: playing ? '#1a1410' : T.text,
            background: playing ? T.ok : T.bg3,
            border: 'none',
          }}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button onClick={() => setPlaying(false)} title="停止并回到编辑状态" style={{ ...btnStyle, width: 30, padding: '3px 0' }}>
          ⏹
        </button>
        <span style={{ width: 1, height: 16, background: T.line }} />
        <button onClick={() => resetRef.current()} title="重置视角（双击视口）" style={{ ...btnStyle, padding: '3px 8px', fontSize: 11 }}>
          重置视角
        </button>
        <button
          onClick={() => setShowGrid(!gridOn)}
          title="地皮生成后可以关掉网格，看起来更像游戏画面"
          style={{ ...btnStyle, padding: '3px 8px', fontSize: 11, color: gridOn ? T.text : T.dimmer }}
        >
          网格 {gridOn ? '开' : '关'}
        </button>
        <div style={{ flex: 1 }} />
        {playing && (
          <span data-play-hud style={{ fontSize: 11, color: T.accent, fontWeight: 600 }}>
            ▶ {hud?.state ?? '运行中'} · ({hud?.x.toFixed(1) ?? '0.0'}, {hud?.z.toFixed(1) ?? '0.0'})
            {hud?.scriptLog && (
              <span data-script-log style={{ color: '#c9a35c', fontWeight: 400 }}>
                {' '}
                · {hud.scriptLog}
              </span>
            )}
            <span style={{ color: T.dimmer, fontWeight: 400 }}> · WASD / 方向键移动 · 相机{hud?.claimed ? ` ${hud.pitchDeg}°` : ''}跟随</span>
          </span>
        )}
        <span style={{ fontSize: 11, color: T.dimmer }}>
          {hasMap ? `已生成 ${mappedGrounds.length} 块地面 · ` : '未生成地皮 · '}
          {project.scene.length} 个对象（{solid} 个实体）
        </span>
      </div>

      {/* 视口 */}
      <div
        style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}
        onContextMenu={(e) => {
          e.preventDefault();
          if ((e.target as HTMLElement).closest('[data-scene-token]')) return;
          setMenu({ x: e.clientX, y: e.clientY, items: viewMenu() });
        }}
      >
        <div ref={hostRef} data-scene-host style={{ position: 'absolute', inset: 0 }} />

        {/* 对象标记层（不吃空白处事件，只有标记本身可点） */}
        <div ref={layerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          {/* 角色精灵：用动画部件叠出来，脚底站在地面上；编辑态也在（静态待机） */}
          <div
            ref={charWrapRef}
            data-char-wrap
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 0,
              height: 0,
              pointerEvents: 'none',
              transform: 'translate(-9999px, -9999px)',
            }}
          >
            {runtime && <CharacterSprite project={project} runtime={runtime} />}
          </div>

          {/* 地图元素：屏幕 UI —— 固定在屏幕坐标上，跟 3D 相机无关 */}
          {project.scene
            .filter((n) => n.kind === 'mapui' && n.mapui)
            .map((node) => {
              const cfg = node.mapui!;
              const decorImg = cfg.decorId ? project.images.find((i) => i.id === cfg.decorId) ?? null : null;
              const decorUrl = decorImg ? mapuiDecorUrl(project, decorImg.id) : '';
              const active = selectedId === node.id;
              /* 装饰贴图的显示方式（都不影响框内内容尺寸 —— 地图铺满整块，边框盖在最上层）：
                 · 重复（loop）→ border-image + round，沿框边环绕拼接；
                 · 九宫格 → border-image 按四线切片 + stretch（边缘不变形、中间拉伸）；
                 · 单张 → 整张图铺满这块框（等比 = contain 不变形，圆的还是圆的；拉伸 = 100% 100%）。 */
              const loop = cfg.decorLoop ?? true;
              const tiling = decorImg?.tiling ?? 'default';
              const nine = tiling === 'nine' && decorImg?.nine ? decorImg.nine : null;
              const single = !!decorUrl && !loop && !nine;
              const border = decorUrl && (loop || nine) ? 12 : 0;
              return (
                <div
                  key={`frame:${node.id}`}
                  data-mapui-frame
                  onPointerDown={(e) => startMoveScreen(e, node)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    editorStore.selectScene(node.id);
                    setMenu({ x: e.clientX, y: e.clientY, items: node_menu(node) });
                  }}
                  onDoubleClick={() => onRenameScene(node)}
                  title={`地图元素 · ${node.name}（拖拽改屏幕位置）`}
                  style={{
                    position: 'absolute',
                    left: cfg.sx,
                    top: cfg.sy,
                    width: cfg.size,
                    height: cfg.size,
                    pointerEvents: 'auto',
                    cursor: 'grab',
                    borderRadius: cfg.shape === 'circle' ? '50%' : 6,
                    // 圆形靠容器裁切（overflow:hidden）就够了，不再用 mask —— 之前的 mask 会把整块元素一起吃掉
                    overflow: 'hidden',
                    background: 'rgba(14,11,7,.72)',
                    boxShadow: active ? `0 0 0 1.5px ${T.accent}, 0 6px 18px rgba(0,0,0,.55)` : '0 4px 14px rgba(0,0,0,.4)',
                    userSelect: 'none',
                  }}
                >
                  {/* 框内：真实的小地图内容（地皮 + 实体点，俯视）—— 铺满整块，不为边框留白 */}
                  <div
                    data-mapui-content
                    style={{
                      position: 'absolute',
                      inset: 0,
                      pointerEvents: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <MinimapCanvas
                      project={project}
                      px={cfg.size}
                      span={(() => {
                        // 显示范围档位决定放大倍数：范围越小可视跨度越小 = 放大越大；「始终」= 全图全景
                        const step = MAPUI_RANGE_STEPS.find((s) => s.id === cfg.range);
                        return step && Number.isFinite(step.radius) ? step.radius * 2 : null;
                      })()}
                      getCenter={
                        followCharNode
                          ? playing
                            ? () => {
                                const rt = runtimeRef.current;
                                return rt ? { x: rt.state.x, z: rt.state.z } : { x: followCharNode.x, z: followCharNode.z };
                              }
                            : () => ({ x: followCharNode.x, z: followCharNode.z })
                          : null
                      }
                      getPos={playing ? liveNodePos : null}
                    />
                  </div>

                  {/* 边框贴图层：盖在内容之上，本身不吃鼠标事件 */}
                  {decorUrl && (loop || nine) && (
                    <div
                      data-mapui-ring
                      style={{
                        position: 'absolute',
                        inset: 0,
                        pointerEvents: 'none',
                        border: `${border}px solid transparent`,
                        borderImageSource: `url(${decorUrl})`,
                        // 九宫格：按贴图属性里拖的四条线切片（线条外的边缘区不拉伸）；默认切片 46px
                        borderImageSlice: nine
                          ? `${nine.t * 100}% ${nine.r * 100}% ${nine.b * 100}% ${nine.l * 100}% fill`
                          : '46 fill',
                        borderImageWidth: `${border}px`,
                        borderImageRepeat: loop ? 'round' : 'stretch',
                      }}
                    />
                  )}
                  {decorUrl && single && (
                    <div
                      data-mapui-ring
                      style={{
                        position: 'absolute',
                        inset: 0,
                        pointerEvents: 'none',
                        backgroundImage: `url(${decorUrl})`,
                        backgroundSize: tiling === 'aspect' ? 'contain' : '100% 100%',
                        backgroundPosition: 'center',
                        backgroundRepeat: 'no-repeat',
                      }}
                    />
                  )}
                  {!decorUrl && (
                    <div
                      data-mapui-ring
                      style={{
                        position: 'absolute',
                        inset: 0,
                        pointerEvents: 'none',
                        border: `2.5px solid ${cfg.decorColor || (active ? T.accent : '#6b5637')}`,
                        borderRadius: 'inherit',
                      }}
                    />
                  )}
                </div>
              );
            })}

          {project.scene
            .filter((n) => n.kind !== 'mapui')
            // 播放时角色本体已经渲染成精灵，标签收起来（不然压在角色身上）
            .filter((n) => !(playing && n.kind === 'character'))
            .map((node) => {
            const meta = sceneKindMeta(node.kind);
            const active = selectedId === node.id;
            const kids = project.scene.filter((n) => n.parentId === node.id).length;
            return (
              <div
                key={node.id}
                data-scene-token
                ref={(el) => {
                  if (el) tokens.current.set(node.id, el);
                  else tokens.current.delete(node.id);
                }}
                onPointerDown={(e) => startMove(e, node)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  editorStore.selectScene(node.id);
                  setMenu({ x: e.clientX, y: e.clientY, items: node_menu(node) });
                }}
                onDoubleClick={() => onRenameScene(node)}
                onDragOver={(e) => {
                  if (!Array.from(e.dataTransfer.types).includes(SCRIPT_DRAG_TYPE)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  // 与资源浏览器的 effectAllowed = 'move' 保持一致
                  e.dataTransfer.dropEffect = 'move';
                  if (scriptHotNode !== node.id) setScriptHotNode(node.id);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  setScriptHotNode((h) => (h === node.id ? null : h));
                }}
                onDrop={(e) => {
                  setScriptHotNode(null);
                  const ids = scriptIdsFromDrop(e);
                  if (ids.length === 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  // 组件脚本进组件列表（属性面板按组件区块渲染），老钩子脚本仍进脚本槽
                  const isHook = (id: string) => project.scripts.find((s) => s.id === id)?.kind === 'hook';
                  const comps = ids.filter((id) => !isHook(id));
                  const hooks = ids.filter((id) => isHook(id));
                  if (comps.length) {
                    const nextC = [...(node.componentIds ?? [])];
                    for (const id of comps) if (!nextC.includes(id)) nextC.push(id);
                    if (nextC.length !== (node.componentIds ?? []).length) editorStore.setNodeComponents(node.id, nextC);
                  }
                  if (hooks.length) {
                    const next = [...(node.scriptIds ?? [])];
                    for (const id of hooks) if (!next.includes(id)) next.push(id);
                    if (next.length !== (node.scriptIds ?? []).length) editorStore.setNodeScripts(node.id, next);
                  }
                  editorStore.selectScene(node.id);
                }}
                title={`${meta.name} · ${node.name}（拖拽改位置；脚本可以直接拖到它上面挂载）`}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  pointerEvents: 'auto',
                  cursor: 'grab',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '3px 7px 3px 5px',
                  borderRadius: 4,
                  border: `1px solid ${scriptHotNode === node.id ? T.accent : active ? T.accent : meta.solid ? T.line : `${T.line} dashed`}`,
                  background:
                    scriptHotNode === node.id
                      ? 'rgba(88,64,32,.96)'
                      : active
                        ? 'rgba(60,47,33,.95)'
                        : 'rgba(26,22,19,.86)',
                  boxShadow:
                    scriptHotNode === node.id
                      ? `0 0 0 2px ${T.accent}, 0 4px 12px rgba(0,0,0,.6)`
                      : active
                        ? `0 0 0 1px ${T.accent}, 0 4px 12px rgba(0,0,0,.6)`
                        : '0 2px 8px rgba(0,0,0,.45)',
                  color: active ? T.text : T.dim,
                  fontSize: 11,
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                  transform: 'translate(-9999px, -9999px)',
                }}
              >
                <span style={{ color: meta.color, display: 'flex' }}>
                  <SceneIcon kind={node.kind} size={12} />
                </span>
                <span>{node.name}</span>
                {kids > 0 && <span style={{ fontSize: 9.5, color: T.dimmer }}>+{kids}</span>}
                {scriptHotNode === node.id && (
                  <span data-script-hot style={{ fontSize: 9.5, color: T.accent, fontWeight: 700 }}>
                    ＋ 脚本
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {project.scene.length === 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              pointerEvents: 'none',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 13, color: T.dim, letterSpacing: '.04em' }}>场景为空</div>
            <div style={{ fontSize: 11.5, color: T.dimmer, lineHeight: 1.8 }}>
              {project.name} 里还没有摆放任何对象
              <br />
              在视口里右键新增：空节点 / 地面 / 覆盖物 / 敌人 / 角色 / 地图元素
            </div>
          </div>
        )}

        {/* 有对象但没有地面：给一个一键补地面的入口，别让人对着虚空找地皮 */}
        {project.scene.length > 0 && groundNodes.length === 0 && !playing && (
          <div
            data-no-ground
            style={{
              position: 'absolute',
              left: '50%',
              bottom: 14,
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              borderRadius: 6,
              border: `1px solid ${T.line}`,
              background: 'rgba(26,22,19,.92)',
              fontSize: 11.5,
              color: T.dim,
              boxShadow: '0 6px 18px rgba(0,0,0,.5)',
            }}
          >
            <span>场景里还没有地面，角色会显得浮在空中</span>
            <button
              onClick={() => {
                const id = editorStore.ensureGroundNode();
                if (id) editorStore.regenerateGround(id);
                resetRef.current?.();
              }}
              style={{ ...btnStyle, padding: '3px 9px', fontSize: 11, color: '#1a1410', background: T.accent, border: 'none' }}
            >
              生成一块地面
            </button>
          </div>
        )}

        <div style={{ position: 'absolute', left: 10, bottom: 8, fontSize: 10.5, color: T.dimmer, pointerEvents: 'none' }}>
          右键新增 · 拖标记改位置 · 左键拖空白旋转 · 滚轮缩放 · 双击重置
        </div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}

      {adding && addingMeta && (
        <PromptDialog
          title={`新建${addingMeta.name}`}
          label="名称"
          defaultValue={addingMeta.baseName}
          onCancel={() => setAdding(null)}
          onSubmit={(name) => {
            editorStore.addSceneNode(adding, name);
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}
