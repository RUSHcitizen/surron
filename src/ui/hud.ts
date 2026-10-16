/** In-ride HUD. Updates text at ~15 Hz and bars every frame to keep DOM work cheap. */
import type { Game } from '../game/game';
import { h } from './dom';

export class Hud {
  el: HTMLDivElement;
  private speed!: HTMLElement;
  private unit!: HTMLElement;
  private power!: HTMLElement;
  private regen!: HTMLElement;
  private batt!: HTMLElement;
  private temp!: HTMLElement;
  private mode!: HTMLElement;
  private flag!: HTMLElement;
  private tele!: HTMLElement;
  private trick!: HTMLElement;
  private chain!: HTMLElement;
  private total!: HTMLElement;
  private ch!: HTMLElement;
  private chText!: HTMLElement;
  private arrow!: HTMLElement;
  private fps!: HTMLElement;
  private pops!: HTMLElement;
  private textTimer = 0;

  constructor(private game: Game, parent: HTMLElement) {
    this.el = h('div', { class: 'hud' });
    this.speed = h('span', {}, '0');
    this.unit = h('small', {}, 'km/h');
    this.mode = h('div', { class: 'hud-mode' }, 'STD');
    this.power = h('i');
    this.regen = h('i');
    this.batt = h('i');
    this.temp = h('i');
    this.flag = h('div', { class: 'hud-flag' });
    const speedo = h('div', { class: 'hud-speedo' },
      this.mode,
      h('div', { class: 'hud-speed' }, this.speed, this.unit),
      this.flag,
      h('div', { class: 'hud-bars' },
        h('div', { class: 'hud-line' }, h('span', {}, 'POWER'), h('span', { 'data-k': 'kw' }, '0 kW')),
        h('div', { class: 'bar' }, this.power),
        h('div', { class: 'bar regen' }, this.regen),
        h('div', { class: 'hud-line' }, h('span', {}, 'BATTERY'), h('span', { 'data-k': 'batt' }, '100%')),
        h('div', { class: 'bar batt' }, this.batt),
        h('div', { class: 'hud-line' }, h('span', {}, 'MOTOR'), h('span', { 'data-k': 'temp' }, '30°C')),
        h('div', { class: 'bar temp' }, this.temp),
      ),
    );
    this.tele = h('div', { class: 'hud-tele' });
    this.trick = h('div', { class: 'hud-trick' });
    this.chain = h('div', { class: 'hud-chain' });
    this.total = h('div', { class: 'hud-total' });
    this.arrow = h('span', { class: 'arrow' }, '▲');
    this.chText = h('span');
    this.ch = h('div', { class: 'hud-challenge' }, this.arrow, this.chText, h('button', { class: 'x', 'aria-label': 'Quit challenge', onclick: () => { this.game.endChallenge(); } }, '✕'));
    this.fps = h('div', { class: 'hud-fps' });
    this.pops = h('div');
    this.el.append(speedo, this.tele, h('div', { class: 'hud-score' }, this.trick, this.chain, this.total), this.ch, this.fps, this.pops);
    parent.append(this.el);
  }

  private pop(text: string, cls = '') {
    const p = h('div', { class: 'pop ' + cls }, text);
    this.pops.append(p);
    setTimeout(() => p.remove(), 1100);
  }

