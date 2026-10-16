// Wheelie QA: node tools/shot-wheelie.mjs <url> <out-prefix>
import { chromium } from '@playwright/test';
const url = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'tools/shots/wh';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.voltline?.state === 'menu', null, { timeout: 90000 });
await page.evaluate(() => window.voltline.ui.startRide?.() ?? document.querySelector('.btn.primary').click());
await page.evaluate(() => window.voltline.respawn('hub'));
await page.waitForTimeout(1500);
const g = 'window.voltline';
const t0 = await page.evaluate(() => window.voltline.time);
const wait = async (s) => { const st = await page.evaluate(() => window.voltline.time); await page.waitForFunction((x) => window.voltline.time > x, st + s, { timeout: 120000 }); };
await page.keyboard.down('KeyW');
await wait(2);
await page.keyboard.down('KeyZ');
for (let i = 0; i < 4; i++) {
  await wait(0.5);
  console.log(JSON.stringify(await page.evaluate(() => { const b = window.voltline.bike; return { pitch: b.pitch.toFixed(2), hold: b.wheelieHold.toFixed(2), v: (b.speed*3.6).toFixed(0), fg: b.front.grounded, crashed: b.crashed, fps: window.voltline.fps.toFixed(0) }; })));
  await page.screenshot({ path: `${out}-${i}.png` });
}
await browser.close();
