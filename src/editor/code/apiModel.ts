/**
 * 脚本 API 模型 —— 代码补全 / hover 说明 / 右栏速查 的唯一数据源。
 *
 * 为什么单拎一份：脚本能用的东西分三类
 *   1. 注解（属性面板的显示与控件）
 *   2. 基类 this 上的成员与生命周期
 *   3. 宿主对象（node / project / camera / Event / three）
 * 以前这些信息散在 ScriptWorkbench 的速查表和 docs/*.md 里，加一个 API 要改三处。
 * 现在补全与速查都读这里；docs 里的 md 仍然是「人读的完整文档」。
 *
 * 新增 / 修改任何脚本 API 时，这个文件要和 src/editor/docs/ 一起改
 * （见 .workbuddy/memory/MEMORY.md 的硬性约定）。
 */

/** 补全列表里的图标分类（对应 CodeMirror 的 Completion type） */
export type ApiKind = 'property' | 'method' | 'function' | 'keyword' | 'class' | 'type' | 'constant' | 'variable';

export interface ApiEntry {
  /** 补全用的名字 */
  name: string;
  kind: ApiKind;
  /** 列表右侧的类型 / 签名 */
  type?: string;
  /** 插入文本；含 ${占位} 时按代码片段插入。不填 = 直接插入 name */
  snippet?: string;
  /** 说明（补全弹窗右侧文档、hover、右栏速查共用） */
  doc: string;
  /** 额外提示（可用值 / 注意事项），接在 doc 后面显示 */
  hint?: string;
}

export interface ApiScope {
  id: string;
  /** 右栏速查的分组标题 */
  title: string;
  /** 补全时的排序加权 */
  boost?: number;
  entries: ApiEntry[];
}

/* ------------------------------------------------------------------ */
/* this（LightComponent 基类）                                        */
/* ------------------------------------------------------------------ */

const THIS_SCOPE: ApiScope = {
  id: 'this',
  title: 'this · 组件自身',
  boost: 10,
  entries: [
    { name: 'node', kind: 'property', type: 'SceneNode', doc: '当前场景对象（只读快照）：id / name / kind / x / z / character / mapui …' },
    { name: 'project', kind: 'property', type: 'ProjectDoc', doc: '整个工程（只读）：scene / images / textures / animations / stateMachines / controllers / scripts。' },
    { name: 'scene', kind: 'property', type: 'THREE.Scene | null', doc: '视口里的 three 场景，可以往里加自己建的对象。编辑态也有值。' },
    { name: 'three', kind: 'property', type: 'typeof THREE | null', doc: 'three 命名空间，直接 new this.three.Vector3() / Mesh / Group…' },
    { name: 'object3d', kind: 'property', type: 'THREE.Object3D | null', doc: '该节点在场景里的锚点对象（位置已对好）。挂模型 / 灯 / 粒子都加到它下面。' },
    { name: 'camera', kind: 'property', type: 'CameraRig | null', doc: '运行时相机。只有播放态有值；摄像机组件写 pose 来摆画面。', hint: '编辑态为 null，用之前判空' },
    { name: 'playing', kind: 'property', type: 'boolean', doc: 'true = 正在播放，false = 编辑态（属性面板驱动）。' },
    { name: 'ctx', kind: 'property', type: 'ComponentContext', doc: '宿主注入的原始上下文（node / project / log / patchNode … 都在这里）。一般用上面的 getter 就够了。' },
    { name: 'log', kind: 'method', type: '(...args: unknown[]) => void', snippet: "log('${1:日志}')", doc: '写日志：播放时进播放日志面板，编辑态进控制台。' },
    { name: 'emit', kind: 'method', type: '(type: string, payload?: unknown) => void', snippet: "emit('${1:事件名}', ${2:payload})", doc: '广播事件，所有 onEvent / Event.on 的订阅者都会收到。' },
    { name: 'setNode', kind: 'method', type: '(patch: Partial<SceneNode>) => void', snippet: 'setNode({ ${1:x}: ${2:0} })', doc: '写节点顶层字段（x / z / name / minimapShow / minimapIcon …），会进撤销历史并落盘。' },
    { name: 'setCharacter', kind: 'method', type: '(patch: Partial<CharacterConfig>) => void', snippet: 'setCharacter({ ${1:blood}: ${2:100} })', doc: '写角色配置（blood / satiation / mental / speed / attack / animationId …）。只有角色节点有效。' },
    { name: 'setMapui', kind: 'method', type: '(patch: Partial<MapUiConfig>) => void', snippet: 'setMapui({ ${1:size}: ${2:64} })', doc: '写地图元素配置（range / shape / size / sx / sy / decorId …）。只有地图元素节点有效。' },
    { name: 'on', kind: 'method', type: '(type: string, fn) => () => void', snippet: "on('${1:事件名}', (payload) => {\n  ${}\n})", doc: '订阅事件，返回取消订阅函数。播放结束时记得调它（或用 onDestroy 兜底）。' },
    { name: 'onMount', kind: 'method', type: '() => void', snippet: 'onMount() {\n  ${}\n}', doc: '挂载后立刻调用一次（编辑态也会调用）。用来把节点上已有数据灌进字段。' },
    { name: 'onStart', kind: 'method', type: '() => void', snippet: 'onStart() {\n  ${}\n}', doc: '播放开始时调用一次（编辑态不调用）。' },
    { name: 'onUpdate', kind: 'method', type: '(dt: number) => void', snippet: 'onUpdate(dt: number) {\n  ${}\n}', doc: '每帧调用，dt = 这一帧的秒数。逻辑写这里。' },
    { name: 'onEvent', kind: 'method', type: '(type: string, payload?: any) => void', snippet: 'onEvent(type: string, payload?: any) {\n  ${}\n}', doc: '收到 Event.emit / this.emit 的事件。' },
    { name: 'onDestroy', kind: 'method', type: '() => void', snippet: 'onDestroy() {\n  ${}\n}', doc: '播放结束 / 组件卸载时调用。清理 three 对象、取消订阅。' },
    { name: 'onFieldChange', kind: 'method', type: '(key: string, value: unknown) => void', snippet: 'onFieldChange(key: string, value: unknown) {\n  ${}\n}', doc: '属性面板改了字段之后回调，用来把值同步到 three 对象。' },
  ],
};

