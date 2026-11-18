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
import { PREJUMP, INTRO_FRAMES } from '../src/sim/constants';

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
    check('launcher -13 on block (measured)', st2.frameAdv?.value === -13, `got ${st2.frameAdv?.value}`);
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
    const st = training('kaito', 'shiori'); place(st, 900);
    const plan: Record<number, number> = { 0: D | R | Btn.H, 46: Btn.L, 60: Btn.L, 74: Btn.H };
    const ev = run(st, 140, (f) => plan[f] ?? (f > 20 && f < 70 ? R : 0));
    const hits = ev.filter((e) => e.type === 'hit' && e.player === 0);
    check('launcher launches', ev.some((e) => e.type === 'launch'));
    check('juggle follow-ups connect (4-hit combo)', hits.length >= 4, `${hits.length} hits`);
    check('juggle ends in knockdown', ev.some((e) => e.type === 'knockdown'));
    check('juggle hits are scaled 100/90/80/70%', hits.length >= 4 && hits[1].damage === 40 && hits[2].damage === 32 && hits[3].damage === 49, hits.map((h) => h.damage).join());
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
    const ev4 = run(st4, 90, seq(R, D, D | R | Btn.S), (f) => (f > 10 && f < 40 ? Btn.L : 0) | D);
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
    check('awaken below 35%: event, heal, awakened', ev3.some((e) => e.type === 'awaken') && F(st3, 0).awakened && F(st3, 0).hp === 400 && F(st3, 0).awakenUsed);
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

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
