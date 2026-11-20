// Sample bank (Sound v2): lazy fetch + decode of the bundled MP3 library (public/sfx, public/voice, index in
// public/audio-manifest.json). Pure playback helper: never touches game state. Every failure (missing manifest,
// 404, decode error, context not ready) degrades to "play nothing" so the synth layer underneath stays the only sound.
import type { Engine } from './engine';

export interface SoundDef { files: string[]; category: string; gain: number; fighter?: string; line_type?: string; text?: string }
export interface Manifest { sounds: Record<string, SoundDef> }

export function baseUrl(): string {
  const env = (import.meta as unknown as { env?: { DEV?: boolean; BASE_URL?: string } }).env;
  if (env?.DEV) return '/';
  return env?.BASE_URL ?? './';
}

/** fetch + decode; resolves null for anything that is not a decodable audio file (404, SPA html fallback, bad data) */
export async function fetchBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') ?? '';
    if (ct.includes('text/html') || ct.includes('json')) return null;
    const ab = await r.arrayBuffer();
    return await ctx.decodeAudioData(ab);
  } catch { return null; }
}

/** max simultaneous voices per category (excess requests are dropped) */
const CAP: Record<string, number> = {
  impact: 4, block: 3, whoosh: 4, foot: 3, fall: 2, cloth: 3, crowd: 2, ui: 3, fx: 2, fighter: 2, announcer: 2,
};

export interface PlayOpts {
  /** seconds from now */
  delay?: number;
  /** extra gain multiplier */
  gain?: number;
  /** random gain spread (+-), default 0.1 */
  gj?: number;
  /** random pitch spread in cents (+-), default 60 */
  pj?: number;
  /** playback rate multiplier */
  rate?: number;
  /** override destination */
  dest?: AudioNode;
}

export class SampleBank {
  defs: Record<string, SoundDef> | null = null;
  private manifestP: Promise<void> | null = null;
  private bufs = new Map<string, AudioBuffer | null>();
  private pending = new Map<string, Promise<AudioBuffer | null>>();
  /** owner-supplied replacements (public/voice/ann_<line>.*) keyed by sound id */
  private over = new Map<string, AudioBuffer>();
  private overTried = new Set<string>();
  private last = new Map<string, number>();
  private ends = new Map<string, Float64Array>();
  private ring: Array<AudioBufferSourceNode | null> = new Array(32).fill(null);
  private ringI = 0;
  private okTmp: number[] = [];
  private seed = (Math.random() * 0xffffffff) >>> 0 || 1;
  /** how many decodes finished / failed (debug) */
  loaded = 0; failed = 0;

  constructor(private e: Engine) {}