/* ------------------------------------------------------------------ */
/* 宿主数据对象                                                        */
/* ------------------------------------------------------------------ */

const NODE_SCOPE: ApiScope = {
  id: 'node',
  title: 'this.node · 场景对象',
  boost: 8,
  entries: [
    { name: 'id', kind: 'property', type: 'string', doc: '节点唯一 id（摄像机抢占、事件里定位用）。' },
    { name: 'name', kind: 'property', type: 'string', doc: '对象名（层级面板显示的名字）。可写，走 setNode。' },
    { name: 'kind', kind: 'property', type: "'character' | 'enemy' | 'ground' | 'mapui' | 'cover' | 'group' | 'camera' | 'time' | 'weather'", doc: '对象类型。' },
    { name: 'parentId', kind: 'property', type: 'string | null', doc: '父节点 id；null = 在场景根层。' },
    { name: 'order', kind: 'property', type: 'number', doc: '同一层里的排序（小的在前）。' },
    { name: 'x', kind: 'property', type: 'number', doc: '世界坐标 X（俯视平面的左右）。写它用 setNode({ x })。' },
    { name: 'z', kind: 'property', type: 'number', doc: '世界坐标 Z（俯视平面的上下）。' },
    { name: 'open', kind: 'property', type: 'boolean | undefined', doc: '分组在层级面板里是否展开（纯界面状态）。' },
    { name: 'character', kind: 'property', type: 'CharacterConfig | undefined', doc: '角色配置（只有 kind === "character" 才有）：blood / speed / animationId / stateMachineId / controllerIds …' },
    { name: 'mapui', kind: 'property', type: 'MapUiConfig | undefined', doc: '地图元素配置（只有 kind === "mapui" 才有）：range / shape / size / sx / sy / decorId …' },
    { name: 'ground', kind: 'property', type: 'GroundConfig | undefined', doc: '地皮生成配置（只有 kind === "ground" 才有）。' },
    { name: 'scriptIds', kind: 'property', type: 'string[] | undefined', doc: '挂的钩子脚本（旧式 function 脚本）id 列表。' },
    { name: 'componentIds', kind: 'property', type: 'string[] | undefined', doc: '挂的组件脚本（TS class）id 列表，驱动属性面板。' },
    { name: 'components', kind: 'property', type: 'Record<string, Record<string, unknown>> | undefined', doc: '组件字段值：scriptId → { 字段名: 值 }。只存改过的值。' },
    { name: 'minimapShow', kind: 'property', type: 'boolean | undefined', doc: '是否在小地图上显示（默认显示）。' },
    { name: 'minimapIcon', kind: 'property', type: 'string | null | undefined', doc: '小地图图标：图组（group）资产 id；空 = 默认圆点。' },
  ],
};

