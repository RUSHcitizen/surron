/**
 * Drift & stunt scoring driven by the actual physics state. Tricks chain into a combo;
 * the chain banks after a moment of calm riding and is lost on a crash.
 */
import type { BikeDynamics } from '../physics/bike';

export interface ScoreEvent {
  type: 'trick' | 'bank' | 'bust';
  name?: string;
  points: number;
}

type Trick = 'drift' | 'wheelie' | 'stoppie' | 'air';

export class Scorer {
  total = 0;
  driftTotal = 0;
  chain = 0;
  multiplier = 1;
  events: ScoreEvent[] = [];
  /** Current live trick (for HUD). */
  live: { name: string; points: number } | null = null;
  bestDrift = 0;
  longestJump = 0;
  lastJump = 0;
  private active: Trick | null = null;
  private trickPts = 0;
  private trickTime = 0;
  private idle = 0;
  private tricksInChain = new Set<string>();
  private airStart: { x: number; z: number } | null = null;
  private landTimer = -1;
  private pendingAir: { pts: number; name: string; dist: number } | null = null;

  reset() {
    this.total = this.driftTotal = this.chain = 0;
    this.longestJump = this.lastJump = 0;
    this.multiplier = 1;
    this.events = [];
    this.live = null;
    this.active = null;
    this.trickPts = this.trickTime = this.idle = 0;
    this.tricksInChain.clear();
    this.airStart = null;
    this.landTimer = -1;
    this.pendingAir = null;
  }

  private finishTrick() {
    if (!this.active) return;
    if (this.trickPts >= 25 && this.trickTime > 0.35) {
      const name = this.active === 'drift' ? 'Drift' : this.active === 'wheelie' ? 'Wheelie' : this.active === 'stoppie' ? 'Stoppie' : 'Air';
      this.addToChain(name, this.trickPts);
      if (this.active === 'drift') this.bestDrift = Math.max(this.bestDrift, this.trickPts);
    }
    this.active = null;
    this.trickPts = 0;
    this.trickTime = 0;
    this.live = null;
  }

  private addToChain(name: string, pts: number) {
    const p = Math.round(pts);
    if (!this.tricksInChain.has(name)) {
      this.tricksInChain.add(name);
      if (this.tricksInChain.size > 1) this.multiplier = Math.min(5, this.multiplier + 1);
    }
    this.chain += p;
    this.events.push({ type: 'trick', name, points: p });
    this.idle = 0;
  }

  update(dt: number, b: BikeDynamics) {
    if (b.crashed) {
      if (this.chain > 0 || this.active) this.events.push({ type: 'bust', points: this.chain + Math.round(this.trickPts) });
      this.chain = 0;
      this.multiplier = 1;
      this.active = null;
      this.trickPts = 0;
      this.live = null;
      this.tricksInChain.clear();
      this.pendingAir = null;
      this.landTimer = -1;
      this.airStart = null;
      return;
    }
    const v = Math.abs(b.speed);
    const fG = b.front.grounded, rG = b.rear.grounded;
    let trick: Trick | null = null;
    let rate = 0;
    if (!fG && !rG) {
      trick = 'air';
      if (!this.airStart) this.airStart = { x: b.pos.x, z: b.pos.z };
    } else if (rG && !fG && b.pitch > 0.12 && v > 2) {
      trick = 'wheelie';
      rate = (30 + v * 4) * (1 + Math.min(1, (b.pitch - 0.12) * 2));
    } else if (fG && !rG && b.pitch < -0.08 && v > 2) {
      trick = 'stoppie';
      rate = 50 + v * 6;
    } else if (fG && rG && Math.abs(b.rear.slipAngle) > 0.2 && v > 3.5) {
      trick = 'drift';
      const ang = Math.min(1.2, Math.abs(b.rear.slipAngle));
      rate = ang * 57 * (1 + v / 6) * 2.2;
    }
    // Landing resolution: an airborne phase scores once the bike lands cleanly.
    if (this.active === 'air' && trick !== 'air') {
      const air = b.airTimeLast;
      const rot = b.airRotLast;
      const flips = Math.floor((Math.abs(rot.x) + 0.6) / (Math.PI * 2));
      const spins = Math.floor((Math.abs(rot.y) + 0.5) / (Math.PI * 2));
      let name = air > 1.2 ? 'Big Air' : 'Air';
      let pts = air > 0.4 ? 80 * air * air + 60 * air : 0;
      if (flips > 0) {
        name = (rot.x > 0 ? 'Frontflip' : 'Backflip') + (flips > 1 ? ` x${flips}` : '');
        pts += 1500 * flips;
      }
      if (spins > 0) {
        name += ` ${spins * 360}`;
        pts += 800 * spins;
      }
      const dist = this.airStart ? Math.hypot(b.pos.x - this.airStart.x, b.pos.z - this.airStart.z) : 0;
      this.airStart = null;
      this.active = null;
      this.live = null;
      if (pts > 0) {
        this.pendingAir = { pts, name, dist };
        this.landTimer = 0.45;
      }
    }
    if (this.landTimer >= 0) {
      this.landTimer -= dt;
      if (this.landTimer < 0 && this.pendingAir) {
        const clean = Math.abs(b.lean) < 0.5 && b.front.grounded && b.rear.grounded;
        this.addToChain(this.pendingAir.name + (clean ? '' : ' (sketchy)'), this.pendingAir.pts * (clean ? 1.25 : 0.6));
        this.lastJump = this.pendingAir.dist;
        this.longestJump = Math.max(this.longestJump, this.pendingAir.dist);
        this.pendingAir = null;
      }
    }
    if (trick !== this.active) {
      if (this.active !== 'air') this.finishTrick();
      this.active = trick;
      this.trickPts = 0;
      this.trickTime = 0;
    }
    if (trick) {
      this.trickTime += dt;
      this.trickPts += rate * dt;
      if (trick === 'drift') this.driftTotal += rate * dt;
      const label = trick === 'air' ? `Air ${b.airTime.toFixed(1)}s` : trick[0].toUpperCase() + trick.slice(1);
      this.live = { name: label, points: Math.round(this.trickPts) };
      this.idle = 0;
    } else {
      this.idle += dt;
    }
    if (this.chain > 0 && this.idle > 1.6 && this.landTimer < 0) {
      const banked = Math.round(this.chain * this.multiplier);
      this.total += banked;
      this.events.push({ type: 'bank', points: banked });
      this.chain = 0;
      this.multiplier = 1;
      this.tricksInChain.clear();
    }
  }

  /** Points including the unbanked chain (for timed challenges). */
  get running() {
    return this.total + Math.round(this.chain * this.multiplier);
  }
}
