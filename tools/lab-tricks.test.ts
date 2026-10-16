import { it } from 'vitest';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { PRESETS } from '../src/vehicle/build';
import { makeBike, run, settle } from '../src/physics/sim';
import { emptyInput } from '../src/physics/bike';
import { flatWorld } from '../src/world/collision';
it('tricks', () => {
  for (const p of PRESETS) {
    for (const hold of [1.0, 2.0, 3.0, 6.0]) {
      const bike = makeBike(computeVehicleSpec(p), flatWorld(3000, 'asphalt'));
      settle(bike);
      run(bike, 20, (_t, b) => ({ ...emptyInput(), throttle: Math.max(0, Math.min(1, (6 - b.speed) * 0.5)) }), (_t, b) => b.speed >= 5.5);
      let maxP = 0, t1 = -1;
      run(bike, hold, () => ({ ...emptyInput(), wheelie: 1 }), (t, b) => { maxP = Math.max(maxP, b.pitch); if (b.crashed && t1 < 0) t1 = t; });
      const atRelease = bike.pitch;
      run(bike, 3, () => emptyInput(), (t, b) => { if (b.crashed && t1 < 0) t1 = hold + t; });
      console.log(p.id, 'wheelie hold', hold, 'maxPitch', maxP.toFixed(2), 'atRelease', atRelease.toFixed(2), 'crash', bike.crashed ? `${bike.crashCause}@${t1.toFixed(2)}` : 'no', 'v', bike.speed.toFixed(1));
    }
    for (const hold of [1.0, 3.0]) {
      const bike = makeBike(computeVehicleSpec(p), flatWorld(3000, 'asphalt'));
      settle(bike);
      run(bike, 20, (_t, b) => ({ ...emptyInput(), throttle: Math.max(0, Math.min(1, (12 - b.speed) * 0.5)) }), (_t, b) => b.speed >= 11.5);
      let minP = 0;
      run(bike, hold, () => ({ ...emptyInput(), stoppie: 1 }), (_t, b) => { minP = Math.min(minP, b.pitch); });
      run(bike, 2, () => emptyInput());
      console.log(p.id, 'stoppie hold', hold, 'minPitch', minP.toFixed(2), 'crash', bike.crashed ? bike.crashCause : 'no', 'v', bike.speed.toFixed(1));
    }
  }
});
