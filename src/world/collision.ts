/**
 * Static collision world: a terrain heightfield plus oriented boxes (buildings,
 * curbs, ramps, containers...). Deliberately simple and allocation-free in the
 * hot paths so the bike can query it hundreds of times per physics step.
 */
import { Matrix3, Vector3 } from 'three';
import type { SurfaceId } from '../vehicle/parts';

export const SURFACE_INDEX: SurfaceId[] = ['asphalt', 'concrete', 'dirt', 'grass', 'sand', 'gravel'];

export interface Hit {
  t: number;
  point: Vector3;
  normal: Vector3;
  surface: SurfaceId;
}

export function makeHit(): Hit {
  return { t: 0, point: new Vector3(), normal: new Vector3(0, 1, 0), surface: 'asphalt' };
}

export interface BoxCollider {
  center: Vector3;
  half: Vector3;
  /** World-from-local rotation. */
  rot: Matrix3;
  /** Local-from-world rotation. */
  inv: Matrix3;
  surface: SurfaceId;
  /** Bounding radius for broadphase. */
  radius: number;
  tag?: string;
  /** Broadphase de-duplication stamp. */
  stamp: number;
}

export interface BoxDef {
  x: number; y: number; z: number;
  sx: number; sy: number; sz: number;
  yaw?: number; pitch?: number; roll?: number;
  surface?: SurfaceId;
  tag?: string;
}

export class Heightfield {
  readonly heights: Float32Array;
  readonly surfaces: Uint8Array;
  constructor(
    readonly x0: number,
    readonly z0: number,
    readonly cell: number,
    readonly n: number,
  ) {
    this.heights = new Float32Array(n * n);
    this.surfaces = new Uint8Array(n * n).fill(3);
  }
  get size() {
    return this.cell * (this.n - 1);
  }
  index(ix: number, iz: number) {
    return iz * this.n + ix;
  }
  heightAt(x: number, z: number): number {
    const fx = (x - this.x0) / this.cell;
    const fz = (z - this.z0) / this.cell;
    const n1 = this.n - 1;
    const ix = Math.max(0, Math.min(n1 - 1, Math.floor(fx)));
    const iz = Math.max(0, Math.min(n1 - 1, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - ix));
    const tz = Math.max(0, Math.min(1, fz - iz));
    const h = this.heights;
    const i = iz * this.n + ix;
    const a = h[i], b = h[i + 1], c = h[i + this.n], d = h[i + this.n + 1];
    // Split each cell into two triangles so the surface matches the rendered mesh.
    if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
    return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }
  normalAt(x: number, z: number, out: Vector3): Vector3 {
    const e = this.cell * 0.5;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }
  surfaceAt(x: number, z: number): SurfaceId {
    const ix = Math.max(0, Math.min(this.n - 1, Math.round((x - this.x0) / this.cell)));
    const iz = Math.max(0, Math.min(this.n - 1, Math.round((z - this.z0) / this.cell)));
    return SURFACE_INDEX[this.surfaces[iz * this.n + ix]] ?? 'grass';
  }
}

const GRID = 12;

const _l = new Vector3();
const _d = new Vector3();
const _c = new Vector3();
const _p = new Vector3();
const _n = new Vector3();

export class CollisionWorld {
  boxes: BoxCollider[] = [];
  private grid = new Map<number, BoxCollider[]>();
  private queryStamp = 0;
  /** Below this height the world is solid (safety floor). */
  floor = -50;

  constructor(public terrain: Heightfield) {}

  private key(ix: number, iz: number) {
    return (ix + 4096) * 8192 + (iz + 4096);
  }

