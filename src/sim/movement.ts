/**
 * Fighter state machine (neutral movement) and per-mode physics:
 * walk, crouch, guard, sidestep / sidewalk (circling the opponent), dash, backdash,
 * jumps, juggle gravity, knockback, ground bounce, wall splat, landing.
 */
import type { GameState } from './types';
import { F, emit, setMode, ensureMode, moveOf, chest, vec, faceToward, speedPct, bodyRadius, type SF } from './fighter';
import { startRealm, spawnClones, frozenByRealm, realmActive } from './crossover';
import {
  R_UP, R_DOWN, R_FWD, R_BACK, DIR_MASK, B_G, B_S, B_L, B_H, B_K,
  EV_UP, EV_UP_DOUBLE, EV_DOWN_TAP, EV_FWD, EV_BACK, EV_FWD_DOUBLE, EV_BACK_DOUBLE,
} from './input';
import { tryActions, attackThink } from './commands';
import { updateThrown, toJuggle } from './hit';
import { spawnProjectiles } from './projectiles';
import { teleport, updateVanish } from './meters';
import { CHARS } from '../data';
import { isqrt, clamp } from '../core/fixed';
import {
  SIDESTEP_FRAMES, SIDEWALK_PCT, DASH_FRAMES, DASH_ACT, BACKDASH_FRAMES, BACKDASH_ACT, PREJUMP, JUMP_FWD,
  LAND_LAG, AIR_LAND_LAG, GRAVITY, KICHARGE_HOLD, KD_MIN, SPLAT_FRAMES, JUGGLE_G2_BASE, JUGGLE_G2_MAX_EXTRA,
} from './constants';

// ---------------------------------------------------------------- neutral input -> movement
function startSidestep(state: GameState, i: number, dir: -1 | 1): void {
  const f = F(state, i);
  setMode(f, 'sidestep');
  // dir -1 = into the screen (away from the camera), +1 = out of the screen
  const n = state.camera.normal;
  f.sim.ssX = Math.trunc((n.x * dir));
  f.sim.ssZ = Math.trunc((n.z * dir));
  f.sim.ssLateral = 0;
  emit(state, { type: 'sidestep', player: i as 0 | 1, pos: vec(f.pos.x, 0, f.pos.z), charId: f.char, tag: dir < 0 ? 'in' : 'out' });
}

function startJump(state: GameState, i: number, dir: -1 | 0 | 1): void {
  const f = F(state, i);
  setMode(f, 'jump');
  f.sim.jumpX = Math.trunc((f.facing.x * JUMP_FWD * dir) / 1000);
  f.sim.jumpZ = Math.trunc((f.facing.z * JUMP_FWD * dir) / 1000);
  f.sim.airAttackUsed = false;
  f.vel.x = f.vel.z = 0;
}

function startDash(state: GameState, i: number, back: boolean): void {
  const f = F(state, i);
  setMode(f, back ? 'backdash' : 'dash');
  emit(state, { type: 'dash', player: i as 0 | 1, pos: vec(f.pos.x, 0, f.pos.z), charId: f.char, tag: back ? 'back' : 'forward' });
}

