/**
 * City traffic: electric cars driving the street grid in the right-hand lane. They turn at
 * junctions on smooth curves, keep their distance, yield to whoever is already in the
 * junction, and brake (and honk) for a bike in their lane, but not instantly: a bike that
 * cuts across them has to dodge. Each car is a moving collision box, so a hit really hits.
 *
 * Rendering is three instanced meshes for the whole fleet (body, wheels, lights). The body is
 * one smooth sculpted shell (SDF-meshed once) with dark glass and bumpers in vertex colour,
 * tinted per car.
 */
import {
  BufferAttribute, BufferGeometry, Color, CylinderGeometry, Group, InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial,
  Quaternion, Vector3, BoxGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CITY_X, CITY_Z } from './layout';
import type { BoxCollider, CollisionWorld } from './collision';
import { mulberry32 } from '../core/noise';
import { meshSDF, roundBox, smin, ssub } from '../render/sdfMesh';

/** Lane centre offset from the road centre line, and where junction curves start/end. */
const LANE = 3;
const TURN = 7.5;
export const CAR = { length: 4.4, width: 1.86, height: 1.5 };
const ACCEL = 2.6;
const BRAKE = 7;
/** Cars only notice a bike this close in their lane (m, beyond their own stopping room). */
const BIKE_LOOK = 7;

const PAINT = [0xf2f2f0, 0x16181c, 0xb9bec6, 0x5b616b, 0x1d3f8a, 0xa3161c, 0x23493a, 0xd8cdb4, 0x2b6cb0, 0x7a7f87, 0xe8e8ea, 0x30343b];

interface Curve { ax: number; az: number; cx: number; cz: number; bx: number; bz: number; len: number }
interface Car {
  id: number;
  /** Node index (i over CITY_X, j over CITY_Z) the car is heading to, and its road direction. */
  ni: number; nj: number;
  dx: number; dz: number;
  /** Exit direction planned at that node. */
  ex: number; ez: number;
  phase: 'road' | 'turn';
  curve: Curve;
  u: number;
  v: number;
  vmax: number;
  x: number; z: number; yaw: number;
  fx: number; fz: number;
  pitch: number;
  body: BoxCollider;
  /** Car this one is waiting behind (-1 none, -2 the bike, -3 a busy junction). */
  blockedBy: number;
  horn: number;
  /** Seconds stopped; a car stuck far too long (a rare gridlock) briefly ignores other cars. */
  stopped: number;
  ghost: number;
}

/** A traffic event the game turns into sound / score. */
export interface TrafficEvent { type: 'horn' | 'nearMiss'; x: number; z: number }

const _m = new Matrix4(), _q = new Quaternion(), _q2 = new Quaternion(), _p = new Vector3(), _s = new Vector3(1, 1, 1);
const _up = new Vector3(0, 1, 0), _x = new Vector3(1, 0, 0);

/** Highest speed from which a car can still pull up comfortably within `room` metres. */
function stopV(room: number) {
  return room > 0 ? Math.sqrt(2 * 4.5 * room) : 0;
}

function bez(c: Curve, u: number, out: { x: number; z: number; tx: number; tz: number }) {
  const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), d = u * u;
  out.x = a * c.ax + b * c.cx + d * c.bx;
  out.z = a * c.az + b * c.cz + d * c.bz;
  out.tx = 2 * (1 - u) * (c.cx - c.ax) + 2 * u * (c.bx - c.cx);
  out.tz = 2 * (1 - u) * (c.cz - c.az) + 2 * u * (c.bz - c.cz);
}

function curve(ax: number, az: number, cx: number, cz: number, bx: number, bz: number): Curve {
  const len = (Math.hypot(cx - ax, cz - az) + Math.hypot(bx - cx, bz - cz) + Math.hypot(bx - ax, bz - az)) / 2;
  return { ax, az, cx, cz, bx, bz, len: Math.max(0.5, len) };
}

