/** Timed activities with medals. All results come from the live physics, measured in-world. */
import type { BikeDynamics } from '../physics/bike';
import type { WorldData } from '../world/layout';
import type { Scorer } from './scoring';
import type { WorldView } from '../render/worldView';

export type Medal = 'gold' | 'silver' | 'bronze' | null;

export interface ChallengeDef {
  id: string;
  name: string;
  desc: string;
  spawn: string;
  /** gold, silver, bronze thresholds */
  medals: [number, number, number];
  lowerIsBetter: boolean;
  unit: 's' | 'm' | 'pts';
  limit?: number;
}

export const CHALLENGES: ChallengeDef[] = [
  { id: 'drag', name: 'Drag Strip 201 m', desc: 'Launch from a standstill and cover 201 m as fast as possible. Records 0–50 and 0–80 km/h.', spawn: 'drag', medals: [10.5, 12.5, 15], lowerIsBetter: true, unit: 's', limit: 60 },
  { id: 'brake', name: 'Brake Test', desc: 'Cross the red/white line at 50 km/h or more, then stop. Distance is normalised to 50 km/h.', spawn: 'drag', medals: [13, 16, 20], lowerIsBetter: true, unit: 'm', limit: 120 },
  { id: 'drift', name: 'Drift Pad', desc: 'Score as many drift points as you can on the pad in 60 seconds.', spawn: 'drift', medals: [5000, 2500, 900], lowerIsBetter: false, unit: 'pts', limit: 60 },
  { id: 'stunt', name: 'Stunt Park Jam', desc: 'Wheelies, stoppies, jumps and flips in 90 seconds. Chain tricks for multipliers.', spawn: 'stunt', medals: [9000, 4500, 1500], lowerIsBetter: false, unit: 'pts', limit: 90 },
  { id: 'lap', name: 'MX Track Lap', desc: 'One lap of the off-road track through every checkpoint.', spawn: 'track', medals: [72, 88, 110], lowerIsBetter: true, unit: 's', limit: 300 },
  { id: 'slalom', name: 'Cone Course', desc: 'Pass through every cone gate in order. +2 s per cone knocked down.', spawn: 'handling', medals: [30, 38, 50], lowerIsBetter: true, unit: 's', limit: 180 },
  { id: 'longjump', name: 'Long Jump', desc: 'Your longest jump in 2 minutes (takeoff to landing).', spawn: 'stunt', medals: [24, 17, 11], lowerIsBetter: false, unit: 'm', limit: 120 },
];

export function medalFor(def: ChallengeDef, v: number): Medal {
  const [g, s, b] = def.medals;
  if (def.lowerIsBetter) return v <= g ? 'gold' : v <= s ? 'silver' : v <= b ? 'bronze' : null;
  return v >= g ? 'gold' : v >= s ? 'silver' : v >= b ? 'bronze' : null;
}

export interface ChallengeCtx {
  bike: BikeDynamics;
  data: WorldData;
  scorer: Scorer;
  view: WorldView;
}

export class ChallengeRun {
  state: 'ready' | 'running' | 'done' | 'failed' = 'ready';
  elapsed = 0;
  result = 0;
  message = '';
  medal: Medal = null;
  extra: Record<string, number> = {};
  private idx = 0;
  private start = { x: 0, z: 0 };
  private baseScore = 0;
  private baseDrift = 0;
  private v0 = 0;
  private brakeStart: { x: number; z: number } | null = null;
  private penalty = 0;

  constructor(public def: ChallengeDef, ctx: ChallengeCtx) {
    this.start = { x: ctx.bike.pos.x, z: ctx.bike.pos.z };
    ctx.scorer.reset();
    if (def.id === 'slalom') ctx.view.resetCones();
    this.message = this.intro();
    if (def.id === 'drift' || def.id === 'stunt' || def.id === 'longjump') this.state = 'running';
  }

  private intro() {
    switch (this.def.id) {
      case 'drag': return 'Full throttle when ready — the clock starts as you move.';
      case 'brake': return 'Build speed and cross the stripes above 50 km/h, then brake hard.';
      case 'lap': return 'Ride through the start gate to begin.';
      case 'slalom': return 'Ride into the first gate to start the clock.';
      default: return this.def.desc;
    }
  }

  get timeLeft() {
    return this.def.limit ? Math.max(0, this.def.limit - this.elapsed) : Infinity;
  }

  get progressText(): string {
    const d = this.def;
    if (this.state === 'done' || this.state === 'failed') return this.message;
    switch (d.id) {
      case 'drag': return this.state === 'running' ? `${this.elapsed.toFixed(2)} s · ${this.extra.dist?.toFixed(0) ?? 0} m` : this.message;
      case 'brake': return this.brakeStart ? `Braking from ${(this.v0 * 3.6).toFixed(0)} km/h…` : this.message;
      case 'drift': return `${Math.round(this.result)} pts · ${this.timeLeft.toFixed(0)} s`;
      case 'stunt': return `${Math.round(this.result)} pts · ${this.timeLeft.toFixed(0)} s`;
      case 'longjump': return `Best ${this.result.toFixed(1)} m · ${this.timeLeft.toFixed(0)} s`;
      case 'lap': return this.state === 'running' ? `${this.elapsed.toFixed(1)} s · CP ${this.idx}/${this.extra.total}` : this.message;
      case 'slalom': return this.state === 'running' ? `${(this.elapsed + this.penalty).toFixed(1)} s · Gate ${this.idx}/${this.extra.total}` : this.message;
    }
    return '';
  }

