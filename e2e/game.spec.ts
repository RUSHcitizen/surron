import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const ready = (page: Page) => page.waitForFunction(() => (window as any).voltline?.state === 'menu', null, { timeout: 60_000 });
/** Wait for `secs` of in-game time (slow software-rendered CI frames run the sim slower than wall time). */
const gameWait = async (page: Page, secs: number) => {
  const t0 = await page.evaluate(() => (window as any).voltline.time);
  await page.waitForFunction((t) => (window as any).voltline.time > t, t0 + secs, { timeout: 60_000 });
};
const evalGame = <T>(page: Page, fn: string) => page.evaluate(`(()=>{const g=window.voltline;${fn}})()`) as Promise<T>;
/** Software-rendered CI (SwiftShader) is very slow at High; riding tests use the Low preset. */
const lowQuality = (page: Page) => evalGame(page, 'g.settings.quality="low"; g.applySettings(); return 1');

test('boots without console errors and shows the menu', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await ready(page);
  await expect(page.getByRole('button', { name: 'Ride — free roam' })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});

test('keyboard riding, reset and pause', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await lowQuality(page);
  await page.getByRole('button', { name: 'Ride — free roam' }).click();
  await page.keyboard.down('KeyW');
  await gameWait(page, 3);
  const speed = await evalGame<number>(page, 'return g.bike.speed');
  expect(speed).toBeGreaterThan(5);
  await page.keyboard.down('KeyD');
  await gameWait(page, 1.2);
  const lean = await evalGame<number>(page, 'return g.bike.lean');
  expect(lean).toBeGreaterThan(0.1);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');
  await evalGame(page, 'g.bike.crash("test"); return 1');
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => (window as any).voltline.bike.crashed === false, null, { timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
});

test('garage edits change stats, persist across reload and apply to the ride', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.getByRole('button', { name: 'Garage' }).click();
  const massRow = page.locator('.stat', { hasText: 'Bike mass' });
  const before = await massRow.locator('.v').textContent();
  await page.locator('.part', { hasText: 'Hyper 84V 45Ah' }).click();
  await expect(massRow.locator('.v')).not.toHaveText(before!);
  // The starting bike (Stark Varg MX) carries the heaviest pack, so this swap saves weight.
  await expect(massRow.locator('.d')).toContainText('−');
  await page.getByRole('button', { name: 'Ride this build ▶' }).click();
  await page.waitForFunction(() => (window as any).voltline.state === 'ride');
  expect(await evalGame<string>(page, 'return g.build.parts.battery')).toBe('hyper84');
  expect(await evalGame<number>(page, 'return g.spec.powertrain.voltage')).toBe(84);
  await page.waitForTimeout(800); // debounced save
  await page.reload();
  await ready(page);
  expect(await evalGame<string>(page, 'return g.build.parts.battery')).toBe('hyper84');
  expect(await evalGame<string>(page, 'return g.save.backend.name')).toBe('IndexedDB');
});

test('drag strip challenge completes and records a measured result', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await ready(page);
  await lowQuality(page);
  await evalGame(page, 'g.startChallenge(g.challenges.find(c=>c.id==="drag")); return 1');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyE'); // lean forward to keep the front down
  await page.waitForFunction(() => { const c = (window as any).voltline.challenge; return c && (c.state === 'done' || c.state === 'failed'); }, null, { timeout: 240_000 });
  await page.keyboard.up('KeyW');
  const r = await evalGame<{ state: string; result: number; rec: any }>(page, 'return {state:g.challenge.state,result:g.challenge.result,rec:g.save.data.progress.measured[g.build.id]}');
  expect(r.state).toBe('done');
  expect(r.result).toBeGreaterThan(7);
  expect(r.result).toBeLessThan(25);
  expect(r.rec.t0to50).toBeGreaterThan(1);
  await expect(page.getByText('Drag Strip 201 m —')).toBeVisible();
});

test('service worker caches the game and it reloads offline with saves intact', async ({ page, context }) => {
  await page.goto('/');
  await ready(page);
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg?.active;
  }, null, { timeout: 30_000 });
  // Controlled after a reload
  await page.reload();
  await ready(page);
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const c = await caches.open(keys.find((k) => k.startsWith('voltline-'))!);
    return (await c.keys()).map((r) => new URL(r.url).pathname);
  });
  expect(cached.some((p) => p.includes('/assets/three-'))).toBe(true);
  expect(cached.some((p) => p.endsWith('manifest.webmanifest'))).toBe(true);
  // Change a setting, then go offline and reload.
  await evalGame(page, 'g.settings.units="mph"; g.save.save(); return 1');
  await page.waitForTimeout(500);
  await context.setOffline(true);
  await page.reload();
  await ready(page);
  expect(await evalGame<string>(page, 'return g.settings.units')).toBe('mph');
  await page.getByRole('button', { name: 'Ride — free roam' }).click();
  await page.keyboard.down('KeyW');
  await gameWait(page, 1.5);
  expect(await evalGame<number>(page, 'return g.bike.speed')).toBeGreaterThan(2);
  await context.setOffline(false);
});

test('manifest is valid for installation', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.start_url).toBe('./');
  expect(['standalone', 'fullscreen']).toContain(m.display);
  expect(m.icons.some((i: any) => i.sizes === '512x512')).toBe(true);
  for (const i of m.icons) expect((await request.get(i.src)).ok()).toBe(true);
  expect((await request.get('/icons/apple-touch-icon.png')).ok()).toBe(true);
});
