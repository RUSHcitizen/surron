/**
 * Moulded bodywork for the motocross bike: shrouds, tank cover, saddle, side panels and the
 * upswept tail as ONE continuous smooth surface (signed-distance modelling, same mesher as
 * the rider), so the bike reads as sleek injection-moulded plastic rather than flat
 * extruded slabs. The battery case, frame and running gear stay separate meshes.
 *
 * Colours are baked per vertex from whichever part is nearest: plastic, saddle, and a
 * graphic stripe sweeping along the shroud. Meshes are cached per shape key (the garage
 * rebuilds the bike on every part change).
 */
import { BufferGeometry, Color, Float32BufferAttribute, Uint32BufferAttribute } from 'three';
import { ellipsoid, meshSDF, roundBox, roundCone, smin } from './sdfMesh';

export interface ShellInput {
  /** Battery centre and size (chassis frame). */
  bat: { x: number; y: number; z: number };
  bs: { x: number; y: number; z: number };
  head: { x: number; y: number; z: number };
  seat: { x: number; y: number; z: number };
  seatLength: number;
  /** Tail (rear fender) length behind the saddle, m. */
  tail: number;
  plastic: string;
  seatColor: string;
  stripe: string;
}

const cache = new Map<string, BufferGeometry>();

export function bodyShellGeometry(p: ShellInput): BufferGeometry {
  const key = JSON.stringify(p);
  const hit = cache.get(key);
  if (hit) return hit;
  const { bat, bs, head, seat } = p;
  const z0 = bat.z - bs.z / 2;
  const seatFront = seat.z + p.seatLength / 2, seatEnd = seat.z - p.seatLength / 2;
  const sy = seat.y;
  const halfW = Math.max(bs.x / 2 + 0.03, 0.115);
  const tailEnd = seatEnd - p.tail;

  // --- Parts (each a distance function) ------------------------------------------------
  // Tank cover: a low, rounded hump over the front of the pack, rising toward the head.
  const tank = (x: number, y: number, z: number) => {
    const t = Math.min(1, Math.max(0, (z - seatFront) / (head.z - seatFront)));
    const cy = sy + 0.0 + t * (head.y + 0.02 - sy);
    const w = halfW * (0.82 - 0.25 * t);
    return roundBox(x, y - cy, z - (seatFront + head.z) / 2 + 0.03, w, 0.05, (head.z - seatFront) / 2 + 0.03, 0.045);
  };
  // Shrouds: a flattened, swept wing on each flank from mid-pack up to the steering head.
  const shroud = (x: number, y: number, z: number) => {
    const ax = Math.abs(x);
    // Flatten across the bike so the wing is a broad panel, not a tube.
    const sx = (ax - (halfW - 0.035)) * 2.2;
    return roundCone(sx, y, z, 0, bat.y + 0.02, z0 + 0.07, 0, head.y - 0.015, head.z - 0.02, 0.1, 0.06) * 0.6;
  };
  // Side panels under the saddle (number-board area).
  const side = (x: number, y: number, z: number) => ellipsoid(x, y - (sy - 0.095), z - (seatEnd + 0.22), halfW * 0.95, 0.1, 0.28);
  // Tail / rear fender: tapering and kicking up behind the saddle, oval in section.
  const tail = (x: number, y: number, z: number) =>
    roundCone(x * 1.15, (y - sy) * 1.7, z, 0, -0.05 * 1.7, seatEnd + 0.14, 0, 0.045 * 1.7, tailEnd, 0.075, 0.026) / 1.7;
  // Saddle: long, flat-topped, narrowing toward the front.
  const saddle = (x: number, y: number, z: number) => {
    // Runs forward up onto the tank, as MX saddles do.
    const front = seatFront + 0.1;
    const t = Math.min(1, Math.max(0, (z - seatEnd) / (front - seatEnd)));
    const w = 0.1 - t * 0.045;
    const top = sy + 0.045 + t * t * 0.03;
    return roundBox(x, y - (top - 0.035), z - (seatEnd + front) / 2, w, 0.035, (front - seatEnd) / 2, 0.03);
  };

  const plasticD = (x: number, y: number, z: number) =>
    smin(smin(smin(tank(x, y, z), shroud(x, y, z), 0.06), side(x, y, z), 0.07), tail(x, y, z), 0.06);
  const sdf = (x: number, y: number, z: number) => smin(plasticD(x, y, z), saddle(x, y, z), 0.012);

  const min: [number, number, number] = [-halfW - 0.08, Math.min(bat.y - 0.1, sy - 0.26), tailEnd - 0.06];
  const max: [number, number, number] = [halfW + 0.08, Math.max(head.y + 0.14, sy + 0.16), head.z + 0.12];
  const m = meshSDF(sdf, min, max, 0.0105);

  // --- Colours ----------------------------------------------------------------------------
  const cPl = new Color(p.plastic), cSeat = new Color(p.seatColor), cStripe = new Color(p.stripe);
  const n = m.positions.length / 3;
  const col = new Float32Array(n * 3);
  const c = new Color();
  for (let i = 0; i < n; i++) {
    const x = m.positions[i * 3], y = m.positions[i * 3 + 1], z = m.positions[i * 3 + 2];
    const dSeat = saddle(x, y, z), dPl = plasticD(x, y, z);
    // Soft but narrow transition at the saddle edge.
    const seatW = Math.min(1, Math.max(0, (dPl - dSeat) / 0.004 + 0.5));
    // A graphic sweep along the shroud flank: a band rising toward the head.
    const lineY = bat.y + 0.03 + ((z - z0) / (head.z - z0)) * (head.y - bat.y - 0.08);
    const onFlank = Math.min(1, Math.max(0, (Math.abs(x) - (halfW - 0.05)) / 0.02)) * (z > z0 && z < head.z ? 1 : 0);
    const band = onFlank * (1 - Math.min(1, Math.max(0, (Math.abs(y - lineY) - 0.012) / 0.012)));
    c.copy(cPl).lerp(cStripe, band * 0).lerp(cSeat, seatW);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(m.normals, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(new Uint32BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  if (cache.size > 16) cache.delete(cache.keys().next().value!);
  cache.set(key, g);
  return g;
}
