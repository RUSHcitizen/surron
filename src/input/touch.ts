/**
 * Touch controls for phones/tablets (multitouch via pointer events).
 *  Left: steering/lean joystick (x = steer, y = lean). Right: throttle pad (vertical position
 *  = throttle amount), front and rear brake buttons. Top: pause / reset / camera / mode.
 *  Right-side free space: drag to orbit the camera.
 */
import type { Action, Input } from './input';

export class TouchControls {
  el: HTMLDivElement;
  private active = new Map<number, string>();
  private stickOrigin = { x: 0, y: 0 };
  private last = new Map<number, { x: number; y: number }>();
  private knob!: HTMLDivElement;
  private stick!: HTMLDivElement;
  private visible = false;
  leftHanded = false;

  constructor(private input: Input, parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'touch-ui';
    this.el.innerHTML = `
      <div class="t-orbit" data-zone="orbit"></div>
      <div class="t-stick" data-zone="stick"><div class="t-stick-base"></div><div class="t-knob"></div><span class="t-hint">STEER · LEAN</span></div>
      <div class="t-right">
        <div class="t-btn t-rear" data-zone="rear">REAR<br><small>brake</small></div>
        <div class="t-btn t-front" data-zone="front">FRONT<br><small>brake</small></div>
        <div class="t-throttle" data-zone="throttle"><div class="t-fill"></div><span>THROTTLE</span></div>
      </div>
      <div class="t-top">
        <button class="t-mini" data-action="pause" aria-label="Pause">❚❚</button>
        <button class="t-mini" data-action="reset" aria-label="Reset bike">⟲</button>
        <button class="t-mini" data-action="camera" aria-label="Camera">◉</button>
        <button class="t-mini" data-action="mode" aria-label="Ride mode">M</button>
      </div>`;
    parent.appendChild(this.el);
    this.knob = this.el.querySelector('.t-knob')!;
    this.stick = this.el.querySelector('.t-stick')!;
    for (const z of this.el.querySelectorAll<HTMLElement>('[data-zone]')) {
      z.addEventListener('pointerdown', (e) => this.onDown(e, z.dataset.zone!));
    }
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-action]')) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.input.press(b.dataset.action as Action);
        this.input.lastDevice = 'touch';
        navigator.vibrate?.(8);
      });
    }
    window.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    this.setVisible(false);
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.el.style.display = v ? '' : 'none';
    if (!v) this.releaseAll();
  }

  setLeftHanded(v: boolean) {
    this.leftHanded = v;
    this.el.classList.toggle('left-handed', v);
  }

  private releaseAll() {
    this.active.clear();
    const t = this.input.touch;
    t.throttle = t.frontBrake = t.rearBrake = 0;
    t.steer = t.lean = null;
    this.knob.style.transform = '';
    this.el.querySelectorAll('.pressed').forEach((e) => e.classList.remove('pressed'));
  }

  private onDown(e: PointerEvent, zone: string) {
    if (!this.visible) return;
    e.preventDefault();
    this.input.lastDevice = 'touch';
    this.active.set(e.pointerId, zone);
    this.last.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const target = e.currentTarget as HTMLElement;
    target.classList.add('pressed');
    if (zone === 'stick') {
      const r = this.stick.getBoundingClientRect();
      this.stickOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    this.apply(e, zone);
    if (zone !== 'orbit') navigator.vibrate?.(5);
  }

  private onMove = (e: PointerEvent) => {
    const zone = this.active.get(e.pointerId);
    if (!zone) return;
    e.preventDefault();
    this.apply(e, zone);
  };

  private onUp = (e: PointerEvent) => {
    const zone = this.active.get(e.pointerId);
    if (!zone) return;
    this.active.delete(e.pointerId);
    this.last.delete(e.pointerId);
    const t = this.input.touch;
    if (zone === 'stick') {
      t.steer = null;
      t.lean = null;
      this.knob.style.transform = '';
    } else if (zone === 'throttle') t.throttle = 0;
    else if (zone === 'front') t.frontBrake = 0;
    else if (zone === 'rear') t.rearBrake = 0;
    if (![...this.active.values()].includes(zone)) this.el.querySelector(`[data-zone="${zone}"]`)?.classList.remove('pressed');
    if (zone === 'throttle') (this.el.querySelector('.t-fill') as HTMLElement).style.height = '0%';
  };

  private apply(e: PointerEvent, zone: string) {
    const t = this.input.touch;
    if (zone === 'stick') {
      const R = 60;
      let dx = e.clientX - this.stickOrigin.x, dy = e.clientY - this.stickOrigin.y;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const sx = dx / R, sy = dy / R;
      // Small dead zone, then a gentle curve for fine steering.
      const curve = (v: number) => Math.sign(v) * Math.pow(Math.max(0, Math.abs(v) - 0.06) / 0.94, 1.3);
      t.steer = curve(sx);
      t.lean = Math.abs(sy) > 0.35 ? -curve(sy) : 0;
    } else if (zone === 'throttle') {
      const r = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect?.() ?? this.el.querySelector('.t-throttle')!.getBoundingClientRect();
      const f = 1 - (e.clientY - r.top) / r.height;
      t.throttle = Math.max(0.35, Math.min(1, 0.35 + f * 0.9));
      (this.el.querySelector('.t-fill') as HTMLElement).style.height = `${t.throttle * 100}%`;
    } else if (zone === 'front') t.frontBrake = 1;
    else if (zone === 'rear') t.rearBrake = 1;
    else if (zone === 'orbit') {
      const p = this.last.get(e.pointerId);
      if (p) this.input.addOrbit(e.clientX - p.x, e.clientY - p.y);
      this.last.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  }
}
