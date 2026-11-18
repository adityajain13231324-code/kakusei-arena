/** Difficulty tuning + per-character personality. Pure data. */
import type { CharId } from '../sim/types';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'nightmare';

export interface Profile {
  /** frames before the CPU notices an attack starting (+ up to `jitter`) */
  react: number;
  jitter: number;
  /** chance to hold a standing guard while the opponent is inside poke range */
  stance: number;
  /** chance a perceived threat is actually answered */
  answer: number;
  /** chance to punish a recoverable move (rolled once per opponent move) and extra lag (frames) */
  punish: number;
  punishLag: number;
  /** chance to continue a launcher into a juggle / ultimate; juggle hit cap */
  combo: number;
  juggleCap: number;
  /** chance to hit-confirm into strings / special cancels */
  confirm: number;
  /** chance per decision to start an attack when in range, and decision interval (frames) */
  aggression: number;
  interval: number;
  /** random bad decision rate */
  mistake: number;
  /** throw break chance (0..1) and anti-air / sidestep / vanish / ult usage */
  tech: number;
  antiAir: number;
  sidestep: number;
  vanish: number;
  ult: number;
  /** frames between button presses while mashing a beam clash */
  mash: number;
  /** how strongly the CPU avoids unsafe moves (0..1) */
  safety: number;
  /** softmax-ish randomness when choosing a move (higher = more random) */
  noise: number;
}

export const PROFILES: Record<Difficulty, Profile> = {
  easy: {
    react: 30, jitter: 12, stance: 0.12, answer: 0.35, punish: 0.1, punishLag: 14, combo: 0.15, juggleCap: 2, confirm: 0.25,
    aggression: 0.38, interval: 20, mistake: 0.3, tech: 0.1, antiAir: 0.1, sidestep: 0.0, vanish: 0.0, ult: 0.2, mash: 11, safety: 0, noise: 3,
  },
  normal: {
    react: 18, jitter: 6, stance: 0.35, answer: 0.7, punish: 0.45, punishLag: 5, combo: 0.55, juggleCap: 3, confirm: 0.6,
    aggression: 0.4, interval: 16, mistake: 0.15, tech: 0.4, antiAir: 0.4, sidestep: 0.1, vanish: 0.1, ult: 0.7, mash: 6, safety: 0.4, noise: 1.5,
  },
  hard: {
    react: 12, jitter: 4, stance: 0.5, answer: 0.88, punish: 0.8, punishLag: 2, combo: 0.9, juggleCap: 5, confirm: 0.9,
    aggression: 0.55, interval: 11, mistake: 0.06, tech: 0.75, antiAir: 0.75, sidestep: 0.25, vanish: 0.3, ult: 0.95, mash: 3, safety: 0.75, noise: 0.8,
  },
  nightmare: {
    react: 8, jitter: 2, stance: 0.6, answer: 0.97, punish: 1.0, punishLag: 0, combo: 1.0, juggleCap: 8, confirm: 1.0,
    aggression: 0.65, interval: 8, mistake: 0.01, tech: 0.95, antiAir: 0.95, sidestep: 0.45, vanish: 0.5, ult: 1.0, mash: 2, safety: 1.0, noise: 0.4,
  },
};

export interface Personality {
  /** preferred centre distance as a fraction of the character's longest ground reach */
  spacing: number;
  /** aggression multiplier */
  rush: number;
  /** per-move-id substring score bonuses */
  likes: Record<string, number>;
  /** chance to use projectiles / teleports / stance etc. at the right range */
  zoning: number;
  trick: number;
}

export const PERSONALITY: Record<CharId, Personality> = {
  kaito: { spacing: 0.85, rush: 1.15, zoning: 0.25, trick: 0, likes: { jab: 0.4, elbow: 0.5, straight: 0.4, blaze: 0.8 } },
  shiori: { spacing: 0.65, rush: 1.25, zoning: 0.15, trick: 0.35, likes: { jab: 0.5, lowjab: 0.7, knee: 0.5, kunai: 0.2 } },
  ren: { spacing: 1.0, rush: 0.8, zoning: 0.35, trick: 0.4, likes: { slash: 0.6, thrust: 0.6, crescent: 0.4, lowcut: 0.3 } },
  goro: { spacing: 0.6, rush: 0.95, zoning: 0.2, trick: 0.3, likes: { palm: 0.5, shoulder: 0.8, hug: 0.9, hammer: 0.3 } },
};
