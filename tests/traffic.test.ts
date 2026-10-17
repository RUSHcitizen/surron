import { describe, expect, it } from 'vitest';
import { CollisionWorld, flatWorld } from '../src/world/collision';
import { generateWorld } from '../src/world/layout';
import { CAR, Traffic } from '../src/world/traffic';
import { makeBike, run, settle } from '../src/physics/sim';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { defaultBuild } from '../src/vehicle/build';
import { emptyInput } from '../src/physics/bike';
import type { BikeDynamics } from '../src/physics/bike';

const cruise = (target: number) => (b: BikeDynamics) => Math.max(0, Math.min(1, (target - b.speed) * 0.6 + 0.12));

/** Footprint overlap of two cars (2D separating axes); > 0 = clear by that much. */
function gap(a: Traffic['cars'][number], b: Traffic['cars'][number]) {
  let sep = -Infinity;
  for (const [ax, az] of [[a.fx, a.fz], [-a.fz, a.fx], [b.fx, b.fz], [-b.fz, b.fx]]) {
    const proj = (q: typeof a) => Math.abs(q.fx * ax + q.fz * az) * CAR.length / 2 + Math.abs(-q.fz * ax + q.fx * az) * CAR.width / 2;
    sep = Math.max(sep, Math.abs((b.x - a.x) * ax + (b.z - a.z) * az) - proj(a) - proj(b));
  }
  return sep;
}

describe('city traffic', () => {
  it('flows around the grid for 5 minutes: on the roads, no collisions between cars, no gridlock', () => {
    const d = generateWorld();
    const world = new CollisionWorld(d.terrain);
    const tr = new Traffic(world, 30);
    const dt = 1 / 30;
    const stopped = tr.cars.map(() => 0);
    let minGap = Infinity, longest = 0, offRoad = 0, sumV = 0, n = 0;
    for (let s = 0; s < 300 / dt; s++) {
      tr.update(dt, 9999, 9999, 0, 0);
      tr.cars.forEach((c, i) => {
        sumV += c.v; n++;
        stopped[i] = c.v < 0.3 ? stopped[i] + dt : 0;
        longest = Math.max(longest, stopped[i]);
        if (d.terrain.surfaceAt(c.x, c.z) !== 'asphalt') offRoad++;
        for (let j = i + 1; j < tr.cars.length; j++) if (Math.hypot(c.x - tr.cars[j].x, c.z - tr.cars[j].z) < 6) minGap = Math.min(minGap, gap(c, tr.cars[j]));
      });
    }
    expect(offRoad).toBe(0);
    expect(minGap).toBeGreaterThan(0.3);
    expect(longest).toBeLessThan(25);
    expect(sumV / n).toBeGreaterThan(6);
  });

  it('a car brakes for a bike stopped in its lane', () => {
    const d = generateWorld();
    const world = new CollisionWorld(d.terrain);
    const tr = new Traffic(world, 1);
    const c = tr.cars[0];
    // Start of a block at cruising speed; park the "bike" 35 m ahead in the car's lane.
    c.u = 0.02;
    c.v = c.vmax;
    tr.update(1 / 30, 9999, 9999, 0, 0);
    const bx = c.x + c.fx * 35, bz = c.z + c.fz * 35;
    let minD = Infinity, horn = false;
    for (let s = 0; s < 300; s++) {
      tr.update(1 / 30, bx, bz, 0, 0);
      minD = Math.min(minD, Math.hypot(c.x - bx, c.z - bz));
      if (tr.events.some((e) => e.type === 'horn')) horn = true;
      tr.events.length = 0;
    }
    expect(minD).toBeGreaterThan(CAR.length / 2 + 0.5);
    expect(horn).toBe(true);
  });

  it('hitting a car at 30+ mph is a crash; a slow bump is not', () => {
    for (const [v, crash] of [[7, false], [18, true]] as const) {
      const world = flatWorld(600);
      const car = world.addDynamic(CAR.width, CAR.height, CAR.length, 'car');
      // A car parked across the road 120 m ahead.
      world.setPose(car, 0, CAR.height / 2, 120, Math.PI / 2, 0, 0);
      const bike = makeBike(computeVehicleSpec(defaultBuild()), world);
      settle(bike);
      let touched = 0;
      run(bike, 30, () => ({ ...emptyInput(), throttle: cruise(v)(bike) }), (_t, b) => {
        touched = Math.max(touched, b.carContact);
        return b.crashed || b.pos.z > 118;
      });
      run(bike, 2, () => ({ ...emptyInput(), throttle: cruise(v)(bike) }), (_t, b) => { touched = Math.max(touched, b.carContact); return b.crashed; });
      expect(touched, `contact at ${v} m/s`).toBeGreaterThan(0);
      expect(bike.crashed, `at ${v} m/s`).toBe(crash);
    }
  });

  it('a car driving into a stopped bike at speed knocks it down (closing speed counts)', () => {
    const world = flatWorld(600);
    const car = world.addDynamic(CAR.width, CAR.height, CAR.length, 'car');
    const bike = makeBike(computeVehicleSpec(defaultBuild()), world);
    settle(bike);
    let z = -40;
    run(bike, 4, () => {
      z += 15 / 240;
      world.setPose(car, 0, CAR.height / 2, z, 0, 0, 15);
      return { ...emptyInput(), frontBrake: 0.3, rearBrake: 0.3 };
    }, (_t, b) => b.crashed);
    expect(bike.crashed).toBe(true);
  });
});
