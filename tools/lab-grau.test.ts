import { it } from 'vitest';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { PRESETS } from '../src/vehicle/build';
import { makeBike, run, settle } from '../src/physics/sim';
import { emptyInput } from '../src/physics/bike';
import { flatWorld } from '../src/world/collision';
// Long held wheelies: stability, speed, steering on the back wheel, stick height control.
it('grau', () => {
  for (const p of PRESETS) {
    for (const [V, lean, steer, thr] of [[6, 0, 0, 0], [14, 0, 0, 0], [14, 0, 0, 1], [10, 0, 0.6, 0], [10, -1, 0, 0], [10, 1, 0, 0], [20, 0, 0.5, 1]]) {
      const bike = makeBike(computeVehicleSpec(p), flatWorld(4000, 'asphalt'));
      settle(bike);
      run(bike, 20, (_t, b) => ({ ...emptyInput(), throttle: Math.max(0, Math.min(1, (V - b.speed) * 0.5)) }), (_t, b) => b.speed >= V - 0.5);
      let minP = 9, maxP = 0, air = 0, n = 0, yaw0 = bike.yaw, ct = -1;
      run(bike, 10, () => ({ ...emptyInput(), wheelie: 1, lean, steer, throttle: thr }), (t, b) => {
        if (t > 2) { minP = Math.min(minP, b.pitch); maxP = Math.max(maxP, b.pitch); n++; if (!b.front.grounded) air++; }
        if (b.crashed && ct < 0) ct = t;
      });
      const turned = bike.yaw - yaw0;
      process.stdout.write(`\n${p.id} V${V} lean${lean} steer${steer} thr${thr}: pitch ${minP.toFixed(2)}..${maxP.toFixed(2)} frontUp ${(air / Math.max(1, n) * 100).toFixed(0)}% v ${(bike.speed * 3.6).toFixed(0)}kmh yaw ${(turned).toFixed(2)} crash ${bike.crashed ? bike.crashCause + '@' + ct.toFixed(1) : 'no'}`);
    }
  }
});
