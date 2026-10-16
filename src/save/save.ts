/**
 * Local persistence. IndexedDB first, localStorage fallback, in-memory as a last resort
 * (private mode / storage blocked). Versioned with migration; corrupted data is quarantined
 * and replaced with defaults instead of breaking the game.
 */
import { PRESETS, cloneBuild, sanitizeBuild } from '../vehicle/build';
import type { BikeBuild, RideMode } from '../vehicle/build';
import { DEFAULT_BINDINGS } from '../input/input';
import type { Bindings } from '../input/input';
import type { DrainMode } from '../physics/powertrain';

export const SAVE_VERSION = 2;

export type Quality = 'low' | 'medium' | 'high';
export interface Settings {
  master: number;
  motor: number;
  sfx: number;
  ambience: number;
  quality: Quality;
  assist: number;
  camDistance: number;
  camSensitivity: number;
  steerSensitivity: number;
  units: 'kmh' | 'mph';
  showTelemetry: boolean;
  showFps: boolean;
  timeOfDay: 'day' | 'sunset' | 'night';
  drain: DrainMode;
  touchControls: 'auto' | 'on' | 'off';
  leftHanded: boolean;
  rideMode: RideMode;
  pedestrians: boolean;
}

export interface MedalRecord { best: number; medal: 'gold' | 'silver' | 'bronze' | null; buildName?: string }
export interface MeasuredRecord { t0to50?: number; t0to80?: number; brake50?: number; topSpeed?: number; at?: number }

export interface Progress {
  collected: string[];
  medals: Record<string, MedalRecord>;
  distance: number;
  bestDrift: number;
  bestStunt: number;
  measured: Record<string, MeasuredRecord>;
}

export interface SaveData {
  version: number;
  settings: Settings;
  builds: BikeBuild[];
  selectedBuildId: string;
  progress: Progress;
  bindings: Bindings;
}

export function defaultSettings(): Settings {
  const touch = typeof window !== 'undefined' && matchMedia?.('(pointer: coarse)').matches;
  return {
    master: 0.8, motor: 0.8, sfx: 0.8, ambience: 0.5, quality: touch ? 'medium' : 'high', assist: 0.65,
    camDistance: 4.2, camSensitivity: 1, steerSensitivity: 1, units: 'kmh', showTelemetry: true, showFps: false,
    timeOfDay: 'day', drain: 'relaxed', touchControls: 'auto', leftHanded: false, rideMode: 'standard', pedestrians: true,
  };
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    settings: defaultSettings(),
    builds: PRESETS.map((b) => ({ ...cloneBuild(b), id: `my-${b.id}` })),
    selectedBuildId: `my-${PRESETS[0].id}`,
    progress: { collected: [], medals: {}, distance: 0, bestDrift: 0, bestStunt: 0, measured: {} },
    bindings: structuredClone(DEFAULT_BINDINGS),
  };
}

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const pick = <T>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

/** Validate + migrate arbitrary data into a well-formed save. */
export function migrate(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, any>;
  // v1 stored settings under "options" and had no bindings.
  if ((r.version ?? 1) < 2 && r.options && !r.settings) r.settings = r.options;
  const s = (r.settings ?? {}) as Record<string, unknown>;
  const ds = d.settings;
  const settings: Settings = {
    master: num(s.master, 0, 1, ds.master), motor: num(s.motor, 0, 1, ds.motor), sfx: num(s.sfx, 0, 1, ds.sfx),
    ambience: num(s.ambience, 0, 1, ds.ambience), quality: pick(s.quality, ['low', 'medium', 'high'] as const, ds.quality),
    assist: num(s.assist, 0, 1, ds.assist), camDistance: num(s.camDistance, 2.5, 9, ds.camDistance),
    camSensitivity: num(s.camSensitivity, 0.2, 3, 1), steerSensitivity: num(s.steerSensitivity, 0.4, 2, 1),
    units: pick(s.units, ['kmh', 'mph'] as const, 'kmh'), showTelemetry: typeof s.showTelemetry === 'boolean' ? s.showTelemetry : true,
    showFps: s.showFps === true, timeOfDay: pick(s.timeOfDay, ['day', 'sunset', 'night'] as const, 'day'),
    drain: pick(s.drain, ['realistic', 'relaxed', 'off'] as const, ds.drain),
    touchControls: pick(s.touchControls, ['auto', 'on', 'off'] as const, 'auto'), leftHanded: s.leftHanded === true,
    rideMode: pick(s.rideMode, ['eco', 'standard', 'sport'] as const, 'standard'), pedestrians: s.pedestrians !== false,
  };
  const builds = Array.isArray(r.builds) ? r.builds.slice(0, 60).map(sanitizeBuild) : d.builds;
  // De-duplicate ids
  const seen = new Set<string>();
  for (const b of builds) {
    while (seen.has(b.id)) b.id = `${b.id}-x`;
    seen.add(b.id);
  }
  if (!builds.length) builds.push(...d.builds);
  const p = (r.progress ?? {}) as Record<string, any>;
  const medals: Record<string, MedalRecord> = {};
  if (p.medals && typeof p.medals === 'object') {
    for (const [k, m] of Object.entries(p.medals as Record<string, any>)) {
      if (!m || typeof m !== 'object' || typeof m.best !== 'number') continue;
      medals[k.slice(0, 40)] = { best: m.best, medal: pick(m.medal, ['gold', 'silver', 'bronze', null] as const, null), buildName: typeof m.buildName === 'string' ? m.buildName.slice(0, 32) : undefined };
    }
  }
  const measured: Record<string, MeasuredRecord> = {};
  if (p.measured && typeof p.measured === 'object') {
    for (const [k, m] of Object.entries(p.measured as Record<string, any>)) {
      if (!m || typeof m !== 'object') continue;
      const rec: MeasuredRecord = {};
      for (const f of ['t0to50', 't0to80', 'brake50', 'topSpeed', 'at'] as const) if (typeof m[f] === 'number' && Number.isFinite(m[f])) rec[f] = m[f];
      measured[k.slice(0, 40)] = rec;
    }
  }
  const bindings = structuredClone(DEFAULT_BINDINGS);
  if (r.bindings && typeof r.bindings === 'object') {
    for (const k of Object.keys(bindings) as (keyof Bindings)[]) {
      const v = (r.bindings as Record<string, unknown>)[k];
      if (Array.isArray(v) && v.every((c) => typeof c === 'string') && v.length) bindings[k] = v.slice(0, 3) as string[];
    }
  }
  const selected = typeof r.selectedBuildId === 'string' && builds.some((b) => b.id === r.selectedBuildId) ? r.selectedBuildId : builds[0].id;
  return {
    version: SAVE_VERSION,
    settings,
    builds,
    selectedBuildId: selected,
    progress: {
      collected: Array.isArray(p.collected) ? p.collected.filter((c: unknown) => typeof c === 'string').slice(0, 500) : [],
      medals,
      distance: num(p.distance, 0, 1e9, 0),
      bestDrift: num(p.bestDrift, 0, 1e9, 0),
      bestStunt: num(p.bestStunt, 0, 1e9, 0),
      measured,
    },
    bindings,
  };
}

