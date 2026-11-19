/**
 * CPU controller. A pure function of (GameState, its own plain-data memory):
 * the PRNG is re-seeded every frame from (player, difficulty, state.frame, state.seed), never Math.random.
 * Look-ahead uses cloneState + step on a scratch copy (deterministic, never touches the live state).
 */
import {
  Btn, type CharId, type FighterState, type GameState, type InputBits, type MoveDef,
} from '../sim/types';
import { cloneState, step as simStep, getMove, getChar } from '../sim/index';
import { PROFILES, PERSONALITY, type Difficulty, type Profile } from './profiles';
import {
  catalog, moveFrames, toRaw, R_FWD, R_BACK, R_DOWN, R_UP, type CharCatalog, type MoveInfo,
} from './moves';

export type { Difficulty };

type Posture = 'none' | 'in' | 'out' | 'guard' | 'cguard' | 'charge' | 'crouch';

/** plain data only */
interface Mem {
  last: number;
  plan: number[];
  post: Posture;
  postUntil: number;
  nextDecide: number;
  oppKey: number; // frame the opponent's current move started
  oppId: string;
  oppReact: number;
  answered: number; // oppKey already answered
  punishKey: number;
  punishTries: number;
  punishRoll: number; // 0 unknown, 1 yes, 2 no
  contactKey: number; // my move start frame that already got a follow-up decision
  juggleTick: number;
  airTick: number;
  projSeen: Record<string, number>;
  breakKey: number;
  breakAt: number;
  techAt: number;
  techKey: number;
  mashN: number;
  awakeAt: number;
  chargeUntil: number;
}

function freshMem(): Mem {
  return {
    last: -1, plan: [], post: 'none', postUntil: 0, nextDecide: 0, oppKey: -1, oppId: '', oppReact: 0, answered: -1,
    punishKey: -1, punishTries: 0, punishRoll: 0, contactKey: -1, juggleTick: 0, airTick: 0, projSeen: {},
    breakKey: -1, breakAt: 0, techAt: 0, techKey: -1, mashN: 0, awakeAt: -1, chargeUntil: 0,
  };
}

// ---------------------------------------------------------------- tiny deterministic PRNG
function mix(a: number): number {
  a = Math.imul(a ^ (a >>> 16), 0x85ebca6b);
  a = Math.imul(a ^ (a >>> 13), 0xc2b2ae35);
  return (a ^ (a >>> 16)) >>> 0;
}
class Rng {
  s: number;
  constructor(seed: number) { this.s = mix(seed) || 1; }
  next(): number { // xorshift32 -> [0,1)
    let x = this.s | 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.s = x | 0;
    return (x >>> 0) / 4294967296;
  }
  chance(p: number): boolean { return this.next() < p; }
  int(n: number): number { return Math.floor(this.next() * n); }
}

const DIFF_SALT: Record<Difficulty, number> = { easy: 11, normal: 23, hard: 37, nightmare: 59 };

// ---------------------------------------------------------------- geometry helpers
function hdist(a: FighterState, b: FighterState): number {
  const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
  return Math.sqrt(dx * dx + dz * dz);
}
/** body radius (mm) straight from the character data */
function radiusOf(id: CharId): number { return getChar(id).radius; }
const FREE_MODES = new Set(['idle', 'walk', 'crouch', 'guard', 'sidewalk', 'kicharge']);

function lastActive(m: MoveDef): number {
  let t = m.startup + m.active;
  for (const hb of m.hitboxes) t = Math.max(t, hb.to);
  return t;
}

interface Threat { kind: 'melee' | 'throw' | 'unb' | 'proj'; low: boolean; frames: number; mi: MoveInfo | null; key: number; remain: number; track: 'none' | 'left' | 'right' | 'full' }

export class CpuController {
  private mem: Mem = freshMem();
  private prof: Profile;

  constructor(public player: 0 | 1, public difficulty: Difficulty) {
    this.prof = PROFILES[difficulty];
  }

  setDifficulty(d: Difficulty): void { this.difficulty = d; this.prof = PROFILES[d]; }
  reset(): void { this.mem = freshMem(); }

