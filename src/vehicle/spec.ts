/**
 * computeVehicleSpec: the single source of truth that turns a BikeBuild (what the
 * player chose) into physical parameters (what the simulation and the renderer use).
 *
 * Frames:
 *  - Chassis frame: origin at the swingarm pivot. +Z forward, +Y up, +X = rider's left.
 *  - Body frame: chassis frame translated so the origin is the total centre of mass.
 *    The physics rigid body lives in the body frame.
 */
import {
  BATTERIES, BODY_KITS, BRAKES, COMPOUNDS, CONTROLLERS, COOLING, DAMPERS, FENDERS, FORKS, FRAMES, HANDGUARDS, HANDLEBARS, LIGHTS, MOTORS, PEGS,
  RIM_STYLES, SEATS, SHOCKS, SWINGARMS, TREADS, YOKES, byId,
} from './parts';
import type { SurfaceId, TreadPart } from './parts';
import type { BikeBuild, ThrottleMap, TireConfig } from './build';

export interface V3 { x: number; y: number; z: number }
const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
const add = (a: V3, b: V3): V3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: V3, b: V3): V3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a: V3, s: number): V3 => v3(a.x * s, a.y * s, a.z * s);

export const SURFACES: SurfaceId[] = ['asphalt', 'concrete', 'dirt', 'grass', 'sand', 'gravel'];
const PAVED = new Set<SurfaceId>(['asphalt', 'concrete']);

export interface TireSpec {
  mu: Record<SurfaceId, number>;
  stiffness: Record<SurfaceId, number>;
  slideRatio: number;
  rolling: number;
  /** Peak slip ratio and peak slip angle (rad). */
  peakSlip: number;
  peakAngle: number;
  hum: number;
  tread: string;
}

export interface WheelSpec {
  radius: number;
  width: number;
  rimRadius: number;
  mass: number;
  /** Rotational inertia about the axle, kg·m² (rear includes reflected motor rotor). */
  inertia: number;
  /** Axle position at full extension, body frame. */
  mount: V3;
  /** Unit direction the axle moves when the suspension compresses (body frame). */
  axis: V3;
  travel: number;
  spring: number;
  preload: number;
  progression: number;
  compDamping: number;
  reboundDamping: number;
  tire: TireSpec;
  brakeTorque: number;
}

export interface PowertrainSpec {
  motorId: string;
  /** Peak shaft torque available from motor + controller, N·m. */
  peakTorque: number;
  primaryRatio: number;
  finalRatio: number;
  totalRatio: number;
  kv: number;
  voltage: number;
  capacityWh: number;
  resistance: number;
  /** Battery-side power cap, W. */
  maxPower: number;
  efficiency: number;
  rampRate: number;
  regenMax: number;
  regen: number;
  throttleMap: ThrottleMap;
  tractionControl: boolean;
  wheelieControl: boolean;
  thermalMass: number;
  cooling: number;
  heat: number;
  deratingStart: number;
  maxTemp: number;
  whine: number;
  pwmTone: number;
  rotorInertia: number;
}

export interface BodyPoint {
  p: V3;
  r: number;
  /** Contact with this point is a crash (rider body, head, bars at speed). */
  crash: boolean;
  name: string;
}

export interface VehicleGeometry {
  /** All in chassis frame. */
  pivot: V3;
  head: V3;
  headTop: V3;
  barCenter: V3;
  barWidth: number;
  seat: V3;
  seatLength: number;
  peg: V3;
  battery: V3;
  batterySize: V3;
  motor: V3;
  motorRadius: number;
  frontAxleExt: V3;
  rearAxleExt: V3;
  riderHip: V3;
  rake: number;
  forkLength: number;
  swingarmLength: number;
  shockTop: V3;
  invertedFork: boolean;
}

