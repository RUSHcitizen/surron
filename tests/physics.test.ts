/**
 * Repeatable physics scenarios. These run the same BikeDynamics the game uses.
 */
import { describe, expect, it } from 'vitest';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { defaultBuild, PRESETS, cloneBuild } from '../src/vehicle/build';
import type { BikeBuild } from '../src/vehicle/build';
import { accelTest, brakeTest, launchThrottle, makeBike, run, settle, turnTest } from '../src/physics/sim';
import { emptyInput } from '../src/physics/bike';
import type { BikeDynamics } from '../src/physics/bike';
import { CollisionWorld, flatWorld } from '../src/world/collision';
import { generateWorld } from '../src/world/layout';
import { Vector3 } from 'three';

const stock = () => computeVehicleSpec(defaultBuild());
const preset = (id: string) => PRESETS.find((p) => p.id === id)!;
const cruise = (target: number) => (b: BikeDynamics) => Math.max(0, Math.min(1, (target - b.speed) * 0.6 + 0.12));
const deg = (r: number) => (r * 180) / Math.PI;
const wallBox = (x: number, z: number) => ({ x, y: 2, z, sx: 30, sy: 4, sz: 1, surface: 'concrete' as const });

describe('static behaviour', () => {
  it('settles upright with sensible sag and no drift', () => {
    const bike = makeBike(stock());
    settle(bike, 3);
    expect(Math.abs(bike.lean)).toBeLessThan(0.02);
    expect(Math.abs(deg(bike.pitch))).toBeLessThan(3);
    expect(bike.front.compression / bike.spec.front.travel).toBeGreaterThan(0.15);
    expect(bike.front.compression / bike.spec.front.travel).toBeLessThan(0.45);
    expect(bike.rear.compression / bike.spec.rear.travel).toBeGreaterThan(0.15);
    expect(bike.vel.length()).toBeLessThan(0.05);
  });

  it('every preset settles without crashing', () => {
    for (const p of PRESETS) {
      const bike = makeBike(computeVehicleSpec(p));
      settle(bike, 2);
      expect(bike.crashed, p.name).toBe(false);
      expect(bike.front.grounded && bike.rear.grounded, p.name).toBe(true);
    }
  });
});

describe('acceleration, top speed and braking', () => {
  it('stock bike: punchy but believable 0-50 and top speed (Sport)', () => {
    const r = accelTest(stock());
    expect(r.crashed).toBe(false);
    expect(r.t0to50!).toBeGreaterThan(1.8);
    expect(r.t0to50!).toBeLessThan(3.2);
    expect(r.topSpeed * 3.6).toBeGreaterThan(80);
    expect(r.topSpeed * 3.6).toBeLessThan(110);
  });

  it('a more powerful build accelerates harder', () => {
    const a = accelTest(stock());
    const b = accelTest(computeVehicleSpec(preset('hornet')));
    expect(b.t0to50!).toBeLessThan(a.t0to50!);
    expect(b.topSpeed).toBeGreaterThan(a.topSpeed);
  });

  it('brakes from 50 km/h in a realistic distance without flipping', () => {
    for (const p of PRESETS) {
      const r = brakeTest(computeVehicleSpec(p));
      expect(r.crashed, p.name).toBe(false);
      expect(r.distance, p.name).toBeGreaterThan(9);
      expect(r.distance, p.name).toBeLessThan(22);
    }
  });

  it('stronger brakes stop shorter', () => {
    const weak = brakeTest(stock());
    const b = defaultBuild();
    b.parts.brakes = 'race';
    const strong = brakeTest(computeVehicleSpec(b));
    expect(strong.distance).toBeLessThan(weak.distance);
  });
});

