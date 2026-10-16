/**
 * Electric powertrain: motor torque curve with back-EMF fade, controller current
 * and power limits, throttle mapping & ramping, battery state of charge with
 * voltage sag, regenerative braking, and a lumped thermal model with derating.
 */
import type { PowertrainSpec } from '../vehicle/spec';
import type { RideMode } from '../vehicle/build';
import { RIDE_MODES } from './tuning';

export interface PowertrainInput {
  throttle: number; // 0..1
  /** Brake lever input used to blend in regen (0..1). */
  brake: number;
  /** Rear wheel angular speed, rad/s. */
  wheelOmega: number;
  /** Rear slip ratio (for traction control). */
  rearSlip: number;
  /** Bike pitch (nose up positive, rad) and whether the front wheel is airborne. */
  pitch: number;
  frontAirborne: boolean;
  rearGrounded: boolean;
  speed: number;
  dt: number;
}

export type DrainMode = 'realistic' | 'relaxed' | 'off';

export class Powertrain {
  soc = 1;
  motorTemp = 30;
  ambient = 25;
  /** Commanded motor torque after ramping (N·m, shaft). Negative = regen. */
  torque = 0;
  /** Telemetry. */
  rpm = 0;
  powerKw = 0;
  voltage = 0;
  current = 0;
  derate = 1;
  regenKw = 0;
  energyUsedWh = 0;
  energyRegenWh = 0;
  tcActive = false;
  wcActive = false;
  limiter: '' | 'power' | 'speed' | 'thermal' | 'battery' | 'traction' | 'wheelie' = '';
  mode: RideMode = 'standard';
  drain: DrainMode = 'realistic';

  constructor(public spec: PowertrainSpec) {
    this.voltage = this.openCircuitVoltage();
  }

  reset(full = false) {
    this.torque = 0;
    if (full) {
      this.soc = 1;
      this.motorTemp = 30;
      this.energyUsedWh = 0;
      this.energyRegenWh = 0;
    }
  }

  openCircuitVoltage() {
    const s = this.soc;
    const knee = s < 0.1 ? (0.1 - s) * 0.8 : 0;
    return this.spec.voltage * (0.9 + 0.18 * s - knee);
  }

  /** Motor no-load angular speed at the current terminal voltage (rad/s). */
  noLoadOmega(voltage = this.voltage) {
    return (this.spec.kv * voltage * 2 * Math.PI) / 60;
  }

  /** Available motor shaft torque (N·m) at motor speed `wm` — used by the dyno chart too. */
  availableTorque(wm: number, mode: RideMode = this.mode, voltage = this.openCircuitVoltage(), derate = 1) {
    const m = RIDE_MODES[mode];
    const tPeak = this.spec.peakTorque * m.torque * derate;
    const w0 = this.noLoadOmega(voltage) * m.speed;
    const fade = Math.max(0, Math.min(1, (w0 - Math.abs(wm)) / (0.18 * w0)));
    const pMech = this.spec.maxPower * m.power * this.spec.efficiency * derate;
    const tPow = pMech / Math.max(Math.abs(wm), 1);
    return Math.max(0, Math.min(tPeak, tPeak * fade, tPow));
  }

  private mapThrottle(t: number) {
    t = Math.max(0, Math.min(1, t));
    switch (this.spec.throttleMap) {
      case 'soft':
        return t * t * (0.35 + 0.65 * t);
      case 'aggressive':
        return 1 - Math.pow(1 - t, 2.2);
      default:
        return t;
    }
  }

