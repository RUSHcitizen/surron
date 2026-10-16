/**
 * Procedural bike + rider model built from the same VehicleSpec the physics uses,
 * so every geometric change (wheel size, swingarm, fork, battery, gearing...) is visible.
 */
import {
  BoxGeometry, CatmullRomCurve3, CircleGeometry, Color, CylinderGeometry, DoubleSide, Group, InstancedMesh, Matrix4,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, Quaternion, SphereGeometry, TorusGeometry,
  TubeGeometry, Vector3,
} from 'three';
import type { BufferGeometry, Material } from 'three';
import type { BikeBuild } from '../vehicle/build';
import type { VehicleSpec, V3 } from '../vehicle/spec';
import { BODY_KITS, FENDERS, FINISHES, LIGHTS, RIM_STYLES, byId } from '../vehicle/parts';
import { liveryTexture, plateTexture, treadTexture } from './textures';

const v = (p: V3) => new Vector3(p.x, p.y, p.z);
const UPY = new Vector3(0, 1, 0);
const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _q = new Quaternion(), _bt = new Vector3();

export interface BikeVisualState {
  steer: number;
  frontComp: number;
  rearComp: number;
  frontAngle: number;
  rearAngle: number;
  riderShift: number;
  riderLat: number;
  speed: number;
  brake: number;
  crashed: boolean;
  headlight: boolean;
  riderPos?: Vector3;
  riderRot?: Quaternion;
}

/** Place a unit-height (Y) mesh between two points. */
function between(m: Object3D, a: Vector3, b: Vector3, scaleXZ = 1) {
  _bt.subVectors(b, a);
  const len = _bt.length();
  m.position.copy(a).addScaledVector(_bt, 0.5);
  if (len > 1e-6) m.quaternion.setFromUnitVectors(UPY, _bt.multiplyScalar(1 / len));
  m.scale.set(scaleXZ, Math.max(len, 1e-4), scaleXZ);
}

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

