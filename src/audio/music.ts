// Procedural music: lookahead scheduler (100 ms) + five seeded, deterministic tracks.
import { Engine } from './engine';
import type { MusicTrack } from './index';
import { choir } from './crossover';

const N = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
/** deterministic pseudo-random in [0,1) from an integer */
function rn(n: number, salt = 0): number {
  const x = Math.sin((n + salt * 131.7) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

interface RealmLayer { kind: string; def: TrackDef; tg: GainNode; next: number; step: number }
interface TrackDef {
  bpm: number; bars: number; loop: boolean; swing?: number; salt: number;
  play(m: Music, s: number, bar: number, t: number): void;
}

export class Music {
  private tg: GainNode | null = null;
  private cur: MusicTrack = 'none';
  private def: TrackDef | null = null;
  private nextT = 0;
  private step = 0;
  private timer: number | null = null;
  onEnd: (() => void) | null = null;
  private layers: RealmLayer[] = [];
  private rtimer: number | null = null;
  private realmIdle = 0;
  /** destination for instruments of the current track */
  d!: AudioNode;
  constructor(readonly e: Engine) {}

  get current(): MusicTrack { return this.cur; }

  set(track: MusicTrack): void {
    const e = this.e;
    if (!e.ctx || track === this.cur) return;
    const now = e.now;
    if (this.layers.length) this.realmOff();
    if (this.tg) {
      const old = this.tg;
      old.gain.cancelScheduledValues(now);
      old.gain.setTargetAtTime(0, now, 0.12);
      setTimeout(() => { try { old.disconnect(); } catch { /* ignore */ } }, 900);
      this.tg = null;
    }
    this.cur = track;
    this.def = TRACKS[track] ?? null;
    if (!this.def) { this.stopTimer(); return; }
    this.tg = e.ctx.createGain();
    this.tg.gain.setValueAtTime(0.0001, now);
    this.tg.gain.setTargetAtTime(1, now + 0.05, 0.15);
    this.tg.connect(e.musicBus);
    this.d = this.tg;
    this.step = 0;
    this.nextT = now + 0.08;
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), 30);
  }

  private stopTimer(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }

  tick(): void {
    const e = this.e, def = this.def;
    if (!e.ctx || !def || !this.tg) return;
    if (e.ctx.state !== 'running') { this.nextT = Math.max(this.nextT, e.now + 0.05); return; }
    const sd = 60 / def.bpm / 4;
    // if the tab stalled, don't dump a backlog of notes
    if (this.nextT < e.now - 0.25) this.nextT = e.now + 0.02;
    while (this.nextT < e.now + 0.1) {
      const total = def.bars * 16;
      if (this.step >= total) {
        if (def.loop) this.step = 0;
        else { this.finish(); return; }
      }
      const s = this.step % 16, bar = Math.floor(this.step / 16);
      const sw = def.swing && s % 2 === 1 ? def.swing * sd : 0;
      this.d = this.tg;
      def.play(this, s, bar, this.nextT + sw);
      this.nextT += sd;
      this.step++;
    }
  }

  private finish(): void {
    const tg = this.tg;
    this.cur = 'none'; this.def = null; this.tg = null;
    this.stopTimer();
    if (tg) {
      const now = this.e.now + 1.5;
      tg.gain.setTargetAtTime(0, now, 0.4);
      setTimeout(() => { try { tg.disconnect(); } catch { /* ignore */ } }, 4000);
    }
    this.onEnd?.();
  }


  // ------------------------------------------------------------ Soul Realm themes (layer over the stage music)
  /** duck the stage track and start the realm theme (two layers = Realm Clash) */
  realmOn(kind: string): void {
    const e = this.e;
    const def = REALM_TRACKS[kind];
    if (!e.ctx || !def || this.layers.some((l) => l.kind === kind)) return;
    const now = e.now;
    const tg = e.ctx.createGain();
    tg.gain.setValueAtTime(0.0001, now);
    tg.gain.setTargetAtTime(1, now + 0.03, 0.2);
    tg.connect(e.musicBus);
    this.layers.push({ kind, def, tg, next: now + 0.06, step: 0 });
    this.duckStage(true);
    if (this.rtimer === null) this.rtimer = window.setInterval(() => this.tickRealm(), 30);
  }
  /** stop one realm theme (or all) and restore the stage track once none is left */
  realmOff(kind?: string): void {
    const e = this.e;
    const now = e.ctx ? e.now : 0;
    const keep: RealmLayer[] = [];
    for (const l of this.layers) {
      if (kind && l.kind !== kind) { keep.push(l); continue; }
      l.tg.gain.cancelScheduledValues(now);
      l.tg.gain.setTargetAtTime(0, now, 0.25);
      const g = l.tg;
      setTimeout(() => { try { g.disconnect(); } catch { /* ignore */ } }, 1500);
    }
    this.layers = keep;
    if (!keep.length) {
      if (this.rtimer !== null) { clearInterval(this.rtimer); this.rtimer = null; }
      this.duckStage(false);
    }
  }
  get realmActive(): boolean { return this.layers.length > 0; }
  /** fail-safe: stop realm themes if neither a realm nor a clash is running for a moment */
  realmWatch(live: boolean, dt: number): void {
    if (!this.layers.length) { this.realmIdle = 0; return; }
    this.realmIdle = live ? 0 : this.realmIdle + dt;
    if (this.realmIdle > 0.7) { this.realmIdle = 0; this.realmOff(); }
  }
  private duckStage(on: boolean): void {
    if (!this.tg || !this.e.ctx) return;
    this.tg.gain.cancelScheduledValues(this.e.now);
    this.tg.gain.setTargetAtTime(on ? 0.16 : 1, this.e.now, on ? 0.12 : 0.6);
  }
  private tickRealm(): void {
    const e = this.e;
    if (!e.ctx || e.ctx.state !== 'running') return;
    for (const l of this.layers) {
      const sd = 60 / l.def.bpm / 4;
      if (l.next < e.now - 0.25) l.next = e.now + 0.02;
      while (l.next < e.now + 0.1) {
        const total = l.def.bars * 16;
        if (l.step >= total) l.step = 0;
        this.d = l.tg;
        l.def.play(this, l.step % 16, Math.floor(l.step / 16), l.next);
        l.next += sd;
        l.step++;
      }
    }
  }
  choir(t: number, notes: number[], dur: number, g = 0.05, vowel: 'ah' | 'oh' | 'oo' = 'ah'): void {
    choir(this.e, t, notes, dur, g, this.d, { vowel, wet: 0.5 });
  }

  // ------------------------------------------------------------ instruments
  kick(t: number, v = 1, deep = 1): void {
    const e = this.e;
    e.tone(t, 0.22 * deep, { f0: 150, f1: 42, g: 0.95 * v, a: 0.001, dest: this.d });
    e.click(t, 0.25 * v, this.d);
  }
  snare(t: number, v = 1, lo = false): void {
    const e = this.e;
    e.noise(t, lo ? 0.14 : 0.17, { ft: 'bandpass', f0: lo ? 1500 : 2200, q: 0.7, g: 0.5 * v, a: 0.001, dest: this.d });
    e.tone(t, 0.1, { type: 'triangle', f0: 200, f1: 130, g: 0.4 * v, dest: this.d });
  }
  clap(t: number, v = 1): void {
    for (let i = 0; i < 3; i++) this.e.noise(t + i * 0.011, 0.07, { ft: 'bandpass', f0: 1500, q: 1.2, g: 0.28 * v, a: 0.001, dest: this.d });
  }
  hat(t: number, v = 1, open = false): void {
    this.e.noise(t, open ? 0.14 : 0.035, { ft: 'highpass', f0: 7000, q: 0.5, g: 0.2 * v, a: 0.001, dest: this.d });
  }
  bass(t: number, f: number, dur: number, g = 0.4, lp = 700, type: OscillatorType = 'sawtooth'): void {
    this.e.tone(t, dur, { type, f0: f, g, lp, a: 0.006, dest: this.d });
  }
  reese(t: number, f: number, dur: number, g = 0.3): void {
    this.e.tone(t, dur, { type: 'sawtooth', f0: f, g, lp: 520, detune: -14, a: 0.01, dest: this.d });
    this.e.tone(t, dur, { type: 'sawtooth', f0: f, g, lp: 520, detune: 14, a: 0.01, dest: this.d });
  }
  arp(t: number, f: number, g = 0.07, type: OscillatorType = 'sawtooth', lp = 2800, dur = 0.12): void {
    this.e.tone(t, dur, { type, f0: f, g, lp, a: 0.002, dest: this.d });
  }
  pad(t: number, notes: number[], dur: number, g = 0.05, lp = 900): void {
    const c = this.e.ctx!;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
    const gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(g, t + dur * 0.25);
    gn.gain.linearRampToValueAtTime(g * 0.7, t + dur * 0.8);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(gn); gn.connect(this.d);
    for (const n of notes) for (const dt of [-8, 8]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = N(n); o.detune.value = dt;
      o.connect(f); o.start(t); o.stop(t + dur + 0.05);
    }
  }
  rhodes(t: number, f: number, dur = 0.9, g = 0.12): void {
    const e = this.e;
    e.tone(t, dur, { f0: f, g, a: 0.004, dest: this.d, lp: 2400 });
    e.tone(t, dur * 0.4, { f0: f * 2, g: g * 0.35, a: 0.002, dest: this.d });
    e.tone(t, dur, { f0: f, g: g * 0.5, detune: 6, a: 0.004, dest: this.d, lp: 1800 });
  }
  koto(t: number, f: number, g = 0.2): void {
    const e = this.e;
    e.tone(t, 1.0, { type: 'triangle', f0: f * 1.012, f1: f, g, a: 0.001, lp: 3500, dest: this.d });
    e.tone(t, 0.5, { type: 'sawtooth', f0: f, g: g * 0.25, a: 0.001, lp: 2200, dest: this.d });
    e.noise(t, 0.02, { ft: 'bandpass', f0: 3200, q: 2, g: g * 0.8, a: 0.0005, dest: this.d });
  }
  taiko(t: number, v = 1, hi = false): void {
    const e = this.e;
    e.tone(t, hi ? 0.35 : 0.6, { f0: hi ? 160 : 110, f1: hi ? 90 : 48, g: 0.9 * v, a: 0.002, dest: this.d });
    e.noise(t, 0.12, { ft: 'lowpass', f0: 900, g: 0.5 * v, a: 0.001, dest: this.d });
  }
  /** breathy shakuhachi-like lead with vibrato */
  shaku(t: number, f: number, dur: number, g = 0.16): void {
    const c = this.e.ctx!, e = this.e;
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
    const lfo = c.createOscillator(); lfo.frequency.value = 5.2;
    const lg = c.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.012, t + 0.4);
    lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
    const gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(g, t + 0.12);
    gn.gain.setValueAtTime(g, t + dur * 0.7);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const g2 = c.createGain(); g2.gain.value = 0.15;
    o.connect(gn); o2.connect(g2); g2.connect(gn); gn.connect(this.d);
    o.start(t); o2.start(t); lfo.start(t);
    o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    e.noise(t, dur, { ft: 'bandpass', f0: f * 2, q: 6, g: g * 0.5, a: 0.1, dest: this.d });
  }
  brass(t: number, f: number, dur: number, g = 0.12): void {
    const e = this.e;
    e.tone(t, dur, { type: 'sawtooth', f0: f, g, a: 0.02, lp: 2600, dest: this.d, detune: -6 });
    e.tone(t, dur, { type: 'sawtooth', f0: f, g, a: 0.02, lp: 2600, dest: this.d, detune: 6 });
  }
  crash(t: number): void {
    this.e.noise(t, 1.2, { ft: 'highpass', f0: 5000, g: 0.25, dest: this.d });
  }
}

