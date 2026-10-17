import { it } from 'vitest';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { PRESETS } from '../src/vehicle/build';
import { makeBike, run, settle } from '../src/physics/sim';
import { emptyInput } from '../src/physics/bike';
import { flatWorld } from '../src/world/collision';
// Bunny hop heights (tap vs charged), whip angle and poses in the air.
it('hop', () => {
  for (const p of PRESETS) {
    for (const [hold, V] of [[0.05, 8], [0.6, 8], [0.6, 20], [0, 0]] as const) {
      const bike = makeBike(computeVehicleSpec(p), flatWorld(4000, 'asphalt'));
      settle(bike);
      if (V > 0) run(bike, 20, (_t, b) => ({ ...emptyInput(), throttle: Math.max(0, Math.min(1, (V - b.speed) * 0.5)) }), (_t, b) => b.speed >= V - 0.3);
      const y0 = bike.pos.y;
      let maxH = 0, air = 0, maxLean = 0, poseMax = 0;
      const cruise = (b: typeof bike) => Math.max(0, Math.min(1, (V - b.speed) * 0.5));
      run(bike, hold, (_t, b) => ({ ...emptyInput(), throttle: cruise(b), jump: 1 }));
      run(bike, 3, (t, b) => ({ ...emptyInput(), throttle: cruise(b), steer: process.env.TRK === 'whip' && t > 0.1 && t < 0.7 ? 1 : 0, trick: process.env.TRK === 'pose' && t > 0.15 && t < 0.6 ? 1 : 0 }), (_t, b) => {
        maxH = Math.max(maxH, b.pos.y - y0);
        if (!b.front.grounded && !b.rear.grounded) air += 1 / 240;
        maxLean = Math.max(maxLean, Math.abs(b.lean));
        poseMax = Math.max(poseMax, b.trickAmt);
      });
      process.stdout.write(`\nHOP ${p.id} hold ${hold} v ${V}: height ${maxH.toFixed(2)} m air ${air.toFixed(2)} s whipLean ${maxLean.toFixed(2)} pose ${poseMax.toFixed(2)} last ${JSON.stringify(bike.airLast)} crashed ${bike.crashed} lean ${bike.lean.toFixed(2)} v ${bike.speed.toFixed(1)}`);
    }
  }
});
