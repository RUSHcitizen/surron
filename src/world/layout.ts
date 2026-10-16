/**
 * World layout: generates the whole map deterministically (no downloaded assets).
 * Produces collision data plus everything the renderer and gameplay need.
 *
 * Map (x east, z north), 800 m square:
 *   City grid (west), hub + garage (centre), test facilities (south),
 *   off-road hills with an MX track, stunt park and sand pit (north-east).
 */
import { Heightfield, SURFACE_INDEX } from './collision';
import type { BoxDef } from './collision';
import type { SurfaceId } from '../vehicle/parts';
import { clamp, fbm, lerp, mulberry32, smoothstep } from '../core/noise';

export type BoxKind = 'building' | 'sidewalk' | 'container' | 'ramp' | 'support' | 'warehouse' | 'barrier' | 'garage' | 'invisible' | 'pallet' | 'rock' | 'wall';

export interface WorldBox extends BoxDef {
  kind: BoxKind;
  color?: number;
  /** Render style for buildings / visual boxes (façade material). */
  style?: string;
}
export interface Marking { x: number; z: number; w: number; l: number; yaw: number; color: number; y?: number }
export interface P2 { x: number; z: number }
export interface Spawn { x: number; z: number; yaw: number }

export interface WorldData {
  terrain: Heightfield;
  boxes: WorldBox[];
  markings: Marking[];
  trees: { x: number; z: number; s: number; kind: number }[];
  rocks: { x: number; z: number; s: number }[];
  lights: { x: number; z: number; yaw: number }[];
  cones: P2[];
  pedPaths: P2[][];
  collectibles: { id: string; x: number; z: number }[];
  spawns: Record<string, Spawn>;
  track: { points: P2[]; checkpoints: Spawn[]; halfWidth: number };
  drag: { z: number; x0: number; x1: number; halfWidth: number; brakeX: number };
  driftPad: { x: number; z: number; r: number };
  handling: { x: number; z: number; gates: Spawn[] };
  stunt: { x: number; z: number; w: number; d: number };
  garagePad: { x: number; z: number; r: number };
  labels: { text: string; x: number; z: number; yaw: number; y: number }[];
  /** Purely visual dressing (colliders, where needed, are in `boxes`). */
  decor: Decor;
}

export interface Decor {
  flags: { x: number; z: number; yaw: number; color: number }[];
  tires: { x: number; z: number; color: number }[];
  chargers: { x: number; z: number; yaw: number }[];
  bushes: { x: number; z: number; s: number }[];
  /** Visual-only boxes (shopfronts, cornices, awnings, rooftop units); no collision. */
  vboxes: WorldBox[];
  tanks: { x: number; y: number; z: number }[];
  /** Spectator spots (track side, stunt park), facing the action. */
  spectators: { x: number; z: number; yaw: number }[];
}

export const WORLD = { size: 800, cell: 2.5, half: 400 };

// City grid
export const CITY_X = [-370, -290, -210, -130, -50];
export const CITY_Z = [-160, -80, 0, 80, 160];
const ROAD_HALF = 6;
const SIDEWALK = 4;

const DRAG_Z = -300;
const HUB = { x0: -40, x1: 75, z0: -60, z1: 60 };
const DRIFT = { x: 95, z: -185, r: 46 };
const HANDLING = { x: 230, z: -185, w: 120, d: 74 };
const STUNT = { x: 135, z: 70, w: 110, d: 90 };
const SAND = { x: 330, z: -10, r: 36 };

function inRect(x: number, z: number, x0: number, x1: number, z0: number, z1: number, pad = 0) {
  return x >= x0 - pad && x <= x1 + pad && z >= z0 - pad && z <= z1 + pad;
}

