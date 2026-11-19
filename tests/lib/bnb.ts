/**
 * Bread-and-butter combos per fighter (documented in docs/BALANCE.md, verified by npm test).
 * Steps are [action, delay]: the action's input starts `delay` frames after the previous hit
 * lands (-1 = earliest frame that works; strings / cancels use 0 = buffered right away).
 * Action names = numpad notation (see tests/lib/finder.ts ACTIONS). dash~X = 66 then X.
 */
import { createMatch, step, type CharId, type GameState } from '../../src/sim/index';

export interface Bnb { name: string; notation: string; steps: Array<[string, number]>; ki?: number; wall?: boolean }

export const BNB: Record<CharId, Bnb[]> = {
  kaito: [
    { name: 'Jab string confirm', notation: 'L, L, H xx 41236S', steps: [['L', 0], ['L', 0], ['H', 0], ['41236S', 0]] },
    { name: 'Launcher (bounce)', notation: '3H, 214S (bounce), H xx 41236S', steps: [['3H', 0], ['214S', -1], ['H', -1], ['41236S', 0]] },
    { name: 'Launcher (simple)', notation: '3H, H, H,H', steps: [['3H', 0], ['H', -1], ['H', 0]] },
    { name: 'Ultimate ender', notation: '3H, 214S, H, 236H+S', steps: [['3H', 0], ['214S', -1], ['H', -1], ['236H+S', 0]], ki: 300 },
    { name: 'Wall splat', notation: '3H, H xx 41236S (splat), 66 H, H,H', steps: [['3H', 0], ['H', -1], ['41236S', 0], ['dash~H', -1], ['H', 0]], wall: true },
  ],
  shiori: [
    { name: 'Jab string confirm', notation: 'L, L, H xx 623S', steps: [['L', 0], ['L', 0], ['H', 0], ['623S', 0]] },
    { name: 'Launcher', notation: '3H, H, H,H xx 623S', steps: [['3H', 0], ['H', -1], ['H', 0], ['623S', 0]] },
    { name: 'Low stagger', notation: '41236S (stagger), H xx 623S, 2K (ground hit)', steps: [['41236S', 0], ['H', -1], ['623S', 0], ['2K', -1]] },
    { name: 'Ultimate ender', notation: '3H, K, H, 236H+S', steps: [['3H', 0], ['K', -1], ['H', -1], ['236H+S', -1]], ki: 300 },
    { name: 'Wall splat', notation: '3H, H, H,H (splat), 66 K, H', steps: [['3H', 0], ['H', -1], ['H', 0], ['dash~K', -1], ['H', -1]], wall: true },
  ],
  ren: [
    { name: 'Jab string confirm', notation: 'L, L, H xx 623S', steps: [['L', 0], ['L', 0], ['H', 0], ['623S', 0]] },
    { name: 'Launcher', notation: '3H, H, H,H xx 623S', steps: [['3H', 0], ['H', -1], ['H', 0], ['623S', 0]] },
    { name: 'Launcher (long)', notation: '3H, L, H, H,H xx 214S', steps: [['3H', 0], ['L', -1], ['H', -1], ['H', 0], ['214S', 0]] },
    { name: 'Ultimate ender', notation: '3H, H, 236H+S', steps: [['3H', 0], ['H', -1], ['236H+S', -1]], ki: 300 },
    { name: 'Wall splat', notation: '3H, H, H,H (splat), 66 H, H,H', steps: [['3H', 0], ['H', -1], ['H', 0], ['dash~H', -1], ['H', 0]], wall: true },
  ],
  goro: [
    { name: 'Poke confirm + ground hit', notation: 'H xx 214S, 4K (ground stomp)', steps: [['H', 0], ['214S', 0], ['4K', -1]] },
    { name: 'Launcher', notation: '3H, L, H xx 41236S', steps: [['3H', 0], ['L', -1], ['H', -1], ['41236S', 0]] },
    { name: 'Launcher (long)', notation: '3H, L, H, H,H', steps: [['3H', 0], ['L', -1], ['H', -1], ['H', 0]] },
    { name: 'Ultimate ender', notation: '3H, L, H, 236H+S', steps: [['3H', 0], ['L', -1], ['H', -1], ['236H+S', -1]], ki: 300 },
    { name: 'Wall splat', notation: 'H, H (wallbounce splat), 66 H, 4K (ground stomp)', steps: [['H', 0], ['H', 0], ['dash~H', -1], ['4K', -1]], wall: true },
  ],
};

/** training setup for a BnB: P1 at 800 mm from P2 (wall combos: P2 ~0.7 m from the wall) */
export function bnbSetup(c: CharId, vs: CharId, b: Bnb): GameState {
  const st = createMatch({ p1: c, p2: vs, stage: 'training', seed: 1, training: true, trainingOpts: { hpRegen: false } });
  step(st, [0, 0]);
  let x0 = 0;
  if (b.wall) { st.arenaHalfSize = 2600; x0 = 800; }
  st.fighters[0].pos = { x: x0, y: 0, z: 0 }; st.fighters[1].pos = { x: x0 + 800, y: 0, z: 0 };
  st.fighters[0].ki = b.ki ?? 0;
  step(st, [0, 0]);
  return st;
}
