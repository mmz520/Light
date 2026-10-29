import * as THREE from 'three';
import type { Actor } from '@/game/entities/Actor';

/**
 * 世界：场景根 + 实体容器 + 边界。
 * 实体只与 World 交互，不直接持 scene。
 */
export class World {
  readonly scene = new THREE.Scene();
  readonly bound = 20;

  private readonly actors: Actor[] = [];

  addActor(actor: Actor): void {
    this.actors.push(actor);
    this.scene.add(actor.sprite.root);
  }

  removeActor(actor: Actor): void {
    const idx = this.actors.indexOf(actor);
    if (idx >= 0) this.actors.splice(idx, 1);
    actor.sprite.root.removeFromParent();
  }

  get actorsInScene(): readonly Actor[] {
    return this.actors;
  }

  update(dt: number): void {
    for (const actor of this.actors) {
      if (actor.alive) actor.update(dt);
    }
  }

  dispose(): void {
    for (const actor of this.actors) actor.dispose();
    this.actors.length = 0;
  }
}
