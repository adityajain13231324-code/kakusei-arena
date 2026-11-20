// Graphics settings model: presets, validation and the auto-benchmark decision logic.
// Pure data + small state machine (no three.js, no DOM) so the settings screen, app shell and renderer can share it.

export type GfxPreset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type BaseQuality = 'low' | 'medium' | 'high';
export type ShadowQ = 'off' | 'low' | 'high';
export type Level3 = 'low' | 'medium' | 'high';
export type CrowdQ = 'off' | 'low' | 'high';
export type FpsCap = 0 | 30 | 60 | 120;

export interface GfxSettings {
  preset: GfxPreset;
  /** coarse bucket used for things without their own toggle (stage geometry detail); follows the last chosen preset */
  base: BaseQuality;
  /** render resolution multiplier 0.5..1.5 */
  renderScale: number;
  /** 0 = unlimited */
  fpsCap: FpsCap;
  shadows: ShadowQ;
  outlines: boolean;
  bloom: boolean;
  impactFrames: boolean;
  speedLines: boolean;
  colorGrade: boolean;
  particles: Level3;
  crowd: CrowdQ;
  realmSky: 'low' | 'high';
  texRes: 1024 | 2048;
  /** MSAA; the WebGL context is created once, so this applies on next launch */
  aa: boolean;
  showFps: boolean;
  /** auto-benchmark already ran (or the user picked a preset manually) */
  benchDone: boolean;
  /** last benchmark result, for display */
  benchMs: number;
}

/** the toggles a preset controls (everything except the meta fields) */
export type GfxTunables = Omit<GfxSettings, 'preset' | 'base' | 'showFps' | 'benchDone' | 'benchMs' | 'fpsCap'>;

export const PRESET_ORDER: GfxPreset[] = ['low', 'medium', 'high', 'ultra', 'custom'];

const PRESETS: Record<Exclude<GfxPreset, 'custom'>, GfxTunables & { fpsCap: FpsCap; base: BaseQuality }> = {
  low: {
    base: 'low', renderScale: 0.65, fpsCap: 60, shadows: 'off', outlines: true, bloom: false, impactFrames: false, speedLines: true, colorGrade: false,
    particles: 'low', crowd: 'low', realmSky: 'low', texRes: 1024, aa: false,
  },
  medium: {
    base: 'medium', renderScale: 1, fpsCap: 60, shadows: 'low', outlines: true, bloom: false, impactFrames: true, speedLines: true, colorGrade: true,
    particles: 'medium', crowd: 'low', realmSky: 'low', texRes: 2048, aa: false,
  },
  high: {
    base: 'high', renderScale: 1, fpsCap: 60, shadows: 'high', outlines: true, bloom: true, impactFrames: true, speedLines: true, colorGrade: true,
    particles: 'high', crowd: 'high', realmSky: 'high', texRes: 2048, aa: true,
  },
  ultra: {
    base: 'high', renderScale: 1.25, fpsCap: 120, shadows: 'high', outlines: true, bloom: true, impactFrames: true, speedLines: true, colorGrade: true,
    particles: 'high', crowd: 'high', realmSky: 'high', texRes: 2048, aa: true,
  },
};

export function presetValues(p: Exclude<GfxPreset, 'custom'>): GfxTunables & { fpsCap: FpsCap; base: BaseQuality } { return { ...PRESETS[p] }; }

export function defaultGfx(): GfxSettings {
  return { ...presetValues('medium'), preset: 'medium', showFps: false, benchDone: false, benchMs: 0 };
}

/** apply a named preset in place (custom just flips the label) */
export function applyPreset(g: GfxSettings, p: GfxPreset): void {
  g.preset = p;
  if (p !== 'custom') Object.assign(g, presetValues(p));
}

const KEYS_TUNABLE: (keyof GfxTunables | 'fpsCap')[] = ['renderScale', 'fpsCap', 'shadows', 'outlines', 'bloom', 'impactFrames', 'speedLines', 'colorGrade', 'particles', 'crowd', 'realmSky', 'texRes', 'aa'];

/** after a manual tweak: label the result as the matching preset, or Custom */
export function relabel(g: GfxSettings): void {
  for (const p of ['low', 'medium', 'high', 'ultra'] as const) {
    const v = PRESETS[p] as unknown as Record<string, unknown>;
    if (KEYS_TUNABLE.every((k) => (g as unknown as Record<string, unknown>)[k] === v[k])) { g.preset = p; return; }
  }
  g.preset = 'custom';
}

