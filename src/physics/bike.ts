/**
 * BikeDynamics — the motorcycle simulation.
 *
 * Model summary
 *  - One 6-DOF rigid body (bike + rider) integrated with semi-implicit Euler at a fixed step.
 *  - Two wheels on suspension: front slides along the steering axis (telescopic fork), rear
 *    moves along the swingarm normal. Wheels are massless for heave but have spin inertia.
 *  - Ground contact by probing several points around the bottom of each tire, so curbs and
 *    edges push back on the correct contact normal.
 *  - Combined-slip tire model (friction-ellipse normalised slip, peak + sliding friction) per
 *    surface; wheel spin integrated in sub-steps for stability.
 *  - Forces are applied where they physically act; drive/brake torques react on the chassis,
 *    so throttle in the air lifts the nose and the brakes dip it.
 *  - Balance: a rider model chooses the steering angle needed to reach a target lean
 *    (countersteering emerges from this). A configurable assist torque adds stability, and
 *    is strongest at walking pace where a real rider would dab a foot.
 */
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import type { VehicleSpec, WheelSpec, V3 } from '../vehicle/spec';
import type { SurfaceId } from '../vehicle/parts';
import type { CollisionWorld, Hit } from '../world/collision';
import { makeHit } from '../world/collision';
import { Powertrain } from './powertrain';
import { RIDE_MODES, SURFACE_PROPS, TUNING } from './tuning';

export interface BikeInput {
  throttle: number;
  frontBrake: number;
  rearBrake: number;
  /** -1 = left, +1 = right. */
  steer: number;
  /** +1 = lean forward (weight over the bars), -1 = lean back. */
  lean: number;
  /** Wheelie / stoppie trick buttons (held = 1). Optional: plain riding leaves them out. */
  wheelie?: number;
  stoppie?: number;
}

export function emptyInput(): BikeInput {
  return { throttle: 0, frontBrake: 0, rearBrake: 0, steer: 0, lean: 0 };
}

export interface WheelState {
  grounded: boolean;
  compression: number;
  compVel: number;
  load: number;
  slipRatio: number;
  slipAngle: number;
  /** How far past peak grip the tire is (0 = gripping). */
  slide: number;
  slipSpeed: number;
  surface: SurfaceId;
  contact: Vector3;
  normal: Vector3;
  center: Vector3;
  omega: number;
  angle: number;
  /** Distance from the extended wheel to the ground (for visuals). */
  groundGap: number;
  bottomed: boolean;
  longForce: number;
  latForce: number;
  airTime: number;
}

function makeWheelState(): WheelState {
  return {
    grounded: false, compression: 0, compVel: 0, load: 0, slipRatio: 0, slipAngle: 0, slide: 0, slipSpeed: 0,
    surface: 'asphalt', contact: new Vector3(), normal: new Vector3(0, 1, 0), center: new Vector3(), omega: 0, angle: 0,
    groundGap: 1, bottomed: false, longForce: 0, latForce: 0, airTime: 0,
  };
}

export type BikeEvent =
  | { type: 'land'; strength: number; surface: SurfaceId }
  | { type: 'bump'; strength: number; wheel: 'front' | 'rear' }
  | { type: 'crash'; speed: number; cause: string }
  | { type: 'scrape'; strength: number };

interface SafeState {
  pos: Vector3;
  yaw: number;
}

const UP = new Vector3(0, 1, 0);
const tv = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const vfrom = (v: V3) => new Vector3(v.x, v.y, v.z);
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Scratch
const _fwd = tv(), _up = tv(), _left = tv(), _hf = tv();
const _mount = tv(), _axis = tv(), _wf = tv(), _wa = tv(), _down = tv(), _pf = tv(), _o = tv(), _start = tv(), _rayDir = tv();
const _n = tv(), _f = tv(), _l = tv(), _r = tv(), _vc = tv(), _F = tv(), _T = tv(), _tmp = tv(), _tmp2 = tv(), _gc = tv();
const _pw = tv(), _vp = tv(), _q = new Quaternion(), _m3 = new Matrix3(), _m3t = new Matrix3(), _m4 = new Matrix4();
const _ffwd = tv(), _faxle = tv(), _rfwd = tv(), _raxle = tv(), _bp = tv();
const _bestPoint = tv(), _bestNormal = tv(), _bestRadial = tv(), _bestTube = tv(), _gdown = tv();

export class BikeDynamics {
  readonly pt: Powertrain;
  pos = tv();
  vel = tv();
  quat = new Quaternion();
  angVel = tv();
  prevPos = tv();
  prevQuat = new Quaternion();

  front = makeWheelState();
  rear = makeWheelState();
  steer = 0;
  steerCmd = 0;
  riderShift = 0;
  riderLat = 0;
  input: BikeInput = emptyInput();
  /** Lean the rider can hold right now (grip, speed), rad. */
  maxLeanNow = 0.8;
  /** How long the wheelie / stoppie buttons have been held, s. */
  wheelieHold = 0;
  stoppieHold = 0;
  /** User balance assist level 0..1. */
  assist = 0.65;

  crashed = false;
  crashTime = 0;
  /**
   * 'arcade' (default): the only crashes are hitting something at 30+ mph and looping out a
   * held wheelie; the rider never drops the bike by leaning, sliding or landing, and a bike that
   * tips over is stood straight back up. 'realistic': the full crash model.
   */
  crashRule: 'arcade' | 'realistic' = 'arcade';
  /** Speed at the start of the current step (impact speed for crash checks), m/s. */
  private stepSpeed = 0;
  /** Time spent tipped over / upside down while not crashed (arcade auto-right). */
  private downTime = 0;
  /** Trick-button pitch torque (about the bike's left axis, + = nose down). */
  private trickTorque = 0;
  /** Arcade auto-right in progress, and how many times it has happened (telemetry/tests). */
  righting = false;
  rightings = 0;
  crashCause = '';
  /** Simple rider ragdoll (point mass) used after a crash. */
  rider = { pos: tv(), vel: tv(), spin: tv(), rot: new Quaternion() };
  airTime = 0;
  /** Accumulated pitch/yaw/roll rotation in the current airborne phase (rad). */
  airRot = tv();
  /** Values of the most recent completed airborne phase. */
  airTimeLast = 0;
  airRotLast = tv();
  time = 0;
  events: BikeEvent[] = [];

  // Derived telemetry
  speed = 0;
  lean = 0;
  pitch = 0;
  yawRate = 0;
  leanTarget = 0;
  effFrontBrake = 0;
  effThrottle = 0;
  distance = 0;
  maxImpact = 0;

  private invInertia: Vector3;
  private safe: SafeState[] = [];
  private safeTimer = 0;
  private mounts: { front: Vector3; rear: Vector3; fAxis: Vector3; rAxis: Vector3; steerAxis: Vector3 };
  private hit: Hit = makeHit();
  private hit2: Hit = makeHit();
  private probeAngles: number[];
  private prevPen = { front: 0, rear: 0 };
  private bodyContact = 0;

