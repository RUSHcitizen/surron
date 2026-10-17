// Triangle budget breakdown at a spot: node tools/shot-tris.mjs <x> <z> <yaw>
import { chromium, devices } from '@playwright/test';
const [x = '-127', z = '-60', yaw = '0'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPhone 15 landscape'], viewport: { width: 852, height: 393 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => window.voltline?.state === 'menu', null, { timeout: 180000 });
await page.tap('.btn.primary');
await page.evaluate(([x, z, yaw]) => { const g = window.voltline; g.bike.place(+x, +z, +yaw); g.cam.snap(); }, [x, z, yaw]);
await page.waitForTimeout(2500);
const res = await page.evaluate(() => {
  const g = window.voltline;
  const out = {};
  g.scene.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry) return;
    const geo = o.geometry;
    const t = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    const n = o.isInstancedMesh ? o.count : 1;
    let key = o.parent?.name || o.parent?.type || 'scene';
    let p = o;
    for (let k = 0; k < 6 && p; k++) { if (p.userData?.tag) { key = p.userData.tag; break; } p = p.parent; }
    key = `${o.isInstancedMesh ? 'inst' : 'mesh'} tris/each=${Math.round(t)} n=${n} cull=${o.frustumCulled}`;
    out[key] = (out[key] || 0) + t * n;
  });
  return Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${Math.round(v / 1000)}k ${k}`);
});
console.log(res.join('\n'));
await browser.close();
