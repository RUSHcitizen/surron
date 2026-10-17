/**
 * Traffic: electric cars driving the road graph (city grid, ring roads, hub links) in the
 * right-hand lane. They turn at junctions on smooth curves, obey traffic lights, keep their
 * distance, only enter a junction when nothing crossing their path is in it, U-turn at road
 * ends, and brake (and honk) for a bike in their lane, but not instantly: a bike that cuts
 * across them has to dodge. Each car is a moving collision box, so a hit really hits.
 *
 * Signals: each signalled junction cycles green / amber / all-red for the x-axis and then the
 * z-axis roads, with its own offset. The heads are drawn here too (they share the timing).
 *
 * Rendering is three instanced meshes for the whole fleet (body, wheels, lights). The body is
 * one smooth sculpted shell (SDF-meshed once) with dark glass and bumpers in vertex colour,
 * tinted per car.
 */
import {
  BufferAttribute, BufferGeometry, Color, CylinderGeometry, Group, InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial,
  Quaternion, Vector3, BoxGeometry, CircleGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HW, dirIndex, roadNetwork, signalHeads } from './layout';
import type { RoadNode, Signal } from './layout';
import type { BoxCollider, CollisionWorld } from './collision';
import { mulberry32 } from '../core/noise';
import { meshSDF, roundBox, smin, ssub } from '../render/sdfMesh';

/** Lane centre offset from the road centre line (each node says where its turn curves start). */
const LANE = 3;
export const CAR = { length: 4.4, width: 1.86, height: 1.5 };
const ACCEL = 2.6;
const BRAKE = 7;
/** Cars only notice a bike this close in their lane (m, beyond their own stopping room). */
const BIKE_LOOK = 7;
/** Signal timing (s): green, amber and all-red per axis. */
const GREEN = 11, AMBER = 3, ALL_RED = 1.5;
const CYCLE = 2 * (GREEN + AMBER + ALL_RED);
/** The city: roads outside it have a higher limit. */
const inCity = (x: number, z: number) => x < -35 && x > -390 && Math.abs(z) < 176;

const PAINT = [0xf2f2f0, 0x16181c, 0xb9bec6, 0x5b616b, 0x1d3f8a, 0xa3161c, 0x23493a, 0xd8cdb4, 0x2b6cb0, 0x7a7f87, 0xe8e8ea, 0x30343b];

interface Curve { ax: number; az: number; cx: number; cz: number; bx: number; bz: number; len: number }
interface Car {
  id: number;
  /** Node the car is heading to, and its road direction. */
  to: number;
  dx: number; dz: number;
  /** Exit direction planned at that node. */
  ex: number; ez: number;
  phase: 'road' | 'turn';
  /** Holds a place in the junction ahead (or the one being crossed). */
  claimed: boolean;
  /** Speed limit on the current road. */
  limit: number;
  curve: Curve;
  u: number;
  v: number;
  vmax: number;
  x: number; z: number; yaw: number;
  fx: number; fz: number;
  pitch: number;
  body: BoxCollider;
  /** Car this one is waiting behind (-1 none, -2 the bike, -3 a junction / red light). */
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
  /** Simulation clock (signal timing). */
  time = 0;
  private body: InstancedMesh;
  private wheels: InstancedMesh;
  private lights: InstancedMesh;
  private lamps: InstancedMesh[] = [];
  private active: number;
  private pt = { x: 0, z: 0, tx: 0, tz: 1 };
  private r: () => number;
  /** Junction node → cars crossing it. Only compatible movements share a junction. */
  private junction = new Map<number, Set<number>>();
  private offsets: number[];

  constructor(private world: CollisionWorld, count: number, readonly roads: RoadNode[] = roadNetwork(), readonly signals: Signal[] = signalHeads(roads), seed = 11) {
    this.r = mulberry32(seed);
    const r = this.r;
    this.offsets = roads.map(() => r() * CYCLE);
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
    this.buildSignals();
    this.render();
  }

  /** 0 green, 1 amber, 2 red for traffic on the x-axis (axis 0) or z-axis (axis 1) roads. */
  light(node: number, axis: number, t = this.time) {
    if (!this.roads[node].signal) return 0;
    const half = GREEN + AMBER + ALL_RED;
    let k = (t + this.offsets[node]) % CYCLE;
    if (axis === 1) k = (k + half) % CYCLE;
    return k < GREEN ? 0 : k < GREEN + AMBER ? 1 : 2;
  }

