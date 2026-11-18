/**
 * Collision: hurtbox / hitbox capsules in world space and integer capsule tests.
 * All coordinates are integer mm. Segment math uses a 1024 fixed-point parameter.
 */
import type { FighterState, GameState, HitboxDef } from './types';
import type { SF } from './fighter';
import { isCrouching } from './fighter';
import { isqrt, clamp } from '../core/fixed';
import { HURT_HEIGHT } from './constants';
import { CHARS } from '../data';

export interface Cap { ax: number; ay: number; az: number; bx: number; by: number; bz: number; r: number }

export function cap(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): Cap {
  return { ax, ay, az, bx, by, bz, r };
}

/** contact point of the last successful capsuleHit (module scratch, not state) */
export const contact = { x: 0, y: 0, z: 0 };

const T1 = 1024;

/**
 * Closest points between segments p1q1 and p2q2 (Ericson, RTCD 5.1.9) in fixed point.
 * Writes the midpoint of the closest points into `contact` and returns squared distance.
 * Coordinates are made relative to p1 to keep magnitudes small.
 */
function segSegDist2(c1: Cap, c2: Cap): number {
  const ox = c1.ax, oy = c1.ay, oz = c1.az;
  const d1x = c1.bx - c1.ax, d1y = c1.by - c1.ay, d1z = c1.bz - c1.az;
  const d2x = c2.bx - c2.ax, d2y = c2.by - c2.ay, d2z = c2.bz - c2.az;
  const rx = ox - c2.ax, ry = oy - c2.ay, rz = oz - c2.az;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0, t = 0; // fixed point 0..T1
  if (a === 0 && e === 0) { s = 0; t = 0; }
  else if (a === 0) { s = 0; t = clamp(Math.trunc((f * T1) / e), 0, T1); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e === 0) { t = 0; s = clamp(Math.trunc((-c * T1) / a), 0, T1); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp(Math.trunc(((b * f - c * e) / denom) * T1), 0, T1) : 0;
      t = Math.trunc((b * s + f * T1) / e);
      if (t < 0) { t = 0; s = clamp(Math.trunc((-c * T1) / a), 0, T1); }
      else if (t > T1) { t = T1; s = clamp(Math.trunc(((b - c) * T1) / a), 0, T1); }
    }
  }
  const p1x = ox + Math.trunc((d1x * s) / T1), p1y = oy + Math.trunc((d1y * s) / T1), p1z = oz + Math.trunc((d1z * s) / T1);
  const p2x = c2.ax + Math.trunc((d2x * t) / T1), p2y = c2.ay + Math.trunc((d2y * t) / T1), p2z = c2.az + Math.trunc((d2z * t) / T1);
  const dx = p1x - p2x, dy = p1y - p2y, dz = p1z - p2z;
  // contact point: on the surface of c2 toward c1 (≈ where the hit visually lands)
  const d = isqrt(dx * dx + dy * dy + dz * dz);
  if (d > 0) {
    contact.x = p2x + Math.trunc((dx * c2.r) / d);
    contact.y = p2y + Math.trunc((dy * c2.r) / d);
    contact.z = p2z + Math.trunc((dz * c2.r) / d);
  } else { contact.x = p2x; contact.y = p2y; contact.z = p2z; }
  return dx * dx + dy * dy + dz * dz;
}

export function capsuleHit(c1: Cap, c2: Cap): boolean {
  const rr = c1.r + c2.r;
  // cheap reject on bounding boxes
  if (Math.min(c1.ax, c1.bx) - c1.r > Math.max(c2.ax, c2.bx) + c2.r) return false;
  if (Math.max(c1.ax, c1.bx) + c1.r < Math.min(c2.ax, c2.bx) - c2.r) return false;
  if (Math.min(c1.az, c1.bz) - c1.r > Math.max(c2.az, c2.bz) + c2.r) return false;
  if (Math.max(c1.az, c1.bz) + c1.r < Math.min(c2.az, c2.bz) - c2.r) return false;
  if (Math.min(c1.ay, c1.by) - c1.r > Math.max(c2.ay, c2.by) + c2.r) return false;
  if (Math.max(c1.ay, c1.by) + c1.r < Math.min(c2.ay, c2.by) - c2.r) return false;
  return segSegDist2(c1, c2) <= rr * rr;
}

/**
 * Hurtboxes (3 capsules: legs / torso / head). Standard gameplay height for every
 * fighter (so height rules are consistent); radius scales with the character.
 * Crouching lowers everything so highs (y≈1450) whiff, mids (y≈1100-1250) still hit.
 */
