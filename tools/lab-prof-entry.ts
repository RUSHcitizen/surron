import { riderMeshStats } from '../src/render/rider';
const t = performance.now();
console.log(riderMeshStats(), (performance.now() - t).toFixed(0), 'ms');