  constructor(public spec: VehicleSpec, public world: CollisionWorld) {
    this.pt = new Powertrain(spec.powertrain);
    this.invInertia = tv(1 / spec.inertia.x, 1 / spec.inertia.y, 1 / spec.inertia.z);
    this.mounts = {
      front: vfrom(spec.front.mount),
      rear: vfrom(spec.rear.mount),
      fAxis: vfrom(spec.front.axis).normalize(),
      rAxis: vfrom(spec.rear.axis).normalize(),
      steerAxis: vfrom(spec.steering.axis).normalize(),
    };
    this.probeAngles = TUNING.tire.probeAngles.map((d) => (d * Math.PI) / 180);
  }

  /** Swap in a new spec (garage edit) keeping position/velocity. */
  setSpec(spec: VehicleSpec) {
    const soc = this.pt.soc, temp = this.pt.motorTemp, mode = this.pt.mode, drain = this.pt.drain;
    this.spec = spec;
    (this as { pt: Powertrain }).pt = new Powertrain(spec.powertrain);
    this.pt.soc = soc;
    this.pt.motorTemp = temp;
    this.pt.mode = mode;
    this.pt.drain = drain;
    this.invInertia = tv(1 / spec.inertia.x, 1 / spec.inertia.y, 1 / spec.inertia.z);
    this.mounts = {
      front: vfrom(spec.front.mount),
      rear: vfrom(spec.rear.mount),
      fAxis: vfrom(spec.front.axis).normalize(),
      rAxis: vfrom(spec.rear.axis).normalize(),
      steerAxis: vfrom(spec.steering.axis).normalize(),
    };
  }

  get yaw() {
    _fwd.set(0, 0, 1).applyQuaternion(this.quat);
    return Math.atan2(_fwd.x, _fwd.z);
  }

  /** Height of the CoM above flat ground when settled at ~sag. */
  rideHeight() {
    const s = this.spec;
    const h = (w: WheelSpec) => -(w.mount.y + w.axis.y * w.travel * 0.3 - w.radius);
    return (h(s.front) + h(s.rear)) / 2;
  }

  /** Place the bike upright at (x, z) facing `yaw`, on whatever ground is there. */
  place(x: number, z: number, yaw: number, y?: number) {
    this.quat.setFromAxisAngle(UP, yaw);
    // Find ground under both wheels.
    const s = this.spec;
    _fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    const gf = this.world.groundHeight(x + _fwd.x * s.front.mount.z, z + _fwd.z * s.front.mount.z, (y ?? 100) + 2);
    const gr = this.world.groundHeight(x + _fwd.x * s.rear.mount.z, z + _fwd.z * s.rear.mount.z, (y ?? 100) + 2);
    const g = Math.max(gf, gr);
    this.pos.set(x, g + this.rideHeight() + 0.03, z);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.steer = 0;
    this.front.omega = this.rear.omega = 0;
    this.front.compression = this.rear.compression = 0;
    this.front.grounded = this.rear.grounded = false;
    this.crashed = false;
    this.crashTime = 0;
    this.airTime = 0;
    this.airRot.set(0, 0, 0);
    this.pt.reset();
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.safe.length = 0;
    this.safeTimer = 0;
    this.bodyContact = 0;
  }

  /** Recover after a crash / stuck: back to a recent safe spot. */
  reset() {
    const s = this.safe.length > 3 ? this.safe[this.safe.length - 4] : this.safe[0];
    if (s) this.place(s.pos.x, s.pos.z, s.yaw, s.pos.y);
    else this.place(this.pos.x, this.pos.z, this.yaw, this.pos.y);
  }

  private bodyToWorld(p: Vector3, out: Vector3) {
    return out.copy(p).applyQuaternion(this.quat).add(this.pos);
  }

  private pointVelocity(pw: Vector3, out: Vector3) {
    _tmp2.copy(pw).sub(this.pos);
    return out.copy(this.angVel).cross(_tmp2).add(this.vel);
  }

  private applyForce(F: Vector3, at: Vector3, force: Vector3, torque: Vector3) {
    force.add(F);
    _tmp.copy(at).sub(this.pos).cross(F);
    torque.add(_tmp);
  }

