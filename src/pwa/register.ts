/** Registers the service worker (production builds only) and reports update availability. */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const url = new URL('sw.js', document.baseURI).href;
  navigator.serviceWorker
    .register(url, { scope: './' })
    .then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            // A new version is cached; it activates on the next launch.
            const t = document.createElement('div');
            t.className = 'toast';
            t.textContent = 'Update downloaded — it will apply next time you open Voltline.';
            document.querySelector('.toasts')?.append(t);
            setTimeout(() => t.remove(), 5000);
          }
        });
      });
    })
    .catch((e) => console.warn('Service worker registration failed', e));
}
