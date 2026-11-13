/**
 * 预设组件脚本 —— 属性面板里原本硬编码的那些分组，现在都是真实存在的脚本资产
 *
 * 打开工程时由 store 确保这些脚本存在（按 preset 键匹配，改名不影响），
 * 并按节点类型自动挂载（componentIds）。用户可以照着自己的脚本改，也可以删掉。
 *
 * 每个脚本都是 TS class 源码，运行时由 typescript 编译后执行 —— 和用户自己写的脚本同一套机制。
 */
import type { SceneKind } from './types';

export interface PresetComponentScript {
  /** 稳定标识（存进 ScriptAsset.preset，用来判断预设是否已存在） */
  key: string;
  /** 脚本名（也是资产名） */
  name: string;
  /** 自动挂到哪些节点类型上 */
  kinds: SceneKind[];
  /** 源码 */
  code: string;
}

/** 变换：位置 X / Z（时间 / 天气是全局设置，地图元素用屏幕坐标，都不挂） */
const TRANSFORM = `// 变换：节点在场景平面上的位置（X 向右、Z 向下，0.5 网格）
@Component('变换', { icon: '✥', order: 10 })
export default class TransformComponent extends LightComponent {
  @Group('位置', 10) @Label('位置 X') @Num(undefined, undefined, 0.5) @Hint('场景单位，0.5 网格吸附') x = 0;
  @Group('位置', 10) @Label('位置 Z') @Num(undefined, undefined, 0.5) @Hint('越大越靠近镜头') z = 0;

  onMount() {
    this.x = this.node.x;
    this.z = this.node.z;
  }

  onFieldChange(key: string, value: any) {
    if (key === 'x' || key === 'z') this.setNode({ [key]: Number(value) || 0 });
  }

  /** 运行时：位置每帧从节点同步（脚本改了节点就跟着走） */
  onUpdate() {
    if (this.x !== this.node.x) this.x = this.node.x;
    if (this.z !== this.node.z) this.z = this.node.z;
  }
}
`;

/** 角色：动画 / 状态机 / 控制器 / 数值 */
const CHARACTER = `// 角色：外观资源与数值
@Component('角色', { icon: '👤', order: 20, desc: '动画、状态机、控制器与角色数值' })
export default class CharacterComponent extends LightComponent {
  @Group('基础', 10) @Label('角色名') @Str() @Hint('留空就用场景对象名') name = '';

  @Group('基础', 10) @Label('默认动画') @Asset('animation') @Hint('状态里没单独指定时用它') animationId: string | null = null;

  @Group('基础', 10) @Label('状态机') @Asset('statemachine') @Hint('变量来源由状态机自己决定') stateMachineId: string | null = null;

  @Group('控制器', 20) @Label('控制器') @Asset('controller', { multiple: true })
  @Hint('按键 → 变量；可以有多个（移动 / 战斗 / 菜单），运行时全部生效') controllerIds: string[] = [];

  @Group('数值', 30) @Label('血量') @Num(0, 1000, 1) @Hint('归零即死亡') blood = 100;
  @Group('数值', 30) @Label('饥饿') @Num(0, 1000, 1) @Hint('归零开始掉血') satiation = 100;
  @Group('数值', 30) @Label('理智') @Num(0, 1000, 1) @Hint('过低触发精神类行为') mental = 100;
  @Group('数值', 30) @Label('移速') @Num(0, 20, 0.1) @Hint('世界单位 / 秒') speed = 1;
  @Group('数值', 30) @Label('攻击') @Num(0, 1000, 1) attack = 10;

  onMount() {
    const c = this.node.character;
    if (!c) return;
    this.name = c.name ?? '';
    this.animationId = c.animationId ?? null;
    this.stateMachineId = c.stateMachineId ?? null;
    this.controllerIds = [...(c.controllerIds ?? [])];
    this.blood = c.blood;
    this.satiation = c.satiation;
    this.mental = c.mental;
    this.speed = c.speed;
    this.attack = c.attack;
  }

  onFieldChange(key: string, value: any) {
    this.setCharacter({ [key]: value });
  }

  /** 示例：血量归零时广播事件（其它脚本可 onEvent 接收） */
  onUpdate() {
    if (this.blood <= 0) this.emit('角色死亡', { nodeId: this.node.id, name: this.node.name });
  }
}
`;

/** 小地图：是否显示 + 图标 */
const MINIMAP = `// 小地图：这个对象在地图上怎么显示
@Component('小地图', { icon: '🗺', order: 30 })
export default class MinimapComponent extends LightComponent {
  @Group('显示', 10) @Label('在地图上显示') @Bool() show = true;

  @Group('显示', 10) @Label('显示图标') @Asset('group')
  @Hint('从「图组」目录选图标；不选就是默认圆点') iconId: string | null = null;

  onMount() {
    this.show = this.node.minimapShow ?? true;
    this.iconId = this.node.minimapIcon ?? null;
  }

  onFieldChange(key: string, value: any) {
    if (key === 'show') this.setNode({ minimapShow: !!value });
    else if (key === 'iconId') this.setNode({ minimapIcon: (value as string) || null });
  }
}
`;

