import type { ControlScheme } from '../sim/types';
import type { Quality } from '../render';
import { DEFAULT_P1, DEFAULT_P2, cloneBindings, sanitizeBindings } from '../input/bindings';
import type { Bindings } from '../input/bindings';

export type QualitySetting = 'auto' | Quality;
export type TouchSetting = 'auto' | 'on' | 'off';

export interface SettingsData {
  master: number; music: number; sfx: number; // 0..1
  quality: QualitySetting;
  reduceFlashing: boolean;
  announcer: boolean;
  touch: TouchSetting;
  scheme: [ControlScheme, ControlScheme];
  keys: { p1: Bindings; p2: Bindings };
}

const KEY = 'kakusei-arena.settings.v1';

export function defaultSettings(): SettingsData {
  return {
    master: 0.8, music: 0.7, sfx: 0.9,
    quality: 'auto', reduceFlashing: false, announcer: true, touch: 'auto',
    scheme: ['pro', 'pro'],
    keys: { p1: cloneBindings(DEFAULT_P1), p2: cloneBindings(DEFAULT_P2) },
  };
}

export function detectPhone(): boolean {
  try {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    return coarse && Math.min(screen.width, screen.height) < 700;
  } catch { return false; }
}

export class SettingsStore {
  data: SettingsData = defaultSettings();
  private listeners = new Set<() => void>();

  constructor() { this.load(); }

  load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const j = JSON.parse(raw) as Partial<SettingsData>;
      const d = this.data;
      const num = (v: unknown, f: number) => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : f);
      d.master = num(j.master, d.master); d.music = num(j.music, d.music); d.sfx = num(j.sfx, d.sfx);
      if (j.quality === 'auto' || j.quality === 'low' || j.quality === 'medium' || j.quality === 'high') d.quality = j.quality;
      if (typeof j.reduceFlashing === 'boolean') d.reduceFlashing = j.reduceFlashing;
      if (typeof j.announcer === 'boolean') d.announcer = j.announcer;
      if (j.touch === 'auto' || j.touch === 'on' || j.touch === 'off') d.touch = j.touch;
      if (Array.isArray(j.scheme) && j.scheme.length === 2) {
        d.scheme = [j.scheme[0] === 'easy' ? 'easy' : 'pro', j.scheme[1] === 'easy' ? 'easy' : 'pro'];
      }
      d.keys = { p1: sanitizeBindings(j.keys?.p1, DEFAULT_P1), p2: sanitizeBindings(j.keys?.p2, DEFAULT_P2) };
    } catch { /* corrupt or unavailable storage: keep defaults */ }
  }

  save(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
    for (const l of [...this.listeners]) l();
  }

  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }

  resolveQuality(): Quality {
    if (this.data.quality !== 'auto') return this.data.quality;
    return detectPhone() ? 'low' : 'medium';
  }
}
