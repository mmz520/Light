/**
 * 地皮（地面）生成 —— 模仿饥荒的地皮套路
 *
 * 饥荒的地面并不是"随机涂格子"，而是：
 *   1. 先把地图按 room 分地盘（每块 room 自带地皮调色板）；
 *   2. 把 room 的有机轮廓（圆 + 噪声扰动）落到格子上，边界格按噪声阈值决定归属；
 *   3. 地皮有覆盖优先级，高的会吃掉相邻的低地皮一格，并把细长的凸起磨圆；
 *   4. 最后才是贴图 / 变体 / 装饰，所以肉眼几乎看不到方格。
 *
 * 这里按同样的顺序实现：
 *   配额（占比归一化）→ 多源生长（噪声代价场，轮廓有机）→ 余量补缝
 *   → 边界侵蚀（高优先级吃低优先级）→ 去尖刺（磨圆角）
 *
 * 生成结果存成一串字符（每格一个 base36 字符，行之间 / 分隔），
 * 直接塞进 metadata.json，不用额外的文件；只有点"重新生成"时才会变。
 */

export type GroundTypeId = 'grass' | 'forest' | 'desert' | 'gobi' | 'snow' | 'swamp' | 'water';

export interface GroundTypeMeta {
  id: GroundTypeId;
  name: string;
  /** 没有贴图时的兜底配色 */
  color: string;
  /** 覆盖优先级：高的会吃进相邻的低地皮（水域最高，海岸线才是碎岛状） */
  priority: number;
  desc: string;
}

/**
 * 顺序即存盘编码里的下标（0..6），不要随便调整。
 */
export const GROUND_TYPES: GroundTypeMeta[] = [
  { id: 'grass', name: '草原', color: '#5f7a45', priority: 1, desc: '草皮、常青树、猪人村' },
  { id: 'forest', name: '森林', color: '#3a5130', priority: 1, desc: '密林、蜘蛛巢、树精' },
  { id: 'desert', name: '沙漠', color: '#b99a63', priority: 2, desc: '沙丘、仙人掌、伏兵' },
  { id: 'gobi', name: '戈壁', color: '#87755e', priority: 3, desc: '碎石、岩块、矿场' },
  { id: 'snow', name: '雪地', color: '#b9c9cf', priority: 2, desc: '冻土、企鹅、冰矿' },
  { id: 'swamp', name: '沼泽', color: '#4a5745', priority: 4, desc: '淤泥、触手、芦苇' },
  { id: 'water', name: '水域', color: '#2f4f6b', priority: 5, desc: '海洋，围在大陆外圈' },
];

export const GROUND_MIN = 12;
/** 上限放开到 9999：注意 9999² 约 1 亿格，生成要等很久、metadata.json 也会非常大 */
export const GROUND_MAX = 9999;

/** 空格子（地图外）：轮廓外就是它，渲染时直接 discard */
export const GROUND_VOID = 7;

/** 着色器里同时最多生效这么多组边界贴图：7 种地皮两两组合 C(7,2) = 21，全部允许 */
export const MAX_GROUND_EDGES = 21;

export interface GroundTypeSetting {
  /** 占比权重：各类型加起来可以超过 100，生成时按总和归一化 */
  ratio: number;
  /** 这一层地皮用的贴图（「贴图」目录的图片资产 id；null = 用纯色 / 类型默认色 + 程序纹理兜底） */
  textureId: string | null;
  /** 纯色（选了贴图时为 null；都为空时用类型默认色） */
  color?: string | null;
  /** true/undefined = 贴图重复贴满整块地面；false = 只贴一张（拉伸方式看贴图属性的单张拉伸策略） */
  loop?: boolean;
}

/**
 * 两种地皮之间的「中间贴图」：沿它们的交界铺一条手绘边，
 * 比纯算法混合更有手绘感。顺序无关（a/b 不分成主次）。
 * 没配中间贴图的组合继续走算法（邻格贴图按权重混合）。
 */