  think(state: GameState): InputBits {
    const mem = this.mem;
    if (state.frame <= mem.last || state.round.phaseFrame === 0 && state.round.phase !== 'fight') {
      if (state.frame < mem.last || state.frame === 0) this.mem = freshMem();
    }
    const m = this.mem;
    m.last = state.frame;
    if (state.round.phase !== 'fight') { m.plan.length = 0; m.post = 'none'; return 0; }
    // state.seed (the sim PRNG state) is mixed in so every match plays out differently, still a pure function of the state
    const rng = new Rng(((state.frame + 1) * 2654435761 + this.player * 40503 + DIFF_SALT[this.difficulty]) ^ mix(state.seed | 0));
    const me = state.fighters[this.player];
    const rel = this.decide(state, rng);
    return toRaw(rel & ~(Btn.Guard | Btn.Ult | Btn.L | Btn.H | Btn.K | Btn.S), me.side) | (rel & (Btn.Guard | Btn.Ult | Btn.L | Btn.H | Btn.K | Btn.S));
  }

  // ================================================================ brain (returns FACING-RELATIVE bits)
  private decide(state: GameState, rng: Rng): number {
    const mem = this.mem, P = this.prof;
    const pi = this.player;
    const me = state.fighters[pi], opp = state.fighters[1 - pi];
    const cat = catalog(me.char), ocat = catalog(opp.char);
    const pers = PERSONALITY[me.char];
    const dist = hdist(me, opp);
    const oR = radiusOf(opp.char), mR = radiusOf(me.char);

    // ---- global states
    if (state.clash.active) {
      mem.mashN++;
      if (mem.mashN % P.mash === 0) return [Btn.L, Btn.H, Btn.K, Btn.S][(mem.mashN / P.mash) & 3];
      return 0;
    }
    if (state.ult) return 0;

    // ---- opponent move bookkeeping (reaction timers)
    if (opp.mode === 'attack' && opp.moveId) {
      const key = state.frame - opp.moveFrame;
      if (key !== mem.oppKey || opp.moveId !== mem.oppId) {
        mem.oppKey = key; mem.oppId = opp.moveId;
        mem.oppReact = P.react + rng.int(P.jitter + 1);
        mem.punishRoll = 0; mem.punishTries = 0;
      }
    }
    for (const p of state.projectiles) {
      const k = String(p.id);
      if (mem.projSeen[k] === undefined) mem.projSeen[k] = state.frame;
    }
    if (state.frame % 120 === 0) {
      const alive: Record<string, number> = {};
      for (const p of state.projectiles) alive[String(p.id)] = mem.projSeen[String(p.id)];
      mem.projSeen = alive;
    }

    // ---- states where we cannot act
    switch (me.mode) {
      case 'thrown': return this.throwBreak(state, me, rng);
      case 'knockdown': return this.techRoll(state, me, rng);
      case 'hitstun': case 'juggle': case 'wallsplat': case 'awaken': case 'vanish': case 'intro': case 'win': case 'lose': case 'clash':
        mem.plan.length = 0; mem.post = 'none';
        return 0;
      case 'wakeup': return 0;
    }

    // ---- blockstun: keep guarding, switch crouch for lows, buffer a punish
    if (me.mode === 'blockstun') return this.blockstun(state, me, opp, cat, ocat, rng);

    // ---- attacking: follow-ups / stance hold / plan frames
    if (me.mode === 'attack') return this.attacking(state, me, opp, cat, ocat, rng);

    // ---- queued frames (motions, dashes ...)
    if (mem.plan.length) return mem.plan.shift()!;

    const free = FREE_MODES.has(me.mode) || me.mode === 'dash' || me.mode === 'sidestep' || (me.mode === 'backdash' && me.modeFrame >= 12);
    if (!free) return 0;

    // ---- awaken (invulnerable, heals, opponent frozen)
    if (!me.awakenUsed && me.hp * 100 < me.maxHp * 35 && opp.mode !== 'juggle') {
      if (mem.awakeAt < 0) mem.awakeAt = state.frame + Math.floor(P.react * (0.5 + rng.next()));
      if (state.frame >= mem.awakeAt && rng.chance(P.ult + 0.05)) { mem.awakeAt = -1; return Btn.L | Btn.H | Btn.K; }
    }

    // ---- juggle / combo conversion
    if (opp.mode === 'juggle' || opp.mode === 'wallsplat') {
      const r = this.juggle(state, me, opp, cat, rng);
      if (r !== null) return r;
      return this.faceNeutral(me);
    }

    // ---- threats
    const th = this.threat(state, me, opp, ocat, dist, mR);
    const ready = th ? this.perceived(state, th, rng) : false;

    // ---- punish a recovering opponent
    const pun = this.punish(state, me, opp, cat, ocat, dist, rng);
    if (pun !== null) return pun;

    if (th && ready) {
      const r = this.respond(state, me, opp, cat, th, dist, rng);
      if (r !== null) return r;
    }

    // ---- anti-air
    if (opp.airborne && opp.mode === 'jump' && dist < 1900 && P.antiAir > 0) {
      const r = this.antiAir(state, me, opp, cat, dist, rng);
      if (r !== null) return r;
    }

    // ---- held posture (guard, walking ...)
    if (mem.post !== 'none') {
      if (state.frame < mem.postUntil && !(mem.post === 'charge' && (dist < 1700 || th))) return this.postureBits(mem.post, me);
      mem.post = 'none';
    }

    if (state.frame < mem.nextDecide) return this.idleBits(state, me, opp);
    mem.nextDecide = state.frame + Math.max(2, Math.floor(P.interval * (0.6 + 0.8 * rng.next())));
    return this.neutral(state, me, opp, cat, ocat, pers, dist, oR, rng);
  }

