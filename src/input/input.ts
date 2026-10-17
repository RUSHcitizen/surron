/**
 * Input aggregation: keyboard (rebindable), gamepad and touch all feed one ControlState.
 * Digital inputs are smoothed into analog values so keyboard riding feels progressive.
 */
export type Action =
  | 'throttle' | 'frontBrake' | 'rearBrake' | 'steerLeft' | 'steerRight' | 'leanForward' | 'leanBack'
  | 'wheelie' | 'stoppie' | 'reset' | 'camera' | 'pause' | 'garage' | 'mode' | 'hud' | 'lights';

export const ACTION_LABELS: Record<Action, string> = {
  throttle: 'Throttle', frontBrake: 'Front brake', rearBrake: 'Rear brake', steerLeft: 'Steer left', steerRight: 'Steer right',
  leanForward: 'Lean forward', leanBack: 'Lean back / wheelie', wheelie: 'Wheelie (hold — too long loops out!)', stoppie: 'Stoppie (hold)', reset: 'Reset bike', camera: 'Change camera', pause: 'Pause',
  garage: 'Garage', mode: 'Ride mode', hud: 'Toggle HUD', lights: 'Headlight',
};

export type Bindings = Record<Action, string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  throttle: ['KeyW', 'ArrowUp'],
  frontBrake: ['KeyS', 'ArrowDown'],
  rearBrake: ['Space'],
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  leanForward: ['KeyE'],
  leanBack: ['KeyQ', 'ShiftLeft', 'ShiftRight'],
  wheelie: ['KeyZ'],
  stoppie: ['KeyX'],
  reset: ['KeyR'],
  camera: ['KeyC'],
  pause: ['Escape', 'KeyP'],
  garage: ['KeyG'],
  mode: ['KeyM'],
  hud: ['KeyH'],
  lights: ['KeyL'],
};

export interface ControlState {
  throttle: number;
  frontBrake: number;
  rearBrake: number;
  steer: number;
  lean: number;
  /** Trick buttons, 0/1 while held. */
  wheelie: number;
  stoppie: number;
}

/** Analog values written by the touch overlay (null when not touching). */
export interface TouchAxes {
  throttle: number;
  frontBrake: number;
  rearBrake: number;
  steer: number | null;
  lean: number | null;
  wheelie: number;
  stoppie: number;
}

const EDGE: Action[] = ['reset', 'camera', 'pause', 'garage', 'mode', 'hud', 'lights'];

export class Input {
  bindings: Bindings = structuredClone(DEFAULT_BINDINGS);
  private down = new Set<string>();
  private pressed = new Set<Action>();
  state: ControlState = { throttle: 0, frontBrake: 0, rearBrake: 0, steer: 0, lean: 0, wheelie: 0, stoppie: 0 };
  touch: TouchAxes = { throttle: 0, frontBrake: 0, rearBrake: 0, steer: null, lean: null, wheelie: 0, stoppie: 0 };
  steerSensitivity = 1;
  enabled = true;
  /** Mouse drag orbit for the camera (pixels since last read). */
  orbit = { dx: 0, dy: 0, active: false, wheel: 0 };
  lastDevice: 'keyboard' | 'touch' | 'gamepad' = 'keyboard';
  private gpPrev: boolean[] = [];
  /** Listening for a rebind: resolves with the code pressed. */
  private rebind: ((code: string) => void) | null = null;

