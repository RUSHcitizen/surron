/** Third-person chase camera with collision, look-ahead, orbit and a helmet view. */
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { CollisionWorld } from '../world/collision';
import { makeHit } from '../world/collision';

export type CamMode = 'chase' | 'far' | 'helmet';
const MODES: CamMode[] = ['chase', 'far', 'helmet'];

const _t = new Vector3(), _d = new Vector3(), _p = new Vector3(), _f = new Vector3(), _q = new Quaternion();

export class ChaseCamera {
  mode: CamMode = 'chase';
  distance = 4.2;
  sensitivity = 1;
  fovBase = 62;
  private yaw = 0;
  private orbitYaw = 0;
  private orbitPitch = 0;
  private orbitIdle = 0;
  private pos = new Vector3();
  private target = new Vector3();
  private shake = 0;
  /** Spring velocities (critically damped follow: smooth starts and stops, no snapping). */
  private posVel = new Vector3();
  private tgtVel = new Vector3();
  private offset = new Vector3();
  /** 0..1: how far the camera has swung out to show a wheelie / stoppie from the side. */
  private trickView = 0;
  private trickSide = 1;
  private hit = makeHit();
  private initialized = false;

  constructor(public camera: PerspectiveCamera, private world: CollisionWorld) {}

  cycle() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this.initialized = false;
  }

  bump(strength: number) {
    this.shake = Math.min(1, this.shake + strength);
  }

  snap() {
    this.initialized = false;
  }

  orbit(dx: number, dy: number, wheel: number) {
    if (dx || dy) {
      this.orbitYaw -= dx * 0.006 * this.sensitivity;
      this.orbitPitch = Math.max(-0.35, Math.min(1.0, this.orbitPitch + dy * 0.004 * this.sensitivity));
      this.orbitIdle = 0;
    }
    if (wheel) this.distance = Math.max(2.5, Math.min(9, this.distance + wheel * 0.4));
  }

  update(dt: number, bikePos: Vector3, bikeQuat: Quaternion, vel: Vector3, headPos: Vector3 | null, crashed: boolean) {
    const cam = this.camera;
    const speed = vel.length();
    _f.set(0, 0, 1).applyQuaternion(bikeQuat);
    const headingYaw = Math.atan2(_f.x, _f.z);
    // Follow the direction of travel at speed (so slides stay framed), the bike's nose when slow.
    const hv = Math.hypot(vel.x, vel.z);
    let desiredYaw = headingYaw;
    if (hv > 3 && !crashed) {
      const velYaw = Math.atan2(vel.x, vel.z);
      let diff = velYaw - headingYaw;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      desiredYaw = headingYaw + diff * Math.min(0.6, (hv - 3) / 10);
    }
    if (!this.initialized) {
      this.yaw = desiredYaw;
      this.target.copy(bikePos);
      this.posVel.set(0, 0, 0);
      this.tgtVel.set(0, 0, 0);
      this.trickView = 0;
    }
    // Wheelies and stoppies are invisible from straight behind: swing out to a three-quarter
    // view while the bike is pitched up or down, and come back when it settles.
    const pitch = Math.asin(Math.max(-1, Math.min(1, _f.y)));
    const want = crashed ? 0 : Math.max(0, Math.min(1, (Math.abs(pitch) - 0.1) / 0.22));
    if (want > 0.05 && this.trickView < 0.05) this.trickSide = this.orbitYaw > 0.05 ? -1 : 1;
    this.trickView += (want - this.trickView) * Math.min(1, (want > this.trickView ? 3 : 1.4) * dt);
    let dy = desiredYaw - this.yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    const yawRate = crashed ? 1.2 : 3.2 + Math.min(3, speed * 0.1);
    this.yaw += dy * Math.min(1, yawRate * dt);
    this.orbitIdle += dt;
    if (this.orbitIdle > 1.5) {
      const k = Math.min(1, 2.5 * dt);
      this.orbitYaw *= 1 - k;
      this.orbitPitch *= 1 - k;
    }

    if (this.mode === 'helmet' && headPos && !crashed) {
      // Helmet cam: rider's head, with roll partially damped so it stays readable.
      cam.position.copy(headPos);
      _q.copy(bikeQuat);
      _d.set(0, 0, 1).applyQuaternion(_q);
      _t.copy(headPos).addScaledVector(_d, 10).addScaledVector(vel, 0.05);
      cam.up.set(0, 1, 0).applyQuaternion(_q).lerp(new Vector3(0, 1, 0), 0.6).normalize();
      cam.lookAt(_t);
      cam.fov = this.fovBase + 6 + Math.min(14, speed * 0.35);
      cam.updateProjectionMatrix();
      this.initialized = true;
      return;
    }
    cam.up.set(0, 1, 0);
    const tv = this.trickView;
    // Pull back a little with speed (more room to read the road at 200 km/h).
    const dist = (this.mode === 'far' ? this.distance * 1.7 : this.distance) + Math.min(2.2, speed * 0.035) + tv * 0.5;
    const height = (this.mode === 'far' ? 2.2 : 1.35) - tv * 0.45 + this.orbitPitch * dist * 0.6;
    // Target: bike + up. Springs (stiff horizontally, softer vertically) keep the follow smooth
    // over bumps and landings without lagging behind at speed.
    _t.copy(bikePos);
    _t.y += 0.75 + tv * 0.15;
    if (!this.initialized) this.target.copy(_t);
    // Horizontally the target is exact (no lag at any speed); vertically it is sprung.
    this.target.x = _t.x;
    this.target.z = _t.z;
    this.tgtVel.y += (81 * (_t.y - this.target.y) - 18 * this.tgtVel.y) * Math.min(dt, 0.05);
    this.target.y += this.tgtVel.y * Math.min(dt, 0.05);
    const yaw = this.yaw + this.orbitYaw + Math.PI + tv * 0.75 * this.trickSide;
    _p.set(Math.sin(yaw) * dist, height, Math.cos(yaw) * dist).add(this.target);
    // Keep above ground
    const g = this.world.heightAt(_p.x, _p.z) + 0.6;
    if (_p.y < g) _p.y = g;
    // Collision: pull in if geometry blocks the view.
    _d.subVectors(_p, this.target);
    const len = _d.length();
    _d.multiplyScalar(1 / len);
    let maxLen = Infinity;
    if (this.world.raycast(this.target, _d, len, this.hit, true, 'pole') && this.hit.t > 0.2) {
      maxLen = Math.max(0.8, this.hit.t - 0.3);
      _p.copy(this.target).addScaledVector(_d, maxLen);
    }
    // The offset from the target is what gets smoothed, so the camera eases through turns and
    // over crests but never trails further behind as speed rises.
    _d.subVectors(_p, this.target);
    if (!this.initialized) this.offset.copy(_d);
    spring(this.offset, this.posVel, _d, 7, 9, dt);
    // A wall between camera and bike pulls the camera in at once (no clipping through it).
    if (this.offset.length() > maxLen) this.offset.setLength(maxLen);
    this.pos.copy(this.target).add(this.offset);
    // Never let the spring carry the camera into the ground.
    const gMin = this.world.heightAt(this.pos.x, this.pos.z) + 0.4;
    if (this.pos.y < gMin) this.pos.y = gMin;
    cam.position.copy(this.pos);
    // Look slightly ahead of the bike at speed.
    _t.copy(this.target).addScaledVector(vel, Math.min(0.25, 0.012 * speed));
    _t.y += 0.15;
    if (this.shake > 0.001) {
      const s = this.shake * 0.08;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      this.shake *= Math.max(0, 1 - 6 * dt);
    }
    cam.lookAt(_t);
    // Wider view as speed builds (strongest sense of speed at Hyper-mode velocities).
    cam.fov = this.fovBase + Math.min(20, speed * 0.25 + Math.max(0, speed - 30) * 0.12);
    cam.updateProjectionMatrix();
    this.initialized = true;
  }
}

/**
 * Critically damped spring toward `goal` (per-axis stiffness: w for x/z, wy for y), stable
 * for any frame time (sub-stepped).
 */
function spring(pos: Vector3, vel: Vector3, goal: Vector3, w: number, wy: number, dt: number) {
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    vel.x += (w * w * (goal.x - pos.x) - 2 * w * vel.x) * h;
    vel.z += (w * w * (goal.z - pos.z) - 2 * w * vel.z) * h;
    vel.y += (wy * wy * (goal.y - pos.y) - 2 * wy * vel.y) * h;
    pos.addScaledVector(vel, h);
  }
}
