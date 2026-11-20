// Crossover Pack sounds (all WebAudio synth, no files): Gojo / Naruto / Zoro / Luffy / Eren moves, forms, realms.
// Used by Sfx.play() for the new sim events (see docs/CROSSOVER.md section 3). Every function schedules nodes at
// time `t`; voice capping happens in Sfx (one claim per event).
import { Engine } from './engine';

const NOTE = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

export type RealmKind = 'infinite_void' | 'tailed_beast_bomb' | 'king_of_hell' | 'gear_fifth' | 'paths'
  | 'sun_forge' | 'moonless_void' | 'petal_storm' | 'mountain_temple';
export const CHAR_REALM: Record<string, RealmKind> = {
  gojo: 'infinite_void', naruto: 'tailed_beast_bomb', zoro: 'king_of_hell', luffy: 'gear_fifth', eren: 'paths',
  kaito: 'sun_forge', shiori: 'moonless_void', ren: 'petal_storm', goro: 'mountain_temple',
};

/**
 * Choir-like pad: detuned saws through two vowel formant band-passes, slow swell, vibrato.
 * `glide` > 0 starts every voice that many semitones low and slides up (the "rising swell").
 */
export function choir(e: Engine, t: number, notes: number[], dur: number, g: number, dest: AudioNode, o: { rise?: number; glide?: number; vowel?: 'ah' | 'oh' | 'oo'; wet?: number } = {}): void {
  const c = e.ctx!;
  const rise = o.rise ?? dur * 0.45;
  const vow = o.vowel === 'oo' ? [320, 800] : o.vowel === 'oh' ? [500, 900] : [780, 1180];
  const bus = c.createGain();
  bus.gain.value = 1;
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(g, t + rise);
  env.gain.setValueAtTime(g, t + Math.max(rise, dur - 0.35));
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  for (const fr of vow) {
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fr; f.Q.value = 7;
    const fg = c.createGain(); fg.gain.value = fr === vow[0] ? 1 : 0.6;
    bus.connect(f); f.connect(fg); fg.connect(env);
  }
  env.connect(dest);
  if (o.wet) { const w = c.createGain(); w.gain.value = o.wet; env.connect(w); w.connect(e.revIn); }
  const lfo = c.createOscillator(); lfo.frequency.value = 5.3;
  const lg = c.createGain(); lg.gain.value = 14;
  lfo.connect(lg);
  const oscs: OscillatorNode[] = [lfo];
  for (const n of notes) for (const d of [-9, 0, 9]) {
    const os = c.createOscillator();
    os.type = 'sawtooth';
    const fN = NOTE(n);
    if (o.glide) {
      os.frequency.setValueAtTime(fN * Math.pow(2, -o.glide / 12), t);
      os.frequency.exponentialRampToValueAtTime(fN, t + dur * 0.8);
    } else os.frequency.value = fN;
    os.detune.value = d;
    lg.connect(os.detune);
    const vg = c.createGain(); vg.gain.value = 0.22;
    os.connect(vg); vg.connect(bus);
    oscs.push(os);
  }
  for (const os of oscs) { os.start(t); os.stop(t + dur + 0.05); }
}

// ------------------------------------------------------------------ building blocks
function boing(e: Engine, t: number, base: number, dur: number, g: number, dest?: AudioNode): void {
  const c = e.ctx!;
  const o = c.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime(base * 1.6, t);
  o.frequency.exponentialRampToValueAtTime(base * 0.9, t + dur);
  const lfo = c.createOscillator(); lfo.frequency.value = 17;
  const lg = c.createGain();
  lg.gain.setValueAtTime(base * 0.7, t);
  lg.gain.exponentialRampToValueAtTime(1, t + dur);
  lfo.connect(lg); lg.connect(o.frequency);
  const gn = c.createGain();
  gn.gain.setValueAtTime(0.0001, t);
  gn.gain.linearRampToValueAtTime(g, t + 0.006);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
  o.connect(lp); lp.connect(gn); gn.connect(dest ?? e.sfxBus);
  o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
}

/** amplitude-modulated noise "whirr" (Rasengan drill, wind blades) */
function whirr(e: Engine, t: number, dur: number, f0: number, f1: number, rate: number, g: number, tone = 0, dest?: AudioNode): void {
  const c = e.ctx!;
  const src = c.createBufferSource(); src.buffer = e.noiseW; src.loop = true;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.5;
  bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const am = c.createGain(); am.gain.value = 0.55;
  const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.setValueAtTime(rate, t); lfo.frequency.linearRampToValueAtTime(rate * 1.5, t + dur);
  const lg = c.createGain(); lg.gain.value = 0.45;
  lfo.connect(lg); lg.connect(am.gain);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(g, t + Math.min(0.12, dur * 0.3));
  env.gain.setValueAtTime(g, t + dur * 0.65);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp); bp.connect(am); am.connect(env); env.connect(dest ?? e.sfxBus);
  src.start(t, Math.random()); lfo.start(t); src.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  if (tone) e.tone(t, dur, { type: 'sawtooth', f0: tone, f1: tone * 1.9, g: g * 0.22, lp: 1600, a: dur * 0.3, dest });
}

