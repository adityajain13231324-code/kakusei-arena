/**
 * Per-character render look: toon tints, rim / outline colours, awakened glow, alt palette (mirror matches),
 * spring-bone tuning and weapon info. Colours only — geometry and textures come from the GLB assets.
 */
import type { CharId } from '../../sim/types';
import { getChar } from '../../sim';

export interface Palette { primary: string; secondary: string; accent: string; hair: string; skin: string; aura: string }

export const FALLBACK_PALETTES: Partial<Record<CharId, Palette>> = {
  kaito: { primary: '#22232e', secondary: '#f4f1ea', accent: '#d8262c', hair: '#d62a1c', skin: '#f6cfac', aura: '#ff7a1a' },
  shiori: { primary: '#2b2340', secondary: '#7b3fb0', accent: '#c9c6d8', hair: '#17141f', skin: '#f3d3bd', aura: '#a066ff' },
  ren: { primary: '#f3f1ea', secondary: '#1f2b4d', accent: '#d9b450', hair: '#1a2445', skin: '#f3d6bc', aura: '#9fd8ff' },
  goro: { primary: '#7a5232', secondary: '#c8742e', accent: '#8d8a86', hair: '#2a2018', skin: '#dba27c', aura: '#ffb347' },
};

const NEUTRAL_PALETTE: Palette = { primary: '#5a5d6a', secondary: '#d8dbe4', accent: '#7fd0ff', hair: '#3a3c46', skin: '#d8d4cc', aura: '#9fd8ff' };

/** Palette for any CharId: sim data first (all fields), then the built-in fallback, then neutral. */
export function resolvePalette(id: CharId): Palette {
  const fb = FALLBACK_PALETTES[id] ?? NEUTRAL_PALETTE;
  try {
    const p = getChar(id)?.palette as Partial<Palette> | undefined;
    if (p) {
      const ok = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.trim());
      const out = { ...fb };
      for (const k of Object.keys(fb) as (keyof Palette)[]) if (ok(p[k])) out[k] = p[k] as string;
      return out;
    }
  } catch { /* fallback */ }
  return fb;
}

export interface SpringTune { gravity: number; drag: number; stiffness: number }

export interface CharLook {
  id: CharId;
  shadowTint: string;
  outline: string;
  outlineAwk: string;
  outlineWidth: number;
  rim: string;
  rimAwk: string;
  rimStrength: number;
  rimStrengthAwk: number;
  /** emissive tint multiplied with the awakened atlas glow mask */
  glow: string;
  glowStrength: number;
  /** extra uniform scale while awakened (Goro grows) */
  awakenScale: number;
  /** hue rotation (radians) of the alternate palette used by P2 in mirror matches */
  altHue: number;
  altOutline: string;
  weapon: 'katana' | 'kunai' | null;
  spring: SpringTune;
}

const LOOKS: Partial<Record<CharId, CharLook>> = {
  kaito: {
    id: 'kaito', shadowTint: '#8a6a8e', outline: '#1a0c0c', outlineAwk: '#3a0800', outlineWidth: 1,
    rim: '#ffd9c0', rimAwk: '#ff7a1a', rimStrength: 0.22, rimStrengthAwk: 0.75, glow: '#ff8b28', glowStrength: 0.8,
    awakenScale: 1, altHue: 3.4, altOutline: '#0a1430', weapon: null, spring: { gravity: 6, drag: 0.1, stiffness: 0.16 },
  },
  shiori: {
    id: 'shiori', shadowTint: '#6a5a96', outline: '#0e0a16', outlineAwk: '#f4f0ff', outlineWidth: 1,
    rim: '#d9c8ff', rimAwk: '#ffffff', rimStrength: 0.25, rimStrengthAwk: 0.8, glow: '#b080ff', glowStrength: 1.0,
    awakenScale: 1, altHue: 2.2, altOutline: '#16100a', weapon: 'kunai', spring: { gravity: 9.8, drag: 0.06, stiffness: 0.04 },
  },
  ren: {
    id: 'ren', shadowTint: '#6a7aa6', outline: '#0c1020', outlineAwk: '#0a1a3a', outlineWidth: 1,
    rim: '#d8ecff', rimAwk: '#9fe0ff', rimStrength: 0.22, rimStrengthAwk: 1.0, glow: '#a8eaff', glowStrength: 1.1,
    awakenScale: 1, altHue: 2.8, altOutline: '#200c0c', weapon: 'katana', spring: { gravity: 8, drag: 0.08, stiffness: 0.07 },
  },
  goro: {
    id: 'goro', shadowTint: '#8a6a5a', outline: '#1a1008', outlineAwk: '#2a1000', outlineWidth: 1.15,
    rim: '#ffe0b0', rimAwk: '#ffb347', rimStrength: 0.2, rimStrengthAwk: 0.9, glow: '#ffb347', glowStrength: 1.0,
    awakenScale: 1.08, altHue: 3.6, altOutline: '#081018', weapon: null, spring: { gravity: 8, drag: 0.1, stiffness: 0.12 },
  },
};

const genericLooks = new Map<CharId, CharLook>();
/** Render look for any CharId; fighters without a hand-tuned entry get one derived from their palette. */
export function charLook(id: CharId): CharLook {
  const hit = LOOKS[id] ?? genericLooks.get(id);
  if (hit) return hit;
  const pal = resolvePalette(id);
  const look: CharLook = {
    id, shadowTint: '#7a7090', outline: '#14121a', outlineAwk: '#14121a', outlineWidth: 1,
    rim: pal.accent, rimAwk: pal.aura, rimStrength: 0.35, rimStrengthAwk: 0.9, glow: pal.aura, glowStrength: 0.9,
    awakenScale: 1, altHue: 2.8, altOutline: '#0a1430', weapon: null, spring: { gravity: 8, drag: 0.09, stiffness: 0.1 },
  };
  genericLooks.set(id, look);
  return look;
}
