/**
 * 无头自检入口：Node 里直接实例化运行时、脚本 VM 与迁移链，证明它们不依赖 DOM。
 * 由 scripts/runtime-headless.mjs 用 esbuild 打包成 cjs 后运行，输出 JSON 结果。
 */
import { newAnimation } from '../../src/editor/model/build';
import { makeMoveController, V_MOVING } from '../../src/editor/model/controller';
import { makeDefaultStateMachine } from '../../src/editor/model/statemachine';
import { defaultCharacter, shortId, type ProjectDoc, type SceneNode } from '../../src/editor/model/types';
import { migrateMetaFile } from '../../src/editor/model/migrations';
import { SceneRuntime } from '../../src/runtime/sceneRuntime';
import { ScriptVM } from '../../src/runtime/scripts';

function buildDoc(): ProjectDoc {
  const anim = newAnimation('测试动画', 'humanoid5');
  const ctrl = makeMoveController();
  const sm = makeDefaultStateMachine(anim, ctrl);
  const node: SceneNode = {
    id: shortId('obj'),
    name: '角色',
    kind: 'character',
    parentId: null,
    order: 0,
    x: 0,
    z: 0,
    open: true,
    character: { ...defaultCharacter(), animationId: anim.id, stateMachineId: sm.id, controllerIds: [ctrl.id] },
  };
  return {
    name: 'headless',
    createdAt: 0,
    updatedAt: 0,
    folders: [],
    folderKinds: {},
    images: [],
    textures: [],
    animations: [anim],
    stateMachines: [sm],
    controllers: [ctrl],
    scripts: [],
    scene: [node],
  } as unknown as ProjectDoc;
}

function checkRuntime() {
  // 假时钟：手动推进，长按/双击判定全部确定化
  let t = 0;
  const doc = buildDoc();
  const rt = new SceneRuntime(doc, doc.scene[0], { now: () => t });
  const before = rt.state.x;
  rt.keyDown('KeyW');
  for (let i = 0; i < 10; i++) {
    t += 16;
    rt.tick(0.016);
  }
  const walked = rt.state.x === before && rt.state.z < 0 && rt.state.stateName === '行走';
  rt.keyUp('KeyW');
  t += 16;
  rt.tick(0.016);
  const backIdle = rt.state.stateName === '待机';
  // 长按判定：按住 500ms 应触发一次 longpress
  rt.reset();
  rt.keyDown('KeyW');
  t += 500;
  rt.tick(0.05);
  const longpressOk = rt.vars[V_MOVING] > 0;
  return { walked, backIdle, longpressOk, vars: { ...rt.vars } };
}

/** W3：脚本挂载 → onStart / onUpdate 位移 / onEvent 写控制器变量 / Light.input */
async function checkScripts() {
  const doc = buildDoc();
  doc.scripts = [
    {
      id: 'sc1',
      name: '推动器',
      folder: '脚本',
      createdAt: 0,
      // v_moving 是移动控制器的固定变量 id（editor/model/controller.ts）
      code: `
function onStart(self, Light) { Light.log('起', self.name); }
function onUpdate(self, Light, dt) {
  self.x += dt * 2;
  if (Light.input.isDown('KeyW')) self.z -= dt * 1;
}
function onEvent(self, Light, name, data) {
  if (name === 'buff') self.vars.v_moving = (data && data.amount) || 1;
}
`,
    },
  ];
  doc.scene[0].scriptIds = ['sc1'];

  let t = 0;
  const rt = new SceneRuntime(doc, doc.scene[0], { now: () => t });
  const vm = await ScriptVM.create();
  rt.attachScripts(vm);
  rt.startScripts();

  const x0 = rt.state.x;
  rt.keyDown('KeyW');
  for (let i = 0; i < 25; i++) {
    t += 16;
    rt.tick(0.016);
  }
  rt.keyUp('KeyW');
  // 脚本位移：25 帧 × 0.016s × 2 = 0.8（运行时状态机没切行走时状态机自身不位移，位移全来自脚本）
  const scriptMoved = rt.state.x > x0 + 0.6;
  const inputWorks = rt.state.z < 0; // isDown('KeyW') 让脚本也推了 z
  // 事件 → 脚本写控制器变量
  vm.emit('buff', { amount: 42 });
  t += 16;
  rt.tick(0.016);
  const eventOk = rt.vars[V_MOVING] === 42;
  const startedOk = vm.logs.some((l) => l.includes('起'));
  rt.disposeScripts();
  return { scriptMoved, inputWorks, eventOk, startedOk };
}

function checkMigrations() {
  // 远古文件：无 version、角色缺 controllerIds
  const old = { name: '老工程', assets: {}, scene: [{ id: 'n1', character: { blood: 100 } }] };
  const r1 = migrateMetaFile(old);
  // 未来文件：版本号更高，不许降级
  const future = { name: '新格式', version: 99 };
  const r2 = migrateMetaFile(future);
  return {
    stamped: r1.meta.version === 2,
    applied: r1.applied,
    controllerIdsFilled: Array.isArray((r1.meta.scene?.[0] as { character?: { controllerIds?: unknown } })?.character?.controllerIds),
    futureKept: r2.meta.version === 99,
  };
}

(async () => {
  const runtime = checkRuntime();
  const scripts = await checkScripts();
  const migrations = checkMigrations();
  const ok =
    runtime.walked &&
    runtime.backIdle &&
    runtime.longpressOk &&
    scripts.scriptMoved &&
    scripts.inputWorks &&
    scripts.eventOk &&
    scripts.startedOk &&
    migrations.stamped &&
    migrations.controllerIdsFilled &&
    migrations.futureKept;
  console.log(JSON.stringify({ ok, runtime, scripts, migrations }, null, 1));
  if (!ok) process.exit(1);
})();
