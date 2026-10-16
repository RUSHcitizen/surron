import { it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { RiderModel } from '../src/render/rider';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { defaultBuild } from '../src/vehicle/build';
it('skin check', () => {
  const build = defaultBuild();
  const r = new RiderModel(build) as any;
  const spec = computeVehicleSpec(build);
  r.pose(spec, new Matrix4(), new Vector3(0.31, 0.725, 0.252), new Vector3(-0.31, 0.725, 0.252), 0, 0, 8);
  const g = r.body.geometry;
  const pos = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  const mats = r.bones.map((b: any, i: number) => new Matrix4().multiplyMatrices(b.matrixWorld, r.data.restInverse[i]));
  const regions = r.data.regions;
  const acc: Record<number, Vector3[]> = {};
  const v = new Vector3(), out = new Vector3(), t = new Vector3();
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k);
    out.set(0, 0, 0);
    for (let q = 0; q < 4; q++) { const w = sw.getComponent(k, q); if (w > 0) out.addScaledVector(t.copy(v).applyMatrix4(mats[si.getComponent(k, q)]), w); }
    (acc[regions[k]] ??= []).push(out.clone());
  }
  for (const [reg, pts] of Object.entries(acc)) {
    const c = pts.reduce((a, p) => a.add(p), new Vector3()).multiplyScalar(1 / pts.length);
    const left = pts.filter((p) => p.x > 0);
    const cl = left.reduce((a, p) => a.add(p), new Vector3()).multiplyScalar(1 / Math.max(1, left.length));
    process.stdout.write(`\nregion ${reg}: n=${pts.length} centroid ${c.toArray().map((x) => x.toFixed(2))} leftCentroid ${cl.toArray().map((x) => x.toFixed(2))}`);
  }
  process.stdout.write('\nwr ' + JSON.stringify(r.j.wr) + ' el ' + JSON.stringify(r.j.el) + '\n');
});
it('bone map check', () => {
  const build = defaultBuild();
  const r = new RiderModel(build) as any;
  const spec = computeVehicleSpec(build);
  r.pose(spec, new Matrix4(), new Vector3(0.31, 0.725, 0.252), new Vector3(-0.31, 0.725, 0.252), 0, 0, 8);
  const restWr = new Vector3(0.44, 0.36, 0.5);
  const restInvFarm = r.data.restInverse[6];
  const restFrame = restInvFarm.clone().invert();
  const restEl = new Vector3().setFromMatrixPosition(restFrame);
  process.stdout.write(`\nrest elbow from frame ${restEl.toArray().map((x: number) => x.toFixed(3))} restLen ${r.data.restLen[6].toFixed(3)} lens ${r.lens[6].toFixed(3)}`);
  const m = new Matrix4().multiplyMatrices(r.bones[6].matrixWorld, restInvFarm);
  process.stdout.write(`\nrest wrist maps to ${restWr.clone().applyMatrix4(m).toArray().map((x: number) => x.toFixed(3))}\n`);
});
it('glove weights', () => {
  const r = new RiderModel(defaultBuild()) as any;
  const g = r.body.geometry;
  const pos = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  const tot: Record<number, number> = {};
  const c = new Vector3(); let n = 0;
  for (let k = 0; k < pos.count; k++) {
    if (r.data.regions[k] !== 7 || pos.getX(k) < 0) continue;
    n++; c.x += pos.getX(k); c.y += pos.getY(k); c.z += pos.getZ(k);
    for (let q = 0; q < 4; q++) tot[si.getComponent(k, q)] = (tot[si.getComponent(k, q)] ?? 0) + sw.getComponent(k, q);
  }
  process.stdout.write(`\nglove rest centroid ${c.multiplyScalar(1 / n).toArray().map((x) => x.toFixed(3))} weights ${JSON.stringify(tot)}\n`);
});
it('outliers', () => {
  const build = defaultBuild();
  const r = new RiderModel(build) as any;
  const spec = computeVehicleSpec(build);
  r.pose(spec, new Matrix4(), new Vector3(0.31, 0.725, 0.252), new Vector3(-0.31, 0.725, 0.252), 0, 0, 8);
  const g = r.body.geometry;
  const pos = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  const mats = r.bones.map((b: any, i: number) => new Matrix4().multiplyMatrices(b.matrixWorld, r.data.restInverse[i]));
  const v = new Vector3(), t = new Vector3();
  const res: any[] = [];
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k);
    const outs = [];
    for (let q = 0; q < 4; q++) { const w = sw.getComponent(k, q); if (w > 0.05) outs.push([si.getComponent(k, q), w, t.copy(v).applyMatrix4(mats[si.getComponent(k, q)]).clone()]); }
    let spread = 0;
    for (const a of outs) for (const b of outs) spread = Math.max(spread, a[2].distanceTo(b[2]));
    res.push({ k, spread, rest: v.toArray().map((x) => +x.toFixed(2)), bones: outs.map((o) => [o[0], +o[1].toFixed(2)]) });
  }
  res.sort((a, b) => b.spread - a.spread);
  for (const o of res.slice(0, 8)) process.stdout.write('\n' + JSON.stringify(o));
  process.stdout.write('\n');
});
it('weight stats', () => {
  const r = new RiderModel(defaultBuild()) as any;
  const sw = r.body.geometry.getAttribute('skinWeight');
  let blended = 0;
  for (let k = 0; k < sw.count; k++) if (sw.getX(k) < 0.95) blended++;
  process.stdout.write(`\nblended ${blended} of ${sw.count}\n`);
});
it('thigh regions', () => {
  const r = new RiderModel(defaultBuild()) as any;
  const si = r.body.geometry.getAttribute('skinIndex');
  const cnt: Record<string, number> = {};
  for (let k = 0; k < si.count; k++) if (si.getX(k) === 9) cnt[r.data.regions[k]] = (cnt[r.data.regions[k]] ?? 0) + 1;
  process.stdout.write(`\nthighL regions ${JSON.stringify(cnt)}\n`);
});
