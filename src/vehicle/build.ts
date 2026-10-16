import {
  BATTERIES, BODY_KITS, BRAKES, COMPOUNDS, CONTROLLERS, DECALS, FENDERS, FINISHES, FORKS, FRAMES,
  FRONT_DIAMETERS, FRONT_WIDTHS, HANDLEBARS, LIGHTS, MOTORS, PROFILES, REAR_DIAMETERS, REAR_WIDTHS,
  RIM_STYLES, SEATS, SHOCKS, SWINGARMS, TREADS, YOKES,
} from './parts';
import type { DecalId, FinishId } from './parts';

export type RideMode = 'eco' | 'standard' | 'sport';
export type ThrottleMap = 'soft' | 'linear' | 'aggressive';

export interface TireConfig {
  diameter: number; // rim inches
  width: number; // mm
  profile: number; // aspect %
  tread: string;
  compound: string;
  pressure: number; // psi
}

export interface BikeBuild {
  id: string;
  name: string;
  /** Unix ms of last edit. */
  updated: number;
  parts: {
    motor: string;
    controller: string;
    battery: string;
    fork: string;
    shock: string;
    swingarm: string;
    yoke: string;
    handlebar: string;
    seat: string;
    fenders: string;
    bodyKit: string;
    frame: string;
    lights: string;
    brakes: string;
    rimStyle: string;
  };
  front: TireConfig;
  rear: TireConfig;
  tuning: {
    frontSprocket: number;
    rearSprocket: number;
    /** Spring rate multipliers (0.6 .. 1.6). */
    forkSpring: number;
    shockSpring: number;
    /** Preload, mm (0 .. 25). */
    forkPreload: number;
    shockPreload: number;
    /** Damping clicks 1 .. 20 (10 = base). */
    forkCompression: number;
    forkRebound: number;
    shockCompression: number;
    shockRebound: number;
    /** Regen strength 0 .. 1 (scaled by controller capability). */
    regen: number;
    throttleMap: ThrottleMap;
    tractionControl: boolean;
    wheelieControl: boolean;
    /** Rider fore/aft seating position, m (-0.08 .. 0.08). */
    riderPosition: number;
  };
  visual: {
    frameColor: string;
    plasticColor: string;
    accentColor: string;
    seatColor: string;
    rimColor: string;
    finish: FinishId;
    decal: DecalId;
    decalColor: string;
    number: string;
    plateColor: string;
  };
}

export const SPROCKET_FRONT_RANGE = [9, 16] as const;
export const SPROCKET_REAR_RANGE = [36, 66] as const;

export function defaultBuild(): BikeBuild {
  return {
    id: 'scout',
    name: 'Volt Scout',
    updated: 0,
    parts: {
      motor: 'arc6', controller: 'stock60', battery: 'stock60', fork: 'stock', shock: 'stock', swingarm: 'stock',
      yoke: 'stock', handlebar: 'stock', seat: 'stock', fenders: 'stock', bodyKit: 'stock', frame: 'stock',
      lights: 'round', brakes: 'stock', rimStyle: 'spoke',
    },
    front: { diameter: 19, width: 80, profile: 100, tread: 'dualsport', compound: 'medium', pressure: 18 },
    rear: { diameter: 19, width: 100, profile: 80, tread: 'dualsport', compound: 'medium', pressure: 18 },
    tuning: {
      frontSprocket: 12, rearSprocket: 48,
      forkSpring: 1, shockSpring: 1, forkPreload: 6, shockPreload: 8,
      forkCompression: 10, forkRebound: 10, shockCompression: 10, shockRebound: 10,
      regen: 0.5, throttleMap: 'linear', tractionControl: false, wheelieControl: false, riderPosition: 0,
    },
    visual: {
      frameColor: '#1b1d22', plasticColor: '#e8e8ea', accentColor: '#c6f432', seatColor: '#1b1d22', rimColor: '#1b1d22',
      finish: 'gloss', decal: 'stripes', decalColor: '#c6f432', number: '27', plateColor: '#e8e8ea',
    },
  };
}

function preset(id: string, name: string, mut: (b: BikeBuild) => void): BikeBuild {
  const b = defaultBuild();
  b.id = id;
  b.name = name;
  mut(b);
  return b;
}