function gust(e: Engine, t: number, dur: number, g: number, f0 = 400, f1 = 1800): void {
  e.noise(t, dur, { ft: 'bandpass', f0, f1, q: 0.9, g, a: dur * 0.4 });
  e.noise(t + dur * 0.1, dur * 0.9, { ft: 'bandpass', f0: f0 * 2.2, f1: f1 * 0.8, q: 2.2, g: g * 0.5, a: dur * 0.35 });
  e.tone(t, dur, { f0: f0 * 1.4, f1: f1 * 0.7, g: g * 0.07, a: dur * 0.4, lp: 3000 });
}

function slash(e: Engine, t: number, p: number, g: number, wet: AudioNode): void {
  e.noise(t, 0.15, { ft: 'bandpass', f0: 2200 * p, f1: 6500 * p, q: 1.4, g: 0.3 * g, a: 0.012 });
  e.fm(t + 0.05, 0.4, 2900 * p, 3.4, 5, 0.1 * g, wet);
  e.noise(t + 0.04, 0.1, { ft: 'highpass', f0: 5500, g: 0.12 * g, a: 0.002 });
}

function boom(e: Engine, t: number, size: number, dest: AudioNode): void {
  e.tone(t, 0.9 * size, { f0: 90, f1: 28, g: 0.95, a: 0.002, dest });
  e.noise(t, 0.6 * size, { type: 'brown', ft: 'lowpass', f0: 900, f1: 70, g: 0.85, a: 0.002, dest });
  e.noise(t, 0.18, { ft: 'bandpass', f0: 2200, f1: 500, q: 0.7, g: 0.5, a: 0.001, dest });
  e.click(t, 0.4);
}

function crackle(e: Engine, t: number, n: number, span: number, g: number): void {
  for (let i = 0; i < n; i++) {
    const d = Math.pow(Math.random(), 1.4) * span;
    e.noise(t + d, 0.012 + Math.random() * 0.02, { ft: 'highpass', f0: 3500 + Math.random() * 4000, g: g * (1 - d / span * 0.6), a: 0.0007 });
    if (Math.random() < 0.5) e.tone(t + d, 0.03, { type: 'sawtooth', f0: 1800 + Math.random() * 3000, f1: 400, g: g * 0.25, a: 0.0005 });
  }
}

function thunder(e: Engine, t: number, wet: AudioNode, size = 1): void {
  e.noise(t, 0.09, { ft: 'highpass', f0: 1500, g: 0.9, a: 0.0006, dest: wet });
  e.noise(t + 0.02, 1.7 * size, { type: 'brown', ft: 'lowpass', f0: 1200, f1: 60, g: 0.95, a: 0.004, dest: wet });
  e.tone(t + 0.02, 1.2 * size, { f0: 70, f1: 24, g: 0.85, dest: wet });
  crackle(e, t, 10, 0.45, 0.28);
  e.fm(t, 0.35, 2600, 1.9, 6, 0.08, wet);
}

function roarSwell(e: Engine, t: number, dur: number, g: number, wet: AudioNode, low = 1): void {
  const c = e.ctx!;
  e.noise(t, dur, { type: 'brown', ft: 'lowpass', f0: 180 * low, f1: 1100 * low, q: 1.4, g: g * 1.1, a: dur * 0.55, dest: wet });
  e.noise(t + dur * 0.1, dur * 0.9, { ft: 'bandpass', f0: 500 * low, f1: 1700 * low, q: 1.1, g: g * 0.55, a: dur * 0.55, dest: wet });
  const o = c.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(52 * low, t); o.frequency.exponentialRampToValueAtTime(96 * low, t + dur * 0.7);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(260, t); lp.frequency.exponentialRampToValueAtTime(1100, t + dur * 0.7);
  const am = c.createGain(); am.gain.value = 0.7;
  const lfo = c.createOscillator(); lfo.frequency.value = 17;
  const lg = c.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(g * 0.55, t + dur * 0.55); env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(lp); lp.connect(am); am.connect(env); env.connect(wet);
  o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
}

function steam(e: Engine, t: number, dur: number, g: number): void {
  e.noise(t, dur, { ft: 'highpass', f0: 2600, f1: 5200, q: 0.6, g, a: 0.03 });
  e.noise(t, dur * 0.8, { ft: 'bandpass', f0: 1800, f1: 900, q: 0.8, g: g * 0.55, a: 0.04 });
  e.tone(t, 0.2, { f0: 140, f1: 70, g: 0.25 });
}

function heartbeat(e: Engine, t: number, g = 1, dest?: AudioNode): void {
  e.tone(t, 0.26, { f0: 95, f1: 40, g: 0.95 * g, a: 0.002, dest });
  e.noise(t, 0.09, { ft: 'lowpass', f0: 500, g: 0.5 * g, a: 0.001, dest });
  e.tone(t + 0.17, 0.22, { f0: 80, f1: 38, g: 0.7 * g, a: 0.002, dest });
  e.noise(t + 0.17, 0.07, { ft: 'lowpass', f0: 420, g: 0.35 * g, a: 0.001, dest });
}

