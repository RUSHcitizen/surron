/**
 * Landscape-only on phones.
 *
 * The installed PWA is locked by the manifest. A browser tab cannot be locked on iOS, so
 * when a touch device is held upright the whole app is drawn rotated 90° clockwise into a
 * landscape-sized box (turn the phone to the left and it reads naturally; turn it fully and
 * the rotation simply switches off). The game never lays out in portrait.
 *
 * Pointer events still arrive in screen coordinates, so input code converts them with
 * `toLocal` / `localRect` into the app's (landscape) frame.
 */

let rotated = false;

/** True while the app is drawn rotated (phone held upright). */
export function isRotated() {
  return rotated;
}

/** Screen (client) coordinates -> app coordinates. */
export function toLocal(x: number, y: number): { x: number; y: number } {
  if (!rotated) return { x, y };
  // App point (u, v) is drawn at screen (W - v, u), with W the screen width.
  return { x: y, y: window.innerWidth - x };
}

/** Screen-space movement -> app-space movement. */
export function toLocalDelta(dx: number, dy: number): { x: number; y: number } {
  return rotated ? { x: dy, y: -dx } : { x: dx, y: dy };
}

/** An element's bounding box in app coordinates. */
export function localRect(el: Element): DOMRect {
  const r = el.getBoundingClientRect();
  if (!rotated) return r;
  const W = window.innerWidth;
  return new DOMRect(r.top, W - r.right, r.height, r.width);
}

function coarse() {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

function apply() {
  const w = window.innerWidth, h = window.innerHeight;
  const next = coarse() && h > w;
  const root = document.documentElement;
  root.classList.toggle('force-landscape', next);
  root.style.setProperty('--land-w', `${next ? h : w}px`);
  root.style.setProperty('--land-h', `${next ? w : h}px`);
  rotated = next;
}

/** Try the real orientation lock where the browser allows it (Android in fullscreen, PWAs). */
export function tryLockLandscape() {
  const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  so?.lock?.('landscape').catch(() => undefined);
}

export function initOrientation() {
  apply();
  const again = () => {
    apply();
    // iOS reports the final size late after a rotation or toolbar change.
    setTimeout(apply, 120);
    setTimeout(apply, 500);
  };
  window.addEventListener('resize', again);
  window.addEventListener('orientationchange', again);
  window.visualViewport?.addEventListener('resize', again);
  window.addEventListener('pointerdown', tryLockLandscape, { once: true });
}
