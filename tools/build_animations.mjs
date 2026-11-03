#!/usr/bin/env node
/**
 * Little Nightmares 风格化火柴棒动画数据生成器
 *
 * 输出：public/animations/engineer_spanner_anim.json
 * 骨架来自 public/assets/sprites/manifest.json，与 AnimatorStudio.makeSkeleton 同构。
 *
 * 风格要点：
 *   - 角色矮胖敦实、重心低，始终微蜷缩（不是站得笔直）
 *   - idle：呼吸是"塌陷—回弹"的不对称波浪，躯干前倾 6°~8°
 *   - walk：沉重拖步，两腿大幅抬起/砸落，躯干前后摆幅 20°+，手臂跟着大甩
 *   - attack：沉身蓄力→爆发前冲→武器挥弧→回摆，有明显的意图感
 *   - hit：被击退时整个人像布偶，四肢散开
 *   - death：踉跄→扑倒→触地瘫软
 *
 * 动画模型：pose 是相对父节点的局部变换；pivotComp(h, deg, 'top'|'bottom')
 * 给肢体旋转叠加关节补偿，让中心位移 = (h/2·sinθ, h/2·(1−cosθ))。
 */
import fs from 'fs';
import path from 'path';

const MANIFEST = path.resolve('public/assets/sprites/manifest.json');
const OUT = path.resolve('public/animations/engineer_spanner_anim.json');

// ---------- 1. 由 manifest 重建骨架 ----------
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const SPRITES_PREFIX = 'assets/sprites/';
const PART_CANVAS_SIZE = 2;
const char = manifest.characters?.[0];

const SKELETON_NODES = [
  { id: 'torso_L', label: '身体下半部分', parent: null, src: { kind: 'body', part: 'torso_L' } },
  { id: 'torso_U', label: '身体上半部分', parent: 'torso_L', src: { kind: 'body', part: 'torso_U' } },
  { id: 'back', label: '背包', parent: 'torso_U', src: { kind: 'slot', slot: 'back' } },
  { id: 'head', label: '头', parent: 'torso_U', src: { kind: 'head' } },
  { id: 'hat', label: '帽子', parent: 'head', src: { kind: 'slot', slot: 'hat' } },
  { id: 'upper_arm_L', label: '左上臂', parent: 'torso_U', src: { kind: 'body', part: 'arm' } },
  { id: 'forearm_L', label: '左下臂', parent: 'upper_arm_L', src: { kind: 'body', part: 'arm' } },
  { id: 'hand_L', label: '左手', parent: 'forearm_L', src: { kind: 'slot', slot: 'hand' } },
  { id: 'upper_arm_R', label: '右上臂', parent: 'torso_U', src: { kind: 'body', part: 'arm' } },
  { id: 'forearm_R', label: '右下臂', parent: 'upper_arm_R', src: { kind: 'body', part: 'arm' } },
  { id: 'hand_R', label: '右手', parent: 'forearm_R', src: { kind: 'slot', slot: 'hand' } },
  { id: 'weapon', label: '武器', parent: 'hand_R', src: { kind: 'slot', slot: 'weapon' } },
  { id: 'thigh_L', label: '左大腿', parent: 'torso_L', src: { kind: 'body', part: 'leg' } },
  { id: 'calf_L', label: '左小腿', parent: 'thigh_L', src: { kind: 'body', part: 'leg' } },
  { id: 'foot_L', label: '左脚', parent: 'calf_L', src: { kind: 'slot', slot: 'foot' } },
  { id: 'thigh_R', label: '右大腿', parent: 'torso_L', src: { kind: 'body', part: 'leg' } },
  { id: 'calf_R', label: '右小腿', parent: 'thigh_R', src: { kind: 'body', part: 'leg' } },
  { id: 'foot_R', label: '右脚', parent: 'calf_R', src: { kind: 'slot', slot: 'foot' } },
];

function manifestLayout(id) {
  const L = manifest.sharedBodies.layoutS;
  const raw = L[id] ?? (id === 'back' ? L['back_S'] : undefined);
  if (!raw) return null;
  const cy = raw.bottom !== undefined ? raw.bottom - raw.h / 2 : (raw.top ?? 0) + raw.h / 2;
  return { cx: raw.cx, cy, h: raw.h };
}