function glassRipple(e: Engine, t: number, wet: AudioNode, base = 91, g = 0.14): void {
  [0, 7, 12, 19, 24].forEach((iv, i) => {
    e.tone(t + i * 0.055, 0.9 - i * 0.07, { f0: NOTE(base + iv), g: g * (1 - i * 0.12), a: 0.002, dest: wet });
    e.tone(t + i * 0.055, 0.5, { f0: NOTE(base + iv) * 2.01, g: g * 0.25, a: 0.001, dest: wet });
  });
  e.fm(t, 0.9, 3400, 2.4, 3, 0.07, wet);
  e.noise(t, 0.5, { ft: 'highpass', f0: 7000, g: 0.1, a: 0.02, dest: wet });
}

function poof(e: Engine, t: number, pitch: number, g: number): void {
  e.noise(t, 0.22, { ft: 'bandpass', f0: 1100 * pitch, f1: 280 * pitch, q: 0.7, g: 0.55 * g, a: 0.004 });
  e.tone(t, 0.12, { f0: 420 * pitch, f1: 130 * pitch, g: 0.4 * g, a: 0.002 });
  e.noise(t + 0.02, 0.3, { ft: 'highpass', f0: 5000, f1: 2500, g: 0.12 * g, a: 0.02 });
}

function odm(e: Engine, t: number): void {
  e.noise(t, 0.2, { ft: 'bandpass', f0: 800, f1: 7000, q: 3, g: 0.34, a: 0.01 });
  e.tone(t, 0.14, { type: 'sawtooth', f0: 500, f1: 2600, g: 0.07, lp: 4000, a: 0.005 });
  e.click(t + 0.17, 0.35);
  e.fm(t + 0.17, 0.14, 3100, 3.1, 3, 0.1);
  e.noise(t + 0.12, 0.35, { ft: 'highpass', f0: 5000, f1: 3000, g: 0.14, a: 0.05 });
}

// ------------------------------------------------------------------ public API
const HAS_MOVE = /^(gojo_(blue|max_blue|red|blink|counter)$|naruto_(rasengan|kurama_rasengan|kurama_arm|sage_rasengan|barrage|clone_|tbb)|zoro_(?!jab$|kick$|jk$)|luffy_|eren_(grapple|lunge|jh|backspin|thunder_spear|spear_volley|t_stomp|paths_stomp|t_roar|t_hardening|counter$|t_charge))/;

export class XSfx {
  static has(id: string): boolean { return HAS_MOVE.test(id); }
  constructor(private e: Engine) {}
  private get wet(): AudioNode { return this.e.sfxWet; }

  // ---------------- projectiles (tag = ProjectileDef.kind)
  projectile(t: number, kind: string): boolean {
    const e = this.e;
    switch (kind) {
      case 'blue': case 'blue_max': {
        // deep implosion suck: noise gets pulled in (rising filter) + falling-then-rising hum
        const big = kind === 'blue_max' ? 1.3 : 1;
        e.noise(t, 0.55 * big, { ft: 'bandpass', f0: 3200, f1: 140, q: 1.4, g: 0.5, a: 0.04, dest: this.wet });
        e.tone(t, 0.6 * big, { f0: 520, f1: 62, g: 0.55, a: 0.02, dest: this.wet });
        e.tone(t, 0.7 * big, { type: 'sine', f0: 62, f1: 47, g: 0.5, a: 0.18, dest: this.wet });
        e.tone(t + 0.05, 0.5, { type: 'triangle', f0: 1200, f1: 180, g: 0.07, lp: 2500 });
        return true;
      }
      case 'red':
        e.noise(t, 0.2, { ft: 'bandpass', f0: 3000, f1: 400, q: 0.8, g: 0.75, a: 0.001, dest: this.wet });
        e.tone(t, 0.3, { f0: 160, f1: 38, g: 0.95, a: 0.001, dest: this.wet });
        e.fm(t, 0.35, 1400, 1.6, 6, 0.18, this.wet);
        e.click(t, 0.5);
        e.noise(t + 0.02, 0.45, { type: 'brown', ft: 'lowpass', f0: 800, f1: 90, g: 0.6, dest: this.wet });
        return true;
      case 'hollow_purple': {
        // the swell is on ultimateStart; the beam release is the enormous boom + sizzle tail
        boom(e, t, 2.6, this.wet);
        e.tone(t, 2.8, { f0: 46, f1: 17, g: 1, a: 0.002, dest: this.wet });
        e.noise(t, 2.2, { type: 'brown', ft: 'lowpass', f0: 600, f1: 50, g: 0.8, a: 0.004, dest: this.wet });
        e.noise(t + 0.02, 1.4, { ft: 'bandpass', f0: 1400, f1: 300, q: 0.6, g: 0.5, a: 0.01, dest: this.wet });
        for (let i = 0; i < 26; i++) {
          const d = 0.15 + Math.pow(Math.random(), 1.3) * 2.4;
          e.noise(t + d, 0.01 + Math.random() * 0.025, { ft: 'highpass', f0: 5000 + Math.random() * 5000, g: 0.2 * (1 - d / 3), a: 0.0005 });
          if (i % 3 === 0) e.tone(t + d, 0.06, { type: 'triangle', f0: 3000 + Math.random() * 4500, f1: 1500, g: 0.05 * (1 - d / 3), a: 0.001 });
        }
        e.noise(t + 0.1, 2.4, { ft: 'highpass', f0: 6000, f1: 9000, g: 0.14, a: 0.3, dest: this.wet });
        e.duckMusic(0.2, 1.8, 0.8);
        return true;
      }
      case 'rasenshuriken': case 'rasenshuriken_kurama': {
        const k = kind === 'rasenshuriken_kurama' ? 0.7 : 1;
        // screeching wind blades
        whirr(e, t, 1.1, 2800 * k, 5200 * k, 38, 0.45, 0, this.wet);
        for (let i = 0; i < 7; i++) e.noise(t + 0.08 + i * 0.13, 0.09, { ft: 'bandpass', f0: (4200 + i * 280) * k, f1: 8000 * k, q: 3, g: 0.2, a: 0.005 });
        e.tone(t, 1.0, { type: 'sine', f0: 3200 * k, f1: 4800 * k, g: 0.06, a: 0.3, dest: this.wet });
        return true;
      }
      case 'thunder_spear':
        // whistle (rising, wobbling) while it flies; the blast is the 'detonate' tag
        this.whistle(t);
        return true;
      case 'titan_roar':
        roarSwell(e, t, 1.3, 0.6, this.wet, 0.8);
        return true;
      case 'flying_slash':
        slash(e, t, 0.8, 1.2, this.wet);
        gust(e, t, 0.4, 0.22, 600, 2600);
        return true;
      default: return false;
    }
  }

