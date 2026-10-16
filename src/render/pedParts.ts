/**
 * Sculpted body parts for pedestrians close to the camera (the near level of detail).
 *
 * Same sizes, origins and orientation conventions as the simple parts in pedestrians.ts, so
 * the same animation drives either set; these add the shapes that make a figure read as a
 * person up close: a ribcage, chest and shoulder line, hips and seat, a head with jaw, nose,
 * ears and eye sockets, muscle shape on the limbs, mitten hands and proper shoes.
 * Built once with the SDF mesher at a coarse resolution (a few thousand triangles per person).
 */
import { BufferAttribute, BufferGeometry } from 'three';
import { ellipsoid, meshSDF, roundBox, roundCone, smin, ssub } from './sdfMesh';
import type { SDF } from './sdfMesh';

const sph = (x: number, y: number, z: number, cx: number, cy: number, cz: number, r: number) => Math.hypot(x - cx, y - cy, z - cz) - r;
const ell = (x: number, y: number, z: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number) => ellipsoid(x - cx, y - cy, z - cz, rx, ry, rz);

function geo(sdf: SDF, min: [number, number, number], max: [number, number, number], h: number) {
  const m = meshSDF(sdf, min, max, h);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new BufferAttribute(m.normals, 3));
  g.setIndex(new BufferAttribute(m.indices, 1));
  return g;
}

/** Tapered limb along Y, centred: radius r0 at -y (a), r1 at +y (b), plus a muscle bulge. */
function limb(len: number, r0: number, r1: number, bulge: [number, number, number, number, number, number], h: number) {
  const y0 = -len / 2 + r0 * 0.6, y1 = len / 2 - r1 * 0.6;
  const [by, bz, rx, ry, rz, k] = bulge;
  const sdf: SDF = (x, y, z) => smin(roundCone(x, y, z, 0, y0, 0, 0, y1, 0, r0, r1), ell(x, y, z, 0, by, bz, rx, ry, rz), k);
  const R = Math.max(r0, r1) + 0.03;
  return geo(sdf, [-R, -len / 2 - 0.03, -R], [R, len / 2 + 0.03, R], h);
}

let cache: Record<string, BufferGeometry> | null = null;

/** Lengths must match the simple parts (L in pedestrians.ts). */
export function pedHiParts(L: { uarm: number; farm: number; thigh: number; shin: number }) {
  if (cache) return cache;
  // Torso: origin at the waist, up to the base of the neck (y 0..0.55), shirt-clad.
  const torso = geo((x, y, z) => {
    let d = ell(x, y, z, 0, 0.15, 0, 0.138, 0.17, 0.098);
    d = smin(d, ell(x, y, z, 0, 0.34, 0.004, 0.168, 0.16, 0.112), 0.07);
    d = smin(d, ell(x, y, z, 0.068, 0.355, 0.055, 0.07, 0.055, 0.05), 0.03);
    d = smin(d, ell(x, y, z, -0.068, 0.355, 0.055, 0.07, 0.055, 0.05), 0.03);
    d = smin(d, roundCone(x, y, z, -0.14, 0.462, -0.012, 0.14, 0.462, -0.012, 0.058, 0.058), 0.06);
    d = smin(d, sph(x, y, z, 0.172, 0.44, 0, 0.058), 0.05);
    d = smin(d, sph(x, y, z, -0.172, 0.44, 0, 0.058), 0.05);
    return Math.max(d, -0.01 - y);
  }, [-0.25, -0.04, -0.16], [0.25, 0.56, 0.17], 0.02);
  // Hips and seat (centred, like the capsule they replace).
  const pelvis = geo((x, y, z) => {
    let d = ell(x, y, z, 0, 0.005, 0, 0.152, 0.11, 0.1);
    d = smin(d, sph(x, y, z, 0.065, -0.02, -0.045, 0.075), 0.05);
    d = smin(d, sph(x, y, z, -0.065, -0.02, -0.045, 0.075), 0.05);
    return d;
  }, [-0.2, -0.15, -0.16], [0.2, 0.15, 0.14], 0.02);
  // Head: cranium, jaw and chin, nose, ears, brow ridge and eye sockets (the eyes are a
  // separate dark part that sits in the sockets).
  const head = geo((x, y, z) => {
    let d = ell(x, y, z, 0, 0.01, -0.005, 0.1, 0.118, 0.11);
    d = smin(d, ell(x, y, z, 0, -0.055, 0.032, 0.074, 0.062, 0.076), 0.04);
    d = smin(d, ell(x, y, z, 0, -0.09, 0.07, 0.034, 0.024, 0.03), 0.03);
    d = smin(d, roundCone(x, y, z, 0, 0.012, 0.1, 0, -0.026, 0.125, 0.014, 0.012), 0.015);
    d = smin(d, ell(x, y, z, 0.1, -0.005, -0.008, 0.014, 0.03, 0.022), 0.012);
    d = smin(d, ell(x, y, z, -0.1, -0.005, -0.008, 0.014, 0.03, 0.022), 0.012);
    d = smin(d, ell(x, y, z, 0, 0.04, 0.085, 0.07, 0.016, 0.022), 0.02);
    d = ssub(d, sph(x, y, z, 0.038, 0.014, 0.112, 0.021), 0.012);
    d = ssub(d, sph(x, y, z, -0.038, 0.014, 0.112, 0.021), 0.012);
    return d;
  }, [-0.14, -0.15, -0.15], [0.14, 0.15, 0.16], 0.0115);
  const hand = geo((x, y, z) => {
    let d = ell(x, y, z, 0, 0.005, 0, 0.026, 0.055, 0.044);
    d = smin(d, ell(x, y, z, 0.022, 0.012, 0.022, 0.014, 0.03, 0.014), 0.012);
    return d;
  }, [-0.06, -0.08, -0.07], [0.06, 0.08, 0.07], 0.01);
  const shoe = geo((x, y, z) => {
    let d = roundBox(x, y + 0.02, z, 0.046, 0.016, 0.136, 0.013);
    d = smin(d, ell(x, y, z, 0, 0.01, -0.03, 0.044, 0.042, 0.095), 0.03);
    d = smin(d, ell(x, y, z, 0, -0.002, 0.075, 0.042, 0.028, 0.065), 0.03);
    return d;
  }, [-0.07, -0.06, -0.17], [0.07, 0.07, 0.17], 0.012);
  cache = {
    torso, pelvis, head, hand, shoe,
    uarm: limb(L.uarm, 0.058, 0.045, [-0.02, 0.018, 0.05, 0.09, 0.048, 0.03], 0.019),
    farm: limb(L.farm, 0.047, 0.034, [-0.055, 0, 0.048, 0.08, 0.043, 0.03], 0.019),
    thigh: limb(L.thigh, 0.088, 0.06, [-0.04, 0.022, 0.08, 0.15, 0.072, 0.04], 0.019),
    shin: limb(L.shin, 0.062, 0.04, [-0.07, -0.028, 0.056, 0.11, 0.054, 0.04], 0.019),
  };
  return cache;
}
