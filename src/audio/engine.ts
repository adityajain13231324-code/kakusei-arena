// Low-level WebAudio engine: context, buses, voice cap, synth primitives. No audio files.
export interface NoiseOpts { type?: 'white' | 'brown'; ft?: BiquadFilterType; f0?: number; f1?: number; q?: number; g?: number; a?: number; dest?: AudioNode; ft2?: BiquadFilterType; f2?: number }
export interface ToneOpts { type?: OscillatorType; f0: number; f1?: number; g?: number; a?: number; dest?: AudioNode; detune?: number; lp?: number }

export class Engine {
  ctx: AudioContext | null = null;
  master!: GainNode; comp!: DynamicsCompressorNode; sfxBus!: GainNode; sfxWet!: GainNode; musicBus!: GainNode;
  duck!: GainNode; musicLP!: BiquadFilterNode; revIn!: GainNode; analyser!: AnalyserNode; sfxPause!: GainNode;
  noiseW!: AudioBuffer; noiseB!: AudioBuffer;
  vols = { master: 0.8, music: 0.5, sfx: 0.9 };
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
    this.sfxBus.connect(this.sfxPause); this.sfxPause.connect(this.comp);
    this.sfxWet.connect(this.sfxBus); this.sfxWet.connect(this.revIn);
    const conv = c.createConvolver();
    conv.buffer = this.makeImpulse(2.4);
    const revOut = c.createGain(); revOut.gain.value = 0.55;
    this.revIn.connect(conv); conv.connect(revOut); revOut.connect(this.sfxPause);
    this.musicBus.connect(this.duck); this.duck.connect(this.musicLP); this.musicLP.connect(this.comp);
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