// ====================================================================== tracks
const ch = (root: number, ...iv: number[]): number[] => iv.map((i) => root + i);

// ---- menu: hype synthwave, A minor, 110 bpm, 16 bars
const MENU_CH = [ch(57, 0, 3, 7), ch(53, 0, 4, 7), ch(60, 0, 4, 7), ch(55, 0, 4, 7), ch(57, 0, 3, 7), ch(53, 0, 4, 7), ch(55, 0, 4, 7), ch(52, 0, 4, 7)];
const MENU_ROOT = [33, 29, 36, 31, 33, 29, 31, 28];
const A_PENT = [69, 72, 74, 76, 79, 81];
const menu: TrackDef = {
  bpm: 110, bars: 16, loop: true, salt: 1,
  play(m, s, bar, t) {
    const b8 = bar % 8, sec = bar >= 8 ? 1 : 0;
    const chord = MENU_CH[b8]!, root = MENU_ROOT[b8]!;
    if (s === 0) { m.pad(t, chord, 60 / 110 * 4, 0.05, 1100); if (bar === 0 || bar === 8) m.crash(t); }
    if (bar >= 1 || s >= 8) { if (s % 4 === 0) m.kick(t, 0.9); }
    if (bar >= 1) {
      if (s === 4 || s === 12) { m.snare(t, 0.8); m.clap(t, 0.6); }
      if (s % 2 === 0) m.hat(t, s % 4 === 2 ? 1 : 0.5, s % 4 === 2 && s % 8 === 6);
      if (s % 2 === 0) m.bass(t, N(root + (s % 8 === 6 ? 12 : 0)), 0.2, 0.34, 600);
    }
    // 16th arpeggio
    if (bar >= 2) { const k = [0, 1, 2, 1][s % 4]!; m.arp(t, N(chord[k]! + 12 + (s >= 8 ? 12 : 0)), 0.04, 'sawtooth', 2400, 0.1); }
    // lead in second half
    if (sec === 1 && s % 2 === 0 && rn(bar * 16 + s, 1) < 0.5) {
      const note = A_PENT[Math.floor(rn(bar * 16 + s, 2) * A_PENT.length)]!;
      m.arp(t, N(note), 0.1, 'square', 3200, 0.22);
    }
  },
};

