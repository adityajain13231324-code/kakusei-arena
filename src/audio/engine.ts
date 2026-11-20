// Low-level WebAudio engine: context, buses, voice cap, synth primitives. No audio files.
export interface NoiseOpts { type?: 'white' | 'brown'; ft?: BiquadFilterType; f0?: number; f1?: number; q?: number; g?: number; a?: number; dest?: AudioNode; ft2?: BiquadFilterType; f2?: number }
export interface ToneOpts { type?: OscillatorType; f0: number; f1?: number; g?: number; a?: number; dest?: AudioNode; detune?: number; lp?: number }

export class Engine {
  ctx: AudioContext | null = null;
  master!: GainNode; comp!: DynamicsCompressorNode; sfxBus!: GainNode; sfxWet!: GainNode; musicBus!: GainNode;
  duck!: GainNode; musicLP!: BiquadFilterNode; revIn!: GainNode; analyser!: AnalyserNode; sfxPause!: GainNode;
  noiseW!: AudioBuffer; noiseB!: AudioBuffer;
  /** Sound v2 buses: sampled SFX, fighter voices, announcer, UI (UI skips the pause mute so menus stay audible) */
  smpBus!: GainNode; voiceBus!: GainNode; annBus!: GainNode; uiBus!: GainNode;
  sfxDuck!: GainNode; vduck!: GainNode;
  /** reverb sends (taps of the sample buses) and the two convolvers: A = stage room, B = Soul Realm wash */
  private smpSend!: GainNode; private voiceSend!: GainNode; private annSend!: GainNode;
  private convA!: ConvolverNode; private revOutA!: GainNode; private revOutB!: GainNode;
  private sendLevel = { smp: 0.12, voice: 0.1, ann: 0.14 };
  private impulses = new Map<string, AudioBuffer>();
  private stageRev = ''; private stageOut = 0.55;
  vols = { master: 0.8, music: 0.5, sfx: 0.9, voice: 0.9, announcer: 0.9 };
  private ends = new Float64Array(64);
  private endN = 0;
  maxVoices = 24;

  get now(): number { return this.ctx ? this.ctx.currentTime : 0; }
  get ready(): boolean { return !!this.ctx && this.ctx.state === 'running'; }

