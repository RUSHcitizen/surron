/**
 * Registers the service worker (production builds only) and applies updates quickly:
 * a new version downloaded while you're in a menu is applied right away (page reloads);
 * while riding you get an "Update now" button instead of an interruption. The app also
 * checks for updates whenever it comes back to the foreground (iOS Home Screen apps are
 * often resumed rather than reopened).
 */
export function registerServiceWorker(canReloadNow: () => boolean = () => true) {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const url = new URL('sw.js', document.baseURI).href;
  let reloading = false;
  // On the very first visit the new worker claims the page; that's not an update, don't reload.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
  const apply = (w: ServiceWorker) => w.postMessage('skipWaiting');
  const offer = (w: ServiceWorker) => {
    if (canReloadNow()) return apply(w);
    const t = document.createElement('div');
    t.className = 'toast update-toast';
    t.style.pointerEvents = 'auto';
    t.textContent = 'A new version is ready. ';
    const b = document.createElement('button');
    b.className = 'btn small primary';
    b.textContent = 'Update now';
    b.addEventListener('click', () => apply(w));
    t.append(b);
    document.querySelector('.toasts')?.append(t);
    setTimeout(() => t.remove(), 15000);
  };
  navigator.serviceWorker
    .register(url, { scope: './' })
    .then((reg) => {
      // An update may already be waiting from a previous session.
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reg.update().catch(() => {});
      });
    })
    .catch((e) => console.warn('Service worker registration failed', e));
}
