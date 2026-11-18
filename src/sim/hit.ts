/**
 * Hit detection & resolution: strikes, trades, heights, guard, counter hits,
 * sidestep evasion, armor, stance parry, launches/juggles, throws.
 */
import type { GameState, MoveDef, OnHitEffect, ProjectileState, Vec3 } from './types';
import {
  F, emit, setMode, moveOf, isCrouching, comboScale, chest, vec, totalFrames, type SF,
} from './fighter';
import { hitCap, hitsFighter, contact } from './collision';
import { B_G, B_K, B_L, R_BACK, R_DOWN } from './input';
import { HITSTOP, PUSHBACK, SIDESTEP_EVADE_FROM, SIDESTEP_EVADE_TO, SIDESTEP_EVADE_DIST, THROW_BREAK, THROW_LAND, THROW_DIST, BACKDASH_ACT } from './constants';
import { addKi, startUltCine } from './meters';
import { moveDef, CHARS } from '../data';
import { chance } from '../core/rng';

/** per-step scratch: fighters that got stunned this step skip the end-of-step stun decrement */
export const stunnedThisStep = [false, false];

function startMoveHook(state: GameState, i: number, id: string): void {
  // late-bound to avoid a circular import with commands.ts
  hooks.startMoveById(state, i, id);
}
export const hooks = { startMoveById: (_s: GameState, _i: number, _id: string): void => {} };

/** put defender di into juggle (airborne) with upward velocity vy and knock speed along attacker facing */
export function toJuggle(state: GameState, di: number, att: SF, vy: number, knock: number): void {
  const d = F(state, di);
  setMode(d, 'juggle');
  d.airborne = true;
  d.vel.y = vy;
  d.sim.knockX = Math.trunc((att.facing.x * knock) / 1000);
  d.sim.knockZ = Math.trunc((att.facing.z * knock) / 1000);
  d.sim.pushX = d.sim.pushZ = 0;
  d.stun = 0;
}

function trackingCatches(move: MoveDef, att: SF, def: SF): boolean {
  const t = move.tracking ?? 'none';
  if (t === 'full') return true;
  if (t === 'none') return false;
  // which way (relative to the attacker) is the defender stepping?
  const rx = -att.facing.z, rz = att.facing.x;
  const toRight = def.sim.ssX * rx + def.sim.ssZ * rz > 0;
  return t === 'right' ? toRight : !toRight;
}

function canBlock(state: GameState, di: number, from: Vec3, move: MoveDef, crouch: boolean): boolean {
  const d = F(state, di);
  if (move.height === 'unblockable' || move.height === 'throw') return false;
  if (d.airborne) return false;
  const m = d.mode;
  const modeOk = m === 'idle' || m === 'walk' || m === 'crouch' || m === 'guard' || m === 'blockstun' || m === 'sidewalk'
    || (m === 'backdash' && d.modeFrame >= BACKDASH_ACT - 2) || (m === 'sidestep' && d.modeFrame >= 12);
  if (!modeOk) return false;
  // the attack must come from in front of the defender
  if ((from.x - d.pos.x) * d.facing.x + (from.z - d.pos.z) * d.facing.z <= 0) return false;
  const s = d.sim;
  let wants = (s.rel & R_BACK) !== 0 || s.held[B_G] > 0 || m === 'blockstun' || m === 'guard' || (crouch && (s.rel & R_DOWN) !== 0);
  // training dummy auto guard (P2)
  let auto = false;
  if (state.training && di === 1 && state.trainingOpts) {
    const g = state.trainingOpts.dummyGuard;
    if (g === 'all' || (g === 'random' && chance(state, 1, 2))) auto = true;
  }
  if (auto) return true; // dummy picks the right posture
  if (!wants) return false;
  if (move.height === 'low') return crouch;
  return !crouch;
}

function isCounter(def: SF): boolean {
  if (def.mode === 'kicharge') return true;
  if (def.mode !== 'attack') return false;
  const m = moveOf(def);
  if (!m) return false;
  return def.moveFrame < m.startup;
}

function hitPoseFor(move: MoveDef): 'hitHigh' | 'hitMid' | 'hitLow' {
  return move.height === 'high' ? 'hitHigh' : move.height === 'low' ? 'hitLow' : 'hitMid';
}

/** push defender away along direction (dx,dz unit*1000) by amount mm, applied over a few frames */
function push(d: SF, dx: number, dz: number, amount: number): void {
  d.sim.pushX += Math.trunc((dx * amount) / 1000);
  d.sim.pushZ += Math.trunc((dz * amount) / 1000);
}