// ---- rooftop: driving D&B / electro, D minor, 170 bpm, 16 bars
const RT_ROOT = [38, 34, 41, 36];
const RT_CH = [ch(62, 0, 3, 7), ch(58, 0, 4, 7), ch(65, 0, 4, 7), ch(60, 0, 4, 7)];
const rooftop: TrackDef = {
  bpm: 170, bars: 16, loop: true, salt: 2,
  play(m, s, bar, t) {
    const ci = Math.floor(bar / 2) % 4;
    const root = RT_ROOT[ci]!, chord = RT_CH[ci]!;
    const sec = Math.floor(bar / 4);
    const fill = bar % 4 === 3 && s >= 12;
    if (s === 0 && bar % 2 === 0) { m.pad(t, chord, 60 / 170 * 8, 0.04, 1400); }
    if (bar === 0 || bar === 4 || bar === 8 || bar === 12) { if (s === 0) m.crash(t); }
    // drums
    if (sec >= 1 || bar >= 2) {
      if (s === 0 || s === 10 || (bar % 2 === 1 && s === 7)) m.kick(t, 0.95, 0.7);
      if ((s === 4 || s === 12) && !fill) m.snare(t, 1);
      if (fill) m.snare(t, 0.4 + (s - 12) * 0.2);
      if (s === 14 && !fill && rn(bar, 5) < 0.4) m.snare(t, 0.3);
    }
    if (s % 2 === 0) m.hat(t, 0.5 + (s % 4 === 2 ? 0.3 : 0), s === 14);
    else if (sec === 3 || rn(bar * 16 + s, 3) < 0.25) m.hat(t, 0.25);
    // reese bass
    if (sec >= 1) {
      const pat = [0, 3, 6, 10, 12];
      if (pat.includes(s) && !fill) m.reese(t, N(root + (rn(bar * 16 + s, 7) < 0.25 ? 12 : 0)), 0.2, 0.2);
    }
    // arp
    if (sec !== 0 || bar >= 2) { const k = [0, 1, 2, 1, 2, 1][s % 6]!; if (s % 2 === 0 || sec >= 2) m.arp(t, N(chord[k]! + 24), 0.035, 'square', 3500, 0.09); }
    // lead
    if (sec === 2 && s % 4 === 0 && rn(bar * 16 + s, 9) < 0.7) {
      const sc = [74, 77, 79, 81, 84];
      m.arp(t, N(sc[Math.floor(rn(bar * 16 + s, 11) * sc.length)]!), 0.08, 'sawtooth', 3000, 0.3);
    }
  },
};

