import { it } from 'vitest';
import { flatWorld } from '../src/world/collision';
import { Traffic } from '../src/world/traffic';
it('car tris', () => {
  const t = new Traffic(flatWorld(), 1);
  for (const m of t.root.children) {
    const g = (m as unknown as { geometry: { index: { count: number } | null; attributes: { position: { count: number } } } }).geometry;
    process.stdout.write(`TRIS ${(g.index ? g.index.count : g.attributes.position.count) / 3}\n`);
  }
});
