/**
 * 地皮网格：把生成出来的格子交给 GPU 画
 *
 * 难点是"看不出方格"。格子本身是硬的，如果直接把每格当四边形贴一张图，
 * 边界就是一条沿格线的锯齿 —— 这正是最大的破绽。
 *
 * 关键是把两件事分开：
 *
 *   1. 【边界】用域扭曲（domain warping）推弯：查"这一格是什么地皮"时用 q（被噪声推过），
 *      相当于饥荒里把拐角顶点挪开，直角就变成有机曲线；
 *   2. 【贴图】必须用没扭曲的 g（世界空间连续坐标）采样：如果贴图也跟着 q 走，
 *      地皮花纹会被拧成漩涡 —— 边界有机了，材质却像融化的塑料。
 *      所以这里 pos(type) 和 pos(tex) 是两套坐标。
 *
 * 过渡有两个来源：
 *   · 算法过渡：边界带里按权重混四个邻格的贴图（默认）；
 *   · 中间贴图：两块地皮之间单独配一张手绘边（GroundConfig.edges），
 *     边界带里用它的 alpha 叠上去，比纯算法更有手绘感。
 *
 * 整块地面只有 1 个 draw call（一个 plane）：7 种地皮各占一个 sampler；
 * 边界中间贴图最多 21 组（7 种地皮两两组合），逐张绑会超出纹理单元上限，
 * 所以全部合成一张图集（uEdgeAtlas），着色器按格子偏移采样。
 * 缺贴图的类型用程序生成的同色噪点纹理兜底，所以永远有东西可画。
 */
import * as THREE from 'three';

import { GROUND_TYPES, MAX_GROUND_EDGES, type GroundConfig, type GroundMap, type GroundTypeId } from '../model/ground';
import { imageCssUrl, imageUrl, textureById, textureImage } from '../model/resolve';
import { croppedSize, DIRS, type ImageAsset, type ProjectDoc } from '../model/types';

/* ------------------------------------------------------------------ */
/* 兜底纹理：没有配贴图时用的同色噪点                                   */
/* ------------------------------------------------------------------ */

const fallbackCache = new Map<string, THREE.Texture>();

function fallbackTexture(typeId: GroundTypeId, color: string): THREE.Texture {
  // 缓存键必须带上颜色：同一种地皮换成不同纯色时（选了自定义颜色），要重画兜底纹理
  const key = `${typeId}:${color}`;
  const hit = fallbackCache.get(key);
  if (hit) return hit;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    let s = 1337;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      return ((s >>> 8) & 0xffff) / 0xffff;
    };
    // 多层颗粒：小点 + 中等斑块，远看像"有颗粒的地皮"而不是纯色块
    for (let i = 0; i < 900; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = 0.6 + rnd() * 2.6;
      const light = rnd() > 0.5;
      ctx.fillStyle = light ? 'rgba(255,244,214,0.07)' : 'rgba(0,0,0,0.10)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 60; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = 4 + rnd() * 10;
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // 地皮贴图是平铺的：必须 Repeat，Clamp 会在每格边缘夹出一条直线，整片地面就是网格
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  fallbackCache.set(key, tex);
  return tex;
}

/** 全部边界中间贴图合成一张图集时的单格边长（像素） */
const ATLAS_CELL = 256;

/** 贴图密度：一格对应多少张图（<1 表示一张图铺满一格多，重复感更弱） */
const TEX_SCALE = 0.62;

/**
 * 不重复（单张铺满整块地面）时每类贴图的拉伸策略：
 *   · 拉伸（默认）：(1,1,0,0) 直接铺满（拉伸，可变形）；
 *   · 等比：居中裁切铺满（cover）—— 采样区 (cx, cy) 与原图同宽高比，不变形（圆的还是圆的）；
 *   · 九宫格：tf.z = 1，逐轴分段映射见 uNineX / uNineY —— 四边四角保持原状，中间拉伸补满。
 */
