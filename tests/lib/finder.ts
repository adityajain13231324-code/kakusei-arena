/** Brute-force combo finder (dev tool): greedy DFS over simple actions from a juggle/hit state. */
import { step, cloneState, Btn, type GameState } from '../../src/sim/index';

export interface Action { name: string; seq: number[] } // facing-relative frames (Right = forward)
const F = Btn.Right, Bk = Btn.Left, D = Btn.Down;
export const ACTIONS: Action[] = [
  { name: 'L', seq: [Btn.L] }, { name: 'H', seq: [Btn.H] }, { name: 'K', seq: [Btn.K] },
  { name: '6H', seq: [F | Btn.H] }, { name: '3H', seq: [D | F | Btn.H] }, { name: '4K', seq: [Bk | Btn.K] },
  { name: '2K', seq: [D | Btn.K] }, { name: '2L', seq: [D | Btn.L] },
  { name: '236S', seq: [D, D | F, F | Btn.S] }, { name: '623S', seq: [F, D, D | F | Btn.S] },
  { name: '214S', seq: [D, D | Bk, Bk | Btn.S] }, { name: '41236S', seq: [Bk, D | Bk, D, D | F, F | Btn.S] },
  // dash (double-tap forward) into a normal, for wall-splat follow-ups
  { name: 'dash~H', seq: [F, 0, F, F, F, F, F, F, F, Btn.H] }, { name: 'dash~L', seq: [F, 0, F, F, F, F, F, F, F, Btn.L] },
  { name: 'dash~K', seq: [F, 0, F, F, F, F, F, F, F, Btn.K] },
  { name: '236H+S', seq: [D, D | F, F | Btn.H | Btn.S] }, { name: '236S+K', seq: [D, D | F, F | Btn.S | Btn.K] },
];

function raw(rel: number, side: number): number {
  let r = rel & ~(Btn.Left | Btn.Right);
  if (rel & Btn.Right) r |= side === -1 ? Btn.Right : Btn.Left;
  if (rel & Btn.Left) r |= side === -1 ? Btn.Left : Btn.Right;
  return r;
}

/** try action at delay; returns new state right after it lands (hit count increased) or null */
export function tryAt(st: GameState, a: Action, delay: number): { st: GameState; dmg: number } | null {
  const s = cloneState(st);
  const d = s.fighters[1];
  const before = d.comboHits;
  const hp0 = d.hp;
  for (let f = 0; f < delay + a.seq.length + 70; f++) {
    const k = f - delay;
    if (s.ult) { // an ultimate connected: play the cinematic out (its hits count once it ends)
      while (s.ult) step(s, [0, 0]);
      return s.fighters[1].comboHits > before ? { st: s, dmg: hp0 - s.fighters[1].hp } : null;
    }
    const inp = k >= 0 && k < a.seq.length ? raw(a.seq[k], s.fighters[0].side) : 0;
    step(s, [inp, 0]);
    if (s.fighters[1].comboHits === 0 && before > 0) return null; // combo ended
    if (s.fighters[1].comboHits > before && (k >= 0)) {
      // let ultimate cinematics finish
      while (s.ult) step(s, [0, 0]);
      return { st: s, dmg: hp0 - s.fighters[1].hp };
    }
  }
  return null;
}

export interface Found { names: string[]; dmg: number; hits: number }

export function findCombo(st: GameState, depth: number, actions = ACTIONS, maxDelay = 40, kiOk = false): Found {
  let best: Found = { names: [], dmg: 0, hits: 0 };
  const rec = (s: GameState, names: string[], dmg: number, lvl: number) => {
    if (dmg > best.dmg) best = { names: [...names], dmg, hits: s.fighters[1].comboHits };
    if (lvl >= depth) return;
    for (const a of actions) {
      if (!kiOk && (a.name.includes('+'))) continue;
      for (let dl = 0; dl <= maxDelay; dl += 2) {
        const r = tryAt(s, a, dl);
        if (r) { rec(r.st, [...names, `${a.name}@${dl}`], dmg + r.dmg, lvl + 1); break; }
      }
    }
  };
  rec(st, [], 0, 0);
  return best;
}

export interface Played { ok: boolean; hits: number; dmg: number; failedAt: number; st: GameState }

/**
 * Play a combo as a chain of [action, delay] steps from a fresh training setup: each step is
 * input `delay` frames after the previous hit landed (-1 = earliest working delay) and must land
 * before the combo drops.
 */
export function playCombo(st0: GameState, steps: Array<[string, number]>): Played {
  let st = st0;
  let dmg = 0;
  for (let i = 0; i < steps.length; i++) {
    const a = ACTIONS.find((x) => x.name === steps[i][0]);
    if (!a) throw new Error(`unknown action ${steps[i][0]}`);
    let r: { st: GameState; dmg: number } | null = null;
    if (steps[i][1] >= 0) r = tryAt(st, a, steps[i][1]);
    else for (let dl = 0; dl <= 60 && !r; dl++) r = tryAt(st, a, dl); // -1 = earliest delay that connects
    if (!r) return { ok: false, hits: st.fighters[1].comboHits, dmg, failedAt: i, st };
    st = r.st; dmg += r.dmg;
  }
  return { ok: true, hits: st.fighters[1].comboHits, dmg, failedAt: -1, st };
}
