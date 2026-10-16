import { it } from 'vitest';
import { makeBike, run, settle } from '../src/physics/sim';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { PRESETS } from '../src/vehicle/build';
import type { RideMode } from '../src/vehicle/build';
import { emptyInput } from '../src/physics/bike';
import { flatWorld } from '../src/world/collision';
// Feel metrics: keyboard-style throttle (ramps like Input), measures launch times, how much
// the effective throttle chatters, longitudinal jerk and pitch bobbing.
it('feel', () => {
  const mode = (process.env.RIDEMODE ?? 'sport') as RideMode;
  for (const b of PRESETS) {
    for (const scen of ['straight', 'slalom']) {
      const bike = makeBike(computeVehicleSpec(b), flatWorld(4000, 'asphalt'), mode);
      bike.assist = 0.85;
      bike.crashRule = 'arcade';
      settle(bike);
      let thrIn = 0, t50: number | null = null, t80: number | null = null, t100: number | null = null;
      let prevV = 0, prevA = 0, jerk = 0, n = 0, chatter = 0, prevEff = 0, pitchVar = 0, cuts = 0, minEff = 1;
      const dt = 1 / 240;
      run(bike, 10, (t) => {
        thrIn = Math.min(1, thrIn + 5 * dt);
        const steer = scen === 'slalom' && t > 2 ? Math.sign(Math.sin(t * 1.6)) * 0.6 : 0;
        return { ...emptyInput(), throttle: thrIn, steer };
      }, (t, bb) => {
        const kmh = bb.speed * 3.6;
        if (t50 === null && kmh >= 50) t50 = t;
        if (t80 === null && kmh >= 80) t80 = t;
        if (t100 === null && kmh >= 100) t100 = t;
        const a = (bb.speed - prevV) / dt;
        if (t > 0.5) {
          jerk += Math.abs(a - prevA); chatter += Math.abs(bb.effThrottle - prevEff); pitchVar += Math.abs(bb.pitch); n++;
          if (bb.effThrottle < 0.7) cuts++;
          minEff = Math.min(minEff, bb.effThrottle);
        }
        prevV = bb.speed; prevA = a; prevEff = bb.effThrottle;
      });
      const f = (x: number | null) => (x === null ? '  -  ' : x.toFixed(2));
      process.stdout.write(`${b.name.padEnd(11)} ${scen.padEnd(8)} 0-50 ${f(t50)} 0-80 ${f(t80)} 0-100 ${f(t100)} v10 ${(bike.speed * 3.6).toFixed(0)} jerk/s ${(jerk / n * 240).toFixed(0)} chatter/s ${(chatter / n * 240).toFixed(2)} cut% ${(cuts / n * 100).toFixed(0)} minEff ${minEff.toFixed(2)} |pitch| ${(pitchVar / n).toFixed(3)} crashed ${bike.crashed}\n`);
    }
  }
});
