// Trick QA at iPhone 15 landscape: bunny hop + superman mid-air, touch UI visible.
// node tools/shot-tricks.mjs <url> <out-prefix>
import { chromium, devices } from '@playwright/test';
const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'tools/shots/tricks';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPhone 15 landscape'], viewport: { width: 852, height: 393 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.setDefaultTimeout(240000);
await page.goto(url);
await page.waitForFunction(() => window.voltline?.state === 'menu', null, { timeout: 120000 });
await page.evaluate(() => { const g = window.voltline; g.settings.quality = 'medium'; g.settings.adaptiveResolution = false; g.perfLevel = 0; g.applySettings(); });
await page.tap('.btn.primary');
const gameWait = async (secs) => {
  const t0 = await page.evaluate(() => window.voltline.time);
  await page.waitForFunction((t) => window.voltline.time > t, t0 + secs, { timeout: 240000 });
};
for (const [name, trick, steer] of [['superman', 1, 0], ['whip', 0, 1]]) {
  await page.evaluate(() => { const g = window.voltline; g.bike.place(20, -60, 0); g.cam.snap(); g.input.touch.throttle = 1; });
  await gameWait(2);
  await page.evaluate(() => { const t = window.voltline.input.touch; t.jump = 1; });
  await gameWait(0.6);
  await page.evaluate(() => { window.voltline.input.touch.jump = 0; });
  await gameWait(0.25);
  await page.evaluate(([trick, steer]) => { const t = window.voltline.input.touch; t.trick = trick; t.steer = steer || null; }, [trick, steer]);
  await page.waitForFunction(() => window.voltline.bike.trickAmt > 0.9 || Math.abs(window.voltline.bike.lean) > 0.7, null, { timeout: 120000 });
  await page.screenshot({ path: `${out}-${name}.png` });
  await page.evaluate(() => { const t = window.voltline.input.touch; t.trick = 0; t.steer = null; t.throttle = 0; });
  await gameWait(2.5);
}
await browser.close();
