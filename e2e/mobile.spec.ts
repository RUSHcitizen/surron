import { expect, test } from '@playwright/test';

test('touch controls: simultaneous throttle + steer, brakes and buttons', async ({ page, context }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).voltline?.state === 'menu', null, { timeout: 60_000 });
  await page.evaluate(() => { const g = (window as any).voltline; g.settings.quality = 'low'; g.applySettings(); });
  await page.tap('.btn.primary');
  await expect(page.locator('.touch-ui')).toBeVisible();
  const thr = (await page.locator('.t-throttle').boundingBox())!;
  const stick = (await page.locator('.t-stick').boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const tp = (id: number, x: number, y: number) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 });
  const T = tp(1, thr.x + thr.width / 2, thr.y + thr.height * 0.2);
  const S = tp(2, stick.x + stick.width / 2, stick.y + stick.height / 2);
  const gameWait = async (secs: number) => {
    const t0 = await page.evaluate(() => (window as any).voltline.time);
    await page.waitForFunction((t) => (window as any).voltline.time > t, t0 + secs, { timeout: 60_000 });
  };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [T, S] });
  await gameWait(2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [T, { ...S, x: S.x + 50 }] });
  await gameWait(1.5);
  const st = await page.evaluate(() => { const g = (window as any).voltline; return { thr: g.input.state.throttle, steer: g.input.state.steer, speed: g.bike.speed, lean: g.bike.lean }; });
  expect(st.thr).toBeGreaterThan(0.8);
  expect(st.steer).toBeGreaterThan(0.4);
  expect(st.speed).toBeGreaterThan(3);
  expect(st.lean).toBeGreaterThan(0.05);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).voltline.input.touch.throttle)).toBe(0);
  // Trick button: hold WHEELIE with the throttle pad untouched; the button alone lifts the front.
  const wb = (await page.locator('.t-wheelie').boundingBox())!;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp(5, wb.x + wb.width / 2, wb.y + wb.height / 2)] });
  await page.waitForFunction(() => (window as any).voltline.input.state.wheelie === 1);
  const p0 = await page.evaluate(() => (window as any).voltline.bike.pitch);
  await page.waitForFunction((p0) => (window as any).voltline.bike.pitch > p0 + 0.15, p0, { timeout: 30_000 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => (window as any).voltline.input.state.wheelie === 0);
  await page.tap('[data-action="pause"]');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
});
