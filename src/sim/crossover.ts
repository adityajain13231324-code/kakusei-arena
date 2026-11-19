/**
 * Crossover Pack systems (Gojo, Naruto, Zoro, Luffy, Eren) + the generic SOUL REALM framework.
 * Everything here is deterministic integer logic on plain state (see docs/CROSSOVER.md):
 *   - Soul Realm: realm move -> 90-frame cinematic (state.realm.phase 'cine') -> rule twist ('active').
 *     The opponent answering with its own realm during the cinematic starts a REALM CLASH (beam-clash mash).
 *   - Gojo: Infinity (enemy projectiles slow near him, first hit each round auto-guarded), Six Eyes auto-guard
 *     after an enemy teleport, Infinite Void damage cap.
 *   - Naruto: shadow clones (state.summons) that copy his next attack from flanking angles.
 *   - Zoro: Asura echo slashes.  Luffy / Naruto / Eren: forms (fighter.form) for the renderer + mechanics.
 */
import type { FighterState, GameState, MoveDef, ProjectileState, RealmState, SummonState, Vec3 } from './types';
import { F, emit, setMode, moveOf, chest, vec, totalFrames, type SF } from './fighter';
import { CHARS, moveDef } from '../data';
import { isqrt, norm2, clamp } from '../core/fixed';
import { resolveStrike, strikeable, stunnedThisStep } from './hit';
import { hitCap, hitsFighter, cap, capsuleHit, contact, lateralSign, type Cap } from './collision';
import { animPose } from './pose';
import { KI_MAX, CLASH_FRAMES } from './constants';

export const REALM_CINE = 90;
export const REALM_COST = KI_MAX;
export const VOID_FREEZE = 90;
export const VOID_CAP_PCT = 35;
export const CLONE_MAX = 2;
export const CLONE_LIFE = 480;
export const TITAN_FRAMES = 600;
export const INFINITY_SLOW = 30; // percent speed of enemy projectiles inside the Infinity radius
export const INFINITY_R = 1200;
export const LOW_HP_PCT = 20; // Nine-Tails Chakra Mode / Gear Fourth threshold (while awakened)

/** base form for a character (Zoro starts in Three-Sword Style) */
export function baseForm(char: string): string {
  return char === 'zoro' ? 'santoryu' : '';
}

// ---------------------------------------------------------------- fake "projectile" source for clone / echo / realm hits
function fakeProj(owner: number, x: number, z: number, dx: number, dz: number, y = 1100): ProjectileState {
  return {
    id: 0, owner: owner as 0 | 1, kind: 'virtual', element: 'none', pos: vec(x, y, z), vel: vec(dx, 0, dz),
    r: 0, life: 1, hitsLeft: 1, beam: false, moveId: '',
  };
}

/** tag the last 'hit' / 'block' event of this step with `tag` (for clone / echo feedback) */
function tagLast(state: GameState, tag: string): void {
  for (let k = state.events.length - 1; k >= 0; k--) {
    const e = state.events[k];
    if (e.type === 'hit' || e.type === 'block' || e.type === 'counter') { if (!e.tag) e.tag = tag; if (e.type !== 'counter') return; }
  }
}

// ================================================================ SOUL REALM
export function canRealm(state: GameState, i: number): boolean {
  const f = F(state, i);
  const def = CHARS[f.char];
  return !!def.realmId && f.awakened && f.ki >= REALM_COST && !f.sim.realmUsed && !f.airborne && !state.realm && !state.clash.active;
}

/** the realm move reached its startup frame: open the realm cinematic (or clash with the opponent's) */
export function startRealm(state: GameState, i: number, m: MoveDef): void {
  const f = F(state, i);
  const r = state.realm;
  if (r && r.owner !== i) { startRealmClash(state); return; }
  if (r) return;
  const o = F(state, 1 - i);
  state.realm = {
    owner: i as 0 | 1, kind: m.realm!.kind, phase: 'cine', frame: 0, duration: m.realm!.duration, cine: REALM_CINE,
    moveId: m.id, dealt: 0, cap: m.realm!.kind === 'infinite_void' ? Math.trunc((o.maxHp * VOID_CAP_PCT) / 100) : 0,
  };
  for (const x of [f, o]) { x.vel.x = x.vel.z = 0; }
  state.camera.cinematic = { kind: 'realm', player: i as 0 | 1, frame: 0 };
  emit(state, { type: 'realmStart', player: i as 0 | 1, target: (1 - i) as 0 | 1, pos: chest(f), moveId: m.id, element: m.element, charId: f.char, tag: m.realm!.kind });
}