const PROJECT_SCOPE: ApiScope = {
  id: 'project',
  title: 'this.project · 工程',
  entries: [
    { name: 'name', kind: 'property', type: 'string', doc: '工程名。' },
    { name: 'root', kind: 'property', type: 'string', doc: '工程目录的绝对路径。' },
    { name: 'scene', kind: 'property', type: 'SceneNode[]', doc: '所有场景对象（扁平数组，父子关系看 parentId）。' },
    { name: 'images', kind: 'property', type: 'ImageAsset[]', doc: '图片资产：id / name / file / width / height。' },
    { name: 'textures', kind: 'property', type: 'TextureAsset[]', doc: '贴图资产（可平铺材质）。' },
    { name: 'animations', kind: 'property', type: 'AnimationAsset[]', doc: '动画资产：id / name / template / frames。' },
    { name: 'stateMachines', kind: 'property', type: 'StateMachineAsset[]', doc: '状态机资产。' },
    { name: 'controllers', kind: 'property', type: 'ControllerAsset[]', doc: '控制器资产（变量 + 按键绑定）。' },
    { name: 'scripts', kind: 'property', type: 'ScriptAsset[]', doc: '脚本资产：id / name / code / kind。' },
    { name: 'folders', kind: 'property', type: 'string[]', doc: '虚拟目录路径（只是分组名，不对应磁盘文件夹）。' },
    { name: 'updatedAt', kind: 'property', type: 'number', doc: '最后保存时间（毫秒时间戳）。' },
  ],
};

const CAMERA_SCOPE: ApiScope = {
  id: 'camera',
  title: 'this.camera · 运行时相机',
  boost: 6,
  entries: [
    { name: 'pose', kind: 'property', type: '{ x, y, z, pitch, yaw, distance }', doc: '可写：注视点 + 俯仰角 / 环绕角（弧度）+ 距离。视口每帧照它摆相机。' },
    { name: 'follow', kind: 'property', type: '{ x, y, z, height }', doc: '只读：当前跟随目标（运行时玩家）的位置与身高。' },
    { name: 'autoDistance', kind: 'property', type: 'number', doc: '只读：按角色身高算出的推荐距离（角色约占屏幕 1/3）。' },
    { name: 'claimedBy', kind: 'property', type: 'string | null', doc: '哪个摄像机节点接管了相机。多个摄像机时先写自己的 node.id 的那个生效。' },
  ],
};

const POSE_SCOPE: ApiScope = {
  id: 'pose',
  title: 'camera.pose · 相机位姿',
  entries: [
    { name: 'x', kind: 'property', type: 'number', doc: '注视点 X（世界坐标）。' },
    { name: 'y', kind: 'property', type: 'number', doc: '注视点 Y。通常取角色身高的一半，画面上下才居中。' },
    { name: 'z', kind: 'property', type: 'number', doc: '注视点 Z。' },
    { name: 'pitch', kind: 'property', type: 'number', doc: '俯仰角（弧度）：Math.PI/4 = 45° 斜视；垂直俯视用 Math.PI/2 - 0.12，别写正好 π/2（万向锁）。' },
    { name: 'yaw', kind: 'property', type: 'number', doc: '水平环绕角（弧度），0 = 正对屏幕上方。' },
    { name: 'distance', kind: 'property', type: 'number', doc: '相机到注视点的距离。' },
  ],
};

const FOLLOW_SCOPE: ApiScope = {
  id: 'follow',
  title: 'camera.follow · 跟随目标',
  entries: [
    { name: 'x', kind: 'property', type: 'number', doc: '目标 X（世界坐标）。' },
    { name: 'y', kind: 'property', type: 'number', doc: '目标脚底 Y（一般是 0）。' },
    { name: 'z', kind: 'property', type: 'number', doc: '目标 Z。' },
    { name: 'height', kind: 'property', type: 'number', doc: '目标身高（用来算注视点高度与默认距离）。' },
  ],
};