export class BikeModel {
  root = new Group();
  private chassis = new Group();
  private steerG = new Group();
  private forkSlide = new Group();
  private frontWheel = new Group();
  private rearWheel = new Group();
  private swingarm = new Group();
  private armScale = new Group();
  private shock = new Mesh();
  private spring = new Mesh();
  private chainTop = new Mesh();
  private chainBot = new Mesh();
  private brakeLightMat = new MeshStandardMaterial({ color: 0x400000, emissive: 0xff1010, emissiveIntensity: 0.2 });
  private headMat = new MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 0.8 });
  private disposables: (BufferGeometry | Material)[] = [];
  private steerAxis = new Vector3();
  private headPos = new Vector3();
  private frontExt = new Vector3();
  private rearExt = new Vector3();
  private rearAxis = new Vector3();
  private shockTop = new Vector3();
  private rearSprocketR = 0.1;
  private frontSprocketR = 0.03;
  private frontSprocketPos = new Vector3();
  rider: RiderModel;
  /** Headlight spot direction anchor (in steering group). */
  lightAnchor = new Object3D();
  lightTarget = new Object3D();

  constructor(build: BikeBuild, public spec: VehicleSpec) {
    this.rider = new RiderModel(build);
    this.build(build, spec);
  }

  private mat<T extends Material>(m: T): T {
    this.disposables.push(m);
    return m;
  }
  private geo<T extends BufferGeometry>(g: T): T {
    this.disposables.push(g);
    return g;
  }

  rebuild(build: BikeBuild, spec: VehicleSpec) {
    this.disposeParts();
    this.spec = spec;
    this.rider.rebuild(build);
    this.build(build, spec);
  }

  private disposeParts() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.root.clear();
    this.chassis = new Group();
    this.steerG = new Group();
    this.forkSlide = new Group();
    this.frontWheel = new Group();
    this.rearWheel = new Group();
    this.swingarm = new Group();
    this.armScale = new Group();
  }

  dispose() {
    this.disposeParts();
    this.rider.dispose();
  }

  private build(build: BikeBuild, spec: VehicleSpec) {
    const G = spec.geo;
    const V = build.visual;
    const fin = FINISHES.find((f) => f.id === V.finish) ?? FINISHES[0];
    const kit = byId(BODY_KITS, build.parts.bodyKit);
    const fend = byId(FENDERS, build.parts.fenders);
    const lights = byId(LIGHTS, build.parts.lights);
    const rimStyle = byId(RIM_STYLES, build.parts.rimStyle).id;

    const paint = this.mat(new MeshStandardMaterial({ color: V.plasticColor, roughness: fin.roughness, metalness: fin.metalness }));
    const frameM = this.mat(new MeshStandardMaterial({ color: V.frameColor, roughness: 0.45, metalness: 0.6 }));
    const accent = this.mat(new MeshStandardMaterial({ color: V.accentColor, roughness: 0.35, metalness: 0.3 }));
    const dark = this.mat(new MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.7, metalness: 0.3 }));
    const alloy = this.mat(new MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.3, metalness: 0.85 }));
    const gold = this.mat(new MeshStandardMaterial({ color: 0xd4a72c, roughness: 0.25, metalness: 0.9 }));
    const rimM = this.mat(new MeshStandardMaterial({ color: V.rimColor, roughness: 0.3, metalness: 0.7 }));
    const seatM = this.mat(new MeshStandardMaterial({ color: V.seatColor, roughness: 0.85 }));
    const livery = this.mat(new MeshStandardMaterial({
      map: liveryTexture(V.plasticColor, V.decal, V.decalColor, V.accentColor, V.number),
      roughness: fin.roughness, metalness: fin.metalness * 0.5,
    }));
    const plateM = this.mat(new MeshStandardMaterial({ map: plateTexture(V.number, V.plateColor, '#111111'), roughness: 0.5 }));

    this.root.add(this.chassis);
    this.chassis.position.set(-spec.com.x, -spec.com.y, -spec.com.z);

    // --- Frame tubes ---------------------------------------------------------
    const head = v(G.head), headTop = v(G.headTop);
    const tube = (pts: Vector3[], r: number, m: Material, x = 0) => {
      const curve = new CatmullRomCurve3(pts.map((p) => p.clone().setX(x)));
      const mesh = new Mesh(this.geo(new TubeGeometry(curve, 24, r, 8)), m);
      mesh.castShadow = true;
      this.chassis.add(mesh);
      return mesh;
    };
    const P = (z: number, y: number) => new Vector3(0, y, z);
    for (const x of [0.075, -0.075]) {
      tube([headTop, P(0.12, 0.47), P(-0.12, 0.41), P(-0.32, 0.38), P(-0.62, 0.37)], 0.018, frameM, x);
      tube([head, P(0.3, 0.12), P(0.16, -0.1), P(-0.02, -0.08), P(-0.03, 0.08), P(-0.18, 0.2), P(-0.42, 0.33)], 0.02, frameM, x);
    }
    const headTube = new Mesh(this.geo(new CylinderGeometry(0.03, 0.03, 0.22, 12)), frameM);
    between(headTube, head, headTop);
    headTube.scale.set(1, headTube.scale.y, 1);
    headTube.geometry.translate(0, 0, 0);
    this.chassis.add(headTube);
    if (build.parts.frame === 'reinforced') {
      for (const x of [0.085, -0.085]) tube([P(0.28, 0.4), P(0.2, 0.2), P(0.05, 0.05)], 0.012, frameM, x);
    }

    // --- Battery, motor, controller --------------------------------------------
    const bs = G.batterySize;
    const battery = new Mesh(this.geo(new BoxGeometry(bs.x, bs.y, bs.z)), dark);
    battery.position.copy(v(G.battery));
    battery.castShadow = true;
    this.chassis.add(battery);
    const motor = new Mesh(this.geo(new CylinderGeometry(G.motorRadius, G.motorRadius, 0.15, 20)), alloy);
    motor.rotation.z = Math.PI / 2;
    motor.position.copy(v(G.motor));
    motor.castShadow = true;
    this.chassis.add(motor);
    const motorCap = new Mesh(this.geo(new CylinderGeometry(G.motorRadius * 0.7, G.motorRadius * 0.7, 0.16, 16)), accent);
    motorCap.rotation.z = Math.PI / 2;
    motorCap.position.copy(motor.position);
    this.chassis.add(motorCap);
    const ctrl = new Mesh(this.geo(new BoxGeometry(0.1, 0.06, 0.18)), dark);
    ctrl.position.set(0, 0.06, -0.12);
    this.chassis.add(ctrl);

    // --- Body panels -------------------------------------------------------------
    const panelW = Math.max(bs.x + 0.03, 0.2);
    const panelMesh = (w: number, h: number, l: number, pos: Vector3, rotX = 0, m: Material = paint) => {
      const mesh = new Mesh(this.geo(new BoxGeometry(w, h, l)), m);
      mesh.position.copy(pos);
      mesh.rotation.x = rotX;
      mesh.castShadow = true;
      this.chassis.add(mesh);
      return mesh;
    };
    if (kit.style !== 'race') {
      // Side panels with livery on the outer faces.
      const sideGeo = this.geo(new PlaneGeometry(0.5, 0.26));
      for (const s of [1, -1]) {
        const side = new Mesh(sideGeo, livery);
        side.position.set(s * (panelW / 2 + 0.008), 0.23, 0.12);
        side.rotation.y = s * (Math.PI / 2);
        side.rotation.z = s * 0.06;
        this.chassis.add(side);
      }
      panelMesh(panelW, 0.27, 0.5, new Vector3(0, 0.23, 0.12), 0.06);
    } else {
      for (const s of [1, -1]) {
        const side = new Mesh(this.geo(new PlaneGeometry(0.34, 0.16)), livery);
        side.position.set(s * (panelW / 2 + 0.008), 0.3, 0.1);
        side.rotation.y = s * (Math.PI / 2);
        this.chassis.add(side);
      }
    }
    if (kit.style === 'armor') {
      panelMesh(0.2, 0.03, 0.42, new Vector3(0, -0.16, 0.1), -0.1, alloy); // skid plate
      for (const s of [1, -1]) panelMesh(0.02, 0.12, 0.3, new Vector3(s * 0.15, 0.0, 0.15), 0, dark);
    }
    // Top cover between head tube and seat, plus shroud "wings" flanking the head.
    if (kit.style !== 'race') {
      const topLen = Math.max(0.12, head.z - 0.03 - (G.seat.z + G.seatLength / 2) + 0.06);
      panelMesh(0.17, 0.05, topLen, new Vector3(0, Math.min(G.seat.y, 0.46) + 0.0, G.seat.z + G.seatLength / 2 + topLen / 2 - 0.04), 0.12);
      for (const sd of [1, -1]) {
        const wing = panelMesh(0.02, 0.2, 0.22, new Vector3(sd * 0.115, 0.36, 0.25), 0.35, accent);
        wing.rotation.y = sd * 0.25;
      }
    }
    // Tail / rear fender blade
    const seatEnd = G.seat.z - G.seatLength / 2;
    const rearFenderLen = fend.style === 'short' ? 0.32 : 0.55;
    panelMesh(0.2, 0.025, rearFenderLen, new Vector3(0, G.seat.y - 0.04, seatEnd - rearFenderLen / 2 + 0.06), -0.18);
    // Tail light
    const tail = new Mesh(this.geo(new BoxGeometry(0.08, 0.03, 0.02)), this.brakeLightMat);
    tail.position.set(0, G.seat.y - 0.06, seatEnd - rearFenderLen + 0.15);
    this.chassis.add(tail);
    // Seat
    const seat = new Mesh(this.geo(new BoxGeometry(0.22, 0.08, G.seatLength)), seatM);
    seat.position.copy(v(G.seat));
    seat.castShadow = true;
    this.chassis.add(seat);
    // Footpegs
    for (const s of [1, -1]) {
      const peg = new Mesh(this.geo(new BoxGeometry(0.1, 0.02, 0.05)), alloy);
      peg.position.set(s * (G.peg.x + 0.04), G.peg.y, G.peg.z);
      this.chassis.add(peg);
    }

    // --- Steering assembly -------------------------------------------------------------
    this.steerAxis.set(spec.steering.axis.x, spec.steering.axis.y, spec.steering.axis.z).normalize();
    this.headPos.copy(head);
    this.steerG.position.copy(head);
    this.chassis.add(this.steerG);
    const clampMat = alloy;
    const topClamp = new Mesh(this.geo(new BoxGeometry(0.22, 0.03, 0.08)), clampMat);
    topClamp.position.copy(headTop).sub(head);
    this.steerG.add(topClamp);
    const botClamp = new Mesh(this.geo(new BoxGeometry(0.22, 0.03, 0.08)), clampMat);
    this.steerG.add(botClamp);
    // Fork: upper tubes fixed in clamps; lower legs slide with the wheel.
    this.frontExt.copy(v(G.frontAxleExt));
    const axleRel = this.frontExt.clone().sub(head);
    const forkUpperLen = 0.38;
    const upperR = G.invertedFork ? 0.028 : 0.02;
    const lowerR = G.invertedFork ? 0.02 : 0.028;
    const upperM = G.invertedFork ? gold : alloy;
    const lowerM = G.invertedFork ? alloy : dark;
    for (const s of [1, -1]) {
      const up = new Mesh(this.geo(new CylinderGeometry(upperR, upperR, 1, 10)), upperM);
      const topP = headTop.clone().sub(head).add(new Vector3(s * 0.08, 0.02, 0));
      const botP = topP.clone().addScaledVector(this.steerAxis, -forkUpperLen - 0.22);
      between(up, topP, botP);
      up.castShadow = true;
      this.steerG.add(up);
      const low = new Mesh(this.geo(new CylinderGeometry(lowerR, lowerR, 1, 10)), lowerM);
      const a = axleRel.clone().add(new Vector3(s * 0.08, 0, 0));
      const b = a.clone().addScaledVector(this.steerAxis, spec.geo.forkLength * 0.55);
      between(low, a, b);
      low.castShadow = true;
      this.forkSlide.add(low);
    }
    this.steerG.add(this.forkSlide);
    // Handlebar
    const barC = v(G.barCenter).sub(head);
    const bar = new Mesh(this.geo(new CylinderGeometry(0.011, 0.011, G.barWidth, 8)), dark);
    bar.rotation.z = Math.PI / 2;
    bar.position.copy(barC);
    this.steerG.add(bar);
    const riser = new Mesh(this.geo(new CylinderGeometry(0.012, 0.012, 1, 8)), alloy);
    between(riser, headTop.clone().sub(head), barC);
    this.steerG.add(riser);
    for (const s of [1, -1]) {
      const grip = new Mesh(this.geo(new CylinderGeometry(0.017, 0.017, 0.12, 8)), seatM);
      grip.rotation.z = Math.PI / 2;
      grip.position.copy(barC).add(new Vector3(s * (G.barWidth / 2 - 0.06), 0, 0));
      this.steerG.add(grip);
      const lever = new Mesh(this.geo(new BoxGeometry(0.14, 0.008, 0.02)), alloy);
      lever.position.copy(barC).add(new Vector3(s * (G.barWidth / 2 - 0.12), -0.01, 0.06));
      lever.rotation.y = s * 0.25;
      this.steerG.add(lever);
    }
    // Front plate / headlight / fairing
    const plateCenter = headTop.clone().sub(head).add(new Vector3(0, -0.12, 0.09));
    if (kit.style === 'fairing') {
      const fair = new Mesh(this.geo(new BoxGeometry(0.34, 0.3, 0.05)), paint);
      fair.position.copy(plateCenter).add(new Vector3(0, 0.04, 0.03));
      fair.rotation.x = -0.35;
      this.steerG.add(fair);
      const screen = new Mesh(this.geo(new PlaneGeometry(0.28, 0.16)), this.mat(new MeshStandardMaterial({ color: 0x223344, transparent: true, opacity: 0.45, side: DoubleSide })));
      screen.position.copy(plateCenter).add(new Vector3(0, 0.22, 0.0));
      screen.rotation.x = -0.6;
      this.steerG.add(screen);
    } else {
      const plate = new Mesh(this.geo(new PlaneGeometry(0.24, 0.18)), plateM);
      plate.position.copy(plateCenter);
      plate.rotation.x = -0.32;
      this.steerG.add(plate);
      const plateBack = new Mesh(this.geo(new BoxGeometry(0.25, 0.19, 0.015)), paint);
      plateBack.position.copy(plateCenter).add(new Vector3(0, 0, -0.012));
      plateBack.rotation.x = -0.32;
      this.steerG.add(plateBack);
    }
    if (lights.style === 'round') {
      const hl = new Mesh(this.geo(new CircleGeometry(0.045, 18)), this.headMat);
      hl.position.copy(plateCenter).add(new Vector3(0, -0.125, 0.045));
      hl.rotation.x = -0.32;
      this.steerG.add(hl);
    } else if (lights.style === 'bar') {
      const hl = new Mesh(this.geo(new BoxGeometry(0.22, 0.035, 0.02)), this.headMat);
      hl.position.copy(plateCenter).add(new Vector3(0, -0.11, 0.03));
      this.steerG.add(hl);
    }
    this.lightAnchor.position.copy(plateCenter).add(new Vector3(0, 0, 0.05));
    this.lightTarget.position.copy(plateCenter).add(new Vector3(0, -1.2, 10));
    this.steerG.add(this.lightAnchor, this.lightTarget);
    // Front fender
    const fr = spec.front.radius;
    if (fend.style === 'high') {
      const ff = new Mesh(this.geo(new BoxGeometry(0.13, 0.02, 0.5)), paint);
      ff.position.copy(new Vector3(0, -0.04, 0.12));
      ff.rotation.x = -0.12;
      this.steerG.add(ff);
    } else {
      const arc = Math.PI * (fend.style === 'short' ? 0.3 : 0.42);
      const ffArc = new Mesh(this.geo(new TorusGeometry(fr + 0.035, 0.008, 6, 20, arc)), paint);
      ffArc.scale.set(1, 1, 7);
      const fg = new Group();
      fg.add(ffArc);
      ffArc.rotation.set(0, Math.PI / 2, Math.PI / 2 - arc * 0.35);
      fg.position.copy(axleRel);
      this.forkSlide.add(fg);
    }

    // --- Wheels -------------------------------------------------------------------
    const makeWheel = (radius: number, rimR: number, width: number, tread: string, rotor: number) => {
      const g = new Group();
      const rc = Math.min(radius * 0.35, width * 0.45);
      const tireTex = treadTexture(tread);
      tireTex.repeat.set(1, 6);
      const tireM = this.mat(new MeshStandardMaterial({ color: 0x18191b, roughness: 0.92, bumpMap: tireTex, bumpScale: 2 }));
      const tire = new Mesh(this.geo(new TorusGeometry(radius - rc, rc, 12, 40)), tireM);
      tire.rotation.y = Math.PI / 2;
      tire.scale.set(1, 1, Math.min(1.3, width / (2 * rc)));
      tire.castShadow = true;
      g.add(tire);
      if (tread === 'knobby' || tread === 'paddle') {
        const count = tread === 'paddle' ? 18 : 40;
        const knob = this.geo(new BoxGeometry(tread === 'paddle' ? width * 0.95 : width * 0.32, 0.018, tread === 'paddle' ? 0.02 : 0.03));
        const im = new InstancedMesh(knob, tireM, tread === 'paddle' ? count : count * 2);
        const m4 = new Matrix4();
        let k = 0;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2;
          const sides = tread === 'paddle' ? [0] : [-1, 1];
          for (const s of sides) {
            const off = (i % 2 ? 0.25 : 0.55) * s * width * 0.5;
            m4.makeRotationX(a);
            m4.setPosition(off, Math.cos(a) * (radius - 0.004), Math.sin(a) * (radius - 0.004));
            im.setMatrixAt(k++, m4);
          }
        }
        im.count = k;
        im.castShadow = true;
        g.add(im);
      }
      const rim = new Mesh(this.geo(new TorusGeometry(rimR, 0.014, 6, 32)), rimM);
      rim.rotation.y = Math.PI / 2;
      g.add(rim);
      const hub = new Mesh(this.geo(new CylinderGeometry(0.045, 0.045, width * 0.9 + 0.05, 12)), alloy);
      hub.rotation.z = Math.PI / 2;
      g.add(hub);
      if (rimStyle === 'disc') {
        const disc = new Mesh(this.geo(new CylinderGeometry(rimR, rimR, 0.03, 32)), rimM);
        disc.rotation.z = Math.PI / 2;
        g.add(disc);
      } else {
        const n = rimStyle === 'spoke' ? 18 : rimStyle === 'cast' ? 6 : 5;
        const r = rimStyle === 'spoke' ? 0.0025 : 0.012;
        const sg = this.geo(new CylinderGeometry(r, r * (rimStyle === 'spoke' ? 1 : 1.6), rimR - 0.04, 6));
        for (let i = 0; i < n; i++) {
          const s = new Mesh(sg, rimStyle === 'spoke' ? alloy : rimM);
          const a = (i / n) * Math.PI * 2;
          s.position.set(rimStyle === 'spoke' ? (i % 2 ? 0.015 : -0.015) : 0, Math.cos(a) * (rimR / 2 + 0.02), Math.sin(a) * (rimR / 2 + 0.02));
          s.rotation.x = a;
          g.add(s);
        }
      }
      const disc = new Mesh(this.geo(new CylinderGeometry(rotor / 2, rotor / 2, 0.005, 24)), alloy);
      disc.rotation.z = Math.PI / 2;
      disc.position.x = -0.06;
      g.add(disc);
      return g;
    };
    const fw = makeWheel(spec.front.radius, spec.front.rimRadius, spec.front.width, spec.front.tire.tread, 0.22);
    this.frontWheel.add(fw);
    this.frontWheel.position.copy(axleRel);
    this.forkSlide.add(this.frontWheel);
    const caliperF = new Mesh(this.geo(new BoxGeometry(0.04, 0.07, 0.05)), accent);
    caliperF.position.copy(axleRel).add(new Vector3(-0.07, 0.07, -0.06));
    this.forkSlide.add(caliperF);

    this.rearExt.copy(v(G.rearAxleExt));
    this.rearAxis.set(spec.rear.axis.x, spec.rear.axis.y, spec.rear.axis.z).normalize();
    const rw = makeWheel(spec.rear.radius, spec.rear.rimRadius, spec.rear.width, spec.rear.tire.tread, 0.2);
    this.rearWheel.add(rw);
    this.chassis.add(this.rearWheel);
    // Rear sprocket on the wheel (size follows the tooth count)
    this.rearSprocketR = build.tuning.rearSprocket * 0.0021;
    const rs = new Mesh(this.geo(new CylinderGeometry(this.rearSprocketR, this.rearSprocketR, 0.006, 32)), alloy);
    rs.rotation.z = Math.PI / 2;
    rs.position.x = 0.07;
    rw.add(rs);

    // Swingarm (scaled to the live axle distance)
    this.chassis.add(this.swingarm);
    this.swingarm.add(this.armScale);
    for (const s of [1, -1]) {
      const arm = new Mesh(this.geo(new BoxGeometry(0.03, 0.06, 1)), frameM);
      arm.position.set(s * 0.085, 0, -0.5);
      arm.castShadow = true;
      this.armScale.add(arm);
    }
    // Front sprocket / chain
    this.frontSprocketR = build.tuning.frontSprocket * 0.0021;
    this.frontSprocketPos.set(0.07, -0.02, 0.05);
    const fs = new Mesh(this.geo(new CylinderGeometry(this.frontSprocketR, this.frontSprocketR, 0.008, 16)), dark);
    fs.rotation.z = Math.PI / 2;
    fs.position.copy(this.frontSprocketPos);
    this.chassis.add(fs);
    const chainGeo = this.geo(new CylinderGeometry(0.004, 0.004, 1, 4));
    this.chainTop = new Mesh(chainGeo, dark);
    this.chainBot = new Mesh(chainGeo, dark);
    this.chassis.add(this.chainTop, this.chainBot);
    // Shock
    this.shockTop.copy(v(G.shockTop));
    this.shock = new Mesh(this.geo(new CylinderGeometry(0.02, 0.02, 1, 10)), alloy);
    this.spring = new Mesh(this.geo(new CylinderGeometry(0.034, 0.034, 1, 12, 1, true)), this.mat(new MeshStandardMaterial({ color: V.accentColor, roughness: 0.4, metalness: 0.4, wireframe: true })));
    this.chassis.add(this.shock, this.spring);

    this.root.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = true;
    });
    this.update({ steer: 0, frontComp: spec.front.travel * 0.3, rearComp: spec.rear.travel * 0.3, frontAngle: 0, rearAngle: 0, riderShift: 0, riderLat: 0, speed: 0, brake: 0, crashed: false, headlight: true });
  }

  update(s: BikeVisualState) {
    // Steering about the steering axis
    this.steerG.quaternion.setFromAxisAngle(this.steerAxis, -s.steer);
    // Fork compression along the axis (in the steering group's unrotated frame)
    this.forkSlide.position.copy(this.steerAxis).multiplyScalar(s.frontComp);
    this.frontWheel.rotation.x = s.frontAngle;
    // Rear axle
    _a.copy(this.rearExt).addScaledVector(this.rearAxis, s.rearComp);
    this.rearWheel.position.copy(_a);
    this.rearWheel.rotation.x = s.rearAngle;
    const L = Math.hypot(_a.y, _a.z);
    this.swingarm.rotation.x = Math.atan2(_a.y, -_a.z);
    this.armScale.scale.set(1, 1, L);
    // Shock: from top mount to 32% along the arm
    _b.set(0, _a.y * 0.32, _a.z * 0.32);
    between(this.shock, this.shockTop, _b, 1);
    _c.copy(this.shockTop).lerp(_b, 0.15);
    const bot = _b.clone();
    between(this.spring, _c, bot.lerp(this.shockTop, 0.25), 1);
    // Chain runs (front sprocket to rear sprocket, top and bottom)
    const rsx = this.frontSprocketPos.x;
    _b.set(rsx, this.frontSprocketPos.y + this.frontSprocketR, this.frontSprocketPos.z);
    _c.set(rsx, _a.y + this.rearSprocketR, _a.z);
    between(this.chainTop, _b, _c);
    _b.set(rsx, this.frontSprocketPos.y - this.frontSprocketR, this.frontSprocketPos.z);
    _c.set(rsx, _a.y - this.rearSprocketR, _a.z);
    between(this.chainBot, _b, _c);
    this.brakeLightMat.emissiveIntensity = s.brake > 0.05 ? 2.5 : 0.35;
    this.headMat.emissiveIntensity = s.headlight && this.spec.headlight > 0 ? 1.6 : 0.2;
  }

  /** Grip positions in chassis-local space after steering (for the rider IK). */
  gripPositions(outL: Vector3, outR: Vector3) {
    const G = this.spec.geo;
    const head = this.headPos;
    for (const [s, out] of [[1, outL], [-1, outR]] as const) {
      out.set(G.barCenter.x + s * (G.barWidth / 2 - 0.07), G.barCenter.y, G.barCenter.z).sub(head);
      out.applyQuaternion(this.steerG.quaternion).add(head);
    }
  }

  get chassisGroup() {
    return this.chassis;
  }
}

