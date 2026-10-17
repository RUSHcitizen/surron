// Highway / countryside QA at iPhone 15 landscape size: node tools/shot-highway.mjs <url> <out-prefix>
import { chromium, devices } from '@playwright/test';
const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'tools/shots/hw';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPhone 15 landscape'], viewport: { width: 852, height: 393 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.voltline?.state === 'menu', null, { timeout: 120000 });
logs.push(`[load] menu after ${((Date.now() - t0) / 1000).toFixed(1)} s (software renderer)`);
await page.tap('.btn.primary');
const spots = [['straight', -300, -597, Math.PI / 2], ['corner', 560, -597, Math.PI / 2], ['north', 10, 450, 0], ['country', -520, 300, 0.6]];
for (const [name, x, z, yaw] of spots) {
  await page.evaluate(([x, z, yaw]) => { const g = window.voltline; g.bike.place(x, z, yaw); g.cam.snap(); }, [x, z, yaw]);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${out}-${name}.png` });
  logs.push(`[${name}] ` + JSON.stringify(await page.evaluate(() => { const g = window.voltline; return { fps: g.fps.toFixed(0), calls: g.post?.sceneCalls, tris: g.post?.sceneTris }; })));
}
console.log(logs.join('\n'));
await browser.close();
