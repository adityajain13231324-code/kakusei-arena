// Synthesised sound effects + state-driven loops (ki charge hum, beam clash roar).
import type { Element, GameState, SimEvent, Strength } from '../sim/types';
import { Engine } from './engine';
import { XSfx } from './crossover';
import { SampleLayer } from './layer';

const LVL: Record<Strength, number> = { light: 0, medium: 1, heavy: 2, super: 3 };
const EV_IDX: Record<string, number> = {};
['hit', 'block', 'counter', 'whiff', 'parry', 'throw', 'throwBreak', 'launch', 'wallSplat', 'groundBounce', 'land', 'knockdown',
  'projectile', 'projectileHit', 'projectileDestroy', 'kiCharge', 'kiFull', 'vanish', 'awaken', 'ultimateStart', 'ultimateHit',
  'clashStart', 'clashEnd', 'sidestep', 'dash', 'jump', 'guardCrush', 'moveStart', 'roundStart', 'fight', 'ko', 'timeout', 'roundEnd', 'matchEnd',
  'realmStart', 'realmEnd', 'realmClash', 'infinityBlock', 'formChange', 'summon', 'summonDispel', 'burn']
  .forEach((k, i) => (EV_IDX[k] = i));

interface Loop { g: GainNode; srcs: Array<OscillatorNode | AudioBufferSourceNode>; a?: OscillatorNode; f?: BiquadFilterNode; b?: OscillatorNode; lfo?: GainNode }

const NOTE = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

export class Sfx {
  /** Sound v2 sample layer (impacts, whooshes, voices ...); the synth below always plays too */
  readonly layer: SampleLayer;
  private annHandled = false;
  private _announcer = true;
  get announcer(): boolean { return this._announcer; }
  set announcer(v: boolean) { this._announcer = v; this.layer.announcer = v; }
  private seen = new Int32Array(48).fill(-1);
  private seenN = 0;
  private kiLoop: Loop | null = null;
  private clashLoop: Loop | null = null;
  private lastHandle = 0;
  private lastMash = 0;
  private lastMashT = 0;
  private lastSpeak = '';
  private lastBurnT = 0;

  private x: XSfx;
  constructor(private e: Engine) { this.x = new XSfx(e); this.layer = new SampleLayer(e); }

  // ------------------------------------------------------------ small building blocks
  private wet(): AudioNode { return this.e.sfxWet; }

  hit(t: number, strength: Strength, el: Element | undefined, counter: boolean): void {
    const e = this.e;
    let l = LVL[strength];
    if (counter) l = Math.min(3, l + 1);
    const dur = [0.09, 0.14, 0.24, 0.42][l]!;
    const dest = l >= 3 ? this.wet() : undefined;
    e.tone(t, dur, { f0: [240, 170, 120, 85][l]!, f1: [90, 60, 40, 28][l]!, g: [0.5, 0.65, 0.8, 0.9][l]!, dest });
    e.noise(t, [0.06, 0.09, 0.16, 0.26][l]!, { ft: 'bandpass', f0: [3500, 2600, 1800, 1200][l]!, f1: 600, q: 0.7, g: 0.42, dest });
    e.click(t, 0.28);
    if (l >= 2) e.noise(t, 0.22, { type: 'brown', ft: 'lowpass', f0: 500, f1: 90, g: 0.7, dest });
    if (l >= 3) e.tone(t, 0.6, { f0: 55, f1: 28, g: 0.7, dest });
    if (counter) e.fm(t + 0.01, 0.55, 1900, 2.76, 3.5, 0.17, this.wet());
    this.elem(t, el, l);
  }

