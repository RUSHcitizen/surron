import './ui/styles.css';
import { Game } from './game/game';
import { registerServiceWorker } from './pwa/register';
import { initOrientation } from './ui/orient';

// Before anything lays out: phones always get a landscape app, even held upright.
initOrientation();

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function boot() {
  const msg = document.getElementById('boot-msg');
  if (!webglAvailable()) {
    if (msg) msg.textContent = 'This device or browser does not support WebGL, which Stark Varg EBike needs.';
    return;
  }
  // Let the boot screen paint before the (synchronous) world generation.
  await new Promise((r) => setTimeout(r, 30));
  try {
    const game = new Game(document.getElementById('app')!);
    await game.init();
    (window as unknown as { voltline: Game }).voltline = game;
    window.addEventListener('error', (e) => game.reportError(e.error ?? e.message));
    window.addEventListener('unhandledrejection', (e) => game.reportError(e.reason));
    const b = document.getElementById('boot');
    if (b) {
      b.style.opacity = '0';
      setTimeout(() => b.remove(), 350);
    }
  } catch (e) {
    console.error(e);
    if (msg) msg.textContent = `Failed to start: ${(e as Error).message}`;
  }
  const g = (window as unknown as { voltline?: Game }).voltline;
  registerServiceWorker(() => !g || g.state !== 'ride');
}

void boot();