const EVENT_SCOPE: ApiScope = {
  id: 'Event',
  title: 'Event · 全局事件总线',
  boost: 9,
  entries: [
    { name: 'emit', kind: 'method', type: '(type: string, payload?: unknown) => void', snippet: "emit('${1:事件名}', ${2:payload})", doc: '广播事件。所有组件的 onEvent 与 Event.on 订阅者都会收到。' },
    { name: 'on', kind: 'method', type: '(type: string, fn) => () => void', snippet: "on('${1:事件名}', (payload) => {\n  ${}\n})", doc: '订阅事件，返回取消函数。' },
    { name: 'off', kind: 'method', type: '(type: string, fn) => void', doc: '取消订阅（也可以调用 on 返回的函数）。' },
    { name: 'clear', kind: 'method', type: '() => void', doc: '清空所有订阅（慎用，会把别的脚本的订阅也清掉）。' },
  ],
};

const OBJECT3D_SCOPE: ApiScope = {
  id: 'object3d',
  title: 'Object3D · 场景对象',
  entries: [
    { name: 'position', kind: 'property', type: 'Vector3', doc: '相对父对象的位置。改完不需要手动 updateMatrix（渲染时自动算）。' },
    { name: 'rotation', kind: 'property', type: 'Euler', doc: '欧拉角（弧度）：rotation.y 转朝向最常见。' },
    { name: 'scale', kind: 'property', type: 'Vector3', doc: '缩放。' },
    { name: 'visible', kind: 'property', type: 'boolean', doc: '是否渲染。隐藏用 false（不会销毁对象）。' },
    { name: 'children', kind: 'property', type: 'Object3D[]', doc: '子对象列表（直接改它无效，用 add / remove）。' },
    { name: 'parent', kind: 'property', type: 'Object3D | null', doc: '父对象。' },
    { name: 'add', kind: 'method', type: '(...objects: Object3D[]) => this', doc: '挂子对象。' },
    { name: 'remove', kind: 'method', type: '(...objects: Object3D[]) => this', doc: '摘子对象（只是从场景树移除，不释放 GPU 资源）。' },
    { name: 'traverse', kind: 'method', type: '(fn: (o: Object3D) => void) => void', doc: '深度遍历自己和所有子孙。' },
    { name: 'getObjectByName', kind: 'method', type: '(name: string) => Object3D | undefined', doc: '按名字找子孙对象。' },
    { name: 'lookAt', kind: 'method', type: '(x: number, y: number, z: number) => void', doc: '朝向某个世界坐标。' },
  ],
};

const SCENE_SCOPE: ApiScope = {
  id: 'scene',
  title: 'Scene · three 场景',
  entries: [
    { name: 'add', kind: 'method', type: '(...objects: Object3D[]) => this', doc: '往场景里加对象。' },
    { name: 'remove', kind: 'method', type: '(...objects: Object3D[]) => this', doc: '从场景里移除对象。' },
    { name: 'traverse', kind: 'method', type: '(fn: (o: Object3D) => void) => void', doc: '遍历整个场景树。' },
    { name: 'getObjectByName', kind: 'method', type: '(name: string) => Object3D | undefined', doc: '按名字找对象。' },
    { name: 'children', kind: 'property', type: 'Object3D[]', doc: '场景直接子对象。' },
    { name: 'background', kind: 'property', type: 'Color | Texture | null', doc: '背景色 / 背景图，可写。' },
    { name: 'fog', kind: 'property', type: 'Fog | null', doc: '雾，可写：scene.fog = new this.three.Fog(0x000000, 10, 40)。' },
  ],
};

