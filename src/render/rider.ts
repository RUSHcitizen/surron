/**
 * The rider: a man in motocross gear (jersey, pants, knee guards, tall boots, gloves, neck
 * brace and a sculpted helmet with goggles), built as one continuous skinned body.
 *
 * The body is modelled once as a signed distance field in a riding rest pose (see sdfMesh.ts)
 * and skinned to 15 bones with smooth weights, so shoulders, elbows, hips and knees bend like
 * a body in clothing instead of separate parts meeting at joints. Each frame the same IK pose
 * as before (hands on the grips, feet on the pegs, torso and head following speed, lean and
 * weight shift) drives the bones. Gear colours come from the build and only re-colour the
 * cached mesh; nothing is re-meshed when the player changes paint.
 */
import {
  BufferAttribute, BufferGeometry, DetachedBindMode, Euler, Float32BufferAttribute, Group, Matrix4, Mesh, MeshPhysicalMaterial,
  MeshStandardMaterial, Quaternion, Skeleton, SkinnedMesh, Bone, Uint16BufferAttribute, Vector3, Color,
} from 'three';
import type { Material } from 'three';
import type { BikeBuild } from '../vehicle/build';
import type { HelmetStyle } from '../vehicle/parts';
import type { VehicleSpec } from '../vehicle/spec';
import { ellipsoid, meshSDF, roundBox, roundCone, smin, ssub } from './sdfMesh';

/** Limb lengths shared by the rest pose and the IK, m. */
export const LIMB = { uarm: 0.3, farm: 0.3, thigh: 0.44, shin: 0.46, torso: 0.5 };

const X = new Vector3(1, 0, 0), UP = new Vector3(0, 1, 0);

interface Joints {
  hip: Vector3; mid: Vector3; neck: Vector3; head: Vector3; headRot: Quaternion;
  sh: [Vector3, Vector3]; el: [Vector3, Vector3]; wr: [Vector3, Vector3];
  hipS: [Vector3, Vector3]; kn: [Vector3, Vector3]; an: [Vector3, Vector3]; toe: [Vector3, Vector3];
}
const pair = (): [Vector3, Vector3] => [new Vector3(), new Vector3()];
const makeJoints = (): Joints => ({
  hip: new Vector3(), mid: new Vector3(), neck: new Vector3(), head: new Vector3(), headRot: new Quaternion(),
  sh: pair(), el: pair(), wr: pair(), hipS: pair(), kn: pair(), an: pair(), toe: pair(),
});

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _d = new Vector3();
function twoBoneIK(a: Vector3, c: Vector3, l1: number, l2: number, hint: Vector3, out: Vector3) {
  const dir = _a.subVectors(c, a);
  let d = dir.length();
  if (d < 1e-5) return out.copy(a).addScaledVector(hint, l1);
  dir.multiplyScalar(1 / d);
  d = Math.min(d, (l1 + l2) * 0.999);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const p = _b.copy(hint).addScaledVector(dir, -hint.dot(dir));
  if (p.lengthSq() < 1e-8) p.set(0, 1, 0);
  p.normalize();
  return out.copy(a).addScaledVector(dir, x).addScaledVector(p, h);
}

// Elbows out and up (the MX attack position), knees forward.
const armHint = (s: number, out: Vector3) => out.set(s * 0.8, 0.02, -0.5);
const legHint = (s: number, out: Vector3) => out.set(s * 0.25, 0.3, 1);

/** Torso rounding: the spine bows up/back between hip and neck, like a rider over the bars. */
function spineMid(j: Joints) {
  const t = _c.subVectors(j.neck, j.hip).normalize();
  const back = _d.copy(UP).addScaledVector(t, -UP.dot(t));
  if (back.lengthSq() < 1e-6) back.set(0, 0, -1);
  back.normalize();
  j.mid.copy(j.hip).addScaledVector(t, LIMB.torso * 0.48).addScaledVector(back, 0.03);
}

/** Rest pose (riding stance), hip at the origin; x = rider's left, y = up, z = forward. */
function restJoints(): Joints {
  const j = makeJoints();
  const pitch = 0.6;
  j.neck.set(0, Math.cos(pitch) * LIMB.torso, Math.sin(pitch) * LIMB.torso);
  spineMid(j);
  j.head.copy(j.neck).add(new Vector3(0, 0.135, 0.07));
  const h = new Vector3();
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    j.sh[i].copy(j.neck).add(new Vector3(s * 0.19, -0.07, -0.02));
    // Arms close to the riding pose (elbows out, hands forward) so skinning has little to do,
    // but held clear of the legs so the field does not merge them.
    // Upper arm well out from the ribs (no armpit webbing when the arm moves).
    j.el[i].copy(j.sh[i]).add(new Vector3(s * 0.2, -0.1, -0.17).setLength(LIMB.uarm));
    j.wr[i].copy(j.el[i]).add(new Vector3(s * -0.04, -0.02, 0.3).setLength(LIMB.farm));
    j.hipS[i].set(s * 0.105, 0, 0);
    j.an[i].set(s * 0.2, -0.74, 0.1);
    twoBoneIK(j.hipS[i], j.an[i], LIMB.thigh, LIMB.shin, legHint(s, h), j.kn[i]);
    j.toe[i].copy(j.an[i]).add(new Vector3(0, -0.03, 0.16));
  }
  return j;
}