  private whistle(t: number): void {
    const e = this.e, c = e.ctx!;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(1500, t); o.frequency.exponentialRampToValueAtTime(2500, t + 0.85);
    const lfo = c.createOscillator(); lfo.frequency.value = 9;
    const lg = c.createGain(); lg.gain.value = 70; lfo.connect(lg); lg.connect(o.frequency);
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(0.13, t + 0.12); env.gain.setValueAtTime(0.13, t + 0.65); env.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(env); env.connect(this.wet);
    o.start(t); lfo.start(t); o.stop(t + 0.95); lfo.stop(t + 0.95);
    e.noise(t, 0.85, { ft: 'bandpass', f0: 3000, f1: 5000, q: 9, g: 0.07, a: 0.2 });
    crackle(e, t, 6, 0.8, 0.07);
  }

  detonate(t: number): void {
    const e = this.e;
    boom(e, t, 1.2, this.wet);
    thunder(e, t, this.wet, 0.8);
    e.noise(t, 0.5, { ft: 'bandpass', f0: 3000, f1: 800, q: 0.7, g: 0.4, a: 0.002, dest: this.wet });
    e.duckMusic(0.35, 0.7, 0.5);
  }

  hollowSwell(t: number): void {
    const e = this.e;
    // rising choir-like swell (glides up an octave) + a rising sub, ends right where the boom lands
    choir(e, t, [45, 57, 64, 69, 76], 1.15, 0.09, this.wet, { rise: 1.0, glide: 12, vowel: 'oo', wet: 0.4 });
    choir(e, t + 0.25, [60, 67, 72], 0.9, 0.05, this.wet, { rise: 0.7, glide: 7, vowel: 'ah' });
    e.noise(t, 1.1, { ft: 'bandpass', f0: 200, f1: 6000, q: 0.8, g: 0.35, a: 1.0, dest: this.wet });
    e.tone(t, 1.1, { type: 'sine', f0: 60, f1: 180, g: 0.4, a: 0.9, dest: this.wet });
  }

