import { it } from 'vitest';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { PRESETS } from '../src/vehicle/build';
import { makeBike, run, settle } from '../src/physics/sim';
import { emptyInput } from '../src/physics/bike';
import { flatWorld } from '../src/world/collision';
it('hop trace', () => {
  const p = PRESETS.find((q) => q.id === (process.env.P ?? 'varg'))!;
  const V = Number(process.env.V ?? 20);
  const bike = makeBike(computeVehicleSpec(p), flatWorld(4000, 'asphalt'));
  settle(bike);
  const cruise = (b: typeof bike) => Math.max(0, Math.min(1, (V - b.speed) * 0.5));
  run(bike, 20, (_t, b) => ({ ...emptyInput(), throttle: cruise(b) }), (_t, b) => b.speed >= V - 0.3);
  run(bike, 0.6, (_t, b) => ({ ...emptyInput(), throttle: cruise(b), jump: 1 }));
  let k = 0;
  run(bike, 2.2, (t, b) => ({ ...emptyInput(), throttle: cruise(b), steer: t > 0.1 && t < 0.7 ? 1 : 0 }), (t, b) => {
    if (k++ % 12 === 0) process.stdout.write(`\nT ${t.toFixed(2)} y ${b.pos.y.toFixed(2)} vy ${b.vel.y.toFixed(1)} lean ${b.lean.toFixed(2)} pitch ${b.pitch.toFixed(2)} whip ${b.whip.toFixed(2)} yawRate ${b.yawRate.toFixed(2)} v ${b.speed.toFixed(1)} F${b.front.grounded ? 1 : 0}R${b.rear.grounded ? 1 : 0} body ${(b as any).bodyContact?.toFixed?.(2)}`);
  });
});
