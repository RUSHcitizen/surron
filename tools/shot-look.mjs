// Close-up QA: node tools/shot-look.mjs <url> <out> <spawn> <jsCameraExpr>
// Rides briefly at <spawn>, pauses (screen hidden) and frames the camera with the given expression,
// which receives `g` (the game) and must call g.camera.position.set(...) / lookAt(...).
import { chromium } from '@playwright/test';
const [url = 'http://localhost:5173/', out = 'tools/shots/look', spawn = 'city', cam = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
await page.goto(url);
await page.waitForFunction(() => window.voltline?.state === 'menu', null, { timeout: 90000 });
await page.evaluate((s) => { const g = window.voltline; g.setState('ride'); g.respawn(s); }, spawn);
await page.waitForTimeout(3000);
await page.evaluate((c) => {
  const g = window.voltline;
  g.setState('pause');
  document.querySelector('.screen')?.remove();
  document.querySelector('.hud') && (document.querySelector('.hud').style.display = 'none');
  new Function('g', c)(g);
  g.camera.updateMatrixWorld();
}, cam);
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}.png` });
console.log(logs.join('\n'));
await browser.close();