// ---- shrine: koto plucks + taiko + shakuhachi, D "In" pentatonic, 120 bpm, 16 bars
const IN = [62, 63, 67, 69, 70, 74, 75, 79];
const shrine: TrackDef = {
  bpm: 120, bars: 16, loop: true, salt: 3,
  play(m, s, bar, t) {
    const sec = Math.floor(bar / 4);
    const phrase = bar % 4;
    if (s === 0 && bar % 4 === 0) m.pad(t, [38, 45, 50], 60 / 120 * 16, 0.05, 700);
    // koto: 8th-note motif; phrase seeded so bars repeat predictably
    if (s % 2 === 0) {
      const idx = Math.floor(s / 2);
      const seed = (phrase % 2) * 8 + idx;
      if (rn(seed, 21) < 0.78) {
        let k = Math.floor(rn(seed, 22) * 6);
        if (phrase === 3 && idx >= 4) k = Math.min(7, k + 1);
        m.koto(t, N(IN[k]!), 0.16 + (s === 0 ? 0.06 : 0));
        if (sec >= 2 && idx % 2 === 0) m.koto(t, N(IN[k]! - 12), 0.07);
      }
    }
    // taiko
    if (sec >= 1) {
      if (s === 0 && phrase % 2 === 0) m.taiko(t, 1);
      if (s === 8) m.taiko(t, 0.5, true);
      if (phrase === 3 && s >= 12) m.taiko(t, 0.5 + (s - 12) * 0.12, s % 2 === 1);
      if (sec >= 3 && (s === 6 || s === 14)) m.taiko(t, 0.45, true);
    }
    // shakuhachi
    if (sec >= 2 && ((s === 0 && phrase % 2 === 0) || (s === 8 && phrase % 2 === 1))) {
      const k = Math.floor(rn(bar * 3 + (s >> 3), 31) * 6);
      m.shaku(t, N(IN[k]! + 12), 60 / 120 * (s === 0 ? 3.6 : 1.8), 0.15);
    }
    if (s % 8 === 4 && sec >= 1) m.hat(t, 0.25);
  },
};

