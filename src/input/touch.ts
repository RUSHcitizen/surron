/**
 * Touch controls for phones/tablets (multitouch via pointer events).
 *
 *  Left half: floating steering/lean stick. The stick centres wherever the thumb lands
 *  (x = steer, y = lean: up = forward, down = back/wheelie).
 *  Right cluster: throttle pad (vertical position = throttle amount) plus FRONT and REAR
 *  brake buttons. A thumb can slide between them without lifting (cover the brake, roll
 *  off the throttle), and several fingers can hold different buttons at once.
 *  Top: pause / reset / camera / mode. Free space on the right: drag to orbit the camera.
 *
 * All state is recomputed from the set of live pointers on every event, so lifting one of
 * two fingers on the same control never releases it by mistake.
 */
import type { Action, Input } from './input';

type Zone = 'stick' | 'cluster' | 'orbit';
type Sub = 'throttle' | 'front' | 'rear' | 'wheelie' | 'stoppie' | null;
type Btn = Exclude<Sub, null>;

interface Ptr {
  zone: Zone;
  x: number;
  y: number;
  sub: Sub;
}

const STICK_R = 56;
/** Extra hit margin (px) around cluster buttons so a slightly-off thumb still counts. */
const PAD = 10;

export class TouchControls {
  el: HTMLDivElement;
  private ptrs = new Map<number, Ptr>();
  private stickPtr = -1;
  private stickOrigin = { x: 0, y: 0 };
  private knob: HTMLDivElement;
  private stickBase: HTMLDivElement;
  private stickZone: HTMLDivElement;
  private fill: HTMLDivElement;
  private btn: Record<Btn, HTMLElement>;
  private rects: Record<Btn, DOMRect> | null = null;
  private visible = false;
  leftHanded = false;