// ---------------------------------------------------------------------------
interface Backend {
  name: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

function idbBackend(): Promise<Backend | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open('voltline', 1);
      const timer = setTimeout(() => resolve(null), 2500);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onerror = () => { clearTimeout(timer); resolve(null); };
      req.onblocked = () => { clearTimeout(timer); resolve(null); };
      req.onsuccess = () => {
        clearTimeout(timer);
        const db = req.result;
        const tx = <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) =>
          new Promise<T>((res, rej) => {
            const t = db.transaction('kv', mode);
            const r = fn(t.objectStore('kv'));
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
          });
        resolve({
          name: 'IndexedDB',
          get: async (k) => ((await tx('readonly', (s) => s.get(k))) as string | undefined) ?? null,
          set: async (k, v) => { await tx('readwrite', (s) => s.put(v, k)); },
        });
      };
    } catch {
      resolve(null);
    }
  });
}

function lsBackend(): Backend | null {
  try {
    const k = '__vl_test';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return {
      name: 'localStorage',
      get: async (key) => localStorage.getItem('voltline:' + key),
      set: async (key, v) => localStorage.setItem('voltline:' + key, v),
    };
  } catch {
    return null;
  }
}

function memBackend(): Backend {
  const m = new Map<string, string>();
  return { name: 'memory (not persistent)', get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } };
}

export class SaveSystem {
  data: SaveData = defaultSave();
  backend: Backend = memBackend();
  warning = '';
  private writing: Promise<void> = Promise.resolve();
  private pending = false;

  async load(): Promise<SaveData> {
    this.backend = (await idbBackend()) ?? lsBackend() ?? memBackend();
    if (this.backend.name.startsWith('memory')) this.warning = 'Storage is unavailable (private browsing?). Progress will not be saved.';
    try {
      const raw = await this.backend.get('save');
      if (raw) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          await this.backend.set('save-corrupt-' + Date.now(), raw).catch(() => {});
          this.warning = 'Your save data was damaged and has been reset (a backup copy was kept).';
          parsed = null;
        }
        this.data = migrate(parsed);
      }
    } catch {
      this.warning = 'Could not read saved data; starting fresh.';
    }
    // Ask the browser to keep our data (helps against iOS storage eviction where supported).
    try {
      await navigator.storage?.persist?.();
    } catch { /* not supported */ }
    return this.data;
  }

  /** Debounced, serialised write. */
  save() {
    if (this.pending) return this.writing;
    this.pending = true;
    this.writing = this.writing.then(async () => {
      await new Promise((r) => setTimeout(r, 150));
      this.pending = false;
      try {
        await this.backend.set('save', JSON.stringify(this.data));
      } catch {
        this.warning = 'Saving failed (storage full?).';
      }
    });
    return this.writing;
  }

  get selectedBuild(): BikeBuild {
    return this.data.builds.find((b) => b.id === this.data.selectedBuildId) ?? this.data.builds[0];
  }
}

export function exportBuild(b: BikeBuild): string {
  return JSON.stringify({ format: 'voltline-build', version: 1, build: b }, null, 2);
}

export function importBuild(text: string): BikeBuild {
  const parsed = JSON.parse(text);
  const raw = parsed && parsed.format === 'voltline-build' ? parsed.build : parsed;
  if (!raw || typeof raw !== 'object' || !raw.parts) throw new Error('Not a Voltline build file');
  const b = sanitizeBuild(raw);
  b.id = `imp-${Date.now().toString(36)}`;
  return b;
}
