// 临时验证脚本（不入库）：无头 Chrome 打开本地页面、截图、模拟按键、抓日志
import puppeteer from 'puppeteer-core';

const CHROME = '/root/.cache/puppeteer/chrome-headless-shell/linux-155.0.8059.39/chrome-headless-shell-linux64/chrome-headless-shell';
const URL = process.argv[2] || 'http://localhost:5173/';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1280,800',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 3500));

const hud = () =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll('.hud-row')].map((r) => r.textContent);
    return rows.join(' | ');
  });

async function shot(name) {
  await page.screenshot({ path: `/tmp/shot_${name}.png` });
}

console.log('HUD initial:', await hud());
await shot('1_idle');

await page.keyboard.down('KeyD');
await new Promise((r) => setTimeout(r, 1200));
await shot('2_move_right');
console.log('HUD after D:', await hud());
await page.keyboard.up('KeyD');

await page.keyboard.down('KeyW');
await new Promise((r) => setTimeout(r, 1200));
await shot('3_move_up');
console.log('HUD after W:', await hud());
await page.keyboard.up('KeyW');

await page.keyboard.press('Space');
await new Promise((r) => setTimeout(r, 250));
await shot('4_attack');
console.log('HUD after Space:', await hud());

const diag = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const game = window.__game;
  return {
    canvas: canvas ? `${canvas.width}x${canvas.height}` : 'none',
    hasGame: Boolean(game),
    errorText: document.querySelector('.error-panel')?.textContent ?? null,
    bodyText: document.body.innerText.slice(0, 200),
  };
});
console.log('DIAG:', JSON.stringify(diag));
console.log('LOGS:\n' + (logs.join('\n') || '(none)'));

await browser.close();
