/**
 * Theoretical estimates shown in the garage. These are calculations from the spec,
 * clearly separate from measured results (in-world runs or the simulated test bench).
 */
import type { VehicleSpec } from './spec';
import { Powertrain } from '../physics/powertrain';
import { SURFACE_PROPS, TUNING } from '../physics/tuning';
import type { RideMode } from './build';

export interface Estimates {
  massKg: number;
  peakPowerKw: number;
  peakWheelTorque: number;
  peakMotorTorque: number;
  finalDrive: number;
  totalRatio: number;
  topSpeedKmh: number;
  topSpeedLimit: 'motor speed' | 'aero drag';
  batteryWh: number;
  voltage: number;
  rangeKm: number;
  rangeCondition: string;
  powerToWeight: number;
  wheelbase: number;
  trail: number;
  rakeDeg: number;
  comHeight: number;
  frontWeight: number;
  sagFront: number;
  sagRear: number;
  groundClearance: number;
  wheelieIndex: number;
  agility: number;
  stability: number;
  grip: { road: number; dirt: number; grass: number; sand: number };
  dyno: { kmh: number; torque: number; powerKw: number }[];
}

export function estimate(spec: VehicleSpec, mode: RideMode = 'sport'): Estimates {
  const pt = new Powertrain(spec.powertrain);
  const g = TUNING.gravity;
  const m = spec.mass;
  const rr = spec.rear.radius;
  const ratio = spec.powertrain.totalRatio;
  const eff = 0.97;
  // Dyno: wheel torque / power vs speed (sport mode, full battery)
  const dyno: Estimates['dyno'] = [];
  let peakP = 0, peakT = 0;
  const vMotor = pt.rpmTopSpeed(rr, mode);
  for (let kmh = 0; kmh <= 140; kmh += 4) {
    const v = kmh / 3.6;
    const wm = (v / rr) * ratio;
    const tm = pt.availableTorque(wm, mode);
    const tw = tm * ratio * eff;
    const p = (tm * wm) / 1000;
    dyno.push({ kmh, torque: tw, powerKw: p });
    peakP = Math.max(peakP, p);
    peakT = Math.max(peakT, tw);
  }
  // Drag-limited top speed: solve P_avail(v) = drag + rolling
  const crr = SURFACE_PROPS.asphalt.crr * spec.rear.tire.rolling;
  const resist = (v: number) => 0.5 * TUNING.airDensity * spec.cda * v * v * v + crr * m * g * v;
  let vDrag = 0;
  for (let v = 1; v < 70; v += 0.25) {
    const wm = (v / rr) * ratio;
    const p = pt.availableTorque(wm, mode) * wm * eff;
    if (p >= resist(v)) vDrag = v;
    else if (v > 5) break;
  }
  const top = Math.min(vMotor, vDrag);
  // Range at a steady 40 km/h on asphalt, standard mode
  const vR = 40 / 3.6;
  const pNeed = resist(vR) / (spec.powertrain.efficiency * eff) + 25;
  const rangeKm = ((spec.powertrain.capacityWh * 0.92) / pNeed) * vR * 3.6;
  // Static loads & sag
  const L = spec.front.mount.z - spec.rear.mount.z;
  const frontW = (0 - spec.rear.mount.z) / L;
  const sag = (load: number, w: VehicleSpec['front']) => Math.max(0, Math.min(1, (load / Math.cos(0.1) - w.preload) / w.spring / w.travel));
  const sagF = sag(m * g * frontW, spec.front);
  const sagR = sag(m * g * (1 - frontW), spec.rear);
  const comH = -Math.min(spec.front.mount.y - spec.front.radius, spec.rear.mount.y - spec.rear.radius) - 0.05;
  const groundClearance = comH + spec.bodyPoints.find((b) => b.name === 'skid')!.p.y - 0.06;
  // Wheelie index: launch drive force × CoM height vs. weight × distance to rear axle
  const driveF = Math.min(peakT / rr, m * g * 1.1);
  const wheelieIndex = (driveF * comH) / (m * g * -spec.rear.mount.z);
  const agility = Math.max(0, Math.min(10, 10 - (spec.wheelbase - 1.05) * 18 - (spec.steering.trail - 0.08) * 40 - (spec.inertia.z - 18) * 0.2 + (spec.steering.leverage - 1) * 10));
  const stability = Math.max(0, Math.min(10, 2 + (spec.wheelbase - 1.05) * 22 + (spec.steering.trail - 0.08) * 60 + (spec.steering.rake - 0.42) * 10));
  const mu = (s: 'asphalt' | 'dirt' | 'grass' | 'sand') => Math.min(spec.front.tire.mu[s], spec.rear.tire.mu[s]);
  return {
    massKg: m - spec.riderMass,
    peakPowerKw: peakP,
    peakWheelTorque: peakT,
    peakMotorTorque: spec.powertrain.peakTorque,
    finalDrive: spec.powertrain.finalRatio,
    totalRatio: ratio,
    topSpeedKmh: top * 3.6,
    topSpeedLimit: vMotor < vDrag ? 'motor speed' : 'aero drag',
    batteryWh: spec.powertrain.capacityWh,
    voltage: spec.powertrain.voltage,
    rangeKm,
    rangeCondition: 'steady 40 km/h, flat asphalt, 75 kg rider',
    powerToWeight: (peakP * 1000) / m,
    wheelbase: spec.wheelbase,
    trail: spec.steering.trail,
    rakeDeg: (spec.steering.rake * 180) / Math.PI,
    comHeight: comH,
    frontWeight: frontW,
    sagFront: sagF,
    sagRear: sagR,
    groundClearance,
    wheelieIndex,
    agility,
    stability,
    grip: { road: mu('asphalt'), dirt: mu('dirt'), grass: mu('grass'), sand: mu('sand') },
    dyno,
  };
}
