/**
 * Dev tool: brute-force the best follow-up chain after a starter move.
 *   npx tsx tests/combo-finder.ts <char> <starter> [depth=3] [ki=0] [wall=0] [vs=kaito]
 *   e.g. npx tsx tests/combo-finder.ts kaito 3H 3
 * Starter / action names: see ACTIONS in tests/lib/finder.ts. Prints actions with the delay
 * (frames after the previous hit) that first connects.
 */
import { createMatch, step, type CharId } from '../src/sim/index';
import { findCombo, tryAt, ACTIONS } from './lib/finder';

declare const process: { argv: string[] };
const [, , c, starter, depthS, kiS, wallS, vsS] = process.argv;
const depth = +(depthS ?? 3), ki = +(kiS ?? 0), wall = +(wallS ?? 0);
const st = createMatch({ p1: c as CharId, p2: (vsS ?? 'kaito') as CharId, stage: 'training', seed: 1, training: true, trainingOpts: { hpRegen: false } });
step(st, [0, 0]);
const x0 = wall ? wall - 300 - 1500 : 0;
if (wall) st.arenaHalfSize = wall;
st.fighters[0].pos = { x: x0, y: 0, z: 0 }; st.fighters[1].pos = { x: x0 + 800, y: 0, z: 0 };
st.fighters[0].ki = ki;
const a = ACTIONS.find((x) => x.name === starter);
if (!a) throw new Error(`unknown starter ${starter}; one of ${ACTIONS.map((x) => x.name).join(' ')}`);
const r0 = tryAt(st, a, 0);
if (!r0) console.log('starter whiffs');
else {
  const r = findCombo(r0.st, depth, ACTIONS, 40, ki > 0);
  console.log(`${c} ${starter} (${r0.dmg}) > ${r.names.join(' > ')}  total ${r0.dmg + r.dmg} dmg, ${r.hits} hits`);
}