  step(input: BikeInput, dt = TUNING.dt) {
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.time += dt;
    this.input = input;
    const sp = this.spec;
    const m = sp.mass;
    const g = TUNING.gravity;
    const force = _F.set(0, 0, 0);
    const torque = _T.set(0, 0, 0);

    // --- Orientation & kinematics -----------------------------------------
    _fwd.set(0, 0, 1).applyQuaternion(this.quat);
    _up.set(0, 1, 0).applyQuaternion(this.quat);
    _left.set(1, 0, 0).applyQuaternion(this.quat);
    _hf.set(_fwd.x, 0, _fwd.z);
    if (_hf.lengthSq() < 1e-4) _hf.set(_up.x, 0, _up.z);
    _hf.normalize();
    this.speed = this.vel.dot(_fwd);
    this.stepSpeed = this.vel.length();
    const arcade = this.crashRule === 'arcade';
    this.lean = Math.asin(clamp(_left.dot(UP), -1, 1));
    this.pitch = Math.asin(clamp(_fwd.dot(UP), -1, 1));
    const leanRate = this.angVel.dot(_fwd);
    const pitchRate = this.angVel.dot(_left); // + = nose down
    this.yawRate = this.angVel.dot(UP);
    const av = Math.abs(this.speed);
    const upright = _up.y;

    let thr = this.crashed ? 0 : clamp(input.throttle, 0, 1);
    let fb = this.crashed ? 0.3 : clamp(input.frontBrake, 0, 1);
    let rb = this.crashed ? 0.3 : clamp(input.rearBrake, 0, 1);
    const steerIn = this.crashed ? 0 : clamp(input.steer, -1, 1);
    let leanIn = this.crashed ? 0 : clamp(input.lean, -1, 1);
    const grounded = this.front.grounded || this.rear.grounded;

    // --- Trick buttons -------------------------------------------------------------
    // WHEELIE: the rider sits back and rides the throttle to a target pitch that rises the
    // longer the button is held. A short hold gives a controlled wheelie; hold too long and
    // the target passes the balance point, the bike loops out and the rider falls off the back.
    // STOPPIE: weight forward and a modulated front brake toward a nose-down target that also
    // grows with hold time (too long at speed = over the bars).
    // While a button is held the matching rider instinct and wheelie control are bypassed.
    const wheelieBtn = !this.crashed && (input.wheelie ?? 0) > 0.5;
    const stoppieBtn = !this.crashed && !wheelieBtn && (input.stoppie ?? 0) > 0.5;
    this.wheelieHold = wheelieBtn ? this.wheelieHold + dt : 0;
    this.stoppieHold = stoppieBtn ? this.stoppieHold + dt : 0;
    const TR = TUNING.tricks;
    this.trickTorque = 0;
    // Pitch torque scale: about what it takes to hold this bike + rider at a given pitch.
    const liftScale = (m * g * 0.55) / 0.5;
    if (wheelieBtn) {
      const target = TR.wheelieBase + Math.max(0, this.wheelieHold - TR.holdGrace) * TR.wheelieRamp;
      const rateUp = -this.angVel.dot(_left);
      // At speed the motor alone cannot pull the front up (no clutch to dump), so the rider
      // pops it with body weight and holds the balance point: a pitch torque toward the
      // target, strongest at speed and fading at a standstill where the motor torque does it.
      if (this.rear.grounded) {
        const pop = smoothstep(2, 9, av);
        const tq = clamp((target - this.pitch) * TR.liftStiffness - rateUp * TR.liftDamping, -1.2, 1.6) * liftScale * pop;
        this.trickTorque = -tq;
      }
      leanIn = -1;
      fb = 0;
      rb = 0;
      thr = this.front.grounded && this.pitch < 0.08
        ? 1
        : clamp(TR.wheelieThrottle + (target - this.pitch) * 2.6 - rateUp * 0.45, 0, 1);
      if (this.pitch > TR.loopOut) {
        this.crash('looped out');
        // Off the back: the rider slides off behind the bike.
        this.rider.vel.addScaledVector(_fwd, -3).add(tv(0, 0.8, 0));
      }
    } else if (stoppieBtn) {
      const target = TR.stoppieBase + Math.max(0, this.stoppieHold - TR.holdGrace) * TR.stoppieRamp;
      const nose = -this.pitch;
      const noseRate = Math.max(0, this.angVel.dot(_left));
      leanIn = 1;
      thr = 0;
      rb = 0;
      fb = this.front.grounded ? clamp(0.7 + (target - nose) * 3 - noseRate * 0.8, 0.1, 0.95) : 0;
      if (this.front.grounded && av > 1.5) {
        // Weight over the bars helps the rear up at speed; in arcade it never goes past the
        // balance point.
        const tgt = arcade ? Math.min(target, TR.overBars - 0.3) : target;
        const tq = clamp((tgt - nose) * TR.liftStiffness * 0.7 - noseRate * TR.liftDamping, -1.2, 1.2) * liftScale * 0.6 * smoothstep(1.5, 6, av);
        this.trickTorque = tq;
        if (arcade && nose > tgt) fb *= clamp(1 - (nose - tgt) * 6, 0, 1);
      }
      if (!arcade && this.front.grounded && nose > TR.overBars) this.crash('over the bars');
    }

    // --- Rider instinct: ease the front brake at the stoppie point and the throttle at the
    // loop-out point, the way a rider modulates by feel. Scaled by assist (0 = none).
    if (!this.crashed && this.assist > 0) {
      const R = TUNING.rider;
      // Predict where the pitch is heading (rate look-ahead) so the rider eases off *before*
      // the bike goes over the bars, holding it near the stoppie balance point.
      const prNose = this.angVel.dot(_left); // + = nose diving
      if (this.front.grounded && fb > 0 && !stoppieBtn) {
        const predicted = -this.pitch + Math.max(0, prNose) * R.stoppieLookahead;
        const rearLight = this.rear.grounded ? smoothstep(0.35, 0.1, this.rear.load / (sp.mass * g * 0.5)) : 1;
        const excess = predicted - R.stoppieLimit;
        if (excess > 0) fb *= clamp(1 - excess * 7 * this.assist * Math.max(rearLight, 0.4), 0.05, 1);
      }
      if (this.rear.grounded && !this.front.grounded && !wheelieBtn) {
        // Look ahead on the pitch rate; past the balance point, cover the rear brake.
        const prUp = -this.angVel.dot(_left);
        const predicted = this.pitch + Math.max(0, prUp) * 0.25;
        if (predicted > R.loopLimit) thr *= clamp(1 - (predicted - R.loopLimit) * 6 * this.assist, 0, 1);
        if (predicted > R.loopLimit + 0.12) rb = Math.max(rb, clamp((predicted - R.loopLimit - 0.12) * 5 * this.assist, 0, 1));
      }
      // Driving out of a turn the rider keeps weight over the front; if the front still goes
      // light while leaned over (and no wheelie was asked for), roll off a little.
      const turning = Math.max(Math.abs(steerIn), smoothstep(0.12, 0.4, Math.abs(this.lean)));
      if (leanIn > -0.2 && turning > 0.1) {
        leanIn = clamp(leanIn + turning * thr * this.assist * 0.8, -1, 1);
        const frontLight = this.front.grounded ? smoothstep(0.3, 0.08, this.front.load / (sp.mass * g * 0.45)) : 1;
        if (this.rear.grounded && frontLight > 0 && this.pitch > -0.05) {
          thr *= clamp(1 - frontLight * turning * this.assist * 1.6 * smoothstep(-0.12, 0.04, this.pitch), 0.1, 1);
        }
      }
      // Feel for wheelspin: a rider modulates so the rear spins enough to slide, not to
      // flail. At assist 0 the rear can spin freely.
      if (this.rear.grounded && av > 1.5) {
        const kMax = R.spinLimit + 1.5 * (1 - this.assist) * (1 - this.assist);
        if (this.rear.slipRatio > kMax) thr *= clamp(1 - (this.rear.slipRatio - kMax) * 2.2, 0.2, 1);
        // Slide angle approaching what the steering lock can catch: roll off.
        const slipA = Math.abs(this.rear.slipAngle);
        if (slipA > R.slideLimit) thr *= clamp(1 - (slipA - R.slideLimit) * 3 * this.assist, 0.1, 1);
      }
      // Rear stepping out hard at big lean: roll off before it lowsides.
      const leanAbs = Math.abs(this.lean);
      if (this.rear.grounded && leanAbs > 0.45 && this.rear.slide > 0.35) {
        thr *= clamp(1 - (this.rear.slide - 0.35) * 2.5 * this.assist * smoothstep(0.45, 0.8, leanAbs), 0.1, 1);
      }
    }
    // Arcade: at speed and deep in a lean the rider feeds the throttle in gently, so the rear
    // never steps out and snaps back (no highsides from full throttle at full lean).
    if (arcade && !wheelieBtn && this.rear.grounded) {
      thr *= 1 - 0.75 * smoothstep(0.3, 0.7, Math.abs(this.lean)) * smoothstep(12, 35, av);
    }
    this.effFrontBrake = fb;
    this.effThrottle = thr;

    // --- Rider steering controller ----------------------------------------
    const T = TUNING.steering;
    const surfF = this.front.surface, surfR = this.rear.surface;
    const mu = Math.min(sp.front.tire.mu[surfF], sp.rear.tire.mu[surfR]);
    let maxLean = lerp(T.lowSpeedLean, T.maxLean, smoothstep(T.leanRampStart, T.leanRampEnd, av));
    // Front washing out: the rider stands the bike up a little.
    maxLean *= 1 - 0.45 * this.assist * clamp(this.front.slide * 1.5, 0, 1);
    // Grip-limited lean: with assist the rider keeps a safety margin; at zero assist you can
    // ask for more lean than the tires can hold (and lowside).
    maxLean = Math.min(maxLean, Math.atan(mu * lerp(1.05, 0.78, this.assist)));
    this.maxLeanNow = maxLean;
    const L = sp.wheelbase;
    const vv = Math.max(av, 1);
    const wDirect = 1 - smoothstep(T.directSpeed, T.blendSpeed, av);
    const dDirectBase = steerIn * sp.steering.maxSteer * (1 - 0.5 * clamp(av / T.blendSpeed, 0, 1));
    // Equilibrium lean for the curvature that direct (low-speed) steering produces.
    const leanDirect = Math.atan((av * av * Math.tan(dDirectBase)) / (L * g));
    const leanT = clamp(lerp(steerIn * maxLean, leanDirect, wDirect), -maxLean - 0.1, maxLean + 0.1);
    this.leanTarget = leanT;
    const dEq = clamp(Math.atan((L * g * Math.tan(clamp(this.lean, -1.3, 1.3))) / (vv * vv)), -sp.steering.maxSteer, sp.steering.maxSteer);
    const trailF = clamp(sp.steering.trail / 0.11, 0.6, 1.5);
    const gain = (sp.steering.leverage / (1 + av / 14)) * (1.15 - 0.15 * trailF);
    // Target a roll rate toward the desired lean (rate-limited like a real rider's flick),
    // and steer to produce it: this is countersteering.
    // Arcade: at very high speed the flick from one side to the other is calmer, so a
    // full-lock change of direction cannot snap the rear and throw the bike (a highside).
    const maxRate = T.maxRollRate * sp.steering.leverage * (arcade ? lerp(1, 0.4, smoothstep(22, 55, av)) : 1);
    const rateT = clamp((leanT - this.lean) * T.leanGain, -maxRate, maxRate);
    const dFb = T.kd * (leanRate - rateT) * gain;
    const dDirect = dDirectBase + dFb * 0.3;
    let cmd = lerp(dEq + dFb, dDirect, wDirect);
    // Direction of travel at the front axle relative to the bike's heading (+ = right).
    this.bodyToWorld(this.mounts.front, _pw);
    this.pointVelocity(_pw, _vp);
    const beta = Math.atan2(-_vp.dot(_left), Math.max(0.5, Math.abs(_vp.dot(_fwd))));
    // Caster: while the rear slides, the front tracks the direction of travel (countersteer).
    // In a slide the steering reference becomes the front's direction of travel (the rider
    // lets the bars follow the slide and balances around it).
    if (this.front.grounded && av > 2) {
      const w = smoothstep(0.06, 0.3, Math.abs(this.rear.slipAngle)) * T.caster * clamp(trailF, 0.8, 1.2);
      cmd = lerp(cmd, beta + dFb + steerIn * 0.05, clamp(w, 0, 1));
    }
    if (!grounded) cmd = steerIn * 0.15;
    // At speed, the useful steering angle is bounded by the curvature the tires can hold.
    const steerLimit = clamp(Math.atan((L * mu * g * T.speedSteerLimit) / (vv * vv)), T.minSteerLimit, sp.steering.maxSteer);
    const slideRoom = smoothstep(0.1, 0.5, Math.abs(this.rear.slipAngle)) * sp.steering.maxSteer;
    const lim = Math.max(steerLimit, slideRoom);
    cmd = clamp(cmd, -lim, lim);
    // Never steer the front far past its peak slip angle: that only skids it.
    if (this.front.grounded && av > T.directSpeed) {
      const fs = sp.front.tire;
      const peak = (fs.peakAngle / fs.stiffness[surfF]) * T.slipLimit;
      const wl = smoothstep(T.directSpeed, T.blendSpeed + 2, av);
      cmd = lerp(cmd, clamp(cmd, beta - peak, beta + peak), wl);
    }
    this.steerCmd = cmd;
    // A steering damper slows bar movement at speed (calmer, but slower turn-in).
    const damp = sp.steering.damper * smoothstep(4, 18, av);
    const rate = (T.rate * sp.steering.leverage * dt) / (1 + damp * 0.9);
    this.steer += clamp(cmd - this.steer, -rate, rate);

    // Rider weight shift (fore/aft), smoothed.
    this.riderShift += (leanIn - this.riderShift) * Math.min(1, TUNING.rider.shiftRate * dt);
    this.riderLat += (steerIn * (grounded ? 1 : 0) - this.riderLat) * Math.min(1, 3 * dt);

    // --- Powertrain ---------------------------------------------------------
    const driveTorque = this.pt.update({
      throttle: thr,
      brake: Math.max(fb, rb),
      wheelOmega: this.rear.omega,
      rearSlip: this.rear.slipRatio,
      wheelieOverride: wheelieBtn,
      pitch: this.pitch,
      frontAirborne: !this.front.grounded,
      rearGrounded: this.rear.grounded,
      speed: this.speed,
      dt,
    });

    // --- Wheels -------------------------------------------------------------
    // Front wheel frame: rotate about the steering axis.
    _axis.copy(this.mounts.steerAxis).applyQuaternion(this.quat);
    _q.setFromAxisAngle(_axis, -this.steer);
    const fFwd = _ffwd.copy(_fwd).applyQuaternion(_q);
    const fAxle = _faxle.copy(_left).applyQuaternion(_q);
    const brakeF = sp.front.brakeTorque * Math.pow(fb, sp.brakeBite);
    const brakeR = sp.rear.brakeTorque * Math.pow(rb, sp.brakeBite);
    this.wheel(this.front, sp.front, this.mounts.front, this.mounts.fAxis, fFwd, fAxle, 0, brakeF, dt, force, torque, 'front');
    this.wheel(this.rear, sp.rear, this.mounts.rear, this.mounts.rAxis, _rfwd.copy(_fwd), _raxle.copy(_left), driveTorque, brakeR, dt, force, torque, 'rear');

    // --- Body collision probes ---------------------------------------------
    this.bodyProbes(dt, force, torque);

    // --- Gravity with rider weight shift ------------------------------------
    _tmp.set(0, -m * g, 0);
    force.add(_tmp);
    const shift = this.riderShift * sp.rider.shift * (sp.riderMass / m);
    const lat = -this.riderLat * 0.05 * (sp.riderMass / m) * smoothstep(1, 6, av);
    _r.set(lat, 0, shift).applyQuaternion(this.quat);
    _tmp2.set(0, -m * g, 0);
    torque.add(_r.cross(_tmp2));

    // --- Aero ---------------------------------------------------------------
    const vmag = this.vel.length();
    if (vmag > 0.1) {
      _tmp.copy(this.vel).multiplyScalar(-0.5 * TUNING.airDensity * sp.cda * RIDE_MODES[this.pt.mode].aero * vmag);
      force.add(_tmp);
    }

    // --- Rider / assist torques ---------------------------------------------
    const A = TUNING.assist, R = TUNING.rider;
    if (!this.crashed) {
      if (grounded) {
        const stand = 1 - smoothstep(0.5, A.standSpeed, av);
        // In big rear slides the rider dabs the inside foot, steadying the lean.
        const dab = smoothstep(0.15, 0.5, Math.abs(this.rear.slipAngle)) * (0.3 + this.assist);
        const k = A.rollStiffness * this.assist + A.standStiffness * stand + A.slideRollStiffness * dab;
        const d = A.rollDamping * this.assist + A.standDamping * stand + A.slideRollDamping * dab;
        const leanErr = clamp(this.lean - leanT, -0.6, 0.6);
        _tmp.copy(_hf).multiplyScalar(-(k * leanErr + d * leanRate) * clamp(upright * 2, 0, 1));
        torque.add(_tmp);
        // Save: when the bike falls past the lean the rider can hold (tucking the front, a dab of
        // the knee or foot), the rider fights it back up. Strength scales with assist; at 0 assist
        // nothing catches you.
        // In arcade the rider always saves it, however hard the turn.
        const save = arcade ? Math.max(1, this.assist * 1.5) : this.assist;
        const holdLean = this.maxLeanNow + (arcade ? 0.02 : 0.08);
        const over = Math.abs(this.lean) - holdLean;
        if (over > 0 && save > 0) {
          const kc = A.catchStiffness * save * (1 + over * 6);
          const falling = Math.sign(this.lean) * leanRate > 0 ? leanRate : 0;
          _tmp.copy(_hf).multiplyScalar(-Math.sign(this.lean) * kc * over - A.catchDamping * save * falling);
          torque.add(_tmp);
        }
        if (this.trickTorque) torque.addScaledVector(_left, this.trickTorque);
        // Slide control: past ~20° of rear slip the rider's body-English and feel resist further
        // rotation, which makes drifts catchable. Below that, grip riding is untouched.
        const slideW = smoothstep(0.22, 0.75, Math.abs(this.rear.slipAngle)) * smoothstep(1.5, 5, av);
        if (slideW > 0) {
          _tmp.copy(UP).multiplyScalar(-A.slideYawDamping * (0.25 + this.assist) * slideW * this.yawRate);
          torque.add(_tmp);
        }
        // Arcade stability at speed: the rear is pulled back in line with the direction of
        // travel, so a rear that steps out at 100+ km/h settles instead of snapping (highside).
        if (arcade && this.rear.grounded && av > 18) {
          const w = smoothstep(18, 35, av);
          _tmp.copy(UP).multiplyScalar(A.arcadeYawStiffness * m * w * clamp(this.rear.slipAngle, -0.5, 0.5) - A.yawDamping * w * this.yawRate * 0.6);
          torque.add(_tmp);
        }
        // Yaw damping (assist) tames snap slides without killing them.
        _tmp.copy(UP).multiplyScalar(-A.yawDamping * this.assist * this.yawRate * smoothstep(0, 4, av) * 0.3);
        torque.add(_tmp);
        // Steering damper: extra yaw calm at speed (independent of assist; it's hardware).
        if (sp.steering.damper > 0) torque.add(_tmp.copy(UP).multiplyScalar(-A.yawDamping * 0.18 * sp.steering.damper * this.yawRate * smoothstep(6, 20, av)));
        // Rider pulls / pushes the bars to pop the front (or rear) — fades once it is up, so
        // holding a wheelie or stoppie is about weight and throttle/brake, not a free torque.
        const pop = leanIn < 0 ? 1 - smoothstep(0.08, 0.4, this.pitch) : 1 - smoothstep(0.08, 0.4, -this.pitch);
        _tmp.copy(_left).multiplyScalar(leanIn * R.groundPitch * sp.steering.leverage * pop);
        torque.add(_tmp);
        // Balance damping in wheelies / stoppies.
        if (this.front.grounded !== this.rear.grounded && Math.abs(this.pitch) > 0.05) {
          _tmp.copy(_left).multiplyScalar(-R.balanceDamping * pitchRate);
          torque.add(_tmp);
        }
      } else {
        _tmp.copy(_left).multiplyScalar(leanIn * R.airPitch);
        torque.add(_tmp);
        // Rider instinct in the air: keep the bike parallel to the flight path for a clean
        // landing. Fades out while the player is actively leaning (so flips stay possible).
        const hv = Math.hypot(this.vel.x, this.vel.z);
        const path = Math.atan2(this.vel.y, Math.max(hv, 1)) * 0.8;
        const hands = (1 - Math.abs(leanIn)) * this.assist;
        if (hands > 0) {
          const pErr = clamp(this.pitch - path, -0.8, 0.8);
          // + torque about left = nose down; reduce positive error (nose too high) with nose-down torque.
          _tmp.copy(_left).multiplyScalar((A.airPitchStiffness * pErr - A.airPitchDamping * pitchRate) * hands);
          torque.add(_tmp);
        }
        _tmp.copy(UP).multiplyScalar(-steerIn * R.airYaw);
        torque.add(_tmp);
        const leanErr = clamp(this.lean, -0.8, 0.8);
        _tmp.copy(_fwd).multiplyScalar(-(A.airRollStiffness * leanErr * (0.4 + this.assist) + A.airRollDamping * leanRate));
        torque.add(_tmp);
      }
    }
    // Angular drag
    _tmp.copy(this.angVel).multiplyScalar(-TUNING.body.angularDrag);
    torque.add(_tmp);

    // --- Integrate ----------------------------------------------------------
    this.vel.addScaledVector(force, dt / m);
    _m3.setFromMatrix4(_m4.makeRotationFromQuaternion(this.quat));
    _m3t.copy(_m3).transpose();
    _tmp.copy(torque).applyMatrix3(_m3t);
    _tmp.multiply(this.invInertia);
    _tmp.applyMatrix3(_m3);
    this.angVel.addScaledVector(_tmp, dt);
    const maxW = TUNING.body.maxAngularSpeed;
    if (this.angVel.lengthSq() > maxW * maxW) this.angVel.setLength(maxW);
    if (this.vel.lengthSq() > TUNING.body.maxSpeed ** 2) this.vel.setLength(TUNING.body.maxSpeed);
    this.pos.addScaledVector(this.vel, dt);
    const wl = this.angVel.length();
    if (wl > 1e-9) {
      _q.setFromAxisAngle(_tmp.copy(this.angVel).multiplyScalar(1 / wl), wl * dt);
      this.quat.premultiply(_q).normalize();
    }
    if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z + this.vel.x + this.angVel.x + this.quat.w)) {
      // Never let a numerical failure leave the player stuck.
      this.place(this.prevPos.x || 0, this.prevPos.z || 0, 0);
      return;
    }
    this.distance += Math.abs(this.speed) * dt;

    // --- Air time, crash checks, safe states -------------------------------
    if (!this.front.grounded && !this.rear.grounded) {
      this.airTime += dt;
      this.airRot.x += pitchRate * dt;
      this.airRot.y += this.yawRate * dt;
      this.airRot.z += leanRate * dt;
    } else if (this.airTime > 0) {
      if (this.airTime > 0.25) this.events.push({ type: 'land', strength: this.maxImpact, surface: this.rear.surface });
      this.airTimeLast = this.airTime;
      this.airRotLast.copy(this.airRot);
      this.airTime = 0;
      this.airRot.set(0, 0, 0);
      this.maxImpact = 0;
    }
    if (!this.crashed && !arcade) {
      if (grounded && Math.abs(this.lean) > TUNING.crash.lean && av < 25) this.crash('lowside');
      else if (grounded && upright < -0.2) this.crash('upside-down');
    }
    if (!this.crashed && arcade) this.autoRight(dt, upright);
    if (this.crashed) {
      this.crashTime += dt;
      this.stepRider(dt);
    } else {
      this.safeTimer += dt;
      if (this.safeTimer > 0.5 && this.front.grounded && this.rear.grounded && Math.abs(this.lean) < 0.35 && upright > 0.9) {
        this.safeTimer = 0;
        this.safe.push({ pos: this.pos.clone(), yaw: this.yaw });
        if (this.safe.length > 12) this.safe.shift();
      }
    }
  }

  private wheel(
    ws: WheelState, w: WheelSpec, mount: Vector3, axisB: Vector3, wFwd: Vector3, wAxle: Vector3,
    driveT: number, brakeT: number, dt: number, force: Vector3, torque: Vector3, which: 'front' | 'rear',
  ) {
    const TT = TUNING.tire, TS = TUNING.suspension;
    this.bodyToWorld(mount, _mount);
    _axis.copy(axisB).applyQuaternion(this.quat);
    _wf.copy(wFwd);
    _wa.copy(wAxle);
    // Wheel-plane "down": the ground normal projected into the wheel plane.
    _down.copy(ws.grounded ? ws.normal : UP).negate();
    _down.addScaledVector(_wa, -_down.dot(_wa));
    if (_down.lengthSq() < 1e-4) _down.copy(_up).negate();
    _down.normalize();
    _pf.copy(_wf).addScaledVector(_down, -_wf.dot(_down)).normalize();

    // Probe the ground around the bottom of the tire.
    let best = -Infinity;
    let bestSurface: SurfaceId = 'asphalt';
    const look = w.travel + 0.6;
    _rayDir.copy(_axis).negate();
    // The tire is a torus: a ring of radius (r - rc) swept by a tube of radius rc.
    const rc = Math.min(w.radius * 0.35, w.width * 0.45);
    const rRing = w.radius - rc;
    _gdown.copy(ws.grounded ? ws.normal : UP).negate();
    for (let i = 0; i < this.probeAngles.length; i++) {
      const a = this.probeAngles[i];
      _o.copy(_down).multiplyScalar(Math.cos(a) * rRing).addScaledVector(_pf, Math.sin(a) * rRing);
      _bestTube.copy(_o);
      _o.addScaledVector(_gdown, rc);
      _start.copy(_mount).addScaledVector(_axis, w.travel).add(_o);
      if (!this.world.raycast(_start, _rayDir, look, this.hit)) continue;
      // Only surfaces facing the wheel count (an inverted bike's wheels touch nothing).
      if (this.hit.normal.dot(_axis) < 0.15) continue;
      const x = w.travel - this.hit.t;
      if (x > best) {
        best = x;
        _bestPoint.copy(this.hit.point);
        _bestNormal.copy(this.hit.normal);
        _bestRadial.copy(_bestTube).normalize().negate();
        bestSurface = this.hit.surface;
      }
    }
    // Small deterministic surface roughness on loose ground.
    const rough = SURFACE_PROPS[bestSurface].rough;
    if (rough > 0 && best > -0.5) {
      const px = _mount.x, pz = _mount.z;
      best += rough * (Math.sin(px * 3.1 + pz * 1.7) * Math.sin(pz * 2.3 - px * 0.9) + 0.5 * Math.sin(px * 7.3 + pz * 5.9));
    }
    ws.groundGap = Math.max(0, -best);
    const wasGrounded = ws.grounded;

    if (best < 0) {
      // Airborne: suspension extends (rebound-limited for visuals), wheel spins freely.
      ws.grounded = false;
      ws.compression = Math.max(0, ws.compression - 2.5 * dt);
      ws.compVel = 0;
      ws.load = 0;
      ws.slide = 0;
      ws.slipSpeed = 0;
      ws.longForce = ws.latForce = 0;
      ws.airTime += dt;
      ws.bottomed = false;
      this.prevPen[which] = 0;
      ws.center.copy(_mount).addScaledVector(_axis, ws.compression);
      // Free spin: drive + brake + bearing drag; reaction torques on the chassis.
      let tw = driveT - Math.sign(ws.omega) * 0.6;
      if (brakeT > 0) {
        const stopT = (Math.abs(ws.omega) * w.inertia) / dt;
        tw -= Math.sign(ws.omega) * Math.min(brakeT, stopT);
      }
      ws.omega += (tw / w.inertia) * dt;
      ws.angle += ws.omega * dt;
      _tmp.copy(_wa).multiplyScalar(-tw);
      torque.add(_tmp);
      return;
    }

    ws.airTime = 0;
    // --- Suspension ---
    const x = Math.min(best, w.travel);
    const xdot = clamp((x - ws.compression) / dt, -TS.maxVelocity, TS.maxVelocity);
    ws.compVel = xdot;
    ws.compression = x;
    const xr = x / w.travel;
    let F = w.spring * x * (1 + w.progression * 1.8 * xr * xr * xr) + w.preload * Math.min(1, x / 0.004);
    F += xdot > 0 ? w.compDamping * xdot : w.reboundDamping * xdot;
    F = Math.max(0, F);
    const pen = best - w.travel;
    ws.bottomed = pen > 0;
    if (pen > 0) {
      const pdot = (pen - this.prevPen[which]) / dt;
      F += TS.bumpStop * pen + TS.bumpDamping * Math.max(0, pdot);
      const impact = Math.max(0, pdot);
      this.maxImpact = Math.max(this.maxImpact, impact + xdot);
      if (!this.crashed && this.crashRule === 'realistic' && pdot + xdot > TUNING.crash.landing * this.spec.toughness) this.crash('hard landing');
      if (pdot > 1.2) this.events.push({ type: 'bump', strength: Math.min(1, pdot / 6), wheel: which });
    }
    this.prevPen[which] = Math.max(0, pen);
    if (!wasGrounded && (xdot > 1.5 || pen > 0)) {
      this.maxImpact = Math.max(this.maxImpact, xdot);
      this.events.push({ type: 'bump', strength: Math.min(1, xdot / 5), wheel: which });
    }

    // Contact normal: flat faces use the surface normal. Edges (curbs, ramp lips) use the
    // in-plane radial direction, judged in the wheel plane so lean does not count as an edge.
    const nAx = _bestNormal.dot(_wa);
    _tmp.copy(_bestNormal).addScaledVector(_wa, -nAx);
    const inPlane = _tmp.length() > 1e-4 ? _tmp.normalize().dot(_bestRadial) : 1;
    if (inPlane > 0.86) _n.copy(_bestNormal);
    else _n.copy(_bestRadial).addScaledVector(_wa, nAx).normalize();
    ws.normal.copy(_n);
    ws.contact.copy(_bestPoint);
    ws.surface = bestSurface;
    ws.grounded = true;
    ws.center.copy(_mount).addScaledVector(_axis, x);
    const axisDot = Math.max(TT.minAxisDot, _n.dot(_axis));
    const N = Math.min(TT.maxLoad, F / axisDot);
    ws.load = N;

    // --- Tire frame and slip ---
    _f.copy(_wa).cross(_n);
    if (_f.lengthSq() < 1e-6) _f.copy(_wf);
    _f.normalize();
    _l.copy(_n).cross(_f);
    // Contact point: bottom of the tire tube nearest the ground.
    _gc.copy(ws.center).addScaledVector(_down, rRing).addScaledVector(_n, -rc);
    this.pointVelocity(_gc, _vc);
    const vLong = _vc.dot(_f);
    const vLat = _vc.dot(_l);
    const tire = w.tire;
    const surf = SURFACE_PROPS[bestSurface];
    const mu = tire.mu[bestSurface] * RIDE_MODES[this.pt.mode].grip;
    const stiff = tire.stiffness[bestSurface];
    const slideR = tire.slideRatio;
    const peakSlip = tire.peakSlip / Math.sqrt(stiff);
    const tanPeak = Math.tan(tire.peakAngle / stiff);
    const denomLong = Math.max(Math.abs(vLong), TT.lowSpeedLong);
    const sy = -vLat / Math.max(Math.abs(vLong), TT.lowSpeedLat) / tanPeak;
    const muN = mu * N;

    // Sub-stepped wheel spin with the longitudinal tire force.
    const n = TUNING.wheelSubsteps;
    const h = dt / n;
    const r = w.radius;
    let fxSum = 0, fySum = 0, tmbSum = 0;
    let s = 0, sx = 0;
    const ABS = this.spec.abs && brakeT > 0;
    for (let k = 0; k < n; k++) {
      sx = (ws.omega * r - vLong) / denomLong / peakSlip;
      s = Math.hypot(sx, sy);
      let shape = 0;
      if (s > 1e-6) shape = s <= 1 ? s * (2 - s) : slideR + (1 - slideR) * Math.exp(-TT.falloff * (s - 1));
      let fx = s > 1e-6 ? (muN * shape * sx) / s : 0;
      const fy = s > 1e-6 ? (muN * shape * sy) / s : 0;
      // Brake / drive on the wheel.
      let bT = brakeT;
      if (ABS && sx < -0.9) bT *= 0.35;
      let tw = driveT - fx * r;
      const omega0 = ws.omega;
      let tBrakeSigned = 0;
      if (bT > 0) {
        if (Math.abs(omega0) < 1e-3) {
          // Static hold: brake can cancel net torque up to capacity.
          tBrakeSigned = clamp(-tw, -bT, bT);
        } else {
          tBrakeSigned = -Math.sign(omega0) * bT;
        }
      }
      let omega1 = omega0 + ((tw + tBrakeSigned) / w.inertia) * h;
      if (bT > 0 && Math.sign(omega1) !== Math.sign(omega0) && Math.abs(omega0) >= 1e-3) {
        // Brake would reverse spin — lock instead.
        omega1 = 0;
        tBrakeSigned = (-omega0 * w.inertia) / h - tw;
      } else if (bT > 0 && Math.abs(omega0) < 1e-3 && Math.abs(tw) <= bT) {
        omega1 = 0;
      }
      ws.omega = omega1;
      fxSum += fx;
      fySum += fy;
      tmbSum += driveT + tBrakeSigned;
      fx = 0;
    }
    const Fx = fxSum / n, Fy = fySum / n, Tmb = tmbSum / n;
    ws.angle += ws.omega * dt;
    ws.slipRatio = (ws.omega * r - vLong) / denomLong;
    ws.slipAngle = Math.atan2(vLat, Math.max(Math.abs(vLong), 0.5));
    ws.slide = Math.max(0, s - 1);
    ws.slipSpeed = Math.hypot(ws.omega * r - vLong, vLat);
    ws.longForce = Fx;
    ws.latForce = Fy;

    // Rolling resistance & loose-surface sink.
    const rr = -(surf.crr * tire.rolling * N) * Math.tanh(vLong / 0.4) - surf.sink * N * vLong * 0.5;

    // Total ground force on the wheel.
    _tmp.copy(_n).multiplyScalar(N).addScaledVector(_f, Fx + rr).addScaledVector(_l, Fy);
    // Chassis: full force at the contact, minus the spin-axis moment that went into the wheel,
    // plus the reaction of drive/brake torque.
    force.add(_tmp);
    _r.copy(_gc).sub(this.pos).cross(_tmp);
    torque.add(_r);
    const spinMoment = -r * Fx * _l.dot(_wa);
    torque.addScaledVector(_wa, -spinMoment - Tmb);
  }

  private bodyProbes(dt: number, force: Vector3, torque: Vector3) {
    const B = TUNING.body;
    const sp = this.spec;
    let touching = false;
    let crashHit = '';
    let scrape = 0;
    const probe = (p: Vector3, r: number, crashProbe: boolean, name: string) => {
      const depth = this.world.penetration(p, r, this.hit2);
      if (depth <= 0) return;
      const n = this.hit2.normal;
      this.pointVelocity(p, _vp);
      const vn = _vp.dot(n);
      const Fn = Math.max(0, B.contactStiffness * Math.min(depth, 0.25) - B.contactDamping * vn);
      _tmp.copy(_vp).addScaledVector(n, -vn);
      const vt = _tmp.length();
      const fr = (B.friction * Fn) / Math.max(vt, 0.3);
      _tmp.multiplyScalar(-fr).addScaledVector(n, Fn);
      this.applyForce(_tmp, p, force, torque);
      touching = true;
      // A rider-body contact is a crash when it is a real impact (or the bike is lying down).
      // Gentle touches (a bar end brushing a bank, a slow tip at walking pace) are a dab.
      if (this.crashRule === 'arcade') {
        // Arcade: only a real hit into something (a wall, tree, pole: a steep surface) at 30+ mph.
        // The ground, ramps and glancing scrapes along a wall never crash.
        const C = TUNING.crash;
        if (n.y < 0.55 && this.stepSpeed >= C.arcadeSpeed && -vn >= Math.max(C.arcadeImpact, this.stepSpeed * 0.35)) crashHit = name;
      } else if (crashProbe && depth > 0.012) {
        // Head-on speed into the surface counts fully; sliding along it (a bar end scraping a
        // wall) much less.
        const impact = Math.max(-vn, vt * 0.2);
        const lying = Math.abs(this.lean) > 1.0 || _up.y < 0.35;
        const limit = lerp(1.2, 5.5, this.assist) * sp.toughness;
        if (lying || impact > limit || depth > 0.12) crashHit = name;
      }
      // Front/rear tyre straight into a wall: a crash only above a speed that grows with assist.
      if (this.crashRule === 'realistic' && !crashProbe && -vn > lerp(7, 11, this.assist) * sp.toughness && name.startsWith('tire')) crashHit = name;
      if (!crashProbe) scrape = Math.max(scrape, vt);
    };
    for (const bp of sp.bodyPoints) {
      this.bodyToWorld(_bp.set(bp.p.x, bp.p.y, bp.p.z), _pw);
      probe(_pw, bp.r, bp.crash, bp.name);
    }
    // Tire "bumpers" catch walls the downward probes cannot see.
    for (const [ws, wspec, which] of [[this.front, sp.front, 'tireF'], [this.rear, sp.rear, 'tireR']] as const) {
      const dir = which === 'tireF' ? 1 : -1;
      _pw.copy(ws.center.lengthSq() > 0 ? ws.center : this.pos).addScaledVector(_fwd, dir * (wspec.radius - 0.11));
      _pw.addScaledVector(_up, 0.04);
      probe(_pw, 0.12, false, which);
    }
    if (scrape > 1 && touching) this.events.push({ type: 'scrape', strength: Math.min(1, scrape / 10) });
    this.bodyContact = touching ? this.bodyContact + dt : 0;
    if (crashHit && !this.crashed) this.crash(crashHit);
  }

  /**
   * Arcade: a bike that ends up on its side or upside down (a slow tip, a wall bounce, a bad
   * landing) is stood back up within a moment instead of crashing.
   */
  private autoRight(dt: number, upright: number) {
    const touching = this.front.grounded || this.rear.grounded || this.bodyContact > 0;
    // Leaned past what the rider can hold (the tyres let go mid-turn): the rider catches it,
    // stepping the lean back to the limit instead of letting the bike lie down.
    const excess = Math.abs(this.lean) - (this.maxLeanNow + 0.12);
    if (touching && excess > 0 && upright > 0.2) {
      _q.setFromAxisAngle(_fwd, -Math.sign(this.lean) * Math.min(excess, 2.5 * dt));
      this.quat.premultiply(_q).normalize();
      const lr = this.angVel.dot(_fwd);
      if (Math.sign(lr) === Math.sign(this.lean)) this.angVel.addScaledVector(_fwd, -lr * Math.min(1, 20 * dt));
    }
    const down = touching && (Math.abs(this.lean) > Math.max(1.05, this.maxLeanNow + 0.3) || upright < 0.45);
    this.downTime = down ? this.downTime + dt : Math.max(0, this.downTime - dt * 2);
    if (this.downTime < 0.3) return;
    if (!this.righting) this.rightings++;
    this.righting = true;
    _q.setFromAxisAngle(UP, this.yaw);
    this.quat.slerp(_q, Math.min(1, 7 * dt)).normalize();
    this.angVel.multiplyScalar(Math.max(0, 1 - 12 * dt));
    // Ease off sideways momentum and lift clear of the ground while righting.
    this.vel.x *= 1 - 2 * dt;
    this.vel.z *= 1 - 2 * dt;
    const clearance = this.world.heightAt(this.pos.x, this.pos.z) + this.rideHeight() * 0.9;
    if (this.pos.y < clearance) this.pos.y += Math.min(clearance - this.pos.y, 3 * dt);
    if (upright > 0.97 && Math.abs(this.lean) < 0.15) {
      this.downTime = 0;
      this.righting = false;
    }
  }

  crash(cause: string) {
    if (this.crashed) return;
    // Going over backwards while holding the wheelie button is a loop-out, whatever touched first.
    if (this.wheelieHold > 1 && this.pitch > 0.8) cause = 'looped out';
    this.crashed = true;
    this.crashTime = 0;
    this.crashCause = cause;
    this.events.push({ type: 'crash', speed: this.vel.length(), cause });
    const sp = this.spec;
    this.bodyToWorld(vfrom(sp.rider.hip).add(tv(0, 0.35, 0)), this.rider.pos);
    this.rider.vel.copy(this.vel).multiplyScalar(0.9).add(tv(0, 1.2, 0));
    this.rider.spin.set(this.angVel.x + 2, this.angVel.y, this.angVel.z + 1.5);
    this.rider.rot.copy(this.quat);
  }

  private stepRider(dt: number) {
    const r = this.rider;
    r.vel.y -= TUNING.gravity * dt;
    r.pos.addScaledVector(r.vel, dt);
    const d = this.world.penetration(r.pos, 0.3, this.hit2);
    if (d > 0) {
      const n = this.hit2.normal;
      r.pos.addScaledVector(n, d);
      const vn = r.vel.dot(n);
      if (vn < 0) r.vel.addScaledVector(n, -vn * 1.25);
      // Ground friction + rolling
      r.vel.multiplyScalar(Math.max(0, 1 - 3.5 * dt));
      r.spin.multiplyScalar(Math.max(0, 1 - 4 * dt));
    }
    const wl = r.spin.length();
    if (wl > 1e-6) {
      _q.setFromAxisAngle(_tmp.copy(r.spin).multiplyScalar(1 / wl), wl * dt);
      r.rot.premultiply(_q).normalize();
    }
  }

  /** True when the bike has crashed long enough that we should auto-reset. */
  get wantsReset() {
    return this.crashed && this.crashTime > TUNING.crash.autoReset;
  }
}
