import { it } from 'vitest';
import { CollisionWorld } from '../src/world/collision';
import { generateWorld } from '../src/world/layout';
import { Traffic } from '../src/world/traffic';
it('traffic flow', () => {
  const d = generateWorld();
  const world = new CollisionWorld(d.terrain);
  const tr = new Traffic(world, Number(process.env.N ?? 30));
  const dt = 1 / 30;
  let minD = Infinity, offRoad = 0, stuckMax = 0, sumV = 0, n = 0;
  const still = new Array(tr.cars.length).fill(0);
  const hist: string[][] = tr.cars.map(() => []);
  for (let s = 0; s < 600 / dt; s++) {
    tr.update(dt, 9999, 9999, 0, 0);
    tr.cars.forEach((c, i) => { hist[i].push(`${(s * dt).toFixed(2)} ${c.phase} ${c.x.toFixed(1)},${c.z.toFixed(1)} u${c.u.toFixed(3)} v${c.v.toFixed(2)} bb${c.blockedBy} g${c.ghost.toFixed(1)}`); if (hist[i].length > 40) hist[i].shift(); });
    for (let i = 0; i < tr.cars.length; i++) {
      const c = tr.cars[i];
      sumV += c.v; n++;
      still[i] = c.v < 0.3 ? still[i] + dt : 0;
      if (Math.abs(still[i] - 20) < dt / 2 && process.env.CHAIN) {
        let k = i, out = '';
        const J = (tr as unknown as { junction: Map<number, number> }).junction;
        for (let h = 0; h < 8 && k >= 0; h++) {
          const q = tr.cars[k];
          out += ` [${k} ${q.phase} n${q.ni},${q.nj} d${q.dx},${q.dz} e${q.ex},${q.ez} u${q.u.toFixed(2)} v${q.v.toFixed(1)} bb${q.blockedBy} own${J.get(q.ni * 16 + q.nj)}]`;
          k = q.blockedBy === -3 ? J.get(q.ni * 16 + q.nj)! : q.blockedBy;
        }
        process.stdout.write(`STUCK t=${(s * dt).toFixed(1)}${out}\n`);
      }
      stuckMax = Math.max(stuckMax, still[i]);
      if (d.terrain.surfaceAt(c.x, c.z) !== 'asphalt') offRoad++;
      for (let j = i + 1; j < tr.cars.length; j++) {
        const o = tr.cars[j];
        if (Math.hypot(c.x - o.x, c.z - o.z) > 6) continue;
        // 2D separating-axis overlap of the two footprints (half 0.93 x 2.2).
        const axes = [[c.fx, c.fz], [-c.fz, c.fx], [o.fx, o.fz], [-o.fz, o.fx]];
        let sep = -Infinity;
        for (const [ax, az] of axes) {
          const proj = (q: typeof c) => Math.abs(q.fx * ax + q.fz * az) * 2.2 + Math.abs(-q.fz * ax + q.fx * az) * 0.93;
          const dd = Math.abs((o.x - c.x) * ax + (o.z - c.z) * az) - proj(c) - proj(o);
          sep = Math.max(sep, dd);
        }
        if (sep < 0 && minD >= 0) process.stdout.write(`HIST ${i}:\n${hist[i].slice(-25).join('\n')}\nHIST ${j}:\n${hist[j].slice(-25).join('\n')}\n`);
        if (sep < 0 && minD >= 0) process.stdout.write(`OVERLAP t=${(s * dt).toFixed(1)} A ${c.phase} ${c.x.toFixed(1)},${c.z.toFixed(1)} f${c.fx.toFixed(2)},${c.fz.toFixed(2)} v${c.v.toFixed(1)} n${c.ni},${c.nj} bb${c.blockedBy} | B ${o.phase} ${o.x.toFixed(1)},${o.z.toFixed(1)} f${o.fx.toFixed(2)},${o.fz.toFixed(2)} v${o.v.toFixed(1)} n${o.ni},${o.nj} bb${o.blockedBy}\n`);
        minD = Math.min(minD, sep);
      }
    }
  }
  process.stdout.write(`avgV ${(sumV / n).toFixed(1)} minGap ${minD.toFixed(2)} longestStop ${stuckMax.toFixed(1)}s offRoad ${offRoad}\n`);
});
