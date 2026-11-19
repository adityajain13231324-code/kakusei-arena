/**
 * Shared CPU-vs-CPU match harness for balance / side-bias tests.
 *
 * The CPU controller seeds its PRNG from (state.frame, player, difficulty) only, so two
 * matches with the same characters are identical regardless of the match seed. To get a
 * real sample, each CPU here sees the state through a view whose `frame` is shifted by a
 * per-match offset drawn from a seeded RNG (same distribution for both sides). This only
 * changes the CPU's random rolls; the live sim state is never modified.
 */
import { createMatch, step, type CharId, type GameState, type InputBits, type StageId } from '../../src/sim/index';
import { CpuController, type Difficulty } from '../../src/ai/index';
import { makeRng } from '../../src/core/rng';

export type Brain = (s: GameState) => InputBits;

export function cpu(player: 0 | 1, d: Difficulty, frameOffset = 0): Brain {
  const c = new CpuController(player, d);
  if (!frameOffset) return (s) => c.think(s);
  return (s) => c.think({ ...s, frame: s.frame + frameOffset });
}

export interface MatchResult {
  winner: -1 | 0 | 1 | 2;
  frames: number;
  /** fight-phase frames per round (excludes intro / KO / round-end) */
  roundFrames: number[];
  ended: boolean;
  dmg: [number, number];
}

export function playMatch(p1: CharId, p2: CharId, b1: Brain, b2: Brain, seed = 1, stage: StageId = 'rooftop', maxFrames = 40000): MatchResult {
  const st = createMatch({ p1, p2, stage, seed });
  const res: MatchResult = { winner: -1, frames: 0, roundFrames: [], ended: false, dmg: [0, 0] };
  let fight = 0;
  for (let f = 0; f < maxFrames; f++) {
    step(st, [b1(st), b2(st)]);
    if (st.round.phase === 'fight') fight++;
    for (const e of st.events) {
      if ((e.type === 'hit' || e.type === 'ultimateHit') && e.damage) res.dmg[e.player] += e.damage;
      if (e.type === 'ko' || e.type === 'timeout') { res.roundFrames.push(fight); fight = 0; }
      if (e.type === 'matchEnd') { res.ended = true; res.winner = st.round.winner; }
    }
    if (res.ended) break;
  }
  res.frames = st.frame;
  return res;
}

/** offsets for match k: independent draws for each side from one seeded stream */
export function offsets(seed: number, k: number): [number, number] {
  // hash the (seed, k) pair first: xorshift streams from nearby seeds start out correlated
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  const r = makeRng(h | 1);
  r(); r(); r();
  return [1 + (r() % 100000), 1 + (r() % 100000)];
}

/** P1-side win rate in mirror matches (same char, same difficulty both sides). Draws count half. */
export function mirrorRate(c: CharId, d: Difficulty, n: number, seed = 1): { p1: number; p2: number; draws: number; rate: number; avgRound: number } {
  let p1 = 0, p2 = 0, draws = 0, rf = 0, rn = 0;
  for (let k = 0; k < n; k++) {
    const [o0, o1] = offsets(seed, k);
    const r = playMatch(c, c, cpu(0, d, o0), cpu(1, d, o1), seed + k);
    if (r.winner === 0) p1++; else if (r.winner === 1) p2++; else draws++;
    for (const x of r.roundFrames) { rf += x; rn++; }
  }
  return { p1, p2, draws, rate: (p1 + draws / 2) / n, avgRound: rn ? rf / rn / 60 : 0 };
}

/**
 * Character A's win rate vs B over n matches; sides alternate every match so side bias cancels.
 */
export function pairRate(a: CharId, b: CharId, d: Difficulty, n: number, seed = 1): { winA: number; rate: number; rounds: number[] } {
  let w = 0;
  const rounds: number[] = [];
  for (let k = 0; k < n; k++) {
    const [o0, o1] = offsets(seed + 31, k);
    const flip = k % 2 === 1;
    const r = flip
      ? playMatch(b, a, cpu(0, d, o0), cpu(1, d, o1), seed + k)
      : playMatch(a, b, cpu(0, d, o0), cpu(1, d, o1), seed + k);
    const aSide = flip ? 1 : 0;
    if (r.winner === aSide) w++; else if (r.winner === 2) w += 0.5;
    rounds.push(...r.roundFrames);
  }
  return { winA: w, rate: w / n, rounds };
}