describe('cornering', () => {
  it('steady turns match the lean/radius equilibrium tanφ = v²/(gR) (realistic rule: no arcade turning aid)', () => {
    for (const [kmh, steer] of [[20, 0.5], [40, 0.5], [40, 1], [60, 1]]) {
      const t = turnTest(stock(), kmh, steer, 'asphalt', 'realistic');
      expect(t.crashed, `${kmh} ${steer}`).toBe(false);
      const theory = Math.atan((t.speed * t.speed) / (9.81 * t.radius));
      expect(Math.abs(deg(Math.abs(t.lean)) - deg(theory)), `${kmh} km/h steer ${steer}`).toBeLessThan(4);
    }
  });

  it('steering right turns right and leans right', () => {
    const t = turnTest(stock(), 30, 0.6);
    expect(t.bike.lean).toBeGreaterThan(0.1);
    expect(t.yawRate).toBeLessThan(0); // negative yaw about +Y = clockwise from above = right
  });

  it('low speed full lock makes a tight U-turn without falling', () => {
    const bike = makeBike(stock());
    settle(bike);
    let yaw = 0;
    run(bike, 8, (_t, b) => ({ ...emptyInput(), throttle: cruise(3)(b), steer: 1 }), (_t, b) => { yaw += b.yawRate / 240; return b.crashed; });
    expect(bike.crashed).toBe(false);
    expect(Math.abs(yaw)).toBeGreaterThan(Math.PI * 1.5);
  });

  it('survives full-lock slaloms at several speeds', () => {
    for (const v of [8, 11, 16]) {
      const bike = makeBike(stock());
      settle(bike);
      run(bike, 20, (_t, b) => ({ ...emptyInput(), throttle: cruise(v)(b) }), (_t, b) => b.speed >= v);
      run(bike, 8, (t, b) => ({ ...emptyInput(), throttle: cruise(v)(b), steer: Math.sin(t * 2.5) > 0 ? 1 : -1 }), (_t, b) => b.crashed);
      expect(bike.crashed, `slalom ${v}`).toBe(false);
    }
  });

  it('with zero assist, demanding too much lean can lowside (the assist matters)', () => {
    const spec = stock();
    const bike = makeBike(spec);
    bike.assist = 0;
    bike.crashRule = 'realistic';
    settle(bike);
    run(bike, 20, (_t, b) => ({ ...emptyInput(), throttle: cruise(17)(b) }), (_t, b) => b.speed >= 17);
    run(bike, 6, () => ({ ...emptyInput(), throttle: 1, steer: 1 }), (_t, b) => b.crashed);
    const assisted = turnTest(spec, 60, 1);
    expect(assisted.crashed).toBe(false);
    expect(bike.crashed || Math.abs(bike.lean) > assisted.maxLean).toBe(true);
  });
});

