import * as THREE from 'three';

/**
 * 资源加载器：Promise 化 + 统一的贴图采样参数。
 * 所有贴图参数只在这里设置，避免各处重复写 filter/colorSpace 导致观感不一致。
 */
export class AssetLoader {
  private readonly imageCache = new Map<string, Promise<HTMLImageElement>>();
  private readonly jsonCache = new Map<string, Promise<unknown>>();

  loadImage(url: string): Promise<HTMLImageElement> {
    const cached = this.imageCache.get(url);
    if (cached) return cached;
    const task = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`图片加载失败: ${url}`));
      img.src = url;
    });
    this.imageCache.set(url, task);
    return task;
  }

  loadJSON<T>(url: string): Promise<T> {
    const cached = this.jsonCache.get(url);
    if (cached) return cached as Promise<T>;
    const task = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`JSON 加载失败(${res.status}): ${url}`);
      return res.json() as Promise<T>;
    });
    this.jsonCache.set(url, task as Promise<unknown>);
    return task as Promise<T>;
  }

  createTexture(img: HTMLImageElement): THREE.Texture {
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }

  dispose(): void {
    this.imageCache.clear();
    this.jsonCache.clear();
  }
}
