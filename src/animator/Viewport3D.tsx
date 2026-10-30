/**
 * Viewport3D —— 中间 3D 视图（Unity 式操作）
 *
 * 操作约定（对齐 Unity Scene 视图）：
 *   · 右键拖拽      旋转视角（环绕目标点）
 *   · 中键拖拽      平移视角
 *   · 滚轮          缩放（推近/拉远）
 *   · 左键点击      选择节点 / 覆盖贴图
 *   · 选中后出现 Unity 式三轴 gizmo（X 红 / Y 绿 / Z 蓝），W/E/R 切换工具：
 *       - 移动（W）：三根轴线 + 箭头 + 中心白块 —— 拖箭头沿该轴移动（任意视角下按投影换算），
 *                   拖中心块在面向相机的平面内自由移动（含 Z）
 *       - 旋转（E）：三个彩色圆环（各绕一轴）—— 拖哪个环绕哪根轴转，"拖到哪转到哪"
 *       - 缩放（R）：中心橙块 + 三根轴线末端小方块 —— 拖中心等比缩放，拖轴端按该轴缩放
 *   · 手柄射线检测优先于节点：拖坐标轴 **不会误选其它节点**，左键点物体只做选择（像 Unity）
 *
 * 层级：每个 part 是一个 THREE.Group，按 PartDef.parent 挂到父 Group 上。
 * pose 是相对父节点的局部变换（x/y/z、rotX/rotY/rot、scale×scaleX/scaleY）；
 * gizmo 挂在被选节点的父级空间里，轴向与该局部空间一致。
 * 覆盖贴图是 part Group 的一个子 Mesh，改它自己的变换不影响任何子节点。
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OverlayDef, PartDef, PartPose } from './types';

export type ViewportTool = 'move' | 'rotate' | 'scale';

interface Props {
  parts: PartDef[];
  /** 每个部件相对父节点的局部 pose（采样自活动 clip） */
  poses: Record<string, PartPose>;
  /** 每个部件的显示/隐藏 */
  visibility: Record<string, boolean>;
  /** 'partId' 或 'partId#overlay' */
  selectedId: string | null;
  tool: ViewportTool;
  onToolChange: (tool: ViewportTool) => void;
  onSelect: (id: string | null) => void;
  onPoseChange: (partId: string, pose: PartPose) => void;
  onOverlayChange: (partId: string, overlay: OverlayDef) => void;
}

const DEG = Math.PI / 180;

interface NodeRecord {
  group: THREE.Group;
  mesh: THREE.Mesh;
  outline: THREE.LineSegments;
  /** 基准布局偏移（相对父节点中心，世界单位）：由 PartDef.layout 决定 */
  baseX: number;
  baseY: number;
  overlay?: THREE.Mesh;
  overlayOutline?: THREE.LineSegments;
}

interface SceneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  root: THREE.Group;
  nodes: Map<string, NodeRecord>;
  meshes: THREE.Mesh[];
  gizmo: THREE.Group;
  toolGroups: Record<ViewportTool, THREE.Group>;
  ringVisuals: { axis: AxisName; mat: THREE.MeshBasicMaterial }[];
  cam: { yaw: number; pitch: number; dist: number; target: THREE.Vector3 };
}

/** gizmo 拖拽中的交互状态（字段在 move 中增量更新） */
interface GizmoDrag {
  handle: string;
  partId: string;
  isOverlay: boolean;
  origPose: PartPose;
  origOverlay: OverlayDef | null;
  center: THREE.Vector3;
  worldScale: number;
  /** 轴向拖拽（move:x|y|z / scale:x|y|z）：世界轴向 + 起始时指针在轴线上的最近点 */
  axisWorld: THREE.Vector3 | null;
  startAxisPoint: THREE.Vector3 | null;
  /** 平面拖拽（free / scale:center）：面向相机的平面 + 起点 */
  plane: THREE.Plane | null;
  startPoint: THREE.Vector3 | null;
  startRadius: number;
  /** 旋转：平面基向量与增量累计 */
  rotU: THREE.Vector3 | null;
  rotV: THREE.Vector3 | null;
  lastAngle: number;
  accAngle: number;
}

type Interaction =
  | { kind: 'orbit'; lastX: number; lastY: number }
  | { kind: 'pan'; lastX: number; lastY: number }
  | ({ kind: 'gizmo' } & GizmoDrag)
  | null;