  // ---------------------------------------------------------------- small helpers
  private faceNeutral(me: FighterState): number { return me.mode === 'crouch' ? R_DOWN : 0; }

  private idleBits(state: GameState, me: FighterState, opp: FighterState): number {
    void state; void me; void opp;
    return 0;
  }

  private postureBits(p: Posture, me: FighterState): number {
    void me;
    switch (p) {
      case 'in': return R_FWD;
      case 'out': return R_BACK;
      case 'guard': return Btn.Guard;
      case 'cguard': return Btn.Guard | R_DOWN;
      case 'charge': return Btn.S;
      case 'crouch': return R_DOWN;
      default: return 0;
    }
  }

  private scheme(state: GameState): 'pro' | 'easy' { return state.schemes[this.player]; }

  /** frames to execute a move now */
  private frames(state: GameState, me: FighterState, mi: MoveInfo): number[] {
    return moveFrames(mi, this.scheme(state), me.lastInputs);
  }

  private canUse(me: FighterState, mi: MoveInfo): boolean {
    if (mi.m.requires === 'awakened' && !me.awakened) return false;
    if (mi.kind === 'ki' && me.ki < mi.kiCost) return false;
    if (mi.kind === 'ultimate' && me.ki < (me.awakened ? 200 : 300)) return false;
    return true;
  }

  private ultOf(me: FighterState, cat: CharCatalog): MoveInfo { return me.awakened && cat.ultAw ? cat.ultAw : cat.ult; }

  /** simulate `frames` for me (opponent neutral) and return damage dealt and whether it was only blocked */
  private lookahead(state: GameState, frames: number[], horizon: number, oppInputs?: number): number {
    const pi = this.player;
    const sim = cloneState(state);
    const oppIdx = 1 - pi;
    const hp0 = sim.fighters[oppIdx].hp;
    const inp: [number, number] = [0, 0];
    let guard = 0;
    for (let k = 0; k < horizon; k++) {
      const me = sim.fighters[pi];
      inp[pi] = k < frames.length ? this.rawOf(frames[k], me.side) : 0;
      inp[oppIdx] = oppInputs ?? 0;
      simStep(sim, inp);
      if (sim.ult) { // cinematic ultimate connected: count it
        return hp0 - sim.fighters[oppIdx].hp + 200;
      }
      for (const e of sim.events) {
        if (e.player === pi && e.type === 'block') guard++;
        if (e.player === pi && e.type === 'hit' && e.target === oppIdx && e.tag === 'ultimate') return 330;
      }
      if (guard) return 0;
    }
    return hp0 - sim.fighters[oppIdx].hp;
  }
  private rawOf(rel: number, side: -1 | 1): number {
    return toRaw(rel & ~(Btn.Guard | Btn.Ult | Btn.L | Btn.H | Btn.K | Btn.S), side) | (rel & (Btn.Guard | Btn.Ult | Btn.L | Btn.H | Btn.K | Btn.S));
  }

  // ---------------------------------------------------------------- thrown / knockdown / clash
  private throwBreak(state: GameState, me: FighterState, rng: Rng): number {
    const mem = this.mem, P = this.prof;
    const key = state.frame - me.modeFrame;
    if (mem.breakKey !== key) {
      mem.breakKey = key;
      mem.breakAt = rng.chance(P.tech) ? Math.round(P.react * 0.7 + rng.int(P.jitter + 1)) : 99;
      if (rng.chance(0.06)) mem.breakAt = 2 + rng.int(14); // lucky guess
    }
    if (me.modeFrame >= mem.breakAt && me.modeFrame <= 18) return rng.chance(0.5) ? Btn.L : Btn.K;
    return 0;
  }

