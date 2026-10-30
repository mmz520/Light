#!/usr/bin/env node
/**
 * 生成工程师（火柴棒骨架）四方向动画数据
 *
 * 数据来源：编辑器实际初始骨架（window.__animator.project.directions[dir].parts），
 * 保证 parts / layout 与运行时完全一致；骨架数值改了就重跑本脚本。
 *
 * 输出：public/animations/engineer_spanner_anim.json
 *
 * 动画模型：
 *   pose.x / pose.y 是相对父节点的位移增量，rot 是绕 **部件中心** 的旋转。
 *   为了让肢体看起来绕关节（肩/肘/髋/膝）转，rot 之外再叠加 pivotComp 位移补偿：
 *   设部件高 h、绕顶端转 θ，中心位移 = (h/2·sinθ, h/2·(1-cosθ))。
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const URL = process.argv[2] || 'http://localhost:5174/';
const OUT = path.resolve('public/animations/engineer_spanner_anim.json');
const executablePath = [
  process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(p => fs.existsSync(p));
if (!executablePath) throw new Error('找不到 Chrome');

// ---------- 1. 从编辑器取真实骨架 ----------
const browser = await puppeteer.launch({
  executablePath, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.evaluate(() => {
  Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('动画编辑器'))?.click();
});
await new Promise(r => setTimeout(r, 2000));
const parts = await page.evaluate(() => window.__animator.project.directions.S.parts);
const targetId = await page.evaluate(() => window.__animator.project.targetId);
await browser.close();
console.log(`骨架：${parts.length} 节点，targetId=${targetId}`);

const DEF = { x: 0, y: 0, rot: 0, scale: 1 };
const H = Object.fromEntries(parts.map(p => [p.id, p.layout?.h ?? 0.3]));
const R = Math.PI / 180;

/** 绕部件顶端/底端旋转 θ 度时，中心需要的位移补偿（使关节固定不动）
 *  top=C+(0,h/2)，绕 C 转 θ 后 top'=C+(-h/2·sinθ, h/2·cosθ)，
 *  δ=top-top'=(+h/2·sinθ, +h/2·(1-cosθ))；bottom 的 x 取反、y 同号。 */
function pivotComp(h, deg, anchor = 'top') {
  const r = deg * R, half = h / 2;
  const dx = half * Math.sin(r), dy = half * (1 - Math.cos(r));
  return anchor === 'top' ? { x: dx, y: dy } : { x: -dx, y: dy };
}

/** 肢体绕顶端旋转：返回带补偿的 pose 片段 */
function limb(id, deg, extra = {}) {
  const c = pivotComp(H[id] ?? 0.3, deg);
  return { rot: deg, x: c.x, y: c.y, ...extra };
}

// ---------- 2. 各 clip 的关键帧 ----------

/** 站立 idle：呼吸起伏 + 手臂微摆（2.4s 循环） */
function idle() {
  const dur = 2.4, N = 6, frames = [];
  for (let i = 0; i <= N; i++) {
    const p = i / N, ph = p * Math.PI * 2, s = Math.sin(ph);
    const bob = s * 0.010;
    const armL = s * 2.6, armR = -s * 2.6;
    frames.push({
      t: +(p * dur).toFixed(4),
      poses: {
        torso_L: { y: bob },
        torso_U: { y: bob * 0.4, rot: s * 1.2 },
        head: { rot: -s * 1.8 },
        upper_arm_L: limb('upper_arm_L', armL),
        upper_arm_R: limb('upper_arm_R', armR),
      },
    });
  }
  return { duration: dur, loop: 'loop', frames };
}

/**
 * 跑步 walk（0.72s 循环，两步一周期）
 *   · 侧面（E/W）：四肢绕关节前后摆，躯干前倾
 *   · 正面/背面（S/N）：四肢交替上下抬落，躯干起伏
 */
