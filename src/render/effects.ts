/** Tire marks (ring-buffer ribbon) and particles (smoke, dust, roost) in a single draw call each. */
import {
  BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Mesh, MeshBasicMaterial, NormalBlending,
  Points, ShaderMaterial, Vector3,
} from 'three';
import type { Scene } from 'three';
import { puffTexture } from './textures';

const MAX_MARKS = 1600;

export class TireMarks {
  mesh: Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private head = 0;
  private last: Record<string, { p: Vector3; l: Vector3; r: Vector3; active: boolean }> = {};
  private geo: BufferGeometry;

  constructor(scene: Scene) {
    this.geo = new BufferGeometry();
    this.pos = new Float32Array(MAX_MARKS * 4 * 3);
    this.col = new Float32Array(MAX_MARKS * 4 * 4);
    const idx = new Uint32Array(MAX_MARKS * 6);
    for (let i = 0; i < MAX_MARKS; i++) {
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    }
    const pa = new BufferAttribute(this.pos, 3);
    pa.setUsage(DynamicDrawUsage);
    const ca = new BufferAttribute(this.col, 4);
    ca.setUsage(DynamicDrawUsage);
    this.geo.setAttribute('position', pa);
    this.geo.setAttribute('color', ca);
    this.geo.setIndex(new BufferAttribute(idx, 1));
    this.mesh = new Mesh(this.geo, new MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  /** Lay a mark segment for `key` at contact p with lateral axis `side`. intensity 0 ends the strip. */
  add(key: string, p: Vector3, side: Vector3, width: number, intensity: number, color: [number, number, number]) {
    const prev = this.last[key];
    const hw = width * 0.5;
    const l = p.clone().addScaledVector(side, hw);
    const r = p.clone().addScaledVector(side, -hw);
    l.y += 0.02;
    r.y += 0.02;
    if (intensity <= 0.02) {
      if (prev) prev.active = false;
      return;
    }
    if (prev && prev.active && prev.p.distanceToSquared(p) < 4) {
      if (prev.p.distanceToSquared(p) < 0.04) return;
      const i = this.head;
      this.head = (this.head + 1) % MAX_MARKS;
      const o = i * 12;
      this.pos.set([prev.l.x, prev.l.y, prev.l.z, prev.r.x, prev.r.y, prev.r.z, l.x, l.y, l.z, r.x, r.y, r.z], o);
      const a = Math.min(0.75, intensity);
      for (let k = 0; k < 4; k++) this.col.set([color[0], color[1], color[2], a], i * 16 + k * 4);
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
    this.last[key] = { p: p.clone(), l, r, active: true };
  }

  /** Fade older marks gradually. */
  fade(dt: number) {
    let changed = false;
    for (let i = 3; i < this.col.length; i += 4) {
      if (this.col[i] > 0) {
        this.col[i] = Math.max(0, this.col[i] - dt * 0.012);
        changed = true;
      }
    }
    if (changed) this.geo.attributes.color.needsUpdate = true;
  }

  clear() {
    this.col.fill(0);
    this.geo.attributes.color.needsUpdate = true;
    this.last = {};
  }
}

const MAX_P = 900;

export class Particles {
  points: Points;
  private pos = new Float32Array(MAX_P * 3);
  private vel = new Float32Array(MAX_P * 3);
  private life = new Float32Array(MAX_P);
  private maxLife = new Float32Array(MAX_P);
  private size = new Float32Array(MAX_P);
  private grow = new Float32Array(MAX_P);
  private alpha = new Float32Array(MAX_P);
  private baseAlpha = new Float32Array(MAX_P);
  private col = new Float32Array(MAX_P * 3);
  private drag = new Float32Array(MAX_P);
  private grav = new Float32Array(MAX_P);
  private head = 0;
  budget = 1;

  constructor(scene: Scene) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    g.setAttribute('size', new BufferAttribute(this.size, 1).setUsage(DynamicDrawUsage));
    g.setAttribute('alpha', new BufferAttribute(this.alpha, 1).setUsage(DynamicDrawUsage));
    g.setAttribute('pcolor', new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage));
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      uniforms: { map: { value: puffTexture() }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 pcolor; varying float vA; varying vec3 vC;
        uniform float scale;
        void main(){ vA = alpha; vC = pcolor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying float vA; varying vec3 vC;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); if (t.a * vA < 0.01) discard; gl_FragColor = vec4(vC, t.a * vA); }`,
    });
    this.points = new Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setViewport(height: number) {
    (this.points.material as ShaderMaterial).uniforms.scale.value = height * 0.9;
  }

  emit(p: Vector3, v: Vector3, color: Color | [number, number, number], size: number, life: number, opts: { grow?: number; drag?: number; gravity?: number; alpha?: number } = {}) {
    if (Math.random() > this.budget) return;
    const i = this.head;
    this.head = (this.head + 1) % MAX_P;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.grow[i] = opts.grow ?? 1.5;
    this.drag[i] = opts.drag ?? 1.5;
    this.grav[i] = opts.gravity ?? 0;
    this.baseAlpha[i] = opts.alpha ?? 0.6;
    this.alpha[i] = this.baseAlpha[i];
    const c = Array.isArray(color) ? color : [color.r, color.g, color.b];
    this.col.set(c, i * 3);
  }

  update(dt: number) {
    for (let i = 0; i < MAX_P; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.max(0, Math.min(1, t * 1.6)) * this.baseAlpha[i];
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
    g.attributes.pcolor.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
  }
}
