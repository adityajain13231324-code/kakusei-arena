/**
 * Meters & anime systems: Ki gauge, Ki Charge, Vanish Step, Awakening, ultimate
 * cinematic, training regeneration.
 */
import type { GameState } from './types';
import { F, emit, setMode, chest, vec, faceToward, inCombo, moveOf, totalFrames, type SF } from './fighter';
import { moveDef, CHARS } from '../data';
import {
  KI_MAX, KICHARGE_RATE, VANISH_COST, VANISH_DIST, AWAKEN_FRAMES, AWAKEN_DURATION, AWAKEN_HP_PCT,
  TRAIN_REGEN_DELAY, TURN_LOCK, VANISH_TP, GUARD_MAX, GUARD_REGEN, GUARD_REGEN_DELAY, ULT_FREEZE, ULT_FREEZE_HIT,
} from './constants';
import { clamp } from '../core/fixed';
import { toJuggle } from './hit';

export function addKi(state: GameState, i: number, amount: number): void {
  const f = F(state, i);
  if (amount <= 0) return;
  if (f.awakened) amount = Math.trunc((amount * 3) / 2);
  const before = f.ki;
  f.ki = clamp(f.ki + amount, 0, KI_MAX);
  if (f.ki >= KI_MAX && before < KI_MAX && !f.sim.kiFullSent) {
    f.sim.kiFullSent = true;
    emit(state, { type: 'kiFull', player: i as 0 | 1, pos: chest(f), charId: f.char });
  }
}

export function spendKi(f: SF, amount: number): void {
  f.ki -= amount;
  if (f.ki < 0) f.ki = 0;
  if (f.ki < KI_MAX) f.sim.kiFullSent = false;
}

export function canAwaken(f: SF): boolean {
  return !f.awakenUsed && f.hp * 100 < f.maxHp * AWAKEN_HP_PCT;
}

export function ultCost(f: SF): number {
  return f.awakened ? 200 : 300;
}

export function startAwaken(state: GameState, i: number): void {
  const f = F(state, i), o = F(state, 1 - i);
  f.awakenUsed = true;
  f.awakened = true;
  f.awakenTimer = AWAKEN_DURATION + AWAKEN_FRAMES;
  setMode(f, 'awaken');
  f.vel.x = 0; f.vel.z = 0;
  f.hp = Math.min(f.maxHp, f.hp + Math.trunc(f.maxHp / 10));
  // transformation "super freeze": the opponent is frozen while it plays
  o.hitstop = Math.max(o.hitstop, AWAKEN_FRAMES);
  state.camera.cinematic = { kind: 'awaken', player: i as 0 | 1, frame: 0 };
  emit(state, { type: 'awaken', player: i as 0 | 1, pos: chest(f), charId: f.char, element: elementOf(f) });
}

export function startVanish(state: GameState, i: number): void {
  const f = F(state, i);
  spendKi(f, VANISH_COST);
  setMode(f, 'vanish');
  f.vel.x = 0; f.vel.z = 0;
  emit(state, { type: 'vanish', player: i as 0 | 1, pos: chest(f), charId: f.char, tag: 'depart' });
}

/** teleport fighter i behind (or in front of) the opponent; used by Vanish Step and Smoke Swap */
export interface PosView { x: number; y: number; z: number; fx: number; fz: number }

/** `view` = opponent position/facing to use (the physics-phase snapshot); defaults to the live opponent */
export function teleport(state: GameState, i: number, to: 'behind' | 'front', dist = VANISH_DIST, view?: PosView): void {
  const f = F(state, i), o = F(state, 1 - i);
  const v: PosView = view ?? { x: o.pos.x, y: o.pos.y, z: o.pos.z, fx: o.facing.x, fz: o.facing.z };
  const sgn = to === 'behind' ? -1 : 1;
  const lim = state.arenaHalfSize - CHARS[f.char].radius;
  let nx = v.x + Math.trunc((v.fx * dist * sgn) / 1000);
  let nz = v.z + Math.trunc((v.fz * dist * sgn) / 1000);
  nx = clamp(nx, -lim, lim);
  nz = clamp(nz, -lim, lim);
  f.pos.x = nx; f.pos.z = nz;
  if (f.pos.y > 0 && f.mode === 'vanish') f.pos.y = 0;
  faceToward(f, { x: v.x, y: v.y, z: v.z });
  if (to === 'behind') o.sim.turnLock = TURN_LOCK;
  emit(state, { type: 'vanish', player: i as 0 | 1, pos: chest(f), charId: f.char, tag: 'arrive' });
}

export function updateVanish(state: GameState, i: number, view?: PosView): void {
  const f = F(state, i);
  if (f.mode === 'vanish' && f.modeFrame === VANISH_TP) teleport(state, i, 'behind', VANISH_DIST, view);
}

function elementOf(f: SF) {
  const m = moveOf(f);
  if (m?.element && m.element !== 'none') return m.element;
  return f.char === 'kaito' ? 'fire' : f.char === 'shiori' ? 'shadow' : f.char === 'ren' ? 'blade' : 'earth';
}

