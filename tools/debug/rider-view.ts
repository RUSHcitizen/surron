// Dev-only rider turntable: npx vite, then open /tools/debug/rider.html?a=0.8&pose=ride|rest|tumble&white=1
import { AmbientLight, Color, DirectionalLight, HemisphereLight, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Quaternion, Scene, Vector3, WebGLRenderer, ACESFilmicToneMapping, PCFSoftShadowMap } from 'three';
import { RiderModel } from '../../src/render/rider';
import { BikeModel } from '../../src/render/bikeModel';
import { computeVehicleSpec } from '../../src/vehicle/spec';
import { PRESETS, defaultBuild } from '../../src/vehicle/build';
import { PMREMGenerator } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
const q = new URLSearchParams(location.search);
const r = new WebGLRenderer({ antialias: true });
r.setSize(innerWidth, innerHeight);
r.toneMapping = ACESFilmicToneMapping;
r.shadowMap.enabled = true;
r.shadowMap.type = PCFSoftShadowMap;
document.body.appendChild(r.domElement);
const scene = new Scene();
scene.background = new Color(0x9db4c8);
scene.add(new HemisphereLight(0xcfe3ff, 0x6b6050, 1.2), new AmbientLight(0xffffff, 0.2));
const sun = new DirectionalLight(0xfff2e0, 2.6);
sun.position.set(3, 5, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
const ground = new Mesh(new PlaneGeometry(20, 20), new MeshStandardMaterial({ color: 0x8a8a86 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const build = q.get('preset') ? PRESETS.find((p) => p.id === q.get('preset'))! : defaultBuild();
// Studio reflections (the game uses its sky instead).
scene.environment = new PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const spec = computeVehicleSpec(build);
const bike = new BikeModel(build, spec);
const pose = q.get('pose') ?? 'ride';
bike.root.position.set(0, spec.front.radius + 0.35, 0);
if (q.get('bike') !== '0') scene.add(bike.root);
scene.add(bike.rider.root);
bike.root.updateMatrixWorld(true);
const rider: RiderModel = bike.rider;
if (q.get('white')) for (const c of rider.root.children) for (const m of ((c as Mesh).material as MeshStandardMaterial[])) { m.vertexColors = false; m.color.set(0xdddddd); }
const gl = new Vector3(), gr = new Vector3();
bike.update({ steer: Number(q.get('steer') ?? 0), frontComp: 0.05, rearComp: 0.05, frontAngle: 0, rearAngle: 0, riderShift: Number(q.get('shift') ?? 0), riderLat: 0, speed: 8, brake: 0, crashed: false, headlight: false });
bike.root.updateMatrixWorld(true);
bike.gripPositions(gl, gr);
if (pose === 'rest') { /* constructor rest pose */ rider.root.matrix.makeTranslation(0, 1.2, 0); rider.root.matrixWorldNeedsUpdate = true; } else if (pose === 'tumble') rider.tumble(new Vector3(0, 1, 0), new Quaternion());
else rider.pose(spec, (bike as unknown as { chassisGroup: { matrixWorld: Matrix4 } }).chassisGroup.matrixWorld, gl, gr, Number(q.get('shift') ?? 0), 0, Number(q.get('speed') ?? 8));
const cam = new PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 100);
const a = Number(q.get('a') ?? 0.8), d = Number(q.get('d') ?? 3), h = Number(q.get('h') ?? 1.4);
cam.position.set(Math.sin(a) * d, h, Math.cos(a) * d);
cam.lookAt(0, Number(q.get('ty') ?? 1.0), 0);
r.render(scene, cam);
(window as unknown as { done: boolean }).done = true;
const J = (rider as unknown as { j: Record<string, unknown> }).j;
console.log('JOINTS', JSON.stringify({ gl, gr, J }, (_k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)));
if (q.get('cpu')) {
  const body = rider.root.children[0] as unknown as { geometry: import('three').BufferGeometry; visible: boolean };
  const R = rider as unknown as { bones: { matrixWorld: Matrix4 }[]; data: { restInverse: Matrix4[] } };
  const g = body.geometry.clone();
  const pos = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  const mats = R.bones.map((b, i) => new Matrix4().multiplyMatrices(b.matrixWorld, R.data.restInverse[i]));
  const v = new Vector3(), o = new Vector3(), t = new Vector3();
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k);
    o.set(0, 0, 0);
    for (let qq = 0; qq < 4; qq++) o.addScaledVector(t.copy(v).applyMatrix4(mats[si.getComponent(k, qq)]), sw.getComponent(k, qq));
    pos.setXYZ(k, o.x, o.y, o.z);
  }
  g.deleteAttribute('skinIndex'); g.deleteAttribute('skinWeight');
  g.computeVertexNormals();
  const m = new Mesh(g, new MeshStandardMaterial({ color: 0xdddddd }));
  m.matrixAutoUpdate = false;
  m.matrix.copy(rider.root.matrix);
  scene.add(m);
  body.visible = false;
  r.render(scene, cam);
}
