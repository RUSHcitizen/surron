/**
 * Lightweight pedestrians: instanced body parts, waypoint loops on sidewalks, simple
 * steering that sidesteps an approaching bike. AI runs at 15 Hz; animation every frame.
 * Contact is non-graphic: the pedestrian hops back, sits for a moment and gets up.
 */
import { BoxGeometry, Color, CylinderGeometry, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3 } from 'three';
import type { P2 } from './layout';
import { mulberry32 } from '../core/noise';

interface Ped {
  path: P2[];
  seg: number;
  t: number;
  speed: number;
  x: number;
  z: number;
  y: number;
  heading: number;
  lateral: number;
  targetLat: number;
  phase: number;
  state: 'walk' | 'dodge' | 'startled' | 'sit';
  timer: number;
  color: Color;
  pause: number;
}

const _m = new Matrix4(), _q = new Quaternion(), _p = new Vector3(), _s = new Vector3(1, 1, 1), _e = new Vector3(0, 1, 0);

export class Pedestrians {
  root = new Group();
  peds: Ped[] = [];
  private body: InstancedMesh;
  private head: InstancedMesh;
  private legs: InstancedMesh;
  private arms: InstancedMesh;
  private aiTimer = 0;
  bumped = 0;

  constructor(paths: P2[][], count: number, private groundAt: (x: number, z: number) => number) {
    const r = mulberry32(42);
    const shirt = [0xd7263d, 0x1e88e5, 0x2ec4b6, 0xffc914, 0x8e44ad, 0xe8e8ea, 0x3a3f48, 0xff6b1a];
    for (let i = 0; i < count && paths.length; i++) {
      const path = paths[i % paths.length];
      const seg = Math.floor(r() * path.length);
      const dir = r() < 0.5;
      const p = dir ? path : [...path].reverse();
      this.peds.push({
        path: p, seg, t: r(), speed: 1.1 + r() * 0.5, x: p[seg].x, z: p[seg].z, y: 0, heading: 0, lateral: 0, targetLat: (r() - 0.5) * 1.2,
        phase: r() * 6, state: 'walk', timer: 0, color: new Color(shirt[Math.floor(r() * shirt.length)]), pause: 0,
      });
    }
    const n = Math.max(1, this.peds.length);
    const skin = new MeshStandardMaterial({ color: 0xc89878, roughness: 0.8 });
    const cloth = new MeshStandardMaterial({ roughness: 0.85 });
    const pants = new MeshStandardMaterial({ color: 0x2d3340, roughness: 0.9 });
    this.body = new InstancedMesh(new CylinderGeometry(0.17, 0.15, 0.62, 8), cloth, n);
    this.head = new InstancedMesh(new SphereGeometry(0.12, 10, 8), skin, n);
    this.legs = new InstancedMesh(new BoxGeometry(0.12, 0.8, 0.14), pants, n * 2);
    this.arms = new InstancedMesh(new BoxGeometry(0.08, 0.58, 0.09), cloth, n * 2);
    this.peds.forEach((p, i) => {
      this.body.setColorAt(i, p.color);
      this.arms.setColorAt(i * 2, p.color);
      this.arms.setColorAt(i * 2 + 1, p.color);
    });
    for (const m of [this.body, this.head, this.legs, this.arms]) {
      m.castShadow = true;
      m.frustumCulled = false;
      this.root.add(m);
    }
    this.root.visible = this.peds.length > 0;
  }