/** per-frame meter upkeep (fight phase only) */
export function updateMeters(state: GameState): void {
  for (let i = 0; i < 2; i++) {
    const f = F(state, i);
    if (f.mode === 'kicharge') {
      addKiRaw(state, i, KICHARGE_RATE);
    }
    if (f.awakened && f.mode !== 'awaken') {
      f.awakenTimer--;
      if (f.awakenTimer <= 0) { f.awakened = false; f.awakenTimer = 0; }
    }
    if (f.ki < KI_MAX) f.sim.kiFullSent = false;
    if (f.counterHitFlash > 0) f.counterHitFlash--;
    // guard meter regenerates after GUARD_REGEN_DELAY frames without blocking
    if (f.mode !== 'blockstun') {
      const idle = (f.sim.guardIdle ?? 0) + 1;
      f.sim.guardIdle = idle;
      if (idle > GUARD_REGEN_DELAY && (f.sim.guard ?? GUARD_MAX) < GUARD_MAX) f.sim.guard = Math.min(GUARD_MAX, (f.sim.guard ?? GUARD_MAX) + GUARD_REGEN);
    }
    // red (recoverable) health drains toward real hp once the combo is over
    if (!inCombo(f) && f.redHp > f.hp) f.redHp = Math.max(f.hp, f.redHp - 4);
    if (f.redHp < f.hp) f.redHp = f.hp;
  }
  if (state.training) {
    const opts = state.trainingOpts;
    for (let i = 0; i < 2; i++) {
      const f = F(state, i);
      if (opts?.infiniteKi) f.ki = KI_MAX;
      if (opts && !opts.hpRegen) continue;
      if (inCombo(f) || f.mode === 'blockstun') f.sim.regen = 0;
      else if (++f.sim.regen >= TRAIN_REGEN_DELAY && f.hp < f.maxHp) f.hp = Math.min(f.maxHp, f.hp + 25);
    }
  }
}

/** ki charge is not boosted by awakening's multiplier twice; uses same full event */
function addKiRaw(state: GameState, i: number, n: number): void {
  const f = F(state, i);
  const before = f.ki;
  f.ki = clamp(f.ki + n, 0, KI_MAX);
  if (f.ki >= KI_MAX && before < KI_MAX && !f.sim.kiFullSent) {
    f.sim.kiFullSent = true;
    emit(state, { type: 'kiFull', player: i as 0 | 1, pos: chest(f), charId: f.char });
  }
}

// ---------------------------------------------------------------- ultimate cinematic
/** Ultimate connected: switch attacker to the cinematic move and lock the defender. */
export function startUltCine(state: GameState, ai: number, totalDamage: number): void {
  const a = F(state, ai), d = F(state, 1 - ai);
  const m = moveOf(a);
  const cineId = m?.followup;
  const cine = cineId ? moveDef(a.char, cineId) : undefined;
  if (!m || !cine) return;
  a.moveId = cine.id;
  a.moveFrame = 0;
  a.vel.x = a.vel.z = 0; a.vel.y = 0; a.pos.y = 0; a.airborne = false;
  setMode(d, 'hitstun');
  d.stun = 9999;
  d.sim.hitPose = 'hitMid';
  d.vel.x = d.vel.y = d.vel.z = 0;
  d.pos.y = 0; d.airborne = false;
  d.sim.pushX = d.sim.pushZ = 0;
  state.ult = {
    player: ai as 0 | 1, target: (1 - ai) as 0 | 1, frame: 0, duration: totalFrames(cine),
    damage: totalDamage, dealt: 0, hitIndex: 0, moveId: cine.id, freeze: ULT_FREEZE,
  };
  a.hitstop = d.hitstop = ULT_FREEZE;
  state.camera.cinematic = { kind: 'ultimate', player: ai as 0 | 1, frame: 0 };
}

/** Runs instead of the normal fighter update while an ultimate cinematic plays. */
export function updateUltCine(state: GameState): void {
  const u = state.ult!;
  const a = F(state, u.player), d = F(state, u.target);
  const cine = moveDef(a.char, u.moveId)!;
  const hits = cine.ultHits ?? [];
  // lock the defender in front of the attacker
  d.pos.x = a.pos.x + Math.trunc((a.facing.x * 800) / 1000);
  d.pos.z = a.pos.z + Math.trunc((a.facing.z * 800) / 1000);
  d.facing.x = -a.facing.x; d.facing.z = -a.facing.z;
  a.invuln = true; d.invuln = true;
  // hit-freeze: the cinematic holds its pose (fighter.hitstop mirrors it for camera shake)
  if (u.freeze && u.freeze > 0) {
    u.freeze--;
    a.hitstop = d.hitstop = u.freeze;
    return;
  }
  if (u.hitIndex < hits.length && a.moveFrame === hits[u.hitIndex]) {
    const last = u.hitIndex === hits.length - 1;
    const dmg = last ? u.damage - u.dealt : Math.trunc(u.damage / hits.length);
    u.dealt += dmg;
    u.hitIndex++;
    d.hp -= dmg;
    if (state.training && d.hp < 1) d.hp = 1;
    if (d.hp < 0) d.hp = 0;
    d.comboHits++;
    d.comboDamage += dmg;
    d.sim.hitPose = u.hitIndex % 2 ? 'hitHigh' : 'hitMid';
    d.modeFrame = 0;
    u.freeze = last ? ULT_FREEZE : ULT_FREEZE_HIT;
    a.hitstop = d.hitstop = u.freeze;
    emit(state, {
      type: 'ultimateHit', player: u.player, target: u.target, pos: chest(d), damage: dmg, moveId: u.moveId,
      element: cine.element, strength: last ? 'super' : 'heavy', charId: a.char, combo: d.comboHits, tag: last ? 'final' : undefined,
    });
  }
  a.moveFrame++;
  u.frame++;
  if (state.camera.cinematic) state.camera.cinematic.frame = u.frame;
  if (a.moveFrame >= u.duration) {
    state.ult = null;
    state.camera.cinematic = null;
    a.hitstop = d.hitstop = 0;
    setMode(a, 'idle');
    a.invuln = false;
    d.stun = 0;
    toJuggle(state, u.target, a, 55, 30);
    emit(state, { type: 'launch', player: u.player, target: u.target, pos: chest(d), moveId: u.moveId, strength: 'super' });
  }
}
