/**
 * Procedural bike + rider model built from the same VehicleSpec the physics uses,
 * so every geometric change (wheel size, swingarm, fork, battery, gearing...) is visible.
 */
import {
  BoxGeometry, BufferGeometry, CapsuleGeometry, CatmullRomCurve3, Float32BufferAttribute, CircleGeometry, Curve, CylinderGeometry, DoubleSide, ExtrudeGeometry,
  Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, Quaternion,
  Shape, SphereGeometry, TorusGeometry, TubeGeometry, Vector2, Vector3,
} from 'three';
import type { Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BikeBuild } from '../vehicle/build';
import type { VehicleSpec, V3 } from '../vehicle/spec';
import { BODY_KITS, COOLING, DAMPERS, FENDERS, FINISHES, HANDGUARDS, LIGHTS, PEGS, RIM_STYLES, byId } from '../vehicle/parts';
import { liveryTexture, plateTexture, treadTexture } from './textures';
import { RiderModel } from './rider';
export { RiderModel };

const v = (p: V3) => new Vector3(p.x, p.y, p.z);
const UPY = new Vector3(0, 1, 0);
const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _bt = new Vector3();

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

/** Place a Y-aligned mesh (height `nominal`, centred) between two points. */
function between(m: Object3D, a: Vector3, b: Vector3, scaleXZ = 1, nominal = 1) {
  _bt.subVectors(b, a);
  const len = _bt.length();
  m.position.copy(a).addScaledVector(_bt, 0.5);
  if (len > 1e-6) m.quaternion.setFromUnitVectors(UPY, _bt.multiplyScalar(1 / len));
  m.scale.set(scaleXZ, Math.max(len, 1e-4) / nominal, scaleXZ);
}

/** Closed shape through `pts` with every corner rounded by up to `r` (smooth, no self-intersection). */
export function roundedShape(pts: [number, number][], r: number): Shape {
  const sh = new Shape();
  const n = pts.length;
  const P = pts.map(([x, y]) => new Vector2(x, y));
  for (let i = 0; i < n; i++) {
    const prev = P[(i + n - 1) % n], cur = P[i], next = P[(i + 1) % n];
    const d1 = cur.distanceTo(prev), d2 = cur.distanceTo(next);
    const rr = Math.min(r, d1 * 0.45, d2 * 0.45);
    const a = cur.clone().lerp(prev, rr / d1);
    const b = cur.clone().lerp(next, rr / d2);
    if (i === 0) sh.moveTo(a.x, a.y);
    else sh.lineTo(a.x, a.y);
    sh.quadraticCurveTo(cur.x, cur.y, b.x, b.y);
  }
  sh.closePath();
  return sh;
}

/**
 * Extrude a side-profile shape drawn in the bike's (z, y) plane across the bike (x), centred
 * on x = 0, with rounded (bevelled) edges. UVs are projected from the side so liveries read
 * correctly from both sides.
 */
export function sideExtrude(shape: Shape, width: number, bevel: number, curveSegments = 10): ExtrudeGeometry {
  const depth = Math.max(0.001, width - 2 * bevel);
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 4, curveSegments });
  // Shape x → bike z, extrusion → bike x.
  g.rotateY(-Math.PI / 2);
  g.translate(depth / 2, 0, 0);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const zr = bb.max.z - bb.min.z || 1, yr = bb.max.y - bb.min.y || 1;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const u = (z - bb.min.z) / zr;
    uv.setXY(i, x > 0 ? 1 - u : u, (y - bb.min.y) / yr);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A moulded plastic panel lofted along a centre-line in the bike's (z, y) side plane: at each
 * point the cross-section spans `width` across the bike and curls down at the edges by `sag`
 * (a U opening toward the wheel, like a real motocross fender), with `thick` wall thickness.
 * Closed (top, bottom, edges and ends) so it shades correctly from every side.
 */