  /** bike: position + velocity. Returns true if a pedestrian was bumped this frame. */
  update(dt: number, bx: number, bz: number, bvx: number, bvz: number, time: number): boolean {
    let bumped = false;
    this.aiTimer -= dt;
    const think = this.aiTimer <= 0;
    if (think) this.aiTimer = 1 / 15;
    const bs = Math.hypot(bvx, bvz);
    for (const p of this.peds) {
      const dx = p.x - bx, dz = p.z - bz;
      const d2 = dx * dx + dz * dz;
      if (think && p.state !== 'sit') {
        if (d2 < 1.0 && bs > 1.5) {
          // Contact: hop back and sit down (non-graphic), then get up.
          p.state = 'sit';
          p.timer = 2.2;
          const d = Math.sqrt(d2) || 1;
          p.x += (dx / d) * 0.8;
          p.z += (dz / d) * 0.8;
          bumped = true;
        } else if (d2 < 100 && bs > 2.5) {
          // Is the bike coming toward me?
          const approach = (dx * bvx + dz * bvz) / (Math.sqrt(d2) * bs + 1e-6);
          if (approach > 0.4) {
            // Step to the side away from the bike's path.
            const side = Math.sign(dx * -bvz + dz * bvx) || 1;
            p.targetLat = side * 2.2;
            p.state = d2 < 25 ? 'startled' : 'dodge';
            p.timer = 1.5;
          }
        }
      }
      if (p.state === 'sit') {
        p.timer -= dt;
        if (p.timer <= 0) { p.state = 'walk'; p.targetLat = 0; }
      } else {
        if (p.timer > 0) p.timer -= dt;
        else if (p.state !== 'walk') { p.state = 'walk'; p.targetLat *= 0.3; }
        p.lateral += (p.targetLat - p.lateral) * Math.min(1, (p.state === 'startled' ? 5 : 2) * dt);
        const a = p.path[p.seg], b = p.path[(p.seg + 1) % p.path.length];
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const sp = p.state === 'startled' ? 0.3 : p.state === 'dodge' ? p.speed * 1.3 : p.speed;
        if (p.pause > 0) p.pause -= dt;
        else p.t += (sp * dt) / len;
        if (p.t >= 1) {
          p.t = 0;
          p.seg = (p.seg + 1) % p.path.length;
          if (Math.random() < 0.15) p.pause = 1 + Math.random() * 3;
        }
        const tx = (b.x - a.x) / len, tz = (b.z - a.z) / len;
        p.heading = Math.atan2(tx, tz);
        // Lateral offset is toward the inside of the block (left of travel) or out.
        p.x = a.x + (b.x - a.x) * p.t + -tz * p.lateral;
        p.z = a.z + (b.z - a.z) * p.t + tx * p.lateral;
        p.phase += dt * sp * 5.5;
      }
      p.y = this.groundAt(p.x, p.z);
    }
    this.render(time);
    if (bumped) this.bumped++;
    return bumped;
  }

  private render(time: number) {
    this.peds.forEach((p, i) => {
      const sit = p.state === 'sit';
      const walking = !sit && p.pause <= 0;
      const swing = walking ? Math.sin(p.phase) * 0.5 : 0;
      _q.setFromAxisAngle(_e, p.heading + (p.state === 'startled' ? Math.sin(time * 20) * 0.1 : 0));
      const baseY = p.y + (sit ? -0.45 : 0);
      _m.compose(_p.set(p.x, baseY + 1.15, p.z), _q, _s);
      this.body.setMatrixAt(i, _m);
      _m.compose(_p.set(p.x, baseY + 1.6, p.z), _q, _s);
      this.head.setMatrixAt(i, _m);
      const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
      const rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
      for (let k = 0; k < 2; k++) {
        const s = k ? 1 : -1;
        const legQ = new Quaternion().setFromAxisAngle(new Vector3(rx, 0, rz), sit ? -1.4 : swing * s);
        legQ.multiply(_q);
        const off = sit ? 0.3 : 0;
        _m.compose(_p.set(p.x + rx * s * 0.09 + fx * off, baseY + (sit ? 0.5 : 0.42), p.z + rz * s * 0.09 + fz * off), legQ, _s);
        this.legs.setMatrixAt(i * 2 + k, _m);
        const armQ = new Quaternion().setFromAxisAngle(new Vector3(rx, 0, rz), p.state === 'startled' ? -2.6 : -swing * s * 0.8);
        armQ.multiply(_q);
        _m.compose(_p.set(p.x + rx * s * 0.23, baseY + 1.2, p.z + rz * s * 0.23), armQ, _s);
        this.arms.setMatrixAt(i * 2 + k, _m);
      }
    });
    for (const m of [this.body, this.head, this.legs, this.arms]) m.instanceMatrix.needsUpdate = true;
  }

  setCount(n: number) {
    this.body.count = this.head.count = Math.min(n, this.peds.length);
    this.legs.count = this.arms.count = Math.min(n, this.peds.length) * 2;
  }
}
