import * as THREE from 'three';
import { AnimationBank } from '@/game/animation/AnimationBank';
import type { SpriteManifest } from '@/game/animation/SpriteManifest';
import { AssetLoader } from '@/game/core/AssetLoader';
import { EventBus } from '@/game/core/EventBus';
import { GameLoop } from '@/game/core/GameLoop';
import { Player } from '@/game/entities/Player';
import { InputSystem } from '@/game/systems/InputSystem';
import type { DirId, GameEvents } from '@/game/types';
import { CameraRig } from '@/game/world/CameraRig';
import { Terrain } from '@/game/world/Terrain';
import { World } from '@/game/world/World';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  manifestUrl?: string;
  spriteRoot?: string;
}

/**
 * 游戏总装配：装配顺序固定（渲染器 → 资源 → 世界 → 角色 → 系统 → 循环）。
 * 退出时统一 dispose，避免 HMR 重复创建 WebGL 上下文。
 */
export class Game {
  readonly bus = new EventBus<GameEvents>();

  private readonly renderer: THREE.WebGLRenderer;
  private readonly rig: CameraRig;
  private readonly world = new World();
  private readonly terrain = new Terrain();
  private readonly input = new InputSystem();
  private readonly loader = new AssetLoader();
  private readonly loop: GameLoop;

  private bank?: AnimationBank;
  private player?: Player;
  private resizeObserver?: ResizeObserver;
  private statsTimer = 0;
  private frameCounter = 0;
  private fps = 0;
  private fpsTimer = 0;

  constructor(private readonly options: GameOptions) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.world.scene.background = new THREE.Color('#191d16');
    this.world.scene.fog = new THREE.Fog('#191d16', 18, 40);
    this.world.scene.add(this.terrain.mesh);

    const hemi = new THREE.HemisphereLight(0xd8e0c8, 0x2a2a20, 1.15);
    const dir = new THREE.DirectionalLight(0xfff2d0, 1.1);
    dir.position.set(6, 12, 4);
    this.world.scene.add(hemi, dir);

    this.rig = new CameraRig(1);
    this.loop = new GameLoop(
      1 / 60,
      (dt) => this.update(dt),
      () => this.render(),
    );
  }

  async init(): Promise<void> {
    const base = import.meta.env.BASE_URL;
    const manifestUrl = this.options.manifestUrl ?? `${base}assets/sprites/manifest.json`;
    const spriteRoot = this.options.spriteRoot ?? `${base}assets/sprites`;

    const manifest = await this.loader.loadJSON<SpriteManifest>(manifestUrl);
    this.bank = new AnimationBank(this.loader, manifest, spriteRoot);

    this.player = new Player(this.bank, this.input);
    this.world.addActor(this.player);
    this.input.attach();

    this.bank.preloadAction('engineer_spanner', 'idle');
    this.bank.preloadAction('engineer_spanner', 'walk');

    this.observeSize();
    this.resize();
    this.bus.emit('game:ready', { characterId: 'engineer_spanner' });
    this.loop.start();
  }

  private update(dt: number): void {
    this.world.update(dt);
    if (!this.player) return;
    this.rig.follow(this.player.x, this.player.z, this.world.bound);
    this.rig.update(dt);

    this.frameCounter++;
    this.fpsTimer += dt;
    this.statsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frameCounter / this.fpsTimer);
      this.frameCounter = 0;
      this.fpsTimer = 0;
    }
    if (this.statsTimer >= 0.2) {
      this.statsTimer = 0;
      this.bus.emit('stats', {
        fps: this.fps,
        action: this.player.currentAction,
        dir: this.player.currentDir as DirId,
        frame: this.player.currentFrame,
        x: Number(this.player.x.toFixed(2)),
        z: Number(this.player.z.toFixed(2)),
        textures: this.bank?.cachedCount ?? 0,
      });
    }
  }

  private render(): void {
    this.renderer.render(this.world.scene, this.rig.camera);
  }

  private observeSize(): void {
    const canvas = this.options.canvas;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
  }

  private resize(): void {
    const canvas = this.options.canvas;
    const parent = canvas.parentElement ?? document.body;
    const w = parent.clientWidth || window.innerWidth;
    const h = parent.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.rig.resize(w, h);
  }

  dispose(): void {
    this.loop.stop();
    this.input.detach();
    this.resizeObserver?.disconnect();
    this.world.dispose();
    this.terrain.dispose();
    this.bank?.dispose();
    this.loader.dispose();
    this.renderer.dispose();
    this.bus.clear();
  }
}
