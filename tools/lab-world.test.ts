import { test } from 'vitest';
import { generateWorld } from '../src/world/layout';
import { CollisionWorld } from '../src/world/collision';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { PRESETS } from '../src/vehicle/build';
import { BikeDynamics, emptyInput } from '../src/physics/bike';
import { run, launchThrottle } from '../src/physics/sim';

test('world', () => {
  let t = performance.now();
  const wd = generateWorld();
  console.log('gen ms', (performance.now() - t).toFixed(0), 'boxes', wd.boxes.length, 'trees', wd.trees.length, 'markings', wd.markings.length, 'track pts', wd.track.points.length);
  const world = new CollisionWorld(wd.terrain);
  for (const b of wd.boxes) world.addBox(b);
  const spec = computeVehicleSpec(PRESETS[1]);
  const scen = (name: string, x: number, z: number, yaw: number, v: number, secs: number, lean = 0) => {
    const bike = new BikeDynamics(spec, world); bike.pt.drain = 'off';
    bike.place(x, z, yaw);
    let maxAir = 0, maxH = 0; const y0 = bike.pos.y;
    run(bike, secs, (_t, b) => ({ ...emptyInput(), throttle: Math.min(launchThrottle(b), Math.max(0, Math.min(1, (v - b.speed) * 0.6 + 0.15))), lean: b.airTime > 0 ? lean : 0.6 }), (_t, b) => { maxAir = Math.max(maxAir, b.airTime); maxH = Math.max(maxH, b.pos.y - y0); return b.crashed; });
    console.log(name, 'crashed', bike.crashed, bike.crashCause, 'maxAir', maxAir.toFixed(2), 'maxRise', maxH.toFixed(2), 'v', bike.speed.toFixed(1), 'pos', bike.pos.x.toFixed(0), bike.pos.z.toFixed(0));
  };
  t = performance.now();
  scen('hub->kicker', -20, -25, 0, 10, 4);
  scen('curb', -50, -120, Math.PI/2*-1, 6, 4);
  scen('stunt big', wd.spawns.stunt.x + 50 + 0, wd.spawns.stunt.z, 0, 16, 5);
  scen('stunt small', wd.spawns.stunt.x, wd.spawns.stunt.z, 0, 9, 4);
  const tr = wd.spawns.track; scen('track', tr.x, tr.z, tr.yaw, 12, 8);
  console.log('sim ms', (performance.now() - t).toFixed(0));
});
