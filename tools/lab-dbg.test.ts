import { test } from 'vitest';
import { generateWorld } from '../src/world/layout';
import { CollisionWorld } from '../src/world/collision';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { PRESETS } from '../src/vehicle/build';
import { BikeDynamics, emptyInput } from '../src/physics/bike';
import { launchThrottle } from '../src/physics/sim';
import { Vector3 } from 'three';
test('dbg', () => {
  const wd = generateWorld();
  const world = new CollisionWorld(wd.terrain);
  for (const b of wd.boxes) world.addBox(b);
  const bike = new BikeDynamics(computeVehicleSpec(PRESETS[Number(process.env.P ?? 1)]), world);
  bike.place(-20, -25, 0);
  const v = Number(process.env.V ?? 10);
  for (let i = 0; i < 240 * 4; i++) {
    const b = bike;
    bike.step({ ...emptyInput(), throttle: Math.min(launchThrottle(b), Math.max(0, Math.min(1, (v - b.speed) * 0.6 + 0.15))), lean: b.airTime > 0 ? 0 : 0.6 });
    if (i % 12 === 0 && bike.pos.z > -16) console.log((i/240).toFixed(2), 'z', bike.pos.z.toFixed(2), 'y', bike.pos.y.toFixed(2), 'pitch', (bike.pitch*57.3).toFixed(1), 'pr', bike.angVel.dot(new Vector3(1,0,0).applyQuaternion(bike.quat)).toFixed(2), 'v', bike.speed.toFixed(1), 'g', +bike.front.grounded, +bike.rear.grounded, 'cF', bike.front.compression.toFixed(2), 'cR', bike.rear.compression.toFixed(2), 'NF', bike.front.load.toFixed(0), 'NR', bike.rear.load.toFixed(0), bike.crashed ? bike.crashCause : '');
    bike.events.length = 0;
    if (bike.crashed) break;
  }
});
