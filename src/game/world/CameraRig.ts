import * as THREE from 'three';

/**
 * 相机装配：固定俯视角度 + 平滑跟随 + 边界夹取。
 * 相机的所有魔法数字集中在这里，实体不感知镜头。
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;

  private readonly offset = new THREE.Vector3(0, 11.5, 9.5);
  private readonly lookAt = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly smooth = 0.14;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 200);
    this.camera.position.copy(this.offset);
    this.camera.lookAt(0, 0.8, 0);
  }

  follow(x: number, z: number, bound: number): void {
    const cx = Math.max(-bound, Math.min(bound, x));
    const cz = Math.max(-bound, Math.min(bound, z));
    this.desired.set(cx + this.offset.x, this.offset.y, cz + this.offset.z);
  }

  update(dt: number): void {
    // 固定步长下用指数阻尼，避免帧率差异导致抖动
    const t = 1 - Math.pow(1 - this.smooth, dt * 60);
    this.camera.position.lerp(this.desired, t);
    this.target.set(this.desired.x, 0.8, this.desired.z - this.offset.z);
    this.lookAt.lerp(this.target, t);
    this.camera.lookAt(this.lookAt);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }
}
