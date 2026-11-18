/** Pose output for the renderer (non-move modes). For moves, pose = current MoveDef.anim key. */
import type { GameState, PoseName } from './types';
import { F, moveOf, isCrouching } from './fighter';
import { PREJUMP } from './constants';

export function animPose(anim: Array<[number, PoseName]>, frame: number): PoseName {
  let p: PoseName = anim.length ? anim[0][1] : 'idle';
  for (const k of anim) { if (k[0] <= frame) p = k[1]; else break; }
  return p;
}

export function updatePoses(state: GameState): void {
  for (let i = 0; i < 2; i++) {
    const f = F(state, i);
    const s = f.sim;
    let p: PoseName;
    switch (f.mode) {
      case 'attack': { const m = moveOf(f); p = m ? animPose(m.anim, f.moveFrame) : 'idle'; break; }
      case 'idle': p = s.landLag > 0 ? 'land' : ((state.frame / 40) | 0) % 2 ? 'idle2' : 'idle'; break;
      case 'walk': case 'sidewalk': p = ((f.modeFrame / 8) | 0) % 2 ? 'walk2' : 'walk1'; break;
      case 'crouch': p = 'crouch'; break;
      case 'guard': case 'blockstun': p = isCrouching(f) ? 'guardLow' : 'guardHigh'; break;
      case 'hitstun': p = s.hitPose; break;
      case 'juggle': p = f.modeFrame < 6 && f.comboHits > 1 ? 'airHit' : f.vel.y > 0 ? 'launched' : 'fallFlat'; break;
      case 'knockdown': p = f.modeFrame < 6 ? 'fallFlat' : 'lieDown'; break;
      case 'wakeup': p = 'getUp'; break;
      case 'wallsplat': p = 'wallSplat'; break;
      case 'thrown': p = 'thrown'; break;
      case 'kicharge': p = 'kiCharge'; break;
      case 'vanish': p = 'vanish'; break;
      case 'awaken': p = 'awakenPose'; break;
      case 'intro': p = 'introPose'; break;
      case 'win': p = 'win'; break;
      case 'lose': p = 'lose'; break;
      case 'clash': p = 'beamFire'; break;
      case 'jump': p = !f.airborne && f.modeFrame < PREJUMP ? 'crouch' : f.vel.y > 0 ? 'jumpUp' : 'jumpFall'; break;
      case 'dash': p = 'dash'; break;
      case 'backdash': p = 'backdash'; break;
      case 'sidestep': p = 'sideStep'; break;
      default: p = 'idle';
    }
    f.pose = p;
  }
}