/** Body shell in car space (x right, y up from the ground, z forward), with vertex colours. */
function bodyGeometry(): BufferGeometry {
  const W = CAR.width / 2, Lh = CAR.length / 2;
  const sdf = (x: number, y: number, z: number) => {
    // Lower body with a slightly lower nose, cabin set back, tapered greenhouse.
    const nose = Math.max(0, z - 1.2) * 0.12;
    let d = roundBox(x, y - 0.66 + nose * 0.5, z, W - 0.02, 0.3 - nose * 0.5, Lh - 0.02, 0.2);
    const tx = x * (1 + Math.max(0, y - 1.0) * 0.6);
    const tz = z + 0.25 - (y - 1.0) * 0.35 * Math.sign(z + 0.25) * 0.6;
    d = smin(d, roundBox(tx, y - 1.13, tz, W - 0.13, 0.3, 1.2, 0.24), 0.14);
    // Wheel arches.
    for (const zc of [1.38, -1.38]) {
      const cyl = Math.max(Math.hypot(y - 0.36, z - zc) - 0.43, Math.abs(x) - W - 0.2);
      d = ssub(d, cyl, 0.04);
    }
    return Math.max(d, 0.2 - y);
  };
  const m = meshSDF(sdf, [-W - 0.1, 0.1, -Lh - 0.1], [W + 0.1, CAR.height + 0.08, Lh + 0.1], 0.12);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new BufferAttribute(m.normals, 3));
  g.setIndex(new BufferAttribute(m.indices, 1));
  const n = m.positions.length / 3;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = m.positions[i * 3], y = m.positions[i * 3 + 1], z = m.positions[i * 3 + 2];
    let c = 1;
    // Glass band round the cabin (roof stays paint).
    if (y > 0.98 && y < 1.36 && z < 1.05 && z > -1.5) c = 0.07;
    // Dark bumpers and sills.
    if (y < 0.34 || (Math.abs(z) > Lh - 0.12 && y < 0.5)) c = 0.12;
    void x;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = c;
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

function tint(g: BufferGeometry, c: Color) {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new BufferAttribute(a, 3));
  g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
}

function wheelGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const zc of [1.38, -1.38]) {
    const tyre = new CylinderGeometry(0.36, 0.36, 0.24, 16).rotateZ(Math.PI / 2).translate(sx * (CAR.width / 2 - 0.16), 0.36, zc);
    const rim = new CylinderGeometry(0.22, 0.22, 0.02, 12).rotateZ(Math.PI / 2).translate(sx * (CAR.width / 2 - 0.03), 0.36, zc);
    parts.push(tint(tyre, new Color(0x141518)), tint(rim, new Color(0x9aa0a8)));
  }
  return mergeGeometries(parts, false)!;
}

function lightGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const Lh = CAR.length / 2;
  for (const sx of [-1, 1]) {
    parts.push(tint(new BoxGeometry(0.42, 0.1, 0.05).translate(sx * 0.6, 0.78, Lh - 0.04), new Color(0xfff4d6)));
    parts.push(tint(new BoxGeometry(0.4, 0.09, 0.05).translate(sx * 0.6, 0.82, -Lh + 0.04), new Color(0xd0141c)));
  }
  // Light bar across the tail (a common EV look).
  parts.push(tint(new BoxGeometry(0.8, 0.04, 0.04).translate(0, 0.82, -Lh + 0.03), new Color(0x9e0f15)));
  return mergeGeometries(parts, false)!;
}

export class Traffic {
  root = new Group();
  cars: Car[] = [];
  events: TrafficEvent[] = [];
  private body: InstancedMesh;
  private wheels: InstancedMesh;
  private lights: InstancedMesh;
  private active: number;
  private pt = { x: 0, z: 0, tx: 0, tz: 1 };
  private r: () => number;
  /** Junction (node key) → id of the car crossing it. One car at a time, so crossing
   *  traffic never meets in the middle. */
  private junction = new Map<number, number>();