function realmMoveOf(state: GameState, i: number): string {
  return CHARS[F(state, i).char].realmId ?? '';
}

function startRealmClash(state: GameState): void {
  const c = state.clash;
  const a = F(state, 0), b = F(state, 1);
  state.realm = null;
  c.active = true;
  c.kind = 'realm';
  c.frame = 0;
  c.duration = CLASH_FRAMES;
  c.balance = 0;
  c.mash = [0, 0];
  c.point = vec(Math.trunc((a.pos.x + b.pos.x) / 2), 1200, Math.trunc((a.pos.z + b.pos.z) / 2));
  c.moves = [realmMoveOf(state, 0), realmMoveOf(state, 1)];
  c.winner = -1;
  for (let i = 0; i < 2; i++) {
    const f = F(state, i);
    setMode(f, 'clash');
    f.vel.x = f.vel.y = f.vel.z = 0;
    f.hitstop = 0;
    f.invuln = true;
  }
  state.camera.cinematic = { kind: 'clash', player: 0, frame: 0 };
  emit(state, { type: 'realmClash', player: 0, target: 1, pos: { ...c.point }, tag: 'realm' });
  emit(state, { type: 'clashStart', player: 0, target: 1, pos: { ...c.point }, element: 'void', tag: 'realm' });
}

/** Realm Clash resolved (called from updateClash): the winner's realm opens straight into its active phase */
export function endRealmClash(state: GameState, winner: 0 | 1 | 2): void {
  const c = state.clash;
  if (winner === 2) {
    for (let i = 0; i < 2; i++) {
      const f = F(state, i);
      setMode(f, 'blockstun'); f.stun = 20; stunnedThisStep[i] = true;
      f.sim.pushX -= Math.trunc((f.facing.x * 600) / 1000); f.sim.pushZ -= Math.trunc((f.facing.z * 600) / 1000);
    }
    emit(state, { type: 'clashEnd', player: 0, pos: { ...c.point }, tag: 'realmDraw' });
    return;
  }
  const w = F(state, winner);
  const m = moveDef(w.char, c.moves ? c.moves[winner] : '');
  emit(state, { type: 'clashEnd', player: winner, target: (1 - winner) as 0 | 1, pos: { ...c.point }, moveId: m?.id, element: m?.element, tag: 'realm' });
  if (!m?.realm) return;
  const o = F(state, 1 - winner);
  state.realm = {
    owner: winner, kind: m.realm.kind, phase: 'active', frame: 0, duration: m.realm.duration, cine: REALM_CINE,
    moveId: m.id, dealt: 0, cap: m.realm.kind === 'infinite_void' ? Math.trunc((o.maxHp * VOID_CAP_PCT) / 100) : 0,
  };
  emit(state, { type: 'realmStart', player: winner, target: (1 - winner) as 0 | 1, pos: chest(w), moveId: m.id, element: m.element, charId: w.char, tag: m.realm.kind });
  realmActivate(state);
}

/** runs INSTEAD of the normal fighter update while a realm cinematic plays */
export function updateRealmCine(state: GameState, wantsUlt: (st: GameState, i: number) => boolean): void {
  const r = state.realm!;
  const j = 1 - r.owner;
  const o = F(state, j);
  // the opponent answers with its own realm inside the window -> REALM CLASH
  const oppRealmMove = o.mode === 'attack' && !!moveOf(o)?.realm;
  const def = CHARS[o.char];
  const can = !!def.realmId && o.awakened && o.ki >= REALM_COST && !o.sim.realmUsed && !o.airborne;
  if (oppRealmMove || (can && wantsUlt(state, j))) {
    if (!oppRealmMove) { o.ki -= REALM_COST; if (o.ki < KI_MAX) o.sim.kiFullSent = false; o.sim.realmUsed = true; }
    startRealmClash(state);
    return;
  }
  r.frame++;
  if (state.camera.cinematic) state.camera.cinematic.frame = r.frame;
  if (r.frame < r.cine) return;
  r.phase = 'active';
  r.frame = 0;
  state.camera.cinematic = null;
  const f = F(state, r.owner);
  if (f.mode === 'attack') setMode(f, 'idle');
  realmActivate(state);
}

