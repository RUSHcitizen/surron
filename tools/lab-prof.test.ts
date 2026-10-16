import { it } from 'vitest';
import { meshSDF, ellipsoid } from '../src/render/sdfMesh';
import { riderMeshStats } from '../src/render/rider';
it('prof', () => {
  let t = performance.now();
  meshSDF((x, y, z) => ellipsoid(x, y, z, 0.3, 0.5, 0.4), [-0.42, -0.64, -0.26], [0.42, 0.74, 0.8], 0.0135);
  process.stdout.write(`\nmesher only (ellipsoid): ${(performance.now() - t).toFixed(0)} ms`);
  t = performance.now();
  riderMeshStats();
  process.stdout.write(`\nrider: ${(performance.now() - t).toFixed(0)} ms\n`);
});
