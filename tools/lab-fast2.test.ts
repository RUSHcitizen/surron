import { it } from 'vitest';
import { makeBike, run, settle, launchThrottle } from '../src/physics/sim';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { PRESETS } from '../src/vehicle/build';
import { emptyInput } from '../src/physics/bike';
import { flatWorld } from '../src/world/collision';
it('fast turning trace', () => {
  const p = PRESETS[Number(process.env.P ?? 3)];
  const bike = makeBike(computeVehicleSpec(p), flatWorld(20000, 'asphalt'), 'hyper');
  settle(bike, 1);
  run(bike, 30, (_t, b) => ({ ...emptyInput(), throttle: launchThrottle(b), lean: 1 }));
  let next = 0;
  run(bike, Number(process.env.T ?? 6), (t) => ({ ...emptyInput(), throttle: 1, steer: Math.sin(t * 1.3) > 0 ? 1 : -1 }), (t, b) => {
    if (t >= next) { next += 0.2; process.stdout.write(`\n${t.toFixed(1)} v=${(b.speed*3.6).toFixed(0)} lean=${b.lean.toFixed(2)} max=${b.maxLeanNow.toFixed(2)} tgt=${b.leanTarget.toFixed(2)} pitch=${b.pitch.toFixed(2)} fg=${b.front.grounded} rg=${b.rear.grounded} rslip=${b.rear.slipAngle.toFixed(2)} fslide=${b.front.slide.toFixed(2)} rslide=${b.rear.slide.toFixed(2)}`); }
  });
});