  private next(node: number, dx: number, dz: number) {
    return this.roads[node].nbr[dirIndex(dx, dz)];
  }

  /** Road curve leaving node `a` along d to its neighbour. */
  private roadCurve(a: number, dx: number, dz: number): Curve {
    const A = this.roads[a], B = this.roads[this.next(a, dx, dz)];
    const rx = -dz * LANE, rz = dx * LANE; // right-hand side of travel
    const ax = A.x + dx * A.turn + rx, az = A.z + dz * A.turn + rz, bx = B.x - dx * B.turn + rx, bz = B.z - dz * B.turn + rz;
    return curve(ax, az, (ax + bx) / 2, (az + bz) / 2, bx, bz);
  }

  /** Junction curve at a node: in along d, out along e (a U-turn when e = -d). */
  private turnCurve(node: number, dx: number, dz: number, ex: number, ez: number): Curve {
    const N = this.roads[node], T = N.turn;
    const rdx = -dz * LANE, rdz = dx * LANE, rex = -ez * LANE, rez = ex * LANE;
    const ax = N.x - dx * T + rdx, az = N.z - dz * T + rdz, bx = N.x + ex * T + rex, bz = N.z + ez * T + rez;
    if (dx === ex && dz === ez) return curve(ax, az, (ax + bx) / 2, (az + bz) / 2, bx, bz);
    if (dx === -ex && dz === -ez) return curve(ax, az, N.x + dx * T, N.z + dz * T, bx, bz);
    return curve(ax, az, N.x + rdx + rex, N.z + rdz + rez, bx, bz);
  }

  /** Pick the exit at the node ahead: mostly straight on, sometimes a turn; U-turn at a road end. */
  private planExit(c: Car) {
    const opts: [number, number, number][] = [];
    const add = (ex: number, ez: number, w: number) => { if (this.next(c.to, ex, ez) >= 0) opts.push([ex, ez, w]); };
    add(c.dx, c.dz, 2);
    add(c.dz, -c.dx, 1);
    add(-c.dz, c.dx, 1);
    if (!opts.length) { c.ex = -c.dx; c.ez = -c.dz; return; }
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

  private setRoad(c: Car, from: number) {
    c.to = this.next(from, c.dx, c.dz);
    c.curve = this.roadCurve(from, c.dx, c.dz);
    const A = this.roads[from], B = this.roads[c.to];
    // Faster outside the city, fastest on the highway loop.
    const highway = Math.max(Math.abs(A.x), Math.abs(A.z)) >= HW && Math.max(Math.abs(B.x), Math.abs(B.z)) >= HW;
    c.limit = c.vmax * (highway ? 1.9 : inCity((A.x + B.x) / 2, (A.z + B.z) / 2) ? 1 : 1.45);
    this.planExit(c);
  }

  private spawn(id: number, r: () => number): Car {
    for (let tries = 0; ; tries++) {
      const a = Math.floor(r() * this.roads.length);
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => this.next(a, dx, dz) >= 0);
      const [dx, dz] = dirs[Math.floor(r() * dirs.length)];
      const cv = this.roadCurve(a, dx, dz);
      const u = 0.05 + r() * 0.85;
      bez(cv, u, this.pt);
      const clear = this.cars.every((o) => Math.hypot(o.x - this.pt.x, o.z - this.pt.z) > 14);
      if (!clear && tries < 60) continue;
      const car: Car = {
        id, to: -1, dx, dz, ex: dx, ez: dz, phase: 'road', claimed: false, limit: 12, curve: cv, u, v: 0, vmax: 10 + r() * 5,
        x: this.pt.x, z: this.pt.z, yaw: Math.atan2(dx, dz), fx: dx, fz: dz, pitch: 0,
        body: this.world.addDynamic(CAR.width, CAR.height, CAR.length, 'car'), blockedBy: -1, horn: 0, stopped: 0, ghost: 0,
      };
      this.setRoad(car, a);
      car.u = u;
      car.v = car.limit * 0.8;
      return car;
    }
  }