const THREE_SCOPE: ApiScope = {
  id: 'three',
  title: 'this.three · three 命名空间',
  entries: [
    { name: 'Vector3', kind: 'class', type: 'new (x?, y?, z?) => Vector3', doc: '三维向量 / 坐标。' },
    { name: 'Vector2', kind: 'class', type: 'new (x?, y?) => Vector2', doc: '二维向量。' },
    { name: 'Euler', kind: 'class', type: 'new (x?, y?, z?) => Euler', doc: '欧拉角（弧度）。' },
    { name: 'Quaternion', kind: 'class', type: 'new () => Quaternion', doc: '四元数（插值旋转用）。' },
    { name: 'Color', kind: 'class', type: 'new (color?) => Color', doc: '颜色。' },
    { name: 'Group', kind: 'class', type: 'new () => Group', doc: '空容器，用来装一堆对象一起动。' },
    { name: 'Mesh', kind: 'class', type: 'new (geometry, material) => Mesh', doc: '网格体：几何 + 材质。' },
    { name: 'Sprite', kind: 'class', type: 'new (material) => Sprite', doc: '永远面向相机的面片（2D 立绘、光点常用）。' },
    { name: 'SpriteMaterial', kind: 'class', type: 'new (params?) => SpriteMaterial', doc: 'Sprite 的材质。' },
    { name: 'Points', kind: 'class', type: 'new (geometry, material) => Points', doc: '点云（粒子）。' },
    { name: 'BoxGeometry', kind: 'class', type: 'new (w, h, d) => BoxGeometry', doc: '立方体几何。' },
    { name: 'PlaneGeometry', kind: 'class', type: 'new (w, h) => PlaneGeometry', doc: '平面几何。' },
    { name: 'SphereGeometry', kind: 'class', type: 'new (r, wSeg, hSeg) => SphereGeometry', doc: '球体几何。' },
    { name: 'CylinderGeometry', kind: 'class', type: 'new (rt, rb, h, seg) => CylinderGeometry', doc: '圆柱 / 圆锥几何。' },
    { name: 'BufferGeometry', kind: 'class', type: 'new () => BufferGeometry', doc: '自定义几何（配合 BufferAttribute）。' },
    { name: 'BufferAttribute', kind: 'class', type: 'new (array, itemSize) => BufferAttribute', doc: '顶点属性数据。' },
    { name: 'MeshBasicMaterial', kind: 'class', type: 'new (params?) => MeshBasicMaterial', doc: '不受光的材质（最省）。' },
    { name: 'MeshStandardMaterial', kind: 'class', type: 'new (params?) => MeshStandardMaterial', doc: 'PBR 材质（受光，质量好）。' },
    { name: 'Line', kind: 'class', type: 'new (geometry, material) => Line', doc: '线段。' },
    { name: 'AmbientLight', kind: 'class', type: 'new (color?, intensity?) => AmbientLight', doc: '环境光。' },
    { name: 'DirectionalLight', kind: 'class', type: 'new (color?, intensity?) => DirectionalLight', doc: '平行光（太阳）。' },
    { name: 'PointLight', kind: 'class', type: 'new (color?, intensity?, distance?) => PointLight', doc: '点光源。' },
    { name: 'Clock', kind: 'class', type: 'new () => Clock', doc: '计时器（getDelta / getElapsedTime）。' },
    { name: 'MathUtils', kind: 'class', type: 'namespace', doc: '数学工具：lerp / clamp / degToRad / randFloat …' },
    { name: 'DoubleSide', kind: 'constant', type: 'Side', doc: '双面渲染：material.side = this.three.DoubleSide。' },
    { name: 'AdditiveBlending', kind: 'constant', type: 'Blending', doc: '加法混合（发光效果）：material.blending = this.three.AdditiveBlending。' },
    { name: 'RepeatWrapping', kind: 'constant', type: 'Wrapping', doc: '重复平铺：texture.wrapS = this.three.RepeatWrapping。' },
  ],
};

const INPUT_SCOPE: ApiScope = {
  id: 'input',
  title: 'this.ctx.input · 按键',
  entries: [
    { name: 'isDown', kind: 'method', type: '(key: string) => boolean', snippet: "isDown('${1:w}')", doc: '按键是否按住（持续）。键名用 KeyboardEvent.key：w / a / ArrowUp / Shift …' },
    { name: 'pressed', kind: 'method', type: '(key: string) => boolean', snippet: "pressed('${1:Space}')", doc: '这一帧是否刚按下（只触发一次）。' },
  ],
};

/* ------------------------------------------------------------------ */
/* 根作用域（装饰器 / 全局 / 片段）                                    */
/* ------------------------------------------------------------------ */