/** realm rule twist: start */
function realmActivate(state: GameState): void {
  const r = state.realm!;
  const oi = 1 - r.owner;
  const f = F(state, r.owner), o = F(state, oi);
  switch (r.kind) {
    case 'infinite_void':
      // the opponent's mind is flooded with infinite information: frozen, cannot act or guard
      o.sim.realmFreeze = VOID_FREEZE;
      if (!o.airborne && o.mode !== 'knockdown' && o.mode !== 'juggle') {
        setMode(o, 'hitstun');
        o.stun = VOID_FREEZE;
        o.sim.hitPose = 'stagger';
        o.vel.x = o.vel.z = 0;
        o.sim.pushX = o.sim.pushZ = 0;
        stunnedThisStep[oi] = true;
      }
      break;
    case 'tailed_beast_bomb': {
      const m = moveDef(f.char, 'naruto_tbb_blast');
      if (m) realmStrike(state, r.owner, m, true);
      spawnClones(state, r.owner, CLONE_MAX);
      break;
    }
    default: break;
  }
}

/** realm-generated hit on the opponent (blast / stomp). `front` = comes from in front of the victim */
function realmStrike(state: GameState, ai: number, m: MoveDef, fromOwner: boolean): void {
  const a = F(state, ai), d = F(state, 1 - ai);
  const was = d.invuln;
  d.invuln = false;
  if (!strikeable(d) && d.mode !== 'knockdown') { d.invuln = was; return; }
  if (d.mode === 'knockdown') { d.invuln = was; return; }
  let fx: number, fz: number, dx: number, dz: number;
  if (fromOwner) {
    const n = norm2(d.pos.x - a.pos.x, d.pos.z - a.pos.z, a.facing.x, a.facing.z);
    fx = d.pos.x - Math.trunc((n.x * 600) / 1000); fz = d.pos.z - Math.trunc((n.z * 600) / 1000); dx = n.x; dz = n.z;
  } else {
    // from the ground in front of the victim
    fx = d.pos.x + Math.trunc((d.facing.x * 600) / 1000); fz = d.pos.z + Math.trunc((d.facing.z * 600) / 1000);
    dx = -d.facing.x; dz = -d.facing.z;
  }
  resolveStrike(state, ai, m, chest(d), fakeProj(ai, fx, fz, dx, dz));
  tagLast(state, 'realm');
}

/** per-frame realm rules (live fight frames only, after the normal update) */
export function updateRealmActive(state: GameState): void {
  for (let i = 0; i < 2; i++) {
    const s = F(state, i).sim;
    if ((s.realmFreeze ?? 0) > 0) s.realmFreeze = (s.realmFreeze ?? 0) - 1;
  }
  const r = state.realm;
  if (!r || r.phase !== 'active') return;
  r.frame++;
  const f = F(state, r.owner);
  switch (r.kind) {
    case 'tailed_beast_bomb':
      if (r.frame % 90 === 0) spawnClones(state, r.owner, CLONE_MAX);
      break;
    case 'paths':
      if (r.frame % 60 === 30) {
        const m = moveDef(f.char, 'eren_paths_stomp');
        if (m && !F(state, 1 - r.owner).airborne) realmStrike(state, r.owner, m, false);
      }
      break;
    default: break;
  }
  if (state.realm && r.frame >= r.duration) endRealm(state, 'time');
}

export function endRealm(state: GameState, reason: string): void {
  const r = state.realm;
  if (!r) return;
  const o = F(state, 1 - r.owner);
  o.sim.realmFreeze = 0;
  emit(state, { type: 'realmEnd', player: r.owner, target: (1 - r.owner) as 0 | 1, pos: chest(F(state, r.owner)), moveId: r.moveId, tag: reason });
  state.realm = null;
}

