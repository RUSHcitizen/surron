/**
 * Headless simulation scenarios. Used by unit tests and by the garage "test bench",
 * which runs the real physics (not formulas) on a virtual flat surface.
 */
import { BikeDynamics, emptyInput } from './bike';
import type { BikeInput } from './bike';
import { TUNING } from './tuning';
import { computeVehicleSpec } from '../vehicle/spec';
import type { VehicleSpec } from '../vehicle/spec';
import type { BikeBuild, RideMode } from '../vehicle/build';
import { flatWorld } from '../world/collision';
import type { CollisionWorld } from '../world/collision';
import type { SurfaceId } from '../vehicle/parts';

export function makeBike(spec: VehicleSpec, world: CollisionWorld = flatWorld(), mode: RideMode = 'sport') {
  const bike = new BikeDynamics(spec, world);
  bike.pt.mode = mode;
  bike.pt.drain = 'off';
  bike.place(0, 0, 0);
  return bike;
}

export function settle(bike: BikeDynamics, seconds = 1.5) {
  const inp = emptyInput();
  inp.frontBrake = 0.3;
  inp.rearBrake = 0.3;
  run(bike, seconds, () => inp);
}

export function run(bike: BikeDynamics, seconds: number, script: (t: number, b: BikeDynamics) => BikeInput, onStep?: (t: number, b: BikeDynamics) => boolean | void) {
  const steps = Math.round(seconds / TUNING.dt);
  const t0 = bike.time;
  for (let i = 0; i < steps; i++) {
    const t = bike.time - t0;
    bike.step(script(t, bike));
    bike.events.length = 0;
    if (onStep && onStep(t, bike) === true) break;
  }
}

/** A drag-launch rider: full throttle, rolling off just enough to keep the front down. */
export function launchThrottle(b: BikeDynamics) {
  if (!b.front.grounded && b.pitch > 0.05) return Math.max(0, 1 - (b.pitch - 0.05) * 9);
  return 1;
}

export interface AccelResult {
  t0to50: number | null;
  t0to80: number | null;
  t100m: number | null;
  topSpeed: number;
  wheelieTime: number;
  crashed: boolean;
  energyWh: number;
}

/** Full-throttle launch with a light forward lean (keeps the front down, like a drag launch). */
export function accelTest(spec: VehicleSpec, surface: SurfaceId = 'asphalt', seconds = 20, mode: RideMode = 'sport'): AccelResult {
  const bike = makeBike(spec, flatWorld(4000, surface), mode);
  settle(bike, 1);
  const start = bike.pos.clone();
  const res: AccelResult = { t0to50: null, t0to80: null, t100m: null, topSpeed: 0, wheelieTime: 0, crashed: false, energyWh: 0 };
  const e0 = bike.pt.energyUsedWh;
  run(
    bike,
    seconds,
    (_t, b) => ({ ...emptyInput(), throttle: launchThrottle(b), lean: 1 }),
    (t, b) => {
      const kmh = b.speed * 3.6;
      if (res.t0to50 === null && kmh >= 50) res.t0to50 = t;
      if (res.t0to80 === null && kmh >= 80) res.t0to80 = t;
      if (res.t100m === null && b.pos.distanceTo(start) >= 100) res.t100m = t;
      res.topSpeed = Math.max(res.topSpeed, b.speed);
      if (!b.front.grounded && b.rear.grounded) res.wheelieTime += TUNING.dt;
      if (b.crashed) {
        res.crashed = true;
        return true;
      }
    },
  );
  res.energyWh = bike.pt.energyUsedWh - e0;
  return res;
}

export interface BrakeResult {
  distance: number;
  time: number;
  crashed: boolean;
  stoppie: boolean;
}

/** Steady 50 km/h, then full front + 70% rear with the rider's weight back (assist moderates the front). */
export function brakeTest(spec: VehicleSpec, surface: SurfaceId = 'asphalt', speedKmh = 50): BrakeResult {
  const bike = makeBike(spec, flatWorld(4000, surface), 'sport');
  settle(bike, 1);
  const target = speedKmh / 3.6;
  // Get up to speed.
  run(bike, 25, (_t, b) => ({ ...emptyInput(), throttle: b.speed < target ? launchThrottle(b) : 0.25, lean: 1 }), (_t, b) => b.speed >= target || b.crashed);
  const p0 = bike.pos.clone();
  const res: BrakeResult = { distance: 0, time: 0, crashed: bike.crashed, stoppie: false };
  if (bike.crashed) return res;
  run(
    bike,
    15,
    () => ({ ...emptyInput(), frontBrake: 1, rearBrake: 0.7, lean: -1 }),
    (t, b) => {
      res.time = t;
      if (!b.rear.grounded && b.front.grounded) res.stoppie = true;
      if (b.crashed) {
        res.crashed = true;
        return true;
      }
      return Math.hypot(b.vel.x, b.vel.z) < 0.3;
    },
  );
  res.distance = Math.hypot(bike.pos.x - p0.x, bike.pos.z - p0.z);
  return res;
}

/** Steady-state turning: hold a steering input at a cruise speed; returns turn radius and peak lean. */
export function turnTest(spec: VehicleSpec, speedKmh = 30, steer = 0.6, surface: SurfaceId = 'asphalt', rule: 'arcade' | 'realistic' = 'arcade') {
  const bike = makeBike(spec, flatWorld(4000, surface), 'sport');
  bike.crashRule = rule;
  settle(bike, 1);
  const target = speedKmh / 3.6;
  const cruise = (b: BikeDynamics) => Math.max(0, Math.min(1, (target - b.speed) * 0.6 + 0.12));
  run(bike, 20, (_t, b) => ({ ...emptyInput(), throttle: cruise(b) }), (_t, b) => b.speed >= target || b.crashed);
  let maxLean = 0;
  let sumYaw = 0;
  let n = 0;
  run(
    bike,
    6,
    (_t, b) => ({ ...emptyInput(), steer, throttle: cruise(b) }),
    (t, b) => {
      maxLean = Math.max(maxLean, Math.abs(b.lean));
      if (t > 3) {
        sumYaw += b.yawRate;
        n++;
      }
      return b.crashed;
    },
  );
  const yawRate = n ? sumYaw / n : 0;
  return {
    crashed: bike.crashed,
    maxLean,
    lean: bike.lean,
    yawRate,
    radius: Math.abs(yawRate) > 1e-3 ? Math.abs(bike.speed / yawRate) : Infinity,
    speed: bike.speed,
    bike,
  };
}

export interface BenchResult {
  accel: AccelResult;
  brake: BrakeResult;
  turn: { radius: number; lean: number; crashed: boolean };
  dirtAccel: AccelResult;
}

export function testBench(build: BikeBuild): BenchResult {
  const spec = computeVehicleSpec(build);
  const t = turnTest(spec, 35, 0.7);
  return {
    accel: accelTest(spec, 'asphalt', 16),
    brake: brakeTest(spec, 'asphalt'),
    turn: { radius: t.radius, lean: t.maxLean, crashed: t.crashed },
    dirtAccel: accelTest(spec, 'dirt', 8),
  };
}