function makeSkeleton() {
  const grid = manifest.partGrid ?? 512;
  const anchor = manifest.anchorFootY ?? grid * 0.8;
  const px = PART_CANVAS_SIZE / grid;
  const zOrder = manifest.sharedBodies.zOrderS ?? [];
  const centerOf = new Map();
  const parts = [];
  SKELETON_NODES.forEach((node, i) => {
    let texturePath = '';
    if (node.src.kind === 'body') texturePath = `${SPRITES_PREFIX}${manifest.sharedBodies.path}/${node.src.part}.png`;
    const lay = manifestLayout(node.id);
    let layout = null;
    if (lay) {
      const world = { x: (lay.cx - grid / 2) * px, y: (anchor - lay.cy) * px };
      const parentWorld = (node.parent && centerOf.get(node.parent)) || { x: 0, y: 0 };
      layout = { x: world.x - parentWorld.x, y: world.y - parentWorld.y, h: lay.h * px };
      centerOf.set(node.id, world);
    }
    const zIdx = zOrder.indexOf(node.id);
    parts.push({
      id: node.id, label: node.label, parent: node.parent, texturePath,
      size: PART_CANVAS_SIZE, layout,
      defaultPose: { x: 0, y: 0, rot: 0, scale: 1 },
      zIndex: zIdx >= 0 ? zIdx : zOrder.length + i, overlay: null,
    });
  });
  return parts;
}

const parts = makeSkeleton();
const targetId = char?.id ?? 'engineer_spanner';
console.log(`骨架：${parts.length} 节点，targetId=${targetId}`);

const DEF = { x: 0, y: 0, rot: 0, scale: 1 };
const H = Object.fromEntries(parts.map(p => [p.id, p.layout?.h ?? 0.3]));
const R = Math.PI / 180;

function pivotComp(h, deg, anchor = 'top') {
  const r = deg * R, half = h / 2;
  const dx = half * Math.sin(r), dy = half * (1 - Math.cos(r));
  return anchor === 'top' ? { x: dx, y: dy } : { x: -dx, y: dy };
}
function limb(id, deg, extra = {}) {
  const c = pivotComp(H[id] ?? 0.3, deg);
  return { rot: deg, x: c.x, y: c.y, ...extra };
}

/**
 * Little Nightmares 的 idle：
 *   不直立 —— 躯干前倾 7°，呼吸是"塌陷 → 撑住"的不对称波浪，
 *   每一次都像角色努力要把自己撑起来又要倒下去。
 *   双臂微垂但有点内收（不是立正那样完全展开）。
 */
function idle() {
  const dur = 2.8;
  const torsoH = H.torso_U ?? 0.5;
  const forwardLean = pivotComp(torsoH, -7, 'bottom');
  const backLean = pivotComp(torsoH, -4, 'bottom');

  return {
    duration: dur, loop: 'loop',
    frames: [
      // 起始：塌陷到最低点，躯干前倾 7°，角色像是在喘气
      { t: 0.00, poses: {
        torso_L: { y: 0.015 },
        torso_U: { x: forwardLean.x, y: 0.010 + forwardLean.y, rot: -7 },
        head: { rot: 5 },
        upper_arm_L: limb('upper_arm_L', -8),
        upper_arm_R: limb('upper_arm_R', 8),
        forearm_L: limb('forearm_L', -18),
        forearm_R: limb('forearm_R', -14),
      }},
      // 撑住最低点，吸一口气
      { t: 0.35, poses: {
        torso_L: { y: 0.015 },
        torso_U: { x: forwardLean.x, y: 0.010 + forwardLean.y, rot: -7 },
        head: { rot: 5 },
        upper_arm_L: limb('upper_arm_L', -6),
        upper_arm_R: limb('upper_arm_R', 6),
      }},
      // 缓慢回弹，躯干回到 -4°（还是前倾，但不那么塌）
      { t: 0.90, poses: {
        torso_L: { y: -0.008 },
        torso_U: { x: backLean.x, y: -0.008 + backLean.y, rot: -4 },
        head: { rot: 2 },
        upper_arm_L: limb('upper_arm_L', -4),
        upper_arm_R: limb('upper_arm_R', 4),
        forearm_L: limb('forearm_L', -22),
        forearm_R: limb('forearm_R', -20),
      }},
      // 又塌回去
      { t: 1.55, poses: {
        torso_L: { y: 0.004 },
        torso_U: { x: pivotComp(torsoH, -6, 'bottom').x, y: 0.004 + pivotComp(torsoH, -6, 'bottom').y, rot: -6 },
        head: { rot: 4 },
        upper_arm_L: limb('upper_arm_L', -7),
        upper_arm_R: limb('upper_arm_R', 7),
      }},
      // 撑住，准备回到起点
      { t: 2.20, poses: {
        torso_L: { y: -0.005 },
        torso_U: { x: backLean.x, y: -0.005 + backLean.y, rot: -4 },
        head: { rot: 3 },
        upper_arm_L: limb('upper_arm_L', -5),
        upper_arm_R: limb('upper_arm_R', 5),
      }},
      { t: dur, poses: {} },
    ],
  };
}