// ---- training: chill lo-fi, C major 7ths, 80 bpm, 8 bars
const LF_CH = [ch(60, 0, 4, 7, 11), ch(57, 0, 3, 7, 10), ch(62, 0, 3, 7, 10), ch(55, 0, 4, 7, 10)];
const LF_ROOT = [36, 33, 38, 31];
const training: TrackDef = {
  bpm: 80, bars: 8, loop: true, swing: 0.2, salt: 4,
  play(m, s, bar, t) {
    const ci = Math.floor(bar / 2) % 4;
    const chord = LF_CH[ci]!;
    if (s === 0 || s === 6 || s === 10) {
      chord.forEach((n, i) => m.rhodes(t + i * 0.012, N(n), 1.0, s === 0 ? 0.1 : 0.07));
    }
    if (s === 0 || s === 7 || (s === 10 && bar % 2 === 1)) m.kick(t, 0.8, 1.2);
    if (s === 4 || s === 12) m.snare(t, 0.55, true);
    if (s % 2 === 0) m.hat(t, 0.25 + rn(bar * 16 + s, 41) * 0.2);
    if (s === 0 || s === 8) m.bass(t, N(LF_ROOT[ci]!), 0.5, 0.35, 400, 'sine');
    if (s === 14 && rn(bar, 43) < 0.5) m.bass(t, N(LF_ROOT[ci]! + 7), 0.3, 0.3, 400, 'sine');
    // vinyl crackle
    if (rn(bar * 16 + s, 45) < 0.5) m.e.click(t + rn(s, 46) * 0.1, 0.05, m.d);
    // gentle melody on bars 4-7
    if (bar >= 4 && (s === 2 || s === 8 || s === 13) && rn(bar * 16 + s, 47) < 0.7) {
      const sc = [72, 74, 76, 79, 81];
      m.e.tone(t, 0.5, { type: 'triangle', f0: N(sc[Math.floor(rn(bar * 16 + s, 48) * sc.length)]!), g: 0.08, lp: 2200, dest: m.d });
    }
  },
};

// ---- victory jingle: C major fanfare, 132 bpm, 4 bars, no loop
const VIC: Array<[number, number, number]> = [
  [0, 72, 2], [3, 72, 2], [6, 72, 2], [8, 76, 6], [16, 79, 2], [19, 77, 2], [22, 76, 2], [24, 79, 8],
  [32, 81, 2], [35, 79, 2], [38, 81, 2], [40, 84, 6], [48, 79, 4], [52, 84, 4], [56, 88, 16],
];
const victory: TrackDef = {
  bpm: 132, bars: 5, loop: false, salt: 5,
  play(m, s, bar, t) {
    const step = bar * 16 + s;
    const sd = 60 / 132 / 4;
    for (const [st, note, len] of VIC) {
      if (st === step) {
        m.brass(t, N(note), len * sd * 1.1, 0.1);
        m.brass(t, N(note - 12), len * sd * 1.1, 0.06);
        if (st === 56) { m.pad(t, [60, 64, 67, 72], 5 * sd * 4, 0.07, 3000); m.crash(t); }
      }
    }
    if (s % 4 === 0 && bar < 4) m.taiko(t, 0.8 - (s === 0 ? 0 : 0.2));
    if (bar < 3 && s % 2 === 0) m.hat(t, 0.35);
    if (bar === 3 && s >= 8) m.snare(t, 0.3 + (s - 8) * 0.06);
    if (step === 56) m.kick(t, 1, 1.5);
  },
};