/** realm damage cap (Infinite Void keeps the owner's total damage during the realm <= 35% of the opponent's HP) */
export function capDamage(state: GameState, ai: number, dmg: number): number {
  const r = state.realm;
  if (!r || r.phase !== 'active' || r.owner !== ai || r.cap <= 0) return dmg;
  const left = r.cap - r.dealt;
  if (dmg > left) dmg = left < 0 ? 0 : left;
  r.dealt += dmg;
  if (r.dealt >= r.cap) endRealm(state, 'cap');
  return dmg;
}

export function realmActive(state: GameState, kind: string, owner: number): boolean {
  const r = state.realm;
  return !!r && r.phase === 'active' && r.kind === kind && r.owner === owner;
}

/** frozen by an opponent's realm: no inputs, cannot guard */
export function frozenByRealm(f: SF): boolean {
  return (f.sim.realmFreeze ?? 0) > 0;
}

// ================================================================ auto-guards: Gojo Infinity / Six Eyes
/**
 * A strike/projectile is about to land on fighter di. Infinity (first hit each round) and the Six Eyes
 * auto-guard turn it into a guard (blockstun, no chip, no guard drain). Returns true if it was absorbed.
 */
export function autoGuard(state: GameState, ai: number, move: MoveDef, point: Vec3, proj: boolean): 'infinity' | 'sixEyes' | null {
  const d = F(state, 1 - ai);
  if (d.char !== 'gojo') return null;
  if (move.height === 'throw' || move.kind === 'ultimate') return null;
  if (d.airborne) return null;
  const m = d.mode;
  if (m === 'hitstun' || m === 'juggle' || m === 'wallsplat' || m === 'knockdown' || m === 'thrown' || m === 'blockstun' || m === 'clash') return null;
  if (frozenByRealm(d)) return null;
  let kind: 'infinity' | 'sixEyes' | null = null;
  if ((d.sim.autoGuard ?? 0) > 0) { kind = 'sixEyes'; d.sim.autoGuard = 0; }
  else if ((d.infinity ?? 0) > 0) { kind = 'infinity'; d.infinity = 0; if (state.training) d.sim.infinityCd = 300; }
  if (!kind) return null;
  void point; void proj;
  return kind;
}

// ================================================================ Asura echo (Zoro awakened: every slash hits twice)
export function queueEcho(state: GameState, ai: number, move: MoveDef, proj: boolean): void {
  const a = F(state, ai);
  if (proj || a.char !== 'zoro' || !a.awakened) return;
  if (move.kind === 'ultimate' || move.height === 'throw' || move.internal) return;
  a.sim.echoMove = move.id;
  a.sim.echoT = 6;
}

function updateEcho(state: GameState, i: number): void {
  const a = F(state, i), s = a.sim;
  if (!s.echoMove || (s.echoT ?? 0) <= 0) return;
  if (a.hitstop > 0) return;
  s.echoT = (s.echoT ?? 0) - 1;
  if (s.echoT > 0) return;
  const m = moveDef(a.char, s.echoMove);
  s.echoMove = '';
  const d = F(state, 1 - i);
  if (!m || !strikeable(d) || d.mode === 'knockdown') return;
  const dx = d.pos.x - a.pos.x, dz = d.pos.z - a.pos.z;
  if (dx * dx + dz * dz > 2200 * 2200) return;
  const echo: MoveDef = { ...m, damage: Math.max(1, Math.trunc(m.damage / 2)), chip: Math.trunc((m.chip ?? 0) / 2), onHit: 'normal', onCounterHit: undefined, hitstop: 4, kind: 'normal', kiGain: 2 };
  const n = norm2(dx, dz, a.facing.x, a.facing.z);
  resolveStrike(state, i, echo, chest(d), fakeProj(i, a.pos.x, a.pos.z, n.x, n.z));
  tagLast(state, 'echo');
}

// ================================================================ forms + per-frame upkeep
function setForm(state: GameState, i: number, form: string): void {
  const f = F(state, i);
  if ((f.form ?? '') === form) return;
  f.form = form;
  emit(state, { type: 'formChange', player: i as 0 | 1, pos: chest(f), charId: f.char, tag: form || 'base', element: CHARS[f.char].element });
}

export function onAwaken(state: GameState, i: number): void {
  const f = F(state, i);
  switch (f.char) {
    case 'gojo': f.sim.sixEyes = 1; setForm(state, i, 'six_eyes'); break;
    case 'naruto': setForm(state, i, 'sage'); break;
    case 'luffy': setForm(state, i, 'gear2'); break;
    case 'eren': f.sim.formTimer = TITAN_FRAMES; setForm(state, i, 'titan'); break;
    default: break;
  }
}