const oneOf = <T,>(v: unknown, list: readonly T[], f: T): T => (list.includes(v as T) ? (v as T) : f);

/** merge untrusted JSON into a fresh GfxSettings */
export function sanitizeGfx(j: unknown, into: GfxSettings): void {
  if (!j || typeof j !== 'object') return;
  const o = j as Record<string, unknown>;
  into.preset = oneOf(o.preset, PRESET_ORDER, into.preset);
  into.base = oneOf(o.base, ['low', 'medium', 'high'] as const, into.base);
  if (typeof o.renderScale === 'number' && isFinite(o.renderScale)) into.renderScale = Math.round(Math.min(1.5, Math.max(0.5, o.renderScale)) * 20) / 20;
  into.fpsCap = oneOf(o.fpsCap, [0, 30, 60, 120] as const, into.fpsCap);
  into.shadows = oneOf(o.shadows, ['off', 'low', 'high'] as const, into.shadows);
  into.particles = oneOf(o.particles, ['low', 'medium', 'high'] as const, into.particles);
  into.crowd = oneOf(o.crowd, ['off', 'low', 'high'] as const, into.crowd);
  into.realmSky = oneOf(o.realmSky, ['low', 'high'] as const, into.realmSky);
  into.texRes = oneOf(o.texRes, [1024, 2048] as const, into.texRes);
  for (const k of ['outlines', 'bloom', 'impactFrames', 'speedLines', 'colorGrade', 'aa', 'showFps', 'benchDone'] as const) {
    if (typeof o[k] === 'boolean') into[k] = o[k] as boolean;
  }
  if (typeof o.benchMs === 'number' && isFinite(o.benchMs)) into.benchMs = o.benchMs;
}

// ------------------------------------------------------------------ auto benchmark
/**
 * Picks a preset from measured frame times while the title/menu scene runs.
 * Probes from the top: each stage applies a preset for STAGE_S seconds (after a short warm-up) and checks the
 * 90th-percentile frame time. Stages: high -> (ok) ultra | (bad) medium -> (bad) low. Phones never go above medium.
 */
export class GfxBenchmark {
  static readonly WARM_S = 0.5;
  static readonly STAGE_S = 1.1;
  /** frame time budget in ms: p90 must stay under this for a stage to pass (vsync at 60 Hz = 16.7) */
  static readonly BUDGET_MS = 19.5;

  private order: Exclude<GfxPreset, 'custom'>[];
  private t = 0;
  private samples: number[] = [];
  done = false;
  result: Exclude<GfxPreset, 'custom'> = 'medium';
  resultMs = 0;
  /** preset to apply right now (while running) */
  current: Exclude<GfxPreset, 'custom'>;

  constructor(private phone: boolean) {
    this.order = phone ? ['medium', 'low'] : ['high', 'ultra', 'medium', 'low'];
    this.current = this.order[0];
  }

  /** feed one frame; returns the preset to switch to when a stage changes, otherwise null */
  step(dt: number): Exclude<GfxPreset, 'custom'> | null {
    if (this.done) return null;
    this.t += dt;
    if (this.t > GfxBenchmark.WARM_S) this.samples.push(dt * 1000);
    if (this.t < GfxBenchmark.WARM_S + GfxBenchmark.STAGE_S) return null;
    const s = this.samples.slice().sort((a, b) => a - b);
    const p90 = s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] : 1000;
    const pass = p90 <= GfxBenchmark.BUDGET_MS;
    this.samples = []; this.t = 0;
    const cur = this.current;
    // walk: high(pass)->ultra ; high(fail)->medium ; ultra(pass)=ultra ; ultra(fail)=high ; medium(pass)=medium ; medium(fail)->low
    let next: Exclude<GfxPreset, 'custom'> | null = null;
    if (cur === 'high') next = pass ? 'ultra' : 'medium';
    else if (cur === 'ultra') this.finish(pass ? 'ultra' : 'high', p90);
    else if (cur === 'medium') { if (pass) this.finish('medium', p90); else if (this.order.includes('low')) next = 'low'; else this.finish('low', p90); }
    else this.finish('low', p90);
    if (next) { this.current = next; return next; }
    return this.done ? this.result : null;
  }

  private finish(p: Exclude<GfxPreset, 'custom'>, ms: number): void {
    this.done = true; this.result = this.phone && (p === 'high' || p === 'ultra') ? 'medium' : p; this.resultMs = ms;
  }

  /** abort (tab hidden / user left the menu): measurements are unreliable */
  restart(): void { this.t = 0; this.samples = []; }
}