  private techRoll(state: GameState, me: FighterState, rng: Rng): number {
    const mem = this.mem, P = this.prof;
    const key = state.frame - me.modeFrame;
    if (mem.techKey !== key) { mem.techKey = key; mem.techAt = rng.chance(P.tech) ? 14 + rng.int(14) : 99; }
    if (me.modeFrame >= mem.techAt) return Btn.L;
    return 0;
  }

  // ---------------------------------------------------------------- blockstun
  private blockstun(state: GameState, me: FighterState, opp: FighterState, cat: CharCatalog, ocat: CharCatalog, rng: Rng): number {
    const mem = this.mem;
    const dist = hdist(me, opp);
    const th = this.threat(state, me, opp, ocat, dist, radiusOf(me.char));
    let low = me.pose === 'guardLow';
    if (th && th.kind !== 'throw' && th.kind !== 'unb' && this.perceived(state, th, rng)) low = th.low;
    // buffered punish: input the punisher a few frames before blockstun ends
    if (mem.plan.length) return mem.plan.shift()!;
    if (me.stun <= 5 && opp.mode === 'attack') {
      const p = this.punish(state, me, opp, cat, ocat, dist, rng, me.stun);
      if (p !== null) return p;
    }
    return Btn.Guard | (low ? R_DOWN : 0);
  }

  // ---------------------------------------------------------------- attacking: cancels, strings, stance
  private attacking(state: GameState, me: FighterState, opp: FighterState, cat: CharCatalog, ocat: CharCatalog, rng: Rng): number {
    const mem = this.mem, P = this.prof;
    void ocat;
    const mi = me.moveId ? cat.byId[me.moveId] : undefined;
    // Ren sheath stance: hold S, release to draw
    if (mi && mi.m.stance && me.moveId === mi.id) {
      const dist = hdist(me, opp);
      const held = me.modeFrame - mi.m.stance.loopFrame;
      const qd = cat.byId[mi.m.stance.releaseMove];
      const inRange = qd && dist <= qd.reach + 0.65 * radiusOf(opp.char) - 80;
      const oppAttacking = opp.mode === 'attack';
      if (held < 4) return Btn.S;
      if (oppAttacking && !inRange) return Btn.S; // wait for the parry
      if (inRange && !oppAttacking && rng.chance(0.35 + 0.1)) return 0; // draw
      if (held > 40 + P.interval * 3) return 0;
      if (opp.mode === 'knockdown' || opp.mode === 'juggle') return 0;
      return Btn.S;
    }
    if (mem.plan.length) return mem.plan.shift()!;
    if (!mi) return 0;
    // contact follow-ups (once per move)
    const key = state.frame - me.moveFrame;
    if (mem.contactKey === key) return 0;
    let contact = 0;
    for (const e of state.events) {
      if (e.player === this.player && e.moveId === me.moveId && (e.type === 'hit' || e.type === 'block') && e.tag !== 'heat') contact = e.type === 'hit' ? 1 : 2;
    }
    if (!contact) return 0;
    mem.contactKey = key;
    if (contact === 2 && !rng.chance(0.25 * P.confirm)) return 0;
    if (!rng.chance(P.confirm)) return 0;
    const hs = Math.max(me.hitstop, 0);
    const cancels = mi.m.cancelInto ?? [];
    // 1) ultimate cancel on hit
    if (contact === 1 && cancels.indexOf('ultimate') >= 0 && rng.chance(P.ult)) {
      const u = this.ultOf(me, cat);
      if (this.canUse(me, u)) {
        const f = this.padded(this.frames(state, me, u), hs);
        if (this.lookahead(state, f, f.length + 22) > 0) { mem.plan = f.slice(1); return f[0]; }
      }
    }
    // 2) string continuation
    const next = this.chain(mi, cat, rng, contact);
    // 3) special cancel
    let best: { f: number[]; dmg: number } | null = null;
    if (cancels.indexOf('special') >= 0 && contact === 1) {
      for (const sp of cat.specials) {
        if (sp.m.stance || !this.canUse(me, sp) || sp.m.requires === 'stance') continue;
        if (sp.projectile && !rng.chance(0.3)) continue;
        const f = this.padded(this.frames(state, me, sp), hs);
        const dmg = this.lookahead(state, f, f.length + sp.startup + sp.m.active + 3);
        if (dmg > 0 && (!best || dmg > best.dmg)) best = { f, dmg };
      }
    }
    if (best && (!next || best.dmg > 60)) { mem.plan = best.f.slice(1); return best.f[0]; }
    if (next) return next;
    return 0;
  }

