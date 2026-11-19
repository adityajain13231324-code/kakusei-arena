/**
 * CPU AI tests. Run: npm run test:ai   (env AI_QUICK=1 for a faster pass)
 * Headless CPU-vs-CPU matches through createMatch/step.
 */
import { createMatch, step, hashState, getMove, Btn, ALL_CHARS, type CharId, type GameState, type InputBits } from '../src/sim/index';
import { CpuController, dummyInput, type Difficulty } from '../src/ai/index';
import { makeRng } from '../src/core/rng';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
declare const process: { env: Record<string, string | undefined>; exit(code: number): never };
const QUICK = !!process.env.AI_QUICK;
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard', 'nightmare'];

interface Stats {
  winner: -1 | 0 | 1 | 2; frames: number;
  hits: [number, number]; blocks: [number, number]; specials: [number, number]; ults: [number, number];
  throws: [number, number]; breaks: number; vanish: [number, number]; awaken: [number, number]; clash: number;
  dmg: [number, number]; ended: boolean; juggles: [number, number]; kiCharge: [number, number];
}

type Brain = (s: GameState) => InputBits;

function playMatch(p1: CharId, p2: CharId, b1: Brain, b2: Brain, seed: number, schemes?: ['pro' | 'easy', 'pro' | 'easy'], maxFrames = 40000): { st: GameState; stats: Stats; hash: number } {
  const st = createMatch({ p1, p2, stage: 'rooftop', seed, schemes });
  const z = (): [number, number] => [0, 0];
  const stats: Stats = { winner: -1, frames: 0, hits: z(), blocks: z(), specials: z(), ults: z(), throws: z(), breaks: 0, vanish: z(), awaken: z(), clash: 0, dmg: z(), ended: false, juggles: z(), kiCharge: z() };
  let h = 0;
  for (let f = 0; f < maxFrames; f++) {
    step(st, [b1(st), b2(st)]);
    for (const e of st.events) {
      const p = e.player;
      if (e.type === 'hit' && e.damage && e.tag !== 'heat') { stats.hits[p]++; stats.dmg[p] += e.damage; if (e.tag === 'juggle') stats.juggles[p]++; }
      else if (e.type === 'block') stats.blocks[e.target as number]++;
      else if (e.type === 'moveStart') {
        const mv = e.moveId ? getMove(e.charId!, e.moveId) : undefined;
        if (mv && (mv.kind === 'special' || mv.kind === 'ki') && !mv.internal) stats.specials[p]++;
        if (mv && mv.kind === 'ultimate' && !mv.internal) stats.ults[p]++;
      } else if (e.type === 'throw') stats.throws[p]++;
      else if (e.type === 'throwBreak') stats.breaks++;
      else if (e.type === 'vanish' && e.tag === 'depart') stats.vanish[p]++;
      else if (e.type === 'awaken') stats.awaken[p]++;
      else if (e.type === 'clashStart') stats.clash++;
      else if (e.type === 'kiCharge') stats.kiCharge[p]++;
      else if (e.type === 'matchEnd') { stats.ended = true; stats.winner = st.round.winner; }
    }
    if (f % 600 === 599) h = (Math.imul(h, 31) + hashState(st)) | 0;
    if (stats.ended) { stats.frames = st.frame; break; }
  }
  if (!stats.ended) stats.frames = st.frame;
  return { st, stats, hash: (Math.imul(h, 31) + hashState(st)) | 0 };
}

function cpuBrain(player: 0 | 1, d: Difficulty): Brain {
  const c = new CpuController(player, d);
  return (s) => c.think(s);
}

/** a first-time player mashing buttons and holding forward/back */
function masher(player: 0 | 1, seed: number): Brain {
  const r = makeRng(seed);
  let cur = 0, hold = 0;
  return (s) => {
    if (hold-- <= 0) {
      hold = 2 + (r() % 6);
      const f = s.fighters[player];
      const fwd = f.side === -1 ? Btn.Right : Btn.Left;
      const back = f.side === -1 ? Btn.Left : Btn.Right;
      let v = 0;
      const d = r() % 10;
      if (d < 5) v |= fwd; else if (d < 7) v |= back;
      const b = r() % 6;
      v |= [Btn.L, Btn.H, Btn.K, Btn.L | Btn.H, Btn.K | Btn.L, 0][b];
      cur = v;
    }
    return cur;
  };
}

const pct = (n: number, d: number): string => (d ? ((100 * n) / d).toFixed(0) : '-').padStart(3) + '%';