export interface Source { x: number; z: number; dx: number; dz: number } // origin + direction of the attack

/**
 * Resolve a connecting strike or projectile. Returns 'hit' | 'block' | 'none'.
 * `proj` is set for projectile hits (attacker does not freeze, no counter-hit bonus to the move state).
 */
export function resolveStrike(state: GameState, ai: number, move: MoveDef, point: Vec3, proj?: ProjectileState): 'hit' | 'block' | 'none' {
  const a = F(state, ai), di = 1 - ai, d = F(state, di);
  const crouch = isCrouching(d);
  // high attacks whiff over crouching / ducking opponents
  if (move.height === 'high' && crouch) return 'none';
  // sidestep evasion: linear strikes whiff during the evasive part of a sidestep
  if (!proj && d.mode === 'sidestep' && d.modeFrame >= SIDESTEP_EVADE_FROM && d.modeFrame <= SIDESTEP_EVADE_TO
    && d.sim.ssLateral >= SIDESTEP_EVADE_DIST && !trackingCatches(move, a, d)) return 'none';

  const from: Vec3 = proj ? { x: proj.pos.x - proj.vel.x * 4, y: 0, z: proj.pos.z - proj.vel.z * 4 } : a.pos;
  let dirx = proj ? proj.vel.x : a.facing.x, dirz = proj ? proj.vel.z : a.facing.z;
  if (proj) { const l = Math.abs(dirx) + Math.abs(dirz); if (l > 0) { dirx = Math.trunc((dirx * 1000) / l); dirz = Math.trunc((dirz * 1000) / l); } }
  const hs = move.hitstop ?? HITSTOP[move.strength];
  const pb = move.pushback ?? PUSHBACK[move.strength];

  // Ren's Sheath Stance auto-counters high strikes
  if (!proj && d.stance && move.height === 'high') {
    const dm = moveOf(d);
    emit(state, { type: 'parry', player: di as 0 | 1, target: ai as 0 | 1, pos: { ...point }, moveId: move.id, tag: 'stance', charId: d.char });
    setMode(a, 'hitstun');
    a.stun = 28;
    a.sim.hitPose = 'stagger';
    stunnedThisStep[ai] = true;
    a.hitstop = 10; d.hitstop = 10;
    if (dm?.stance) startMoveHook(state, di, dm.stance.counterMove);
    return 'none';
  }

  const blocked = canBlock(state, di, from, move, crouch);
  if (blocked) {
    setMode(d, 'blockstun');
    d.stun = move.blockstun;
    stunnedThisStep[di] = true;
    if (move.chip && !state.training) d.hp = Math.max(1, d.hp - move.chip);
    else if (move.chip) d.hp = Math.max(1, d.hp - move.chip);
    push(d, dirx, dirz, Math.trunc((pb * 12) / 10));
    d.hitstop = Math.max(d.hitstop, hs - 2);
    if (!proj) { a.hitstop = Math.max(a.hitstop, hs - 2); a.sim.contact = 2; }
    addKi(state, ai, Math.trunc((move.kiGain ?? 0) / 2));
    addKi(state, di, 2);
    emit(state, { type: 'block', player: ai as 0 | 1, target: di as 0 | 1, pos: { ...point }, strength: move.strength, element: move.element, moveId: move.id, charId: a.char, damage: move.chip ?? 0 });
    if (!proj) state.advTrack = { att: ai, moveId: move.id, aFree: -1, dFree: -1 };
    return 'block';
  }

  // ---- hit
  const backHit = (from.x - d.pos.x) * d.facing.x + (from.z - d.pos.z) * d.facing.z < 0;
  const counter = isCounter(d) || backHit;

  // Ultimate connected -> cinematic
  if (move.kind === 'ultimate' && move.followup && !proj) {
    let total = Math.trunc((move.damage * comboScale(d.comboHits)) / 1000);
    if (a.awakened) total = Math.trunc((total * 11) / 10);
    if (d.comboHits === 0) d.redHp = d.hp;
    a.sim.contact = 1;
    emit(state, { type: 'hit', player: ai as 0 | 1, target: di as 0 | 1, pos: { ...point }, strength: 'super', element: move.element, moveId: move.id, damage: 0, charId: a.char, tag: 'ultimate', combo: d.comboHits });
    startUltCine(state, ai, total);
    return 'hit';
  }

  // armor (Stone Skin etc): absorb one hit, take the damage, no stun
  const dm = d.mode === 'attack' ? moveOf(d) : undefined;
  if (dm?.armor && !d.sim.armorUsed && move.height !== 'unblockable') {
    const fr = d.moveFrame + 1;
    if (fr >= dm.armor[0] && fr <= dm.armor[1]) {
      d.sim.armorUsed = true;
      const dmg = Math.max(1, Math.trunc((move.damage * (a.awakened ? 11 : 10)) / 10));
      d.hp -= dmg;
      if (state.training && d.hp < 1) d.hp = 1;
      d.hitstop = Math.max(d.hitstop, hs);
      if (!proj) { a.hitstop = Math.max(a.hitstop, hs); a.sim.contact = 1; }
      addKi(state, ai, move.kiGain ?? 0);
      emit(state, { type: 'hit', player: ai as 0 | 1, target: di as 0 | 1, pos: { ...point }, strength: move.strength, element: move.element, moveId: move.id, damage: dmg, charId: a.char, tag: 'armor' });
      return 'hit';
    }
  }

  // damage
  const hitsBefore = d.comboHits;
  if (hitsBefore === 0) d.redHp = d.hp;
  let dmg = Math.trunc((move.damage * comboScale(hitsBefore)) / 1000);
  if (counter) dmg = Math.trunc((dmg * 12) / 10);
  if (a.awakened) dmg = Math.trunc((dmg * 11) / 10);
  if (a.sim.easyMove && (move.kind === 'special' || move.kind === 'ki')) dmg = Math.trunc((dmg * 9) / 10);
  if (!proj && a.sim.heatUsed > 0) dmg = Math.trunc((dmg * (100 + 15 * a.sim.heatUsed)) / 100);
  if (dmg < 1) dmg = 1;
  d.hp -= dmg;
  if (state.training && d.hp < 1) d.hp = 1;
  d.comboHits++;
  d.comboDamage += dmg;
  d.juggleScale = comboScale(d.comboHits);
  d.sim.regen = 0;

  const wasAir = d.airborne || d.mode === 'juggle' || d.mode === 'wallsplat';
  const effect: OnHitEffect = (counter && move.onCounterHit) ? move.onCounterHit : (move.onHit ?? 'normal');
  d.hitstop = Math.max(d.hitstop, hs + (counter ? 2 : 0));
  if (!proj) { a.hitstop = Math.max(a.hitstop, hs + (counter ? 2 : 0)); a.sim.contact = 1; }
  const evBase = { player: ai as 0 | 1, target: di as 0 | 1, strength: move.strength, element: move.element, moveId: move.id, charId: a.char };

  if (wasAir) applyJuggleHit(state, di, a, move, effect, dirx, dirz);
  else applyGroundHit(state, di, a, move, effect, counter, dirx, dirz, pb);

  addKi(state, ai, move.kiGain ?? 0);
  addKi(state, di, Math.trunc(dmg / 12));
  if (move.heat === 'gain' && a.char === 'kaito' && a.heatStacks < 3) {
    a.heatStacks++;
    emit(state, { ...evBase, type: 'hit', pos: chest(a), damage: 0, tag: 'heat' });
  }

  if (counter) {
    d.counterHitFlash = 30;
    emit(state, { ...evBase, type: 'counter', pos: { ...point }, damage: dmg, tag: backHit ? 'backHit' : undefined });
  }
  emit(state, { ...evBase, type: 'hit', pos: { ...point }, damage: dmg, combo: d.comboHits, tag: wasAir ? 'juggle' : undefined });
  if (!proj) state.advTrack = { att: ai, moveId: move.id, aFree: -1, dFree: -1 };
  return 'hit';
}