  elem(t: number, el: Element | undefined, l: number): void {
    const e = this.e;
    const k = 0.6 + l * 0.15;
    switch (el) {
      case 'fire':
        e.noise(t, 0.35, { ft: 'bandpass', f0: 400, f1: 1800, q: 0.8, g: 0.28 * k });
        for (let i = 0; i < 6; i++) e.noise(t + 0.03 + Math.random() * 0.3, 0.015, { ft: 'highpass', f0: 4000, g: 0.14 * k, a: 0.001 });
        break;
      case 'shadow':
        e.noise(t, 0.34, { ft: 'lowpass', f0: 200, f1: 3500, q: 1, g: 0.32 * k, a: 0.28 });
        e.tone(t, 0.34, { f0: 80, f1: 55, g: 0.25 * k, a: 0.2 });
        break;
      case 'blade':
        e.fm(t, 0.65, 2200, 3.5, 6, 0.15 * k, this.wet());
        e.noise(t, 0.25, { ft: 'highpass', f0: 4000, f1: 9000, g: 0.2 * k });
        break;
      case 'earth':
        e.noise(t, 0.65, { type: 'brown', ft: 'lowpass', f0: 160, f1: 50, g: 0.85 * k });
        e.tone(t, 0.4, { f0: 70, f1: 35, g: 0.5 * k });
        break;
      case 'ki':
        e.tone(t, 0.14, { type: 'sawtooth', f0: 1600, f1: 250, g: 0.18 * k, lp: 5000 });
        e.noise(t, 0.08, { f0: 5000, q: 2, g: 0.2 * k });
        e.tone(t, 0.1, { type: 'square', f0: 3000, f1: 600, g: 0.06 * k });
        break;
      default: this.x.elem(t, el ?? 'none', k);
    }
  }

  block(t: number, l: number): void {
    const e = this.e;
    e.noise(t, 0.05, { ft: 'bandpass', f0: 900, q: 4, g: 0.5 });
    e.tone(t, 0.06, { type: 'triangle', f0: 420, f1: 300, g: 0.4 });
    e.noise(t + 0.035, 0.04, { ft: 'bandpass', f0: 1300, q: 5, g: 0.3 });
    e.tone(t + 0.035, 0.05, { type: 'triangle', f0: 560, f1: 380, g: 0.25 });
    if (l >= 2) e.tone(t, 0.12, { f0: 120, f1: 60, g: 0.4 });
  }

  /** glassy shatter + low thump */
  guardCrush(t: number): void {
    const e = this.e;
    e.tone(t, 0.3, { f0: 110, f1: 40, g: 0.85 });
    e.noise(t, 0.2, { type: 'brown', ft: 'lowpass', f0: 600, f1: 90, g: 0.6 });
    e.fm(t, 0.5, 3200, 2.9, 5, 0.17, this.wet());
    e.fm(t + 0.02, 0.4, 4700, 1.7, 4, 0.11, this.wet());
    e.noise(t, 0.3, { ft: 'highpass', f0: 5000, f1: 9000, g: 0.28, a: 0.002 });
    for (let i = 0; i < 9; i++) {
      const d = 0.03 + Math.random() * 0.4;
      e.tone(t + d, 0.09, { type: 'triangle', f0: 2600 + Math.random() * 3800, f1: 1800 + Math.random() * 1500, g: 0.09 * (1 - d), a: 0.001 });
      e.noise(t + d, 0.02, { ft: 'highpass', f0: 6000, g: 0.1, a: 0.001 });
    }
  }

  /** ground hit on a lying opponent: heavy stomp thud with a dust swish */
  otg(t: number): void {
    const e = this.e;
    e.tone(t, 0.28, { f0: 85, f1: 32, g: 0.9 });
    e.noise(t, 0.2, { type: 'brown', ft: 'lowpass', f0: 380, f1: 70, g: 0.8 });
    e.noise(t, 0.05, { ft: 'bandpass', f0: 1500, q: 1.5, g: 0.35 });
    e.click(t, 0.25);
    e.noise(t + 0.03, 0.3, { ft: 'bandpass', f0: 1800, f1: 600, q: 0.8, g: 0.2, a: 0.06 });
  }

  whiff(t: number, l: number): void {
    this.e.noise(t, 0.12 + l * 0.05, { ft: 'bandpass', f0: 600, f1: 2400 + l * 400, q: 1.2, g: 0.2 + l * 0.04, a: 0.03 });
  }

  private ping(t: number, notes: number[], g = 0.2, step = 0.07): void {
    const e = this.e;
    notes.forEach((n, i) => e.tone(t + i * step, 0.5, { type: 'sine', f0: NOTE(n), g, dest: this.wet() }));
  }

  private chord(t: number, notes: number[], dur: number, g: number, lpFrom: number, lpTo: number): void {
    const e = this.e, c = e.ctx!;
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 1;
    f.frequency.setValueAtTime(lpFrom, t);
    f.frequency.exponentialRampToValueAtTime(lpTo, t + dur * 0.5);
    const gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(g, t + dur * 0.35);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(gn); gn.connect(this.wet());
    for (const n of notes) for (const d of [-7, 7]) {
      const o = c.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = NOTE(n); o.detune.value = d;
      o.connect(f); o.start(t); o.stop(t + dur + 0.05);
    }
  }

