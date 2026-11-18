/**
 * Seeded PRNG (xorshift32). The generator state lives in GameState.seed so
 * it is serialised and rolled back together with everything else.
 */
export interface Seeded { seed: number }

/** advance and return a uint32 */
export function nextU32(s: Seeded): number {
  let x = s.seed | 0;
  if (x === 0) x = 0x9e3779b9 | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.seed = x | 0;
  return x >>> 0;
}

/** integer in [0, n) */
export function randInt(s: Seeded, n: number): number {
  return nextU32(s) % n;
}

/** true with probability num/den */
export function chance(s: Seeded, num: number, den: number): boolean {
  return randInt(s, den) < num;
}

/** Standalone generator for tools/tests (not part of game state). */
export function makeRng(seed: number): () => number {
  const s: Seeded = { seed: seed | 0 || 1 };
  return () => nextU32(s);
}
