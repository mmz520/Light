import { nativeImage, protocol } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { mimeOf } from './fsops';

/**
 * 自定义协议 gameasset://local/?p=<absPath>
 *
 * 渲染进程在 file:// 下无法 fetch 本地文件，直接用 file:// 又会被 CORS 拦。
 * 用自定义协议既能给 <img src> 用，也能 fetch/纹理加载，且不受 file:// 限制。
 */
export const ASSET_SCHEME = 'gameasset';

/** 必须在 app ready 之前调用 */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        // 渲染进程在 file:// 下 fetch 自定义协议属于跨源请求，必须开启 CORS
        corsEnabled: true,
      },
    },
  ]);
}

function decodeTarget(requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl);
    const raw = url.searchParams.get('p');
    if (!raw) return null;
    const abs = path.resolve(raw);
    return abs;
  } catch {
    return null;
  }
}

/**
 * 非破坏性裁剪：?c=x,y,w,h（原图像素）。
 * 渲染层里 border-image / background 这类纯 CSS 用法没法按 UV 取源区域，
 * 所以把裁剪放到协议层 —— 服务端先裁再返回，CSS 拿到的就是裁剪后的图。
 */
function decodeCrop(requestUrl: string): { x: number; y: number; width: number; height: number } | null {
  try {
    const raw = new URL(requestUrl).searchParams.get('c');
    if (!raw) return null;
    const nums = raw.split(',').map((s) => Math.round(Number(s)));
    if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return null;
    const [x, y, width, height] = nums;
    if (width <= 0 || height <= 0) return null;
    return { x: Math.max(0, x), y: Math.max(0, y), width, height };
  } catch {
    return null;
  }
}

/** app ready 之后调用 */
export function handleAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const abs = decodeTarget(request.url);
    if (!abs) return new Response('missing ?p=', { status: 400 });

    try {
      const data = await fsp.readFile(abs);
      const crop = decodeCrop(request.url);
      let body = new Uint8Array(data);
      let type = mimeOf(abs);

      if (crop) {
        const src = nativeImage.createFromBuffer(data);
        if (!src.isEmpty()) {
          const size = src.getSize();
          const x = Math.min(crop.x, size.width - 1);
          const y = Math.min(crop.y, size.height - 1);
          const width = Math.max(1, Math.min(crop.width, size.width - x));
          const height = Math.max(1, Math.min(crop.height, size.height - y));
          body = new Uint8Array(src.crop({ x, y, width, height }).toPNG());
          type = 'image/png';
        }
      }

      return new Response(body, {
        status: 200,
        headers: {
          'content-type': type,
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      });
    } catch {
      return new Response(`not found: ${abs}`, { status: 404 });
    }
  });
}