  /** insert neutral frames so the move's final (button) frame lands at the end of hitstop */
  private padded(frames: number[], hitstop: number): number[] {
    const pad = Math.max(0, hitstop - frames.length);
    const out: number[] = [];
    for (let i = 0; i < pad; i++) out.push(0);
    return out.concat(frames);
  }

  private chain(mi: MoveInfo, cat: CharCatalog, rng: Rng, contact: number): number {
    const opts: string[] = [];
    for (const tok of ['L', 'H', 'K']) {
      const id = cat.all.find((a) => a.m.input === `${mi.m.input},${tok}`);
      if (id) opts.push(tok);
    }
    if (!opts.length) return 0;
    if (contact === 2 && mi.onBlock < -3) return 0;
    const t = opts[rng.int(opts.length)];
    return t === 'L' ? Btn.L : t === 'H' ? Btn.H : Btn.K;
  }

  // ---------------------------------------------------------------- juggle conversion
  private juggle(state: GameState, me: FighterState, opp: FighterState, cat: CharCatalog, rng: Rng): number | null {
    const mem = this.mem, P = this.prof;
    if (opp.comboHits > P.juggleCap) return null;
    if (state.frame % 2 !== 0) return 0;
    if (!rng.chance(0.15 + P.combo * 0.85)) return null;
    // decide once per combo whether we go for it at all
    const cands: MoveInfo[] = [];
    const u = this.ultOf(me, cat);
    if (this.canUse(me, u) && rng.chance(P.ult)) cands.push(u);
    for (const s of cat.specials) if (!s.m.stance && !s.projectile && this.canUse(me, s) && s.m.requires !== 'stance') cands.push(s);
    for (const n of cat.normals) if (!n.isLow) cands.push(n);
    for (const k of cat.kis) if (!k.beam && this.canUse(me, k)) cands.push(k);
    let best: { f: number[]; dmg: number } | null = null;
    let evals = 0;
    for (const mi of cands) {
      if (evals++ > 7) break;
      const f = this.frames(state, me, mi);
      const dmg = this.lookahead(state, f, f.length + mi.startup + mi.m.active + 4);
      if (dmg > 0 && (!best || dmg > best.dmg)) best = { f, dmg };
      if (mi === u && dmg > 0) break;
    }
    void mem;
    if (best) { this.mem.plan = best.f.slice(1); return best.f[0]; }
    return null;
  }