/** Low-poly rider with procedural IK pose. Lives in the scene separately so it can detach on crashes. */
export class RiderModel {
  root = new Group();
  private parts: Record<string, Mesh> = {};
  private disposables: (BufferGeometry | Material)[] = [];
  private tmp = { hip: new Vector3(), neck: new Vector3(), head: new Vector3(), sh: [new Vector3(), new Vector3()], el: [new Vector3(), new Vector3()], kn: [new Vector3(), new Vector3()], hipS: [new Vector3(), new Vector3()] };

  constructor(build: BikeBuild) {
    this.rebuild(build);
  }

  rebuild(build: BikeBuild) {
    this.dispose();
    const suit = new MeshStandardMaterial({ color: new Color(build.visual.accentColor).lerp(new Color(0x1b1d22), 0.55), roughness: 0.8 });
    const suit2 = new MeshStandardMaterial({ color: 0x24272e, roughness: 0.85 });
    const helmet = new MeshStandardMaterial({ color: build.visual.plasticColor, roughness: 0.25, metalness: 0.2 });
    const visor = new MeshStandardMaterial({ color: 0x111418, roughness: 0.1, metalness: 0.6 });
    const boot = new MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 });
    this.disposables.push(suit, suit2, helmet, visor, boot);
    const cyl = (r1: number, r2: number) => {
      const g = new CylinderGeometry(r1, r2, 1, 8);
      this.disposables.push(g);
      return g;
    };
    const add = (name: string, geo: BufferGeometry, m: Material) => {
      const mesh = new Mesh(geo, m);
      mesh.castShadow = true;
      this.parts[name] = mesh;
      this.root.add(mesh);
    };
    add('torso', cyl(0.16, 0.13), suit);
    add('pelvis', cyl(0.13, 0.13), suit2);
    for (const s of ['L', 'R']) {
      add('uarm' + s, cyl(0.045, 0.04), suit);
      add('farm' + s, cyl(0.04, 0.035), suit);
      add('thigh' + s, cyl(0.065, 0.055), suit2);
      add('shin' + s, cyl(0.055, 0.05), boot);
    }
    const hg = new SphereGeometry(0.135, 14, 10);
    this.disposables.push(hg);
    add('helmet', hg, helmet);
    const vg = new BoxGeometry(0.17, 0.07, 0.06);
    this.disposables.push(vg);
    add('visor', vg, visor);
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.root.clear();
    this.parts = {};
  }

  /**
   * Pose in the bike's chassis frame, then transform into world via `chassisWorld`.
   * hip/grips/pegs are chassis-local.
   */
  pose(spec: VehicleSpec, chassisWorld: Matrix4, gripL: Vector3, gripR: Vector3, shift: number, lat: number, speed: number) {
    const G = spec.geo;
    const t = this.tmp;
    const crouch = Math.min(1, Math.abs(speed) / 18);
    t.hip.set(G.riderHip.x + lat * 0.07, G.riderHip.y + 0.04 + shift * -0.03, G.riderHip.z + shift * 0.12);
    // Torso leans toward the bars, more when crouched/shifted forward
    const pitch = 0.45 + crouch * 0.25 + shift * 0.35;
    const roll = lat * 0.25;
    t.neck.set(Math.sin(roll) * 0.5 + t.hip.x, t.hip.y + Math.cos(pitch) * 0.5, t.hip.z + Math.sin(pitch) * 0.5);
    t.head.copy(t.neck).add(new Vector3(0, 0.16, 0.06));
    const P = this.parts;
    between(P.torso, t.hip, t.neck);
    P.pelvis.position.copy(t.hip);
    P.pelvis.scale.set(1, 0.14, 1);
    P.pelvis.rotation.set(0, 0, Math.PI / 2);
    P.helmet.position.copy(t.head);
    P.visor.position.copy(t.head).add(new Vector3(0, -0.01, 0.11));
    P.visor.rotation.set(-pitch * 0.3, 0, 0);
    // Arms
    const grips = [gripL, gripR];
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      t.sh[i].copy(t.neck).add(new Vector3(s * 0.19, -0.06, -0.02));
      twoBoneIK(t.sh[i], grips[i], 0.3, 0.3, new Vector3(s * 0.8, -0.5, -0.4), t.el[i]);
      between(P[i === 0 ? 'uarmL' : 'uarmR'], t.sh[i], t.el[i]);
      between(P[i === 0 ? 'farmL' : 'farmR'], t.el[i], grips[i]);
      // Legs
      t.hipS[i].copy(t.hip).add(new Vector3(s * 0.11, 0, 0));
      const peg = new Vector3(s * (G.peg.x + 0.05), G.peg.y + 0.07, G.peg.z - 0.02);
      twoBoneIK(t.hipS[i], peg, 0.44, 0.46, new Vector3(s * 0.25, 0.3, 1), t.kn[i]);
      between(P[i === 0 ? 'thighL' : 'thighR'], t.hipS[i], t.kn[i]);
      between(P[i === 0 ? 'shinL' : 'shinR'], t.kn[i], peg);
    }
    this.root.matrixAutoUpdate = false;
    this.root.matrix.copy(chassisWorld);
    this.root.matrixWorldNeedsUpdate = true;
  }

  /** Tucked tumble pose for crashes, placed at the ragdoll point. */
  tumble(pos: Vector3, rot: Quaternion) {
    const P = this.parts;
    const t = this.tmp;
    t.hip.set(0, -0.1, 0);
    t.neck.set(0, 0.35, 0.1);
    between(P.torso, t.hip, t.neck);
    P.pelvis.position.copy(t.hip);
    P.helmet.position.set(0, 0.52, 0.16);
    P.visor.position.set(0, 0.5, 0.28);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const sh = new Vector3(s * 0.19, 0.3, 0.08), el = new Vector3(s * 0.3, 0.1, 0.25), hd = new Vector3(s * 0.2, 0.25, 0.4);
      between(P[i === 0 ? 'uarmL' : 'uarmR'], sh, el);
      between(P[i === 0 ? 'farmL' : 'farmR'], el, hd);
      const hp = new Vector3(s * 0.11, -0.1, 0), kn = new Vector3(s * 0.15, 0.15, 0.4), ft = new Vector3(s * 0.15, -0.25, 0.5);
      between(P[i === 0 ? 'thighL' : 'thighR'], hp, kn);
      between(P[i === 0 ? 'shinL' : 'shinR'], kn, ft);
    }
    _q.copy(rot);
    this.root.matrixAutoUpdate = false;
    this.root.matrix.compose(pos, _q, new Vector3(1, 1, 1));
    this.root.matrixWorldNeedsUpdate = true;
  }
}

/** A flat shadow-catcher-free blob under the bike for low quality mode. */
export function blobShadow(): Mesh {
  const m = new Mesh(new CircleGeometry(0.7, 20), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.scale.set(0.6, 1.4, 1);
  return m;
}