/** 地图元素（屏幕 UI）：位置 / 形状 / 范围 / 尺寸 / 装饰 */
const MAPUI = `// 地图元素：屏幕 UI（小地图框、罗盘、区域标题）
@Component('地图元素', { icon: '🧭', order: 30 })
export default class MapUiComponent extends LightComponent {
  @Group('屏幕位置', 10) @Label('X（像素）') @Num(-2000, 8000, 1) @Hint('拖框也能改') sx = 0;
  @Group('屏幕位置', 10) @Label('Y（像素）') @Num(-2000, 8000, 1) sy = 0;

  @Group('外观', 20) @Label('形状') @Enum([{ value: 'circle', label: '圆形' }, { value: 'rect', label: '方形' }]) shape = 'circle';

  @Group('外观', 20) @Label('显示范围') @Enum([
    { value: 'always', label: '始终' },
    { value: 'near', label: '近' },
    { value: 'mid', label: '中' },
    { value: 'far', label: '远' },
  ]) @Hint('运行时玩家靠近才显示；编辑器里始终可见') range = 'always';

  @Group('外观', 20) @Label('框大小（px）') @Num(48, 640, 4) size = 200;

  @Group('装饰', 30) @Label('装饰贴图') @Asset('texture') @Hint('沿框边装饰；不选用纯色') decorId: string | null = null;

  onMount() {
    const m = this.node.mapui;
    if (!m) return;
    this.sx = m.sx;
    this.sy = m.sy;
    this.shape = m.shape;
    this.range = m.range;
    this.size = m.size;
    this.decorId = m.decorId ?? null;
  }

  onFieldChange(key: string, value: any) {
    this.setMapui({ [key]: value });
  }
}
`;

/** 地皮：整块生成面板交给宿主内置 UI（参数太多，用字段拼不划算） */
const GROUND = `// 地皮：生成参数与贴图
// 参数界面用宿主内置的地皮面板渲染（@Panel），字段值仍由脚本持有
@Component('地皮', { icon: '🌱', order: 40 })
export default class GroundComponent extends LightComponent {
  @Group('生成', 10) @Label('地皮面板') @Panel('ground') seed = 0;

  onStart() {
    this.log('地皮就绪：' + this.node.name);
  }
}
`;

/** 摄像机：运行时视口的相机（角度 / 距离 / 缓动跟随） */
const CAMERA = `// 摄像机：决定运行时画面怎么跟着角色走
// 场景里有多个摄像机时只有第一个生效（按场景顺序，先抢到相机的那个）
@Component('摄像机', { icon: '🎥', order: 5, desc: '45° 斜视 / 垂直俯视，可缓动跟随' })
export default class CameraComponent extends LightComponent {
  @Group('视角', 10) @Label('45 度角') @Bool()
  @Hint('开启 = 斜 45° 俯视（经典 ARPG 视角）；关闭 = 接近垂直俯视') isometric = true;

  @Group('视角', 10) @Label('距离') @Num(0, 40, 0.5)
  @Hint('相机到角色的距离；0 = 按角色身高自动') distance = 0;

  @Group('跟随', 20) @Label('缓动跟随') @Bool()
  @Hint('开启后角色起步 / 停下都有缓冲过程，最终停在同一个位置') smooth = true;

  @Group('跟随', 20) @Label('跟随速度') @Num(0.5, 20, 0.5)
  @Hint('越大越跟手；关闭缓动时无效') followSpeed = 5;

  snapped = false;

  onStart() {
    const cam = this.camera;
    if (!cam || cam.claimedBy) return;
    cam.claimedBy = this.node.id;
    this.snapped = false;
  }

  onUpdate(dt: number) {
    const cam = this.camera;
    if (!cam || cam.claimedBy !== this.node.id) return;

    // 第一帧直接对齐，避免开场从上一轮的位置飞过来
    if (!this.snapped) {
      cam.pose.x = cam.follow.x;
      cam.pose.y = cam.follow.y;
      cam.pose.z = cam.follow.z;
      this.snapped = true;
    }

    // 指数阻尼：和帧率无关，所有帧叠起来正好收敛到目标（停下时也走同一套）
    const k = this.smooth ? 1 - Math.exp(-Math.max(0.1, this.followSpeed) * dt) : 1;
    cam.pose.x += (cam.follow.x - cam.pose.x) * k;
    cam.pose.y += (cam.follow.y - cam.pose.y) * k;
    cam.pose.z += (cam.follow.z - cam.pose.z) * k;

    cam.pose.pitch = this.isometric ? Math.PI / 4 : Math.PI / 2 - 0.12;
    cam.pose.yaw = 0;
    cam.pose.distance = this.distance > 0 ? this.distance : cam.autoDistance;
  }

  onDestroy() {
    const cam = this.camera;
    if (cam && cam.claimedBy === this.node.id) cam.claimedBy = null;
    this.snapped = false;
  }
}
`;

export const PRESET_COMPONENT_SCRIPTS: PresetComponentScript[] = [
  { key: 'transform', name: '变换', kinds: ['group', 'ground', 'cover', 'enemy', 'character', 'camera'], code: TRANSFORM },
  { key: 'character', name: '角色', kinds: ['character'], code: CHARACTER },
  { key: 'minimap', name: '小地图', kinds: ['character', 'enemy'], code: MINIMAP },
  { key: 'mapui', name: '地图元素', kinds: ['mapui'], code: MAPUI },
  { key: 'ground', name: '地皮', kinds: ['ground'], code: GROUND },
  { key: 'camera', name: '摄像机', kinds: ['camera'], code: CAMERA },
];

/** 某种节点默认挂哪些预设组件（按数组顺序） */
export function presetKeysForKind(kind: SceneKind): string[] {
  return PRESET_COMPONENT_SCRIPTS.filter((p) => p.kinds.includes(kind)).map((p) => p.key);
}