  /** Cars beyond `n` are parked out of the way (quality setting). */
  setCount(n: number) {
    this.active = Math.max(0, Math.min(n, this.cars.length));
    for (let i = this.active; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (c.claimed) this.release(c, i);
      this.world.setPose(c.body, 0, -500, 0, 0, 0, 0);
    }
    this.body.count = this.wheels.count = this.lights.count = this.active;
  }

  private isLeft(c: Car) {
    return c.ex === c.dz && c.ez === -c.dx;
  }

  /** May car `c` share its junction with the cars already crossing it? */
  private compatible(c: Car, ci: number) {
    // A bend or a road end: nothing can cross.
    if (this.roads[c.to].nbr.filter((k) => k >= 0).length <= 2) return true;
    const set = this.junction.get(c.to);
    if (!set) return true;
    for (const oi of set) {
      if (oi === ci) continue;
      const o = this.cars[oi];
      if (o.dx === c.dx && o.dz === c.dz) continue; // same approach: following through
      if (o.dx === -c.dx && o.dz === -c.dz && !this.isLeft(o) && !this.isLeft(c)) continue; // opposite, nobody turning across
      return false;
    }
    return true;
  }

  private claim(c: Car, ci: number) {
    let set = this.junction.get(c.to);
    if (!set) this.junction.set(c.to, (set = new Set()));
    set.add(ci);
    c.claimed = true;
  }

  private release(c: Car, ci: number) {
    this.junction.get(c.to)?.delete(ci);
    c.claimed = false;
  }

  /** May the car go into the junction now (light and crossing traffic)? */
  private mayEnter(c: Car, ci: number, left: number) {
    const sig = this.light(c.to, c.dx !== 0 ? 0 : 1);
    // Amber: stop if that can be done comfortably, otherwise carry on through.
    const lightOk = sig === 0 || (sig === 1 && left < (c.v * c.v) / (2 * 4.5) + 1);
    return lightOk && this.compatible(c, ci) && this.exitClear(c, ci);
  }

  /** Don't block the box: only go in when there is room for the car on the exit road. */
  private exitClear(c: Car, ci: number) {
    for (let oi = 0; oi < this.active; oi++) {
      const o = this.cars[oi];
      if (oi === ci || o.dx !== c.ex || o.dz !== c.ez) continue;
      // A car just out of this junction on the exit road, or still turning onto it.
      const justOut = o.phase === 'road' && o.to === this.next(c.to, c.ex, c.ez) && o.u * o.curve.len < CAR.length + 3 && o.v < 4;
      if (justOut) return false;
    }
    return true;
  }