/**
 * Walk：矮胖角色的沉重拖步
 *   - 侧面（E/W）：躯干前后仰 20°+，每步都像把身体砸向地面
 *   - 正面/背面（S/N）：两腿大幅抬起（像跨水坑），交替下落时躯干有明显的"晃一下"
 *   - 手臂摆幅大，摆动方向与腿反相
 */
function walk(dir) {
  const sideView = dir === 'E' || dir === 'W';
  const sgn = dir === 'W' ? -1 : 1;
  const flip = dir === 'N' ? -1 : 1;
  const torsoH = H.torso_U ?? 0.5;
  const dur = 0.88;

  if (sideView) {
    // 侧面：8 帧一周期的沉重步
    // 相位 0-3：左腿前伸落地；4-7：右腿前伸落地
    const frames = [];
    const stepAngles = [-40, -36, -22, 4, 28, 40, 32, -10]; // thigh_L 轨迹（相对 torso 前倾 18°）
    for (let i = 0; i < 8; i++) {
      const p = i / 8;
      const forwardTilt = i < 4 ? -18 : -22; // 前腿落 vs 后腿蹬
      const cForward = pivotComp(torsoH, forwardTilt, 'bottom');
      const thigh_L = stepAngles[i];
      const thigh_R = -stepAngles[(i + 4) % 8]; // 反相
      const calf_L = i < 4 ? -28 - Math.abs(thigh_L) * 0.3 : 6 - thigh_L * 0.2;
      const calf_R = i < 4 ? -4 - thigh_R * 0.2 : -26 - Math.abs(thigh_R) * 0.3;
      // 手臂摆幅比腿大，反相
      const arm_L = -stepAngles[i] * 0.8 - 6;
      const arm_R = stepAngles[(i + 4) % 8] * 0.8 + 6;
      const bob = (i === 1 || i === 5) ? 0.020 : (i === 3 || i === 7) ? 0.008 : 0.000;
      frames.push({
        t: +(p * dur).toFixed(4),
        poses: {
          torso_L: { y: bob },
          torso_U: { x: cForward.x * sgn, y: bob + cForward.y, rot: forwardTilt * sgn },
          head: { rot: forwardTilt * 0.4 * sgn - (i % 2 === 0 ? 2 : -2) },
          thigh_L: limb('thigh_L', thigh_L * sgn),
          calf_L: limb('calf_L', calf_L * sgn),
          foot_L: { rot: -12 * sgn },
          thigh_R: limb('thigh_R', thigh_R * sgn),
          calf_R: limb('calf_R', calf_R * sgn),
          foot_R: { rot: -12 * sgn },
          upper_arm_L: limb('upper_arm_L', arm_L * sgn),
          upper_arm_R: limb('upper_arm_R', arm_R * sgn),
          forearm_L: limb('forearm_L', -32 - Math.abs(arm_L) * 0.2),
          forearm_R: limb('forearm_R', -32 - Math.abs(arm_R) * 0.2),
        },
      });
    }
    frames.push({ t: dur, poses: {} });
    return { duration: dur, loop: 'loop', frames };
  }

  // 正面/背面：两腿大幅抬起 + 落下砸地，躯干左右摆
  const frames = [];
  for (let i = 0; i < 8; i++) {
    const p = i / 8;
    const phase = Math.sin(p * Math.PI * 2);
    const forward = i % 4 < 2 ? 1 : -1;
    const legLift = Math.max(0, Math.sin(p * Math.PI * 2 - Math.PI / 2)) * 0.08;
    const legDropY = i % 4 === 0 || i % 4 === 4 ? 0.018 : 0; // 砸地时下沉
    const bob = Math.abs(Math.sin(p * Math.PI * 2)) * 0.010 + legDropY;
    const sway = phase * 3 * flip; // 躯干左右摆
    const cSway = pivotComp(torsoH, sway, 'bottom');
    frames.push({
      t: +(p * dur).toFixed(4),
      poses: {
        torso_L: { y: bob },
        torso_U: { x: cSway.x * flip, y: bob + cSway.y, rot: sway * flip - 3 },
        head: { rot: sway * 0.5 * flip + phase * 2 },
        thigh_L: { y: legLift * forward, ...limb('thigh_L', phase * 14) },
        calf_L: limb('calf_L', 26 - Math.abs(phase) * 10),
        foot_L: { rot: -14 + phase * 4 },
        thigh_R: { y: -legLift * forward, ...limb('thigh_R', -phase * 14) },
        calf_R: limb('calf_R', 26 - Math.abs(phase) * 10),
        foot_R: { rot: -14 - phase * 4 },
        upper_arm_L: { y: -0.035 * phase, ...limb('upper_arm_L', 18 * phase) },
        upper_arm_R: { y: 0.035 * phase, ...limb('upper_arm_R', -18 * phase) },
        forearm_L: limb('forearm_L', -28 - Math.abs(phase) * 12),
        forearm_R: limb('forearm_R', -28 - Math.abs(phase) * 12),
      },
    });
  }
  frames.push({ t: dur, poses: {} });
  return { duration: dur, loop: 'loop', frames };
}

