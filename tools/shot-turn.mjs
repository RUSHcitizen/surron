// Turning / boost QA at iPhone 15 landscape size: node tools/shot-turn.mjs <url> <out-prefix>
import { chromium, devices } from '@playwright/test';
const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'tools/shots/turn';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPhone 15 landscape'], viewport: { width: 852, height: 393 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => window.voltline?.state === 'menu', null, { timeout: 90000 });
await page.tap('.btn.primary');
// South ring road, heading east, with room ahead.
await page.evaluate(() => { const g = window.voltline; g.bike.place(-360, -238, Math.PI / 2); g.cam.snap(); });
await page.waitForTimeout(800);
const cdp = await ctx.newCDPSession(page);
const tp = (id, x, y) => ({ x, y, id, radiusX: 5, radiusY: 5, force: 1 });
const boost = await page.locator('.t-boost').boundingBox();
const thr = await page.locator('.t-throttle').boundingBox();
const T = tp(1, thr.x + thr.width / 2, thr.y + thr.height * 0.3);
const B = tp(1, boost.x + boost.width / 2, boost.y + boost.height / 2);
const S = tp(2, 150, 300);
// Simulated time runs slowly in the software renderer: drive the bike's speed up directly.
await page.evaluate(() => { const g = window.voltline; g.bike.vel.set(22, 0, 0); });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [B, S] });
await page.waitForTimeout(300);
logs.push('[touch] ' + JSON.stringify(await page.evaluate(() => { const g = window.voltline; return { touch: g.input.touch, state: g.input.state }; })) + JSON.stringify(B));
await page.waitForTimeout(3000);
logs.push('[boost] ' + JSON.stringify(await page.evaluate(() => { const g = window.voltline; return { v: (g.bike.speed * 3.6).toFixed(0), boost: g.bike.pt.boostLevel.toFixed(2), meter: g.boostMeter.toFixed(2) }; })));
await page.screenshot({ path: `${out}-boost.png` });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [T, { ...S, x: S.x + 45 }] });
await page.waitForTimeout(2200);
logs.push('[turn] ' + JSON.stringify(await page.evaluate(() => { const g = window.voltline; return { v: (g.bike.speed * 3.6).toFixed(0), lean: g.bike.lean.toFixed(2), fps: g.fps.toFixed(0) }; })));
await page.screenshot({ path: `${out}-right.png` });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
console.log(logs.join('\n'));
await browser.close();