/** form timers / thresholds, Infinity recharge, auto-guard timers, echoes. Live fight frames only. */
export function updateCrossover(state: GameState, frozen: boolean[]): void {
  for (let i = 0; i < 2; i++) {
    const f = F(state, i), s = f.sim;
    if ((s.autoGuard ?? 0) > 0) s.autoGuard = (s.autoGuard ?? 0) - 1;
    if (!frozen[i]) updateEcho(state, i);
    const low = f.hp * 100 < f.maxHp * LOW_HP_PCT;
    switch (f.char) {
      case 'gojo':
        if (!f.awakened && f.form) setForm(state, i, '');
        if (state.training && (f.infinity ?? 0) === 0 && (s.infinityCd ?? 0) > 0) { s.infinityCd = (s.infinityCd ?? 0) - 1; if (s.infinityCd === 0) f.infinity = 1; }
        break;
      case 'naruto':
        if (!f.awakened) { if (f.form) setForm(state, i, ''); }
        else if (low && f.form !== 'kurama') setForm(state, i, 'kurama');
        break;
      case 'luffy':
        if (realmActive(state, 'gear_fifth', i)) setForm(state, i, 'gear5');
        else if (!f.awakened) { if (f.form) setForm(state, i, ''); }
        else if (low || f.form === 'gear4' || f.form === 'gear5') setForm(state, i, 'gear4');
        else setForm(state, i, 'gear2');
        break;
      case 'eren':
        if (f.form === 'titan') {
          if ((s.formTimer ?? 0) > 0) s.formTimer = (s.formTimer ?? 0) - 1;
          if ((s.formTimer ?? 0) <= 0 && f.mode !== 'attack') { s.formTimer = 0; setForm(state, i, ''); }
        }
        break;
      default: break;
    }
  }
}

/** Gojo: Six Eyes reads an enemy teleport (called from teleport()) -> no turn-lock, auto-guard the next hit */
export function onTeleportedBehind(state: GameState, victim: number): boolean {
  const v = F(state, victim);
  if (v.char !== 'gojo' || !v.awakened || (v.sim.sixEyes ?? 0) <= 0) return false;
  v.sim.sixEyes = (v.sim.sixEyes ?? 0) - 1;
  v.sim.autoGuard = 45;
  emit(state, { type: 'infinityBlock', player: victim as 0 | 1, pos: chest(v), charId: v.char, tag: 'sixEyesRead' });
  return true;
}

/** Infinity: speed percent for a projectile this frame (30 inside 1.2 m of an enemy Gojo) */
export function projectileSlow(state: GameState, p: ProjectileState): number {
  const t = F(state, 1 - p.owner);
  if (t.char !== 'gojo') return 100;
  // Infinity drops while he is being comboed (hit / juggled / down)
  const m = t.mode;
  if (m === 'hitstun' || m === 'juggle' || m === 'wallsplat' || m === 'knockdown' || m === 'thrown') return 100;
  const dx = p.pos.x - t.pos.x, dy = p.pos.y - (t.pos.y + 1000), dz = p.pos.z - t.pos.z;
  return dx * dx + dy * dy + dz * dz < INFINITY_R * INFINITY_R ? INFINITY_SLOW : 100;
}

// ================================================================ shadow clones (state.summons)
function summons(state: GameState): SummonState[] {
  if (!state.summons) state.summons = [];
  return state.summons;
}

export function cloneCount(state: GameState, owner: number): number {
  let n = 0;
  for (const s of state.summons ?? []) if (s.owner === owner) n++;
  return n;
}

const C70 = 342, S70 = 940; // cos / sin 70 degrees * 1000

