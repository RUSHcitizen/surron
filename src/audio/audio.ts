/**
 * Procedural Web Audio: no sample files. Created only after a user gesture (autoplay rules).
 *
 * Electric drivetrain voice = motor electrical whine (rpm × pole pairs) + primary gear mesh
 * tone + PWM controller hiss under load + chain/drivetrain noise; regen gets a softer tone.
 */
import type { SurfaceId } from '../vehicle/parts';

export interface AudioFrame {
  rpm: number;
  load: number; // -1 (regen) .. 1 (full drive)
  speed: number;
  slip: number; // 0..1+ (squeal amount)
  surface: SurfaceId;
  grounded: boolean;
  distance: number; // camera to bike
  whine: number;
  pwm: number;
  city: number; // 0 nature .. 1 city
  paused: boolean;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private motorBus!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private noise!: AudioBuffer;
  private motorOsc: OscillatorNode[] = [];
  private motorGain: GainNode[] = [];
  private motorFilter!: BiquadFilterNode;
  private pwmGain!: GainNode;
  private pwmFilter!: BiquadFilterNode;
  private chainGain!: GainNode;
  private tireGain!: GainNode;
  private tireFilter!: BiquadFilterNode;
  private squealGain!: GainNode;
  private squealOsc!: OscillatorNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private cityGain!: GainNode;
  private natureGain!: GainNode;
  private birdTimer = 0;
  volumes = { master: 0.8, motor: 0.8, sfx: 0.8, ambience: 0.5 };
  muted = false;

  /** Must be called from a user gesture handler. */
  async unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.motorBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    for (const b of [this.motorBus, this.sfxBus, this.ambBus]) b.connect(this.master);
    this.applyVolumes();