// --- Bones -------------------------------------------------------------------------------
const BONES = ['pelvis', 'abdomen', 'chest', 'neck', 'head', 'uarmL', 'farmL', 'uarmR', 'farmR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'] as const;
type BoneName = (typeof BONES)[number];
const B = Object.fromEntries(BONES.map((n, i) => [n, i])) as Record<BoneName, number>;

/** Frame with origin a, y along a→b and x toward `ref` (made perpendicular). */
function segFrame(a: Vector3, b: Vector3, ref: Vector3, out: Matrix4, len?: { v: number }) {
  const y = _a.subVectors(b, a);
  const l = y.length();
  if (len) len.v = l;
  if (l < 1e-6) y.set(0, 1, 0);
  else y.multiplyScalar(1 / l);
  const x = _b.copy(ref).addScaledVector(y, -ref.dot(y));
  if (x.lengthSq() < 1e-8) x.set(0, 0, 1).addScaledVector(y, -y.z);
  x.normalize();
  const z = _c.crossVectors(x, y);
  return out.makeBasis(x, y, z).setPosition(a);
}

const _h = new Vector3(), _pd = new Vector3();
/** Bone frames for a pose; `lens` receives segment lengths (for stretch). */
function boneFrames(j: Joints, out: Matrix4[], lens?: number[]) {
  const L = { v: 0 };
  const put = (i: number, a: Vector3, b: Vector3, ref: Vector3) => {
    segFrame(a, b, ref, out[i], L);
    if (lens) lens[i] = L.v;
  };
  const t = _pd.subVectors(j.neck, j.hip).normalize();
  const pelvisTip = new Vector3().copy(t).addScaledVector(UP, 1.2).normalize().multiplyScalar(0.2).add(j.hip);
  put(B.pelvis, j.hip, pelvisTip, X);
  put(B.abdomen, j.hip, j.mid, X);
  put(B.chest, j.mid, j.neck, X);
  put(B.neck, j.neck, j.head, X);
  out[B.head].makeRotationFromQuaternion(j.headRot).setPosition(j.head);
  if (lens) lens[B.head] = 1;
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    const S = i === 0 ? 'L' : 'R';
    put(B[('uarm' + S) as BoneName], j.sh[i], j.el[i], armHint(s, _h));
    put(B[('farm' + S) as BoneName], j.el[i], j.wr[i], armHint(s, _h));
    put(B[('thigh' + S) as BoneName], j.hipS[i], j.kn[i], legHint(s, _h));
    put(B[('shin' + S) as BoneName], j.kn[i], j.an[i], legHint(s, _h));
    put(B[('foot' + S) as BoneName], j.an[i], j.toe[i], X);
  }
}

// --- Body field ----------------------------------------------------------------------------
type Region = 'jersey' | 'jerseyAcc' | 'pants' | 'pantsAcc' | 'boot' | 'buckle' | 'sole' | 'glove' | 'gloveAcc' | 'guard' | 'brace' | 'skin';
const REGIONS: Region[] = ['jersey', 'jerseyAcc', 'pants', 'pantsAcc', 'boot', 'buckle', 'sole', 'glove', 'gloveAcc', 'guard', 'brace', 'skin'];
const PLASTIC = new Set<Region>(['boot', 'buckle', 'sole', 'guard', 'brace']);

interface Prim {
  bone: number;
  region: Region;
  /** Blend radius into what came before. */
  k: number;
  /** Cloth wrinkle amplitude (m). */
  wr: number;
  d: Field;
  /** Bounding sphere of the primitive's surface (centre + radius), for skipping far ones. */
  bc?: Vector3;
  br?: number;
  /** Optional local parameter along a segment (0..1) for region rules. */
  t?: (x: number, y: number, z: number) => number;
  /** Optional lateral coordinate (outward +) for region rules. */
  side?: (x: number, y: number, z: number) => number;
}

type Field = ((x: number, y: number, z: number) => number) & { bc?: Vector3; br?: number };
/** Attach a bounding sphere to a field function. */
const bound = (f: Field, c: Vector3, r: number): Field => Object.assign(f, { bc: c.clone(), br: r });
const cone = (a: Vector3, b: Vector3, ra: number, rb: number) =>
  bound((x, y, z) => roundCone(x, y, z, a.x, a.y, a.z, b.x, b.y, b.z, ra, rb), a.clone().add(b).multiplyScalar(0.5), a.distanceTo(b) / 2 + Math.max(ra, rb));
