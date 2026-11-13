# 摄像机

运行时画面怎么跟着角色走，由场景里的「摄像机」对象决定。它挂的系统脚本通过
`this.camera` 读写视口相机；没有摄像机对象时，引擎用内置默认（45°、居中跟随）。

## `this.camera` 结构

```ts
interface CameraRig {
  // 可写：相机位姿。视口每帧照它摆相机
  pose: {
    x: number; y: number; z: number;   // 注视点（世界坐标，y 通常是角色身高的一半）
    pitch: number;                     // 俯仰角（弧度）：π/4 = 45° 斜视，π/2-0.12 ≈ 垂直俯视
    yaw: number;                       // 水平环绕角，0 = 正对屏幕上方
    distance: number;                  // 相机到注视点的距离
  };
  // 只读：当前跟随目标（运行时玩家）的位置与身高
  follow: { x: number; y: number; z: number; height: number };
  // 只读：按角色身高算出的推荐距离（角色约占屏幕 1/3）
  autoDistance: number;
  // 哪个摄像机节点接管了相机；null = 没人接管
  claimedBy: string | null;
}
```

| 时机 | 能不能用 |
| --- | --- |
| 编辑态 | 拿得到对象，但视口用编辑相机，不读 `pose` |
| 播放态（无摄像机组件接管） | 视口用内置默认逻辑 |
| 播放态（组件 `claimedBy` 设成自己的 node.id） | 视口完全按 `pose` 摆相机 |

**多摄像机只认第一个**：谁先把 `claimedBy` 写成自己的 `node.id`，谁生效，其它摄像机脚本要主动让位：

```ts
onStart() {
  const cam = this.camera;
  if (!cam || cam.claimedBy) return;
  cam.claimedBy = this.node.id;
}
onDestroy() {
  if (this.camera?.claimedBy === this.node.id) this.camera.claimedBy = null;
}
```

## 示例：带前瞻的摄像机

角色移动时把镜头往前推一点，让他看到更多前方；停下后缓慢回正。

```ts
@Component('前瞻摄像机', { icon: '🎥', order: 6 })
export default class LookAheadCamera extends LightComponent {
  @Group('视角', 10) @Label('45 度角') @Bool() isometric = true;
  @Group('视角', 10) @Label('距离') @Num(0, 40, 0.5) distance = 0;
  @Group('前瞻', 20) @Label('往前看多少') @Num(0, 4, 0.1) ahead = 1.2;
  @Group('前瞻', 20) @Label('平滑') @Num(0.5, 20, 0.5) smooth = 4;

  @Hidden() px = 0;
  @Hidden() pz = 0;
  @Hidden() ready = false;

  onStart() {
    const cam = this.camera;
    if (!cam || cam.claimedBy) return;
    cam.claimedBy = this.node.id;
    this.px = cam.follow.x;
    this.pz = cam.follow.z;
    this.ready = false;
  }

  onUpdate(dt: number) {
    const cam = this.camera;
    if (!cam || cam.claimedBy !== this.node.id) return;

    // follow 是角色当前位置；和上一帧的差就是移动方向
    const dx = cam.follow.x - this.px;
    const dz = cam.follow.z - this.pz;
    const len = Math.hypot(dx, dz);
    const k = 1 - Math.exp(-this.smooth * dt);

    const wantX = cam.follow.x + (len > 0.001 ? (dx / len) * this.ahead : 0);
    const wantZ = cam.follow.z + (len > 0.001 ? (dz / len) * this.ahead : 0);

    if (!this.ready) {
      cam.pose.x = wantX;
      cam.pose.z = wantZ;
      this.ready = true;
    } else {
      cam.pose.x += (wantX - cam.pose.x) * k;
      cam.pose.z += (wantZ - cam.pose.z) * k;
    }
    cam.pose.y = cam.follow.y;
    cam.pose.pitch = this.isometric ? Math.PI / 4 : Math.PI / 2 - 0.12;
    cam.pose.yaw = 0;
    cam.pose.distance = this.distance > 0 ? this.distance : cam.autoDistance;

    this.px = cam.follow.x;
    this.pz = cam.follow.z;
  }

  onDestroy() {
    if (this.camera?.claimedBy === this.node.id) this.camera.claimedBy = null;
    this.ready = false;
  }
}
```

## 注意

- `pitch` 不要取精确的 `π/2`：视线与 up 向量平行时 `lookAt` 会退化（画面乱转）。用 `π/2 - 0.12`。
- `pose` 是纯数值，不要往里面塞 three 对象；视口只读这几个数字。
- 摄像机脚本每帧写 `pose` 是正常的（不落盘、不进撤销历史）；要保存的配置写在组件字段里。
- 停止播放时会清空 `claimedBy`，下次播放重新抢。
