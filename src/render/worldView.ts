/**
 * World renderer. Draw-call budget: terrain is chunked (frustum culled), static boxes are
 * merged per material, vegetation/props are instanced.
 */
import {
  AdditiveBlending, BackSide, BoxGeometry, BufferAttribute, CanvasTexture, CircleGeometry, UniformsLib, UniformsUtils, Vector2, CapsuleGeometry, DoubleSide, MeshPhysicalMaterial, Shape, ShapeGeometry, TorusGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry,
  Euler, Float32BufferAttribute, Group, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, OctahedronGeometry, PlaneGeometry, Quaternion, Scene, ShaderMaterial, SphereGeometry, Vector3,
} from 'three';
import type { Material } from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WorldBox, WorldData } from '../world/layout';
import { SURFACE_INDEX } from '../world/collision';
import { corrugatedTexture, facadeSet, groundDetail, leafTexture, showroomTexture, signTexture } from './textures';
import type { FacadeStyle } from './textures';
import { fbm, mulberry32 } from '../core/noise';

const SURF_COLOR: Record<string, [number, number, number]> = {
  asphalt: [0.25, 0.25, 0.255],
  concrete: [0.47, 0.47, 0.45],
  dirt: [0.5, 0.36, 0.23],
  grass: [0.3, 0.44, 0.17],
  sand: [0.8, 0.7, 0.5],
  gravel: [0.5, 0.48, 0.44],
};

/** Per-surface detail weights (asphalt, concrete, loose, grass) for the terrain shader splat. */
const SURF_SPLAT: Record<string, [number, number, number, number]> = {
  asphalt: [1, 0, 0, 0], concrete: [0, 1, 0, 0], dirt: [0, 0, 1, 0], sand: [0, 0, 0.6, 0], gravel: [0, 0, 0.8, 0], grass: [0, 0, 0, 1],
};

/** GLSL value noise shared by the terrain and grass shaders. */
export const NOISE_GLSL = `
float vhash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(vhash(i), vhash(i+vec2(1,0)), u.x), mix(vhash(i+vec2(0,1)), vhash(i+vec2(1,1)), u.x), u.y); }
`;

/**
 * Terrain material: vertex colours carry the surface tint; a 4-way splat weight attribute
 * blends procedural detail per surface (asphalt aggregate + patches, concrete slab joints,
 * loose ground clods, grass streaks), fading high frequencies with distance to avoid shimmer.
 */
/** Shared uniforms for drifting cloud shadows on the ground (offset in metres, strength 0..1). */
export const CLOUD_SHADOW = { offset: { value: new Vector2() }, amount: { value: 0.2 } };

function terrainMaterial(map: CanvasTexture) {
  const m = new MeshStandardMaterial({ vertexColors: true, map, roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.cloudOffset = CLOUD_SHADOW.offset;
    sh.uniforms.cloudAmount = CLOUD_SHADOW.amount;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat; varying vec4 vSplat; varying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat; vWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vSplat; varying vec3 vWPos; uniform vec2 cloudOffset; uniform float cloudAmount;' + NOISE_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 p = vWPos.xz;
          float dist = length(vWPos - cameraPosition);
          float near = 1.0 - smoothstep(25.0, 90.0, dist);
          float big = vnoise(p * 0.035) * 0.6 + vnoise(p * 0.11) * 0.4;
          float mid = vnoise(p * 0.6);
          // The finest detail only matters close to the camera; skip it far away.
          float fine = near > 0.0 ? vnoise(p * 3.1) : 0.5;
          // Asphalt: worn tone, darker repair patches with crisp edges, sealed tar-snake
          // cracks, oil blotches and light aggregate speckle.
          float asp = 0.84 + big * 0.26 + (fine - 0.5) * 0.14 * near;
          vec2 pc = floor(p / 7.0), pf = fract(p / 7.0);
          float patchy = step(0.86, vhash(pc + 17.0)) * step(0.12, min(pf.x, pf.y)) * step(min(pf.x, pf.y), 0.88) * step(max(pf.x, pf.y), 0.88);
          asp *= 1.0 - patchy * 0.16;
          // Thin, broken-up sealed cracks (only in some stretches, fading with distance).
          float tar = 1.0 - abs(vnoise(p * 0.3 + vec2(3.7, 1.3)) * 2.0 - 1.0);
          asp *= 1.0 - smoothstep(0.985, 0.997, tar) * 0.22 * near * smoothstep(0.62, 0.75, vnoise(p * 0.07 + 5.0));
          asp *= 1.0 - smoothstep(0.7, 0.9, vnoise(p * 0.5 + 9.0)) * 0.18;
          // Concrete: 4 m slabs with dark joints and per-slab tone.
          vec2 cell = floor(p / 4.0); vec2 f = fract(p / 4.0);
          float joint = smoothstep(0.0, 0.012, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
          float con = (0.9 + vhash(cell) * 0.14 + (mid - 0.5) * 0.08) * mix(0.62, 1.0, mix(1.0, joint, near));
          // Loose ground: clods and ruts.
          float lo = 0.78 + big * 0.3 + (mid - 0.5) * 0.25 + (fine - 0.5) * 0.18 * near;
          // Grass: patchy tone and streaks.
          float gr = 0.8 + big * 0.35 + (vnoise(vec2(p.x * 0.9, p.y * 2.7)) - 0.5) * 0.25 * near;
          float w = max(vSplat.x + vSplat.y + vSplat.z + vSplat.w, 1e-3);
          float k = (vSplat.x * asp + vSplat.y * con + vSplat.z * lo + vSplat.w * gr) / w;
          diffuseColor.rgb *= mix(1.0, k, min(1.0, w));
          // Dry/lush hue variation on grass.
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.15, 1.02, 0.75), vSplat.w * smoothstep(0.45, 0.75, big) * 0.6);
          // Soft cloud shadows drifting across the land.
          vec2 cp = (p + cloudOffset) * 0.0045;
          float cs = smoothstep(0.5, 0.78, vnoise(cp) * 0.65 + vnoise(cp * 2.7 + 3.1) * 0.35);
          diffuseColor.rgb *= 1.0 - cs * cloudAmount;
        }`)
      // Surface relief near the camera: asphalt aggregate, concrete slab joints, clods in loose
      // ground. Procedural height turned into a normal perturbation (no textures to download).
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 p = vWPos.xz;
          float nb = 1.0 - smoothstep(10.0, 40.0, length(vWPos - cameraPosition));
          float w = max(vSplat.x + vSplat.y + vSplat.z + vSplat.w, 1e-3);
          float fineN = vnoise(p * 11.0);
          float midN = vnoise(p * 2.3);
          vec2 f = fract(p / 4.0);
          float jd = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
          float hA = fineN;
          float hC = smoothstep(0.0, 0.02, jd) * 1.4 + fineN * 0.15;
          float hL = midN * 1.6 + fineN * 0.5;
          float h = (vSplat.x * hA * 0.5 + vSplat.y * hC + vSplat.z * hL * 1.5 + vSplat.w * hL * 0.5) / w;
          h *= nb * 0.012;
          vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
          float dhx = dFdx(h), dhy = dFdy(h);
          vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          normal = normalize(abs(det) * normal - grad);
        }`);
  };
  return m;
}

