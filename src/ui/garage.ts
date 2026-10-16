/**
 * Garage: studio scene with the live bike model + customization panels.
 * The draft build drives both the preview model and the stats (same computeVehicleSpec).
 */
import {
  AmbientLight, CircleGeometry, Color, DirectionalLight, Mesh, MeshStandardMaterial, PerspectiveCamera,
  PlaneGeometry, PointLight, RepeatWrapping, Scene, SpotLight, Vector3,
} from 'three';
import type { WebGLRenderer } from 'three';
import type { Game } from '../game/game';
import { BikeModel } from '../render/bikeModel';
import { floorTexture } from '../render/textures';
import { computeVehicleSpec } from '../vehicle/spec';
import type { VehicleSpec } from '../vehicle/spec';
import { estimate } from '../vehicle/stats';
import type { Estimates } from '../vehicle/stats';
import { cloneBuild, PRESETS, sanitizeBuild, SPROCKET_FRONT_RANGE, SPROCKET_REAR_RANGE } from '../vehicle/build';
import type { BikeBuild, TireConfig } from '../vehicle/build';
import {
  BATTERIES, BODY_KITS, BRAKES, COMPOUNDS, CONTROLLERS, DECALS, FENDERS, FINISHES, FORKS, FRAMES, FRONT_DIAMETERS, FRONT_WIDTHS,
  HANDLEBARS, LIGHTS, MOTORS, PALETTE, PROFILES, REAR_DIAMETERS, REAR_WIDTHS, RIM_STYLES, SEATS, SHOCKS, SWINGARMS, TREADS, YOKES, byId,
} from '../vehicle/parts';
import type { PartBase } from '../vehicle/parts';
import { testBench } from '../physics/sim';
import type { BenchResult } from '../physics/sim';
import { exportBuild, importBuild } from '../save/save';
import { clear, download, h, pickFile, segmented, slider, toggle } from './dom';

type Tab = 'power' | 'wheels' | 'suspension' | 'chassis' | 'paint' | 'builds' | 'test';
const TABS: { id: Tab; name: string }[] = [
  { id: 'power', name: 'Powertrain' }, { id: 'wheels', name: 'Wheels & Tires' }, { id: 'suspension', name: 'Suspension' },
  { id: 'chassis', name: 'Chassis' }, { id: 'paint', name: 'Paint' }, { id: 'builds', name: 'Builds' }, { id: 'test', name: 'Test Bench' },
];

export class Garage {
  el: HTMLDivElement;
  scene = new Scene();
  camera = new PerspectiveCamera(42, 1, 0.05, 100);
  model: BikeModel;
  draft: BikeBuild;
  spec: VehicleSpec;
  private baseline: Estimates;
  private est: Estimates;
  private tab: Tab = 'power';
  private body!: HTMLElement;
  private stats!: HTMLElement;
  private nameInput!: HTMLInputElement;
  private orbit = { yaw: -0.9, pitch: 0.22, dist: 3.4, dragging: false, lx: 0, ly: 0, pinch: 0, auto: true };
  private bench: BenchResult | null = null;
  private dirty = false;
  private rebuildTimer = 0;
  private compareIds: string[] = [];
  private canvasEl: HTMLCanvasElement;
  private pointers = new Map<number, { x: number; y: number }>();
  open = false;

  constructor(private game: Game, parent: HTMLElement) {
    this.draft = cloneBuild(game.build);
    this.spec = computeVehicleSpec(this.draft);
    this.est = this.baseline = estimate(this.spec);
    this.model = new BikeModel(this.draft, this.spec);
    this.buildScene();
    this.el = h('div', { class: 'garage' });
    this.el.style.display = 'none';
    parent.append(this.el);
    this.canvasEl = game.renderer.domElement;
    this.bindOrbit();
  }

