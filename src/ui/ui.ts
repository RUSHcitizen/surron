/** Screen manager: menus, pause, settings, challenges, help, toasts, results. */
import type { Game, GameState } from '../game/game';
import type { ChallengeRun } from '../gameplay/challenges';
import { ACTION_LABELS, DEFAULT_BINDINGS } from '../input/input';
import type { Action } from '../input/input';
import { defaultSave } from '../save/save';
import type { Settings } from '../save/save';
import { BODY_KITS, DECALS, RIM_STYLES } from '../vehicle/parts';
import { clear, download, h, segmented, slider, toggle } from './dom';
import { Garage } from './garage';
import { Hud } from './hud';

const TELEPORTS: [string, string][] = [
  ['hub', 'Hub & Garage'], ['city', 'City streets'], ['drag', 'Drag strip'], ['drift', 'Drift pad'], ['handling', 'Cone course'],
  ['track', 'MX track'], ['stunt', 'Stunt park'], ['offroad', 'Off-road hills'], ['sand', 'Sand pit'], ['lake', 'Lake'], ['highway', 'Highway'],
];

const keyName = (c: string) => c.replace(/^Key/, '').replace(/^Digit/, '').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('ShiftLeft', 'L-Shift').replace('ShiftRight', 'R-Shift').replace('Space', 'Space').replace('Escape', 'Esc');

export class UI {
  layer: HTMLDivElement;
  screen: HTMLDivElement;
  toasts: HTMLDivElement;
  hud: Hud;
  garage: Garage;
  private returnTo: GameState = 'menu';
  private announced = new Set<string>();