  /** render-side xorshift32 in [0,1) */
  rnd(): number {
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  loadManifest(): Promise<void> {
    if (!this.manifestP) {
      this.manifestP = (async () => {
        try {
          const r = await fetch(baseUrl() + 'audio-manifest.json');
          if (!r.ok) return;
          const j = (await r.json()) as Manifest;
          if (j && j.sounds) this.defs = j.sounds;
        } catch { /* no manifest: samples stay off */ }
      })();
    }
    return this.manifestP;
  }

  private loadFile(file: string): Promise<AudioBuffer | null> {
    const ctx = this.e.ctx;
    if (this.bufs.has(file)) return Promise.resolve(this.bufs.get(file) ?? null);
    const p = this.pending.get(file);
    if (p) return p;
    if (!ctx) return Promise.resolve(null);
    const q = fetchBuffer(ctx, baseUrl() + file).then((b) => {
      this.bufs.set(file, b); this.pending.delete(file);
      if (b) this.loaded++; else this.failed++;
      return b;
    });
    this.pending.set(file, q);
    return q;
  }

  /** announcer ids look for public/voice/ann_<line>.(mp3|wav) first */
  private loadOverride(id: string): Promise<void> {
    if (!id.startsWith('announcer_') || this.overTried.has(id)) return Promise.resolve();
    this.overTried.add(id);
    const ctx = this.e.ctx;
    if (!ctx) return Promise.resolve();
    const line = 'ann_' + id.slice(10);
    return (async () => {
      for (const ext of ['mp3', 'wav']) {
        const b = await fetchBuffer(ctx, `${baseUrl()}voice/${line}.${ext}`);
        if (b) { this.over.set(id, b); return; }
      }
    })();
  }

  /** decode every file of these ids (fire-and-forget safe; resolves when all settled) */
  async preload(ids: Iterable<string>): Promise<void> {
    await this.loadManifest();
    if (!this.defs || !this.e.ctx) return;
    const jobs: Array<Promise<unknown>> = [];
    for (const id of ids) {
      const d = this.defs[id];
      if (!d) continue;
      jobs.push(this.loadOverride(id));
      for (const f of d.files) jobs.push(this.loadFile(f));
    }
    await Promise.all(jobs);
  }

  ids(filter: (id: string, d: SoundDef) => boolean): string[] {
    const out: string[] = [];
    if (this.defs) for (const k in this.defs) if (filter(k, this.defs[k]!)) out.push(k);
    return out;
  }

  has(id: string): boolean { return !!this.defs?.[id]; }

  /** buffer length of the first decoded variant (0 when not loaded) */
  duration(id: string): number {
    const o = this.over.get(id);
    if (o) return o.duration;
    const d = this.defs?.[id];
    const b = d ? this.bufs.get(d.files[0]!) : null;
    return b ? b.duration : 0;
  }

  private cap(cat: string, at: number, dur: number): boolean {
    let a = this.ends.get(cat);
    if (!a) { a = new Float64Array(8); this.ends.set(cat, a); }
    const max = Math.min(8, CAP[cat] ?? 3);
    const now = this.e.now;
    let n = 0, free = -1;
    for (let i = 0; i < a.length; i++) {
      if (a[i]! > now) n++; else if (free < 0) free = i;
    }
    if (n >= max || free < 0) return false;
    a[free] = at + dur;
    return true;
  }

  /**
   * Play one variant of sound `id` (never the same variant twice in a row), with small pitch / gain jitter.
   * `cat` selects the voice-limit bucket. Returns the played duration in seconds, 0 if nothing was played.
   */
  play(id: string, cat: string, o: PlayOpts = {}): number {
    const e = this.e, ctx = e.ctx;
    if (!ctx || !e.ready || !this.defs) return 0;
    const d = this.defs[id];
    if (!d) return 0;
    let buf: AudioBuffer | null | undefined = this.over.get(id);
    if (!buf) {
      // choose among decoded variants; start decoding the rest lazily
      let n = 0;
      const ok = this.okTmp;
      for (let i = 0; i < d.files.length; i++) {
        const b = this.bufs.get(d.files[i]!);
        if (b) ok[n++] = i;
        else if (b === undefined) void this.loadFile(d.files[i]!);
      }
      if (!n) return 0;
      let k = Math.floor(this.rnd() * n);
      const last = this.last.get(id);
      if (n > 1 && ok[k] === last) k = (k + 1) % n;
      const pick = ok[k]!;
      this.last.set(id, pick);
      buf = this.bufs.get(d.files[pick]!)!;
    }
    const rate = (o.rate ?? 1) * Math.pow(2, ((this.rnd() * 2 - 1) * (o.pj ?? 60)) / 1200);
    const dur = buf.duration / rate;
    const delay = o.delay ?? 0;
    if (!this.cap(cat, e.now + delay, dur)) return 0;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = d.gain * (o.gain ?? 1) * (1 + (this.rnd() * 2 - 1) * (o.gj ?? 0.1));
    src.connect(g);
    g.connect(o.dest ?? this.dest(id, d));
    src.start(e.now + 0.003 + delay);
    this.ring[this.ringI] = src;
    this.ringI = (this.ringI + 1) % this.ring.length;
    return dur;
  }

  private dest(id: string, d: SoundDef): AudioNode {
    const e = this.e;
    if (id.startsWith('announcer_')) return e.annBus;
    if (d.category === 'voice') return e.voiceBus;
    if (d.category === 'ui') return e.uiBus;
    return e.smpBus;
  }

  /** stop everything that is still playing (pause / tab hidden) */
  stopAll(): void {
    for (let i = 0; i < this.ring.length; i++) {
      const s = this.ring[i];
      if (s) { try { s.stop(); } catch { /* already ended */ } this.ring[i] = null; }
    }
    for (const a of this.ends.values()) a.fill(0);
  }
}