const sphere = (c: Vector3, r: number) => bound((x, y, z) => Math.sqrt((x - c.x) ** 2 + (y - c.y) ** 2 + (z - c.z) ** 2) - r, c, r);
const along = (a: Vector3, b: Vector3) => {
  const d = new Vector3().subVectors(b, a);
  const l2 = d.lengthSq();
  return (x: number, y: number, z: number) => ((x - a.x) * d.x + (y - a.y) * d.y + (z - a.z) * d.z) / l2;
};
/** Oriented ellipsoid: centre c, orthonormal axes, radii. */
const oEllipsoid = (c: Vector3, ax: Vector3, ay: Vector3, az: Vector3, r: [number, number, number]) => bound((x, y, z) => {
  const px = x - c.x, py = y - c.y, pz = z - c.z;
  return ellipsoid(px * ax.x + py * ax.y + pz * ax.z, px * ay.x + py * ay.y + pz * ay.z, px * az.x + py * az.y + pz * az.z, r[0], r[1], r[2]);
}, c, Math.max(...r));
/** Torus around axis n through c. */
const torus = (c: Vector3, n: Vector3, R: number, r: number) => bound((x, y, z) => {
  const px = x - c.x, py = y - c.y, pz = z - c.z;
  const h = px * n.x + py * n.y + pz * n.z;
  const qx = px - n.x * h, qy = py - n.y * h, qz = pz - n.z * h;
  const a = Math.sqrt(qx * qx + qy * qy + qz * qz) - R;
  return Math.sqrt(a * a + h * h) - r;
}, c, R + r);

function bodyPrims(j: Joints): Prim[] {
  const P: Prim[] = [];
  const t = new Vector3().subVectors(j.neck, j.hip).normalize();
  const back = new Vector3().copy(UP).addScaledVector(t, -UP.dot(t)).normalize();
  const front = back.clone().negate();
  // Pelvis and seat.
  P.push({ bone: B.pelvis, region: 'pants', k: 0, wr: 0.0015, d: oEllipsoid(j.hip.clone().addScaledVector(t, 0.03).addScaledVector(back, 0.01), X, t, front, [0.17, 0.14, 0.14]) });
  // Abdomen and chest: wider than deep, shoulders broad; the jersey hangs loose.
  P.push({ bone: B.abdomen, region: 'jersey', k: 0.07, wr: 0.002, d: oEllipsoid(j.hip.clone().addScaledVector(t, 0.2).addScaledVector(back, 0.01), X, t, front, [0.165, 0.15, 0.13]) });
  const chestC = j.mid.clone().addScaledVector(t, 0.1).addScaledVector(back, -0.005);
  P.push({
    bone: B.chest, region: 'jersey', k: 0.08, wr: 0.0015, d: oEllipsoid(chestC, X, t, front, [0.198, 0.178, 0.142]),
    side: (x) => Math.abs(x) / 0.198,
  });
  // Trapezius / shoulder line.
  // (Stops short of the shoulder joints: the shoulder caps belong to the arms, so they rotate
  // with them instead of being pinched between chest and arm.)
  const trapL = j.sh[0].clone().lerp(j.sh[1], 0.2).addScaledVector(t, 0.015), trapR = j.sh[1].clone().lerp(j.sh[0], 0.2).addScaledVector(t, 0.015);
  P.push({ bone: B.chest, region: 'jersey', k: 0.06, wr: 0.001, d: cone(trapL, trapR, 0.075, 0.075) });
  // Neck, head (under the helmet) and neck brace.
  P.push({ bone: B.neck, region: 'jerseyAcc', k: 0.03, wr: 0, d: cone(j.neck.clone().addScaledVector(t, -0.04), j.head.clone().add(new Vector3(0, -0.05, -0.01)), 0.058, 0.052) });
  P.push({ bone: B.head, region: 'skin', k: 0.03, wr: 0, d: bound((x, y, z) => ellipsoid(x - j.head.x, y - j.head.y, z - j.head.z, 0.09, 0.11, 0.1), j.head, 0.11) });
  P.push({ bone: B.chest, region: 'brace', k: 0.012, wr: 0, d: torus(j.neck.clone().addScaledVector(t, -0.005), t, 0.088, 0.026) });
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    const S = i === 0 ? 'L' : 'R';
    const uarm = B[('uarm' + S) as BoneName], farm = B[('farm' + S) as BoneName];
    const thigh = B[('thigh' + S) as BoneName], shin = B[('shin' + S) as BoneName], foot = B[('foot' + S) as BoneName];
    // Arms: deltoid, sleeve, forearm, fist around the grip.
    const ud = new Vector3().subVectors(j.el[i], j.sh[i]).normalize();
    P.push({ bone: uarm, region: 'jersey', k: 0.05, wr: 0.002, d: sphere(j.sh[i].clone().addScaledVector(ud, 0.025), 0.064) });
    P.push({ bone: uarm, region: 'jersey', k: 0.035, wr: 0.0028, d: cone(j.sh[i], j.el[i], 0.062, 0.051) });
    const fd = new Vector3().subVectors(j.wr[i], j.el[i]).normalize();
    const cuffEnd = j.wr[i].clone().addScaledVector(fd, -0.06);
    P.push({ bone: farm, region: 'jersey', k: 0.025, wr: 0.0025, d: cone(j.el[i], cuffEnd, 0.055, 0.046), t: along(j.el[i], cuffEnd) });
    const gx = new Vector3().copy(armHint(s, new Vector3())).addScaledVector(fd, -armHint(s, new Vector3()).dot(fd)).normalize();
    const gz = new Vector3().crossVectors(gx, fd);
    P.push({ bone: farm, region: 'glove', k: 0.02, wr: 0.001, d: oEllipsoid(j.wr[i].clone().addScaledVector(fd, -0.005), gx, fd, gz, [0.045, 0.058, 0.05]), t: along(cuffEnd, j.wr[i]) });
    // Legs: thigh, knee guard, boot shaft, foot and sole.
    const thighT = along(j.hipS[i], j.kn[i]);
    P.push({
      bone: thigh, region: 'pants', k: 0.06, wr: 0.003, d: cone(j.hipS[i], j.kn[i], 0.092, 0.068), t: along(j.hipS[i], j.kn[i]),
      side: (x, y, z) => {
        const u = Math.max(0, Math.min(1, thighT(x, y, z)));
        return (s * (x - (j.hipS[i].x + (j.kn[i].x - j.hipS[i].x) * u))) / (0.092 - 0.024 * u);
      },
    });
    const kneeFront = new Vector3().copy(legHint(s, new Vector3()));
    const sd = new Vector3().subVectors(j.an[i], j.kn[i]).normalize();
    kneeFront.addScaledVector(sd, -kneeFront.dot(sd)).normalize();
    const kx = new Vector3().crossVectors(sd, kneeFront).normalize();
    P.push({ bone: shin, region: 'guard', k: 0.012, wr: 0, d: oEllipsoid(j.kn[i].clone().addScaledVector(kneeFront, 0.035).addScaledVector(sd, 0.05), kx, sd, kneeFront, [0.055, 0.11, 0.035]) });
    P.push({ bone: shin, region: 'boot', k: 0.03, wr: 0.0012, d: cone(j.kn[i].clone().addScaledVector(sd, 0.02), j.an[i], 0.068, 0.07), t: along(j.kn[i], j.an[i]), side: (x) => s * (x - j.an[i].x) });
    P.push({ bone: foot, region: 'boot', k: 0.035, wr: 0, d: cone(j.an[i].clone().add(new Vector3(0, -0.01, -0.03)), j.toe[i], 0.062, 0.042) });
    P.push({ bone: foot, region: 'sole', k: 0.012, wr: 0, d: bound((x, y, z) => roundBox(x - j.an[i].x, y - (j.an[i].y - 0.055), z - (j.an[i].z + 0.055), 0.048, 0.016, 0.135, 0.014), j.an[i].clone().add(new Vector3(0, -0.055, 0.055)), 0.15) });
  }
  for (const p of P) primBounds(p);
  return P;
}