  /** bike: position and velocity (m, m/s). */
  update(dt: number, bx: number, bz: number, bvx: number, bvz: number) {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const n = this.active;
    const bs = Math.hypot(bvx, bvz);
    for (let ci = 0; ci < n; ci++) {
      const c = this.cars[ci];
      const fx = c.fx, fz = c.fz;
      // Target speed: the road's limit, slower through turns, braking for the turn ahead.
      const straight = c.ex === c.dx && c.ez === c.dz;
      const uturn = c.ex === -c.dx && c.ez === -c.dz;
      // Sweeping highway corners are taken briskly; junction turns slowly.
      const turnV = straight ? c.limit : uturn ? 4 : this.roads[c.to].turn > 20 ? Math.min(c.limit, 16) : 6.5;
      let want = c.limit;
      if (c.phase === 'turn') want = turnV;
      else {
        const left = (1 - c.u) * c.curve.len;
        want = Math.min(want, Math.sqrt(turnV * turnV + 2 * 3 * left));
      }
      // Keep a gap to whatever is ahead in the lane (other cars, and the bike when close).
      c.blockedBy = -1;
      // Far enough ahead to pull up comfortably from this speed (highway speeds need room).
      const look = 6 + c.v * 1.5 + (c.v * c.v) / 9;
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
      // Junction ahead: the front car of the lane claims a place when the light and the
      // crossing traffic allow, early enough to stop otherwise; anyone else waits at the line.
      if (c.phase === 'road' && c.claimed) {
        // The light changed after the claim: stop if there is still room to do so comfortably.
        const left = (1 - c.u) * c.curve.len;
        if (this.light(c.to, c.dx !== 0 ? 0 : 1) !== 0 && left > (c.v * c.v) / (2 * 4.5) + 1) this.release(c, ci);
      }
      if (c.phase === 'road' && !c.claimed && c.ghost <= 0) {
        const left = (1 - c.u) * c.curve.len;
        if (left < 4 + (c.v * c.v) / BRAKE + 6) {
          let front = true;
          for (let oi = 0; oi < n && front; oi++) {
            const o = this.cars[oi];
            if (oi !== ci && o.phase === 'road' && o.to === c.to && o.dx === c.dx && o.dz === c.dz && o.u > c.u) front = false;
          }
          if (front && left < 4 + (c.v * c.v) / BRAKE && this.mayEnter(c, ci, left)) this.claim(c, ci);
          else {
            const v = stopV(left - 0.3);
            if (v < want) { want = v; c.blockedBy = -3; }
          }
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
      // (Waiting at a red light is normal; only a much longer wait counts as stuck.)
      c.stopped = c.v < 0.2 && c.blockedBy !== -2 ? c.stopped + dt : 0;
      if (c.stopped > (c.blockedBy === -3 ? 60 : 30)) { c.ghost = 2.5; c.stopped = 0; }
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
          if (!c.claimed) {
            if (c.ghost <= 0 && !this.mayEnter(c, ci, 0)) { c.u = 1; c.v = 0; break; }
            this.claim(c, ci);
          }
          c.phase = 'turn';
          c.curve = this.turnCurve(c.to, c.dx, c.dz, c.ex, c.ez);
        } else {
          const node = c.to;
          this.release(c, ci);
          c.dx = c.ex;
          c.dz = c.ez;
          c.phase = 'road';
          this.setRoad(c, node);
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

  /** Signal poles and heads (static) plus red / amber / green lamps (lit per frame). */
  private buildSignals() {
    const S = this.signals, n = Math.max(1, S.length);
    const poleG = new CylinderGeometry(0.07, 0.08, 3.4, 8).translate(0, 1.7, 0);
    const headG = new BoxGeometry(0.34, 0.95, 0.24).translate(0, 3.05, 0);
    const visorG = new BoxGeometry(0.4, 0.04, 0.16);
    const parts: BufferGeometry[] = [tint(poleG, new Color(0x2b2f36)), tint(headG, new Color(0x1a1c20))];
    for (const y of [3.38, 3.08, 2.78]) parts.push(tint(visorG.clone().translate(0, y + 0.12, 0.17), new Color(0x1a1c20)));
    const housing = new InstancedMesh(mergeGeometries(parts, false)!, new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 }), n);
    housing.castShadow = true;
    const lampG = new CircleGeometry(0.11, 14);
    for (let k = 0; k < 3; k++) {
      const m = new InstancedMesh(lampG, new MeshBasicMaterial({ toneMapped: false }), n);
      m.frustumCulled = false;
      this.lamps.push(m);
    }
    S.forEach((sg, i) => {
      // Faces the traffic it controls (arriving along d, so it looks back along -d).
      _q.setFromAxisAngle(_up, Math.atan2(-sg.dx, -sg.dz));
      _m.compose(_p.set(sg.x, this.world.heightAt(sg.x, sg.z), sg.z), _q, _s);
      housing.setMatrixAt(i, _m);
      for (let k = 0; k < 3; k++) {
        _m.compose(_v.set(0, 3.38 - k * 0.3, 0.125).applyQuaternion(_q).add(_p), _q, _s);
        this.lamps[k].setMatrixAt(i, _m);
      }
    });
    housing.frustumCulled = false;
    this.root.add(housing, ...this.lamps);
    if (!S.length) housing.visible = false;
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
    // Lamps: bright when lit (above 1 so they bloom), dim glass otherwise.
    this.signals.forEach((sg, i) => {
      const st = this.light(sg.node, sg.dx !== 0 ? 0 : 1);
      for (let k = 0; k < 3; k++) {
        const on = (k === 0 && st === 2) || (k === 1 && st === 1) || (k === 2 && st === 0);
        this.lamps[k].setColorAt(i, on ? LAMP_ON[k] : LAMP_OFF[k]);
      }
    });
    for (const m of this.lamps) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}

const LAMP_ON = [new Color(4, 0.25, 0.15), new Color(3.6, 1.6, 0.1), new Color(0.2, 3.2, 1.0)];
const LAMP_OFF = [new Color(0.16, 0.03, 0.03), new Color(0.15, 0.1, 0.02), new Color(0.02, 0.12, 0.06)];
const _v = new Vector3();
