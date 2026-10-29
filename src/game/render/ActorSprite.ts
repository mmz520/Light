import * as THREE from 'three';
import type { AnimationBank } from '@/game/animation/AnimationBank';
import type { ActionDef } from '@/game/animation/SpriteManifest';
import type { DirId } from '@/game/types';

/**
 * 实体与 three.js 之间唯一的适配器。
 * 帧索引 → UV offset 的全部计算在这里，实体层不感知渲染细节。
 */
export class ActorSprite {
  readonly root = new THREE.Group();

  private readonly sprite: THREE.Sprite;
  private readonly material: THREE.SpriteMaterial;
  private readonly shadow: THREE.Mesh;

  /** 每个方向单独持有一份贴图克隆：避免多个同类实体共享 offset 互相覆盖 */
  private readonly textureCache = new Map<DirId, THREE.Texture>();
  private activeTexture?: THREE.Texture;

  private charId: string;
  private action = 'idle';
  private dir: DirId = 'S';
  private frame = 0;
  private frames = 1;

  constructor(
    private readonly bank: AnimationBank,
    characterId: string,
    displayHeight: number,
  ) {
    this.charId = characterId;
    const cell = bank.getCell();

    this.material = new THREE.SpriteMaterial({
      transparent: true,
      depthWrite: false,
      alphaTest: 0.02,
      color: 0xffffff,
    });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.scale.set(displayHeight, displayHeight, 1);
    // 轴心：底部中心（脚底）落在 root 原点。
    // 注意 UV 的 y 轴自下而上，manifest 里的 pivotY 是像素坐标（自上而下），需要翻转。
    this.sprite.center.set(0.5, 1 - cell.pivotY / cell.h);
    this.root.add(this.sprite);

    const shadowGeo = new THREE.CircleGeometry(displayHeight * 0.26, 24);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.02;
    this.root.add(this.shadow);
  }

  setCharacter(characterId: string): void {
    this.charId = characterId;
    this.clearTextures();
  }

  setAction(action: string, def: ActionDef): void {
    this.action = action;
    this.frames = Math.max(1, def.frames);
    this.applyTexture();
  }

  setDirection(dir: DirId): void {
    if (this.dir === dir) return;
    this.dir = dir;
    this.applyTexture();
  }

  setFrame(frame: number): void {
    const next = Math.min(Math.max(0, frame), this.frames - 1);
    if (next === this.frame) return;
    this.frame = next;
    this.applyOffset();
  }

  setPosition(x: number, z: number): void {
    this.root.position.set(x, 0, z);
    // y-sort：z 越大越靠近镜头，后绘制
    this.root.renderOrder = Math.round(z * 100);
  }

  /** 每帧调用：异步贴图就绪后自动接上 */
  tick(): void {
    if (!this.activeTexture) this.applyTexture();
  }

  private applyTexture(): void {
    let tex = this.textureCache.get(this.dir);
    if (!tex) {
      const source = this.bank.getTexture(this.charId, this.action, this.dir);
      if (!source) return; // 尚未加载完成，下一帧再试
      tex = source.clone();
      tex.needsUpdate = true;
      this.textureCache.set(this.dir, tex);
      if (this.textureCache.size > 16) {
        const oldest = this.textureCache.keys().next();
        if (!oldest.done) {
          this.textureCache.get(oldest.value)?.dispose();
          this.textureCache.delete(oldest.value);
        }
      }
    }
    this.activeTexture = tex;
    this.material.map = tex;
    this.material.needsUpdate = true;
    this.applyOffset();
  }

  private applyOffset(): void {
    const tex = this.activeTexture;
    if (!tex) return;
    tex.repeat.set(1 / this.frames, 1);
    tex.offset.set(this.frame / this.frames, 0);
  }

  private clearTextures(): void {
    for (const tex of this.textureCache.values()) tex.dispose();
    this.textureCache.clear();
    this.activeTexture = undefined;
    this.material.map = null;
    this.material.needsUpdate = true;
  }

  dispose(): void {
    this.clearTextures();
    this.material.dispose();
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
    this.sprite.removeFromParent();
    this.root.removeFromParent();
  }
}