describe('wheelies, slides and jumps', () => {
  it('a rider can hold a controlled wheelie', () => {
    const bike = makeBike(stock());
    settle(bike);
    let wt = 0;
    run(bike, 8, (_t, b) => {
      const pr = b.angVel.dot(new Vector3(1, 0, 0).applyQuaternion(b.quat));
      return { ...emptyInput(), throttle: b.front.grounded ? 1 : Math.max(0, Math.min(1, 0.6 + (0.5 - b.pitch) * 3 + pr * 1.2)), lean: b.pitch < 0.15 ? -1 : 0, rearBrake: b.pitch > 0.65 ? 1 : 0 };
    }, (_t, b) => { if (!b.front.grounded && b.rear.grounded) wt += 1 / 240; return b.crashed; });
    expect(bike.crashed).toBe(false);
    expect(wt).toBeGreaterThan(2);
  });

  it('a short swingarm wheelies more readily than a drag swingarm', () => {
    const mk = (arm: string) => {
      const b = defaultBuild();
      b.parts.motor = 'brick10';
      b.parts.controller = 'trail90';
      b.parts.swingarm = arm;
      const bike = makeBike(computeVehicleSpec(b));
      settle(bike);
      let maxPitch = 0;
      run(bike, 1.5, () => ({ ...emptyInput(), throttle: 1 }), (_t, x) => { maxPitch = Math.max(maxPitch, x.pitch); return x.crashed; });
      return maxPitch;
    };
    expect(mk('short')).toBeGreaterThan(mk('ext120'));
  });

  it('power slides on dirt can be sustained without crashing', () => {
    const bike = makeBike(computeVehicleSpec(preset('dart')), flatWorld(2000, 'dirt'));
    settle(bike);
    run(bike, 20, (_t, b) => ({ ...emptyInput(), throttle: b.front.grounded ? cruise(8)(b) : 0, lean: 1 }), (_t, b) => b.speed >= 8);
    let slipTime = 0;
    run(bike, 6, (_t, b) => ({ ...emptyInput(), throttle: Math.max(0, Math.min(1, 0.65 + (0.5 - Math.abs(b.rear.slipAngle)) * 2.2 - Math.abs(b.yawRate) * 0.1)), steer: 0.7 }),
      (_t, b) => { if (Math.abs(b.rear.slipAngle) > 0.2 && b.speed > 2) slipTime += 1 / 240; return b.crashed; });
    expect(bike.crashed).toBe(false);
    expect(slipTime).toBeGreaterThan(3);
  });

  it('traction control suppresses the power slide', () => {
    const b = cloneBuild(preset('dart'));
    b.parts.controller = 'trail90';
    b.tuning.tractionControl = true;
    const bike = makeBike(computeVehicleSpec(b), flatWorld(2000, 'dirt'));
    settle(bike);
    run(bike, 20, (_t, x) => ({ ...emptyInput(), throttle: x.front.grounded ? cruise(8)(x) : 0, lean: 1 }), (_t, x) => x.speed >= 8);
    let maxSlip = 0;
    run(bike, 4, () => ({ ...emptyInput(), throttle: 1, steer: 0.7 }), (_t, x) => { maxSlip = Math.max(maxSlip, x.rear.slipRatio); return x.crashed; });
    expect(maxSlip).toBeLessThan(0.45);
  });

  it('lands a kicker jump in the stunt park and scores airtime', () => {
    const wd = generateWorld();
    const world = new CollisionWorld(wd.terrain);
    for (const b of wd.boxes) world.addBox(b);
    const bike = makeBike(computeVehicleSpec(preset('mudlark')), world);
    bike.place(-20, -25, 0);
    let maxAir = 0;
    run(bike, 4, (_t, b) => ({ ...emptyInput(), throttle: Math.min(launchThrottle(b), cruise(10)(b)), lean: b.airTime > 0 ? 0 : 0.6 }), (_t, b) => { maxAir = Math.max(maxAir, b.airTime); return b.crashed; });
    expect(bike.crashed).toBe(false);
    expect(maxAir).toBeGreaterThan(0.5);
  });

  it('rides over a city curb', () => {
    const wd = generateWorld();
    const world = new CollisionWorld(wd.terrain);
    for (const b of wd.boxes) world.addBox(b);
    const bike = makeBike(stock(), world);
    bike.place(-50, -120, -Math.PI / 2);
    run(bike, 4, (_t, b) => ({ ...emptyInput(), throttle: cruise(6)(b), lean: 0.5 }), (_t, b) => b.crashed);
    expect(bike.crashed).toBe(false);
    expect(bike.pos.y).toBeGreaterThan(0.8); // up on the sidewalk slab
  });
});

describe('robustness', () => {
  it('random input fuzz never produces NaN and crashes always recover via reset', () => {
    const bike = makeBike(stock());
    settle(bike);
    let seed = 1;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let inp = emptyInput();
    for (let i = 0; i < 240 * 40; i++) {
      if (i % 60 === 0) inp = { throttle: r(), frontBrake: r() < 0.2 ? r() : 0, rearBrake: r() < 0.2 ? r() : 0, steer: r() * 2 - 1, lean: r() * 2 - 1 };
      bike.step(inp);
      bike.events.length = 0;
      if (bike.wantsReset) bike.reset();
      expect(Number.isFinite(bike.pos.x + bike.pos.y + bike.pos.z + bike.quat.w)).toBe(true);
    }
    expect(bike.pos.y).toBeGreaterThan(-5);
  });

  it('reset after a crash returns an upright, grounded bike', () => {
    const bike = makeBike(stock());
    settle(bike);
    run(bike, 3, () => ({ ...emptyInput(), throttle: 0.5 }));
    bike.crash('test');
    bike.reset();
    settle(bike, 1);
    expect(bike.crashed).toBe(false);
    expect(Math.abs(bike.lean)).toBeLessThan(0.05);
    expect(bike.front.grounded && bike.rear.grounded).toBe(true);
  });
});