/** Copy the field's bounding sphere onto the primitive. */
function primBounds(p: Prim) {
  const f = p.d as Field;
  p.bc = f.bc ?? new Vector3();
  p.br = f.br ?? 10;
}

/** Fabric crumple (small, irregular folds). */
const wrinkle = (x: number, y: number, z: number) =>
  Math.sin(x * 52 + Math.sin(y * 23) * 2) * Math.sin(z * 47 + y * 21) * 0.75 + Math.sin(y * 70 + x * 19) * 0.25;

interface RiderMesh {
  geometry: BufferGeometry;
  regions: Uint8Array;
  restInverse: Matrix4[];
  restLen: number[];
}

let cachedBody: RiderMesh | null = null;

function buildBody(): RiderMesh {
  const rest = restJoints();
  const prims = bodyPrims(rest);
  const sdf = (x: number, y: number, z: number) => {
    let d = 1e9;
    let best = 1e9, bi = -1;
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i];
      // A primitive further than the blend radius beyond the current surface cannot matter.
      if (i > 0) {
        const qx = x - p.bc!.x, qy = y - p.bc!.y, qz = z - p.bc!.z;
        const lb = Math.sqrt(qx * qx + qy * qy + qz * qz) - p.br!;
        if (lb > d + p.k) continue;
      }
      const v = p.d(x, y, z);
      d = i === 0 ? v : smin(d, v, p.k);
      if (v < best) {
        best = v;
        bi = i;
      }
    }
    const w = prims[bi].wr;
    return w > 0 && d > -0.02 ? d + w * wrinkle(x, y, z) : d;
  };
  const m = meshSDF(sdf, [-0.56, -0.92, -0.26], [0.56, 0.74, 0.7], 0.0135);
  const n = m.positions.length / 3;
  const regions = new Uint8Array(n);
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const boneD = new Float32Array(BONES.length);
  const top = [0, 0, 0, 0], topD = [0, 0, 0, 0];
  for (let v = 0; v < n; v++) {
    const x = m.positions[v * 3], y = m.positions[v * 3 + 1], z = m.positions[v * 3 + 2];
    boneD.fill(1e9);
    let best = 1e9, bp: Prim | null = null;
    for (const p of prims) {
      const d = p.d(x, y, z);
      if (d < boneD[p.bone]) boneD[p.bone] = d;
      if (d < best) {
        best = d;
        bp = p;
      }
    }
    // Region from the nearest primitive, refined by gear details.
    let r: Region = bp!.region;
    const tt = bp!.t?.(x, y, z) ?? 0;
    const side = bp!.side?.(x, y, z) ?? 0;
    if (r === 'jersey' && bp!.t && tt > 0.78) r = 'jerseyAcc'; // cuffs
    else if (r === 'glove' && tt < 0.32) r = 'gloveAcc'; // glove cuff
    else if (r === 'pants' && bp!.side && side > 0.8 && tt > 0.12 && tt < 0.88) r = 'pantsAcc'; // outer leg stripe
    else if (r === 'boot' && bp!.t) {
      if (tt < 0.3) r = 'pants';
      else if (side > 0.035 && [0.5, 0.66, 0.82].some((b) => Math.abs(tt - b) < 0.02)) r = 'buckle';
    }
    regions[v] = REGIONS.indexOf(r);
    // Smooth skin weights: every bone within a blend band of the nearest one.
    // Four nearest bones (selection, no sort).
    for (let k = 0; k < 4; k++) {
      let bi = 0;
      for (let q = 1; q < boneD.length; q++) if (boneD[q] < boneD[bi]) bi = q;
      top[k] = bi;
      topD[k] = boneD[bi];
      boneD[bi] = 1e9;
    }
    let sum = 0;
    const d0 = topD[0];
    for (let k = 0; k < 4; k++) {
      const w = Math.max(0, 1 - (topD[k] - d0) / 0.03) ** 2;
      topD[k] = w;
      sum += w;
    }
    for (let k = 0; k < 4; k++) {
      skinIndex[v * 4 + k] = top[k];
      skinWeight[v * 4 + k] = topD[k] / sum;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new BufferAttribute(m.normals, 3));
  g.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new Float32BufferAttribute(skinWeight, 4));
  g.setAttribute('color', new Float32BufferAttribute(new Float32Array(n * 3), 3));
  // Two material groups: fabric (jersey, pants, gloves) and plastic/leather (boots, guards, brace).
  const fab: number[] = [], pla: number[] = [];
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t], b = m.indices[t + 1], c = m.indices[t + 2];
    const votes = [a, b, c].filter((i) => PLASTIC.has(REGIONS[regions[i]])).length;
    (votes >= 2 ? pla : fab).push(a, b, c);
  }
  g.setIndex([...fab, ...pla]);
  g.addGroup(0, fab.length, 0);
  g.addGroup(fab.length, pla.length, 1);
  const frames = BONES.map(() => new Matrix4());
  const lens: number[] = [];
  boneFrames(rest, frames, lens);
  return { geometry: g, regions, restInverse: frames.map((f) => f.clone().invert()), restLen: lens };
}