// ====================================================================== Soul Realm themes (loop under the stage music)
// infinite_void: eerie ambient pad, no drums. 54 bpm, 8 bars.
const IV_PINGS = [86, 87, 91, 93, 98, 79];
const infiniteVoid: TrackDef = {
  bpm: 54, bars: 8, loop: true, salt: 11,
  play(m, s, bar, t) {
    const bd = 60 / 54 * 4;
    if (s === 0 && bar % 2 === 0) {
      m.pad(t, [38, 45, 51], bd * 2.1, 0.05, 650);
      m.pad(t, [62, 69, 75].map((n) => n + (bar % 4 === 2 ? 1 : 0)), bd * 2.1, 0.022, 1500);
    }
    if (s === 0 && bar % 2 === 1) m.e.tone(t, 1.4, { f0: 44, f1: 38, g: 0.28, a: 0.02, dest: m.d });
    if (s % 4 === 2 && rn(bar * 16 + s, 11) < 0.2) m.e.tone(t, 1.8, { f0: N(IV_PINGS[Math.floor(rn(bar * 16 + s, 12) * IV_PINGS.length)]!), g: 0.05, a: 0.004, dest: m.d });
    if (s === 8 && bar % 4 === 3) m.e.noise(t, 3.2, { ft: 'bandpass', f0: 3500, f1: 1200, q: 6, g: 0.05, a: 1.6, dest: m.d });
  },
};

// tailed_beast_bomb: ominous drums + low drone, 72 bpm, 8 bars.
const TBB_BASS = [31, 31, 34, 29];
const tailedBeastBomb: TrackDef = {
  bpm: 72, bars: 8, loop: true, salt: 12,
  play(m, s, bar, t) {
    const bd = 60 / 72 * 4;
    if (s === 0 && bar % 2 === 0) m.reese(t, N(TBB_BASS[(bar >> 1) % 4]!), bd * 2, 0.22);
    if (s === 0) m.taiko(t, 1);
    if (s === 6) m.taiko(t, 0.55, true);
    if (s === 8) m.taiko(t, 0.85);
    if (s === 11) m.taiko(t, 0.5, true);
    if (s === 14 && bar % 2 === 1) m.taiko(t, 0.7, true);
    if (bar >= 4 && s % 2 === 0 && bar % 4 === 3 && s >= 8) m.taiko(t, 0.35 + (s - 8) * 0.04, true);
    if (s === 0 && bar % 4 === 0) { m.brass(t, N(38), bd * 0.8, 0.09); m.brass(t, N(45), bd * 0.8, 0.06); }
    if (s === 0 && bar % 4 === 2) m.e.noise(t, bd * 1.4, { type: 'brown', ft: 'lowpass', f0: 160, f1: 800, g: 0.45, a: bd * 0.8, dest: m.d });
  },
};

// king_of_hell: taiko + low strings (D phrygian), 96 bpm, 8 bars.
const KOH_LINE = [0, 0, 3, 0, 5, 3, 0, -2];
const kingOfHell: TrackDef = {
  bpm: 96, bars: 8, loop: true, salt: 13,
  play(m, s, bar, t) {
    const bd = 60 / 96 * 4;
    const root = bar % 4 === 3 ? 36 : 38;
    if (s === 0) m.pad(t, [root, root + 7, root + 15], bd * 1.02, 0.055, 900); // low strings
    if (s === 0 || s === 8) m.taiko(t, 1);
    if (s === 4 || s === 10) m.taiko(t, 0.5);
    if (s === 12 || s === 14) m.taiko(t, 0.65, true);
    if (bar >= 2 && s % 2 === 0) m.bass(t, N(root + KOH_LINE[(s >> 1) % 8]!), 0.15, 0.18, 800, 'sawtooth'); // spiccato
    if (bar >= 4 && s === 0) m.shaku(t, N(root + 36 + (bar % 8 === 4 ? 0 : 1)), bd * 0.9, 0.1);
    if (bar % 4 === 2 && s === 6) m.koto(t, N(root + 24 + 3), 0.16);
    if (s === 0 && bar % 4 === 0) m.crash(t);
  },
};