// ---------------------------------------------------------------- (1) matches end, CPUs hit/block/special for all 16 pairs
console.log(`\n== (1) all ${ALL_CHARS.length * ALL_CHARS.length} character pairs x 4 difficulties (mirror difficulty), matches must end`);
{
  const agg = { hits: 0, blocks: 0, specials: 0, ults: 0, throws: 0, matches: 0, ended: 0, frames: 0, juggles: 0, vanish: 0, awaken: 0, breaks: 0, kiCharge: 0, clash: 0 };
  for (const d of DIFFS) {
    const row = { hits: 0, blocks: 0, specials: 0, ults: 0, throws: 0, ended: 0, n: 0, frames: 0 };
    let seed = 100;
    for (const a of ALL_CHARS) for (const b of ALL_CHARS) {
      if (QUICK && d !== 'normal' && d !== 'nightmare') continue;
      const { stats } = playMatch(a, b, cpuBrain(0, d), cpuBrain(1, d), seed++);
      row.n++;
      if (stats.ended) row.ended++;
      row.hits += stats.hits[0] + stats.hits[1]; row.blocks += stats.blocks[0] + stats.blocks[1];
      row.specials += stats.specials[0] + stats.specials[1]; row.ults += stats.ults[0] + stats.ults[1];
      row.throws += stats.throws[0] + stats.throws[1]; row.frames += stats.frames;
      agg.juggles += stats.juggles[0] + stats.juggles[1]; agg.vanish += stats.vanish[0] + stats.vanish[1];
      agg.awaken += stats.awaken[0] + stats.awaken[1]; agg.breaks += stats.breaks; agg.kiCharge += stats.kiCharge[0] + stats.kiCharge[1]; agg.clash += stats.clash;
    }
    if (!row.n) continue;
    console.log(`  ${d.padEnd(9)} matches ${row.n} ended ${row.ended}  avg ${(row.frames / row.n / 60).toFixed(0)}s  hits/match ${(row.hits / row.n).toFixed(1)}  blocks ${(row.blocks / row.n).toFixed(1)}  specials ${(row.specials / row.n).toFixed(1)}  ults ${(row.ults / row.n).toFixed(2)}  throws ${(row.throws / row.n).toFixed(1)}`);
    check(`${d}: every match ends`, row.ended === row.n);
    check(`${d}: CPUs land hits`, row.hits / row.n > 5);
    check(`${d}: CPUs block`, row.blocks / row.n > 1 || d === 'easy');
    check(`${d}: CPUs use specials`, row.specials / row.n > 1);
    agg.hits += row.hits; agg.ults += row.ults;
  }
  console.log(`  totals: ults ${agg.ults}  juggle hits ${agg.juggles}  vanishes ${agg.vanish}  awakenings ${agg.awaken}  throw breaks ${agg.breaks}  ki charges ${agg.kiCharge}  beam clashes ${agg.clash}`);
  check('ultimates are used', agg.ults > 0);
  check('juggle combos happen', agg.juggles > 0);
  check('awakening is used', agg.awaken > 0);
}

// ---------------------------------------------------------------- (2) difficulty ladder
const N = QUICK ? 6 : 20;
function duel(hi: Difficulty, lo: Difficulty, n: number): { winHi: number; hpHi: number; n: number } {
  let w = 0;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const a = ALL_CHARS[i % ALL_CHARS.length], b = ALL_CHARS[Math.floor(i / ALL_CHARS.length + i * 7) % ALL_CHARS.length];
    const flip = i % 2 === 1; // swap sides to remove side bias
    const hiP: 0 | 1 = flip ? 1 : 0;
    const seed = 500 + i;
    const bs: [Brain, Brain] = flip ? [cpuBrain(0, lo), cpuBrain(1, hi)] : [cpuBrain(0, hi), cpuBrain(1, lo)];
    const { stats } = playMatch(flip ? b : a, flip ? a : b, bs[0], bs[1], seed);
    if (stats.winner === hiP) w++;
    else if (stats.winner === 2) w += 0.5;
    k++;
  }
  return { winHi: w, hpHi: 0, n: k };
}
console.log(`\n== (2) difficulty ladder: higher difficulty vs lower, ${N} matches each (sides + characters rotated)`);
{
  const table: Record<string, string> = {};
  const pairs: Array<[Difficulty, Difficulty, number]> = [
    ['nightmare', 'easy', 0.8], ['nightmare', 'normal', 0.6], ['nightmare', 'hard', 0.55], ['hard', 'normal', 0.55], ['hard', 'easy', 0.8], ['normal', 'easy', 0.6],
  ];
  for (const [hi, lo, need] of pairs) {
    const r = duel(hi, lo, N);
    const rate = r.winHi / r.n;
    table[`${hi} vs ${lo}`] = `${(rate * 100).toFixed(0)}%`;
    console.log(`  ${hi.padEnd(9)} beats ${lo.padEnd(7)} ${(rate * 100).toFixed(0)}% (${r.winHi}/${r.n})`);
    check(`${hi} beats ${lo} >= ${need * 100}%`, rate >= need);
  }
}

