/** Helpers to build plain FighterState / GameState objects (menu scene, snapshots, dev harness). */
import type { CharId, FighterState, GameState, StageId, PoseName } from '../sim/types';

export function blankFighter(char: CharId, x = 0, z = 0, facingX = 1000, facingZ = 0, pose: PoseName = 'idle'): FighterState {
  return {
    char, pos: { x, y: 0, z }, vel: { x: 0, y: 0, z: 0 }, facing: { x: facingX, z: facingZ },
    mode: 'idle', modeFrame: 0, moveId: null, moveFrame: 0, pose,
    hp: 1000, maxHp: 1000, redHp: 1000, ki: 0, awakened: false, awakenUsed: false, awakenTimer: 0,
    stun: 0, hitstop: 0, invuln: false, armor: false, airborne: false, comboHits: 0, comboDamage: 0, juggleScale: 1000,
    counterHitFlash: 0, stance: false, heatStacks: 0, wins: 0, side: x < 0 ? -1 : 1, lastInputs: [],
  };
}

export function blankState(p1: CharId, p2: CharId, stage: StageId, half = 5000): GameState {
  const a = blankFighter(p1, -1300, 0, 1000, 0);
  const b = blankFighter(p2, 1300, 0, -1000, 0);
  return {
    frame: 0, seed: 1, stage, arenaHalfSize: half,
    fighters: [a, b], projectiles: [], nextProjectileId: 1,
    clash: { active: false, frame: 0, duration: 0, balance: 0, mash: [0, 0], point: { x: 0, y: 0, z: 0 } },
    round: { number: 1, phase: 'fight', phaseFrame: 0, timer: 60, winner: -1 }, roundsToWin: 2,
    camera: { center: { x: 0, y: 0, z: 0 }, normal: { x: 0, z: 1000 }, distance: 2600, cinematic: null },
    slowmo: 0, events: [], training: false, schemes: ['pro', 'pro'],
  };
}

/** Fill state.camera from fighter positions (what the sim would provide). */
export function computeCameraHint(s: GameState): void {
  const [a, b] = s.fighters;
  s.camera.center.x = (a.pos.x + b.pos.x) / 2;
  s.camera.center.z = (a.pos.z + b.pos.z) / 2;
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  s.camera.distance = d;
  // perpendicular, choose the one toward +Z-ish (keeps p1 on the left)
  s.camera.normal.x = Math.round((-dz / d) * 1000);
  s.camera.normal.z = Math.round((dx / d) * 1000);
}