  /** Returns motor torque at the rear wheel (N·m, positive = drive). */
  update(i: PowertrainInput): number {
    const sp = this.spec;
    const m = RIDE_MODES[this.mode];
    const wm = i.wheelOmega * sp.totalRatio;
    this.rpm = (wm * 60) / (2 * Math.PI);

    // Thermal derating
    const span = sp.maxTemp - sp.deratingStart;
    this.derate = 1 - 0.75 * Math.max(0, Math.min(1, (this.motorTemp - sp.deratingStart) / span));

    const vOc = this.openCircuitVoltage();
    this.voltage = Math.max(sp.voltage * 0.6, vOc - this.current * sp.resistance);
    let avail = this.availableTorque(wm, this.mode, this.voltage, this.derate);
    this.limiter = '';
    if (this.derate < 0.98) this.limiter = 'thermal';
    // Battery protection
    if (this.drain !== 'off') {
      if (this.soc <= 0.001) {
        avail = Math.min(avail, sp.peakTorque * 0.12);
        this.limiter = 'battery';
      } else if (this.soc < 0.08) {
        avail *= 0.4 + (0.6 * this.soc) / 0.08;
        this.limiter = 'battery';
      }
    }

    let target = avail * this.mapThrottle(i.throttle);
    if (!this.limiter && i.throttle > 0.95) {
      const tPeak = sp.peakTorque * m.torque;
      if (avail < tPeak * 0.97) this.limiter = Math.abs(wm) > this.noLoadOmega(this.voltage) * m.speed * 0.8 ? 'speed' : 'power';
    }

    // Traction control: trim torque when the rear spins up.
    this.tcActive = false;
    if (sp.tractionControl && i.rearGrounded && i.speed > 1 && i.rearSlip > 0.16 && target > 0) {
      target *= Math.max(0.25, 1 - (i.rearSlip - 0.16) * 3.5);
      this.tcActive = true;
      this.limiter = 'traction';
    }
    // Wheelie control: limit pitch past ~24°.
    this.wcActive = false;
    if (sp.wheelieControl && i.frontAirborne && i.rearGrounded && i.pitch > 0.36 && target > 0) {
      target *= Math.max(0, 1 - (i.pitch - 0.36) * 5);
      this.wcActive = true;
      this.limiter = 'wheelie';
    }

    // Regen: on coast (light) and with brake lever (strong). Fades out at low speed.
    let regenT = 0;
    if (i.throttle < 0.04 && i.wheelOmega > 0.5 && i.rearGrounded) {
      const fade = Math.min(1, Math.max(0, (i.speed - 1) / 3));
      const full = this.soc > 0.985 && this.drain !== 'off' ? 0.15 : 1;
      const coast = 0.18 + 0.82 * Math.min(1, i.brake * 1.5);
      regenT = -sp.peakTorque * sp.regenMax * sp.regen * m.regen * coast * fade * full;
    }
    if (regenT < 0) target = regenT;

    // Ramp toward target (controller slew), faster release.
    const rate = sp.peakTorque * (target > this.torque ? sp.rampRate : sp.rampRate * 3);
    const dT = target - this.torque;
    const maxStep = rate * i.dt;
    this.torque += Math.max(-maxStep, Math.min(maxStep, dT));

    // Electrical
    const pMech = this.torque * wm;
    let pElec: number;
    if (pMech >= 0) pElec = pMech / sp.efficiency + 15;
    else pElec = pMech * sp.efficiency * 0.85 + 15;
    this.powerKw = pElec / 1000;
    this.regenKw = pElec < 0 ? -pElec / 1000 : 0;
    this.current = pElec / Math.max(1, this.voltage);
    const drainScale = this.drain === 'realistic' ? 1 : this.drain === 'relaxed' ? 0.25 : 0;
    const dWh = (pElec * i.dt) / 3600;
    if (dWh > 0) this.energyUsedWh += dWh;
    else this.energyRegenWh -= dWh;
    this.soc = Math.max(0, Math.min(1, this.soc - (dWh * drainScale) / sp.capacityWh));

    // Thermal: copper losses scale with torque², iron/switching with power.
    const tRel = this.torque / Math.max(1, sp.peakTorque);
    const loss = (Math.abs(pMech) * (1 - sp.efficiency) * 0.6 + tRel * tRel * 900) * sp.heat;
    const cooling = sp.cooling * (1 + 0.06 * Math.abs(i.speed)) * (this.motorTemp - this.ambient);
    this.motorTemp += ((loss - cooling) * i.dt) / sp.thermalMass;

    return this.torque * sp.totalRatio * 0.97; // chain/belt losses
  }

  /** Theoretical top speed (m/s) limited only by motor speed in the given mode. */
  rpmTopSpeed(rearRadius: number, mode: RideMode = 'sport') {
    const w0 = this.noLoadOmega(this.spec.voltage * 1.0) * RIDE_MODES[mode].speed;
    return ((w0 * 0.97) / this.spec.totalRatio) * rearRadius;
  }
}