  constructor(private game: Game) {
    const root = document.getElementById('app')!;
    this.layer = h('div', { class: 'ui-layer' });
    this.screen = h('div');
    this.toasts = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    this.hud = new Hud(game, this.layer);
    this.garage = new Garage(game, this.layer);
    this.layer.append(this.screen, this.toasts);
    root.append(this.layer);
    // Prevent iOS double-tap zoom / gesture zoom while playing.
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    document.addEventListener('dblclick', (e) => e.preventDefault());
    // Pinch-zoom outside scrollable panels (iOS ignores user-scalable=no).
    document.addEventListener('touchmove', (e) => {
      if (e.touches.length > 1 && !(e.target as HTMLElement).closest?.('.garage-pinch')) e.preventDefault();
    }, { passive: false });
    // Unlock audio on interaction. iOS only grants audio from touchend/click, not touchstart,
    // and can leave the context "interrupted" after calls or app switches, so keep listening.
    const unlock = () => {
      void game.audio.unlock();
    };
    for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) window.addEventListener(ev, unlock, { passive: true });
    this.seedAnnounced();
  }

  /** Unlocks already satisfied by saved progress should not be announced again. */
  seedAnnounced() {
    for (const k of this.unlockKeys()) if (this.game.isUnlocked(k.key)) this.announced.add(k.key);
  }

  onState(s: GameState, _prev: GameState) {
    document.body.classList.toggle('riding', s === 'ride');
    document.body.classList.toggle('touching', s === 'ride' && this.game.touch.el.style.display !== 'none');
    this.hud.el.style.display = s === 'ride' ? '' : 'none';
    if (s === 'menu') this.showMenu();
    else if (s === 'pause') this.showPause();
    else if (s === 'ride') this.closeScreen();
  }

  toast(msg: string, ms = 2200) {
    const t = h('div', { class: 'toast' }, msg);
    this.toasts.append(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild?.remove();
    setTimeout(() => t.remove(), ms);
  }

  private closeScreen() {
    this.game.input.cancelRebind();
    clear(this.screen);
    this.screen.className = '';
  }

  private open(card: HTMLElement) {
    this.game.input.cancelRebind();
    clear(this.screen);
    this.screen.className = 'screen';
    this.screen.append(card);
    const first = card.querySelector<HTMLElement>('button.primary, button');
    first?.focus({ preventScroll: true });
  }

  private btn(label: string, fn: () => void, cls = '') {
    return h('button', { class: `btn block ${cls}`, onclick: () => { this.game.audio.click(); fn(); } }, label);
  }

  showMenu() {
    const g = this.game;
    const medals = Object.values(g.save.data.progress.medals).filter((m) => m.medal).length;
    this.open(h('div', { class: 'card menu-card' },
      h('div', { class: 'brand' }, h('div', { class: 'logo', html: 'STARK <span>VARG</span>' }), h('div', { class: 'tag' }, 'EBike · electric dirt-bike sandbox')),
      h('div', { class: 'menu-grid' },
        this.btn('Ride — free roam', () => { g.endChallenge(); g.setState('ride'); }, 'primary'),
        this.btn('Garage', () => this.openGarage()),
        this.btn('Challenges', () => this.showChallenges('menu')),
        this.btn('Settings', () => this.showSettings('menu')),
        this.btn('Controls & how to play', () => this.showHelp('menu')),
      ),
      h('div', { class: 'meta-row' },
        h('span', {}, 'Bike: ', h('b', {}, g.build.name)),
        h('span', {}, 'Charge cores: ', h('b', {}, `${g.collectedCount}/${g.data.collectibles.length}`)),
        h('span', {}, 'Medals: ', h('b', {}, String(medals))),
        h('span', {}, 'Best wheelie: ', h('b', {}, g.save.data.progress.bestWheelie ? `${g.save.data.progress.bestWheelie} m` : '—')),
        h('span', {}, 'Ridden: ', h('b', {}, `${(g.save.data.progress.distance / 1000).toFixed(1)} km`)),
        h('span', {}, 'Build: ', h('b', {}, __BUILD__)),
      ),
      h('p', { class: 'note', style: 'margin-top:14px' }, 'Every bike here is electric. Build it in the garage, then feel the difference on the street, the dirt and the test facilities. Works offline once installed.'),
    ));
  }

  showPause() {
    const g = this.game;
    const tp = h('div', { class: 'btn-row' }, ...TELEPORTS.map(([id, name]) => h('button', { class: 'btn small', onclick: () => { g.endChallenge(); g.respawn(id); g.setState('ride'); } }, name)));
    this.open(h('div', { class: 'card menu-card' },
      h('h2', {}, 'Paused'),
      h('div', { class: 'menu-grid' },
        this.btn('Resume', () => g.setState('ride'), 'primary'),
        this.btn('Reset bike', () => { g.bike.reset(); g.setState('ride'); }),
        this.btn('Garage', () => this.openGarage()),
        this.btn('Challenges', () => this.showChallenges('pause')),
        this.btn('Settings', () => this.showSettings('pause')),
        this.btn('Controls', () => this.showHelp('pause')),
        this.btn('Main menu', () => { g.endChallenge(); g.setState('menu'); }),
      ),
      h('div', { class: 'g-section' }, 'Go to'),
      tp,
    ));
  }

  showChallenges(back: 'menu' | 'pause') {
    const g = this.game;
    const list = h('div', { class: 'ch-list' });
    for (const c of g.challenges) {
      const rec = g.save.data.progress.medals[c.id];
      const fmt = (v: number) => (c.unit === 'pts' ? `${Math.round(v)} pts` : `${v.toFixed(c.unit === 's' ? 2 : 1)} ${c.unit}`);
      list.append(h('div', { class: 'ch' },
        h('h3', {}, h('span', { class: `medal ${rec?.medal ?? 'none'}` }), c.name),
        h('p', {}, c.desc),
        h('div', { class: 'best' }, rec ? `Best ${fmt(rec.best)}${rec.buildName ? ` · ${rec.buildName}` : ''}` : 'Not attempted'),
        h('div', { class: 'best' }, `Gold ${fmt(c.medals[0])} · Silver ${fmt(c.medals[1])} · Bronze ${fmt(c.medals[2])}`),
        h('button', { class: 'btn small primary', onclick: () => g.startChallenge(c) }, 'Start'),
      ));
    }
    this.open(h('div', { class: 'card wide' }, h('h2', {}, 'Challenges'), h('p', { class: 'sub' }, `Riding: ${g.build.name}. Results are measured live from the physics.`), list,
      h('div', { class: 'btn-row', style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: () => (back === 'menu' ? this.showMenu() : this.showPause()) }, 'Back'))));
  }

  challengeResult(ch: ChallengeRun) {
    const g = this.game;
    const card = h('div', { class: 'card' },
      h('h2', {}, ch.state === 'done' ? (ch.medal ? `${ch.medal[0].toUpperCase()}${ch.medal.slice(1)} medal!` : 'Finished') : 'Challenge failed'),
      h('p', { class: 'sub' }, `${ch.def.name} — ${ch.message}`),
    );
    if (ch.def.id === 'drag' && ch.state === 'done') {
      const e = ch.extra;
      card.append(h('div', { class: 'note' }, `0–50 km/h: ${e.t50?.toFixed(2) ?? '—'} s · 0–80 km/h: ${e.t80?.toFixed(2) ?? '—'} s · top ${((e.top ?? 0) * 3.6).toFixed(0)} km/h (measured)`));
    }
    card.append(h('div', { class: 'btn-row', style: 'margin-top:14px' },
      h('button', { class: 'btn primary', onclick: () => g.startChallenge(ch.def) }, 'Retry'),
      h('button', { class: 'btn', onclick: () => { g.endChallenge(); g.setState('ride'); } }, 'Free roam'),
      h('button', { class: 'btn', onclick: () => this.openGarage() }, 'Garage'),
    ));
    g.setState('pause');
    this.open(card);
  }

  private unlockKeys() {
    const out: { key: string; name: string }[] = [];
    for (const p of [...RIM_STYLES, ...BODY_KITS]) if (p.unlock) out.push({ key: p.unlock, name: p.name });
    for (const d of DECALS) if ((d as { unlock?: string }).unlock) out.push({ key: (d as { unlock?: string }).unlock!, name: `${d.name} decal` });
    return out;
  }

  /** Newly satisfied unlocks (announced once). */
  unlockMessages(_cores: number) {
    const msgs: string[] = [];
    for (const u of this.unlockKeys()) {
      if (!this.announced.has(u.key + u.name) && this.game.isUnlocked(u.key)) {
        this.announced.add(u.key + u.name);
        if (!this.announced.has(u.key)) msgs.push(`Unlocked: ${u.name} (garage)`);
      }
    }
    return msgs;
  }

  showSettings(back: 'menu' | 'pause', tab = 'gameplay') {
    const g = this.game;
    const s = g.settings;
    const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
      s[k] = v;
      g.applySettings();
      g.save.save();
    };
    const body = h('div');
    const tabs = h('div', { class: 'tabs' });
    const tabsDef = [['gameplay', 'Riding'], ['graphics', 'Graphics'], ['audio', 'Audio'], ['camera', 'Camera'], ['controls', 'Controls'], ['data', 'Data']] as const;
    const render = (t: string) => {
      g.input.cancelRebind();
      clear(body);
      tabs.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.t === t));
      if (t === 'gameplay') {
        body.append(
          segmented('Crashes', [{ id: 'arcade', name: 'Big hits only' }, { id: 'realistic', name: 'Realistic' }] as const, s.crashes, (v) => set('crashes', v)),
          h('div', { class: 'note' }, 'Big hits only: you crash only when you hit something at 30+ mph. Leaning, sliding and landings never throw you off, and a tipped bike stands back up. Realistic: lowsides, endos and hard landings count.'),
          slider('Rider assist', s.assist, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => set('assist', v)),
          h('div', { class: 'note' }, 'Assist = balance help, lean margin, and rider instincts (easing brake/throttle at the stoppie, loop-out and slide limits). 0% is raw physics: lowsides, loop-outs and endos are on you.'),
          slider('Steering sensitivity', s.steerSensitivity, 0.4, 2, 0.05, (v) => v.toFixed(2), (v) => set('steerSensitivity', v)),
          segmented('Default ride mode', [{ id: 'eco', name: 'Eco' }, { id: 'standard', name: 'Standard' }, { id: 'sport', name: 'Sport' }, { id: 'hyper', name: 'Hyper' }] as const, s.rideMode, (v) => set('rideMode', v)),
          segmented('Battery drain', [{ id: 'realistic', name: 'Realistic' }, { id: 'relaxed', name: 'Relaxed ×¼' }, { id: 'off', name: 'Off' }] as const, s.drain, (v) => set('drain', v)),
          segmented('Units', [{ id: 'kmh', name: 'km/h' }, { id: 'mph', name: 'mph' }] as const, s.units, (v) => set('units', v)),
          segmented('Time of day', [{ id: 'day', name: 'Day' }, { id: 'sunset', name: 'Sunset' }, { id: 'night', name: 'Night' }] as const, s.timeOfDay, (v) => set('timeOfDay', v)),
          toggle('Pedestrians', s.pedestrians, (v) => set('pedestrians', v)),
          toggle('City traffic', s.traffic, (v) => set('traffic', v)),
          toggle('Telemetry overlay', s.showTelemetry, (v) => set('showTelemetry', v)),
        );
      } else if (t === 'graphics') {
        body.append(
          segmented('Quality', [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }] as const, s.quality, (v) => set('quality', v)),
          h('div', { class: 'note' }, 'Low: no shadows, 1× resolution, fewer particles, pedestrians & cars — best for older phones. Tree density applies on next launch.'),
          toggle('Adaptive resolution', s.adaptiveResolution, (v) => set('adaptiveResolution', v)),
          h('div', { class: 'note' }, 'Lowers the render resolution a little when frames get slow, and raises it again when there is headroom. Recommended on phones.'),
          toggle('Show FPS', s.showFps, (v) => set('showFps', v)),
        );
      } else if (t === 'audio') {
        body.append(
          slider('Master', s.master, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => set('master', v)),
          slider('Motor', s.motor, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => set('motor', v)),
          slider('Effects', s.sfx, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => set('sfx', v)),
          slider('Ambience', s.ambience, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => set('ambience', v)),
        );
      } else if (t === 'camera') {
        body.append(
          slider('Chase distance', s.camDistance, 2.5, 9, 0.1, (v) => `${v.toFixed(1)} m`, (v) => set('camDistance', v)),
          slider('Orbit sensitivity', s.camSensitivity, 0.2, 3, 0.05, (v) => v.toFixed(2), (v) => set('camSensitivity', v)),
          h('div', { class: 'note' }, 'Press C (or ◉) to cycle chase / far / helmet. Drag with the mouse (or the right side of the screen) to look around; scroll to zoom.'),
        );
      } else if (t === 'controls') {
        const b = g.save.data.bindings;
        const list = h('div');
        for (const a of Object.keys(ACTION_LABELS) as Action[]) {
          const btn = h('button', { class: 'btn small' }, b[a].map(keyName).join(' / '));
          btn.addEventListener('click', async () => {
            btn.textContent = 'Press a key…';
            const code = await g.input.listenForRebind();
            if (!code) return; // cancelled (screen or tab changed)
            if (code !== 'Escape' || a === 'pause') {
              // Remove this key from other actions to avoid conflicts.
              for (const k of Object.keys(b) as Action[]) b[k] = b[k].filter((c) => c !== code);
              b[a] = [code, ...b[a].filter((c) => c !== code)].slice(0, 2);
              for (const k of Object.keys(b) as Action[]) if (!b[k].length) b[k] = [...DEFAULT_BINDINGS[k]];
              g.applySettings();
              g.save.save();
            }
            render('controls');
          });
          list.append(h('div', { class: 'row' }, h('span', { class: 'row-label' }, ACTION_LABELS[a]), h('div', { class: 'kbind' }, btn)));
        }
        body.append(
          list,
          h('div', { class: 'btn-row', style: 'margin:10px 0' }, h('button', { class: 'btn small', onclick: () => { g.save.data.bindings = structuredClone(DEFAULT_BINDINGS); g.applySettings(); g.save.save(); render('controls'); } }, 'Reset key bindings')),
          segmented('Touch controls', [{ id: 'auto', name: 'Auto' }, { id: 'on', name: 'Always' }, { id: 'off', name: 'Off' }] as const, s.touchControls, (v) => set('touchControls', v)),
          toggle('Left-handed touch layout', s.leftHanded, (v) => set('leftHanded', v)),
          h('div', { class: 'note' }, 'Gamepad: RT throttle, LT front brake, RB/B rear brake, left stick steer, right stick lean (LB = lean back), Y reset, Start pause, X ride mode.'),
        );
      } else if (t === 'data') {
        const st = g.save.backend.name;
        body.append(
          h('p', { class: 'note' }, `Saves are stored locally on this device in ${st}. Nothing is sent anywhere.`),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn small', onclick: () => download('voltline-save.json', JSON.stringify(g.save.data, null, 2)) }, 'Export all data'),
            h('button', { class: 'btn small danger', onclick: () => {
              if (!confirm('Erase all builds, settings and progress?')) return;
              g.save.data = defaultSave();
              void g.save.saveNow().then(() => location.reload());
            } }, 'Reset everything'),
          ),
          h('p', { class: 'note' }, 'iPhone tip: install to the Home Screen so Safari is less likely to evict saved data. Export your builds occasionally as a backup.'),
        );
      }
    };
    for (const [id, name] of tabsDef) {
      const t = h('button', { class: 'tab', 'data-t': id }, name);
      t.addEventListener('click', () => render(id));
      tabs.append(t);
    }
    this.open(h('div', { class: 'card' }, h('h2', {}, 'Settings'), tabs, body,
      h('div', { class: 'btn-row', style: 'margin-top:14px' }, h('button', { class: 'btn primary', onclick: () => (back === 'menu' ? this.showMenu() : this.showPause()) }, 'Done'))));
    render(tab);
  }

  showHelp(back: 'menu' | 'pause') {
    const b = this.game.save.data.bindings;
    const k = (a: Action) => h('span', {}, ...b[a].map((c) => h('kbd', {}, keyName(c))));
    const rows: [HTMLElement, string][] = [
      [k('throttle'), 'Throttle (hold — keyboard ramps in progressively)'],
      [k('frontBrake'), 'Front brake (strongest; too much = stoppie)'],
      [k('rearBrake'), 'Rear brake (lock it to slide / start drifts)'],
      [h('span', {}, k('steerLeft'), ' ', k('steerRight')), 'Steer — the rider leans the bike and countersteers for you'],
      [k('leanBack'), 'Lean back: shift weight / pop a wheelie / pull up in the air'],
      [k('leanForward'), 'Lean forward: keep the front down / stoppie / push down in the air'],
      [k('wheelie'), 'WHEELIE button: hold to ride a wheelie for as long as you like. Steer to turn on the back wheel, lean back/forward to raise or lower the front, throttle to pull harder.'],
      [k('stoppie'), 'STOPPIE button: hold for a stoppie (weight forward + front brake). Too long at speed = over the bars.'],
      [k('reset'), 'Reset bike to the last safe spot'],
      [k('camera'), 'Cycle camera (chase / far / helmet)'],
      [k('mode'), 'Ride mode Eco / Standard / Sport'],
      [k('garage'), 'Garage (build & tune)'],
      [k('pause'), 'Pause'],
      [h('span', {}, h('kbd', {}, 'Mouse drag'), ' ', h('kbd', {}, 'Wheel')), 'Look around / zoom'],
    ];
    this.open(h('div', { class: 'card wide' },
      h('h2', {}, 'How to ride'),
      h('div', { class: 'help-grid' }, ...rows.flatMap(([a, d]) => [a, h('span', {}, d)])),
      h('div', { class: 'g-section' }, 'Touch (landscape)'),
      h('p', { class: 'note' }, 'Left stick: steer (left/right) and lean (up = forward, down = back). Right: tall THROTTLE pad (slide up for more), FRONT and REAR brake buttons, and WHEELIE / STOPPIE trick buttons above the brakes. The wheelie button fills red the longer you hold it: let go before it is full or you fall off the back. Top-right: pause, reset, camera, ride mode. Drag the upper-right area to look around. All buttons work simultaneously.'),
      h('div', { class: 'g-section' }, 'Tips'),
      h('p', { class: 'note' }, 'Drifts: on dirt, steer into a turn and roll on the throttle with a torquey motor — or tap the rear brake to unsettle the rear, then hold throttle and let the bars follow the slide. Wheelies: hold WHEELIE (Z) to ride on the back wheel for as long as you like; steer to turn on one wheel, lean back/forward to raise or lower the front, add throttle to pull harder. Or do it by hand: lean back + throttle and feather it at the balance point; tap the rear brake to drop the front. Jumps: neutral bars for a level landing, lean to rotate. Customize in the garage: gearing, tires and suspension all change the physics.'),
      h('div', { class: 'btn-row', style: 'margin-top:14px' }, h('button', { class: 'btn primary', onclick: () => (back === 'menu' ? this.showMenu() : this.showPause()) }, 'Back')),
    ));
  }

  openGarage() {
    const g = this.game;
    this.returnTo = g.state === 'menu' ? 'menu' : 'ride';
    this.closeScreen();
    g.setState('garage');
    this.hud.el.style.display = 'none';
    this.garage.show();
  }

  closeGarage(ride: boolean) {
    this.garage.hide();
    const g = this.game;
    g.cam.snap();
    g.setState(ride ? 'ride' : this.returnTo);
  }
}
