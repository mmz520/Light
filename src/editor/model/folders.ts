/**
 * 虚拟目录工具
 *
 * 目录只是 metadata.json 里的一个路径（"贴图/装备"），磁盘上没有真实目录。
 * 第一层固定为 图片 / 贴图 / 动画 三个（不可增删改），
 * 它们下面可以任意新建子目录，子目录继承父目录的类型。
 */
import type { AssetKind, FolderKind, ProjectDoc } from './types';
import { FIXED_FOLDERS } from './types';

export const KIND_LABEL: Record<FolderKind, string> = {
  image: '贴图',
  texture: '图组',
  animation: '动画',
  script: '脚本',
  statemachine: '状态机',
  controller: '控制器',
  character: '角色',
  enemy: '敌人',
  cover: '地面覆盖物',
};

export const KIND_ORDER: FolderKind[] = [
  'image',
  'texture',
  'animation',
  'statemachine',
  'controller',
  'script',
  'character',
  'enemy',
  'cover',
];

/** 能装资源的目录（角色 / 敌人 / 覆盖物是场景实体，还没有独立资产结构） */
export const ASSET_KINDS: AssetKind[] = ['image', 'texture', 'animation', 'statemachine', 'controller'];

/** 第一层固定目录名 */
export const ROOT_NAMES: string[] = FIXED_FOLDERS.map((f) => f.name);

/** 是否第一层固定目录（不能重命名 / 删除） */
export function isRootFolder(path: string): boolean {
  return ROOT_NAMES.includes(path);
}

export function parentPath(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

export function childPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/** path 是否等于 root 或在其之下 */
export function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/** 某一层的直接子目录名（不含更深的） */
export function siblingNames(folders: string[], parent: string): string[] {
  return folders
    .filter((f) => parentPath(f) === parent)
    .map((f) => baseName(f));
}

/** 目录类型（缺省按图片算） */
export function folderKindOf(project: ProjectDoc, path: string): FolderKind {
  return project.folderKinds[path] ?? 'image';
}

/** 某目录里的资产（不含子目录） */
export function assetsIn(project: ProjectDoc, path: string): { kind: AssetKind; id: string; name: string }[] {
  const out: { kind: AssetKind; id: string; name: string }[] = [];
  for (const a of project.images) if (a.folder === path) out.push({ kind: 'image', id: a.id, name: a.name });
  for (const a of project.textures) if (a.folder === path) out.push({ kind: 'texture', id: a.id, name: a.name });
  for (const a of project.animations) if (a.folder === path) out.push({ kind: 'animation', id: a.id, name: a.name });
  for (const a of project.stateMachines) if (a.folder === path) out.push({ kind: 'statemachine', id: a.id, name: a.name });
  for (const a of project.controllers) if (a.folder === path) out.push({ kind: 'controller', id: a.id, name: a.name });
  return out;
}

/**
 * 目录里的资产数量（不含子目录）。
 * excludePresetScripts = true 时（开发模式的「系统脚本」固定目录），
 * 预设脚本不计入普通脚本目录的计数。
 */
export function assetCount(project: ProjectDoc, path: string, excludePresetScripts = false): number {
  return (
    project.images.filter((a) => a.folder === path).length +
    project.textures.filter((a) => a.folder === path).length +
    project.animations.filter((a) => a.folder === path).length +
    project.stateMachines.filter((a) => a.folder === path).length +
    project.controllers.filter((a) => a.folder === path).length +
    project.scripts.filter((a) => a.folder === path && !(excludePresetScripts && a.preset)).length
  );
}

/** 目录下（含子目录）的资产数量（excludePresetScripts 含义同 assetCount） */
export function deepAssetCount(project: ProjectDoc, path: string, excludePresetScripts = false): number {
  return (
    project.images.filter((a) => isInside(a.folder, path)).length +
    project.textures.filter((a) => isInside(a.folder, path)).length +
    project.animations.filter((a) => isInside(a.folder, path)).length +
    project.stateMachines.filter((a) => isInside(a.folder, path)).length +
    project.controllers.filter((a) => isInside(a.folder, path)).length +
    project.scripts.filter((a) => isInside(a.folder, path) && !(excludePresetScripts && a.preset)).length
  );
}

/** 目录名去重（同一层内） */
export function uniqueFolderName(base: string, taken: string[]): string {
  const t = base.trim() || '新建目录';
  if (!taken.includes(t)) return t;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${t} ${i}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${t}_${Date.now()}`;
}
