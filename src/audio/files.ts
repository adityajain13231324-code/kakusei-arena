// Owner-supplied music files (public/music/<name>.(mp3|ogg|wav) + optional public/music/music.json loop points).
// They override the procedural tracks whenever they exist; a missing file is a silent, cached miss.
import type { Engine } from './engine';
import { baseUrl, fetchBuffer } from './samples';

const EXTS = ['mp3', 'ogg', 'wav'];

export class MusicFiles {
  private bufs = new Map<string, AudioBuffer | null>();
  private pending = new Map<string, Promise<AudioBuffer | null>>();
  private cfg: Record<string, unknown> | null = null;
  private cfgP: Promise<void> | null = null;

  constructor(private e: Engine) {}

  /** undefined = not tried yet, null = no such file */
  peek(name: string): AudioBuffer | null | undefined { return this.bufs.get(name); }

  private loadCfg(): Promise<void> {
    if (!this.cfgP) {
      this.cfgP = (async () => {
        try {
          const r = await fetch(baseUrl() + 'music/music.json');
          if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) return;
          const j = (await r.json()) as unknown;
          if (j && typeof j === 'object') this.cfg = j as Record<string, unknown>;
        } catch { /* no config: loop whole files */ }
      })();
    }
    return this.cfgP;
  }

  /** loop end in seconds ({"music_menu": {"loopEnd": 93.2}} or {"music_menu": 93.2}); 0 = whole file */
  loopEnd(name: string): number {
    const v = this.cfg?.[name];
    const n = typeof v === 'number' ? v : v && typeof v === 'object' ? (v as { loopEnd?: unknown }).loopEnd : 0;
    return typeof n === 'number' && isFinite(n) && n > 0 ? n : 0;
  }

  request(name: string): Promise<AudioBuffer | null> {
    if (this.bufs.has(name)) return Promise.resolve(this.bufs.get(name) ?? null);
    const p = this.pending.get(name);
    if (p) return p;
    const ctx = this.e.ctx;
    if (!ctx) return Promise.resolve(null);
    const q = (async () => {
      await this.loadCfg();
      let b: AudioBuffer | null = null;
      for (const ext of EXTS) {
        b = await fetchBuffer(ctx, `${baseUrl()}music/${name}.${ext}`);
        if (b) break;
      }
      this.bufs.set(name, b); this.pending.delete(name);
      return b;
    })();
    this.pending.set(name, q);
    return q;
  }
}
