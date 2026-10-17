/**
 * Pedestrians: smooth, articulated people drawn with one instanced mesh per body part
 * (12 draw calls for the whole crowd). Each person has their own height, build, skin tone,
 * hair and outfit (short/long sleeves, shorts/trousers), and a walk cycle with hip, knee,
 * shoulder and elbow motion. They loop along sidewalks, turn smoothly, and sidestep an
 * approaching bike. AI runs at 15 Hz; animation every frame.
 * Contact is non-graphic: the pedestrian hops back, sits for a moment and gets up.
 */
import {
  CapsuleGeometry, Color, CylinderGeometry, Group, InstancedMesh, LatheGeometry, Matrix4, MeshStandardMaterial, Quaternion,
  SphereGeometry, Vector2, Vector3,
} from 'three';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { P2 } from './layout';
import { mulberry32 } from '../core/noise';
import { pedHiParts } from '../render/pedParts';

interface Look {
  scale: number; // overall height factor
  build: number; // shoulder/hip width factor
  skin: Color;
  hair: Color;
  shirt: Color;
  pants: Color;
  shoes: Color;
  shortSleeves: boolean;
  shorts: boolean;
  longHair: boolean;
  /** Idlers: looking at a phone (one hand up). */
  phone: boolean;
}

/** walk: strolls a loop; jog: runs it; idle: stands (window shopping, on the phone); cheer: spectator. */
export type PedKind = 'walk' | 'jog' | 'idle' | 'cheer';
export interface PedStand { x: number; z: number; yaw: number }

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
  walk: number;
  state: 'walk' | 'dodge' | 'startled' | 'sit';
  timer: number;
  pause: number;
  look: Look;
  kind: PedKind;
  /** Standing spot (idle / cheer). */
  home?: PedStand;
  /** 0..1: how excited a spectator is (bike nearby and fast). */
  excite: number;
}

const SKIN = [0xffdbac, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0x5c3a21];
const HAIR = [0x1c1714, 0x2e2119, 0x4a3324, 0x8a6a3e, 0xc9a66b, 0x8c8c8c, 0x7a3b1d];
const SHIRT = [0xd7263d, 0x1e88e5, 0x2ec4b6, 0xffc914, 0x8e44ad, 0xf0f0f0, 0x3a3f48, 0xff6b1a, 0x6b8e23, 0xe91e63, 0x0d47a1, 0xbca88a];
const PANTS = [0x2b3a55, 0x3b4d6b, 0x1d1f24, 0x555a62, 0x9c8a6a, 0x6b5b45];
const SHOES = [0xf2f2f2, 0x1b1b1d, 0x6d4c33, 0x9aa0a8, 0xc0392b];

// Body proportions (metres, before per-person scale).
const L = { thigh: 0.44, shin: 0.43, uarm: 0.29, farm: 0.27, hipY: 0.93, torso: 0.53, hipW: 0.095, shW: 0.205 };

const _m = new Matrix4(), _q = new Quaternion(), _q2 = new Quaternion(), _p = new Vector3(), _s = new Vector3(), _d = new Vector3();
const _a = new Vector3(), _b = new Vector3(), _up = new Vector3(0, 1, 0), _x = new Vector3(1, 0, 0);

type Part = 'torso' | 'pelvis' | 'neck' | 'head' | 'face' | 'hair' | 'hairBack' | 'uarm' | 'farm' | 'hand' | 'thigh' | 'shin' | 'shoe';
const LIMBS = ['uarm', 'farm', 'hand', 'thigh', 'shin', 'shoe'];
/** Near level of detail: at most this many people, within this distance of the bike (m). */
const NEAR_MAX = 14;
const NEAR_R = 22;
/** People farther than this from the bike are not drawn (the fog hides them anyway), so a
 *  big crowd costs only what is near; drawn people are packed into the first slots. */
const VIS_R = 115;
const _white = new Color(1, 1, 1);

export class Pedestrians {
  root = new Group();
  peds: Ped[] = [];
  private parts = {} as Record<Part, InstancedMesh>;
  /** Near level of detail: sculpted parts for the few people closest to the player. */
  private hi = {} as Record<Part, InstancedMesh>;
  /** The part set being written and the slot of the person being written. */
  private P = this.parts;
  private lodX = Infinity;
  private lodZ = Infinity;
  private aiTimer = 0;
  private active = Infinity;
  /** Which person each simple-part slot was last coloured for (-1 = none). */
  private slotOwner: Int32Array = new Int32Array(0);
  bumped = 0;

