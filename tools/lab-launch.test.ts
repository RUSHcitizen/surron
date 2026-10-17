import { it } from 'vitest';
import { makeBike, run, settle } from '../src/physics/sim';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { PRESETS } from '../src/vehicle/build';
import { emptyInput } from '../src/physics/bike';
import { flatWorld } from '../src/world/collision';
// Launch trace for one preset (P = index): throttle, slip, pitch, front load, limiter.
it('launch', () => {
  const bike = makeBike(computeVehicleSpec(PRESETS[Number(process.env.P ?? 0)]), flatWorld(4000, (process.env.SURF ?? 'asphalt') as 'asphalt'), (process.env.RIDEMODE ?? 'sport') as 'sport');
  bike.assist = 0.85; settle(bike);
  let thr = 0, tr = '';
  run(bike, 4, () => ({ ...emptyInput(), throttle: (thr = Math.min(1, thr + 5 / 240)) }), (t, b) => {
    if (Math.round(t * 240) % 24 === 0) tr += `${t.toFixed(1)} ${(b.speed * 3.6).toFixed(0)}kmh eff${b.effThrottle.toFixed(2)} T${b.pt.torque.toFixed(0)} slip${b.rear.slipRatio.toFixed(2)} p${b.pitch.toFixed(2)} fL${b.front.load.toFixed(0)} rL${b.rear.load.toFixed(0)} ${b.pt.limiter}\n`;
  });
  process.stdout.write(tr);
});
