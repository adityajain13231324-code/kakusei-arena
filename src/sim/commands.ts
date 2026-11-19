/**
 * Command selection: turns buffered inputs into actions (moves, throws, vanish,
 * awakening, ultimates) for free fighters, and handles string / special / vanish
 * cancels during attacks. Priority (highest first):
 *   Ultimate > Awakening > Vanish > Throw > Ki special > Special > Normal.
 */
import type { GameState, MoveDef } from './types';
import { F, emit, setMode, faceToward, moveOf, chest, type SF } from './fighter';
import {
  B_L, B_H, B_K, B_S, B_U, fresh, together, consume, motionDone, parseInput, digitOf, dirMatches, charTables, R_DOWN, R_FWD, R_BACK,
} from './input';
import { CHARS, moveDef } from '../data';
import { canAwaken, startAwaken, startVanish, spendKi, ultCost } from './meters';
import { VANISH_COST, BUFFER } from './constants';
import { hooks } from './hit';
import { canRealm, cloneCount, onMoveStart, consumeClones, REALM_COST } from './crossover';

const LHK = [B_L, B_H, B_K];
const TOK = ['L', 'H', 'K'];

/** Start a move (resets per-move bookkeeping, snaps facing, pays ki for ki specials). */
export function startMove(state: GameState, i: number, m: MoveDef, easy = false): void {
  const f = F(state, i), o = F(state, 1 - i), s = f.sim;
  f.mode = 'attack';
  f.modeFrame = 0;
  f.moveId = m.id;
  f.moveFrame = 0;
  f.stance = false;
  s.hitMask = 0;
  s.contact = 0;
  s.activeDone = false;
  s.queued = null;
  s.easyMove = easy;
  s.armorUsed = false;
  s.heatUsed = 0;
  s.partner = -1;
  s.turnLock = 0; // attacking turns you around ("vanish read")
  faceToward(f, o.pos);
  if ((m.kind === 'ki' || m.kind === 'special') && m.kiCost) spendKi(f, m.kiCost);
  if (m.needClones) consumeClones(state, i, 'rush');
  if (m.heat === 'consume' && f.heatStacks > 0) {
    s.heatUsed = f.heatStacks;
    f.heatStacks = 0;
  }
  if (!f.airborne) { f.vel.x = 0; f.vel.z = 0; }
  else s.airAttackUsed = true;
  emit(state, {
    type: 'moveStart', player: i as 0 | 1, pos: chest(f), moveId: m.id, strength: m.strength, element: m.element, charId: f.char,
    tag: s.heatUsed > 0 ? 'heat' : m.kind,
  });
  onMoveStart(state, i, m);
  if (m.kind === 'ultimate' && !m.internal) {
    state.camera.cinematic = { kind: 'ultimate', player: i as 0 | 1, frame: 0 };
    emit(state, { type: 'ultimateStart', player: i as 0 | 1, pos: chest(f), moveId: m.id, element: m.element, charId: f.char, strength: 'super' });
  }
}

hooks.startMoveById = (state, i, id) => {
  const m = moveDef(F(state, i).char, id);
  if (m) startMove(state, i, m);
};

function startUlt(state: GameState, i: number): boolean {
  const f = F(state, i);
  if (f.airborne) return false;
  const def = CHARS[f.char];
  // Soul Realm: awakened + 300 Ki turns the awakened ultimate into the fighter's realm (once per match)
  if (canRealm(state, i)) {
    const rm = moveDef(f.char, def.realmId!);
    if (rm) {
      spendKi(f, REALM_COST);
      f.sim.realmUsed = true;
      startMove(state, i, rm, state.schemes[i] === 'easy');
      return true;
    }
  }
  const cost = ultCost(f);
  if (f.ki < cost) return false;
  let id = f.awakened && def.awakenedUltimateId ? def.awakenedUltimateId : def.ultimateId;
  let m = moveDef(f.char, id);
  if (m && m.needForm !== undefined && (f.form ?? '') !== m.needForm) { id = def.ultimateId; m = moveDef(f.char, id); }
  if (!m || (m.needForm !== undefined && (f.form ?? '') !== m.needForm)) return false;
  spendKi(f, cost);
  startMove(state, i, m, state.schemes[i] === 'easy');
  return true;
}

function reqOk(f: SF, m: MoveDef, state?: GameState, i = 0): boolean {
  if (m.needForm !== undefined && (f.form ?? '') !== m.needForm) return false;
  if (m.kind === 'special' && m.kiCost && f.ki < m.kiCost) return false;
  if (m.needClones && (!state || cloneCount(state, i) < m.needClones)) return false;
  if (m.requires === 'awakened') return f.awakened;
  if (m.requires === 'stance') return false;
  return true;
}

/** chain-table key prefix for form-specific strings (Zoro sword styles, Eren titan) */
export function formKey(m: MoveDef): string {
  return m.needForm ? m.needForm + ':' : '';
}

