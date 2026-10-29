import puppeteer from 'puppeteer-core';

const CHROME = '/root/.cache/puppeteer/chrome-headless-shell/linux-155.0.8059.39/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('requestfailed', (r) => console.log('[reqfail]', r.url(), r.failure()?.errorText));
page.on('response', (r) => {
  if (r.url().includes('/sprites/')) console.log('[res]', r.status(), r.url());
});

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 4000));

const info = await page.evaluate(() => {
  const g = window.__game;
  const scene = g?.world?.scene ?? null;
  const out = { keys: Object.keys(g ?? {}), children: [] };
  if (!scene) return out;
  scene.traverse((o) => {
    const m = o.material;
    out.children.push({
      type: o.type,
      visible: o.visible,
      pos: o.position.toArray().map((n) => +n.toFixed(2)),
      scale: o.scale.toArray().map((n) => +n.toFixed(2)),
      center: o.center ? o.center.toArray().map((n) => +n.toFixed(2)) : null,
      hasMap: Boolean(m?.map),
      mapSize: m?.map?.image ? `${m.map.image.width}x${m.map.image.height}` : null,
      opacity: m?.opacity,
      alphaTest: m?.alphaTest,
      repeat: m?.map ? m.map.repeat.toArray() : null,
      offset: m?.map ? m.map.offset.toArray() : null,
    });
  });
  return out;
});
console.log(JSON.stringify(info.children.filter((c) => ['Sprite','Group','Mesh'].includes(c.type)), null, 1));
await browser.close();