const DECORATORS: ApiEntry[] = [
  {
    name: 'Component',
    kind: 'function',
    type: "(name, { desc?, icon?, order? }) => void",
    snippet: "@Component('${1:我的组件}', { icon: '${2:🧩}', order: ${3:50} })\nexport default class ${4:MyComponent} extends LightComponent {\n  ${}\n}",
    doc: '类注解：属性面板里的区块标题 / 图标 / 排序。一个脚本只能有一个默认导出的组件类。',
  },
  { name: 'Group', kind: 'function', type: '(name, order = 100) => void', snippet: "@Group('${1:基础}', ${2:10})", doc: '把字段归到一个分组（面板里的小标题）。order 小的在前。' },
  { name: 'Label', kind: 'function', type: '(text) => void', snippet: "@Label('${1:中文名}')", doc: '字段在面板里的显示名。不写就用字段名。' },
  { name: 'Hint', kind: 'function', type: '(text) => void', snippet: "@Hint('${1:说明}')", doc: '字段下方的灰色说明文字。' },
  { name: 'Order', kind: 'function', type: '(n) => void', snippet: '@Order(${1:10})', doc: '同组内的排序（小的在前）。不写就按声明顺序。' },
  { name: 'Hidden', kind: 'function', type: '() => void', snippet: '@Hidden()', doc: '面板里不显示这个字段（运行时仍然可用）。内部状态标记用。' },
  { name: 'Num', kind: 'function', type: '(min?, max?, step = 1) => void', snippet: '@Num(${1:0}, ${2:100}, ${3:1})', doc: '数值控件。给了 min/max 会显示滑条范围。' },
  { name: 'Int', kind: 'function', type: '(min?, max?) => void', snippet: '@Int(${1:0}, ${2:10})', doc: '整数控件（步长固定 1）。' },
  { name: 'Bool', kind: 'function', type: '() => void', snippet: '@Bool()', doc: '开关控件。' },
  { name: 'Str', kind: 'function', type: '() => void', snippet: '@Str()', doc: '单行文本控件。' },
  { name: 'Text', kind: 'function', type: '() => void', snippet: '@Text()', doc: '多行文本控件。' },
  { name: 'Color', kind: 'function', type: '() => void', snippet: '@Color()', doc: '颜色控件，值存 #rrggbb 字符串。' },
  { name: 'Enum', kind: 'function', type: "(options: string[] | {value,label}[]) => void", snippet: "@Enum([{ value: '${1:a}', label: '${2:甲}' }])", doc: '下拉枚举。值可以是字符串或数字。' },
  {
    name: 'Asset',
    kind: 'function',
    type: "(kind: 'image'|'texture'|'group'|'animation'|'statemachine'|'controller'|'script', opts?) => void",
    snippet: "@Asset('${1:animation}')",
    doc: '资源引用控件，值存资产 id。第二个参数 { multiple: true } 可多选（值是 id 数组）。',
    hint: 'group = 图组（四向立绘）；animation = 动画；statemachine = 状态机',
  },
  { name: 'Json', kind: 'function', type: '() => void', snippet: '@Json()', doc: '任意可 JSON 序列化的对象 / 数组，用 JSON 文本框编辑。也适合存状态机这类复杂结构。' },
  { name: 'List', kind: 'function', type: '(itemKind?: FieldKind) => void', snippet: '@List()', doc: '数组控件。目前渲染与 @Json 同款（JSON 文本框），元素类型参数先留着。' },
  { name: 'Panel', kind: 'function', type: "(id: 'ground' | string) => void", snippet: "@Panel('${1:ground}')", doc: '交给宿主内置面板渲染（现在是地皮生成器 ground）。' },
];

const SKELETON: ApiEntry = {
  name: 'class',
  kind: 'keyword',
  type: '组件脚本骨架',
  snippet: "@Component('${1:我的组件}', { icon: '${2:🧩}', order: ${3:50} })\nexport default class ${4:MyComponent} extends LightComponent {\n  @Group('基础') @Label('开关') @Bool() enabled = true;\n\n  onStart() {\n    ${}\n  }\n\n  onUpdate(dt: number) {\n    ${}\n  }\n}",
  doc: '插入一份完整的组件脚本骨架（类注解 + 一个字段 + 两个生命周期）。新建脚本时模板已经长这样，写第二个组件时用得上。',
};

const HOOK_SKELETON: ApiEntry = {
  name: 'onStart',
  kind: 'keyword',
  type: '钩子脚本骨架',
  snippet: "function onStart(self, Light) {\n  Light.log(self.name + ' 上线');\n}\n\nfunction onUpdate(self, Light, dt) {\n  ${}\n}\n\nfunction onEvent(self, Light, name, data) {\n  ${}\n}\n\nfunction onDestroy(self, Light) {\n  ${}\n}",
  doc: '插入钩子脚本的四个钩子函数骨架（旧式 quickjs 脚本）。',
};