  // ---------------- moves (event 'moveStart', moveId)
  /** returns true if the move got a dedicated sound */
  move(t: number, id: string): boolean {
    const e = this.e, w = this.wet;
    switch (id) {
      // ---- Gojo
      case 'gojo_blue': case 'gojo_max_blue':
        e.noise(t, 0.28, { ft: 'bandpass', f0: 400, f1: 2400, q: 1, g: 0.18, a: 0.2, dest: w });
        e.tone(t, 0.3, { f0: 110, f1: 330, g: 0.16, a: 0.2, dest: w });
        return true;
      case 'gojo_red': case 'gojo_counter_red': case 'gojo_red_max':
        if (id === 'gojo_red') this.projectile(t + 0.14, 'red');
        return true;
      case 'gojo_blink':
        e.tone(t, 0.18, { type: 'triangle', f0: 2200, f1: 180, g: 0.2 });
        e.noise(t, 0.16, { ft: 'bandpass', f0: 5000, f1: 400, q: 1, g: 0.3, a: 0.004 });
        glassRipple(e, t + 0.12, w, 100, 0.06);
        return true;
      case 'gojo_counter':
        glassRipple(e, t + 0.03, w, 96, 0.08);
        return true;
      // ---- Naruto
      case 'naruto_rasengan': case 'naruto_kurama_rasengan': case 'naruto_sage_rasengan': {
        const big = id === 'naruto_rasengan' ? 1 : 0.65;
        whirr(e, t, 0.85, 1500 * big, 3200 * big, 30 * big, 0.38, 180 * big, w);
        return true;
      }
      case 'naruto_kurama_arm':
        roarSwell(e, t, 0.7, 0.35, w, 1.2);
        gust(e, t + 0.2, 0.4, 0.3, 300, 1400);
        return true;
      case 'naruto_barrage':
        for (let i = 0; i < 10; i++) { e.tone(t + 0.12 + i * 0.045, 0.06, { f0: 220, f1: 90, g: 0.3, a: 0.001 }); e.click(t + 0.12 + i * 0.045, 0.14); }
        return true;
      case 'naruto_clone_rush': case 'naruto_clone_jutsu':
        e.click(t, 0.3); e.tone(t, 0.08, { type: 'square', f0: 600, f1: 300, g: 0.1 });
        e.click(t + 0.08, 0.25);
        return true;
      case 'naruto_tbb':
        roarSwell(e, t + 0.1, 1.4, 0.55, w, 0.85);
        return true;
      case 'naruto_tbb_blast':
        boom(e, t, 2, w); roarSwell(e, t, 1.2, 0.5, w, 0.9);
        return true;
      // ---- Zoro: style-aware slashes (three swords layer, one sword is a single deep cut, two is fast)
      case 'zoro_3_h': case 'zoro_3_hh':
        slash(e, t, 0.9, 1, w); slash(e, t + 0.028, 1.0, 0.85, w); slash(e, t + 0.056, 1.14, 0.75, w);
        return true;
      case 'zoro_1_h':
        e.noise(t, 0.22, { ft: 'bandpass', f0: 1200, f1: 5200, q: 1.1, g: 0.4, a: 0.03 });
        e.fm(t + 0.12, 0.8, 1800, 3.3, 4, 0.14, w);
        e.tone(t + 0.1, 0.25, { f0: 140, f1: 55, g: 0.4 });
        return true;
      case 'zoro_2_h': case 'zoro_2_hh': case 'zoro_2_hhh':
        slash(e, t, 1.05, 1, w); slash(e, t + 0.04, 1.22, 0.8, w);
        return true;
      case 'zoro_style': {
        const n = 3;
        for (let i = 0; i < n; i++) { e.fm(t + i * 0.07, 0.35, 2600 + i * 450, 3.2, 3, 0.08, w); e.noise(t + i * 0.07, 0.06, { ft: 'bandpass', f0: 5000, q: 2, g: 0.15, a: 0.003 }); }
        return true;
      }
      case 'zoro_tatsumaki':
        gust(e, t + 0.03, 0.9, 0.5, 350, 2000);
        e.noise(t + 0.08, 0.7, { ft: 'bandpass', f0: 900, f1: 2400, q: 3, g: 0.2, a: 0.25 });
        slash(e, t + 0.05, 1, 0.8, w);
        return true;
      case 'zoro_oni_giri': case 'zoro_sanzen_sekai': case 'zoro_rengoku':
        e.noise(t, 0.2, { ft: 'bandpass', f0: 600, f1: 3800, q: 1, g: 0.35, a: 0.02 });
        slash(e, t + 0.1, 0.85, 1, w); slash(e, t + 0.14, 1, 0.8, w); slash(e, t + 0.18, 1.15, 0.7, w);
        return true;
      case 'zoro_king_of_hell':
        for (let i = 0; i < 3; i++) e.fm(t + i * 0.12, 0.6, 2200 + i * 380, 3.4, 4, 0.1, w);
        return true;
      case 'zoro_jab2': case 'zoro_jab3': case 'zoro_lowcut': case 'zoro_sweep': case 'zoro_launcher':
      case 'zoro_thrust': case 'zoro_spin': case 'zoro_jh': case 'zoro_ult': case 'zoro_ult_aw':
        slash(e, t + 0.02, id === 'zoro_sweep' || id === 'zoro_lowcut' ? 0.85 : 1, 1, w);
        return true;
      // ---- Luffy
      case 'luffy_gatling':
        for (let i = 0; i < 14; i++) {
          const d = t + 0.1 + i * 0.052;
          e.tone(d, 0.08, { f0: rnd(150, 230), f1: 60, g: 0.34, a: 0.001 });
          e.noise(d, 0.04, { ft: 'bandpass', f0: rnd(1200, 2400), q: 1.5, g: 0.2, a: 0.001 });
        }
        boing(e, t, 220, 0.18, 0.12);
        return true;
      case 'luffy_bell':
        boing(e, t + 0.08, 120, 0.4, 0.3);
        e.fm(t + 0.2, 0.6, 700, 1.9, 3, 0.1, w);
        return true;
      case 'luffy_jk': case 'luffy_jh': case 'luffy_launcher':
        boing(e, t, 260, 0.2, 0.14);
        return true;
      case 'luffy_gear5':
        heartbeat(e, t);
        return true;
      default:
        if (id.startsWith('luffy_')) {
          const heavy = /kong|leo|elephant|ult|bajrang|rocket/.test(id);
          boing(e, t, heavy ? 150 : 210, heavy ? 0.45 : 0.3, heavy ? 0.28 : 0.2);
          e.noise(t + 0.03, heavy ? 0.4 : 0.22, { ft: 'bandpass', f0: 500, f1: 2600, q: 0.9, g: heavy ? 0.4 : 0.26, a: 0.05 });
          if (heavy) steam(e, t, 0.45, 0.12);
          return true;
        }
        break;
      // ---- Eren
      case 'eren_grapple': case 'eren_lunge': case 'eren_jh': case 'eren_backspin':
        odm(e, t);
        return true;
      case 'eren_thunder_spear': case 'eren_spear_volley':
        e.noise(t, 0.2, { ft: 'bandpass', f0: 1000, f1: 4000, q: 2, g: 0.2, a: 0.02 });
        e.click(t + 0.12, 0.3);
        return true;
      case 'eren_t_stomp': case 'eren_paths_stomp':
        boom(e, t + 0.1, 0.9, w);
        crackle(e, t + 0.1, 5, 0.25, 0.14);
        return true;
      case 'eren_t_roar':
        roarSwell(e, t, 1.0, 0.55, w, 0.8);
        return true;
      case 'eren_t_hardening': case 'eren_counter':
        e.fm(t + 0.05, 0.7, 1500, 2.2, 3, 0.13, w);
        e.noise(t, 0.12, { ft: 'highpass', f0: 4000, g: 0.2 });
        return true;
      case 'eren_t_charge':
        boom(e, t, 0.6, w); gust(e, t + 0.15, 0.5, 0.2, 300, 900);
        return true;
    }
    return false;
  }