/** 贴图缓存：同一 URL 只加载一次；onReady 在图片可用时回调（用于按真实宽高比修尺寸） */
const textureCache = new Map<string, THREE.Texture>();
const textureWaiters = new Map<string, ((tex: THREE.Texture) => void)[]>();
function loadTexture(url: string, onReady?: (tex: THREE.Texture) => void): THREE.Texture {
  let tex = textureCache.get(url);
  if (!tex) {
    tex = new THREE.TextureLoader().load(url, t => {
      const fs = textureWaiters.get(url) ?? [];
      textureWaiters.delete(url);
      fs.forEach(fn => fn(t));
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(url, tex);
  }
  if (onReady) {
    if (tex.image) onReady(tex);
    else {
      const arr = textureWaiters.get(url) ?? [];
      arr.push(onReady);
      textureWaiters.set(url, arr);
    }
  }
  return tex;
}

function makeOutline(color: number): THREE.LineSegments {
  const s = 0.56;
  const pts = [
    -s, -s, 0, s, -s, 0,
    s, -s, 0, s, s, 0,
    s, s, 0, -s, s, 0,
    -s, s, 0, -s, -s, 0,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
}

function applyPartMaterial(mat: THREE.MeshBasicMaterial, part: PartDef, onAspect?: (aspect: number) => void) {
  if (part.texturePath) {
    const tex = loadTexture(assetUrl(part.texturePath), t => {
      const img = t.image as { width?: number; height?: number } | undefined;
      if (onAspect && img?.width && img?.height) onAspect(img.width / img.height);
    });
    const img = tex.image as { width?: number; height?: number } | undefined;
    if (onAspect && img?.width && img?.height) onAspect(img.width / img.height);
    mat.map = tex;
    mat.color.set('#ffffff');
    mat.opacity = 1;
  } else {
    // 无贴图：占位块保持布局尺寸，但完全不填充内容（全透明），
    // 只有被选中时靠描边显示位置
    mat.map = null;
    mat.color.set('#ffffff');
    mat.opacity = 0;
  }
  mat.needsUpdate = true;
}

export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

function rebuildParts(st: SceneState, parts: PartDef[]) {
  for (const rec of st.nodes.values()) {
    rec.group.removeFromParent();
    rec.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
  st.nodes.clear();
  st.meshes = [];

  for (const part of parts) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    // 有 layout：高度取 manifest 布局值，宽度按贴图真实宽高比自动换算（材质就绪后修正）
    // 无 layout：沿用旧版整幅画布尺寸（所有部件同尺寸叠加）
    const hWorld = part.layout ? part.layout.h : (part.size ?? 0.4);
    mesh.scale.set(hWorld, hWorld, 1);
    mesh.renderOrder = part.zIndex;
    mesh.userData = { selectId: part.id };
    applyPartMaterial(mat, part, aspect => mesh.scale.set(hWorld * aspect, hWorld, 1));
    const outline = makeOutline(0xffe066);
    outline.renderOrder = 9998;
    mesh.add(outline);
    group.add(mesh);

    const rec: NodeRecord = {
      group, mesh, outline,
      baseX: part.layout?.x ?? 0,
      baseY: part.layout?.y ?? 0,
    };
    if (part.overlay !== undefined && part.overlay !== null) {
      const ovMat = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, side: THREE.DoubleSide });
      if (part.overlay.texturePath) {
        ovMat.map = loadTexture(assetUrl(part.overlay.texturePath));
        ovMat.color.set('#ffffff');
      } else {
        ovMat.color.set('#6cf');
        ovMat.opacity = 0.6;
      }
      const ovMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ovMat);
      ovMesh.renderOrder = part.zIndex + 0.1;
      ovMesh.userData = { selectId: `${part.id}#overlay` };
      const ovOutline = makeOutline(0x6cf);
      ovOutline.renderOrder = 9999;
      ovMesh.add(ovOutline);
      group.add(ovMesh);
      rec.overlay = ovMesh;
      rec.overlayOutline = ovOutline;
    }
    st.nodes.set(part.id, rec);
    // 无贴图的空部件不参与拾取（全透明整幅画布会挡住其它部件的点击）
    if (part.texturePath) st.meshes.push(mesh);
    if (rec.overlay) st.meshes.push(rec.overlay);
  }

  for (const part of parts) {
    const rec = st.nodes.get(part.id);
    if (!rec) continue;
    const parentRec = part.parent ? st.nodes.get(part.parent) : null;
    (parentRec ? parentRec.group : st.root).add(rec.group);
  }
}

// ———————————————————— Gizmo（Unity 式三轴变换坐标轴） ————————————————————

const GIZMO_COLORS = { x: 0xff5252, y: 0x69f069, z: 0x5b9dff } as const;
const AXES = ['x', 'y', 'z'] as const;
type AxisName = (typeof AXES)[number];