// ---------------------------------------------------------------- (3) vs masher
console.log(`\n== (3) first-time player (button masher) vs CPU, ${N} matches each`);
{
  for (const d of DIFFS) {
    let cpuWins = 0;
    for (let i = 0; i < N; i++) {
      const a = ALL_CHARS[i % ALL_CHARS.length], b = ALL_CHARS[Math.floor(i / ALL_CHARS.length + i * 7) % ALL_CHARS.length];
      const flip = i % 2 === 1;
      const bs: [Brain, Brain] = flip ? [masher(0, 77 + i), cpuBrain(1, d)] : [cpuBrain(0, d), masher(1, 77 + i)];
      const { stats } = playMatch(a, b, bs[0], bs[1], 900 + i);
      if (stats.winner === (flip ? 1 : 0)) cpuWins++;
      else if (stats.winner === 2) cpuWins += 0.5;
    }
    console.log(`  ${d.padEnd(9)} CPU wins ${cpuWins}/${N} (${((100 * cpuWins) / N).toFixed(0)}%)`);
    if (d === 'easy') check('easy is beatable by a masher (masher wins >= 35%)', (N - cpuWins) / N >= 0.35);
    if (d === 'nightmare') check('nightmare beats a masher >= 90%', cpuWins / N >= 0.9);
  }
}

// ---------------------------------------------------------------- (4) 4x4 character win matrix (normal vs normal / nightmare vs nightmare)
if (!QUICK) {
  console.log('\n== (4) character matrix, nightmare mirror difficulty, 1 match per cell (P1 wins / total)');
  const head = '          ' + ALL_CHARS.map((c) => c.padEnd(8)).join('');
  console.log(head);
  for (const a of ALL_CHARS) {
    let line = a.padEnd(10);
    for (const b of ALL_CHARS) {
      let w = 0;
      for (let i = 0; i < 1; i++) {
        const { stats } = playMatch(a, b, cpuBrain(0, 'nightmare'), cpuBrain(1, 'nightmare'), 3000 + i);
        if (stats.winner === 0) w++;
      }
      line += `${w}/1`.padEnd(8);
    }
    console.log(line);
  }
}

// ---------------------------------------------------------------- (5) nightmare punishes unsafe moves
console.log('\n== (5) nightmare punishes unsafe blocked moves (Kaito 2K sweep blocked by every character)');
{
  let punished = 0, total = 0;
  // several match seeds per character: the CPU's PRNG now depends on state.seed, and it sometimes attacks first (no block)
  for (const c of ALL_CHARS) for (const sd of [1, 2, 3, 4]) {
    const st = createMatch({ p1: 'kaito', p2: c, stage: 'training', seed: sd, training: true });
    step(st, [0, 0]);
    st.fighters[0].pos.x = -480; st.fighters[1].pos.x = 480;
    const cpu = new CpuController(1, 'nightmare');
    const hp0 = st.fighters[0].hp;
    // P1 throws a sweep (-16), P2 CPU blocks (forced guard until the CPU reacts)
    const seq = [Btn.Down | Btn.K];
    let blocked = false, hitBack = false;
    for (let f = 0; f < 120; f++) {
      const in1 = f < seq.length ? seq[f] : 0;
      let in2 = cpu.think(st);
      if (!blocked && f < 30 && st.fighters[1].mode !== 'attack') in2 |= Btn.Guard | Btn.Down;
      step(st, [in1, in2]);
      for (const e of st.events) {
        if (e.type === 'block' && e.target === 1) blocked = true;
        if (e.type === 'hit' && e.target === 0) hitBack = true;
      }
    }
    if (blocked) { total++; if (hitBack || st.fighters[0].hp < hp0) punished++; }
  }
  console.log(`  punished ${punished}/${total}`);
  check('nightmare punishes the blocked sweep', total > 0 && punished >= total - Math.ceil(total * 0.15));
}

// ---------------------------------------------------------------- (6) determinism
console.log('\n== (6) determinism: same match twice -> same hash; fresh controllers; reset after rewind');
{
  const run = () => playMatch('shiori', 'goro', cpuBrain(0, 'hard'), cpuBrain(1, 'nightmare'), 4242);
  const a = run(), b = run();
  check('identical hash', a.hash === b.hash, `${a.hash} vs ${b.hash}`);
  check('identical frame count + winner', a.stats.frames === b.stats.frames && a.stats.winner === b.stats.winner);
  const c = playMatch('shiori', 'goro', cpuBrain(0, 'hard'), cpuBrain(1, 'nightmare'), 4243);
  check('different seed differs', c.hash !== a.hash);
  const easyScheme = () => playMatch('ren', 'kaito', cpuBrain(0, 'normal'), cpuBrain(1, 'normal'), 77, ['easy', 'easy']);
  const e1 = easyScheme(), e2 = easyScheme();
  check('easy control scheme: deterministic', e1.hash === e2.hash);
  check('easy control scheme: matches end and specials fire', e1.stats.ended && e1.stats.specials[0] + e1.stats.specials[1] > 0, `ended ${e1.stats.ended} specials ${e1.stats.specials}`);
}

