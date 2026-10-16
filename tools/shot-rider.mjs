// node tools/shot-rider.mjs <query> <out>  (dev server on :5173)
import { chromium } from '@playwright/test';
const [qs = '', out = 'tools/shots/rv'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text()); });
await page.goto(`http://localhost:5173/tools/debug/rider.html?${qs}`);
await page.waitForFunction(() => window.done, null, { timeout: 60000 });
await page.screenshot({ path: `${out}.png` });
await browser.close();
