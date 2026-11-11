/**
 * 场景对象树工具
 *
 * 场景用扁平数组存（parentId + order），这样移动 / 排序 / 改层级都只是改字段，
 * 落盘进 metadata.json 的 scene 字段，不用新的文件。
 */
import { uniqueName, type SceneNode } from './types';

/** 某一层的直接子对象（按 order 排好） */
export function childrenOf(nodes: SceneNode[], parentId: string | null): SceneNode[] {
  return nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.order - b.order);
}

/** 某个对象的所有后代 id（含自身） */
export function subtreeIds(nodes: SceneNode[], id: string): string[] {
  const out: string[] = [id];
  for (let i = 0; i < out.length; i++) {
    for (const n of nodes) if (n.parentId === out[i]) out.push(n.id);
  }
  return out;
}

/** candidate 是否是 id 本身或它的后代（用于阻止把父节点拖进自己的子树） */
export function isSelfOrDescendant(nodes: SceneNode[], id: string, candidate: string): boolean {
  return subtreeIds(nodes, id).includes(candidate);
}

/** 该层下一个 order 值 */
export function nextOrder(nodes: SceneNode[], parentId: string | null): number {
  const sib = childrenOf(nodes, parentId);
  return sib.length === 0 ? 0 : sib[sib.length - 1].order + 1;
}

/** 展开成带缩进的行（尊重 open 折叠） */
export function flattenScene(nodes: SceneNode[]): { node: SceneNode; depth: number }[] {
  const out: { node: SceneNode; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const n of childrenOf(nodes, parentId)) {
      out.push({ node: n, depth });
      if (n.open !== false) walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** 子树快照（父在前，便于粘贴时按顺序重挂） */
export function collectSubtree(nodes: SceneNode[], id: string): SceneNode[] {
  const ids = new Set(subtreeIds(nodes, id));
  return flattenScene(nodes)
    .filter(({ node }) => ids.has(node.id))
    .map(({ node }) => node);
}

/** 对象所在的父级名字（根层返回空串） */
export function parentName(nodes: SceneNode[], node: SceneNode): string {
  if (!node.parentId) return '';
  return nodes.find((n) => n.id === node.parentId)?.name ?? '';
}

/** 同级里不重名的名字 */
export function uniqueSceneName(nodes: SceneNode[], parentId: string | null, base: string): string {
  return uniqueName(base, childrenOf(nodes, parentId).map((n) => n.name));
}