export function hurtCaps(f: SF, out: Cap[]): number {
  const R = CHARS[f.char].radius;
  const H = HURT_HEIGHT;
  const x = f.pos.x, y = f.pos.y, z = f.pos.z;
  let n = 0;
  const put = (c: Cap) => { out[n++] = c; };
  if (f.mode === 'knockdown' || (f.mode === 'wakeup' && f.modeFrame < 8)) {
    // lying on the floor along the facing axis
    const fx = f.facing.x, fz = f.facing.z;
    put(cap(x - Math.trunc((fx * 900) / 1000), y + 150, z - Math.trunc((fz * 900) / 1000), x + Math.trunc((fx * 300) / 1000), y + 150, z + Math.trunc((fz * 300) / 1000), 200));
    return n;
  }
  if (f.mode === 'juggle' || (f.airborne && (f.mode === 'hitstun' || f.mode === 'thrown'))) {
    put(cap(x, y + 250, z, x, y + 1350, z, R));
    put(cap(x, y + 1500, z, x, y + 1500, z, Math.trunc((R * 47) / 100)));
    return n;
  }
  if (isCrouching(f)) {
    put(cap(x, y + 100, z, x, y + Math.trunc((H * 24) / 100), z, Math.trunc((R * 67) / 100)));
    put(cap(x, y + Math.trunc((H * 32) / 100), z, x, y + Math.trunc((H * 47) / 100), z, Math.trunc((R * 77) / 100)));
    const hy = y + Math.trunc((H * 58) / 100);
    put(cap(x, hy, z, x, hy, z, Math.trunc((R * 47) / 100)));
    return n;
  }
  put(cap(x, y + 100, z, x, y + Math.trunc((H * 45) / 100), z, Math.trunc((R * 57) / 100)));
  put(cap(x, y + Math.trunc((H * 53) / 100), z, x, y + Math.trunc((H * 77) / 100), z, Math.trunc((R * 70) / 100)));
  const hy = y + Math.trunc((H * 92) / 100);
  put(cap(x, hy, z, x, hy, z, Math.trunc((R * 47) / 100)));
  return n;
}

/** attacker-local hitbox -> world capsule */
export function hitCap(f: FighterState, hb: HitboxDef): Cap {
  const fx = f.facing.x, fz = f.facing.z;
  const rx = -fz, rz = fx; // local +z (right)
  const lz = hb.z ?? 0;
  const ax = f.pos.x + Math.trunc((fx * hb.x + rx * lz) / 1000);
  const az = f.pos.z + Math.trunc((fz * hb.x + rz * lz) / 1000);
  const ay = f.pos.y + hb.y;
  const bx = ax + Math.trunc((fx * hb.len) / 1000);
  const bz = az + Math.trunc((fz * hb.len) / 1000);
  return cap(ax, ay, az, bx, ay, bz, hb.r);
}

const scratch: Cap[] = [];

/** test a world capsule against a fighter's hurtboxes; contact point in `contact` */
export function hitsFighter(c: Cap, def: SF): boolean {
  const n = hurtCaps(def, scratch);
  for (let i = 0; i < n; i++) if (capsuleHit(c, scratch[i])) return true;
  return false;
}

/** keep fighters from overlapping (pushes both, or only the free one against a wall) */
export function separate(state: GameState, a: SF, b: SF): void {
  if (a.mode === 'knockdown' || b.mode === 'knockdown' || a.mode === 'vanish' || b.mode === 'vanish') return;
  if (a.mode === 'thrown' || b.mode === 'thrown') return;
  // vertical overlap: allow passing under a high jumper / juggle
  if (Math.abs(a.pos.y - b.pos.y) > 1100) return;
  const ra = CHARS[a.char].radius, rb = CHARS[b.char].radius;
  const min = ra + rb;
  let dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return;
  let d = isqrt(d2);
  if (d === 0) { dx = a.facing.x; dz = a.facing.z; d = 1000; }
  const overlap = min - (d === 1000 && d2 === 0 ? 0 : d);
  const px = Math.trunc((dx * overlap) / d), pz = Math.trunc((dz * overlap) / d);
  const lim = state.arenaHalfSize;
  const aWall = Math.abs(a.pos.x) >= lim - ra - 1 || Math.abs(a.pos.z) >= lim - ra - 1;
  const bWall = Math.abs(b.pos.x) >= lim - rb - 1 || Math.abs(b.pos.z) >= lim - rb - 1;
  if (aWall && !bWall) { b.pos.x += px; b.pos.z += pz; }
  else if (bWall && !aWall) { a.pos.x -= px; a.pos.z -= pz; }
  else {
    const hx = Math.trunc(px / 2), hz = Math.trunc(pz / 2);
    a.pos.x -= hx; a.pos.z -= hz;
    b.pos.x += px - hx; b.pos.z += pz - hz;
  }
}
