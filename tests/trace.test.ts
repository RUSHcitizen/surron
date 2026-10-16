import { test } from 'vitest';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { defaultBuild } from '../src/vehicle/build';
import { makeBike, run, settle } from '../src/physics/sim';
import { emptyInput } from '../src/physics/bike';
import { Vector3 } from 'three';
const d = (r: number) => (r * 57.3).toFixed(1);
test('trace', () => {
  const spec = computeVehicleSpec(defaultBuild());
  const bike = makeBike(spec); settle(bike);
  const v = Number(process.env.V ?? 11.1);
  run(bike, 20, (_t, b) => ({ ...emptyInput(), throttle: Math.max(0, Math.min(1, (v - b.speed) * 0.6 + 0.12)) }), (_t,b)=> b.speed >= v);
  run(bike, Number(process.env.DUR ?? 3), (_t, b) => ({ ...emptyInput(), throttle: Math.max(0, Math.min(1, (v - b.speed) * 0.6 + 0.12)), steer: 1 }), (t,b)=>{
    if (Math.round(t*240)%Number(process.env.EVERY ?? 12)===0) console.log(t.toFixed(2), `lean ${d(b.lean)} lt ${d(b.leanTarget)} rr ${b.angVel.dot(new Vector3(0,0,1).applyQuaternion(b.quat)).toFixed(2)} steer ${d(b.steer)} cmd ${d(b.steerCmd)} v ${b.speed.toFixed(1)} aF ${d(b.front.slipAngle)} aR ${d(b.rear.slipAngle)} sF ${b.front.slide.toFixed(2)} sR ${b.rear.slide.toFixed(2)} NF ${b.front.load.toFixed(0)} NR ${b.rear.load.toFixed(0)} FyF ${b.front.latForce.toFixed(0)} FyR ${b.rear.latForce.toFixed(0)} yaw ${b.yawRate.toFixed(2)} ${b.crashed ? 'CRASH ' + b.crashCause : ''}`);
    return b.crashed; });
});