const ROOT_GLOBALS: ApiEntry[] = [
  { name: 'LightComponent', kind: 'class', type: 'class', snippet: 'LightComponent', doc: '所有组件脚本的基类。export default class X extends LightComponent。' },
  { name: 'Event', kind: 'constant', type: '{ emit, on, off, clear }', doc: '全局事件总线：Event.emit("事件名", data) 能与任何脚本通信。' },
];

/* ------------------------------------------------------------------ */
/* 钩子脚本（旧式 quickjs）：独立作用域                                */
/* ------------------------------------------------------------------ */

const HOOK_GLOBALS: ApiEntry[] = [
  { name: 'onStart', kind: 'function', type: '(self, Light) => void', snippet: 'function onStart(self, Light) {\n  ${}\n}', doc: '播放开始，每个实例一次。' },
  { name: 'onUpdate', kind: 'function', type: '(self, Light, dt) => void', snippet: 'function onUpdate(self, Light, dt) {\n  ${}\n}', doc: '每帧调用，dt = 秒。' },
  { name: 'onEvent', kind: 'function', type: '(self, Light, name, data) => void', snippet: 'function onEvent(self, Light, name, data) {\n  ${}\n}', doc: '收到 Light.emit 的信号。' },
  { name: 'onDestroy', kind: 'function', type: '(self, Light) => void', snippet: 'function onDestroy(self, Light) {\n  ${}\n}', doc: '播放结束 / 实例销毁。' },
];

const SELF_SCOPE: ApiScope = {
  id: 'self',
  title: 'self · 实例',
  entries: [
    { name: 'name', kind: 'property', type: 'string', doc: '对象名。' },
    { name: 'x', kind: 'property', type: 'number', doc: '世界坐标 X（可写，钩子返回后回写运行时）。' },
    { name: 'z', kind: 'property', type: 'number', doc: '世界坐标 Z（可写）。' },
    { name: 'face', kind: 'property', type: 'number', doc: '朝向：1 右 / -1 左（可写）。' },
    { name: 'vars', kind: 'property', type: 'Record<string, number>', doc: '控制器变量表（可读写，和运行时共享）。' },
  ],
};

const LIGHT_SCOPE: ApiScope = {
  id: 'Light',
  title: 'Light · 钩子脚本 API',
  entries: [
    { name: 'log', kind: 'method', type: '(...args: unknown[]) => void', snippet: "log('${1:日志}')", doc: '输出到播放日志。' },
    { name: 'input', kind: 'property', type: '{ isDown, pressed }', doc: '按键状态：Light.input.isDown("w") / Light.input.pressed("Space")。' },
    { name: 'emit', kind: 'method', type: '(name, data?) => void', snippet: "emit('${1:事件名}', ${2:data})", doc: '广播事件（其它钩子脚本的 onEvent 能收到）。' },
    { name: 'on', kind: 'method', type: '(name, fn) => void', snippet: "on('${1:事件名}', (data) => {\n  ${}\n})", doc: '订阅事件。' },
    { name: 'time', kind: 'method', type: '() => number', doc: '播放开始到现在的秒数。' },
    { name: 'find', kind: 'method', type: '(name: string) => { name, x, z }[]', snippet: "find('${1:对象名}')", doc: '按名字找实体（只读快照）。' },
  ],
};

/* ------------------------------------------------------------------ */
/* 汇总                                                                */
/* ------------------------------------------------------------------ */

/** 组件脚本的作用域（右栏速查按这个顺序展示） */
export const COMPONENT_SCOPES: ApiScope[] = [THIS_SCOPE, NODE_SCOPE, PROJECT_SCOPE, CAMERA_SCOPE, EVENT_SCOPE, THREE_SCOPE];

/** 所有可能在补全里出现的作用域 */
const ALL_SCOPES: ApiScope[] = [
  THIS_SCOPE,
  NODE_SCOPE,
  PROJECT_SCOPE,
  CAMERA_SCOPE,
  POSE_SCOPE,
  FOLLOW_SCOPE,
  EVENT_SCOPE,
  OBJECT3D_SCOPE,
  SCENE_SCOPE,
  THREE_SCOPE,
  INPUT_SCOPE,
  SELF_SCOPE,
  LIGHT_SCOPE,
];