export interface VehicleSpec {
  buildId: string;
  mass: number;
  riderMass: number;
  /** Principal inertia about the CoM (x = pitch, y = yaw, z = roll). */
  inertia: V3;
  /** Centre of mass in chassis frame. */
  com: V3;
  front: WheelSpec;
  rear: WheelSpec;
  steering: {
    /** Unit vector up the steering axis (body frame). */
    axis: V3;
    rake: number;
    offset: number;
    trail: number;
    maxSteer: number;
    leverage: number;
    /** Steering damper strength (0 = none): slows bar movement at speed and adds yaw calm. */
    damper: number;
  };
  wheelbase: number;
  cda: number;
  powertrain: PowertrainSpec;
  /** Rider seat reference (body frame) and fore/aft weight shift range, m. */
  rider: { hip: V3; shift: number };
  bodyPoints: BodyPoint[];
  toughness: number;
  abs: boolean;
  brakeBite: number;
  headlight: number;
  geo: VehicleGeometry;
}

/** Rider mass is fixed — the build changes the bike, not the person. */
export const RIDER_MASS = 75;

export function tireRadius(t: TireConfig): number {
  return (t.diameter * 0.0254) / 2 + (t.width / 1000) * (t.profile / 100);
}

function tireSpec(t: TireConfig, front: boolean): TireSpec {
  const tread = byId(TREADS, t.tread) as TreadPart;
  const comp = byId(COMPOUNDS, t.compound);
  const base = front ? 80 : 100;
  const dw = t.width - base;
  const mu = {} as Record<SurfaceId, number>;
  const stiffness = {} as Record<SurfaceId, number>;
  const profileStiff = t.profile <= 70 ? 1.14 : t.profile <= 80 ? 1.06 : 1.0;
  for (const s of SURFACES) {
    const paved = PAVED.has(s);
    const widthF = paved ? 1 + 0.0018 * dw : s === 'sand' ? 1 + 0.004 * dw : 1 + 0.0006 * dw;
    // Paved surfaces want ~26-32 psi; loose surfaces reward low pressure (bigger footprint).
    const pressF = paved
      ? 1 - 0.007 * Math.max(0, 26 - t.pressure) - 0.004 * Math.max(0, t.pressure - 32)
      : 1 + 0.007 * (17 - t.pressure);
    mu[s] = tread.mu[s] * comp.muScale * widthF * Math.max(0.75, Math.min(1.12, pressF));
    const pStiff = 0.8 + 0.2 * Math.min(1.25, t.pressure / 24);
    stiffness[s] = tread.stiffness[s] * Math.sqrt(t.width / base) * profileStiff * pStiff;
  }
  return {
    mu,
    stiffness,
    slideRatio: Math.min(0.95, tread.slideRatio + comp.slideRatioDelta),
    rolling: tread.rolling * comp.rolling * Math.sqrt(t.width / base) * (1 + 0.02 * Math.max(0, 22 - t.pressure)),
    peakSlip: 0.11,
    peakAngle: 0.16 / Math.sqrt(profileStiff),
    hum: tread.hum,
    tread: tread.id,
  };
}

function wheelMass(t: TireConfig, rimScale: number, front: boolean): { mass: number; inertia: number; rimR: number } {
  const rimR = (t.diameter * 0.0254) / 2;
  const r = tireRadius(t);
  const rim = (1.3 + 0.12 * t.diameter) * rimScale;
  const tread = byId(TREADS, t.tread);
  const tire = 0.02 * t.width * (0.6 + (0.4 * t.profile) / 100) * Math.pow(t.diameter / 19, 0.8) + tread.mass;
  const hub = front ? 1.1 : 2.0;
  const mid = (rimR + r) / 2;
  return { mass: rim + tire + hub, inertia: rim * rimR * rimR * 0.85 + tire * mid * mid + hub * 0.004, rimR };
}

const clickFactor = (c: number) => 0.4 + 0.06 * c;

interface Mass { m: number; p: V3; size: V3 }

