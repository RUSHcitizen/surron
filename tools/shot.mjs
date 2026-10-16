// Browser driver for manual QA: node tools/shot.mjs <url> <out-prefix> [actions-json]
import { chromium } from '@playwright/test';
const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'tools/shots/shot';
const actions = JSON.parse(process.argv[4] ?? '[]');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => window.voltline, null, { timeout: 60000 });
let n = 0;
for (const a of actions) {
  if (a.wait) await page.waitForTimeout(a.wait);
  if (a.click) await page.click(a.click);
  if (a.key) await page.keyboard.press(a.key);
  if (a.down) await page.keyboard.down(a.down);
  if (a.up) await page.keyboard.up(a.up);
  if (a.eval) logs.push('[eval] ' + JSON.stringify(await page.evaluate(a.eval)));
  if (a.shot) await page.screenshot({ path: `${out}-${a.shot}.png` });
  n++;
}
console.log(logs.join('\n'));
await browser.close();