/** flank spot for a clone: rotate (owner - opponent) by +-70 degrees around the opponent (screen-mirrored) */
function flankSpot(state: GameState, owner: number, slot: number, out: { x: number; z: number }): void {
  const f = F(state, owner), o = F(state, 1 - owner);
  const dx = f.pos.x - o.pos.x, dz = f.pos.z - o.pos.z;
  const u = norm2(dx, dz, -o.facing.x, -o.facing.z);
  const sl = slot * lateralSign(f);
  const rx = Math.trunc((u.x * C70 - u.z * S70 * sl) / 1000);
  const rz = Math.trunc((u.x * S70 * sl + u.z * C70) / 1000);
  const r = clamp(isqrt(dx * dx + dz * dz), 750, 1400);
  const lim = state.arenaHalfSize - 300;
  out.x = clamp(o.pos.x + Math.trunc((rx * r) / 1000), -lim, lim);
  out.z = clamp(o.pos.z + Math.trunc((rz * r) / 1000), -lim, lim);
}

const spot = { x: 0, z: 0 };

export function spawnClones(state: GameState, owner: number, count: number): void {
  const list = summons(state);
  const f = F(state, owner);
  for (let k = 0; k < count; k++) {
    if (cloneCount(state, owner) >= CLONE_MAX) return;
    let slot = -1;
    for (const s of list) if (s.owner === owner && s.slot === slot) slot = 1;
    for (const s of list) if (s.owner === owner && s.slot === slot) return;
    flankSpot(state, owner, slot, spot);
    const c: SummonState = {
      id: state.nextSummonId ?? 1, owner: owner as 0 | 1, kind: 'clone', pos: vec(spot.x, 0, spot.z), facing: { x: f.facing.x, z: f.facing.z },
      slot, mode: 'appear', modeFrame: 0, moveId: null, moveFrame: 0, queued: null, delay: 0, hitMask: 0, life: CLONE_LIFE, pose: 'vanish',
    };
    state.nextSummonId = c.id + 1;
    list.push(c);
    emit(state, { type: 'summon', player: owner as 0 | 1, pos: vec(spot.x, 1000, spot.z), charId: f.char, tag: 'clone' });
  }
}

function dispel(state: GameState, idx: number, reason: string): void {
  const list = summons(state);
  const s = list[idx];
  emit(state, { type: 'summonDispel', player: s.owner, pos: vec(s.pos.x, 1000, s.pos.z), charId: F(state, s.owner).char, tag: reason });
  list.splice(idx, 1);
}

/** remove every clone of `owner` (Clone Rush uses them up) */
export function consumeClones(state: GameState, owner: number, reason: string): void {
  const list = summons(state);
  for (let k = list.length - 1; k >= 0; k--) if (list[k].owner === owner) dispel(state, k, reason);
}

/** owner started a move: idle clones queue a copy of it */
export function onMoveStart(state: GameState, i: number, m: MoveDef): void {
  if (m.cycleForms && m.cycleForms.length) {
    const f = F(state, i);
    const k = m.cycleForms.indexOf(f.form ?? '');
    setForm(state, i, m.cycleForms[(k + 1) % m.cycleForms.length]);
  }
  if (!state.summons || state.summons.length === 0) return;
  if (m.internal || m.kind === 'throw' || m.kind === 'ultimate' || m.height === 'throw' || m.projectile || m.requires === 'air') return;
  if (m.summon || m.needClones || m.realm || m.teleport || m.hitboxes.length === 0) return;
  let n = 0;
  for (const s of state.summons) {
    if (s.owner !== i || s.mode === 'attack' || s.queued) continue;
    s.queued = m.id;
    s.delay = 4 + 4 * n++;
  }
}

/** world capsule of a clone's body */
function cloneCap(s: SummonState): Cap {
  return cap(s.pos.x, 100, s.pos.z, s.pos.x, 1500, s.pos.z, 260);
}

/** a strike / projectile capsule touched any enemy clone of `attacker`'s opponent: dispel it */
export function hitClones(state: GameState, attacker: number, c: Cap): void {
  const list = state.summons;
  if (!list || !list.length) return;
  for (let k = list.length - 1; k >= 0; k--) {
    const s = list[k];
    if (s.owner === attacker || s.mode === 'appear') continue;
    if (capsuleHit(c, cloneCap(s))) dispel(state, k, 'hit');
  }
}

export function projectileHitsClone(state: GameState, p: ProjectileState, pc: Cap): boolean {
  const list = state.summons;
  if (!list || !list.length) return false;
  for (let k = list.length - 1; k >= 0; k--) {
    const s = list[k];
    if (s.owner === p.owner || s.mode === 'appear') continue;
    if (capsuleHit(pc, cloneCap(s))) { dispel(state, k, 'hit'); return true; }
  }
  return false;
}