  // ---------------------------------------------------------------- threats
  private threat(state: GameState, me: FighterState, opp: FighterState, ocat: CharCatalog, dist: number, mR: number): Threat | null {
    let best: Threat | null = null;
    if (opp.mode === 'attack' && opp.moveId) {
      const mi = ocat.byId[opp.moveId];
      if (mi && !mi.m.internal && !(mi.kind === 'ultimate' && state.ult)) {
        const el = opp.moveFrame;
        const act = lastActive(mi.m);
        const key = state.frame - opp.moveFrame;
        if (mi.projectile) {
          if (el < mi.m.projectile!.spawnFrame - 1 && dist < mi.reach) {
            best = { kind: 'proj', low: mi.isLow, frames: mi.startup - el + Math.max(0, (dist - mi.m.projectile!.x) / mi.m.projectile!.speed), mi, key, remain: mi.total - el, track: 'full' };
          }
        } else if (el < act && opp.hitstop === 0 || el < act && opp.hitstop > 0) {
          if (dist <= mi.reachMax + 0.7 * mR + 160) {
            best = {
              kind: mi.height === 'throw' ? 'throw' : mi.height === 'unblockable' ? 'unb' : 'melee',
              low: mi.isLow, frames: Math.max(0, mi.startup - el), mi, key, remain: mi.total - el, track: mi.tracking,
            };
          }
        }
      }
    }
    if (!best) {
      for (const p of state.projectiles) {
        if (p.owner === this.player) continue;
        const rx = me.pos.x - p.pos.x, rz = me.pos.z - p.pos.z;
        const sp = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z) || 1;
        const along = (rx * p.vel.x + rz * p.vel.z) / sp;
        if (along <= 0) continue;
        const lat = Math.abs(rx * p.vel.z - rz * p.vel.x) / sp;
        if (lat > p.r + mR * 0.8) continue;
        const t = along / sp;
        if (t > 50) continue;
        const seen = this.mem.projSeen[String(p.id)] ?? state.frame;
        best = { kind: 'proj', low: p.pos.y < 500, frames: t, mi: null, key: -1000 - p.id, remain: t + 6, track: 'full' };
        // reaction clock for projectiles starts when it appears
        (best as Threat & { age?: number }).age = state.frame - seen;
        break;
      }
    }
    return best;
  }

  private perceived(state: GameState, th: Threat, rng: Rng): boolean {
    void rng;
    const P = this.prof;
    if (th.key <= -1000) {
      const age = (th as Threat & { age?: number }).age ?? 0;
      return age >= P.react * 0.5 && th.frames <= 40;
    }
    const opp = state.fighters[1 - this.player];
    return opp.moveFrame >= this.mem.oppReact && th.frames >= 0;
  }

  private respond(state: GameState, me: FighterState, opp: FighterState, cat: CharCatalog, th: Threat, dist: number, rng: Rng): number | null {
    const mem = this.mem, P = this.prof;
    if (mem.answered === th.key) {
      // already chose: keep the posture
      return mem.post !== 'none' && state.frame < mem.postUntil ? this.postureBits(mem.post, me) : null;
    }
    mem.answered = th.key;
    if (!rng.chance(P.answer)) return null;
    const until = state.frame + Math.min(60, Math.ceil(th.remain) + 4);
    if (th.kind === 'throw') {
      if (rng.chance(P.sidestep + 0.2) && th.frames >= 3) { mem.plan = [0, R_BACK, 0, R_BACK, R_BACK]; return R_BACK; }
      return null;
    }
    if (th.kind === 'unb') {
      if (th.frames >= 3 && me.ki >= 100 && rng.chance(P.vanish + 0.2)) return Btn.H | Btn.K;
      if (th.frames >= 3 && rng.chance(0.5 + P.sidestep)) { mem.plan = [0, R_BACK, 0, R_BACK, R_BACK]; return R_BACK; }
      return null;
    }
    // blockable
    if (th.kind === 'melee' && th.mi && th.track === 'none' && th.frames >= 5 && th.frames <= 20 && rng.chance(P.sidestep)) {
      mem.plan = [0, 0];
      return R_UP;
    }
    // stuff a slow move with a jab
    if (th.kind === 'melee' && th.frames >= cat.fastest.startup + 3 && rng.chance(P.sidestep * 0.6) && dist <= cat.fastest.reach) {
      const f = this.frames(state, me, cat.fastest);
      mem.plan = f.slice(1);
      return f[0];
    }
    mem.post = th.low ? 'cguard' : 'guard';
    mem.postUntil = until;
    return this.postureBits(mem.post, me);
  }

  // ---------------------------------------------------------------- punish
  private punish(state: GameState, me: FighterState, opp: FighterState, cat: CharCatalog, ocat: CharCatalog, dist: number, rng: Rng, stunLeft = 0): number | null {
    const mem = this.mem, P = this.prof;
    if (opp.mode !== 'attack' || !opp.moveId) return null;
    const om = ocat.byId[opp.moveId];
    if (!om || om.m.internal) return null;
    const el = opp.moveFrame;
    const act = lastActive(om.m);
    if (el <= act) return null;
    const remain = om.total - el;
    if (remain < 7 + stunLeft) return null;
    if (om.projectile && om.m.projectile && el < om.m.projectile.spawnFrame + 3) return null;
    if (mem.punishRoll === 0) mem.punishRoll = rng.chance(P.punish) ? 1 : 2;
    if (mem.punishRoll === 2) return null;
    if (el - act < P.punishLag) return null;
    if (mem.punishTries >= 3 || (state.frame & 1) === 1) return null;
    mem.punishTries++;
    // candidates: strongest first
    const cands: MoveInfo[] = [];
    const u = this.ultOf(me, cat);
    if (this.canUse(me, u) && remain >= u.startup + 4) cands.push(u);
    for (const s of cat.specials) if (!s.m.stance && !s.projectile && this.canUse(me, s) && s.startup + 3 <= remain && s.m.requires !== 'stance') cands.push(s);
    for (const n of cat.normals) if (n.startup + 1 <= remain) cands.push(n);
    if (cat.throwInfo && remain >= cat.throwInfo.startup + 1) cands.push(cat.throwInfo);
    let best: { f: number[]; dmg: number } | null = null;
    let evals = 0;
    // order: cheap/likely first by damage
    cands.sort((a, b) => b.damage * (b.launches ? 1.5 : 1) - a.damage * (a.launches ? 1.5 : 1));
    for (const mi of cands) {
      if (evals++ >= 7) break;
      const f = this.frames(state, me, mi);
      if (f.length + mi.startup > remain + 2 + stunLeft) continue;
      const dmg = this.lookahead(state, f, Math.min(remain + 4, f.length + mi.startup + mi.m.active + 2));
      if (dmg > 0 && (!best || dmg > best.dmg)) best = { f, dmg };
      if (best && best.dmg >= 150) break;
    }
    if (best) { mem.plan = best.f.slice(1); return best.f[0]; }
    // approach for a long recovery
    if (remain > 28 && dist > cat.maxReach && stunLeft === 0 && P.punish > 0.8) { mem.plan = [0, R_FWD, R_FWD, R_FWD, R_FWD]; return R_FWD; }
    return null;
  }

  // ---------------------------------------------------------------- anti-air
  private antiAir(state: GameState, me: FighterState, opp: FighterState, cat: CharCatalog, dist: number, rng: Rng): number | null {
    const mem = this.mem, P = this.prof;
    if (dist > 1700 || opp.pos.y < 100) return null;
    if (state.frame - mem.airTick < 3) return null;
    mem.airTick = state.frame;
    if (!rng.chance(P.antiAir)) return null;
    const cands: MoveInfo[] = [];
    for (const s of cat.specials) if (!s.m.stance && !s.projectile && s.invulnTo > 0) cands.push(s);
    for (const n of cat.launchers) cands.push(n);
    for (const n of cat.normals) if (n.m.requires !== 'air' && !n.isLow) cands.push(n);
    let evals = 0;
    for (const mi of cands) {
      if (evals++ > 4) break;
      if (!this.canUse(me, mi)) continue;
      const f = this.frames(state, me, mi);
      const dmg = this.lookahead(state, f, f.length + mi.startup + mi.m.active + 3);
      if (dmg > 0) { mem.plan = f.slice(1); return f[0]; }
    }
    return null;
  }

  // ---------------------------------------------------------------- neutral
  private neutral(state: GameState, me: FighterState, opp: FighterState, cat: CharCatalog, ocat: CharCatalog, pers: (typeof PERSONALITY)[CharId], dist: number, oR: number, rng: Rng): number {
    const mem = this.mem, P = this.prof;
    void ocat;
    const pref = pers.spacing * cat.maxReach + 0.55 * oR;
    const ready = (n: number) => state.frame + n;
    const set = (p: Posture, n: number): number => { mem.post = p; mem.postUntil = ready(n); return this.postureBits(p, me); };

    // random blunders
    if (rng.chance(P.mistake)) {
      const r = rng.int(5);
      if (r === 0) return set('out', 12 + rng.int(20));
      if (r === 1) return set('crouch', 15);
      if (r === 2) return set('none', 1);
      if (r === 3 && dist < 1300) { const f = this.frames(state, me, cat.fastest); mem.plan = f.slice(1); return f[0]; }
      return set('in', 10 + rng.int(20));
    }

    // opponent down: close in, do not whiff wildly
    if (opp.mode === 'knockdown' || opp.mode === 'wakeup') {
      if (dist > pref) return set('in', 10);
      if (opp.mode === 'wakeup' && rng.chance(P.aggression)) return this.attack(state, me, opp, cat, pers, dist, oR, rng) ?? 0;
      return 0;
    }

    // charge ki when safe at range
    if (dist > 2000 && me.ki < 230 && opp.mode !== 'attack' && state.projectiles.every((p) => p.owner === this.player) && rng.chance(0.2 + 0.3 * P.aggression)) {
      return set('charge', 40 + rng.int(40));
    }

    // zoning: projectiles
    if (dist > 1500 && dist < 4200 && opp.mode !== 'attack' && rng.chance(Math.min(0.9, pers.zoning * 1.6 * (0.4 + P.aggression)))) {
      const pr = this.pickProjectile(me, cat, dist, rng);
      if (pr) { const f = this.frames(state, me, pr); mem.plan = f.slice(1); return f[0]; }
    }

    // character tricks
    if (me.char === 'ren' && cat.stance && dist > 1000 && dist < 2000 && opp.mode !== 'attack' && rng.chance(pers.trick * 0.7 * (0.5 + P.stance))) {
      const f = this.frames(state, me, cat.stance);
      mem.plan = f.slice(1);
      return f[0];
    }
    if (me.char === 'shiori' && dist < 1500 && rng.chance(pers.trick * 0.25 * (0.3 + P.aggression))) {
      const sw = cat.byId.shiori_smoke_swap;
      if (sw && this.canUse(me, sw)) { const f = this.frames(state, me, sw); mem.plan = f.slice(1); return f[0]; }
    }
    if (dist < 1700 && me.ki >= 100 && rng.chance(P.vanish * 0.05)) return Btn.H | Btn.K;

    // approach
    if (dist > pref + 700) {
      if (dist > pref + 1700 && rng.chance(0.4)) { mem.plan = [0, R_FWD, R_FWD, R_FWD]; return R_FWD; }
      if (me.char === 'goro' && dist < pref + 1500 && rng.chance(0.3)) {
        const mv = cat.byId.goro_shoulder;
        const f = this.frames(state, me, mv); mem.plan = f.slice(1); return f[0];
      }
      return set('in', 8 + rng.int(12));
    }
    // at poke range
    if (dist <= cat.maxReach + 0.6 * oR) {
      // defensive stance
      if (rng.chance(P.stance * (1 - P.aggression * pers.rush * 0.5))) return set(opp.pose === 'guardLow' ? 'guard' : 'guard', 14 + rng.int(14));
      if (rng.chance(Math.min(0.95, P.aggression * pers.rush))) {
        const f = this.attack(state, me, opp, cat, pers, dist, oR, rng);
        if (f !== null) return f;
      }
    }
    // spacing
    if (dist < pref - 250 && rng.chance(0.5)) return set('out', 8 + rng.int(10));
    if (dist > pref + 250) return set('in', 6 + rng.int(10));
    if (rng.chance(0.15 * P.sidestep)) { mem.plan = [0, 0]; return rng.chance(0.5) ? R_UP : 0; }
    return rng.chance(0.5) ? set('guard', 8) : 0;
  }

  private pickProjectile(me: FighterState, cat: CharCatalog, dist: number, rng: Rng): MoveInfo | null {
    const c: MoveInfo[] = [];
    for (const s of cat.specials) if (s.projectile && this.canUse(me, s) && dist < s.reach) c.push(s);
    for (const k of cat.kis) if (k.beam && this.canUse(me, k) && me.ki >= 100 && dist > 1800 && rng.chance(0.5)) c.push(k);
    if (!c.length) return null;
    return c[rng.int(c.length)];
  }

  /** choose an attack from the catalog for the current spacing */
  private attack(state: GameState, me: FighterState, opp: FighterState, cat: CharCatalog, pers: (typeof PERSONALITY)[CharId], dist: number, oR: number, rng: Rng): number | null {
    const P = this.prof;
    const oppCrouch = opp.mode === 'crouch' || opp.pose === 'guardLow';
    const oppGuard = opp.mode === 'guard' || opp.mode === 'blockstun';
    const behind = ((me.pos.x - opp.pos.x) * opp.facing.x + (me.pos.z - opp.pos.z) * opp.facing.z) < 0;
    const cands: Array<{ mi: MoveInfo; w: number }> = [];
    const consider = (mi: MoveInfo) => {
      if (!this.canUse(me, mi) || mi.m.requires === 'stance' || mi.m.stance) return;
      if (mi.kind === 'ultimate') return;
      const hi = mi.reach + 0.6 * oR - 40;
      if (dist > hi) return;
      if (mi.projectile && dist < 1100) return;
      if (mi.kind === 'throw' && dist > mi.reach + 0.5 * oR - 100) return;
      if (oppCrouch && mi.isHigh) return;
      let w = 1 + mi.damage / 80;
      w += (20 - mi.startup) / 12;
      if (mi.launches) w += 0.8;
      if (mi.onBlock <= -12) w -= 1.4 * P.safety; else if (mi.onBlock >= -4) w += 0.4 * P.safety;
      if (oppGuard) { if (mi.isLow) w += 0.9; if (mi.kind === 'throw') w += 1.2; if (mi.isHigh) w -= 0.6; }
      else { if (mi.isLow) w -= 0.4; if (mi.kind === 'throw') w -= 0.6; }
      if (dist < 750 && mi.kind === 'special' && mi.projectile) w -= 2;
      if (behind && mi.launches) w += 1.5;
      for (const k of Object.keys(pers.likes)) if (mi.id.indexOf(k) >= 0) w += pers.likes[k];
      if (w < 0.1) w = 0.1;
      cands.push({ mi, w });
    };
    for (const n of cat.normals) consider(n);
    for (const s of cat.specials) if (!s.m.stance && s.m.requires !== 'stance') consider(s);
    consider(cat.throwInfo);
    if (!cands.length) return null;
    // softmax-ish pick
    let tot = 0;
    for (const c of cands) { c.w = Math.pow(c.w, 1 / Math.max(0.25, P.noise * 0.5)); tot += c.w; }
    let r = rng.next() * tot;
    let pick = cands[0].mi;
    for (const c of cands) { r -= c.w; if (r <= 0) { pick = c.mi; break; } }
    const f = this.frames(state, me, pick);
    this.mem.plan = f.slice(1);
    return f[0];
  }
}

void getMove;
void R_UP;