    // White-noise buffer shared by all noise voices.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b0 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.97 * b0 + 0.03 * w; // a touch of pink
      d[i] = w * 0.6 + b0 * 2;
    }

    // Motor: fundamental whine, 2nd harmonic, gear mesh tone.
    this.motorFilter = ctx.createBiquadFilter();
    this.motorFilter.type = 'lowpass';
    this.motorFilter.frequency.value = 2500;
    this.motorFilter.Q.value = 0.7;
    this.motorFilter.connect(this.motorBus);
    const types: OscillatorType[] = ['sawtooth', 'triangle', 'sine'];
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.type = types[i];
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(g).connect(this.motorFilter);
      o.start();
      this.motorOsc.push(o);
      this.motorGain.push(g);
    }
    // PWM / inverter hiss (high band-passed noise) under load.
    const pwmSrc = this.loopNoise();
    this.pwmFilter = ctx.createBiquadFilter();
    this.pwmFilter.type = 'bandpass';
    this.pwmFilter.frequency.value = 7000;
    this.pwmFilter.Q.value = 6;
    this.pwmGain = ctx.createGain();
    this.pwmGain.gain.value = 0;
    pwmSrc.connect(this.pwmFilter).connect(this.pwmGain).connect(this.motorBus);
    // Chain / drivetrain rattle
    const chainSrc = this.loopNoise();
    const chainF = ctx.createBiquadFilter();
    chainF.type = 'bandpass';
    chainF.frequency.value = 1200;
    chainF.Q.value = 1.2;
    this.chainGain = ctx.createGain();
    this.chainGain.gain.value = 0;
    chainSrc.connect(chainF).connect(this.chainGain).connect(this.motorBus);
    // Tire rolling noise
    const tireSrc = this.loopNoise();
    this.tireFilter = ctx.createBiquadFilter();
    this.tireFilter.type = 'lowpass';
    this.tireFilter.frequency.value = 800;
    this.tireGain = ctx.createGain();
    this.tireGain.gain.value = 0;
    tireSrc.connect(this.tireFilter).connect(this.tireGain).connect(this.sfxBus);
    // Squeal: tonal + narrow noise band
    this.squealOsc = ctx.createOscillator();
    this.squealOsc.type = 'triangle';
    this.squealOsc.frequency.value = 950;
    const sqNoise = this.loopNoise();
    const sqF = ctx.createBiquadFilter();
    sqF.type = 'bandpass';
    sqF.frequency.value = 2600;
    sqF.Q.value = 10;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    const sqMix = ctx.createGain();
    sqMix.gain.value = 0.25;
    this.squealOsc.connect(sqMix).connect(this.squealGain);
    sqNoise.connect(sqF).connect(this.squealGain);
    this.squealGain.connect(this.sfxBus);
    this.squealOsc.start();
    // Wind
    const windSrc = this.loopNoise();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 300;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    windSrc.connect(this.windFilter).connect(this.windGain).connect(this.sfxBus);
    // Ambience: city hum vs. breezy nature bed
    const citySrc = this.loopNoise();
    const cityF = ctx.createBiquadFilter();
    cityF.type = 'lowpass';
    cityF.frequency.value = 180;
    this.cityGain = ctx.createGain();
    this.cityGain.gain.value = 0;
    citySrc.connect(cityF).connect(this.cityGain).connect(this.ambBus);
    const natSrc = this.loopNoise();
    const natF = ctx.createBiquadFilter();
    natF.type = 'bandpass';
    natF.frequency.value = 600;
    natF.Q.value = 0.4;
    this.natureGain = ctx.createGain();
    this.natureGain.gain.value = 0;
    natSrc.connect(natF).connect(this.natureGain).connect(this.ambBus);
  }

  private loopNoise() {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    s.start(0, Math.random() * 1.5);
    return s;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, t, 0.05);
    this.motorBus.gain.setTargetAtTime(this.volumes.motor, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.ambBus.gain.setTargetAtTime(this.volumes.ambience, t, 0.05);
  }

  suspend() {
    this.ctx?.suspend().catch(() => {});
  }
  resume() {
    this.ctx?.resume().catch(() => {});
  }

  update(f: AudioFrame, dt: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const tc = 0.04;
    const atten = 1 / (1 + Math.max(0, f.distance - 3) / 8);
    const mute = f.paused ? 0 : 1;
    const rpmAbs = Math.abs(f.rpm);
    // Electrical frequency: 5 pole pairs; gear mesh: 11 teeth on the motor pinion.
    const fElec = (rpmAbs / 60) * 5 * f.whine;
    const fGear = (rpmAbs / 60) * 11 * 0.5;
    const loadAbs = Math.min(1, Math.abs(f.load));
    const regen = f.load < -0.02;
    const spin = Math.min(1, rpmAbs / 7000);
    this.motorOsc[0].frequency.setTargetAtTime(30 + fElec, t, tc);
    this.motorOsc[1].frequency.setTargetAtTime(30 + fElec * 2, t, tc);
    this.motorOsc[2].frequency.setTargetAtTime(60 + fGear, t, tc);
    const base = (0.02 + spin * 0.06 + loadAbs * 0.09) * atten * mute;
    this.motorGain[0].gain.setTargetAtTime(base * (regen ? 0.35 : 0.55), t, tc);
    this.motorGain[1].gain.setTargetAtTime(base * (regen ? 0.4 : 0.25), t, tc);
    this.motorGain[2].gain.setTargetAtTime(base * (0.5 + spin * 0.6), t, tc);
    this.motorFilter.frequency.setTargetAtTime(700 + spin * 2600 + loadAbs * 1500, t, tc);
    this.pwmFilter.frequency.setTargetAtTime(5200 + loadAbs * 3000 * f.pwm, t, tc);
    this.pwmGain.gain.setTargetAtTime(loadAbs * 0.025 * f.pwm * atten * mute, t, tc);
    this.chainGain.gain.setTargetAtTime(Math.min(1, f.speed / 18) * 0.02 * atten * mute, t, tc);
    // Tires
    const paved = f.surface === 'asphalt' || f.surface === 'concrete';
    const loose = f.surface === 'dirt' || f.surface === 'gravel' || f.surface === 'sand';
    const roll = f.grounded ? Math.min(1, f.speed / 20) : 0;
    this.tireFilter.frequency.setTargetAtTime(paved ? 900 + f.speed * 40 : loose ? 450 + f.speed * 20 : 350, t, 0.1);
    this.tireGain.gain.setTargetAtTime(roll * (paved ? 0.05 : 0.11) * atten * mute, t, 0.08);
    const sq = f.grounded && paved ? Math.max(0, Math.min(1, f.slip)) : 0;
    this.squealGain.gain.setTargetAtTime(sq * 0.06 * atten * mute, t, 0.05);
    this.squealOsc.frequency.setTargetAtTime(850 + sq * 400 + Math.sin(t * 23) * 30, t, 0.05);
    // Wind ∝ v²
    const w = Math.min(1, (f.speed / 25) ** 2);
    this.windGain.gain.setTargetAtTime(w * 0.12 * mute, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(250 + f.speed * 30, t, 0.15);
    // Ambience
    this.cityGain.gain.setTargetAtTime(f.city * 0.05 * mute, t, 0.5);
    this.natureGain.gain.setTargetAtTime((1 - f.city) * 0.025 * mute, t, 0.5);
    this.birdTimer -= dt;
    if (this.birdTimer <= 0 && !f.paused) {
      this.birdTimer = 2 + Math.random() * 5;
      if (f.city < 0.5) this.chirp();
    }
  }

  private chirp() {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    const f0 = 2500 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 3);
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.13;
      o.frequency.setValueAtTime(f0, s);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.4, s + 0.07);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.linearRampToValueAtTime(0.02, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.1);
    }
    o.connect(g).connect(this.ambBus);
    o.start(t);
    o.stop(t + n * 0.13 + 0.2);
  }

  /** Thud / crunch one-shot. */
  impact(strength: number, kind: 'land' | 'crash' | 'bump' | 'scrape' = 'land', surface: SurfaceId = 'dirt') {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const s = Math.max(0.05, Math.min(1, strength));
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    const loose = surface !== 'asphalt' && surface !== 'concrete';
    f.frequency.value = kind === 'crash' ? 1800 : kind === 'scrape' ? 3500 : loose ? 500 : 900;
    const g = ctx.createGain();
    const dur = kind === 'crash' ? 0.7 : kind === 'scrape' ? 0.25 : 0.22;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime((kind === 'crash' ? 0.5 : 0.3) * s, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
    if (kind !== 'scrape') {
      // Low suspension thump
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.frequency.setValueAtTime(90, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
      og.gain.setValueAtTime(0.0001, t);
      og.gain.linearRampToValueAtTime(0.35 * s, t + 0.01);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(og).connect(this.sfxBus);
      o.start(t);
      o.stop(t + 0.3);
    }
  }

  /** Pleasant two-note chime (collectibles, medals). */
  chime(high = false) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const notes = high ? [784, 1175, 1568] : [659, 988];
    notes.forEach((fr, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = fr;
      const s = t + i * 0.09;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.linearRampToValueAtTime(0.12, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.5);
      o.connect(g).connect(this.sfxBus);
      o.start(s);
      o.stop(s + 0.55);
    });
  }

  click() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 1400;
    g.gain.setValueAtTime(0.04, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.06);
  }
}
