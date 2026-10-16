import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Generates dist/sw.js with a precache manifest of every emitted asset plus a content hash
 * as the cache version, so each deploy gets a fresh cache and stale ones are purged.
 */
function serviceWorker(): Plugin {
  return {
    name: 'voltline-sw',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const publicFiles = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'offline.html'];
      const all = ['./', ...files, ...publicFiles].filter((f, i, a) => a.indexOf(f) === i);
      const hash = createHash('sha256');
      for (const f of files) {
        const item = bundle[f];
        hash.update(f);
        hash.update(item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : Buffer.from(item.source));
      }
      const version = hash.digest('hex').slice(0, 12);
      const template = readFileSync(new URL('./src/pwa/sw-template.js', import.meta.url), 'utf8');
      const code = template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(all.map((f) => (f === './' ? f : `./${f}`))));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: code });
    },
  };
}

export default defineConfig({
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC') },
  // Relative base: works at the domain root or any sub-path (Cloudflare Pages, previews, sub-folders).
  base: './',
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: { manualChunks: { three: ['three'] } },
    },
  },
  plugins: [serviceWorker()],
  server: { host: true },
});