// ---------------------------------------------------------------- (7) dummy + misc
console.log('\n== (7) training dummy');
{
  const st = createMatch({ p1: 'kaito', p2: 'ren', stage: 'training', seed: 1, training: true });
  step(st, [0, 0]);
  const modes = ['stand', 'crouch', 'jump', 'guardAll', 'randomGuard'] as const;
  let ok = true;
  for (const m of modes) { const a = dummyInput(st, 1, m), b = dummyInput(st, 1, m); if (a !== b) ok = false; }
  check('dummyInput pure/deterministic', ok);
  check('guardAll holds back+guard', (dummyInput(st, 1, 'guardAll') & Btn.Guard) !== 0);
}

// ---------------------------------------------------------------- (8) beam clash mashing + think() cost
console.log('\n== (8) beam clash mash rate + performance');
{
  // real clash: both fire beams (Easy scheme S+K) at once; P0 mashes ~15/s, the CPU mashes at its rate
  for (const d of DIFFS) {
    let cpuWon = 0, clashes = 0;
    for (let t = 0; t < 4; t++) {
      const st = createMatch({ p1: 'kaito', p2: t % 2 ? 'goro' : 'ren', stage: 'training', seed: 1 + t, training: true, schemes: ['easy', 'easy'] });
      step(st, [0, 0]);
      st.fighters[0].pos.x = -1800; st.fighters[1].pos.x = 1800;
      st.fighters[0].ki = 300; st.fighters[1].ki = 300;
      const c = new CpuController(1, d);
      let n = 0;
      for (let f = 0; f < 400; f++) {
        n++;
        const in0 = f === 0 ? (Btn.S | Btn.K) : st.clash.active ? [Btn.L, 0, Btn.H, 0][(f >> 1) & 3] : 0;
        const in1 = f < 1 ? Btn.S | Btn.K : st.clash.active ? c.think(st) : 0;
        step(st, [in0, in1]);
        if (st.events.some((e) => e.type === 'clashEnd')) {
          clashes++;
          if (st.clash.winner === 1) cpuWon++;
          break;
        }
      }
    }
    console.log(`  clash ${d.padEnd(9)}: clashes ${clashes}/4, CPU wins ${cpuWon} (scripted opponent ~15 presses/s)`);
    check(`${d}: beam clashes occur`, clashes > 0);
    if (d === 'nightmare') check('nightmare wins the mash vs 15/s', cpuWon === clashes && clashes > 0);
  }
  // direct drive: force a clash state and measure presses per second
  for (const d of DIFFS) {
    const st = createMatch({ p1: 'kaito', p2: 'ren', stage: 'training', seed: 1, training: true });
    step(st, [0, 0]);
    st.clash.active = true; st.clash.duration = 180;
    const c = new CpuController(1, d);
    let presses = 0;
    for (let f = 0; f < 120; f++) { if (c.think(st) & (Btn.L | Btn.H | Btn.K | Btn.S)) presses++; st.frame++; }
    console.log(`  ${d.padEnd(9)} ${presses / 2} presses/s`);
    if (d === 'nightmare') check('nightmare mashes >= 20 presses/s', presses / 2 >= 20);
    if (d === 'easy') check('easy mashes <= 7 presses/s', presses / 2 <= 7);
  }
  const st = createMatch({ p1: 'kaito', p2: 'ren', stage: 'rooftop', seed: 9 });
  const c = [new CpuController(0, 'nightmare'), new CpuController(1, 'nightmare')];
  let worst = 0, tot = 0, n = 0;
  for (let f = 0; f < 6000; f++) {
    const t0 = performance.now();
    const i0 = c[0].think(st), i1 = c[1].think(st);
    const dt = performance.now() - t0;
    worst = Math.max(worst, dt); tot += dt; n++;
    step(st, [i0, i1]);
  }
  console.log(`  think() avg ${(tot / n).toFixed(3)} ms for both CPUs, worst ${worst.toFixed(2)} ms`);
  check('think() worst frame < 8 ms', worst < 8);
}

console.log(failures ? `\n${failures} FAILED` : '\nall AI tests passed');
process.exit(failures ? 1 : 0);