function applyGroundHit(state: GameState, di: number, a: SF, move: MoveDef, effect: OnHitEffect, counter: boolean, dx: number, dz: number, pb: number): void {
  const d = F(state, di);
  const pt = chest(d);
  switch (effect) {
    case 'launch':
      toJuggle(state, di, a, move.launchVel ?? 60, 3);
      emit(state, { type: 'launch', player: (1 - di) as 0 | 1, target: di as 0 | 1, pos: pt, moveId: move.id, strength: move.strength, element: move.element });
      return;
    case 'knockdown':
      toJuggle(state, di, a, 26, 16);
      return;
    case 'wallbounce':
      toJuggle(state, di, a, 22, 42);
      return;
    case 'groundbounce':
      d.sim.bounce = true;
      toJuggle(state, di, a, -12, 6);
      return;
    case 'stagger':
    case 'crumple':
      setMode(d, 'hitstun');
      d.stun = effect === 'crumple' ? 50 : move.hitstun + 10;
      d.sim.crumple = effect === 'crumple';
      d.sim.hitPose = 'stagger';
      stunnedThisStep[di] = true;
      push(d, dx, dz, Math.trunc(pb / 2));
      return;
    case 'throw':
    case 'normal':
    default:
      setMode(d, 'hitstun');
      d.stun = move.hitstun + (counter ? 4 : 0);
      d.sim.hitPose = hitPoseFor(move);
      stunnedThisStep[di] = true;
      push(d, dx, dz, pb);
  }
}