  constructor(paths: P2[][], count: number, private groundAt: (x: number, z: number) => number, stands: PedStand[] = [], seed = 42) {
    const r = mulberry32(seed);
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
    for (let i = 0; i < count && paths.length; i++) {
      const path = paths[i % paths.length];
      const seg = Math.floor(r() * path.length);
      const p = r() < 0.5 ? path : [...path].reverse();
      const look: Look = {
        scale: 0.9 + r() * 0.18, build: 0.88 + r() * 0.26, skin: new Color(pick(SKIN)), hair: new Color(pick(HAIR)),
        shirt: new Color(pick(SHIRT)), pants: new Color(pick(PANTS)), shoes: new Color(pick(SHOES)),
        shortSleeves: r() < 0.5, shorts: r() < 0.25, longHair: r() < 0.4, phone: r() < 0.5,
      };
      const kr = r();
      const kind: PedKind = kr < 0.14 ? 'jog' : kr < 0.3 ? 'idle' : 'walk';
      if (kind === 'jog') Object.assign(look, { shorts: true, shortSleeves: true });
      const ped: Ped = {
        path: p, seg, t: r(), speed: kind === 'jog' ? 2.6 + r() * 0.7 : 1.05 + r() * 0.45, x: p[seg].x, z: p[seg].z, y: 0, heading: 0, lateral: 0,
        targetLat: (r() - 0.5) * 1.2, phase: r() * 6, walk: 1, state: 'walk', timer: 0, pause: 0, look, kind, excite: 0,
      };
      if (kind === 'idle') {
        // Stand at the inner edge of the sidewalk (by the shopfronts), facing the building.
        const a = p[seg], b = p[(seg + 1) % p.length];
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const tx = (b.x - a.x) / len, tz = (b.z - a.z) / len;
        const t = 0.15 + r() * 0.7;
        const side = path === p ? 1 : -1; // inside of the loop is on the left when walking the original direction
        ped.home = { x: a.x + (b.x - a.x) * t - tz * 1.3 * side, z: a.z + (b.z - a.z) * t + tx * 1.3 * side, yaw: Math.atan2(-tz * side, tx * side) };
      }
      this.peds.push(ped);
    }
    // Spectators at fixed spots (track side, stunt park).
    for (const st of stands) {
      const look: Look = {
        scale: 0.9 + r() * 0.18, build: 0.88 + r() * 0.26, skin: new Color(pick(SKIN)), hair: new Color(pick(HAIR)),
        shirt: new Color(pick(SHIRT)), pants: new Color(pick(PANTS)), shoes: new Color(pick(SHOES)),
        shortSleeves: r() < 0.6, shorts: r() < 0.3, longHair: r() < 0.4, phone: r() < 0.25,
      };
      this.peds.push({
        path: [{ x: st.x, z: st.z }], seg: 0, t: 0, speed: 0, x: st.x, z: st.z, y: 0, heading: st.yaw, lateral: 0, targetLat: 0,
        phase: r() * 6, walk: 0, state: 'walk', timer: 0, pause: 0, look, kind: 'cheer', home: st, excite: 0,
      });
    }
    const n = Math.max(1, this.peds.length);
    const mat = new MeshStandardMaterial({ roughness: 0.78 });
    const skinMat = new MeshStandardMaterial({ roughness: 0.6 });
    const hairMat = new MeshStandardMaterial({ roughness: 0.55 });
    // Torso: a lathed profile (waist → chest → shoulders), slightly flattened front-to-back.
    const prof = [[0.0, 0], [0.14, 0], [0.145, 0.1], [0.158, 0.26], [0.182, 0.4], [0.17, 0.47], [0.11, 0.53], [0.05, 0.55], [0.0, 0.55]].map(([x, y]) => new Vector2(x, y));
    const torsoG = new LatheGeometry(prof, 12);
    torsoG.scale(1, 1, 0.66);
    const cap = (r0: number, len: number) => new CapsuleGeometry(r0, Math.max(0.01, len - 2 * r0), 2, 7);
    const headG = new SphereGeometry(0.116, 12, 9);
    headG.scale(0.92, 1.08, 1);
    const hairG = new SphereGeometry(0.124, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
    hairG.rotateX(-0.42); // tilt back: frees the forehead, covers the back of the head
    hairG.scale(0.95, 1.05, 1.04);
    const hairBackG = cap(0.075, 0.3);
    const shoeG = cap(0.052, 0.27);
    shoeG.rotateX(Math.PI / 2);
    shoeG.scale(0.85, 0.7, 1);
    // Face: eyes, brows and a nose, merged into one small mesh (dark; nose is tinted per person below).
    const faceParts: BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      const eye = new SphereGeometry(0.015, 8, 6);
      eye.translate(sx * 0.038, 0.012, 0.098);
      const brow = new CapsuleGeometry(0.006, 0.03, 2, 4).rotateZ(Math.PI / 2 + sx * 0.12);
      brow.translate(sx * 0.04, 0.042, 0.1);
      faceParts.push(eye, brow);
    }
    const mouth = new CapsuleGeometry(0.006, 0.035, 2, 4).rotateZ(Math.PI / 2);
    mouth.translate(0, -0.052, 0.098);
    faceParts.push(mouth);
    const faceG = mergeGeometries(faceParts.map((x) => { x.deleteAttribute('uv'); return x.index ? x.toNonIndexed() : x; }), false)!;
    const defs: [Part, BufferGeometry, MeshStandardMaterial, number][] = [
      ['torso', torsoG, mat, 1], ['pelvis', cap(0.11, 0.32).rotateZ(Math.PI / 2), mat, 1], ['neck', new CylinderGeometry(0.052, 0.058, 0.09, 12), skinMat, 1],
      ['head', headG, skinMat, 1], ['face', faceG, new MeshStandardMaterial({ color: 0x2a1d17, roughness: 0.4 }), 1], ['hair', hairG, hairMat, 1], ['hairBack', hairBackG, hairMat, 1],
      ['uarm', cap(0.06, L.uarm), mat, 2], ['farm', cap(0.05, L.farm), mat, 2], ['hand', new SphereGeometry(0.05, 12, 10), skinMat, 2],
      ['thigh', cap(0.088, L.thigh), mat, 2], ['shin', cap(0.066, L.shin), mat, 2], ['shoe', shoeG, mat, 2],
    ];
    this.slotOwner = new Int32Array(n).fill(-1);
    const hiGeo = pedHiParts(L) as Partial<Record<Part, BufferGeometry>>;
    for (const [name, g, m, k] of defs) {
      const im = new InstancedMesh(g, m, n * k);
      // Crowds don't cast shadows: a big saving in the shadow pass on phones.
      im.castShadow = false;
      im.frustumCulled = false;
      this.parts[name] = im;
      this.root.add(im);
      const hm = new InstancedMesh(hiGeo[name] ?? g, m, NEAR_MAX * k);
      hm.castShadow = false;
      hm.frustumCulled = false;
      hm.count = 0;
      hm.setColorAt(0, new Color());
      this.hi[name] = hm;
      this.root.add(hm);
    }
    // Place everyone once so they are correct even before the first update.
    for (const p of this.peds) {
      if (p.home) { p.x = p.home.x; p.z = p.home.z; p.heading = p.home.yaw; }
      p.y = this.groundAt(p.x, p.z);
    }
    this.root.visible = this.peds.length > 0;
    this.render(0);
  }

