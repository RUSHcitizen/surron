// City street QA at iPhone 15 landscape size: node tools/shot-city.mjs <url> <out-prefix>
import { chromium, devices } from '@playwright/test';
const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'tools/shots/city';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPhone 15 landscape'], viewport: { width: 852, height: 393 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.setDefaultTimeout(180000);
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
await page.goto(url);
await page.waitForFunction(() => window.voltline?.state === 'menu', null, { timeout: 120000 });
await page.tap('.btn.primary');
const spots = [['street', -127, -60, 0], ['corner', -137, -86, 0.8], ['side', -126, 30, -0.35]];
for (const [name, x, z, yaw] of spots) {
  await page.evaluate(([x, z, yaw]) => { const g = window.voltline; g.bike.place(x, z, yaw); g.cam.snap(); }, [x, z, yaw]);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${out}-${name}.png` });
  logs.push(`[${name}] ` + JSON.stringify(await page.evaluate(() => { const g = window.voltline; return { calls: g.post?.sceneCalls, tris: g.post?.sceneTris }; })));
}
console.log(logs.join('\n'));
await browser.close();