export function loftPanel(path: [number, number][], width: (t: number) => number, sag: number, thick: number, across = 10): BufferGeometry {
  const curve = new CatmullRomCurve3(path.map(([z, y]) => new Vector3(0, y, z)));
  const N = Math.max(12, path.length * 8);
  const pts = curve.getSpacedPoints(N);
  const pos: number[] = [];
  const idx: number[] = [];
  const ring = (across + 1) * 2; // top + bottom per station
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = pts[i];
    const tan = curve.getTangentAt(Math.min(0.999, Math.max(0.001, t)));
    // Up-normal in the side plane (perpendicular to the tangent, pointing away from the wheel).
    const n = new Vector3(0, tan.z, -tan.y).normalize();
    if (n.y < 0) n.negate();
    const w = width(t);
    for (const layer of [0, 1]) {
      for (let k = 0; k <= across; k++) {
        const u = (k / across) * 2 - 1;
        const drop = sag * u * u + (layer ? thick : 0);
        pos.push(u * w * 0.5, p.y - n.y * drop, p.z - n.z * drop);
      }
    }
  }
  const at = (i: number, layer: number, k: number) => i * ring + layer * (across + 1) + k;
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < across; k++) {
      // Top (outer) and bottom (inner) skins, wound opposite ways.
      idx.push(at(i, 0, k), at(i + 1, 0, k), at(i, 0, k + 1), at(i + 1, 0, k), at(i + 1, 0, k + 1), at(i, 0, k + 1));
      idx.push(at(i, 1, k), at(i, 1, k + 1), at(i + 1, 1, k), at(i + 1, 1, k), at(i, 1, k + 1), at(i + 1, 1, k + 1));
    }
    // Side edges.
    for (const k of [0, across]) {
      const flip = k === 0;
      const a = at(i, 0, k), b = at(i + 1, 0, k), c = at(i, 1, k), d = at(i + 1, 1, k);
      if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  // End caps.
  for (const i of [0, N]) {
    for (let k = 0; k < across; k++) {
      const a = at(i, 0, k), b = at(i, 0, k + 1), c = at(i, 1, k), d = at(i, 1, k + 1);
      if (i === 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // Smooth normals on the welded mesh (soft, rounded rims), then unweld to merge with the rest.
  g.computeVertexNormals();
  const ni = g.toNonIndexed();
  g.dispose();
  return ni;
}

/** Coil spring along Y, centred, unit length. */
class Helix extends Curve<Vector3> {
  constructor(private r: number, private turns: number) {
    super();
  }
  getPoint(t: number, out = new Vector3()) {
    const a = t * Math.PI * 2 * this.turns;
    return out.set(Math.cos(a) * this.r, t - 0.5, Math.sin(a) * this.r);
  }
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
    const cool = byId(COOLING, build.parts.cooling);
    const damperPart = byId(DAMPERS, build.parts.damper);
    const pegPart = byId(PEGS, build.parts.pegs);
    const guards = byId(HANDGUARDS, build.parts.handguards);
    const rimStyle = byId(RIM_STYLES, build.parts.rimStyle).id;

    const gloss = 1 - Math.min(1, fin.roughness * 1.6);
    const paint = this.mat(new MeshPhysicalMaterial({ color: V.plasticColor, roughness: fin.roughness, metalness: fin.metalness, clearcoat: gloss, clearcoatRoughness: 0.12 }));
    const frameM = this.mat(new MeshStandardMaterial({ color: V.frameColor, roughness: 0.45, metalness: 0.6 }));
    const accent = this.mat(new MeshStandardMaterial({ color: V.accentColor, roughness: 0.35, metalness: 0.3 }));
    const dark = this.mat(new MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.7, metalness: 0.3 }));
    const alloy = this.mat(new MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.3, metalness: 0.85 }));
    const gold = this.mat(new MeshStandardMaterial({ color: 0xd4a72c, roughness: 0.25, metalness: 0.9 }));
    const rimM = this.mat(new MeshStandardMaterial({ color: V.rimColor, roughness: 0.3, metalness: 0.7 }));
    const seatM = this.mat(new MeshStandardMaterial({ color: V.seatColor, roughness: 0.85 }));
    const gripM = this.mat(new MeshStandardMaterial({ color: V.gripColor ?? '#1b1d22', roughness: 0.75 }));
    const forkM = this.mat(new MeshStandardMaterial({ color: V.forkColor ?? '#c0c4cc', roughness: 0.22, metalness: 0.9 }));
    const livery = this.mat(new MeshPhysicalMaterial({
      map: liveryTexture(V.plasticColor, V.decal, V.decalColor, V.accentColor, V.number),
      roughness: fin.roughness, metalness: fin.metalness * 0.5, clearcoat: gloss, clearcoatRoughness: 0.12,
    }));
    const plateM = this.mat(new MeshStandardMaterial({ map: plateTexture(V.number, V.plateColor, '#111111'), roughness: 0.5 }));

    this.root.add(this.chassis);
    this.chassis.position.set(-spec.com.x, -spec.com.y, -spec.com.z);

    // --- Frame tubes ---------------------------------------------------------
    const head = v(G.head), headTop = v(G.headTop);
    const tube = (pts: Vector3[], r: number, m: Material, x = 0) => {
      const curve = new CatmullRomCurve3(pts.map((p) => p.clone().setX(x)));
      const mesh = new Mesh(this.geo(new TubeGeometry(curve, 32, r, 12)), m);
      mesh.castShadow = true;
      this.chassis.add(mesh);
      return mesh;
    };
    const P = (z: number, y: number) => new Vector3(0, y, z);
    for (const x of [0.075, -0.075]) {
      tube([headTop, P(0.12, 0.47), P(-0.12, 0.41), P(-0.32, 0.38), P(-0.62, 0.37)], 0.018, frameM, x);
      tube([head, P(0.3, 0.12), P(0.16, -0.1), P(-0.02, -0.08), P(-0.03, 0.08), P(-0.18, 0.2), P(-0.42, 0.33)], 0.02, frameM, x);
    }
    const headTube = new Mesh(this.geo(new CylinderGeometry(0.032, 0.032, 0.22, 20)), frameM);
    between(headTube, head, headTop);
    headTube.scale.set(1, headTube.scale.y, 1);
    headTube.geometry.translate(0, 0, 0);
    this.chassis.add(headTube);
    if (build.parts.frame === 'reinforced') {
      for (const x of [0.085, -0.085]) tube([P(0.28, 0.4), P(0.2, 0.2), P(0.05, 0.05)], 0.012, frameM, x);
    }

    // --- Battery, motor, controller --------------------------------------------
    const bs = G.batterySize;
    // Battery case: a cast, rounded box with cooling ribs along its flanks (the lower half
    // shows below the bodywork, as on the Varg).
    const caseM = this.mat(new MeshStandardMaterial({ color: 0x2c3036, roughness: 0.42, metalness: 0.55 }));
    const bc = v(G.battery);
    const battery = new Mesh(this.geo(sideExtrude(roundedShape([[bs.z / 2, bs.y / 2], [bs.z / 2, -bs.y / 2], [-bs.z / 2, -bs.y / 2], [-bs.z / 2, bs.y / 2]], 0.045), bs.x, 0.018, 8)), caseM);
    battery.position.copy(bc);
    battery.castShadow = true;
    this.chassis.add(battery);
    for (let k = 0; k < 5; k++) {
      const rib = new Mesh(this.geo(new BoxGeometry(bs.x + 0.012, 0.008, bs.z * 0.78)), caseM);
      rib.position.copy(bc).add(new Vector3(0, -bs.y * 0.42 + k * bs.y * 0.075, -bs.z * 0.02));
      this.chassis.add(rib);
    }
    const motor = new Mesh(this.geo(new CylinderGeometry(G.motorRadius, G.motorRadius, 0.15, 36)), alloy);
    motor.rotation.z = Math.PI / 2;
    motor.position.copy(v(G.motor));
    motor.castShadow = true;
    this.chassis.add(motor);
    const motorCap = new Mesh(this.geo(new CylinderGeometry(G.motorRadius * 0.72, G.motorRadius * 0.78, 0.17, 32)), accent);
    motorCap.rotation.z = Math.PI / 2;
    motorCap.position.copy(motor.position);
    if (cool.style === 'fins') {
      // Radial heat-sink fins around the motor case.
      const finG = this.geo(new TorusGeometry(G.motorRadius + 0.006, 0.006, 6, 36));
      for (let k = -3; k <= 3; k++) {
        const fin = new Mesh(finG, alloy);
        fin.rotation.y = Math.PI / 2;
        fin.position.copy(motor.position).add(new Vector3(k * 0.02, 0, 0));
        this.chassis.add(fin);
      }
    } else if (cool.style === 'jacket') {
      const jacket = new Mesh(this.geo(new CylinderGeometry(G.motorRadius + 0.012, G.motorRadius + 0.012, 0.13, 36)), accent);
      jacket.rotation.z = Math.PI / 2;
      jacket.position.copy(motor.position);
      this.chassis.add(jacket);
      // Small radiator ahead of the battery, with hoses.
      const rad = new Mesh(this.geo(sideExtrude(roundedShape([[0.03, 0.09], [0.03, -0.09], [-0.01, -0.09], [-0.01, 0.09]], 0.01), 0.16, 0.006)), dark);
      rad.position.set(0, 0.12, (G.battery.z + G.batterySize.z / 2) + 0.05);
      this.chassis.add(rad);
      const hose = (a: Vector3, b: Vector3) => {
        const h = new Mesh(this.geo(new TubeGeometry(new CatmullRomCurve3([a, a.clone().lerp(b, 0.5).add(new Vector3(0, -0.04, 0.02)), b]), 12, 0.009, 6)), dark);
        this.chassis.add(h);
      };
      hose(new Vector3(0.05, 0.05, G.battery.z + G.batterySize.z / 2 + 0.05), new Vector3(0.06, G.motor.y + 0.04, G.motor.z + 0.02));
      hose(new Vector3(-0.05, 0.05, G.battery.z + G.batterySize.z / 2 + 0.05), new Vector3(-0.06, G.motor.y + 0.04, G.motor.z + 0.02));
    }
    this.chassis.add(motorCap);
    const ctrl = new Mesh(this.geo(new BoxGeometry(0.1, 0.06, 0.18)), dark);
    ctrl.position.set(0, 0.06, -0.12);
    this.chassis.add(ctrl);

    // --- Body panels (sculpted, rounded) -------------------------------------------
    const bp = v(G.battery);
    const z0 = bp.z - bs.z / 2, z1 = bp.z + bs.z / 2, y0 = bp.y - bs.y / 2, y1 = bp.y + bs.y / 2;
    const panelW = Math.max(bs.x + 0.05, 0.22);
    const addMesh = (geo: BufferGeometry, m: Material | Material[], parent: Object3D = this.chassis) => {
      const mesh = new Mesh(this.geo(geo), m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const seatEnd = G.seat.z - G.seatLength / 2;
    const seatFront = G.seat.z + G.seatLength / 2;
    if (kit.style !== 'race') {
      // One-piece side shroud wrapping the battery, rising toward the steering head.
      // The shroud covers the top and front of the pack and stops halfway down its flanks.
      const topF = Math.min(head.z - 0.02, z1 + 0.04);
      const ym = y0 + (y1 - y0) * 0.42;
      const shroud = roundedShape([
        [topF, Math.max(y1 + 0.12, head.y + 0.03)],
        [z1 + 0.045, (ym + y1) / 2 + 0.02],
        [z1 + 0.01, ym - 0.03],
        [(z0 + z1) / 2, ym - 0.005],
        [z0 + 0.03, ym + 0.05],
        [z0 - 0.03, y1 - 0.02],
        [Math.max(seatFront - 0.06, z0 + 0.04), y1 + 0.03],
        [(z1 + topF) / 2 - 0.04, y1 + 0.08],
      ], 0.06);
      addMesh(sideExtrude(shroud, panelW, 0.03, 12), livery);
      if (kit.style === 'armor') {
        addMesh(sideExtrude(roundedShape([[z1 + 0.04, y0 - 0.02], [z1 - 0.02, y0 - 0.11], [z0 + 0.02, y0 - 0.12], [z0 - 0.02, y0 - 0.04]], 0.04), panelW * 0.8, 0.015), alloy);
      }
    } else {
      // Race kit: a slim tank-style cover; the battery case shows below.
      const bat = addMesh(sideExtrude(roundedShape([[z1, y1], [z1, y0], [z0, y0], [z0, y1]], 0.04), bs.x, 0.02), dark);
      bat.position.y = 0;
      addMesh(sideExtrude(roundedShape([[head.z - 0.03, head.y + 0.02], [z1, y1 - 0.04], [z0 + 0.04, y1 - 0.02], [seatFront - 0.05, y1 + 0.06], [z1 - 0.06, y1 + 0.08]], 0.05), panelW * 0.85, 0.025), livery);
    }
    // Wings flanking the head tube.
    if (kit.style !== 'race') {
      for (const sd of [1, -1]) {
        const wing = addMesh(sideExtrude(roundedShape([[0.04, 0.12], [0.1, -0.08], [-0.08, -0.1], [-0.12, 0.06]], 0.035), 0.022, 0.008), accent);
        wing.position.set(sd * (panelW / 2 + 0.005), Math.max(y1 + 0.02, 0.38), Math.min(head.z - 0.08, z1));
        wing.rotation.set(0.15, sd * 0.18, 0);
      }
    }
    // Seat: long padded saddle.
    const sy = G.seat.y;
    const seatShape = roundedShape([
      [seatFront + 0.02, sy + 0.005], [seatFront - 0.1, sy + 0.05], [seatEnd + 0.02, sy + 0.055], [seatEnd - 0.03, sy + 0.035],
      [seatEnd, sy - 0.035], [seatFront - 0.05, sy - 0.04],
    ], 0.05);
    addMesh(sideExtrude(seatShape, 0.21, 0.04, 14), seatM);
    // Tail / rear fender blade sweeping back from under the seat.
    const rearFenderLen = fend.style === 'short' ? 0.3 : 0.52;
    // A moulded fender: U section, kicking up at the tail.
    addMesh(loftPanel([
      [seatEnd + 0.16, sy - 0.07], [seatEnd, sy - 0.035], [seatEnd - rearFenderLen * 0.55, sy + 0.005], [seatEnd - rearFenderLen, sy + 0.06],
    ], (t) => 0.235 - t * 0.075, 0.045, 0.006), paint);
    // Side number boards under the seat.
    for (const sd of [1, -1]) {
      const board = addMesh(sideExtrude(roundedShape([
        [seatEnd + 0.24, sy - 0.03], [seatEnd + 0.17, sy - 0.17], [seatEnd - 0.06, sy - 0.12], [seatEnd - 0.1, sy - 0.035],
      ], 0.03), 0.012, 0.004, 8), livery);
      board.position.x = sd * 0.1;
      board.rotation.y = sd * 0.06;
    }
    // Tail light
    const tail = addMesh(new CapsuleGeometry(0.014, 0.07, 4, 8), this.brakeLightMat);
    tail.rotation.z = Math.PI / 2;
    tail.position.set(0, sy - 0.025, seatEnd - rearFenderLen * 0.72);
    // Footpegs
    for (const s of [1, -1]) {
      const peg = new Mesh(this.geo(new CapsuleGeometry(0.014 * (pegPart.width / 0.05), 0.08 + (pegPart.width - 0.05), 3, 8)), alloy);
      peg.rotation.z = Math.PI / 2;
      peg.position.set(s * (G.peg.x + 0.04), G.peg.y, G.peg.z);
      this.chassis.add(peg);
    }

    // --- Steering assembly -------------------------------------------------------------
    this.steerAxis.set(spec.steering.axis.x, spec.steering.axis.y, spec.steering.axis.z).normalize();
    this.headPos.copy(head);
    this.steerG.position.copy(head);
    this.chassis.add(this.steerG);
    const clampMat = alloy;
    const guardM = this.mat(new MeshStandardMaterial({ color: V.plasticColor, roughness: fin.roughness + 0.15, side: DoubleSide }));
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
    // The anodised (coloured) tubes are the outer ones: uppers on an inverted fork, lowers otherwise.
    const upperM = G.invertedFork ? forkM : alloy;
    const lowerM = G.invertedFork ? alloy : forkM;
    for (const s of [1, -1]) {
      const up = new Mesh(this.geo(new CylinderGeometry(upperR, upperR, 1, 18)), upperM);
      const topP = headTop.clone().sub(head).add(new Vector3(s * 0.08, 0.02, 0));
      const botP = topP.clone().addScaledVector(this.steerAxis, -forkUpperLen - 0.22);
      between(up, topP, botP);
      up.castShadow = true;
      this.steerG.add(up);
      const low = new Mesh(this.geo(new CylinderGeometry(lowerR, lowerR, 1, 18)), lowerM);
      const a = axleRel.clone().add(new Vector3(s * 0.08, 0, 0));
      const b = a.clone().addScaledVector(this.steerAxis, spec.geo.forkLength * 0.55);
      between(low, a, b);
      low.castShadow = true;
      this.forkSlide.add(low);
      // Plastic fork guard over the front of the lower leg.
      const guard = new Mesh(this.geo(new CylinderGeometry(lowerR + 0.012, lowerR + 0.016, 1, 14, 1, true, Math.PI * 0.35, Math.PI * 1.3)), guardM);
      between(guard, a.clone().addScaledVector(this.steerAxis, 0.05), a.clone().addScaledVector(this.steerAxis, 0.32));
      this.forkSlide.add(guard);
    }
    this.steerG.add(this.forkSlide);
    // Handlebar
    const barC = v(G.barCenter).sub(head);
    const bar = new Mesh(this.geo(new CylinderGeometry(0.011, 0.011, G.barWidth, 12)), dark);
    bar.rotation.z = Math.PI / 2;
    bar.position.copy(barC);
    this.steerG.add(bar);
    // Crossbar pad in the middle of the bar.
    const pad = new Mesh(this.geo(new CapsuleGeometry(0.024, 0.13, 4, 10)), dark);
    pad.rotation.z = Math.PI / 2;
    pad.position.copy(barC).add(new Vector3(0, 0.022, 0));
    this.steerG.add(pad);
    const riser = new Mesh(this.geo(new CylinderGeometry(0.012, 0.012, 1, 8)), alloy);
    between(riser, headTop.clone().sub(head), barC);
    this.steerG.add(riser);
    for (const s of [1, -1]) {
      const grip = new Mesh(this.geo(new CapsuleGeometry(0.018, 0.1, 4, 12)), gripM);
      grip.rotation.z = Math.PI / 2;
      grip.position.copy(barC).add(new Vector3(s * (G.barWidth / 2 - 0.06), 0, 0));
      this.steerG.add(grip);
      const lever = new Mesh(this.geo(new BoxGeometry(0.14, 0.008, 0.02)), alloy);
      lever.position.copy(barC).add(new Vector3(s * (G.barWidth / 2 - 0.12), -0.01, 0.06));
      lever.rotation.y = s * 0.25;
      this.steerG.add(lever);
      if (guards.style !== 'none') {
        // Curved shield ahead of the grip; the wrap style also loops back to the bar.
        const gs = new Mesh(this.geo(sideExtrude(roundedShape([[0.09, 0.05], [0.07, -0.05], [-0.02, -0.03], [0.0, 0.06]], 0.03), 0.11, 0.01)), accent);
        gs.position.copy(barC).add(new Vector3(s * (G.barWidth / 2 - 0.05), 0, 0.02));
        gs.rotation.y = s * 0.12;
        this.steerG.add(gs);
        if (guards.style === 'wrap') {
          const loop = new Mesh(this.geo(new TorusGeometry(0.075, 0.007, 6, 20, Math.PI)), alloy);
          loop.position.copy(barC).add(new Vector3(s * (G.barWidth / 2 - 0.09), 0, 0.02));
          loop.rotation.set(Math.PI / 2, 0, s > 0 ? -Math.PI / 2 : Math.PI / 2);
          this.steerG.add(loop);
        }
      }
    }
    if (damperPart.damping > 0) {
      // Steering damper: a body bolted to the frame, its rod to the top clamp.
      const dBody = new Mesh(this.geo(new CapsuleGeometry(0.014, 0.12, 4, 10)), gold);
      dBody.rotation.z = Math.PI / 2;
      dBody.position.copy(headTop).add(new Vector3(0, 0.02, -0.07));
      this.chassis.add(dBody);
    }
    // Front plate / headlight / fairing
    const plateCenter = headTop.clone().sub(head).add(new Vector3(0, -0.12, 0.09));
    if (kit.style === 'fairing') {
      const fair = new Mesh(this.geo(sideExtrude(roundedShape([[0.08, 0.2], [0.02, -0.14], [-0.04, -0.12], [-0.02, 0.22]], 0.05), 0.34, 0.03, 12)), paint);
      fair.position.copy(plateCenter).add(new Vector3(0, 0.02, 0.0));
      fair.castShadow = true;
      this.steerG.add(fair);
      const screen = new Mesh(this.geo(new SphereGeometry(0.2, 20, 10, 0, Math.PI, 0, Math.PI * 0.32)), this.mat(new MeshPhysicalMaterial({ color: 0x334455, transparent: true, opacity: 0.4, roughness: 0.05, side: DoubleSide })));
      screen.position.copy(plateCenter).add(new Vector3(0, 0.08, -0.08));
      screen.rotation.set(-0.5, Math.PI / 2, 0);
      screen.rotateY(-Math.PI / 2);
      this.steerG.add(screen);
    } else {
      // Rounded number plate with the plate graphic on its face.
      const sh = roundedShape([[-0.125, 0.1], [-0.115, -0.095], [0.115, -0.095], [0.125, 0.1]], 0.04);
      const pg = new ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3, curveSegments: 8 });
      const uv = pg.getAttribute('uv'), pp = pg.getAttribute('position');
      for (let i = 0; i < pp.count; i++) uv.setXY(i, (pp.getX(i) + 0.125) / 0.25, (pp.getY(i) + 0.1) / 0.2);
      const plate = new Mesh(this.geo(pg), plateM);
      plate.position.copy(plateCenter).add(new Vector3(0, 0, -0.006));
      plate.rotation.x = -0.32;
      plate.castShadow = true;
      this.steerG.add(plate);
    }
    if (lights.style === 'round') {
      const hl = new Mesh(this.geo(new SphereGeometry(0.048, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)), this.headMat);
      hl.position.copy(plateCenter).add(new Vector3(0, -0.12, 0.03));
      hl.rotation.x = Math.PI / 2 - 0.32;
      this.steerG.add(hl);
    } else if (lights.style === 'bar') {
      const hl = new Mesh(this.geo(new CapsuleGeometry(0.018, 0.19, 4, 10)), this.headMat);
      hl.rotation.z = Math.PI / 2;
      hl.position.copy(plateCenter).add(new Vector3(0, -0.11, 0.03));
      this.steerG.add(hl);
    }
    this.lightAnchor.position.copy(plateCenter).add(new Vector3(0, 0, 0.05));
    this.lightTarget.position.copy(plateCenter).add(new Vector3(0, -1.2, 10));
    this.steerG.add(this.lightAnchor, this.lightTarget);
    // Front fender
    const fr = spec.front.radius;
    if (fend.style === 'high') {
      // Motocross front fender: bolted under the bottom clamp, arching over the tyre, a long
      // beak out front and a short tail, U-section throughout.
      const ff = new Mesh(this.geo(loftPanel([
        [-0.17, 0.015], [-0.06, -0.03], [0.08, -0.055], [0.26, -0.07], [0.43, -0.07], [0.47, -0.058],
      ], (t) => 0.13 + Math.sin(Math.PI * Math.min(1, t * 1.4)) * 0.05 - t * 0.04, 0.04, 0.006)), paint);
      ff.position.set(0, -0.035, 0);
      ff.castShadow = true;
      this.steerG.add(ff);
    } else {
      // Curved fender hugging the tyre (an annular arc, extruded across the wheel).
      const arc = Math.PI * (fend.style === 'short' ? 0.32 : 0.46);
      const r0 = fr + 0.03, r1 = fr + 0.045;
      const start = Math.PI / 2 - arc * 0.3;
      const sh = new Shape();
      const N = 16;
      for (let i = 0; i <= N; i++) {
        const a = start + (arc * i) / N;
        const p = [Math.cos(a) * r1, Math.sin(a) * r1];
        if (i === 0) sh.moveTo(p[0], p[1]); else sh.lineTo(p[0], p[1]);
      }
      for (let i = N; i >= 0; i--) {
        const a = start + (arc * i) / N;
        sh.lineTo(Math.cos(a) * r0, Math.sin(a) * r0);
      }
      sh.closePath();
      const ff = new Mesh(this.geo(sideExtrude(sh, 0.13, 0.006, 4)), paint);
      ff.castShadow = true;
      ff.position.copy(axleRel);
      this.forkSlide.add(ff);
    }

    // --- Wheels -------------------------------------------------------------------
    const makeWheel = (radius: number, rimR: number, width: number, tread: string, rotor: number) => {
      const g = new Group();
      const rc = Math.min(radius * 0.35, width * 0.45);
      const tireTex = treadTexture(tread);
      tireTex.repeat.set(1, 6);
      const tireM = this.mat(new MeshStandardMaterial({ color: 0x18191b, roughness: 0.92, bumpMap: tireTex, bumpScale: 2 }));
      const tire = new Mesh(this.geo(new TorusGeometry(radius - rc, rc, 16, 64)), tireM);
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
      const rim = new Mesh(this.geo(new TorusGeometry(rimR, 0.015, 10, 56)), rimM);
      rim.rotation.y = Math.PI / 2;
      g.add(rim);
      const hub = new Mesh(this.geo(new CylinderGeometry(0.045, 0.045, width * 0.9 + 0.05, 20)), alloy);
      hub.rotation.z = Math.PI / 2;
      g.add(hub);
      if (rimStyle === 'disc') {
        const disc = new Mesh(this.geo(new CylinderGeometry(rimR, rimR, 0.03, 48)), rimM);
        disc.rotation.z = Math.PI / 2;
        g.add(disc);
      } else {
        const n = rimStyle === 'spoke' ? 18 : rimStyle === 'cast' ? 6 : 5;
        const r = rimStyle === 'spoke' ? 0.0025 : 0.012;
        // All spokes merged into one mesh (one draw call per wheel).
        const list: BufferGeometry[] = [];
        const m4 = new Matrix4();
        for (let i = 0; i < n; i++) {
          const sg = new CylinderGeometry(r, r * (rimStyle === 'spoke' ? 1 : 1.6), rimR - 0.04, 6);
          const a = (i / n) * Math.PI * 2;
          m4.makeRotationX(a).setPosition(rimStyle === 'spoke' ? (i % 2 ? 0.015 : -0.015) : 0, Math.cos(a) * (rimR / 2 + 0.02), Math.sin(a) * (rimR / 2 + 0.02));
          sg.applyMatrix4(m4);
          list.push(sg);
        }
        const merged = this.geo(mergeGeometries(list, false)!);
        list.forEach((x) => x.dispose());
        g.add(new Mesh(merged, rimStyle === 'spoke' ? alloy : rimM));
      }
      // Brake rotor: a polished ring on a dark carrier.
      const disc = new Mesh(this.geo(new TorusGeometry(rotor / 2 - 0.018, 0.019, 3, 48)), alloy);
      disc.rotation.y = Math.PI / 2;
      disc.scale.set(1, 1, 0.14);
      disc.position.x = -0.06;
      g.add(disc);
      const carrier = new Mesh(this.geo(new CylinderGeometry(rotor * 0.3, rotor * 0.3, 0.008, 5)), dark);
      carrier.rotation.z = Math.PI / 2;
      carrier.position.x = -0.06;
      g.add(carrier);
      return g;
    };
    const fw = makeWheel(spec.front.radius, spec.front.rimRadius, spec.front.width, spec.front.tire.tread, 0.26);
    this.frontWheel.add(fw);
    this.frontWheel.position.copy(axleRel);
    this.forkSlide.add(this.frontWheel);
    const caliperF = new Mesh(this.geo(new CapsuleGeometry(0.026, 0.05, 4, 10)), accent);
    caliperF.position.copy(axleRel).add(new Vector3(-0.07, 0.07, -0.06));
    this.forkSlide.add(caliperF);

    this.rearExt.copy(v(G.rearAxleExt));
    this.rearAxis.set(spec.rear.axis.x, spec.rear.axis.y, spec.rear.axis.z).normalize();
    const rw = makeWheel(spec.rear.radius, spec.rear.rimRadius, spec.rear.width, spec.rear.tire.tread, 0.2);
    this.rearWheel.add(rw);
    this.chassis.add(this.rearWheel);
    // Rear sprocket on the wheel (size follows the tooth count)
    this.rearSprocketR = build.tuning.rearSprocket * 0.0021;
    const rs = new Mesh(this.geo(new CylinderGeometry(this.rearSprocketR, this.rearSprocketR, 0.006, 48)), alloy);
    rs.rotation.z = Math.PI / 2;
    rs.position.x = 0.07;
    rw.add(rs);

    // Swingarm (scaled to the live axle distance)
    this.chassis.add(this.swingarm);
    this.swingarm.add(this.armScale);
    for (const s of [1, -1]) {
      // Cast-aluminium arm: deep at the pivot, tapering to the axle.
      const arm = new Mesh(this.geo(sideExtrude(roundedShape([[0.05, 0.045], [0.04, -0.05], [-0.5, -0.034], [-1.02, -0.024], [-1.02, 0.024], [-0.5, 0.036]], 0.02), 0.036, 0.009, 6)), alloy);
      arm.position.set(s * 0.085, 0, 0);
      arm.castShadow = true;
      this.armScale.add(arm);
    }
    // Front sprocket / chain
    this.frontSprocketR = build.tuning.frontSprocket * 0.0021;
    this.frontSprocketPos.set(0.07, -0.02, 0.05);
    const fs = new Mesh(this.geo(new CylinderGeometry(this.frontSprocketR, this.frontSprocketR, 0.008, 24)), dark);
    fs.rotation.z = Math.PI / 2;
    fs.position.copy(this.frontSprocketPos);
    this.chassis.add(fs);
    const chainGeo = this.geo(new CylinderGeometry(0.004, 0.004, 1, 4));
    this.chainTop = new Mesh(chainGeo, dark);
    this.chainBot = new Mesh(chainGeo, dark);
    this.chassis.add(this.chainTop, this.chainBot);
    // Shock
    this.shockTop.copy(v(G.shockTop));
    this.shock = new Mesh(this.geo(new CylinderGeometry(0.02, 0.02, 1, 16)), alloy);
    this.spring = new Mesh(this.geo(new TubeGeometry(new Helix(0.032, 9), 180, 0.0055, 6)), this.mat(new MeshStandardMaterial({ color: V.accentColor, roughness: 0.35, metalness: 0.5 })));
    this.chassis.add(this.shock, this.spring);

    // Fewer draw calls: merge the static meshes of each rigid group by material.
    for (const grp of [this.chassis, this.steerG, this.forkSlide, fw, rw]) this.mergeStatic(grp, [this.shock, this.spring, this.chainTop, this.chainBot]);
    this.root.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = true;
    });
    this.update({ steer: 0, frontComp: spec.front.travel * 0.3, rearComp: spec.rear.travel * 0.3, frontAngle: 0, rearAngle: 0, riderShift: 0, riderLat: 0, speed: 0, brake: 0, crashed: false, headlight: true });
  }

  /** Merge a group's direct, non-instanced Mesh children that share a material into one mesh. */
  private mergeStatic(group: Object3D, exclude: Object3D[]) {
    const byMat = new Map<Material, Mesh[]>();
    for (const c of group.children) {
      const m = c as Mesh;
      if (!m.isMesh || (m as unknown as InstancedMesh).isInstancedMesh || exclude.includes(m) || Array.isArray(m.material)) continue;
      const mat = m.material as Material;
      let l = byMat.get(mat);
      if (!l) byMat.set(mat, (l = []));
      l.push(m);
    }
    for (const [mat, list] of byMat) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        let g = m.geometry.clone().applyMatrix4(m.matrix);
        if (g.index) g = g.toNonIndexed();
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
        if (!g.getAttribute('uv')) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
        g.clearGroups();
        return g;
      });
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      for (const m of list) group.remove(m);
      const mm = new Mesh(this.geo(merged), mat);
      mm.castShadow = mm.receiveShadow = true;
      group.add(mm);
    }
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

/** Nominal limb lengths (m); capsules are built at these lengths and stretched slightly by IK. */
/** A flat shadow-catcher-free blob under the bike for low quality mode. */
export function blobShadow(): Mesh {
  const m = new Mesh(new CircleGeometry(0.7, 20), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.scale.set(0.6, 1.4, 1);
  return m;
}