export interface GroundEdge {
  id: string;
  a: GroundTypeId;
  b: GroundTypeId;
  /** 中间贴图（「贴图」目录的图片资产 id；没设置就走算法） */
  textureId: string | null;
  color?: string | null;
  /** true/undefined = 沿交界重复铺满；false = 整条交界只铺一张（拉伸方式看贴图属性） */
  loop?: boolean;
}

export function groundEdgeKey(a: GroundTypeId, b: GroundTypeId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function newGroundEdge(a: GroundTypeId, b: GroundTypeId): GroundEdge {
  return {
    id: `edge_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
    a,
    b,
    textureId: null,
    color: null,
  };
}

export interface GroundConfig {
  seed: number;
  w: number;
  h: number;
  /** 一格等于多少场景单位（角色大概 0.5~0.8 格宽，和饥荒的 4 单位一格同思路） */
  cell: number;
  types: Record<GroundTypeId, GroundTypeSetting>;
  /** 边界中间贴图（按两种地皮的组合） */
  edges: GroundEdge[];
  /** 生成结果：每格一个 base36 字符（GROUND_TYPES 下标，7 = 空格子），行之间用 / 分隔；'' = 还没生成 */
  map: string;
  /**
   * 渲染代数：每次重新生成 +1。渲染层靠它判断"地图内容变没变"——
   * 不能用 seed（改种子参数不该动地面）也不能用 map.length（重新生成后长度通常不变）。
   */
  gen: number;
}

export function defaultGroundConfig(): GroundConfig {
  return {
    seed: 20261103,
    w: 48,
    h: 48,
    cell: 1,
    types: {
      grass: { ratio: 30, textureId: null },
      forest: { ratio: 20, textureId: null },
      desert: { ratio: 12, textureId: null },
      gobi: { ratio: 10, textureId: null },
      snow: { ratio: 8, textureId: null },
      swamp: { ratio: 8, textureId: null },
      water: { ratio: 12, textureId: null },
    },
    edges: [],
    map: '',
    gen: 0,
  };
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 读盘 / 老工程迁移：缺字段补默认值，坏值夹到合法区间 */
export function normalizeGround(raw: Partial<GroundConfig> | null | undefined): GroundConfig {
  const base = defaultGroundConfig();
  if (!raw) return base;
  const types = { ...base.types };
  for (const t of GROUND_TYPES) {
    const s = raw.types?.[t.id];
    if (!s) continue;
    types[t.id] = {
      ratio: Number.isFinite(s.ratio) ? Math.min(400, Math.max(0, Number(s.ratio))) : base.types[t.id].ratio,
      textureId: s.textureId ?? null,
      color: typeof s.color === 'string' && s.color ? s.color : null,
      loop: s.loop !== false,
    };
  }
  return {
    seed: Number.isFinite(raw.seed) ? Math.round(Number(raw.seed)) : base.seed,
    w: clampInt(raw.w, GROUND_MIN, GROUND_MAX, base.w),
    h: clampInt(raw.h, GROUND_MIN, GROUND_MAX, base.h),
    cell: Number.isFinite(raw.cell) && Number(raw.cell) > 0 ? Math.min(4, Math.max(0.25, Number(raw.cell))) : 1,
    types,
    edges: normalizeEdges(raw.edges),
    map: typeof raw.map === 'string' ? raw.map : '',
    gen: Number.isFinite(raw.gen) ? Math.max(0, Math.round(Number(raw.gen))) : 0,
  };
}

/** 边界贴图列表：丢掉坏项 / 同种地皮 / 重复组合，最多留 MAX_GROUND_EDGES 组 */
function normalizeEdges(raw: unknown): GroundEdge[] {
  if (!Array.isArray(raw)) return [];
  const valid = new Set(GROUND_TYPES.map((t) => t.id));
  const out: GroundEdge[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Partial<GroundEdge>;
    if (!e.a || !e.b || e.a === e.b) continue;
    if (!valid.has(e.a) || !valid.has(e.b)) continue;
    const key = groundEdgeKey(e.a, e.b);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: typeof e.id === 'string' && e.id ? e.id : newGroundEdge(e.a, e.b).id,
      a: e.a,
      b: e.b,
      textureId: typeof e.textureId === 'string' && e.textureId ? e.textureId : null,
      color: typeof e.color === 'string' && e.color ? e.color : null,
      loop: e.loop !== false,
    });
    if (out.length >= MAX_GROUND_EDGES) break;
  }
  return out;
}

/** 归一化后的实际占比（0~1），界面上用来显示"合起来 120 时各占多少" */
export function ratioPercents(cfg: GroundConfig): Record<GroundTypeId, number> {
  const total = GROUND_TYPES.reduce((s, t) => s + Math.max(0, cfg.types[t.id]?.ratio ?? 0), 0);
  const out = {} as Record<GroundTypeId, number>;
  for (const t of GROUND_TYPES) {
    out[t.id] = total <= 0 ? 0 : Math.max(0, cfg.types[t.id]?.ratio ?? 0) / total;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 生成                                                                */
/* ------------------------------------------------------------------ */

export interface GroundMap {
  w: number;
  h: number;
  /** 每格的地皮下标（GROUND_TYPES 的下标） */
  tiles: Uint8Array;
}

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

export function encodeMap(tiles: Uint8Array, w: number, h: number): string {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) row += DIGITS[tiles[y * w + x]] ?? '0';
    rows.push(row);
  }
  return rows.join('/');
}

export function decodeMap(map: string, w: number, h: number): Uint8Array | null {
  if (!map) return null;
  const rows = map.split('/');
  if (rows.length !== h) return null;
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    if (row.length !== w) return null;
    for (let x = 0; x < w; x++) {
      const v = DIGITS.indexOf(row[x]);
      // 0..6 = 地皮，7 = 空格子（自由形状的轮廓外）
      if (v < 0 || v > GROUND_TYPES.length) return null;
      tiles[y * w + x] = v;
    }
  }
  return tiles;
}

/** 工程里的地皮图（'': 未生成；坏数据也当没有） */
export function groundTiles(cfg: GroundConfig): GroundMap | null {
  const tiles = decodeMap(cfg.map, cfg.w, cfg.h);
  return tiles ? { w: cfg.w, h: cfg.h, tiles } : null;
}

export function tileCounts(tiles: Uint8Array): Record<GroundTypeId, number> {
  const out = {} as Record<GroundTypeId, number>;
  for (const t of GROUND_TYPES) out[t.id] = 0;
  for (let i = 0; i < tiles.length; i++) {
    const id = GROUND_TYPES[tiles[i]]?.id;
    if (id) out[id] += 1;
  }
  return out;
}

/* ---------------- 噪声 / 随机 ---------------- */

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 值噪声（够用，不需要引入 simd 噪声库） */
function vnoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

function fbm(x: number, y: number, seed: number, octaves = 3): number {
  let v = 0;
  let amp = 0.55;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    v += vnoise(x * f, y * f, seed + i * 131) * amp;
    norm += amp;
    f *= 2;
    amp *= 0.5;
  }
  return norm > 0 ? v / norm : 0;
}

/** 最小堆：生长时每次都取"最便宜"的格子，轮廓才会顺着噪声走 */
class MinHeap {
  private idx: number[] = [];
  private cost: number[] = [];

  get size(): number {
    return this.idx.length;
  }

  push(i: number, c: number): void {
    let k = this.idx.length;
    this.idx.push(i);
    this.cost.push(c);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.cost[p] <= this.cost[k]) break;
      this.swap(p, k);
      k = p;
    }
  }

  pop(): number {
    const n = this.idx.length;
    if (n === 0) return -1;
    const top = this.idx[0];
    const lastI = this.idx.pop() as number;
    const lastC = this.cost.pop() as number;
    if (n > 1) {
      this.idx[0] = lastI;
      this.cost[0] = lastC;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < this.idx.length && this.cost[l] < this.cost[m]) m = l;
        if (r < this.idx.length && this.cost[r] < this.cost[m]) m = r;
        if (m === k) break;
        this.swap(m, k);
        k = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const ti = this.idx[a];
    this.idx[a] = this.idx[b];
    this.idx[b] = ti;
    const tc = this.cost[a];
    this.cost[a] = this.cost[b];
    this.cost[b] = tc;
  }
}

/* ---------------- 主流程 ---------------- */

export function generateGround(cfg: GroundConfig): GroundMap {
  const w = clampInt(cfg.w, GROUND_MIN, GROUND_MAX, 48);
  const h = clampInt(cfg.h, GROUND_MIN, GROUND_MAX, 48);
  const n = w * h;
  const rnd = mulberry32((cfg.seed | 0) ^ 0x9e3779b9);
  const seed = cfg.seed | 0;

  const weights = GROUND_TYPES.map((t) => Math.max(0, cfg.types[t.id]?.ratio ?? 0));
  const totalW = weights.reduce((a, b) => a + b, 0);
  const fallback = new Uint8Array(n);

  // 全为 0：退回草原，别把地图搞成空白
  if (totalW <= 0) {
    fallback.fill(0);
    return { w, h, tiles: fallback };
  }

  /* 1.5 外轮廓：椭圆底 + 低频噪声咬边，再做多轮"细胞自动机"平滑把外缘磨圆。
        轮廓外是空格子（VOID）。平滑是外边缘圆滑的关键 —— 纯噪声海岸会有大量
        单格毛刺，多数表决几轮后只剩低频的有机起伏。 */
  const land = new Uint8Array(n);
  const coast: number[] = [];
  let landCount = 0;
  {
    const rx = w / 2;
    const ry = h / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const nx = (x + 0.5 - rx) / rx;
        const ny = (y + 0.5 - ry) / ry;
        // 椭圆距离 0（中心）→ 1（边中点），角上 ~1.41；噪声让海岸线犬牙交错
        const d = Math.sqrt(nx * nx + ny * ny);
        const wob = (fbm(x * 0.05 + 3.1, y * 0.05 + 8.7, seed + 31, 2) - 0.5) * 0.62;
        land[y * w + x] = d + wob < 0.86 ? 1 : 0;
      }
    }
    // CA 平滑：3 轮 8 邻域多数表决 —— 陆格 8 邻里陆地太少（<3）就被冲掉（去毛刺），
    // 空格 8 邻里陆地够多（>=5）就填上（补凹坑），外缘自然变圆滑
    for (let pass = 0; pass < 3; pass++) {
      const src = land.slice();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          let cnt = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              cnt += src[ny * w + nx];
            }
          }
          land[i] = src[i] ? (cnt >= 3 ? 1 : 0) : cnt >= 5 ? 1 : 0;
        }
      }
    }
    for (let i = 0; i < n; i++) if (land[i]) landCount += 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!land[i]) continue;
        const edge =
          x === 0 || y === 0 || x === w - 1 || y === h - 1 || !land[i - 1] || !land[i + 1] || !land[i - w] || !land[i + w];
        if (edge) coast.push(i);
      }
    }
    if (landCount === 0) {
      fallback.fill(0);
      return { w, h, tiles: fallback };
    }
  }

  /* 1. 配额：按归一化占比切陆格总数，余数补给小数部分最大的几个 */
  const quotas = weights.map((v) => Math.floor((v / totalW) * landCount));
  const rest = landCount - quotas.reduce((a, b) => a + b, 0);
  const frac = weights
    .map((v, i) => ({ i, f: (v / totalW) * landCount - quotas[i] }))
    .sort((a, b) => b.f - a.f);
  for (let k = 0; k < rest; k++) quotas[frac[k % frac.length].i] += 1;

  const active = weights.map((v, i) => ({ v, i })).filter((t) => t.v > 0).map((t) => t.i);
  if (active.length === 0) {
    fallback.fill(0);
    return { w, h, tiles: fallback };
  }

  const owner = new Int8Array(n).fill(-1);
  const counts = new Array(GROUND_TYPES.length).fill(0) as number[];

  // 生长代价场：低频噪声 → 大块有机形状；一点点随机 → 边界不呆板。
  // 量化到 Uint8（9999² 时省下 300MB），随机项也换成确定性 hash，保证同格同价
  const costField = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fbm(x * 0.075 + 11.3, y * 0.075 + 5.9, seed, 3) + hash2(x, y, seed + 5) * 0.34;
      costField[y * w + x] = Math.max(0, Math.min(255, Math.round(c * 90)));
    }
  }

  /* 宏观偏好场：每种地皮一张自己的低分辨率"倾向图"（值越低越想去）。
        相位 = seed + 类型号，所以换种子时各类型的偏好区域整块移动 ——
        森林这局在西北、下局可能就跑到东南，解决"怎么随机大体位置都不变"。
        只按 active 类型各存 K² 个数，9999² 也几乎不占内存。 */
  const K = Math.max(3, Math.min(24, Math.round(Math.sqrt(landCount) / 12)));
  const bias: Float32Array[] = active.map((ti) => {
    const g = new Float32Array(K * K);
    let min = Infinity;
    let max = -Infinity;
    for (let by = 0; by < K; by++) {
      for (let bx = 0; bx < K; bx++) {
        const v = fbm(bx * 0.55 + ti * 17.31, by * 0.55 + ti * 9.7, seed + ti * 613, 2);
        g[by * K + bx] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const span = max - min;
    if (span > 1e-6) for (let i = 0; i < g.length; i++) g[i] = (g[i] - min) / span;
    return g;
  });
  const BIAS_GAIN = 110; // 相对共享代价场(0~120)足够大，宏观偏好才推得动大块布局
  const biasOf = (ai: number, idx: number): number => {
    const bx = Math.min(K - 1, ((idx % w) * K) / w | 0);
    const by = Math.min(K - 1, (((idx / w) | 0) * K) / h | 0);
    return bias[ai][by * K + bx];
  };

  const heaps = GROUND_TYPES.map(() => new MinHeap());
  const pushNeighbors = (idx: number, ai: number, ti: number) => {
    const x = idx % w;
    const y = (idx / w) | 0;
    if (x > 0 && land[idx - 1]) heaps[ti].push(idx - 1, costField[idx - 1] + biasOf(ai, idx - 1) * BIAS_GAIN);
    if (x < w - 1 && land[idx + 1]) heaps[ti].push(idx + 1, costField[idx + 1] + biasOf(ai, idx + 1) * BIAS_GAIN);
    if (y > 0 && land[idx - w]) heaps[ti].push(idx - w, costField[idx - w] + biasOf(ai, idx - w) * BIAS_GAIN);
    if (y < h - 1 && land[idx + w]) heaps[ti].push(idx + w, costField[idx + w] + biasOf(ai, idx + w) * BIAS_GAIN);
  };
  const claim = (idx: number, ai: number, ti: number) => {
    owner[idx] = ti;
    counts[ti] += 1;
    pushNeighbors(idx, ai, ti);
  };

  /* 2. 种子点：水域下在海岸（贴空格子的陆格），陆地种在"自己偏好区域"里 ——
        每个种子都在随机抽出的候选里挑偏好值最低的那个（锦标赛选择），
        布局随种子强烈变化，同时保持大块、少碎片 */
  const waterIdx = GROUND_TYPES.findIndex((t) => t.id === 'water');
  const seedEvery = Math.max(48, Math.round(landCount / (active.length * 3)));
  const landList: number[] = [];
  for (let i = 0; i < n; i++) if (land[i]) landList.push(i);
  /** 锦标赛：随机抽 candidates 个空陆格，返回偏好值最低的那个（-1 = 没抽到空格） */
  const pickCell = (ai: number, candidates: number): number => {
    let best = -1;
    let bestB = Infinity;
    for (let t = 0; t < candidates; t++) {
      const at = landList[Math.floor(rnd() * landList.length)];
      if (owner[at] !== -1) continue;
      const b = biasOf(ai, at);
      if (b < bestB) {
        bestB = b;
        best = at;
      }
    }
    return best;
  };
  for (let ai = 0; ai < active.length; ai++) {
    const ti = active[ai];
    const need = Math.max(1, Math.min(14, Math.round(quotas[ti] / seedEvery) + 1));
    if (ti === waterIdx) {
      // 水域贴着海岸下种子：洗牌海岸线，锦标赛挑最偏好的那几个
      for (let i = coast.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const tmp = coast[i];
        coast[i] = coast[j];
        coast[j] = tmp;
      }
      let placed = 0;
      for (let k = 0; k < coast.length && placed < need; k++) {
        const at = coast[k];
        if (owner[at] !== -1) continue;
        if (placed > 0 && biasOf(ai, at) > 0.75) continue; // 水域也稍微挑挑位置，但第一颗必须下
        claim(at, ai, ti);
        placed += 1;
      }
      continue;
    }
    let placed = 0;
    for (let tries = 0; tries < need * 60 && placed < need; tries++) {
      const at = pickCell(ai, 5);
      if (at < 0) continue;
      claim(at, ai, ti);
      placed += 1;
    }
  }

  /* 3. 多源生长：按占比给每种地皮不同的生长速度 —— 占比大的长成一整块，
        占比小的填进缝隙，这样不会被"每轮各拿一格"的轮转摊平成斑点 */
  const maxWeight = Math.max(...weights, 1);
  const laneRate = weights.map((v) => Math.max(1, Math.round((v / maxWeight) * 6)));
  const aiOf = new Map<number, number>();
  active.forEach((ti, ai) => aiOf.set(ti, ai));
  let guard = n * 3;
  while (guard-- > 0) {
    let progressed = false;
    for (const ti of active) {
      const heap = heaps[ti];
      for (let step = 0; step < laneRate[ti]; step++) {
        if (counts[ti] >= quotas[ti]) break;
        let idx = -1;
        while (heap.size > 0) {
          const candidate = heap.pop();
          if (candidate >= 0 && owner[candidate] === -1) {
            idx = candidate;
            break;
          }
        }
        if (idx < 0) break;
        claim(idx, aiOf.get(ti) ?? 0, ti);
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  /* 4. 补缝：剩下的空陆格由相邻地皮蔓延填掉（近似 Voronoi 的补位）；
        空格子（VOID）不参与，保持轮廓 */
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (owner[i] === -1) continue;
    const x = i % w;
    const y = (i / w) | 0;
    if (
      (x > 0 && land[i - 1] && owner[i - 1] === -1) ||
      (x < w - 1 && land[i + 1] && owner[i + 1] === -1) ||
      (y > 0 && land[i - w] && owner[i - w] === -1) ||
      (y < h - 1 && land[i + w] && owner[i + w] === -1)
    )
      queue.push(i);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const idx = queue[qi];
    const ti = owner[idx];
    if (ti < 0) continue;
    const x = idx % w;
    const y = (idx / w) | 0;
    const nbs = [x > 0 ? idx - 1 : -1, x < w - 1 ? idx + 1 : -1, y > 0 ? idx - w : -1, y < h - 1 ? idx + w : -1];
    for (const nb of nbs) {
      if (nb < 0 || !land[nb] || owner[nb] !== -1) continue;
      owner[nb] = ti;
      counts[ti] += 1;
      queue.push(nb);
    }
  }

  /* 5. 边界侵蚀：高优先级吃进低优先级。只在"凹口/尖角"（至少两个方向被高地皮压着）
        才吃，平直的海岸线保留，否则整块大陆会被啃掉一圈、占比也守不住 */
  const before = owner.slice();
  const prio = GROUND_TYPES.map((t) => t.priority);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const t = before[idx];
      if (t < 0) continue;
      // 贴着外轮廓（VOID）的格子不参与侵蚀：海岸线轮廓已经 CA 磨圆了，别再啃出毛刺
      if (
        (x > 0 && !land[idx - 1]) ||
        (x < w - 1 && !land[idx + 1]) ||
        (y > 0 && !land[idx - w]) ||
        (y < h - 1 && !land[idx + w])
      )
        continue;
      const threshold = fbm(x * 0.28 + 3.7, y * 0.28 + 19.1, seed + 77, 2);
      if (threshold < 0.42) continue;
      let best = -1;
      let pressure = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const u = before[ny * w + nx];
          if (u < 0 || u === t || prio[u] <= prio[t]) continue;
          pressure += 1;
          if (best < 0 || prio[u] > prio[best]) best = u;
        }
      }
      if (best >= 0 && pressure >= 2) owner[idx] = best;
    }
  }

  /* 6. 去尖刺：一格宽的低地皮凸起（两侧被同一块高地皮夹住）直接并进去，直角就磨圆了 */
  const pass2 = owner.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const t = pass2[idx];
      if (t < 0) continue;
      const tally = new Map<number, number>();
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const u = pass2[ny * w + nx];
        if (u < 0 || u === t || prio[u] <= prio[t]) continue;
        tally.set(u, (tally.get(u) ?? 0) + 1);
      }
      let best = -1;
      let bestN = 1;
      for (const [u, cnt] of tally) {
        if (cnt > bestN || (cnt === bestN && best >= 0 && prio[u] > prio[best])) {
          best = u;
          bestN = cnt;
        }
      }
      if (best >= 0) owner[idx] = best;
    }
  }

  /* 7. 配额回收：生长速度与侵蚀都会让实际面积偏离设定，最后沿接触面把超出类型的格子
        让给不足的类型（只换四邻相接的格子，所以不会长出孤立碎块） */
  // 侵蚀/磨圆直接改了 owner，先把计数对齐到当前地图
  counts.fill(0);
  for (let i = 0; i < n; i++) if (owner[i] >= 0) counts[owner[i]] += 1;
  for (let round = 0; round < 24; round++) {
    const over: number[] = [];
    const under: number[] = [];
    for (const ti of active) {
      if (counts[ti] > quotas[ti] * 1.05) over.push(ti);
      else if (counts[ti] < quotas[ti] * 0.95) under.push(ti);
    }
    if (over.length === 0 || under.length === 0) break;

    let moved = 0;
    for (const ti of under) {
      let need = quotas[ti] - counts[ti];
      if (need <= 0) continue;
      const cand: number[] = [];
      for (let i = 0; i < n && cand.length < need * 8 + 96; i++) {
        const u = owner[i];
        if (!over.includes(u)) continue;
        const x = i % w;
        const y = (i / w) | 0;
        const touches =
          (x > 0 && owner[i - 1] === ti) ||
          (x < w - 1 && owner[i + 1] === ti) ||
          (y > 0 && owner[i - w] === ti) ||
          (y < h - 1 && owner[i + w] === ti);
        if (touches) cand.push(i);
      }
      if (cand.length === 0) continue;
      // 洗牌：让缺口沿整条接触面均匀补，而不是堆在一处
      for (let i = cand.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const tmp = cand[i];
        cand[i] = cand[j];
        cand[j] = tmp;
      }
      for (let k = 0; k < cand.length && need > 0; k++) {
        const idx = cand[k];
        const u = owner[idx];
        if (!over.includes(u) || counts[u] <= quotas[u]) continue;
        owner[idx] = ti;
        counts[u] -= 1;
        counts[ti] += 1;
        need -= 1;
        moved += 1;
      }
    }
    if (moved === 0) break;
  }

  const tiles = new Uint8Array(n);
  for (let i = 0; i < n; i++) tiles[i] = owner[i] < 0 ? GROUND_VOID : owner[i];
  return { w, h, tiles };
}

/** 生成并直接得到可存盘的 map 字符串（store 里用） */
export function generateGroundMap(cfg: GroundConfig): { map: string; w: number; h: number; counts: Record<GroundTypeId, number> } {
  const gen = generateGround(cfg);
  return { map: encodeMap(gen.tiles, gen.w, gen.h), w: gen.w, h: gen.h, counts: tileCounts(gen.tiles) };
}
