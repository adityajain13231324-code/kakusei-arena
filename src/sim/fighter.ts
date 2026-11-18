/** Fighter helpers shared by every sim module. */
import type { FighterMode, FighterSimData, FighterState, GameState, MoveDef, SimEvent, Vec3 } from './types';
import { moveDef } from '../data';
import { norm2 } from '../core/fixed';

export type SF = FighterState & { sim: FighterSimData };

export function F(state: GameState, i: number): SF {
  return state.fighters[i] as SF;
}

export function moveOf(f: FighterState): MoveDef | undefined {
  return f.moveId ? moveDef(f.char, f.moveId) : undefined;
}

export function totalFrames(m: MoveDef): number {
  return m.startup + m.active + m.recovery;
}

/** enter a new mode; clears the active move unless entering 'attack' */
export function setMode(f: SF, mode: FighterMode): void {
  f.mode = mode;
  f.modeFrame = 0;
  if (mode !== 'attack') {
    f.moveId = null;
    f.moveFrame = 0;
    f.sim.partner = -1;
  }
  f.stance = false;
}

/** change mode only if different (keeps modeFrame running for walk cycles etc) */
export function ensureMode(f: SF, mode: FighterMode): void {
  if (f.mode !== mode) setMode(f, mode);
}

export function faceToward(f: FighterState, target: Vec3): void {
  const n = norm2(target.x - f.pos.x, target.z - f.pos.z, f.facing.x, f.facing.z);
  f.facing.x = n.x;
  f.facing.z = n.z;
}

export function emit(state: GameState, ev: Omit<SimEvent, 'frame'>): void {
  (ev as SimEvent).frame = state.frame;
  state.events.push(ev as SimEvent);
}

export function vec(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function chest(f: FighterState): Vec3 {
  return { x: f.pos.x, y: f.pos.y + 1100, z: f.pos.z };
}

/** modes where the fighter is in control and may start actions */
export function isFreeMode(f: SF): boolean {
  const m = f.mode;
  return (m === 'idle' || m === 'walk' || m === 'crouch' || m === 'guard' || m === 'sidewalk' || m === 'kicharge') && f.sim.landLag === 0;
}

/** fighter is "in a combo" (taking hits) */
export function inCombo(f: SF): boolean {
  const m = f.mode;
  return m === 'hitstun' || m === 'juggle' || m === 'wallsplat' || m === 'thrown' || m === 'knockdown';
}

export function isCrouching(f: SF): boolean {
  if (f.airborne) return false;
  switch (f.mode) {
    case 'crouch': return true;
    case 'guard':
    case 'blockstun': return (f.sim.rel & 2) !== 0; // Btn.Down
    case 'attack': {
      const m = moveOf(f);
      if (!m) return false;
      return m.crouching ?? m.input.charAt(0) === '2';
    }
    default: return false;
  }
}

export function comboScale(hitsBefore: number): number {
  const s = 1000 - 100 * hitsBefore;
  return s < 300 ? 300 : s;
}
