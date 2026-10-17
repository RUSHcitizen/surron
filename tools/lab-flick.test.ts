import { it } from 'vitest';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { PRESETS } from '../src/vehicle/build';
import { launchThrottle, makeBike, run, settle } from '../src/physics/sim';
import { emptyInput } from '../src/physics/bike';
import { flatWorld } from '../src/world/collision';
// Full-lock flicks at full throttle in Hyper: max lean, when it happens, slip.
it('flick', () => {
  for (const p of PRESETS.filter((x) => !process.env.ONLY || x.id === process.env.ONLY)) {
    const bike = makeBike(computeVehicleSpec(p), flatWorld(20000, 'asphalt'), 'hyper');
    settle(bike, 1);
    run(bike, 25, (_t, b) => ({ ...emptyInput(), throttle: launchThrottle(b), lean: 1 }));
    let maxLean = 0, at = 0, v = 0, slip = 0;
    run(bike, 10, (t) => ({ ...emptyInput(), throttle: 1, steer: Math.sin(t * 1.3) > 0 ? 1 : -1 }), (t, b) => {
      if (process.env.TRACE && t > 2.0 && t < 3.0 && Math.round(t * 240) % 12 === 0) process.stdout.write(`\nT ${t.toFixed(2)} lean ${b.lean.toFixed(2)} tgt ${b.leanTarget.toFixed(2)} maxNow ${b.maxLeanNow.toFixed(2)} yaw ${b.yawRate.toFixed(2)} v ${b.speed.toFixed(1)} F${b.front.grounded ? 1 : 0}R${b.rear.grounded ? 1 : 0} fs ${b.front.slide.toFixed(2)} rs ${b.rear.slipAngle.toFixed(2)}`);
      if (Math.abs(b.lean) > maxLean) { maxLean = Math.abs(b.lean); at = t; v = b.speed; slip = b.rear.slipAngle; }
    });
    process.stdout.write(`\nFLICK ${p.id} maxLean ${maxLean.toFixed(2)} at ${at.toFixed(2)} v ${v.toFixed(1)} rearSlip ${slip.toFixed(2)} crashed ${bike.crashed}`);
  }
});