export function computeVehicleSpec(build: BikeBuild): VehicleSpec {
  const P = build.parts;
  const T = build.tuning;
  const motor = byId(MOTORS, P.motor);
  const ctrl = byId(CONTROLLERS, P.controller);
  const batt = byId(BATTERIES, P.battery);
  const fork = byId(FORKS, P.fork);
  const shock = byId(SHOCKS, P.shock);
  const arm = byId(SWINGARMS, P.swingarm);
  const yoke = byId(YOKES, P.yoke);
  const bar = byId(HANDLEBARS, P.handlebar);
  const seat = byId(SEATS, P.seat);
  const fend = byId(FENDERS, P.fenders);
  const kit = byId(BODY_KITS, P.bodyKit);
  const frame = byId(FRAMES, P.frame);
  const lights = byId(LIGHTS, P.lights);
  const brakes = byId(BRAKES, P.brakes);
  const rim = byId(RIM_STYLES, P.rimStyle);
  const cool = byId(COOLING, P.cooling);
  const damper = byId(DAMPERS, P.damper);
  const pegs = byId(PEGS, P.pegs);
  const guards = byId(HANDGUARDS, P.handguards);
  const riderMass = build.rider?.weight ?? RIDER_MASS;

  // --- Geometry (chassis frame, origin = swingarm pivot) -------------------
  const rake = (yoke.rake * Math.PI) / 180;
  const axisUp = v3(0, Math.cos(rake), -Math.sin(rake));
  const perpFwd = v3(0, Math.sin(rake), Math.cos(rake));
  const head = v3(0, 0.445, 0.36);
  const frontAxleExt = add(sub(head, scale(axisUp, fork.length)), scale(perpFwd, yoke.offset));
  const headTop = add(head, scale(axisUp, 0.2));
  const barCenter = add(headTop, v3(0, bar.rise + 0.04, -0.02));

  const theta0 = (12 * Math.PI) / 180;
  const rearRef = v3(0, -arm.length * Math.sin(theta0) - shock.rideHeight, -arm.length * Math.cos(theta0));
  const rearAxis = v3(0, Math.cos(theta0), -Math.sin(theta0));
  const rearAxleExt = sub(rearRef, scale(rearAxis, 0.3 * shock.travel));

  const seatPos = v3(0, 0.38 + seat.height, -0.1 + T.riderPosition);
  const peg = v3(0.16 + (pegs.width - 0.05) * 0.5, -0.07 + pegs.height, 0.04);
  const battery = v3(0, 0.2 + batt.heightOffset, 0.15);
  const bs = Math.cbrt(batt.size);
  const batterySize = v3(0.17 * bs, 0.3 * bs, 0.38 * bs);
  const motorPos = v3(0, -0.07, 0.1);
  const motorRadius = 0.075 + 0.0028 * motor.mass;
  const riderHip = v3(0, seatPos.y + 0.06, seatPos.z + 0.02);
  // Lower pegs drop the rider's legs (and a little of their mass) with them.
  const riderCom = v3(0, seatPos.y + 0.3 + bar.riderHeight * 0.5 + pegs.height * 0.35, seatPos.z + 0.1);
  const shockTop = v3(0, 0.3, -0.02);

  // Wheels
  const fw = wheelMass(build.front, rim.massScale, true);
  const rw = wheelMass(build.rear, rim.massScale, false);
  const rf = tireRadius(build.front);
  const rr = tireRadius(build.rear);
  const frontAxleRide = add(frontAxleExt, scale(axisUp, 0.3 * fork.travel));

  // --- Mass distribution ---------------------------------------------------
  const masses: Mass[] = [
    { m: frame.mass, p: v3(0, 0.22, 0.1), size: v3(0.25, 0.5, 0.9) },
    { m: batt.mass, p: battery, size: batterySize },
    { m: motor.mass, p: motorPos, size: v3(0.14, motorRadius * 2, motorRadius * 2) },
    { m: ctrl.mass, p: v3(0, 0.05, -0.1), size: v3(0.1, 0.06, 0.18) },
    { m: arm.mass, p: scale(rearRef, 0.5), size: v3(0.2, 0.08, arm.length) },
    { m: shock.mass, p: v3(0, 0.16, -0.06), size: v3(0.06, 0.3, 0.06) },
    { m: fork.mass, p: scale(add(head, frontAxleRide), 0.5), size: v3(0.2, fork.length, 0.08) },
    { m: fw.mass + brakes.mass * 0.6, p: frontAxleRide, size: v3(0.1, rf * 2, rf * 2) },
    { m: rw.mass + brakes.mass * 0.4, p: rearRef, size: v3(0.12, rr * 2, rr * 2) },
    { m: seat.mass, p: seatPos, size: v3(0.2, 0.08, seat.length) },
    { m: bar.mass, p: barCenter, size: v3(bar.width, 0.05, 0.05) },
    { m: fend.mass + kit.mass, p: v3(0, 0.33, -0.02), size: v3(0.3, 0.3, 1.0) },
    { m: lights.mass, p: add(head, v3(0, 0.05, 0.1)), size: v3(0.15, 0.12, 0.08) },
    { m: cool.mass, p: motorPos, size: v3(0.18, motorRadius * 2.2, motorRadius * 2.2) },
    { m: damper.mass, p: head, size: v3(0.2, 0.04, 0.04) },
    { m: pegs.mass, p: peg, size: v3(0.35, 0.03, 0.08) },
    { m: guards.mass, p: barCenter, size: v3(bar.width, 0.08, 0.1) },
    { m: riderMass, p: riderCom, size: v3(0.42 * Math.cbrt(riderMass / RIDER_MASS), 0.85, 0.36 * Math.cbrt(riderMass / RIDER_MASS)) },
  ];
  let mass = 0;
  let com = v3(0, 0, 0);
  for (const c of masses) {
    mass += c.m;
    com = add(com, scale(c.p, c.m));
  }
  com = scale(com, 1 / mass);
  const inertia = v3(0, 0, 0);
  for (const c of masses) {
    const d = sub(c.p, com);
    const sx = c.size.x, sy = c.size.y, sz = c.size.z;
    inertia.x += c.m * (d.y * d.y + d.z * d.z) + (c.m * (sy * sy + sz * sz)) / 12;
    inertia.y += c.m * (d.x * d.x + d.z * d.z) + (c.m * (sx * sx + sz * sz)) / 12;
    inertia.z += c.m * (d.x * d.x + d.y * d.y) + (c.m * (sx * sx + sy * sy)) / 12;
  }
  const toBody = (p: V3) => sub(p, com);

  // --- Powertrain ----------------------------------------------------------
  const finalRatio = T.rearSprocket / T.frontSprocket;
  const totalRatio = motor.primaryRatio * finalRatio;
  const rotorInertia = motor.mass * 0.00045;

  // --- Suspension ----------------------------------------------------------
  const frontSpring = fork.springRate * T.forkSpring;
  const rearSpring = shock.springRate * T.shockSpring;

  const front: WheelSpec = {
    radius: rf,
    width: build.front.width / 1000,
    rimRadius: fw.rimR,
    mass: fw.mass,
    inertia: fw.inertia,
    mount: toBody(frontAxleExt),
    axis: axisUp,
    travel: fork.travel,
    spring: frontSpring,
    preload: frontSpring * (T.forkPreload / 1000),
    progression: fork.progression,
    compDamping: fork.damping * clickFactor(T.forkCompression),
    reboundDamping: fork.damping * 1.6 * clickFactor(T.forkRebound),
    tire: tireSpec(build.front, true),
    brakeTorque: brakes.frontTorque,
  };
  const rear: WheelSpec = {
    radius: rr,
    width: build.rear.width / 1000,
    rimRadius: rw.rimR,
    mass: rw.mass,
    inertia: rw.inertia + rotorInertia * totalRatio * totalRatio,
    mount: toBody(rearAxleExt),
    axis: rearAxis,
    travel: shock.travel,
    spring: rearSpring,
    preload: rearSpring * (T.shockPreload / 1000),
    progression: shock.progression,
    compDamping: shock.damping * clickFactor(T.shockCompression),
    reboundDamping: shock.damping * 1.6 * clickFactor(T.shockRebound),
    tire: tireSpec(build.rear, false),
    brakeTorque: brakes.rearTorque,
  };

  const trail = (rf * Math.sin(rake) - yoke.offset) / Math.cos(rake);
  const wheelbase = frontAxleRide.z - rearRef.z;

  // --- Collision probes (body frame) ---------------------------------------
  const bp = (name: string, p: V3, r: number, crash: boolean): BodyPoint => ({ name, p: toBody(p), r, crash });
  const bodyPoints: BodyPoint[] = [
    bp('pegL', peg, 0.04, false),
    bp('pegR', v3(-peg.x, peg.y, peg.z), 0.04, false),
    bp('skid', v3(0, -0.13, 0.12), 0.06, false),
    bp('fenderRear', v3(0, 0.32, -0.72), 0.06, false),
    bp('seatRear', v3(0, seatPos.y, seatPos.z - seat.length * 0.5), 0.07, false),
    bp('nose', add(head, v3(0, 0.02, 0.14)), 0.08, false),
    bp('barL', add(barCenter, v3(bar.width / 2, 0, 0)), 0.05, true),
    bp('barR', add(barCenter, v3(-bar.width / 2, 0, 0)), 0.05, true),
    bp('hipL', v3(0.2, riderHip.y + 0.05, riderHip.z), 0.1, true),
    bp('hipR', v3(-0.2, riderHip.y + 0.05, riderHip.z), 0.1, true),
    bp('shoulderL', v3(0.2, riderHip.y + 0.55, riderHip.z + 0.22), 0.1, true),
    bp('shoulderR', v3(-0.2, riderHip.y + 0.55, riderHip.z + 0.22), 0.1, true),
    bp('head', v3(0, riderHip.y + 0.78 + bar.riderHeight, riderHip.z + 0.3), 0.13, true),
  ];

  const cda = 0.6 + bar.cda + kit.cda + fend.cda + guards.cda + (cool.style === 'jacket' ? 0.01 : 0) + (riderMass - RIDER_MASS) * 0.0015;

  return {
    buildId: build.id,
    mass,
    riderMass,
    inertia,
    com,
    front,
    rear,
    steering: {
      axis: axisUp,
      rake,
      offset: yoke.offset,
      trail,
      maxSteer: (38 * Math.PI) / 180,
      leverage: bar.leverage,
      damper: damper.damping,
    },
    wheelbase,
    cda,
    powertrain: {
      motorId: motor.id,
      peakTorque: motor.peakTorque * ctrl.torqueFactor,
      primaryRatio: motor.primaryRatio,
      finalRatio,
      totalRatio,
      kv: motor.kv,
      voltage: batt.voltage,
      capacityWh: batt.capacityWh,
      resistance: batt.resistance,
      maxPower: Math.min(ctrl.maxPower, batt.maxPower),
      efficiency: motor.efficiency,
      rampRate: ctrl.rampRate,
      regenMax: ctrl.regenMax,
      regen: T.regen,
      throttleMap: T.throttleMap,
      tractionControl: ctrl.tractionControl && T.tractionControl,
      wheelieControl: ctrl.tractionControl && T.wheelieControl,
      thermalMass: motor.thermalMass * cool.thermalScale,
      cooling: motor.cooling * cool.coolingScale,
      heat: ctrl.heat,
      deratingStart: motor.deratingStart,
      maxTemp: motor.maxTemp,
      whine: motor.whine,
      pwmTone: ctrl.pwmTone,
      rotorInertia,
    },
    rider: { hip: toBody(riderHip), shift: (0.16 + (seat.length - 0.6) * 0.5) * pegs.leverage },
    bodyPoints,
    toughness: kit.toughness * frame.toughness * guards.toughness,
    abs: brakes.abs,
    brakeBite: brakes.bite,
    headlight: lights.intensity,
    geo: {
      pivot: v3(0, 0, 0),
      head,
      headTop,
      barCenter,
      barWidth: bar.width,
      seat: seatPos,
      seatLength: seat.length,
      peg,
      battery,
      batterySize,
      motor: motorPos,
      motorRadius,
      frontAxleExt,
      rearAxleExt,
      riderHip,
      rake,
      forkLength: fork.length,
      swingarmLength: arm.length,
      shockTop,
      invertedFork: fork.inverted,
    },
  };
}