// gear_fifth: playful heartbeat "dum-dum" drums + bouncy plucks, 112 bpm, 8 bars.
const G5_PENT = [72, 74, 76, 79, 81, 84];
const gearFifth: TrackDef = {
  bpm: 112, bars: 8, loop: true, salt: 14,
  play(m, s, bar, t) {
    if (s === 0 || s === 8) m.kick(t, 1, 1.1);
    if (s === 2 || s === 10) m.kick(t, 0.7, 0.9);
    if (s === 4 || s === 12) m.clap(t, 0.5);
    if (s % 4 === 2 && bar >= 1) m.hat(t, 0.5);
    if (s === 6 || s === 14) m.bass(t, N(36 + (bar % 2) * 5), 0.14, 0.3, 500, 'sine');
    if (bar >= 1 && s % 2 === 0 && rn(bar * 16 + s, 14) < 0.6) {
      const n = G5_PENT[Math.floor(rn(bar * 16 + s, 15) * G5_PENT.length)]!;
      m.arp(t, N(n), 0.07, 'triangle', 3000, 0.11);
      if (s % 8 === 0) m.arp(t, N(n - 12), 0.05, 'sine', 2000, 0.2);
    }
    if (s === 0 && bar % 4 === 0) m.pad(t, [60, 64, 67, 72], 60 / 112 * 16, 0.035, 1800);
  },
};

// paths: ethereal choir, 60 bpm, 8 bars.
const PATHS_CH = [[57, 62, 66, 69], [55, 62, 67, 71], [54, 61, 66, 69], [52, 59, 64, 68]];
const paths: TrackDef = {
  bpm: 60, bars: 8, loop: true, salt: 15,
  play(m, s, bar, t) {
    if (s === 0 && bar % 2 === 0) {
      m.choir(t, PATHS_CH[(bar >> 1) % 4]!, 8.1, 0.06, bar % 4 === 2 ? 'oo' : 'ah');
      m.e.tone(t, 8, { f0: N(38), g: 0.16, a: 2, dest: m.d });
    }
    if (s % 8 === 4 && rn(bar * 16 + s, 16) < 0.6) m.rhodes(t, N(PATHS_CH[(bar >> 1) % 4]![Math.floor(rn(bar + s, 17) * 4)]! + 24), 1.6, 0.06);
    if (s === 0 && bar % 4 === 3) m.taiko(t, 0.5);
  },
};

// sun_forge: anvil strikes on the off-beats, driving taiko, low brass stabs (E phrygian), 104 bpm, 8 bars.
const SF_ROOT = [40, 40, 41, 38];
const sunForge: TrackDef = {
  bpm: 104, bars: 8, loop: true, salt: 21,
  play(m, s, bar, t) {
    const bd = 60 / 104 * 4;
    const root = SF_ROOT[(bar >> 1) % 4]!;
    if (s === 0 || s === 8) m.taiko(t, 1);
    if (s === 6 || s === 14) m.taiko(t, 0.55, true);
    if (s === 4 || s === 12) m.e.fm(t, 0.5, 1400 + (bar % 2) * 180, 2.76, 4, 0.07, m.d); // anvil
    if (s === 10 && bar % 2 === 1) m.e.fm(t, 0.35, 1900, 2.76, 3, 0.05, m.d);
    if (s % 2 === 0 && bar >= 2) m.bass(t, N(root - 12), 0.12, 0.22, 600, 'sawtooth');
    if (s === 0 && bar % 2 === 0) { m.brass(t, N(root), bd * 0.45, 0.08); m.brass(t, N(root + 7), bd * 0.45, 0.06); }
    if (s === 0 && bar % 4 === 0) { m.e.noise(t, bd * 1.6, { type: 'brown', ft: 'lowpass', f0: 220, f1: 700, g: 0.3, a: bd * 0.6, dest: m.d }); m.crash(t); }
    if (bar >= 4 && s === 8 && bar % 2 === 0) m.shaku(t, N(root + 25), bd * 0.45, 0.07);
  },
};

