/**
 * Projectiles (fireballs, kunai fans, crescents, boulders, shockwaves, beams) and
 * BEAM CLASH: two beams from different owners colliding start a mash-off.
 */
import type { GameState, MoveDef, ProjectileState } from './types';
import { F, emit, setMode, vec, chest, moveOf } from './fighter';
import { cap, capsuleHit, contact, hurtCaps, lateralSign, type Cap } from './collision';
import { resolveStrike, toJuggle, stunnedThisStep } from './hit';
import { moveDef } from '../data';
import { isqrt, norm2 } from '../core/fixed';
import { B_L, B_H, B_K, B_S, EV_UP, EV_DOWN, EV_FWD, EV_BACK } from './input';
import { CLASH_FRAMES, CLASH_PUSH } from './constants';
import { projectileSlow, projectileHitsClone, endRealmClash, capDamage } from './crossover';

export function spawnProjectiles(state: GameState, i: number, m: MoveDef): void {
  const f = F(state, i);
  const pd = m.projectile!;
  const count = pd.count ?? 1;
  const ls = lateralSign(f); // mirror the fan order between screen sides
  const rx = -f.facing.z * ls, rz = f.facing.x * ls;
  const bx = f.pos.x + Math.trunc((f.facing.x * pd.x) / 1000);
  const bz = f.pos.z + Math.trunc((f.facing.z * pd.x) / 1000);
  for (let k = 0; k < count; k++) {
    // fan: lateral component spread*(k - mid) per 1000 forward
    const lat = count > 1 ? Math.trunc(((pd.spread ?? 150) * (2 * k - (count - 1))) / 2) : 0;
    const dir = norm2(f.facing.x * 1000 + rx * lat, f.facing.z * 1000 + rz * lat, f.facing.x, f.facing.z);
    const p: ProjectileState = {
      id: state.nextProjectileId++,
      owner: i as 0 | 1,
      kind: pd.kind,
      element: m.element ?? 'none',
      pos: vec(bx, f.pos.y + pd.y, bz),
      vel: vec(Math.trunc((dir.x * pd.speed) / 1000), 0, Math.trunc((dir.z * pd.speed) / 1000)),
      r: pd.r,
      life: pd.life,
      hitsLeft: pd.hits,
      beam: !!pd.beam,
      moveId: m.id,
      cooldown: 0,
      slow: 100,
    };
    if (pd.fuse) { p.fuse = pd.fuse; p.blastR = pd.blastR ?? pd.r * 4; }
    state.projectiles.push(p);
    emit(state, { type: 'projectile', player: i as 0 | 1, pos: { ...p.pos }, moveId: m.id, element: p.element, charId: f.char, tag: p.kind });
  }
}

function destroy(state: GameState, idx: number, reason: string): void {
  const p = state.projectiles[idx];
  emit(state, { type: 'projectileDestroy', player: p.owner, pos: { ...p.pos }, moveId: p.moveId, element: p.element, tag: reason });
  state.projectiles.splice(idx, 1);
}

function projCap(p: ProjectileState): Cap {
  // swept sphere over the last frame so fast projectiles can't tunnel
  const k = p.slow ?? 100;
  const vx = Math.trunc((p.vel.x * k) / 100), vz = Math.trunc((p.vel.z * k) / 100);
  return cap(p.pos.x - vx, p.pos.y, p.pos.z - vz, p.pos.x, p.pos.y, p.pos.z, p.r);
}

function projInvulnerable(state: GameState, i: number): boolean {
  const f = F(state, i);
  if (f.invuln) return true;
  if (f.sim.enderUsed && f.mode === 'juggle') return true;
  const m = f.mode;
  if (m === 'knockdown' || m === 'thrown' || m === 'vanish' || m === 'awaken' || m === 'intro' || m === 'clash' || m === 'win' || m === 'lose') return true;
  if (m === 'attack') {
    const mv = moveOf(f);
    if (mv?.projInvuln) { const fr = f.moveFrame + 1; if (fr >= mv.projInvuln[0] && fr <= mv.projInvuln[1]) return true; }
  }
  return false;
}

const hcaps: Cap[] = [];