/**
 * Foliage: leaf clumps from noise in the canopy's own space (light tips, dark gaps between
 * clumps) and a matching bump, faded out with distance so it never shimmers.
 */
function foliage<T extends MeshStandardMaterial>(m: T): T {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLeaf; varying float vLeafDist;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 leafOff = vec3(0.0);
        #ifdef USE_INSTANCING
          leafOff = instanceMatrix[3].xyz * 0.37;
        #endif
        vLeaf = position * 2.6 + leafOff;
        vLeafDist = length((modelMatrix * vec4(position, 1.0)).xyz + leafOff / 0.37 - cameraPosition);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLeaf; varying float vLeafDist;' + NOISE_GLSL + `
        float leafN(vec3 p) { return vnoise(p.xz * 2.1 + p.y * 1.3) * 0.55 + vnoise(p.xy * 2.7 - p.z) * 0.45; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float ln = leafN(vLeaf);
        float lf = 1.0 - smoothstep(35.0, 110.0, vLeafDist);
        diffuseColor.rgb *= mix(1.0, 0.62 + ln * 0.66, 0.35 + 0.65 * lf);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.1, 0.72), smoothstep(0.62, 0.85, ln) * 0.5);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float h = ln * 0.05 * lf;
          vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
          float dhx = dFdx(h), dhy = dFdy(h);
          vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          normal = normalize(abs(det) * normal - sign(det) * (dhx * r1 + dhy * r2));
        }`);
  };
  return m;
}

function boxGeometry(b: WorldBox, uvScale: number, facade?: { su: number; sv: number; ground: number }) {
  const g = new BoxGeometry(b.sx, b.sy, b.sz);
  if (facade) {
    // Walls tile one window bay × one floor; roofs/floors sample the plain corner of the texture.
    const uv = g.getAttribute('uv') as BufferAttribute;
    const dims: [number, number][] = [[b.sz, b.sy], [b.sz, b.sy], [0, 0], [0, 0], [b.sx, b.sy], [b.sx, b.sy]];
    for (let f = 0; f < 6; f++) {
      for (let i = 0; i < 4; i++) {
        const k = f * 4 + i;
        if (f === 2 || f === 3) uv.setXY(k, 0.015, 0.985);
        else uv.setXY(k, uv.getX(k) * Math.max(1, Math.round(dims[f][0] * facade.su)), uv.getY(k) * Math.max(1, Math.round(dims[f][1] * facade.sv)));
      }
    }
  } else if (uvScale > 0) {
    const uv = g.getAttribute('uv') as BufferAttribute;
    // Face order: +x, -x, +y, -y, +z, -z (4 verts each)
    const dims: [number, number][] = [[b.sz, b.sy], [b.sz, b.sy], [b.sx, b.sz], [b.sx, b.sz], [b.sx, b.sy], [b.sx, b.sy]];
    for (let f = 0; f < 6; f++) {
      for (let i = 0; i < 4; i++) {
        const k = f * 4 + i;
        uv.setXY(k, uv.getX(k) * dims[f][0] * uvScale, uv.getY(k) * dims[f][1] * uvScale);
      }
    }
  }
  const m = new Matrix4().makeRotationFromEuler(new Euler(b.pitch ?? 0, b.yaw ?? 0, b.roll ?? 0, 'YXZ'));
  m.setPosition(b.x, b.y, b.z);
  g.applyMatrix4(m);
  const c = new Color(b.color ?? 0x9a9a94);
  const n = g.getAttribute('position').count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // Roofs slightly darker for buildings
    const shade = b.kind === 'building' && b.style !== 'awning' && g.getAttribute('normal').getY(i) > 0.9 ? 0.55 : 1;
    cols[i * 3] = c.r * shade;
    cols[i * 3 + 1] = c.g * shade;
    cols[i * 3 + 2] = c.b * shade;
  }
  g.setAttribute('color', new Float32BufferAttribute(cols, 3));
  // Façades: ground height under the box, for contact shading and grime near street level.
  if (facade) g.setAttribute('aGround', new Float32BufferAttribute(new Float32Array(n).fill(facade.ground), 1));
  return g;
}

/**
 * Weathering for façades: contact shading where walls meet the street, grime that thickens
 * toward the ground, faint rain streaks and a per-building tone shift, so walls stop looking
 * freshly printed. All procedural, applied before lighting.
 */
function weathered<T extends MeshStandardMaterial>(m: T): T {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGround; varying vec3 vWallPos; varying float vAbove;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWallPos = (modelMatrix * vec4(position, 1.0)).xyz; vAbove = vWallPos.y - aGround;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWallPos; varying float vAbove;' + NOISE_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float h = max(vAbove, 0.0);
          // Contact shading: walls darken into the pavement (strongest in the first metre).
          float ao = mix(0.52, 1.0, smoothstep(0.0, 2.6, h)) * mix(0.85, 1.0, smoothstep(0.0, 0.35, h));
          // Splash-back grime and soot near street level.
          float grime = (1.0 - smoothstep(0.3, 4.5, h)) * (0.6 + 0.4 * vnoise(vWallPos.xz * 0.9 + vWallPos.y * 0.7));
          // Rain streaks: long vertical streaks hanging from ledges.
          float along = vWallPos.x + vWallPos.z;
          float streak = smoothstep(0.55, 0.9, vnoise(vec2(along * 1.7, vWallPos.y * 0.06))) * smoothstep(0.3, 0.8, vnoise(vec2(along * 0.25, vWallPos.y * 0.2 + 4.0)));
          // Per-building tone shift (big, slow noise) so neighbours do not match exactly.
          float tone = 0.93 + 0.14 * vnoise(vWallPos.xz * 0.013 + 2.0);
          diffuseColor.rgb *= ao * tone * (1.0 - grime * 0.22) * (1.0 - streak * 0.12);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.92, 0.88, 0.8), grime * 0.5);
        }`);
  };
  return m;
}

/** Displace a sphere-like geometry with smooth noise (organic, not faceted). */
function lumpGeometry(r: number, detail: number, amount: number, seed: number) {
  const ico = new IcosahedronGeometry(r, detail);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  // Weld the polyhedron's duplicated vertices so normals are smooth, not faceted.
  const g = mergeVertices(ico);
  ico.dispose();
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = fbm(x * 1.7 + seed, z * 1.7 + y * 1.3 - seed, 3);
    const k = 1 + n * amount;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Vertex colours: darker toward the bottom/inside, lighter on top (fake canopy AO). */
function shadeVertical(g: BufferGeometry, base: Color, top: Color, y0: number, y1: number) {
  const p = g.getAttribute('position');
  const cols = new Float32Array(p.count * 3);
  const c = new Color();
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0)));
    c.copy(base).lerp(top, t * t);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(cols, 3));
  return g;
}

/**
 * A spruce: six overlapping tiers whose skirts sag and whose outline breaks into branch tips
 * (a star of drooping boughs per tier, each tier turned), so the silhouette reads as a tree
 * rather than stacked cones. Origin at the trunk top.
 */