  /** bike: position + velocity. Returns true if a pedestrian was bumped this frame. */
  update(dt: number, bx: number, bz: number, bvx: number, bvz: number, time: number): boolean {
    let bumped = false;
    this.aiTimer -= dt;
    const think = this.aiTimer <= 0;
    if (think) this.aiTimer = 1 / 15;
    const bs = Math.hypot(bvx, bvz);
    this.lodX = bx;
    this.lodZ = bz;
    const n = Math.min(this.active, this.peds.length);
    for (let pi = 0; pi < n; pi++) {
      const p = this.peds[pi];
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
      if (p.home && p.state !== 'sit') {
        // Standing people: step aside when a bike comes at them, then drift back to their spot.
        if (p.timer > 0) p.timer -= dt;
        else if (p.state !== 'walk') { p.state = 'walk'; p.targetLat = 0; }
        p.lateral += (p.targetLat - p.lateral) * Math.min(1, (p.state === 'startled' ? 5 : 2) * dt);
        const rx = Math.cos(p.home.yaw), rz = -Math.sin(p.home.yaw);
        p.x = p.home.x + rx * p.lateral;
        p.z = p.home.z + rz * p.lateral;
        let dh = p.home.yaw - p.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        p.heading += dh * Math.min(1, 4 * dt);
        p.walk = Math.abs(p.targetLat - p.lateral) > 0.2 ? Math.min(1, p.walk + dt * 4) : Math.max(0, p.walk - dt * 3);
        p.phase += dt * (1.6 + p.walk * 4);
        if (p.kind === 'cheer') {
          const near = d2 < 45 * 45 && bs > 6;
          p.excite = near ? Math.min(1, p.excite + dt * 3) : Math.max(0, p.excite - dt * 0.8);
          // Face the action while excited.
          if (p.excite > 0.2) p.heading += Math.atan2(Math.sin(Math.atan2(-dx, -dz) - p.heading), Math.cos(Math.atan2(-dx, -dz) - p.heading)) * Math.min(1, 3 * dt);
        }
      } else if (p.state === 'sit') {
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
        // Turn smoothly at corners instead of snapping.
        const want = Math.atan2(tx, tz);
        let dh = want - p.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        p.heading += dh * Math.min(1, 6 * dt);
        // Lateral offset is toward the inside of the block (left of travel) or out.
        p.x = a.x + (b.x - a.x) * p.t + -tz * p.lateral;
        p.z = a.z + (b.z - a.z) * p.t + tx * p.lateral;
        p.phase += dt * (p.kind === 'jog' ? 3.2 + sp * 2.2 : 1.6 + sp * 3.2);
        p.walk = sp > 0.05 && p.pause <= 0 ? Math.min(1, p.walk + dt * 3) : Math.max(0, p.walk - dt * 3);
      }
      p.y = this.groundAt(p.x, p.z);
    }
    this.render(time);
    if (bumped) this.bumped++;
    return bumped;
  }