/**
 * Attack：小小梦魇式的"凶狠一击"
 *   1) 沉身蓄力 —— 角色重心往下塌，躯干后仰，手收在腰侧
 *   2) 爆发前冲 —— 躯干像弹簧一样弹出去，身体前倾，持武器手猛地挥出
 *   3) 收招 —— 武器停下，身体回稳
 */
function attack(dir) {
  const sgn = dir === 'W' ? -1 : 1;
  const torsoH = H.torso_U ?? 0.5;
  const torsoLH = H.torso_L ?? 0.4;
  const tiltComp = (deg) => pivotComp(torsoH, deg * sgn, 'bottom');

  return {
    duration: 0.78, loop: 'once',
    frames: [
      { t: 0, poses: {} },
      // —— 沉身蓄力 —— 躯干后仰 10°，角色整体往下压
      { t: 0.14, poses: {
        torso_L: { y: 0.028 },
        torso_U: { x: tiltComp(-10).x, y: 0.028 + tiltComp(-10).y, rot: -10 * sgn },
        head: { rot: -8 * sgn },
        thigh_L: limb('thigh_L', 10 * sgn),
        thigh_R: limb('thigh_R', -10 * sgn),
        upper_arm_L: limb('upper_arm_L', -16 * sgn),
        upper_arm_R: limb('upper_arm_R', 38 * sgn),  // 持武器手收到腰侧
        forearm_R: limb('forearm_R', -40 * sgn),
      }},
      // —— 爆发！前冲 + 躯干猛转 + 武器挥出 —— 击中帧
      { t: 0.32, poses: {
        torso_L: { x: 0.06 * sgn, y: 0.005 },
        torso_U: { x: tiltComp(22).x + 0.02 * sgn, y: tiltComp(22).y + 0.005, rot: 22 * sgn },
        head: { rot: 14 * sgn },
        thigh_L: limb('thigh_L', 22 * sgn),
        thigh_R: limb('thigh_R', -14 * sgn),
        upper_arm_L: limb('upper_arm_L', 24 * sgn),
        upper_arm_R: limb('upper_arm_R', -58 * sgn),  // 武器挥到最前
        forearm_R: limb('forearm_R', 18 * sgn),      // 手腕甩出去
      }},
      // —— 武器挥过，身体随惯性继续转 ——
      { t: 0.46, poses: {
        torso_L: { x: 0.035 * sgn },
        torso_U: { x: tiltComp(14).x + 0.015 * sgn, y: tiltComp(14).y, rot: 14 * sgn },
        head: { rot: 6 * sgn },
        upper_arm_R: limb('upper_arm_R', -36 * sgn),
        forearm_R: limb('forearm_R', -28 * sgn),
        upper_arm_L: limb('upper_arm_L', 30 * sgn),
      }},
      // —— 收招：躯干回正，武器落回初始位置 ——
      { t: 0.62, poses: {
        torso_U: { x: tiltComp(3).x, y: tiltComp(3).y, rot: 3 * sgn },
        upper_arm_R: limb('upper_arm_R', -18 * sgn),
        forearm_R: limb('forearm_R', -32 * sgn),
      }},
      { t: 0.78, poses: {} },
    ],
  };
}

