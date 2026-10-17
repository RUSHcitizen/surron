import { describe, expect, it } from 'vitest';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { defaultBuild, PRESETS, sanitizeBuild } from '../src/vehicle/build';
import { BATTERIES, BODY_KITS, BRAKES, CONTROLLERS, COOLING, DAMPERS, FENDERS, FORKS, FRAMES, HANDGUARDS, HANDLEBARS, LIGHTS, MOTORS, PEGS, RIM_STYLES, SEATS, SHOCKS, SWINGARMS, YOKES } from '../src/vehicle/parts';
import { estimate } from '../src/vehicle/stats';
import { Powertrain } from '../src/physics/powertrain';
import { defaultSave, exportBuild, importBuild, migrate, SAVE_VERSION } from '../src/save/save';
import { Scorer } from '../src/gameplay/scoring';
import { CHALLENGES, medalFor } from '../src/gameplay/challenges';
import { makeBike, run, settle } from '../src/physics/sim';
import { emptyInput } from '../src/physics/bike';
import { flatWorld, CollisionWorld } from '../src/world/collision';
import { generateWorld } from '../src/world/layout';

describe('vehicle spec', () => {
  it('all presets produce finite, plausible specs', () => {
    for (const p of PRESETS) {
      const s = computeVehicleSpec(p);
      expect(s.mass - s.riderMass, p.name).toBeGreaterThan(50);
      // (The real Stark Varg MX is about 118 kg ready to ride.)
      expect(s.mass - s.riderMass, p.name).toBeLessThan(125);
      expect(s.wheelbase).toBeGreaterThan(1.1);
      expect(s.wheelbase).toBeLessThan(1.45);
      expect(s.steering.trail).toBeGreaterThan(0.06);
      for (const v of [s.inertia.x, s.inertia.y, s.inertia.z, s.front.radius, s.rear.radius]) expect(Number.isFinite(v) && v > 0).toBe(true);
    }
  });

  it('every part option changes the physical spec (no cosmetic-only performance parts)', () => {
    const base = JSON.stringify({ ...computeVehicleSpec(defaultBuild()), buildId: '' });
    const lists = { motor: MOTORS, controller: CONTROLLERS, battery: BATTERIES, fork: FORKS, shock: SHOCKS, swingarm: SWINGARMS, yoke: YOKES, handlebar: HANDLEBARS, seat: SEATS, fenders: FENDERS, bodyKit: BODY_KITS, frame: FRAMES, lights: LIGHTS, brakes: BRAKES, rimStyle: RIM_STYLES, cooling: COOLING, damper: DAMPERS, pegs: PEGS, handguards: HANDGUARDS } as const;
    for (const [slot, list] of Object.entries(lists)) {
      for (const part of list) {
        const b = defaultBuild();
        if ((b.parts as Record<string, string>)[slot] === part.id) continue;
        (b.parts as Record<string, string>)[slot] = part.id;
        const s = JSON.stringify({ ...computeVehicleSpec(b), buildId: '' });
        expect(s === base, `${slot}:${part.id}`).toBe(false);
      }
    }
  });

  it('rider weight changes mass, centre of mass and acceleration', () => {
    const light = defaultBuild(), heavy = defaultBuild();
    light.rider.weight = 55;
    heavy.rider.weight = 105;
    const a = computeVehicleSpec(light), b = computeVehicleSpec(heavy);
    expect(b.mass - a.mass).toBeCloseTo(50, 5);
    expect(b.riderMass).toBe(105);
    expect(b.com.y).toBeGreaterThan(a.com.y);
    expect(estimate(b).topSpeedKmh).toBeLessThanOrEqual(estimate(a).topSpeedKmh);
  });

  it('cooling upgrades delay thermal derate; dampers and pegs change steering and weight shift', () => {
    const b = defaultBuild();
    b.parts.cooling = 'jacket';
    b.parts.damper = 'race';
    b.parts.pegs = 'wide';
    const s0 = computeVehicleSpec(defaultBuild()), s1 = computeVehicleSpec(b);
    expect(s1.powertrain.cooling).toBeGreaterThan(s0.powertrain.cooling * 1.5);
    expect(s1.powertrain.thermalMass).toBeGreaterThan(s0.powertrain.thermalMass);
    expect(s1.steering.damper).toBeGreaterThan(0);
    expect(s1.rider.shift).toBeGreaterThan(s0.rider.shift);
    // Same 40 s full-load run: the cooled motor ends up noticeably cooler.
    const heat = (sp: typeof s0) => {
      const p = new Powertrain(sp.powertrain);
      const t0 = p.motorTemp;
      for (let i = 0; i < 40 * 60; i++) p.update({ throttle: 1, brake: 0, wheelOmega: 12, rearSlip: 0, pitch: 0, frontAirborne: false, rearGrounded: true, speed: 4, dt: 1 / 60 });
      return p.motorTemp - t0;
    };
    expect(heat(s1)).toBeLessThan(heat(s0) * 0.75);
  });

  it('old builds without rider gear migrate with matching colours', () => {
    const old = JSON.parse(JSON.stringify(PRESETS[1])) as Record<string, unknown>;
    delete old.rider;
    (old.parts as Record<string, unknown>).cooling = undefined;
    const b = sanitizeBuild(old);
    expect(b.rider.weight).toBe(75);
    expect(b.rider.helmetColor).toBe(PRESETS[1].visual.plasticColor);
    expect(b.parts.cooling).toBe('stock');
  });

  it('estimates: sprockets change final drive and top speed', () => {
    const a = defaultBuild(), b = defaultBuild();
    b.tuning.rearSprocket = 60;
    const ea = estimate(computeVehicleSpec(a)), eb = estimate(computeVehicleSpec(b));
    expect(eb.finalDrive).toBeGreaterThan(ea.finalDrive);
    expect(eb.peakWheelTorque).toBeGreaterThan(ea.peakWheelTorque);
    expect(eb.topSpeedKmh).toBeLessThan(ea.topSpeedKmh);
    expect(ea.rangeKm).toBeGreaterThan(30);
  });

  it('sanitizeBuild repairs corrupted/hostile input', () => {
    const b = sanitizeBuild({ name: '<script>x</script>', parts: { motor: 'v8-gas-engine' }, tuning: { rearSprocket: 9999, regen: NaN }, visual: { plasticColor: 'red;}' }, front: { diameter: 99 } });
    expect(b.name).not.toContain('<');
    expect(b.parts.motor).toBe('arc6');
    expect(b.tuning.rearSprocket).toBeLessThanOrEqual(66);
    expect(Number.isFinite(b.tuning.regen)).toBe(true);
    expect(b.visual.plasticColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(b.front.diameter).toBe(19);
    expect(() => computeVehicleSpec(sanitizeBuild(null))).not.toThrow();
  });
});

describe('powertrain', () => {
  const pt = () => new Powertrain(computeVehicleSpec(defaultBuild()).powertrain);
  const step = (p: Powertrain, o: Partial<Parameters<Powertrain['update']>[0]>, n = 240) => {
    let t = 0;
    for (let i = 0; i < n; i++) t = p.update({ throttle: 0, brake: 0, wheelOmega: 30, rearSlip: 0, pitch: 0, frontAirborne: false, rearGrounded: true, speed: 10, dt: 1 / 240, ...o });
    return t;
  };
  it('torque falls toward the motor no-load speed', () => {
    const p = pt();
    expect(p.availableTorque(50)).toBeGreaterThan(p.availableTorque(p.noLoadOmega() * 0.95));
    expect(p.availableTorque(p.noLoadOmega() * 1.01)).toBe(0);
  });
  it('drains the battery under load and regen puts energy back', () => {
    const p = pt();
    step(p, { throttle: 1 }, 2400);
    const soc = p.soc;
    expect(soc).toBeLessThan(1);
    const t = step(p, { throttle: 0, brake: 1 }, 2400);
    expect(t).toBeLessThan(0);
    expect(p.energyRegenWh).toBeGreaterThan(0);
    expect(p.soc).toBeGreaterThan(soc);
  });
  it('derates when the motor overheats', () => {
    const p = pt();
    p.motorTemp = p.spec.maxTemp - 5;
    const hot = step(p, { throttle: 1, wheelOmega: 5 }, 120);
    const q = pt();
    const cold = step(q, { throttle: 1, wheelOmega: 5 }, 120);
    expect(hot).toBeLessThan(cold * 0.6);
    expect(p.limiter).toBe('thermal');
  });
  it('empty battery limps instead of stranding the rider', () => {
    const p = pt();
    p.soc = 0;
    const t = step(p, { throttle: 1, wheelOmega: 5 }, 240);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(step(pt(), { throttle: 1, wheelOmega: 5 }, 240) * 0.3);
  });
});

describe('save system', () => {
  it('migrates garbage to defaults', () => {
    const d = migrate('nonsense');
    expect(d.version).toBe(SAVE_VERSION);
    expect(d.builds.length).toBeGreaterThan(0);
  });
  it('migrates a v1 save (options → settings) and keeps builds and progress', () => {
    const v1 = { version: 1, options: { master: 0.3, quality: 'low' }, builds: [defaultBuild()], selectedBuildId: 'scout', progress: { collected: ['core1'], medals: { drag: { best: 11, medal: 'silver' } } } };
    const d = migrate(v1);
    expect(d.settings.master).toBe(0.3);
    expect(d.settings.quality).toBe('low');
    expect(d.progress.collected).toEqual(['core1']);
    expect(d.progress.medals.drag.medal).toBe('silver');
    // Their own build is kept; pre-v4 saves gain the Stark Varg MX and start on it.
    expect(d.builds.some((b) => b.id === 'scout')).toBe(true);
    expect(d.selectedBuildId).toBe('my-varg');
    expect(migrate(JSON.parse(JSON.stringify(d))).selectedBuildId).toBe('my-varg');
  });
  it('round-trips through JSON', () => {
    const d = defaultSave();
    expect(migrate(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
  it('exports and imports builds', () => {
    const b = PRESETS[2];
    const back = importBuild(exportBuild(b));
    expect(back.parts).toEqual(b.parts);
    expect(back.id).not.toBe(b.id);
    expect(() => importBuild('{"hello":1}')).toThrow();
  });
});

describe('scoring and challenges', () => {
  it('awards drift points during a sustained slide', () => {
    const bike = makeBike(computeVehicleSpec(PRESETS.find((p) => p.id === 'dart')!), flatWorld(2000, 'dirt'));
    settle(bike);
    const sc = new Scorer();
    run(bike, 20, (_t, b) => ({ ...emptyInput(), throttle: b.front.grounded ? Math.max(0, Math.min(1, (8 - b.speed) * 0.6 + 0.12)) : 0, lean: 1 }), (_t, b) => b.speed >= 8);
    run(bike, 5, (_t, b) => ({ ...emptyInput(), throttle: Math.max(0, Math.min(1, 0.65 + (0.5 - Math.abs(b.rear.slipAngle)) * 2.2 - Math.abs(b.yawRate) * 0.1)), steer: 0.7 }), (_t, b) => { sc.update(1 / 240, b); });
    expect(sc.driftTotal).toBeGreaterThan(600);
  });
  it('medal thresholds respect direction', () => {
    const drag = CHALLENGES.find((c) => c.id === 'drag')!;
    expect(medalFor(drag, 9)).toBe('gold');
    expect(medalFor(drag, 99)).toBe(null);
    const drift = CHALLENGES.find((c) => c.id === 'drift')!;
    expect(medalFor(drift, 99999)).toBe('gold');
    expect(medalFor(drift, 1)).toBe(null);
  });
});

describe('world', () => {
  it('generates deterministically with spawns on solid ground', () => {
    const a = generateWorld(), b = generateWorld();
    expect(a.boxes.length).toBe(b.boxes.length);
    const world = new CollisionWorld(a.terrain);
    for (const bx of a.boxes) world.addBox(bx);
    for (const [name, s] of Object.entries(a.spawns)) {
      const bike = makeBike(computeVehicleSpec(defaultBuild()), world);
      bike.place(s.x, s.z, s.yaw);
      settle(bike, 1.5);
      expect(bike.crashed, name).toBe(false);
      expect(bike.front.grounded || bike.rear.grounded, name).toBe(true);
    }
  });
});
