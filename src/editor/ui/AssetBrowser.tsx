/**
 * 底部资源浏览器 —— 左「目录列表」+ 右「当前目录内容」
 *
 * 目录是虚拟的：资产上只有一个 folder 字段，磁盘上并没有真的分目录，
 * 所有图片仍然躺在 assets/images 下。
 *
 * 第一层固定为 图片 / 贴图 / 动画 三个，不能改名 / 删除；
 * 它们的下面可以任意新建子目录（类型继承父目录），子目录可以改名 / 删除。
 * 每个目录只放自己那一种资产（新建菜单也跟着目录类型变）。
 *
 * 支持 Ctrl+点击多选、Shift 连选、Ctrl+A 全选；
 * 拖到左侧目录行或右侧目录项即可移动资源。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { animationParts, imageCssUrl, textureImage } from '../model/resolve';
import {
  assetCount,
  baseName,
  deepAssetCount,
  isRootFolder,
  KIND_LABEL,
  KIND_ORDER,
  ROOT_NAMES,
  parentPath,
} from '../model/folders';
import {
  SKELETON_TEMPLATES,
  TEXTURE_TEMPLATES,
  type AssetKind,
  type AssetRef,
  type AnimationAsset,
  type FolderKind,
  type ProjectDoc,
  type SkeletonId,
  type TextureTemplate,
} from '../model/types';
import { ConfirmDialog, PromptDialog } from './Dialogs';
import { ContextMenu, type MenuItem } from './Menu';
import { T } from './theme';
import { isDesktop } from '../../platform/desk';

interface Props {
  project: ProjectDoc;
  selection: { kind: string; id: string } | null;
  onSelect: (kind: AssetKind, id: string) => void;
  onOpenAnimation: (id: string) => void;
  onOpenStateMachine: (id: string) => void;
  onOpenController: (id: string) => void;
  onOpenScript: (id: string) => void;
  /** 桌面端双击脚本：用 VS Code / 系统默认编辑器打开源码文件 */
  onOpenScriptInVscode?: (id: string) => void;
  onAddStateMachine: (folder: string) => void;
  onAddController: (folder: string) => void;
  onAddScript: (folder: string) => void;
  onAddTexture: (tpl: TextureTemplate, folder: string) => void;
  onAddAnimation: (tpl: SkeletonId, folder: string) => void;
  onAddAnimationFrom: (id: string, folder: string) => void;
  onImportImages: (folder: string) => void;
  onAddFolder: (parent: string, name: string) => string;
  onRenameFolder: (path: string, name: string) => string;
  onDeleteFolder: (path: string) => void;
  onMoveAssets: (refs: AssetRef[], folder: string) => void;
  onRename: (kind: AssetKind, id: string, current: string) => void;
  onDelete: (kind: AssetKind, id: string) => void;
  onDeleteMany: (refs: AssetRef[]) => void;
  onCropImage: (id: string) => void;
}

/** 图标配色：按文件类型区分（都压暗，配合暗黑哥特底） */
const KIND_COLOR: Record<FolderKind, string> = {
  image: '#8ba4bd',
  texture: '#b193c4',
  animation: '#8aa872',
  statemachine: '#c9a35c',
  controller: '#7fb0a8',
  script: '#c4a35c',
  character: '#8ba4bd',
  enemy: '#c4553f',
  cover: '#7f9a6a',
};

type IconKind =
  | 'folder'
  | 'folder-up'
  | 'image'
  | 'texture-single'
  | 'texture-four'
  | 'animation'
  | 'statemachine'
  | 'controller'
  | 'script';

const refKey = (r: AssetRef) => `${r.kind}:${r.id}`;

/** 开发模式下的固定目录：预设组件脚本（系统脚本）统一在这里展示 */
const SYS_SCRIPT_FOLDER = '系统脚本';
const isSysFolder = (p: string) => p === SYS_SCRIPT_FOLDER;
/** 开发模式（桌面版）才显示系统脚本目录；浏览器模式预设脚本仍留在脚本目录里 */
const SHOW_SYS_FOLDER = isDesktop;