/** Closed Catmull-Rom spline sampled every `step` metres. */
function spline(ctrl: P2[], step: number): P2[] {
  const out: P2[] = [];
  const n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const k = Math.max(2, Math.ceil(len / step));
    for (let j = 0; j < k; j++) {
      const t = j / k, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  return out;
}

const TRACK_CTRL: P2[] = [
  { x: 120, z: 175 }, { x: 160, z: 140 }, { x: 230, z: 135 }, { x: 300, z: 120 }, { x: 345, z: 160 },
  { x: 350, z: 230 }, { x: 320, z: 290 }, { x: 260, z: 300 }, { x: 225, z: 255 }, { x: 185, z: 270 },
  { x: 160, z: 330 }, { x: 110, z: 330 }, { x: 95, z: 270 }, { x: 105, z: 215 },
];

/** Track features along arc length (m): tabletops and whoops. */
const TABLETOPS = [
  { s: 70, up: 7, top: 9, down: 8, h: 2.2 },
  { s: 250, up: 6, top: 4, down: 9, h: 2.6 },
  { s: 520, up: 8, top: 12, down: 10, h: 2.0 },
  { s: 760, up: 6, top: 5, down: 8, h: 2.4 },
];
const WHOOPS = { s0: 380, s1: 450, period: 6, h: 0.45 };

function trackProfile(s: number): number {
  let h = 0;
  for (const t of TABLETOPS) {
    const a = t.s, b = a + t.up, c = b + t.top, d = c + t.down;
    if (s >= a && s < b) h = Math.max(h, (t.h * (s - a)) / t.up);
    else if (s >= b && s < c) h = Math.max(h, t.h);
    else if (s >= c && s < d) h = Math.max(h, t.h * (1 - (s - c) / t.down));
  }
  if (s > WHOOPS.s0 && s < WHOOPS.s1) h += WHOOPS.h * (0.5 - 0.5 * Math.cos(((s - WHOOPS.s0) / WHOOPS.period) * Math.PI * 2));
  return h;
}

/** 1 inside the rect, fading to 0 over `blend` metres outside it. */
function rectBlend(x: number, z: number, x0: number, x1: number, z0: number, z1: number, blend: number) {
  const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
  return 1 - smoothstep(0, blend, Math.hypot(dx, dz));
}

function baseHeight(x: number, z: number): number {
  let h = 0;
  // Off-road hills (north-east)
  const off = smoothstep(55, 95, x) * smoothstep(-140, -100, z);
  if (off > 0) h += off * (fbm(x / 90, z / 90, 4) * 14 + 5 + fbm(x / 25 + 7, z / 25, 2) * 1.6);
  // Rolling park hills (north-west, north of the city)
  const park = smoothstep(195, 235, z) * (1 - smoothstep(30, 70, x));
  if (park > 0) h += park * (fbm(x / 70 + 3, z / 70, 3) * 7 + 3);
  // Map edge berm
  const e = Math.max(Math.abs(x), Math.abs(z));
  if (e > 355) h += Math.pow((e - 355) / 45, 2) * 28;
  // Keep facilities flat, blending smoothly into the hills.
  const flat = rectBlend(x, z, STUNT.x - STUNT.w / 2, STUNT.x + STUNT.w / 2, STUNT.z - STUNT.d / 2, STUNT.z + STUNT.d / 2, 30);
  return h * (1 - flat);
}

export function generateWorld(seed = 7): WorldData {
  const rnd = mulberry32(seed);
  const n = WORLD.size / WORLD.cell + 1;
  const hf = new Heightfield(-WORLD.half, -WORLD.half, WORLD.cell, n);
  const boxes: WorldBox[] = [];
  const markings: Marking[] = [];
  const trees: WorldData['trees'] = [];
  const rocks: WorldData['rocks'] = [];
  const lights: WorldData['lights'] = [];
  const cones: P2[] = [];
  const pedPaths: P2[][] = [];
  const labels: WorldData['labels'] = [];
  const S = (s: SurfaceId) => SURFACE_INDEX.indexOf(s);

  // --- Track polyline ------------------------------------------------------
  const track = spline(TRACK_CTRL, 2);
  const trackS: number[] = [0];
  for (let i = 1; i < track.length; i++) trackS.push(trackS[i - 1] + Math.hypot(track[i].x - track[i - 1].x, track[i].z - track[i - 1].z));
  const curv: number[] = track.map((_, i) => {
    const a = track[(i - 3 + track.length) % track.length], b = track[i], c = track[(i + 3) % track.length];
    const h1 = Math.atan2(b.z - a.z, b.x - a.x), h2 = Math.atan2(c.z - b.z, c.x - b.x);
    let d = h2 - h1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d / 12;
  });
  // Smoothed base height along the track centreline.
  const rawC = track.map((p) => baseHeight(p.x, p.z));
  const centerH = rawC.map((_, i) => {
    let s = 0;
    for (let k = -10; k <= 10; k++) s += rawC[(i + k + rawC.length) % rawC.length];
    return s / 21;
  });
  const TRACK_HALF = 5;

  // --- Heights & surfaces ---------------------------------------------------
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = hf.x0 + ix * hf.cell, z = hf.z0 + iz * hf.cell;
      let h = baseHeight(x, z);
      let surf: SurfaceId = 'grass';
      if (x > 55 && z > -110 && fbm(x / 30 + 11, z / 30, 2) > 0.18) surf = 'dirt';
      // Track carving
      if (x > 60 && z > 100) {
        let best = 1e9, bi = 0;
        for (let i = 0; i < track.length; i++) {
          const dx = x - track[i].x, dz = z - track[i].z;
          const d2 = dx * dx + dz * dz;
          if (d2 < best) { best = d2; bi = i; }
        }
        const d = Math.sqrt(best);
        if (d < TRACK_HALF + 9) {
          const p = track[bi], q = track[(bi + 1) % track.length];
          const tx = q.x - p.x, tz = q.z - p.z;
          const tl = Math.hypot(tx, tz) || 1;
          const lateral = ((x - p.x) * -tz + (z - p.z) * tx) / tl; // + = left of travel
          const bank = clamp(curv[bi] * 9, -0.5, 0.5);
          const ht = centerH[bi] + trackProfile(trackS[bi]) - bank * lateral;
          const w = 1 - smoothstep(TRACK_HALF, TRACK_HALF + 8, d);
          h = lerp(h, ht, w);
          if (d < TRACK_HALF + 1.5) surf = 'dirt';
        }
      }
      // Sand pit (a shallow bowl)
      const ds = Math.hypot(x - SAND.x, z - SAND.z);
      if (ds < SAND.r) {
        surf = 'sand';
        h -= 1.2 * (1 - (ds / SAND.r) ** 2);
      }
      // Stunt park: dirt
      if (inRect(x, z, STUNT.x - STUNT.w / 2, STUNT.x + STUNT.w / 2, STUNT.z - STUNT.d / 2, STUNT.z + STUNT.d / 2, 2)) surf = 'dirt';
      // City: roads asphalt; inside blocks handled by slabs/boxes.
      if (x >= -385 && x <= -35 && z >= -175 && z <= 175) surf = 'asphalt';
      // Hub plaza
      if (inRect(x, z, HUB.x0, HUB.x1, HUB.z0, HUB.z1)) surf = 'concrete';
      // Connecting roads
      if (Math.abs(x - 10) <= 6 && z <= HUB.z0 && z >= DRAG_Z) surf = 'asphalt'; // hub -> drag strip
      if (Math.abs(z) <= 6 && x >= HUB.x1 && x <= 110) surf = 'asphalt'; // hub -> off-road gate
      if (Math.abs(x - 10) <= 5 && z >= HUB.z1 && z <= 230) surf = 'asphalt'; // hub -> north park
      if (Math.abs(z - (-185)) <= 6 && x > 10 && x < 180) surf = 'asphalt'; // service road to pads
      // Drag strip
      if (Math.abs(z - DRAG_Z) <= 9 && x >= -360 && x <= 330) surf = 'asphalt';
      // Drift pad & handling lot
      if (Math.hypot(x - DRIFT.x, z - DRIFT.z) <= DRIFT.r) surf = 'asphalt';
      if (inRect(x, z, HANDLING.x - HANDLING.w / 2, HANDLING.x + HANDLING.w / 2, HANDLING.z - HANDLING.d / 2, HANDLING.z + HANDLING.d / 2)) surf = 'asphalt';
      // Gravel shoulders along the drag strip
      if (Math.abs(z - DRAG_Z) > 9 && Math.abs(z - DRAG_Z) <= 13 && x >= -360 && x <= 330) surf = 'gravel';
      hf.heights[hf.index(ix, iz)] = h;
      hf.surfaces[hf.index(ix, iz)] = S(surf);
    }
  }

  const box = (b: WorldBox) => boxes.push(b);
  const decor: Decor = { flags: [], tires: [], chargers: [], bushes: [], vboxes: [], tanks: [], spectators: [] };
  const vbox = (b: WorldBox) => decor.vboxes.push(b);
  const groundAt = (x: number, z: number) => hf.heightAt(x, z);

  /** A ramp rising along `yaw` from (x,z): length L, height H, width W. */
  const ramp = (x: number, z: number, yaw: number, L: number, H: number, W: number, color = 0x8a6a46, kind: BoxKind = 'ramp') => {
    const g = groundAt(x, z);
    const t = 0.4;
    const pitch = -Math.atan2(H, L);
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    const hyp = Math.hypot(L, H);
    // Box local up after R = Ry(yaw)·Rx(pitch) is (sin p·dx, cos p, sin p·dz).
    const sp = Math.sin(pitch), cp = Math.cos(pitch);
    const topCx = x + dx * (L / 2), topCz = z + dz * (L / 2), topCy = g + H / 2;
    box({
      kind, color, surface: 'concrete',
      x: topCx - sp * dx * t * 0.5, y: topCy - cp * t * 0.5, z: topCz - sp * dz * t * 0.5,
      sx: W, sy: t, sz: hyp, yaw, pitch,
    });
    if (H > 0.6) {
      // Solid support under the lip so nothing can slip underneath.
      const sl = Math.min(L * 0.5, 2.5);
      box({ kind: 'support', color: 0x5a4632, surface: 'concrete', x: x + dx * (L - sl / 2 - 0.15), y: g + (H - 0.25) / 2, z: z + dz * (L - sl / 2 - 0.15), sx: W, sy: H - 0.25, sz: sl, yaw });
    }
  };

  // --- City ---------------------------------------------------------------
  const FLOOR = 3.5;
  const STYLE_COLORS: Record<string, number[]> = {
    brick: [0xffffff, 0xf0e2da, 0xe6d6cf],
    office: [0xffffff, 0xe8f0f6, 0xdfe6ea],
    apartment: [0xf3efe6, 0xe9d9c4, 0xd6e0e4, 0xe8d0c8, 0xd9dcc8],
    stucco: [0xf6e7c8, 0xf2d7c0, 0xe9e4d8, 0xdcc7a8, 0xf0dcd6],
  };
  const AWNINGS = [0x2f6f4f, 0xb03a2e, 0x1f4e79, 0xc79a2b, 0x5b3a6b, 0x2b2f36];
  /** One building on a lot: main mass (collider), optional setback tower, shopfront base, cornice, rooftop units. */
  const building = (x0: number, x1: number, z0: number, z1: number, block: { x0: number; x1: number; z0: number; z1: number }, downtown: boolean) => {
    const rr = rnd();
    const style = downtown ? (rr < 0.7 ? 'office' : 'apartment') : rr < 0.32 ? 'brick' : rr < 0.62 ? 'apartment' : rr < 0.82 ? 'stucco' : 'office';
    const floors = style === 'office' ? 6 + Math.floor(rnd() * (downtown ? 9 : 5)) : style === 'stucco' ? 2 + Math.floor(rnd() * 3) : style === 'brick' ? 3 + Math.floor(rnd() * 4) : 4 + Math.floor(rnd() * 5);
    const hgt = floors * FLOOR + 0.6;
    const cols = STYLE_COLORS[style];
    const color = cols[Math.floor(rnd() * cols.length)];
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0 - 0.4, sz = z1 - z0 - 0.4;
    const base = 0.15;
    box({ kind: 'building', style, color, x: cx, y: base + hgt / 2, z: cz, sx, sy: hgt, sz });
    // Cornice / parapet cap.
    vbox({ kind: 'building', style: 'trim', color: style === 'office' ? 0x8c949e : 0xd9d3c7, x: cx, y: base + hgt + 0.3, z: cz, sx: sx + 0.5, sy: 0.6, sz: sz + 0.5 });
    let roofY = base + hgt + 0.6;
    // Setback tower on tall offices.
    if (style === 'office' && floors >= 9) {
      const tf = 3 + Math.floor(rnd() * 6), th = tf * FLOOR;
      box({ kind: 'building', style, color, x: cx, y: roofY + th / 2, z: cz, sx: sx * 0.66, sy: th, sz: sz * 0.66 });
      vbox({ kind: 'building', style: 'trim', color: 0x8c949e, x: cx, y: roofY + th + 0.25, z: cz, sx: sx * 0.66 + 0.4, sy: 0.5, sz: sz * 0.66 + 0.4 });
      roofY += th + 0.5;
    }
    // Shopfront base on everything but offices (offices get a glazed lobby via their own façade).
    if (style !== 'office') {
      vbox({ kind: 'building', style: 'shop', color: 0xffffff, x: cx, y: base + 2.1, z: cz, sx: sx + 0.12, sy: 4.2, sz: sz + 0.12 });
      // Awnings over the street-facing sides.
      const ac = AWNINGS[Math.floor(rnd() * AWNINGS.length)];
      const sides: [number, number, number, number, number][] = [];
      if (Math.abs(z0 - block.z0) < 0.5) sides.push([cx, z0 - 0.2 - 0.7, sx * 0.8, 1.4, 1]);
      if (Math.abs(z1 - block.z1) < 0.5) sides.push([cx, z1 + 0.2 + 0.7, sx * 0.8, 1.4, -1]);
      for (const [ax, az, aw, ad, dir] of sides) vbox({ kind: 'building', style: 'awning', color: ac, x: ax, y: base + 4.0, z: az, sx: aw, sy: 0.12, sz: ad, pitch: -0.28 * dir });
      const sidesX: [number, number][] = [];
      if (Math.abs(x0 - block.x0) < 0.5) sidesX.push([x0 - 0.9, 1]);
      if (Math.abs(x1 - block.x1) < 0.5) sidesX.push([x1 + 0.9, -1]);
      for (const [axx, dir] of sidesX) vbox({ kind: 'building', style: 'awning', color: ac, x: axx, y: base + 4.0, z: cz, sx: 1.4, sy: 0.12, sz: sz * 0.8, roll: 0.28 * dir });
    }
    // Rooftop: AC units and the odd water tank.
    const units = 1 + Math.floor(rnd() * 3);
    for (let u = 0; u < units; u++) {
      const ux = cx + (rnd() - 0.5) * sx * 0.5, uz = cz + (rnd() - 0.5) * sz * 0.5;
      vbox({ kind: 'building', style: 'metal', color: 0xb8bcc2, x: ux, y: roofY + 0.6, z: uz, sx: 1.8, sy: 1.2, sz: 1.3 });
    }
    if ((style === 'brick' || style === 'apartment') && rnd() < 0.45) decor.tanks.push({ x: cx + sx * 0.2, y: roofY, z: cz - sz * 0.2 });
  };
  for (let bx = 0; bx < CITY_X.length - 1; bx++) {
    for (let bz = 0; bz < CITY_Z.length - 1; bz++) {
      const x0 = CITY_X[bx] + ROAD_HALF, x1 = CITY_X[bx + 1] - ROAD_HALF;
      const z0 = CITY_Z[bz] + ROAD_HALF, z1 = CITY_Z[bz + 1] - ROAD_HALF;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const w = x1 - x0, d = z1 - z0;
      const type = bx === 1 && bz === 1 ? 'parking' : bx === 0 && bz === 0 ? 'industrial' : bx === 2 && bz === 3 ? 'park' : bx === 3 && bz === 0 ? 'industrial2' : 'buildings';
      if (type === 'parking') {
        // Asphalt lot with painted bays and a couple of kickers.
        for (let i = 0; i < 9; i++) markings.push({ x: x0 + 8 + i * 5.5, z: cz - 12, w: 0.15, l: 5, yaw: 0, color: 0xffffff });
        for (let i = 0; i < 9; i++) markings.push({ x: x0 + 8 + i * 5.5, z: cz + 12, w: 0.15, l: 5, yaw: 0, color: 0xffffff });
        ramp(cx - 6, cz - 2, Math.PI / 2, 4, 0.8, 3, 0x4a4f57);
        ramp(cx + 14, cz + 2, -Math.PI / 2, 4, 0.8, 3, 0x4a4f57);
        // curb stones around
        box({ kind: 'sidewalk', x: cx, y: 0.075, z: z0 + 1, sx: w, sy: 0.15, sz: 2, surface: 'concrete' });
        box({ kind: 'sidewalk', x: cx, y: 0.075, z: z1 - 1, sx: w, sy: 0.15, sz: 2, surface: 'concrete' });
        labels.push({ text: 'PARKING', x: cx, z: z0 + 0.2, y: 0.4, yaw: Math.PI });
        continue;
      }
      if (type === 'industrial' || type === 'industrial2') {
        // Concrete yard, warehouses and shipping containers with ramps.
        box({ kind: 'sidewalk', x: cx, y: 0.06, z: cz, sx: w, sy: 0.12, sz: d, surface: 'concrete' });
        box({ kind: 'warehouse', color: 0x7d8792, x: cx - w * 0.22, y: 5.12, z: cz + d * 0.2, sx: w * 0.45, sy: 10, sz: d * 0.4 });
        const cc = [0xb5452f, 0x2f6fb5, 0x3f8f4f, 0xc79a2b, 0x6c6f75];
        for (let i = 0; i < 6; i++) {
          const yy = i < 4 ? 1.42 : 4.02;
          box({ kind: 'container', color: cc[i % cc.length], x: cx + 6 + (i % 2) * 6.5, y: yy, z: cz - d * 0.3 + (i % 4 > 1 ? 7 : 0) + (i >= 4 ? 3.5 : 0), sx: 2.6, sy: 2.6, sz: 6.1, yaw: 0 });
        }
        ramp(cx + 9.25, cz - d * 0.3 - 10, 0, 6.5, 2.6, 3.2, 0x6b7280);
        box({ kind: 'pallet', color: 0x9b7b4f, x: cx - 10, y: 0.5, z: cz - 15, sx: 3, sy: 0.8, sz: 3 });
        box({ kind: 'pallet', color: 0x9b7b4f, x: cx - 4, y: 0.5, z: cz - 20, sx: 2.4, sy: 0.8, sz: 2.4, yaw: 0.4 });
        ramp(cx - 18, cz - 10, Math.PI / 2, 5, 1.2, 3, 0x6b7280);
        labels.push({ text: 'INDUSTRIAL', x: cx, z: z0 + 0.3, y: 0.6, yaw: Math.PI });
        continue;
      }
      // Sidewalk slab with curb edge
      box({ kind: 'sidewalk', x: cx, y: 0.075, z: cz, sx: w, sy: 0.15, sz: d, surface: 'concrete' });
      pedPaths.push([
        { x: x0 + 2, z: z0 + 2 }, { x: x1 - 2, z: z0 + 2 }, { x: x1 - 2, z: z1 - 2 }, { x: x0 + 2, z: z1 - 2 },
      ]);
      // Second, closer-to-the-shops loop walked the other way: two-way foot traffic.
      pedPaths.push([
        { x: x0 + 3.3, z: z1 - 3.3 }, { x: x1 - 3.3, z: z1 - 3.3 }, { x: x1 - 3.3, z: z0 + 3.3 }, { x: x0 + 3.3, z: z0 + 3.3 },
      ].reverse());
      if (type === 'park') {
        for (let i = 0; i < 18; i++) trees.push({ x: x0 + 8 + rnd() * (w - 16), z: z0 + 8 + rnd() * (d - 16), s: 0.8 + rnd() * 0.6, kind: 1 });
        continue;
      }
      const inset = SIDEWALK + 1.5;
      const ix0 = x0 + inset, ix1 = x1 - inset, iz0 = z0 + inset, iz1 = z1 - inset;
      const alley = (bx + bz) % 2 === 0;
      const halves = alley
        ? [[ix0, ix1, iz0, (iz0 + iz1) / 2 - 3.5], [ix0, ix1, (iz0 + iz1) / 2 + 3.5, iz1]]
        : [[ix0, (ix0 + ix1) / 2 - 1, iz0, iz1], [(ix0 + ix1) / 2 + 1, ix1, iz0, iz1]];
      for (const [ax0, ax1, az0, az1] of halves) {
        // Split the half-block into lots along its longer side: a row of distinct buildings.
        const alongX = ax1 - ax0 >= az1 - az0;
        const span = alongX ? ax1 - ax0 : az1 - az0;
        const cuts = [0];
        while (cuts[cuts.length - 1] < span - 1) {
          const remain = span - cuts[cuts.length - 1];
          cuts.push(remain < 30 ? span : cuts[cuts.length - 1] + 13 + rnd() * 13);
        }
        for (let li = 0; li < cuts.length - 1; li++) {
          const a0 = cuts[li] + (li ? 0.0 : 0), a1 = cuts[li + 1];
          const lx0 = alongX ? ax0 + a0 : ax0, lx1 = alongX ? ax0 + a1 : ax1;
          const lz0 = alongX ? az0 : az0 + a0, lz1 = alongX ? az1 : az0 + a1;
          building(lx0, lx1, lz0, lz1, { x0: ix0, x1: ix1, z0: iz0, z1: iz1 }, bx === 3 && bz > 0 && bz < 3);
        }
      }
      // Street trees along the curbs (gaps left at the corners and crossings).
      for (let t = 10; t < w - 10; t += 13) {
        trees.push({ x: x0 + t, z: z0 + 1.1, s: 0.85 + rnd() * 0.15, kind: 1 });
        trees.push({ x: x0 + t, z: z1 - 1.1, s: 0.85 + rnd() * 0.15, kind: 1 });
      }
      for (let t = 12; t < d - 12; t += 13) {
        trees.push({ x: x0 + 1.1, z: z0 + t, s: 0.85 + rnd() * 0.15, kind: 1 });
        trees.push({ x: x1 - 1.1, z: z0 + t, s: 0.85 + rnd() * 0.15, kind: 1 });
      }
      if (alley) {
        // The alley between the two buildings gets a couple of crates.
        box({ kind: 'pallet', color: 0x7b5f3f, x: ix0 + 12, y: 0.15 + 0.45, z: (iz0 + iz1) / 2 + 2, sx: 1.2, sy: 0.9, sz: 1.2 });
        box({ kind: 'pallet', color: 0x7b5f3f, x: ix1 - 15, y: 0.15 + 0.45, z: (iz0 + iz1) / 2 - 2, sx: 1.2, sy: 0.9, sz: 1.2 });
      }
    }
  }
  // Road markings + street lights + crosswalks
  for (const x of CITY_X) {
    for (let z = -170; z < 170; z += 9) if (!CITY_Z.some((cz) => Math.abs(cz - z) < 9)) markings.push({ x, z, w: 0.18, l: 4, yaw: 0, color: 0xf2d24b });
    for (let z = -166; z <= 166; z += 32) lights.push({ x: x + ROAD_HALF + 0.6, z, yaw: -Math.PI / 2 });
  }
  for (const z of CITY_Z) {
    for (let x = -380; x < -40; x += 9) if (!CITY_X.some((cx) => Math.abs(cx - x) < 9)) markings.push({ x, z, w: 0.18, l: 4, yaw: Math.PI / 2, color: 0xf2d24b });
    for (let x = -360; x <= -60; x += 32) lights.push({ x, z: z + ROAD_HALF + 0.6, yaw: Math.PI });
  }
  for (const x of CITY_X) for (const z of CITY_Z) {
    for (let k = -2; k <= 2; k++) {
      markings.push({ x: x + k * 2, z: z + ROAD_HALF + 1.6, w: 1, l: 2.4, yaw: 0, color: 0xffffff });
      markings.push({ x: x + ROAD_HALF + 1.6, z: z + k * 2, w: 2.4, l: 1, yaw: 0, color: 0xffffff });
    }
  }
  for (const l of lights) box({ kind: 'invisible', tag: 'pole', x: l.x, y: 3, z: l.z, sx: 0.3, sy: 6, sz: 0.3 });

  // --- Hub ----------------------------------------------------------------
  box({ kind: 'garage', color: 0x2a2f38, x: 20, y: 4, z: 46, sx: 28, sy: 8, sz: 16 });
  labels.push({ text: 'STARK VARG GARAGE', x: 20, z: 37.9, y: 6.6, yaw: Math.PI });
  const garagePad = { x: 20, z: 32, r: 5 };
  markings.push({ x: garagePad.x, z: garagePad.z, w: 9, l: 7, yaw: 0, color: 0x1f6f8b, y: 0.02 });
  for (let i = 0; i < 4; i++) lights.push({ x: HUB.x0 + 10 + i * 30, z: HUB.z0 + 4, yaw: 0 });
  pedPaths.push([{ x: -30, z: -50 }, { x: 65, z: -50 }, { x: 65, z: 25 }, { x: -30, z: 25 }]);
  // Hub practice kickers
  ramp(-20, -10, 0, 5, 1.0, 3.5);
  ramp(-20, 4, 0, 4, 0.8, 3.5, 0x8a6a46);

  // --- Drag strip ----------------------------------------------------------
  const drag = { z: DRAG_Z, x0: -340, x1: 330, halfWidth: 9, brakeX: 120 };
  markings.push({ x: drag.x0, z: DRAG_Z, w: 0.6, l: 18, yaw: 0, color: 0xffffff });
  for (const m of [100, 200, 300, 400]) {
    markings.push({ x: drag.x0 + m, z: DRAG_Z, w: 0.4, l: 18, yaw: 0, color: 0xf2d24b });
    labels.push({ text: `${m} m`, x: drag.x0 + m, z: DRAG_Z - 10, y: 1.6, yaw: Math.PI });
    box({ kind: 'barrier', color: 0xe8e8ea, x: drag.x0 + m, y: 1, z: DRAG_Z - 11, sx: 0.4, sy: 2, sz: 1.2 });
  }
  for (let x = drag.x0 - 10; x < drag.x1; x += 12) markings.push({ x, z: DRAG_Z, w: 5, l: 0.2, yaw: 0, color: 0xffffff });
  // Braking zone: red/white stripes
  for (let i = 0; i < 12; i++) markings.push({ x: drag.brakeX + i * 4, z: DRAG_Z, w: 2, l: 17, yaw: 0, color: i % 2 ? 0xd7263d : 0xffffff, y: 0.012 });
  labels.push({ text: 'DRAG STRIP', x: drag.x0 - 4, z: DRAG_Z - 10, y: 2.4, yaw: Math.PI });
  for (let x = drag.x0; x < drag.x1; x += 40) {
    box({ kind: 'barrier', color: 0xc0c4cc, x, y: 0.5, z: DRAG_Z + 14, sx: 38, sy: 1, sz: 0.6 });
  }

  // --- Drift pad -------------------------------------------------------------
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) {
    markings.push({ x: DRIFT.x + Math.cos(a) * 22, z: DRIFT.z + Math.sin(a) * 22, w: 0.3, l: 2.2, yaw: -a, color: 0xff6b1a });
  }
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) cones.push({ x: DRIFT.x + Math.cos(a) * 9, z: DRIFT.z + Math.sin(a) * 9 });
  labels.push({ text: 'DRIFT PAD', x: DRIFT.x, z: DRIFT.z + DRIFT.r + 1, y: 1, yaw: 0 });

  // --- Handling course -------------------------------------------------------
  const gates: Spawn[] = [];
  const hx0 = HANDLING.x - HANDLING.w / 2 + 10;
  const path = [
    { x: hx0, z: HANDLING.z - 25 }, { x: hx0 + 20, z: HANDLING.z - 20 }, { x: hx0 + 35, z: HANDLING.z - 28 }, { x: hx0 + 52, z: HANDLING.z - 18 },
    { x: hx0 + 70, z: HANDLING.z - 26 }, { x: hx0 + 92, z: HANDLING.z - 10 }, { x: hx0 + 88, z: HANDLING.z + 14 }, { x: hx0 + 66, z: HANDLING.z + 24 },
    { x: hx0 + 44, z: HANDLING.z + 12 }, { x: hx0 + 24, z: HANDLING.z + 26 }, { x: hx0 + 4, z: HANDLING.z + 12 },
  ];
  for (let i = 0; i < path.length; i++) {
    const p = path[i], q = path[Math.min(path.length - 1, i + 1)], o = path[Math.max(0, i - 1)];
    const yaw = Math.atan2(q.x - o.x, q.z - o.z);
    gates.push({ x: p.x, z: p.z, yaw });
    const nx = Math.cos(yaw), nz = -Math.sin(yaw);
    cones.push({ x: p.x + nx * 2.6, z: p.z + nz * 2.6 }, { x: p.x - nx * 2.6, z: p.z - nz * 2.6 });
  }
  labels.push({ text: 'HANDLING', x: HANDLING.x, z: HANDLING.z - HANDLING.d / 2 - 0.5, y: 1, yaw: Math.PI });

  // --- Stunt park -------------------------------------------------------------
  const sx0 = STUNT.x - STUNT.w / 2, sz0 = STUNT.z - STUNT.d / 2;
  // Kicker + landing pairs of increasing size
  const pairs = [
    { x: sx0 + 15, h: 1.0, L: 4, gap: 7 },
    { x: sx0 + 35, h: 1.6, L: 5.5, gap: 11 },
    { x: sx0 + 58, h: 2.3, L: 7, gap: 15 },
    { x: sx0 + 85, h: 3.0, L: 8.5, gap: 20 },
  ];
  for (const p of pairs) {
    const z = sz0 + 10;
    ramp(p.x, z, 0, p.L, p.h, 4.5);
    const zl = z + p.L + p.gap;
    // Landing: a ramp descending away (built as an up-ramp facing back toward the kicker).
    const LL = p.L * 1.8;
    ramp(p.x, zl + LL, Math.PI, LL, p.h * 0.9, 6, 0x6f5638);
  }
  // Funbox / table
  box({ kind: 'support', color: 0x6f5638, surface: 'concrete', x: sx0 + 30, y: 0.6, z: sz0 + 70, sx: 10, sy: 1.2, sz: 8 });
  ramp(sx0 + 30, sz0 + 70 - 4 - 4, 0, 4, 1.2, 10, 0x8a6a46);
  ramp(sx0 + 30, sz0 + 70 + 4 + 4, Math.PI, 4, 1.2, 10, 0x8a6a46);
  // Wall ride-ish banked ramp
  ramp(sx0 + 80, sz0 + 72, -Math.PI / 2, 6, 2.5, 12, 0x8a6a46);
  labels.push({ text: 'STUNT PARK', x: STUNT.x, z: sz0 - 1, y: 1.2, yaw: Math.PI });

  // --- Edge walls (invisible) -------------------------------------------------
  const H = WORLD.half - 2;
  box({ kind: 'invisible', x: 0, y: 20, z: H, sx: 800, sy: 80, sz: 2 });
  box({ kind: 'invisible', x: 0, y: 20, z: -H, sx: 800, sy: 80, sz: 2 });
  box({ kind: 'invisible', x: H, y: 20, z: 0, sx: 2, sy: 80, sz: 800 });
  box({ kind: 'invisible', x: -H, y: 20, z: 0, sx: 2, sy: 80, sz: 800 });

  // --- Vegetation & rocks ----------------------------------------------------
  const nearTrack = (x: number, z: number, r: number) => track.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < r * r);
  for (let i = 0; i < 900 && trees.length < 520; i++) {
    const x = -390 + rnd() * 780, z = -390 + rnd() * 780;
    const offroad = x > 60 && z > -110;
    const park = z > 215 && x < 60;
    const south = z < -215 && Math.abs(z - DRAG_Z) > 20 && !(Math.hypot(x - DRIFT.x, z - DRIFT.z) < DRIFT.r + 6) && !inRect(x, z, HANDLING.x - HANDLING.w / 2, HANDLING.x + HANDLING.w / 2, HANDLING.z - HANDLING.d / 2, HANDLING.z + HANDLING.d / 2, 8);
    if (!offroad && !park && !south) continue;
    if (inRect(x, z, STUNT.x - STUNT.w / 2, STUNT.x + STUNT.w / 2, STUNT.z - STUNT.d / 2, STUNT.z + STUNT.d / 2, 6)) continue;
    if (Math.hypot(x - SAND.x, z - SAND.z) < SAND.r + 3) continue;
    if (Math.abs(x - 10) < 12 && z > 0) continue;
    if (Math.abs(z) < 12 && x < 120) continue;
    if (Math.abs(z + 185) < 12 && x < 180) continue;
    if (Math.abs(x - 10) < 12 && z < 0) continue;
    if (nearTrack(x, z, 14)) continue;
    if (fbm(x / 50, z / 50, 2) < -0.05 && !park) continue;
    trees.push({ x, z, s: 0.7 + rnd() * 0.8, kind: rnd() < 0.6 ? 0 : 1 });
  }
  for (const t of trees) box({ kind: 'invisible', tag: 'pole', x: t.x, y: groundAt(t.x, t.z) + 2, z: t.z, sx: 0.5 * t.s, sy: 4, sz: 0.5 * t.s });
  for (let i = 0; i < 160; i++) {
    const x = 70 + rnd() * 310, z = -100 + rnd() * 480;
    if (nearTrack(x, z, 10) || inRect(x, z, STUNT.x - STUNT.w / 2, STUNT.x + STUNT.w / 2, STUNT.z - STUNT.d / 2, STUNT.z + STUNT.d / 2, 4)) continue;
    if (Math.abs(z) < 10 && x < 120) continue;
    const s = 0.3 + rnd() * rnd() * 1.6;
    rocks.push({ x, z, s });
    if (s > 0.9) box({ kind: 'invisible', x, y: groundAt(x, z) + s * 0.35, z, sx: s * 1.5, sy: s * 0.9, sz: s * 1.3, yaw: rnd() * 3, surface: 'gravel' });
  }

  // --- Collectibles ("charge cores") ----------------------------------------
  const collectibles: WorldData['collectibles'] = [];
  const addC = (x: number, z: number) => collectibles.push({ id: `core${collectibles.length + 1}`, x, z });
  // Hand-placed rewards for exploring each area
  [[-130 + 0.5, -40], [-210, 40], [-290, -120], [-50, 120], [-370, 160], [-250, 0], [-170, -160], // city
   [-6, -120], [95, -185], [230, -160], [-200, DRAG_Z], [300, DRAG_Z], // facilities
   [STUNT.x - 20, STUNT.z - 18], [STUNT.x + 30, STUNT.z + 10], [STUNT.x - 25, STUNT.z + 30], // stunt park
   [SAND.x, SAND.z], [350, 80], [300, 240], [200, 300], [130, 330], [100, 240], [270, 140], // off-road
   [-120, 300], [-260, 280], [-20, 330], [60, 260], [-330, 330], [10, 180], [250, 20], [180, -60],
  ].forEach(([x, z]) => addC(x, z));

  // --- Track checkpoints -------------------------------------------------------
  const checkpoints: Spawn[] = [];
  for (let i = 0; i < track.length; i += 20) {
    const p = track[i], q = track[(i + 1) % track.length];
    checkpoints.push({ x: p.x, z: p.z, yaw: Math.atan2(q.x - p.x, q.z - p.z) });
  }
  // --- Dressing: feather flags, tyre stacks, chargers, planters -------------------
  const FLAG_COLORS = [0xc6f432, 0xffffff, 0x38d9f5, 0x1d2129];
  const flag = (x: number, z: number, yaw: number, i: number) => {
    decor.flags.push({ x, z, yaw, color: FLAG_COLORS[i % FLAG_COLORS.length] });
    box({ kind: 'invisible', tag: 'pole', x, y: groundAt(x, z) + 2, z, sx: 0.12, sy: 4, sz: 0.12 });
  };
  const tireStack = (x: number, z: number, i: number) => {
    decor.tires.push({ x, z, color: i % 3 === 0 ? 0xe9e9e9 : i % 3 === 1 ? 0xd8372f : 0x1b1c1f });
    box({ kind: 'invisible', x, y: groundAt(x, z) + 0.45, z, sx: 0.8, sy: 0.9, sz: 0.8 });
  };
  // Hub: flags along the plaza edges, chargers by the garage, planters with bushes.
  for (let i = 0, x = HUB.x0 + 6; x < HUB.x1 - 4; x += 14, i++) flag(x, HUB.z0 + 1.5, 0, i);
  for (let i = 0, z = HUB.z0 + 12; z < HUB.z1 - 20; z += 14, i++) flag(HUB.x1 - 1.5, z, Math.PI / 2, i + 1);
  for (let i = 0; i < 4; i++) {
    const x = 42 + i * 4.5, z = 33;
    decor.chargers.push({ x, z, yaw: Math.PI });
    box({ kind: 'invisible', x, y: groundAt(x, z) + 0.9, z, sx: 0.7, sy: 1.8, sz: 0.5 });
  }
  for (const [px, pz] of [[-6, 30], [2, 30], [38, 30], [62, 30]] as const) {
    box({ kind: 'barrier', color: 0x8d8a84, x: px, y: groundAt(px, pz) + 0.3, z: pz, sx: 3.2, sy: 0.6, sz: 1.4 });
    for (let k = 0; k < 3; k++) decor.bushes.push({ x: px - 1 + k, z: pz + (k % 2) * 0.3 - 0.15, s: 0.32 + (k % 2) * 0.08 });
  }
  // Plaza islands: raised planters with trees and bushes break up the open concrete.
  for (const [ix, iz] of [[50, -30], [-2, -42], [56, 6]] as const) {
    box({ kind: 'sidewalk', x: ix, y: groundAt(ix, iz) + 0.12, z: iz, sx: 9, sy: 0.24, sz: 9, surface: 'grass' as const, color: 0x6f8f4a });
    for (const t of [{ x: ix - 2, z: iz - 1.5, s: 0.9, kind: 1 }, { x: ix + 2.2, z: iz + 2, s: 0.8, kind: 1 }]) {
      trees.push(t);
      box({ kind: 'invisible', tag: 'pole', x: t.x, y: groundAt(t.x, t.z) + 2, z: t.z, sx: 0.5 * t.s, sy: 4, sz: 0.5 * t.s });
    }
    for (let k = 0; k < 4; k++) decor.bushes.push({ x: ix - 3 + k * 2, z: iz + (k % 2 ? 3.2 : -3.4), s: 0.3 });
  }
  // MX track: alternating flags just outside the track, tyre stacks on the outside of turns.
  {
    let acc = 0, flagI = 0, tireAcc = 0;
    const n = track.length;
    for (let i = 0; i < n; i++) {
      const a = track[i], b = track[(i + 1) % n], c = track[(i + 2) % n];
      const seg = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const tx = (b.x - a.x) / seg, tz = (b.z - a.z) / seg;
      const ux = c.x - b.x, uz = c.z - b.z;
      const turn = tx * uz - tz * ux; // + = turning left
      acc += seg;
      tireAcc += seg;
      if (acc > 28) {
        acc = 0;
        const side = flagI % 2 ? 1 : -1;
        const off = TRACK_HALF + 6.5;
        flag(a.x - tz * off * side, a.z + tx * off * side, Math.atan2(tx, tz), flagI++);
        // A small group of spectators behind every other flag, facing the track.
        if (flagI % 2 === 0) {
          const n = 2 + Math.floor(rnd() * 3);
          for (let k = 0; k < n; k++) {
            const o2 = off + 2 + rnd() * 1.5, along = (k - n / 2) * 1.1;
            const sx = a.x - tz * o2 * side + tx * along, sz = a.z + tx * o2 * side + tz * along;
            decor.spectators.push({ x: sx, z: sz, yaw: Math.atan2(a.x - sx, a.z - sz) + (rnd() - 0.5) * 0.4 });
          }
        }
      }
      if (Math.abs(turn) > 0.35 && tireAcc > 3.2) {
        tireAcc = 0;
        const side = turn > 0 ? -1 : 1; // outside of the turn
        const off = TRACK_HALF + 5.5;
        tireStack(a.x - tz * off * side, a.z + tx * off * side, i);
      }
    }
  }
  // Stunt park perimeter flags.
  for (let i = 0; i < 6; i++) flag(STUNT.x - STUNT.w / 2 + 6 + i * 19, STUNT.z - STUNT.d / 2 - 2, 0, i);
  for (let i = 0; i < 14; i++) {
    const sx = STUNT.x - STUNT.w / 2 + 8 + i * 7 + rnd() * 2, sz = STUNT.z - STUNT.d / 2 - 4 - rnd() * 2;
    decor.spectators.push({ x: sx, z: sz, yaw: (rnd() - 0.5) * 0.5 });
  }
  // Hub: people hanging out by the garage and chargers, and a hub stroll loop.
  for (let i = 0; i < 8; i++) decor.spectators.push({ x: 28 + i * 3.4 + rnd(), z: 31 - rnd() * 2, yaw: Math.PI + (rnd() - 0.5) * 1.2 });
  pedPaths.push([{ x: -30, z: 36 }, { x: 70, z: 36 }, { x: 70, z: -55 }, { x: -30, z: -55 }]);

  // Track flag poles at start
  labels.push({ text: 'MX TRACK', x: track[0].x, z: track[0].z, y: groundAt(track[0].x, track[0].z) + 4.5, yaw: checkpoints[0].yaw + Math.PI });

  const t0 = checkpoints[0];
  const spawns: Record<string, Spawn> = {
    hub: { x: 20, z: 22, yaw: Math.PI },
    garage: { x: 20, z: 30, yaw: Math.PI },
    drag: { x: drag.x0 - 6, z: DRAG_Z, yaw: Math.PI / 2 },
    drift: { x: DRIFT.x - 30, z: DRIFT.z, yaw: 0 },
    handling: { x: path[0].x - 12, z: path[0].z, yaw: Math.PI / 2 },
    track: { x: t0.x - Math.sin(t0.yaw) * 12, z: t0.z - Math.cos(t0.yaw) * 12, yaw: t0.yaw },
    stunt: { x: pairs[0].x, z: sz0 - 6, yaw: 0 },
    city: { x: -50, z: -150, yaw: 0 },
    offroad: { x: 110, z: 0, yaw: Math.PI / 2 },
    sand: { x: SAND.x - SAND.r - 10, z: SAND.z, yaw: Math.PI / 2 },
  };

  return {
    terrain: hf, boxes, markings, trees, rocks, lights, cones, pedPaths, collectibles, spawns,
    track: { points: track, checkpoints, halfWidth: TRACK_HALF },
    drag, driftPad: DRIFT, handling: { x: HANDLING.x, z: HANDLING.z, gates }, stunt: STUNT, garagePad, labels, decor,
  };
}