/** Factory presets. Original designs; each one demonstrates a different handling character. */
export const PRESETS: BikeBuild[] = [
  defaultBuild(),
  preset('mudlark', 'Mudlark MX', (b) => {
    Object.assign(b.parts, { motor: 'brick10', controller: 'trail90', battery: 'stock60', fork: 'enduro', shock: 'enduro', handlebar: 'mx', seat: 'mx', fenders: 'high', bodyKit: 'armor' });
    b.front = { diameter: 21, width: 80, profile: 100, tread: 'knobby', compound: 'soft', pressure: 14 };
    b.rear = { diameter: 18, width: 120, profile: 100, tread: 'knobby', compound: 'soft', pressure: 13 };
    Object.assign(b.tuning, { frontSprocket: 11, rearSprocket: 52, forkSpring: 0.95, shockSpring: 0.95, tractionControl: true });
    Object.assign(b.visual, { plasticColor: '#ff6b1a', accentColor: '#1b1d22', decal: 'chevron', decalColor: '#1b1d22', number: '412', rimColor: '#c0c4cc', finish: 'satin' });
  }),
  preset('hornet', 'Asphalt Hornet SM', (b) => {
    Object.assign(b.parts, { motor: 'spin12', controller: 'race150', battery: 'volt72', fork: 'sm', shock: 'sm', yoke: 'stable', handlebar: 'flat', fenders: 'short', bodyKit: 'stock', brakes: 'quad', rimStyle: 'cast' });
    b.front = { diameter: 17, width: 110, profile: 70, tread: 'street', compound: 'soft', pressure: 28 };
    b.rear = { diameter: 17, width: 140, profile: 70, tread: 'street', compound: 'soft', pressure: 28 };
    Object.assign(b.tuning, { frontSprocket: 13, rearSprocket: 46, forkSpring: 1.1, shockSpring: 1.1, forkCompression: 13, shockCompression: 13, regen: 0.7 });
    Object.assign(b.visual, { plasticColor: '#ffc914', accentColor: '#1b1d22', frameColor: '#3a3f48', decal: 'bolt', decalColor: '#1b1d22', number: '08', rimColor: '#ffc914', finish: 'gloss' });
  }),
  preset('dart', 'Drift Dart', (b) => {
    Object.assign(b.parts, { motor: 'brick10', controller: 'race150', battery: 'volt72', fork: 'sm', shock: 'stock', swingarm: 'ext60', yoke: 'stable', fenders: 'short', brakes: 'quad' });
    b.front = { diameter: 17, width: 110, profile: 70, tread: 'street', compound: 'soft', pressure: 26 };
    b.rear = { diameter: 17, width: 120, profile: 70, tread: 'street', compound: 'hard', pressure: 32 };
    Object.assign(b.tuning, { frontSprocket: 12, rearSprocket: 50, regen: 0.2, throttleMap: 'aggressive' });
    Object.assign(b.visual, { plasticColor: '#ff4fa3', accentColor: '#00e5ff', frameColor: '#e8e8ea', decal: 'stripes', decalColor: '#00e5ff', number: '77', rimColor: '#e8e8ea', finish: 'metallic' });
  }),
  preset('mule', 'Stunt Mule', (b) => {
    Object.assign(b.parts, { motor: 'monster22', controller: 'apex300', battery: 'hyper84', fork: 'enduro', shock: 'enduro', swingarm: 'short', handlebar: 'mx', frame: 'reinforced', bodyKit: 'armor', brakes: 'race' });
    b.front = { diameter: 19, width: 80, profile: 100, tread: 'dualsport', compound: 'medium', pressure: 18 };
    b.rear = { diameter: 18, width: 120, profile: 100, tread: 'dualsport', compound: 'soft', pressure: 16 };
    Object.assign(b.tuning, { frontSprocket: 11, rearSprocket: 54, wheelieControl: true, tractionControl: false });
    Object.assign(b.visual, { plasticColor: '#3a2bd8', accentColor: '#ffc914', frameColor: '#1b1d22', decal: 'bolt', decalColor: '#ffc914', number: '1', rimColor: '#ffc914', finish: 'matte' });
  }),
];

const pick = <T>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const color = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);
const ids = (list: { id: string }[]) => list.map((p) => p.id);

function sanitizeTire(t: Partial<TireConfig> | undefined, front: boolean, d: TireConfig): TireConfig {
  const src = (t ?? {}) as Record<string, unknown>;
  return {
    diameter: pick(src.diameter, (front ? FRONT_DIAMETERS : REAR_DIAMETERS) as readonly number[], d.diameter),
    width: pick(src.width, (front ? FRONT_WIDTHS : REAR_WIDTHS) as readonly number[], d.width),
    profile: pick(src.profile, PROFILES as readonly number[], d.profile),
    tread: pick(src.tread, ids(TREADS), d.tread),
    compound: pick(src.compound, ids(COMPOUNDS), d.compound),
    pressure: Math.round(num(src.pressure, 8, 36, d.pressure)),
  };
}

