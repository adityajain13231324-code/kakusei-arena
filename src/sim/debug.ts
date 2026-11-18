/** World-space capsules for the training-mode hitbox viewer. */
import type { Capsule, GameState } from './types';
import { F, moveOf } from './fighter';
import { hurtCaps, hitCap, type Cap } from './collision';
import { vec } from './fighter';

const tmp: Cap[] = [];

export function debugBoxes(state: GameState): Capsule[] {
  const out: Capsule[] = [];
  for (let i = 0; i < 2; i++) {
    const f = F(state, i);
    const n = hurtCaps(f, tmp);
    for (let k = 0; k < n; k++) {
      const c = tmp[k];
      out.push({ a: vec(c.ax, c.ay, c.az), b: vec(c.bx, c.by, c.bz), r: c.r, owner: i as 0 | 1, kind: 'hurt' });
    }
    if (f.mode === 'attack') {
      const m = moveOf(f);
      if (m) {
        const fr = f.moveFrame + 1;
        for (const hb of m.hitboxes) {
          if (fr < hb.from || fr > hb.to) continue;
          const c = hitCap(f, hb);
          out.push({ a: vec(c.ax, c.ay, c.az), b: vec(c.bx, c.by, c.bz), r: c.r, owner: i as 0 | 1, kind: m.height === 'throw' ? 'throw' : 'hit' });
        }
      }
    }
  }
  for (const p of state.projectiles) {
    out.push({ a: vec(p.pos.x - p.vel.x, p.pos.y, p.pos.z - p.vel.z), b: { ...p.pos }, r: p.r, owner: p.owner, kind: 'projectile' });
  }
  return out;
}
