/**
 * Signed-distance-field modelling for organic shapes (the rider's body and helmet).
 *
 * Shapes are written as a smooth union of a few primitives (tapered capsules, ellipsoids,
 * rounded boxes) and turned into a mesh with naive surface nets: one vertex per grid cell
 * that straddles the surface, quads across every sign-changing grid edge. The result is a
 * single continuous, smooth skin with no seams between body parts, which is what makes the
 * rider read as a person instead of a set of separate spheres and sticks.
 *
 * A coarse pass skips the fine grid wherever the surface is provably far away, so meshing
 * a full rider takes a fraction of a second at load.
 */

export type SDF = (x: number, y: number, z: number) => number;

export interface SurfaceMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/** Polynomial smooth minimum (blend radius k). */
export function smin(a: number, b: number, k: number) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Smooth subtraction: a minus b. */
export function ssub(a: number, b: number, k: number) {
  return -smin(-a, b, k);
}

/** Tapered capsule from a (radius ra) to b (radius rb); exact distance. */
export function roundCone(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb: number) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - ra;
}

/** Axis-aligned ellipsoid (good approximation of the distance near the surface). */
export function ellipsoid(px: number, py: number, pz: number, rx: number, ry: number, rz: number) {
  const ax = px / rx, ay = py / ry, az = pz / rz;
  const bx = ax / rx, by = ay / ry, bz = az / rz;
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

/** Axis-aligned rounded box of half extents (hx, hy, hz) and corner radius r. */
export function roundBox(px: number, py: number, pz: number, hx: number, hy: number, hz: number, r: number) {
  const qx = Math.abs(px) - hx + r, qy = Math.abs(py) - hy + r, qz = Math.abs(pz) - hz + r;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

const CORNERS = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * Mesh the zero level set of `sdf` inside [min, max] with cell size h. Normals come from the
 * field gradient and vertices are projected onto the surface (one Newton step).
 */
export function meshSDF(sdf: SDF, min: [number, number, number], max: [number, number, number], h: number): SurfaceMesh {
  const nx = Math.ceil((max[0] - min[0]) / h) + 1;
  const ny = Math.ceil((max[1] - min[1]) / h) + 1;
  const nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const val = new Float32Array(nx * ny * nz);
  const id = (i: number, j: number, k: number) => i + nx * (j + ny * k);

  // Coarse pass every C cells; fine samples inside coarse cells that cannot contain the surface
  // take the interpolated coarse value (only the sign and rough magnitude matter there).
  const C = 2;
  const cx = Math.ceil((nx - 1) / C) + 1, cy = Math.ceil((ny - 1) / C) + 1, cz = Math.ceil((nz - 1) / C) + 1;
  const coarse = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    coarse[i + cx * (j + cy * k)] = sdf(min[0] + i * C * h, min[1] + j * C * h, min[2] + k * C * h);
  }
  const margin = C * h * 0.95;
  for (let K = 0; K < cz - 1; K++) for (let J = 0; J < cy - 1; J++) for (let I = 0; I < cx - 1; I++) {
    let far = true;
    let c000 = 0, c100 = 0, c010 = 0, c110 = 0, c001 = 0, c101 = 0, c011 = 0, c111 = 0;
    for (let c = 0; c < 8; c++) {
      const [a, b, d] = CORNERS[c];
      const v = coarse[I + a + cx * (J + b + cy * (K + d))];
      if (Math.abs(v) < margin) far = false;
      if (c === 0) c000 = v; else if (c === 1) c100 = v; else if (c === 2) c010 = v; else if (c === 3) c110 = v;
      else if (c === 4) c001 = v; else if (c === 5) c101 = v; else if (c === 6) c011 = v; else c111 = v;
    }
    const sameSign = Math.sign(c000) === Math.sign(c111) && Math.sign(c000) === Math.sign(c100) && Math.sign(c000) === Math.sign(c010) &&
      Math.sign(c000) === Math.sign(c001) && Math.sign(c000) === Math.sign(c110) && Math.sign(c000) === Math.sign(c101) && Math.sign(c000) === Math.sign(c011);
    if (!sameSign) far = false;
    for (let dk = 0; dk <= C; dk++) {
      const k = K * C + dk;
      if (k >= nz) break;
      for (let dj = 0; dj <= C; dj++) {
        const j = J * C + dj;
        if (j >= ny) break;
        for (let di = 0; di <= C; di++) {
          const i = I * C + di;
          if (i >= nx) break;
          if (far) {
            const u = di / C, v = dj / C, w = dk / C;
            const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u, x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
            const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
            val[id(i, j, k)] = y0 + (y1 - y0) * w;
          } else val[id(i, j, k)] = sdf(min[0] + i * h, min[1] + j * h, min[2] + k * h);
        }
      }
    }
  }

  // One vertex per surface cell: the mean of the edge crossings.
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cid = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos: number[] = [];
  const cv = new Float32Array(8);
  const off = CORNERS.map(([a, b, d]) => a + nx * (b + ny * d));
  const E0 = EDGES.map((e) => e[0]), E1 = EDGES.map((e) => e[1]);
  const CX = CORNERS.map((c) => c[0]), CY = CORNERS.map((c) => c[1]), CZ = CORNERS.map((c) => c[2]);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) {
    let base = nx * (j + ny * k);
    for (let i = 0; i < nx - 1; i++, base++) {
      let neg = 0;
      for (let c = 0; c < 8; c++) {
        const v = val[base + off[c]];
        cv[c] = v;
        if (v < 0) neg++;
      }
      if (neg === 0 || neg === 8) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (let e = 0; e < 12; e++) {
        const e0 = E0[e], e1 = E1[e];
        const v0 = cv[e0], v1 = cv[e1];
        if (v0 < 0 === v1 < 0) continue;
        const t = v0 / (v0 - v1);
        sx += CX[e0] + (CX[e1] - CX[e0]) * t;
        sy += CY[e0] + (CY[e1] - CY[e0]) * t;
        sz += CZ[e0] + (CZ[e1] - CZ[e0]) * t;
        n++;
      }
      cellVert[cid(i, j, k)] = pos.length / 3;
      pos.push(min[0] + (i + sx / n) * h, min[1] + (j + sy / n) * h, min[2] + (k + sz / n) * h);
    }
  }

  // Quads across sign-changing edges.
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) [b, d] = [d, b];
    // Split along the shorter diagonal.
    const dac = dist2(pos, a, c), dbd = dist2(pos, b, d);
    if (dac <= dbd) idx.push(a, b, c, a, c, d);
    else idx.push(a, b, d, b, c, d);
  };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p0 = id(i, j, k);
    const in0 = val[p0] < 0;
    // Quick reject: no sign change toward any +axis neighbour.
    if ((i >= nx - 1 || val[p0 + 1] < 0 === in0) && (j >= ny - 1 || val[p0 + nx] < 0 === in0) && (k >= nz - 1 || val[p0 + nx * ny] < 0 === in0)) continue;
    if (i < nx - 1 && j > 0 && k > 0 && j < ny - 1 && k < nz - 1) {
      if (in0 !== val[id(i + 1, j, k)] < 0) quad(cellVert[cid(i, j - 1, k - 1)], cellVert[cid(i, j, k - 1)], cellVert[cid(i, j, k)], cellVert[cid(i, j - 1, k)], !in0);
    }
    if (j < ny - 1 && i > 0 && k > 0 && i < nx - 1 && k < nz - 1) {
      if (in0 !== val[id(i, j + 1, k)] < 0) quad(cellVert[cid(i - 1, j, k - 1)], cellVert[cid(i - 1, j, k)], cellVert[cid(i, j, k)], cellVert[cid(i, j, k - 1)], !in0);
    }
    if (k < nz - 1 && i > 0 && j > 0 && i < nx - 1 && j < ny - 1) {
      if (in0 !== val[id(i, j, k + 1)] < 0) quad(cellVert[cid(i - 1, j - 1, k)], cellVert[cid(i, j - 1, k)], cellVert[cid(i, j, k)], cellVert[cid(i - 1, j, k)], !in0);
    }
  }

  // Gradient normals and projection onto the surface.
  const positions = new Float32Array(pos);
  const normals = new Float32Array(pos.length);
  const e = h * 0.5;
  for (let v = 0; v < positions.length; v += 3) {
    let x = positions[v], y = positions[v + 1], z = positions[v + 2];
    for (let it = 0; it < 2; it++) {
      const d = sdf(x, y, z);
      const gx = sdf(x + e, y, z) - sdf(x - e, y, z);
      const gy = sdf(x, y + e, z) - sdf(x, y - e, z);
      const gz = sdf(x, y, z + e) - sdf(x, y, z - e);
      const gl = Math.hypot(gx, gy, gz) || 1;
      const nxv = gx / gl, nyv = gy / gl, nzv = gz / gl;
      if (it === 0) {
        // Project, but never further than half a cell (keeps thin features intact).
        const s = Math.max(-h * 0.5, Math.min(h * 0.5, d));
        x -= nxv * s;
        y -= nyv * s;
        z -= nzv * s;
      } else {
        normals[v] = nxv;
        normals[v + 1] = nyv;
        normals[v + 2] = nzv;
      }
    }
    positions[v] = x;
    positions[v + 1] = y;
    positions[v + 2] = z;
  }
  // Wind every triangle outward (agreeing with the field gradient).
  const indices = new Uint32Array(idx);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const wx = positions[c] - positions[a], wy = positions[c + 1] - positions[a + 1], wz = positions[c + 2] - positions[a + 2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    const nx2 = normals[a] + normals[b] + normals[c], ny2 = normals[a + 1] + normals[b + 1] + normals[c + 1], nz2 = normals[a + 2] + normals[b + 2] + normals[c + 2];
    if (fx * nx2 + fy * ny2 + fz * nz2 < 0) {
      const tmp = indices[t + 1];
      indices[t + 1] = indices[t + 2];
      indices[t + 2] = tmp;
    }
  }
  return { positions, normals, indices };
}

function dist2(p: number[], a: number, b: number) {
  const dx = p[a * 3] - p[b * 3], dy = p[a * 3 + 1] - p[b * 3 + 1], dz = p[a * 3 + 2] - p[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}