  addBox(def: BoxDef): BoxCollider {
    const rot = new Matrix3();
    const cy = Math.cos(def.yaw ?? 0), sy = Math.sin(def.yaw ?? 0);
    const cp = Math.cos(def.pitch ?? 0), sp = Math.sin(def.pitch ?? 0);
    const cr = Math.cos(def.roll ?? 0), sr = Math.sin(def.roll ?? 0);
    // R = Ry(yaw) * Rx(pitch) * Rz(roll)
    const ry = new Matrix3().set(cy, 0, sy, 0, 1, 0, -sy, 0, cy);
    const rx = new Matrix3().set(1, 0, 0, 0, cp, -sp, 0, sp, cp);
    const rz = new Matrix3().set(cr, -sr, 0, sr, cr, 0, 0, 0, 1);
    rot.multiplyMatrices(ry, rx).multiply(rz);
    const inv = rot.clone().transpose();
    const half = new Vector3(def.sx / 2, def.sy / 2, def.sz / 2);
    const box: BoxCollider = {
      center: new Vector3(def.x, def.y, def.z),
      half,
      rot,
      inv,
      surface: def.surface ?? 'concrete',
      radius: half.length(),
      tag: def.tag,
      stamp: 0,
    };
    this.boxes.push(box);
    const r = box.radius;
    const x0 = Math.floor((def.x - r) / GRID), x1 = Math.floor((def.x + r) / GRID);
    const z0 = Math.floor((def.z - r) / GRID), z1 = Math.floor((def.z + r) / GRID);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.key(ix, iz);
        let cell = this.grid.get(k);
        if (!cell) this.grid.set(k, (cell = []));
        cell.push(box);
      }
    }
    return box;
  }

  /** Visit boxes near the segment/sphere [a, b] expanded by `pad`. */
  private forBoxes(ax: number, az: number, bx: number, bz: number, pad: number, fn: (b: BoxCollider) => void) {
    const stamp = ++this.queryStamp;
    const x0 = Math.floor((Math.min(ax, bx) - pad) / GRID), x1 = Math.floor((Math.max(ax, bx) + pad) / GRID);
    const z0 = Math.floor((Math.min(az, bz) - pad) / GRID), z1 = Math.floor((Math.max(az, bz) + pad) / GRID);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const cell = this.grid.get(this.key(ix, iz));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const b = cell[i];
          if (b.stamp === stamp) continue;
          b.stamp = stamp;
          fn(b);
        }
      }
    }
  }

  heightAt(x: number, z: number) {
    return this.terrain.heightAt(x, z);
  }

  /** Highest walkable surface (terrain or box top) at x,z — used for spawning. */
  groundHeight(x: number, z: number, fromY = 200): number {
    const hit = makeHit();
    if (this.raycast(new Vector3(x, fromY, z), new Vector3(0, -1, 0), fromY + 60, hit, true, 'pole')) return hit.point.y;
    return this.terrain.heightAt(x, z);
  }

  /**
   * Raycast against terrain and boxes. Rays that start inside a box ignore that box
   * (the penetration query handles embedded points). Returns true on hit.
   */
  raycast(origin: Vector3, dir: Vector3, maxDist: number, out: Hit, ignoreInside = true, skipTag?: string): boolean {
    let best = maxDist;
    let found = false;
    // Terrain: march + bisection.
    const tr = this.terrain;
    const f = (t: number) => origin.y + dir.y * t - tr.heightAt(origin.x + dir.x * t, origin.z + dir.z * t);
    let f0 = f(0);
    if (f0 <= 0) {
      // Origin below the terrain: report a negative distance back to the surface so
      // callers can measure penetration depth.
      found = true;
      const t0 = dir.y < -0.2 ? f0 / -dir.y : 0;
      best = 0;
      out.t = t0;
      out.point.copy(origin).addScaledVector(dir, t0);
      tr.normalAt(origin.x, origin.z, out.normal);
      out.surface = tr.surfaceAt(origin.x, origin.z);
    } else {
      const horiz = Math.hypot(dir.x, dir.z) * maxDist;
      const steps = Math.max(2, Math.min(64, Math.ceil(horiz / (tr.cell * 0.5)) + 1));
      const dt = maxDist / steps;
      let tPrev = 0;
      for (let i = 1; i <= steps; i++) {
        const t = i * dt;
        const ft = f(t);
        if (ft <= 0) {
          let lo = tPrev, hi = t;
          const iters = Math.min(24, Math.max(8, Math.ceil(Math.log2(dt / 0.002))));
          for (let k = 0; k < iters; k++) {
            const mid = (lo + hi) * 0.5;
            if (f(mid) > 0) lo = mid; else hi = mid;
          }
          best = hi;
          found = true;
          out.t = hi;
          out.point.copy(origin).addScaledVector(dir, hi);
          tr.normalAt(out.point.x, out.point.z, out.normal);
          out.surface = tr.surfaceAt(out.point.x, out.point.z);
          break;
        }
        tPrev = t;
        f0 = ft;
      }
    }
    // Boxes
    const ex = origin.x + dir.x * maxDist, ez = origin.z + dir.z * maxDist;
    this.forBoxes(origin.x, origin.z, ex, ez, 1, (b) => {
      if (skipTag && b.tag === skipTag) return;
      _l.copy(origin).sub(b.center).applyMatrix3(b.inv);
      _d.copy(dir).applyMatrix3(b.inv);
      let tmin = -Infinity, tmax = Infinity;
      let axis = -1, sign = 1;
      const h = b.half;
      for (let a = 0; a < 3; a++) {
        const o = a === 0 ? _l.x : a === 1 ? _l.y : _l.z;
        const d = a === 0 ? _d.x : a === 1 ? _d.y : _d.z;
        const e = a === 0 ? h.x : a === 1 ? h.y : h.z;
        if (Math.abs(d) < 1e-9) {
          if (o < -e || o > e) return;
          continue;
        }
        let t1 = (-e - o) / d, t2 = (e - o) / d;
        let s = -1;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return;
      }
      if (tmax < 0) return;
      if (tmin < 0) {
        if (ignoreInside) return;
        tmin = 0;
      }
      if (tmin < best && axis >= 0) {
        best = tmin;
        found = true;
        out.t = tmin;
        out.point.copy(origin).addScaledVector(dir, tmin);
        _n.set(0, 0, 0);
        if (axis === 0) _n.x = sign; else if (axis === 1) _n.y = sign; else _n.z = sign;
        out.normal.copy(_n).applyMatrix3(b.rot);
        out.surface = b.surface;
      }
    });
    return found;
  }

  /**
   * Sphere-vs-world penetration. Returns depth (> 0 when penetrating) and writes the
   * push-out normal. Picks the deepest contact.
   */
  penetration(p: Vector3, r: number, out: Hit): number {
    let depth = 0;
    const tr = this.terrain;
    const h = tr.heightAt(p.x, p.z);
    tr.normalAt(p.x, p.z, _n);
    const dTerrain = (h - p.y) * _n.y + r;
    if (dTerrain > 0) {
      depth = dTerrain;
      out.normal.copy(_n);
      out.point.set(p.x, h, p.z);
      out.surface = tr.surfaceAt(p.x, p.z);
    }
    this.forBoxes(p.x, p.z, p.x, p.z, r + 0.5, (b) => {
      _l.copy(p).sub(b.center).applyMatrix3(b.inv);
      const hx = b.half.x, hy = b.half.y, hz = b.half.z;
      _c.set(Math.max(-hx, Math.min(hx, _l.x)), Math.max(-hy, Math.min(hy, _l.y)), Math.max(-hz, Math.min(hz, _l.z)));
      _p.copy(_l).sub(_c);
      const dist = _p.length();
      let d: number;
      if (dist > 1e-6) {
        d = r - dist;
        if (d <= depth) return;
        _p.multiplyScalar(1 / dist);
      } else {
        // Centre inside: push out through the nearest face.
        const px = hx - Math.abs(_l.x), py = hy - Math.abs(_l.y), pz = hz - Math.abs(_l.z);
        _p.set(0, 0, 0);
        if (px <= py && px <= pz) { d = px + r; _p.x = Math.sign(_l.x) || 1; }
        else if (py <= pz) { d = py + r; _p.y = Math.sign(_l.y) || 1; }
        else { d = pz + r; _p.z = Math.sign(_l.z) || 1; }
        if (d <= depth) return;
      }
      depth = d;
      out.normal.copy(_p).applyMatrix3(b.rot);
      out.point.copy(_c).applyMatrix3(b.rot).add(b.center);
      out.surface = b.surface;
    });
    if (p.y - r < this.floor) {
      const d = this.floor - (p.y - r);
      if (d > depth) {
        depth = d;
        out.normal.set(0, 1, 0);
        out.surface = 'concrete';
      }
    }
    return depth;
  }
}

/** Flat test world (used by unit tests and the garage). */
export function flatWorld(size = 2000, surface: SurfaceId = 'asphalt'): CollisionWorld {
  const n = 9;
  const hf = new Heightfield(-size / 2, -size / 2, size / (n - 1), n);
  hf.surfaces.fill(SURFACE_INDEX.indexOf(surface));
  return new CollisionWorld(hf);
}
