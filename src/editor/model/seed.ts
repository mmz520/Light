/**
 * 内置示例素材 → 工程资产
 *
 * 新建工程时可选"包含示例资源"：把应用自带的工程师素体 / 装备复制进工程，
 * 并生成与之对应的贴图资产和一条待机动画，用来演示三层映射关系：
 *   图片（png） ← 贴图（1 或 4 张） ← 动画（每节点一张）
 */
import { desk } from '../../platform/desk';
import type { Clip } from '../../animator/types';
import { newAnimation, newTexture } from './build';
import { FIXED_FOLDERS, shortId, type AnimationAsset, type ImageAsset, type ProjectDoc, type TextureAsset } from './types';
interface SeedSink {
  addImageFromFile(src: string, name: string): Promise<ImageAsset | null>;
  registerTexture(tex: TextureAsset): void;
  registerAnimation(anim: AnimationAsset): void;
}

function join(root: string, ...parts: string[]): string {
  const sep = desk.path.sep || '/';
  return [root, ...parts].join(sep);
}

export async function seedSampleProject(project: ProjectDoc, sink: SeedSink): Promise<void> {
  let samples: string | null = null;
  try {
    const paths = await desk.app.paths();
    samples = paths.samples ?? null;
  } catch {
    samples = null;
  }
  if (!samples) return;

  const file = (...p: string[]) => join(samples!, ...p);
  const image = async (rel: string[], name: string) => {
    const asset = await sink.addImageFromFile(file(...rel), name);
    return asset?.id ?? null;
  };

  // —— 图片：素体 4 张（单向）+ 头 / 帽 / 背包 / 鞋 四向 + 手套 / 扳手 ——
  const arm = await image(['role', 'common', 'arm.png'], '素体 · 手臂');
  const leg = await image(['role', 'common', 'leg.png'], '素体 · 腿');
  const torsoU = await image(['role', 'common', 'torso_U.png'], '素体 · 上身');
  const torsoL = await image(['role', 'common', 'torso_L.png'], '素体 · 下身');

  const dirs = ['S', 'E', 'N', 'W'] as const;
  const head: Partial<Record<(typeof dirs)[number], string | null>> = {};
  for (const d of dirs) head[d] = await image(['role', 'engineer_spanner', `${d}.png`], `工程师 · 头 ${d}`);

  const hat: Partial<Record<(typeof dirs)[number], string | null>> = {};
  for (const d of dirs) hat[d] = await image(['equipment', 'hat', 'engineer_cap', `${d}.png`], `工程师帽 ${d}`);

  const pack: Partial<Record<(typeof dirs)[number], string | null>> = {};
  for (const d of dirs) pack[d] = await image(['equipment', 'back', 'gearpack', `${d}.png`], `齿轮背包 ${d}`);

  const boots: Partial<Record<(typeof dirs)[number], string | null>> = {};
  for (const d of dirs) boots[d] = await image(['equipment', 'foot', 'boots', `${d}.png`], `长靴 ${d}`);

  const glove = await image(['equipment', 'hand', 'gloves', 'single.png'], '工作手套');
  const wrench = await image(['equipment', 'weapon', 'wrench', 'single.png'], '扳手');

  // —— 贴图 ——
  const single = (name: string, imageId: string | null): TextureAsset => {
    const tex = newTexture(name, 'single', []);
    tex.name = name;
    tex.image = imageId;
    sink.registerTexture(tex);
    return tex;
  };
  const four = (name: string, map: Partial<Record<(typeof dirs)[number], string | null>>): TextureAsset => {
    const tex = newTexture(name, 'four', []);
    tex.name = name;
    for (const d of dirs) tex.dirs[d] = map[d] ?? null;
    sink.registerTexture(tex);
    return tex;
  };

  const texArm = single('素体 · 手臂', arm);
  const texLeg = single('素体 · 腿', leg);
  const texTorsoU = single('素体 · 上身', torsoU);
  const texTorsoL = single('素体 · 下身', torsoL);
  const texHead = four('工程师 · 头部', head);
  const texHat = four('工程师帽', hat);
  const texPack = four('齿轮背包', pack);
  const texBoots = four('长靴', boots);
  const texGlove = single('工作手套', glove);
  const texWrench = single('扳手', wrench);

  // —— 动画：把贴图挂到对应节点 ——
  const anim = newAnimation('工程师 · 待机', 'humanoid10');
  const bySlot: Record<string, string> = {
    arm: texArm.id,
    leg: texLeg.id,
    torso_U: texTorsoU.id,
    torso_L: texTorsoL.id,
    head: texHead.id,
    hat: texHat.id,
    back: texPack.id,
    foot: texBoots.id,
    hand: texGlove.id,
    weapon: texWrench.id,
  };
  for (const node of anim.nodes) {
    node.textureId = bySlot[node.slot] ?? null;
  }

  // 待机：呼吸 + 轻微摇摆（2 秒循环）
  const idle = anim.clips.idle;
  if (idle) {
    const setTrack = (partId: string, keys: { t: number; x?: number; y?: number; rot?: number }[]) => {
      const tr = idle.tracks.find((t) => t.partId === partId);
      if (!tr) return;
      tr.keys = keys.map((k) => ({
        t: k.t,
        pose: { x: k.x ?? 0, y: k.y ?? 0, rot: k.rot ?? 0, scale: 1 },
        ease: 'easeInOutQuad' as const,
      }));
    };
    setTrack('torso_U', [{ t: 0, y: 0 }, { t: 1, y: 0.012 }, { t: 2, y: 0 }]);
    setTrack('torso_L', [{ t: 0, rot: 0 }, { t: 1, rot: -1.2 }, { t: 2, rot: 0 }]);
    setTrack('head', [{ t: 0, rot: 0 }, { t: 0.7, rot: 1.5 }, { t: 1.6, rot: -1.5 }, { t: 2, rot: 0 }]);
    setTrack('upper_arm_L', [{ t: 0, rot: 0 }, { t: 1, rot: -2.5 }, { t: 2, rot: 0 }]);
    setTrack('upper_arm_R', [{ t: 0, rot: 0 }, { t: 1, rot: 2.5 }, { t: 2, rot: 0 }]);
    setTrack('weapon', [{ t: 0, rot: 0 }, { t: 1, rot: 3 }, { t: 2, rot: 0 }]);
  }

  // 行走：左右腿交替（0.8 秒循环）
  const walk = anim.clips.walk;
  if (walk) {
    const swing = (partId: string, seq: number[]) => {
      const tr = walk.tracks.find((t) => t.partId === partId);
      if (!tr) return;
      tr.keys = seq.map((rot, i) => ({
        t: (i / (seq.length - 1)) * walk.duration,
        pose: { x: 0, y: 0, rot, scale: 1 },
        ease: 'easeInOutQuad' as const,
      }));
    };
    swing('thigh_L', [18, 0, -18, 0, 18]);
    swing('thigh_R', [-18, 0, 18, 0, -18]);
    swing('calf_L', [-10, -22, 0, -10, -10]);
    swing('calf_R', [0, -10, -10, -22, 0]);
    swing('upper_arm_L', [-12, 0, 12, 0, -12]);
    swing('upper_arm_R', [12, 0, -12, 0, 12]);
  }

  anim.id = shortId('anim');
  sink.registerAnimation(anim);

  // —— 机械师（5 骨架 humanoid5）：AI 生成的部件贴图，默认摆在场景里的就是它 ——
  const mHead = await image(['role', 'mechanic', 'head.png'], '机械师 · 头');
  const mTorso = await image(['role', 'mechanic', 'torso.png'], '机械师 · 躯干');
  const mArm = await image(['role', 'mechanic', 'arm.png'], '机械师 · 机械臂');
  const mLeg = await image(['role', 'mechanic', 'leg.png'], '机械师 · 腿');
  const mWrench = await image(['equipment', 'weapon', 'mechanic_wrench.png'], '旧扳手');

  const texMHead = single('机械师 · 头部', mHead);
  const texMTorso = single('机械师 · 躯干', mTorso);
  const texMArm = single('机械师 · 机械臂', mArm);
  const texMLeg = single('机械师 · 腿', mLeg);
  const texMWrench = single('旧扳手', mWrench);

  const mech = newAnimation('机械师', 'humanoid5');
  const mechSlots: Record<string, string | null> = {
    leg: texMLeg.id,
    body: texMTorso.id,
    arm: texMArm.id,
    head: texMHead.id,
    hat: null,
    hand: null,
    weapon: texMWrench.id,
  };
  for (const node of mech.nodes) node.textureId = mechSlots[node.slot] ?? null;

  // 饥荒式比例重排：头最大(170) > 躯干短宽(120) > 四肢短细(腿105/臂90)，脚底贴地、总高基本不变。
  // 用绝对画布坐标（y 自顶向下、脚底线 412）声明，再换算成「中心到父中心」的相对 layout。
  const pxw = 2 / 512;
  const footY = 412;
  const dsSpec: Record<string, { cx: number; bottom?: number; top?: number; h: number }> = {
    leg_L: { cx: 232, bottom: 412, h: 105 },
    leg_R: { cx: 280, bottom: 412, h: 105 },
    body: { cx: 256, bottom: 307, h: 120 },
    head: { cx: 256, bottom: 184, h: 170 },
    hat: { cx: 256, bottom: 54, h: 50 },
    arm_L: { cx: 214, top: 205, h: 90 },
    arm_R: { cx: 298, top: 205, h: 90 },
    hand_L: { cx: 214, bottom: 295, h: 44 },
    hand_R: { cx: 298, bottom: 295, h: 44 },
    weapon: { cx: 306, bottom: 320, h: 95 },
  };
  const dsAbs = (id: string) => {
    const s = dsSpec[id];
    const cy = s.bottom !== undefined ? s.bottom - s.h / 2 : s.top! + s.h / 2;
    return { x: (s.cx - 256) * pxw, y: (footY - cy) * pxw };
  };
  for (const n of mech.nodes) {
    const s = dsSpec[n.id];
    if (!s) continue;
    const a = dsAbs(n.id);
    const p = n.parent ? dsAbs(n.parent) : { x: 0, y: 0 };
    n.layout.h = s.h * pxw;
    n.layout.x = a.x - p.x;
    n.layout.y = a.y - p.y;
  }

  /** 给某条 clip 的一个部件覆写关键帧（pose 只有 rot/y/x，全部 easeInOut） */
  const setTrack = (
    clip: Clip | undefined,
    partId: string,
    keys: { t: number; x?: number; y?: number; rot?: number }[],
  ) => {
    const tr = clip?.tracks.find((t) => t.partId === partId);
    if (!tr) return;
    tr.keys = keys.map((k) => ({
      t: k.t,
      pose: { x: k.x ?? 0, y: k.y ?? 0, rot: k.rot ?? 0, scale: 1 },
      ease: 'easeInOutQuad' as const,
    }));
  };
  /** 5 键循环摆动：0 → 0.25 → 0.5 → 0.75 → 1.0 均匀铺 */
  const swing = (clip: Clip | undefined, partId: string, seq: number[], attr: 'rot' | 'y' = 'rot') => {
    const dur = clip?.duration ?? 1;
    setTrack(
      clip,
      partId,
      seq.map((v, i) => ({ t: (i / (seq.length - 1)) * dur, [attr]: v })),
    );
  };

  // 待机（2s）：舞台剧式表演——大口呼吸（躯干明显起伏）+ 夸张张望（头 ±7°）+ 耸肩 + 手臂无精打采地晃
  const midle = mech.clips.idle;
  setTrack(midle, 'body', [{ t: 0, y: 0, rot: 0 }, { t: 0.8, y: 0.024, rot: 2.5 }, { t: 1.4, y: 0.01, rot: -2.5 }, { t: 2, y: 0, rot: 0 }]);
  setTrack(midle, 'head', [{ t: 0, rot: 0 }, { t: 0.6, rot: 7 }, { t: 1.5, rot: -7 }, { t: 2, rot: 0 }]);
  setTrack(midle, 'arm_L', [{ t: 0, rot: 0 }, { t: 1, rot: -7 }, { t: 2, rot: 0 }]);
  setTrack(midle, 'arm_R', [{ t: 0, rot: 0 }, { t: 1, rot: 7 }, { t: 2, rot: 0 }]);
  setTrack(midle, 'weapon', [{ t: 0, rot: 0 }, { t: 1, rot: 9 }, { t: 2, rot: 0 }]);

  // 行走（0.8s）：性格先于物理——大步幅甩腿(±38°)、手臂大幅反甩(±28°)、身体前倾+每步一颠、头和扳手跟着甩
  const mwalk = mech.clips.walk;
  swing(mwalk, 'leg_L', [38, 0, -38, 0, 38]);
  swing(mwalk, 'leg_R', [-38, 0, 38, 0, -38]);
  swing(mwalk, 'arm_L', [-28, 0, 28, 0, -28]);
  swing(mwalk, 'arm_R', [28, 0, -28, 0, 28]);
  setTrack(mwalk, 'body', [{ t: 0, y: 0, rot: 6 }, { t: 0.2, y: 0.03, rot: 7 }, { t: 0.4, y: 0, rot: 6 }, { t: 0.6, y: 0.03, rot: 7 }, { t: 0.8, y: 0, rot: 6 }]);
  swing(mwalk, 'head', [6, 0, -6, 0, 6]);
  swing(mwalk, 'weapon', [24, 0, -24, 0, 24]);

  mech.id = shortId('anim');
  sink.registerAnimation(mech);

  // 虚拟目录：只是分组名，磁盘上仍然是 assets/images|textures|animations
  project.folders = FIXED_FOLDERS.map((f) => f.name);
  project.folderKinds = Object.fromEntries(FIXED_FOLDERS.map((f) => [f.name, f.kind])) as ProjectDoc['folderKinds'];
  for (const img of project.images) img.folder = '图片';
  for (const tex of project.textures) tex.folder = '贴图';
  for (const a of project.animations) a.folder = '动画';
}