function walk(dir) {
  const sideView = dir === 'E' || dir === 'W';
  const sgn = dir === 'W' ? -1 : 1;      // 左右镜像
  const flip = dir === 'N' ? -1 : 1;     // 背面视角左右相反
  const dur = 0.72, N = 8, frames = [];

  for (let i = 0; i < N; i++) {
    const p = i / N, ph = p * Math.PI * 2;
    const c = Math.cos(ph) * flip;
    const bob = Math.abs(Math.sin(ph)) * 0.022;   // 每步一次起伏
    const P = {
      torso_L: { y: bob },
      torso_U: { y: bob * 0.3 },
      head: {},
    };

    if (sideView) {
      const tilt = -7 * sgn;                       // 前倾
      const thL = -26 * c * sgn, thR = 26 * c * sgn;
      P.torso_U = { ...P.torso_U, ...pivotComp(H.torso_U, tilt, 'bottom'), rot: tilt };
      P.head = { rot: -tilt * 0.7 };
      P.thigh_L = limb('thigh_L', thL);
      P.thigh_R = limb('thigh_R', thR);
      P.calf_L = limb('calf_L', 24 * (1 - c) * 0.9);       // 后蹬时折膝
      P.calf_R = limb('calf_R', 24 * (1 + c) * 0.9);
      P.foot_L = { rot: -18 * (1 - c) * 0.5 };
      P.foot_R = { rot: -18 * (1 + c) * 0.5 };
      const aL = 30 * c * sgn, aR = -30 * c * sgn;         // 手臂与同侧腿反相
      P.upper_arm_L = limb('upper_arm_L', aL);
      P.upper_arm_R = limb('upper_arm_R', aR);
      P.forearm_L = limb('forearm_L', -30 - 18 * c);
      P.forearm_R = limb('forearm_R', -30 + 18 * c);
    } else {
      // 正面/背面：抬腿 + 手臂交替上下
      const lift = 0.05 * c;
      P.thigh_L = { y: lift, ...limb('thigh_L', 6 * c) };
      P.thigh_R = { y: -lift, ...limb('thigh_R', -6 * c) };
      P.calf_L = limb('calf_L', 16 - 16 * c);
      P.calf_R = limb('calf_R', 16 + 16 * c);
      P.foot_L = { rot: -8 * (1 - c) };
      P.foot_R = { rot: -8 * (1 + c) };
      P.upper_arm_L = { y: -0.035 * c, ...limb('upper_arm_L', 9 * c) };
      P.upper_arm_R = { y: 0.035 * c, ...limb('upper_arm_R', -9 * c) };
      P.forearm_L = limb('forearm_L', -22 - 10 * c);
      P.forearm_R = limb('forearm_R', -22 + 10 * c);
      P.head = { rot: 1.5 * c };
    }
    frames.push({ t: +(p * dur).toFixed(4), poses: P });
  }
  return { duration: dur, loop: 'loop', frames };
}

/** 攻击 attack：右手扳手蓄力横挥（0.62s 单次） */
function attack(dir) {
  const sgn = dir === 'W' ? -1 : 1;
  const tilt = (d) => ({ rot: d * sgn, ...pivotComp(H.torso_U, d * sgn, 'bottom') });
  return {
    duration: 0.62,
    loop: 'once',
    frames: [
      { t: 0, poses: {} },
      {
        t: 0.14,
        poses: {
          torso_L: { x: -0.02 * sgn },
          torso_U: tilt(8),
          head: { rot: -5 * sgn },
          upper_arm_R: limb('upper_arm_R', 46 * sgn),
          forearm_R: limb('forearm_R', -42 * sgn),
          upper_arm_L: limb('upper_arm_L', -12 * sgn),
        },
      },
      {
        t: 0.26,
        poses: {
          torso_L: { x: 0.05 * sgn, y: -0.01 },
          torso_U: tilt(-9),
          head: { rot: 7 * sgn },
          upper_arm_R: limb('upper_arm_R', -56 * sgn),
          forearm_R: limb('forearm_R', 6 * sgn),
          upper_arm_L: limb('upper_arm_L', 16 * sgn),
          thigh_R: limb('thigh_R', -10 * sgn),
        },
      },
      {
        t: 0.42,
        poses: {
          torso_U: tilt(-2),
          upper_arm_R: limb('upper_arm_R', -18 * sgn),
          forearm_R: limb('forearm_R', -24 * sgn),
        },
      },
      { t: 0.62, poses: {} },
    ],
  };
}

/** 受击 hit：后仰 + 回弹（0.42s 单次） */
function hit(dir) {
  const d = dir === 'E' ? 1 : -1;   // 后仰方向
  return {
    duration: 0.42,
    loop: 'once',
    frames: [
      { t: 0, poses: {} },
      {
        t: 0.08,
        poses: {
          torso_L: { x: -0.03 * d, y: -0.012 },
          torso_U: { rot: -17 * d, ...pivotComp(H.torso_U, -17 * d, 'bottom') },
          head: { rot: -13 * d },
          upper_arm_L: limb('upper_arm_L', 16 * d),
          upper_arm_R: limb('upper_arm_R', -12 * d),
          forearm_L: limb('forearm_L', -10 * d),
        },
      },
      {
        t: 0.19,
        poses: {
          torso_L: { x: 0.008 * d },
          torso_U: { rot: 5 * d, ...pivotComp(H.torso_U, 5 * d, 'bottom') },
          head: { rot: 4 * d },
        },
      },
      { t: 0.3, poses: { torso_U: { rot: -3 * d } } },
      { t: 0.42, poses: {} },
    ],
  };
}