  constructor(private world: CollisionWorld, count: number, seed = 11) {
    this.r = mulberry32(seed);
    const r = this.r;
    const bodyMat = new MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.32 });
    this.body = new InstancedMesh(bodyGeometry(), bodyMat, Math.max(1, count));
    this.wheels = new InstancedMesh(wheelGeometry(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 }), Math.max(1, count));
    this.lights = new InstancedMesh(lightGeometry(), new MeshBasicMaterial({ vertexColors: true, toneMapped: false }), Math.max(1, count));
    for (const m of [this.body, this.wheels, this.lights]) {
      m.frustumCulled = false;
      this.root.add(m);
    }
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    for (let i = 0; i < count; i++) {
      const car = this.spawn(i, r);
      this.cars.push(car);
      this.body.setColorAt(i, new Color(PAINT[Math.floor(r() * PAINT.length)]));
    }
    this.active = count;
    this.render();
  }

  private dirOk(i: number, j: number, dx: number, dz: number) {
    const a = i + dx, b = j + dz;
    return a >= 0 && a < CITY_X.length && b >= 0 && b < CITY_Z.length;
  }

  /** Road curve from node (i, j) leaving in direction d to the next node. */
  private roadCurve(i: number, j: number, dx: number, dz: number): Curve {
    const x0 = CITY_X[i], z0 = CITY_Z[j], x1 = CITY_X[i + dx], z1 = CITY_Z[j + dz];
    const rx = -dz * LANE, rz = dx * LANE; // right-hand side of travel
    const ax = x0 + dx * TURN + rx, az = z0 + dz * TURN + rz, bx = x1 - dx * TURN + rx, bz = z1 - dz * TURN + rz;
    return curve(ax, az, (ax + bx) / 2, (az + bz) / 2, bx, bz);
  }

  /** Junction curve at node (i, j): in along d, out along e. */
  private turnCurve(i: number, j: number, dx: number, dz: number, ex: number, ez: number): Curve {
    const nx = CITY_X[i], nz = CITY_Z[j];
    const rdx = -dz * LANE, rdz = dx * LANE, rex = -ez * LANE, rez = ex * LANE;
    const ax = nx - dx * TURN + rdx, az = nz - dz * TURN + rdz, bx = nx + ex * TURN + rex, bz = nz + ez * TURN + rez;
    const straight = dx === ex && dz === ez;
    return straight ? curve(ax, az, (ax + bx) / 2, (az + bz) / 2, bx, bz) : curve(ax, az, nx + rdx + rex, nz + rdz + rez, bx, bz);
  }

  /** Pick the exit at the node ahead: mostly straight on, sometimes a turn, never a U-turn. */
  private planExit(c: Car) {
    const opts: [number, number, number][] = [];
    const add = (ex: number, ez: number, w: number) => { if (this.dirOk(c.ni, c.nj, ex, ez)) opts.push([ex, ez, w]); };
    add(c.dx, c.dz, 2);
    add(c.dz, -c.dx, 1);
    add(-c.dz, c.dx, 1);
    let tot = 0;
    for (const o of opts) tot += o[2];
    let k = this.r() * tot;
    for (const o of opts) {
      k -= o[2];
      if (k <= 0) { c.ex = o[0]; c.ez = o[1]; return; }
    }
    c.ex = opts[0][0];
    c.ez = opts[0][1];
  }

  private spawn(id: number, r: () => number): Car {
    for (let tries = 0; ; tries++) {
      const i = Math.floor(r() * CITY_X.length), j = Math.floor(r() * CITY_Z.length);
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => this.dirOk(i, j, dx, dz));
      const [dx, dz] = dirs[Math.floor(r() * dirs.length)];
      const cv = this.roadCurve(i, j, dx, dz);
      const u = 0.05 + r() * 0.85;
      bez(cv, u, this.pt);
      const clear = this.cars.every((o) => Math.hypot(o.x - this.pt.x, o.z - this.pt.z) > 12);
      if (!clear && tries < 40) continue;
      const car: Car = {
        id, ni: i + dx, nj: j + dz, dx, dz, ex: dx, ez: dz, phase: 'road', curve: cv, u, v: 0, vmax: 10 + r() * 5,
        x: this.pt.x, z: this.pt.z, yaw: Math.atan2(dx, dz), fx: dx, fz: dz, pitch: 0,
        body: this.world.addDynamic(CAR.width, CAR.height, CAR.length, 'car'), blockedBy: -1, horn: 0, stopped: 0, ghost: 0,
      };
      car.v = car.vmax * 0.8;
      this.planExit(car);
      return car;
    }
  }

  /** Cars beyond `n` are parked out of the way (quality setting). */
  setCount(n: number) {
    this.active = Math.max(0, Math.min(n, this.cars.length));
    for (let i = this.active; i < this.cars.length; i++) this.world.setPose(this.cars[i].body, 0, -500, 0, 0, 0, 0);
    this.body.count = this.wheels.count = this.lights.count = this.active;
  }

  /** bike: position and velocity (m, m/s). */
  update(dt: number, bx: number, bz: number, bvx: number, bvz: number) {
    dt = Math.min(dt, 0.1);
    const n = this.active;
    const bs = Math.hypot(bvx, bvz);
    for (let ci = 0; ci < n; ci++) {
      const c = this.cars[ci];
      const fx = c.fx, fz = c.fz;
      // Target speed: cruising, slower through turns, braking for the turn ahead.
      const turning = c.ex !== c.dx || c.ez !== c.dz;
      const turnV = turning ? 6.5 : c.vmax;
      let want = c.vmax;
      if (c.phase === 'turn') want = turnV;
      else {
        const left = (1 - c.u) * c.curve.len;
        want = Math.min(want, Math.sqrt(turnV * turnV + 2 * 3 * left));
      }
      // Keep a gap to whatever is ahead in the lane (other cars, and the bike when close).
      c.blockedBy = -1;
      const look = 6 + c.v * 1.5;
      for (let oi = 0; oi < n && c.ghost <= 0; oi++) {
        if (oi === ci) continue;
        const o = this.cars[oi];
        const rx = o.x - c.x, rz = o.z - c.z;
        const ahead = rx * fx + rz * fz;
        if (ahead <= 0 || ahead > look) continue;
        const lat = Math.abs(rx * fz - rz * fx);
        if (lat > 2.6) continue;
        // Two cars waiting on each other: the lower id goes first. A car waiting at the line
        // of the junction this one is crossing does not hold it up.
        if (o.blockedBy === ci && ci < oi) continue;
        if (o.blockedBy === -3 && c.phase === 'turn') continue;
        const v = stopV(ahead - CAR.length - 2.5);
        if (v < want) { want = v; c.blockedBy = oi; }
      }
      // Junction ahead: the front car of the lane claims it in time to stop if it is free;
      // anyone else waits at the line.
      if (c.phase === 'road' && c.ghost <= 0) {
        const key = c.ni * 16 + c.nj;
        const left = (1 - c.u) * c.curve.len;
        const owner = this.junction.get(key);
        let front = true;
        for (let oi = 0; oi < n && front; oi++) {
          const o = this.cars[oi];
          if (oi !== ci && o.phase === 'road' && o.ni === c.ni && o.nj === c.nj && o.dx === c.dx && o.dz === c.dz && o.u > c.u) front = false;
        }
        // (Claimed early enough that a car finding it taken can still pull up comfortably.)
        if (owner === undefined && front && left < 4 + (c.v * c.v) / BRAKE) this.junction.set(key, ci);
        else if (owner !== undefined && owner !== ci) {
          const v = stopV(left - 0.3);
          if (v < want) { want = v; c.blockedBy = -3; }
        }
      }
      {
        const rx = bx - c.x, rz = bz - c.z;
        const ahead = rx * fx + rz * fz;
        const lat = Math.abs(rx * fz - rz * fx);
        // Brakes only once the bike is close in front: the stopping distance at this speed
        // plus a short reaction margin, so cutting in front of a car is genuinely risky.
        const stop = (c.v * c.v) / (2 * BRAKE);
        if (ahead > 0 && ahead < stop + BIKE_LOOK && lat < 1.9) {
          const v = stopV(ahead - CAR.length / 2 - 2);
          if (v < want) {
            want = v;
            if (c.blockedBy !== -2 && c.horn <= 0 && c.v > 3) {
              this.events.push({ type: 'horn', x: c.x, z: c.z });
              c.horn = 3;
            }
            c.blockedBy = -2;
          }
        }
        // Near miss: the bike flashes past close to the car at a good closing speed.
        const d2 = rx * rx + rz * rz;
        if (d2 < 3.2 * 3.2 && c.horn < 1.5) {
          const rvx = bvx - c.v * fx, rvz = bvz - c.v * fz;
          if (Math.hypot(rvx, rvz) > 9 && bs > 6 && Math.abs(ahead) < CAR.length / 2 + 0.6 && lat > CAR.width / 2 + 0.25) {
            this.events.push({ type: 'nearMiss', x: c.x, z: c.z });
            c.horn = Math.max(c.horn, 2.5);
          }
        }
      }
      if (c.horn > 0) c.horn -= dt;
      c.stopped = c.v < 0.2 && c.blockedBy !== -2 ? c.stopped + dt : 0;
      if (c.stopped > 25) { c.ghost = 2.5; c.stopped = 0; }
      if (c.ghost > 0) c.ghost -= dt;
      const dv = want - c.v;
      const acc = Math.max(-BRAKE, Math.min(ACCEL, dv * 6));
      c.v = Math.max(0, c.v + acc * dt);
      c.pitch += (-acc * 0.006 - c.pitch) * Math.min(1, 6 * dt);
      // Advance along the curve.
      c.u += (c.v * dt) / c.curve.len;
      while (c.u >= 1) {
        const over = (c.u - 1) * c.curve.len;
        if (c.phase === 'road') {
          const key = c.ni * 16 + c.nj;
          const owner = this.junction.get(key);
          if (owner !== undefined && owner !== ci && c.ghost <= 0) { c.u = 1; c.v = 0; break; }
          this.junction.set(key, ci);
          c.phase = 'turn';
          c.curve = this.turnCurve(c.ni, c.nj, c.dx, c.dz, c.ex, c.ez);
        } else {
          const i = c.ni, j = c.nj;
          if (this.junction.get(i * 16 + j) === ci) this.junction.delete(i * 16 + j);
          c.dx = c.ex;
          c.dz = c.ez;
          c.ni = i + c.dx;
          c.nj = j + c.dz;
          c.phase = 'road';
          c.curve = this.roadCurve(i, j, c.dx, c.dz);
          this.planExit(c);
        }
        c.u = over / c.curve.len;
      }
      bez(c.curve, c.u, this.pt);
      const tl = Math.hypot(this.pt.tx, this.pt.tz) || 1;
      c.x = this.pt.x;
      c.z = this.pt.z;
      c.fx = this.pt.tx / tl;
      c.fz = this.pt.tz / tl;
      c.yaw = Math.atan2(c.fx, c.fz);
      const y = this.world.heightAt(c.x, c.z);
      this.world.setPose(c.body, c.x, y + CAR.height / 2, c.z, c.yaw, c.fx * c.v, c.fz * c.v);
    }
    this.render();
  }

  private render() {
    const n = this.active;
    for (let i = 0; i < n; i++) {
      const c = this.cars[i];
      const y = this.world.heightAt(c.x, c.z);
      _q.setFromAxisAngle(_up, c.yaw);
      _q2.setFromAxisAngle(_x, c.pitch);
      _q.multiply(_q2);
      _m.compose(_p.set(c.x, y, c.z), _q, _s);
      this.body.setMatrixAt(i, _m);
      this.lights.setMatrixAt(i, _m);
      _q.setFromAxisAngle(_up, c.yaw);
      _m.compose(_p, _q, _s);
      this.wheels.setMatrixAt(i, _m);
    }
    for (const m of [this.body, this.wheels, this.lights]) m.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }
}
