/**
 * 地图元素的默认装饰贴图：饥荒风的**细铜圆环**边框。
 * 用 canvas 现画现生成（不需要任何美术资源），写进工程「贴图」目录后
 * 就和普通图片资产一样，可以随时换成自己的。
 *
 * 造型要点：
 *   · 圆环外缘顶到画面四边（上下左右都顶格），铺在方形框上正合适；
 *   · 环带做细（约画布宽的 7%），不压地图内容；
 *   · 明暗三道描边（外近黑 / 环面中调 / 内缘亮铜）+ 颗粒 + 划痕 + 四枚铆钉，
 *     保证在深色 UI 上也能一眼看出是一圈铜箍，不会糊成一片透明。
 *
 * 文件名带版本号：老工程打开时按 LEGACY_DECOR_FILES / 名字找到旧图、
 * 写到新文件名，这样图片 URL 变化，不会命中浏览器里旧图的缓存。
 */

export const DEFAULT_DECOR_NAME = '地图元素边框·默认';
/** 当前内置边框的文件名（带版本号，换美术就 +1） */
export const DEFAULT_DECOR_FILE = 'mapui_frame_default_v3.png';
/** 历史版本文件名（老工程升级时按这些找） */
export const LEGACY_DECOR_FILES = [
  'mapui_frame_default.png',
  'mapui_frame_default_v1.png',
  'mapui_frame_default_v2.png',
];

/** 画布边长（生成图的分辨率） */
export const DEFAULT_DECOR_SIZE = 192;

export function makeDefaultFrameDataUrl(): string {
  const size = DEFAULT_DECOR_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  let s = 20261105;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return ((s >>> 8) & 0xffff) / 0xffff;
  };

  const c = size / 2;
  const rOut = 95.5; // 环外半径：贴到画布边（留 0.5px）
  const band = 14; // 细环：带宽约占画面 7.3%
  const rIn = rOut - band;
  const rm = (rOut + rIn) / 2; // 环带中心线

  const ring = (r: number, w: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  };

  // 1. 环体底色：中间调铜
  ring(rm, band, '#4a3820');

  // 2. 环面颗粒（只落在环带上）：明暗点交错，做出粗粝铜锈质感
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 1400; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rm + (rnd() - 0.5) * band;
    const x = c + Math.cos(a) * d;
    const y = c + Math.sin(a) * d;
    const light = rnd() > 0.5;
    ctx.fillStyle = light ? 'rgba(206,166,104,0.22)' : 'rgba(16,11,6,0.3)';
    ctx.beginPath();
    ctx.arc(x, y, 0.4 + rnd() * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // 环面划痕：几段短弧，避免“完美圆”的塑料感
  for (let i = 0; i < 26; i++) {
    const a0 = rnd() * Math.PI * 2;
    const len = 0.03 + rnd() * 0.12;
    const d = rm + (rnd() - 0.5) * band * 0.8;
    ctx.strokeStyle = rnd() > 0.45 ? 'rgba(214,178,116,0.3)' : 'rgba(12,8,4,0.34)';
    ctx.lineWidth = 0.5 + rnd() * 1.1;
    ctx.beginPath();
    ctx.arc(c, c, d, a0, a0 + len);
    ctx.stroke();
  }
  ctx.restore();

  // 3. 三道描边：外近黑（压边） / 环面中线提亮 / 内缘亮铜（最强的识别线）
  ring(rOut - 1.6, 3.2, '#140e07');
  ring(rm - band * 0.12, band * 0.34, 'rgba(198,160,98,0.26)');
  ring(rIn + 2.2, 3, '#c9a267');

  // 4. 环内一圈更深的暗边：贴地图内容时有一点纵深，同时压住亮铜内缘
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ring(rIn - 0.6, 2.4, 'rgba(0,0,0,0.5)');
  ctx.restore();

  // 5. 四枚小铆钉：均布在环带上（上 / 右 / 下 / 左），带高光点
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 - Math.PI / 2;
    const x = c + Math.cos(a) * rm;
    const y = c + Math.sin(a) * rm;
    ctx.fillStyle = '#1d150b';
    ctx.beginPath();
    ctx.arc(x, y, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c9a267';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x, y, 3.1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(242,214,158,.85)';
    ctx.beginPath();
    ctx.arc(x - 1.1, y - 1.2, 1, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas.toDataURL('image/png');
}