  // ---------------- forms
  form(t: number, tag: string): void {
    const e = this.e, w = this.wet;
    switch (tag) {
      case 'six_eyes':
        glassRipple(e, t, w, 88, 0.12);
        e.tone(t, 0.9, { type: 'sine', f0: 200, f1: 1600, g: 0.14, a: 0.5, dest: w });
        e.noise(t, 0.9, { ft: 'highpass', f0: 3000, f1: 9000, g: 0.14, a: 0.5, dest: w });
        break;
      case 'sage': {
        // deep resonant hum: stacked sines with a slow swell
        [55, 110, 165, 220].forEach((f, i) => e.tone(t, 2.2, { f0: f, g: 0.28 / (i + 1) + 0.04, a: 1.0, dest: w, detune: i * 3 }));
        e.noise(t, 2.0, { type: 'brown', ft: 'lowpass', f0: 160, f1: 420, g: 0.4, a: 0.9, dest: w });
        this.chordShimmer(t + 0.6, [57, 64, 69]);
        break;
      }
      case 'kurama':
        roarSwell(e, t, 1.7, 0.7, w, 0.9);
        e.tone(t + 1.1, 1.0, { f0: 70, f1: 28, g: 0.8, dest: w });
        e.noise(t + 1.1, 0.8, { type: 'brown', ft: 'lowpass', f0: 500, f1: 70, g: 0.6, dest: w });
        break;
      case 'santoryu':
        for (let i = 0; i < 3; i++) { e.fm(t + i * 0.09, 0.45, 2500 + i * 330, 3.3, 4, 0.1, w); e.noise(t + i * 0.09, 0.07, { ft: 'bandpass', f0: 6000, q: 2, g: 0.16, a: 0.002 }); }
        break;
      case 'ittoryu':
        e.fm(t, 0.7, 2000, 3.3, 5, 0.13, w); e.noise(t, 0.08, { ft: 'bandpass', f0: 5000, q: 2, g: 0.18, a: 0.002 });
        break;
      case 'nitoryu':
        for (let i = 0; i < 2; i++) { e.fm(t + i * 0.09, 0.5, 2800 + i * 400, 3.3, 4, 0.11, w); e.noise(t + i * 0.09, 0.07, { ft: 'bandpass', f0: 5500, q: 2, g: 0.16, a: 0.002 }); }
        break;
      case 'gear2':
        steam(e, t, 0.9, 0.3);
        boing(e, t, 180, 0.3, 0.14);
        heartbeat(e, t + 0.05, 0.5);
        break;
      case 'gear4':
        steam(e, t, 1.2, 0.36);
        boing(e, t, 100, 0.55, 0.28);
        e.tone(t + 0.1, 0.5, { f0: 70, f1: 32, g: 0.8, dest: w });
        e.noise(t + 0.1, 0.4, { type: 'brown', ft: 'lowpass', f0: 400, f1: 80, g: 0.5, dest: w });
        break;
      case 'gear5':
        // heartbeat drum: dum-dum, dum-dum
        heartbeat(e, t, 1); heartbeat(e, t + 0.55, 0.9);
        boing(e, t + 0.3, 330, 0.5, 0.16);
        steam(e, t + 0.2, 0.8, 0.2);
        [72, 76, 79, 84].forEach((n, i) => e.tone(t + 0.6 + i * 0.07, 0.35, { type: 'triangle', f0: NOTE(n), g: 0.1, dest: w }));
        break;
      case 'titan':
        // thunder crack + transform roar swell
        thunder(e, t, w, 1);
        roarSwell(e, t + 0.25, 1.5, 0.7, w, 0.85);
        e.tone(t + 0.4, 1.2, { f0: 60, f1: 24, g: 0.9, dest: w });
        e.duckMusic(0.3, 1.6, 0.6);
        break;
      default: break; // 'base' (form ended): quiet
    }
  }

