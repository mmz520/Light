/**
 * 编辑器状态仓库
 *
 * 单一数据源：ProjectDoc（含全部资产详情）。
 * 落盘时拆成 metadata.json（索引）+ 每个资产一个 JSON 文件。
 * 任何修改都会进撤销栈，并触发 600ms 去抖的自动保存。
 */
import { useSyncExternalStore } from 'react';

import { desk, DeskError, isDesktop } from '../../platform/desk';
import type { RecentProject } from '../../shared/ipc';
import { deriveAnimation, newAnimation, newTexture, switchTextureTemplate } from './build';
import { baseName, childPath, isInside, parentPath, ROOT_NAMES, siblingNames, uniqueFolderName } from './folders';
import {
  defaultGroundConfig,
  generateGroundMap,
  groundTiles,
  groundEdgeKey,
  MAX_GROUND_EDGES,
  newGroundEdge,
  normalizeGround,
  tileCounts,
  type GroundConfig,
  type GroundEdge,
  type GroundTypeId,
  type GroundTypeSetting,
} from './ground';
import { animationReferences, textureReferences, imageById, textureById } from './resolve';
import { childrenOf, collectSubtree, isSelfOrDescendant, nextOrder, subtreeIds, uniqueSceneName } from './scene';
import {
  DEFAULT_FOLDER,
  FIXED_FOLDERS,
  FOLDER_OF_KIND,
  FOLDERS,
  defaultBinding,
  migrateFolderPath,
  PROJECT_FORMAT,
  PROJECT_VERSION,
  shortId,
  SCENE_KINDS,
  sceneKindMeta,
  textureFilled,
  uniqueName,
  defaultMapui,
  defaultCharacter,
  normalizeCharacter,
  type CropRect,
  normalizeMapui,
  normalizeImageTiling,
  type AnimationAsset,
  type AssetRef,
  type AnimationIndexEntry,
  type AssetKind,
  type ControllerAsset,
  type ControllerIndexEntry,
  type CtrlBinding,
  type CtrlVariable,
  type ScriptAsset,
  type ScriptIndexEntry,
  type FolderKind,
  type ImageAsset,
  type ImageIndexEntry,
  type MapUiConfig,
  type ProjectDoc,
  type ProjectMetaFile,
  type SceneKind,
  type SceneNode,
  type StateMachineAsset,
  type StateMachineIndexEntry,
  type SkeletonId,
  type TextureAsset,
  type TextureIndexEntry,
  type TextureTemplate,
} from './types';
import { seedSampleProject } from './seed';
import { migrateMetaFile } from './migrations';
import {
  defaultCondition,
  dropVarConditions,
  makeBlankStateMachine,
  makeDefaultStateMachine,
  migrateConditions,
  newSmState,
  staggerOverlappingStates,
  transitionsOf,
} from './statemachine';
import { makeBlankController, makeMoveController, newVariable, removeVariableSafely } from './controller';
import { SCRIPT_TEMPLATE, scriptFileOf } from './types';
import {
  DEFAULT_DECOR_FILE,
  DEFAULT_DECOR_NAME,
  DEFAULT_DECOR_SIZE,
  LEGACY_DECOR_FILES,
  makeDefaultFrameDataUrl,
} from '../ui/mapuiDecor';

export type EditorStatus = 'booting' | 'welcome' | 'ready';
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface Selection {
  kind: AssetKind;
  id: string;
}

export interface EditorState {
  status: EditorStatus;
  project: ProjectDoc | null;
  selection: Selection | null;
  /** 场景里选中的对象（与资源选择互斥） */
  sceneSelection: string | null;
  /** 场景剪贴板里是否有东西（控制"粘贴"是否可点） */
  sceneClipboard: boolean;
  /** 动画编辑器里选中的节点（partId 或 partId#overlay） */
  selectedNodeId: string | null;
  saveState: SaveState;
  error: string | null;
  /** 停在首屏的原因（没打开过 / 上次的文件夹不在了） */
  welcomeNote: string | null;
  recent: RecentProject[];
  canUndo: boolean;
  canRedo: boolean;
  busy: string | null;
}

const initialState: EditorState = {
  status: 'booting',
  project: null,
  selection: null,
  sceneSelection: null,
  sceneClipboard: false,
  selectedNodeId: null,
  saveState: 'idle',
  error: null,
  welcomeNote: null,
  recent: [],
  canUndo: false,
  canRedo: false,
  busy: null,
};

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 把工程拆成磁盘上的文件内容 */
function toMetaFile(project: ProjectDoc): ProjectMetaFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    folders: FIXED_FOLDERS.map((f) => f.name),
    folderKinds: project.folderKinds,
    scene: project.scene,
    ground: project.ground,
    assets: {
      images: project.images.map(
        (i): ImageIndexEntry => ({
          id: i.id,
          name: i.name,
          folder: i.folder,
          file: i.file,
          width: i.width,
          height: i.height,
          crop: i.crop,
          tiling: i.tiling ?? 'default',
          nine: i.nine ?? null,
        }),
      ),
      textures: project.textures.map(
        (t): TextureIndexEntry => ({ id: t.id, name: t.name, folder: t.folder, template: t.template, file: `${FOLDERS.textures}/${t.id}.json` }),
      ),
      animations: project.animations.map(
        (a): AnimationIndexEntry => ({
          id: a.id,
          name: a.name,
          folder: a.folder,
          template: a.template,
          file: `${FOLDERS.animations}/${a.id}.json`,
        }),
      ),
      stateMachines: project.stateMachines.map(
        (sm): StateMachineIndexEntry => ({
          id: sm.id,
          name: sm.name,
          folder: sm.folder,
          file: `${FOLDERS.stateMachines}/${sm.id}.json`,
        }),
      ),
      controllers: project.controllers.map(
        (c): ControllerIndexEntry => ({
          id: c.id,
          name: c.name,
          folder: c.folder,
          file: `${FOLDERS.controllers}/${c.id}.json`,
        }),
      ),
      scripts: project.scripts.map(
        (s): ScriptIndexEntry => ({
          id: s.id,
          name: s.name,
          folder: s.folder,
          createdAt: s.createdAt,
          file: scriptFileOf(project.scripts, s),
        }),
      ),
    },
  };
}

/** 读图片像素尺寸（浏览器端解码，纯本地 data URL） */
function probeImage(base64: string, mime: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = `data:${mime};base64,${base64}`;
  });
}

function extOf(p: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(p);
  return (m?.[1] ?? 'png').toLowerCase();
}

function stemOf(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? p;
  return base.replace(/\.[^.]+$/, '');
}

class EditorStore {
  private state: EditorState = initialState;
  private listeners = new Set<() => void>();

  private past: ProjectDoc[] = [];
  private future: ProjectDoc[] = [];
  /** 场景对象剪贴板（存子树，粘贴时重新分配 id） */
  private clip: SceneNode[] | null = null;
  private lastMergeKey: string | null = null;
  private lastPushAt = 0;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving = false;

