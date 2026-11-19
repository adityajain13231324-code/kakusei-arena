/** Mirror helpers for the side-symmetry tests: reflect x -> -x and swap the two players. */
import { Btn, type FighterState, type GameState } from '../../src/sim/index';

/** swap Left/Right bits (what the mirrored player presses for the same facing-relative action) */
export function mirrorInput(v: number): number {
  const l = v & Btn.Left, r = v & Btn.Right;
  return (v & ~(Btn.Left | Btn.Right)) | (l ? Btn.Right : 0) | (r ? Btn.Left : 0);
}

/** fields compared between a fighter and its mirror image. Returns '' when they match. */
export function fighterDiff(a: FighterState, b: FighterState): string {
  const out: string[] = [];
  const eq = (k: string, x: unknown, y: unknown) => { if (x !== y) out.push(`${k}: ${String(x)} vs ${String(y)}`); };
  eq('pos.x', a.pos.x, -b.pos.x); eq('pos.y', a.pos.y, b.pos.y); eq('pos.z', a.pos.z, b.pos.z);
  eq('vel.x', a.vel.x, -b.vel.x); eq('vel.y', a.vel.y, b.vel.y); eq('vel.z', a.vel.z, b.vel.z);
  eq('facing.x', a.facing.x, -b.facing.x); eq('facing.z', a.facing.z, b.facing.z);
  eq('mode', a.mode, b.mode); eq('modeFrame', a.modeFrame, b.modeFrame);
  eq('moveId', a.moveId, b.moveId); eq('moveFrame', a.moveFrame, b.moveFrame);
  eq('hp', a.hp, b.hp); eq('ki', a.ki, b.ki); eq('stun', a.stun, b.stun); eq('hitstop', a.hitstop, b.hitstop);
  eq('side', a.side, -b.side); eq('combo', a.comboHits, b.comboHits); eq('pose', a.pose, b.pose);
  eq('airborne', a.airborne, b.airborne); eq('awakened', a.awakened, b.awakened); eq('heat', a.heatStacks, b.heatStacks);
  eq('wins', a.wins, b.wins);
  return out.join(', ');
}

/** '' if state b is the mirror image (players swapped, x reflected) of state a */
export function stateMirrorDiff(a: GameState, b: GameState): string {
  const d0 = fighterDiff(a.fighters[0], b.fighters[1]);
  if (d0) return `P1|P2': ${d0}`;
  const d1 = fighterDiff(a.fighters[1], b.fighters[0]);
  if (d1) return `P2|P1': ${d1}`;
  if (a.projectiles.length !== b.projectiles.length) return `projectiles ${a.projectiles.length} vs ${b.projectiles.length}`;
  // crossover: forms, shadow clones, realms
  if ((a.fighters[0].form ?? '') !== (b.fighters[1].form ?? '') || (a.fighters[1].form ?? '') !== (b.fighters[0].form ?? '')) return 'form';
  const sa = a.summons ?? [], sb = b.summons ?? [];
  if (sa.length !== sb.length) return `summons ${sa.length} vs ${sb.length}`;
  for (let k = 0; k < sa.length; k++) {
    const x = sa[k], y = sb[k];
    if (x.owner !== 1 - y.owner || x.pos.x !== -y.pos.x || x.pos.z !== y.pos.z || x.mode !== y.mode) return `summon ${k}: ${x.pos.x},${x.pos.z} ${x.mode} vs ${y.pos.x},${y.pos.z} ${y.mode}`;
  }
  const ra = a.realm, rb = b.realm;
  if (!!ra !== !!rb || (ra && rb && (ra.owner !== 1 - rb.owner || ra.frame !== rb.frame || ra.phase !== rb.phase))) return 'realm';
  const wa = a.round.winner, wb = b.round.winner;
  const sw = (w: number) => (w === 0 ? 1 : w === 1 ? 0 : w);
  if (wa !== sw(wb)) return `round winner ${wa} vs ${wb}`;
  if (a.round.phase !== b.round.phase) return `phase ${a.round.phase} vs ${b.round.phase}`;
  if (a.camera.normal.x !== -b.camera.normal.x || a.camera.normal.z !== b.camera.normal.z) return `camera normal`;
  return '';
}