function planeTransform(doc: ProjectDoc, gw: number, gh: number, id: string | null): { tf: THREE.Vector4; nx: THREE.Vector4; ny: THREE.Vector4 } {
  const none = { tf: new THREE.Vector4(1, 1, 0, 0), nx: new THREE.Vector4(), ny: new THREE.Vector4() };
  const img = groundImage(doc, id);
  if (!img || gh <= 0) return none;
  const s = croppedSize(img);
  // ρ = 地面长宽比 ÷ 贴图长宽比（>1 = 地面相对贴图更宽）
  const rho = gw / gh / Math.max(1e-6, s.w / Math.max(1, s.h));
  if (img.tiling === 'aspect') {
    const tf = rho <= 1 ? new THREE.Vector4(1, rho, 0, 0) : new THREE.Vector4(1 / rho, 1, 0, 0);
    return { tf, nx: new THREE.Vector4(), ny: new THREE.Vector4() };
  }
  if (img.tiling === 'nine' && img.nine) {
    // 目标平面 gw×gh（世界格），源图 s.w×s.h（像素）。九宫格：边缘区按源像素 1:1，
    // 中间区拉伸补满。取 s = 世界单位/源像素，保证两个轴的边缘区都放得下（留 2% 中缝）。
    const { l, t, r, b } = img.nine;
    const sx = gw / (Math.max(l + r, 1e-4) * s.w);
    const sy = gh / (Math.max(t + b, 1e-4) * s.h);
    const k = 0.98 * Math.min(sx, sy);
    // 每轴映射 uv(p)：p<p0 → p/B；p<1-p1 → p·M + p0·(B-M)；否则 p/B + 1-1/B
    // B = 边界斜率（目标长 / 边缘源长），p0/p1 = 左(下)/右(上)边缘断点（目标归一化），M = 中段斜率。
    // 中段偏移由连续性推出：uv(p0) = p0·B = l。
    const axis = (fl: number, fr: number, target: number, src: number): THREE.Vector4 => {
      const B = target / (k * src);
      const p0 = fl / B;
      const p1 = fr / B;
      const M = (1 - fl - fr) / Math.max(1 - p0 - p1, 1e-3);
      return new THREE.Vector4(B, p0, p1, M);
    };
    return { tf: new THREE.Vector4(0, 0, 1, 0), nx: axis(l, r, gw, s.w), ny: axis(t, b, gh, s.h) };
  }
  return none;
}

/* ------------------------------------------------------------------ */
/* 贴图资产 → three 纹理                                               */
/* ------------------------------------------------------------------ */

/** 贴图槽引用解析：现在是「贴图」目录的图片 id；老数据可能是图组 id，解包成源图 */
function groundImage(doc: ProjectDoc, id: string | null): ImageAsset | null {
  if (!id) return null;
  const direct = doc.images.find((i) => i.id === id);
  if (direct) return direct;
  const tex = textureById(doc, id);
  if (!tex) return null;
  const s = textureImage(doc, tex, 'S');
  if (s) return s;
  for (const d of DIRS) {
    const img = textureImage(doc, tex, d);
    if (img) return img;
  }
  return null;
}

const urlCache = new Map<string, THREE.Texture>();

/**
 * 图片资产 → three 纹理（缓存共享；首次加载是异步的，材质先挂兜底纹理不会白块）
 *
 * 裁剪必须在这里就裁好：地皮用的是自定义 uniform 的 sampler，three 的 texture.offset/repeat
 * 只作用于材质内置的 map 槽，对这类纹理完全不参与采样（之前写成 UV 偏移 = 裁剪静默失效）。
 */
function loadImageTexture(doc: ProjectDoc, img: ImageAsset): THREE.Texture {
  const url = imageCssUrl(doc, img);
  const hit = urlCache.get(url);
  if (hit) return hit;
  const tex = new THREE.Texture();
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  urlCache.set(url, tex);
  new THREE.TextureLoader().load(url, (loaded) => {
    tex.image = loaded.image;
    tex.needsUpdate = true;
  });
  return tex;
}

/* ------------------------------------------------------------------ */
/* 着色器                                                              */
/* ------------------------------------------------------------------ */