describe('customization changes measurable behaviour', () => {
  const variant = (mut: (b: BikeBuild) => void) => {
    const b = defaultBuild();
    mut(b);
    return computeVehicleSpec(b);
  };

  it('shorter gearing: quicker launch, lower top speed', () => {
    const tall = accelTest(variant((b) => { b.tuning.rearSprocket = 40; }));
    const short = accelTest(variant((b) => { b.tuning.rearSprocket = 60; }));
    expect(short.t0to50!).toBeLessThan(tall.t0to50!);
    expect(short.topSpeed).toBeLessThan(tall.topSpeed);
  });

  it('a larger rear wheel lengthens effective gearing (higher top speed)', () => {
    const small = accelTest(variant((b) => { b.rear.diameter = 16; }));
    const big = accelTest(variant((b) => { b.rear.diameter = 19; b.rear.profile = 100; }));
    expect(big.topSpeed).toBeGreaterThan(small.topSpeed);
  });

  it('knobby tires out-accelerate street tires on dirt; street wins on tarmac grip', () => {
    const street = variant((b) => { b.front.tread = b.rear.tread = 'street'; });
    const knobby = variant((b) => { b.front.tread = b.rear.tread = 'knobby'; });
    expect(knobby.rear.tire.mu.dirt).toBeGreaterThan(street.rear.tire.mu.dirt);
    expect(street.rear.tire.mu.asphalt).toBeGreaterThan(knobby.rear.tire.mu.asphalt);
    const torque = (b: BikeBuild) => { b.parts.motor = 'brick10'; b.parts.controller = 'race150'; b.tuning.tractionControl = false; };
    const sd = accelTest(variant((b) => { torque(b); b.front.tread = b.rear.tread = 'street'; }), 'dirt', 8);
    const kd = accelTest(variant((b) => { torque(b); b.front.tread = b.rear.tread = 'knobby'; }), 'dirt', 8);
    expect(kd.t0to50!).toBeLessThan(sd.t0to50!);
  });

  it('a heavier battery increases mass and roll inertia', () => {
    const a = variant((b) => { b.parts.battery = 'lite60'; });
    const c = variant((b) => { b.parts.battery = 'hyper84'; });
    expect(c.mass).toBeGreaterThan(a.mass + 10);
    expect(c.inertia.z).toBeGreaterThan(a.inertia.z);
  });

  it('stiffer springs reduce sag; more preload raises the bike', () => {
    const soft = makeBike(variant((b) => { b.tuning.shockSpring = 0.7; }));
    const stiff = makeBike(variant((b) => { b.tuning.shockSpring = 1.5; }));
    settle(soft, 2);
    settle(stiff, 2);
    expect(stiff.rear.compression).toBeLessThan(soft.rear.compression);
    const lo = makeBike(variant((b) => { b.tuning.shockPreload = 0; b.tuning.forkPreload = 0; }));
    const hi = makeBike(variant((b) => { b.tuning.shockPreload = 25; b.tuning.forkPreload = 25; }));
    settle(lo, 2);
    settle(hi, 2);
    expect(hi.pos.y).toBeGreaterThan(lo.pos.y);
  });

  it('a longer swingarm lengthens the wheelbase and widens the turning circle', () => {
    const s = variant((b) => { b.parts.swingarm = 'short'; });
    const l = variant((b) => { b.parts.swingarm = 'ext120'; });
    expect(l.wheelbase).toBeGreaterThan(s.wheelbase + 0.1);
    const ts = turnTest(s, 15, 1), tl = turnTest(l, 15, 1);
    expect(tl.radius).toBeGreaterThan(ts.radius);
  });

  it('eco mode limits speed and power', () => {
    const sp = stock();
    const sport = accelTest(sp, 'asphalt', 16, 'sport');
    const eco = accelTest(sp, 'asphalt', 16, 'eco');
    expect(eco.topSpeed).toBeLessThan(sport.topSpeed * 0.85);
    expect(eco.t0to50 ?? 99).toBeGreaterThan(sport.t0to50!);
  });
});