/** 把 +Y 朝向的物件旋到指定轴：x→绕Z转-90°，y→不动，z→绕X转90° */
function orientY(obj: THREE.Object3D, axis: AxisName) {
  if (axis === 'x') obj.rotation.z = -Math.PI / 2;
  else if (axis === 'z') obj.rotation.x = Math.PI / 2;
}

/** 把圆环（默认绕 Z 轴）旋到绕指定轴 */
function orientTorus(obj: THREE.Object3D, axis: AxisName) {
  if (axis === 'x') obj.rotation.y = Math.PI / 2;
  else if (axis === 'y') obj.rotation.x = Math.PI / 2;
}

function buildGizmo(): {
  group: THREE.Group;
  toolGroups: Record<ViewportTool, THREE.Group>;
  /** 旋转环的可视网格（用于按朝向淡出侧视环，Unity 同款行为） */
  ringVisuals: { axis: AxisName; mat: THREE.MeshBasicMaterial }[];
} {
  const group = new THREE.Group();
  group.visible = false;
  const invisibleMat = () =>
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  const solidMat = (color: number, opacity = 1) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false });
  const ringVisuals: { axis: AxisName; mat: THREE.MeshBasicMaterial }[] = [];

  /** 标记手柄（挂在 group 上，命中时向上找 userData） */
  const tag = (g: THREE.Object3D, handle: string) => { g.userData = { gizmoHandle: handle }; return g; };

  // —— 移动：三轴箭头（线 + 锥头）+ 粗命中代理 + 中心白块 ——
  const moveGroup = new THREE.Group();
  for (const axis of AXES) {
    const mat = solidMat(GIZMO_COLORS[axis]);
    const arrow = new THREE.Group();
    orientY(arrow, axis);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.6, 10), mat);
    shaft.position.y = 0.3;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 14), mat);
    head.position.y = 0.7;
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.95, 8), invisibleMat());
    hit.position.y = 0.475;
    arrow.add(shaft, head, hit);
    moveGroup.add(tag(arrow, `move:${axis}`));
  }
  const moveCenter = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.17), solidMat(0xeeeeee, 0.9));
  moveGroup.add(tag(moveCenter, 'move:free'));

  // —— 旋转：三轴圆环 + 粗命中代理 ——
  const rotateGroup = new THREE.Group();
  for (const axis of AXES) {
    const ring = new THREE.Group();
    orientTorus(ring, axis);
    const ringMat = solidMat(GIZMO_COLORS[axis]);
    ringVisuals.push({ axis, mat: ringMat });
    ring.add(new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.014, 8, 80), ringMat));
    ring.add(new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.1, 8, 80), invisibleMat()));
    rotateGroup.add(tag(ring, `rot:${axis}`));
  }

  // —— 缩放：中心橙块 + 三轴（线 + 立方体 + 命中代理） ——
  const scaleGroup = new THREE.Group();
  for (const axis of AXES) {
    const axisGrp = new THREE.Group();
    orientY(axisGrp, axis);
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.75, 8), solidMat(GIZMO_COLORS[axis], 0.85));
    line.position.y = 0.375;
    const cube = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.11), solidMat(GIZMO_COLORS[axis]));
    cube.position.y = 0.78;
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.85, 8), invisibleMat());
    hit.position.y = 0.425;
    axisGrp.add(line, cube, hit);
    scaleGroup.add(tag(axisGrp, `scale:${axis}`));
  }
  const scaleCenter = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), solidMat(0xf2a33c));
  scaleGroup.add(tag(scaleCenter, 'scale:center'));

  group.add(moveGroup, rotateGroup, scaleGroup);
  return { group, toolGroups: { move: moveGroup, rotate: rotateGroup, scale: scaleGroup }, ringVisuals };
}

/** 解出某对象父级的 世界缩放/四元数 */
function parentFrame(obj: THREE.Object3D) {
  const parentObj = obj.parent!;
  parentObj.updateWorldMatrix(true, false);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  parentObj.matrixWorld.decompose(p, q, s);
  return { q, s };
}

/** 指针射线在轴线上的最近点（标准最近点公式，见最小二乘推导） */
function closestOnAxis(raycaster: THREE.Raycaster, linePoint: THREE.Vector3, lineDir: THREE.Vector3, out: THREE.Vector3): boolean {
  const ray = raycaster.ray;
  const w = new THREE.Vector3().subVectors(ray.origin, linePoint);
  const b = ray.direction.dot(lineDir);
  const d = ray.direction.dot(w);
  const e = lineDir.dot(w);
  const denom = 1 - b * b;
  if (Math.abs(denom) < 1e-6) return false;
  const s = (e - b * d) / denom;
  out.copy(linePoint).addScaledVector(lineDir, s);
  return true;
}