const SCOPE_BY_ID = new Map<string, ApiScope>(ALL_SCOPES.map((s) => [s.id, s]));

/** 接收者标识符 → 作用域 id（`this.node.` 里最后一个标识符是 node） */
const RECEIVER_SCOPE: Record<string, string> = {
  this: 'this',
  ctx: 'this',
  node: 'node',
  project: 'project',
  camera: 'camera',
  pose: 'pose',
  follow: 'follow',
  Event: 'Event',
  three: 'three',
  THREE: 'three',
  object3d: 'object3d',
  Object3D: 'object3d',
  scene: 'scene',
  Scene: 'scene',
  input: 'input',
  self: 'self',
  Light: 'Light',
};

export function scopeById(id: string): ApiScope | undefined {
  return SCOPE_BY_ID.get(id);
}

/** 由点号链求作用域：['this','node'] → node */
export function scopeOfChain(chain: string[]): ApiScope | undefined {
  if (chain.length === 0) return undefined;
  const last = chain[chain.length - 1];
  const id = RECEIVER_SCOPE[last];
  if (!id) return undefined;
  // `this.ctx.input` 之类的两段式：优先看最后一段，够了
  return SCOPE_BY_ID.get(id);
}

/** 根作用域里的条目（装饰器 + 全局 + 骨架） */
export function rootEntries(hook: boolean): ApiEntry[] {
  if (hook) return [...HOOK_GLOBALS, HOOK_SKELETON];
  return [...DECORATORS, ...ROOT_GLOBALS, SKELETON];
}

/* ------------------------------------------------------------------ */
/* 类体里的补全（生命周期钩子 / 字段片段）                             */
/* ------------------------------------------------------------------ */

/** 组件脚本的生命周期方法名（顺序即补全列表顺序） */
const LIFECYCLE_NAMES = ['onMount', 'onStart', 'onUpdate', 'onEvent', 'onFieldChange', 'onDestroy'];

/** 类体里敲字段名时插入一条带注解的属性 */
const FIELD_SNIPPET: ApiEntry = {
  name: 'field',
  kind: 'property',
  type: '带注解的字段',
  snippet: "@Group('${1:基础}', ${2:10}) @Label('${3:中文名}') @Num(${4:0}, ${5:100}, ${6:1})\n${7:speed} = ${8:1};",
  doc: '插入一条带注解的字段（分组 + 中文名 + 数值控件）；插入后改注解就能换成开关 / 文本 / 下拉 / 颜色 / 资源。',
  hint: '注解顺序随意；同组字段会自动排在一起',
};

/**
 * 组件脚本类体里的补全：六个生命周期钩子（带签名与空方法体）+ 字段片段。
 *
 * 钩子的说明与片段直接复用 THIS_SCOPE 里的定义，`this.onUpdate` 与类体里的
 * `onUpdate` 只维护一份，避免说法不一致。
 */
export function classBodyEntries(): ApiEntry[] {
  const life = LIFECYCLE_NAMES.map((n) => THIS_SCOPE.entries.find((e) => e.name === n)).filter(
    (e): e is ApiEntry => !!e,
  );
  return [...life, FIELD_SNIPPET];
}

/** 右栏「API 速查」的分组（顺序即展示顺序） */
export function sidebarGroups(hook: boolean): { title: string; entries: ApiEntry[] }[] {
  if (hook) {
    return [
      { title: '钩子函数', entries: HOOK_GLOBALS },
      { title: SELF_SCOPE.title, entries: SELF_SCOPE.entries },
      { title: LIGHT_SCOPE.title, entries: LIGHT_SCOPE.entries },
    ];
  }
  return [
    { title: '注解 · 属性面板', entries: DECORATORS },
    ...COMPONENT_SCOPES.map((s) => ({ title: s.title, entries: s.entries })),
    { title: OBJECT3D_SCOPE.title, entries: OBJECT3D_SCOPE.entries },
  ];
}

/** 找一条 API 说明（hover 用）：先按作用域，再全局兜底 */
export function findEntry(name: string, scopeIds: string[]): { entry: ApiEntry; scope: string } | null {
  for (const id of scopeIds) {
    const scope = SCOPE_BY_ID.get(id);
    const hit = scope?.entries.find((e) => e.name === name);
    if (hit) return { entry: hit, scope: scope!.title };
  }
  return null;
}
