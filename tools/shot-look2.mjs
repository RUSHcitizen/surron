// Visual QA at iPhone 15 landscape size with full effects (no automatic quality drop):
// node tools/shot-look2.mjs <url> <out-prefix> [quality]
import { chromium, devices } from '@playwright/test';
const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'tools/shots/look';
const quality = process.argv[4] ?? 'medium';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPhone 15 landscape'], viewport: { width: 852, height: 393 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.setDefaultTimeout(240000);
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
await page.goto(url);
await page.waitForFunction(() => window.voltline?.state === 'menu', null, { timeout: 120000 });
await page.evaluate((q) => { const g = window.voltline; g.settings.quality = q; g.settings.adaptiveResolution = false; g.perfLevel = 0; g.applySettings(); }, quality);
await page.tap('.btn.primary');
await page.evaluate(() => { document.querySelector('.touch-ui').style.opacity = '0'; });
const spots = (process.env.SPOTS ?? 'street:-127:-60:0,corner:-137:-86:0.8,hub:20:-10:2.2').split(',').map((s) => s.split(':'));
const gameWait = async (secs) => {
  const t0 = await page.evaluate(() => window.voltline.time);
  await page.waitForFunction((t) => window.voltline.time > t, t0 + secs, { timeout: 240000 });
};
for (const [name, x, z, yaw] of spots) {
  await page.evaluate(([x, z, yaw]) => { const g = window.voltline; g.bike.place(+x, +z, +yaw); g.cam.snap(); }, [x, z, yaw]);
  await gameWait(1.2);
  await page.screenshot({ path: `${out}-${name}.png` });
}
if (process.env.WHEELIE) {
  const [x, z, yaw] = process.env.WHEELIE.split(':').map(Number);
  await page.evaluate(([x, z, yaw]) => { const g = window.voltline; g.bike.place(x, z, yaw); g.cam.snap(); g.input.touch.throttle = 1; }, [x, z, yaw]);
  await gameWait(1.5);
  await page.evaluate(() => { const t = window.voltline.input.touch; t.throttle = 0; t.wheelie = 1; t.steer = 0.35; });
  await gameWait(2.5);
  await page.screenshot({ path: `${out}-wheelie.png` });
  logs.push('[wheelie] ' + JSON.stringify(await page.evaluate(() => { const b = window.voltline.bike; return { pitch: b.pitch, v: b.speed, crashed: b.crashed }; })));
}
console.log(logs.join('\n'));
await browser.close();
