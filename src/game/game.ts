/**
 * Game: owns the renderer, world, bike, systems and the main loop.
 * Physics runs at a fixed step (TUNING.dt); rendering interpolates between steps.
 */
import {
  ACESFilmicToneMapping, DirectionalLight, Fog, HemisphereLight, Matrix4, PCFShadowMap, PCFSoftShadowMap, PerspectiveCamera,
  PMREMGenerator, Quaternion, Scene, SpotLight, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import type { WebGLRenderTarget } from 'three';
import { BikeDynamics, emptyInput } from '../physics/bike';
import { TUNING, SURFACE_PROPS } from '../physics/tuning';
import { computeVehicleSpec } from '../vehicle/spec';
import type { VehicleSpec } from '../vehicle/spec';
import type { BikeBuild, RideMode } from '../vehicle/build';
import { cloneBuild } from '../vehicle/build';
import { CollisionWorld } from '../world/collision';
import { generateWorld } from '../world/layout';
import type { WorldData } from '../world/layout';
import { WorldView } from '../render/worldView';
import type { Quality } from '../render/worldView';
import { BikeModel } from '../render/bikeModel';
import { Particles, TireMarks } from '../render/effects';
import { Grass } from '../render/grass';
import { Birds } from '../render/birds';
import { ChaseCamera } from '../camera/chaseCamera';
import { Input } from '../input/input';
import { TouchControls } from '../input/touch';
import { AudioEngine } from '../audio/audio';
import { Scorer } from '../gameplay/scoring';
import { CHALLENGES, ChallengeRun } from '../gameplay/challenges';
import type { ChallengeDef } from '../gameplay/challenges';
import { Pedestrians } from '../world/pedestrians';
import type { PedStand } from '../world/pedestrians';
import { SaveSystem } from '../save/save';
import type { Settings } from '../save/save';
import { UI } from '../ui/ui';

export type GameState = 'menu' | 'ride' | 'pause' | 'garage';

const QUALITY: Record<Settings['quality'], Quality> = {
  low: { shadows: false, shadowSize: 512, trees: 180, pixelRatio: 1, drawDistance: 260 },
  medium: { shadows: true, shadowSize: 1024, trees: 340, pixelRatio: 1.5, drawDistance: 380 },
  high: { shadows: true, shadowSize: 2048, trees: 520, pixelRatio: 2, drawDistance: 520 },
};

const GRASS_MAX = 7000;
const CITY_PEDS = 100;
const _v = new Vector3(), _v2 = new Vector3(), _m = new Matrix4(), _gl = new Vector3(), _gr = new Vector3();

export class Game {
  renderer: WebGLRenderer;
  scene = new Scene();
  camera = new PerspectiveCamera(62, 1, 0.1, 1200);
  sun = new DirectionalLight(0xffffff, 2.6);
  hemi = new HemisphereLight(0xcfe3ff, 0x5a5040, 1.1);
  headlight = new SpotLight(0xfff2dd, 0, 60, 0.5, 0.45, 1.4);
  data: WorldData;
  world: CollisionWorld;
  view: WorldView;
  bike: BikeDynamics;
  model: BikeModel;
  spec: VehicleSpec;
  build: BikeBuild;
  cam: ChaseCamera;
  input: Input;
  touch: TouchControls;
  audio = new AudioEngine();
  scorer = new Scorer();
  marks: TireMarks;
  particles: Particles;
  peds: Pedestrians;
  grass: Grass;
  birds: Birds;
  private wet = { under: 0, splashed: false, dry: { x: 0, z: 0, yaw: 0, ok: false } };
  /** Pedestrian groups with a bounding circle for distance culling. */
  crowds: { peds: Pedestrians; cx: number; cz: number; r: number }[] = [];
  save = new SaveSystem();
  ui!: UI;
  state: GameState = 'menu';
  challenge: ChallengeRun | null = null;
  headlightOn = true;
  hudVisible = true;
  fps = 60;
  time = 0;
  private acc = 0;
  private last = 0;
  private renderPos = new Vector3();
  private renderQuat = new Quaternion();
  private distanceSaveTimer = 0;
  private launch = { armed: false, t: 0, done: false };
  private frameTimes: number[] = [];
  private collected = new Set<string>();
  quality: Quality = QUALITY.high;
  private contextLost = false;
  /** Adaptive resolution: current pixel ratio between min and the quality preset's max. */
  private dynPR = 1;
  private perf = { t: 0, frames: 0, slow: 0, cooldown: 0, ceiling: 99 };
  onFrame: ((dt: number) => void) | null = null;

  constructor(private container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'game-canvas';
    this.input = new Input(this.renderer.domElement);
    this.touch = new TouchControls(this.input, container);
    this.data = generateWorld();
    this.world = new CollisionWorld(this.data.terrain);
    for (const b of this.data.boxes) this.world.addBox(b);
    this.view = new WorldView(this.data, this.quality);
    this.scene.add(this.view.root);
    this.grass = new Grass(this.data.terrain, GRASS_MAX);
    this.scene.add(this.grass.mesh);
    this.birds = new Birds();
    this.scene.add(this.birds.mesh);
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.scene.fog = new Fog(0xcfe3f2, 120, 520);
    this.build = cloneBuild(this.save.selectedBuild);
    this.spec = computeVehicleSpec(this.build);
    this.bike = new BikeDynamics(this.spec, this.world);
    this.model = new BikeModel(this.build, this.spec);
    this.scene.add(this.model.root, this.model.rider.root);
    this.scene.add(this.headlight);
    this.marks = new TireMarks(this.scene);
    this.particles = new Particles(this.scene);
    const ground = (x: number, z: number) => this.world.groundHeight(x, z, 1.5);
    this.peds = new Pedestrians(this.data.pedPaths, CITY_PEDS, ground);
    this.scene.add(this.peds.root);
    // Spectator crowds, one per area so each can be skipped (update + draw) when far away.
    const areas = new Map<string, PedStand[]>();
    for (const st of this.data.decor.spectators) {
      const key = st.x > 90 && st.z > 20 && st.z < 130 ? 'stunt' : Math.hypot(st.x - 20, st.z) < 90 ? 'hub' : `track${Math.floor(st.z / 150)}`;
      (areas.get(key) ?? areas.set(key, []).get(key)!).push(st);
    }
    let seed = 7;
    for (const list of areas.values()) {
      const peds = new Pedestrians([], 0, ground, list, seed++);
      const cx = list.reduce((a, q) => a + q.x, 0) / list.length, cz = list.reduce((a, q) => a + q.z, 0) / list.length;
      const r = Math.max(...list.map((q) => Math.hypot(q.x - cx, q.z - cz)));
      this.crowds.push({ peds, cx, cz, r });
      this.scene.add(peds.root);
    }
    // The city crowd spans the city and hub.
    this.crowds.unshift({ peds: this.peds, cx: -165, cz: 0, r: 240 });
    this.cam = new ChaseCamera(this.camera, this.world);
    // iOS reports the new size late after rotation / toolbar changes, so resize again shortly after.
    const deferResize = () => {
      this.resize();
      setTimeout(() => this.resize(), 120);
      setTimeout(() => this.resize(), 500);
    };
    window.addEventListener('resize', deferResize);
    window.addEventListener('orientationchange', deferResize);
    window.visualViewport?.addEventListener('resize', deferResize);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.ui?.toast('Graphics were paused by the system — restoring…', 4000);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.applySettings();
    });
    window.addEventListener('blur', () => this.touch.releaseAll());
    window.addEventListener('pagehide', () => void this.save.saveNow());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.touch.releaseAll();
        if (this.state === 'ride') this.setState('pause');
        this.audio.suspend();
        // iOS freezes backgrounded apps almost immediately: write now, not debounced.
        this.progressSave();
        void this.save.saveNow();
      } else this.audio.resume();
    });
    this.resize();
  }

  async init() {
    await this.save.load();
    this.ui = new UI(this);
    this.build = cloneBuild(this.save.selectedBuild);
    this.applyBuild(this.build, false);
    this.applySettings();
    this.collected = new Set(this.save.data.progress.collected);
    this.view.setCollected(this.collected);
    this.ui.seedAnnounced();
    this.respawn('hub');
    this.setState('menu');
    if (this.save.warning) this.ui.toast(this.save.warning, 6000);
    // Compile every shader now (behind the loading screen) so nothing stutters on first sight.
    try {
      this.renderer.compile(this.scene, this.camera);
    } catch { /* best effort */ }
    requestAnimationFrame(this.frame);
  }

  get settings() {
    return this.save.data.settings;
  }

  applySettings() {
    const s = this.settings;
    this.quality = QUALITY[s.quality];
    this.dynPR = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    this.perf.ceiling = 99;
    this.renderer.setPixelRatio(this.dynPR);
    this.renderer.shadowMap.enabled = this.quality.shadows;
    // Soft (many-tap) shadow filtering only on High; Medium uses plain PCF, much cheaper on phones.
    const shadowType = s.quality === 'high' ? PCFSoftShadowMap : PCFShadowMap;
    if (this.renderer.shadowMap.type !== shadowType) {
      this.renderer.shadowMap.type = shadowType;
      // Shaders bake the shadow filter in: recompile on change.
      this.scene.traverse((o) => {
        const m = (o as { material?: { needsUpdate: boolean } | { needsUpdate: boolean }[] }).material;
        if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
        else if (m) m.needsUpdate = true;
      });
    }
    this.sun.castShadow = this.quality.shadows;
    this.sun.shadow.mapSize.set(this.quality.shadowSize, this.quality.shadowSize);
    this.sun.shadow.map?.dispose();
    (this.sun.shadow as { map: unknown }).map = null;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -35;
    sc.right = sc.top = 35;
    sc.near = 1;
    sc.far = 200;
    sc.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.grass.setCount(s.quality === 'low' ? 0 : s.quality === 'medium' ? 3800 : GRASS_MAX);
    this.particles.budget = s.quality === 'low' ? 0.4 : s.quality === 'medium' ? 0.75 : 1;
    const pedShare = !s.pedestrians ? 0 : s.quality === 'low' ? 0.35 : s.quality === 'medium' ? 0.65 : 1;
    this.peds.setCount(Math.round(CITY_PEDS * pedShare));
    for (const c of this.crowds) if (c.peds !== this.peds) c.peds.setCount(Math.ceil(c.peds.peds.length * pedShare));
    this.camera.far = Math.max(this.quality.drawDistance + 400, 950);
    this.view.cullDistance = this.quality.drawDistance;
    (this.scene.fog as Fog).far = this.quality.drawDistance;
    (this.scene.fog as Fog).near = this.quality.drawDistance * 0.25;
    this.bike.assist = s.assist;
    this.bike.crashRule = s.crashes;
    this.bike.pt.drain = s.drain;
    this.bike.pt.mode = s.rideMode;
    this.cam.distance = s.camDistance;
    this.cam.sensitivity = s.camSensitivity;
    this.input.steerSensitivity = s.steerSensitivity;
    this.input.bindings = this.save.data.bindings;
    this.audio.volumes = { master: s.master, motor: s.motor, sfx: s.sfx, ambience: s.ambience };
    this.audio.applyVolumes();
    this.touch.setLeftHanded(s.leftHanded);
    this.setTimeOfDay(s.timeOfDay);
    this.updateTouchVisibility();
    if (this.perfLevel) this.applyPerfLevel();
    this.resize();
  }

  updateTouchVisibility() {
    const t = this.settings.touchControls;
    const coarse = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    const show = this.state === 'ride' && (t === 'on' || (t === 'auto' && (coarse || this.input.lastDevice === 'touch')));
    this.touch.setVisible(show);
  }

  setTimeOfDay(mode: Settings['timeOfDay']) {
    const dir = mode === 'day' ? new Vector3(0.5, 0.72, 0.38) : mode === 'sunset' ? new Vector3(-0.8, 0.2, 0.4) : new Vector3(0.3, 0.5, -0.4);
    dir.normalize();
    this.view.setTimeOfDay(mode, dir);
    this.sunDir.copy(dir);
    this.bakeEnvironment();
    const fog = this.scene.fog as Fog;
    if (mode === 'day') {
      this.sun.color.set(0xfff1dc); this.sun.intensity = 2.9;
      this.hemi.color.set(0xcfe3ff); this.hemi.groundColor.set(0x5a5040); this.hemi.intensity = 0.45;
      fog.color.set(0xc6dbec); this.renderer.toneMappingExposure = 0.88;
    } else if (mode === 'sunset') {
      this.sun.color.set(0xffa860); this.sun.intensity = 2.2;
      this.hemi.color.set(0x8d8fb8); this.hemi.groundColor.set(0x4a3a30); this.hemi.intensity = 0.35;
      fog.color.set(0xd9a477); this.renderer.toneMappingExposure = 1.05;
    } else {
      this.sun.color.set(0x8fa6d6); this.sun.intensity = 0.35;
      this.hemi.color.set(0x334466); this.hemi.groundColor.set(0x111318); this.hemi.intensity = 0.25;
      fog.color.set(0x0b0f18); this.renderer.toneMappingExposure = 1.15;
    }
    this.grass.setLighting(this.sun.color, this.sun.intensity, this.hemi.color, this.hemi.intensity + (mode === 'night' ? 0.1 : 0.6));
    this.headlight.intensity = mode === 'night' ? 60 * this.spec.headlight : mode === 'sunset' ? 18 * this.spec.headlight : 0;
    this.headlight.visible = this.headlight.intensity > 0;
  }
  private sunDir = new Vector3(0.45, 0.85, 0.3).normalize();
  private pmrem: PMREMGenerator | null = null;
  private envRT: WebGLRenderTarget | null = null;

  /** Bake the current sky into a prefiltered environment map (reflections + soft ambient). */
  private bakeEnvironment() {
    this.pmrem ??= new PMREMGenerator(this.renderer);
    const { scene, dispose } = this.view.envScene();
    const rt = this.pmrem.fromScene(scene, 0.02, 0.1, 500);
    dispose();
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = this.settings.timeOfDay === 'night' ? 0.35 : 0.85;
    this.ui?.garage?.setEnvironment(rt.texture);
  }

  /** Switch the active bike to a build (updates physics and model, keeps position). */
  applyBuild(b: BikeBuild, keepPose = true) {
    this.build = cloneBuild(b);
    this.spec = computeVehicleSpec(this.build);
    this.bike.setSpec(this.spec);
    this.bike.assist = this.settings.assist;
    this.bike.pt.drain = this.settings.drain;
    this.bike.pt.mode = this.settings.rideMode;
    this.model.rebuild(this.build, this.spec);
    this.setTimeOfDay(this.settings.timeOfDay);
    if (keepPose) this.bike.place(this.bike.pos.x, this.bike.pos.z, this.bike.yaw, this.bike.pos.y);
  }

  respawn(where: string) {
    const s = this.data.spawns[where] ?? this.data.spawns.hub;
    this.bike.place(s.x, s.z, s.yaw);
    this.cam.snap();
    this.marks.clear();
    this.particles.clear();
    this.scorer.reset();
    this.launch = { armed: false, t: 0, done: false };
  }

  setState(s: GameState) {
    const prev = this.state;
    this.state = s;
    this.input.enabled = s === 'ride';
    this.input.clearEdges();
    if (s === 'ride' && prev !== 'ride') {
      this.acc = 0;
      this.audio.resume();
    }
    if (s !== 'ride' && s !== 'menu') this.audio.quiet();
    this.updateTouchVisibility();
    this.ui?.onState(s, prev);
  }

  startChallenge(def: ChallengeDef) {
    this.respawn(def.spawn);
    this.challenge = new ChallengeRun(def, { bike: this.bike, data: this.data, scorer: this.scorer, view: this.view });
    this.setState('ride');
  }

  endChallenge() {
    this.challenge = null;
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles.setViewport(h * this.renderer.getPixelRatio());
    this.ui?.garage?.resize(w, h);
  }

  private frame = (tms: number) => {
    requestAnimationFrame(this.frame);
    const now = tms / 1000;
    let dt = this.last ? now - this.last : 1 / 60;
    this.last = now;
    if (dt > 0.1) dt = 0.1;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 30) this.frameTimes.shift();
    this.fps = this.frameTimes.length / this.frameTimes.reduce((a, b) => a + b, 0);
    this.time += dt;
    if (this.contextLost) return;
    // One bad frame must never stop the game: catch, report once, keep running.
    try {
      this.adaptResolution(dt);
      if (this.state === 'garage') {
        this.ui.garage.update(dt);
        this.ui.garage.render(this.renderer);
        return;
      }
      this.input.update(dt, this.bike.speed);
      if (this.state === 'ride') this.rideUpdate(dt);
      else if (this.state === 'menu') this.menuUpdate(dt);
      this.renderer.render(this.scene, this.camera);
      this.onFrame?.(dt);
    } catch (e) {
      this.reportError(e);
      // A physics blow-up (NaN) is recoverable: put the bike back on its last safe spot.
      if (!Number.isFinite(this.bike.pos.x + this.bike.pos.y + this.bike.pos.z)) {
        this.bike.reset();
        this.cam.snap();
      }
    }
  };

  private errorCount = 0;
  /** Show an error on screen (once per message) so it can be reported, without stopping the game. */
  reportError(e: unknown) {
    this.errorCount++;
    const msg = e instanceof Error ? e.message : String(e);
    console.error(e);
    if (this.errorCount <= 3) this.ui?.toast(`Something went wrong (${msg.slice(0, 80)}). The game kept running.`, 5000);
  }

  /**
   * Keep frame rate up on phones: drop the render resolution when frames are slow, creep back
   * up when there is headroom. A resolution that proved too slow becomes a ceiling, so the
   * game does not oscillate. Only runs while riding (menus/garage are not representative).
   */
  private adaptResolution(dt: number) {
    if (this.state !== 'ride' || !this.settings.adaptiveResolution) return;
    const p = this.perf;
    p.t += dt;
    p.frames++;
    if (dt > 1 / 45) p.slow++;
    if (p.cooldown > 0) p.cooldown -= dt;
    if (p.t < 2) return;
    const slowFrac = p.slow / p.frames;
    p.t = p.frames = p.slow = 0;
    if (p.cooldown > 0) return;
    const max = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio, p.ceiling);
    const min = Math.min(max, this.settings.quality === 'low' ? 0.85 : 1);
    let next = this.dynPR;
    if (slowFrac > 0.25 && this.dynPR <= min + 0.01) {
      // Already at the lowest resolution and still slow: shed the most expensive extras.
      this.degrade();
      p.cooldown = 2;
      return;
    }
    if (slowFrac > 0.25) {
      p.ceiling = Math.min(p.ceiling, this.dynPR - 0.01);
      next = Math.max(min, this.dynPR * 0.8);
    } else if (slowFrac < 0.02 && this.dynPR < max) next = Math.min(max, this.dynPR + 0.1);
    if (Math.abs(next - this.dynPR) > 0.01) {
      this.dynPR = next;
      this.renderer.setPixelRatio(next);
      this.resize();
      p.cooldown = 2;
    }
  }

  /** Performance safety net level (0 = as configured). Session only; Settings are unchanged. */
  perfLevel = 0;
  private degrade() {
    if (this.perfLevel >= 3) return;
    this.perfLevel++;
    this.applyPerfLevel();
    if (this.perfLevel === 1) this.ui.toast('Lowering some effects to keep the game smooth', 2500);
  }

  private applyPerfLevel() {
    const L = this.perfLevel;
    if (L >= 1) this.grass.setCount(0);
    if (L >= 2) {
      this.renderer.shadowMap.enabled = false;
      this.sun.castShadow = false;
    }
    if (L >= 3) {
      for (const c of this.crowds) c.peds.setCount(Math.ceil(c.peds.peds.length * 0.3));
      this.view.cullDistance = Math.min(this.view.cullDistance, 240);
      const fog = this.scene.fog as Fog;
      fog.far = Math.min(fog.far, 260);
      fog.near = Math.min(fog.near, 70);
    }
  }

  get renderScale() {
    return this.dynPR;
  }

  private menuUpdate(dt: number) {
    // Idle bike with a slow orbiting camera behind the menu.
    this.bike.step(emptyInput());
    this.syncModel(1);
    const a = this.time * 0.15;
    const p = this.renderPos;
    this.camera.position.set(p.x + Math.sin(a) * 5, p.y + 1.4, p.z + Math.cos(a) * 5);
    this.camera.lookAt(p.x, p.y + 0.3, p.z);
    this.updateEnvironment(dt);
    this.audio.update({ rpm: 0, load: 0, speed: 0, slip: 0, surface: 'concrete', grounded: true, distance: 6, whine: 1, pwm: 1, city: 0.6, paused: true }, dt);
  }

  private rideUpdate(dt: number) {
    const inp = this.input;
    if (inp.consume('pause')) return this.setState('pause');
    if (inp.consume('garage')) {
      this.ui.openGarage();
      return;
    }
    if (inp.consume('reset')) {
      this.bike.reset();
      this.cam.snap();
    }
    if (inp.consume('camera')) {
      this.cam.cycle();
      this.ui.toast(`Camera: ${this.cam.mode}`);
    }
    if (inp.consume('mode')) {
      const modes: RideMode[] = ['eco', 'standard', 'sport', 'hyper'];
      const m = modes[(modes.indexOf(this.bike.pt.mode) + 1) % modes.length];
      this.bike.pt.mode = m;
      this.settings.rideMode = m;
      this.save.save();
      this.ui.toast(`Ride mode: ${m.toUpperCase()}`);
    }
    if (inp.consume('hud')) this.hudVisible = !this.hudVisible;
    if (inp.consume('lights')) {
      this.headlightOn = !this.headlightOn;
      this.ui.toast(`Headlight ${this.headlightOn ? 'on' : 'off'}`);
    }
    const o = inp.readOrbit();
    this.cam.orbit(o.dx, o.dy, o.wheel);
    if (o.wheel) {
      this.settings.camDistance = this.cam.distance;
    }

    // --- Fixed-step physics ---
    this.acc += dt;
    let steps = 0;
    const bInput = { ...inp.state };
    while (this.acc >= TUNING.dt && steps < 40) {
      this.bike.step(bInput);
      this.acc -= TUNING.dt;
      steps++;
    }
    if (steps >= 40) this.acc = 0;
    const alpha = this.acc / TUNING.dt;
    this.syncModel(alpha);

    // Events
    for (const e of this.bike.events) {
      if (e.type === 'land') {
        this.audio.impact(Math.min(1, e.strength / 4 + 0.2), 'land', e.surface);
        this.cam.bump(Math.min(0.6, e.strength / 8));
        const p = this.bike.rear.contact;
        const c = SURFACE_PROPS[e.surface];
        for (let i = 0; i < 14 * c.dust; i++) {
          this.particles.emit(p, _v.set((Math.random() - 0.5) * 3, Math.random() * 1.2, (Math.random() - 0.5) * 3), c.color, 0.5, 1.2, { grow: 1.4, drag: 2 });
        }
      } else if (e.type === 'bump') this.audio.impact(e.strength * 0.5, 'bump', this.bike.front.surface);
      else if (e.type === 'scrape') this.audio.impact(e.strength * 0.3, 'scrape');
      else if (e.type === 'crash') {
        this.audio.impact(1, 'crash');
        this.cam.bump(0.8);
        const why = e.cause === 'looped out' ? 'Looped out! You held the wheelie too long. ' : e.cause === 'over the bars' ? 'Over the bars! ' : 'Crashed! ';
        this.ui.toast(`${why}Press R / ⟲ to reset (auto in 3 s)`, 2800);
      }
    }
    this.bike.events.length = 0;
    if (this.bike.wantsReset) {
      this.bike.reset();
      this.cam.snap();
    }

    // Systems
    this.scorer.update(dt, this.bike);
    if (this.challenge) this.challenge.update(dt, { bike: this.bike, data: this.data, scorer: this.scorer, view: this.view });
    this.effects(dt);
    this.gameplayChecks(dt);
    this.updateEnvironment(dt);
    _v.copy(this.renderPos);
    this.cam.update(dt, this.renderPos, this.renderQuat, this.bike.vel, this.helmetPos(_v2), this.bike.crashed);
    const b = this.bike;
    const pt = b.pt;
    this.audio.update({
      rpm: pt.rpm,
      load: pt.torque / Math.max(1, b.spec.powertrain.peakTorque),
      speed: Math.hypot(b.vel.x, b.vel.z),
      slip: Math.max(b.rear.slide, b.front.slide * 1.2) * (b.rear.slipSpeed > 1.5 ? 1 : 0),
      surface: b.rear.surface,
      grounded: b.rear.grounded || b.front.grounded,
      distance: this.camera.position.distanceTo(this.renderPos),
      whine: 1,
      pwm: b.spec.powertrain.pwmTone,
      city: this.renderPos.x < -30 && Math.abs(this.renderPos.z) < 200 ? 1 : 0,
      paused: false,
    }, dt);
    if (this.touch.isVisible) {
      // Danger meter: full at roughly the hold time where the bikes loop out (~2.8 s).
      this.touch.setWheelieHold(b.wheelieHold > 0 ? (b.wheelieHold - 0.6) / 2.2 : 0);
    }
    this.ui.hud.update(dt);
  }

  private helmetPos(out: Vector3) {
    const h = this.spec.bodyPoints.find((p) => p.name === 'head')!.p;
    return out.set(h.x, h.y - 0.05, h.z + 0.08).applyQuaternion(this.renderQuat).add(this.renderPos);
  }

  /** Copy interpolated physics state into the render model. */
  private syncModel(alpha: number) {
    const b = this.bike;
    this.renderPos.lerpVectors(b.prevPos, b.pos, alpha);
    this.renderQuat.slerpQuaternions(b.prevQuat, b.quat, alpha);
    this.model.root.position.copy(this.renderPos);
    this.model.root.quaternion.copy(this.renderQuat);
    this.model.update({
      steer: b.steer, frontComp: b.front.compression, rearComp: b.rear.compression, frontAngle: b.front.angle, rearAngle: b.rear.angle,
      riderShift: b.riderShift, riderLat: b.riderLat, speed: b.speed, brake: Math.max(b.input.frontBrake, b.input.rearBrake), crashed: b.crashed,
      headlight: this.headlightOn,
    });
    this.model.root.updateMatrixWorld(true);
    if (b.crashed) {
      this.model.rider.tumble(b.rider.pos, b.rider.rot);
    } else {
      this.model.gripPositions(_gl, _gr);
      _m.copy(this.model.chassisGroup.matrixWorld);
      this.model.rider.pose(this.spec, _m, _gl, _gr, b.riderShift, b.riderLat, b.speed);
    }
    this.model.lightAnchor.getWorldPosition(this.headlight.position);
    this.headlight.target = this.model.lightTarget;
    this.headlight.visible = this.headlightOn && this.headlight.intensity > 0;
  }

  private effects(dt: number) {
    const b = this.bike;
    this.marks.fade(dt);
    for (const [key, w, spec] of [['f', b.front, this.spec.front], ['r', b.rear, this.spec.rear]] as const) {
      const sp = SURFACE_PROPS[w.surface];
      const sliding = w.grounded ? Math.min(1, Math.max(0, w.slide - 0.15) * 1.4 + (w.slipSpeed > 3 ? 0.3 : 0)) : 0;
      const loose = w.surface !== 'asphalt' && w.surface !== 'concrete';
      const intensity = sp.marks ? (loose ? Math.min(0.8, 0.25 + sliding) * (w.grounded && Math.abs(b.speed) > 1 ? 1 : 0) : sliding * 0.8) : 0;
      _v.set(1, 0, 0).applyQuaternion(this.renderQuat);
      const col: [number, number, number] = loose ? [sp.color[0] * 0.55, sp.color[1] * 0.5, sp.color[2] * 0.45] : [0.05, 0.05, 0.05];
      this.marks.add(key, w.contact, _v, spec.width * 0.9, w.grounded ? intensity : 0, col);
      if (!w.grounded) continue;
      // Smoke on tarmac, dust/roost on loose ground.
      if (!loose && w.slipSpeed > 3 && w.slide > 0.3) {
        const n = Math.min(3, w.slipSpeed / 4);
        for (let i = 0; i < n; i++) {
          this.particles.emit(w.contact, _v2.set((Math.random() - 0.5) * 1.5, 0.6 + Math.random(), (Math.random() - 0.5) * 1.5), [0.85, 0.85, 0.88], 0.6, 1.8 + Math.random(), { grow: 2.2, drag: 1.2, alpha: 0.55 });
        }
      } else if (loose && (Math.abs(b.speed) > 4 || w.slipSpeed > 2)) {
        const amt = sp.dust * (Math.abs(b.speed) / 15 + w.slipSpeed / 6) * dt * 40;
        for (let i = 0; i < Math.min(4, amt); i++) {
          this.particles.emit(w.contact, _v2.set((Math.random() - 0.5) * 1.2, 0.3 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2), sp.color, 0.45, 1.6, { grow: 1.8, drag: 1.6, alpha: 0.45 });
        }
        if (key === 'r' && w.slipSpeed > 2.5) {
          _v.set(0, 0, -1).applyQuaternion(this.renderQuat);
          for (let i = 0; i < 2; i++) {
            this.particles.emit(w.contact, _v2.copy(_v).multiplyScalar(3 + w.slipSpeed * 0.6).add(new Vector3((Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2)), [sp.color[0] * 0.7, sp.color[1] * 0.6, sp.color[2] * 0.5], 0.12, 0.8, { grow: 0.1, drag: 0.3, gravity: 9, alpha: 0.9 });
          }
        }
      }
    }
    this.particles.update(dt);
  }

  private gameplayChecks(dt: number) {
    const b = this.bike;
    const p = b.pos;
    // Collectibles
    for (const c of this.data.collectibles) {
      if (this.collected.has(c.id)) continue;
      const gy = this.data.terrain.heightAt(c.x, c.z) + 1.3;
      if ((p.x - c.x) ** 2 + (p.z - c.z) ** 2 < 4 && Math.abs(p.y - gy) < 2.5) {
        this.collected.add(c.id);
        this.save.data.progress.collected = [...this.collected];
        this.view.setCollected(this.collected);
        this.audio.chime(true);
        const n = this.collected.size;
        this.ui.toast(`Charge core ${n}/${this.data.collectibles.length}`);
        const unlocked = this.ui.unlockMessages(n);
        for (const u of unlocked) this.ui.toast(u, 4000);
        this.save.save();
      }
    }
    this.view.updateCores(this.time);
    // Cones
    const knocked = this.view.hitCones(p.x, p.z, b.vel.x, b.vel.z);
    if (knocked) this.audio.impact(0.2, 'bump', 'asphalt');
    this.view.updateCones(dt);
    // Lake: splash on entry, water drag, and a reset if the bike goes under.
    const lk = this.data.lake;
    if (Math.hypot(p.x - lk.x, p.z - lk.z) < lk.r + 14) {
      const depth = lk.level - (Math.min(b.front.contact.y, b.rear.contact.y));
      if (depth > 0.05) {
        const v = Math.hypot(b.vel.x, b.vel.z);
        if (!this.wet.splashed && v > 2) {
          this.wet.splashed = true;
          this.audio.impact(Math.min(1, v / 10), 'land', 'sand');
          for (let i = 0; i < 24; i++) this.particles.emit(_v2.set(p.x, lk.level + 0.1, p.z), _v.set((Math.random() - 0.5) * 4 + b.vel.x * 0.3, 1.5 + Math.random() * 3, (Math.random() - 0.5) * 4 + b.vel.z * 0.3), [0.85, 0.92, 0.95], 0.4, 1.0, { grow: 1.2, drag: 1.5, gravity: 9, alpha: 0.8 });
        }
        if (v > 1.5 && Math.random() < dt * 30) this.particles.emit(_v2.set(p.x, lk.level + 0.05, p.z), _v.set((Math.random() - 0.5) * 2, 0.8 + Math.random(), (Math.random() - 0.5) * 2), [0.9, 0.95, 1], 0.3, 0.7, { grow: 1.5, drag: 2, gravity: 6, alpha: 0.6 });
        // Water drag grows with depth.
        const k = Math.min(1, depth / 0.6) * 1.6 * dt;
        b.vel.x *= 1 - k;
        b.vel.z *= 1 - k;
        this.wet.under = depth > 0.75 ? this.wet.under + dt : 0;
        if (this.wet.under > 1.2) {
          this.wet.under = 0;
          this.ui.toast('Splash! Water and electrics don\'t mix. Back to the shore.', 3000);
          // Back to the last dry spot (the safe-state buffer may hold shallow-water states).
          const d = this.wet.dry;
          if (d.ok) b.place(d.x, d.z, d.yaw);
          else b.reset();
          this.cam.snap();
        }
      } else this.wet.splashed = false;
    }
    if (Math.hypot(p.x - lk.x, p.z - lk.z) > lk.r + 8 && !b.crashed && b.rear.grounded && Math.abs(b.lean) < 0.3) {
      this.wet.dry = { x: p.x, z: p.z, yaw: b.yaw, ok: true };
    }
    // Pedestrians
    if (this.settings.pedestrians) {
      for (const c of this.crowds) {
        if (Math.hypot(p.x - c.cx, p.z - c.cz) > c.r + 130) continue;
        if (c.peds.update(dt, p.x, p.z, b.vel.x, b.vel.z, this.time)) {
          this.ui.toast('Watch out for pedestrians!');
          b.vel.multiplyScalar(0.85);
        }
      }
    }
    // Auto-measured launch: 0–50 km/h from a standstill (free roam)
    const kmh = b.speed * 3.6;
    if (!this.launch.armed && Math.abs(b.speed) < 0.3 && b.front.grounded && b.rear.grounded) this.launch = { armed: true, t: 0, done: false };
    if (this.launch.armed) {
      if (b.speed > 0.3) this.launch.t += dt;
      else if (Math.abs(b.speed) < 0.3) this.launch.t = 0;
      if (b.crashed || b.input.frontBrake > 0.3) this.launch.armed = false;
      if (kmh >= 50 && this.launch.t > 0) {
        const id = this.build.id;
        const rec = (this.save.data.progress.measured[id] ??= {});
        if (!rec.t0to50 || this.launch.t < rec.t0to50) {
          rec.t0to50 = this.launch.t;
          rec.at = Date.now();
          this.ui.toast(`Measured 0–50 km/h: ${this.launch.t.toFixed(2)} s (best)`);
          this.save.save();
        }
        this.launch.armed = false;
      }
    }
    // Distance / save progress periodically
    this.distanceSaveTimer += dt;
    if (this.distanceSaveTimer > 10) {
      this.distanceSaveTimer = 0;
      this.progressSave();
      this.save.save();
    }
    // Challenge completion bookkeeping
    const ch = this.challenge;
    if (ch && (ch.state === 'done' || ch.state === 'failed') && !ch.extra.__reported) {
      ch.extra.__reported = 1;
      this.ui.challengeResult(ch);
      if (ch.state === 'done') {
        const prev = this.save.data.progress.medals[ch.def.id];
        const better = !prev || (ch.def.lowerIsBetter ? ch.result < prev.best : ch.result > prev.best);
        if (better) this.save.data.progress.medals[ch.def.id] = { best: ch.result, medal: ch.medal, buildName: this.build.name };
        const rec = (this.save.data.progress.measured[this.build.id] ??= {});
        if (ch.def.id === 'drag') {
          if (ch.extra.t50 !== undefined && (!rec.t0to50 || ch.extra.t50 < rec.t0to50)) rec.t0to50 = ch.extra.t50;
          if (ch.extra.t80 !== undefined && (!rec.t0to80 || ch.extra.t80 < rec.t0to80)) rec.t0to80 = ch.extra.t80;
          if (ch.extra.top !== undefined) rec.topSpeed = Math.max(rec.topSpeed ?? 0, ch.extra.top * 3.6);
        }
        if (ch.def.id === 'brake' && (!rec.brake50 || ch.result < rec.brake50)) rec.brake50 = ch.result;
        rec.at = Date.now();
        if (ch.medal) this.audio.chime(true);
        for (const u of this.ui.unlockMessages(this.collected.size)) this.ui.toast(u, 4000);
        this.save.save();
      }
    }
  }

  private lastBikeDistance = 0;
  /** Fold odometer and best drift into saved progress (lifetime totals). */
  private progressSave() {
    const b = this.bike;
    if (b.distance < this.lastBikeDistance) this.lastBikeDistance = 0;
    this.save.data.progress.distance += b.distance - this.lastBikeDistance;
    this.lastBikeDistance = b.distance;
    this.save.data.progress.bestDrift = Math.max(this.save.data.progress.bestDrift, Math.round(this.scorer.bestDrift));
  }

  private updateEnvironment(_dt: number) {
    // Shadow camera follows the bike.
    const p = this.renderPos;
    this.sun.position.copy(p).addScaledVector(this.sunDir, 80);
    this.sun.target.position.copy(p);
    this.view.follow(this.camera.position, this.time);
    this.grass.update(this.camera.position, this.time);
    this.birds.mesh.visible = this.settings.timeOfDay !== 'night';
    if (this.birds.mesh.visible) this.birds.update(this.time);
    // The crowd lives in the city (x < -35); skip drawing it from far away.
    const cp = this.camera.position;
    for (const c of this.crowds) c.peds.root.visible = this.settings.pedestrians && Math.hypot(cp.x - c.cx, cp.z - c.cz) < c.r + 120;
  }

  get challenges() {
    return CHALLENGES;
  }

  /** Recompute whether a part unlock key is satisfied. */
  isUnlocked(key?: string) {
    if (!key) return true;
    const m = /^(cores|medal)(\d+)$/.exec(key);
    if (!m) return true;
    const n = Number(m[2]);
    if (m[1] === 'cores') return this.collected.size >= n;
    return Object.values(this.save.data.progress.medals).filter((x) => x.medal).length >= n;
  }

  get collectedCount() {
    return this.collected.size;
  }
}
