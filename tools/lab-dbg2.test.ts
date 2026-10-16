import { it } from 'vitest';
import { makeBike, run, settle, launchThrottle } from '../src/physics/sim';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { PRESETS } from '../src/vehicle/build';
import { emptyInput } from '../src/physics/bike';
import { flatWorld } from '../src/world/collision';
it('dbg', () => {
  const p = PRESETS[Number(process.env.P ?? 1)];
  const bike = makeBike(computeVehicleSpec(p), flatWorld(8000, 'asphalt'), (process.env.M ?? 'hyper') as any);
  settle(bike, 1);
  let next = 0;
  run(bike, 40, (_t, b) => ({ ...emptyInput(), throttle: launchThrottle(b), lean: 1 }), (t, b) => {
    if (t >= next) { next += 2; process.stdout.write(`\n${t.toFixed(0)}s v=${(b.speed*3.6).toFixed(0)} pitch=${b.pitch.toFixed(2)} lim=${b.pt.limiter} T=${b.pt.torque.toFixed(0)} rpm=${b.pt.rpm.toFixed(0)} temp=${b.pt.motorTemp.toFixed(0)} slip=${b.rear.slipRatio.toFixed(2)} fg=${b.front.grounded} crashed=${b.crashed}`); }
  });
});