  /** The point the player should head to next (for the HUD arrow / beacon). */
  target(ctx: ChallengeCtx): { x: number; z: number } | null {
    if (this.state === 'done' || this.state === 'failed') return null;
    if (this.def.id === 'lap') {
      const cps = ctx.data.track.checkpoints;
      return cps[this.idx % cps.length];
    }
    if (this.def.id === 'slalom') return ctx.data.handling.gates[Math.min(this.idx, ctx.data.handling.gates.length - 1)];
    if (this.def.id === 'brake' && !this.brakeStart) return { x: ctx.data.drag.brakeX, z: ctx.data.drag.z };
    return null;
  }

  private finish(value: number, msg?: string) {
    this.result = value;
    this.medal = medalFor(this.def, value);
    this.state = 'done';
    const u = this.def.unit === 's' ? 's' : this.def.unit === 'm' ? 'm' : 'pts';
    const fmt = this.def.unit === 'pts' ? Math.round(value).toString() : value.toFixed(2);
    this.message = msg ?? `${fmt} ${u}${this.medal ? ` — ${this.medal.toUpperCase()}` : ''}`;
  }

  private fail(msg: string) {
    this.state = 'failed';
    this.message = msg;
  }

  update(dt: number, ctx: ChallengeCtx) {
    if (this.state === 'done' || this.state === 'failed') return;
    const b = ctx.bike;
    const d = this.def;
    if (this.state === 'running') this.elapsed += dt;
    if (d.limit && this.elapsed >= d.limit) {
      if (d.id === 'drift' || d.id === 'stunt' || d.id === 'longjump') return this.finish(this.result);
      return this.fail('Out of time');
    }
    switch (d.id) {
      case 'drag': {
        const dist = Math.hypot(b.pos.x - this.start.x, b.pos.z - this.start.z);
        if (this.state === 'ready' && dist > 0.3) {
          this.state = 'running';
          this.elapsed = 0;
        }
        if (this.state !== 'running') return;
        this.extra.dist = dist;
        const kmh = b.speed * 3.6;
        if (this.extra.t50 === undefined && kmh >= 50) this.extra.t50 = this.elapsed;
        if (this.extra.t80 === undefined && kmh >= 80) this.extra.t80 = this.elapsed;
        this.extra.top = Math.max(this.extra.top ?? 0, b.speed);
        if (b.crashed) return this.fail('Crashed — try again');
        if (dist >= 201) this.finish(this.elapsed);
        return;
      }
      case 'brake': {
        const lineX = ctx.data.drag.brakeX;
        if (!this.brakeStart) {
          this.state = 'running';
          if (Math.abs(b.pos.z - ctx.data.drag.z) < 10 && b.pos.x >= lineX && b.pos.x - b.vel.x * dt < lineX + 0.5) {
            this.v0 = Math.hypot(b.vel.x, b.vel.z);
            if (this.v0 < 50 / 3.6) return this.fail(`Too slow: ${(this.v0 * 3.6).toFixed(0)} km/h (need 50+)`);
            this.brakeStart = { x: b.pos.x, z: b.pos.z };
          }
          return;
        }
        if (b.crashed) return this.fail('Crashed while braking');
        if (Math.hypot(b.vel.x, b.vel.z) < 0.3) {
          const dist = Math.hypot(b.pos.x - this.brakeStart.x, b.pos.z - this.brakeStart.z);
          const d50 = dist * Math.pow(50 / 3.6 / this.v0, 2);
          this.extra.raw = dist;
          this.extra.v0 = this.v0;
          this.finish(d50, `${d50.toFixed(1)} m from 50 km/h (raw ${dist.toFixed(1)} m from ${(this.v0 * 3.6).toFixed(0)} km/h)`);
          this.medal = medalFor(this.def, d50);
          if (this.medal) this.message += ` — ${this.medal.toUpperCase()}`;
        }
        return;
      }
      case 'drift': {
        const p = ctx.data.driftPad;
        const inPad = Math.hypot(b.pos.x - p.x, b.pos.z - p.z) < p.r + 4;
        const now = ctx.scorer.driftTotal;
        if (inPad) this.result += now - this.baseDrift;
        this.baseDrift = now;
        return;
      }
      case 'stunt': {
        const now = ctx.scorer.running;
        this.result = Math.max(this.result, this.baseScore + (now - this.baseScore));
        this.result = now;
        return;
      }
      case 'longjump': {
        this.result = ctx.scorer.longestJump;
        return;
      }
      case 'lap': {
        const cps = ctx.data.track.checkpoints;
        this.extra.total = cps.length;
        const cp = cps[this.idx % cps.length];
        if (Math.hypot(b.pos.x - cp.x, b.pos.z - cp.z) < 9) {
          if (this.state === 'ready') {
            this.state = 'running';
            this.elapsed = 0;
            this.idx = 1;
          } else {
            this.idx++;
            if (this.idx > cps.length) return this.finish(this.elapsed);
          }
        }
        return;
      }
      case 'slalom': {
        const gates = ctx.data.handling.gates;
        this.extra.total = gates.length;
        const g = gates[this.idx];
        if (g && Math.hypot(b.pos.x - g.x, b.pos.z - g.z) < 3) {
          if (this.state === 'ready') {
            this.state = 'running';
            this.elapsed = 0;
            ctx.view.resetCones();
          }
          this.idx++;
          if (this.idx >= gates.length) {
            this.penalty = ctx.view.conesDown * 2;
            return this.finish(this.elapsed + this.penalty, `${(this.elapsed + this.penalty).toFixed(2)} s (${ctx.view.conesDown} cones)${medalFor(this.def, this.elapsed + this.penalty) ? ' — ' + medalFor(this.def, this.elapsed + this.penalty)!.toUpperCase() : ''}`);
          }
        }
        this.penalty = ctx.view.conesDown * 2;
        return;
      }
    }
  }
}