function pineGeometry() {
  const parts: BufferGeometry[] = [];
  const tiers = 6;
  for (let k = 0; k < tiers; k++) {
    const f = k / (tiers - 1);
    const r = 2.05 - f * 1.45, h = 1.75 - f * 0.55, y = 0.55 + f * 3.15;
    const c = new ConeGeometry(r, h, 14, 2);
    const p = c.getAttribute('position');
    const turn = k * 0.9;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), yy = p.getY(i);
      const a = Math.atan2(z, x) + turn;
      const rim = (h / 2 - yy) / h; // 0 at the tip, 1 at the skirt
      // Branch tips: a spiky outline at the skirt, soft toward the tip.
      const tips = 1 + (Math.pow(Math.abs(Math.sin(a * 3.5)), 3) * 0.32 - 0.1) * rim + Math.sin(a * 11 + k) * 0.04 * rim;
      // Boughs droop: the skirt hangs lower, more at the branch tips.
      const droop = rim * rim * (0.32 + 0.25 * Math.abs(Math.sin(a * 3.5)));
      p.setXYZ(i, x * tips, yy - droop, z * tips);
    }
    c.translate(0, y, 0);
    c.computeVertexNormals();
    parts.push(c.toNonIndexed());
  }
  const g = mergeGeometries(parts.map((x) => { x.deleteAttribute('uv'); return x; }), false)!;
  parts.forEach((x) => x.dispose());
  return withTrunk(shadeVertical(g, new Color(0x16301c), new Color(0x46784a), -0.4, 4.6), 1.9);
}

/** Add a trunk (origin moves to the ground) so a whole tree is one instanced draw. */
function withTrunk(canopy: BufferGeometry, lift: number) {
  canopy.translate(0, lift, 0);
  const trunk = new CylinderGeometry(0.13, 0.24, lift + 0.6, 8, 1, true);
  trunk.translate(0, (lift + 0.6) / 2, 0);
  trunk.deleteAttribute('uv');
  const t = shadeVertical(trunk.index ? trunk.toNonIndexed() : trunk, new Color(0x3e2c20), new Color(0x5a4030), 0, lift);
  const c = canopy.index ? canopy.toNonIndexed() : canopy;
  const g = mergeGeometries([c, t], false)!;
  return g;
}

/** Leaf clumps of the broadleaf crown: x, y, z, radius (y from the trunk top). */
const BROAD_BLOBS: [number, number, number, number][] = [
  [0, 1.7, 0, 1.25], [1.35, 1.25, 0.35, 0.95], [-1.25, 1.35, -0.25, 1.0], [0.3, 1.2, 1.3, 0.9], [-0.35, 1.3, -1.3, 0.95],
  [0.85, 2.45, -0.5, 0.85], [-0.75, 2.5, 0.6, 0.85], [0.1, 3.1, 0.1, 0.75], [1.5, 2.0, 1.0, 0.65], [-1.55, 2.1, -1.0, 0.6],
];
const BROAD_LIFT = 3.3;

/**
 * Broadleaf core: the clumps as shrunken, darker noisy blobs. They give the crown volume and
 * a solid silhouette at a distance; the leaf cards (broadleafCards) make up the visible
 * surface up close. Origin at the ground, trunk included.
 */
function broadleafGeometry() {
  const parts = BROAD_BLOBS.map(([x, y, z, r], i) => {
    const g = lumpGeometry(r * 0.6, 1, 0.3, i * 3.7);
    g.translate(x, y, z);
    return g;
  });
  const g = mergeGeometries(parts, false)!;
  parts.forEach((x) => x.dispose());
  return withTrunk(shadeVertical(g, new Color(0x1f3814), new Color(0x557a2c), -0.2, 3.6), BROAD_LIFT);
}

/**
 * Broadleaf leaf cards: alpha-tested quads of leaves scattered over each clump, facing
 * roughly outward. Normals point away from the crown centre (with an upward bias) so the
 * crown shades as one soft volume instead of a pile of flat cards.
 */
