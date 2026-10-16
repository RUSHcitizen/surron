import { describe, expect, it } from 'vitest';
import { riderMeshStats } from '../src/render/rider';

describe('rider mesh', () => {
  it('builds one continuous skinned body and a helmet quickly, at a sane size', () => {
    const t0 = performance.now();
    const s = riderMeshStats();
    const ms = performance.now() - t0;
    process.stdout.write(`\nrider: ${JSON.stringify(s)} in ${ms.toFixed(0)} ms\n`);
    expect(s.bodyTris).toBeGreaterThan(8000);
    expect(s.bodyTris).toBeLessThan(80000);
    expect(s.helmetTris).toBeGreaterThan(2000);
    expect(ms).toBeLessThan(4000);
  });
});
