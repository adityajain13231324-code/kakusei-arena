/**
 * Facing, screen sides and the deterministic camera hint.
 * The camera normal is perpendicular to the fighter axis; of the two candidates we
 * always pick the one closest to last frame's normal, so the camera never jumps to
 * the other side. Screen-right = (n.z, -n.x) for a camera at center + n looking at center.
 */
import type { GameState } from './types';
import { F, faceToward, moveOf, type SF } from './fighter';
import { isqrt, norm2 } from '../core/fixed';

/** should this fighter's facing track the opponent this frame? */
function tracksOpponent(f: SF): boolean {
  if (f.sim.turnLock > 0) return false;
  switch (f.mode) {
    case 'attack': {
      // facing locks at move start; tracking moves keep re-aiming during startup
      const m = moveOf(f);
      return !!m && (m.tracking ?? 'none') !== 'none' && f.moveFrame < m.startup;
    }
    case 'thrown': case 'knockdown': case 'wakeup': case 'juggle': case 'wallsplat': case 'clash': case 'vanish':
      return false;
    default:
      return true;
  }
}

export function updateFacing(state: GameState): void {
  const a = F(state, 0), b = F(state, 1);
  if (tracksOpponent(a)) faceToward(a, b.pos);
  if (tracksOpponent(b)) faceToward(b, a.pos);
}

export function updateCamera(state: GameState): void {
  const a = F(state, 0), b = F(state, 1);
  const cam = state.camera;
  // Math.trunc (not >> 1, which floors) keeps the midpoint mirror-symmetric
  cam.center.x = Math.trunc((a.pos.x + b.pos.x) / 2);
  cam.center.y = Math.trunc((a.pos.y + b.pos.y) / 2);
  cam.center.z = Math.trunc((a.pos.z + b.pos.z) / 2);
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  cam.distance = isqrt(dx * dx + dz * dz);
  if (cam.distance > 50) {
    const ax = norm2(dx, dz);
    let nx = -ax.z, nz = ax.x;
    if (nx * cam.normal.x + nz * cam.normal.z < 0) { nx = -nx; nz = -nz; }
    cam.normal.x = nx; cam.normal.z = nz;
  }
  // screen sides
  const rx = cam.normal.z, rz = -cam.normal.x;
  // side from the fighter axis itself (no rounded midpoint) so both players are treated alike
  const sa = (a.pos.x - b.pos.x) * rx + (a.pos.z - b.pos.z) * rz;
  if (sa < 0) { a.side = -1; b.side = 1; }
  else if (sa > 0) { a.side = 1; b.side = -1; }
}