  update(dt: number) {
    const g = this.game;
    this.el.classList.toggle('hidden', !g.hudVisible);
    if (!g.hudVisible) return;
    const b = g.bike;
    const pt = b.pt;
    const s = g.settings;
    // Bars every frame
    const peakKw = b.spec.powertrain.maxPower / 1000;
    this.power.style.width = `${Math.max(0, Math.min(100, (pt.powerKw / peakKw) * 100))}%`;
    this.regen.style.width = `${Math.max(0, Math.min(100, (pt.regenKw / (peakKw * 0.4)) * 100))}%`;
    this.batt.style.width = `${pt.soc * 100}%`;
    this.temp.style.width = `${Math.max(0, Math.min(100, ((pt.motorTemp - 25) / (b.spec.powertrain.maxTemp - 25)) * 100))}%`;
    // Score events -> pops
    for (const e of g.scorer.events) {
      if (e.type === 'trick') this.pop(`${e.name} +${e.points}`);
      else if (e.type === 'bank') this.pop(`+${e.points}`, 'bank');
      else if (e.type === 'bust') this.pop('BUST', 'bust');
    }
    g.scorer.events.length = 0;
    // Challenge arrow
    const ch = g.challenge;
    this.ch.style.display = ch ? '' : 'none';
    if (ch) {
      const t = ch.target({ bike: b, data: g.data, scorer: g.scorer, view: g.view });
      this.arrow.style.display = t ? '' : 'none';
      if (t) {
        const cam = g.camera;
        const yawCam = Math.atan2(cam.position.x - b.pos.x, cam.position.z - b.pos.z) + Math.PI;
        const yawT = Math.atan2(t.x - b.pos.x, t.z - b.pos.z);
        this.arrow.style.transform = `rotate(${-(yawT - yawCam)}rad)`;
      }
    }
    this.textTimer -= dt;
    if (this.textTimer > 0) return;
    this.textTimer = 1 / 15;
    const mph = s.units === 'mph';
    const v = Math.abs(b.speed) * (mph ? 2.237 : 3.6);
    this.speed.textContent = v.toFixed(0);
    this.unit.textContent = mph ? 'mph' : 'km/h';
    this.mode.textContent = pt.mode === 'eco' ? 'ECO' : pt.mode === 'standard' ? 'STD' : 'SPORT';
    this.mode.className = 'hud-mode ' + pt.mode;
    const flags: string[] = [];
    if (pt.tcActive) flags.push('TC');
    if (pt.wcActive) flags.push('WHEELIE CTRL');
    if (pt.limiter === 'thermal') flags.push('HOT — DERATING');
    if (pt.limiter === 'battery') flags.push('LOW BATTERY');
    if (pt.regenKw > 0.2) flags.push('REGEN');
    if (b.crashed) flags.push('CRASHED — R TO RESET');
    this.flag.textContent = flags.join(' · ');
    const q = (k: string) => this.el.querySelector(`[data-k="${k}"]`)!;
    q('kw').textContent = `${pt.powerKw >= 0 ? pt.powerKw.toFixed(1) : '−' + pt.regenKw.toFixed(1)} kW`;
    q('batt').textContent = `${(pt.soc * 100).toFixed(0)}% · ${pt.voltage.toFixed(1)} V`;
    q('temp').textContent = `${pt.motorTemp.toFixed(0)}°C`;
    this.tele.style.display = s.showTelemetry ? '' : 'none';
    if (s.showTelemetry) {
      const d = (r: number) => ((r * 180) / Math.PI).toFixed(0);
      this.tele.innerHTML =
        `RPM <b>${Math.abs(pt.rpm).toFixed(0)}</b><br>` +
        `Torque <b>${pt.torque.toFixed(1)} N·m</b><br>` +
        `Lean <b>${d(b.lean)}°</b> Pitch <b>${d(b.pitch)}°</b><br>` +
        `Slip R <b>${d(b.rear.slipAngle)}°</b> κ <b>${b.rear.slipRatio.toFixed(2)}</b><br>` +
        `Susp F <b>${((b.front.compression / b.spec.front.travel) * 100).toFixed(0)}%</b> R <b>${((b.rear.compression / b.spec.rear.travel) * 100).toFixed(0)}%</b><br>` +
        `Surface <b>${b.rear.grounded ? b.rear.surface : 'air'}</b>`;
    }
    const sc = g.scorer;
    this.trick.textContent = sc.live && sc.live.points > 10 ? `${sc.live.name} ${sc.live.points}` : '';
    this.chain.textContent = sc.chain > 0 ? `Combo ${sc.chain} × ${sc.multiplier}` : '';
    this.total.textContent = sc.total > 0 ? `Score ${sc.total.toLocaleString()}` : '';
    if (ch) this.chText.textContent = `${ch.def.name}: ${ch.progressText}`;
    this.fps.style.display = s.showFps ? '' : 'none';
    if (s.showFps) this.fps.textContent = `${g.fps.toFixed(0)} fps`;
  }
}
