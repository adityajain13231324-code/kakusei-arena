/**
 * Netcode tests (headless). Run: npm run test:net
 * Two RollbackSession peers connected by a fake transport with configurable latency, jitter
 * and packet loss, driven by a virtual clock. Each scenario plays random inputs for 3000 frames and checks:
 *   - every exchanged confirmed-state hash matches (no desync),
 *   - an offline replay of the confirmed input streams reproduces the same hash,
 *   - rollbacks actually happen when there is latency,
 *   - every event of the final timeline was presented, without large duplication.
 */
import { createMatch, step, hashState, Btn, type GameState, type MatchConfig, type SimEvent } from '../src/sim/index';
import { makeRng } from '../src/core/rng';
import { RollbackSession, MAX_PREDICTION } from '../src/net/rollback';
import type { RollbackMsg } from '../src/net/protocol';
import { isReliable, makeRoomCode, normalizeRoomCode } from '../src/net/protocol';

let failures = 0, passes = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passes++; console.log(`  ok   ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failures++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

function inputGen(seed: number): () => number {
  const r = makeRng(seed);
  let cur = 0, hold = 0;
  return () => {
    if (hold-- <= 0) {
      hold = r() % 10;
      let v = 0;
      const d = r() % 10;
      if (d < 3) v |= Btn.Right; else if (d < 5) v |= Btn.Left;
      const ud = r() % 12;
      if (ud === 0) v |= Btn.Up; else if (ud < 3) v |= Btn.Down;
      const b = r() % 12;
      if (b < 7) v |= [Btn.L, Btn.H, Btn.K, Btn.S, Btn.Guard, Btn.L | Btn.K, Btn.H | Btn.K][b];
      cur = v;
    }
    return cur;
  };
}

interface NetCfg { name: string; latency: number; jitter: number; loss: number; skew?: number; frames?: number; corruptAt?: number; blackout?: [number, number] }

interface Packet { at: number; to: 0 | 1; msg: RollbackMsg }

function run(c: NetCfg) {
  const frames = c.frames ?? 3000;
  const cfg: MatchConfig = { p1: 'kaito', p2: 'goro', stage: 'rooftop', seed: 4242, roundsToWin: 2, schemes: ['pro', 'easy'] };
  const rnd = makeRng(99 + Math.round(c.latency * 7 + c.loss * 1000));
  const u = () => (rnd() % 1_000_000) / 1_000_000;
  let now = 0;
  const queue: Packet[] = [];
  const lastReliableAt: [number, number] = [0, 0];
  const presented: [SimEvent[], SimEvent[]] = [[], []];
  const desyncs: number[] = [];

  const hashes: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];
  const mkSend = (from: 0 | 1) => (msg: RollbackMsg) => {
    const to = (1 - from) as 0 | 1;
    if (msg.t === 'hash') hashes[from].set(msg.f, msg.h);
    const copy = JSON.parse(JSON.stringify(msg)) as RollbackMsg;
    const inBlackout = c.blackout && now >= c.blackout[0] && now < c.blackout[1];
    if (isReliable(copy)) {
      let at = now + c.latency + u() * c.jitter;
      if (inBlackout) at = Math.max(at, c.blackout![1] + c.latency);
      at = Math.max(at, lastReliableAt[to]);
      lastReliableAt[to] = at;
      queue.push({ at, to, msg: copy });
    } else {
      if (inBlackout || u() < c.loss) return;
      queue.push({ at: now + c.latency + u() * c.jitter, to, msg: copy });
    }
  };
  const peers: [RollbackSession, RollbackSession] = [0, 1].map((i) => new RollbackSession({
    localSlot: i as 0 | 1, isHost: i === 0, initial: createMatch(cfg), send: mkSend(i as 0 | 1), now: () => now,
    onEvents: (ev) => presented[i].push(...ev),
    onDesync: (d) => desyncs.push(d.frame),
  })) as [RollbackSession, RollbackSession];
  const gens = [inputGen(11), inputGen(22)];
  const period = [1000 / 60, (1000 / 60) * (1 + (c.skew ?? 0))];
  const nextTick = [0, 3 + c.latency * 0.5]; // guest starts a little later (it got 'start' over the wire)
  let maxAhead = 0;
  let corrupted = false;
  const tEnd = (frames / 60) * 1000 * 3 + 20000;
  for (now = 0; now < tEnd; now += 0.5) {
    queue.sort((a, b) => a.at - b.at);
    while (queue.length && queue[0].at <= now) { const p = queue.shift()!; peers[p.to].receive(p.msg); }
    for (const i of [0, 1] as const) {
      if (now >= nextTick[i]) {
        nextTick[i] += period[i];
        peers[i].tick(gens[i]());
        if (c.corruptAt && !corrupted && i === 1 && peers[1].curFrame === c.corruptAt) {
          // simulate a non-deterministic bug on the guest
          peers[1].state.fighters[0].hp -= 37;
          corrupted = true;
        }
      }
    }
    maxAhead = Math.max(maxAhead, Math.abs(peers[0].curFrame - peers[1].curFrame));
    if (peers[0].confirmedFrame >= frames + 31 && peers[1].confirmedFrame >= frames + 31) break;
  }
  return { peers, presented, desyncs, maxAhead, cfg, frames, hashes };
}

function replay(cfg: MatchConfig, p0: number[], p1: number[], upto: number) {
  const st = createMatch(cfg);
  const events: SimEvent[] = [];
  const hashes = new Map<number, number>();
  for (let f = 0; f <= upto; f++) {
    step(st, [p0[f] ?? 0, p1[f] ?? 0]);
    events.push(...st.events);
    if (f % 30 === 0) hashes.set(f, hashState(st));
  }
  return { st, events, hashes };
}

const key = (e: SimEvent) => `${e.frame}|${e.type}|${e.player}|${e.target ?? ''}|${e.moveId ?? ''}|${e.tag ?? ''}`;

const SCENARIOS: NetCfg[] = [
  { name: 'LAN 0 ms, no loss', latency: 0, jitter: 0, loss: 0 },
  { name: '30 ms ±5, 1% loss', latency: 30, jitter: 5, loss: 0.01 },
  { name: '80 ms ±20, 3% loss, clock skew +0.3%', latency: 80, jitter: 20, loss: 0.03, skew: 0.003 },
  { name: '150 ms ±30, 10% loss, clock skew -0.5%', latency: 150, jitter: 30, loss: 0.10, skew: -0.005 },
];

console.log('KAKUSEI ARENA netcode tests');
const t0 = Date.now();
for (const sc of SCENARIOS) {
  console.log(`\n== ${sc.name}`);
  const r = run(sc);
  const [a, b] = r.peers;
  check('both peers reached frame ' + r.frames, a.confirmedFrame >= r.frames && b.confirmedFrame >= r.frames, `host ${a.confirmedFrame} guest ${b.confirmedFrame}`);
  // hash comparison over every 30th confirmed frame
  let compared = 0, mismatched = 0;
  for (const [f, h] of r.hashes[0]) { const o = r.hashes[1].get(f); if (o === undefined) continue; compared++; if (o !== h) mismatched++; }
  check('confirmed-state hashes equal on both peers', compared >= r.frames / 30 - 2 && mismatched === 0, `${compared} compared, ${mismatched} mismatched`);
  check('no desync reported', r.desyncs.length === 0 && a.stats.desyncs === 0 && b.stats.desyncs === 0);
  // offline replay of the confirmed input streams
  const p0 = a.local, p1 = b.local;
  const sameStreams = p0.slice(0, r.frames + 1).every((v, f) => b.remote[f] === v) && p1.slice(0, r.frames + 1).every((v, f) => a.remote[f] === v);
  check('both peers agree on both input streams', sameStreams);
  const rep = replay(r.cfg, p0, p1, r.frames);
  const fl = Math.floor(r.frames / 30) * 30;
  check('offline replay matches online hash @' + fl, rep.hashes.get(fl) === r.hashes[0].get(fl) && rep.hashes.get(fl) === r.hashes[1].get(fl));
  const rolled = a.stats.rollbacks + b.stats.rollbacks;
  if (sc.latency > 0) check('rollbacks happened', rolled > 0, `host ${a.stats.rollbacks} (max ${a.stats.maxRollback}f) guest ${b.stats.rollbacks} (max ${b.stats.maxRollback}f)`);
  check('rollback depth within prediction window', a.stats.maxRollback <= MAX_PREDICTION && b.stats.maxRollback <= MAX_PREDICTION, `${a.stats.maxRollback}/${b.stats.maxRollback}`);
  check('peers stay in time sync', r.maxAhead <= MAX_PREDICTION + 3, `max frame gap ${r.maxAhead}, waits ${a.stats.waits}/${b.stats.waits}, stalls ${a.stats.stallTicks}/${b.stats.stallTicks}, delay ${a.delay}/${b.delay}, rtt ${a.rtt.toFixed(0)}ms`);
  // events: every event of the final timeline was presented on each peer; limited duplication
  const ref = rep.events.filter((e) => e.frame <= r.frames - 2);
  for (const i of [0, 1] as const) {
    const got = new Map<string, number>();
    for (const e of r.presented[i]) got.set(key(e), (got.get(key(e)) ?? 0) + 1);
    const want = new Map<string, number>();
    for (const e of ref) want.set(key(e), (want.get(key(e)) ?? 0) + 1);
    let missing = 0;
    for (const [k, n] of want) if ((got.get(k) ?? 0) < n) missing++;
    const presentedInRange = r.presented[i].filter((e) => e.frame <= r.frames - 2).length;
    const ratio = presentedInRange / Math.max(1, ref.length);
    const exact = sc.latency === 0 ? presentedInRange === ref.length : ratio <= 1.25;
    check(`${i === 0 ? 'host' : 'guest'} events: none missing, no re-forward on resim`, missing === 0 && exact, `${ref.length} ref events, presented ratio ${ratio.toFixed(3)}, missing ${missing}`);
  }
}

console.log('\n== desync detection + host resync (guest state corrupted at frame 600, 60 ms)');
{
  const r = run({ name: 'resync', latency: 60, jitter: 10, loss: 0.02, corruptAt: 600, frames: 1500 });
  const [a, b] = r.peers;
  check('desync detected', r.desyncs.length > 0 && a.stats.desyncs > 0, `frames ${[...new Set(r.desyncs)].join(',')}`);
  check('host sent / guest applied resync', a.stats.resyncs >= 1 && b.stats.resyncs >= 1, `${a.stats.resyncs}/${b.stats.resyncs}`);
  let compared = 0, mismatched = 0;
  for (const [f, h] of r.hashes[0]) { if (f <= 900) continue; const o = r.hashes[1].get(f); if (o === undefined) continue; compared++; if (o !== h) mismatched++; }
  check('hashes equal again after resync', compared > 10 && mismatched === 0, `${compared} compared after f900, ${mismatched} mismatched`);
}

console.log('\n== connection blackout (1.5 s, all packets dropped)');
{
  const r = run({ name: 'blackout', latency: 40, jitter: 5, loss: 0, blackout: [10000, 11500], frames: 1500 });
  const [a, b] = r.peers;
  check('peers stalled during blackout (waiting indicator)', a.stats.stallTicks > 30 && b.stats.stallTicks > 30, `${a.stats.stallTicks}/${b.stats.stallTicks} stall ticks`);
  let mismatched = 0, compared = 0;
  for (const [f, h] of r.hashes[0]) { const o = r.hashes[1].get(f); if (o === undefined) continue; compared++; if (o !== h) mismatched++; }
  check('recovered with no desync', a.confirmedFrame >= 1500 && mismatched === 0 && compared > 40, `${compared} compared`);
}

console.log('\n== room codes');
{
  const codes = Array.from({ length: 200 }, () => makeRoomCode());
  check('codes are 6 chars without ambiguous letters', codes.every((c) => /^[A-HJ-NP-Z2-9]{6}$/.test(c)));
  check('normalize accepts lowercase / spaces / pasted link', normalizeRoomCode(' ab c-d2 3 ') === 'ABCD23' && normalizeRoomCode('https://x.app/#join-QWERTY') === 'QWERTY' && normalizeRoomCode('abc') === null);
}

console.log(`\n${passes} passed, ${failures} failed  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (failures) (globalThis as unknown as { process: { exit(c: number): void } }).process.exit(1);