/** move projectiles, resolve projectile-vs-projectile and projectile-vs-fighter */
export function updateProjectiles(state: GameState, hitsLive: boolean): void {
  const ps = state.projectiles;
  const lim = state.arenaHalfSize;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    // Gojo's Infinity: enemy projectiles crawl at 30% speed within 1.2 m of him
    const k = projectileSlow(state, p);
    p.slow = k;
    if (k === 100) { p.pos.x += p.vel.x; p.pos.y += p.vel.y; p.pos.z += p.vel.z; }
    else { p.pos.x += Math.trunc((p.vel.x * k) / 100); p.pos.y += Math.trunc((p.vel.y * k) / 100); p.pos.z += Math.trunc((p.vel.z * k) / 100); }
    p.life--;
    // delayed blast (Thunder Spear): stops and detonates with `fuse` frames of life left
    if (p.fuse && p.life === p.fuse) {
      p.vel.x = p.vel.y = p.vel.z = 0;
      p.r = p.blastR ?? p.r;
      emit(state, { type: 'projectile', player: p.owner, pos: { ...p.pos }, moveId: p.moveId, element: p.element, tag: 'detonate' });
    }
    if (p.cooldown && p.cooldown > 0) p.cooldown--;
    if (p.life <= 0) { destroy(state, i, 'expire'); continue; }
    if (Math.abs(p.pos.x) > lim || Math.abs(p.pos.z) > lim) { destroy(state, i, 'wall'); continue; }
  }
  // projectile vs projectile
  if (ps.length > 1) {
    const dead: boolean[] = [];
    for (let i = 0; i < ps.length; i++) dead.push(false);
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        if (dead[i]) break;
        if (dead[j]) continue;
        const a = ps[i], b = ps[j];
        if (a.owner === b.owner) continue;
        const dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y, dz = a.pos.z - b.pos.z;
        // include closing speed so fast heads can't pass through each other in one frame
        const rr = a.r + b.r + ((Math.abs(a.vel.x - b.vel.x) + Math.abs(a.vel.z - b.vel.z)) >> 1);
        if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
        if (a.beam && b.beam) {
          if (!state.clash.active && hitsLive) { startClash(state, a, b); return; }
          continue;
        }
        const mid = vec(Math.trunc((a.pos.x + b.pos.x) / 2), Math.trunc((a.pos.y + b.pos.y) / 2), Math.trunc((a.pos.z + b.pos.z) / 2));
        if (a.beam !== b.beam) {
          const weak = a.beam ? j : i;
          dead[weak] = true;
          emit(state, { type: 'projectileDestroy', player: ps[weak].owner, pos: mid, moveId: ps[weak].moveId, element: ps[weak].element, tag: 'overpowered' });
          continue;
        }
        // two normal projectiles cancel each other out
        dead[i] = dead[j] = true;
        emit(state, { type: 'projectileDestroy', player: a.owner, pos: mid, moveId: a.moveId, element: a.element, tag: 'cancel' });
        emit(state, { type: 'projectileDestroy', player: b.owner, pos: mid, moveId: b.moveId, element: b.element, tag: 'cancel' });
      }
    }
    let w = 0;
    for (let i = 0; i < ps.length; i++) if (!dead[i]) ps[w++] = ps[i];
    ps.length = w;
  }
  if (!hitsLive) return;
  // projectile vs fighter
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    if (p.cooldown && p.cooldown > 0) continue;
    if (p.fuse && p.life > p.fuse) continue; // still flying: harmless until it detonates
    // enemy shadow clones in the path are dispelled
    if (state.summons && state.summons.length && projectileHitsClone(state, p, projCap(p))) {
      p.hitsLeft--;
      if (p.hitsLeft <= 0) { destroy(state, i, 'spent'); continue; }
    }
    const ti = 1 - p.owner;
    if (projInvulnerable(state, ti)) continue;
    const d = F(state, ti);
    const n = hurtCaps(d, hcaps);
    const pc = projCap(p);
    let hit = false;
    for (let k = 0; k < n && !hit; k++) hit = capsuleHit(pc, hcaps[k]);
    if (!hit) continue;
    const m = moveDef(F(state, p.owner).char, p.moveId);
    if (!m) { destroy(state, i, 'invalid'); continue; }
    const pt = vec(contact.x, contact.y, contact.z);
    const r = resolveStrike(state, p.owner, m, pt, p);
    if (r === 'none') continue;
    emit(state, { type: 'projectileHit', player: p.owner, target: ti as 0 | 1, pos: pt, moveId: p.moveId, element: p.element, tag: r });
    p.hitsLeft--;
    p.cooldown = 6;
    if (p.beam) { p.vel.x = 0; p.vel.z = 0; } // beam head pins on the target while it has hits left
    if (p.hitsLeft <= 0) destroy(state, i, 'spent');
  }
}