/** per-frame clone logic: follow a flank spot, play copied moves, hit the opponent */
export function updateSummons(state: GameState, hitsLive: boolean): void {
  const list = state.summons;
  if (!list || !list.length) return;
  for (let k = list.length - 1; k >= 0; k--) {
    const s = list[k];
    const f = F(state, s.owner), o = F(state, 1 - s.owner);
    s.life--;
    s.modeFrame++;
    if (s.life <= 0 || f.mode === 'thrown' || f.mode === 'knockdown') { dispel(state, k, s.life <= 0 ? 'expire' : 'owner'); continue; }
    const n = norm2(o.pos.x - s.pos.x, o.pos.z - s.pos.z, s.facing.x, s.facing.z);
    if (s.mode !== 'attack') { s.facing.x = n.x; s.facing.z = n.z; }
    if (s.mode === 'appear') {
      s.pose = 'vanish';
      if (s.modeFrame >= 12) { s.mode = 'idle'; s.modeFrame = 0; }
      continue;
    }
    if (s.mode === 'idle') {
      flankSpot(state, s.owner, s.slot, spot);
      const dx = spot.x - s.pos.x, dz = spot.z - s.pos.z;
      const d = isqrt(dx * dx + dz * dz);
      const v = d > 70 ? 70 : d;
      if (d > 0) { s.pos.x += Math.trunc((dx * v) / d); s.pos.z += Math.trunc((dz * v) / d); }
      s.pose = d > 40 ? (((s.modeFrame / 6) | 0) % 2 ? 'walk2' : 'walk1') : 'idle';
      if (s.queued) {
        s.delay--;
        if (s.delay <= 0) {
          // flash-step onto the flank spot, then copy the move from there
          s.pos.x = spot.x; s.pos.z = spot.z;
          const nn = norm2(o.pos.x - s.pos.x, o.pos.z - s.pos.z, s.facing.x, s.facing.z);
          s.facing.x = nn.x; s.facing.z = nn.z;
          s.mode = 'attack'; s.modeFrame = 0; s.moveId = s.queued; s.queued = null; s.moveFrame = 0; s.hitMask = 0;
        }
      }
      continue;
    }
    // attack
    const m = s.moveId ? moveDef(f.char, s.moveId) : undefined;
    if (!m) { dispel(state, k, 'done'); continue; }
    if (m.movement) {
      let kf: [number, number, number] | null = null;
      for (const q of m.movement) if (q[0] <= s.moveFrame) kf = q;
      if (kf) { s.pos.x += Math.trunc((s.facing.x * kf[1]) / 1000); s.pos.z += Math.trunc((s.facing.z * kf[1]) / 1000); }
      const lim = state.arenaHalfSize - 260;
      s.pos.x = clamp(s.pos.x, -lim, lim); s.pos.z = clamp(s.pos.z, -lim, lim);
    }
    s.pose = animPose(m.anim, s.moveFrame);
    const fr = s.moveFrame + 1;
    if (hitsLive && o.mode !== 'knockdown' && strikeable(o)) {
      const view = { pos: s.pos, facing: s.facing, side: f.side } as unknown as FighterState;
      for (let h = 0; h < m.hitboxes.length; h++) {
        const hb = m.hitboxes[h];
        if (fr < hb.from || fr > hb.to || (s.hitMask & (1 << h))) continue;
        const c = hitCap(view, hb);
        if (hitsFighter(c, o)) {
          const copy: MoveDef = { ...m, damage: Math.max(1, Math.trunc((m.damage * 40) / 100)), chip: Math.trunc((m.chip ?? 0) / 2), kiGain: Math.trunc((m.kiGain ?? 0) / 2) };
          const pt = vec(contact.x, contact.y, contact.z);
          const r = resolveStrike(state, s.owner, copy, pt, fakeProj(s.owner, s.pos.x, s.pos.z, s.facing.x, s.facing.z));
          if (r !== 'none') { s.hitMask |= 1 << h; tagLast(state, 'clone'); }
          break;
        }
      }
    }
    s.moveFrame++;
    if (s.moveFrame >= totalFrames(m)) dispel(state, k, 'done');
  }
}

export { setForm };