/**
 * Hit：被击退时整个人像布偶
 *   - 不是躯干单独后仰，而是从根节点开始"被推出去"
 *   - 四肢在惯性下乱摆、散开
 */
function hit(dir) {
  const d = dir === 'E' ? 1 : -1; // 向后倒的方向
  const torsoH = H.torso_U ?? 0.5;
  const torsoLH = H.torso_L ?? 0.4;
  const forwardTilt = (deg) => pivotComp(torsoH, deg * d, 'bottom');
  const hipTilt = (deg) => pivotComp(torsoLH, deg * d, 'bottom');

  return {
    duration: 0.50, loop: 'once',
    frames: [
      { t: 0, poses: {} },
      // —— 被猛推 —— 整个角色向外飞出去，躯干后仰 25°，头甩得更狠
      { t: 0.08, poses: {
        torso_L: { x: -0.08 * d, y: -0.022 },
        torso_U: { x: forwardTilt(-25).x - 0.02 * d, y: -0.022 + forwardTilt(-25).y, rot: -25 * d },
        head: { rot: -20 * d },
        thigh_L: limb('thigh_L', -18 * d),
        thigh_R: limb('thigh_R', -22 * d),
        upper_arm_L: limb('upper_arm_L', 34 * d),
        upper_arm_R: limb('upper_arm_R', -28 * d),
        forearm_L: limb('forearm_L', 12 * d),
        forearm_R: limb('forearm_R', -18 * d),
      }},
      // —— 空中踉跄 —— 躯干继续后仰，头往反方向甩，四肢继续乱摆
      { t: 0.22, poses: {
        torso_L: { x: -0.03 * d, y: -0.008 },
        torso_U: { x: forwardTilt(-16).x - 0.01 * d, y: -0.008 + forwardTilt(-16).y, rot: -16 * d },
        head: { rot: 12 * d },
        thigh_L: limb('thigh_L', -14 * d),
        thigh_R: limb('thigh_R', 8 * d),
        upper_arm_L: limb('upper_arm_L', -10 * d),
        upper_arm_R: limb('upper_arm_R', 20 * d),
      }},
      // —— 站稳，还在晃 ——
      { t: 0.36, poses: {
        torso_L: { x: 0.01 * d },
        torso_U: { x: forwardTilt(6).x + 0.005 * d, y: forwardTilt(6).y, rot: 6 * d },
        head: { rot: -5 * d },
        upper_arm_L: limb('upper_arm_L', 4 * d),
        upper_arm_R: limb('upper_arm_R', -4 * d),
      }},
      { t: 0.50, poses: {} },
    ],
  };
}

/**
 * Death：被重击 → 踉跄 → 向前扑倒 → 触地瘫软
 *   - 小小梦魇的死亡不是慢慢倒下，是重重砸下去
 *   - 落地那一帧有明显的"砸"感（躯干中心短暂下沉，四肢散开）
 */
