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
    }
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
    const dist = (this.mode === 'far' ? this.distance * 1.7 : this.distance) + Math.min(1.5, speed * 0.04);
    const height = (this.mode === 'far' ? 2.2 : 1.35) + this.orbitPitch * dist * 0.6;
    // Target: bike + up, smoothed vertically (keeps jumps readable without jitter).
    _t.copy(bikePos);
    _t.y += 0.75;
    const k = Math.min(1, 14 * dt), ky = Math.min(1, 7 * dt);
    this.target.x += (_t.x - this.target.x) * k;
    this.target.z += (_t.z - this.target.z) * k;
    this.target.y += (_t.y - this.target.y) * ky;
    if (!this.initialized) this.target.copy(_t);
    const yaw = this.yaw + this.orbitYaw + Math.PI;
    _p.set(Math.sin(yaw) * dist, height, Math.cos(yaw) * dist).add(this.target);
    // Keep above ground
    const g = this.world.heightAt(_p.x, _p.z) + 0.6;
    if (_p.y < g) _p.y = g;
    // Collision: pull in if geometry blocks the view.
    _d.subVectors(_p, this.target);
    const len = _d.length();
    _d.multiplyScalar(1 / len);
    if (this.world.raycast(this.target, _d, len, this.hit, true, 'pole') && this.hit.t > 0.2) {
      _p.copy(this.target).addScaledVector(_d, Math.max(0.8, this.hit.t - 0.3));
    }
    if (!this.initialized) this.pos.copy(_p);
    const kp = Math.min(1, 10 * dt);
    this.pos.lerp(_p, kp);
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
    cam.fov = this.fovBase + Math.min(12, speed * 0.28);
    cam.updateProjectionMatrix();
    this.initialized = true;
  }
}