  constructor(private input: Input, parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'touch-ui';
    this.el.innerHTML = `
      <div class="t-orbit" data-zone="orbit"></div>
      <div class="t-stick-zone" data-zone="stick">
        <div class="t-stick"><div class="t-stick-base"></div><div class="t-knob"></div><span class="t-hint">STEER · LEAN</span></div>
      </div>
      <div class="t-right" data-zone="cluster">
        <div class="t-btn t-trick t-wheelie" data-sub="wheelie">WHEELIE<small>hold · not too long!</small></div>
        <div class="t-btn t-trick t-stoppie" data-sub="stoppie">STOPPIE<small>hold</small></div>
        <div class="t-btn t-rear" data-sub="rear">REAR<small>brake</small></div>
        <div class="t-btn t-front" data-sub="front">FRONT<small>brake</small></div>
        <div class="t-throttle" data-sub="throttle"><div class="t-fill"></div><span>THROTTLE</span></div>
      </div>
      <div class="t-top">
        <button class="t-mini" data-action="pause" aria-label="Pause">❚❚</button>
        <button class="t-mini" data-action="reset" aria-label="Reset bike">⟲</button>
        <button class="t-mini" data-action="camera" aria-label="Camera">◉</button>
        <button class="t-mini" data-action="mode" aria-label="Ride mode">M</button>
      </div>`;
    parent.appendChild(this.el);
    this.knob = this.el.querySelector('.t-knob')!;
    this.stickBase = this.el.querySelector('.t-stick')!;
    this.stickZone = this.el.querySelector('.t-stick-zone')!;
    this.fill = this.el.querySelector('.t-fill')!;
    this.btn = {
      throttle: this.el.querySelector('.t-throttle')!,
      front: this.el.querySelector('.t-front')!,
      rear: this.el.querySelector('.t-rear')!,
      wheelie: this.el.querySelector('.t-wheelie')!,
      stoppie: this.el.querySelector('.t-stoppie')!,
    };
    for (const z of this.el.querySelectorAll<HTMLElement>('[data-zone]')) {
      z.addEventListener('pointerdown', (e) => this.onDown(e, z.dataset.zone as Zone));
    }
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-action]')) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.input.press(b.dataset.action as Action);
        this.input.lastDevice = 'touch';
        b.classList.add('pressed');
        setTimeout(() => b.classList.remove('pressed'), 140);
        navigator.vibrate?.(8);
      });
      // A click would otherwise refocus the button and can trigger iOS "tap to zoom" heuristics.
      b.addEventListener('click', (e) => e.preventDefault());
    }
    window.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    // iOS: block the callout/selection menu on long presses and stray scroll gestures.
    this.el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    this.el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.setVisible(false);
  }

  get isVisible() {
    return this.visible;
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.el.style.display = v ? '' : 'none';
    document.body.classList.toggle('touching', v);
    if (!v) this.releaseAll();
  }

  setLeftHanded(v: boolean) {
    this.leftHanded = v;
    this.el.classList.toggle('left-handed', v);
    this.resetStickVisual();
  }

  /** Release everything (also used when the app loses focus mid-touch). */
  releaseAll() {
    this.ptrs.clear();
    this.stickPtr = -1;
    const t = this.input.touch;
    t.throttle = t.frontBrake = t.rearBrake = t.wheelie = t.stoppie = 0;
    t.steer = t.lean = null;
    this.resetStickVisual();
    this.refreshCluster();
  }

  private resetStickVisual() {
    this.knob.style.transform = '';
    this.stickBase.style.left = this.stickBase.style.top = this.stickBase.style.bottom = this.stickBase.style.right = '';
    this.stickBase.classList.remove('pressed');
  }

  private onDown(e: PointerEvent, zone: Zone) {
    if (!this.visible) return;
    e.preventDefault();
    this.input.lastDevice = 'touch';
    const p: Ptr = { zone, x: e.clientX, y: e.clientY, sub: null };
    if (zone === 'stick') {
      if (this.stickPtr !== -1) return; // one thumb steers
      this.stickPtr = e.pointerId;
      // Float the stick to where the thumb landed (kept fully inside its zone).
      const zr = this.stickZone.getBoundingClientRect();
      const m = STICK_R + 14;
      const ox = Math.min(zr.right - m, Math.max(zr.left + m, e.clientX));
      const oy = Math.min(zr.bottom - m, Math.max(zr.top + m, e.clientY));
      this.stickOrigin = { x: ox, y: oy };
      const half = this.stickBase.offsetWidth / 2;
      this.stickBase.style.left = `${ox - zr.left - half}px`;
      this.stickBase.style.top = `${oy - zr.top - half}px`;
      this.stickBase.style.bottom = 'auto';
      this.stickBase.style.right = 'auto';
      this.stickBase.classList.add('pressed');
    } else if (zone === 'cluster') {
      const rr = (k: Btn) => this.btn[k].getBoundingClientRect();
      this.rects = { throttle: rr('throttle'), front: rr('front'), rear: rr('rear'), wheelie: rr('wheelie'), stoppie: rr('stoppie') };
    }
    this.ptrs.set(e.pointerId, p);
    this.apply(e.pointerId, p, e.clientX, e.clientY);
    if (zone !== 'orbit') navigator.vibrate?.(5);
  }

  private onMove = (e: PointerEvent) => {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    this.apply(e.pointerId, p, e.clientX, e.clientY);
  };

  private onUp = (e: PointerEvent) => {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    this.ptrs.delete(e.pointerId);
    if (p.zone === 'stick' && e.pointerId === this.stickPtr) {
      this.stickPtr = -1;
      const t = this.input.touch;
      t.steer = null;
      t.lean = null;
      this.resetStickVisual();
    } else if (p.zone === 'cluster') this.refreshCluster();
  };

  private apply(id: number, p: Ptr, x: number, y: number) {
    const t = this.input.touch;
    if (p.zone === 'stick') {
      if (id !== this.stickPtr) return;
      let dx = x - this.stickOrigin.x, dy = y - this.stickOrigin.y;
      const l = Math.hypot(dx, dy);
      if (l > STICK_R) {
        dx *= STICK_R / l;
        dy *= STICK_R / l;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const sx = dx / STICK_R, sy = dy / STICK_R;
      // Small dead zone, then a gentle curve for fine steering.
      const curve = (v: number, dz: number) => Math.sign(v) * Math.pow(Math.max(0, Math.abs(v) - dz) / (1 - dz), 1.3);
      t.steer = curve(sx, 0.06);
      // Lean needs a deliberate vertical push so hard steering doesn't trigger wheelies.
      t.lean = -curve(sy, 0.32);
    } else if (p.zone === 'cluster') {
      p.x = x;
      p.y = y;
      p.sub = this.hit(x, y);
      this.refreshCluster();
    } else if (p.zone === 'orbit') {
      this.input.addOrbit(x - p.x, y - p.y);
      p.x = x;
      p.y = y;
    }
  }

  private hit(x: number, y: number): Sub {
    const r = this.rects;
    if (!r) return null;
    const inside = (b: DOMRect) => x >= b.left - PAD && x <= b.right + PAD && y >= b.top - PAD && y <= b.bottom + PAD;
    // Throttle first: it is the biggest target and the one most often slid onto.
    if (inside(r.throttle)) return 'throttle';
    if (inside(r.front)) return 'front';
    if (inside(r.rear)) return 'rear';
    // Trick buttons: no extra margin so a thumb on the brakes never triggers them.
    const exact = (b: DOMRect) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
    if (exact(r.wheelie)) return 'wheelie';
    if (exact(r.stoppie)) return 'stoppie';
    return null;
  }

  /** 0..1 danger meter on the wheelie button (1 = about to loop out). */
  setWheelieHold(f: number) {
    const v = Math.max(0, Math.min(1, f)).toFixed(2);
    if (v !== this.lastHold) {
      this.lastHold = v;
      this.btn.wheelie.style.setProperty('--hold', v);
    }
  }
  private lastHold = '';

  /** Aggregate all cluster pointers into throttle/brake values and button highlights. */
  private refreshCluster() {
    const t = this.input.touch;
    let thr = 0, front = 0, rear = 0, wheelie = 0, stoppie = 0;
    for (const p of this.ptrs.values()) {
      if (p.zone !== 'cluster' || !p.sub) continue;
      if (p.sub === 'front') front = 1;
      else if (p.sub === 'rear') rear = 1;
      else if (p.sub === 'wheelie') wheelie = 1;
      else if (p.sub === 'stoppie') stoppie = 1;
      else if (this.rects) {
        const r = this.rects.throttle;
        const f = 1 - (p.y - r.top) / r.height;
        thr = Math.max(thr, Math.max(0.35, Math.min(1, 0.35 + f * 0.9)));
      }
    }
    t.throttle = thr;
    t.frontBrake = front;
    t.rearBrake = rear;
    t.wheelie = wheelie;
    t.stoppie = stoppie;
    this.btn.wheelie.classList.toggle('pressed', wheelie > 0);
    this.btn.stoppie.classList.toggle('pressed', stoppie > 0);
    this.fill.style.height = `${thr * 100}%`;
    this.btn.throttle.classList.toggle('pressed', thr > 0);
    this.btn.front.classList.toggle('pressed', front > 0);
    this.btn.rear.classList.toggle('pressed', rear > 0);
  }
}