  init(): void {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 12; this.comp.ratio.value = 5; this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
    this.master = c.createGain();
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 512;
    this.sfxBus = c.createGain(); this.sfxPause = c.createGain(); this.sfxWet = c.createGain();
    this.musicBus = c.createGain(); this.duck = c.createGain(); this.musicLP = c.createBiquadFilter();
    this.musicLP.type = 'lowpass'; this.musicLP.frequency.value = 20000;
    this.revIn = c.createGain();
    // sfx -> sfxPause -> comp ; wet sfx -> sfxBus + reverb
    this.sfxDuck = c.createGain(); this.vduck = c.createGain();
    this.sfxBus.connect(this.sfxDuck); this.sfxDuck.connect(this.sfxPause); this.sfxPause.connect(this.comp);
    this.sfxWet.connect(this.sfxBus); this.sfxWet.connect(this.revIn);
    const conv = (this.convA = c.createConvolver());
    conv.buffer = this.makeImpulse(2.4);
    const revOut = (this.revOutA = c.createGain()); revOut.gain.value = 0.55;
    this.revIn.connect(conv); conv.connect(revOut); revOut.connect(this.sfxPause);
    const convB = c.createConvolver();
    convB.buffer = this.impulse('wash');
    this.revOutB = c.createGain(); this.revOutB.gain.value = 0;
    this.revIn.connect(convB); convB.connect(this.revOutB); this.revOutB.connect(this.sfxPause);
    this.musicBus.connect(this.duck); this.duck.connect(this.vduck); this.vduck.connect(this.musicLP); this.musicLP.connect(this.comp);
    // sample buses
    this.smpBus = c.createGain(); this.voiceBus = c.createGain(); this.annBus = c.createGain(); this.uiBus = c.createGain();
    this.smpSend = c.createGain(); this.voiceSend = c.createGain(); this.annSend = c.createGain();
    this.smpBus.connect(this.sfxBus); this.smpBus.connect(this.smpSend);
    this.voiceBus.connect(this.sfxPause); this.voiceBus.connect(this.voiceSend);
    this.annBus.connect(this.sfxPause); this.annBus.connect(this.annSend);
    this.uiBus.connect(this.comp);
    this.smpSend.connect(this.revIn); this.voiceSend.connect(this.revIn); this.annSend.connect(this.revIn);
    this.comp.connect(this.master); this.master.connect(this.analyser); this.analyser.connect(c.destination);
    // noise buffers
    const len = c.sampleRate * 2;
    this.noiseW = c.createBuffer(1, len, c.sampleRate);
    this.noiseB = c.createBuffer(1, len, c.sampleRate);
    const w = this.noiseW.getChannelData(0), b = this.noiseB.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const r = Math.random() * 2 - 1;
      w[i] = r;
      last = (last + 0.02 * r) / 1.02;
      b[i] = last * 3.5;
    }
    this.applyVolumes();
  }

  private makeImpulse(sec: number): AudioBuffer {
    const c = this.ctx!;
    const n = Math.floor(c.sampleRate * sec);
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6);
    }
    return buf;
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vols.master, t, 0.03);
    this.musicBus.gain.setTargetAtTime(this.vols.music, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(this.vols.sfx, t, 0.03);
    this.voiceBus.gain.setTargetAtTime(this.vols.voice, t, 0.03);
    this.annBus.gain.setTargetAtTime(this.vols.announcer, t, 0.03);
    this.uiBus.gain.setTargetAtTime(this.vols.sfx, t, 0.03);
    this.smpSend.gain.setTargetAtTime(this.sendLevel.smp * this.vols.sfx, t, 0.05);
    this.voiceSend.gain.setTargetAtTime(this.sendLevel.voice * this.vols.voice, t, 0.05);
    this.annSend.gain.setTargetAtTime(this.sendLevel.ann * this.vols.announcer, t, 0.05);
  }

  // ---------------------------------------------------------- per-stage reverb
  /** procedurally generated impulse responses (deterministic noise), cached */
  impulse(kind: 'room' | 'slapback' | 'wood' | 'wash'): AudioBuffer {
    const hit = this.impulses.get(kind);
    if (hit) return hit;
    const c = this.ctx!;
    const sec = { room: 0.55, slapback: 1.5, wood: 1.25, wash: 3.6 }[kind];
    const n = Math.floor(c.sampleRate * sec);
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let seed = 0x9e3779b1 ^ (ch * 7919) ^ kind.length * 131;
      const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296) * 2 - 1; };
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const x = i / n, ts = i / c.sampleRate;
        let v = rnd();
        if (kind === 'room') { lp += 0.55 * (v - lp); v = lp * Math.pow(1 - x, 3.2); }
        else if (kind === 'wood') { lp += 0.28 * (v - lp); v = lp * 1.8 * Math.pow(1 - x, 2.4); }
        else if (kind === 'wash') { lp += 0.16 * (v - lp); v = lp * 2.2 * Math.pow(1 - x, 1.7) * Math.min(1, ts * 12); }
        else {
          // open air: faint tail plus two discrete slap echoes (~0.17 s and ~0.34 s)
          lp += 0.35 * (v - lp);
          v = lp * 0.35 * Math.pow(1 - x, 4);
          for (const [dt, a] of [[0.17, 1], [0.34, 0.5]] as const) {
            const k = ts - dt - ch * 0.004;
            if (k >= 0 && k < 0.03) v += rnd() * a * Math.exp(-k * 140);
          }
        }
        d[i] = v;
      }
    }
    this.impulses.set(kind, buf);
    return buf;
  }

  /** pick the reverb for a stage: short room (training), open-air slapback (rooftop), wooden hall (shrine) */
  setStageReverb(stage: string): void {
    if (!this.ctx || stage === this.stageRev) return;
    this.stageRev = stage;
    const kind = stage === 'rooftop' ? 'slapback' : stage === 'shrine' ? 'wood' : stage === 'training' ? 'room' : null;
    const t = this.ctx.currentTime;
    this.revOutA.gain.cancelScheduledValues(t);
    this.revOutA.gain.setTargetAtTime(0, t, 0.02);
    this.sendLevel = stage === 'rooftop' ? { smp: 0.1, voice: 0.08, ann: 0.16 } : stage === 'shrine' ? { smp: 0.16, voice: 0.12, ann: 0.14 } : { smp: 0.1, voice: 0.07, ann: 0.1 };
    const out = (this.stageOut = kind === 'slapback' ? 0.6 : kind === 'wood' ? 0.6 : 0.5);
    const buf = kind ? this.impulse(kind) : null;
    window.setTimeout(() => {
      if (!this.ctx) return;
      if (buf) this.convA.buffer = buf;
      this.revOutA.gain.setTargetAtTime(out, this.ctx.currentTime, 0.08);
    }, 80);
    this.applyVolumes();
  }

  /** Soul Realm: crossfade the stage room into the big wash (and back) */
  setRealmReverb(on: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.revOutB.gain.setTargetAtTime(on ? 0.75 : 0, t, on ? 0.15 : 0.5);
    this.revOutA.gain.setTargetAtTime(on ? 0.2 : this.stageOut, t, 0.2);
  }

  /** duck music (and a little SFX) under a voice / announcer line for `hold` seconds */
  duckVoice(music: number, sfx: number, hold: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const [g, v] of [[this.vduck.gain, music], [this.sfxDuck.gain, sfx]] as const) {
      g.cancelScheduledValues(t);
      g.setTargetAtTime(v, t, 0.04);
      g.setTargetAtTime(1, t + hold, 0.25);
    }
  }

  resume(): void {
    this.init();
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
  }

  /** claim a voice slot for `dur` seconds; false if over the cap */
  claim(dur: number, prio = false): boolean {
    const now = this.now;
    let n = 0;
    for (let i = 0; i < this.endN; i++) {
      if (this.ends[i]! > now) { this.ends[n++] = this.ends[i]!; }
    }
    this.endN = n;
    if (n >= (prio ? this.maxVoices + 8 : this.maxVoices) || n >= 64) return false;
    this.ends[this.endN++] = now + dur;
    return true;
  }
  get voices(): number {
    const now = this.now;
    let n = 0;
    for (let i = 0; i < this.endN; i++) if (this.ends[i]! > now) n++;
    return n;
  }

  // ---------------------------------------------------------- primitives
  noise(t: number, dur: number, o: NoiseOpts = {}): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = o.type === 'brown' ? this.noiseB : this.noiseW;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = o.ft ?? 'bandpass';
    f.Q.value = o.q ?? 0.8;
    const f0 = o.f0 ?? 1000;
    f.frequency.setValueAtTime(f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur);
    const g = c.createGain();
    const peak = o.g ?? 0.5, a = o.a ?? 0.003;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    let last: AudioNode = f;
    if (o.ft2) {
      const f2 = c.createBiquadFilter(); f2.type = o.ft2; f2.frequency.value = o.f2 ?? 4000;
      f.connect(f2); last = f2;
    }
    last.connect(g); g.connect(o.dest ?? this.sfxBus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  tone(t: number, dur: number, o: ToneOpts): void {
    const c = this.ctx!;
    const osc = c.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1), t + dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = c.createGain();
    const peak = o.g ?? 0.4, a = o.a ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let n: AudioNode = osc;
    if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); n = f; }
    n.connect(g); g.connect(o.dest ?? this.sfxBus);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  /** two-operator FM ring (metallic) */
  fm(t: number, dur: number, fc: number, ratio: number, index: number, g0: number, dest?: AudioNode): void {
    const c = this.ctx!;
    const car = c.createOscillator(), mod = c.createOscillator();
    car.frequency.value = fc; mod.frequency.value = fc * ratio;
    const mg = c.createGain();
    mg.gain.setValueAtTime(fc * index, t);
    mg.gain.exponentialRampToValueAtTime(1, t + dur);
    mod.connect(mg); mg.connect(car.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(g0, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(g); g.connect(dest ?? this.sfxBus);
    car.start(t); mod.start(t); car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
  }

  click(t: number, g = 0.3, dest?: AudioNode): void {
    this.noise(t, 0.012, { ft: 'highpass', f0: 3000, q: 0.5, g, a: 0.0005, dest });
  }

  duckMusic(amount: number, hold: number, release = 0.5): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setTargetAtTime(amount, t, 0.04);
    this.duck.gain.setTargetAtTime(1, t + hold, release / 3);
  }
}