  /* ---------------- 订阅 ---------------- */

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): EditorState => this.state;

  private set(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /* ---------------- 生命周期 ---------------- */

  async boot(): Promise<void> {
    if (!isDesktop) {
      this.set({
        status: 'welcome',
        welcomeNote: '当前是浏览器模式：无法读写本地文件夹。请用 npm run dev 启动桌面版后再打开工程。',
        recent: [],
      });
      return;
    }
    this.set({ status: 'booting', busy: '正在恢复上次的工程…' });
    try {
      const info = await desk.project.get();
      const recent = await desk.project.recent().catch(() => []);
      if (!info) {
        this.set({ status: 'welcome', busy: null, recent, welcomeNote: '还没有打开过工程。' });
        return;
      }
      const metaPath = joinPath(info.root, 'metadata.json');
      const exists = await desk.fs.exists(metaPath);
      if (!exists) {
        this.set({
          status: 'welcome',
          busy: null,
          recent,
          welcomeNote: `上次打开的文件夹里没有 metadata.json：${info.root}`,
        });
        return;
      }
      await this.loadProject(info.root, info.name);
    } catch (e) {
      this.set({ status: 'welcome', busy: null, welcomeNote: errText(e) });
    }
  }

  async refreshRecent(): Promise<void> {
    if (!isDesktop) return;
    const recent = await desk.project.recent().catch(() => []);
    this.set({ recent });
  }

  async openProjectDialog(): Promise<void> {
    if (!isDesktop) return;
    try {
      const picked = await desk.dialog.open({
        title: '打开工程文件夹',
        directory: true,
        defaultPath: this.state.project?.root,
      });
      if (picked.length === 0) return;
      await this.openProject(picked[0]);
    } catch (e) {
      this.set({ error: errText(e) });
    }
  }

  async openProject(root: string): Promise<void> {
    this.set({ busy: '正在打开工程…', error: null });
    try {
      const metaPath = joinPath(root, 'metadata.json');
      if (!(await desk.fs.exists(metaPath))) {
        this.set({
          busy: null,
          status: 'welcome',
          welcomeNote: `这个文件夹不是 Light 工程（缺少 metadata.json）：${root}`,
        });
        return;
      }
      await desk.project.open(root);
      await this.loadProject(root, '');
    } catch (e) {
      this.set({ busy: null, status: 'welcome', welcomeNote: errText(e) });
    }
  }

  private async loadProject(root: string, fallbackName: string): Promise<void> {
    const raw = await desk.fs.readJson<unknown>(joinPath(root, 'metadata.json'));
    // 版本迁移链：老工程逐级升到当前版本（改动点见 model/migrations.ts）
    const { meta, from, applied } = migrateMetaFile(raw);
    if (applied.length) {
      console.info(`[project] 「${fallbackName || meta.name || root}」数据从 v${from} 迁移到 v${meta.version}（${applied.join('→')}）`);
    }

    const images: ImageAsset[] = [];
    for (const entry of meta.assets?.images ?? []) {
      const tiling = normalizeImageTiling(entry);
      images.push({
        id: entry.id,
        name: entry.name,
        file: entry.file,
        width: entry.width,
        height: entry.height,
        crop: entry.crop ?? null,
        folder: entry.folder || DEFAULT_FOLDER,
        tiling: tiling.tiling,
        nine: tiling.nine,
        createdAt: 0,
      });
    }

    // 内置默认边框随程序升级：自动生成的那张图（历史文件名见 LEGACY_DECOR_FILES，
    // 导入时被重命名的按资产名认）统一写到当前版本的文件名上，并把资产 file 指过去 ——
    // URL 变了才能绕过浏览器图片缓存；用户自己导入 / 改名的图片不受影响。
    const isBuiltinFrame = (file: string, name: string) =>
      [DEFAULT_DECOR_FILE, ...LEGACY_DECOR_FILES].some((f) => file.endsWith(f)) || name === DEFAULT_DECOR_NAME;
    const builtinFrame = images.find((i) => isBuiltinFrame(i.file, i.name));
    if (builtinFrame && isDesktop) {
      try {
        const dataUrl = makeDefaultFrameDataUrl();
        if (dataUrl) {
          const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
          const nextFile = joinPath(FOLDERS.images, DEFAULT_DECOR_FILE);
          await desk.fs.writeBinary(joinPath(root, nextFile), b64);
          const oldFile = builtinFrame.file;
          builtinFrame.file = nextFile; // path 是工程相对的 posix 路径
          builtinFrame.width = DEFAULT_DECOR_SIZE;
          builtinFrame.height = DEFAULT_DECOR_SIZE;
          builtinFrame.crop = null;
          if (oldFile && oldFile !== nextFile) {
            // 旧文件能删就删，删不掉也不影响（已经没有任何资产引用它）
            try {
              await desk.fs.remove(joinPath(root, oldFile));
            } catch {
              /* ignore */
            }
          }
        }
      } catch {
        /* 升级失败不打断加载 */
      }
    }

    const textures: TextureAsset[] = [];
    for (const entry of meta.assets?.textures ?? []) {
      try {
        const doc = await desk.fs.readJson<TextureAsset>(joinPath(root, entry.file));
        textures.push({
          ...doc,
          id: entry.id,
          name: entry.name,
          folder: entry.folder || doc.folder || DEFAULT_FOLDER,
          template: entry.template ?? doc.template,
        });
      } catch {
        textures.push({
          id: entry.id,
          name: entry.name,
          folder: entry.folder || DEFAULT_FOLDER,
          template: entry.template ?? 'single',
          image: null,
          dirs: { S: null, E: null, N: null, W: null },
          createdAt: 0,
        });
      }
    }

    const animations: AnimationAsset[] = [];
    for (const entry of meta.assets?.animations ?? []) {
      try {
        const doc = await desk.fs.readJson<AnimationAsset>(joinPath(root, entry.file));
        animations.push({ ...doc, id: entry.id, name: entry.name, folder: entry.folder || doc.folder || DEFAULT_FOLDER });
      } catch {
        /* 坏文件跳过，不让整个工程打不开 */
      }
    }

    const stateMachines: StateMachineAsset[] = [];
    for (const entry of meta.assets?.stateMachines ?? []) {
      try {
        const doc = await desk.fs.readJson<StateMachineAsset>(joinPath(root, entry.file));
        stateMachines.push({
          ...doc,
          id: entry.id,
          name: entry.name,
          folder: entry.folder || doc.folder || FOLDER_OF_KIND.statemachine,
          states: Array.isArray(doc.states) ? doc.states : [],
          transitions: Array.isArray(doc.transitions) ? doc.transitions : [],
        });
      } catch {
        /* 坏文件跳过 */
      }
    }

    // 老工程里默认机的两个状态常在同一水平线上，正反两条线会重合；载入时错开一次
    for (const sm of stateMachines) staggerOverlappingStates(sm);
    // 老条件（标志位 moving / 输入事件）换成变量条件，新编辑器才能改
    for (const sm of stateMachines) migrateConditions(sm);

    // 控制器：读资产文件（坏文件跳过，变量 / 事件数组兜底）
    const controllers: ControllerAsset[] = [];
    for (const entry of meta.assets?.controllers ?? []) {
      try {
        const doc = await desk.fs.readJson<ControllerAsset>(joinPath(root, entry.file));
        controllers.push({
          ...doc,
          id: entry.id,
          name: entry.name,
          folder: entry.folder || doc.folder || FOLDER_OF_KIND.controller,
          vars: Array.isArray(doc.vars) ? doc.vars : [],
          bindings: Array.isArray(doc.bindings) ? doc.bindings : [],
        });
      } catch {
        /* 坏文件跳过 */
      }
    }

    // 脚本：读纯 .js 源码文件（坏文件跳过，code 兜底为空串）；
    // 老工程的 <id>.js.json（JSON 包裹）在读取时自动迁移成 <名字>.js
    const scripts: ScriptAsset[] = [];
    for (const entry of meta.assets?.scripts ?? []) {
      let file = entry.file;
      let code = '';
      try {
        if (file.endsWith('.js')) {
          code = await desk.fs.readText(joinPath(root, file));
        } else {
          const doc = await desk.fs.readJson<ScriptAsset>(joinPath(root, file));
          code = typeof doc?.code === 'string' ? doc.code : '';
          const taken: { id: string; name: string }[] = [...scripts, { id: entry.id, name: entry.name }];
          const migrated = scriptFileOf(taken, { id: entry.id, name: entry.name });
          await desk.fs.writeText(joinPath(root, migrated), code);
          await desk.fs.remove(joinPath(root, file));
          console.info(`[project] 脚本「${entry.name}」从 ${file} 迁移到 ${migrated}`);
          file = migrated;
        }
      } catch {
        /* 坏文件跳过 */
      }
      if (file.endsWith('.js')) {
        scripts.push({
          id: entry.id,
          name: entry.name,
          folder: entry.folder || FOLDER_OF_KIND.script,
          code,
          createdAt: entry.createdAt ?? Date.now(),
        });
      }
    }

    // 老工程目录改名迁移：图片→贴图、贴图→图组（只换第一层根名）
    for (const a of images) a.folder = migrateFolderPath(a.folder);
    for (const a of textures) a.folder = migrateFolderPath(a.folder);
    for (const a of animations) a.folder = migrateFolderPath(a.folder);

    // 第一层固定目录（贴图 / 图组 / 动画 / 角色 / 敌人 / 地面覆盖物），不允许额外目录；
    // 只保留它们下面的子目录，其它杂项目录丢掉，资产按类型归位。
    const folders: string[] = FIXED_FOLDERS.map((f) => f.name);
    const folderKinds: Record<string, FolderKind> = {};
    for (const f of FIXED_FOLDERS) folderKinds[f.name] = f.kind;

    const rootOf = (path: string) => path.split('/')[0];
    const knownRoot = (name: string) => ROOT_NAMES.includes(name);

    for (const f of meta.folders ?? []) {
      const mapped = migrateFolderPath(f);
      if (!mapped || !mapped.includes('/')) continue;
      const root = rootOf(mapped);
      if (!knownRoot(root)) continue;
      if (!folders.includes(mapped)) folders.push(mapped);
      folderKinds[mapped] = folderKinds[root];
    }

    /** 资产落在哪个目录：不合法（含已丢弃的第一层目录）就回到它那一类的固定目录 */
    const settle = (folder: string, kind: AssetKind): string => {
      const fallback = FOLDER_OF_KIND[kind];
      if (!folder) return fallback;
      const root = rootOf(folder);
      if (!knownRoot(root) || folderKinds[root] !== kind) return fallback;
      if (folder === root) return root;
      if (!folders.includes(folder)) {
        folders.push(folder);
        folderKinds[folder] = folderKinds[root];
      }
      return folder;
    };
    for (const a of images) a.folder = settle(a.folder, 'image');
    for (const a of textures) a.folder = settle(a.folder, 'texture');
    for (const a of animations) a.folder = settle(a.folder, 'animation');
    for (const s of stateMachines) s.folder = settle(s.folder, 'statemachine');
    for (const c of controllers) c.folder = settle(c.folder, 'controller');
    for (const s of scripts) s.folder = settle(s.folder, 'script');

    // 场景对象：过滤掉坏数据，父级找不到的挂回根层
    const rawScene = Array.isArray(meta.scene) ? meta.scene : [];
    const scene: SceneNode[] = [];
    const validKinds = new Set(SCENE_KINDS.map((k) => k.id));
    for (const n of rawScene) {
      if (!n || !n.id || !validKinds.has(n.kind)) continue;
      scene.push({
        id: n.id,
        name: n.name || sceneKindMeta(n.kind).name,
        kind: n.kind,
        parentId: n.parentId ?? null,
        order: Number.isFinite(n.order) ? n.order : scene.length,
        x: Number.isFinite(n.x) ? n.x : 0,
        z: Number.isFinite(n.z) ? n.z : 0,
        open: n.open,
        ground: n.kind === 'ground' && n.ground ? normalizeGround(n.ground) : undefined,
        mapui: n.kind === 'mapui' ? normalizeMapui(n.mapui) : undefined,
        scriptIds: Array.isArray(n.scriptIds) ? n.scriptIds.filter((x) => typeof x === 'string') : [],
        minimapShow: typeof n.minimapShow === 'boolean' ? n.minimapShow : undefined,
        minimapIcon: typeof n.minimapIcon === 'string' ? n.minimapIcon : undefined,
      });
    }
    const ids = new Set(scene.map((n) => n.id));
    for (const n of scene) if (n.parentId && !ids.has(n.parentId)) n.parentId = null;

    // 兼容老工程①：地面类型 / 边界贴图 / 地图元素装饰以前引用「图组」，
    // 现在统一引用「贴图」目录的单张贴图 —— 图组 id 解包成它的源图 id
    const groupSource = new Map<string, string>(); // 图组 id → 源图 id
    const toImageId = (id: string): string => {
      if (images.some((i) => i.id === id)) return id;
      let mapped: string | null = groupSource.get(id) ?? null;
      if (!mapped) {
        const tex = textures.find((t) => t.id === id);
        mapped = tex ? (tex.image ?? tex.dirs.S ?? tex.dirs.E ?? tex.dirs.N ?? tex.dirs.W ?? null) : null;
        if (mapped) groupSource.set(id, mapped);
      }
      return mapped ?? id;
    };
    for (const n of scene) {
      if (n.kind === 'ground' && n.ground) {
        for (const t of Object.keys(n.ground.types) as (keyof typeof n.ground.types)[]) {
          const s = n.ground.types[t];
          if (s?.textureId) s.textureId = toImageId(s.textureId);
        }
        for (const e of n.ground.edges) if (e.textureId) e.textureId = toImageId(e.textureId);
      }
      if (n.kind === 'mapui' && n.mapui?.decorId) n.mapui.decorId = toImageId(n.mapui.decorId);
    }

    // 内置默认边框强制「单张」：圆环图沿框边拼接会变成好几圈，没有重复的意义。
    // 用户自己换的装饰贴图保留各自的重复设置。
    if (builtinFrame) {
      for (const n of scene) {
        if (n.kind === 'mapui' && n.mapui && n.mapui.decorId === builtinFrame.id) n.mapui.decorLoop = false;
      }
    }

    // 兼容老工程②：地皮参数以前挂在工程上，现在属于每一块地面自己
    const legacyGround = normalizeGround(meta.ground);
    const groundNodes = scene.filter((n) => n.kind === 'ground');
    groundNodes.forEach((n, i) => {
      if (n.ground) return;
      n.ground = i === 0 && legacyGround.map ? { ...legacyGround } : { ...legacyGround, map: '' };
    });
    if (groundNodes.length === 0 && legacyGround.map) {
      // 老工程只有一张地图、没有地面对象：补一个把它接住
      scene.push({
        id: shortId('obj'),
        name: '地面',
        kind: 'ground',
        parentId: null,
        order: scene.length,
        x: 0,
        z: 0,
        open: true,
        ground: { ...legacyGround },
      });
    }

    // 老工程：角色对象上没有 character 字段 → 补一套默认数值
    for (const n of scene) {
      if (n.kind === 'character') n.character = normalizeCharacter(n.character);
    }

    // 一个工程至少有一个控制器：没有就建「移动控制器」（WASD / 方向键 → moving / dirX / dirY）
    if (controllers.length === 0) controllers.push(makeMoveController());
    const defaultCtrl = controllers[0];

    // 一个工程至少有一个状态机：没有就把「待机 ⇄ 行走」建出来，
    // 以后加攻击 / 受击 / 技能只需要往它上面加状态和连线。
    if (stateMachines.length === 0) {
      stateMachines.push(makeDefaultStateMachine(animations[0] ?? null, defaultCtrl));
    }
    const defaultSm = stateMachines[0];

    // 状态机的变量来源：没绑或绑的控制器已经不在 → 用默认控制器
    for (const sm of stateMachines) {
      if (!sm.controllerId || !controllers.some((c) => c.id === sm.controllerId)) sm.controllerId = defaultCtrl.id;
    }

    for (const n of scene) {
      if (n.kind !== 'character' || !n.character) continue;
      if (!n.character.stateMachineId || !stateMachines.some((sm) => sm.id === n.character!.stateMachineId)) {
        n.character.stateMachineId = defaultSm.id;
      }
      if (!n.character.animationId && animations[0]) n.character.animationId = animations[0].id;
      // 控制器引用：去掉已经不存在的，一个都没有就绑默认控制器
      n.character.controllerIds = (n.character.controllerIds ?? []).filter((id) => controllers.some((c) => c.id === id));
      if (n.character.controllerIds.length === 0) n.character.controllerIds = [defaultCtrl.id];
    }

    // 有动画但一个角色都没有：自动放一个到第一块地面中心，打开工程就能直接跑起来
    if (animations.length > 0 && !scene.some((n) => n.kind === 'character')) {
      const g = groundNodes[0];
      scene.push({
        id: shortId('obj'),
        name: '角色',
        kind: 'character',
        parentId: null,
        order: scene.length,
        x: g?.x ?? 0,
        z: g?.z ?? 0,
        open: true,
        character: {
          ...defaultCharacter(),
          animationId: animations[0].id,
          stateMachineId: defaultSm.id,
          controllerIds: [defaultCtrl.id],
        },
      });
    }

    const project: ProjectDoc = {
      root,
      name: meta.name || fallbackName || '未命名工程',
      createdAt: meta.createdAt ?? Date.now(),
      updatedAt: meta.updatedAt ?? Date.now(),
      folders,
      folderKinds,
      images,
      textures,
      animations,
      stateMachines,
      controllers,
      scripts,
      scene,
      ground: normalizeGround(meta.ground),
    };

    this.past = [];
    this.future = [];
    this.lastMergeKey = null;
    this.clip = null;
    const first = animations[0] ? { kind: 'animation' as const, id: animations[0].id } : textures[0] ? { kind: 'texture' as const, id: textures[0].id } : images[0] ? { kind: 'image' as const, id: images[0].id } : null;
    this.set({
      status: 'ready',
      project,
      selection: first,
      sceneSelection: null,
      sceneClipboard: false,
      selectedNodeId: null,
      busy: null,
      error: null,
      welcomeNote: null,
      saveState: 'saved',
      canUndo: false,
      canRedo: false,
      recent: await desk.project.recent().catch(() => this.state.recent),
    });
    void desk.window.setTitle(`Light Editor — ${project.name}`);
  }

  async closeProject(): Promise<void> {
    await this.saveNow();
    if (isDesktop) await desk.project.close().catch(() => undefined);
    this.past = [];
    this.future = [];
    this.clip = null;
    this.set({
      status: 'welcome',
      project: null,
      selection: null,
      sceneSelection: null,
      sceneClipboard: false,
      selectedNodeId: null,
      welcomeNote: '工程已关闭。',
      canUndo: false,
      canRedo: false,
      recent: await desk.project.recent().catch(() => this.state.recent),
    });
    void desk.window.setTitle('Light Editor');
  }

  /**
   * 新建工程：在 parentDir 下创建 name 文件夹，写入固定目录结构与 metadata.json。
   * withSample = 附带内置示例素材（工程师素体 / 装备 / 一条待机动画）。
   */
  async createProject(parentDir: string, name: string, withSample: boolean): Promise<void> {
    this.set({ busy: '正在创建工程…', error: null });
    try {
      const root = joinPath(parentDir, name);
      if (await desk.fs.exists(joinPath(root, 'metadata.json'))) {
        this.set({ busy: null, error: `目标文件夹里已经有工程：${root}` });
        return;
      }
      await desk.fs.mkdirp(joinPath(root, FOLDERS.images));
      await desk.fs.mkdirp(joinPath(root, FOLDERS.textures));
      await desk.fs.mkdirp(joinPath(root, FOLDERS.animations));
      await desk.fs.mkdirp(joinPath(root, FOLDERS.stateMachines));
      await desk.fs.mkdirp(joinPath(root, FOLDERS.controllers));
      await desk.fs.mkdirp(joinPath(root, FOLDERS.scripts));

      const project: ProjectDoc = {
        root,
        name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        folders: FIXED_FOLDERS.map((f) => f.name),
        folderKinds: Object.fromEntries(FIXED_FOLDERS.map((f) => [f.name, f.kind])) as Record<string, FolderKind>,
        images: [],
        textures: [],
        animations: [],
        stateMachines: [],
        controllers: [],
        scripts: [],
        scene: [],
        ground: defaultGroundConfig(),
      };

      if (withSample) {
        await seedSampleProject(project, {
          addImageFromFile: (src, name) => this.importImageFile(project, src, name),
          registerTexture: (tex) => project.textures.push(tex),
          registerAnimation: (anim) => project.animations.push(anim),
        });
      }

      // 新工程自带「移动控制器」+ 默认状态机（待机 ⇄ 行走）；没有动画时先建空壳，之后绑上动画就能用
      const ctrl = makeMoveController();
      project.controllers.push(ctrl);
      // 场景主角优先用「机械师」（5 骨架），没有示例素材时才退回第一条动画
      const mainAnim =
        project.animations.find((a) => a.template === 'humanoid5') ?? project.animations[0] ?? null;
      const sm = makeDefaultStateMachine(mainAnim, ctrl);
      project.stateMachines.push(sm);

      // 新工程先摆一块"已经生成好的地面"：打开就能看见地皮，角色站上去不会浮在虚空里
      {
        const cfg = { ...clone(project.ground), map: '' };
        const gen = generateGroundMap(cfg);
        const groundCfg = { ...cfg, w: gen.w, h: gen.h, map: gen.map, gen: 1 };
        project.scene.push({
          id: shortId('obj'),
          name: '地面',
          kind: 'ground',
          parentId: null,
          order: 0,
          x: 0,
          z: 0,
          open: true,
          ground: groundCfg,
        });
        project.ground = { ...project.ground, w: gen.w, h: gen.h, map: gen.map, gen: 1 };
      }

      // 带示例素材时直接摆一个角色到场景里：打开工程点「▶」就能用 WASD 走动
      if (project.animations[0]) {
        project.scene.push({
          id: shortId('obj'),
          name: '角色',
          kind: 'character',
          parentId: null,
          order: 1,
          x: 0,
          z: 0,
          open: true,
          character: {
            ...defaultCharacter(),
            animationId: mainAnim?.id ?? null,
            stateMachineId: sm.id,
            controllerIds: [ctrl.id],
          },
        });
      }

      await desk.project.open(root);
      await this.writeAll(project);
      await this.loadProject(root, name);
    } catch (e) {
      this.set({ busy: null, error: errText(e) });
      throw e;
    }
  }

  /* ---------------- 历史 ---------------- */

  private pushHistory(mergeKey?: string): void {
    if (!this.state.project) return;
    const now = Date.now();
    const merge = !!mergeKey && this.lastMergeKey === mergeKey && now - this.lastPushAt < 800;
    this.lastMergeKey = mergeKey ?? null;
    this.lastPushAt = now;
    if (merge) return;
    this.past.push(clone(this.state.project));
    if (this.past.length > 80) this.past.shift();
    this.future = [];
    this.set({ canUndo: true, canRedo: false });
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev || !this.state.project) return;
    this.future.push(clone(this.state.project));
    this.set({ project: prev, canUndo: this.past.length > 0, canRedo: true });
    this.markDirty();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next || !this.state.project) return;
    this.past.push(clone(this.state.project));
    this.set({ project: next, canUndo: true, canRedo: this.future.length > 0 });
    this.markDirty();
  }

  /* ---------------- 选择 ---------------- */

  select(kind: AssetKind, id: string): void {
    this.set({ selection: { kind, id }, sceneSelection: null, selectedNodeId: null });
  }

  /** 选中场景对象（会清掉资源选择，右侧属性面板跟着切） */
  selectScene(id: string | null): void {
    this.set({ sceneSelection: id, selection: id ? null : this.state.selection, selectedNodeId: null });
  }

  selectNode(nodeId: string | null): void {
    this.set({ selectedNodeId: nodeId });
  }

  sceneNode(id: string | null): SceneNode | null {
    if (!id) return null;
    return this.state.project?.scene.find((n) => n.id === id) ?? null;
  }

  /* ---------------- 变更入口 ---------------- */

  private mutate(fn: (p: ProjectDoc) => void, mergeKey?: string): void {
    if (!this.state.project) return;
    this.pushHistory(mergeKey);
    const next = clone(this.state.project);
    fn(next);
    next.updatedAt = Date.now();
    this.set({ project: next });
    this.markDirty();
  }

  renameAsset(kind: AssetKind, id: string, name: string, mergeKey?: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const project = this.state.project;
    // 脚本重命名：源码文件名跟名字走，先把旧文件记下来，改完后清掉
    const oldScript = kind === 'script' && project ? project.scripts.find((x) => x.id === id) ?? null : null;
    const oldFile = oldScript && project ? scriptFileOf(project.scripts, oldScript) : null;
    this.mutate((p) => {
      const list = assetList(p, kind);
      const item = list.find((x) => x.id === id);
      if (item) item.name = uniqueName(trimmed, list.filter((x) => x.id !== id).map((x) => x.name));
    }, mergeKey ?? `rename:${kind}:${id}`);
    const after = this.state.project;
    const newScript = kind === 'script' && after ? after.scripts.find((x) => x.id === id) ?? null : null;
    const newFile = newScript && after ? scriptFileOf(after.scripts, newScript) : null;
    if (oldFile && newFile && oldFile !== newFile) {
      void desk.fs.remove(joinPath(after!.root, oldFile)).catch(() => {
        /* 旧文件不存在也不影响 */
      });
    }
  }

  /* ---------------- 场景对象 ---------------- */

  /**
   * 新增场景对象。parentId 是场景根时传 null（或省略）。
   * 位置：不传就沿着一圈圈散开，避免全部叠在原点。
   */
  addSceneNode(kind: SceneKind, name?: string, parentId: string | null = null, pos?: { x: number; z: number }): string | null {
    const p = this.state.project;
    if (!p) return null;
    const meta = sceneKindMeta(kind);
    const count = p.scene.length;
    const ring = 1.5 + Math.floor(count / 6) * 1.3;
    const ang = ((count % 6) / 6) * Math.PI * 2 + 0.4;
    const at = pos ?? {
      x: Math.round(Math.cos(ang) * ring * 2) / 2,
      z: Math.round(Math.sin(ang) * ring * 2) / 2,
    };
    const id = `obj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.mutate((doc) => {
      doc.scene.push({
        id,
        name: uniqueSceneName(doc.scene, parentId, (name ?? '').trim() || meta.baseName),
        kind,
        parentId,
        order: nextOrder(doc.scene, parentId),
        x: at.x,
        z: at.z,
        open: true,
        // 每块地面有自己的一套地皮参数，互不影响；新建时沿用上一块的参数，但地图要空着
        ...(kind === 'ground' ? { ground: { ...clone(p.ground), map: '' } } : {}),
        // 地图元素：默认参数（圆形、中等显示范围、用内置装饰样式）
        ...(kind === 'mapui' ? { mapui: defaultMapui() } : {}),
        // 角色：默认数值 + 自动绑上工程里的第一个状态机与控制器（一个都没有就现建）
        ...(kind === 'character'
          ? {
              character: (() => {
                if (doc.controllers.length === 0) doc.controllers.push(makeMoveController());
                const ctrl = doc.controllers[0];
                if (doc.stateMachines.length === 0) {
                  doc.stateMachines.push(makeDefaultStateMachine(doc.animations[0] ?? null, ctrl));
                }
                return {
                  ...defaultCharacter(),
                  animationId: doc.animations[0]?.id ?? null,
                  stateMachineId: doc.stateMachines[0].id,
                  controllerIds: [ctrl.id],
                };
              })(),
            }
          : {}),
      });
      const parent = parentId ? doc.scene.find((n) => n.id === parentId) : null;
      if (parent) parent.open = true;
    });
    this.set({ sceneSelection: id, selection: null });
    // 地图元素一建好就自动配好饥荒风默认边框（不用用户再点按钮）
    if (kind === 'mapui') void this.ensureMapuiDecor(id);
    return id;
  }

  renameSceneNode(id: string, name: string, mergeKey?: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.mutate((p) => {
      const node = p.scene.find((n) => n.id === id);
      if (!node) return;
      node.name = uniqueSceneName(p.scene.filter((n) => n.id !== id), node.parentId, trimmed);
    }, mergeKey ?? `scene-name:${id}`);
  }

  /** 拖拽 / 输入坐标改位置（合并到一次撤销里，避免每帧压一条历史） */
  moveSceneNodeTo(id: string, x: number, z: number, mergeKey?: string): void {
    this.mutate((p) => {
      const node = p.scene.find((n) => n.id === id);
      if (!node) return;
      node.x = Math.round(x * 2) / 2;
      node.z = Math.round(z * 2) / 2;
    }, mergeKey ?? `scene-pos:${id}`);
  }

  setSceneNodeOpen(id: string, open: boolean): void {
    this.mutate((p) => {
      const node = p.scene.find((n) => n.id === id);
      if (node) node.open = open;
    }, `scene-open:${id}`);
  }

  /** 删除对象（连子树一起删，撤销可救回） */
  deleteSceneNode(id: string): void {
    const p = this.state.project;
    if (!p) return;
    const ids = new Set(subtreeIds(p.scene, id));
    const wasSelected = this.state.sceneSelection ? ids.has(this.state.sceneSelection) : false;
    this.mutate((doc) => {
      doc.scene = doc.scene.filter((n) => !ids.has(n.id));
    });
    if (wasSelected) this.set({ sceneSelection: null });
  }

  /**
   * 移动对象：改父级 + 改顺序。
   * beforeId 为 null 表示放到该层末尾；否则插到 beforeId 之前。
   */
  moveSceneNode(id: string, parentId: string | null, beforeId: string | null = null): void {
    const p = this.state.project;
    if (!p) return;
    if (parentId && isSelfOrDescendant(p.scene, id, parentId)) {
      this.set({ error: '不能把一个对象拖进它自己的子树里。' });
      return;
    }
    this.mutate((doc) => {
      const node = doc.scene.find((n) => n.id === id);
      if (!node) return;
      node.parentId = parentId;
      const sibs = childrenOf(doc.scene, parentId).filter((s) => s.id !== id);
      let index = sibs.length;
      if (beforeId) {
        const i = sibs.findIndex((s) => s.id === beforeId);
        if (i >= 0) index = i;
      }
      sibs.splice(index, 0, node);
      sibs.forEach((s, i) => {
        s.order = i;
      });
      const parent = parentId ? doc.scene.find((n) => n.id === parentId) : null;
      if (parent) parent.open = true;
    });
  }

  /** 复制对象到剪贴板（含子树） */
  copySceneNode(id: string): void {
    const p = this.state.project;
    if (!p) return;
    const sub = collectSubtree(p.scene, id);
    if (sub.length === 0) return;
    this.clip = clone(sub);
    this.set({ sceneClipboard: true });
  }

  /**
   * 粘贴剪贴板。目标层级：
   *  - 显式给了 parentId 就用它；
   *  - 选中的是空节点 → 粘进这个分组里；
   *  - 选中了别的对象 → 粘成它的兄弟（排在它后面）；
   *  - 什么都没选 → 场景根层末尾。
   */
  pasteSceneNode(parentId?: string | null): string | null {
    const p = this.state.project;
    if (!p || !this.clip) return null;
    const sel = this.sceneNode(this.state.sceneSelection);
    let target: string | null;
    let beforeId: string | null = null;
    if (parentId !== undefined) {
      target = parentId;
    } else if (sel && sel.kind === 'group') {
      target = sel.id;
    } else {
      target = sel?.parentId ?? null;
      if (sel) {
        const sibs = childrenOf(p.scene, sel.parentId);
        const i = sibs.findIndex((s) => s.id === sel.id);
        beforeId = i >= 0 ? (sibs[i + 1]?.id ?? null) : null;
      }
    }
    return this.insertClip(this.clip, target, beforeId);
  }

  /** 复制一份（原地右侧，同级） */
  duplicateSceneNode(id: string): string | null {
    const p = this.state.project;
    if (!p) return null;
    const src = p.scene.find((n) => n.id === id);
    if (!src) return null;
    const sibs = childrenOf(p.scene, src.parentId);
    const i = sibs.findIndex((s) => s.id === id);
    const beforeId = i >= 0 ? (sibs[i + 1]?.id ?? null) : null;
    return this.insertClip(collectSubtree(p.scene, id), src.parentId, beforeId, ' 副本');
  }

  /** 把一段子树插入到指定层（内部用；返回新的根 id） */
  private insertClip(clip: SceneNode[], parentId: string | null, beforeId: string | null, suffix = ''): string | null {
    if (clip.length === 0) return null;
    const idMap = new Map<string, string>();
    let seed = Date.now().toString(36);
    for (const n of clip) {
      seed = `${seed}${Math.random().toString(36).slice(2, 1 + 4)}`;
      idMap.set(n.id, `obj_${seed.slice(0, 10)}${Math.random().toString(36).slice(2, 5)}`);
    }
    const isRootOfClip = (n: SceneNode) => !n.parentId || !idMap.has(n.parentId);
    this.mutate((doc) => {
      for (const n of clip) {
        const newParent = n.parentId && idMap.has(n.parentId) ? idMap.get(n.parentId)! : parentId;
        const rootOfClip = isRootOfClip(n);
        doc.scene.push({
          id: idMap.get(n.id)!,
          name: n.name,
          kind: n.kind,
          parentId: newParent,
          order: nextOrder(doc.scene, newParent),
          // 粘贴出来的错开半格，免得跟原件完全重叠看不见
          x: rootOfClip ? Math.round((n.x + 0.5) * 2) / 2 : n.x,
          z: rootOfClip ? Math.round((n.z + 0.5) * 2) / 2 : n.z,
          open: n.open ?? true,
        });
      }
      // 根层重新排一次顺序，让"插到 beforeId 之前"生效
      const sibs = childrenOf(doc.scene, parentId);
      const moving = sibs.filter((s) => [...idMap.values()].includes(s.id));
      const rest = sibs.filter((s) => !moving.includes(s));
      const at = beforeId ? rest.findIndex((s) => s.id === beforeId) : -1;
      rest.splice(at >= 0 ? at : rest.length, 0, ...moving);
      rest.forEach((s, i) => {
        s.order = i;
      });
      // 名字去重
      for (const n of clip) {
        if (!isRootOfClip(n)) continue;
        const created = doc.scene.find((s) => s.id === idMap.get(n.id)!);
        if (created) {
          created.name = uniqueSceneName(
            doc.scene.filter((s) => s.id !== created.id),
            parentId,
            `${n.name}${suffix}`,
          );
        }
      }
    });
    const firstRoot = clip.find(isRootOfClip);
    const newId = firstRoot ? (idMap.get(firstRoot.id) ?? null) : null;
    if (newId) this.set({ sceneSelection: newId, selection: null });
    return newId;
  }

  /* ---------------- 地皮（每块地面各有一套参数与生成结果） ---------------- */

  /** 某块地面的地皮配置（不是地面对象就返回 null） */
  groundOf(nodeId: string): GroundConfig | null {
    const p = this.state.project;
    if (!p) return null;
    return p.scene.find((n) => n.id === nodeId)?.ground ?? null;
  }

  /**
   * 改某块地面的生成参数。注意：这里只改参数，不会重算地图 ——
   * 地图只有点"重新生成"（regenerateGround）才会变。
   * 同时记成"下一块新建地面的默认值"，新地面不用每次都从头调。
   */
  setGround(nodeId: string, patch: Partial<GroundConfig>, mergeKey?: string): void {
    this.mutate((p) => {
      const node = p.scene.find((n) => n.id === nodeId);
      if (!node?.ground) return;
      node.ground = { ...node.ground, ...patch };
      p.ground = { ...p.ground, ...patch, map: '' };
    }, mergeKey);
  }

  setGroundType(nodeId: string, id: GroundTypeId, patch: Partial<GroundTypeSetting>, mergeKey?: string): void {
    this.mutate((p) => {
      const node = p.scene.find((n) => n.id === nodeId);
      if (!node?.ground) return;
      node.ground.types[id] = { ...node.ground.types[id], ...patch };
    }, mergeKey ?? `ground:${nodeId}:${id}`);
  }

  /* ---------- 边界中间贴图（两种地皮之间的一条手绘边） ---------- */

  /** 给两种地皮新增一条边界贴图；重复组合 / 超上限 / 同种地皮都返回 null */
  addGroundEdge(nodeId: string, a: GroundTypeId, b: GroundTypeId): string | null {
    if (a === b) return null;
    const cfg = this.groundOf(nodeId);
    if (!cfg || cfg.edges.length >= MAX_GROUND_EDGES) return null;
    const key = groundEdgeKey(a, b);
    if (cfg.edges.some((e) => groundEdgeKey(e.a, e.b) === key)) return null;
    const edge = newGroundEdge(a, b);
    this.mutate((p) => {
      const node = p.scene.find((n) => n.id === nodeId);
      if (!node?.ground) return;
      node.ground.edges = [...node.ground.edges, edge];
    }, `ground-edge-add:${nodeId}`);
    return edge.id;
  }

  setGroundEdge(nodeId: string, edgeId: string, patch: Partial<GroundEdge>, mergeKey?: string): void {
    this.mutate((p) => {
      const node = p.scene.find((n) => n.id === nodeId);
      if (!node?.ground) return;
      node.ground.edges = node.ground.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e));
    }, mergeKey ?? `ground-edge:${nodeId}:${edgeId}`);
  }

  removeGroundEdge(nodeId: string, edgeId: string): void {
    this.mutate((p) => {
      const node = p.scene.find((n) => n.id === nodeId);
      if (!node?.ground) return;
      node.ground.edges = node.ground.edges.filter((e) => e.id !== edgeId);
    }, `ground-edge-del:${nodeId}:${edgeId}`);
  }

  /** 重新生成某块地面的地皮（唯一会改动 map 的入口） */
  regenerateGround(nodeId: string): Record<GroundTypeId, number> | null {
    const p = this.state.project;
    const node = p?.scene.find((n) => n.id === nodeId);
    if (!p || !node?.ground) return null;
    const gen = generateGroundMap(node.ground);
    this.pushHistory();
    const next = clone(p);
    const target = next.scene.find((n) => n.id === nodeId);
    if (!target?.ground) return null;
    target.ground = { ...target.ground, w: gen.w, h: gen.h, map: gen.map, gen: (target.ground.gen ?? 0) + 1 };
    next.ground = { ...next.ground, w: gen.w, h: gen.h, map: gen.map };
    next.updatedAt = Date.now();
    this.set({ project: next });
    this.markDirty();
    return gen.counts;
  }

  /** 某块地面的格子（没生成过返回 null） */
  groundMap(nodeId: string): ReturnType<typeof groundTiles> {
    const cfg = this.groundOf(nodeId);
    return cfg ? groundTiles(cfg) : null;
  }

  groundCounts(nodeId: string): Record<GroundTypeId, number> | null {
    const map = this.groundMap(nodeId);
    return map ? tileCounts(map.tiles) : null;
  }

  /** 拿到（必要时新建）一块地面，好让"点地面改参数"有落点 */
  ensureGroundNode(): string | null {
    const p = this.state.project;
    if (!p) return null;
    const hit = p.scene.find((n) => n.kind === 'ground');
    if (hit) return hit.id;
    return this.addSceneNode('ground', '地面');
  }

  /* ---------------- 地图元素（屏幕 UI） ---------------- */

  setMapui(nodeId: string, patch: Partial<MapUiConfig>, mergeKey?: string): void {
    this.mutate((p) => {
      const n = p.scene.find((x) => x.id === nodeId);
      if (n?.mapui) n.mapui = { ...n.mapui, ...patch };
    }, mergeKey);
  }

  /**
   * 给地图元素配好装饰贴图 —— 「贴图」目录的图片资产：
   * 没有就用内置的饥荒风圆环现画一张（同一工程只画一次，之后沿用同一张）。
   * 老数据里 decorId 指向图组的，由 loadProject 解包回图片 id。
   *
   * 注意：这里**不做换版本文件名的操作**。运行中的快照还引用着当前文件，
   * 一旦在这里改名 + 删旧文件，正在显示的那张图立刻变成坏链（画面上就是"没有环"）。
   * 版本升级只在 loadProject（重新载入工程、重建成快照）时做。
   */
  async ensureMapuiDecor(nodeId: string): Promise<string | null> {
    const p0 = this.state.project;
    const node0 = p0?.scene.find((n) => n.id === nodeId);
    if (!p0 || !node0 || node0.kind !== 'mapui') return null;
    if (node0.mapui?.decorId && imageById(p0, node0.mapui.decorId)) return node0.mapui.decorId;

    // 已经有内置边框资产就直接用（按名字认，老的按历史文件名认）
    const existing =
      p0.images.find((i) => i.name === DEFAULT_DECOR_NAME) ??
      p0.images.find((i) => [DEFAULT_DECOR_FILE, ...LEGACY_DECOR_FILES].some((x) => i.file.endsWith(x))) ??
      null;
    if (existing) {
      this.mutate((doc) => {
        const n = doc.scene.find((x) => x.id === nodeId);
        if (n?.mapui) n.mapui = { ...n.mapui, decorId: existing.id, decorLoop: false };
      });
      return existing.id;
    }

    if (!isDesktop) return null;
    const dataUrl = makeDefaultFrameDataUrl();
    if (!dataUrl) return null;
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    // 先写一份临时文件再走正常的导入流程（导入会复制成 img_xxx.png 并登记资产），
    // 临时文件随即删掉，避免 assets 里多出一张没人引用的图。
    const tmpRel = joinPath(FOLDERS.images, '.tmp_mapui_frame.png');
    const tmpAbs = joinPath(p0.root, tmpRel);
    let img: ImageAsset | null = null;
    try {
      await desk.fs.writeBinary(tmpAbs, base64);
      img = await this.importImageFile(this.state.project ?? p0, tmpAbs, DEFAULT_DECOR_NAME, FOLDER_OF_KIND.image);
    } catch {
      img = null;
    }
    try {
      await desk.fs.remove(tmpAbs);
    } catch {
      /* 临时文件删不掉无所谓 */
    }
    if (!img) return null;

    const finalImg = img;
    this.mutate((doc) => {
      // 图片如果漏在当前文档外（异步竞争导致写进了旧快照），这里补回去
      if (!doc.images.some((i) => i.id === finalImg.id)) doc.images.push(finalImg);
      const n = doc.scene.find((x) => x.id === nodeId);
      if (n?.mapui) n.mapui = { ...n.mapui, decorId: finalImg.id, decorLoop: false };
    });
    return finalImg.id;
  }

  /* ---------------- 虚拟目录（第一层固定，子目录可增删） ---------------- */

  /** 目录类型（图片 / 贴图 / 动画 / 角色 / 敌人 / 地面覆盖物） */
  folderKind(path: string): FolderKind {
    return this.state.project?.folderKinds[path] ?? 'image';
  }

  /** 在 parent 下新建子目录（类型继承父目录），返回最终路径 */
  addFolder(parent: string, name: string): string {
    const p = this.state.project;
    if (!p) return '';
    const kind = p.folderKinds[parent];
    if (!kind) return '';
    const dirName = uniqueFolderName(name, siblingNames(p.folders, parent));
    const path = childPath(parent, dirName);
    this.mutate((doc) => {
      doc.folders.push(path);
      doc.folderKinds[path] = kind;
    });
    return path;
  }

  /** 重命名子目录（第一层固定目录不能改名）；连带子目录与资产 */
  renameFolder(path: string, name: string): string {
    const p = this.state.project;
    const trimmed = name.trim();
    if (!p || !trimmed) return path;
    if (ROOT_NAMES.includes(path as (typeof ROOT_NAMES)[number])) {
      this.set({ error: `「${path}」是第一层固定目录，不能重命名。` });
      return path;
    }
    const parent = parentPath(path);
    const dirName = uniqueFolderName(trimmed, siblingNames(p.folders, parent).filter((n) => n !== baseName(path)));
    const next = childPath(parent, dirName);
    if (next === path) return path;
    this.mutate((doc) => {
      const renamed = (old: string) => next + old.slice(path.length);
      doc.folders = doc.folders.map((f) => (isInside(f, path) ? renamed(f) : f));
      const kinds: Record<string, FolderKind> = {};
      for (const [f, k] of Object.entries(doc.folderKinds)) kinds[isInside(f, path) ? renamed(f) : f] = k;
      doc.folderKinds = kinds;
      for (const list of [doc.images, doc.textures, doc.animations, doc.stateMachines, doc.controllers, doc.scripts]) {
        for (const a of list) if (isInside(a.folder, path)) a.folder = renamed(a.folder);
      }
    });
    return next;
  }

  /** 只删空目录（无资产、无子目录），且第一层固定目录不能删 */
  deleteFolder(path: string): boolean {
    const p = this.state.project;
    if (!p) return false;
    if (ROOT_NAMES.includes(path as (typeof ROOT_NAMES)[number])) {
      this.set({ error: `「${path}」是第一层固定目录，不能删除。` });
      return false;
    }
    const assets = [...p.images, ...p.textures, ...p.animations, ...p.stateMachines, ...p.controllers, ...p.scripts].filter((a) => isInside(a.folder, path)).length;
    if (assets > 0) {
      this.set({ error: `目录「${baseName(path)}」里还有 ${assets} 个资源，先把它们移走或删掉。` });
      return false;
    }
    if (p.folders.some((f) => parentPath(f) === path)) {
      this.set({ error: `目录「${baseName(path)}」里还有子目录，先删掉子目录。` });
      return false;
    }
    this.mutate((doc) => {
      doc.folders = doc.folders.filter((f) => f !== path);
      delete doc.folderKinds[path];
    });
    return true;
  }

  /** 把一批资源挪到目标目录（类型必须匹配）；返回真正移动的数量 */
  moveAssets(refs: AssetRef[], to: string): number {
    const p = this.state.project;
    if (!p) return 0;
    const kind = p.folderKinds[to];
    if (!kind) return 0;
    const valid = refs.filter((r) => r.kind === kind);
    const skipped = refs.length - valid.length;
    if (valid.length === 0) {
      this.set({ error: `「${to}」是${kindLabel(kind)}目录，只能放${kindLabel(kind)}。` });
      return 0;
    }
    this.mutate((doc) => {
      for (const ref of valid) {
        const asset = assetList(doc, ref.kind).find((a) => a.id === ref.id);
        if (asset) asset.folder = to;
      }
    });
    if (skipped > 0) this.set({ error: `有 ${skipped} 个资源类型不匹配，没有移动。` });
    return valid.length;
  }

  /** 把单个资源挪到另一个目录（属性面板用） */
  setAssetFolder(kind: AssetKind, id: string, folder: string): void {
    this.moveAssets([{ kind, id }], folder);
  }

  /* ---------------- 图片 ---------------- */

  /** 把外部图片复制进工程并登记（保证工程自包含） */
  async importImageFile(project: ProjectDoc, srcPath: string, name?: string, folder = DEFAULT_FOLDER): Promise<ImageAsset | null> {
    const bin = await desk.fs.readBinary(srcPath);
    const mime = bin.mime || 'image/png';
    const { w, h } = await probeImage(bin.base64, mime);
    const id = `img_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const ext = extOf(srcPath);
    const rel = `${FOLDERS.images}/${id}.${ext}`;
    await desk.fs.writeBinary(joinPath(project.root, rel), bin.base64);
    const base = name ?? stemOf(srcPath);
    const asset: ImageAsset = {
      id,
      name: uniqueName(base, project.images.map((i) => i.name)),
      folder: folder || DEFAULT_FOLDER,
      file: rel,
      width: w,
      height: h,
      crop: null,
      createdAt: Date.now(),
    };
    project.images.push(asset);
    return asset;
  }

  async importImagesDialog(folder = DEFAULT_FOLDER): Promise<void> {
    if (!isDesktop || !this.state.project) return;
    try {
      const files = await desk.dialog.open({
        title: '导入贴图到工程',
        multi: true,
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      });
      if (files.length === 0) return;
      const project = this.state.project;
      this.pushHistory();
      const added: ImageAsset[] = [];
      for (const f of files) {
        const asset = await this.importImageFile(project, f, undefined, folder);
        if (asset) added.push(asset);
      }
      this.set({
        project: { ...project, images: [...project.images], updatedAt: Date.now() },
        selection: added[0] ? { kind: 'image', id: added[0].id } : this.state.selection,
      });
      this.markDirty();
    } catch (e) {
      this.set({ error: errText(e) });
    }
  }

  updateImage(id: string, patch: Partial<ImageAsset>, mergeKey?: string): void {
    this.mutate((p) => {
      const img = p.images.find((i) => i.id === id);
      if (img) Object.assign(img, patch);
    }, mergeKey ?? `image:${id}`);
  }

  /**
   * 裁剪写入图片文件本身（破坏性），并清空裁剪设置。
   * rect 由裁剪对话框直接传入 —— 对话框里拖出来的框可能还没提交到 store，
   * 只读 img.crop 会读到旧值（多半是 null），看起来就是"点了没反应"。
   * 写回时换一个新文件名：同 URL 改内容会被浏览器图片缓存挡住，画面不会变。
   */
  async bakeCrop(id: string, rect?: CropRect): Promise<void> {
    const project = this.state.project;
    const img = project?.images.find((i) => i.id === id);
    const crop = rect ?? img?.crop ?? null;
    if (!project || !img || !crop) return;
    try {
      const abs = joinPath(project.root, img.file);
      const bin = await desk.fs.readBinary(abs);
      const bmp = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('图片解码失败'));
        el.src = `data:${bin.mime};base64,${bin.base64}`;
      });
      // 裁剪框按原图像素裁，越界先夹住
      const cx = Math.max(0, Math.min(Math.round(crop.x), bmp.naturalWidth - 1));
      const cy = Math.max(0, Math.min(Math.round(crop.y), bmp.naturalHeight - 1));
      const cw = Math.max(1, Math.min(Math.round(crop.w), bmp.naturalWidth - cx));
      const ch = Math.max(1, Math.min(Math.round(crop.h), bmp.naturalHeight - cy));
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建画布');
      ctx.drawImage(bmp, cx, cy, cw, ch, 0, 0, cw, ch);
      const url = canvas.toDataURL('image/png');
      const base64 = url.slice(url.indexOf(',') + 1);

      const oldFile = img.file;
      const nextFile = joinPath(FOLDERS.images, `${img.id}_b${Date.now().toString(36).slice(-5)}.png`);
      await desk.fs.writeBinary(joinPath(project.root, nextFile), base64);
      this.mutate((p) => {
        const target = p.images.find((i) => i.id === id);
        if (target) {
          target.file = nextFile;
          target.width = cw;
          target.height = ch;
          target.crop = null;
        }
      });
      if (oldFile && oldFile !== nextFile) {
        try {
          await desk.fs.remove(joinPath(project.root, oldFile));
        } catch {
          /* 旧文件删不掉无所谓，已经没有资产引用它 */
        }
      }
    } catch (e) {
      this.set({ error: errText(e) });
    }
  }

  /* ---------------- 贴图 ---------------- */

  addTexture(template: TextureTemplate, folder = DEFAULT_FOLDER): void {
    this.mutate((p) => {
      const name = uniqueName(template === 'single' ? '新建单向图组' : '新建四向图组', p.textures.map((t) => t.name));
      const tex = newTexture(name, template, []);
      tex.name = name;
      tex.folder = ensureFolder(p, folder, 'texture');
      p.textures.push(tex);
      this.pendingSelect = { kind: 'texture', id: tex.id };
    });
    if (this.pendingSelect) {
      this.set({ selection: this.pendingSelect, selectedNodeId: null });
      this.pendingSelect = null;
    }
  }

  private pendingSelect: Selection | null = null;

  setTextureTemplate(id: string, template: TextureTemplate): void {
    this.mutate((p) => {
      const tex = p.textures.find((t) => t.id === id);
      if (!tex) return;
      const next = switchTextureTemplate(tex, template);
      Object.assign(tex, next);
    });
  }

  /** 给贴图某个方向（单向传 image）指定图片 id */
  setTextureSlot(id: string, dir: 'image' | 'S' | 'E' | 'N' | 'W', imageId: string | null): void {
    this.mutate((p) => {
      const tex = p.textures.find((t) => t.id === id);
      if (!tex) return;
      if (dir === 'image') tex.image = imageId;
      else tex.dirs[dir] = imageId;
    }, `texslot:${id}:${dir}`);
  }

  clearTextureSlot(id: string, dir: 'image' | 'S' | 'E' | 'N' | 'W'): void {
    this.setTextureSlot(id, dir, null);
  }

  /* ---------------- 动画 ---------------- */

  addAnimation(template: SkeletonId, folder = DEFAULT_FOLDER): void {
    this.mutate((p) => {
      const name = uniqueName('新建动画', p.animations.map((a) => a.name));
      const anim = newAnimation(name, template);
      anim.name = name;
      anim.folder = ensureFolder(p, folder, 'animation');
      p.animations.push(anim);
      this.pendingSelect = { kind: 'animation', id: anim.id };
    });
    if (this.pendingSelect) {
      this.set({ selection: this.pendingSelect, selectedNodeId: null });
      this.pendingSelect = null;
    }
  }

  /** 以某个动画为模板新建：沿用关键帧，清空贴图（只保留素体） */
  addAnimationFrom(baseId: string, folder = DEFAULT_FOLDER): void {
    this.mutate((p) => {
      const base = p.animations.find((a) => a.id === baseId);
      if (!base) return;
      const name = uniqueName(`${base.name} 副本`, p.animations.map((a) => a.name));
      const anim = deriveAnimation(base, name);
      anim.name = name;
      anim.folder = ensureFolder(p, folder, 'animation');
      p.animations.push(anim);
      this.pendingSelect = { kind: 'animation', id: anim.id };
    });
    if (this.pendingSelect) {
      this.set({ selection: this.pendingSelect, selectedNodeId: null });
      this.pendingSelect = null;
    }
  }

  updateAnimation(id: string, patch: Partial<AnimationAsset>, mergeKey?: string): void {
    this.mutate((p) => {
      const anim = p.animations.find((a) => a.id === id);
      if (anim) Object.assign(anim, patch);
    }, mergeKey ?? `anim:${id}`);
  }

  updateNode(animId: string, nodeId: string, patch: Partial<AnimationAsset['nodes'][number]>, mergeKey?: string): void {
    this.mutate((p) => {
      const anim = p.animations.find((a) => a.id === animId);
      const node = anim?.nodes.find((n) => n.id === nodeId);
      if (node) Object.assign(node, patch);
    }, mergeKey ?? `node:${animId}:${nodeId}`);
  }

  /** 直接改动画（回调里拿到的是最新快照，适合连续输入/拖拽） */
  mutateAnimation(animId: string, fn: (anim: AnimationAsset) => void, mergeKey?: string): void {
    this.mutate((p) => {
      const anim = p.animations.find((a) => a.id === animId);
      if (anim) fn(anim);
    }, mergeKey);
  }

  /* ---------------- 角色 ---------------- */

  /** 改角色配置（数值 / 动画 / 状态机引用都走这里） */
  setCharacter(nodeId: string, patch: Partial<NonNullable<SceneNode['character']>>, mergeKey?: string): void {
    this.mutate((p) => {
      const n = p.scene.find((x) => x.id === nodeId);
      if (!n || n.kind !== 'character') return;
      n.character = { ...normalizeCharacter(n.character), ...patch };
    }, mergeKey ?? `char:${nodeId}`);
  }

  /* ---------------- 状态机 ---------------- */

  addStateMachine(folder = FOLDER_OF_KIND.statemachine): void {
    this.mutate((p) => {
      const name = uniqueName('新建状态机', p.stateMachines.map((sm) => sm.name));
      const sm = makeBlankStateMachine(p.animations[0] ?? null, name);
      sm.folder = ensureFolder(p, folder, 'statemachine');
      p.stateMachines.push(sm);
      this.pendingSelect = { kind: 'statemachine', id: sm.id };
    });
    if (this.pendingSelect) {
      this.set({ selection: this.pendingSelect, selectedNodeId: null });
      this.pendingSelect = null;
    }
  }

  updateStateMachine(id: string, patch: Partial<StateMachineAsset>, mergeKey?: string): void {
    this.mutate((p) => {
      const sm = p.stateMachines.find((s) => s.id === id);
      if (sm) Object.assign(sm, patch);
    }, mergeKey ?? `sm:${id}`);
  }

  /** 直接改状态机（回调里拿到最新快照，适合流程图拖拽这种高频更新） */
  mutateStateMachine(id: string, fn: (sm: StateMachineAsset) => void, mergeKey?: string): void {
    this.mutate((p) => {
      const sm = p.stateMachines.find((s) => s.id === id);
      if (sm) fn(sm);
    }, mergeKey);
  }

  /** 加一个状态，落在 (x, y)；返回新状态 id */
  addSmState(smId: string, x = 120, y = 120, name?: string): string {
    let created = '';
    this.mutate((p) => {
      const sm = p.stateMachines.find((s) => s.id === smId);
      if (!sm) return;
      const state = newSmState(uniqueName(name?.trim() || '新状态', sm.states.map((s) => s.name)), x, y, {
        animationId: p.animations[0]?.id ?? null,
      });
      sm.states.push(state);
      created = state.id;
    });
    return created;
  }

  updateSmState(smId: string, stateId: string, patch: Partial<StateMachineAsset['states'][number]>, mergeKey?: string): void {
    this.mutate((p) => {
      const sm = p.stateMachines.find((s) => s.id === smId);
      const st = sm?.states.find((x) => x.id === stateId);
      if (st) Object.assign(st, patch);
    }, mergeKey ?? `smstate:${smId}:${stateId}`);
  }

  setSmEntry(smId: string, stateId: string): void {
    this.mutate((p) => {
      const sm = p.stateMachines.find((s) => s.id === smId);
      if (!sm) return;
      for (const st of sm.states) st.entry = st.id === stateId;
    }, `smentry:${smId}`);
  }

  /** 删状态：连带删掉挂在它身上的所有连线 */
  removeSmState(smId: string, stateId: string): void {
    this.mutate((p) => {
      const sm = p.stateMachines.find((s) => s.id === smId);
      if (!sm) return;
      const doomed = new Set(transitionsOf(sm, stateId).map((t) => t.id));
      sm.states = sm.states.filter((st) => st.id !== stateId);
      sm.transitions = sm.transitions.filter((t) => !doomed.has(t.id));
      if (sm.states.length > 0 && !sm.states.some((st) => st.entry)) sm.states[0].entry = true;
    });
  }

  /** 加一条连线（条件默认「键盘 W 按下」）；返回连线 id */
  addSmTransition(smId: string, from: string, to: string, condition: StateMachineAsset['transitions'][number]['condition'] | undefined = undefined): string {
    let created = '';
    this.mutate((p) => {
      const sm = p.stateMachines.find((s) => s.id === smId);
      if (!sm || from === to) return;
      const tr = { id: shortId('tr'), from, to, condition: condition === undefined ? defaultCondition() : condition };
      sm.transitions.push(tr);
      created = tr.id;
    });
    return created;
  }

  updateSmTransition(smId: string, trId: string, patch: Partial<StateMachineAsset['transitions'][number]>, mergeKey?: string): void {
    this.mutate((p) => {
      const sm = p.stateMachines.find((s) => s.id === smId);
      const tr = sm?.transitions.find((t) => t.id === trId);
      if (tr) Object.assign(tr, patch);
    }, mergeKey ?? `smtr:${smId}:${trId}`);
  }

  removeSmTransition(smId: string, trId: string): void {
    this.mutate((p) => {
      const sm = p.stateMachines.find((s) => s.id === smId);
      if (sm) sm.transitions = sm.transitions.filter((t) => t.id !== trId);
    });
  }

  /* ---------------- 控制器 ---------------- */

  addController(folder = FOLDER_OF_KIND.controller): void {
    this.mutate((p) => {
      const name = uniqueName('新建控制器', p.controllers.map((c) => c.name));
      const c = makeBlankController(name);
      c.folder = ensureFolder(p, folder, 'controller');
      p.controllers.push(c);
      this.pendingSelect = { kind: 'controller', id: c.id };
    });
    if (this.pendingSelect) {
      this.set({ selection: this.pendingSelect, selectedNodeId: null });
      this.pendingSelect = null;
    }
  }

  updateController(id: string, patch: Partial<ControllerAsset>, mergeKey?: string): void {
    this.mutate((p) => {
      const c = p.controllers.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
    }, mergeKey ?? `ctrl:${id}`);
  }

  mutateController(id: string, fn: (ctrl: ControllerAsset) => void, mergeKey?: string): void {
    this.mutate((p) => {
      const c = p.controllers.find((x) => x.id === id);
      if (c) fn(c);
    }, mergeKey);
  }

  /** 加变量（名字在控制器内唯一） */
  addCtrlVariable(ctrlId: string, name?: string): string {
    let created = '';
    this.mutate((p) => {
      const c = p.controllers.find((x) => x.id === ctrlId);
      if (!c) return;
      const v = newVariable(uniqueName(name?.trim() || 'value', c.vars.map((x) => x.name)), 0);
      c.vars.push(v);
      created = v.id;
    });
    return created;
  }

  updateCtrlVariable(ctrlId: string, varId: string, patch: Partial<CtrlVariable>, mergeKey?: string): void {
    this.mutate((p) => {
      const c = p.controllers.find((x) => x.id === ctrlId);
      const v = c?.vars.find((x) => x.id === varId);
      if (v) Object.assign(v, patch);
    }, mergeKey ?? `ctrlvar:${ctrlId}:${varId}`);
  }

  /** 删变量：连带删掉指向它的事件，并清理状态机里引用它的条件 */
  removeCtrlVariable(ctrlId: string, varId: string): void {
    this.mutate((p) => {
      const c = p.controllers.find((x) => x.id === ctrlId);
      if (!c) return;
      const next = removeVariableSafely(c, varId);
      c.vars = next.vars;
      c.bindings = next.bindings;
      for (const sm of p.stateMachines) {
        if (sm.controllerId === ctrlId) dropVarConditions(sm, varId);
      }
    });
  }

  addCtrlBinding(ctrlId: string, variableId?: string): string {
    let created = '';
    this.mutate((p) => {
      const c = p.controllers.find((x) => x.id === ctrlId);
      if (!c) return;
      const b = defaultBinding(variableId ?? c.vars[0]?.id ?? '');
      c.bindings.push(b);
      created = b.id;
    });
    return created;
  }

  updateCtrlBinding(ctrlId: string, bindId: string, patch: Partial<CtrlBinding>, mergeKey?: string): void {
    this.mutate((p) => {
      const c = p.controllers.find((x) => x.id === ctrlId);
      const b = c?.bindings.find((x) => x.id === bindId);
      if (b) Object.assign(b, patch);
    }, mergeKey ?? `ctrlbind:${ctrlId}:${bindId}`);
  }

  removeCtrlBinding(ctrlId: string, bindId: string): void {
    this.mutate((p) => {
      const c = p.controllers.find((x) => x.id === ctrlId);
      if (c) c.bindings = c.bindings.filter((b) => b.id !== bindId);
    });
  }

  /** 角色绑定的控制器：整体改写 */
  setCharacterControllers(nodeId: string, ids: string[]): void {
    this.mutate((p) => {
      const n = p.scene.find((x) => x.id === nodeId);
      if (!n || n.kind !== 'character' || !n.character) return;
      n.character.controllerIds = ids;
    }, `char-ctrl:${nodeId}`);
  }

  /* ---------------- 脚本 ---------------- */

  addScript(folder = FOLDER_OF_KIND.script, code?: string, opts: { select?: boolean } = {}): string {
    let newId = '';
    this.mutate((p) => {
      const name = uniqueName('新脚本', p.scripts.map((s) => s.name));
      const s: ScriptAsset = {
        id: shortId('script'),
        name,
        folder: ensureFolder(p, folder, 'script'),
        code: code ?? SCRIPT_TEMPLATE,
        createdAt: Date.now(),
      };
      p.scripts.push(s);
      newId = s.id;
      this.pendingSelect = { kind: 'script', id: s.id };
    });
    if (this.pendingSelect && opts.select !== false) {
      this.set({ selection: this.pendingSelect, selectedNodeId: null });
    }
    this.pendingSelect = null;
    return newId;
  }

  mutateScript(id: string, fn: (s: ScriptAsset) => void, mergeKey?: string): void {
    this.mutate((p) => {
      const s = p.scripts.find((x) => x.id === id);
      if (s) fn(s);
    }, mergeKey);
  }

  /** 节点挂/卸脚本（整体改写该节点的 scriptIds） */
  setNodeScripts(nodeId: string, ids: string[]): void {
    this.mutate((p) => {
      const n = p.scene.find((x) => x.id === nodeId);
      if (n) n.scriptIds = ids;
    }, `node-script:${nodeId}`);
  }

  /** 节点在小地图上的显示开关与图标（minimapIcon = 图组 id，null 清空） */
  setNodeMinimap(nodeId: string, patch: { minimapShow?: boolean; minimapIcon?: string | null }): void {
    this.mutate((p) => {
      const n = p.scene.find((x) => x.id === nodeId);
      if (!n) return;
      if (patch.minimapShow !== undefined) n.minimapShow = patch.minimapShow;
      if (patch.minimapIcon !== undefined) n.minimapIcon = patch.minimapIcon;
    }, `node-minimap:${nodeId}`);
  }

  /** 新建一个脚本并立刻挂到节点上（属性面板「添加脚本」按钮；可连点挂多个） */
  addScriptToNode(nodeId: string, folder = FOLDER_OF_KIND.script): string {
    const before = this.state.project;
    const node = before?.scene.find((n) => n.id === nodeId);
    if (!before || !node) return '';
    // 不切选择：新建脚本的目的是挂到当前节点上，属性面板别跳走
    const id = this.addScript(folder, undefined, { select: false });
    if (id) this.setNodeScripts(nodeId, [...(node.scriptIds ?? []), id]);
    return id;
  }

  /* ---------------- 删除 ---------------- */

  async deleteAsset(kind: AssetKind, id: string): Promise<void> {
    const project = this.state.project;
    if (!project) return;

    // 引用检查：被引用时不允许直接删，给出明确提示
    if (kind === 'image') {
      const usedBy = project.textures.filter((t) => textureReferences(t, id).length > 0);
      if (usedBy.length > 0) {
        this.set({ error: `这张图片正被贴图「${usedBy.map((t) => t.name).join('、')}」使用，请先解除引用。` });
        return;
      }
    }
    if (kind === 'texture') {
      const usedBy = project.animations
        .map((a) => ({ a, hits: animationReferences(a, id) }))
        .filter((x) => x.hits.length > 0);
      if (usedBy.length > 0) {
        const first = usedBy[0];
        this.set({
          error: `这张贴图正被动画「${first.a.name}」的 ${first.hits.length} 处引用，请先在动画里解除。`,
        });
        return;
      }
    }
    // 动画被状态机 / 角色引用时不拦，删除后自动解绑（下面统一处理），避免删一个资源还要跑好几个面板
    if (kind === 'statemachine') {
      const usedBy = project.scene.filter((n) => n.kind === 'character' && n.character?.stateMachineId === id);
      if (usedBy.length > 0) {
        this.set({ error: `这个状态机正被角色「${usedBy.map((n) => n.name).join('、')}」使用，请先改绑或删掉角色。` });
        return;
      }
    }
    if (kind === 'controller') {
      const usedBy = project.scene.filter((n) => n.kind === 'character' && (n.character?.controllerIds ?? []).includes(id));
      if (usedBy.length > 0) {
        this.set({ error: `这个控制器正被角色「${usedBy.map((n) => n.name).join('、')}」使用，请先解绑或删掉角色。` });
        return;
      }
    }

    this.pushHistory();
    const scriptAsset = kind === 'script' ? project.scripts.find((s) => s.id === id) ?? null : null;
    const file =
      kind === 'image'
        ? project.images.find((i) => i.id === id)?.file
        : kind === 'texture'
          ? `${FOLDERS.textures}/${id}.json`
          : kind === 'animation'
            ? `${FOLDERS.animations}/${id}.json`
            : kind === 'controller'
              ? `${FOLDERS.controllers}/${id}.json`
              : kind === 'script'
                ? scriptAsset
                  ? scriptFileOf(project.scripts, scriptAsset)
                  : null
                : `${FOLDERS.stateMachines}/${id}.json`;

    if (file) {
      const abs = joinPath(project.root, file);
      try {
        await desk.fs.trash(abs);
      } catch {
        /* 文件不存在也不影响索引清理 */
      }
    }

    const next = clone(project);
    if (kind === 'image') next.images = next.images.filter((i) => i.id !== id);
    else if (kind === 'texture') next.textures = next.textures.filter((t) => t.id !== id);
    else if (kind === 'animation') next.animations = next.animations.filter((a) => a.id !== id);
    else if (kind === 'controller') next.controllers = next.controllers.filter((c) => c.id !== id);
    else if (kind === 'script') next.scripts = next.scripts.filter((s) => s.id !== id);
    else next.stateMachines = next.stateMachines.filter((sm) => sm.id !== id);
    // 删脚本：把场景节点上的挂载解绑，别留下指向空资源的 id
    if (kind === 'script') {
      for (const n of next.scene) n.scriptIds = (n.scriptIds ?? []).filter((sid) => sid !== id);
    }
    // 删控制器：状态机上的变量来源解绑（运行时回落到角色的第一个控制器）
    if (kind === 'controller') {
      for (const sm of next.stateMachines) if (sm.controllerId === id) sm.controllerId = null;
    }
    // 删动画：把状态机状态与角色上的引用解绑，别留下指向空资源的 id
    if (kind === 'animation') {
      for (const sm of next.stateMachines) for (const st of sm.states) if (st.animationId === id) st.animationId = null;
      for (const n of next.scene) if (n.character?.animationId === id) n.character.animationId = null;
    }
    next.updatedAt = Date.now();

    const stillSelected = this.state.selection?.id !== id;
    const fallback =
      kind === 'animation' && next.animations[0]
        ? { kind: 'animation' as const, id: next.animations[0].id }
        : kind === 'statemachine' && next.stateMachines[0]
          ? { kind: 'statemachine' as const, id: next.stateMachines[0].id }
          : kind === 'controller' && next.controllers[0]
            ? { kind: 'controller' as const, id: next.controllers[0].id }
            : kind === 'script' && next.scripts[0]
              ? { kind: 'script' as const, id: next.scripts[0].id }
              : next.textures[0]
              ? { kind: 'texture' as const, id: next.textures[0].id }
              : next.images[0]
                ? { kind: 'image' as const, id: next.images[0].id }
                : null;

    this.set({
      project: next,
      selection: stillSelected ? this.state.selection : fallback,
      selectedNodeId: stillSelected ? this.state.selectedNodeId : null,
    });
    this.markDirty();
  }

  /* ---------------- 保存 ---------------- */

  markDirty(): void {
    this.set({ saveState: 'saving' });
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), 600);
  }

  private async writeAll(project: ProjectDoc): Promise<void> {
    const root = project.root;
    await desk.fs.mkdirp(joinPath(root, FOLDERS.textures));
    await desk.fs.mkdirp(joinPath(root, FOLDERS.animations));
    await desk.fs.mkdirp(joinPath(root, FOLDERS.stateMachines));
    await desk.fs.mkdirp(joinPath(root, FOLDERS.controllers));
    await desk.fs.mkdirp(joinPath(root, FOLDERS.scripts));
    await desk.fs.mkdirp(joinPath(root, FOLDERS.images));
    await desk.fs.writeJson(joinPath(root, 'metadata.json'), toMetaFile(project));
    for (const tex of project.textures) {
      await desk.fs.writeJson(joinPath(root, `${FOLDERS.textures}/${tex.id}.json`), tex);
    }
    for (const anim of project.animations) {
      await desk.fs.writeJson(joinPath(root, `${FOLDERS.animations}/${anim.id}.json`), anim);
    }
    for (const sm of project.stateMachines) {
      await desk.fs.writeJson(joinPath(root, `${FOLDERS.stateMachines}/${sm.id}.json`), sm);
    }
    for (const ctrl of project.controllers) {
      await desk.fs.writeJson(joinPath(root, `${FOLDERS.controllers}/${ctrl.id}.json`), ctrl);
    }
    for (const sc of project.scripts) {
      await desk.fs.writeText(joinPath(root, scriptFileOf(project.scripts, sc)), sc.code);
    }
  }

  async saveNow(): Promise<void> {
    const project = this.state.project;
    if (!project || !isDesktop) {
      this.set({ saveState: 'idle' });
      return;
    }
    if (this.saving) return;
    this.saving = true;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      await this.writeAll(project);
      this.set({ saveState: 'saved' });
    } catch (e) {
      this.set({ saveState: 'error', error: errText(e) });
    } finally {
      this.saving = false;
    }
  }

  /* ---------------- 派生查询 ---------------- */

  get project(): ProjectDoc | null {
    return this.state.project;
  }

  clearError(): void {
    this.set({ error: null });
  }

  /** 检查某些贴图是否未配置完整（资源列表上打标记） */
  textureWarning(tex: TextureAsset): string | null {
    if (!textureFilled(tex)) return '未设置图片';
    if (tex.template === 'four') {
      const missing = (['S', 'E', 'N', 'W'] as const).filter((d) => !tex.dirs[d]);
      if (missing.length > 0) return `缺少 ${missing.join(' / ')} 方向`;
    }
    return null;
  }

  /** 图片被删/移动后是否还能读到 */
  imageExists(img: ImageAsset): boolean {
    return !!imageById(this.state.project!, img.id);
  }

  textureName(id: string | null): string {
    if (!id) return '';
    return textureById(this.state.project!, id)?.name ?? '';
  }
}

