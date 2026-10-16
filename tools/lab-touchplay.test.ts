import { it } from 'vitest';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { PRESETS } from '../src/vehicle/build';
import { makeBike, settle } from '../src/physics/sim';
import { emptyInput } from '../src/physics/bike';
import { flatWorld, CollisionWorld } from '../src/world/collision';
import { generateWorld } from '../src/world/layout';
import { mulberry32 } from '../src/core/noise';
import type { SurfaceId } from '../src/vehicle/parts';

// A "phone player": jabs the throttle pad, swings the stick fully left/right, brakes now and then.
function play(presetIdx: number, surface: SurfaceId | 'world', seed: number, seconds = 60, assist = 0.65) {
  let world: CollisionWorld;
  if (surface === 'world') {
    const d = generateWorld();
    world = new CollisionWorld(d.terrain);
    for (const b of d.boxes) world.addBox(b);
  } else world = flatWorld(4000, surface);
  const bike = makeBike(computeVehicleSpec(PRESETS[presetIdx]), world, (process.env.RIDEMODE ?? 'sport') as 'sport');
  bike.assist = assist;
  if (surface === 'world') {
    const sp = (process.env.SPAWN ?? '110,0,1.5708').split(',').map(Number);
    bike.place(sp[0], sp[1], sp[2]);
  }
  settle(bike);
  const r = mulberry32(seed);
  let tThr = 0, tSteer = 0, tBrake = 0;
  let thrT = 0.8, steerT = 0, brakeF = 0, brakeR = 0;
  const s = { throttle: 0, frontBrake: 0, rearBrake: 0, steer: 0, lean: 0 };
  const approach = (c: number, t: number, rate: number, dt: number) => c + Math.max(-rate * dt, Math.min(rate * dt, t - c));
  const dt = 1 / 240;
  const causes: string[] = [];
  let crashes = 0, maxV = 0;
  for (let i = 0; i < seconds * 240; i++) {
    tThr -= dt; tSteer -= dt; tBrake -= dt;
    if (tThr <= 0) { tThr = 0.5 + r() * 2.5; thrT = r() < 0.2 ? 0 : 0.45 + r() * 0.55; }
    if (tSteer <= 0) { tSteer = 0.3 + r() * 1.5; steerT = r() < 0.35 ? 0 : (r() < 0.5 ? -1 : 1) * (0.4 + r() * 0.6); }
    if (tBrake <= 0) { tBrake = 1 + r() * 3; brakeF = r() < 0.15 ? 1 : 0; brakeR = r() < 0.12 ? 1 : 0; }
    s.throttle = approach(s.throttle, brakeF ? 0 : thrT, 30, dt);
    s.frontBrake = approach(s.frontBrake, brakeF, 30, dt);
    s.rearBrake = approach(s.rearBrake, brakeR, 14, dt);
    s.steer = approach(s.steer, steerT, 12, dt);
    bike.step({ ...emptyInput(), ...s });
    maxV = Math.max(maxV, bike.speed);
    for (const e of bike.events) if (e.type === 'crash') { crashes++; causes.push(`${e.cause}@${(i / 240).toFixed(1)}s v=${e.speed.toFixed(1)}`); }
    bike.events.length = 0;
    if (bike.wantsReset) bike.reset();
  }
  return { crashes, causes, maxV };
}

it('phone-player crash rate', () => {
  const surfaces = (process.env.SURF ?? 'asphalt,dirt,grass,world').split(',') as (SurfaceId | 'world')[];
  const assist = Number(process.env.ASSIST ?? 0.65);
  let total = 0;
  for (const surf of surfaces) for (let p = 0; p < PRESETS.length; p++) {
    const r = play(p, surf, 11 + p, 60, assist);
    total += r.crashes;
    console.log(surf.padEnd(8), PRESETS[p].id.padEnd(8), 'crashes/min', r.crashes, 'maxV', r.maxV.toFixed(1), r.causes.slice(0, 4).join(' | '));
  }
  console.log('TOTAL', total);
});
