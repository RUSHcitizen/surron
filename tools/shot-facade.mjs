// Façade close-ups at iPhone 15 landscape size: node tools/shot-facade.mjs
import { chromium, devices } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPhone 15 landscape'], viewport: { width: 852, height: 393 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.setDefaultTimeout(180000);
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => window.voltline?.state === 'menu', null, { timeout: 180000 });
await page.tap('.btn.primary');
const spots = [['east', -134, -35, Math.PI / 2 - 0.35], ['west', -126, 35, -Math.PI / 2 + 0.35], ['north', -230, 74, 0.4]];
for (const [name, x, z, yaw] of spots) {
  await page.evaluate(([x, z, yaw]) => { const g = window.voltline; g.bike.place(x, z, yaw); g.cam.snap(); g.cam.orbit(0, -90, 0); }, [x, z, yaw]);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `tools/shots/facade-${name}.png` });
}
await browser.close();