/** 确保目录存在，并登记类型 */
function ensureFolder(doc: ProjectDoc, path: string, kind: AssetKind): string {
  const f = (path ?? '').trim() || DEFAULT_FOLDER;
  if (!doc.folders.includes(f)) doc.folders.push(f);
  if (!doc.folderKinds[f]) doc.folderKinds[f] = kind;
  return f;
}

/** 按资产类型拿它的资产数组（各个列表结构一样，只需要 id/name/folder） */
function assetList(doc: ProjectDoc, kind: AssetKind): { id: string; name: string; folder: string }[] {
  if (kind === 'image') return doc.images;
  if (kind === 'texture') return doc.textures;
  if (kind === 'animation') return doc.animations;
  if (kind === 'controller') return doc.controllers;
  if (kind === 'script') return doc.scripts;
  return doc.stateMachines;
}

export function kindLabel(kind: FolderKind): string {
  return kind === 'image'
    ? '图片'
    : kind === 'texture'
      ? '贴图'
      : kind === 'animation'
        ? '动画'
        : kind === 'statemachine'
          ? '状态机'
          : kind === 'controller'
            ? '控制器'
            : kind === 'character'
              ? '角色'
              : kind === 'enemy'
                ? '敌人'
                : '地面覆盖物';
}

function joinPath(root: string, rel: string): string {
  return `${root}/${rel}`.split('/').join(desk.path.sep || '/');
}

export function errText(e: unknown): string {
  if (e instanceof DeskError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export const editorStore = new EditorStore();

export function useEditor(): EditorState {
  return useSyncExternalStore(editorStore.subscribe, editorStore.getSnapshot, editorStore.getSnapshot);
}
