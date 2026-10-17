import { it } from 'vitest';
import { generateWorld } from '../src/world/layout';
it('gen time', () => {
  generateWorld();
  const t = performance.now();
  const d = generateWorld();
  process.stdout.write(`cores ${d.collectibles.length} GEN ${(performance.now() - t).toFixed(0)} ms trees ${d.trees.length} boxes ${d.boxes.length} markings ${d.markings.length} lights ${d.lights.length}\n`);
});