const VERT = /* glsl */ `
varying vec2 vUv;
varying float vDepth;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uMap;   // 类型图：R 通道 = 地皮下标
uniform sampler2D uT0;
uniform sampler2D uT1;
uniform sampler2D uT2;
uniform sampler2D uT3;
uniform sampler2D uT4;
uniform sampler2D uT5;
uniform sampler2D uT6;

// 边界中间贴图图集：最多 21 组（7 种地皮两两组合），一张纹理全放下
uniform sampler2D uEdgeAtlas;
/** 每组在图集里的格子：(offX, offY, scaleX, scaleY)；scale = 0 表示这组没配贴图 */
uniform vec4 uEdgeCell[21];

/** 每类地皮是否重复贴满：1 = 重复；0 = 整块地面只贴一张（单张模式，拉伸策略生效） */
uniform float uLoop[7];
/** 每组边界贴图是否重复：同上 */
uniform float uEdgeLoop[21];

/** 重复模式下的贴图密度：一格对应多少张图（<1 表示一张图占一格多，重复感更弱） */
uniform float uTexScale;
/** 重复模式下的采样偏移（来自种子，让不同种子的花纹错开） */
uniform vec2 uTOff;
/** 每类地皮单张模式（不重复）时的拉伸策略：z > 0.5 = 九宫格；否则 xy = 居中缩放（等比=cover，拉伸=(1,1)） */
uniform vec4 uPlaneTf[7];
/** 九宫格逐轴分段映射 (B, p0, p1, M)：B = 边界斜率，p0/p1 = 边缘断点，M = 中段斜率 */
uniform vec4 uNineX[7];
uniform vec4 uNineY[7];

uniform vec2 uSize;       // 地图格数 (w, h)
uniform float uSeed;
/** 边界扭曲强度（1 = 正常；0 = 直边） */
uniform float uBandWarp;
/** 边界贴图组合：x = 类型 a + 1，y = 类型 b + 1（0 = 空位） */
uniform vec2 uEdgePair[21];
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;

varying vec2 vUv;
varying float vDepth;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/** 取某格的地皮下标；地图外返回 -1 */
float typeAt(vec2 g) {
  vec2 c = floor(g);
  vec2 uv = (c + 0.5) / uSize;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return -1.0;
  return floor(texture2D(uMap, uv).r * 255.0 + 0.5);
}

/**
 * 单张模式（不重复，整块地面只贴一张）按贴图属性里的拉伸策略修正采样坐标：
 *   · 九宫格（tf.z > 0.5）：逐轴分段映射 —— 边缘区按源像素 1:1（不变形），中间区拉伸补满。
 *     每轴参数 (B, p0, p1, M)：p<p0 → p·B；p<1-p1 → p·M + p0·(B-M)；否则 p·B + 1-B。
 *   · 否则：uv = 0.5 + (p - 0.5)·tf.xy。等比 = 居中裁切铺满（cover），不变形；拉伸 = (1,1)。
 */
vec2 planeUv(vec2 p, vec4 tf, vec4 nx, vec4 ny) {
  if (tf.z > 0.5) {
    float u = p.x < nx.y ? p.x * nx.x : (p.x < 1.0 - nx.z ? p.x * nx.w + nx.y * (nx.x - nx.w) : p.x * nx.x + 1.0 - nx.x);
    float v = p.y < ny.y ? p.y * ny.x : (p.y < 1.0 - ny.z ? p.y * ny.w + ny.y * (ny.x - ny.w) : p.y * ny.x + 1.0 - ny.x);
    return vec2(u, v);
  }
  return vec2(0.5) + (p - 0.5) * tf.xy;
}

/** 取某类地皮的贴图：重复 → 世界空间平铺（固定密度）；单张 → 按该类贴图的拉伸策略 */
vec4 texOf(float id, vec2 rw, vec2 plane) {
  if (id < 0.5) return texture2D(uT0, uLoop[0] > 0.5 ? rw * uTexScale + uTOff : planeUv(plane, uPlaneTf[0], uNineX[0], uNineY[0]));
  if (id < 1.5) return texture2D(uT1, uLoop[1] > 0.5 ? rw * uTexScale + uTOff : planeUv(plane, uPlaneTf[1], uNineX[1], uNineY[1]));
  if (id < 2.5) return texture2D(uT2, uLoop[2] > 0.5 ? rw * uTexScale + uTOff : planeUv(plane, uPlaneTf[2], uNineX[2], uNineY[2]));
  if (id < 3.5) return texture2D(uT3, uLoop[3] > 0.5 ? rw * uTexScale + uTOff : planeUv(plane, uPlaneTf[3], uNineX[3], uNineY[3]));
  if (id < 4.5) return texture2D(uT4, uLoop[4] > 0.5 ? rw * uTexScale + uTOff : planeUv(plane, uPlaneTf[4], uNineX[4], uNineY[4]));
  if (id < 5.5) return texture2D(uT5, uLoop[5] > 0.5 ? rw * uTexScale + uTOff : planeUv(plane, uPlaneTf[5], uNineX[5], uNineY[5]));
  return texture2D(uT6, uLoop[6] > 0.5 ? rw * uTexScale + uTOff : planeUv(plane, uPlaneTf[6], uNineX[6], uNineY[6]));
}

vec2 rot2(vec2 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

/** 这对地皮有没有配中间贴图：返回下标，-1 = 没配（走算法过渡） */
int edgeIndexFor(float a, float b) {
  for (int i = 0; i < 21; i++) {
    vec2 p = uEdgePair[i];
    if (p.x > 0.5) {
      float pa = p.x - 1.0;
      float pb = p.y - 1.0;
      bool same = abs(pa - a) < 0.5 && abs(pb - b) < 0.5;
      bool swapped = abs(pa - b) < 0.5 && abs(pb - a) < 0.5;
      if (same || swapped) return i;
    }
  }
  return -1;
}

/**
 * 把邻格并进当前颜色：
 *   · 这对地皮配了中间贴图 → 从图集里取它的 alpha 在边界带上铺一条手绘边；
 *   · 没配（或贴图这块是全透明的）→ 按权重混邻格贴图（算法过渡）。
 */
void blendNeighbor(float idC, float idn, vec2 rw, vec2 plane, float w, inout vec4 acc, inout float wsum) {
  if (idn < 0.0 || idn > 6.5) return;
  int ei = edgeIndexFor(idC, idn);
  if (ei >= 0) {
    for (int k = 0; k < 21; k++) {
      if (k != ei) continue;
      vec4 cell = uEdgeCell[k];
      if (cell.z <= 0.0) break; // 这组没配贴图：退回算法过渡
      // 重复 = 图集内 fract 手动平铺（固定密度）；单张 = 平面 UV（整条边带一张）
      vec2 f = uEdgeLoop[k] > 0.5 ? fract(rw * uTexScale + uTOff) : plane;
      vec4 ec = texture2D(uEdgeAtlas, cell.xy + f * cell.zw);
      if (ec.a > 0.02) {
        float kk = w * ec.a;
        acc += vec4(ec.rgb, 1.0) * kk;
        wsum += kk;
      }
      break;
    }
  }
  acc += texOf(idn, rw, plane) * w;
  wsum += w;
}

void main() {
  vec2 g = vUv * uSize;   // 世界空间连续格坐标：贴图只认它

  /* 1. 域扭曲只作用在"类型场"上 —— 等价于饥荒把地皮拐角顶点挪开：
        低频把整条边界揉弯，中频打散阶梯拐角，高频再抖一下。
        注意：贴图坐标不用 q，否则地皮花纹会被一起拧成漩涡。 */
  vec2 q = g;
  q += (vec2(vnoise(g * 0.42 + uSeed * 0.017), vnoise(g * 0.42 + 23.9)) - 0.5) * 1.75 * uBandWarp;
  q += (vec2(vnoise(q * 1.15 + 7.1), vnoise(q * 1.15 + 41.3)) - 0.5) * 0.72 * uBandWarp;
  q += (vec2(vnoise(q * 3.70 + 2.3), vnoise(q * 3.70 + 57.7)) - 0.5) * 0.26 * uBandWarp;

  float idC = typeAt(q);
  if (idC < 0.0 || idC > 6.5) {
    // 地图外 / 空格子（自由形状的轮廓外）：挖空
    gl_FragColor = vec4(0.0);
    discard;
  }

  /* 2. 贴图坐标：世界空间连续 + 一个固定的整体旋转（刚性旋转不会扭曲花纹）。
        以前是 fract(g)（每格都从 (0,0) 开始贴一张图），格边必然出现一圈图边，
        整片地皮就是一张方格网 —— 这也是"像图片锯齿"的来源之一。
        重复模式固定密度；单张模式在 texOf / planeUv 里按拉伸策略映射。 */
  float ang = uSeed * 0.031;
  vec2 rw = rot2(g, ang);

  vec4 col = texOf(idC, rw, vUv);
  float wsum = 1.0;

  /* 3. 过渡带：带宽由噪声决定（0.14~0.44 格），交界两侧互相渗一半，
        硬边变成渐变；台阶即使还在，也是糊的。 */
  vec2 f = fract(q);
  float band = 0.14 + vnoise(q * 2.1 + 13.0) * 0.30;

  float w;
  float idn;

  w = smoothstep(band, 0.0, f.x);
  if (w > 0.002) {
    idn = typeAt(q - vec2(1.0, 0.0));
    blendNeighbor(idC, idn, rw, vUv, w, col, wsum);
  }
  w = smoothstep(band, 0.0, 1.0 - f.x);
  if (w > 0.002) {
    idn = typeAt(q + vec2(1.0, 0.0));
    blendNeighbor(idC, idn, rw, vUv, w, col, wsum);
  }
  w = smoothstep(band, 0.0, f.y);
  if (w > 0.002) {
    idn = typeAt(q - vec2(0.0, 1.0));
    blendNeighbor(idC, idn, rw, vUv, w, col, wsum);
  }
  w = smoothstep(band, 0.0, 1.0 - f.y);
  if (w > 0.002) {
    idn = typeAt(q + vec2(0.0, 1.0));
    blendNeighbor(idC, idn, rw, vUv, w, col, wsum);
  }
  col /= wsum;

  /* 4. 明暗：两级连续噪声（每格一个随机值本身就是方格感的来源）。
        用未扭曲的 g，避免明暗也跟着边界一起"拧"。 */
  float shade = 0.93 + vnoise(g * 1.9 + 11.0) * 0.10 + vnoise(g * 0.37 + 3.3) * 0.06;
  col.rgb *= shade;

  float fog = smoothstep(uFogNear, uFogFar, vDepth);
  col.rgb = mix(col.rgb, uFogColor, fog);
  gl_FragColor = col;

  #include <colorspace_fragment>
}
`;