describe('trick buttons', () => {
  const rolling = (v: number) => {
    const bike = makeBike(computeVehicleSpec(defaultBuild()), flatWorld(3000, 'asphalt'));
    settle(bike);
    run(bike, 20, (_t, b) => ({ ...emptyInput(), throttle: Math.max(0, Math.min(1, (v + 0.5 - b.speed) * 0.5)) }), (_t, b) => b.speed >= v);
    return bike;
  };
  it('a short wheelie-button hold lifts the front without crashing; releasing brings it down', () => {
    const bike = rolling(5.5);
    let maxP = 0;
    run(bike, 1.8, () => ({ ...emptyInput(), wheelie: 1 }), (_t, b) => { maxP = Math.max(maxP, b.pitch); });
    expect(maxP).toBeGreaterThan(0.3);
    expect(bike.crashed).toBe(false);
    run(bike, 3, () => emptyInput());
    expect(bike.crashed).toBe(false);
    expect(bike.front.grounded).toBe(true);
  });
  it('holding the wheelie button too long loops out: the rider falls off the back', () => {
    const bike = rolling(5.5);
    run(bike, 5, () => ({ ...emptyInput(), wheelie: 1 }));
    expect(bike.crashed).toBe(true);
    expect(bike.crashCause).toBe('looped out');
  });
  it('the stoppie button lifts the rear while braking', () => {
    const bike = rolling(11.5);
    let minP = 0;
    run(bike, 1, () => ({ ...emptyInput(), stoppie: 1 }), (_t, b) => { minP = Math.min(minP, b.pitch); });
    expect(minP).toBeLessThan(-0.12);
    expect(bike.crashed).toBe(false);
    expect(bike.speed).toBeLessThan(11);
  });
});

describe('forgiving for casual phone riding', () => {
  it('jabby touch-style inputs rarely crash at the default assist', () => {
    let crashes = 0;
    for (const [pi, surf] of [[0, 'asphalt'], [1, 'dirt'], [2, 'asphalt'], [4, 'grass']] as const) {
      const bike = makeBike(computeVehicleSpec(PRESETS[pi]), flatWorld(4000, surf));
      bike.assist = 0.85;
      settle(bike);
      let seed = 17 + pi;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      let tT = 0, tS = 0, thrT = 0.8, steerT = 0;
      const s = { ...emptyInput() };
      const toward = (c: number, t: number, r: number) => c + Math.max(-r / 240, Math.min(r / 240, t - c));
      for (let i = 0; i < 40 * 240; i++) {
        if ((tT -= 1 / 240) <= 0) { tT = 0.5 + rnd() * 2.5; thrT = rnd() < 0.2 ? 0 : 0.45 + rnd() * 0.55; }
        if ((tS -= 1 / 240) <= 0) { tS = 0.3 + rnd() * 1.5; steerT = rnd() < 0.35 ? 0 : (rnd() < 0.5 ? -1 : 1) * (0.4 + rnd() * 0.6); }
        s.throttle = toward(s.throttle, thrT, 30);
        s.steer = toward(s.steer, steerT, 12 / (1 + Math.abs(bike.speed) / 9));
        bike.step(s);
        for (const e of bike.events) if (e.type === 'crash') crashes++;
        bike.events.length = 0;
        if (bike.wantsReset) bike.reset();
      }
    }
    // 160 s of deliberately jabby riding across four bikes and surfaces.
    expect(crashes).toBeLessThanOrEqual(1);
  });
});