function applyJuggleHit(state: GameState, di: number, a: SF, move: MoveDef, effect: OnHitEffect, dx: number, dz: number): void {
  const d = F(state, di);
  if (d.mode === 'wallsplat') {
    if (effect === 'launch') toJuggle(state, di, a, Math.trunc(((move.launchVel ?? 60) * 7) / 10), -4);
    return; // stays pinned to the wall
  }
  const ch = d.comboHits;
  let vy: number;
  let knock = 6;
  if (effect === 'launch') vy = Math.trunc(((move.launchVel ?? 60) * 8) / 10);
  else if (effect === 'groundbounce') { vy = -40; d.sim.bounce = true; }
  else if (effect === 'wallbounce') { vy = 18; knock = 42; }
  else if (effect === 'knockdown') { vy = 16; knock = 16; }
  else vy = Math.max(20, 46 - 3 * ch); // small pop per juggle hit, shrinking with combo length
  // juggles get lower each hit: cap pop by combo length
  toJuggle(state, di, a, vy, knock);
  d.airborne = true;
}

// ---------------------------------------------------------------- throws
export function tryThrow(state: GameState, ai: number, move: MoveDef, point: Vec3): void {
  const a = F(state, ai), di = 1 - ai, d = F(state, di);
  if (d.airborne) return;
  const m = d.mode;
  if (m === 'hitstun' || m === 'blockstun' || m === 'juggle' || m === 'knockdown' || m === 'wallsplat' || m === 'thrown' || d.invuln) return;
  // normal throws are high: they whiff on crouchers. Command throws (special) grab anyone grounded.
  if (move.kind === 'throw' && isCrouching(d)) return;
  a.sim.hitMask = -1;
  // simultaneous throws: automatic break
  const dm = d.mode === 'attack' ? moveOf(d) : undefined;
  if (dm && dm.height === 'throw' && !dm.internal && d.moveFrame >= dm.startup) {
    throwBreak(state, ai, point);
    return;
  }
  a.sim.contact = 1;
  const front = (a.pos.x - d.pos.x) * d.facing.x + (a.pos.z - d.pos.z) * d.facing.z > 0;
  const follow = move.followup ? moveDef(a.char, move.followup) : undefined;
  if (follow) { a.moveId = follow.id; a.moveFrame = 0; }
  a.sim.partner = di;
  a.vel.x = a.vel.z = 0;
  setMode(d, 'thrown');
  d.sim.partner = ai;
  d.sim.breakable = !move.unbreakable && front;
  d.sim.throwMove = move.id;
  d.vel.x = d.vel.y = d.vel.z = 0;
  state.camera.cinematic = { kind: 'throw', player: ai as 0 | 1, frame: 0 };
  emit(state, { type: 'throw', player: ai as 0 | 1, target: di as 0 | 1, pos: { ...point }, moveId: move.id, element: move.element, charId: a.char, tag: d.sim.breakable ? undefined : 'unbreakable' });
}

function throwBreak(state: GameState, ai: number, point: Vec3): void {
  const a = F(state, ai), d = F(state, 1 - ai);
  for (const f of [a, d]) {
    setMode(f, 'blockstun');
    f.stun = 16;
    f.sim.hitPose = 'stagger';
  }
  stunnedThisStep[0] = stunnedThisStep[1] = true;
  push(a, -a.facing.x, -a.facing.z, 450);
  push(d, -d.facing.x, -d.facing.z, 450);
  if (state.camera.cinematic?.kind === 'throw') state.camera.cinematic = null;
  emit(state, { type: 'throwBreak', player: (1 - ai) as 0 | 1, target: ai as 0 | 1, pos: { ...point }, charId: d.char });
}