export interface GroundLayer {
  group: THREE.Group;
  dispose(): void;
}

/**
 * 构造一块地面的渲染层。cfg 是这块地面自己的参数（尺寸 / 种子 / 每类的贴图 / 边界贴图），
 * 整体以原点为中心铺在 y = 0 平面上，由调用方平移到地面对象的位置。
 */
export function buildGroundLayer(doc: ProjectDoc, cfg: GroundConfig, map: GroundMap, fog?: THREE.Fog | THREE.FogExp2 | null): GroundLayer {
  const { w, h, tiles } = map;
  const cell = cfg.cell > 0 ? cfg.cell : 1;

  // 类型图：1 字节一格塞进 R 通道。纹理原点在左下，地图第 0 行在北，所以按行倒着写
  const data = new Uint8Array(w * h * 4);
  for (let gy = 0; gy < h; gy++) {
    const row = h - 1 - gy;
    for (let gx = 0; gx < w; gx++) {
      const at = (row * w + gx) * 4;
      data[at] = tiles[gy * w + gx];
      data[at + 3] = 255;
    }
  }
  const typeTex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  typeTex.magFilter = THREE.NearestFilter;
  typeTex.minFilter = THREE.NearestFilter;
  typeTex.needsUpdate = true;

  // 边界贴图组合：类型 id + 1 编码（0 = 空位，着色器据此判断"这对地皮配没配"）
  const edges = (cfg.edges ?? []).slice(0, MAX_GROUND_EDGES);
  const edgePairs: THREE.Vector2[] = [];
  for (let i = 0; i < MAX_GROUND_EDGES; i++) {
    const e = edges[i];
    const ai = e ? GROUND_TYPES.findIndex((t) => t.id === e.a) : -1;
    const bi = e ? GROUND_TYPES.findIndex((t) => t.id === e.b) : -1;
    edgePairs.push(new THREE.Vector2(ai >= 0 ? ai + 1 : 0, bi >= 0 ? bi + 1 : 0));
  }

  /* 边界中间贴图全部合成一张图集：最多 21 组逐张绑会超出纹理单元上限（WebGL 只保证 16 个）。
        图集初始全透明 —— 某组还没配贴图 / 还没加载完时 alpha=0，着色器自动退回算法过渡。 */
  const atlasImgs = edges.map((e) => groundImage(doc, e.textureId));
  const filled = atlasImgs.filter(Boolean).length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, filled))));
  const rows = Math.max(1, Math.ceil(Math.max(1, filled) / cols));
  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = cols * ATLAS_CELL;
  atlasCanvas.height = rows * ATLAS_CELL;
  const atlasCtx = atlasCanvas.getContext('2d');
  const atlasTex = new THREE.CanvasTexture(atlasCanvas);
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.flipY = false; // 格子坐标直接按 canvas 从上往下算，省得换算
  atlasTex.magFilter = THREE.LinearFilter;
  atlasTex.minFilter = THREE.LinearFilter;
  atlasTex.generateMipmaps = false; // 图集内平铺用 fract 手动做，mipmap 会在格缝渗色

  const edgeCells: THREE.Vector4[] = [];
  let nextCell = 0;
  for (let i = 0; i < MAX_GROUND_EDGES; i++) {
    const img = atlasImgs[i];
    if (!img || !atlasCtx) {
      edgeCells.push(new THREE.Vector4(0, 0, 0, 0));
      continue;
    }
    const cx = (nextCell % cols) * ATLAS_CELL;
    const cy = Math.floor(nextCell / cols) * ATLAS_CELL;
    nextCell += 1;
    edgeCells.push(new THREE.Vector4(cx / atlasCanvas.width, cy / atlasCanvas.height, ATLAS_CELL / atlasCanvas.width, ATLAS_CELL / atlasCanvas.height));
    const el = new Image();
    el.onload = () => {
      if (!atlasCtx) return;
      atlasCtx.clearRect(cx, cy, ATLAS_CELL, ATLAS_CELL);
      if (img.crop) {
        // crop 是像素坐标（左上原点），直接当源矩形
        atlasCtx.drawImage(el, img.crop.x, img.crop.y, img.crop.w, img.crop.h, cx, cy, ATLAS_CELL, ATLAS_CELL);
      } else {
        atlasCtx.drawImage(el, cx, cy, ATLAS_CELL, ATLAS_CELL);
      }
      atlasTex.needsUpdate = true;
    };
    el.src = imageUrl(doc, img);
  }

  const planeTfs = GROUND_TYPES.map((meta) => planeTransform(doc, cfg.w, cfg.h, cfg.types[meta.id]?.textureId ?? null));
  const uniforms: Record<string, THREE.IUniform> = {
    uMap: { value: typeTex },
    uSize: { value: new THREE.Vector2(w, h) },
    uSeed: { value: (cfg.seed | 0) % 9973 },
    uTexScale: { value: TEX_SCALE },
    uTOff: { value: new THREE.Vector2(((cfg.seed | 0) % 9973) * 0.317, ((cfg.seed | 0) % 9973) * 0.317) },
    uPlaneTf: { value: planeTfs.map((p) => p.tf) },
    uNineX: { value: planeTfs.map((p) => p.nx) },
    uNineY: { value: planeTfs.map((p) => p.ny) },
    uBandWarp: { value: 1 },
    uLoop: { value: GROUND_TYPES.map((meta) => ((cfg.types[meta.id]?.loop ?? true) ? 1 : 0)) },
    uEdgeAtlas: { value: atlasTex },
    uEdgeCell: { value: edgeCells },
    uEdgePair: { value: edgePairs },
    uEdgeLoop: { value: Array.from({ length: MAX_GROUND_EDGES }, (_, i) => ((edges[i]?.loop ?? true) ? 1 : 0)) },
    uFogColor: { value: new THREE.Color(0x100d0a) },
    uFogNear: { value: 42 },
    uFogFar: { value: 150 },
  };

  // 材质先挂兜底纹理占位，图片加载完再换上去（避免白块；加载失败就一直是兜底纹理）
  const pending: (() => void)[] = [];
  const bindLazy = (key: string, img: ImageAsset | null) => {
    const tex = img ? loadImageTexture(doc, img) : null;
    if (!tex) return;
    let tries = 0;
    const apply = () => {
      if (tex.image) {
        uniforms[key].value = tex;
        mat.needsUpdate = true;
        return;
      }
      if (++tries > 40) return;
      window.setTimeout(apply, 120);
    };
    pending.push(apply);
  };

  GROUND_TYPES.forEach((meta, i) => {
    // 纯色优先用这一层自己选的颜色，没选就用类型默认色
    const custom = cfg.types[meta.id]?.color || meta.color;
    uniforms[`uT${i}`] = { value: fallbackTexture(meta.id, custom) };
    bindLazy(`uT${i}`, groundImage(doc, cfg.types[meta.id]?.textureId ?? null));
  });

  if (fog && 'near' in fog) {
    uniforms.uFogColor = { value: new THREE.Color(fog.color.getHex()) };
    uniforms.uFogNear = { value: fog.near };
    uniforms.uFogFar = { value: fog.far };
  }

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    side: THREE.FrontSide,
  });
  for (const apply of pending) apply();

  const geo = new THREE.PlaneGeometry(w * cell, h * cell, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;

  const group = new THREE.Group();
  group.name = 'ground';
  group.add(mesh);

  return {
    group,
    dispose() {
      group.removeFromParent();
      geo.dispose();
      mat.dispose();
      typeTex.dispose();
      atlasTex.dispose();
    },
  };
}