const wrapPi = (a: number) => {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
};

export function Viewport3D({
  parts, poses, visibility, selectedId, tool, onToolChange, onSelect, onPoseChange, onOverlayChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ parts, poses, visibility, selectedId, tool, onToolChange, onSelect, onPoseChange, onOverlayChange });
  propsRef.current = { parts, poses, visibility, selectedId, tool, onToolChange, onSelect, onPoseChange, onOverlayChange };

  const sceneRef = useRef<SceneState | null>(null);
  const interactionRef = useRef<Interaction>(null);
  const raycasterRef = useRef(new THREE.Raycaster());

  // —— 初始化（一次） ——
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#15151a');
    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.05, 200);

    const grid = new THREE.GridHelper(20, 40, 0x3a3a46, 0x26262e);
    scene.add(grid);
    const axes = new THREE.AxesHelper(1.2);
    scene.add(axes);
    const root = new THREE.Group();
    scene.add(root);

    const { group: gizmo, toolGroups, ringVisuals } = buildGizmo();
    scene.add(gizmo);

    const st: SceneState = {
      renderer, scene, camera, root,
      nodes: new Map(), meshes: [],
      gizmo, toolGroups, ringVisuals,
      cam: { yaw: 0, pitch: 0.28, dist: 3.4, target: new THREE.Vector3(0, 0.75, 0) },
    };
    sceneRef.current = st;
    // 调试句柄（供自动化检查读取视口状态）
    (window as unknown as { __viewport?: unknown }).__viewport = st;

    const clampCam = () => {
      st.cam.pitch = Math.max(-1.45, Math.min(1.45, st.cam.pitch));
      st.cam.dist = Math.max(0.4, Math.min(60, st.cam.dist));
    };

    const updateCamera = () => {
      clampCam();
      const { yaw, pitch, dist, target } = st.cam;
      camera.position.set(
        target.x + dist * Math.sin(yaw) * Math.cos(pitch),
        target.y + dist * Math.sin(pitch),
        target.z + dist * Math.cos(yaw) * Math.cos(pitch),
      );
      camera.lookAt(target);
    };

    const raycast = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = raycasterRef.current;
      ray.setFromCamera(ndc, camera);
      return ray;
    };

    /** 取当前选中对象（part 或 overlay）的上下文；无选中返回 null */
    const selectionContext = () => {
      const sel = propsRef.current.selectedId;
      if (!sel) return null;
      const hashIdx = sel.indexOf('#');
      const partId = hashIdx >= 0 ? sel.slice(0, hashIdx) : sel;
      const isOverlay = hashIdx >= 0;
      const part = propsRef.current.parts.find(p => p.id === partId);
      const rec = st.nodes.get(partId);
      if (!part || !rec) return null;
      if (isOverlay && !rec.overlay) return null;
      const pose = propsRef.current.poses[partId] ?? part.defaultPose;
      return { partId, isOverlay, part, rec, pose };
    };

    /** 相机朝向平面（过某点） */
    const camPlane = (through: THREE.Vector3) => {
      const n = new THREE.Vector3();
      camera.getWorldDirection(n);
      return new THREE.Plane().setFromNormalAndCoplanarPoint(n, through);
    };

    const onPointerDown = (e: PointerEvent) => {
      // 阻止原生文本选择/拖拽抢占后续指针事件，并捕获指针到画布（拖拽中事件不丢）
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      if (e.button === 2) {
        interactionRef.current = { kind: 'orbit', lastX: e.clientX, lastY: e.clientY };
        return;
      }
      if (e.button === 1) {
        interactionRef.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;

      const ray = raycast(e.clientX, e.clientY);
      const curTool = propsRef.current.tool;

      // 1) 先命中 gizmo 手柄 —— 命中后不改变选择，也不会选到别的节点
      const active = st.toolGroups[curTool];
      const gHits = active.visible ? ray.intersectObjects([active], true) : [];
      const gHit = gHits[0];
      if (gHit) {
        const findHandle = (o0: THREE.Object3D | null): string => {
          let o = o0;
          while (o) {
            if (o.userData?.gizmoHandle) return o.userData.gizmoHandle as string;
            o = o.parent;
          }
          return '';
        };
        let handle = findHandle(gHit.object);
        // 旋转环相交处可能同时命中多个环：优先选法线最正对相机的环（Unity 行为）
        if (handle.startsWith('rot:') && gHits.length > 1) {
          const camDir = new THREE.Vector3();
          camera.getWorldDirection(camDir);
          const ctxPre = selectionContext();
          if (ctxPre) {
            const targetObj0 = ctxPre.isOverlay ? ctxPre.rec.overlay! : ctxPre.rec.group;
            const { q: q0 } = parentFrame(targetObj0);
            let bestScore = -1;
            for (const h of gHits) {
              const hd = findHandle(h.object);
              if (!hd.startsWith('rot:')) continue;
              const a = hd.slice(-1);
              const n = new THREE.Vector3(a === 'x' ? 1 : 0, a === 'y' ? 1 : 0, a === 'z' ? 1 : 0).applyQuaternion(q0);
              const score = Math.abs(n.dot(camDir));
              if (score > bestScore) { bestScore = score; handle = hd; }
            }
          }
        }
        const ctx = selectionContext();
        if (!ctx || !handle) return;
        const targetObj = ctx.isOverlay ? ctx.rec.overlay! : ctx.rec.group;
        const { q, s } = parentFrame(targetObj);
        const center = new THREE.Vector3();
        targetObj.getWorldPosition(center);
        let worldScale = Math.max(s.x, 1e-6);
        if (ctx.isOverlay) worldScale *= Math.max(ctx.pose.scale, 1e-6);

        const drag: GizmoDrag = {
          handle, partId: ctx.partId, isOverlay: ctx.isOverlay,
          origPose: { ...ctx.pose },
          origOverlay: ctx.part.overlay ? { ...ctx.part.overlay } : null,
          center: center.clone(),
          worldScale,
          axisWorld: null, startAxisPoint: null,
          plane: null, startPoint: null, startRadius: 0,
          rotU: null, rotV: null, lastAngle: 0, accAngle: 0,
        };

        const localAxisOf = (h: string): AxisName => h.slice(-1) as AxisName;

        if (handle.startsWith('move:') && handle !== 'move:free') {
          const axisName = localAxisOf(handle);
          const axisWorld = new THREE.Vector3(...(axisName === 'x' ? [1, 0, 0] : axisName === 'y' ? [0, 1, 0] : [0, 0, 1])).applyQuaternion(q).normalize();
          const p = new THREE.Vector3();
          if (!closestOnAxis(ray, center, axisWorld, p)) return;
          drag.axisWorld = axisWorld;
          drag.startAxisPoint = p.clone();
        } else if (handle.startsWith('scale:') && handle !== 'scale:center') {
          const axisName = localAxisOf(handle);
          const axisWorld = new THREE.Vector3(...(axisName === 'x' ? [1, 0, 0] : axisName === 'y' ? [0, 1, 0] : [0, 0, 1])).applyQuaternion(q).normalize();
          drag.axisWorld = axisWorld;
          drag.plane = camPlane(center);
          const p = new THREE.Vector3();
          if (!ray.ray.intersectPlane(drag.plane, p)) return;
          drag.startPoint = p.clone();
          drag.startRadius = Math.max(Math.abs(p.clone().sub(center).dot(axisWorld)) / worldScale, 1e-4);
        } else if (handle.startsWith('rot:')) {
          const axisName = localAxisOf(handle);
          const n = new THREE.Vector3(...(axisName === 'x' ? [1, 0, 0] : axisName === 'y' ? [0, 1, 0] : [0, 0, 1])).applyQuaternion(q).normalize();
          const up = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
          const u = new THREE.Vector3().crossVectors(up, n).normalize();
          const v = new THREE.Vector3().crossVectors(n, u).normalize();
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, center);
          const p = new THREE.Vector3();
          if (!ray.ray.intersectPlane(plane, p)) return;
          const rel = p.clone().sub(center);
          drag.plane = plane;
          drag.rotU = u;
          drag.rotV = v;
          drag.lastAngle = Math.atan2(rel.dot(v), rel.dot(u));
          drag.accAngle = 0;
        } else {
          // move:free / scale:center —— 面向相机的平面
          drag.plane = camPlane(center);
          const p = new THREE.Vector3();
          if (!ray.ray.intersectPlane(drag.plane, p)) return;
          drag.startPoint = p.clone();
          drag.startRadius = Math.max(p.distanceTo(center), 1e-4);
        }
        interactionRef.current = { kind: 'gizmo', ...drag };
        return;
      }

      // 2) 命中节点 / 覆盖贴图 —— 仅选择，不拖拽（变换统一走 gizmo）
      const hits = ray.intersectObjects(st.meshes, false);
      const hit = hits[0];
      const selectId = (hit?.object.userData?.selectId as string | undefined) ?? null;
      propsRef.current.onSelect(selectId);
    };

    const onPointerMove = (e: PointerEvent) => {
      const it = interactionRef.current;
      if (!it) return;
      if (it.kind === 'orbit') {
        st.cam.yaw -= (e.clientX - it.lastX) * 0.008;
        st.cam.pitch += (e.clientY - it.lastY) * 0.008;
        it.lastX = e.clientX; it.lastY = e.clientY;
        return;
      }
      if (it.kind === 'pan') {
        const dx = e.clientX - it.lastX;
        const dy = e.clientY - it.lastY;
        it.lastX = e.clientX; it.lastY = e.clientY;
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
        const up = new THREE.Vector3().crossVectors(right, dir).normalize();
        const k = st.cam.dist * 0.0016;
        st.cam.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
        return;
      }

      // —— gizmo 变换 ——
      const ray = raycast(e.clientX, e.clientY);
      const part = propsRef.current.parts.find(p => p.id === it.partId);
      if (!part) return;
      const cl = (v: number) => Math.max(0.02, Math.min(50, v));
      const setScale = (f: number) => {
        if (it.isOverlay && it.origOverlay) {
          propsRef.current.onOverlayChange(it.partId, { ...it.origOverlay, scale: cl(it.origOverlay.scale * f) });
        } else {
          propsRef.current.onPoseChange(it.partId, { ...it.origPose, scale: cl(it.origPose.scale * f) });
        }
      };
      const setAxisScale = (axis: AxisName, f: number) => {
        if (axis === 'z') { setScale(f); return; } // 平面贴图 Z 向缩放并入均匀缩放
        if (it.isOverlay && it.origOverlay) {
          propsRef.current.onOverlayChange(it.partId, {
            ...it.origOverlay, [axis === 'x' ? 'scaleX' : 'scaleY']: cl((axis === 'x' ? it.origOverlay.scaleX ?? 1 : it.origOverlay.scaleY ?? 1) * f),
          });
        } else {
          propsRef.current.onPoseChange(it.partId, {
            ...it.origPose, [axis === 'x' ? 'scaleX' : 'scaleY']: cl((axis === 'x' ? it.origPose.scaleX ?? 1 : it.origPose.scaleY ?? 1) * f),
          });
        }
      };
      const setRotAxis = (axis: AxisName, rot: number) => {
        const field = axis === 'x' ? 'rotX' : axis === 'y' ? 'rotY' : 'rot';
        if (it.isOverlay && it.origOverlay) {
          propsRef.current.onOverlayChange(it.partId, { ...it.origOverlay, [field]: rot });
        } else {
          propsRef.current.onPoseChange(it.partId, { ...it.origPose, [field]: rot });
        }
      };
      const setPos = (x: number, y: number, z: number) => {
        if (it.isOverlay && it.origOverlay) {
          propsRef.current.onOverlayChange(it.partId, { ...it.origOverlay, offsetX: x, offsetY: y, offsetZ: z });
        } else {
          propsRef.current.onPoseChange(it.partId, { ...it.origPose, x, y, z });
        }
      };

      switch (true) {
        case it.handle.startsWith('move:') && it.handle !== 'move:free': {
          // 轴向移动：指针射线在轴线上的最近点，投影到轴上换算局部位移
          const p = new THREE.Vector3();
          if (!it.axisWorld || !it.startAxisPoint || !closestOnAxis(ray, it.center, it.axisWorld, p)) return;
          const d = p.clone().sub(it.startAxisPoint).dot(it.axisWorld) / it.worldScale;
          const axis = it.handle.slice(-1) as AxisName;
          if (axis === 'x') setPos((it.isOverlay ? it.origOverlay!.offsetX : it.origPose.x) + d,
            it.isOverlay ? it.origOverlay!.offsetY : it.origPose.y,
            it.isOverlay ? it.origOverlay!.offsetZ ?? 0 : it.origPose.z ?? 0);
          else if (axis === 'y') setPos(it.isOverlay ? it.origOverlay!.offsetX : it.origPose.x,
            (it.isOverlay ? it.origOverlay!.offsetY : it.origPose.y) + d,
            it.isOverlay ? it.origOverlay!.offsetZ ?? 0 : it.origPose.z ?? 0);
          else setPos(it.isOverlay ? it.origOverlay!.offsetX : it.origPose.x,
            it.isOverlay ? it.origOverlay!.offsetY : it.origPose.y,
            (it.isOverlay ? it.origOverlay!.offsetZ ?? 0 : it.origPose.z ?? 0) + d);
          break;
        }
        case it.handle === 'move:free': {
          const p = new THREE.Vector3();
          if (!it.plane || !it.startPoint || !ray.ray.intersectPlane(it.plane, p)) return;
          const world = p.clone().sub(it.startPoint);
          // 面向相机平面上的世界位移，逆变换回父级局部空间（父四元数在拖拽中不变）
          const rec = sceneRef.current?.nodes.get(it.partId);
          if (!rec) return;
          const obj = it.isOverlay ? rec.overlay : rec.group;
          if (!obj?.parent) return;
          obj.parent.updateWorldMatrix(true, false);
          const q = new THREE.Quaternion();
          obj.parent.matrixWorld.decompose(new THREE.Vector3(), q, new THREE.Vector3());
          const local = world.clone().applyQuaternion(q.clone().invert()).divideScalar(it.worldScale);
          setPos(
            (it.isOverlay ? it.origOverlay!.offsetX : it.origPose.x) + local.x,
            (it.isOverlay ? it.origOverlay!.offsetY : it.origPose.y) + local.y,
            (it.isOverlay ? it.origOverlay!.offsetZ ?? 0 : it.origPose.z ?? 0) + local.z,
          );
          break;
        }
        case it.handle.startsWith('rot:'): {
          const p = new THREE.Vector3();
          if (!it.plane || !it.rotU || !it.rotV || !ray.ray.intersectPlane(it.plane, p)) return;
          const rel = p.clone().sub(it.center);
          const a = Math.atan2(rel.dot(it.rotV), rel.dot(it.rotU));
          it.accAngle += wrapPi(a - it.lastAngle);
          it.lastAngle = a;
          const axis = it.handle.slice(-1) as AxisName;
          setRotAxis(axis, (axis === 'z'
            ? (it.isOverlay ? it.origOverlay!.rot : it.origPose.rot)
            : axis === 'x'
              ? (it.isOverlay ? it.origOverlay!.rotX ?? 0 : it.origPose.rotX ?? 0)
              : (it.isOverlay ? it.origOverlay!.rotY ?? 0 : it.origPose.rotY ?? 0)) + it.accAngle / DEG);
          break;
        }
        case it.handle === 'scale:center': {
          const p = new THREE.Vector3();
          if (!it.plane || !it.startPoint || !ray.ray.intersectPlane(it.plane, p)) return;
          setScale(p.distanceTo(it.center) / it.startRadius);
          break;
        }
        case it.handle.startsWith('scale:'): {
          const p = new THREE.Vector3();
          if (!it.plane || !ray.ray.intersectPlane(it.plane, p)) return;
          const axis = it.handle.slice(-1) as AxisName;
          const proj = Math.abs(p.clone().sub(it.center).dot(it.axisWorld!)) / it.worldScale;
          setAxisScale(axis, proj / it.startRadius);
          break;
        }
      }
    };

    const onPointerUp = () => { interactionRef.current = null; };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      st.cam.dist *= Math.exp(e.deltaY * 0.001);
      clampCam();
    };

    const onContextMenu = (e: Event) => e.preventDefault();
    const onPointerCancel = () => { interactionRef.current = null; };

    const el = renderer.domElement;
    el.style.touchAction = 'none';
    el.style.userSelect = 'none';
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContextMenu);

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(container);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const { parts: ps, poses: pp, visibility: vv, selectedId: sel, tool: curTool } = propsRef.current;

      // 同步层级 pose / 可见性 / 选中框
      for (const part of ps) {
        const rec = st.nodes.get(part.id);
        if (!rec) continue;
        const pose = pp[part.id] ?? part.defaultPose;
        // 基准布局（manifest 画布位置）叠加在动画 pose 之上：pose 仍是"相对父节点"的增量
        rec.group.position.set(rec.baseX + pose.x, rec.baseY + pose.y, pose.z ?? 0);
        rec.group.rotation.set((pose.rotX ?? 0) * DEG, (pose.rotY ?? 0) * DEG, pose.rot * DEG);
        rec.group.scale.set(pose.scale * (pose.scaleX ?? 1), pose.scale * (pose.scaleY ?? 1), pose.scale);
        rec.group.visible = vv[part.id] !== false;
        rec.outline.visible = sel === part.id;
        if (rec.overlay) {
          const ov = part.overlay;
          rec.overlay.visible = rec.group.visible && !!ov;
          if (ov) {
            rec.overlay.position.set(ov.offsetX, ov.offsetY, (ov.offsetZ ?? 0) + 0.01);
            rec.overlay.rotation.set((ov.rotX ?? 0) * DEG, (ov.rotY ?? 0) * DEG, ov.rot * DEG);
            const base = part.layout?.h ?? part.size ?? 0.4;
            rec.overlay.scale.set(base * ov.scale * (ov.scaleX ?? 1), base * ov.scale * (ov.scaleY ?? 1), base * ov.scale);
          }
          if (rec.overlayOutline) rec.overlayOutline.visible = sel === `${part.id}#overlay`;
        }
      }

      // —— gizmo 跟随选中对象 ——
      const ctx = (() => {
        if (!sel) return null;
        const hashIdx = sel.indexOf('#');
        const partId = hashIdx >= 0 ? sel.slice(0, hashIdx) : sel;
        const isOverlay = hashIdx >= 0;
        const part = ps.find(p => p.id === partId);
        const rec = st.nodes.get(partId);
        if (!part || !rec) return null;
        if (isOverlay && !(rec.overlay && part.overlay)) return null;
        return { partId, isOverlay, part, rec };
      })();

      if (ctx) {
        const pose = pp[ctx.partId] ?? ctx.part.defaultPose;
        let parentObj: THREE.Object3D;
        if (ctx.isOverlay) {
          parentObj = ctx.rec.group; // overlay 的局部空间 = 节点 Group
          const ov = ctx.part.overlay!;
          gizmo.position.set(ov.offsetX, ov.offsetY, ov.offsetZ ?? 0);
        } else {
          parentObj = ctx.rec.group.parent ?? st.root;
          gizmo.position.set(ctx.rec.baseX + pose.x, ctx.rec.baseY + pose.y, pose.z ?? 0);
        }
        if (gizmo.parent !== parentObj) parentObj.add(gizmo);
        gizmo.visible = true;
        // 屏幕恒定大小：按相机距离缩放，并抵消父级缩放
        const wp = new THREE.Vector3();
        gizmo.getWorldPosition(wp);
        const dist = camera.position.distanceTo(wp);
        parentObj.updateWorldMatrix(true, false);
        const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        parentObj.matrixWorld.decompose(p, q, s);
        gizmo.scale.setScalar((dist * 0.3) / Math.max(s.x, 1e-6));
        // 只显示当前工具的坐标系
        for (const t of ['move', 'rotate', 'scale'] as ViewportTool[]) {
          st.toolGroups[t].visible = t === curTool;
        }
        // 旋转环：侧视（环平面与视线平行）时淡出，与 Unity 一致
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        for (const rv of st.ringVisuals) {
          const n = new THREE.Vector3(
            rv.axis === 'x' ? 1 : 0, rv.axis === 'y' ? 1 : 0, rv.axis === 'z' ? 1 : 0,
          ).applyQuaternion(q);
          const facing = Math.abs(n.dot(camDir));
          rv.mat.opacity = 0.15 + 0.85 * Math.min(1, facing / 0.3);
        }
      } else {
        gizmo.visible = false;
      }

      updateCamera();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContextMenu);
      for (const rec of st.nodes.values()) {
        rec.group.traverse(o => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
        });
      }
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // —— parts 变化时重建骨架（贴图/zIndex/层级/覆盖物都会反映进来） ——
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    rebuildParts(st, parts);
  }, [parts]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div style={{
        position: 'absolute', top: 10, left: 10, display: 'flex', gap: 4, zIndex: 10,
      }}>
        {([
          ['move', '✥ 移动', '#3a6', 'W'],
          ['rotate', '⟳ 旋转', '#48c', 'E'],
          ['scale', '⤢ 缩放', '#c82', 'R'],
        ] as const).map(([t, label, color, key]) => (
          <button
            key={t}
            onClick={() => onToolChange(t)}
            style={{
              padding: '4px 10px', fontSize: 12, cursor: 'pointer',
              border: '1px solid #555', borderRadius: 4,
              background: tool === t ? color : 'rgba(30,30,34,.85)',
              color: tool === t ? '#000' : '#ccc',
              fontWeight: tool === t ? 700 : 400,
            }}
            title={`${label}（快捷键 ${key}）`}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{
        position: 'absolute', bottom: 8, left: 10, fontSize: 10, color: '#888', zIndex: 10,
        textShadow: '0 1px 2px #000',
      }}>
        右键拖拽 旋转视角 · 中键拖拽 平移 · 滚轮 缩放 · 左键 选择 · 拖三轴手柄 变换（X红/Y绿/Z蓝，W/E/R 切工具）
      </div>
    </div>
  );
}