/** 死亡 death：受击 → 侧倒 → 触地回弹 → 静止（1.2s 单次）
 *  fall(deg, cx, cy)：躯干绕底端转 deg·d 变躺姿，cx/cy 是"部件中心"的世界目标位
 *  （cy=部件中心离地高度，横躺时 ≈ 部件半厚 0.05~0.1）；函数内部扣除 pivot 补偿。 */
function death(dir) {
  const d = dir === 'E' ? -1 : 1;   // 倒向
  const fall = (deg, cx, cy) => {
    const c = pivotComp(H.torso_L, deg * d, 'bottom');
    return { rot: deg * d, x: cx * d - c.x, y: cy - 0.703 - c.y };
  };
  return {
    duration: 1.2,
    loop: 'once',
    frames: [
      { t: 0, poses: {} },
      {
        t: 0.16,
        poses: {
          torso_L: { x: -0.03 * d, y: -0.015 },
          torso_U: { rot: -18 * d, ...pivotComp(H.torso_U, -18 * d, 'bottom') },
          head: { rot: -14 * d },
          upper_arm_L: limb('upper_arm_L', 20 * d),
          upper_arm_R: limb('upper_arm_R', -16 * d),
        },
      },
      {
        t: 0.52,
        poses: {
          torso_L: fall(-58, 0.08, 0.35),
          torso_U: { rot: -8 * d },
          head: { rot: 6 * d },
          thigh_L: limb('thigh_L', 14 * d),
          thigh_R: limb('thigh_R', 8 * d),
          calf_L: limb('calf_L', -22 * d),
          calf_R: limb('calf_R', -14 * d),
          upper_arm_L: limb('upper_arm_L', 34 * d),
          upper_arm_R: limb('upper_arm_R', 28 * d),
        },
      },
      {
        t: 0.8,
        poses: {
          torso_L: fall(-84, 0.13, 0.09),
          torso_U: { rot: 4 * d },
          head: { rot: -4 * d },
          thigh_L: limb('thigh_L', 12 * d),
          thigh_R: limb('thigh_R', 6 * d),
          calf_L: limb('calf_L', -14 * d),
          calf_R: limb('calf_R', -8 * d),
          upper_arm_L: limb('upper_arm_L', 40 * d),
          upper_arm_R: limb('upper_arm_R', 34 * d),
        },
      },
      {
        t: 0.98,
        poses: {
          torso_L: fall(-79, 0.12, 0.14),
          head: { rot: 2 * d },
        },
      },
      {
        t: 1.2,
        poses: {
          torso_L: fall(-86, 0.15, 0.06),
          torso_U: { rot: 2 * d },
          head: { rot: -2 * d },
          thigh_L: limb('thigh_L', 12 * d),
          thigh_R: limb('thigh_R', 6 * d),
          calf_L: limb('calf_L', -12 * d),
          calf_R: limb('calf_R', -6 * d),
          upper_arm_L: limb('upper_arm_L', 42 * d),
          upper_arm_R: limb('upper_arm_R', 36 * d),
        },
      },
    ],
  };
}

// ---------- 3. 组装成 Clip（轨道） ----------
function toClip(name, spec) {
  const involved = new Set();
  for (const f of spec.frames) Object.keys(f.poses || {}).forEach(id => involved.add(id));

  const tracks = parts.map(part => {
    if (!involved.has(part.id)) {
      return { partId: part.id, keys: [{ t: 0, pose: { ...DEF }, ease: 'linear' }] };
    }
    // 未在该时刻出场的部件回落默认 pose，保证采样不出 NaN
    const keys = spec.frames.map(f => ({
      t: f.t,
      pose: { ...DEF, ...(f.poses[part.id] || {}) },
      ease: 'easeInOutQuad',
    }));
    return { partId: part.id, keys };
  });

  return { name, duration: spec.duration, loop: spec.loop, tracks };
}

const directions = {};
for (const dir of ['S', 'E', 'N', 'W']) {
  directions[dir] = {
    parts, // 与编辑器初始骨架一致
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
