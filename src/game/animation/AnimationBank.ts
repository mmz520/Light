import * as THREE from 'three';
import type { AssetLoader } from '@/game/core/AssetLoader';
import { DIRECTION_ORDER, type DirId } from '@/game/types';
import type { ActionDef, CharacterDef, SpriteManifest } from './SpriteManifest';

/**
 * 动画资源库：manifest 解析 + 分方向条带贴图的异步加载与缓存。
 * - 贴图按 (角色, 动作, 方向) 粒度缓存，避免一次性把 96 张图塞进显存
 * - 只在这里拼 URL，路径规则唯一
 */
export class AnimationBank {
  private readonly cache = new Map<string, THREE.Texture>();
  private readonly pending = new Map<string, Promise<THREE.Texture>>();
  private readonly maxCached = 32;

  constructor(
    private readonly loader: AssetLoader,
    private readonly manifest: SpriteManifest,
    private readonly rootUrl: string,
  ) {}

  getCell(): SpriteManifest['cell'] {
    return this.manifest.cell;
  }

  getCharacter(characterId: string): CharacterDef {
    const def = this.manifest.characters[characterId];
    if (!def) throw new Error(`manifest 中缺少角色: ${characterId}`);
    return def;
  }

  getAction(characterId: string, action: string): ActionDef {
    const def = this.getCharacter(characterId).actions[action];
    if (!def) throw new Error(`角色 ${characterId} 缺少动作: ${action}`);
    return def;
  }

  hasAction(characterId: string, action: string): boolean {
    return Boolean(this.manifest.characters[characterId]?.actions[action]);
  }

  stripUrl(characterId: string, action: string, dir: DirId): string {
    return `${this.rootUrl}/${characterId}/${action}/${dir}.png`;
  }

  /** 同步取贴图；未加载时返回 undefined 并异步预取 */
  getTexture(characterId: string, action: string, dir: DirId): THREE.Texture | undefined {
    const key = `${characterId}/${action}/${dir}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    void this.request(characterId, action, dir);
    return undefined;
  }

  /** 预加载某动作的全部 8 方向（动作切换时调用，避免转向瞬闪） */
  preloadAction(characterId: string, action: string): void {
    for (const dir of DIRECTION_ORDER) void this.request(characterId, action, dir);
  }

  request(characterId: string, action: string, dir: DirId): Promise<THREE.Texture> {
    const key = `${characterId}/${action}/${dir}`;
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const already = this.pending.get(key);
    if (already) return already;

    const task = this.loader
      .loadImage(this.stripUrl(characterId, action, dir))
      .then((img) => {
        const tex = this.loader.createTexture(img);
        this.store(key, tex);
        return tex;
      })
      .finally(() => this.pending.delete(key));

    this.pending.set(key, task);
    return task;
  }

  private store(key: string, tex: THREE.Texture): void {
    if (this.cache.size >= this.maxCached) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, tex);
  }

  get cachedCount(): number {
    return this.cache.size;
  }

  dispose(): void {
    for (const tex of this.cache.values()) tex.dispose();
    this.cache.clear();
    this.pending.clear();
  }
}