// --- Helmet ---------------------------------------------------------------------------------
type HRegion = 'shell' | 'accent' | 'lens' | 'frame' | 'strap' | 'trim';
const HREGIONS: HRegion[] = ['shell', 'accent', 'lens', 'frame', 'strap', 'trim'];
const helmetCache = new Map<HelmetStyle, { geometry: BufferGeometry; regions: Uint8Array }>();

function buildHelmet(style: HelmetStyle) {
  const hit = helmetCache.get(style);
  if (hit) return hit;
  const mx = style === 'mx', full = style === 'full';
  const peakPitch = -0.24, cp = Math.cos(peakPitch), sp = Math.sin(peakPitch);
  const shell = (x: number, y: number, z: number) => ellipsoid(x, y - 0.015, z + 0.01, 0.133, 0.142, 0.158);
  const chin = full
    ? (x: number, y: number, z: number) => roundCone(x, y, z, 0, -0.06, 0.05, 0, -0.095, 0.125, 0.092, 0.06)
    : (x: number, y: number, z: number) => roundCone(x, y, z, 0, -0.065, 0.055, 0, mx ? -0.108 : -0.1, mx ? 0.152 : 0.14, 0.086, mx ? 0.05 : 0.055);
  const eyePort = (x: number, y: number, z: number) => ellipsoid(x, y - 0.006, z - 0.152, 0.098, 0.043, 0.07);
  const goggles = (x: number, y: number, z: number) => ellipsoid(x, y - 0.006, z - 0.118, 0.1, 0.039, 0.052);
  const peak = (x: number, y: number, z: number) => {
    const ly = y - 0.088, lz = z - 0.168;
    const py = ly * cp - lz * sp, pz = ly * sp + lz * cp;
    const taper = 1 - 0.25 * Math.max(0, pz / 0.09);
    return roundBox(x, py, pz, (mx ? 0.11 : 0.1) * taper, 0.006, mx ? 0.09 : 0.07, 0.005);
  };
  const sdf = (x: number, y: number, z: number) => {
    let d = smin(shell(x, y, z), chin(x, y, z), 0.05);
    if (!full) {
      d = ssub(d, eyePort(x, y, z), 0.012);
      d = smin(d, goggles(x, y, z), 0.008);
      d = smin(d, peak(x, y, z), 0.02);
    }
    return d;
  };
  const m = meshSDF(sdf, [-0.17, -0.19, -0.2], [0.17, 0.17, 0.27], 0.0078);
  const n = m.positions.length / 3;
  const regions = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    const x = m.positions[v * 3], y = m.positions[v * 3 + 1], z = m.positions[v * 3 + 2];
    let r: HRegion = 'shell';
    const ds = shell(x, y, z), dc = chin(x, y, z);
    if (!full && Math.abs(goggles(x, y, z)) < 0.004 && z > 0.12) r = Math.abs(y - 0.006) < 0.027 && Math.abs(x) < 0.084 ? 'lens' : 'frame';
    else if (!full && Math.abs(peak(x, y, z)) < 0.004) r = 'accent';
    else if (full && z > 0.09 && Math.abs(y - 0.008) < 0.046 && Math.abs(x) < 0.1 && ds < 0.006) r = 'lens';
    else if (!full && Math.abs(y - 0.008) < 0.017 && z < 0.1 && ds < 0.004) r = 'strap';
    else if (y < -0.118 && z < 0.06) r = 'trim';
    else if (dc < ds - 0.004 && !full) r = 'accent';
    else if (Math.abs(x) < 0.022 && y > 0.07) r = 'accent';
    else if (full && Math.abs(x) > 0.1 && y < -0.02 && y > -0.06) r = 'accent';
    regions[v] = HREGIONS.indexOf(r);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new BufferAttribute(m.normals, 3));
  g.setAttribute('color', new Float32BufferAttribute(new Float32Array(n * 3), 3));
  const groups: number[][] = [[], [], []]; // painted shell, lens, soft (frame/strap/trim)
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t], b = m.indices[t + 1], c = m.indices[t + 2];
    const rs = [a, b, c].map((i) => HREGIONS[regions[i]]);
    const lens = rs.filter((r) => r === 'lens').length >= 2;
    const soft = rs.filter((r) => r === 'frame' || r === 'strap' || r === 'trim').length >= 2;
    groups[lens ? 1 : soft ? 2 : 0].push(a, b, c);
  }
  g.setIndex(groups.flat());
  let o = 0;
  groups.forEach((gr, i) => {
    g.addGroup(o, gr.length, i);
    o += gr.length;
  });
  const res = { geometry: g, regions };
  helmetCache.set(style, res);
  return res;
}