// moonless_void: near silence. Low drone, a breathy flute phrase now and then, plucks like dripping ink. 50 bpm.
const MV_NOTES = [74, 75, 79, 81, 86];
const moonlessVoid: TrackDef = {
  bpm: 50, bars: 8, loop: true, salt: 22,
  play(m, s, bar, t) {
    const bd = 60 / 50 * 4;
    if (s === 0 && bar % 2 === 0) { m.pad(t, [33, 40, 46], bd * 2.05, 0.045, 420); m.e.tone(t, bd * 2, { f0: N(33), g: 0.12, a: bd * 0.5, dest: m.d }); }
    if (s % 4 === 2 && rn(bar * 16 + s, 22) < 0.22) m.koto(t, N(MV_NOTES[Math.floor(rn(bar * 16 + s, 23) * MV_NOTES.length)]!), 0.07);
    if (s === 4 && bar % 4 === 1) m.shaku(t, N(69), bd * 0.6, 0.06);
    if (s === 4 && bar % 4 === 3) m.shaku(t, N(70), bd * 0.5, 0.05);
    if (s === 12 && bar % 2 === 1) m.e.noise(t, 2.2, { ft: 'bandpass', f0: 900, f1: 2400, q: 8, g: 0.04, a: 1.0, dest: m.d });
  },
};

// petal_storm: koto arpeggios in a miyako-bushi scale, soft taiko, flute melody on top. 88 bpm, 8 bars.
const PS_SCALE = [64, 65, 69, 71, 72, 76, 77, 81];
const PS_MEL = [76, 77, 76, 72, 71, 72, 69, 71];
const petalStorm: TrackDef = {
  bpm: 88, bars: 8, loop: true, salt: 23,
  play(m, s, bar, t) {
    const bd = 60 / 88 * 4;
    if (s % 2 === 0) m.koto(t, N(PS_SCALE[(s / 2 + bar * 3) % PS_SCALE.length]! - (bar % 4 === 3 ? 2 : 0)), 0.09);
    if (s === 0) m.taiko(t, 0.7);
    if (s === 10) m.taiko(t, 0.4, true);
    if (s === 12 && bar % 2 === 1) m.taiko(t, 0.5, true);
    if (s === 0 && bar % 2 === 0) m.pad(t, [52, 59, 64], bd * 2, 0.03, 1100);
    if (bar >= 2 && (s === 0 || s === 8)) m.shaku(t, N(PS_MEL[(bar * 2 + (s >> 3)) % 8]!), bd * 0.48, 0.08);
    if (s === 14 && rn(bar, 24) < 0.5) m.e.noise(t, 0.4, { ft: 'bandpass', f0: 4000, f1: 7000, q: 1, g: 0.05, a: 0.1, dest: m.d }); // petal gust
  },
};

// mountain_temple: deep temple bells, low monk choir, slow heavy taiko. 60 bpm, 8 bars.
const MT_CH = [[38, 45, 50], [36, 43, 50], [41, 48, 53], [38, 45, 50]];
const mountainTemple: TrackDef = {
  bpm: 60, bars: 8, loop: true, salt: 24,
  play(m, s, bar, t) {
    const bd = 60 / 60 * 4;
    if (s === 0 && bar % 2 === 0) m.choir(t, MT_CH[(bar >> 1) % 4]!, bd * 2.05, 0.05, 'oh');
    if (s === 0) { m.e.fm(t, 4.5, N(50), 1.41, 3, 0.07, m.d); m.e.tone(t, 4, { f0: N(26), g: 0.2, a: 0.01, dest: m.d }); } // temple bell
    if (s === 8 && bar % 2 === 1) m.e.fm(t, 3, N(57), 1.41, 2, 0.04, m.d);
    if (s === 0 || (s === 12 && bar % 2 === 1)) m.taiko(t, 0.9);
    if (s === 6 && bar % 4 === 2) m.taiko(t, 0.45, true);
    if (bar >= 4 && s === 4 && bar % 2 === 0) m.shaku(t, N(62 + (bar % 4 === 0 ? 0 : 3)), bd * 0.55, 0.06);
  },
};

const REALM_TRACKS: Record<string, TrackDef> = {
  infinite_void: infiniteVoid, tailed_beast_bomb: tailedBeastBomb, king_of_hell: kingOfHell, gear_fifth: gearFifth, paths,
  sun_forge: sunForge, moonless_void: moonlessVoid, petal_storm: petalStorm, mountain_temple: mountainTemple,
};

const TRACKS: Partial<Record<MusicTrack, TrackDef>> = { menu, rooftop, shrine, training, victory };