function neutralMovement(state: GameState, i: number): void {
  const f = F(state, i), s = f.sim;
  const rel = s.rel, ev = s.dirEv;
  const c = CHARS[f.char];
  f.vel.x = 0; f.vel.z = 0;
  if (s.landLag > 0) { if (s.held[B_G] > 0) ensureMode(f, 'guard'); return; }
  // Up: jump (with forward/back), neutral jump (double tap), sidestep in (tap)
  if (ev & EV_UP) {
    if (rel & (R_FWD | R_BACK)) startJump(state, i, rel & R_FWD ? 1 : -1);
    else if (ev & EV_UP_DOUBLE) startJump(state, i, 0);
    else startSidestep(state, i, -1);
    return;
  }
  if ((rel & R_UP) && (ev & (EV_FWD | EV_BACK))) { startJump(state, i, ev & EV_FWD ? 1 : -1); return; }
  if (ev & EV_DOWN_TAP) { startSidestep(state, i, 1); return; }
  if (ev & EV_FWD_DOUBLE) { startDash(state, i, false); return; }
  if (ev & EV_BACK_DOUBLE) { startDash(state, i, true); return; }
  if (s.held[B_G] > 0) { ensureMode(f, 'guard'); return; }
  if (rel & R_DOWN) { ensureMode(f, 'crouch'); return; }
  if (rel & R_UP) {
    // holding Up after a sidestep (or from neutral) = sidewalk into the screen
    if (f.mode !== 'sidewalk') { setMode(f, 'sidewalk'); f.sim.ssX = -state.camera.normal.x; f.sim.ssZ = -state.camera.normal.z; }
    return;
  }
  // Ki charge: hold S alone, no direction
  const onlyS = s.held[B_S] > 0 && s.held[B_L] === 0 && s.held[B_H] === 0 && s.held[B_K] === 0 && (rel & DIR_MASK) === 0;
  if (onlyS && (f.mode === 'kicharge' || s.held[B_S] >= KICHARGE_HOLD)) {
    if (f.mode !== 'kicharge') {
      setMode(f, 'kicharge');
      emit(state, { type: 'kiCharge', player: i as 0 | 1, pos: chest(f), charId: f.char, element: 'ki' });
    }
    return;
  }
  const sp = speedPct(f);
  if (rel & R_FWD) {
    ensureMode(f, 'walk');
    const w = Math.trunc((c.walkSpeed * sp) / 100);
    f.vel.x = Math.trunc((f.facing.x * w) / 1000);
    f.vel.z = Math.trunc((f.facing.z * w) / 1000);
    return;
  }
  if (rel & R_BACK) {
    ensureMode(f, 'walk');
    const w = Math.trunc((c.backWalkSpeed * sp) / 100);
    f.vel.x = -Math.trunc((f.facing.x * w) / 1000);
    f.vel.z = -Math.trunc((f.facing.z * w) / 1000);
    return;
  }
  // training dummy crouch option
  if (state.training && i === 1 && state.trainingOpts?.dummyCrouch) { ensureMode(f, 'crouch'); return; }
  ensureMode(f, 'idle');
}