/** Average each vertex colour with its neighbours `iterations` times (along mesh edges). */
function smoothColors(src: Float32Array, g: BufferGeometry, iterations: number): Float32Array {
  const idx = g.index!.array;
  const n = src.length / 3;
  let a: Float32Array = src, b: Float32Array = new Float32Array(src.length);
  for (let it = 0; it < iterations; it++) {
    b.set(a);
    const cnt = new Float32Array(n).fill(1);
    for (let t = 0; t < idx.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const p = idx[t + e], q = idx[t + ((e + 1) % 3)];
        for (let k = 0; k < 3; k++) {
          b[p * 3 + k] += a[q * 3 + k];
          b[q * 3 + k] += a[p * 3 + k];
        }
        cnt[p]++;
        cnt[q]++;
      }
    }
    for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) b[v * 3 + k] /= cnt[v];
    [a, b] = [b, a];
  }
  return a;
}

const lum = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** Rider in MX gear, posed by IK. Lives in the scene separately so it can detach on crashes. */
export class RiderModel {
  root = new Group();
  private body: SkinnedMesh;
  private helmet: Mesh;
  private bones: Bone[];
  private mats: Material[] = [];
  private frames = BONES.map(() => new Matrix4());
  private lens: number[] = [];
  private j = makeJoints();
  private girth = 1;
  private data: RiderMesh;
  private style: HelmetStyle | null = null;
  private tmpS = new Matrix4();
  private v = new Vector3();
  private e = new Euler();