export function AssetBrowser(props: Props) {
  const { project, selection } = props;
  const [path, setPath] = useState<string>(project.folders[0] ?? ROOT_NAMES[0] ?? '');
  const [leftW, setLeftW] = useState(178);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [prompt, setPrompt] = useState<
    { mode: 'new'; parent: string; value: string } | { mode: 'rename'; path: string; value: string } | null
  >(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [sel, setSel] = useState<AssetRef[]>([]);
  /** 右栏被单击选中的子目录（只是高亮，进入要双击） */
  const [pickedFolder, setPickedFolder] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dragRef = useRef<AssetRef[]>([]);
  const anchorRef = useRef<string | null>(null);

  const kindHere = isSysFolder(path) ? 'script' : (project.folderKinds[path] ?? 'image');

  /** 左栏树：第一层固定目录 + 它们的子目录（深度用于缩进）；开发模式末尾追加「系统脚本」 */
  const folderTree = useMemo(() => {
    const out: { path: string; depth: number }[] = [];
    const walk = (parent: string, depth: number) => {
      for (const f of project.folders) {
        if (parentPath(f) !== parent) continue;
        out.push({ path: f, depth });
        walk(f, depth + 1);
      }
    };
    for (const kind of KIND_ORDER) {
      const root = project.folders.find((f) => !f.includes('/') && (project.folderKinds[f] ?? 'image') === kind);
      if (!root) continue;
      out.push({ path: root, depth: 0 });
      walk(root, 1);
    }
    if (SHOW_SYS_FOLDER) out.push({ path: SYS_SCRIPT_FOLDER, depth: 0 });
    return out;
  }, [project.folders, project.folderKinds]);

  /** 当前目录的直接子目录 */
  const subFolders = useMemo(() => project.folders.filter((f) => parentPath(f) === path), [project.folders, path]);

  // 切工程 / 目录被规范化后回落（系统脚本固定目录一直有效）
  useEffect(() => {
    if (path !== SYS_SCRIPT_FOLDER && !project.folders.includes(path)) setPath(project.folders[0] ?? ROOT_NAMES[0] ?? '');
  }, [project.folders, path]);

  const openMenu = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  /* ---------------- 数据 ---------------- */

  const animThumb = useMemo(() => {
    const cache = new Map<string, string>();
    for (const anim of project.animations) {
      if (anim.folder !== path) continue;
      const parts = animationParts(project, anim, 'S');
      const withTex = parts.filter((p) => p.texturePath).sort((a, b) => b.zIndex - a.zIndex);
      cache.set(anim.id, withTex[0]?.texturePath ?? '');
    }
    return cache;
  }, [project, path]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    // 系统脚本固定目录：只列预设组件脚本
    if (isSysFolder(path)) {
      for (const sc of project.scripts) {
        if (!sc.preset) continue;
        out.push({
          kind: 'script',
          id: sc.id,
          name: sc.name,
          sub: `${sc.code.split('\n').length} 行 · 系统`,
          icon: 'script',
          color: KIND_COLOR.script,
          thumb: '',
          preset: true,
        });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    }
    for (const img of project.images) {
      if (img.folder !== path) continue;
      out.push({
        kind: 'image',
        id: img.id,
        name: img.name,
        sub: `${img.width}×${img.height}`,
        icon: 'image',
        color: KIND_COLOR.image,
        thumb: imageCssUrl(project, img),
      });
    }
    for (const tex of project.textures) {
      if (tex.folder !== path) continue;
      const img = textureImage(project, tex, 'S');
      out.push({
        kind: 'texture',
        id: tex.id,
        name: tex.name,
        sub: tex.template === 'four' ? '四向 S/E/N/W' : '单向',
        icon: tex.template === 'four' ? 'texture-four' : 'texture-single',
        color: KIND_COLOR.texture,
        thumb: img ? imageCssUrl(project, img) : '',
      });
    }
    for (const anim of project.animations) {
      if (anim.folder !== path) continue;
      out.push({
        kind: 'animation',
        id: anim.id,
        name: anim.name,
        sub: templateName(anim),
        icon: 'animation',
        color: KIND_COLOR.animation,
        thumb: animThumb.get(anim.id) ?? '',
      });
    }
    for (const sm of project.stateMachines) {
      if (sm.folder !== path) continue;
      out.push({
        kind: 'statemachine',
        id: sm.id,
        name: sm.name,
        sub: `${sm.states.length} 状态 / ${sm.transitions.length} 流转`,
        icon: 'statemachine',
        color: KIND_COLOR.statemachine,
        thumb: '',
      });
    }
    for (const ctrl of project.controllers) {
      if (ctrl.folder !== path) continue;
      out.push({
        kind: 'controller',
        id: ctrl.id,
        name: ctrl.name,
        sub: `${ctrl.vars.length} 变量 / ${ctrl.bindings.length} 事件`,
        icon: 'controller',
        color: KIND_COLOR.controller,
        thumb: '',
      });
    }
    for (const sc of project.scripts) {
      if (sc.folder !== path) continue;
      // 开发模式：预设脚本归入「系统脚本」固定目录，不在普通脚本目录里出现
      if (SHOW_SYS_FOLDER && sc.preset) continue;
      out.push({
        kind: 'script',
        id: sc.id,
        name: sc.name,
        sub: `${sc.code.split('\n').length} 行 JS`,
        icon: 'script',
        color: KIND_COLOR.script,
        thumb: '',
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    return out;
  }, [project, path, animThumb]);

  /** 预设脚本的 id 集合（系统脚本不可删 / 不可拖 / 不可改名） */
  const presetScriptIds = useMemo(() => new Set(project.scripts.filter((s) => s.preset).map((s) => s.id)), [project.scripts]);

  const selectedKeys = useMemo(() => new Set(sel.map(refKey)), [sel]);

  /* ---------------- 多选 ---------------- */

  const clickRow = (e: React.MouseEvent, row: Row) => {
    const key = refKey(row);
    setPickedFolder(null);
    props.onSelect(row.kind, row.id);
    if (e.shiftKey && anchorRef.current) {
      const from = rows.findIndex((r) => refKey(r) === anchorRef.current);
      const to = rows.findIndex((r) => refKey(r) === key);
      if (from >= 0 && to >= 0) {
        const [a, b] = from < to ? [from, to] : [to, from];
        setSel(rows.slice(a, b + 1).map((r) => ({ kind: r.kind, id: r.id })));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSel((prev) =>
        prev.some((s) => refKey(s) === key) ? prev.filter((s) => refKey(s) !== key) : [...prev, { kind: row.kind, id: row.id }],
      );
      anchorRef.current = key;
      return;
    }
    setSel([{ kind: row.kind, id: row.id }]);
    anchorRef.current = key;
  };

  // Ctrl+A 全选当前目录；Esc 取消
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        setSel(rows.map((r) => ({ kind: r.kind, id: r.id })));
      } else if (e.key === 'Escape') {
        setSel([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows]);

  // 切目录清空选择
  useEffect(() => {
    setSel([]);
    setPickedFolder(null);
    anchorRef.current = null;
  }, [path]);

  /* ---------------- 拖拽 ---------------- */

  const startDrag = (e: React.DragEvent, row: Row) => {
    // 系统脚本：不允许拖拽（不能移动目录，也不能拖进场景/资源槽）
    if (row.preset) {
      e.preventDefault();
      return;
    }
    const key = refKey(row);
    const refs = selectedKeys.has(key) ? sel : [{ kind: row.kind, id: row.id }];
    if (!selectedKeys.has(key)) setSel(refs);
    dragRef.current = refs;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', refs.map(refKey).join(','));
    // 种类标记：dragover 阶段读不到数据，但能读 types —— 资源选择槽位靠它判断该不该高亮响应
    const kinds = new Set(refs.map((r) => r.kind));
    if (kinds.has('image')) e.dataTransfer.setData('application/x-light-asset-image', '1');
    if (kinds.has('texture')) e.dataTransfer.setData('application/x-light-asset-texture', '1');
    if (kinds.has('animation')) e.dataTransfer.setData('application/x-light-asset-animation', '1');
    if (kinds.has('statemachine')) e.dataTransfer.setData('application/x-light-asset-statemachine', '1');
    if (kinds.has('controller')) e.dataTransfer.setData('application/x-light-asset-controller', '1');
    if (kinds.has('script')) e.dataTransfer.setData('application/x-light-asset-script', '1');
  };

  const canDropInto = useCallback(
    (target: string) => {
      if (!target) return false;
      const kind = project.folderKinds[target];
      if (!kind) return false;
      const refs = dragRef.current;
      return refs.length > 0 && refs.every((r) => r.kind === kind);
    },
    [project.folderKinds],
  );

  const dragOverTarget = (e: React.DragEvent, target: string) => {
    if (!canDropInto(target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dropTarget !== target) setDropTarget(target);
  };

  const dropOnTarget = (e: React.DragEvent, target: string) => {
    if (!canDropInto(target)) return;
    e.preventDefault();
    e.stopPropagation();
    const refs = dragRef.current;
    dragRef.current = [];
    setDropTarget(null);
    if (refs.length > 0) props.onMoveAssets(refs, target);
  };

  const endDrag = () => {
    dragRef.current = [];
    setDropTarget(null);
  };

  /* ---------------- 菜单 ---------------- */

  /** 目录项右键：第一层只能建子目录，子目录还能改名 / 删除 */
  const folderMenu = (target: string): MenuItem[] => {
    if (isSysFolder(target)) {
      return [
        { label: '系统脚本 · 属性面板的预设组件', disabled: true },
        { label: '可以打开编辑代码，不能删除或移动', disabled: true },
      ];
    }
    const root = isRootFolder(target);
    const items: MenuItem[] = [
      { label: '新建目录', onClick: () => setPrompt({ mode: 'new', parent: target, value: '新建目录' }) },
    ];
    if (!root) {
      items.push(
        { type: 'sep' },
        { label: '重命名目录…', onClick: () => setPrompt({ mode: 'rename', path: target, value: baseName(target) }) },
        {
          label: '删除目录',
          danger: true,
          disabled: deepAssetCount(project, target) > 0,
          onClick: () => setRemoving(target),
        },
      );
    }
    items.push({ type: 'sep' }, { label: root ? '第一层固定目录' : `位于「${parentPath(target)}」`, disabled: true });
    return items;
  };

  /** 右栏空白处右键：新建目录 + 当前目录类型能放的东西 */
  const contentMenu = (): MenuItem[] => {
    // 系统脚本固定目录：不可新建任何东西
    if (isSysFolder(path)) {
      return [
        { label: '系统脚本随工程自动生成，随打开自动恢复', disabled: true },
        { label: '双击脚本即可编辑代码', disabled: true },
      ];
    }
    const newFolder: MenuItem = {
      label: '新建目录',
      hint: '分组',
      onClick: () => setPrompt({ mode: 'new', parent: path, value: '新建目录' }),
    };
    if (kindHere === 'texture') {
      return [
        newFolder,
        { type: 'sep' },
        {
          label: '新建图组',
          submenu: TEXTURE_TEMPLATES.map((t) => ({
            label: t.name,
            hint: t.id === 'single' ? '1 张' : '4 张',
            onClick: () => props.onAddTexture(t.id, path),
          })),
        },
        { type: 'sep' },
        { label: '这个目录只放图组', disabled: true },
      ];
    }
    if (kindHere === 'animation') {
      return [
        newFolder,
        { type: 'sep' },
        {
          label: '新建动画',
          submenu: SKELETON_TEMPLATES.map((s) => ({ label: s.name, onClick: () => props.onAddAnimation(s.id, path) })),
        },
        { type: 'sep' },
        { label: '这个目录只放动画', disabled: true },
      ];
    }
    if (kindHere === 'statemachine') {
      return [
        newFolder,
        { type: 'sep' },
        { label: '新建状态机', hint: '流程图', onClick: () => props.onAddStateMachine(path) },
        { type: 'sep' },
        { label: '一个状态机 = 一个角色的一整套行为', disabled: true },
      ];
    }
    if (kindHere === 'controller') {
      return [
        newFolder,
        { type: 'sep' },
        { label: '新建控制器', hint: '变量 + 按键', onClick: () => props.onAddController(path) },
        { type: 'sep' },
        { label: '控制器把按键变成变量，状态机读变量', disabled: true },
      ];
    }
    if (kindHere === 'script') {
      return [
        newFolder,
        { type: 'sep' },
        { label: '新建脚本', hint: 'JS 生命周期钩子', onClick: () => props.onAddScript(path) },
        { type: 'sep' },
        { label: '编辑态不执行脚本，运行时在沙箱里跑', disabled: true },
      ];
    }
    if (kindHere === 'image') {
      return [
        newFolder,
        { type: 'sep' },
        { label: '导入贴图…', onClick: () => props.onImportImages(path) },
        { type: 'sep' },
        { label: '这个目录只放贴图', disabled: true },
      ];
    }
    return [
      newFolder,
      { type: 'sep' },
      { label: `这个目录只放${KIND_LABEL[kindHere]}`, disabled: true },
      { label: `${KIND_LABEL[kindHere]}的资产结构还没接`, disabled: true },
    ];
  };

  const itemMenu = (row: Row): MenuItem[] => {
    if (sel.length > 1 && selectedKeys.has(refKey(row))) {
      // 系统脚本不参与批量删除：从待删列表里剔除
      const deletable = sel.filter((s) => !(s.kind === 'script' && presetScriptIds.has(s.id)));
      if (deletable.length === 0) {
        return [{ label: '选中的都是系统脚本，不可删除', disabled: true }, { type: 'sep' }, { label: '取消选择', hint: 'Esc', onClick: () => setSel([]) }];
      }
      const hasPreset = deletable.length !== sel.length;
      return [
        { label: `删除选中的 ${deletable.length} 项${hasPreset ? '（系统脚本除外）' : ''}`, danger: true, onClick: () => props.onDeleteMany(deletable) },
        { type: 'sep' },
        { label: '取消选择', hint: 'Esc', onClick: () => setSel([]) },
      ];
    }
    // 系统脚本：开发环境（桌面版）只可编辑（打开编辑器 / VS Code），不能重命名 / 删除；
    // 浏览器模式不可编辑，只展示说明
    if (row.preset) {
      if (!isDesktop) {
        return [
          { label: '系统脚本 · 随对象类型自动挂载', disabled: true },
          { label: '只能在开发环境（桌面版）中编辑', disabled: true },
        ];
      }
      const vs = props.onOpenScriptInVscode;
      return [
        ...(vs ? [{ label: '使用 VS Code 编辑', onClick: () => vs(row.id) }] : []),
        { label: '打开编辑器', hint: '双击', onClick: () => props.onOpenScript(row.id) },
        { type: 'sep' },
        { label: '系统脚本 · 只可编辑，不可删除 / 移动', disabled: true },
      ];
    }
    const common: MenuItem[] = [
      { type: 'sep' },
      { label: '重命名…', hint: 'F2', onClick: () => props.onRename(row.kind, row.id, row.name) },
      { label: '删除', danger: true, onClick: () => props.onDelete(row.kind, row.id) },
    ];
    if (row.kind === 'animation') {
      return [
        { label: '编辑动画', hint: '双击', onClick: () => props.onOpenAnimation(row.id) },
        { label: '以此动画为模板添加…', hint: '沿用关键帧', onClick: () => props.onAddAnimationFrom(row.id, path) },
        ...common,
      ];
    }
    if (row.kind === 'statemachine') {
      return [{ label: '编辑状态机', hint: '双击', onClick: () => props.onOpenStateMachine(row.id) }, ...common];
    }
    if (row.kind === 'controller') {
      return [{ label: '编辑控制器', hint: '双击', onClick: () => props.onOpenController(row.id) }, ...common];
    }
    if (row.kind === 'script') {
      const vs = props.onOpenScriptInVscode;
      return [
        ...(vs ? [{ label: '使用 VS Code 编辑', onClick: () => vs(row.id) }] : []),
        { label: '打开编辑器', hint: '双击', onClick: () => props.onOpenScript(row.id) },
        ...common,
      ];
    }
    if (row.kind === 'texture') return common;
    return [{ label: '裁剪…', onClick: () => props.onCropImage(row.id) }, ...common];
  };

  /* ---------------- 渲染 ---------------- */

  return (
    <div style={{ height: '100%', display: 'flex', background: T.bg1, minHeight: 0 }}>
      {/* 左：目录列表（固定三个，不可增删改） */}
      <div
        style={{ width: leftW, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${T.lineSoft}`, minHeight: 0 }}
      >
        <div
          style={{
            height: 30,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 10px',
            borderBottom: `1px solid ${T.lineSoft}`,
            background: T.bg2,
          }}
        >
          <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: T.dimmer }}>目录</span>
          <span style={{ fontSize: 10.5, color: T.dimmer }}>{project.folders.length}</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: T.dimmer }}>固定目录</span>
        </div>

        <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: '4px 0' }}>
          {folderTree.map(({ path: f, depth }) => {
            const active = path === f;
            const sys = isSysFolder(f);
            const kind = sys ? 'script' : (project.folderKinds[f] ?? 'image');
            const isDrop = dropTarget === f;
            const root = isRootFolder(f);
            const count = sys
              ? project.scripts.filter((s) => s.preset).length
              : root
                ? assetCount(project, f, SHOW_SYS_FOLDER)
                : deepAssetCount(project, f, SHOW_SYS_FOLDER);
            return (
              <div
                key={f}
                data-folder-row={sys ? 'sys-scripts' : undefined}
                onClick={() => setPath(f)}
                onContextMenu={(e) => openMenu(e, folderMenu(f))}
                onDragOver={sys ? undefined : (e) => dragOverTarget(e, f)}
                onDragLeave={sys ? undefined : () => setDropTarget((d) => (d === f ? null : d))}
                onDrop={sys ? undefined : (e) => dropOnTarget(e, f)}
                title={sys ? `${SYS_SCRIPT_FOLDER}（预设组件脚本 · 只可编辑）` : `${f}（${KIND_LABEL[kind]}目录）`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px 4px 10px',
                  paddingLeft: 10 + depth * 12,
                  fontSize: 11.5,
                  color: active ? T.text : T.dim,
                  background: isDrop ? 'rgba(201,135,58,.22)' : active ? T.sel : 'transparent',
                  borderLeft: `2px solid ${active ? T.accent : 'transparent'}`,
                  outline: isDrop ? `1px dashed ${T.accent}` : 'none',
                  outlineOffset: -1,
                  cursor: 'default',
                  userSelect: 'none',
                }}
                onMouseEnter={(e) => {
                  if (!active && !isDrop) e.currentTarget.style.background = T.bg2;
                }}
                onMouseLeave={(e) => {
                  if (!active && !isDrop) e.currentTarget.style.background = 'transparent';
                }}
              >
                <FileIcon kind="folder" color={KIND_COLOR[kind]} size={depth === 0 ? 14 : 12} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {depth === 0 ? f : baseName(f)}
                </span>
                <span style={{ fontSize: 10, color: T.dimmer }}>{count}</span>
              </div>
            );
          })}
        </div>

        <div style={{ flexShrink: 0, padding: '5px 10px', borderTop: `1px solid ${T.lineSoft}`, fontSize: 10, color: T.dimmer }}>
          虚拟目录 · 一个目录只放一种资产
        </div>
      </div>

      <Splitter width={leftW} onChange={setLeftW} />

      {/* 右：当前目录内容 */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div
          style={{
            height: 30,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 10px',
            borderBottom: `1px solid ${T.lineSoft}`,
            background: T.bg2,
          }}
        >
          <FileIcon kind="folder" color={KIND_COLOR[kindHere]} size={13} />
          <span data-browser-path style={{ fontSize: 11.5, color: T.text }}>{path}</span>
          <span style={{ fontSize: 10.5, color: T.dimmer }}>· {KIND_LABEL[kindHere]}目录 · {rows.length} 项</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10.5, color: T.dimmer }}>
            {sel.length > 1 ? `已选 ${sel.length}` : '双击目录进入 · 右键新建 · 拖到左侧目录移动'}
          </span>
        </div>

        <div
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest('[data-tile]')) return;
            openMenu(e, contentMenu());
          }}
          onDragOver={(e) => {
            if (dragRef.current.length > 0) e.preventDefault();
          }}
          style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: '8px 10px 12px' }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))',
              gap: '8px 6px',
              alignContent: 'start',
            }}
          >
            {/* 子目录里第一项是「上一级」（第一层固定目录不需要） */}
            {!isRootFolder(path) && !isSysFolder(path) && (
              <FileTile
                key="__up__"
                icon="folder-up"
                color={T.accent}
                label="上一级"
                sub={`双击回到 ${parentPath(path)}`}
                active={false}
                onClick={() => undefined}
                onDoubleClick={() => setPath(parentPath(path))}
                onContext={(e) => openMenu(e, [{ label: '回到上一级', onClick: () => setPath(parentPath(path)) }])}
                onDragOver={(e) => dragOverTarget(e, parentPath(path))}
                onDragLeave={() => setDropTarget((d) => (d === parentPath(path) ? null : d))}
                onDrop={(e) => dropOnTarget(e, parentPath(path))}
                dropActive={dropTarget === parentPath(path)}
              />
            )}

            {/* 子目录：单击只选中，双击才进入（可继续往里建目录，也可以直接把资源拖进去） */}
            {subFolders.map((f) => {
              const isDrop = dropTarget === f;
              return (
                <FileTile
                  key={`folder:${f}`}
                  icon="folder"
                  color={KIND_COLOR[kindHere]}
                  label={baseName(f)}
                  sub={`目录 · ${deepAssetCount(project, f, SHOW_SYS_FOLDER)} 项`}
                  active={pickedFolder === f}
                  onClick={() => setPickedFolder(f)}
                  onDoubleClick={() => setPath(f)}
                  onContext={(e) => openMenu(e, folderMenu(f))}
                  onDragOver={(e) => dragOverTarget(e, f)}
                  onDragLeave={() => setDropTarget((d) => (d === f ? null : d))}
                  onDrop={(e) => dropOnTarget(e, f)}
                  dropActive={isDrop}
                />
              );
            })}

            {rows.map((row) => (
              <FileTile
                key={refKey(row)}
                icon={row.icon}
                color={row.color}
                label={row.name}
                sub={row.sub}
                thumb={row.thumb}
                active={
                  selectedKeys.has(refKey(row)) ||
                  (sel.length === 0 && !!selection && selection.kind === row.kind && selection.id === row.id)
                }
                onClick={(e) => clickRow(e, row)}
                onDoubleClick={() => {
                  // 动画 / 状态机 / 控制器双击直接打开编辑浮窗；图片双击裁剪；贴图双击只选中
                  if (row.kind === 'animation') props.onOpenAnimation(row.id);
                  else if (row.kind === 'statemachine') props.onOpenStateMachine(row.id);
                  else if (row.kind === 'controller') props.onOpenController(row.id);
                  else if (row.kind === 'script') {
                    // 双击 = 打开脚本编辑器（右键菜单里有「使用 VS Code 编辑」）；
                    // 预设脚本只有开发环境（桌面版）能编辑
                    if (!row.preset || isDesktop) props.onOpenScript(row.id);
                  }
                  else if (row.kind === 'image') props.onCropImage(row.id);
                }}
                onContext={(e) => openMenu(e, itemMenu(row))}
                onDragStart={(e) => startDrag(e, row)}
                onDragEnd={endDrag}
              />
            ))}

            {rows.length === 0 && subFolders.length === 0 && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  margin: '6px 2px',
                  padding: '16px 10px',
                  textAlign: 'center',
                  color: T.dimmer,
                  fontSize: 11.5,
                  border: `1px dashed ${T.line}`,
                  borderRadius: 5,
                  lineHeight: 1.9,
                }}
              >
                {isSysFolder(path) ? (
                  <>
                    还没有系统脚本
                    <br />
                    打开工程时会自动生成预设组件脚本
                  </>
                ) : (
                  <>
                    这个目录是空的
                    <br />
                    {kindHere === 'image' || kindHere === 'texture' || kindHere === 'animation' || kindHere === 'statemachine' || kindHere === 'controller' || kindHere === 'script'
                      ? `右键新建${KIND_LABEL[kindHere]}或目录`
                      : `右键可以新建子目录；${KIND_LABEL[kindHere]}的资产结构还没接`}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}

      {prompt && (
        <PromptDialog
          title={prompt.mode === 'new' ? '新建目录' : '重命名目录'}
          label="目录名称"
          defaultValue={prompt.value}
          onCancel={() => setPrompt(null)}
          onSubmit={(v) => {
            if (prompt.mode === 'new') {
              const created = props.onAddFolder(prompt.parent, v);
              if (created) setPath(created);
            } else {
              const renamed = props.onRenameFolder(prompt.path, v);
              if (renamed) setPath(renamed);
            }
            setPrompt(null);
          }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title="删除目录"
          danger
          confirmText="删除"
          message={
            <>
              将删除空目录「{baseName(removing)}」。
              <br />
              目录只是 metadata.json 里的分组名，不会删除任何文件。
            </>
          }
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            props.onDeleteFolder(removing);
            setPath(parentPath(removing));
            setRemoving(null);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

interface Row {
  kind: AssetKind;
  id: string;
  name: string;
  sub: string;
  icon: IconKind;
  color: string;
  thumb: string;
  /** 系统脚本（预设组件）：只可编辑，不可拖拽 / 删除 */
  preset?: boolean;
}

function templateName(anim: AnimationAsset): string {
  return SKELETON_TEMPLATES.find((s) => s.id === anim.template)?.name ?? anim.template;
}

/* ------------------------------------------------------------------ */
/* 左右拖动                                                            */
/* ------------------------------------------------------------------ */

function Splitter({ width, onChange }: { width: number; onChange: (w: number) => void }) {
  const base = useRef(width);
  const start = useRef(0);
  const [active, setActive] = useState(false);
  base.current = width;
  return (
    <div
      onPointerDown={(e) => {
        e.preventDefault();
        base.current = width;
        start.current = e.clientX;
        setActive(true);
        const move = (ev: PointerEvent) => {
          onChange(Math.min(320, Math.max(110, base.current + (ev.clientX - start.current))));
        };
        const up = () => {
          setActive(false);
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
      style={{ width: 4, flexShrink: 0, cursor: 'col-resize', background: active ? T.accent : 'transparent' }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = T.line;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* 文件图标                                                            */
/* ------------------------------------------------------------------ */

function FileIcon({ kind, color, size = 50 }: { kind: IconKind; color: string; size?: number }) {
  const stroke = { fill: 'none', stroke: color, strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      {kind === 'folder' && (
        <>
          <path
            d="M5 14.5h12.6l3.2 4H43v19.3a3.6 3.6 0 0 1-3.6 3.6H8.6A3.6 3.6 0 0 1 5 37.8z"
            fill="rgba(201,135,58,.13)"
            stroke={color}
            strokeWidth={1.7}
            strokeLinejoin="round"
          />
          <path d="M5 19.4h38" stroke={color} strokeWidth={1.1} opacity=".5" />
        </>
      )}

      {kind === 'folder-up' && (
        <>
          <path
            d="M5 14.5h12.6l3.2 4H43v19.3a3.6 3.6 0 0 1-3.6 3.6H8.6A3.6 3.6 0 0 1 5 37.8z"
            fill="rgba(201,135,58,.1)"
            stroke={color}
            strokeWidth={1.7}
            strokeLinejoin="round"
            strokeDasharray="4 2.6"
          />
          <path d="M24 35.5V22M18.2 27.4 24 21.4l5.8 6" {...stroke} strokeWidth={2} />
        </>
      )}

      {kind === 'image' && (
        <>
          <rect x="6" y="10" width="36" height="28" rx="3" {...stroke} />
          <circle cx="16.5" cy="19" r="3.1" {...stroke} />
          <path d="M6.6 34.4 17 24.8l7.3 7 5.4-4.6L41 37" {...stroke} />
        </>
      )}

      {kind === 'texture-single' && (
        <>
          <rect x="8" y="12" width="32" height="24" rx="3" {...stroke} />
          <path d="M8.8 28.6 18 21.4l7.6 5.4 6-3.4 7.6 5.6" {...stroke} opacity=".75" />
          <rect x="30.5" y="30.5" width="9.5" height="9.5" rx="1.8" fill={color} opacity=".9" />
        </>
      )}

      {kind === 'texture-four' && (
        <>
          <rect x="7.5" y="11.5" width="15" height="11" rx="2.2" {...stroke} />
          <rect x="25.5" y="11.5" width="15" height="11" rx="2.2" {...stroke} />
          <rect x="7.5" y="25.5" width="15" height="11" rx="2.2" {...stroke} />
          <rect x="25.5" y="25.5" width="15" height="11" rx="2.2" {...stroke} />
        </>
      )}

      {kind === 'animation' && (
        <>
          <rect x="5.5" y="10" width="37" height="28" rx="3" {...stroke} />
          <path d="M15 10v28M33 10v28" stroke={color} strokeWidth="1.1" opacity=".55" />
          {[15.5, 23, 30.5].map((y) => (
            <g key={y}>
              <circle cx="10.2" cy={y} r="1.15" fill={color} opacity=".8" />
              <circle cx="37.8" cy={y} r="1.15" fill={color} opacity=".8" />
            </g>
          ))}
          <path d="M20.5 18.2v11.6l9.5-5.8z" fill={color} opacity=".9" />
        </>
      )}

      {kind === 'statemachine' && (
        <>
          <rect x="6" y="14" width="14" height="10" rx="3" {...stroke} />
          <rect x="28" y="24" width="14" height="10" rx="3" {...stroke} />
          <path d="M20 19h5.5v10H28" {...stroke} strokeDasharray="2.4 2" />
          <circle cx="20" cy="19" r="1.3" fill={color} />
          <circle cx="28" cy="29" r="1.3" fill={color} />
        </>
      )}

      {kind === 'controller' && (
        <>
          {/* 手柄：圆角机身 + 十字方向键 + 两颗按键 */}
          <rect x="7" y="13" width="34" height="22" rx="8" {...stroke} />
          <path d="M18 20v8M14 24h8" {...stroke} strokeWidth={1.5} />
          <circle cx="31.5" cy="21.5" r="2" fill={color} opacity=".85" />
          <circle cx="35.5" cy="27" r="2" fill={color} opacity=".55" />
        </>
      )}

      {kind === 'script' && (
        <>
          {/* 脚本：折角纸页 + 代码行 + 尖括号 */}
          <path d="M11 6.5h18l8 8V41a1.5 1.5 0 0 1-1.5 1.5h-24.5A1.5 1.5 0 0 1 9.5 41V8a1.5 1.5 0 0 1 1.5-1.5z" {...stroke} />
          <path d="M29 6.5V15h8" {...stroke} strokeWidth={1.3} />
          <path d="M20 24l-4 4 4 4M28 24l4 4-4 4" {...stroke} strokeWidth={1.5} />
        </>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 网格单元                                                            */
/* ------------------------------------------------------------------ */

function FileTile({
  icon,
  color,
  label,
  sub,
  thumb,
  active,
  dropActive,
  onClick,
  onDoubleClick,
  onContext,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  icon: IconKind;
  color: string;
  label: string;
  sub?: string;
  thumb?: string;
  active?: boolean;
  dropActive?: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContext: (e: React.MouseEvent) => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  return (
    <div
      data-tile
      draggable={!!onDragStart}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContext}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      title={`${label}${sub ? `\n${sub}` : ''}`}
      style={{
        padding: '6px 4px 5px',
        borderRadius: 5,
        border: `1px solid ${dropActive || active ? T.accent : 'transparent'}`,
        background: dropActive ? 'rgba(201,135,58,.22)' : active ? T.sel : 'transparent',
        boxShadow: dropActive ? `inset 0 0 0 1px ${T.accent}` : 'none',
        cursor: 'default',
        userSelect: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        minWidth: 0,
      }}
      onMouseEnter={(e) => {
        if (!active && !dropActive) e.currentTarget.style.background = T.bg2;
      }}
      onMouseLeave={(e) => {
        if (!active && !dropActive) e.currentTarget.style.background = 'transparent';
      }}
    >
      <div style={{ position: 'relative', width: 56, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <FileIcon kind={icon} color={color} />
        {thumb && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              bottom: 0,
              width: 24,
              height: 24,
              borderRadius: 3,
              border: `1px solid ${T.line}`,
              background: `repeating-conic-gradient(${T.bg0} 0% 25%, #1d1915 0% 50%) 50% / 8px 8px`,
              boxShadow: '0 1px 5px rgba(0,0,0,.65)',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img src={thumb} alt="" draggable={false} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          </div>
        )}
      </div>
      <div
        style={{
          width: '100%',
          textAlign: 'center',
          fontSize: 11,
          color: active ? T.text : T.dim,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </div>
      {sub && (
        <div
          style={{
            width: '100%',
            textAlign: 'center',
            fontSize: 9.5,
            color: T.dimmer,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