  private chordShimmer(t: number, notes: number[]): void {
    notes.forEach((n, i) => this.e.tone(t + i * 0.1, 1.2, { f0: NOTE(n + 12), g: 0.07, a: 0.2, dest: this.wet }));
  }

  // ---------------- clones
  summon(t: number): void { poof(this.e, t, 1, 1); }
  summonDispel(t: number, tag?: string): void {
    poof(this.e, t, tag === 'hit' ? 1.5 : 1.25, 0.8);
    if (tag === 'hit') this.e.tone(t + 0.02, 0.1, { type: 'triangle', f0: 1800, f1: 600, g: 0.1 });
  }

  // ---------------- Infinity
  infinity(t: number, tag?: string): void {
    glassRipple(this.e, t, this.wet, tag === 'infinity' ? 91 : 95, tag === 'infinity' ? 0.16 : 0.1);
    this.e.tone(t, 0.12, { f0: 240, f1: 120, g: 0.25 });
  }

  // ---------------- realms
  realmStart(t: number, kind: string): void {
    const e = this.e, w = this.wet;
    e.click(t, 0.4); e.noise(t, 0.08, { ft: 'bandpass', f0: 1400, q: 2, g: 0.4, a: 0.001 }); // hand-sign clap
    switch (kind) {
      case 'infinite_void':
        e.tone(t, 1.8, { f0: 110, f1: 28, g: 0.9, a: 0.01, dest: w });
        e.noise(t + 0.05, 1.5, { ft: 'bandpass', f0: 9000, f1: 400, q: 0.8, g: 0.45, a: 0.02, dest: w });
        glassRipple(e, t + 0.15, w, 84, 0.1);
        choir(e, t + 0.3, [50, 57, 62], 2.4, 0.05, w, { vowel: 'oo', rise: 1.2, wet: 0.5 });
        break;
      case 'tailed_beast_bomb':
        roarSwell(e, t + 0.05, 1.6, 0.75, w, 0.8);
        [0.2, 0.6, 1.0].forEach((d, i) => { e.tone(t + d, 0.6, { f0: 110 - i * 12, f1: 40, g: 0.9, dest: w }); e.noise(t + d, 0.12, { ft: 'lowpass', f0: 900, g: 0.5 }); });
        break;
      case 'king_of_hell':
        for (let i = 0; i < 3; i++) e.fm(t + 0.05 + i * 0.12, 0.8, 2000 + i * 420, 3.4, 5, 0.12, w);
        [0.05, 0.5, 0.95].forEach((d) => { e.tone(t + d, 0.7, { f0: 112, f1: 46, g: 0.95, dest: w }); e.noise(t + d, 0.12, { ft: 'lowpass', f0: 900, g: 0.5 }); });
        break;
      case 'gear_fifth':
        heartbeat(e, t + 0.05); heartbeat(e, t + 0.6);
        boing(e, t, 300, 0.5, 0.2);
        [72, 79, 84, 88, 91].forEach((n, i) => e.tone(t + 0.15 + i * 0.07, 0.4, { type: 'triangle', f0: NOTE(n), g: 0.1, dest: w }));
        break;
      case 'paths':
        choir(e, t, [50, 57, 62, 66, 74], 2.6, 0.08, w, { vowel: 'ah', rise: 1.3, wet: 0.6 });
        thunder(e, t + 0.1, w, 0.8);
        break;
      case 'sun_forge':
        // furnace roar + three anvil strikes
        e.noise(t, 1.6, { type: 'brown', ft: 'lowpass', f0: 300, f1: 1400, g: 0.6, a: 0.4, dest: w });
        [0.15, 0.5, 0.85].forEach((d, i) => { e.fm(t + d, 0.9, 1500 + i * 160, 2.76, 5, 0.12, w); e.tone(t + d, 0.4, { f0: 120, f1: 50, g: 0.6 }); });
        crackle(e, t + 0.2, 10, 1.2, 0.14);
        break;
      case 'moonless_void':
        // everything drains away: a rising whoosh into a deep sub, one hollow flute breath
        e.noise(t, 1.2, { ft: 'bandpass', f0: 300, f1: 6000, q: 0.8, g: 0.35, a: 1.0, dest: w });
        e.tone(t + 1.0, 1.6, { f0: 70, f1: 30, g: 0.8, dest: w });
        e.noise(t + 1.1, 1.4, { ft: 'bandpass', f0: 1400, q: 9, g: 0.12, a: 0.3, dest: w });
        break;
      case 'petal_storm':
        // a gust full of petals, koto glissando, one sword ring
        gust(e, t, 1.4, 0.3, 600, 4200);
        [64, 65, 69, 71, 72, 76, 77, 81].forEach((n, i) => e.tone(t + 0.1 + i * 0.05, 0.6, { type: 'triangle', f0: NOTE(n), g: 0.09, a: 0.002, dest: w }));
        e.fm(t + 0.6, 1.4, 2600, 3.1, 3, 0.08, w);
        break;
      case 'mountain_temple':
        // huge temple bell + stone rumble + low monks
        e.fm(t + 0.05, 3.2, NOTE(38), 1.41, 4, 0.22, w);
        e.tone(t + 0.05, 2.5, { f0: NOTE(26), g: 0.7, dest: w });
        e.noise(t, 1.2, { type: 'brown', ft: 'lowpass', f0: 500, f1: 90, g: 0.7, dest: w });
        choir(e, t + 0.3, [38, 45, 50], 2.4, 0.06, w, { vowel: 'oh', rise: 1.0, wet: 0.5 });
        break;
      default: break;
    }
  }