// ---------------------------------------------------------------- beam clash
function startClash(state: GameState, a: ProjectileState, b: ProjectileState): void {
  const p0 = a.owner === 0 ? a : b, p1 = a.owner === 0 ? b : a;
  const c = state.clash;
  c.active = true;
  c.kind = 'beam';
  c.frame = 0;
  c.duration = CLASH_FRAMES;
  c.balance = 0;
  c.mash = [0, 0];
  c.point = vec(Math.trunc((a.pos.x + b.pos.x) / 2), Math.trunc((a.pos.y + b.pos.y) / 2), Math.trunc((a.pos.z + b.pos.z) / 2));
  c.moves = [p0.moveId, p1.moveId];
  c.winner = -1;
  state.projectiles = state.projectiles.filter((p) => p !== a && p !== b);
  for (let i = 0; i < 2; i++) {
    const f = F(state, i);
    setMode(f, 'clash');
    f.vel.x = f.vel.y = f.vel.z = 0;
    f.hitstop = 0;
    f.invuln = true;
  }
  state.camera.cinematic = { kind: 'clash', player: 0, frame: 0 };
  emit(state, { type: 'clashStart', player: 0, target: 1, pos: { ...c.point }, element: 'ki', tag: 'beam' });
}

function freshPresses(state: GameState, i: number): number {
  const s = F(state, i).sim;
  let n = 0;
  for (const b of [B_L, B_H, B_K, B_S]) if (s.press[b] === 0) n++;
  // rotating the stick counts too: every new cardinal direction press is one mash input
  if (s.dirEv & (EV_UP | EV_DOWN | EV_FWD | EV_BACK)) n++;
  return n;
}

/** Runs instead of normal fighter updates while a clash is active. */
export function updateClash(state: GameState): void {
  const c = state.clash;
  const n0 = freshPresses(state, 0), n1 = freshPresses(state, 1);
  c.mash[0] += n0; c.mash[1] += n1;
  c.balance += (n0 - n1) * CLASH_PUSH;
  if (c.balance > 1000) c.balance = 1000;
  if (c.balance < -1000) c.balance = -1000;
  c.frame++;
  if (state.camera.cinematic) state.camera.cinematic.frame = c.frame;
  // the meeting point slides toward the losing fighter
  const f0 = F(state, 0), f1 = F(state, 1);
  const mx = Math.trunc((f0.pos.x + f1.pos.x) / 2), mz = Math.trunc((f0.pos.z + f1.pos.z) / 2);
  const hx = Math.trunc((f1.pos.x - f0.pos.x) / 2), hz = Math.trunc((f1.pos.z - f0.pos.z) / 2);
  c.point.x = mx + Math.trunc((hx * c.balance * 8) / 10000);
  c.point.z = mz + Math.trunc((hz * c.balance * 8) / 10000);
  if (c.frame < c.duration && Math.abs(c.balance) < 1000) return;

  const winner: 0 | 1 | 2 = c.balance > 0 ? 0 : c.balance < 0 ? 1 : 2;
  c.winner = winner;
  c.active = false;
  state.camera.cinematic = null;
  for (let i = 0; i < 2; i++) { const f = F(state, i); f.invuln = false; setMode(f, 'idle'); }
  if (c.kind === 'realm') { c.kind = 'beam'; endRealmClash(state, winner); return; }
  if (winner === 2) {
    for (let i = 0; i < 2; i++) {
      const f = F(state, i);
      setMode(f, 'blockstun'); f.stun = 20; stunnedThisStep[i] = true;
      f.sim.pushX -= Math.trunc((f.facing.x * 500) / 1000); f.sim.pushZ -= Math.trunc((f.facing.z * 500) / 1000);
    }
    emit(state, { type: 'clashEnd', player: 0, pos: { ...c.point }, tag: 'draw' });
    return;
  }
  const w = F(state, winner), l = F(state, 1 - winner);
  const wm = moveDef(w.char, c.moves ? c.moves[winner] : '');
  let dmg = wm ? Math.trunc((wm.damage * (wm.projectile?.hits ?? 1) * 6) / 10) : 100;
  if (w.awakened) dmg = Math.trunc((dmg * 11) / 10);
  dmg = capDamage(state, winner, dmg);
  if (l.comboHits === 0) l.redHp = l.hp;
  l.hp -= dmg;
  if (state.training && l.hp < 1) l.hp = 1;
  l.comboHits++;
  l.comboDamage += dmg;
  toJuggle(state, 1 - winner, w, 55, 24);
  emit(state, { type: 'clashEnd', player: winner as 0 | 1, target: (1 - winner) as 0 | 1, pos: { ...c.point }, damage: dmg, moveId: wm?.id, element: wm?.element, tag: 'win' });
  emit(state, { type: 'hit', player: winner as 0 | 1, target: (1 - winner) as 0 | 1, pos: chest(l), damage: dmg, strength: 'super', element: wm?.element, moveId: wm?.id, charId: w.char, tag: 'beam', combo: l.comboHits });
}

export { isqrt };