export function wantsUltIdx(state: GameState, i: number): boolean {
  return wantsUlt(state, F(state, i), i);
}

function wantsUlt(state: GameState, f: SF, i: number): boolean {
  if (state.schemes[i] === 'easy') return fresh(f, B_U);
  if (!together(f, [B_H, B_S])) return false;
  return motionDone(f, '236', Math.min(f.sim.press[B_H], f.sim.press[B_S], BUFFER));
}

function pickKi(state: GameState, f: SF, i: number): MoveDef | null {
  if (!together(f, [B_S, B_K])) return null;
  const easy = state.schemes[i] === 'easy';
  const cur = digitOf(f.sim.rel);
  const extra = Math.min(f.sim.press[B_S], f.sim.press[B_K], BUFFER);
  // Easy: direction-specific inputs (2S+K) win over the plain S+K catch-all
  if (easy) for (const m of charTables(f.char).kis) {
    if (!reqOk(f, m, state, i) || f.ki < (m.kiCost ?? 0)) continue;
    const d = parseInput(m.easyInput ?? '').dir;
    if (d !== 0 && dirMatches(d, cur)) return m;
  }
  for (const m of charTables(f.char).kis) {
    if (!reqOk(f, m, state, i) || f.ki < (m.kiCost ?? 0)) continue;
    if (easy) { if (dirMatches(parseInput(m.easyInput ?? '').dir, cur)) return m; }
    else {
      const p = parseInput(m.input);
      if (p.motion ? motionDone(f, p.motion, extra) : dirMatches(p.dir, cur)) return m;
    }
  }
  return null;
}

function pickSpecial(state: GameState, f: SF, i: number): MoveDef | null {
  if (!fresh(f, B_S)) return null;
  const easy = state.schemes[i] === 'easy';
  const cur = digitOf(f.sim.rel);
  const extra = Math.min(f.sim.press[B_S], BUFFER);
  // Pro: motion specials first (by priority), then direction specials like Ren's 4S
  for (const m of charTables(f.char).specials) {
    if (!reqOk(f, m, state, i)) continue;
    const p = parseInput(m.input);
    if (easy) {
      const e = parseInput(m.easyInput ?? m.input);
      if (e.dir !== 0 && dirMatches(e.dir, cur)) return m;
    } else if (p.motion) {
      if (motionDone(f, p.motion, extra)) return m;
    } else if (p.dir !== 0 && dirMatches(p.dir, cur)) return m;
  }
  return null;
}

/** normals: direction-specific first, then fallbacks (3 -> 2 -> neutral, 1 -> 2 -> neutral, 6/4/8 -> neutral) */
function pickNormal(f: SF): { m: MoveDef; b: number } | null {
  const air = f.airborne;
  const cur = digitOf(f.sim.rel);
  const order = cur === 3 || cur === 1 ? [cur, 2, 0] : cur === 2 ? [2, 0] : cur === 5 || cur >= 7 ? [0] : [cur, 0];
  // newest press first
  let best: { m: MoveDef; b: number } | null = null;
  let bestAge = 99;
  for (const b of LHK) {
    if (!fresh(f, b) || f.sim.press[b] >= bestAge) continue;
    const tok = TOK[b];
    let found: MoveDef | null = null;
    for (const want of air ? [0] : order) {
      for (const m of charTables(f.char).normals) {
        if (!reqOk(f, m)) continue;
        if ((m.requires === 'air') !== air) continue;
        const p = parseInput(m.input);
        if (p.buttons.length !== 1 || TOK[p.buttons[0]] !== tok) continue;
        if (p.dir === want) { found = m; break; }
      }
      if (found) break;
    }
    if (found) { best = { m: found, b }; bestAge = f.sim.press[b]; }
  }
  return best;
}

export type ActCtx = 'free' | 'sidestep' | 'air' | 'upgrade' | 'cancel';

/**
 * Try to start an action from buffered input. `allow` restricts cancel categories.
 * Returns true if something started.
 */
