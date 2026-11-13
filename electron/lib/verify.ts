/**
 * 自动化验证（--shot）：新建一个示例工程 → 打开动画浮窗 → 截图 → 退出。
 *
 * 只在开发/自查时用，不参与正常启动路径。
 */
import { app, BrowserWindow, nativeImage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

import { toErrorInfo } from './ipc';

interface ShotResult {
  ok: boolean;
  error?: string;
  status?: string;
  counts?: { images: number; textures: number; animations: number };
  animId?: string | null;
  metadataWritten?: boolean;
  files?: number;
  folders?: string[];
  folderKinds?: Record<string, string>;
  sampleFolder?: string;
  minimap?: {
    painted?: boolean;
    coverage?: number;
    iconSlot?: boolean;
    iconSet?: boolean;
    iconErr?: string | null;
  };
}

export async function runShot(
  win: BrowserWindow,
  outDir: string,
  opts: { holdOnBroken?: boolean } = {},
): Promise<boolean> {
  const tmpParent = path.join(app.getPath('temp'), 'light-editor-verify');
  const projectRoot = path.join(tmpParent, 'VerifyDemo');
  try {
    await fs.rm(tmpParent, { recursive: true, force: true });
    await fs.mkdir(tmpParent, { recursive: true });
  } catch (e) {
    console.error('[shot] 清理临时目录失败', e);
  }

  await waitForLoad(win);
  await sleep(900);

  // 先截首屏（未创建工程前的欢迎页）
  try {
    await fs.mkdir(outDir, { recursive: true }).catch(() => undefined);
    const welcome = await win.webContents.capturePage();
    await fs.writeFile(path.join(outDir, 'welcome.png'), welcome.toPNG());
  } catch (e) {
    console.error('[shot] 首屏截图失败', e);
  }

  let result: ShotResult = { ok: false };
  try {
    const raw = await win.webContents.executeJavaScript(`(async () => {
      try {
        await window.__editor.createProject(${JSON.stringify(tmpParent)}, 'VerifyDemo', true);
        const s = window.__editor.getSnapshot();
        const animId = s.project && s.project.animations[0] ? s.project.animations[0].id : null;
        if (animId && window.__editorUi) window.__editorUi.openAnimation(animId);
        return {
          ok: s.status === 'ready',
          status: s.status,
          counts: s.project ? {
            images: s.project.images.length,
            textures: s.project.textures.length,
            animations: s.project.animations.length,
          } : null,
          animId,
          error: s.error || null,
        };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
    })()`);
    result = raw as ShotResult;
  } catch (e) {
    result = { ok: false, error: String(toErrorInfo(e)) };
  }

  // 等 3D 贴图与布局稳定
  await sleep(2200);

  try {
    const metaPath = path.join(projectRoot, 'metadata.json');
    result.metadataWritten = await fs
      .stat(metaPath)
      .then(() => true)
      .catch(() => false);
    try {
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
      result.folders = meta.folders;
      result.folderKinds = meta.folderKinds;
      result.sampleFolder = meta.assets?.images?.[0]?.folder;
    } catch {
      /* ignore */
    }
    const walk = async (dir: string): Promise<number> => {
      const list = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      let n = 0;
      for (const it of list) {
        if (it.isDirectory()) n += await walk(path.join(dir, it.name));
        else n += 1;
      }
      return n;
    };
    result.files = await walk(projectRoot);
  } catch {
    /* ignore */
  }

  await fs.mkdir(outDir, { recursive: true }).catch(() => undefined);
  const img = await win.webContents.capturePage();
  const shotPath = path.join(outDir, 'editor.png');
  await fs.writeFile(shotPath, img.toPNG());

  // 第二张：关掉浮窗，选中一张四向贴图看中间预览
  try {
    await win.webContents.executeJavaScript(`(async () => {
      const s = window.__editor.getSnapshot();
      const tex = s.project.textures.find((t) => t.template === 'four');
      if (tex) window.__editorUi.select('texture', tex.id);
      return true;
    })()`);
    await sleep(700);
    const img2 = await win.webContents.capturePage();
    await fs.writeFile(path.join(outDir, 'texture.png'), img2.toPNG());
  } catch (e) {
    console.error('[shot] 第二张截图失败', e);
  }

  // 第三张：建一个子目录，在右栏单击（不应进入）再双击（应进入）
  try {
    const probe = await win.webContents.executeJavaScript(`(async () => {
      window.__editorUi && window.__editorUi.closeWindows && window.__editorUi.closeWindows();
      await new Promise((r) => setTimeout(r, 300));
      const sub = window.__editor.addFolder('贴图', '装备');
      await new Promise((r) => setTimeout(r, 300));
      const row = [...document.querySelectorAll('[data-folder-row]')].find((el) => (el.title || '').startsWith('贴图'));
      if (row) row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 500));
      const tile = [...document.querySelectorAll('[data-tile]')].find((el) => (el.title || '').startsWith('装备'));
      const found = !!tile;
      const readPath = () => document.querySelector('[data-browser-path]')?.textContent ?? '';
      if (tile) tile.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      const afterClick = readPath();
      if (tile) tile.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      const afterDblClick = readPath();
      // 左栏必须有「脚本」固定目录（KIND_ORDER 漏项曾导致它不显示）
      const folderTitles = [...document.querySelectorAll('[data-folder-row]')].map((el) => el.title || '');
      const hasScriptFolder = folderTitles.some((t) => t.startsWith('脚本'));
      // 点进脚本目录 → 新建脚本 → 右栏应出现该脚本 tile
      const scriptRow = [...document.querySelectorAll('[data-folder-row]')].find((el) => (el.title || '').startsWith('脚本'));
      let scriptTile = false;
      let scriptCount = -1;
      let scriptTotal = -1;
      if (scriptRow) {
        scriptRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));
        const beforeIds = window.__editor.getSnapshot().project.scripts.map((s) => s.id);
        window.__editor.addScript('脚本');
        await new Promise((r) => setTimeout(r, 400));
        const sc = window.__editor.getSnapshot().project.scripts.find((x) => beforeIds.indexOf(x.id) < 0);
        scriptTile = !!sc && [...document.querySelectorAll('[data-tile]')].some((el) => (el.title || '').indexOf(sc.name) >= 0);
        // 左栏「脚本」右侧的数字必须等于脚本总数（计数漏项曾显示 0）
        const rowNow = [...document.querySelectorAll('[data-folder-row]')].find((el) => (el.title || '').startsWith('脚本'));
        const num = /(\\d+)\\s*$/.exec((rowNow && rowNow.textContent) || '');
        scriptCount = num ? Number(num[1]) : -1;
        scriptTotal = window.__editor.getSnapshot().project.scripts.length;
        // 切回贴图目录，避免影响后续探针
        const back = [...document.querySelectorAll('[data-folder-row]')].find((el) => (el.title || '').startsWith('贴图'));
        if (back) back.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 300));
      }
      return {
        sub,
        found,
        afterClick,
        afterDblClick,
        enteredByDoubleClick: afterClick === '贴图' && afterDblClick === sub,
        hasScriptFolder,
        scriptTile,
        scriptCount,
        scriptTotal,
        countOk: scriptCount === scriptTotal && scriptTotal > 0,
        folderTitles,
      };
    })()`);
    console.log('[shot] 右栏双击进入探测:', JSON.stringify(probe));
    await sleep(700);
    const img3 = await win.webContents.capturePage();
    await fs.writeFile(path.join(outDir, 'browser.png'), img3.toPNG());
  } catch (e) {
    console.error('[shot] 第三张截图失败', e);
  }

  // 第四张：场景对象（分组 / 地面 / 覆盖物 / 敌人 / 角色）与属性面板
  try {
    const probe = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const g = ed.addSceneNode('group', '地面组');
      ed.addSceneNode('ground', '草地', g);
      ed.addSceneNode('cover', '草丛', g);
      ed.addSceneNode('enemy', '兔子');
      const c = ed.addSceneNode('character', '威尔逊');
      ed.moveSceneNodeTo(c, 2.5, 1.5);
      ed.selectScene(c);
      await new Promise((r) => setTimeout(r, 500));
      const s = ed.getSnapshot();
      const nodes = s.project.scene;
      return {
        count: nodes.length,
        roots: nodes.filter((n) => !n.parentId).length,
        grouped: nodes.filter((n) => n.parentId === g).length,
        selected: s.sceneSelection === c,
        kinds: [...new Set(nodes.map((n) => n.kind))],
        hasTokens: document.querySelectorAll('[data-scene-token]').length,
        rows: document.querySelectorAll('[data-scene-row]').length,
      };
    })()`);
    console.log('[shot] 场景对象探测:', JSON.stringify(probe));
    await sleep(1100);
    const img4 = await win.webContents.capturePage();
    await fs.writeFile(path.join(outDir, 'scene.png'), img4.toPNG());
    const meta = JSON.parse(await fs.readFile(path.join(projectRoot, 'metadata.json'), 'utf8'));
    console.log('[shot] metadata.scene 数量:', Array.isArray(meta.scene) ? meta.scene.length : 'missing');
  } catch (e) {
    console.error('[shot] 场景截图失败', e);
  }

  // 第五张：地皮生成 —— 两块地面各有一套参数与地图
  try {
    const probe = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const pick = (id) => ed.getSnapshot().project.scene.find((n) => n.id === id);

      const first = ed.ensureGroundNode();
      ed.selectScene(first);
      await new Promise((r) => setTimeout(r, 400));
      const beforeLen = pick(first).ground.map.length;
      ed.regenerateGround(first);
      await new Promise((r) => setTimeout(r, 900));
      const a = pick(first).ground;

      // 第二块地面：应继承参数模板、但自己对地图为空，独立生成
      const second = ed.addSceneNode('ground', '雪原', null, { x: 30, z: 0 });
      const inherited = !!pick(second).ground;
      const emptyLen = pick(second).ground.map.length;
      ed.setGroundType(second, 'snow', { ratio: 90 }, 'probe-snow');
      ed.setGround(second, { seed: 777, w: 24, h: 24 }, 'probe-size');
      ed.regenerateGround(second);
      ed.selectScene(second);
      await new Promise((r) => setTimeout(r, 900));
      const b = pick(second).ground;

      return {
        first: { id: first, beforeLen, size: a.w + 'x' + a.h, mapLen: a.map.length },
        second: { id: second, inherited, emptyLen, size: b.w + 'x' + b.h, mapLen: b.map.length },
        independent: a.map !== b.map,
        firstUnchanged: pick(first).ground.map.length === a.map.length,
        panel: !!document.querySelector('[data-ground-panel]'),
        counts: ed.groundCounts(second),
      };
    })()`);
    console.log('[shot] 地皮生成探测:', JSON.stringify(probe));
    await sleep(1400);
    const img5 = await win.webContents.capturePage();
    await fs.writeFile(path.join(outDir, 'ground.png'), img5.toPNG());
    const meta = JSON.parse(await fs.readFile(path.join(projectRoot, 'metadata.json'), 'utf8'));
    const grounds = (meta.scene ?? []).filter((n: { kind: string }) => n.kind === 'ground');
    console.log(
      '[shot] metadata 地面:',
      grounds.map((g: { name: string; ground?: { w: number; h: number; map: string } }) => `${g.name}=${g.ground?.w}x${g.ground?.h}/${g.ground?.map.length ?? 0}字`).join(', ') || 'none',
    );
  } catch (e) {
    console.error('[shot] 地皮截图失败', e);
  }

  // 第六段：自由形状生成 + 地图元素（屏幕 UI）
  try {
    const probe = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const snap = ed.getSnapshot();
      const g = snap.project.scene.find((n) => n.kind === 'ground' && n.ground);
      if (g) {
        ed.setGround(g.id, { w: 40, h: 40 });
        ed.regenerateGround(g.id);
      }
      // 只新建，不手动调用 ensureMapuiDecor —— 验证默认边框是自动配上的
      const ui = ed.addSceneNode ? ed.addSceneNode('mapui', '小地图') : null;
      // 时间 / 天气：只需要能添加（不做逻辑）
      const t = ed.addSceneNode ? ed.addSceneNode('time', '四季与昼夜') : null;
      const w = ed.addSceneNode ? ed.addSceneNode('weather', '天气') : null;
      await new Promise((r) => setTimeout(r, 1400));
      const s3 = ed.getSnapshot();
      const final = s3.project.scene.find((n) => n.id === ui);
      return {
        freeShape: !!g && !!s3.project.scene.find((n) => n.kind === 'ground' && n.ground && n.ground.map.includes('7')),
        uiCreated: !!ui,
        mapui: final ? final.mapui : null,
        autoDecor: !!final?.mapui?.decorId,
        decorImg: s3.project.images.find((i) => i.id === final?.mapui?.decorId)?.name ?? null,
        frameEl: !!document.querySelector('[data-mapui-frame]'),
        timeOk: !!t && !!s3.project.scene.find((n) => n.id === t && n.kind === 'time'),
        weatherOk: !!w && !!s3.project.scene.find((n) => n.id === w && n.kind === 'weather'),
        // 场景列表里能看到的行（时间 / 天气各一行）
        listTime: [...document.querySelectorAll('[data-scene-row]')].some((el) => (el.textContent || '').includes('四季与昼夜')),
        listWeather: [...document.querySelectorAll('[data-scene-row]')].some((el) => (el.textContent || '').includes('天气')),
      };
    })()`);
    console.log('[shot] 自由形状与地图元素探测:', JSON.stringify(probe));
    await sleep(1200);
    const img6 = await win.webContents.capturePage();
    await fs.writeFile(path.join(outDir, 'mapui.png'), img6.toPNG());
  } catch (e) {
    console.error('[shot] 地图元素探测失败', e);
  }

  // 第六段半：换种子布局差异 —— 各地皮的大体位置应随种子明显移动
  try {
    const vari = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const g = ed.getSnapshot().project.scene.find((n) => n.kind === 'ground' && n.ground);
      if (!g) return { error: 'no ground' };
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const genWith = async (seed) => {
        ed.setGround(g.id, { seed });
        ed.regenerateGround(g.id);
        await sleep(150);
        const cfg = ed.getSnapshot().project.scene.find((n) => n.id === g.id).ground;
        const rows = cfg.map.split('/');
        const w = cfg.w;
        const sumX = {}, sumY = {}, cnt = {};
        for (let y = 0; y < cfg.h; y++) {
          for (let x = 0; x < w; x++) {
            const v = parseInt(rows[y][x], 36);
            if (v === 7) continue;
            sumX[v] = (sumX[v] || 0) + x;
            sumY[v] = (sumY[v] || 0) + y;
            cnt[v] = (cnt[v] || 0) + 1;
          }
        }
        const cent = {};
        for (const k in cnt) cent[k] = [+(sumX[k] / cnt[k]).toFixed(1), +(sumY[k] / cnt[k]).toFixed(1)];
        return { map: cfg.map, cent };
      };
      const a = await genWith(111);
      const b = await genWith(987654);
      let diff = 0;
      let total = 0;
      for (let i = 0; i < a.map.length; i++) {
        if (a.map[i] === '/') continue;
        total += 1;
        if (a.map[i] !== b.map[i]) diff += 1;
      }
      const keys = Object.keys(a.cent);
      const moved = keys.filter((k) => b.cent[k] && (a.cent[k][0] !== b.cent[k][0] || a.cent[k][1] !== b.cent[k][1])).length;
      ed.setGround(g.id, { seed: 20261103 });
      ed.regenerateGround(g.id);
      await sleep(150);
      return { diffRatio: +(diff / Math.max(1, total)).toFixed(3), typesMoved: moved + '/' + keys.length };
    })()`);
    console.log('[shot] 种子布局差异:', JSON.stringify(vari));
  } catch (e) {
    console.error('[shot] 种子差异探测失败', e);
  }

  // 第七段：地形特写（整体轮廓 / 边界细节 / 小地图框）
  try {
    const info = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const ui = window.__editorUi;
      ui.closeWindows();
      // 只留一块自由形地面，其它场景对象删掉，画面干净
      const snap = ed.getSnapshot();
      const grounds = snap.project.scene.filter((n) => n.kind === 'ground');
      const keep = grounds[0];
      if (!keep) return { error: 'no ground' };
      // 保留这块地面 + 它的所有祖先分组，别的都删掉（删父分组会连带删子节点）
      const byId = new Map(snap.project.scene.map((n) => [n.id, n]));
      const keepIds = new Set();
      let cur = keep;
      while (cur) {
        keepIds.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : null;
      }
      for (const n of [...snap.project.scene]) {
        if (!keepIds.has(n.id)) ed.deleteSceneNode(n.id);
      }
      ed.setGround(keep.id, { w: 64, h: 64, seed: 20261103, cell: 1 });
      ed.regenerateGround(keep.id);
      ed.selectScene(keep.id);
      ui.setPanels({ left: true, right: false, bottom: false });
      await new Promise((r) => setTimeout(r, 800));
      const host = document.querySelector('[data-scene-host]');
      if (!host) return { error: 'no host' };
      host.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 700));
      return { ok: true, map: ed.getSnapshot().project.scene.find((n) => n.id === keep.id)?.ground?.map.length ?? 0 };
    })()`);
    console.log('[shot] 地形特写准备:', JSON.stringify(info));

    // 1) 整块地面轮廓
    await sleep(600);
    const imgOutline = await win.webContents.capturePage();
    await fs.writeFile(path.join(outDir, 'outline.png'), imgOutline.toPNG());

    // 2) 边界细节：滚轮拉近
    await win.webContents.executeJavaScript(`(async () => {
      const host = document.querySelector('[data-scene-host] canvas');
      for (let i = 0; i < 16; i++) host.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 600));
    })()`);
    await sleep(600);
    const imgEdge = await win.webContents.capturePage();
    await fs.writeFile(path.join(outDir, 'edge.png'), imgEdge.toPNG());

    // 3) 小地图（地图元素）特写：屏幕 UI，固定在视口左上区域，框内应画出地皮
    const mini = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const id = ed.addSceneNode('mapui', '小地图');
      ed.setMapui(id, { sx: 60, sy: 60, size: 260 });
      ed.selectScene(id);
      await new Promise((r) => setTimeout(r, 1400));
      const d = ed.getSnapshot().project.scene.find((n) => n.id === id);
      const f = document.querySelector('[data-mapui-frame]');
      const cv = document.querySelector('[data-mapui-canvas]');
      let painted = false;
      let opaque = 0;
      if (cv) {
        const ctx = cv.getContext('2d');
        const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] > 0) {
            painted = true;
            opaque += 1;
          }
        }
      }
      const decorImg = d?.mapui?.decorId ? ed.getSnapshot().project.images.find((i) => i.id === d.mapui.decorId) : null;
      // 边框图层：必须真的画出来（图片能加载、非全透明）；同时框内内容要铺满，不给边框留白
      const ringEl = document.querySelector('[data-mapui-ring]');
      const ring = { exists: !!ringEl, natural: 0, layout: '', alpha: 0 };
      if (ringEl) {
        const cs = getComputedStyle(ringEl);
        const src = cs.backgroundImage !== 'none' ? cs.backgroundImage : cs.borderImageSource;
        const um = (src || '').match(/url\\("?([^")]+)"?\\)/);
        ring.layout = cs.backgroundImage !== 'none'
          ? cs.backgroundSize + ' / ' + cs.backgroundRepeat
          : 'border-image ' + cs.borderImageRepeat;
        if (um) {
          // 只验证「图片能加载」；像素级 alpha 由 Node 侧用 data URL 解码（gameasset:// 直接画会污染 canvas）
          const im = new Image();
          await new Promise((res) => { im.onload = res; im.onerror = res; im.src = um[1]; });
          ring.natural = im.naturalWidth;
        }
      }
      const content = document.querySelector('[data-mapui-content] canvas');
      const contentPx = content ? Math.round(content.getBoundingClientRect().width) : 0;

      // 角色图标 = 图组选择器：这一段前面把场景清空只留地面，所以临时造个角色来测
      let iconSlot = false;
      let iconSet = false;
      let iconErr = null;
      try {
        const cid = ed.addSceneNode('character', '图标测试');
        ed.moveSceneNodeTo(cid, 0, 0);
        // 属性面板要打开才看得到槽位（本段默认只留左侧）
        window.__editorUi.setPanels({ left: true, right: true, bottom: false });
        ed.selectScene(cid);
        await new Promise((r) => setTimeout(r, 500));
        iconSlot = !!document.querySelector('[data-minimap-icon] [data-slot-kind="group"]');

        let p = ed.getSnapshot().project;
        let tex = p.textures.find((t) => (t.template === 'single' ? !!t.image : !!(t.dirs.S || t.dirs.E || t.dirs.N || t.dirs.W)));
        if (!tex && p.images.length > 0) {
          ed.addTexture('single');
          p = ed.getSnapshot().project;
          tex = p.textures[p.textures.length - 1];
          ed.setTextureSlot(tex.id, 'image', p.images[0].id);
          await new Promise((r) => setTimeout(r, 200));
        }
        if (tex) {
          ed.setNodeMinimap(cid, { minimapIcon: tex.id });
          await new Promise((r) => setTimeout(r, 900));
          // 图标槽位缩略图应该是这个图组的预览图
          // （画布画过 gameasset 图片后被污染，getImageData 会抛错，不能再验像素）
          const slotThumb = document.querySelector('[data-minimap-icon] [data-asset-slot] img');
          iconSet =
            ed.getSnapshot().project.scene.find((n) => n.id === cid)?.minimapIcon === tex.id && !!slotThumb;
        }
        // 只留地面 + 这个角色，属性面板收起，给小地图截图一个干净画面
        window.__editorUi.setPanels({ left: true, right: false, bottom: false });
        ed.selectScene(id);
        await new Promise((r) => setTimeout(r, 300));
      } catch (e) {
        iconErr = String(e && e.message ? e.message : e);
      }

      return {
        id,
        decor: !!decorImg,
        decorFolder: decorImg?.folder ?? null,
        decorFile: decorImg?.file ?? null,
        cfg: d?.mapui ?? null,
        frame: f ? { left: f.style.left, top: f.style.top, w: f.style.width } : null,
        canvas: !!cv,
        painted,
        coverage: cv ? +(opaque / (cv.width * cv.height)).toFixed(3) : 0,
        ring,
        contentPx,
        contentFills: Math.abs(contentPx - (d?.mapui?.size ?? 0)) <= 2,
        iconSlot,
        iconSet,
        iconErr,
      };
    })()`);
    console.log('[shot] 小地图特写:', JSON.stringify(mini));
    result.minimap = mini as ShotResult['minimap'];

    // 非破坏性裁剪（点「确定」）必须作用到地图外框：CSS 用的 URL 里要带裁剪参数，
    // 且协议返回的图真的按裁剪框变小了（否则边框还是整张原图，看起来像没裁）
    const fCrop = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const d = ed.getSnapshot().project.scene.find((n) => n.kind === 'mapui' && n.mapui?.decorId);
      if (!d) return { ok: false, reason: '没有地图元素装饰' };
      const id = d.mapui.decorId;
      const img = ed.getSnapshot().project.images.find((i) => i.id === id);
      if (!img) return { ok: false, reason: '装饰图缺失' };
      const rect = {
        x: Math.round(img.width * 0.2),
        y: Math.round(img.height * 0.2),
        w: Math.round(img.width * 0.6),
        h: Math.round(img.height * 0.6),
      };
      ed.updateImage(id, { crop: rect });
      await new Promise((r) => setTimeout(r, 700));
      const el = document.querySelector('[data-mapui-ring]');
      const cs = el ? getComputedStyle(el) : null;
      const src = cs ? (cs.backgroundImage !== 'none' ? cs.backgroundImage : cs.borderImageSource) : '';
      const um = (src || '').match(/url\\("?([^")]+)"?\\)/);
      const q = um ? um[1] : '';
      const im = new Image();
      await new Promise((res) => { im.onload = res; im.onerror = res; if (q) im.src = q; else res(null); });
      const out = { ok: !!q && q.includes('c=') && im.naturalWidth === rect.w, rect, url: q, natural: im.naturalWidth, expect: rect.w };
      return out;
    })()`);
    console.log('[shot] 地图外框裁剪:', JSON.stringify(fCrop));
    // 留一张裁剪生效后的外框特写，人眼确认环确实跟着换了
    try {
      const png = await win.webContents.capturePage();
      await fs.writeFile(path.join(outDir, 'frame-crop.png'), png.toPNG());
    } catch {
      /* 截图失败不影响断言 */
    }
    await win.webContents.executeJavaScript(`(() => {
      const ed = window.__editor;
      const d = ed.getSnapshot().project.scene.find((n) => n.kind === 'mapui' && n.mapui?.decorId);
      if (d) ed.updateImage(d.mapui.decorId, { crop: null });
    })()`);
    await sleep(300);

    // 边框图必须真的有环：读盘上的 PNG，用 data URL 解码数 alpha（data URL 不会污染 canvas）
    try {
      const imgDir = path.join(projectRoot, 'assets', 'images');
      const wanted = String(mini?.decorFile ?? '').split('/').pop() ?? '';
      const list = await fs.readdir(imgDir).catch(() => [] as string[]);
      const pick = list.includes(wanted) ? wanted : (list.find((f) => f.startsWith('mapui_frame_default')) ?? '');
      if (!pick) {
        console.log('[shot] 边框环像素:', JSON.stringify({ loaded: false, reason: '文件缺失', wanted }));
      } else {
        const b64 = (await fs.readFile(path.join(imgDir, pick))).toString('base64');
        const stats = await win.webContents.executeJavaScript(`(async () => {
          const im = new Image();
          await new Promise((res) => { im.onload = res; im.onerror = res; im.src = 'data:image/png;base64,${b64}'; });
          if (!im.naturalWidth) return { loaded: false, w: 0, alpha: 0 };
          const off = document.createElement('canvas');
          off.width = im.naturalWidth;
          off.height = im.naturalHeight;
          const c2 = off.getContext('2d');
          c2.drawImage(im, 0, 0);
          const dd = c2.getImageData(0, 0, off.width, off.height).data;
          let n = 0;
          for (let i = 3; i < dd.length; i += 4) if (dd[i] > 0) n += 1;
          return { loaded: true, file: ${JSON.stringify(pick)}, w: off.width, alpha: +(n / (off.width * off.height)).toFixed(3) };
        })()`);
        console.log('[shot] 边框环像素:', JSON.stringify(stats));
      }
    } catch (e) {
      console.error('[shot] 边框像素检查失败', e);
    }

    await sleep(700);
    const imgMini = await win.webContents.capturePage();
    await fs.writeFile(path.join(outDir, 'minimap.png'), imgMini.toPNG());

    // 边框可见性：拿掉装饰后画面必须变化（否则就是"没有环"）
    const withRing = imgMini.toPNG();
    const removed = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const n = ed.getSnapshot().project.scene.find((x) => x.kind === 'mapui');
      if (!n) return false;
      ed.setMapui(n.id, { decorId: null });
      await new Promise((r) => setTimeout(r, 600));
      return true;
    })()`);
    const withoutRing = (await win.webContents.capturePage()).toPNG();
    const ringVisible = !!removed && !withRing.equals(withoutRing);
    console.log('[shot] 边框可见性:', JSON.stringify({ ringVisible }));
    await fs.writeFile(path.join(outDir, 'mapui-no-ring.png'), withoutRing);
    // 复原：重新确保内置边框
    await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const n = ed.getSnapshot().project.scene.find((x) => x.kind === 'mapui');
      if (!n) return false;
      const id = await ed.ensureMapuiDecor(n.id);
      if (id) ed.setMapui(n.id, { decorId: id, decorLoop: false });
      await new Promise((r) => setTimeout(r, 500));
      return !!id;
    })()`);
  } catch (e) {
    console.error('[shot] 地形特写失败', e);
  }

  // 第八段：贴图选择器的各个使用位置
  try {
    const info = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const ui = window.__editorUi;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      ui.closeWindows();
      ui.setPanels({ left: true, right: true, bottom: true });
      const snap = ed.getSnapshot();
      const g = snap.project.scene.find((n) => n.kind === 'ground');
      if (g) ed.selectScene(g.id);
      await sleep(700);
      return {
        slots: document.querySelectorAll('[data-asset-slot]').length,
        ground: !!g,
      };
    })()`);
    console.log('[shot] 选择器-地面面板:', JSON.stringify(info));
    await sleep(500);
    await fs.writeFile(path.join(outDir, 'picker-ground.png'), (await win.webContents.capturePage()).toPNG());

    // 打开贴图选择器（点第一个贴图槽的缩略图）
    const dlg = await win.webContents.executeJavaScript(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const btn = document.querySelector('[data-asset-slot][data-slot-kind="tex"] [data-slot-thumb]');
      if (btn) btn.click();
      await sleep(600);
      const d = document.querySelector('[data-asset-dialog]');
      return { open: !!d, cards: d ? d.querySelectorAll('button').length : 0 };
    })()`);
    console.log('[shot] 选择器-弹窗:', JSON.stringify(dlg));
    await sleep(500);
    await fs.writeFile(path.join(outDir, 'picker-dialog.png'), (await win.webContents.capturePage()).toPNG());

    // 关掉弹窗，打开动画浮窗看节点贴图槽
    const anim = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const ui = window.__editorUi;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await sleep(300);
      const an = ed.getSnapshot().project.animations[0];
      if (an) ui.openAnimation(an.id);
      await sleep(1200);
      // 选中一个节点，让右侧出现贴图槽
      const row = document.querySelector('[data-part-row]');
      if (row) row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await sleep(700);
      const win2 = [...document.querySelectorAll('[data-asset-slot][data-slot-kind="group"]')].filter((el) => el.offsetParent !== null);
      return { opened: !!an, slots: win2.length };
    })()`);
    console.log('[shot] 选择器-动画节点:', JSON.stringify(anim));
    await sleep(500);
    await fs.writeFile(path.join(outDir, 'picker-anim.png'), (await win.webContents.capturePage()).toPNG());

    // 贴图资产：1 / E / S / W / N 五个图片槽
    const tex = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const ui = window.__editorUi;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      ui.closeWindows();
      await sleep(300);
      const t = ed.getSnapshot().project.textures.find((x) => x.template === 'four') ?? ed.getSnapshot().project.textures[0];
      if (t) ed.select('texture', t.id);
      await sleep(800);
      return { name: t?.name ?? null, slots: document.querySelectorAll('[data-asset-slot][data-slot-kind="tex"]').length };
    })()`);
    console.log('[shot] 选择器-贴图资产:', JSON.stringify(tex));
    await sleep(400);
    await fs.writeFile(path.join(outDir, 'picker-texture.png'), (await win.webContents.capturePage()).toPNG());

    // 地图元素：装饰贴图槽
    const mapui = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const n = ed.getSnapshot().project.scene.find((x) => x.kind === 'mapui');
      if (n) ed.selectScene(n.id);
      await sleep(700);
      return { found: !!n, slots: document.querySelectorAll('[data-asset-slot][data-slot-kind="tex"]').length };
    })()`);
    console.log('[shot] 选择器-地图元素:', JSON.stringify(mapui));
    await sleep(400);
    await fs.writeFile(path.join(outDir, 'picker-mapui.png'), (await win.webContents.capturePage()).toPNG());

    // 地图边框：单张模式（关重复）三种策略 —— 等比 / 拉伸 应各只画一个环，不是拼接出多个
    const frameProbe = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const n = ed.getSnapshot().project.scene.find((x) => x.kind === 'mapui');
      if (!n) return { ok: false, error: 'no mapui' };
      ed.selectScene(n.id);
      await sleep(500);
      const decorId = n.mapui.decorId;
      ed.updateImage(decorId, { tiling: 'default' });
      ed.setMapui(n.id, { decorLoop: false });
      await sleep(700);
      return { ok: true, decorId, loop: ed.getSnapshot().project.scene.find((x) => x.id === n.id).mapui.decorLoop };
    })()`);
    console.log('[shot] 地图边框单张:', JSON.stringify(frameProbe));
    const pngFrameStretch = (await win.webContents.capturePage()).toPNG();
    await fs.writeFile(path.join(outDir, 'mapui-single-stretch.png'), pngFrameStretch);
    await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const n = ed.getSnapshot().project.scene.find((x) => x.kind === 'mapui');
      ed.updateImage(n.mapui.decorId, { tiling: 'aspect' });
      await new Promise((r) => setTimeout(r, 700));
    })()`);
    const pngFrameAspect = (await win.webContents.capturePage()).toPNG();
    await fs.writeFile(path.join(outDir, 'mapui-single-aspect.png'), pngFrameAspect);
    await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const n = ed.getSnapshot().project.scene.find((x) => x.kind === 'mapui');
      ed.updateImage(n.mapui.decorId, { tiling: 'default' });
      ed.setMapui(n.id, { decorLoop: false });
      await new Promise((r) => setTimeout(r, 500));
    })()`);
    console.log('[shot] 地图边框单张视觉:', JSON.stringify({ stretchVsAspect: !pngFrameStretch.equals(pngFrameAspect) }));

    // 贴图属性的单张拉伸策略：拉伸 → 九宫格出现四线编辑器，拖一条线数值变化，再试等比
    const tiling = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const img = ed.getSnapshot().project.images[0];
      if (!img) return { ok: false, error: 'no image' };
      ed.updateImage(img.id, { tiling: 'default' });
      ed.select('image', img.id);
      await sleep(600);
      const btns = [...document.querySelectorAll('button')].filter((b) => ['拉伸', '等比', '九宫格'].includes(b.textContent));
      const btn = (name) => btns.find((b) => b.textContent === name);
      const hasModes = btns.length >= 3;
      // 等编辑器真的出现（最多 3s），一次没出来再点一次，避免渲染抖动让探测假失败
      const waitFor = async (fn, ms = 3000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const v = fn();
          if (v) return v;
          await sleep(100);
        }
        return null;
      };
      btn('九宫格').click();
      let lineEls = await waitFor(() => {
        const n = document.querySelectorAll('[data-nine-line]');
        return n.length === 4 ? n : null;
      }, 3000);
      if (!lineEls) {
        btn('九宫格').click();
        lineEls = await waitFor(() => {
          const n = document.querySelectorAll('[data-nine-line]');
          return n.length === 4 ? n : null;
        }, 3000);
      }
      const nineOn = ed.getSnapshot().project.images.find((i) => i.id === img.id).nine;
      const lines = document.querySelectorAll('[data-nine-line]').length;
      const box = await waitFor(() => document.querySelector('[data-nine-editor]'), 2000);
      let dragged = false;
      let draggedR = false;
      let draggedB = false;
      let dragDebug = null;
      if (box) {
        const r = box.getBoundingClientRect();
        const dragLine = async (edge, fx, fy, expect) => {
          const line = document.querySelector('[data-nine-line="' + edge + '"]');
          const lr = line.getBoundingClientRect();
          line.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: lr.x, clientY: lr.y }));
          window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width * fx, clientY: r.top + r.height * fy }));
          window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
          await sleep(250);
          const nine = ed.getSnapshot().project.images.find((i) => i.id === img.id).nine;
          return { hit: Math.abs(nine[edge] - expect) < 0.02, got: nine[edge], expect };
        };
        const dL = await dragLine('l', 0.35, 0.5, 0.35);
        const dR = await dragLine('r', 0.65, 0.5, 0.35); // 右线拖到 65% → r = 1 - 0.65
        const dB = await dragLine('b', 0.5, 0.65, 0.35); // 下线拖到 65% → b = 1 - 0.65
        dragged = dL.hit;
        draggedR = dR.hit;
        draggedB = dB.hit;
        dragDebug = { l: dL, r: dR, b: dB };
      }
      btn('等比').click();
      await sleep(300);
      const aspectSet = ed.getSnapshot().project.images.find((i) => i.id === img.id).tiling === 'aspect';
      btn('拉伸').click();
      await sleep(200);
      return { ok: hasModes && lines === 4 && dragged && draggedR && draggedB && aspectSet, hasModes, lines, nineOn, imgName: img.name, dragged, draggedR, draggedB, dragDebug, aspectSet };
    })()`);
    console.log('[shot] 贴图平铺策略:', JSON.stringify(tiling));
    await sleep(400);
    await fs.writeFile(path.join(outDir, 'image-tiling.png'), (await win.webContents.capturePage()).toPNG());

    // 裁剪 → 应用到图片：走真实 UI（属性面板「裁剪…」→ 改四个数值 → 点「应用到图片」），
    // 断言图片尺寸真的变了、文件换名了、裁剪设置清空、按钮文案没有括号
    const bake = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const img = ed.getSnapshot().project.images.find((i) => i.width > 40 && i.height > 40 && !i.crop);
      if (!img) return { ok: false, error: 'no image' };
      ed.select('image', img.id);
      await sleep(700);
      const cropBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '裁剪…');
      if (!cropBtn) return { ok: false, error: 'no crop button' };
      cropBtn.click();
      await sleep(600);
      const nums = [...document.querySelectorAll('input[type="number"]')];
      if (nums.length < 4) return { ok: false, error: 'no fields', n: nums.length };
      const setVal = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setVal(nums[0], 4);
      setVal(nums[1], 6);
      setVal(nums[2], 20);
      setVal(nums[3], 30);
      await sleep(300);
      const bakeBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('应用到图片'));
      if (!bakeBtn) return { ok: false, error: 'no bake button' };
      const label = bakeBtn.textContent.trim();
      const labelClean = !/[（(]/.test(label);
      const before = ed.getSnapshot().project.images.find((i) => i.id === img.id);
      bakeBtn.click();
      await sleep(1200);
      const after = ed.getSnapshot().project.images.find((i) => i.id === img.id);
      return {
        ok: after.width === 20 && after.height === 30 && after.file !== before.file && after.crop === null && labelClean,
        label,
        labelClean,
        beforeSize: before.width + 'x' + before.height,
        afterSize: after.width + 'x' + after.height,
        fileChanged: after.file !== before.file,
        afterFile: after.file,
        cropCleared: after.crop === null,
        dialogClosed: !document.body.textContent.includes('重置为整图'),
      };
    })()`);
    console.log('[shot] 裁剪应用到图片:', JSON.stringify(bake));
    if (bake?.afterFile) {
      const abs = path.join(projectRoot, String(bake.afterFile).split('/').join(path.sep));
      const exists = await fs.readFile(abs).then(() => true).catch(() => false);
      console.log('[shot] 裁剪结果文件:', JSON.stringify({ file: bake.afterFile, exists }));
    }

    // 拖拽赋值：合成 DataTransfer 模拟 drop —— 贴图拖到贴图槽生效；图组引用拖到贴图槽不生效
    const dnd = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const g = ed.getSnapshot().project.scene.find((n) => n.kind === 'ground' && n.ground && n.ground.map);
      if (!g) return { ok: false, error: 'no ground' };
      ed.selectScene(g.id);
      await sleep(600);
      const img = ed.getSnapshot().project.images.find((i) => !i.file.includes('mapui_frame_default'));
      const slot = document.querySelector('[data-asset-slot][data-slot-kind="tex"]');
      if (!slot || !img) return { ok: false, error: 'no slot/image' };
      const fire = (type, data) => {
        const dt = new DataTransfer();
        for (const [k, v] of Object.entries(data)) dt.setData(k, v);
        slot.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
        return dt;
      };
      // 合成 DragEvent 在无真实拖拽会话时 dispatchEvent 恒返回"已取消"，无法用返回值判断；
      // 改看真实行为：匹配时槽位高亮（边框变色），drop 后值被赋上
      const border0 = getComputedStyle(slot).borderTopColor;
      // ① 贴图种类拖到贴图槽：应高亮，drop 后地皮应引用这张图
      fire('dragover', { 'text/plain': 'image:' + img.id, 'application/x-light-asset-image': '1' });
      await sleep(80);
      const texHighlight = getComputedStyle(slot).borderTopColor !== border0;
      fire('drop', { 'text/plain': 'image:' + img.id, 'application/x-light-asset-image': '1' });
      await sleep(400);
      const types = ed.getSnapshot().project.scene.find((n) => n.id === g.id).ground.types;
      const applied = Object.values(types).some((t) => t.textureId === img.id);
      // ② 图组种类拖到贴图槽：不应高亮，drop 后也不应有地皮引用这个图组
      const tex = ed.getSnapshot().project.textures[0];
      fire('dragover', { 'text/plain': 'texture:' + tex.id, 'application/x-light-asset-texture': '1' });
      await sleep(80);
      const texNoHighlight = getComputedStyle(slot).borderTopColor === border0;
      fire('drop', { 'text/plain': 'texture:' + tex.id, 'application/x-light-asset-texture': '1' });
      await sleep(400);
      const types2 = ed.getSnapshot().project.scene.find((n) => n.id === g.id).ground.types;
      const rejected = !Object.values(types2).some((t) => t.textureId === tex.id);
      return { ok: texHighlight && applied && texNoHighlight && rejected, texHighlight, applied, texNoHighlight, rejected };
    })()`);
    console.log('[shot] 拖拽赋值:', JSON.stringify(dnd));

    // 循环开关与平面拉伸策略：UI 点击循环开关 → store 变化 → 画面变化；不循环时拉伸策略生效
    const loopProbe = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const g = ed.getSnapshot().project.scene.find((n) => n.kind === 'ground' && n.ground && n.ground.map);
      if (!g) return { ok: false, error: 'no ground' };
      ed.selectScene(g.id);
      await sleep(600);
      const img = ed.getSnapshot().project.images.find((i) => !i.file.includes('mapui_frame_default'));
      if (!img) return { ok: false, error: 'no image' };
      // 草地配贴图 + 循环
      ed.setGroundType(g.id, 'grass', { textureId: img.id, color: null, loop: true });
      await sleep(500);
      const read = () => ed.getSnapshot().project.scene.find((n) => n.id === g.id).ground.types.grass;
      const before = read().loop;
      const cb = document.querySelector('[data-loop-toggle]');
      if (!cb) return { ok: false, error: 'no toggle' };
      cb.click();
      await sleep(400);
      const after = read().loop;
      return { ok: before === true && after === false, before, after };
    })()`);
    console.log('[shot] 循环开关:', JSON.stringify(loopProbe));
    await sleep(300);
    // 视觉验证：把循环状态恢复为 true 再截基帧 —— loopProbe 结束时开关是关的
    await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const g = ed.getSnapshot().project.scene.find((n) => n.kind === 'ground' && n.ground && n.ground.map);
      const img = ed.getSnapshot().project.images.find((i) => !i.file.includes('mapui_frame_default'));
      ed.updateImage(img.id, { tiling: 'default', nine: null });
      ed.setGroundType(g.id, 'grass', { textureId: img.id, color: null, loop: true });
      await new Promise((r) => setTimeout(r, 800));
    })()`);
    const pngLoop = (await win.webContents.capturePage()).toPNG();
    // 不循环（默认策略：直接铺满）
    await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const g = ed.getSnapshot().project.scene.find((n) => n.kind === 'ground' && n.ground && n.ground.map);
      const img = ed.getSnapshot().project.images.find((i) => !i.file.includes('mapui_frame_default'));
      ed.setGroundType(g.id, 'grass', { textureId: img.id, color: null, loop: false });
      await new Promise((r) => setTimeout(r, 900));
    })()`);
    const pngPlane = (await win.webContents.capturePage()).toPNG();
    // 单张 + 等比
    await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const img = ed.getSnapshot().project.images.find((i) => !i.file.includes('mapui_frame_default'));
      ed.updateImage(img.id, { tiling: 'aspect' });
      await new Promise((r) => setTimeout(r, 900));
    })()`);
    const pngPlaneAspect = (await win.webContents.capturePage()).toPNG();
    // 不循环 + 九宫格
    await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const img = ed.getSnapshot().project.images.find((i) => !i.file.includes('mapui_frame_default'));
      ed.updateImage(img.id, { tiling: 'nine', nine: { l: 0.25, t: 0.25, r: 0.25, b: 0.25 } });
      await new Promise((r) => setTimeout(r, 900));
    })()`);
    const pngPlaneNine = (await win.webContents.capturePage()).toPNG();
    // 恢复默认
    await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const g = ed.getSnapshot().project.scene.find((n) => n.kind === 'ground' && n.ground && n.ground.map);
      const img = ed.getSnapshot().project.images.find((i) => !i.file.includes('mapui_frame_default'));
      ed.updateImage(img.id, { tiling: 'default', nine: null });
      ed.setGroundType(g.id, 'grass', { textureId: img.id, color: null, loop: true });
      await new Promise((r) => setTimeout(r, 500));
    })()`);
    const loopVisual = !pngPlane.equals(pngLoop);
    const planeAspectVisual = !pngPlaneAspect.equals(pngPlane);
    const planeNineVisual = !pngPlaneNine.equals(pngPlane);
    console.log('[shot] 循环与平面策略视觉:', JSON.stringify({ loopVisual, planeAspectVisual, planeNineVisual }));
    await fs.writeFile(path.join(outDir, 'loop-plane.png'), pngPlane);
    await fs.writeFile(path.join(outDir, 'loop-plane-aspect.png'), pngPlaneAspect);
  } catch (e) {
    console.error('[shot] 选择器截图失败', e);
  }

  // 第八段半：边界中间贴图列表（新增 / 配贴图 / 截图 / 删除 / 归一化）
  try {
    const edges = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const g = ed.getSnapshot().project.scene.find((n) => n.kind === 'ground' && n.ground && n.ground.map);
      if (!g) return { ok: false, error: 'no ground' };
      ed.selectScene(g.id);
      await sleep(400);
      const before = ed.getSnapshot().project.scene.find((n) => n.id === g.id).ground.edges.length;
      const id = ed.addGroundEdge(g.id, 'grass', 'forest');
      const dup = ed.addGroundEdge(g.id, 'forest', 'grass'); // 同一组合，应被拒
      const same = ed.addGroundEdge(g.id, 'snow', 'snow');   // 同种地皮，应被拒
      const tex = ed.getSnapshot().project.images[0];
      if (id && tex) ed.setGroundEdge(g.id, id, { textureId: tex.id });
      await sleep(400);
      const cfg = ed.getSnapshot().project.scene.find((n) => n.id === g.id).ground;
      const after = cfg.edges.map((e) => e.a + '>' + e.b + ':' + (e.textureId ? 'tex' : 'none'));
      const rows = document.querySelectorAll('[data-ground-edge]').length;
      // 把参数面板滚到边界贴图区，截图留档
      const sec = document.querySelector('[data-ground-edge]');
      if (sec) sec.scrollIntoView({ block: 'center' });
      await sleep(400);
      return {
        ok: after.length === 1 && after[0].endsWith(':tex') && rows === 1,
        before,
        added: !!id,
        duplicateRejected: dup === null,
        sameTypeRejected: same === null,
        after,
        rows,
        edgeId: id,
      };
    })()`);
    console.log('[shot] 边界中间贴图:', JSON.stringify(edges));
    await sleep(500);
    await fs.writeFile(path.join(outDir, 'ground-edges.png'), (await win.webContents.capturePage()).toPNG());
    // 撤掉测试数据，别让它留在截图里
    await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const g = ed.getSnapshot().project.scene.find((n) => n.kind === 'ground' && n.ground);
      if (g && ${JSON.stringify((edges as { edgeId?: string | null }).edgeId)}) ed.removeGroundEdge(g.id, ${JSON.stringify((edges as { edgeId?: string | null }).edgeId)});
      return true;
    })()`);
    await sleep(400);
  } catch (e) {
    console.error('[shot] 边界贴图探测失败', e);
  }

  // 第八段又半：渲染代数 —— 改种子参数地面不动；重新生成后 3D 地面必须真的重建
  try {
    const regen = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const g = ed.getSnapshot().project.scene.find((n) => n.kind === 'ground' && n.ground && n.ground.map);
      if (!g) return { ok: false, error: 'no ground with map' };
      const gen0 = g.ground.gen ?? 0;
      const map0 = g.ground.map;
      // 1) 只改种子参数：gen 与地图都不该变（渲染层不该重建）
      ed.setGround(g.id, { seed: (g.ground.seed + 1) % 99999999 });
      await sleep(400);
      const afterSeed = ed.getSnapshot().project.scene.find((n) => n.id === g.id).ground;
      // 2) 重新生成：gen +1，地图内容必须真的变了
      ed.regenerateGround(g.id);
      await sleep(900);
      const afterRegen = ed.getSnapshot().project.scene.find((n) => n.id === g.id).ground;
      let diffCells = -1;
      if (afterRegen.map.length === map0.length) {
        diffCells = 0;
        for (let i = 0; i < map0.length; i++) if (map0[i] !== afterRegen.map[i]) diffCells += 1;
      }
      return {
        ok: (afterSeed.gen ?? 0) === gen0 && afterSeed.map === map0 && (afterRegen.gen ?? 0) === gen0 + 1 && diffCells > 0,
        gen0,
        seedChangedGen: afterSeed.gen ?? 0,
        regenGen: afterRegen.gen ?? 0,
        diffCells,
      };
    })()`);
    console.log('[shot] 渲染代数:', JSON.stringify(regen));
    await sleep(400);
  } catch (e) {
    console.error('[shot] 渲染代数探测失败', e);
  }

  // 第九段（最后一张）：在场景里真实点一下地面 —— 右侧应出现这块地面的生成参数
  try {
    const click = await win.webContents.executeJavaScript(`(async () => {
      const ed = window.__editor;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const g = ed.getSnapshot().project.scene.find((n) => n.kind === 'ground' && n.ground && n.ground.map);
      if (!g) return { ok: false, error: 'no ground with map' };
      ed.selectScene(null);
      await sleep(400);
      // 地面标记（token）锚在这块地面的位置上，借它换算屏幕坐标
      const token = [...document.querySelectorAll('[data-scene-token]')].find((el) => (el.title || '').startsWith('地面 ·'));
      const canvas = document.querySelector('[data-scene-host] canvas');
      if (!token || !canvas) return { ok: false, error: 'no token or canvas' };
      const r = token.getBoundingClientRect();
      const opts = {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        button: 0,
        clientX: r.left + r.width / 2,
        clientY: Math.max(0, r.bottom - 2),
      };
      canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
      canvas.dispatchEvent(new PointerEvent('pointerup', opts));
      await sleep(800);
      const s = ed.getSnapshot();
      return {
        ok: s.sceneSelection === g.id,
        selected: s.sceneSelection,
        panel: !!document.querySelector('[data-ground-panel]'),
      };
    })()`);
    console.log('[shot] 点击地面选中:', JSON.stringify(click));
    await sleep(600);
    await fs.writeFile(path.join(outDir, 'ground-click.png'), (await win.webContents.capturePage()).toPNG());

    // 非破坏性裁剪必须影响渲染：判据不是"截图变了"（光照/提示文字都会变），
    // 而是把裁剪框缩到 1×1 —— 真吃到 crop 的话，这块区域的像素会退化成单一颜色。
    const sampleColors = (png: Buffer, region: { x: number; y: number; width: number; height: number }) => {
      // electron 类型里 getBitmap 标注为 void，实际返回 Buffer
      const bmp = nativeImage.createFromBuffer(png).getBitmap() as unknown as Buffer;
      const seen = new Set<number>();
      for (let i = 0; i + 3 < bmp.length; i += 4) {
        seen.add(((bmp[i] << 16) | (bmp[i + 1] << 8) | bmp[i + 2]) >>> 0);
      }
      return { region, colors: seen.size };
    };

    try {
      const spot = await win.webContents.executeJavaScript(`(() => {
        const host = document.querySelector('[data-scene-host]');
        const r = host ? host.getBoundingClientRect() : null;
        if (!r) return null;
        const cx = Math.round(r.left + r.width / 2);
        const cy = Math.round(r.top + r.height * 0.55);
        return { x: Math.max(0, cx - 70), y: Math.max(0, cy - 70), width: 140, height: 140 };
      })()`);
      if (spot) {
        const before = sampleColors((await win.webContents.capturePage(spot)).toPNG(), spot);
        const hit = await win.webContents.executeJavaScript(`(async () => {
          const p = window.__editor.getSnapshot().project;
          const g = p.scene.find((n) => n.kind === 'ground' && n.ground && Object.values(n.ground.types || {}).some((t) => t && t.textureId));
          if (!g) return null;
          const t = Object.values(g.ground.types).find((x) => x && x.textureId);
          const direct = p.images.find((i) => i.id === t.textureId);
          let img = direct ?? null;
          if (!img) {
            const tex = p.textures.find((x) => x.id === t.textureId);
            const id = tex ? (tex.template === 'single' ? tex.image : (tex.dirs.S || tex.dirs.E || tex.dirs.N || tex.dirs.W)) : null;
            img = p.images.find((i) => i.id === id) ?? null;
          }
          if (!img) return null;
          window.__editor.updateImage(img.id, { crop: { x: 0, y: 0, w: 1, h: 1 } });
          await new Promise((r) => setTimeout(r, 1000));
          return { id: img.id, name: img.name };
        })()`);
        let shotG: Buffer | null = null;
        const after = hit ? (shotG = (await win.webContents.capturePage(spot)).toPNG(), sampleColors(shotG, spot)) : null;
        if (hit) {
          await win.webContents.executeJavaScript(`window.__editor.updateImage(${JSON.stringify(hit.id)}, { crop: null })`);
          await sleep(400);
        }
        if (shotG) await fs.writeFile(path.join(outDir, 'ground-crop.png'), shotG);
        // 采样区里还有网格线 / 道具 / 文字，不可能退化到纯色；颜色数大幅下降即可
        const ok = !!after && after.colors <= before.colors * 0.5;
        console.log(
          '[shot] 裁剪影响·地面:',
          JSON.stringify({ img: hit?.name ?? null, before: before.colors, after: after?.colors ?? null, ok }),
        );
      }
    } catch (e) {
      console.error('[shot] 裁剪影响探测失败', e);
    }

    // 动画部件（图组里的图）：同样用 1×1 裁剪，部件会退化成纯色，画面颜色数应明显下降
    try {
      const opened = await win.webContents.executeJavaScript(`(async () => {
        const p = window.__editor.getSnapshot().project;
        const anim = p.animations[0];
        if (!anim) return null;
        window.__editorUi.openAnimation(anim.id);
        await new Promise((r) => setTimeout(r, 1200));
        const host = document.querySelector('[data-anim-host]');
        if (!host) return null;
        const r = host.getBoundingClientRect();
        // 裁剪动画用到的所有图，避免"裁的图和可见部件对不上"的歧义
        const ids = [];
        for (const n of anim.nodes) {
          const tex = p.textures.find((t) => t.id === n.textureId);
          const id = tex ? (tex.template === 'single' ? tex.image : (tex.dirs.S || tex.dirs.E || tex.dirs.N || tex.dirs.W)) : null;
          if (id && !ids.includes(id)) ids.push(id);
          if (n.overlay && n.overlay.textureId) {
            const ot = p.textures.find((t) => t.id === n.overlay.textureId);
            const oid = ot ? (ot.template === 'single' ? ot.image : (ot.dirs.S || ot.dirs.E || ot.dirs.N || ot.dirs.W)) : null;
            if (oid && !ids.includes(oid)) ids.push(oid);
          }
        }
        return {
          region: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
          ids,
          count: ids.length,
        };
      })()`);
      if (opened?.count) {
        const region = opened.region;
        const before = sampleColors((await win.webContents.capturePage(region)).toPNG(), region);
        await win.webContents.executeJavaScript(`(async () => {
          const ids = ${JSON.stringify(opened.ids)};
          for (const id of ids) window.__editor.updateImage(id, { crop: { x: 0, y: 0, w: 1, h: 1 } });
          await new Promise((r) => setTimeout(r, 1200));
        })()`);
        const shot = (await win.webContents.capturePage(region)).toPNG();
        await fs.writeFile(path.join(outDir, 'anim-crop.png'), shot);
        const after = sampleColors(shot, region);
        await win.webContents.executeJavaScript(`(async () => {
          const ids = ${JSON.stringify(opened.ids)};
          for (const id of ids) window.__editor.updateImage(id, { crop: null });
          await new Promise((r) => setTimeout(r, 500));
        })()`);
        console.log(
          '[shot] 裁剪影响·动画:',
          JSON.stringify({ parts: opened.count, before: before.colors, after: after.colors, ok: after.colors <= before.colors * 0.6 }),
        );
      }
    } catch (e) {
      console.error('[shot] 动画裁剪影响探测失败', e);
    }
  } catch (e) {
    console.error('[shot] 点击地面截图失败', e);
  }

  // 状态机：默认状态机在、流程图能渲染、角色挂上了数值与状态机
  try {
    await win.webContents
      .executeJavaScript('1+1')
      .then((v) => console.log('[shot] 渲染进程存活:', v, 'crashed:', win.webContents.isCrashed()))
      .catch((e) => console.log('[shot] 渲染进程失联:', String(e), 'crashed:', win.webContents.isCrashed()));
    const smProbe = await win.webContents.executeJavaScript(`(async () => {
      try {
      const ed = window.__editor;
      const p = ed.getSnapshot().project;
      const sm = p.stateMachines[0];
      if (!sm) return { ok: false, reason: '没有状态机' };
      window.__editorUi.openStateMachine(sm.id);
      // 连线要等节点量尺寸后才画出来，轮询到有为止（最多 4s）
      let edges = 0;
      let waited = 0;
      while (waited < 4000) {
        await new Promise((r) => setTimeout(r, 250));
        waited += 250;
        edges = document.querySelectorAll('.react-flow__edge').length;
        if (edges > 0) break;
      }
      // 诊断：连线没画出来时，触发一次 store 更新（重渲染）看能不能救回来
      let healed = false;
      if (edges === 0) {
        const sm0 = window.__editor.getSnapshot().project.stateMachines[0];
        window.__editor.updateStateMachine(sm0.id, {});
        await new Promise((r) => setTimeout(r, 600));
        healed = document.querySelectorAll('.react-flow__edge').length > 0;
      }
      // 仍救不回（偶发：react-flow 节点测量卡死）→ 关窗重开浮窗再轮询一轮
      if (edges === 0 && !healed) {
        window.__editorUi.closeWindows();
        await new Promise((r) => setTimeout(r, 400));
        window.__editorUi.openStateMachine(sm.id);
        while (waited < 10000) {
          await new Promise((r) => setTimeout(r, 250));
          waited += 250;
          edges = document.querySelectorAll('.react-flow__edge').length;
          if (edges > 0) { healed = true; break; }
        }
      }
      const nodes = document.querySelectorAll('[data-sm-state]').length;
      // 纵向错落：两个状态若在同一水平线上，正反两条贝塞尔会完全重合
      const ys = sm.states.map((st) => st.y);
      const ySpread = Math.max.apply(null, ys) - Math.min.apply(null, ys);
      const ds = Array.prototype.map.call(document.querySelectorAll('.react-flow__edge path'), (p) => p.getAttribute('d') || '');
      const distinctPaths = Array.from(new Set(ds)).length;
      const diag = { healed,
        rf: document.querySelectorAll('.react-flow').length,
        nodes: document.querySelectorAll('.react-flow__node').length,
        edgeSvg: document.querySelectorAll('.react-flow__edges').length,
        paths: document.querySelectorAll('.react-flow__edges path').length,
        html: (document.querySelector('.react-flow__edges')?.innerHTML ?? '').slice(0, 240),
        box: (() => { const el = document.querySelector('[data-anim-host], .react-flow'); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
        rf: (() => {
          const inst = window.__rfInst;
          if (!inst) return { inst: false };
          const nodes = inst.getNodes();
          const edges = inst.getEdges();
          return {
            inst: true,
            n: nodes.length,
            e: edges.length,
            measured: nodes.map((nd) => [nd.measured ? nd.measured.width : null, nd.measured ? nd.measured.height : null]),
            handles: document.querySelectorAll('.react-flow__handle').length,
            eSample: edges.slice(0, 2).map((ed) => [ed.source, ed.target]),
          };
        })(),
      };
      // 角色：新建一个，检查默认数值字段与状态机绑定（需求里的 blood/satiation/mental/speed/attack/name）
      const cid = ed.addSceneNode('character', '测试角色');
      await new Promise((r) => setTimeout(r, 400));
      const ch = ed.getSnapshot().project.scene.find((n) => n.id === cid);
      // 点连线 → 右侧应出现条件行（设备 / 键 / 动作三个下拉）与「＋ 添加条件」
      const edgeEl = document.querySelector('.react-flow__edge');
      if (edgeEl) {
        edgeEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 400));
      }
      const condRows = document.querySelectorAll('[data-cond-row]').length;
      // 条件行现在是「变量 + 运算符 + 标准值」：变量下拉里一定有「选变量」占位项
      const condPanel = [...document.querySelectorAll('select')].some((el) => (el.textContent ?? '').includes('选变量'));
      const addCondBtn = [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('添加条件'));
      const okChar = !!ch?.character && ch.character.blood === 100 && ch.character.stateMachineId === sm.id;

      // 控制器：变量表 + 按键事件 + 角色绑定
      const ctrl = p.controllers[0];
      const ctrlInfo = ctrl
        ? {
            vars: ctrl.vars.length,
            bindings: ctrl.bindings.length,
            hasMoving: ctrl.vars.some((v) => v.name === 'moving'),
            bound: (ch?.character?.controllerIds ?? []).includes(ctrl.id),
            smUses: sm.controllerId === ctrl.id,
          }
        : null;

      // 脚本（W3）：组件脚本 = 属性面板里的区块（和系统组件同款）；老钩子脚本走脚本槽。
      // 播放段用钩子脚本验证 onStart 日志与脚本位移
      let script = null;
      try {
        const chNode = window.__editor.getSnapshot().project.scene.find((n) => n.kind === 'character');
        window.__editor.selectScene(chNode.id);
        await new Promise((r) => setTimeout(r, 300));

        // ① 点「＋ 添加脚本」→ 新建组件脚本并挂到当前对象；属性面板出现同款区块（可编辑、非系统）
        const addBtn = document.querySelector('[data-add-node-script]');
        if (addBtn) addBtn.click();
        await new Promise((r) => setTimeout(r, 700));
        const p2 = window.__editor.getSnapshot().project;
        const cur = p2.scene.find((n) => n.id === chNode.id);
        const userCompId = (cur.componentIds ?? []).find((id) => {
          const s = p2.scripts.find((x) => x.id === id);
          return !!s && !s.preset;
        });
        const userBlock = userCompId ? document.querySelector('[data-component="' + userCompId + '"]') : null;
        const compBlock = !!userBlock && (userBlock.textContent || '').indexOf('我的组件') >= 0;

        const dtOf = (sid) => {
          const dt = new DataTransfer();
          dt.setData('text/plain', 'script:' + sid);
          dt.setData('application/x-light-asset-script', '1');
          return dt;
        };

        // ② 组件脚本拖到视口里的对象标记上 → 进组件列表（渲染成组件区块），不进脚本槽
        let tokenDrop = false;
        const gid = window.__editor.addSceneNode('enemy', '拖拽靶子');
        await new Promise((r) => setTimeout(r, 400));
        const token = [...document.querySelectorAll('[data-scene-token]')].find((el) => (el.title || '').indexOf('拖拽靶子') >= 0);
        if (token && userCompId) {
          token.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dtOf(userCompId) }));
          token.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dtOf(userCompId) }));
          await new Promise((r) => setTimeout(r, 350));
          const cur2 = window.__editor.getSnapshot().project.scene.find((n) => n.id === gid);
          tokenDrop = (cur2.componentIds ?? []).includes(userCompId) && !(cur2.scriptIds ?? []).includes(userCompId);
        }

        // ③ 老钩子脚本：仍挂到 scriptIds，属性面板显示为脚本槽
        const hookId = window.__editor.addScript(
          undefined,
          "function onStart(self, Light){ Light.log('脚本已启动', self.name); } function onUpdate(self, Light, dt){ self.x += dt * 3; }",
          { kind: 'hook', select: false },
        );
        window.__editor.setNodeScripts(chNode.id, [hookId]);
        window.__editor.selectScene(chNode.id); // ② 里拖拽时选中项变成了靶子对象，这里选回角色
        await new Promise((r) => setTimeout(r, 400));
        const hookSlot = !!document.querySelector('[data-node-script]');

        script = { created: true, compBlock, hookSlot, tokenDrop };
      } catch (e) {
        script = { err: String(e) };
      }

      // 运行时：点 ▶ 开播 → 按 W 应切到「行走」并向前挪 → 松手回「待机」→ 停播
      const press = (type, code) =>
        window.dispatchEvent(new KeyboardEvent(type, { code: code, bubbles: true, cancelable: true }));
      let play = null;
      try {
        const playBtn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '▶');
        if (playBtn) {
          playBtn.click();
          await new Promise((r) => setTimeout(r, 400));
          const hudText = () => {
            const el = document.querySelector('[data-play-hud]');
            return el ? el.textContent || '' : '';
          };
          const hud0 = hudText();
          press('keydown', 'KeyW');
          await new Promise((r) => setTimeout(r, 900));
          const hud1 = hudText();
          const parts = document.querySelectorAll('[data-char-sprite] [data-char-part]').length;
          const moved = (() => {
            const m = /\\(([-\\d.]+),\\s*([-\\d.]+)\\)/.exec(hud1);
            const m0 = /\\(([-\\d.]+),\\s*([-\\d.]+)\\)/.exec(hud0);
            if (!m || !m0) return null;
            return Math.abs(Number(m[2]) - Number(m0[2])) > 0.5 || Math.abs(Number(m[1]) - Number(m0[1])) > 0.5;
          })();
          press('keyup', 'KeyW');
          await new Promise((r) => setTimeout(r, 500));
          const hud2 = hudText();
          // 脚本日志要在播放中读取：停播后 HUD 卸载，data-script-log 会消失
          const scriptLogEl = document.querySelector('[data-script-log]');
          const scriptLog = scriptLogEl ? scriptLogEl.textContent || '' : '';
          const stopBtn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') || '').indexOf('停止') >= 0);
          if (stopBtn) stopBtn.click();
          await new Promise((r) => setTimeout(r, 250));
          play = {
            hud0,
            hud1,
            hud2,
            parts,
            moved,
            walked: hud1.indexOf('行走') >= 0,
            idleBack: hud2.indexOf('待机') >= 0,
            scriptLog,
          };
        }
      } catch (e) {
        play = { err: String(e) };
      }
      const okPlay = !!play && play.parts > 0 && play.walked === true && play.idleBack === true;
      const okScript =
        !!script &&
        script.created === true &&
        script.compBlock === true &&
        script.hookSlot === true &&
        script.tokenDrop === true &&
        !!play &&
        typeof play.scriptLog === 'string' &&
        play.scriptLog.indexOf('脚本已启动') >= 0;

      return {
        ok:
          nodes >= 2 &&
          edges >= 1 &&
          okChar &&
          condPanel &&
          condRows >= 1 &&
          addCondBtn &&
          ySpread >= 40 &&
          distinctPaths >= 2 &&
          !!ctrlInfo &&
          ctrlInfo.vars >= 3 &&
          ctrlInfo.bindings >= 16 &&
          okPlay &&
          okScript,
        states: sm.states.length,
        transitions: sm.transitions.length,
        nodes,
        edges,
        ySpread,
        distinctPaths,
        walkState: sm.states.some((st) => st.move === 'forward'),
        animBound: sm.states.every((st) => !!st.animationId) || sm.states.some((st) => !!st.animationId),
        character: ch
          ? {
              blood: ch.character?.blood,
              satiation: ch.character?.satiation,
              mental: ch.character?.mental,
              speed: ch.character?.speed,
              attack: ch.character?.attack,
              name: ch.character?.name,
              sm: ch.character?.stateMachineId === sm.id,
              anim: !!ch.character?.animationId,
              ctrls: ch.character?.controllerIds?.length,
            }
          : null,
        ctrlInfo,
        script,
        play,
        condPanel,
        condRows,
        addCondBtn,
        waited,
        diag,
      };
      } catch (err) {
        return { ok: false, err: String(err && err.stack ? err.stack : err) };
      }
    })()`);
    console.log('[shot] 状态机流程图:', JSON.stringify(smProbe));
    await fs.writeFile(path.join(outDir, 'statemachine.png'), (await win.webContents.capturePage()).toPNG());

    // 运行时截图：关掉浮窗 → 开播 → 按 D 向右走 → 截一张游戏画面
    try {
      await win.webContents.executeJavaScript(`(async () => {
        window.__editorUi.closeWindows();
        await new Promise((r) => setTimeout(r, 200));
        const playBtn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '▶');
        if (playBtn) playBtn.click();
        await new Promise((r) => setTimeout(r, 600));
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 700));
        return true;
      })()`);
      await fs.writeFile(path.join(outDir, 'play.png'), (await win.webContents.capturePage()).toPNG());
      const spriteDiag = await win.webContents.executeJavaScript(`(async () => {
        const wrap = document.querySelector('[data-char-wrap]');
        const sprite = document.querySelector('[data-char-sprite]');
        const img = sprite ? sprite.querySelector('img') : null;
        const part = sprite ? sprite.querySelector('[data-char-part]') : null;
        const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
        return {
          wrapRect: r(wrap),
          wrapTransform: wrap ? wrap.style.transform : null,
          spriteChildren: sprite ? sprite.querySelectorAll('[data-char-part]').length : 0,
          firstPartRect: r(part),
          firstPartTransform: part ? part.style.transform : null,
          img: img ? { src: img.src.slice(0, 80), complete: img.complete, natW: img.naturalWidth, rect: r(img), h: img.style.height } : null,
          z: sprite ? getComputedStyle(sprite).zIndex : null,
          wrapDisplay: wrap ? getComputedStyle(wrap).display : null,
        };
      })()`);
      console.log('[shot] 角色精灵诊断:', JSON.stringify(spriteDiag));
      await win.webContents.executeJavaScript(`(async () => {
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', bubbles: true, cancelable: true }));
        const stop = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') || '').indexOf('停止') >= 0);
        if (stop) stop.click();
        await new Promise((r) => setTimeout(r, 300));
        return true;
      })()`);
      console.log('[shot] 运行时截图:', path.join(outDir, 'play.png'));

      // 脚本槽位截图：最新对象已挂脚本，再点一次「＋ 添加脚本」让空槽出来
      await win.webContents.executeJavaScript(`(async () => {
        const p = window.__editor.getSnapshot().project;
        const target = p.scene.find((n) => (n.scriptIds ?? []).length > 0) || p.scene.find((n) => n.kind === 'character');
        if (target) window.__editor.selectScene(target.id);
        await new Promise((r) => setTimeout(r, 300));
        const b = document.querySelector('[data-add-node-script]');
        if (b) b.click();
        await new Promise((r) => setTimeout(r, 300));
        const zone = document.querySelector('[data-node-script-zone]');
        if (zone) zone.scrollIntoView({ block: 'start' });
        await new Promise((r) => setTimeout(r, 300));
        return true;
      })()`);
      await fs.writeFile(path.join(outDir, 'script-slot.png'), (await win.webContents.capturePage()).toPNG());
      console.log('[shot] 脚本槽位截图:', path.join(outDir, 'script-slot.png'));

      // 控制器编辑器截图：变量表 + 按键事件表
      await win.webContents.executeJavaScript(`(async () => {
        const p = window.__editor.getSnapshot().project;
        window.__editorUi.openController(p.controllers[0].id);
        await new Promise((r) => setTimeout(r, 400));
        return true;
      })()`);
      await fs.writeFile(path.join(outDir, 'controller.png'), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript('window.__editorUi.closeWindows()');
    } catch (e) {
      console.error('[shot] 运行时截图失败', e);
    }

    // 人工复现模式（--live）：连线真没画出来就停在现场，不退出、不再碰界面
    const prob = smProbe as { ok?: boolean; edges?: number };
    if (opts.holdOnBroken && prob && prob.edges === 0) {
      console.log('[live] REPRO: 连线未渲染，界面保持原样，请人工查看（关闭窗口即结束）');
      await new Promise<void>(() => undefined);
    }
  } catch (e) {
    console.error('[shot] 状态机探测失败', e);
  }

  // 再截一张：只留动画浮窗（关掉底部面板，验证浮窗独立布局）
  console.log('\n========== shot result ==========');
  console.log(
    JSON.stringify(
      {
        ...result,
        shot: shotPath,
        shot2: path.join(outDir, 'texture.png'),
        shot3: path.join(outDir, 'browser.png'),
        shot4: path.join(outDir, 'scene.png'),
        shot5: path.join(outDir, 'ground.png'),
        shotLast: path.join(outDir, 'ground-click.png'),
      },
      null,
      2,
    ),
  );
  console.log('=================================');
  // 小地图图标必须走「图组」选择器（角色属性里有 group 槽，挂上后能存进节点数据）
  const miniOk = !result.minimap || (result.minimap.iconSlot === true && result.minimap.iconSet === true);
  return result.ok === true && result.metadataWritten === true && miniOk;
}

function waitForLoad(win: BrowserWindow): Promise<void> {
  if (!win.webContents.isLoading()) return Promise.resolve();
  return new Promise((resolve) => win.webContents.once('did-finish-load', () => resolve()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
