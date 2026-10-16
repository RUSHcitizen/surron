/**
 * World renderer. Draw-call budget: terrain is chunked (frustum culled), static boxes are
 * merged per material, vegetation/props are instanced.
 */
import {
  BackSide, BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DodecahedronGeometry,
  Euler, Float32BufferAttribute, Group, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, OctahedronGeometry, PlaneGeometry, Quaternion, ShaderMaterial, SphereGeometry, Vector3,
} from 'three';
import type { Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WorldBox, WorldData } from '../world/layout';
import { SURFACE_INDEX } from '../world/collision';
import { facadeEmissive, facadeTexture, groundDetail, signTexture } from './textures';
import { fbm } from '../core/noise';

const SURF_COLOR: Record<string, [number, number, number]> = {
  asphalt: [0.2, 0.21, 0.23],
  concrete: [0.58, 0.58, 0.55],
  dirt: [0.52, 0.39, 0.26],
  grass: [0.33, 0.45, 0.2],
  sand: [0.83, 0.74, 0.53],
  gravel: [0.52, 0.5, 0.46],
};

function boxGeometry(b: WorldBox, uvScale: number) {
  const g = new BoxGeometry(b.sx, b.sy, b.sz);
  if (uvScale > 0) {
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
    const shade = b.kind === 'building' && g.getAttribute('normal').getY(i) > 0.9 ? 0.6 : 1;
    cols[i * 3] = c.r * shade;
    cols[i * 3 + 1] = c.g * shade;
    cols[i * 3 + 2] = c.b * shade;
  }
  g.setAttribute('color', new Float32BufferAttribute(cols, 3));
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
    this.buildSky();
  }

  private mat<T extends Material>(m: T) {
    this.materials.push(m);
    return m;
  }

  private buildTerrain() {
    const hf = this.data.terrain;
    const detail = groundDetail();
    const mat = this.mat(new MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.95, metalness: 0 }));
    const CH = 32;
    const cells = hf.n - 1;
    for (let cz = 0; cz < cells; cz += CH) {
      for (let cx = 0; cx < cells; cx += CH) {
        const nx = Math.min(CH, cells - cx), nz = Math.min(CH, cells - cz);
        const vx = nx + 1, vz = nz + 1;
        const pos = new Float32Array(vx * vz * 3);
        const col = new Float32Array(vx * vz * 3);
        const uv = new Float32Array(vx * vz * 2);
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
            const n = fbm(x / 18, z / 18, 2) * 0.12;
            const n2 = s === 'grass' ? fbm(x / 60 + 5, z / 60, 2) * 0.12 : 0;
            col[k * 3] = Math.max(0, c[0] * (1 + n) + n2 * 0.4);
            col[k * 3 + 1] = Math.max(0, c[1] * (1 + n) + n2);
            col[k * 3 + 2] = Math.max(0, c[2] * (1 + n));
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
        g.setIndex(idx);
        g.computeVertexNormals();
        g.computeBoundingSphere();
        const m = new Mesh(g, mat);
        m.receiveShadow = true;
        this.root.add(m);
      }
    }
  }

  private buildBoxes() {
    const groups = new Map<string, BufferGeometry[]>();
    const push = (k: string, g: BufferGeometry) => {
      let l = groups.get(k);
      if (!l) groups.set(k, (l = []));
      l.push(g);
    };
    for (const b of this.data.boxes) {
      if (b.kind === 'invisible') continue;
      if (b.kind === 'building') push('building', boxGeometry(b, 1 / 16));
      else if (b.kind === 'sidewalk') push('concrete', boxGeometry(b, 1 / 6));
      else if (b.kind === 'ramp' || b.kind === 'support' || b.kind === 'pallet') push('wood', boxGeometry(b, 1 / 4));
      else push('painted', boxGeometry(b, 0));
    }
    const facade = facadeTexture();
    const mats: Record<string, MeshStandardMaterial> = {
      building: this.mat(new MeshStandardMaterial({ vertexColors: true, map: facade, roughness: 0.85, emissiveMap: facadeEmissive(), emissive: 0x000000 })),
      concrete: this.mat(new MeshStandardMaterial({ vertexColors: true, color: 0xcfcfca, map: groundDetail(), roughness: 0.95 })),
      wood: this.mat(new MeshStandardMaterial({ vertexColors: true, map: groundDetail(), roughness: 0.9 })),
      painted: this.mat(new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 })),
    };
    this.windowMats.push(mats.building);
    for (const [k, list] of groups) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const m = new Mesh(merged, mats[k]);
      m.castShadow = k !== 'concrete';
      m.receiveShadow = true;
      this.root.add(m);
    }
    // Garage door + light strip
    const door = new Mesh(new PlaneGeometry(10, 5.5), this.mat(new MeshStandardMaterial({ color: 0x0d1117, emissive: 0x0a3a4a, emissiveIntensity: 0.6 })));
    door.position.set(20, 2.75, 37.95);
    door.rotation.y = Math.PI;
    this.root.add(door);
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
    const trunkM = this.mat(new MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 }));
    const pineM = this.mat(new MeshStandardMaterial({ color: 0x2f5a35, roughness: 0.85, flatShading: true }));
    const leafM = this.mat(new MeshStandardMaterial({ color: 0x4f7a32, roughness: 0.85, flatShading: true }));
    const mkInst = (geo: BufferGeometry, mat: Material, items: { x: number; z: number; s: number }[], y: number, sy = 1, shadow = true) => {
      const im = new InstancedMesh(geo, mat, Math.max(1, items.length));
      items.forEach((t, i) => {
        pos.set(t.x, hf.heightAt(t.x, t.z) + y * t.s, t.z);
        quat.setFromAxisAngle(new Vector3(0, 1, 0), (t.x * 13.1 + t.z * 7.7) % 6.28);
        scl.set(t.s, t.s * sy, t.s);
        m4.compose(pos, quat, scl);
        im.setMatrixAt(i, m4);
      });
      im.count = items.length;
      im.castShadow = shadow;
      im.receiveShadow = false;
      im.computeBoundingSphere();
      this.root.add(im);
      return im;
    };
    mkInst(new CylinderGeometry(0.15, 0.22, 2.4, 6), trunkM, trees, 1.2);
    mkInst(new ConeGeometry(1.7, 5, 7), pineM, pines, 4.6);
    mkInst(new IcosahedronGeometry(2.1, 0), leafM, broad, 3.8);
    // Rocks
    const rockM = this.mat(new MeshStandardMaterial({ color: 0x7c776f, roughness: 0.95, flatShading: true }));
    mkInst(new DodecahedronGeometry(0.8, 0), rockM, this.data.rocks, 0.2, 0.65);
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
        top: { value: new Color(0x3d7cc9) },
        horizon: { value: new Color(0xcfe3f2) },
        ground: { value: new Color(0x8a9aa6) },
        sunDir: { value: new Vector3(0.4, 0.8, 0.3).normalize() },
        sunColor: { value: new Color(0xfff2cc) },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; uniform vec3 sunColor; varying vec3 vDir;
        void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, ground, pow(-h, 0.4));
        float s = max(dot(normalize(vDir), sunDir), 0.0); c += sunColor * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0); }`,
    });
    this.materials.push(this.skyMat);
    this.sky = new Mesh(new SphereGeometry(900, 24, 12), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.root.add(this.sky);
  }

  setTimeOfDay(mode: 'day' | 'sunset' | 'night', sunDir: Vector3) {
    const u = this.skyMat.uniforms;
    u.sunDir.value.copy(sunDir);
    if (mode === 'day') {
      u.top.value.set(0x3d7cc9); u.horizon.value.set(0xcfe3f2); u.ground.value.set(0x8a9aa6); u.sunColor.value.set(0xfff2cc);
    } else if (mode === 'sunset') {
      u.top.value.set(0x2b3d78); u.horizon.value.set(0xf2a35e); u.ground.value.set(0x5a4a4a); u.sunColor.value.set(0xffb070);
    } else {
      u.top.value.set(0x05070d); u.horizon.value.set(0x1a2233); u.ground.value.set(0x07090c); u.sunColor.value.set(0x223355);
    }
    const night = mode === 'night';
    for (const m of this.windowMats) {
      m.emissive.set(night ? 0xffffff : mode === 'sunset' ? 0x553322 : 0x000000);
      m.emissiveIntensity = night ? 0.9 : 0.3;
    }
    this.lampMat.emissiveIntensity = night ? 3 : mode === 'sunset' ? 1 : 0.2;
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