  realmClash(t: number): void {
    const e = this.e, w = this.wet;
    // both worlds grinding: dissonant choir + roar + huge impact
    choir(e, t, [50, 56, 62, 68], 2.2, 0.09, w, { vowel: 'ah', rise: 0.9, wet: 0.5 });
    roarSwell(e, t, 1.6, 0.8, w, 0.8);
    boom(e, t + 0.05, 1.8, w);
    thunder(e, t + 0.2, w, 0.7);
    e.fm(t, 1.2, 1100, 1.41, 6, 0.1, w);
  }

  realmEnd(t: number): void {
    const e = this.e, w = this.wet;
    e.noise(t, 0.7, { ft: 'bandpass', f0: 6000, f1: 300, q: 0.7, g: 0.4, a: 0.01, dest: w });
    e.tone(t, 0.6, { f0: 160, f1: 36, g: 0.6, dest: w });
    glassRipple(e, t + 0.05, w, 86, 0.07);
  }

  /** Sun Forge burn tick: a short quiet sizzle */
  burn(t: number): void {
    const e = this.e;
    e.noise(t, 0.12, { ft: 'highpass', f0: 3500, f1: 6000, g: 0.07, a: 0.004 });
    crackle(e, t, 2, 0.1, 0.05);
  }

  /** armor absorbed a strike (hit tag 'armor'): stone clank; `temple` = Goro's Mountain Temple stone skin */
  armor(t: number, temple: boolean): void {
    const e = this.e;
    e.fm(t, temple ? 0.6 : 0.35, temple ? 520 : 760, 1.41, 3, temple ? 0.14 : 0.1, this.wet);
    e.tone(t, 0.18, { f0: 160, f1: 70, g: 0.5 });
    e.noise(t, 0.08, { ft: 'bandpass', f0: 1800, q: 1.4, g: 0.3, a: 0.001 });
    if (temple) e.noise(t + 0.02, 0.3, { type: 'brown', ft: 'lowpass', f0: 600, f1: 120, g: 0.35 });
  }

  /** extra weight for a realm blast / Paths stomp (hit tag 'realm') */
  realmHit(t: number): void { boom(this.e, t, 1.1, this.wet); }

  // elements for hit() layering
  elem(t: number, el: string, k: number): boolean {
    const e = this.e;
    switch (el) {
      case 'void':
        e.tone(t, 0.45, { f0: 120, f1: 55, g: 0.28 * k, a: 0.01, dest: this.wet });
        e.fm(t, 0.5, 2600, 2.3, 3, 0.1 * k, this.wet);
        e.noise(t, 0.3, { ft: 'bandpass', f0: 5000, f1: 700, q: 1.2, g: 0.16 * k });
        return true;
      case 'wind':
        gust(e, t, 0.3, 0.2 * k, 800, 3200);
        return true;
      case 'lightning':
        crackle(e, t, 6, 0.2, 0.2 * k);
        e.fm(t, 0.2, 2200, 1.9, 5, 0.1 * k, this.wet);
        return true;
      case 'rubber':
        boing(e, t, 200, 0.28, 0.2 * k);
        e.noise(t, 0.05, { ft: 'bandpass', f0: 900, q: 2, g: 0.3 * k, a: 0.001 });
        return true;
      default: return false;
    }
  }
}
