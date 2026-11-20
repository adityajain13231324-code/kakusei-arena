import type { ControlScheme } from '../sim/types';
import type { Quality } from '../render';
import { DEFAULT_P1, DEFAULT_P2, cloneBindings, sanitizeBindings } from '../input/bindings';
import type { Bindings } from '../input/bindings';
import { defaultGfx, presetValues, sanitizeGfx } from './gfx';
import type { GfxSettings } from './gfx';

export type BroadcastMode = 'off' | 'ticker' | 'full';
export type TouchSetting = 'auto' | 'on' | 'off';
/** camera shake + hit punches (render only) */
export type CameraShake = 'off' | 'low' | 'full';

export interface SettingsData {
  master: number; music: number; sfx: number; // 0..1
  /** Sound v2 mixer: fighter voices and announcer volume (0..1); old saves get the defaults */
  voice: number; announcerVol: number;
  /** graphics preset + toggles (src/app/gfx.ts) */
  gfx: GfxSettings;
  reduceFlashing: boolean;
  /** camera shake / punch strength (P8 Feel); old saves get 'full' */
  cameraShake: CameraShake;
  announcer: boolean;
  /** broadcast flavor layer: off / one-line news ticker / ticker + live commentator panel */
  broadcastMode: BroadcastMode;
  /** HUD scale 0.7..1.2 (CSS variable --hud-scale) */
  hudScale: number;
  touch: TouchSetting;
  scheme: [ControlScheme, ControlScheme];
  keys: { p1: Bindings; p2: Bindings };
}

const KEY = 'kakusei-arena.settings.v1';

export function defaultSettings(): SettingsData {
  return {
    master: 0.8, music: 0.7, sfx: 0.9, voice: 0.9, announcerVol: 0.9,
    gfx: defaultGfx(), reduceFlashing: false, cameraShake: 'full', announcer: true, broadcastMode: 'off', hudScale: 1, touch: 'auto',
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
      d.voice = num(j.voice, d.voice); d.announcerVol = num(j.announcerVol, d.announcerVol);
      if (j.gfx) sanitizeGfx(j.gfx, d.gfx);
      else {
        // pre-P8 saves: a fixed quality choice becomes the matching preset (and skips the first-launch benchmark)
        const lq = (j as { quality?: unknown }).quality;
        if (lq === 'low' || lq === 'medium' || lq === 'high') { Object.assign(d.gfx, presetValues(lq), { preset: lq, benchDone: true }); }
      }
      if (typeof j.reduceFlashing === 'boolean') d.reduceFlashing = j.reduceFlashing;
      if (typeof j.announcer === 'boolean') d.announcer = j.announcer;
      if (j.cameraShake === 'off' || j.cameraShake === 'low' || j.cameraShake === 'full') d.cameraShake = j.cameraShake;
      // the news ticker / commentator layer was removed (owner request, P8): saved modes are ignored, it stays off
      if (typeof j.hudScale === 'number' && isFinite(j.hudScale)) d.hudScale = Math.round(Math.min(1.2, Math.max(0.7, j.hudScale)) * 20) / 20;
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

  /** coarse bucket for stage/model detail not covered by an individual toggle */
  resolveQuality(): Quality { return this.data.gfx.base; }
}
