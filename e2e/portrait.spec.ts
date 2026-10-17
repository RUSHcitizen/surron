import { expect, test } from '@playwright/test';

// A phone held upright still gets the landscape game: the app is drawn rotated and touch
// input is mapped into the rotated frame.
test('upright phone: game is laid out in landscape and touch maps through the rotation', async ({ page, context }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).voltline?.state === 'menu', null, { timeout: 60_000 });
  await page.evaluate(() => { const g = (window as any).voltline; g.settings.quality = 'low'; g.applySettings(); });
  const vp = page.viewportSize()!;
  expect(vp.height).toBeGreaterThan(vp.width);
  expect(await page.evaluate(() => document.documentElement.classList.contains('force-landscape'))).toBe(true);
  const size = await page.evaluate(() => { const c = (window as any).voltline.renderer.domElement as HTMLCanvasElement; return { w: c.clientWidth, h: c.clientHeight }; });
  expect(size.w).toBe(vp.height);
  expect(size.h).toBe(vp.width);
  await expect(page.getByText('Rotate your phone')).toHaveCount(0);
  await page.tap('.btn.primary');
  await expect(page.locator('.touch-ui')).toBeVisible();
  // On screen the throttle pad sits at the bottom (the app's right edge).
  const thr = (await page.locator('.t-throttle').boundingBox())!;
  const stick = (await page.locator('.t-stick').boundingBox())!;
  expect(thr.y).toBeGreaterThan(vp.height / 2);
  expect(stick.y + stick.height / 2).toBeLessThan(vp.height / 2);
  const cdp = await context.newCDPSession(page);
  const tp = (id: number, x: number, y: number) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 });
  // The app's "up" is screen right, so the top of the throttle pad is its rightmost part.
  const T = tp(1, thr.x + thr.width * 0.8, thr.y + thr.height / 2);
  const S = tp(2, stick.x + stick.width / 2, stick.y + stick.height / 2);
  const gameWait = async (secs: number) => {
    const t0 = await page.evaluate(() => (window as any).voltline.time);
    await page.waitForFunction((t) => (window as any).voltline.time > t, t0 + secs, { timeout: 60_000 });
  };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [T, S] });
  await gameWait(1.5);
  // Thumb towards the app's right = towards the bottom of the upright screen.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [T, { ...S, y: S.y + 50 }] });
  await gameWait(1);
  const st = await page.evaluate(() => { const g = (window as any).voltline; return { thr: g.input.state.throttle, steer: g.input.state.steer, lean: g.input.touch.lean, speed: g.bike.speed }; });
  expect(st.thr).toBeGreaterThan(0.8);
  expect(st.steer).toBeGreaterThan(0.4);
  expect(Math.abs(st.lean ?? 0)).toBeLessThan(0.1);
  expect(st.speed).toBeGreaterThan(2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.screenshot({ path: 'tools/shots/portrait.png' });
});
