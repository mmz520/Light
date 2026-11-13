/**
 * 组件宿主（编辑器侧）
 *
 * 把「节点 + 组件脚本 + three 场景」粘起来：
 *   · 给组件注入上下文（this.node / this.scene / this.three / setNode / setCharacter / setMapui / emit …）
 *   · 属性面板改字段 → 同步到实例 → 调 onFieldChange → 值写回 node.components
 *   · 持有每个节点的 three 锚点对象，脚本可以直接往上挂东西
 */
import * as THREE from 'three';
import { editorStore } from './store';
import type { ProjectDoc, SceneNode, ScriptAsset } from './types';
import type { ComponentContext, CameraRig, LightComponent } from '../../runtime/component';
import { eventBus } from '../../runtime/component';
import {
  applyValues,
  createComponent,
  loadComponent,
  peekComponent,
  type LoadedComponent,
} from '../../runtime/scriptRegistry';

/** 编辑器视口的三维场景（SceneView 挂上来；没有也不影响属性面板） */
let viewScene: THREE.Scene | null = null;
/** nodeId → 锚点对象（脚本 this.object3d 拿到的就是它） */
const anchors = new Map<string, THREE.Object3D>();
/** 运行时相机（SceneView 挂上来）：摄像机组件通过 this.camera 读写 */
let cameraRig: CameraRig | null = null;

/** SceneView 初始化 / 销毁时调用 */
export function attachViewportScene(scene: THREE.Scene | null): void {
  if (viewScene === scene) return;
  viewScene = scene;
  anchors.clear();
}

/** 视口挂上 / 摘下运行时相机（组件实例化时读这个模块变量） */
export function setCameraRig(rig: CameraRig | null): void {
  cameraRig = rig;
}

/** 组件的 three 命名空间（脚本里 this.three.Mesh(...)） */
export { THREE as ThreeNamespace };

/** 取（必要时创建）节点的三维锚点 */
export function anchorOf(node: SceneNode): THREE.Object3D | null {
  if (!viewScene) return null;
  let obj = anchors.get(node.id);
  if (!obj) {
    obj = new THREE.Object3D();
    obj.name = `node:${node.id}`;
    viewScene.add(obj);
    anchors.set(node.id, obj);
  }
  obj.position.set(node.x, 0, node.z);
  return obj;
}

/** 节点的三维锚点当前实际位置（播放中脚本可能挪过它）；没锚点返回 null */
export function anchorPositionOf(nodeId: string): { x: number; z: number } | null {
  const obj = anchors.get(nodeId);
  if (!obj) return null;
  return { x: obj.position.x, z: obj.position.z };
}

/** 给组件用的上下文 */
export function buildContext(node: SceneNode, project: ProjectDoc, playing = false): ComponentContext {
  return {
    node,
    project,
    scene: viewScene,
    three: THREE,
    object3d: anchorOf(node),
    log: (...args: unknown[]) => console.log(`[${node.name}]`, ...args),
    emit: (type, payload) => eventBus.emit(type, payload),
    camera: cameraRig,
    time: () => 0,
    playing,
    patchNode: (patch) => editorStore.patchNodeFields(node.id, patch, `comp-node:${node.id}`),
    setCharacter: (patch) => editorStore.setCharacter(node.id, patch as never),
    setMapui: (patch) => editorStore.setMapui(node.id, patch as never),
  };
}

/** 节点挂了哪些组件脚本（同步，依赖已编译好的注册表） */
export function nodeComponents(node: SceneNode, project: ProjectDoc): { script: ScriptAsset; loaded: LoadedComponent }[] {
  const ids = node.componentIds ?? [];
  const out: { script: ScriptAsset; loaded: LoadedComponent }[] = [];
  for (const id of ids) {
    const script = project.scripts.find((s) => s.id === id);
    if (!script) continue;
    const loaded = peekComponent(script.id);
    if (!loaded) continue; // 还没编译好，由调用方触发 ensureComponents
    out.push({ script, loaded });
  }
  return out;
}

/** 触发节点上组件脚本的编译（异步；完成后注册表会通知界面重渲染） */
export async function ensureNodeComponents(node: SceneNode, project: ProjectDoc): Promise<void> {
  const ids = node.componentIds ?? [];
  const scripts = ids
    .map((id) => project.scripts.find((s) => s.id === id))
    .filter((s): s is ScriptAsset => !!s);
  await Promise.all(scripts.map((s) => loadComponent(s).catch(() => null)));
}

/** 造一个实例：先套已存字段值，再 onMount 把节点上的真实数据灌进去 */
export function instantiate(
  node: SceneNode,
  project: ProjectDoc,
  loaded: LoadedComponent,
  playing = false,
): LightComponent {
  const ctx = buildContext(node, project, playing);
  const values = node.components?.[loaded.scriptId] ?? null;
  const inst = createComponent(loaded, ctx, values);
  try {
    inst.onMount?.();
  } catch (e) {
    console.warn('[脚本] onMount 出错：', loaded.meta.name, e);
  }
  return inst;
}

/**
 * 属性面板改字段：
 *   1. 建实例 → 写字段 → onFieldChange（脚本可以在这里写节点 / three）
 *   2. 字段值持久化到 node.components
 */
export function applyComponentField(
  node: SceneNode,
  project: ProjectDoc,
  loaded: LoadedComponent,
  key: string,
  value: unknown,
): void {
  const inst = instantiate(node, project, loaded);
  (inst as unknown as Record<string, unknown>)[key] = value;
  try {
    inst.onFieldChange?.(key, value);
  } catch (e) {
    console.warn('[脚本] onFieldChange 出错：', loaded.meta.name, e);
  }
  editorStore.setNodeComponentField(node.id, loaded.scriptId, key, value, `comp:${node.id}:${loaded.scriptId}:${key}`);
}

/**
 * 只读一次字段的当前值（属性面板渲染用）：
 * 实例字段优先，其次 node.components，最后是脚本默认值。
 */
export function readFieldValues(inst: LightComponent, loaded: LoadedComponent): Record<string, unknown> {
  const target = inst as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...loaded.defaults };
  for (const f of loaded.fields) {
    const v = target[f.key];
    if (typeof v !== 'function') out[f.key] = v;
  }
  return out;
}

/** 给组件实例重新套一遍字段值（外部数据变了，比如拖场景改了位置） */
export function refreshInstance(inst: LightComponent, values: Record<string, unknown> | null | undefined): void {
  applyValues(inst, values ?? null);
}