function death(dir) {
  const d = dir === 'E' ? 1 : -1; // 倒向
  const torsoH = H.torso_U ?? 0.5;
  const torsoLH = H.torso_L ?? 0.4;
  const lean = (deg) => pivotComp(torsoH, deg * d, 'bottom');
  const hip = (deg) => pivotComp(torsoLH, deg * d, 'bottom');

  return {
    duration: 1.4, loop: 'once',
    frames: [
      { t: 0, poses: {} },
      // —— 踉跄：被重击后还在站着，但已经撑不住了 ——
      { t: 0.16, poses: {
        torso_L: { x: -0.04 * d, y: -0.012 },
        torso_U: { x: lean(-14).x - 0.015 * d, y: -0.012 + lean(-14).y, rot: -14 * d },
        head: { rot: -12 * d },
        upper_arm_L: limb('upper_arm_L', 22 * d),
        upper_arm_R: limb('upper_arm_R', -18 * d),
      }},
      // —— 扑倒前的最后挣扎：腿软，躯干往前栽 ——
      { t: 0.42, poses: {
        torso_L: { x: 0.02 * d },
        torso_U: { x: lean(24).x + 0.03 * d, y: lean(24).y, rot: 24 * d },
        head: { rot: 10 * d },
        thigh_L: limb('thigh_L', -18 * d),
        thigh_R: limb('thigh_R', 16 * d),
        calf_L: limb('calf_L', 32 * d),
        calf_R: limb('calf_R', -28 * d),
      }},
      // —— 空中：躯干几乎水平，脸朝下 ——
      { t: 0.70, poses: {
        torso_L: { x: 0.09 * d, y: -0.10 },
        torso_U: { x: lean(78).x + 0.06 * d, y: lean(78).y - 0.10, rot: 78 * d },
        head: { rot: 30 * d },
        thigh_L: limb('thigh_L', 28 * d),
        thigh_R: limb('thigh_R', 22 * d),
        calf_L: limb('calf_L', -40 * d),
        calf_R: limb('calf_R', -32 * d),
        upper_arm_L: limb('upper_arm_L', 42 * d),
        upper_arm_R: limb('upper_arm_R', 36 * d),
      }},
      // —— 砸地：躯干触地，短暂下沉，四肢散开 ——
      { t: 0.86, poses: {
        torso_L: { x: 0.13 * d, y: -0.005 },
        torso_U: { x: lean(90).x + 0.09 * d, y: lean(90).y - 0.005, rot: 90 * d },
        head: { rot: 45 * d },
        thigh_L: limb('thigh_L', 34 * d),
        thigh_R: limb('thigh_R', 28 * d),
        calf_L: limb('calf_L', -22 * d),
        calf_R: limb('calf_R', -16 * d),
        upper_arm_L: limb('upper_arm_L', 52 * d),
        upper_arm_R: limb('upper_arm_R', 46 * d),
      }},
      // —— 瘫软静止：躯干保持几乎水平，四肢还在轻微颤动 ——
      { t: 1.10, poses: {
        torso_L: { x: 0.14 * d, y: 0 },
        torso_U: { x: lean(86).x + 0.095 * d, y: lean(86).y, rot: 86 * d },
        head: { rot: 42 * d },
        thigh_L: limb('thigh_L', 32 * d),
        thigh_R: limb('thigh_R', 26 * d),
        calf_L: limb('calf_L', -18 * d),
        calf_R: limb('calf_R', -12 * d),
        upper_arm_L: limb('upper_arm_L', 50 * d),
        upper_arm_R: limb('upper_arm_R', 44 * d),
      }},
      { t: 1.4, poses: {
        torso_L: { x: 0.14 * d },
        torso_U: { x: lean(86).x + 0.095 * d, y: lean(86).y, rot: 86 * d },
        head: { rot: 42 * d },
      }},
    ],
  };
}

// ---------- 3. 组装成 Clip ----------
function toClip(name, spec) {
  const involved = new Set();
  for (const f of spec.frames) Object.keys(f.poses || {}).forEach(id => involved.add(id));
  const tracks = parts.map(part => {
    if (!involved.has(part.id)) return { partId: part.id, keys: [{ t: 0, pose: { ...DEF }, ease: 'linear' }] };
    const keys = spec.frames.map(f => ({ t: f.t, pose: { ...DEF, ...(f.poses[part.id] || {}) }, ease: 'easeInOutQuad' }));
    return { partId: part.id, keys };
  });
  return { name, duration: spec.duration, loop: spec.loop, tracks };
}

const directions = {};
for (const dir of ['S', 'E', 'N', 'W']) {
  directions[dir] = {
    parts,
    clips: {
      idle: toClip('idle', idle()),
      walk: toClip('walk', walk(dir)),
      attack: toClip('attack', attack(dir)),
      hit: toClip('hit', hit(dir)),
      death: toClip('death', death(dir)),
    },
  };
}

const project = { version: 2, targetId, fps: 60, directions };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(project, null, 1), 'utf8');

const size = (fs.statSync(OUT).size / 1024).toFixed(0);
const keyCount = Object.values(directions).reduce(
  (n, d) => n + Object.values(d.clips).reduce((m, c) => m + c.tracks.reduce((k, t) => k + t.keys.length, 0), 0), 0);
console.log(`✓ ${path.relative(process.cwd(), OUT)}  ${size}KB  ${keyCount} 关键帧`);
console.log(`  clips: ${Object.values(directions.S.clips).map(c => `${c.name}(${c.duration}s/${c.loop})`).join('  ')}`);