/** per-frame update of a thrown fighter (lock, break window, damage) */
export function updateThrown(state: GameState, di: number): void {
  const d = F(state, di);
  const ai = d.sim.partner;
  if (ai < 0) { setMode(d, 'idle'); return; }
  const a = F(state, ai);
  d.pos.x = a.pos.x + Math.trunc((a.facing.x * THROW_DIST) / 1000);
  d.pos.z = a.pos.z + Math.trunc((a.facing.z * THROW_DIST) / 1000);
  d.facing.x = -a.facing.x; d.facing.z = -a.facing.z;
  if (state.camera.cinematic?.kind === 'throw') state.camera.cinematic.frame = d.modeFrame;
  if (d.sim.breakable && d.modeFrame >= 1 && d.modeFrame <= THROW_BREAK && (d.sim.press[B_L] === 0 || d.sim.press[B_K] === 0)) {
    throwBreak(state, ai, chest(d));
    return;
  }
  if (d.modeFrame >= THROW_LAND) {
    const tm = moveDef(a.char, d.sim.throwMove);
    let dmg = tm ? tm.damage : 100;
    if (a.awakened) dmg = Math.trunc((dmg * 11) / 10);
    if (d.comboHits === 0) d.redHp = d.hp;
    d.hp -= dmg;
    if (state.training && d.hp < 1) d.hp = 1;
    d.comboHits++;
    d.comboDamage += dmg;
    addKi(state, ai, tm?.kiGain ?? 10);
    addKi(state, di, Math.trunc(dmg / 12));
    emit(state, { type: 'hit', player: ai as 0 | 1, target: di as 0 | 1, pos: chest(d), damage: dmg, strength: 'heavy', element: tm?.element, moveId: tm?.id, charId: a.char, tag: 'throw', combo: d.comboHits });
    d.sim.partner = -1;
    toJuggle(state, di, a, 30, 14);
    if (state.camera.cinematic?.kind === 'throw') state.camera.cinematic = null;
  }
}

// ---------------------------------------------------------------- detection
interface Pending { ai: number; move: MoveDef; k: number; x: number; y: number; z: number }
const pending: Pending[] = [];

function strikeable(d: SF): boolean {
  if (d.invuln) return false;
  const m = d.mode;
  return !(m === 'knockdown' || m === 'thrown' || m === 'intro' || m === 'clash' || m === 'win' || m === 'lose' || m === 'vanish' || m === 'awaken');
}

/** Find all connecting hitboxes for this frame first, then resolve (so trades work). */
export function detectStrikes(state: GameState, frozen: boolean[]): void {
  pending.length = 0;
  for (let ai = 0; ai < 2; ai++) {
    const a = F(state, ai);
    if (a.mode !== 'attack' || frozen[ai]) continue;
    const m = moveOf(a);
    if (!m || m.internal && m.hitboxes.length === 0) continue;
    const d = F(state, 1 - ai);
    if (!strikeable(d)) continue;
    const fr = a.moveFrame + 1;
    for (let k = 0; k < m.hitboxes.length; k++) {
      const hb = m.hitboxes[k];
      if (fr < hb.from || fr > hb.to) continue;
      if (a.sim.hitMask & (1 << k)) continue;
      const c = hitCap(a, hb);
      if (hitsFighter(c, d)) {
        pending.push({ ai, move: m, k, x: contact.x, y: contact.y, z: contact.z });
        break;
      }
    }
  }
  for (const p of pending) {
    const a = F(state, p.ai);
    const pt = vec(p.x, p.y, p.z);
    if (p.move.height === 'throw') { tryThrow(state, p.ai, p.move, pt); continue; }
    const r = resolveStrike(state, p.ai, p.move, pt);
    if (r !== 'none') a.sim.hitMask |= 1 << p.k;
  }
}

/** whiff detection at the end of a move's active frames (called from the advance phase) */
export function checkWhiff(state: GameState, i: number): void {
  const a = F(state, i);
  const m = moveOf(a);
  if (!m || a.sim.activeDone || m.hitboxes.length === 0) return;
  let lastTo = 0;
  for (const hb of m.hitboxes) if (hb.to > lastTo) lastTo = hb.to;
  if (a.moveFrame + 1 < lastTo) return;
  a.sim.activeDone = true;
  if (a.sim.contact === 0) {
    const hb = m.hitboxes[m.hitboxes.length - 1];
    const c = hitCap(a, hb);
    emit(state, { type: 'whiff', player: i as 0 | 1, pos: vec(c.bx, c.by, c.bz), moveId: m.id, strength: m.strength, element: m.element, charId: a.char });
    addKi(state, i, Math.trunc((m.kiGain ?? 0) / 4));
  }
}

export { totalFrames };
