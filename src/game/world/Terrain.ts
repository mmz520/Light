import * as THREE from 'three';

/** 确定性伪随机，保证每次加载地形纹理一致 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 地形：一块带手绘斑驳纹理的地面。
 * 世界坐标 ↔ 像素比例统一由这里提供，禁止各处写魔法数。
 */
export class Terrain {
  readonly mesh: THREE.Mesh;

  constructor(size = 90) {
    const geometry = new THREE.PlaneGeometry(size, size);
    const material = new THREE.MeshLambertMaterial({ map: Terrain.createTexture() });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0;
    this.mesh.receiveShadow = true;
  }

  private static createTexture(): THREE.Texture {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const rand = mulberry32(20261029);

    ctx.fillStyle = '#6d7a4c';
    ctx.fillRect(0, 0, size, size);

    // 斑驳色块（饥荒式的脏旧草地）
    const palette = ['#5f6c41', '#778452', '#7d8a56', '#59643b', '#828f5c'];
    for (let i = 0; i < 900; i++) {
      const r = 6 + rand() * 26;
      ctx.fillStyle = palette[Math.floor(rand() * palette.length)]!;
      ctx.globalAlpha = 0.18 + rand() * 0.3;
      ctx.beginPath();
      ctx.ellipse(rand() * size, rand() * size, r, r * (0.5 + rand() * 0.6), rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 6);
    return tex;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const mat = this.mesh.material as THREE.MeshLambertMaterial;
    mat.map?.dispose();
    mat.dispose();
  }
}
