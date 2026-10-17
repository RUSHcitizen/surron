// City traffic + crowd QA at iPhone 15 landscape size: node tools/shot-traffic.mjs <url> <out-prefix>
import { chromium, devices } from '@playwright/test';
const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'tools/shots/traffic';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPhone 15 landscape'], viewport: { width: 852, height: 393 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
await page.goto(url);
await page.waitForFunction(() => window.voltline?.state === 'menu', null, { timeout: 90000 });
await page.tap('.btn.primary');
await page.evaluate(() => window.voltline.respawn('city'));
for (const [k, back, side] of [[0, 14, 0], [3, 9, -2.5], [7, 22, 3]]) {
  await page.evaluate(([k, back, side]) => {
    const g = window.voltline;
    const c = g.traffic.cars[k];
    // Behind the car in its lane (side offset to see past it), facing the same way.
    g.bike.place(c.x - c.fx * back + c.fz * side, c.z - c.fz * back - c.fx * side, Math.atan2(c.fx, c.fz));
    g.cam.snap();
  }, [k, back, side]);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}-${k}.png` });
}
logs.push('[state] ' + JSON.stringify(await page.evaluate(() => { const g = window.voltline; return { fps: g.fps.toFixed(0), calls: g.post?.sceneCalls, tris: g.post?.sceneTris, cars: g.traffic.cars.length }; })));
console.log(logs.join('\n'));
await browser.close();