  private speak(text: string): void {
    if (!this.announcer || this.annHandled) return;
    try {
      const ss = window.speechSynthesis;
      if (!ss) return;
      ss.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95; u.pitch = 0.7; u.volume = Math.min(1, this.e.vols.sfx);
      ss.speak(u);
      this.lastSpeak = text;
    } catch { /* speech not available */ }
  }

  // ------------------------------------------------------------ event router
  private dedupe(ev: SimEvent): boolean {
    const key = (ev.frame * 64 + (EV_IDX[ev.type] ?? 63)) * 2 + ev.player;
    for (let i = 0; i < this.seen.length; i++) if (this.seen[i] === key) return true;
    this.seen[this.seenN] = key;
    this.seenN = (this.seenN + 1) % this.seen.length;
    return false;
  }

  handle(events: SimEvent[], state: GameState): void {
    const e = this.e;
    if (!e.ready) return;
    this.lastHandle = e.now;
    this.updateLoops(state);
    this.layer.update(state);
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]!;
      if (this.dedupe(ev)) continue;
      this.annHandled = this.layer.onEvent(ev, state);
      this.play(ev, state);
    }
  }

  private play(ev: SimEvent, state: GameState): void {
    const e = this.e;
    const t = e.now + 0.003;
    const st = ev.strength ?? 'medium';
    const l = LVL[st];
    const big = ev.type === 'ko' || ev.type === 'guardCrush' || ev.type === 'awaken' || ev.type === 'ultimateStart' || ev.type === 'ultimateHit' || ev.type === 'fight' || ev.type === 'roundStart' || ev.type === 'realmStart' || ev.type === 'realmClash' || ev.type === 'formChange';
    if (ev.type === 'moveStart') {
      if (!XSfx.has(ev.moveId ?? '') || !e.claim(0.5)) return;
      this.x.move(t, ev.moveId ?? '');
      return;
    }
    if (ev.type === 'burn') {
      // Sun Forge burn ticks every 5 frames: sizzle at most ~6 times a second, never steal a voice from a hit
      if (t - this.lastBurnT < 0.16 || !e.claim(0.2)) return;
      this.lastBurnT = t;
      this.x.burn(t);
      return;
    }
    if (!e.claim(ev.type === 'ko' ? 2 : 0.4, big || ev.type === 'counter')) return;
    switch (ev.type) {
      case 'hit':
        if (ev.tag === 'otg') this.otg(t);
        else if (ev.tag === 'armor') {
          this.hit(t, st === 'light' ? 'light' : 'medium', ev.element, false);
          this.x.armor(t, !!state.realm && state.realm.kind === 'mountain_temple' && state.realm.owner === ev.target);
        } else { this.hit(t, st, ev.element, false); if (ev.tag === 'realm') this.x.realmHit(t); }
        break;
      case 'guardCrush': this.guardCrush(t); break;
      case 'counter': this.hit(t, st, ev.element, true); break;
      case 'block': this.block(t, l); break;
      case 'parry': this.block(t, 1); e.fm(t, 0.5, 2400, 2.76, 3, 0.15, this.wet()); break;
      case 'whiff': this.whiff(t, l); break;
      case 'jump':
        e.noise(t, 0.12, { ft: 'bandpass', f0: 500, f1: 1800, q: 1, g: 0.14, a: 0.02 });
        e.tone(t, 0.08, { f0: 300, f1: 520, g: 0.12 });
        break;
      case 'land':
        e.tone(t, 0.1, { f0: 140, f1: 55, g: 0.6 });
        e.noise(t, 0.09, { ft: 'lowpass', f0: 1100, g: 0.35 });
        break;
      case 'dash':
        e.noise(t, 0.17, { ft: 'bandpass', f0: 1000, f1: 3200, q: 0.9, g: 0.22, a: 0.02 });
        e.tone(t, 0.1, { f0: 160, f1: 90, g: 0.12 });
        break;
      case 'sidestep':
        e.noise(t, 0.1, { ft: 'bandpass', f0: 1600, f1: 4200, q: 1.2, g: 0.26, a: 0.015 });
        break;
      case 'throw':
        e.tone(t, 0.22, { f0: 100, f1: 35, g: 0.85 });
        e.noise(t, 0.1, { ft: 'lowpass', f0: 1500, g: 0.5 });
        e.noise(t, 0.05, { ft: 'bandpass', f0: 2200, q: 2, g: 0.4 });
        break;
      case 'throwBreak': this.block(t, 1); e.fm(t, 0.4, 1500, 2.2, 2, 0.12); break;
      case 'launch':
        e.noise(t, 0.38, { ft: 'bandpass', f0: 300, f1: 3200, q: 0.9, g: 0.3, a: 0.05 });
        e.tone(t, 0.35, { f0: 200, f1: 900, g: 0.15 });
        break;
      case 'wallSplat':
        e.noise(t, 0.18, { ft: 'bandpass', f0: 1200, f1: 400, q: 1.5, g: 0.6 });
        for (let i = 0; i < 5; i++) e.noise(t + 0.02 + Math.random() * 0.18, 0.025, { ft: 'bandpass', f0: 800 + Math.random() * 2500, q: 3, g: 0.3, a: 0.001 });
        e.tone(t, 0.3, { f0: 90, f1: 35, g: 0.8 });
        e.noise(t, 0.4, { type: 'brown', ft: 'lowpass', f0: 300, f1: 70, g: 0.6 });
        break;
      case 'groundBounce':
      case 'knockdown':
        e.tone(t, 0.25, { f0: 95, f1: 38, g: 0.8 });
        e.noise(t, 0.15, { ft: 'lowpass', f0: 1000, f1: 200, g: 0.45 });
        break;
      case 'projectile': this.projectileLaunch(t, ev); break;
      case 'projectileHit': this.hit(t, 'medium', ev.element, false); break;
      case 'projectileDestroy':
        e.noise(t, 0.1, { ft: 'highpass', f0: 2500, g: 0.25 });
        e.tone(t, 0.1, { f0: 600, f1: 150, g: 0.2 });
        break;
      case 'kiCharge':
        e.tone(t, 0.3, { type: 'triangle', f0: 300, f1: 900, g: 0.15 });
        break;
      case 'kiFull':
        this.ping(t, [76, 83, 88, 95], 0.16, 0.06);
        e.noise(t, 0.3, { ft: 'highpass', f0: 3000, f1: 8000, g: 0.12 });
        break;
      case 'vanish':
        e.noise(t, 0.22, { ft: 'bandpass', f0: 4000, f1: 500, q: 1, g: 0.3, a: 0.01 });
        e.tone(t, 0.25, { f0: 1400, f1: 260, g: 0.18, type: 'triangle' });
        this.ping(t + 0.1, [88, 93], 0.07, 0.05);
        break;
      case 'awaken': this.awaken(t); break;
      case 'ultimateStart':
        e.noise(t, 0.7, { ft: 'bandpass', f0: 300, f1: 5000, q: 0.7, g: 0.4, a: 0.35, dest: this.wet() });
        this.chord(t, [60, 64, 67, 72], 1.4, 0.07, 400, 6000);
        e.tone(t, 0.8, { f0: 80, f1: 160, g: 0.35, type: 'sawtooth', lp: 500 });
        if (ev.moveId === 'gojo_ult' || ev.moveId === 'gojo_ult_aw') this.x.hollowSwell(t);
        e.duckMusic(0.3, 2.6, 0.8);
        break;
      case 'ultimateHit':
        this.hit(t, 'super', ev.element, false);
        e.fm(t, 0.8, 900, 1.41, 4, 0.1, this.wet());
        e.duckMusic(0.35, 1.0, 0.6);
        break;
      case 'clashStart':
        e.noise(t, 0.5, { ft: 'bandpass', f0: 800, f1: 6000, q: 1, g: 0.4, a: 0.2, dest: this.wet() });
        e.tone(t, 0.4, { type: 'sawtooth', f0: 90, f1: 400, g: 0.3, lp: 3000 });
        break;
      case 'clashEnd':
        e.tone(t, 0.9, { f0: 70, f1: 24, g: 0.95, dest: this.wet() });
        e.noise(t, 0.7, { ft: 'lowpass', f0: 5000, f1: 120, g: 0.7, dest: this.wet() });
        e.fm(t, 0.8, 1200, 1.7, 5, 0.1, this.wet());
        e.duckMusic(0.35, 1.2, 0.6);
        break;
      case 'ko':
        e.tone(t, 1.3, { f0: 75, f1: 22, g: 1.0, dest: this.wet() });
        e.noise(t, 1.0, { ft: 'lowpass', f0: 6000, f1: 90, g: 0.8, dest: this.wet() });
        e.noise(t, 2.4, { type: 'brown', ft: 'lowpass', f0: 400, f1: 60, g: 0.5, dest: this.wet() });
        e.fm(t + 0.02, 1.2, 800, 2.1, 4, 0.1, this.wet());
        e.duckMusic(0.2, 3.2, 1.2);
        this.speak('K.O.');
        break;
      case 'roundStart': {
        e.tone(t, 0.3, { f0: 120, f1: 55, g: 0.8 });
        e.noise(t, 0.2, { ft: 'lowpass', f0: 2000, g: 0.5 });
        e.tone(t + 0.12, 0.6, { type: 'sawtooth', f0: 220, f1: 440, g: 0.18, lp: 2500, a: 0.2 });
        const n = state.round.number;
        this.speak(n >= 3 ? 'Final round' : n === 2 ? 'Round two' : 'Round one');
        break;
      }
      case 'fight':
        e.tone(t, 0.5, { f0: 140, f1: 45, g: 1.0, dest: this.wet() });
        e.noise(t, 0.5, { ft: 'bandpass', f0: 1800, f1: 400, g: 0.6, dest: this.wet() });
        this.chord(t, [48, 55, 60], 0.9, 0.09, 3000, 800);
        this.speak('Fight');
        break;
      case 'timeout':
        e.tone(t, 0.7, { type: 'sawtooth', f0: 220, g: 0.3, lp: 1200, a: 0.02 });
        e.tone(t + 0.8, 0.7, { type: 'sawtooth', f0: 220, g: 0.3, lp: 1200, a: 0.02 });
        break;
      case 'matchEnd':
        e.tone(t, 1.5, { f0: 110, f1: 55, g: 0.5, dest: this.wet() });
        break;
      // ---- crossover pack
      case 'infinityBlock': this.x.infinity(t, ev.tag); break;
      case 'formChange': this.x.form(t, ev.tag ?? ''); break;
      case 'summon': this.x.summon(t); break;
      case 'summonDispel': this.x.summonDispel(t, ev.tag); break;
      case 'realmStart': this.x.realmStart(t, ev.tag ?? ''); break;
      case 'realmClash': this.x.realmClash(t); break;
      case 'realmEnd': this.x.realmEnd(t); break;
      default: break;
    }
  }

  private projectileLaunch(t: number, ev: SimEvent): void {
    const e = this.e;
    if (ev.tag === 'detonate') { this.x.detonate(t); return; }
    if (ev.tag && this.x.projectile(t, ev.tag)) return;
    const el = ev.element ?? 'none';
    const id = (ev.moveId ?? '').toLowerCase();
    if (el === 'fire' || id.includes('fire')) {
      e.noise(t, 0.4, { ft: 'bandpass', f0: 300, f1: 1500, q: 0.8, g: 0.35, a: 0.05 });
      e.tone(t, 0.3, { type: 'sawtooth', f0: 220, f1: 120, g: 0.14, lp: 1200 });
    } else if (el === 'shadow' || id.includes('kunai')) {
      e.noise(t, 0.12, { ft: 'bandpass', f0: 3000, f1: 6000, q: 1.5, g: 0.28 });
      e.tone(t, 0.08, { f0: 2600, f1: 1800, g: 0.07 });
    } else if (el === 'blade') {
      e.fm(t, 0.5, 2000, 3.2, 5, 0.14, this.wet());
      e.noise(t, 0.2, { ft: 'highpass', f0: 3000, f1: 8000, g: 0.2 });
    } else if (el === 'earth') {
      e.noise(t, 0.5, { type: 'brown', ft: 'lowpass', f0: 200, f1: 60, g: 0.8 });
      e.tone(t, 0.3, { f0: 80, f1: 40, g: 0.6 });
    } else {
      e.tone(t, 0.45, { type: 'sawtooth', f0: 100, f1: 900, g: 0.2, lp: 4000 });
      e.noise(t, 0.4, { ft: 'bandpass', f0: 500, f1: 4000, q: 1, g: 0.3 });
    }
  }

  private awaken(t: number): void {
    const e = this.e, c = e.ctx!;
    e.tone(t, 1.3, { type: 'sawtooth', f0: 100, f1: 800, g: 0.22, lp: 3000, a: 0.9, dest: this.wet() });
    e.noise(t, 1.2, { ft: 'bandpass', f0: 200, f1: 6000, q: 0.8, g: 0.35, a: 1.0, dest: this.wet() });
    const t2 = t + 1.1;
    e.tone(t2, 1.5, { f0: 60, f1: 30, g: 0.9, dest: this.wet() });
    this.chord(t2, [48, 55, 60, 63, 67], 2.0, 0.09, 6000, 500);
    // "gogogo" rumble: brown noise with 8 Hz tremolo
    const src = c.createBufferSource();
    src.buffer = e.noiseB; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 130;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t2);
    g.gain.linearRampToValueAtTime(0.8, t2 + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t2 + 2.2);
    const lfo = c.createOscillator(); lfo.frequency.value = 8;
    const lg = c.createGain(); lg.gain.value = 0.35;
    lfo.connect(lg); lg.connect(g.gain);
    src.connect(lp); lp.connect(g); g.connect(this.wet());
    src.start(t2); lfo.start(t2); src.stop(t2 + 2.3); lfo.stop(t2 + 2.3);
    e.duckMusic(0.3, 2.5, 0.8);
  }

  // ------------------------------------------------------------ loops
  private mkLoop(kind: 'ki' | 'clash'): Loop {
    const e = this.e, c = e.ctx!;
    const g = c.createGain();
    g.gain.value = 0.0001;
    g.connect(e.sfxBus);
    const srcs: Loop['srcs'] = [];
    const lp: Loop = { g, srcs };
    if (kind === 'ki') {
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 3;
      const a = c.createOscillator(); a.type = 'sawtooth'; a.frequency.value = 110;
      const b = c.createOscillator(); b.type = 'sine'; b.frequency.value = 220; b.detune.value = 8;
      const am = c.createGain(); am.gain.value = 0.6;
      const lfo = c.createOscillator(); lfo.frequency.value = 9;
      const lg = c.createGain(); lg.gain.value = 0.25;
      lfo.connect(lg); lg.connect(am.gain);
      a.connect(f); b.connect(f); f.connect(am); am.connect(g);
      a.start(); b.start(); lfo.start();
      srcs.push(a, b, lfo);
      lp.a = a; lp.b = b; lp.f = f;
    } else {
      const n = c.createBufferSource(); n.buffer = e.noiseW; n.loop = true;
      const hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 3000; hp.Q.value = 0.6;
      const am = c.createGain(); am.gain.value = 0.5;
      const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 55;
      const lg = c.createGain(); lg.gain.value = 0.5;
      lfo.connect(lg); lg.connect(am.gain);
      n.connect(hp); hp.connect(am); am.connect(g);
      const r = c.createBufferSource(); r.buffer = e.noiseB; r.loop = true;
      const rl = c.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 220;
      const rg = c.createGain(); rg.gain.value = 1.2;
      r.connect(rl); rl.connect(rg); rg.connect(g);
      const s = c.createOscillator(); s.type = 'sawtooth'; s.frequency.value = 55;
      const sf = c.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 400;
      const sg = c.createGain(); sg.gain.value = 0.35;
      s.connect(sf); sf.connect(sg); sg.connect(g);
      n.start(); lfo.start(); r.start(); s.start();
      srcs.push(n, lfo, r, s);
      lp.f = hp; lp.a = s; lp.b = lfo;
    }
    return lp;
  }

  private stopLoop(l: Loop | null): null {
    if (!l) return null;
    const t = this.e.now;
    l.g.gain.cancelScheduledValues(t);
    l.g.gain.setTargetAtTime(0, t, 0.05);
    for (const s of l.srcs) { try { s.stop(t + 0.4); } catch { /* already stopped */ } }
    return null;
  }

  private updateLoops(state: GameState): void {
    const e = this.e, t = e.now;
    // ki charge hum
    let charge = -1;
    for (const f of state.fighters) if (f.mode === 'kicharge') charge = Math.max(charge, f.modeFrame);
    if (charge >= 0) {
      if (!this.kiLoop) { this.kiLoop = this.mkLoop('ki'); }
      const k = Math.min(1, charge / 180);
      const l = this.kiLoop;
      l.a!.frequency.setTargetAtTime(110 * (1 + k * 1.6), t, 0.08);
      l.b!.frequency.setTargetAtTime(220 * (1 + k * 1.6), t, 0.08);
      l.f!.frequency.setTargetAtTime(500 + k * 2800, t, 0.1);
      l.g.gain.setTargetAtTime(0.16 + k * 0.14, t, 0.08);
    } else if (this.kiLoop) this.kiLoop = this.stopLoop(this.kiLoop);
    // clash roar
    const c = state.clash;
    if (c.active) {
      if (!this.clashLoop) this.clashLoop = this.mkLoop('clash');
      const l = this.clashLoop;
      const prog = Math.min(1, c.frame / Math.max(1, c.duration));
      l.g.gain.setTargetAtTime(0.22 + prog * 0.22, t, 0.06);
      l.f!.frequency.setTargetAtTime(2200 + Math.abs(c.balance) * 3 + prog * 1500, t, 0.1);
      l.a!.frequency.setTargetAtTime(55 + prog * 30, t, 0.1);
      l.b!.frequency.setTargetAtTime(50 + prog * 40, t, 0.1);
      const m = c.mash[0] + c.mash[1];
      if (m > this.lastMash && t - this.lastMashT > 0.04) {
        this.lastMashT = t;
        e.tone(t, 0.06, { type: 'square', f0: 700 + prog * 900 + (m % 5) * 90, g: 0.12 });
        e.click(t, 0.2);
      }
      this.lastMash = m;
    } else {
      this.lastMash = 0;
      if (this.clashLoop) this.clashLoop = this.stopLoop(this.clashLoop);
    }
  }

  /** stop loops if the game stopped polling (tab hidden / screen change) */
  watchdog(): void {
    if (this.e.now - this.lastHandle > 0.5) this.stopAll();
  }
  stopAll(): void {
    this.kiLoop = this.stopLoop(this.kiLoop);
    this.clashLoop = this.stopLoop(this.clashLoop);
    this.layer.stopAll();
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  }

  // ------------------------------------------------------------ UI
  private lastUi = 0;
  ui(s: 'move' | 'select' | 'back' | 'start' | 'error' | 'hover' | 'press'): void {
    const e = this.e;
    if (!e.ready) return;
    const t = e.now + 0.002;
    this.layer.ui(s);
    // tiny feedback sounds never pile up: at most one per 45 ms
    if ((s === 'hover' || s === 'press') && t - this.lastUi < 0.045) return;
    this.lastUi = t;
    switch (s) {
      case 'hover': e.tone(t, 0.03, { type: 'sine', f0: 2100, f1: 2500, g: 0.035, a: 0.001 }); break;
      case 'press': e.tone(t, 0.07, { type: 'triangle', f0: 190, f1: 95, g: 0.2, a: 0.001 }); e.click(t, 0.1); break;
      case 'move': e.tone(t, 0.04, { type: 'square', f0: 1400, g: 0.1 }); e.click(t, 0.1); break;
      case 'select':
        e.tone(t, 0.12, { type: 'square', f0: 880, g: 0.12 });
        e.tone(t + 0.06, 0.18, { type: 'square', f0: 1320, g: 0.12 });
        e.tone(t, 0.25, { type: 'sine', f0: 1760, g: 0.08 });
        break;
      case 'back': e.tone(t, 0.1, { type: 'triangle', f0: 300, f1: 180, g: 0.25 }); break;
      case 'start':
        [72, 76, 79, 84].forEach((n, i) => {
          e.tone(t + i * 0.07, 0.4, { type: 'triangle', f0: NOTE(n), g: 0.18, dest: this.wet() });
          e.tone(t + i * 0.07, 0.3, { type: 'sine', f0: NOTE(n + 12), g: 0.06 });
        });
        break;
      case 'error':
        e.tone(t, 0.22, { type: 'sawtooth', f0: 110, g: 0.25, lp: 700 });
        e.tone(t, 0.22, { type: 'square', f0: 117, g: 0.1, lp: 700 });
        break;
    }
  }
}
