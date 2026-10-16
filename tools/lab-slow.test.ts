import { it } from 'vitest';
import { makeBike, run, settle } from '../src/physics/sim';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { defaultBuild } from '../src/vehicle/build';
import { emptyInput } from '../src/physics/bike';
it('throttle + steer from rest', () => {
  for (const rule of ['arcade', 'realistic'] as const) for (const steer of [0, 0.3, 0.62, 1]) {
    const bike = makeBike(computeVehicleSpec(defaultBuild()));
    bike.assist = 0.85;
    bike.crashRule = rule;
    settle(bike);
    let trace = '';
    run(bike, 4, (t) => ({ ...emptyInput(), throttle: 1, steer: t > 0.3 ? steer : 0 }), (t, b) => { if (Math.abs(t % 1) < 1 / 240) trace += ` ${t.toFixed(0)}s:${(b.speed * 3.6).toFixed(0)}km/h thr=${b.effThrottle.toFixed(2)} lean=${b.lean.toFixed(2)} pitch=${b.pitch.toFixed(2)} r=${b.righting}`; });
    process.stdout.write(`\n${rule} steer ${steer}:${trace}`);
  }
  process.stdout.write('\n');
});