  private buildScene() {
    const s = this.scene;
    s.background = new Color(0x15181e);
    const ft = floorTexture();
    ft.wrapS = ft.wrapT = RepeatWrapping;
    ft.repeat.set(6, 6);
    const floor = new Mesh(new PlaneGeometry(24, 24), new MeshStandardMaterial({ map: ft, roughness: 0.6, metalness: 0.15 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    const wallM = new MeshStandardMaterial({ color: 0x23272f, roughness: 0.9 });
    const back = new Mesh(new PlaneGeometry(24, 8), wallM);
    back.position.set(0, 4, -6);
    s.add(back);
    const side = new Mesh(new PlaneGeometry(24, 8), wallM);
    side.position.set(-6, 4, 0);
    side.rotation.y = Math.PI / 2;
    s.add(side);
    const disc = new Mesh(new CircleGeometry(1.6, 48), new MeshStandardMaterial({ color: 0x2b3038, roughness: 0.35, metalness: 0.5 }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.005;
    disc.receiveShadow = true;
    s.add(disc);
    s.add(new AmbientLight(0xffffff, 0.35));
    const key = new SpotLight(0xffffff, 60, 20, 0.6, 0.5, 1.5);
    key.position.set(2.5, 4.5, 2.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    s.add(key);
    const rim = new DirectionalLight(0x9fd8ff, 1.2);
    rim.position.set(-3, 2, -2);
    s.add(rim);
    const fill = new PointLight(0xc6f432, 4, 8);
    fill.position.set(-2, 1, 2);
    s.add(fill);
    s.add(this.model.root, this.model.rider.root);
  }

  private bindOrbit() {
    const c = this.canvasEl;
    c.addEventListener('pointerdown', (e) => {
      if (!this.open) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.orbit.auto = false;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.open || !this.pointers.has(e.pointerId)) return;
      const prev = this.pointers.get(e.pointerId)!;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d0 = Math.hypot(a.x - b.x, a.y - b.y);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a2, b2] = [...this.pointers.values()];
        const d1 = Math.hypot(a2.x - b2.x, a2.y - b2.y);
        this.orbit.dist = Math.max(1.6, Math.min(6, this.orbit.dist * (d0 / Math.max(1, d1))));
        return;
      }
      this.orbit.yaw -= (e.clientX - prev.x) * 0.008;
      this.orbit.pitch = Math.max(-0.1, Math.min(1.2, this.orbit.pitch + (e.clientY - prev.y) * 0.006));
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    const up = (e: PointerEvent) => this.pointers.delete(e.pointerId);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      if (!this.open) return;
      this.orbit.dist = Math.max(1.6, Math.min(6, this.orbit.dist + Math.sign(e.deltaY) * 0.25));
    });
  }

  show() {
    this.open = true;
    this.draft = cloneBuild(this.game.build);
    this.dirty = false;
    this.bench = null;
    this.refresh(true);
    this.baseline = this.est;
    this.el.style.display = '';
    this.renderPanels();
    this.resize(window.innerWidth, window.innerHeight);
  }

  hide() {
    this.open = false;
    this.el.style.display = 'none';
  }

  resize(w: number, hgt: number) {
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
  }

  /** Recompute spec/estimates and rebuild the preview model. */
  private refresh(immediate = false) {
    this.spec = computeVehicleSpec(this.draft);
    this.est = estimate(this.spec);
    if (immediate) this.model.rebuild(this.draft, this.spec);
    else this.rebuildTimer = 0.06;
    this.renderStats();
  }

  private change(mut: (b: BikeBuild) => void, rerenderPanel = false) {
    mut(this.draft);
    this.draft = sanitizeBuild(this.draft);
    this.dirty = true;
    this.bench = null;
    this.refresh();
    if (rerenderPanel) this.renderBody();
    this.game.audio.click();
  }

  update(dt: number) {
    if (this.rebuildTimer > 0) {
      this.rebuildTimer -= dt;
      if (this.rebuildTimer <= 0) this.model.rebuild(this.draft, this.spec);
    }
    if (this.orbit.auto) this.orbit.yaw += dt * 0.15;
    const o = this.orbit;
    const target = new Vector3(0, 0.55, 0);
    // Sit the wheels on the floor at ~12% suspension compression.
    const sp = this.spec;
    const wb = (w: VehicleSpec['front']) => w.mount.y + w.axis.y * w.travel * 0.12 - w.radius;
    this.model.root.position.set(0, -Math.min(wb(sp.front), wb(sp.rear)), -(sp.front.mount.z + sp.rear.mount.z) / 2);
    this.model.update({
      steer: Math.sin(this.game.time * 0.4) * 0.12, frontComp: this.spec.front.travel * 0.12, rearComp: this.spec.rear.travel * 0.12,
      frontAngle: 0, rearAngle: 0, riderShift: 0, riderLat: 0, speed: 0, brake: 0, crashed: false, headlight: true,
    });
    this.model.root.updateMatrixWorld(true);
    this.model.rider.root.visible = false;
    this.camera.position.set(Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist, target.y + Math.sin(o.pitch) * o.dist, Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist);
    this.camera.lookAt(target);
  }

  render(r: WebGLRenderer) {
    r.render(this.scene, this.camera);
  }

  // --- Panels ---------------------------------------------------------------------
  private renderPanels() {
    clear(this.el);
    this.nameInput = h('input', { value: this.draft.name, maxlength: 32, 'aria-label': 'Build name' }) as HTMLInputElement;
    this.nameInput.addEventListener('input', () => {
      this.draft.name = this.nameInput.value.replace(/[<>]/g, '').slice(0, 32) || 'Custom Build';
      this.dirty = true;
    });
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    for (const t of TABS) {
      const b = h('button', { class: 'tab' + (t.id === this.tab ? ' on' : ''), role: 'tab', 'aria-selected': t.id === this.tab ? 'true' : 'false' }, t.name);
      b.addEventListener('click', () => {
        this.tab = t.id;
        tabs.querySelectorAll('.tab').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        this.renderBody();
      });
      tabs.append(b);
    }
    this.body = h('div', { class: 'g-body' });
    const left = h('div', { class: 'g-panel g-left' }, h('div', { class: 'g-head' }, this.nameInput), h('div', { style: 'padding:0 12px' }, tabs), this.body);
    this.stats = h('div', { class: 'g-body' });
    const right = h('div', { class: 'g-panel g-right' }, h('div', { class: 'g-head' }, h('b', {}, 'Performance'), h('span', { class: 'tag-est' }, 'EST'), h('span', { class: 'tag-sim' }, 'SIM'), h('span', { class: 'tag-meas' }, 'MEASURED')), this.stats);
    const center = h('div', { class: 'g-center' },
      h('div', { class: 'btn-row', style: 'justify-content:center;margin-bottom:6px' },
        h('button', { class: 'btn small', onclick: () => this.el.classList.toggle('show-stats') }, 'Stats ⇄ Parts'),
        h('button', { class: 'btn small', onclick: () => this.revert() }, 'Revert'),
        h('button', { class: 'btn small', onclick: () => this.saveBuild(false) }, 'Save'),
        h('button', { class: 'btn small', onclick: () => this.saveBuild(true) }, 'Save as new'),
        h('button', { class: 'btn primary', onclick: () => this.ride() }, 'Ride this build ▶'),
        h('button', { class: 'btn small', onclick: () => this.close() }, 'Back'),
      ),
    );
    this.el.append(left, center, right);
    this.renderBody();
    this.renderStats();
  }

  private partList<T extends PartBase>(items: T[], current: string, onPick: (p: T) => void, extra?: (p: T) => string) {
    const wrap = h('div', { class: 'parts' });
    for (const p of items) {
      const locked = !this.game.isUnlocked(p.unlock);
      const el = h('button', { class: 'part' + (p.id === current ? ' on' : '') + (locked ? ' locked' : ''), disabled: locked, 'aria-pressed': p.id === current ? 'true' : 'false' },
        h('div', { class: 'pn' }, p.name, h('em', {}, locked ? `🔒 ${this.unlockText(p.unlock)}` : extra ? extra(p) : '')),
        h('div', { class: 'pd' }, p.desc),
        h('div', { class: 'pc' }, ...p.pros.map((x) => h('span', { class: 'pro' }, '+ ' + x)), ...p.cons.map((x) => h('span', { class: 'con' }, '− ' + x))),
      );
      el.addEventListener('click', () => {
        if (locked) return;
        wrap.querySelectorAll('.part').forEach((x) => x.classList.remove('on'));
        el.classList.add('on');
        onPick(p);
      });
      wrap.append(el);
    }
    return wrap;
  }

  private unlockText(key?: string) {
    if (!key) return '';
    const m = /^(cores|medal)(\d+)$/.exec(key);
    if (!m) return '';
    return m[1] === 'cores' ? `${m[2]} charge cores` : `${m[2]} medals`;
  }

  private section(t: string) {
    return h('div', { class: 'g-section' }, t);
  }

  private tireControls(which: 'front' | 'rear') {
    const t = this.draft[which];
    const set = (mut: (t: TireConfig) => void, re = false) => this.change((b) => mut(b[which]), re);
    const diams = (which === 'front' ? FRONT_DIAMETERS : REAR_DIAMETERS) as readonly number[];
    const widths = (which === 'front' ? FRONT_WIDTHS : REAR_WIDTHS) as readonly number[];
    return h('div', {},
      segmented('Rim diameter', diams.map((d) => ({ id: String(d), name: `${d}"` })), String(t.diameter), (v) => set((x) => (x.diameter = Number(v)))),
      segmented('Tire width', widths.map((d) => ({ id: String(d), name: `${d}` })), String(t.width), (v) => set((x) => (x.width = Number(v)))),
      segmented('Profile', PROFILES.map((d) => ({ id: String(d), name: `${d}%` })), String(t.profile), (v) => set((x) => (x.profile = Number(v)))),
      segmented('Compound', COMPOUNDS.map((c) => ({ id: c.id, name: c.name, title: [...c.pros, ...c.cons].join(' · ') })), t.compound, (v) => set((x) => (x.compound = v))),
      slider('Pressure', t.pressure, 8, 36, 1, (v) => `${v} psi`, (v) => set((x) => (x.pressure = v))),
      h('div', { class: 'note' }, 'Low pressure = bigger footprint off-road but squirm & drag on tarmac. ~26–32 psi suits pavement, 12–16 psi suits dirt.'),
      this.section(`${which === 'front' ? 'Front' : 'Rear'} tread`),
      this.partList(TREADS, t.tread, (p) => set((x) => (x.tread = p.id))),
    );
  }

  private renderBody() {
    const b = this.draft;
    const B = this.body;
    clear(B);
    const P = b.parts;
    const pick = (k: keyof BikeBuild['parts']) => (p: PartBase) => this.change((d) => (d.parts[k] = p.id));
    const kg = (p: { mass: number }) => `${p.mass.toFixed(1)} kg`;
    switch (this.tab) {
      case 'power': {
        const ctrl = byId(CONTROLLERS, P.controller);
        B.append(
          this.section('Motor'),
          this.partList(MOTORS, P.motor, pick('motor'), (p) => `${(p.ratedPower / 1000).toFixed(1)} kW · ${p.peakTorque} N·m · ${kg(p)}`),
          this.section('Controller'),
          this.partList(CONTROLLERS, P.controller, (p) => this.change((d) => (d.parts.controller = p.id), true), (p) => `${(p.maxPower / 1000).toFixed(1)} kW cap`),
          this.section('Battery'),
          this.partList(BATTERIES, P.battery, pick('battery'), (p) => `${p.voltage} V · ${(p.capacityWh / 1000).toFixed(2)} kWh · ${kg(p)}`),
          this.section('Final drive (sprockets)'),
          slider('Front sprocket', b.tuning.frontSprocket, SPROCKET_FRONT_RANGE[0], SPROCKET_FRONT_RANGE[1], 1, (v) => `${v} T`, (v) => this.change((d) => (d.tuning.frontSprocket = v))),
          slider('Rear sprocket', b.tuning.rearSprocket, SPROCKET_REAR_RANGE[0], SPROCKET_REAR_RANGE[1], 1, (v) => `${v} T`, (v) => this.change((d) => (d.tuning.rearSprocket = v))),
          h('div', { class: 'note' }, 'Bigger rear / smaller front = shorter gearing: more wheel torque and wheelies, lower top speed. A bigger rear wheel also lengthens effective gearing.'),
          this.section('Controller tuning'),
          segmented('Throttle map', [{ id: 'soft', name: 'Soft' }, { id: 'linear', name: 'Linear' }, { id: 'aggressive', name: 'Aggressive' }] as const, b.tuning.throttleMap, (v) => this.change((d) => (d.tuning.throttleMap = v))),
          slider('Regen strength', b.tuning.regen, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => this.change((d) => (d.tuning.regen = v))),
          toggle('Traction control', b.tuning.tractionControl, (v) => this.change((d) => (d.tuning.tractionControl = v)), !ctrl.tractionControl, ctrl.tractionControl ? 'Trims torque when the rear spins (kills power slides)' : 'Needs Trail 90A or better'),
          toggle('Wheelie control', b.tuning.wheelieControl, (v) => this.change((d) => (d.tuning.wheelieControl = v)), !ctrl.tractionControl, 'Limits pitch past ~20°'),
        );
        break;
      }
      case 'wheels':
        B.append(
          this.section('Rims'),
          this.partList(RIM_STYLES, P.rimStyle, pick('rimStyle')),
          this.section('Front wheel'), this.tireControls('front'),
          this.section('Rear wheel'), this.tireControls('rear'),
        );
        break;
      case 'suspension': {
        const t = b.tuning;
        B.append(
          this.section('Front fork'),
          this.partList(FORKS, P.fork, pick('fork'), (p) => `${Math.round(p.travel * 1000)} mm`),
          slider('Fork spring', t.forkSpring, 0.6, 1.6, 0.05, (v) => `${(v * 100).toFixed(0)}%`, (v) => this.change((d) => (d.tuning.forkSpring = v))),
          slider('Fork preload', t.forkPreload, 0, 25, 1, (v) => `${v} mm`, (v) => this.change((d) => (d.tuning.forkPreload = v))),
          slider('Fork compression', t.forkCompression, 1, 20, 1, (v) => `${v} clk`, (v) => this.change((d) => (d.tuning.forkCompression = v))),
          slider('Fork rebound', t.forkRebound, 1, 20, 1, (v) => `${v} clk`, (v) => this.change((d) => (d.tuning.forkRebound = v))),
          this.section('Rear shock'),
          this.partList(SHOCKS, P.shock, pick('shock'), (p) => `${Math.round(p.travel * 1000)} mm`),
          slider('Shock spring', t.shockSpring, 0.6, 1.6, 0.05, (v) => `${(v * 100).toFixed(0)}%`, (v) => this.change((d) => (d.tuning.shockSpring = v))),
          slider('Shock preload', t.shockPreload, 0, 25, 1, (v) => `${v} mm`, (v) => this.change((d) => (d.tuning.shockPreload = v))),
          slider('Shock compression', t.shockCompression, 1, 20, 1, (v) => `${v} clk`, (v) => this.change((d) => (d.tuning.shockCompression = v))),
          slider('Shock rebound', t.shockRebound, 1, 20, 1, (v) => `${v} clk`, (v) => this.change((d) => (d.tuning.shockRebound = v))),
          h('div', { class: 'note' }, 'Softer springs soak up bumps but pitch and bottom out more; stiffer springs feel sharp on smooth ground but skip on rough terrain. More preload raises ride height.'),
          this.section('Swingarm'),
          this.partList(SWINGARMS, P.swingarm, pick('swingarm'), (p) => `${Math.round(p.length * 1000)} mm`),
          this.section('Steering geometry'),
          this.partList(YOKES, P.yoke, pick('yoke'), (p) => `${p.rake}° · ${Math.round(p.offset * 1000)} mm`),
        );
        break;
      }
      case 'chassis':
        B.append(
          this.section('Frame'), this.partList(FRAMES, P.frame, pick('frame'), kg),
          this.section('Body panels'), this.partList(BODY_KITS, P.bodyKit, pick('bodyKit'), kg),
          this.section('Brakes'), this.partList(BRAKES, P.brakes, pick('brakes'), (p) => `${p.frontTorque} / ${p.rearTorque} N·m`),
          this.section('Handlebar'), this.partList(HANDLEBARS, P.handlebar, pick('handlebar')),
          this.section('Seat'), this.partList(SEATS, P.seat, pick('seat')),
          slider('Rider position', b.tuning.riderPosition, -0.08, 0.08, 0.01, (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)} cm`, (v) => this.change((d) => (d.tuning.riderPosition = v))),
          h('div', { class: 'note' }, 'Sitting further back makes wheelies easier and stoppies harder; forward keeps the front planted.'),
          this.section('Fenders'), this.partList(FENDERS, P.fenders, pick('fenders')),
          this.section('Lights'), this.partList(LIGHTS, P.lights, pick('lights')),
        );
        break;
      case 'paint': {
        const V = b.visual;
        const swatch = (label: string, key: keyof BikeBuild['visual']) => {
          const wrap = h('div', { class: 'swatches' });
          for (const c of PALETTE) {
            const s = h('button', { class: 'sw' + (V[key] === c ? ' on' : ''), style: `background:${c}`, 'aria-label': `${label} ${c}` });
            s.addEventListener('click', () => {
              wrap.querySelectorAll('.sw').forEach((x) => x.classList.remove('on'));
              s.classList.add('on');
              this.change((d) => ((d.visual as unknown as Record<string, string>)[key] = c));
            });
            wrap.append(s);
          }
          const custom = h('input', { type: 'color', class: 'sw-custom', value: V[key] as string, 'aria-label': `${label} custom colour` }) as HTMLInputElement;
          custom.addEventListener('input', () => this.change((d) => ((d.visual as unknown as Record<string, string>)[key] = custom.value)));
          wrap.append(custom);
          return h('div', {}, h('div', { class: 'row-label', style: 'margin-top:8px' }, label), wrap);
        };
        const num = h('input', { value: V.number, maxlength: 3, class: 'btn small', style: 'width:80px;text-align:center', 'aria-label': 'Race number' }) as HTMLInputElement;
        num.addEventListener('change', () => this.change((d) => (d.visual.number = num.value)));
        B.append(
          swatch('Plastics', 'plasticColor'), swatch('Frame', 'frameColor'), swatch('Accent / springs', 'accentColor'),
          swatch('Seat & grips', 'seatColor'), swatch('Rims', 'rimColor'),
          segmented('Finish', FINISHES.map((f) => ({ id: f.id, name: f.name })), V.finish, (v) => this.change((d) => (d.visual.finish = v))),
          segmented('Decal', DECALS.map((dd) => ({ id: dd.id, name: dd.name, disabled: !this.game.isUnlocked((dd as { unlock?: string }).unlock), title: (dd as { unlock?: string }).unlock ? `Unlock: ${this.unlockText((dd as { unlock?: string }).unlock)}` : '' })), V.decal, (v) => this.change((d) => (d.visual.decal = v))),
          swatch('Decal colour', 'decalColor'), swatch('Number plate', 'plateColor'),
          h('label', { class: 'row' }, h('span', { class: 'row-label' }, 'Race number'), num),
        );
        break;
      }
      case 'builds':
        this.renderBuilds();
        break;
      case 'test':
        this.renderTest();
        break;
    }
  }

  private renderBuilds() {
    const B = this.body;
    const save = this.game.save;
    const list = h('div', { class: 'builds' });
    for (const bd of save.data.builds) {
      const sel = this.compareIds.includes(bd.id);
      const cmp = h('input', { type: 'checkbox', checked: sel, 'aria-label': `Compare ${bd.name}` }) as HTMLInputElement;
      cmp.addEventListener('change', () => {
        if (cmp.checked) this.compareIds = [...this.compareIds.filter((x) => x !== bd.id), bd.id].slice(-3);
        else this.compareIds = this.compareIds.filter((x) => x !== bd.id);
        this.renderBody();
      });
      list.append(h('div', { class: 'build-item' + (bd.id === this.draft.id ? ' on' : '') },
        h('span', { class: 'chip', style: `background:${bd.visual.plasticColor}` }),
        h('span', { class: 'nm' }, bd.name),
        cmp,
        h('button', { class: 'btn small', onclick: () => this.loadBuild(bd) }, 'Load'),
        h('button', { class: 'btn small', onclick: () => download(`${bd.name.replace(/\W+/g, '-')}.voltline.json`, exportBuild(bd)) }, 'Export'),
        h('button', { class: 'btn small danger', disabled: save.data.builds.length <= 1, onclick: () => this.deleteBuild(bd.id) }, '✕'),
      ));
    }
    B.append(
      this.section('Saved builds'), list,
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        h('button', { class: 'btn small', onclick: async () => {
          const txt = await pickFile();
          if (!txt) return;
          try {
            const nb = importBuild(txt);
            save.data.builds.push(nb);
            save.save();
            this.game.ui.toast(`Imported "${nb.name}"`);
            this.renderBody();
          } catch (e) {
            this.game.ui.toast(`Import failed: ${(e as Error).message}`);
          }
        } }, 'Import build…'),
        h('button', { class: 'btn small', onclick: () => {
          const menu = PRESETS.map((p) => p.name).join(', ');
          void menu;
          this.loadBuild({ ...cloneBuild(PRESETS[0]), id: `build-${Date.now().toString(36)}`, name: 'New Build' });
        } }, 'New from stock'),
      ),
      this.section('Factory presets'),
      h('div', { class: 'builds' }, ...PRESETS.map((p) => h('div', { class: 'build-item' },
        h('span', { class: 'chip', style: `background:${p.visual.plasticColor}` }), h('span', { class: 'nm' }, p.name),
        h('button', { class: 'btn small', onclick: () => this.loadBuild({ ...cloneBuild(p), id: `build-${Date.now().toString(36)}` }) }, 'Use as base'),
      ))),
    );
    if (this.compareIds.length >= 2) B.append(this.section('Comparison (estimates + measured)'), this.compareTable());
    else B.append(h('div', { class: 'note', style: 'margin-top:10px' }, 'Tick two or three builds to compare them side by side.'));
  }

  private compareTable() {
    const builds = this.compareIds.map((id) => this.game.save.data.builds.find((b) => b.id === id)).filter(Boolean) as BikeBuild[];
    const ests = builds.map((b) => estimate(computeVehicleSpec(b)));
    const meas = builds.map((b) => this.game.save.data.progress.measured[b.id] ?? {});
    const rows: [string, (i: number) => number | undefined, (v: number) => string, 'hi' | 'lo'][] = [
      ['Mass (bike)', (i) => ests[i].massKg, (v) => `${v.toFixed(1)} kg`, 'lo'],
      ['Peak power', (i) => ests[i].peakPowerKw, (v) => `${v.toFixed(1)} kW`, 'hi'],
      ['Wheel torque', (i) => ests[i].peakWheelTorque, (v) => `${v.toFixed(0)} N·m`, 'hi'],
      ['Top speed (est)', (i) => ests[i].topSpeedKmh, (v) => `${v.toFixed(0)} km/h`, 'hi'],
      ['Range (est)', (i) => ests[i].rangeKm, (v) => `${v.toFixed(0)} km`, 'hi'],
      ['Final drive', (i) => ests[i].finalDrive, (v) => v.toFixed(2), 'hi'],
      ['Wheelbase', (i) => ests[i].wheelbase, (v) => `${(v * 1000).toFixed(0)} mm`, 'hi'],
      ['Road grip μ', (i) => ests[i].grip.road, (v) => v.toFixed(2), 'hi'],
      ['Dirt grip μ', (i) => ests[i].grip.dirt, (v) => v.toFixed(2), 'hi'],
      ['Agility', (i) => ests[i].agility, (v) => v.toFixed(1), 'hi'],
      ['Stability', (i) => ests[i].stability, (v) => v.toFixed(1), 'hi'],
      ['0–50 measured', (i) => meas[i].t0to50, (v) => `${v.toFixed(2)} s`, 'lo'],
      ['Brake 50 measured', (i) => meas[i].brake50, (v) => `${v.toFixed(1)} m`, 'lo'],
    ];
    const t = h('table', { class: 'cmp' });
    t.append(h('tr', {}, h('th', {}, ''), ...builds.map((b) => h('th', {}, b.name))));
    for (const [label, get, fmt, better] of rows) {
      const vals = builds.map((_, i) => get(i));
      const defined = vals.filter((v): v is number => v !== undefined);
      const best = defined.length ? (better === 'hi' ? Math.max(...defined) : Math.min(...defined)) : NaN;
      t.append(h('tr', {}, h('td', {}, label), ...vals.map((v) => h('td', { class: v === best && defined.length > 1 ? 'best' : '' }, v === undefined ? '—' : fmt(v)))));
    }
    return t;
  }

  private renderTest() {
    const B = this.body;
    const run = h('button', { class: 'btn primary block' }, 'Run simulated test bench');
    run.addEventListener('click', () => {
      run.textContent = 'Running…';
      run.setAttribute('disabled', '');
      setTimeout(() => {
        const t0 = performance.now();
        this.bench = testBench(this.draft);
        const ms = performance.now() - t0;
        this.renderBody();
        this.renderStats();
        this.game.ui.toast(`Test bench finished in ${ms.toFixed(0)} ms of real time`);
      }, 30);
    });
    B.append(
      h('p', { class: 'note' }, 'The test bench runs the real ride physics headlessly on virtual flat surfaces with a scripted rider (launch control, threshold braking, steady turn). Results are tagged SIM. In-world runs on the drag strip / brake test are tagged MEASURED.'),
      run,
    );
    if (this.bench) {
      const r = this.bench;
      const fmt = (v: number | null, u: string, d = 2) => (v === null ? '—' : `${v.toFixed(d)} ${u}`);
      B.append(
        this.section('Simulated results'),
        this.statRow('0–50 km/h (asphalt)', fmt(r.accel.t0to50, 's'), '', 'sim'),
        this.statRow('0–80 km/h (asphalt)', fmt(r.accel.t0to80, 's'), '', 'sim'),
        this.statRow('100 m (asphalt)', fmt(r.accel.t100m, 's'), '', 'sim'),
        this.statRow('Top speed reached (16 s)', fmt(r.accel.topSpeed * 3.6, 'km/h', 0), '', 'sim'),
        this.statRow('0–50 km/h (dirt)', fmt(r.dirtAccel.t0to50, 's'), '', 'sim'),
        this.statRow('Braking 50→0 (asphalt)', `${r.brake.distance.toFixed(1)} m${r.brake.stoppie ? ' (rear lifted)' : ''}`, '', 'sim'),
        this.statRow('Turn radius at 35 km/h, 70% steer', `${r.turn.radius.toFixed(1)} m · lean ${((r.turn.lean * 180) / Math.PI).toFixed(0)}°`, '', 'sim'),
        this.statRow('Launch wheelie time', `${r.accel.wheelieTime.toFixed(2)} s`, '', 'sim'),
      );
      if (r.accel.crashed || r.brake.crashed || r.turn.crashed) B.append(h('div', { class: 'note', style: 'color:var(--bad)' }, 'The scripted rider crashed during a test — this build is on the edge.'));
    }
  }

  private statRow(label: string, value: string, delta = '', kind: 'est' | 'sim' | 'meas' = 'est', cls = 'same') {
    return h('div', { class: 'stat' }, h('span', {}, label, ' ', kind !== 'est' ? h('span', { class: kind === 'sim' ? 'tag-sim' : 'tag-meas' }, kind === 'sim' ? 'SIM' : 'MEAS') : null), h('span', { class: 'v' }, value), h('span', { class: `d ${cls}` }, delta));
  }

  private renderStats() {
    if (!this.stats) return;
    const S = this.stats;
    clear(S);
    const e = this.est, b0 = this.baseline;
    const row = (label: string, v: number, base: number, fmt: (x: number) => string, higherBetter: boolean | null, unit = '') => {
      const d = v - base;
      const eps = Math.abs(base) * 0.004 + 1e-6;
      let cls = 'same', txt = '';
      if (Math.abs(d) > eps) {
        const good = higherBetter === null ? null : higherBetter ? d > 0 : d < 0;
        cls = good === null ? 'same' : good ? 'up' : 'down';
        if (good === null) cls = 'up';
        txt = `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}${unit}`;
      }
      return this.statRow(label, fmt(v) + unit, txt, 'est', cls);
    };
    S.append(
      this.section('Estimates (calculated)'),
      row('Bike mass', e.massKg, b0.massKg, (x) => x.toFixed(1), false, ' kg'),
      row('Peak power', e.peakPowerKw, b0.peakPowerKw, (x) => x.toFixed(1), true, ' kW'),
      row('Peak wheel torque', e.peakWheelTorque, b0.peakWheelTorque, (x) => x.toFixed(0), true, ' N·m'),
      row('Final drive', e.finalDrive, b0.finalDrive, (x) => x.toFixed(2), null, ':1'),
      row(`Top speed (${e.topSpeedLimit})`, e.topSpeedKmh, b0.topSpeedKmh, (x) => x.toFixed(0), true, ' km/h'),
      row('Battery', e.batteryWh, b0.batteryWh, (x) => x.toFixed(0), true, ' Wh'),
      row('Range*', e.rangeKm, b0.rangeKm, (x) => x.toFixed(0), true, ' km'),
      row('Power / weight', e.powerToWeight, b0.powerToWeight, (x) => x.toFixed(1), true, ' W/kg'),
      row('Wheelbase', e.wheelbase * 1000, b0.wheelbase * 1000, (x) => x.toFixed(0), null, ' mm'),
      row('Trail', e.trail * 1000, b0.trail * 1000, (x) => x.toFixed(0), null, ' mm'),
      row('CoM height', e.comHeight * 1000, b0.comHeight * 1000, (x) => x.toFixed(0), false, ' mm'),
      row('Front weight', e.frontWeight * 100, b0.frontWeight * 100, (x) => x.toFixed(0), null, '%'),
      row('Sag front / rear', e.sagFront * 100, b0.sagFront * 100, (x) => x.toFixed(0), null, `% / ${(e.sagRear * 100).toFixed(0)}%`),
      row('Ground clearance', e.groundClearance * 1000, b0.groundClearance * 1000, (x) => x.toFixed(0), true, ' mm'),
      h('div', { class: 'note' }, `*Range: ${e.rangeCondition}.`),
      this.section('Handling'),
      this.meter('Agility', e.agility / 10, b0.agility / 10),
      this.meter('High-speed stability', e.stability / 10, b0.stability / 10),
      this.meter('Wheelie tendency', Math.min(1, e.wheelieIndex / 1.6), Math.min(1, b0.wheelieIndex / 1.6)),
      this.meter('Road grip', e.grip.road / 1.3, b0.grip.road / 1.3),
      this.meter('Dirt grip', e.grip.dirt / 1.3, b0.grip.dirt / 1.3),
      this.meter('Sand grip', e.grip.sand / 1.3, b0.grip.sand / 1.3),
      this.section('Dyno (wheel torque & power vs speed, Sport)'),
      this.dyno(),
    );
    const m = this.game.save.data.progress.measured[this.draft.id];
    S.append(this.section('Measured in-world'));
    if (m && (m.t0to50 || m.brake50 || m.t0to80)) {
      if (m.t0to50) S.append(this.statRow('0–50 km/h', `${m.t0to50.toFixed(2)} s`, '', 'meas'));
      if (m.t0to80) S.append(this.statRow('0–80 km/h', `${m.t0to80.toFixed(2)} s`, '', 'meas'));
      if (m.topSpeed) S.append(this.statRow('Top speed (drag strip)', `${m.topSpeed.toFixed(0)} km/h`, '', 'meas'));
      if (m.brake50) S.append(this.statRow('Brake from 50 km/h', `${m.brake50.toFixed(1)} m`, '', 'meas'));
      if (this.dirty) S.append(h('div', { class: 'note' }, 'Measured values belong to the saved version of this build.'));
    } else S.append(h('div', { class: 'note' }, 'No in-world measurements yet. Run the Drag Strip or Brake Test challenge, or launch from a stop in free roam.'));
    if (this.bench) {
      S.append(this.section('Simulated (test bench)'),
        this.statRow('0–50 km/h', this.bench.accel.t0to50 ? `${this.bench.accel.t0to50.toFixed(2)} s` : '—', '', 'sim'),
        this.statRow('Brake 50→0', `${this.bench.brake.distance.toFixed(1)} m`, '', 'sim'));
    }
  }

  private meter(label: string, v: number, base: number) {
    return h('div', {}, h('div', { class: 'hud-line', style: 'font-size:12.5px;color:var(--text)' }, h('span', {}, label)),
      h('div', { class: 'meter' }, h('i', { style: `width:${Math.max(2, Math.min(100, v * 100))}%` }), h('b', { style: `left:${Math.max(0, Math.min(100, base * 100))}%` })));
  }

  private dyno() {
    const c = h('canvas', { class: 'dyno', width: 600, height: 280 }) as HTMLCanvasElement;
    const g = c.getContext('2d');
    if (!g) return c;
    const d = this.est.dyno, base = this.baseline.dyno;
    const maxT = Math.max(...d.map((x) => x.torque), ...base.map((x) => x.torque), 1);
    const maxP = Math.max(...d.map((x) => x.powerKw), ...base.map((x) => x.powerKw), 1);
    const W = 600, H = 280, pad = 34;
    g.fillStyle = '#0f1217';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.fillStyle = '#9aa3b1';
    g.font = '18px system-ui';
    for (let k = 0; k <= 140; k += 20) {
      const x = pad + (k / 140) * (W - pad * 2);
      g.beginPath(); g.moveTo(x, pad / 2); g.lineTo(x, H - pad); g.stroke();
      g.fillText(String(k), x - 10, H - 8);
    }
    const line = (pts: { kmh: number; v: number }[], max: number, color: string, dash: number[]) => {
      g.strokeStyle = color;
      g.lineWidth = 3;
      g.setLineDash(dash);
      g.beginPath();
      pts.forEach((p, i) => {
        const x = pad + (p.kmh / 140) * (W - pad * 2), y = H - pad - (p.v / max) * (H - pad * 1.6);
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      });
      g.stroke();
      g.setLineDash([]);
    };
    line(base.map((p) => ({ kmh: p.kmh, v: p.torque })), maxT, 'rgba(198,244,50,0.35)', [6, 6]);
    line(base.map((p) => ({ kmh: p.kmh, v: p.powerKw })), maxP, 'rgba(56,217,245,0.35)', [6, 6]);
    line(d.map((p) => ({ kmh: p.kmh, v: p.torque })), maxT, '#c6f432', []);
    line(d.map((p) => ({ kmh: p.kmh, v: p.powerKw })), maxP, '#38d9f5', []);
    g.fillStyle = '#c6f432';
    g.fillText(`Torque ${Math.max(...d.map((x) => x.torque)).toFixed(0)} N·m`, pad + 6, 24);
    g.fillStyle = '#38d9f5';
    g.fillText(`Power ${Math.max(...d.map((x) => x.powerKw)).toFixed(1)} kW`, pad + 220, 24);
    g.fillStyle = '#9aa3b1';
    g.fillText('km/h  (dashed = before changes)', W - 300, 24);
    return c;
  }

  // --- Actions ----------------------------------------------------------------
  private loadBuild(b: BikeBuild) {
    if (this.dirty && !confirm('Discard unsaved changes to this build?')) return;
    this.draft = cloneBuild(b);
    this.dirty = !this.game.save.data.builds.some((x) => x.id === b.id);
    this.refresh(true);
    this.baseline = this.est;
    this.renderPanels();
  }

  private deleteBuild(id: string) {
    const s = this.game.save;
    if (s.data.builds.length <= 1) return;
    if (!confirm('Delete this build?')) return;
    s.data.builds = s.data.builds.filter((b) => b.id !== id);
    if (s.data.selectedBuildId === id) s.data.selectedBuildId = s.data.builds[0].id;
    s.save();
    this.renderBody();
  }

  private revert() {
    const saved = this.game.save.data.builds.find((b) => b.id === this.draft.id) ?? this.game.build;
    this.draft = cloneBuild(saved);
    this.dirty = false;
    this.refresh(true);
    this.renderPanels();
  }

  saveBuild(asNew: boolean) {
    const s = this.game.save;
    const b = sanitizeBuild(this.draft);
    b.updated = Date.now();
    if (asNew || !s.data.builds.some((x) => x.id === b.id)) {
      if (asNew) {
        b.id = `build-${Date.now().toString(36)}`;
        if (s.data.builds.some((x) => x.name === b.name)) b.name = `${b.name} 2`.slice(0, 32);
      }
      s.data.builds.push(b);
    } else {
      const i = s.data.builds.findIndex((x) => x.id === b.id);
      s.data.builds[i] = b;
      // Measurements no longer describe a changed build.
      delete s.data.progress.measured[b.id];
    }
    this.draft = cloneBuild(b);
    this.dirty = false;
    this.baseline = this.est;
    s.save();
    this.game.ui.toast(`Saved "${b.name}"`);
    this.renderPanels();
    return b;
  }

  private ride() {
    const b = this.dirty ? this.saveBuild(false) : this.draft;
    this.game.save.data.selectedBuildId = b.id;
    this.game.save.save();
    this.game.applyBuild(b);
    this.game.bike.pt.reset(true); // the garage charges the battery
    this.game.ui.closeGarage(true);
  }

  close() {
    if (this.dirty && !confirm('Leave without saving your changes?')) return;
    this.game.bike.pt.reset(true);
    this.game.ui.closeGarage(false);
  }
}