/** input-driven decisions for one fighter (only called for non-frozen fighters while inputs are live) */
export function think(state: GameState, i: number): void {
  const f = F(state, i), s = f.sim;
  // frozen inside the opponent's Soul Realm (Infinite Void): no inputs at all
  if (frozenByRealm(f)) {
    if (f.mode === 'walk' || f.mode === 'sidewalk' || f.mode === 'guard' || f.mode === 'crouch' || f.mode === 'kicharge') setMode(f, 'idle');
    return;
  }
  switch (f.mode) {
    case 'idle': case 'walk': case 'crouch': case 'guard': case 'sidewalk': case 'kicharge':
      if (s.landLag === 0 && tryActions(state, i, 'free')) return;
      neutralMovement(state, i);
      return;
    case 'sidestep':
      // Up then Forward/Back within the first frames converts the sidestep into a jump
      if (f.modeFrame <= 2 && (s.rel & R_UP) && (s.rel & (R_FWD | R_BACK)) && s.ssX * state.camera.normal.x + s.ssZ * state.camera.normal.z < 0) {
        startJump(state, i, s.rel & R_FWD ? 1 : -1);
        return;
      }
      if (s.dirEv & EV_UP_DOUBLE) { startJump(state, i, 0); return; } // tap-tap Up = neutral jump
      if (f.modeFrame >= 1) tryActions(state, i, 'sidestep');
      return;
    case 'dash':
      if (f.modeFrame >= DASH_ACT && tryActions(state, i, 'free')) return;
      if (s.dirEv & EV_BACK) setMode(f, 'idle');
      return;
    case 'backdash':
      if (f.modeFrame >= BACKDASH_ACT) tryActions(state, i, 'free');
      return;
    case 'jump':
      if (f.airborne && f.modeFrame > PREJUMP) tryActions(state, i, 'air');
      return;
    case 'attack':
      attackThink(state, i);
      return;
    case 'knockdown':
      // early wake-up: press any button after KD_MIN frames
      if (f.modeFrame >= KD_MIN && (s.press[B_L] === 0 || s.press[B_H] === 0 || s.press[B_K] === 0 || s.press[B_S] === 0 || (s.dirEv & EV_UP))) {
        setMode(f, 'wakeup');
        emit(state, { type: 'land', player: i as 0 | 1, pos: vec(f.pos.x, 0, f.pos.z), charId: f.char, tag: 'tech' });
      }
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------- physics
/** move laterally (perpendicular to the fighter axis) while keeping the distance to the opponent */
function circle(f: SF, o: { x: number; z: number }, speed: number): void {
  const dx0 = f.pos.x - o.x, dz0 = f.pos.z - o.z;
  const d0 = isqrt(dx0 * dx0 + dz0 * dz0);
  // lateral = perpendicular to facing, sign chosen to continue the stored direction
  let lx = -f.facing.z, lz = f.facing.x;
  if (lx * f.sim.ssX + lz * f.sim.ssZ < 0) { lx = -lx; lz = -lz; }
  f.sim.ssX = lx; f.sim.ssZ = lz;
  let nx = f.pos.x + Math.trunc((lx * speed) / 1000);
  let nz = f.pos.z + Math.trunc((lz * speed) / 1000);
  if (d0 > 0) {
    const ddx = nx - o.x, ddz = nz - o.z;
    const d1 = isqrt(ddx * ddx + ddz * ddz);
    if (d1 > 0) { nx = o.x + Math.trunc((ddx * d0) / d1); nz = o.z + Math.trunc((ddz * d0) / d1); }
  }
  f.vel.x = nx - f.pos.x;
  f.vel.z = nz - f.pos.z;
}

function land(state: GameState, i: number, lag: number): void {
  const f = F(state, i);
  f.pos.y = 0; f.vel.y = 0; f.vel.x = 0; f.vel.z = 0;
  f.airborne = false;
  setMode(f, 'idle');
  f.sim.landLag = lag;
  emit(state, { type: 'land', player: i as 0 | 1, pos: vec(f.pos.x, 0, f.pos.z), charId: f.char });
}

/**
 * Juggle gravity. In thousandths of mm/f²: (BASE + min(MAX_EXTRA, comboHits)) x 500 x weight/100,
 * spread exactly over frames (integer, deterministic). Starts floaty (2 mm/f²) so a launcher can
 * be followed up and gets heavier with every hit, so juggles always end (JUGGLE_* in constants).
 * Weight counts half (Goro 125 -> x1.125, Shiori 92 -> x0.96) so one timing works on everyone.
 */
function juggleGravity(f: SF): number {
  const w = 100 + Math.trunc((CHARS[f.char].weight - 100) / 2);
  let gm = (JUGGLE_G2_BASE + Math.min(JUGGLE_G2_MAX_EXTRA, f.comboHits)) * 5 * w;
  if (gear5(f)) gm = Math.trunc((gm * 2) / 3); // Gear Fifth: cartoon physics, juggles float
  const t = f.modeFrame;
  return Math.trunc((gm * (t + 1)) / 1000) - Math.trunc((gm * t) / 1000);
}

/** fighter f is being juggled inside the opponent's Gear Fifth realm */
let gearState: GameState | null = null;
function gear5(f: SF): boolean {
  const st = gearState;
  if (!st || !st.realm) return false;
  const oi = st.fighters[0] === f ? 1 : 0;
  return realmActive(st, 'gear_fifth', oi);
}

/**
 * Start-of-physics snapshot of both fighters' position + facing. Everything in the physics
 * phase that looks at the OTHER fighter (sidestep circling, teleports, throw holds) reads
 * this snapshot, so the result does not depend on which player is processed first.
 */
export const snap = [
  { x: 0, y: 0, z: 0, fx: 1000, fz: 0 },
  { x: 0, y: 0, z: 0, fx: -1000, fz: 0 },
];
export function snapshot(state: GameState): void {
  gearState = state;
  for (let i = 0; i < 2; i++) {
    const f = F(state, i), p = snap[i];
    p.x = f.pos.x; p.y = f.pos.y; p.z = f.pos.z; p.fx = f.facing.x; p.fz = f.facing.z;
  }
}

/** phase 1 of physics: mode logic -> velocities (reads the other fighter only through `snap`) */
export function physics(state: GameState, i: number): void {
  const f = F(state, i), s = f.sim;
  const o = snap[1 - i];
  const c = CHARS[f.char];
  switch (f.mode) {
    case 'walk':
      break; // velocity set by neutralMovement
    case 'sidestep': {
      const mf = f.modeFrame;
      const v = mf < 10 ? c.sidestepSpeed : Math.trunc((c.sidestepSpeed * (SIDESTEP_FRAMES - mf)) / 8);
      circle(f, o, Math.max(0, v));
      s.ssLateral += Math.max(0, v);
      break;
    }
    case 'sidewalk':
      circle(f, o, Math.trunc((c.sidestepSpeed * SIDEWALK_PCT) / 100));
      break;
    case 'dash': {
      const v = Math.trunc((Math.trunc((c.dashSpeed * speedPct(f)) / 100) * (DASH_FRAMES - f.modeFrame)) / DASH_FRAMES);
      f.vel.x = Math.trunc((f.facing.x * v) / 1000); f.vel.z = Math.trunc((f.facing.z * v) / 1000);
      break;
    }
    case 'backdash': {
      const v = Math.trunc((c.dashSpeed * 8 * (BACKDASH_FRAMES - f.modeFrame)) / (10 * BACKDASH_FRAMES));
      f.vel.x = -Math.trunc((f.facing.x * v) / 1000); f.vel.z = -Math.trunc((f.facing.z * v) / 1000);
      break;
    }
    case 'jump':
      if (!f.airborne) {
        if (f.modeFrame >= PREJUMP) {
          f.airborne = true;
          f.vel.y = c.jumpVel;
          f.vel.x = s.jumpX; f.vel.z = s.jumpZ;
          emit(state, { type: 'jump', player: i as 0 | 1, pos: vec(f.pos.x, 0, f.pos.z), charId: f.char });
        } else { f.vel.x = 0; f.vel.z = 0; }
      } else f.vel.y -= GRAVITY;
      break;
    case 'attack': {
      const m = moveOf(f);
      if (!m) break;
      if (m.movement && !(f.airborne && m.requires === 'air')) {
        let kf: [number, number, number] | null = null;
        for (const k of m.movement) if (k[0] <= f.moveFrame) kf = k;
        if (kf) {
          f.vel.x = Math.trunc((f.facing.x * kf[1]) / 1000);
          f.vel.z = Math.trunc((f.facing.z * kf[1]) / 1000);
          if (kf[0] === f.moveFrame && kf[2] !== 0 && !f.stance) { f.vel.y = kf[2]; f.airborne = true; }
        } else if (!f.airborne) { f.vel.x = 0; f.vel.z = 0; }
      } else if (!f.airborne) { f.vel.x = 0; f.vel.z = 0; }
      if (f.airborne) f.vel.y -= GRAVITY;
      if (m.teleport && f.moveFrame === m.teleport.frame && !f.stance) teleport(state, i, m.teleport.to, undefined, o);
      if (m.projectile && f.moveFrame + 1 === m.projectile.spawnFrame && !f.stance) spawnProjectiles(state, i, m);
      if (m.realm && f.moveFrame === m.startup) startRealm(state, i, m);
      if (m.summon && f.moveFrame === m.summon.frame) spawnClones(state, i, m.summon.count);
      break;
    }
    case 'juggle':
      f.vel.x = s.knockX; f.vel.z = s.knockZ;
      f.vel.y -= juggleGravity(f);
      break;
    case 'wallsplat':
      f.vel.x = 0; f.vel.z = 0; f.vel.y = f.pos.y > 0 ? -5 : 0;
      break;
    case 'thrown':
      updateThrown(state, i, snap[f.sim.partner >= 0 ? f.sim.partner : 1 - i]);
      f.vel.x = f.vel.z = f.vel.y = 0;
      break;
    case 'vanish':
      updateVanish(state, i, o);
      f.vel.x = f.vel.z = 0;
      break;
    default:
      // idle, crouch, guard, kicharge, hitstun, blockstun, knockdown, wakeup, awaken, intro, win, lose, clash
      f.vel.x = 0; f.vel.z = 0;
      if (f.airborne) f.vel.y -= GRAVITY;
      else f.vel.y = 0;
  }
}

/** phase 2 of physics: integrate velocity + pushback, landing (runs after phase 1 for BOTH fighters) */
export function integrate(state: GameState, i: number): void {
  const f = F(state, i), o = F(state, 1 - i), s = f.sim;

  // integrate
  f.pos.x += f.vel.x;
  f.pos.z += f.vel.z;
  f.pos.y += f.vel.y;
  // knockback push (hit / block pushback), applied over a few frames
  if (s.pushX !== 0 || s.pushZ !== 0) {
    let dx = Math.trunc(s.pushX / 3), dz = Math.trunc(s.pushZ / 3);
    if (Math.abs(s.pushX) < 8) dx = s.pushX;
    if (Math.abs(s.pushZ) < 8) dz = s.pushZ;
    f.pos.x += dx; f.pos.z += dz;
    s.pushX -= dx; s.pushZ -= dz;
  }

  // landing
  if (f.pos.y <= 0 && (f.airborne || f.vel.y < 0)) {
    f.pos.y = 0;
    if (f.airborne) {
      if (f.mode === 'juggle') {
        if (gear5(f) && (s.bounceExtra ?? 0) < 2 && f.comboHits < 9) {
          // Gear Fifth: the floor is rubber too
          s.bounceExtra = (s.bounceExtra ?? 0) + 1;
          f.vel.y = 40;
          f.pos.y = 1;
          emit(state, { type: 'groundBounce', player: (1 - i) as 0 | 1, target: i as 0 | 1, pos: vec(f.pos.x, 0, f.pos.z), charId: o.char, tag: 'gear5' });
        } else if (s.bounce && !s.bounceUsed) {
          s.bounce = false; s.bounceUsed = true;
          f.vel.y = 46;
          s.knockX = Math.trunc(s.knockX / 2); s.knockZ = Math.trunc(s.knockZ / 2);
          f.pos.y = 1;
          emit(state, { type: 'groundBounce', player: (1 - i) as 0 | 1, target: i as 0 | 1, pos: vec(f.pos.x, 0, f.pos.z), charId: o.char });
        } else {
          setMode(f, 'knockdown');
          f.airborne = false; f.vel.y = 0; s.bounce = false; s.enderUsed = false; s.otgUsed = false;
          emit(state, { type: 'land', player: i as 0 | 1, pos: vec(f.pos.x, 0, f.pos.z), charId: f.char, tag: 'body' });
          emit(state, { type: 'knockdown', player: (1 - i) as 0 | 1, target: i as 0 | 1, pos: vec(f.pos.x, 0, f.pos.z), charId: f.char, combo: f.comboHits, damage: f.comboDamage });
        }
      } else if (f.mode === 'jump') land(state, i, LAND_LAG);
      else if (f.mode === 'attack') {
        const m = moveOf(f);
        if (m?.requires === 'air') land(state, i, AIR_LAND_LAG);
        else { f.airborne = false; f.vel.y = 0; f.vel.x = 0; f.vel.z = 0; if (m && f.moveFrame > m.startup + m.active) emit(state, { type: 'land', player: i as 0 | 1, pos: vec(f.pos.x, 0, f.pos.z), charId: f.char }); }
      } else if (f.mode === 'wallsplat') { f.airborne = false; f.vel.y = 0; }
      else if (f.mode === 'thrown') { f.airborne = false; f.vel.y = 0; }
      else { f.airborne = false; f.vel.y = 0; if (f.mode === 'hitstun' || f.mode === 'blockstun' || f.mode === 'idle') emit(state, { type: 'land', player: i as 0 | 1, pos: vec(f.pos.x, 0, f.pos.z), charId: f.char }); }
    } else f.vel.y = 0;
  }
  if (f.pos.y > 0 && f.mode !== 'thrown') f.airborne = true;
}

/** walls: clamp, transfer pushback to the attacker, wall splat */
export function walls(state: GameState, i: number): void {
  const f = F(state, i), o = F(state, 1 - i), s = f.sim;
  const lim = state.arenaHalfSize - bodyRadius(f);
  let hitWall = false;
  let wallDot = 0;
  if (f.pos.x > lim) { f.pos.x = lim; hitWall = true; wallDot = s.knockX; if (s.pushX > 0) { o.sim.pushX -= s.pushX; s.pushX = 0; } }
  else if (f.pos.x < -lim) { f.pos.x = -lim; hitWall = true; wallDot = -s.knockX; if (s.pushX < 0) { o.sim.pushX -= s.pushX; s.pushX = 0; } }
  if (f.pos.z > lim) { f.pos.z = lim; hitWall = true; wallDot = Math.max(wallDot, s.knockZ); if (s.pushZ > 0) { o.sim.pushZ -= s.pushZ; s.pushZ = 0; } }
  else if (f.pos.z < -lim) { f.pos.z = -lim; hitWall = true; wallDot = Math.max(wallDot, -s.knockZ); if (s.pushZ < 0) { o.sim.pushZ -= s.pushZ; s.pushZ = 0; } }
  // Wall splat: a juggled fighter knocked into the wall sticks to it (once per combo)
  if (hitWall && f.mode === 'juggle' && !s.splatUsed && wallDot >= 8) {
    setMode(f, 'wallsplat');
    s.splatUsed = true;
    s.knockX = s.knockZ = 0;
    f.vel.x = f.vel.z = 0; f.vel.y = 0;
    if (f.pos.y < 300) f.pos.y = 300;
    f.airborne = true;
    emit(state, { type: 'wallSplat', player: (1 - i) as 0 | 1, target: i as 0 | 1, pos: vec(f.pos.x, f.pos.y + 1000, f.pos.z), charId: f.char, combo: f.comboHits });
  }
}

export { toJuggle, SPLAT_FRAMES, faceToward, clamp };
