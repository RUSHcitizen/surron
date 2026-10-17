import { it } from 'vitest';
import { makeBike, run, settle } from '../src/physics/sim';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { PRESETS } from '../src/vehicle/build';
import { emptyInput } from '../src/physics/bike';
import { flatWorld } from '../src/world/collision';
import type { SurfaceId } from '../src/vehicle/parts';
// Turn-in metrics: steer step at a cruise speed (input ramped like keyboard / touch), reports
// time to 50% / 90% of the steady yaw rate, the steady turn radius, overshoot and lean.
it('steer', () => {
  const surf = (process.env.SURF ?? 'asphalt') as SurfaceId;
  const dev = process.env.DEV ?? 'touch';
  for (const p of PRESETS.filter((x) => !process.env.ONLY || x.id === process.env.ONLY)) for (const v of [8, 15, 25, 40]) {
    const bike = makeBike(computeVehicleSpec(p), flatWorld(6000, surf), (process.env.RIDEMODE ?? 'sport') as 'sport');
    bike.assist = 0.85; bike.crashRule = 'arcade';
    settle(bike);
    const cruise = (b: typeof bike) => Math.max(0, Math.min(1, (v - b.speed) * 0.6 + 0.15));
    run(bike, 30, (_t, b) => ({ ...emptyInput(), throttle: cruise(b) }), (_t, b) => b.speed >= v);
    run(bike, 1, (_t, b) => ({ ...emptyInput(), throttle: cruise(b) }));
    let s = 0; const yaw: number[] = []; let maxLean = 0;
    const dt = 1 / 240;
    run(bike, 4, () => {
      const rate = dev === 'touch' ? 12 / (1 + v / 18) : 4.5 - Math.min(2, v / 15);
      s = Math.min(1, s + rate * dt);
      return { ...emptyInput(), throttle: cruise(bike), steer: s };
    }, (_t, b) => { yaw.push(-b.yawRate); maxLean = Math.max(maxLean, Math.abs(b.lean)); });
    const ss = yaw.slice(-240).reduce((a, x) => a + x, 0) / 240;
    const t50 = yaw.findIndex((y) => y > ss * 0.5) * dt, t90 = yaw.findIndex((y) => y > ss * 0.9) * dt;
    const peak = Math.max(...yaw); const wrong = Math.min(...yaw);
    const coord = Math.tan(Math.abs(bike.lean)) / Math.max(1e-3, (bike.speed * ss) / 9.81);
    process.stdout.write(`coord ${coord.toFixed(2)} ${p.id.padEnd(8)} v${String(v).padEnd(3)} t50 ${t50.toFixed(2)} t90 ${t90.toFixed(2)} R ${(bike.speed / Math.max(ss, 1e-3)).toFixed(1)}m yaw ${ss.toFixed(2)} over ${((peak / ss - 1) * 100).toFixed(0)}% wrong ${wrong.toFixed(2)} lean ${maxLean.toFixed(2)} v ${bike.speed.toFixed(1)} ${bike.crashed ? 'CRASH' : ''}\n`);
  }
});