  constructor(build: BikeBuild) {
    this.data = cachedBody ??= buildBody();
    this.bones = BONES.map(() => {
      const b = new Bone();
      b.matrixAutoUpdate = false;
      b.matrixWorldAutoUpdate = false;
      return b;
    });
    const skel = new Skeleton(this.bones, this.data.restInverse.map((m) => m.clone()));
    this.body = new SkinnedMesh(this.data.geometry, []);
    this.body.bindMode = DetachedBindMode;
    this.body.bind(skel, new Matrix4());
    this.body.frustumCulled = false;
    this.body.castShadow = true;
    this.helmet = new Mesh(undefined, []);
    this.helmet.matrixAutoUpdate = false;
    this.helmet.castShadow = true;
    this.helmet.frustumCulled = false;
    this.root.add(this.body, this.helmet);
    this.root.matrixAutoUpdate = false;
    this.rebuild(build);
    // Start in the rest pose so the first frame is valid even before pose() runs.
    for (let i = 0; i < BONES.length; i++) this.bones[i].matrixWorld.identity().multiply(this.data.restInverse[i].clone().invert());
  }

  rebuild(build: BikeBuild) {
    const R = build.rider ?? { weight: 75, helmet: 'mx' as HelmetStyle, helmetColor: build.visual.plasticColor, helmetAccent: build.visual.accentColor, jerseyColor: build.visual.accentColor, pantsColor: '#23262d', bootColor: '#e9ebee', gloveColor: '#141619' };
    for (const m of this.mats) m.dispose();
    const jersey = new Color(R.jerseyColor), pants = new Color(R.pantsColor), boot = new Color(R.bootColor), glove = new Color(R.gloveColor);
    // Accent panels contrast with the main colour (dark on light gear, light on dark gear).
    const contrast = (c: Color, other: Color) => (Math.abs(lum(c) - lum(other)) > 0.18 ? other.clone() : lum(c) > 0.45 ? new Color(0x1b1d22) : new Color(0xeef0f2));
    const colors: Record<Region, Color> = {
      jersey, jerseyAcc: contrast(jersey, pants), pants, pantsAcc: contrast(pants, jersey), boot,
      buckle: new Color(0x9aa0a8), sole: new Color(0x1a1b1e), glove, gloveAcc: jersey.clone(), guard: new Color(0x2a2d33),
      brace: new Color(0x1d1f23), skin: new Color(0xc08a68),
    };
    const col = this.data.geometry.getAttribute('color') as BufferAttribute;
    const base = new Float32Array(this.data.regions.length * 3);
    for (let v = 0; v < this.data.regions.length; v++) {
      const c = colors[REGIONS[this.data.regions[v]]];
      base[v * 3] = c.r;
      base[v * 3 + 1] = c.g;
      base[v * 3 + 2] = c.b;
    }
    // Soften seams between gear pieces (vertex regions make a stair-stepped edge otherwise).
    (col.array as Float32Array).set(smoothColors(base, this.data.geometry, 1));
    col.needsUpdate = true;
    const fabric = new MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
    const plastic = new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.05, clearcoat: 0.4, clearcoatRoughness: 0.3 });
    this.body.material = [fabric, plastic];

    if (this.style !== R.helmet) {
      this.style = R.helmet;
      this.helmet.geometry = buildHelmet(R.helmet).geometry;
    }
    const H = buildHelmet(R.helmet);
    const shellC = new Color(R.helmetColor), acc = new Color(R.helmetAccent);
    const hc: Record<HRegion, Color> = { shell: shellC, accent: acc, lens: new Color(0x1a2230), frame: acc.clone().multiplyScalar(0.6), strap: new Color(0x16171a), trim: new Color(0x16171a) };
    const hcol = H.geometry.getAttribute('color') as BufferAttribute;
    for (let v = 0; v < H.regions.length; v++) {
      const c = hc[HREGIONS[H.regions[v]]];
      hcol.setXYZ(v, c.r, c.g, c.b);
    }
    hcol.needsUpdate = true;
    const shell = new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.08, clearcoat: 1, clearcoatRoughness: 0.06 });
    const lens = new MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.04, metalness: 0.85, clearcoat: 1, iridescence: 0.6, iridescenceIOR: 1.6 });
    const soft = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    this.helmet.material = [shell, lens, soft];
    this.mats = [fabric, plastic, shell, lens, soft];
    this.girth = 0.86 + ((R.weight ?? 75) - 50) / 65 * 0.32;
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    this.mats = [];
  }

  /** Apply joint positions (rider-root space) to the skeleton and helmet. */
  private apply() {
    boneFrames(this.j, this.frames, this.lens);
    for (let i = 0; i < BONES.length; i++) {
      const b = this.bones[i];
      // Keep segment lengths honest (crash poses differ from the rest pose) and give heavier
      // riders more girth on the torso and legs.
      const stretch = i === B.head ? 1 : Math.max(0.7, Math.min(1.4, this.lens[i] / (this.data.restLen[i] || 1)));
      const g = i <= B.chest ? this.girth : i === B.thighL || i === B.thighR ? Math.pow(this.girth, 0.7) : i === B.uarmL || i === B.uarmR ? Math.pow(this.girth, 0.5) : 1;
      b.matrixWorld.copy(this.frames[i]).multiply(this.tmpS.makeScale(g, stretch, g));
    }
    this.helmet.matrix.copy(this.frames[B.head]);
    this.helmet.matrixWorldNeedsUpdate = true;
  }

  /**
   * Pose in the bike's chassis frame, then transform into world via `chassisWorld`.
   * hip/grips/pegs are chassis-local.
   */
  pose(spec: VehicleSpec, chassisWorld: Matrix4, gripL: Vector3, gripR: Vector3, shift: number, lat: number, speed: number, lean = 0) {
    const G = spec.geo;
    const j = this.j;
    const crouch = Math.min(1, Math.abs(speed) / 18);
    // Hanging off: in a lean the rider slides the hips and drops the shoulders to the inside
    // (bike +x is its left, and a positive lean is to the right).
    const hang = Math.max(-1, Math.min(1, lean / 0.8)) * Math.min(1, Math.abs(speed) / 6);
    j.hip.set(G.riderHip.x + lat * 0.07 - hang * 0.075, G.riderHip.y + 0.03 + shift * -0.03 - Math.abs(hang) * 0.02, G.riderHip.z - 0.06 + shift * 0.12);
    // Torso leans toward the bars, more when crouched/shifted forward; sits up in a wheelie.
    const pitch = 0.62 + crouch * 0.18 + shift * 0.4;
    const roll = lat * 0.25 - hang * 0.32;
    j.neck.set(Math.sin(roll) * LIMB.torso + j.hip.x, j.hip.y + Math.cos(pitch) * LIMB.torso, j.hip.z + Math.sin(pitch) * LIMB.torso);
    spineMid(j);
    j.head.copy(j.neck).add(this.v.set(0, 0.135, 0.07));
    // Eyes up the trail: the head pitches back against the torso lean.
    j.headRot.setFromEuler(this.e.set(-(pitch - 0.5) * 0.4, 0, roll * 0.5));
    const grips = [gripL, gripR];
    // Shoulders turn with the bars: the outside shoulder follows its grip forward.
    const twist = (gripL.z - gripR.z) * 0.5;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      j.sh[i].copy(j.neck).add(this.v.set(s * 0.19, -0.07, -0.02 + s * twist * 0.7));
      j.wr[i].copy(grips[i]);
      twoBoneIK(j.sh[i], j.wr[i], LIMB.uarm, LIMB.farm, armHint(s, _h), j.el[i]);
      j.hipS[i].copy(j.hip).add(this.v.set(s * 0.105, 0, 0));
      j.an[i].set(s * (G.peg.x + 0.05), G.peg.y + 0.08, G.peg.z - 0.02);
      twoBoneIK(j.hipS[i], j.an[i], LIMB.thigh, LIMB.shin, legHint(s, _h), j.kn[i]);
      j.toe[i].copy(j.an[i]).add(this.v.set(0, -0.03, 0.16));
    }
    this.apply();
    this.root.matrix.copy(chassisWorld);
    this.root.matrixWorldNeedsUpdate = true;
  }

  /** Tucked tumble pose for crashes, placed at the ragdoll point. */
  tumble(pos: Vector3, rot: Quaternion) {
    const j = this.j;
    j.hip.set(0, -0.1, 0);
    j.neck.set(0, 0.36, 0.16);
    spineMid(j);
    j.head.set(0, 0.5, 0.26);
    j.headRot.setFromEuler(this.e.set(0.3, 0, 0));
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      j.sh[i].copy(j.neck).add(this.v.set(s * 0.19, -0.07, -0.02));
      j.wr[i].set(s * 0.22, 0.28, 0.5);
      twoBoneIK(j.sh[i], j.wr[i], LIMB.uarm, LIMB.farm, armHint(s, _h), j.el[i]);
      j.hipS[i].set(s * 0.105, -0.1, 0);
      j.an[i].set(s * 0.16, -0.3, 0.42);
      twoBoneIK(j.hipS[i], j.an[i], LIMB.thigh, LIMB.shin, legHint(s, _h), j.kn[i]);
      j.toe[i].copy(j.an[i]).add(this.v.set(0, -0.05, 0.15));
    }
    this.apply();
    this.root.matrix.compose(pos, rot, this.v.set(1, 1, 1));
    this.root.matrixWorldNeedsUpdate = true;
  }
}

/** For tests: mesh sizes of the cached rider body and a helmet. */
export function riderMeshStats() {
  const b = (cachedBody ??= buildBody());
  return { bodyVerts: b.regions.length, bodyTris: (b.geometry.index?.count ?? 0) / 3, helmetTris: (buildHelmet('mx').geometry.index?.count ?? 0) / 3 };
}