export function tryActions(state: GameState, i: number, ctx: ActCtx, allow?: string[]): boolean {
  const f = F(state, i);
  const can = (k: string) => !allow || allow.indexOf(k) >= 0;
  if (ctx === 'air') {
    if (f.sim.airAttackUsed) return false;
    const n = pickNormal(f);
    if (n) { consume(f, [n.b]); startMove(state, i, n.m, false); return true; }
    return false;
  }
  const neutral = ctx === 'free' || ctx === 'sidestep' || ctx === 'upgrade';
  // 1. Ultimate
  if ((neutral || can('ultimate')) && wantsUlt(state, f, i) && startUlt(state, i)) {
    consume(f, [B_H, B_S, B_U]);
    return true;
  }
  if (neutral) {
    // 2. Awakening (L+H+K, once per match, below 35% HP)
    if (together(f, [B_L, B_H, B_K]) && canAwaken(f) && !f.airborne) {
      consume(f, [B_L, B_H, B_K]);
      startAwaken(state, i);
      return true;
    }
    // 3. Vanish Step (H+K, 1 bar)
    if (together(f, [B_H, B_K]) && f.ki >= VANISH_COST && !f.airborne) {
      consume(f, [B_H, B_K]);
      startVanish(state, i);
      return true;
    }
    // 4. Throw (L+K)
    if (together(f, [B_L, B_K]) && !f.airborne) {
      const m = moveDef(f.char, `${f.char}_throw`);
      if (m) { consume(f, [B_L, B_K]); startMove(state, i, m); return true; }
    }
  }
  // 5. Ki specials
  if (neutral || can('ki')) {
    const m = pickKi(state, f, i);
    if (m && !f.airborne) { consume(f, [B_S, B_K]); startMove(state, i, m, state.schemes[i] === 'easy'); return true; }
  }
  if (ctx === 'upgrade') return false;
  // 6. Specials
  if (ctx === 'free' || ctx === 'sidestep' || can('special')) {
    const m = pickSpecial(state, f, i);
    if (m && !f.airborne) { consume(f, [B_S]); startMove(state, i, m, state.schemes[i] === 'easy'); return true; }
  }
  if (ctx === 'cancel') return false;
  // 7. Normals
  const n = pickNormal(f);
  if (n) { consume(f, [n.b]); startMove(state, i, n.m, false); return true; }
  return false;
}

/** cancels while attacking: strings, auto-combo, combo upgrades, special/vanish cancels, stance */
export function attackThink(state: GameState, i: number): void {
  const f = F(state, i), s = f.sim;
  const m = moveOf(f);
  if (!m) return;
  // ---- hold stance (Ren)
  if (m.stance) {
    if (f.moveFrame >= m.stance.loopFrame) {
      const inStance = f.modeFrame - m.stance.loopFrame;
      if (s.held[4] > 0 || (s.rel & R_DOWN)) { setMode(f, 'idle'); return; }
      if (s.held[B_S] > 0 && inStance < m.stance.maxHold) { f.stance = true; return; }
      f.stance = false;
      const rel = moveDef(f.char, m.stance.releaseMove);
      if (rel) startMove(state, i, rel, s.easyMove);
    }
    return;
  }
  const fr = f.moveFrame + 1;
  const win = m.cancelWindow ?? [m.startup + 1, m.startup + m.active + 10];
  // a follow-up never cuts off the current move's active frames unless it already connected
  const open = s.contact > 0 ? win[0] : Math.max(win[0], m.startup + m.active + 1);
  // ---- Vanish Step cancel on hit or block (any time after contact)
  if (s.contact > 0 && together(f, [B_H, B_K]) && f.ki >= VANISH_COST && !f.airborne && m.kind !== 'ultimate' && s.partner < 0) {
    consume(f, [B_H, B_K]);
    startVanish(state, i);
    return;
  }
  // ---- multi-button upgrade in the first frames of a normal (jab -> throw / vanish / ki / ult)
  if (m.kind === 'normal' && f.moveFrame <= 2 && !f.airborne) {
    if (tryActions(state, i, 'upgrade')) return;
  }
  // ---- special / ki / ultimate cancels on contact
  if (s.contact > 0 && m.cancelInto && fr >= win[0] && fr <= win[1]) {
    if (tryActions(state, i, 'cancel', m.cancelInto)) return;
  }
  // ---- queued string follow-up
  if (s.queued) {
    if (fr >= open && fr <= win[1]) {
      const q = moveDef(f.char, s.queued);
      s.queued = null;
      if (q) { startMove(state, i, q, s.easyMove); return; }
    } else if (fr > win[1]) s.queued = null;
  }
  // ---- string follow-ups (buffered from frame 1, executed when the window opens)
  if (m.kind === 'normal' && m.input && !s.queued && fr <= win[1]) {
    const easy = state.schemes[i] === 'easy';
    const tables = charTables(f.char);
    for (const b of LHK) {
      if (!fresh(f, b)) continue;
      const fk = formKey(m);
      let next = tables.chain[`${fk}${m.input},${TOK[b]}`];
      // Easy auto-combo: mashing L walks the string, then cancels into the ender special
      if (!next && easy && b === B_L) next = tables.chain[`${fk}${m.input},H`] ?? tables.chain[`${fk}${m.input},K`];
      if (!next && easy && b === B_L && s.contact > 0 && fr >= win[0] && (m.cancelInto ?? []).indexOf('special') >= 0) {
        const ender = CHARS[f.char].autoComboEnder;
        const em = ender ? moveDef(f.char, ender) : undefined;
        if (em) { consume(f, [b]); startMove(state, i, em, true); return; }
      }
      if (next) {
        consume(f, [b]);
        if (fr >= open) { const nm = moveDef(f.char, next); if (nm) { startMove(state, i, nm, easy); return; } }
        else s.queued = next;
        break;
      }
    }
  }
}

export { R_FWD, R_BACK };