/**
 * Coerce arbitrary (possibly corrupted, outdated, or user-imported) data into a valid build.
 * Unknown fields are dropped and invalid values fall back to stock.
 */
export function sanitizeBuild(raw: unknown): BikeBuild {
  const d = defaultBuild();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const p = (r.parts ?? {}) as Record<string, unknown>;
  const t = (r.tuning ?? {}) as Record<string, unknown>;
  const v = (r.visual ?? {}) as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.replace(/[<>]/g, '').trim().slice(0, 32) : '';
  const id = typeof r.id === 'string' && /^[\w-]{1,40}$/.test(r.id) ? r.id : `build-${Date.now().toString(36)}`;
  return {
    id,
    name: name || 'Custom Build',
    updated: num(r.updated, 0, 1e15, 0),
    parts: {
      motor: pick(p.motor, ids(MOTORS), d.parts.motor),
      controller: pick(p.controller, ids(CONTROLLERS), d.parts.controller),
      battery: pick(p.battery, ids(BATTERIES), d.parts.battery),
      fork: pick(p.fork, ids(FORKS), d.parts.fork),
      shock: pick(p.shock, ids(SHOCKS), d.parts.shock),
      swingarm: pick(p.swingarm, ids(SWINGARMS), d.parts.swingarm),
      yoke: pick(p.yoke, ids(YOKES), d.parts.yoke),
      handlebar: pick(p.handlebar, ids(HANDLEBARS), d.parts.handlebar),
      seat: pick(p.seat, ids(SEATS), d.parts.seat),
      fenders: pick(p.fenders, ids(FENDERS), d.parts.fenders),
      bodyKit: pick(p.bodyKit, ids(BODY_KITS), d.parts.bodyKit),
      frame: pick(p.frame, ids(FRAMES), d.parts.frame),
      lights: pick(p.lights, ids(LIGHTS), d.parts.lights),
      brakes: pick(p.brakes, ids(BRAKES), d.parts.brakes),
      rimStyle: pick(p.rimStyle, ids(RIM_STYLES), d.parts.rimStyle),
    },
    front: sanitizeTire(r.front, true, d.front),
    rear: sanitizeTire(r.rear, false, d.rear),
    tuning: {
      frontSprocket: Math.round(num(t.frontSprocket, SPROCKET_FRONT_RANGE[0], SPROCKET_FRONT_RANGE[1], d.tuning.frontSprocket)),
      rearSprocket: Math.round(num(t.rearSprocket, SPROCKET_REAR_RANGE[0], SPROCKET_REAR_RANGE[1], d.tuning.rearSprocket)),
      forkSpring: num(t.forkSpring, 0.6, 1.6, 1),
      shockSpring: num(t.shockSpring, 0.6, 1.6, 1),
      forkPreload: num(t.forkPreload, 0, 25, d.tuning.forkPreload),
      shockPreload: num(t.shockPreload, 0, 25, d.tuning.shockPreload),
      forkCompression: Math.round(num(t.forkCompression, 1, 20, 10)),
      forkRebound: Math.round(num(t.forkRebound, 1, 20, 10)),
      shockCompression: Math.round(num(t.shockCompression, 1, 20, 10)),
      shockRebound: Math.round(num(t.shockRebound, 1, 20, 10)),
      regen: num(t.regen, 0, 1, d.tuning.regen),
      throttleMap: pick(t.throttleMap, ['soft', 'linear', 'aggressive'] as const, 'linear'),
      tractionControl: bool(t.tractionControl, false),
      wheelieControl: bool(t.wheelieControl, false),
      riderPosition: num(t.riderPosition, -0.08, 0.08, 0),
    },
    visual: {
      frameColor: color(v.frameColor, d.visual.frameColor),
      plasticColor: color(v.plasticColor, d.visual.plasticColor),
      accentColor: color(v.accentColor, d.visual.accentColor),
      seatColor: color(v.seatColor, d.visual.seatColor),
      rimColor: color(v.rimColor, d.visual.rimColor),
      finish: pick(v.finish, FINISHES.map((f) => f.id), d.visual.finish),
      decal: pick(v.decal, DECALS.map((f) => f.id), d.visual.decal),
      decalColor: color(v.decalColor, d.visual.decalColor),
      number: typeof v.number === 'string' ? v.number.replace(/[^0-9A-Za-z]/g, '').slice(0, 3) || '27' : d.visual.number,
      plateColor: color(v.plateColor, d.visual.plateColor),
    },
  };
}

export function cloneBuild(b: BikeBuild): BikeBuild {
  return JSON.parse(JSON.stringify(b)) as BikeBuild;
}