  constructor(canvas: HTMLElement) {
    window.addEventListener('keydown', this.onKey, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && (e.button === 0 || e.button === 2)) {
        this.orbit.active = true;
        canvas.setPointerCapture(e.pointerId);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.orbit.active && e.pointerType === 'mouse') {
        this.orbit.dx += e.movementX;
        this.orbit.dy += e.movementY;
      }
    });
    canvas.addEventListener('pointerup', () => (this.orbit.active = false));
    canvas.addEventListener('wheel', (e) => {
      this.orbit.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.rebind) {
      e.preventDefault();
      const cb = this.rebind;
      this.rebind = null;
      cb(e.code);
      return;
    }
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    this.lastDevice = 'keyboard';
    if (!this.down.has(e.code)) {
      for (const a of EDGE) if (this.bindings[a].includes(e.code)) this.pressed.add(a);
    }
    this.down.add(e.code);
    // Keep the page from scrolling while riding.
    if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  listenForRebind(): Promise<string> {
    this.cancelRebind();
    return new Promise((res) => (this.rebind = res));
  }

  /** Abandon a pending rebind (resolves it with an empty code). */
  cancelRebind() {
    const cb = this.rebind;
    this.rebind = null;
    cb?.('');
  }

  isDown(a: Action) {
    return this.bindings[a].some((c) => this.down.has(c));
  }

  /** Edge-triggered action (consumed on read). */
  consume(a: Action) {
    const p = this.pressed.has(a);
    this.pressed.delete(a);
    return p;
  }

  press(a: Action) {
    this.pressed.add(a);
  }

  clearEdges() {
    this.pressed.clear();
  }

  update(dt: number, speed: number) {
    const s = this.state;
    const kb = this.enabled;
    // Gamepad
    let gp: Gamepad | null = null;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    let gThrottle = 0, gFront = 0, gRear = 0, gSteer = 0, gLean = 0, gWheelie = 0, gStoppie = 0;
    if (gp) {
      const ax = (i: number) => (Math.abs(gp!.axes[i] ?? 0) > 0.12 ? gp!.axes[i] : 0);
      const btn = (i: number) => gp!.buttons[i]?.value ?? 0;
      gThrottle = btn(7);
      gFront = btn(6);
      gRear = Math.max(btn(5), btn(1));
      gSteer = ax(0);
      gLean = -ax(3) || -ax(1) * 0.0;
      const map: [number, Action][] = [[3, 'reset'], [9, 'pause'], [8, 'camera'], [2, 'mode'], [4, 'leanBack']];
      for (const [i, a] of map) {
        const now = (gp.buttons[i]?.value ?? 0) > 0.5;
        if (now && !this.gpPrev[i] && a !== 'leanBack') this.pressed.add(a);
        this.gpPrev[i] = now;
      }
      if (gThrottle + gFront + gRear + Math.abs(gSteer) > 0.05) this.lastDevice = 'gamepad';
      if ((gp.buttons[4]?.value ?? 0) > 0.5) gLean = -1;
      gWheelie = (gp.buttons[0]?.value ?? 0) > 0.5 ? 1 : 0; // A
      gStoppie = (gp.buttons[10]?.value ?? 0) > 0.5 ? 1 : 0; // left stick click
    }
    const approach = (cur: number, target: number, up: number, down: number) => {
      const r = target > cur ? up : down;
      return cur + Math.max(-r * dt, Math.min(r * dt, target - cur));
    };
    const t = this.touch;
    const kThrottle = kb && this.isDown('throttle') ? 1 : 0;
    const kFront = kb && this.isDown('frontBrake') ? 1 : 0;
    const kRear = kb && this.isDown('rearBrake') ? 1 : 0;
    const kSteer = kb ? (this.isDown('steerRight') ? 1 : 0) - (this.isDown('steerLeft') ? 1 : 0) : 0;
    const kLean = kb ? (this.isDown('leanForward') ? 1 : 0) - (this.isDown('leanBack') ? 1 : 0) : 0;

    const throttleT = Math.max(kThrottle, gThrottle, t.throttle);
    const frontT = Math.max(kFront, gFront, t.frontBrake);
    const rearT = Math.max(kRear, gRear, t.rearBrake);
    // Digital throttle ramps in quickly but not instantly (no 0→100% torque spikes).
    s.throttle = kThrottle && !gThrottle && !t.throttle ? approach(s.throttle, 1, 5, 9) : approach(s.throttle, throttleT, 30, 30);
    s.frontBrake = kFront && !gFront ? approach(s.frontBrake, 1, 6, 12) : approach(s.frontBrake, frontT, 30, 30);
    s.rearBrake = approach(s.rearBrake, rearT, 14, 14);
    // Steering: keyboard ramps; slower at speed so taps make gentle lane changes.
    let steerT = kSteer;
    let analogSteer = false;
    if (Math.abs(gSteer) > 0) { steerT = gSteer; analogSteer = true; }
    let touchSteer = false;
    if (t.steer !== null) { steerT = t.steer; analogSteer = true; touchSteer = true; }
    steerT = Math.max(-1, Math.min(1, steerT * this.steerSensitivity));
    // A thumb on a glass stick jumps much faster than a real rider moves the bars: at speed,
    // touch steering is eased in (it still returns to centre quickly).
    const steerRate = touchSteer ? 12 / (1 + Math.abs(speed) / 18) : 12;
    if (analogSteer) s.steer = approach(s.steer, steerT, Math.abs(steerT) > Math.abs(s.steer) ? steerRate : 12, 12);
    else {
      const rate = (4.5 - Math.min(2, Math.abs(speed) / 15)) * this.steerSensitivity;
      const ret = 5;
      s.steer = approach(s.steer, steerT, steerT === 0 || Math.sign(steerT) !== Math.sign(s.steer) ? ret : rate, ret);
    }
    let leanT = kLean;
    if (gLean) leanT = gLean;
    if (t.lean !== null) leanT = t.lean;
    s.lean = approach(s.lean, leanT, 7, 7);
    s.wheelie = Math.max(kb && this.isDown('wheelie') ? 1 : 0, gWheelie, t.wheelie);
    s.stoppie = Math.max(kb && this.isDown('stoppie') ? 1 : 0, gStoppie, t.stoppie);
  }

  readOrbit() {
    const o = { dx: this.orbit.dx, dy: this.orbit.dy, wheel: this.orbit.wheel };
    this.orbit.dx = this.orbit.dy = this.orbit.wheel = 0;
    return o;
  }

  addOrbit(dx: number, dy: number) {
    this.orbit.dx += dx;
    this.orbit.dy += dy;
  }
}