  /** Write one part's matrix: a Y-aligned piece from local point a to b (ped space → world). */
  private seg(part: Part, idx: number, a: Vector3, b: Vector3, nominal: number, w: number, root: Matrix4, rootQ: Quaternion) {
    _d.subVectors(b, a);
    const len = _d.length() || 1e-4;
    _q2.setFromUnitVectors(_up, _d.multiplyScalar(1 / len));
    _q.copy(rootQ).multiply(_q2);
    _p.copy(a).lerp(b, 0.5).applyMatrix4(root);
    const sc = root.getMaxScaleOnAxis();
    _m.compose(_p, _q, _s.set(w * sc, (len / nominal) * sc, w * sc));
    this.P[part].setMatrixAt(idx, _m);
  }

  private place(part: Part, idx: number, at: Vector3, root: Matrix4, rootQ: Quaternion, scale: number, extraQ?: Quaternion) {
    _p.copy(at).applyMatrix4(root);
    _q.copy(rootQ);
    if (extraQ) _q.multiply(extraQ);
    _m.compose(_p, _q, _s.setScalar(scale * root.getMaxScaleOnAxis()));
    this.P[part].setMatrixAt(idx, _m);
  }

  private render(time: number) {
    const root = new Matrix4(), rootQ = new Quaternion(), tilt = new Quaternion();
    const hip = [new Vector3(), new Vector3()], knee = new Vector3(), ankle = new Vector3(), sh = new Vector3(), el = new Vector3(), hand = new Vector3();
    const pelvis = new Vector3(), chest = new Vector3(), neckP = new Vector3(), headP = new Vector3();
    const n = Math.min(this.active, this.peds.length);
    const all = !Number.isFinite(this.lodX);
    let near = 0, vis = 0;
    for (let i = 0; i < n; i++) {
      const p = this.peds[i];
      const lk = p.look, S = lk.scale, B = lk.build;
      const d2 = (p.x - this.lodX) ** 2 + (p.z - this.lodZ) ** 2;
      if (!all && d2 > VIS_R * VIS_R) continue;
      // The closest few get the sculpted parts; everyone else drawn takes the next simple slot.
      const isNear = near < NEAR_MAX && d2 < NEAR_R * NEAR_R;
      let s0: number;
      if (isNear) {
        s0 = near++;
        this.P = this.hi;
        this.colorHi(s0, lk);
      } else {
        s0 = vis++;
        this.P = this.parts;
        if (this.slotOwner[s0] !== i) {
          this.slotOwner[s0] = i;
          this.colorSimple(s0, lk);
        }
      }
      const sit = p.state === 'sit', startled = p.state === 'startled';
      const w = sit ? 0 : p.walk;
      const jog = p.kind === 'jog' && !sit ? 1 : 0;
      const ph = p.phase;
      // Root: feet on the ground, facing the walking direction, a slight lean into the stride.
      rootQ.setFromAxisAngle(_up, p.heading + (startled ? Math.sin(time * 20) * 0.08 : 0));
      tilt.setFromAxisAngle(_x, (0.05 + jog * 0.1) * w);
      rootQ.multiply(tilt);
      const cheerHop = p.kind === 'cheer' ? Math.max(0, Math.sin(time * 9 + i)) * 0.06 * p.excite : 0;
      const bob = sit ? -0.42 : Math.abs(Math.cos(ph)) * (0.035 + jog * 0.05) * w - 0.02 * w + cheerHop;
      root.compose(_a.set(p.x, p.y + bob * S, p.z), rootQ, _s.setScalar(S));
      pelvis.set(0, L.hipY, sit ? -0.12 : 0);
      chest.set(0, L.hipY + L.torso * 0.62, 0.0);
      neckP.set(0, L.hipY + L.torso + 0.03, 0.01);
      headP.set(0, L.hipY + L.torso + 0.14, 0.02);
      const twist = Math.sin(ph) * 0.1 * w;
      // Torso & hips
      _q2.setFromAxisAngle(_up, twist);
      this.placeScaled('torso', s0, _b.set(0, L.hipY - 0.03, 0), root, rootQ, _q2, _a.set(B, 1, B));
      this.placeScaled('pelvis', s0, pelvis, root, rootQ, null, _a.set(B, 1, 1));
      this.place('neck', s0, neckP, root, rootQ, 1);
      _q2.setFromAxisAngle(_up, -twist * 0.6 + (startled ? 0.5 : 0));
      this.place('head', s0, headP, root, rootQ, 1, _q2);
      this.place('face', s0, headP, root, rootQ, 1, _q2);
      this.place('hair', s0, _b.copy(headP).add(_a.set(0, 0.012, -0.008)), root, rootQ, 1, _q2);
      if (lk.longHair) this.place('hairBack', s0, _b.copy(headP).add(_a.set(0, -0.09, -0.07)), root, rootQ, 1, _q2);
      else this.place('hairBack', s0, headP, root, rootQ, 0);
      for (let k = 0; k < 2; k++) {
        const side = k ? 1 : -1;
        const j = s0 * 2 + k;
        // Legs: hip swing + knee bend through the stride (knee bends on the swing phase).
        const swing = Math.sin(ph + (k ? Math.PI : 0));
        let hipA = swing * (0.42 + jog * 0.2) * w;
        let kneeA = Math.max(0, -Math.cos(ph + (k ? Math.PI : 0))) * (0.75 + jog * 0.6) * w + 0.05 + jog * 0.25;
        if (sit) { hipA = 1.45; kneeA = 1.5; }
        hip[k].set(side * L.hipW * B, L.hipY - 0.04, pelvis.z);
        knee.set(hip[k].x, hip[k].y - Math.cos(hipA) * L.thigh, hip[k].z + Math.sin(hipA) * L.thigh);
        const sa = hipA - kneeA;
        ankle.set(knee.x, knee.y - Math.cos(sa) * L.shin, knee.z + Math.sin(sa) * L.shin);
        this.seg('thigh', j, hip[k], knee, L.thigh, B, root, rootQ);
        this.seg('shin', j, knee, ankle, L.shin, 1, root, rootQ);
        _q2.setFromAxisAngle(_x, sit ? 0 : Math.max(-0.3, Math.min(0.5, -sa * 0.6)));
        this.place('shoe', j, _b.copy(ankle).add(_a.set(0, -0.04, 0.06)), root, rootQ, 1, _q2);
        // Arms: swing opposite to the legs, elbows soft; hands up when startled.
        sh.set(side * L.shW * B, L.hipY + L.torso - 0.06, 0);
        let armA = -swing * (0.38 + jog * 0.3) * w, elbow = 0.25 + Math.max(0, -swing) * 0.35 * w + jog * 1.1;
        let spread = 0.12;
        if (p.kind === 'cheer' && p.excite > 0.05) {
          // Arms up, waving.
          armA = 0.4 + p.excite * 2.4 + Math.sin(time * 8 + k * 2 + i) * 0.25 * p.excite;
          elbow = 0.3;
          spread = 0.25 + p.excite * 0.2;
        } else if ((p.kind === 'idle' || p.kind === 'cheer') && lk.phone && k === 1 && w < 0.3) {
          armA = 0.5;
          elbow = 1.9; // phone in hand, looking down
        }
        if (startled) { armA = 2.4; elbow = 0.6; spread = 0.4; }
        if (sit) { armA = 0.6; elbow = 0.9; spread = 0.15; }
        el.set(sh.x + side * Math.sin(spread) * L.uarm, sh.y - Math.cos(armA) * Math.cos(spread) * L.uarm, sh.z + Math.sin(armA) * L.uarm);
        const fa = armA + elbow;
        hand.set(el.x + side * 0.02, el.y - Math.cos(fa) * L.farm, el.z + Math.sin(fa) * L.farm);
        this.seg('uarm', j, sh, el, L.uarm, B, root, rootQ);
        this.seg('farm', j, el, hand, L.farm, 1, root, rootQ);
        this.place('hand', j, hand.addScaledVector(_d.subVectors(hand, el).normalize(), 0.03), root, rootQ, 1);
      }
    }
    this.P = this.parts;
    for (const [k, m] of Object.entries(this.hi)) {
      m.count = near * (LIMBS.includes(k) ? 2 : 1);
      m.visible = near > 0;
    }
    for (const [k, m] of Object.entries(this.parts)) {
      m.count = vis * (LIMBS.includes(k) ? 2 : 1);
      m.visible = vis > 0;
    }
    for (const m of [...Object.values(this.parts), ...Object.values(this.hi)]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  private placeScaled(part: Part, idx: number, at: Vector3, root: Matrix4, rootQ: Quaternion, extraQ: Quaternion | null, scale: Vector3) {
    _p.copy(at).applyMatrix4(root);
    _q.copy(rootQ);
    if (extraQ) _q.multiply(extraQ);
    const sc = root.getMaxScaleOnAxis();
    _m.compose(_p, _q, _s.copy(scale).multiplyScalar(sc));
    this.P[part].setMatrixAt(idx, _m);
  }

  /** Colour simple-part slot `i` for a person. */
  private colorSimple(i: number, lk: Look) {
    const P = this.parts;
    P.torso.setColorAt(i, lk.shirt);
    P.pelvis.setColorAt(i, lk.pants);
    P.neck.setColorAt(i, lk.skin);
    P.head.setColorAt(i, lk.skin);
    P.hair.setColorAt(i, lk.hair);
    P.hairBack.setColorAt(i, lk.hair);
    for (let k = 0; k < 2; k++) {
      const j = i * 2 + k;
      P.uarm.setColorAt(j, lk.shirt);
      P.farm.setColorAt(j, lk.shortSleeves ? lk.skin : lk.shirt);
      P.hand.setColorAt(j, lk.skin);
      P.thigh.setColorAt(j, lk.pants);
      P.shin.setColorAt(j, lk.shorts ? lk.skin : lk.pants);
      P.shoe.setColorAt(j, lk.shoes);
    }
  }

  private colorHi(s: number, lk: Look) {
    const P = this.hi;
    P.torso.setColorAt(s, lk.shirt);
    P.pelvis.setColorAt(s, lk.pants);
    P.neck.setColorAt(s, lk.skin);
    P.head.setColorAt(s, lk.skin);
    P.face.setColorAt(s, _white);
    P.hair.setColorAt(s, lk.hair);
    P.hairBack.setColorAt(s, lk.hair);
    for (let k = 0; k < 2; k++) {
      const j = s * 2 + k;
      P.uarm.setColorAt(j, lk.shirt);
      P.farm.setColorAt(j, lk.shortSleeves ? lk.skin : lk.shirt);
      P.hand.setColorAt(j, lk.skin);
      P.thigh.setColorAt(j, lk.pants);
      P.shin.setColorAt(j, lk.shorts ? lk.skin : lk.pants);
      P.shoe.setColorAt(j, lk.shoes);
    }
  }

  setCount(n: number) {
    this.active = Math.min(n, this.peds.length);
  }
}
