import { it } from 'vitest';
import { makeBike, run, settle, launchThrottle } from '../src/physics/sim';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { PRESETS } from '../src/vehicle/build';
import { emptyInput } from '../src/physics/bike';
import { flatWorld } from '../src/world/collision';
it('fast turning', () => {
  for (const p of PRESETS) {
    const bike = makeBike(computeVehicleSpec(p), flatWorld(20000, 'asphalt'), 'hyper');
    settle(bike, 1);
    run(bike, 30, (_t, b) => ({ ...emptyInput(), throttle: launchThrottle(b), lean: 1 }));
    const v0 = bike.speed;
    let maxLean = 0;
    run(bike, 12, (t) => ({ ...emptyInput(), throttle: 1, steer: Math.sin(t * 1.3) > 0 ? 1 : -1 }), (_t, b) => { maxLean = Math.max(maxLean, Math.abs(b.lean)); });
    process.stdout.write(`\n${p.id} v0=${(v0 * 3.6).toFixed(0)} after=${(bike.speed * 3.6).toFixed(0)} maxLean=${maxLean.toFixed(2)} crashed=${bike.crashed} rightings=${bike.rightings} finite=${Number.isFinite(bike.pos.x)}`);
  }
});