describe('arcade crash rule (default)', () => {
  it('full-lock turning at any speed never crashes or lies the bike down', () => {
    for (const p of PRESETS) {
      const bike = makeBike(computeVehicleSpec(p), flatWorld(20000, 'asphalt'), 'hyper');
      settle(bike, 1);
      run(bike, 25, (_t, b) => ({ ...emptyInput(), throttle: launchThrottle(b), lean: 1 }));
      let maxLean = 0;
      run(bike, 10, (t) => ({ ...emptyInput(), throttle: 1, steer: Math.sin(t * 1.3) > 0 ? 1 : -1 }), (_t, b) => { maxLean = Math.max(maxLean, Math.abs(b.lean)); });
      expect(bike.crashed, p.id).toBe(false);
      expect(maxLean, p.id).toBeLessThan(1.0);
    }
  });

  it('hyper mode goes very fast (well past 150 km/h on the supermoto)', () => {
    const sm = PRESETS.find((p) => p.id === 'hornet')!;
    expect(accelTest(computeVehicleSpec(sm), 'asphalt', 40, 'hyper').topSpeed * 3.6).toBeGreaterThan(180);
  });

  it('a wall hit below 30 mph is not a crash; above 30 mph head-on it is', () => {
    for (const [v, crash] of [[9, false], [18, true]] as const) {
      const world = flatWorld(400);
      world.addBox(wallBox(0, 120));
      const bike = makeBike(stock(), world);
      settle(bike);
      let atHit = 0, reached = false;
      run(bike, 30, (_t, b) => ({ ...emptyInput(), throttle: cruise(v)(b) }), (_t, b) => {
        // Speed on the way in (not after bouncing back off the wall).
        if (b.pos.z >= 117) reached = true;
        if (!reached) atHit = b.speed;
        return b.crashed || b.pos.z > 125;
      });
      expect(Math.abs(atHit - v), 'reached test speed').toBeLessThan(1.5);
      expect(bike.crashed, `at ${v} m/s`).toBe(crash);
    }
  });

  it('boost adds a real surge: quicker to 100 km/h and a higher top speed while held', () => {
    const go = (boost: number) => {
      const bike = makeBike(computeVehicleSpec(PRESETS[0]), flatWorld(6000));
      settle(bike);
      let t100 = Infinity;
      run(bike, 12, () => ({ ...emptyInput(), throttle: 1, boost }), (t, b) => { if (t100 === Infinity && b.speed * 3.6 >= 100) t100 = t; });
      return { t100, v: bike.speed };
    };
    const a = go(0), b = go(1);
    expect(b.t100).toBeLessThan(a.t100);
    expect(b.v).toBeGreaterThan(a.v * 1.08);
  });

  it('holding full throttle (no lean) drives forward cleanly: no accidental wheelie, no throttle chatter', () => {
    for (const p of PRESETS) {
      const bike = makeBike(computeVehicleSpec(p), flatWorld(4000));
      settle(bike);
      let thr = 0, maxP = 0, chatter = 0, prev = 0;
      run(bike, 5, () => ({ ...emptyInput(), throttle: (thr = Math.min(1, thr + 5 / 240)) }), (t, b) => {
        maxP = Math.max(maxP, b.pitch);
        if (t > 0.5) chatter += Math.abs(b.effThrottle - prev);
        prev = b.effThrottle;
      });
      expect(maxP, p.id).toBeLessThan(0.25);
      expect(bike.speed * 3.6, p.id).toBeGreaterThan(50);
      expect(chatter, p.id).toBeLessThan(5);
      expect(bike.crashed, p.id).toBe(false);
    }
  });

  it('the wheelie button pulls a clear wheelie at 50 km/h too (not just from a standstill)', () => {
    for (const p of PRESETS) {
      const bike = makeBike(computeVehicleSpec(p), flatWorld(4000));
      settle(bike);
      run(bike, 20, (_t, b) => ({ ...emptyInput(), throttle: cruise(14)(b) }), (_t, b) => b.speed >= 13.8);
      let maxP = 0;
      run(bike, 1.5, () => ({ ...emptyInput(), wheelie: 1 }), (_t, b) => { maxP = Math.max(maxP, b.pitch); });
      expect(maxP, p.id).toBeGreaterThan(0.3);
      expect(bike.crashed, p.id).toBe(false);
    }
  });
});
