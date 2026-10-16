import { test } from 'vitest';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { defaultBuild, PRESETS } from '../src/vehicle/build';
import { makeBike, run, settle, accelTest, brakeTest, turnTest } from '../src/physics/sim';
import { emptyInput, BikeDynamics } from '../src/physics/bike';
import { flatWorld } from '../src/world/collision';
import { Vector3 } from 'three';

const d = (r: number) => (r * 57.3).toFixed(1);
const which = (process.env.SCEN ?? 'all').split(',');
const on = (n: string) => which.includes('all') || which.includes(n);
const st = (b: BikeDynamics) => `lean ${d(b.lean)} lt ${d(b.leanTarget)} rr ${b.angVel.dot(new Vector3(0,0,1).applyQuaternion(b.quat)).toFixed(2)} pitch ${d(b.pitch)} steer ${d(b.steer)} v ${b.speed.toFixed(1)} aF ${d(b.front.slipAngle)} aR ${d(b.rear.slipAngle)} kR ${b.rear.slipRatio.toFixed(2)} NF ${b.front.load.toFixed(0)} NR ${b.rear.load.toFixed(0)} FyF ${b.front.latForce.toFixed(0)} FyR ${b.rear.latForce.toFixed(0)} g ${+b.front.grounded}${+b.rear.grounded} yaw ${b.yawRate.toFixed(2)} ${b.crashed ? 'CRASH ' + b.crashCause : ''}`;
const cruise = (target: number) => (_t: number, b: BikeDynamics) => Math.max(0, Math.min(1, (target - b.speed) * 0.6 + 0.12));

test('explore', () => {
  if (on('presets')) for (const b of PRESETS) {
    const spec = computeVehicleSpec(b);
    const bike = makeBike(spec); settle(bike, 1.5);
    console.log(b.name, 'mass', spec.mass.toFixed(1), 'pitch', d(bike.pitch), 'sagF', (bike.front.compression/spec.front.travel).toFixed(2), 'sagR', (bike.rear.compression/spec.rear.travel).toFixed(2),
      '\n   accel', JSON.stringify(accelTest(spec)), '\n   brake', JSON.stringify(brakeTest(spec)));
  }
  const spec = computeVehicleSpec(defaultBuild());
  if (on('turn')) for (const [kmh, s] of [[10, 1], [20, 0.5], [20, 1], [40, 0.5], [40, 1], [60, 1], [80, 1]]) {
    const t = turnTest(spec, kmh, s);
    console.log('turn', kmh, s, 'crash', t.crashed, t.bike.crashCause, 'maxLean', d(t.maxLean), 'lean', d(t.lean), 'R', t.radius.toFixed(1), 'v', (t.speed*3.6).toFixed(1), 'theory lean', d(Math.atan(t.speed*t.speed/(9.81*t.radius))));
  }
  if (on('slalom')) for (const v of [8, 11, 16]) {
    const bike = makeBike(spec); settle(bike);
    run(bike, 20, (t, b) => ({ ...emptyInput(), throttle: cruise(v)(t, b) }), (_t,b)=> b.speed >= v);
    let maxLean = 0;
    run(bike, 8, (t, b) => ({ ...emptyInput(), throttle: cruise(v)(t,b), steer: Math.sin(t * 2.5) > 0 ? 1 : -1 }), (t,b)=>{ maxLean=Math.max(maxLean,Math.abs(b.lean)); if (process.env.TRACE && Math.round(t*240)%12===0) console.log('slalom', v, t.toFixed(2), st(b)); return b.crashed; });
    console.log('slalom', v, 'maxLean', d(maxLean), 'crashed', bike.crashed, bike.crashCause, 'v', bike.speed.toFixed(1));
  }
  if (on('drift')) for (const [name, surf, entry, v0, preset] of [['brake-tap', 'asphalt', 'brake', 7, 3], ['power', 'dirt', 'power', 8, 3], ['power-tc', 'dirt', 'power', 8, 1], ['brake-tap', 'dirt', 'brake', 9, 3], ['brake-tap-mx', 'dirt', 'brake', 9, 4], ['power', 'grass', 'power', 8, 3]] as const) {
    const bike = makeBike(computeVehicleSpec(PRESETS[preset]), flatWorld(2000, surf)); settle(bike);
    run(bike, 20, (t, b) => ({ ...emptyInput(), throttle: b.front.grounded ? cruise(v0)(t, b) : 0, lean: 1 }), (_t,b)=> b.speed >= v0 || b.crashed);
    let maxSlip = 0, slipTime = 0;
    run(bike, 7, (t, b) => {
      if (entry === 'brake' && t < 0.25) return { ...emptyInput(), steer: 0.8, rearBrake: 1 };
      const slip = Math.abs(b.rear.slipAngle);
      const thr = Math.max(0, Math.min(1, 0.65 + (0.5 - slip) * 2.2 - Math.abs(b.yawRate) * 0.1));
      return { ...emptyInput(), throttle: thr, steer: 0.7 };
    }, (t,b)=>{ maxSlip=Math.max(maxSlip,Math.abs(b.rear.slipAngle)); if (Math.abs(b.rear.slipAngle) > 0.2 && b.speed > 2) slipTime += 1/240; if (process.env.TRACE && Math.round(t*240)%Number(process.env.EVERY ?? 48)===0) console.log('drift', name, surf, t.toFixed(2), st(b)); return b.crashed; });
    console.log('drift', name, surf, 'maxSlip', d(maxSlip), 'slipTime(>11deg,>2m/s)', slipTime.toFixed(2), 'crashed', bike.crashed, bike.crashCause, 'v', bike.speed.toFixed(1));
  }
  if (on('wheelie')) {
    const bike = makeBike(spec); settle(bike);
    let wt = 0, maxP = 0;
    run(bike, 8, (_t, b) => { const pr = b.angVel.dot(new Vector3(1,0,0).applyQuaternion(b.quat)); const target = 0.5;
      return { ...emptyInput(), throttle: b.front.grounded ? 1 : Math.max(0, Math.min(1, 0.6 + (target - b.pitch) * 3 + pr * 1.2)), lean: b.pitch < 0.15 ? -1 : 0, rearBrake: b.pitch > target + 0.15 ? 1 : 0 }; }, (t,b)=>{ maxP=Math.max(maxP,b.pitch); if (!b.front.grounded && b.rear.grounded) wt += 1/240; if (process.env.TRACE && Math.round(t*240)%24===0) console.log('wheelie', t.toFixed(2), st(b)); return b.crashed; });
    console.log('wheelie time', wt.toFixed(2), 'maxPitch', d(maxP), 'crash', bike.crashed, bike.crashCause, 'v', bike.speed.toFixed(1));
  }
  if (on('uturn')) {
    const bike = makeBike(spec); settle(bike);
    let yaw = 0;
    run(bike, 8, (t, b) => ({ ...emptyInput(), throttle: cruise(3)(t, b), steer: 1 }), (t,b)=>{ yaw += b.yawRate/240; if (process.env.TRACE && Math.round(t*240)%60===0) console.log('uturn', t.toFixed(2), st(b)); return b.crashed; });
    console.log('uturn yaw', d(yaw), 'crash', bike.crashed, 'lean', d(bike.lean));
  }
});