function broadleafCards() {
  const rnd = mulberry32(4242);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [];
  const centre = new Vector3(0, 1.9, 0);
  const q = new Quaternion(), e = new Euler(), v = new Vector3(), n = new Vector3(), d = new Vector3();
  const dark = new Color(0x3d6324), light = new Color(0xa6c96a), c = new Color();
  const corners = [[-0.5, -0.5, 0, 0], [0.5, -0.5, 1, 0], [0.5, 0.5, 1, 1], [-0.5, 0.5, 0, 1]];
  for (const [bx, by, bz, r] of BROAD_BLOBS) {
    const count = Math.round(r * 13);
    for (let i = 0; i < count; i++) {
      // A point on the clump surface (upper half favoured: crowns are fuller on top).
      d.set(rnd() * 2 - 1, rnd() * 1.6 - 0.6, rnd() * 2 - 1).normalize();
      const p = new Vector3(bx, by, bz).addScaledVector(d, r * (0.55 + rnd() * 0.4));
      const size = r * (1.3 + rnd() * 0.6);
      e.set((rnd() - 0.5) * Math.PI, Math.atan2(d.x, d.z) + (rnd() - 0.5) * 1.2, (rnd() - 0.5) * Math.PI);
      q.setFromEuler(e);
      n.copy(p).sub(centre).normalize().add(new Vector3(0, 0.6, 0)).normalize();
      const t = Math.min(1, Math.max(0, (p.y + 0.2) / 3.6));
      c.copy(dark).lerp(light, t * 0.8 + rnd() * 0.25);
      const quad = corners.map(([x, y, u, w]) => {
        v.set(x * size, y * size, 0).applyQuaternion(q).add(p);
        return [v.x, v.y + BROAD_LIFT, v.z, u, w];
      });
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const [x, y, z, u, w] = quad[k];
        pos.push(x, y, z);
        nor.push(n.x, n.y, n.z);
        uv.push(u, w);
        col.push(c.r, c.g, c.b);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

export interface Quality {
  shadows: boolean;
  shadowSize: number;
  trees: number;
  pixelRatio: number;
  drawDistance: number;
}

export class WorldView {
  root = new Group();
  private materials: Material[] = [];
  private coneMesh!: InstancedMesh;
  private coneState: { x: number; z: number; y: number; vx: number; vz: number; tip: number; tipV: number; axis: Vector3; down: boolean }[] = [];
  private coreMesh!: InstancedMesh;
  private coreVisible: boolean[] = [];
  private windowMats: MeshStandardMaterial[] = [];
  private lampMat!: MeshStandardMaterial;
  sky!: Mesh;
  private skyMat!: ShaderMaterial;

  constructor(public data: WorldData, quality: Quality) {
    this.buildTerrain();
    this.buildBoxes();
    this.buildMarkings();
    this.buildProps(quality);
    this.buildLabels();
    this.buildDecor();
    this.buildSky();
    this.buildWater();
    this.buildLightPools();
  }

  private mat<T extends Material>(m: T) {
    this.materials.push(m);
    return m;
  }

  private buildTerrain() {
    const hf = this.data.terrain;
    const detail = groundDetail();
    const mat = this.mat(terrainMaterial(detail));
    // Ambient occlusion baked into the vertex colours: soft dark patches under trees and rocks.
    const ao = new Float32Array(hf.n * hf.n).fill(1);
    const occlude = (x: number, z: number, r: number, k: number) => {
      const i0 = Math.max(0, Math.floor((x - r - hf.x0) / hf.cell)), i1 = Math.min(hf.n - 1, Math.ceil((x + r - hf.x0) / hf.cell));
      const j0 = Math.max(0, Math.floor((z - r - hf.z0) / hf.cell)), j1 = Math.min(hf.n - 1, Math.ceil((z + r - hf.z0) / hf.cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(hf.x0 + i * hf.cell - x, hf.z0 + j * hf.cell - z);
        if (d < r) ao[hf.index(i, j)] *= 1 - k * (1 - d / r) * (1 - d / r);
      }
    };
    for (const t of this.data.trees) occlude(t.x, t.z, 4.2 * t.s, t.kind === 0 ? 0.45 : 0.5);
    for (const r of this.data.rocks) occlude(r.x, r.z, 1.6 * r.s + 0.6, 0.35);
    const CH = 64;
    const cells = hf.n - 1;
    for (let cz = 0; cz < cells; cz += CH) {
      for (let cx = 0; cx < cells; cx += CH) {
        const nx = Math.min(CH, cells - cx), nz = Math.min(CH, cells - cz);
        const vx = nx + 1, vz = nz + 1;
        const pos = new Float32Array(vx * vz * 3);
        const col = new Float32Array(vx * vz * 3);
        const uv = new Float32Array(vx * vz * 2);
        const spl = new Float32Array(vx * vz * 4);
        for (let j = 0; j < vz; j++) {
          for (let i = 0; i < vx; i++) {
            const ix = cx + i, iz = cz + j;
            const k = j * vx + i;
            const x = hf.x0 + ix * hf.cell, z = hf.z0 + iz * hf.cell;
            const h = hf.heights[hf.index(ix, iz)];
            pos[k * 3] = x;
            pos[k * 3 + 1] = h;
            pos[k * 3 + 2] = z;
            const s = SURFACE_INDEX[hf.surfaces[hf.index(ix, iz)]];
            const c = SURF_COLOR[s] ?? SURF_COLOR.grass;
            spl.set(SURF_SPLAT[s] ?? SURF_SPLAT.grass, k * 4);
            const n = fbm(x / 18, z / 18, 2) * 0.12;
            const n2 = s === 'grass' ? fbm(x / 60 + 5, z / 60, 2) * 0.12 : 0;
            const occ = ao[hf.index(ix, iz)];
            col[k * 3] = Math.max(0, c[0] * (1 + n) + n2 * 0.4) * occ;
            col[k * 3 + 1] = Math.max(0, c[1] * (1 + n) + n2) * occ;
            col[k * 3 + 2] = Math.max(0, c[2] * (1 + n)) * occ;
            uv[k * 2] = x / 6;
            uv[k * 2 + 1] = z / 6;
          }
        }
        const idx: number[] = [];
        for (let j = 0; j < nz; j++) {
          for (let i = 0; i < nx; i++) {
            const a = j * vx + i, b = a + 1, c = a + vx, d = c + 1;
            // Matches Heightfield.heightAt triangle split (a,b,c) and (b,d,c)
            idx.push(a, c, b, b, c, d);
          }
        }
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(pos, 3));
        g.setAttribute('color', new BufferAttribute(col, 3));
        g.setAttribute('uv', new BufferAttribute(uv, 2));
        g.setAttribute('splat', new BufferAttribute(spl, 4));
        g.setIndex(idx);
        g.computeVertexNormals();
        g.computeBoundingSphere();
        const m = new Mesh(g, mat);
        m.receiveShadow = true;
        this.root.add(m);
        this.terrainChunks.push(m);
      }
    }
  }
  private terrainChunks: Mesh[] = [];

  private buildBoxes() {
    const groups = new Map<string, BufferGeometry[]>();
    const push = (k: string, g: BufferGeometry) => {
      let l = groups.get(k);
      if (!l) groups.set(k, (l = []));
      l.push(g);
    };
    const FACADES = ['brick', 'office', 'apartment', 'stucco'];
    for (const b of [...this.data.boxes, ...this.data.decor.vboxes]) {
      if (b.kind === 'invisible') continue;
      const ground = this.data.terrain.heightAt(b.x, b.z);
      if (b.style === 'shop') push('f-shop', boxGeometry(b, 0, { su: 1 / 6, sv: 1 / 4.2, ground }));
      else if (b.style === 'trim' || b.style === 'awning' || b.style === 'metal') push(b.style, boxGeometry(b, 0));
      else if (b.kind === 'building') push('f-' + (FACADES.includes(b.style ?? '') ? b.style : 'apartment'), boxGeometry(b, 0, { su: 1 / 3, sv: 1 / 3.5, ground }));
      else if (b.kind === 'sidewalk') push('concrete', boxGeometry(b, 1 / 6));
      else if (b.kind === 'warehouse' || b.kind === 'container') push('corr', boxGeometry(b, 1 / 2));
      else if (b.kind === 'ramp' || b.kind === 'support' || b.kind === 'pallet') push('wood', boxGeometry(b, 1 / 4));
      else push('painted', boxGeometry(b, 0));
    }
    const facadeMat = (st: FacadeStyle) => {
      const f = facadeSet(st);
      const m = this.mat(weathered(new MeshStandardMaterial({ vertexColors: true, map: f.map, normalMap: f.normal, roughnessMap: f.orm, metalnessMap: f.orm, roughness: 1, metalness: 1, emissiveMap: f.emissive, emissive: 0x000000 })));
      this.windowMats.push(m);
      return m;
    };
    const mats: Record<string, MeshStandardMaterial> = {
      'f-brick': facadeMat('brick'), 'f-office': facadeMat('office'), 'f-apartment': facadeMat('apartment'), 'f-stucco': facadeMat('stucco'), 'f-shop': facadeMat('shop'),
      trim: this.mat(new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })),
      awning: this.mat(new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })),
      corr: this.mat(new MeshStandardMaterial({ vertexColors: true, map: corrugatedTexture(), roughness: 0.55, metalness: 0.35 })),
      metal: this.mat(new MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.7 })),
      concrete: this.mat(new MeshStandardMaterial({ vertexColors: true, color: 0xcfcfca, map: groundDetail(), roughness: 0.95 })),
      wood: this.mat(new MeshStandardMaterial({ vertexColors: true, map: groundDetail(), roughness: 0.9 })),
      painted: this.mat(new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 })),
    };
    for (const [k, list] of groups) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const m = new Mesh(merged, mats[k]);
      m.castShadow = k !== 'concrete' && k !== 'f-shop';
      m.receiveShadow = true;
      this.root.add(m);
    }
    // Showroom glazing: reflective glass in front of a softly lit interior.
    const interior = new Mesh(new PlaneGeometry(22, 5.8), this.mat(new MeshStandardMaterial({ color: 0x1b2129, emissive: 0xffffff, emissiveIntensity: 0.55, emissiveMap: showroomTexture(), map: showroomTexture() })));
    interior.position.set(20, 2.9, 37.965);
    interior.rotation.y = Math.PI;
    const glass = new Mesh(new PlaneGeometry(22, 5.8), this.mat(new MeshPhysicalMaterial({ color: 0x6f8494, metalness: 0.1, roughness: 0.03, transparent: true, opacity: 0.2, clearcoat: 1, envMapIntensity: 1.2, depthWrite: false })));
    glass.position.set(20, 2.9, 37.9);
    glass.rotation.y = Math.PI;
    // Canopy downlights.
    const strip = new Mesh(new PlaneGeometry(22, 0.25), this.mat(new MeshBasicMaterial({ color: 0xfff4e0 })));
    strip.position.set(20, 5.88, 35.2);
    strip.rotation.x = Math.PI / 2;
    this.root.add(interior, glass, strip);
  }

  private buildMarkings() {
    const list: BufferGeometry[] = [];
    const hf = this.data.terrain;
    for (const mk of this.data.markings) {
      const g = new PlaneGeometry(mk.w, mk.l);
      g.rotateX(-Math.PI / 2);
      g.rotateY(mk.yaw);
      const y = hf.heightAt(mk.x, mk.z) + (mk.y ?? 0.02);
      g.translate(mk.x, y, mk.z);
      const c = new Color(mk.color);
      const n = g.getAttribute('position').count;
      const cols = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
      g.setAttribute('color', new Float32BufferAttribute(cols, 3));
      g.deleteAttribute('uv');
      list.push(g);
    }
    const merged = mergeGeometries(list, false);
    list.forEach((g) => g.dispose());
    if (merged) {
      const m = new Mesh(merged, this.mat(new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
      m.receiveShadow = true;
      this.root.add(m);
    }
  }

  private buildProps(q: Quality) {
    const hf = this.data.terrain;
    const m4 = new Matrix4();
    const quat = new Quaternion();
    const scl = new Vector3();
    const pos = new Vector3();
    // Trees
    const trees = this.data.trees.slice(0, q.trees);
    const pines = trees.filter((t) => t.kind === 0), broad = trees.filter((t) => t.kind === 1);
    const pineM = this.mat(foliage(new MeshStandardMaterial({ vertexColors: true, roughness: 0.82 })));
    const leafM = this.mat(foliage(new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })));
    // Instanced props are split into spatial chunks so frustum culling (main and shadow
    // cameras) and distance culling skip whatever is off-screen or far away.
    const CHUNK = 220;
    const mkInst = (geo: BufferGeometry, mat: Material, all: { x: number; z: number; s: number }[], y: number, sy = 1, shadow = true, tint = false) => {
      const cells = new Map<string, typeof all>();
      for (const t of all) {
        const k = `${Math.floor(t.x / CHUNK)},${Math.floor(t.z / CHUNK)}`;
        let l = cells.get(k);
        if (!l) cells.set(k, (l = []));
        l.push(t);
      }
      for (const items of cells.values()) this.chunks.push(mkOne(geo, mat, items, y, sy, shadow, tint));
    };
    const mkOne = (geo: BufferGeometry, mat: Material, items: { x: number; z: number; s: number }[], y: number, sy: number, shadow: boolean, tint: boolean) => {
      const im = new InstancedMesh(geo, mat, Math.max(1, items.length));
      items.forEach((t, i) => {
        pos.set(t.x, hf.heightAt(t.x, t.z) + y * t.s, t.z);
        quat.setFromAxisAngle(new Vector3(0, 1, 0), (t.x * 13.1 + t.z * 7.7) % 6.28);
        scl.set(t.s, t.s * sy, t.s);
        m4.compose(pos, quat, scl);
        im.setMatrixAt(i, m4);
      });
      im.count = items.length;
      if (tint) {
        items.forEach((t, i) => {
          const h = Math.abs(Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453) % 1;
          im.setColorAt(i, new Color().setHSL(0, 0, 0.82 + h * 0.3));
        });
      }
      im.castShadow = shadow;
      im.receiveShadow = false;
      im.computeBoundingSphere();
      this.root.add(im);
      return im;
    };
    mkInst(pineGeometry(), pineM, pines, 0, 1, true, true);
    mkInst(broadleafGeometry(), leafM, broad, 0, 1, true, true);
    // Leaf cards over the broadleaf cores (same placement, so the instances line up).
    const cardM = this.mat(new MeshStandardMaterial({
      vertexColors: true, map: leafTexture(), alphaTest: 0.5, alphaToCoverage: true, side: DoubleSide, roughness: 0.78,
    }));
    mkInst(broadleafCards(), cardM, broad, 0, 1, true, true);
    // Rocks
    const rockM = this.mat(new MeshStandardMaterial({ color: 0x8a847b, roughness: 0.92 }));
    mkInst(lumpGeometry(0.8, 1, 0.28, 3), rockM, this.data.rocks, 0.2, 0.65);
    // Street lights
    const poleM = this.mat(new MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.5, metalness: 0.6 }));
    this.lampMat = this.mat(new MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe2a8, emissiveIntensity: 0.2 }));
    const L = this.data.lights;
    const pole = new InstancedMesh(new CylinderGeometry(0.08, 0.12, 6, 6), poleM, L.length);
    const arm = new InstancedMesh(new BoxGeometry(0.1, 0.1, 1.6), poleM, L.length);
    const lamp = new InstancedMesh(new BoxGeometry(0.35, 0.12, 0.6), this.lampMat, L.length);
    L.forEach((l, i) => {
      const g = hf.heightAt(l.x, l.z) + 0.15;
      quat.setFromAxisAngle(new Vector3(0, 1, 0), l.yaw);
      m4.compose(pos.set(l.x, g + 3, l.z), quat, scl.set(1, 1, 1));
      pole.setMatrixAt(i, m4);
      const dx = Math.sin(l.yaw) * 0.8, dz = Math.cos(l.yaw) * 0.8;
      m4.compose(pos.set(l.x + dx, g + 6, l.z + dz), quat, scl);
      arm.setMatrixAt(i, m4);
      m4.compose(pos.set(l.x + dx * 2, g + 5.92, l.z + dz * 2), quat, scl);
      lamp.setMatrixAt(i, m4);
    });
    for (const im of [pole, arm, lamp]) {
      im.castShadow = true;
      im.computeBoundingSphere();
      this.root.add(im);
    }
    // Cones (knockable)
    const coneM = this.mat(new MeshStandardMaterial({ color: 0xff6a13, roughness: 0.6 }));
    const coneGeo = new ConeGeometry(0.2, 0.55, 10);
    coneGeo.translate(0, 0.275, 0);
    this.coneMesh = new InstancedMesh(coneGeo, coneM, this.data.cones.length);
    this.coneState = this.data.cones.map((c) => ({ x: c.x, z: c.z, y: hf.heightAt(c.x, c.z), vx: 0, vz: 0, tip: 0, tipV: 0, axis: new Vector3(1, 0, 0), down: false }));
    this.coneMesh.castShadow = true;
    this.root.add(this.coneMesh);
    this.updateCones(0);
    // Collectible charge cores
    const coreM = this.mat(new MeshStandardMaterial({ color: 0x9ff7ff, emissive: 0x18e0ff, emissiveIntensity: 1.6, roughness: 0.2, metalness: 0.3 }));
    this.coreMesh = new InstancedMesh(new OctahedronGeometry(0.45, 0), coreM, this.data.collectibles.length);
    this.coreVisible = this.data.collectibles.map(() => true);
    this.root.add(this.coreMesh);
  }

  /** Feather flags, tyre stacks, EV chargers and planter bushes. */
  private buildDecor() {
    const D = this.data.decor;
    const hf = this.data.terrain;
    const m4 = new Matrix4(), q = new Quaternion(), p = new Vector3(), sc = new Vector3(1, 1, 1), up = new Vector3(0, 1, 0);
    const col = new Color();
    // Feather flags: a pole and a tall curved sail, coloured per instance.
    const poleM = this.mat(new MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.4, metalness: 0.7 }));
    const sailM = this.mat(new MeshStandardMaterial({ roughness: 0.75, side: DoubleSide }));
    const pole = new InstancedMesh(new CylinderGeometry(0.03, 0.04, 4.2, 8), poleM, D.flags.length);
    const sailShape = new Shape();
    sailShape.moveTo(0, 1.0);
    sailShape.quadraticCurveTo(0.95, 4.3, 0.15, 4.1);
    sailShape.lineTo(0.0, 4.1);
    sailShape.lineTo(0, 1.0);
    const sailGeo = new ShapeGeometry(sailShape, 10);
    // Gentle billow.
    const sp = sailGeo.getAttribute('position');
    for (let i = 0; i < sp.count; i++) sp.setZ(i, Math.sin(sp.getX(i) * 3) * 0.12);
    sailGeo.computeVertexNormals();
    const sail = new InstancedMesh(sailGeo, sailM, D.flags.length);
    D.flags.forEach((f, i) => {
      const g = hf.heightAt(f.x, f.z);
      q.setFromAxisAngle(up, f.yaw + 0.6);
      m4.compose(p.set(f.x, g + 2.1, f.z), q, sc);
      pole.setMatrixAt(i, m4);
      m4.compose(p.set(f.x, g, f.z), q, sc);
      sail.setMatrixAt(i, m4);
      sail.setColorAt(i, col.set(f.color));
    });
    // Tyre stacks: three tyres, the top one painted.
    const tireM = this.mat(new MeshStandardMaterial({ roughness: 0.85 }));
    const tireGeo = new TorusGeometry(0.3, 0.13, 10, 20);
    tireGeo.rotateX(Math.PI / 2);
    const tires = new InstancedMesh(tireGeo, tireM, D.tires.length * 3);
    D.tires.forEach((t, i) => {
      const g = hf.heightAt(t.x, t.z);
      for (let k = 0; k < 3; k++) {
        q.setFromAxisAngle(up, i * 1.3 + k);
        m4.compose(p.set(t.x + (k === 1 ? 0.04 : 0), g + 0.13 + k * 0.25, t.z), q, sc);
        tires.setMatrixAt(i * 3 + k, m4);
        tires.setColorAt(i * 3 + k, col.set(k === 2 ? t.color : 0x1b1c1f));
      }
    });
    // Bushes in planters.
    const bushM = this.mat(foliage(new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })));
    const bushes = new InstancedMesh(shadeVertical(lumpGeometry(1, 2, 0.25, 9), new Color(0x27451a), new Color(0x6f9a3c), -0.8, 1), bushM, D.bushes.length);
    D.bushes.forEach((b, i) => {
      m4.compose(p.set(b.x, hf.heightAt(b.x, b.z) + 0.6 + b.s * 0.5, b.z), q.identity(), sc.setScalar(b.s * 2.2));
      bushes.setMatrixAt(i, m4);
    });
    sc.set(1, 1, 1);
    const tankM = this.mat(new MeshStandardMaterial({ color: 0x8a6a4e, roughness: 0.85 }));
    const tankG = new CylinderGeometry(1.3, 1.3, 2.6, 16);
    tankG.translate(0, 2.6, 0);
    const roofG = new ConeGeometry(1.4, 0.8, 16);
    roofG.translate(0, 4.3, 0);
    const legG = new CylinderGeometry(0.08, 0.08, 1.3, 6);
    legG.translate(0, 0.65, 0);
    const tankParts = [mergeGeometries([tankG, roofG].map((x) => { x.deleteAttribute('uv'); return x; }), false)!, legG];
    const tanks = new InstancedMesh(tankParts[0], tankM, Math.max(1, D.tanks.length));
    const legs = new InstancedMesh(legG, poleM, Math.max(1, D.tanks.length * 4));
    D.tanks.forEach((t, i) => {
      m4.compose(p.set(t.x, t.y, t.z), q.identity(), sc);
      tanks.setMatrixAt(i, m4);
      for (let k = 0; k < 4; k++) {
        m4.compose(p.set(t.x + (k % 2 ? 0.9 : -0.9), t.y, t.z + (k > 1 ? 0.9 : -0.9)), q, sc);
        legs.setMatrixAt(i * 4 + k, m4);
      }
    });
    tanks.count = D.tanks.length;
    legs.count = D.tanks.length * 4;
    for (const im of [pole, sail, tires, bushes, tanks, legs]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.root.add(im);
    }
    // EV chargers: a rounded pillar, glowing screen and a lime accent band.
    const pillarM = this.mat(new MeshPhysicalMaterial({ color: 0xeef1f4, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }));
    const screenM = this.mat(new MeshStandardMaterial({ color: 0x0a1418, emissive: 0x38d9f5, emissiveIntensity: 0.9 }));
    const bandM = this.mat(new MeshStandardMaterial({ color: 0xc6f432, emissive: 0xc6f432, emissiveIntensity: 0.35 }));
    const pillarG = new CapsuleGeometry(0.28, 1.2, 6, 16);
    pillarG.scale(1, 1, 0.65);
    for (const c of D.chargers) {
      const g = new Group();
      const pil = new Mesh(pillarG, pillarM);
      pil.position.y = 0.9;
      pil.castShadow = true;
      const scr = new Mesh(new PlaneGeometry(0.32, 0.42), screenM);
      scr.position.set(0, 1.25, 0.19);
      const band = new Mesh(new CylinderGeometry(0.29, 0.29, 0.06, 20), bandM);
      band.scale.set(1, 1, 0.66);
      band.position.y = 0.55;
      g.add(pil, scr, band);
      g.position.set(c.x, hf.heightAt(c.x, c.z), c.z);
      g.rotation.y = c.yaw;
      this.root.add(g);
    }
  }

  water!: Mesh;
  private waterMat!: ShaderMaterial;
  /** Lake surface: animated ripples, Fresnel sky reflection and sun glints (one draw call). */
  private buildWater() {
    const L = this.data.lake;
    this.waterMat = new ShaderMaterial({
      transparent: true,
      fog: true,
      uniforms: UniformsUtils.merge([UniformsLib.fog, {
        time: { value: 0 },
        sunDir: { value: new Vector3(0.5, 0.7, 0.4).normalize() },
        sunColor: { value: new Color(0xfff2cc) },
        skyTop: { value: new Color(0x2f6fc4) },
        skyHorizon: { value: new Color(0xcfe3f2) },
        deep: { value: new Color(0x0f3a4a) },
        shallow: { value: new Color(0x2f7f7a) },
        center: { value: new Vector2(L.x, L.z) },
        radius: { value: L.r },
      }]),
      vertexShader: `varying vec3 vW;
        #include <fog_pars_vertex>
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform float time; uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 skyTop; uniform vec3 skyHorizon;
        uniform vec3 deep; uniform vec3 shallow; uniform vec2 center; uniform float radius; varying vec3 vW;
        ${NOISE_GLSL}
        #include <fog_pars_fragment>
        float h(vec2 p){ return vnoise(p * 0.35 + vec2(time * 0.25, time * 0.18)) * 0.6 + vnoise(p * 0.9 - vec2(time * 0.4, -time * 0.3)) * 0.4; }
        void main(){
          vec2 p = vW.xz;
          float e = 0.15;
          vec3 n = normalize(vec3(h(p - vec2(e, 0.0)) - h(p + vec2(e, 0.0)), 1.6, h(p - vec2(0.0, e)) - h(p + vec2(0.0, e))));
          vec3 v = normalize(cameraPosition - vW);
          float fres = 0.06 + 0.94 * pow(1.0 - max(dot(n, v), 0.0), 4.0);
          vec3 r = reflect(-v, n);
          vec3 sky = mix(skyHorizon, skyTop, clamp(r.y * 1.8, 0.0, 1.0));
          float shore = smoothstep(radius * 0.55, radius, length(p - center));
          vec3 body = mix(deep, shallow, shore);
          vec3 c = mix(body, sky, fres) + sunColor * pow(max(dot(r, sunDir), 0.0), 220.0) * 2.5;
          gl_FragColor = vec4(c, mix(0.92, 0.7, shore));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.materials.push(this.waterMat);
    const g = new CircleGeometry(L.r + 1.5, 72);
    g.rotateX(-Math.PI / 2);
    this.water = new Mesh(g, this.waterMat);
    this.water.position.set(L.x, L.level, L.z);
    this.water.receiveShadow = false;
    this.root.add(this.water);
  }

  private poolMat!: MeshBasicMaterial;
  /** Warm pools of light under the street lamps (visible at dusk and night). */
  private buildLightPools() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,214,150,0.85)');
    gr.addColorStop(0.45, 'rgba(255,190,120,0.35)');
    gr.addColorStop(1, 'rgba(255,170,100,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    const tex = new CanvasTexture(cv);
    tex.colorSpace = 'srgb';
    this.poolMat = this.mat(new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    const geo = new PlaneGeometry(11, 11);
    geo.rotateX(-Math.PI / 2);
    const L = this.data.lights;
    const im = new InstancedMesh(geo, this.poolMat, Math.max(1, L.length));
    const m4 = new Matrix4(), q = new Quaternion(), p = new Vector3(), sc = new Vector3(1, 1, 1);
    L.forEach((l, i) => {
      const x = l.x + Math.sin(l.yaw) * 1.6, z = l.z + Math.cos(l.yaw) * 1.6;
      m4.compose(p.set(x, this.data.terrain.heightAt(x, z) + 0.2, z), q, sc);
      im.setMatrixAt(i, m4);
    });
    im.computeBoundingSphere();
    im.renderOrder = 2;
    this.root.add(im);
  }

  private buildLabels() {
    for (const l of this.data.labels) {
      const t = signTexture(l.text);
      const m = new Mesh(new PlaneGeometry(4, 1), this.mat(new MeshBasicMaterial({ map: t, transparent: true })));
      const g = this.data.terrain.heightAt(l.x, l.z);
      m.position.set(l.x, Math.max(l.y, g + l.y), l.z);
      m.rotation.y = l.yaw;
      this.root.add(m);
      const back = m.clone();
      back.rotation.y = l.yaw + Math.PI;
      this.root.add(back);
    }
  }

  private buildSky() {
    this.skyMat = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new Color(0x2f6fc4) },
        horizon: { value: new Color(0xcfe3f2) },
        ground: { value: new Color(0x8a9aa6) },
        sunDir: { value: new Vector3(0.4, 0.8, 0.3).normalize() },
        sunColor: { value: new Color(0xfff2cc) },
        cloudColor: { value: new Color(0xffffff) },
        cloudShade: { value: new Color(0x9aa8bb) },
        cover: { value: 0.48 },
        time: { value: 0 },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; uniform vec3 sunColor;
        uniform vec3 cloudColor; uniform vec3 cloudShade; uniform float cover; uniform float time; varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
        float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a*vnoise(p); p = p*2.03 + 7.1; a *= 0.5; } return s; }
        float fbm2(vec2 p){ return vnoise(p) * 0.6 + vnoise(p * 2.03 + 7.1) * 0.3; }
        void main(){
          vec3 d = normalize(vDir); float h = d.y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(max(h, 0.0), 0.55)) : mix(horizon, ground, pow(-h, 0.4));
          float s = max(dot(d, sunDir), 0.0);
          // Clouds on a virtual dome.
          if (h > 0.01) {
            vec2 uv = d.xz / (h + 0.12) * 1.6 + vec2(time * 0.004, time * 0.0015);
            float n = fbm(uv);
            float m = smoothstep(cover, cover + 0.28, n);
            float lit = 0.6 + 0.4 * smoothstep(0.0, 1.0, fbm2(uv + sunDir.xz * 0.15) - n + 0.5);
            vec3 cc = mix(cloudShade, cloudColor, lit) + sunColor * pow(s, 8.0) * 0.35;
            c = mix(c, cc, m * smoothstep(0.01, 0.18, h) * 0.92);
          }
          c += sunColor * (pow(s, 900.0) * 3.0 + pow(s, 24.0) * 0.22 + pow(s, 4.0) * 0.06);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.materials.push(this.skyMat);
    this.sky = new Mesh(new SphereGeometry(900, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -2;
    this.root.add(this.sky);
    // Distant mountain ring (follows the camera like the sky; tinted toward the horizon).
    const N = 160, R0 = 640;
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    for (const [layer, rr, hmax, seed] of [[0, R0 + 120, 150, 11], [1, R0, 95, 3]] as const) {
      const base = pos.length / 3;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const x = Math.cos(a), z = Math.sin(a);
        const n = Math.max(0, fbm(x * 2.2 + seed, z * 2.2 - seed, 4) * 0.5 + 0.45);
        const hgt = 12 + hmax * n * n;
        pos.push(x * rr, -40, z * rr, x * rr, hgt, z * rr);
        // r = layer (0 far, 1 near), g = vertical (0 base, 1 ridge)
        col.push(layer, 0, 0, layer, 1, 0);
        if (i < N) {
          const k = base + i * 2;
          idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
      }
    }
    const mg = new BufferGeometry();
    mg.setAttribute('position', new Float32BufferAttribute(pos, 3));
    mg.setAttribute('color', new Float32BufferAttribute(col, 3));
    mg.setIndex(idx);
    this.mountainMat = new ShaderMaterial({
      fog: false,
      uniforms: { horizon: { value: new Color() }, far: { value: new Color() }, near: { value: new Color() } },
      vertexShader: 'attribute vec3 color; varying vec2 vC; void main(){ vC = color.rg; vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; }',
      fragmentShader: `uniform vec3 horizon; uniform vec3 far; uniform vec3 near; varying vec2 vC;
        void main(){ vec3 m = mix(far, near, vC.x); vec3 c = mix(horizon, m, 0.35 + 0.65 * vC.y); gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
        }`,
    });
    this.materials.push(this.mountainMat);
    this.mountains = new Mesh(mg, this.mountainMat);
    this.mountains.frustumCulled = false;
    this.mountains.renderOrder = -1;
    this.root.add(this.mountains);
  }

  mountains!: Mesh;
  private mountainMat!: ShaderMaterial;

  /** A scene holding just the sky, used to bake image-based lighting (reflections + ambient). */
  envScene() {
    const sc = new Scene();
    const m = new Mesh(new SphereGeometry(100, 32, 16), this.skyMat);
    sc.add(m);
    return { scene: sc, dispose: () => m.geometry.dispose() };
  }

  /** Keep sky and mountains centred on the camera; drift the clouds. */
  private chunks: InstancedMesh[] = [];
  /** Distance beyond which instanced prop chunks are hidden (fog hides them anyway). */
  cullDistance = 520;

  follow(camPos: Vector3, time: number) {
    for (const c of this.chunks) {
      const bs = c.boundingSphere!;
      c.visible = bs.center.distanceTo(camPos) - bs.radius < this.cullDistance;
    }
    for (const c of this.terrainChunks) {
      const bs = c.geometry.boundingSphere!;
      c.visible = bs.center.distanceTo(camPos) - bs.radius < this.cullDistance + 60;
    }
    this.sky.position.copy(camPos);
    this.mountains.position.set(camPos.x, 0, camPos.z);
    this.skyMat.uniforms.time.value = time;
    this.waterMat.uniforms.time.value = time;
    CLOUD_SHADOW.offset.value.set(time * 2.2, time * 0.9);
  }

  setTimeOfDay(mode: 'day' | 'sunset' | 'night', sunDir: Vector3) {
    const u = this.skyMat.uniforms;
    u.sunDir.value.copy(sunDir);
    const mu = this.mountainMat.uniforms;
    if (mode === 'day') {
      u.top.value.set(0x2f6fc4); u.horizon.value.set(0xcfe3f2); u.ground.value.set(0x8a9aa6); u.sunColor.value.set(0xfff2cc);
      u.cloudColor.value.set(0xffffff); u.cloudShade.value.set(0x9fadc0); u.cover.value = 0.5;
      mu.far.value.set(0x8ea6bf); mu.near.value.set(0x5f7a6a);
    } else if (mode === 'sunset') {
      u.top.value.set(0x2b3d78); u.horizon.value.set(0xf2a35e); u.ground.value.set(0x5a4a4a); u.sunColor.value.set(0xffb070);
      u.cloudColor.value.set(0xffc49a); u.cloudShade.value.set(0x6a5a7a); u.cover.value = 0.46;
      mu.far.value.set(0x8a6a86); mu.near.value.set(0x4a3a4a);
    } else {
      u.top.value.set(0x03050b); u.horizon.value.set(0x1a2233); u.ground.value.set(0x07090c); u.sunColor.value.set(0x223355);
      u.cloudColor.value.set(0x2a3448); u.cloudShade.value.set(0x0c1018); u.cover.value = 0.52;
      mu.far.value.set(0x141b29); mu.near.value.set(0x0b0f17);
    }
    mu.horizon.value.copy(u.horizon.value);
    const night = mode === 'night';
    for (const m of this.windowMats) {
      m.emissive.set(night ? 0xffffff : mode === 'sunset' ? 0x553322 : 0x000000);
      m.emissiveIntensity = night ? 0.9 : 0.3;
    }
    this.lampMat.emissiveIntensity = night ? 3 : mode === 'sunset' ? 1 : 0.2;
    this.poolMat.opacity = night ? 1 : mode === 'sunset' ? 0.35 : 0;
    this.poolMat.visible = this.poolMat.opacity > 0;
    CLOUD_SHADOW.amount.value = mode === 'day' ? 0.22 : mode === 'sunset' ? 0.12 : 0;
    const wu = this.waterMat.uniforms;
    wu.sunDir.value.copy(sunDir);
    wu.sunColor.value.copy(u.sunColor.value);
    wu.skyTop.value.copy(u.top.value);
    wu.skyHorizon.value.copy(u.horizon.value);
    wu.deep.value.set(night ? 0x02080c : mode === 'sunset' ? 0x1a2a3a : 0x0f3a4a);
    wu.shallow.value.set(night ? 0x061418 : mode === 'sunset' ? 0x3a4a50 : 0x2f7f7a);
  }

  /** Knock cones the bike touches; returns number newly knocked over. */
  hitCones(x: number, z: number, vx: number, vz: number, r = 0.8): number {
    let n = 0;
    for (const c of this.coneState) {
      const dx = c.x - x, dz = c.z - z;
      if (dx * dx + dz * dz < r * r && Math.hypot(vx, vz) > 0.5) {
        if (!c.down) n++;
        c.down = true;
        c.vx = vx * 0.8 + dx * 2;
        c.vz = vz * 0.8 + dz * 2;
        c.tipV = 6;
        c.axis.set(vz, 0, -vx).normalize();
      }
    }
    return n;
  }

  resetCones() {
    this.coneState.forEach((c, i) => {
      const o = this.data.cones[i];
      c.x = o.x; c.z = o.z; c.y = this.data.terrain.heightAt(o.x, o.z); c.vx = c.vz = c.tip = c.tipV = 0; c.down = false;
    });
    this.updateCones(0);
  }

  get conesDown() {
    return this.coneState.filter((c) => c.down).length;
  }

  updateCones(dt: number) {
    const m4 = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3(1, 1, 1);
    this.coneState.forEach((c, i) => {
      if (dt > 0 && (c.vx || c.vz || c.tipV)) {
        c.x += c.vx * dt;
        c.z += c.vz * dt;
        const f = Math.max(0, 1 - 3 * dt);
        c.vx *= f;
        c.vz *= f;
        c.tip = Math.min(Math.PI / 2, c.tip + c.tipV * dt);
        if (c.tip >= Math.PI / 2) c.tipV = 0;
        if (Math.abs(c.vx) + Math.abs(c.vz) < 0.05) c.vx = c.vz = 0;
        c.y = this.data.terrain.heightAt(c.x, c.z);
      }
      q.setFromAxisAngle(c.axis, c.tip);
      m4.compose(p.set(c.x, c.y + (c.tip > 0 ? 0.15 : 0), c.z), q, s);
      this.coneMesh.setMatrixAt(i, m4);
    });
    this.coneMesh.instanceMatrix.needsUpdate = true;
    this.coneMesh.computeBoundingSphere();
  }

  setCollected(ids: Set<string>) {
    this.data.collectibles.forEach((c, i) => (this.coreVisible[i] = !ids.has(c.id)));
  }

  updateCores(time: number) {
    const m4 = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3();
    this.data.collectibles.forEach((c, i) => {
      q.setFromAxisAngle(new Vector3(0, 1, 0), time * 1.5 + i);
      const vis = this.coreVisible[i];
      s.setScalar(vis ? 1 : 0);
      m4.compose(p.set(c.x, this.data.terrain.heightAt(c.x, c.z) + 1.3 + Math.sin(time * 2 + i) * 0.15, c.z), q, s);
      this.coreMesh.setMatrixAt(i, m4);
    });
    this.coreMesh.instanceMatrix.needsUpdate = true;
    this.coreMesh.computeBoundingSphere();
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.materials.forEach((m) => m.dispose());
  }
}
