/**
 * KAKUSEI ARENA sim tests. Run: npm test
 *  (a) determinism  (b) save/load  (c) frame data  (d) full-match smoke  (e) performance
 *  (f) mechanics scenarios (inputs, sidestep, throws, ultimates, clash, awakening, ...)
 */
import {
  createMatch, step, serialize, deserialize, cloneState, hashState, getChar, Btn, ALL_CHARS,
  type GameState, type CharId, type MatchConfig, type MoveDef, type SimEvent,
} from '../src/sim/index';
import { makeRng } from '../src/core/rng';
import { startMove } from '../src/sim/commands';
import { F, totalFrames } from '../src/sim/fighter';
import { PREJUMP, INTRO_FRAMES, HITSTOP, COUNTER_HITSTOP, ULT_FREEZE, JUGGLE_HIT_CAP, GUARD_MAX } from '../src/sim/constants';
import { mirrorInput, stateMirrorDiff } from './lib/mirror';
import { cpu } from './lib/harness';
import { BNB, bnbSetup } from './lib/bnb';
import { playCombo } from './lib/finder';

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passes++;
  else { failures++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(name: string): void { console.log(`\n== ${name}`); }

/** random but "held" inputs: change every 1-8 frames, biased toward plausible play */
function inputGen(seed: number): () => number {
  const r = makeRng(seed);
  let cur = 0, hold = 0;
  return () => {
    if (hold-- <= 0) {
      hold = (r() % 8);
      let v = 0;
      const d = r() % 10;
      if (d < 2) v |= Btn.Right; else if (d < 4) v |= Btn.Left;
      const ud = r() % 10;
      if (ud === 0) v |= Btn.Up; else if (ud < 3) v |= Btn.Down;
      const b = r() % 12;
      if (b < 7) v |= [Btn.L, Btn.H, Btn.K, Btn.S, Btn.Guard, Btn.L | Btn.K, Btn.H | Btn.K][b];
      else if (b === 7 && r() % 8 === 0) v |= Btn.Ult | Btn.H | Btn.S;
      else if (b === 8 && r() % 10 === 0) v |= Btn.L | Btn.H | Btn.K;
      cur = v;
    }
    return cur;
  };
}

const PAIRS: Array<[CharId, CharId]> = [['kaito', 'shiori'], ['ren', 'goro'], ['goro', 'kaito'], ['shiori', 'ren']];

// ---------------------------------------------------------------- (a) determinism
section('(a) determinism: 3 matches x 5000 frames, run twice');
function runHashes(cfg: MatchConfig, seed: number, frames: number): number[] {
  const st = createMatch(cfg);
  const g1 = inputGen(seed), g2 = inputGen(seed * 31 + 7);
  const out: number[] = [];
  for (let f = 1; f <= frames; f++) {
    step(st, [g1(), g2()]);
    if (f % 60 === 0) out.push(hashState(st));
  }
  return out;
}
for (let m = 0; m < 3; m++) {
  const cfg: MatchConfig = { p1: PAIRS[m][0], p2: PAIRS[m][1], stage: m === 2 ? 'shrine' : 'rooftop', seed: 1000 + m, schemes: m === 1 ? ['easy', 'pro'] : ['pro', 'easy'] };
  const a = runHashes(cfg, 50 + m, 5000);
  const b = runHashes(cfg, 50 + m, 5000);
  let same = a.length === b.length;
  for (let i = 0; i < a.length && same; i++) if (a[i] !== b[i]) same = false;
  check(`match ${m} identical hashes`, same);
  check(`match ${m} state evolves`, new Set(a).size > 10);
}

// ---------------------------------------------------------------- (b) save / load
section('(b) save/load: serialize at 1000, continue both 2000 frames');
{
  const cfg: MatchConfig = { p1: 'kaito', p2: 'ren', stage: 'rooftop', seed: 99 };
  const st = createMatch(cfg);
  const g1 = inputGen(5), g2 = inputGen(6);
  for (let f = 0; f < 1000; f++) step(st, [g1(), g2()]);
  const loaded = deserialize(serialize(st));
  const cloned = cloneState(st);
  check('hash equal after load', hashState(loaded) === hashState(st));
  check('hash equal after clone', hashState(cloned) === hashState(st));
  const h1 = inputGen(77), h2 = inputGen(78);
  const ins: Array<[number, number]> = [];
  for (let f = 0; f < 2000; f++) ins.push([h1(), h2()]);
  let ok = true;
  for (let f = 0; f < 2000; f++) {
    step(st, ins[f]); step(loaded, ins[f]); step(cloned, ins[f]);
    if (f % 100 === 99) {
      const h = hashState(st);
      if (h !== hashState(loaded) || h !== hashState(cloned)) { ok = false; break; }
    }
  }
  check('continued hashes identical (loaded + cloned)', ok);
}

// ---------------------------------------------------------------- helpers for scenario tests
function training(p1: CharId, p2: CharId, extra: Partial<MatchConfig> = {}): GameState {
  return createMatch({ p1, p2, stage: 'training', seed: 1, training: true, ...extra });
}
function place(st: GameState, d: number): void {
  const a = F(st, 0), b = F(st, 1);
  a.pos = { x: 0, y: 0, z: 0 }; b.pos = { x: d, y: 0, z: 0 };
  a.facing = { x: 1000, z: 0 }; b.facing = { x: -1000, z: 0 };
}
function run(st: GameState, n: number, in1: number | ((f: number) => number) = 0, in2: number | ((f: number) => number) = 0): SimEvent[] {
  const evs: SimEvent[] = [];
  for (let f = 0; f < n; f++) {
    step(st, [typeof in1 === 'function' ? in1(f) : in1, typeof in2 === 'function' ? in2(f) : in2]);
    evs.push(...st.events);
  }
  return evs;
}
/** play a sequence of input frames for P1 (each entry one frame) */
function seq(...frames: number[]): (f: number) => number {
  return (f) => (f < frames.length ? frames[f] : 0);
}

// ---------------------------------------------------------------- (c) frame data
section('(c) frame data: first active frame = startup+1 (input frame = move frame 1)');
{
  let tested = 0;
  for (const cid of ALL_CHARS) {
    for (const m of getChar(cid).moves) {
      if (m.hitboxes.length === 0 && !m.projectile) continue;
      tested++;
      let best = 9999;
      let expected = 0;
      for (let d = 500; d <= 2600 && best === 9999; d += 100) {
        const st = training(cid, 'kaito');
        run(st, 2);
        place(st, d);
        const a = F(st, 0);
        if (m.requires === 'awakened') a.awakened = true;
        if (m.requires === 'air') { a.mode = 'jump'; a.modeFrame = PREJUMP + 1; a.airborne = true; a.pos.y = 350; a.vel.y = 20; }
        const f0 = st.frame;
        startMove(st, 0, m);
        expected = f0 + (m.projectile ? m.projectile.spawnFrame : m.startup + 1);
        for (let k = 0; k < totalFrames(m) + 5; k++) {
          step(st, [0, 0]);
          const hit = st.events.find((e) => e.player === 0 && (m.projectile ? e.type === 'projectile' : (e.type === 'hit' || e.type === 'block' || e.type === 'throw')));
          if (hit) { best = Math.min(best, st.frame); break; }
        }
      }
      check(`${m.id} first active frame`, best === expected, `got ${best === 9999 ? 'no contact' : 'frame ' + (best - expected + (m.projectile ? m.projectile.spawnFrame : m.startup + 1))}, want ${m.projectile ? m.projectile.spawnFrame : m.startup + 1}`);
      // anim sanity: starts at frame 0, keys sorted
      let sorted = m.anim.length > 0 && m.anim[0][0] === 0;
      for (let i = 1; i < m.anim.length; i++) if (m.anim[i][0] < m.anim[i - 1][0]) sorted = false;
      check(`${m.id} anim keys sorted from 0`, sorted);
    }
  }
  console.log(`  ${tested} moves checked`);
}

// ---------------------------------------------------------------- (d) smoke
section('(d) smoke: random fighters finish a full match within 60k frames');
for (let k = 0; k < PAIRS.length; k++) {
  const st = createMatch({ p1: PAIRS[k][0], p2: PAIRS[k][1], stage: 'rooftop', seed: 300 + k, schemes: k % 2 ? ['easy', 'easy'] : ['pro', 'pro'] });
  const g1 = inputGen(900 + k), g2 = inputGen(1900 + k);
  let f = 0;
  let ended = false;
  for (; f < 60000; f++) {
    step(st, [g1(), g2()]);
    if (st.events.some((e) => e.type === 'matchEnd')) { ended = true; break; }
  }
  check(`${PAIRS[k].join(' vs ')} reaches matchEnd`, ended && st.round.phase === 'matchEnd', `phase ${st.round.phase} after ${f}`);
  if (ended) console.log(`  ${PAIRS[k].join(' vs ')}: matchEnd at frame ${f + 1}, winner P${st.round.winner + 1}, rounds ${st.round.number}`);
}

// ---------------------------------------------------------------- (e) performance
section('(e) performance: average step() < 0.2 ms');
{
  const st = createMatch({ p1: 'shiori', p2: 'kaito', stage: 'shrine', seed: 4, training: true });
  const g1 = inputGen(11), g2 = inputGen(12);
  const N = 30000;
  const ins: Array<[number, number]> = [];
  for (let i = 0; i < N; i++) ins.push([g1(), g2()]);
  for (let i = 0; i < 2000; i++) step(st, ins[i]); // warm-up
  const t0 = performance.now();
  for (let i = 2000; i < N; i++) step(st, ins[i]);
  const avg = (performance.now() - t0) / (N - 2000);
  console.log(`  avg ${avg.toFixed(4)} ms/step`);
  check('step average < 0.2 ms', avg < 0.2, `${avg.toFixed(4)} ms`);
}

// ---------------------------------------------------------------- (f) mechanics
section('(f) mechanics scenarios');
{
  const R = Btn.Right, L = Btn.Left, U = Btn.Up, D = Btn.Down;
  // intro ignores input, then 'fight'
  {
    const st = createMatch({ p1: 'kaito', p2: 'shiori', stage: 'rooftop', seed: 2 });
    const ev = run(st, INTRO_FRAMES + 2, Btn.L);
    check('intro: roundStart then fight', ev.some((e) => e.type === 'roundStart') && ev.some((e) => e.type === 'fight'));
    check('intro: no moves during intro', !ev.some((e) => e.type === 'moveStart' && e.frame <= INTRO_FRAMES));
  }
  // walk forward (P1 on the left, Right = forward)
  {
    const st = training('kaito', 'goro'); place(st, 2600);
    run(st, 20, R);
    check('walk: Right moves P1 toward P2', F(st, 0).pos.x > 600 && F(st, 0).mode === 'walk');
  }
  // side switch: P2 on the left uses Right as forward
  {
    const st = training('kaito', 'goro');
    run(st, 1);
    F(st, 0).pos.x = 1300; F(st, 1).pos.x = -1300;
    run(st, 1);
    check('sides swap when positions swap', F(st, 0).side === 1 && F(st, 1).side === -1);
    const x0 = F(st, 1).pos.x;
    run(st, 10, 0, R);
    check('swapped P2: Right walks forward', F(st, 1).pos.x > x0 + 200);
  }
  // camera normal continuity under circling
  {
    const st = training('kaito', 'goro'); place(st, 2000);
    let ok = true;
    let prev = { ...st.camera.normal };
    for (let f = 0; f < 400; f++) {
      step(st, [U, 0]);
      const n = st.camera.normal;
      if (n.x * prev.x + n.z * prev.z < 0) ok = false;
      prev = { ...n };
    }
    const a = F(st, 0), b = F(st, 1);
    const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
    check('sidewalk circles opponent (z moved, distance kept)', Math.abs(a.pos.z) > 1000 && Math.abs(d - 2000) < 150, `z=${a.pos.z} d=${d.toFixed(0)}`);
    check('camera normal never flips', ok);
  }
  // sidestep tap + event
  {
    const st = training('ren', 'goro'); place(st, 2000);
    const ev = run(st, 3, seq(U, 0, 0));
    check('tap Up = sidestep in', F(st, 0).mode === 'sidestep' && ev.some((e) => e.type === 'sidestep' && e.tag === 'in'));
    const st2 = training('ren', 'goro'); place(st2, 2000);
    const ev2 = run(st2, 6, seq(D, D, D, 0, 0, 0));
    check('tap Down = sidestep out', ev2.some((e) => e.type === 'sidestep' && e.tag === 'out'));
    const st3 = training('ren', 'goro'); place(st3, 2000);
    run(st3, 20, D);
    check('hold Down = crouch', F(st3, 0).mode === 'crouch');
  }
  // jumps / dash / backdash
  {
    const st = training('kaito', 'goro'); place(st, 3000);
    const ev = run(st, 30, U | R);
    check('Up+Forward = forward jump', ev.some((e) => e.type === 'jump') && F(st, 0).pos.x > 300 && F(st, 0).airborne);
    const st2 = training('kaito', 'goro'); place(st2, 3000);
    const ev2 = run(st2, 12, seq(U, U, 0, 0, U, U, U, U));
    check('double-tap Up = neutral jump', ev2.some((e) => e.type === 'jump') && Math.abs(F(st2, 0).pos.x) < 50);
    const st3 = training('kaito', 'goro'); place(st3, 3000);
    const ev3 = run(st3, 12, seq(R, R, 0, 0, R, R, R));
    check('double-tap forward = dash', ev3.some((e) => e.type === 'dash' && e.tag === 'forward') && F(st3, 0).pos.x > 500);
    const st4 = training('kaito', 'goro'); place(st4, 3000);
    const ev4 = run(st4, 12, seq(L, L, 0, 0, L, L, L));
    check('double-tap back = backdash', ev4.some((e) => e.type === 'dash' && e.tag === 'back') && F(st4, 0).pos.x < -400);
  }
  // motion input 236S (Pro) -> fireball
  {
    const st = training('kaito', 'goro'); place(st, 3000);
    const ev = run(st, 30, seq(D, D, D | R, D | R, R, R | Btn.S));
    check('Pro 236S = Homura Shot projectile', ev.some((e) => e.type === 'moveStart' && e.moveId === 'kaito_homura_shot') && ev.some((e) => e.type === 'projectile'));
    const st2 = training('kaito', 'goro', { schemes: ['easy', 'pro'] }); place(st2, 3000);
    const ev2 = run(st2, 30, seq(R | Btn.S));
    check('Easy 6S = Homura Shot', ev2.some((e) => e.type === 'moveStart' && e.moveId === 'kaito_homura_shot'));
    const st3 = training('kaito', 'goro'); place(st3, 3000);
    const ev3 = run(st3, 30, seq(R, D, D | R, D | R | Btn.S));
    check('Pro 623S = Rising Phoenix (beats 236)', ev3.some((e) => e.type === 'moveStart' && e.moveId === 'kaito_rising_phoenix'));
    const st4 = training('shiori', 'goro'); place(st4, 3000);
    const ev4 = run(st4, 30, seq(Btn.Right, R));
    check('Shiori fan: 3 kunai', (() => { const s5 = training('shiori', 'goro'); place(s5, 3000); const e5 = run(s5, 30, seq(D, D | R, R | Btn.S)); return e5.filter((e) => e.type === 'projectile').length === 3; })());
    void ev4;
  }
  // strings & buffer: L,L,H chain
  {
    const st = training('kaito', 'goro'); place(st, 900);
    const ev = run(st, 60, seq(Btn.L, 0, 0, 0, 0, 0, 0, 0, Btn.L, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, Btn.H));
    const ids = ev.filter((e) => e.type === 'moveStart').map((e) => e.moveId);
    check('string L,L,H', ids.join() === 'kaito_jab,kaito_jab2,kaito_jab3', ids.join());
  }
  // easy auto-combo: mash L
  {
    const st = training('kaito', 'goro', { schemes: ['easy', 'pro'] }); place(st, 900);
    const ev = run(st, 120, (f) => (f % 4 === 0 ? Btn.L : 0));
    const ids = ev.filter((e) => e.type === 'moveStart').map((e) => e.moveId);
    check('easy mash L: jab -> jab2 -> jab3 -> ender', ids.slice(0, 4).join() === 'kaito_jab,kaito_jab2,kaito_jab3,kaito_blaze_knuckle', ids.slice(0, 5).join());
  }
  // heights: high whiffs on crouch; low beats standing guard; mid beats crouch guard
  {
    const st = training('kaito', 'goro'); place(st, 700);
    const ev = run(st, 30, seq(Btn.L), D);
    check('high whiffs vs crouch', ev.some((e) => e.type === 'whiff') && !ev.some((e) => e.type === 'hit'));
    const st2 = training('kaito', 'goro'); place(st2, 700);
    const ev2 = run(st2, 30, seq(D | Btn.L, D), (f) => (f >= 8 ? R : 0)); // P2 on the right: Right = back = guard
    check('low hits standing guard', ev2.some((e) => e.type === 'hit') && !ev2.some((e) => e.type === 'block'));
    const st3 = training('kaito', 'goro'); place(st3, 700);
    const ev3 = run(st3, 30, seq(D | Btn.L, D), D | R);
    check('low blocked by crouch guard', ev3.some((e) => e.type === 'block'));
    const st4 = training('kaito', 'goro'); place(st4, 700);
    const ev4 = run(st4, 30, seq(Btn.H), D | R);
    check('mid hits crouch guard', ev4.some((e) => e.type === 'hit'));
    const st5 = training('kaito', 'goro'); place(st5, 700);
    const ev5 = run(st5, 30, seq(Btn.H), (f) => (f >= 10 ? R : 0));
    check('mid blocked standing', ev5.some((e) => e.type === 'block'));
    const st6 = training('kaito', 'goro'); place(st6, 700);
    const ev6 = run(st6, 30, seq(Btn.H), Btn.Guard);
    check('Guard button blocks mid', ev6.some((e) => e.type === 'block'));
  }
  // frame advantage measured on block: jab +1, launcher -13
  {
    const st = training('kaito', 'goro'); place(st, 700);
    run(st, 60, seq(Btn.L), R);
    check('jab +1 on block (measured)', st.frameAdv?.value === 1, `got ${st.frameAdv?.value}`);
    const st2 = training('kaito', 'goro'); place(st2, 700);
    run(st2, 80, seq(D | R | Btn.H), (f) => (f >= 12 ? R : 0));
    check('launcher -14 on block (measured)', st2.frameAdv?.value === -14, `got ${st2.frameAdv?.value}`);
    const st3 = training('kaito', 'goro'); place(st3, 700);
    run(st3, 60, seq(Btn.L));
    check('jab +8 on hit (measured)', st3.frameAdv?.value === 8, `got ${st3.frameAdv?.value}`);
  }
  // counter hit: hit the opponent during their startup
  {
    const st = training('kaito', 'goro'); place(st, 900);
    const ev = run(st, 30, seq(0, 0, 0, Btn.L), seq(R | Btn.K)); // goro 4K (18f, no armor), kaito jab (10f) later
    check('counter hit during startup', ev.some((e) => e.type === 'counter' && e.player === 0));
  }
  // launch + juggle + damage scaling + knockdown
  {
    // 3H launcher, H, H,H (raw inputs, P1 on the left)
    const st = training('kaito', 'shiori'); place(st, 900);
    const plan: Record<number, number> = { 0: D | R | Btn.H, 44: Btn.H, 54: Btn.H };
    const ev = run(st, 160, (f) => plan[f] ?? 0);
    const hits = ev.filter((e) => e.type === 'hit' && e.player === 0);
    check('launcher launches', ev.some((e) => e.type === 'launch'));
    check('juggle follow-ups connect (3H, H, H,H)', hits.length === 3, `${hits.length} hits`);
    check('juggle ends in knockdown', ev.some((e) => e.type === 'knockdown'));
    check('juggle hits are scaled 100/90/80%', hits.length === 3 && hits[0].damage === 70 && hits[1].damage === 85 && hits[2].damage === 88, hits.map((h) => h.damage).join());
  }
  // sidestep evades a linear move, tracking move catches it
  {
    const st = training('kaito', 'goro'); place(st, 1000);
    const ev = run(st, 40, seq(0, 0, 0, 0, Btn.L), seq(U));
    check('sidestep evades linear jab', !ev.some((e) => e.type === 'hit'));
    const st2 = training('ren', 'goro'); place(st2, 1200);
    const ev2 = run(st2, 60, seq(D, D | L, L | Btn.S), seq(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, U));
    check('tracking Moon Step catches sidestep', ev2.some((e) => e.type === 'hit' && e.moveId === 'ren_moon_step'));
  }
  // throws and breaks
  {
    const st = training('kaito', 'goro'); place(st, 800);
    const ev = run(st, 80, seq(Btn.L | Btn.K));
    check('throw connects and damages', ev.some((e) => e.type === 'throw') && ev.some((e) => e.type === 'hit' && e.tag === 'throw'));
    const st2 = training('kaito', 'goro'); place(st2, 800);
    const ev2 = run(st2, 80, seq(Btn.L | Btn.K), seq(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, Btn.L));
    check('throw break with L', ev2.some((e) => e.type === 'throwBreak') && !ev2.some((e) => e.type === 'hit'));
    const st3 = training('kaito', 'goro'); place(st3, 800);
    const ev3 = run(st3, 40, seq(Btn.L | Btn.K), D);
    check('normal throw whiffs vs crouch', !ev3.some((e) => e.type === 'throw'));
    const st4 = training('goro', 'kaito'); place(st4, 800);
    const ev4 = run(st4, 100, seq(R, D, D | R | Btn.S), (f) => (f > 26 && f < 50 && f % 2 === 0 ? Btn.L : 0) | D); // mash L only once grabbed
    check('Mountain Hug: unbreakable, grabs crouchers', ev4.some((e) => e.type === 'throw' && e.tag === 'unbreakable') && !ev4.some((e) => e.type === 'throwBreak') && ev4.some((e) => e.type === 'hit' && e.tag === 'throw'));
  }
  // ki charge, vanish, awakening
  {
    const st = training('kaito', 'goro', { trainingOpts: { hpRegen: false } }); place(st, 2500);
    const ev = run(st, 200, Btn.S);
    check('hold S = ki charge', F(st, 0).mode === 'kicharge' && ev.some((e) => e.type === 'kiCharge') && F(st, 0).ki > 300 - 1 && ev.some((e) => e.type === 'kiFull'));
    const ev2 = run(st, 30, seq(0, Btn.H | Btn.K));
    check('vanish: teleports behind, costs 100', ev2.filter((e) => e.type === 'vanish').length === 2 && F(st, 0).ki === 200 && F(st, 0).pos.x > F(st, 1).pos.x);
    const st3 = training('kaito', 'goro', { trainingOpts: { hpRegen: false } }); place(st3, 2500);
    run(st3, 1);
    const ev3a = run(st3, 5, seq(Btn.L | Btn.H | Btn.K));
    check('awaken refused above 35% HP', !ev3a.some((e) => e.type === 'awaken'));
    run(st3, 60);
    F(st3, 0).hp = 300;
    const ev3 = run(st3, 60, seq(Btn.L | Btn.H | Btn.K));
    const healed = 300 + Math.trunc(F(st3, 0).maxHp / 10);
    check('awaken below 35%: event, heal, awakened', ev3.some((e) => e.type === 'awaken') && F(st3, 0).awakened && F(st3, 0).hp === healed && F(st3, 0).awakenUsed, `hp ${F(st3, 0).hp} want ${healed}`);
    const ev3b = run(st3, 60, seq(Btn.L | Btn.H | Btn.K));
    check('awaken once per match', !ev3b.some((e) => e.type === 'awaken'));
  }
  // ultimate: cinematic, ~330 damage, cost 300
  {
    const st = training('kaito', 'goro', { trainingOpts: { hpRegen: false } }); place(st, 1200);
    F(st, 0).ki = 300;
    const ev = run(st, 260, seq(D, D | R, R | Btn.H | Btn.S));
    const uh = ev.filter((e) => e.type === 'ultimateHit');
    const total = uh.reduce((s, e) => s + (e.damage ?? 0), 0);
    check('Pro 236H+S ultimate starts', ev.some((e) => e.type === 'ultimateStart'));
    check('ultimate cinematic multi-hit ~330 dmg', uh.length >= 6 && total === 330, `${uh.length} hits, ${total}`);
    check('ultimate costs 300', F(st, 0).ki === 0);
    const st2 = training('shiori', 'goro', { schemes: ['easy', 'pro'], trainingOpts: { hpRegen: false } }); place(st2, 1500);
    F(st2, 0).ki = 300;
    const ev2 = run(st2, 80, seq(Btn.Ult), R);
    check('Easy Ult button; blocked ult has no cinematic', ev2.some((e) => e.type === 'ultimateStart') && ev2.some((e) => e.type === 'block') && !ev2.some((e) => e.type === 'ultimateHit'));
  }
  // beam clash
  {
    const st = training('kaito', 'goro'); place(st, 3000);
    F(st, 0).ki = 300; F(st, 1).ki = 300;
    const ev = run(st, 300, (f) => (f === 0 ? D : f === 1 ? D | R : f === 2 ? R | Btn.S | Btn.K : f > 40 && f % 3 === 0 ? Btn.L : 0),
      (f) => (f === 0 ? D : f === 1 ? D | L : f === 2 ? L | Btn.S | Btn.K : 0));
    check('beam vs beam = clash', ev.some((e) => e.type === 'clashStart'));
    const end = ev.find((e) => e.type === 'clashEnd');
    check('mashing P1 wins clash', !!end && end.player === 0 && (end.damage ?? 0) > 0);
  }
  // wall splat
  {
    const st = training('goro', 'kaito'); place(st, 900);
    st.arenaHalfSize = 2000;
    F(st, 0).pos.x = 600; F(st, 1).pos.x = 1500;
    const ev = run(st, 80, seq(Btn.H, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, Btn.H));
    check('wallbounce move into wall = wall splat', ev.some((e) => e.type === 'wallSplat'));
  }
  // Ren stance: hold 4S, release -> quick draw; high attack is auto-countered
  {
    const st = training('ren', 'goro'); place(st, 1400);
    const ev = run(st, 60, (f) => (f < 20 ? L | Btn.S : 0));
    const ids = ev.filter((e) => e.type === 'moveStart').map((e) => e.moveId);
    check('sheath stance -> quick draw on release', ids.join() === 'ren_sheath,ren_quick_draw', ids.join());
    const st2 = training('ren', 'kaito'); place(st2, 900);
    const ev2 = run(st2, 60, (f) => (f < 30 ? L | Btn.S : L | Btn.S), seq(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, Btn.L));
    check('stance auto-counters highs', ev2.some((e) => e.type === 'parry') && ev2.some((e) => e.type === 'moveStart' && e.moveId === 'ren_stance_counter'));
  }
  // Goro armor absorbs a jab
  {
    const st = training('goro', 'kaito'); place(st, 1000);
    const ev = run(st, 40, seq(Btn.H), seq(0, 0, Btn.L)); // jab lands on goro frame 13 (armor 5-15)
    check('Stone Skin armor absorbs a hit', ev.some((e) => e.type === 'hit' && e.tag === 'armor') && ev.some((e) => e.type === 'hit' && e.player === 0));
  }
  // Kaito heat stacks
  {
    const st = training('kaito', 'goro'); place(st, 1600);
    run(st, 60, seq(D, D | R, R | Btn.S));
    check('special hit adds a heat stack', F(st, 0).heatStacks === 1, `${F(st, 0).heatStacks}`);
  }
  // timeout & KO round flow
  {
    const st = createMatch({ p1: 'kaito', p2: 'goro', stage: 'rooftop', seed: 3 });
    run(st, INTRO_FRAMES + 5);
    F(st, 1).hp = 1;
    st.round.timer = 3;
    const ev = run(st, 10);
    check('timeout: higher hp% wins', ev.some((e) => e.type === 'timeout') && st.round.winner === 0);
    const ev2 = run(st, 400);
    check('next round starts, wins counted', ev2.some((e) => e.type === 'roundEnd') && ev2.some((e) => e.type === 'roundStart') && F(st, 0).wins === 1 && F(st, 1).hp === F(st, 1).maxHp);
    const st2 = createMatch({ p1: 'kaito', p2: 'goro', stage: 'rooftop', seed: 3 });
    run(st2, INTRO_FRAMES + 5);
    F(st2, 1).hp = 10; place(st2, 900);
    const ev3 = run(st2, 30, seq(Btn.H));
    check('KO event + slowmo + cinematic', ev3.some((e) => e.type === 'ko') && st2.round.phase === 'ko' && st2.camera.cinematic?.kind === 'ko');
  }
  // vanish cancel on block, dummy guard, awakened ult cost, KO deferred to the end of an ultimate
  {
    const st = training('kaito', 'goro', { trainingOpts: { dummyGuard: 'all', hpRegen: false } }); place(st, 750);
    F(st, 0).ki = 100;
    const ev = run(st, 40, (f) => (f === 0 ? Btn.H : f === 18 ? Btn.H | Btn.K : 0));
    check('dummy auto-guard blocks', ev.some((e) => e.type === 'block'));
    check('vanish cancel after block (costs 100)', ev.some((e) => e.type === 'vanish' && e.tag === 'arrive') && F(st, 0).ki < 10);
    const st2 = training('kaito', 'goro', { trainingOpts: { dummyGuard: 'all' } }); place(st2, 750);
    const ev2 = run(st2, 40, seq(D | Btn.K));
    check('dummy auto-guard blocks lows too', ev2.some((e) => e.type === 'block'));
    const st3 = training('ren', 'goro', { trainingOpts: { hpRegen: false } }); place(st3, 1300);
    F(st3, 0).ki = 200; F(st3, 0).awakened = true; F(st3, 0).awakenTimer = 600;
    const ev3 = run(st3, 250, seq(D, D | R, R | Btn.H | Btn.S));
    check('awakened ultimate costs 200 (awakened variant)', ev3.some((e) => e.type === 'ultimateStart' && e.moveId === 'ren_ult_aw') && F(st3, 0).ki === 0);
    const st4 = createMatch({ p1: 'kaito', p2: 'goro', stage: 'rooftop', seed: 9 });
    run(st4, INTRO_FRAMES + 3); place(st4, 1200);
    F(st4, 0).ki = 300; F(st4, 1).hp = 50;
    const ev4 = run(st4, 260, seq(D, D | R, R | Btn.H | Btn.S));
    const koEv = ev4.find((e) => e.type === 'ko');
    const lastUlt = ev4.filter((e) => e.type === 'ultimateHit').pop();
    check('KO resolves after the ultimate cinematic', !!koEv && !!lastUlt && koEv.frame > lastUlt.frame);
  }
  // events carry positions, poses set
  {
    const st = training('kaito', 'goro'); place(st, 900);
    const ev = run(st, 20, seq(Btn.H));
    const h = ev.find((e) => e.type === 'hit');
    check('hit event has contact point near defender', !!h && h.pos.x > 400 && h.pos.x < 1000 && h.pos.y > 900);
    check('defender pose is a hit pose', ['hitMid', 'hitHigh'].includes(F(st, 1).pose));
  }
}


// ---------------------------------------------------------------- (g) side symmetry
section('(g) side symmetry: P1/P2 doing mirrored inputs give mirrored states every frame');
{
  let firstDiff = '';
  let runs = 0;
  for (const a of ALL_CHARS) for (const b of ALL_CHARS) {
    for (let k = 0; k < 2; k++) {
      const useCpu = k === 1 && (a === b || a === 'kaito');
      if (k === 1 && !useCpu) continue;
      const s1 = createMatch({ p1: a, p2: b, stage: 'rooftop', seed: 5 });
      const s2 = createMatch({ p1: b, p2: a, stage: 'rooftop', seed: 5 });
      const g1 = inputGen(400 + runs), g2 = inputGen(800 + runs);
      const c1 = cpu(0, 'nightmare', 17 + runs), c2 = cpu(1, 'nightmare', 91 + runs);
      runs++;
      for (let f = 0; f < 3000 && !firstDiff; f++) {
        const i1 = useCpu ? c1(s1) : g1(), i2 = useCpu ? c2(s1) : g2();
        step(s1, [i1, i2]);
        step(s2, [mirrorInput(i2), mirrorInput(i1)]);
        const d = stateMirrorDiff(s1, s2);
        if (d) firstDiff = `${a} vs ${b}${useCpu ? ' (cpu)' : ''} frame ${s1.frame}: ${d}`;
      }
    }
  }
  check(`${runs} mirrored runs stay mirror-identical`, !firstDiff, firstDiff);
  // same-frame interactions from both sides
  const both = (p1: CharId, p2: CharId, in1: number[], in2: number[]): string => {
    const s1 = training(p1, p2), s2 = training(p2, p1);
    run(s1, 1); run(s2, 1);
    for (const st of [s1, s2]) { F(st, 0).pos = { x: -400, y: 0, z: 0 }; F(st, 1).pos = { x: 400, y: 0, z: 0 }; F(st, 0).facing = { x: 1000, z: 0 }; F(st, 1).facing = { x: -1000, z: 0 }; }
    for (let f = 0; f < 90; f++) {
      const a = in1[f] ?? 0, b = in2[f] ?? 0;
      step(s1, [a, b]); step(s2, [mirrorInput(b), mirrorInput(a)]);
      const d = stateMirrorDiff(s1, s2);
      if (d) return `frame ${f}: ${d}`;
    }
    return '';
  };
  check('jab vs jab trade is symmetric', both('kaito', 'kaito', [Btn.L], [Btn.L]) === '');
  check('throw vs throw is symmetric', both('ren', 'ren', [Btn.L | Btn.K], [Btn.L | Btn.K]) === '');
  check('throw vs jab (strike beats throw) is symmetric', both('goro', 'shiori', [Btn.L | Btn.K], [Btn.L]) === '');
  check('sidestep vs tracking move is symmetric', both('kaito', 'goro', [0, 0, 0, Btn.Right | Btn.H], [Btn.Up]) === '');
  check('Smoke Swap vs Smoke Swap is symmetric', both('shiori', 'shiori', [Btn.Down, Btn.Down | Btn.Left, Btn.Left | Btn.S], [Btn.Down, Btn.Down | Btn.Right, Btn.Right | Btn.S]) === '');
  // strike beats throw regardless of which player throws
  const stb = (thrower: 0 | 1): boolean => {
    const st = training('kaito', 'kaito'); run(st, 1);
    F(st, 0).pos = { x: -350, y: 0, z: 0 }; F(st, 1).pos = { x: 350, y: 0, z: 0 };
    const t = Btn.L | Btn.K;
    const ev = run(st, 60, seq(thrower === 0 ? t : Btn.L), seq(thrower === 1 ? t : Btn.L));
    return !ev.some((e) => e.type === 'throw') && ev.some((e) => e.type === 'hit' && e.player === 1 - thrower);
  };
  check('jab beats a same-frame throw (P1 throws)', stb(0));
  check('jab beats a same-frame throw (P2 throws)', stb(1));
}

// ---------------------------------------------------------------- (h) BnB combos
section('(h) bread-and-butter combos connect on every opponent');
{
  for (const c of ALL_CHARS) for (const b of BNB[c]) {
    let ok = true, dmgLo = 9999, dmgHi = 0, why = '';
    for (const vs of ALL_CHARS) {
      const r = playCombo(bnbSetup(c, vs, b), b.steps);
      if (!r.ok) { ok = false; why = `vs ${vs} dropped at step ${r.failedAt + 1}`; }
      dmgLo = Math.min(dmgLo, r.dmg); dmgHi = Math.max(dmgHi, r.dmg);
    }
    check(`${c} ${b.name}: ${b.notation}`, ok, why);
    check(`${c} ${b.name}: damage in 180..520`, dmgLo >= 180 && dmgHi <= 520, `${dmgLo}..${dmgHi}`);
  }
}

// ---------------------------------------------------------------- (i) combat systems
section('(i) combat systems: enders, juggle cap, guard crush, ground hits, clash rotation, ult freeze');
{
  const R = Btn.Right, D = Btn.Down;
  // ender rule: a special in a juggle ends it (no hits until the opponent lands)
  {
    const st = training('kaito', 'kaito'); place(st, 900);
    const plan: Record<number, number> = { 0: D | R | Btn.H, 44: Btn.Left, 45: D | Btn.Left, 46: D, 47: D | R, 48: R | Btn.S };
    const ev = run(st, 200, (f) => plan[f] ?? (f > 70 && f % 3 === 0 ? Btn.L : 0));
    const blaze = ev.findIndex((e) => e.type === 'hit' && e.moveId === 'kaito_blaze_knuckle');
    const kd = ev.findIndex((e) => e.type === 'knockdown');
    const between = ev.slice(blaze + 1, kd).filter((e) => e.type === 'hit' && e.player === 0).length;
    check('special in a juggle = ender (no follow-up hits before landing)', blaze > 0 && kd > blaze && between === 0, `blaze ${blaze} kd ${kd} extra ${between}`);
  }
  // no infinites: mashing every frame after a launcher still ends the juggle
  for (const c of ALL_CHARS) {
    const st = training(c, 'shiori'); place(st, 850);
    let maxHits = 0;
    const ev = run(st, 400, (f) => (f === 0 ? D | R | Btn.H : [Btn.L, 0, Btn.H, 0, Btn.K, 0][f % 6] | (f % 30 < 4 ? R : 0)));
    for (const e of ev) if (e.player === 0 && e.combo) maxHits = Math.max(maxHits, e.combo);
    check(`${c}: mashing after a launcher ends (knockdown, <= ${JUGGLE_HIT_CAP + 3} hits)`, ev.some((e) => e.type === 'knockdown') && maxHits <= JUGGLE_HIT_CAP + 3, `${maxHits} hits`);
  }
  // hitstop: counter hits add COUNTER_HITSTOP
  {
    const st = training('kaito', 'goro'); place(st, 900);
    let hs = -1;
    for (let f = 0; f < 30 && hs < 0; f++) { step(st, [f === 3 ? Btn.L : 0, f === 0 ? R | Btn.K : 0]); if (st.events.some((e) => e.type === 'counter')) hs = F(st, 0).hitstop; }
    check(`counter hit hitstop = light ${HITSTOP.light} + ${COUNTER_HITSTOP}`, hs === HITSTOP.light + COUNTER_HITSTOP, `${hs}`);
    check('hitstop bands: light 6-8, heavy 10-12, super 14', HITSTOP.light >= 6 && HITSTOP.light <= 8 && HITSTOP.heavy >= 10 && HITSTOP.heavy <= 12 && HITSTOP.super === 14);
  }
  // guard crush: sustained pressure on a guarding opponent breaks the guard -> stagger -> launcher combo
  {
    const st = training('goro', 'kaito'); place(st, 800);
    const ev: SimEvent[] = [];
    let crushedAt = -1;
    for (let f = 0; f < 900 && crushedAt < 0; f++) {
      step(st, [(f % 40 === 0 ? Btn.H : f % 40 === 20 ? Btn.K : 0) | (f % 20 > 8 ? R : 0), Btn.Guard]);
      ev.push(...st.events);
      if (st.events.some((e) => e.type === 'guardCrush')) crushedAt = f;
    }
    check('guard crush after sustained blocking', crushedAt > 0 && ev.filter((e) => e.type === 'block').length >= 3, `blocks ${ev.filter((e) => e.type === 'block').length}`);
    check('guard crush: defender staggered (hitstun), meter refilled', F(st, 1).mode === 'hitstun' && F(st, 1).pose === 'stagger' && F(st, 1).sim?.guard === GUARD_MAX);
    const ev2 = run(st, 70, (f) => (f < 50 ? D | R | (f % 3 === 0 ? Btn.H : 0) : 0), Btn.Guard);
    check('guard crush is punishable with a launcher', ev2.some((e) => e.type === 'launch'));
    const st2 = training('kaito', 'goro'); place(st2, 800);
    run(st2, 40, seq(Btn.H), Btn.Guard);
    const g0 = F(st2, 1).sim?.guard ?? 0;
    run(st2, 200);
    check('guard meter drains on block and regenerates', g0 < GUARD_MAX && F(st2, 1).sim?.guard === GUARD_MAX, `${g0}`);
  }
  // ground hits (OTG): sweep knockdown, then a ground-hit move connects once
  {
    const st = training('kaito', 'goro', { trainingOpts: { hpRegen: false } }); place(st, 800);
    const ev = run(st, 160, (f) => (f === 0 || f === 66 || f === 100 ? D | Btn.K : 0));
    const otg = ev.filter((e) => e.type === 'hit' && e.tag === 'otg');
    check('2K sweep hits a knocked-down opponent (otg)', otg.length === 1, `${otg.length}`);
    const st2 = training('kaito', 'goro'); place(st2, 800);
    const ev2 = run(st2, 120, (f) => (f === 0 ? D | Btn.K : f === 66 ? D | Btn.L : 0));
    check('non-otg moves do not hit a lying opponent', ev2.filter((e) => e.type === 'hit').length === 1);
    const st3 = training('goro', 'kaito'); place(st3, 800);
    const ev3 = run(st3, 160, (f) => (f === 0 ? D | Btn.K : f === 66 ? Btn.Left | Btn.K : 0));
    check('Goro 4K Quake Stomp is a ground hit', ev3.some((e) => e.type === 'hit' && e.tag === 'otg' && e.moveId === 'goro_stomp'));
  }
  // armor: lows go through Stone Skin
  {
    const st = training('goro', 'kaito'); place(st, 1000);
    const ev = run(st, 40, seq(Btn.H), seq(D | Btn.L));
    check('Stone Skin does not absorb lows', !ev.some((e) => e.tag === 'armor') && ev.some((e) => e.type === 'hit' && e.player === 1));
  }
  // grounded (non-counter) bounce move = knockdown, no bounce
  {
    const st = training('kaito', 'goro'); place(st, 900);
    const ev = run(st, 80, seq(D, D | Btn.Left, Btn.Left | Btn.S));
    check('Cinder Drop on a standing opponent knocks down (bounce only on CH / juggle)', ev.some((e) => e.type === 'hit' && e.moveId === 'kaito_cinder_drop') && !ev.some((e) => e.type === 'groundBounce'));
  }
  // beam clash: rotating the stick counts as mashing
  {
    const st = training('kaito', 'goro'); place(st, 3000);
    F(st, 0).ki = 300; F(st, 1).ki = 300;
    const rot = [Btn.Up, Btn.Right, Btn.Down, Btn.Left];
    const ev = run(st, 300, (f) => (f === 0 ? D : f === 1 ? D | R : f === 2 ? R | Btn.S | Btn.K : f > 40 ? rot[(f >> 1) & 3] : 0),
      (f) => (f === 0 ? D : f === 1 ? D | Btn.Left : f === 2 ? Btn.Left | Btn.S | Btn.K : 0));
    const end = ev.find((e) => e.type === 'clashEnd');
    check('clash: stick rotation alone wins the mash', ev.some((e) => e.type === 'clashStart') && !!end && end.player === 0);
  }
  // ultimate hit-freeze
  {
    const st = training('kaito', 'goro', { trainingOpts: { hpRegen: false } }); place(st, 1200);
    F(st, 0).ki = 300;
    let freezeOnConnect = -1, freezeOnFinal = -1;
    for (let f = 0; f < 320; f++) {
      step(st, [seq(D, D | R, R | Btn.H | Btn.S)(f), 0]);
      if (freezeOnConnect < 0 && st.ult) freezeOnConnect = st.ult.freeze ?? 0;
      if (st.events.some((e) => e.type === 'ultimateHit' && e.tag === 'final')) freezeOnFinal = st.ult?.freeze ?? -1;
    }
    check(`ultimate connect + final hit freeze ${ULT_FREEZE} frames`, freezeOnConnect === ULT_FREEZE && freezeOnFinal === ULT_FREEZE, `${freezeOnConnect} / ${freezeOnFinal}`);
    check('hitstop cleared after the cinematic', F(st, 0).hitstop === 0 && F(st, 1).hitstop === 0 && !st.ult);
  }
  // stagger only from a fresh hit (no stagger loops)
  {
    const st = training('shiori', 'kaito'); place(st, 900);
    const ev = run(st, 120, (f) => [Btn.Left, D | Btn.Left, D, D | R, R | Btn.S][f] ?? [Btn.Left, D | Btn.Left, D, D | R, R | Btn.S][f - 40] ?? 0);
    const st1 = ev.filter((e) => e.type === 'hit' && e.moveId === 'shiori_shadow_stitch');
    check('Shadow Stitch staggers; a 2nd stitch in the combo does not re-stagger', st1.length >= 1 && (st1.length < 2 || F(st, 1).pose !== 'stagger' || F(st, 1).mode !== 'hitstun'));
  }
  // lows are punishable on block (measured)
  {
    const st = training('kaito', 'goro'); place(st, 700);
    run(st, 60, seq(D | Btn.L, D), D | R);
    check('Kaito 2L -12 on block (measured)', st.frameAdv?.value === -12, `got ${st.frameAdv?.value}`);
  }
}

// ---------------------------------------------------------------- (j) data rules
section('(j) move data rules: punishable launchers / lows, accurate onBlock / onHitAdv');
{
  for (const c of ALL_CHARS) for (const m of getChar(c).moves) {
    if (m.internal || m.kind === 'ultimate' || m.hitboxes.length === 0) continue;
    const launches = m.onHit === 'launch' || m.onCounterHit === 'launch';
    if (launches) check(`${m.id}: launcher is punishable on block (<= -10)`, (m.onBlock ?? 0) <= -10, `${m.onBlock}`);
    if (m.height === 'low') check(`${m.id}: low is punishable on block (<= -12)`, (m.onBlock ?? 0) <= -12, `${m.onBlock}`);
    if (m.height === 'throw') continue;
    let lastFrom = 0;
    for (const hb of m.hitboxes) lastFrom = Math.max(lastFrom, hb.from);
    const remaining = totalFrames(m) - lastFrom;
    check(`${m.id}: onBlock matches blockstun`, m.onBlock === m.blockstun - remaining, `${m.onBlock} vs ${m.blockstun - remaining}`);
    if (m.onHitAdv !== undefined && m.onHit !== 'stagger') check(`${m.id}: onHitAdv matches hitstun`, m.onHitAdv === m.hitstun - remaining);
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
