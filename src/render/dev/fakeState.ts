/** Fake GameState generator for render development (independent of the sim). */
import type { CharId, GameState, MoveDef, PoseName, StageId, FighterState } from '../../sim/types';
import { blankState, computeCameraHint } from '../util';

function mv(id: string, anim: Array<[number, PoseName]>, total: number): MoveDef {
  return {
    id, name: id, kind: 'normal', input: 'L', startup: 4, active: 2, recovery: total - 6, damage: 10, height: 'mid', strength: 'medium',
    hitstun: 12, blockstun: 8, hitboxes: [], anim,
  };
}

/** Demo moves with keyframes (used when the sim's getMove has nothing). */
export const DEMO_MOVES: Record<string, MoveDef> = {
  jab: mv('jab', [[0, 'jabWind'], [3, 'jabExt'], [9, 'jabExt'], [14, 'idle']], 16),
  straight: mv('straight', [[0, 'straightWind'], [6, 'straightExt'], [14, 'straightExt'], [20, 'idle']], 22),
  hook: mv('hook', [[0, 'hookWind'], [7, 'hookExt'], [14, 'hookExt'], [22, 'idle']], 24),
  uppercut: mv('uppercut', [[0, 'uppercutWind'], [8, 'uppercutExt'], [18, 'uppercutExt'], [26, 'idle']], 28),
  highKick: mv('highKick', [[0, 'highKickWind'], [8, 'highKickExt'], [18, 'highKickExt'], [26, 'idle']], 28),
  midKick: mv('midKick', [[0, 'midKickWind'], [6, 'midKickExt'], [14, 'midKickExt'], [22, 'idle']], 24),
  sweep: mv('sweep', [[0, 'crouch'], [6, 'sweepExt'], [16, 'sweepExt'], [24, 'crouch']], 26),
  roundhouse: mv('roundhouse', [[0, 'highKickWind'], [8, 'roundhouseExt'], [16, 'roundhouseExt'], [24, 'idle']], 26),
  slash: mv('slash', [[0, 'slashWind'], [8, 'slashExt'], [16, 'slashExt'], [26, 'idle']], 28),
  slashUp: mv('slashUp', [[0, 'slashLowExt'], [8, 'slashUpExt'], [16, 'slashUpExt'], [26, 'idle']], 28),
  quickDraw: mv('quickDraw', [[0, 'sheathStance'], [14, 'quickDraw'], [26, 'quickDraw'], [34, 'idle']], 36),
  kunai: mv('kunai_throw', [[0, 'palmWind'], [6, 'throwProjectile'], [16, 'throwProjectile'], [22, 'idle']], 24),
  palm: mv('palm', [[0, 'palmWind'], [7, 'palmExt'], [16, 'palmExt'], [24, 'idle']], 26),
  beam: mv('beam', [[0, 'beamCharge'], [20, 'beamFire'], [44, 'beamFire'], [52, 'idle']], 54),
  grab: mv('grab', [[0, 'grabReach'], [8, 'throwGrab'], [18, 'liftOverhead'], [30, 'groundPound'], [42, 'idle']], 44),
  stomp: mv('stomp', [[0, 'midKickWind'], [10, 'stompExt'], [20, 'stompExt'], [28, 'idle']], 30),
  spin: mv('spin', [[0, 'spinAttack'], [14, 'spinAttack'], [18, 'idle']], 20),
  axe: mv('axe', [[0, 'axeKickUp'], [10, 'axeKickDown'], [20, 'axeKickDown'], [28, 'idle']], 30),
};

const MOVESETS: Record<CharId, string[]> = {
  kaito: ['jab', 'straight', 'hook', 'uppercut', 'highKick', 'axe', 'beam'],
  shiori: ['jab', 'midKick', 'kunai', 'roundhouse', 'sweep', 'spin'],
  ren: ['slash', 'quickDraw', 'slashUp', 'midKick', 'slash'],
  goro: ['palm', 'grab', 'stomp', 'straight', 'hook'],
};

export function demoLookup(_c: CharId, id: string): MoveDef | undefined { return DEMO_MOVES[id]; }

/** Scripted "demo fight": approach, attack, react, sidestep, occasional awaken. */
export class DemoFight {
  state: GameState;
  private plan = [0, 0];
  private timer = [40, 80];
  private idx = [0, 3];
  constructor(p1: CharId, p2: CharId, stage: StageId) {
    this.state = blankState(p1, p2, stage);
  }
  step(): void {
    const s = this.state;
    s.frame++;
    s.events = [];
    for (let i = 0; i < 2; i++) {
      const f = s.fighters[i], o = s.fighters[1 - i];
      const dx = o.pos.x - f.pos.x, dz = o.pos.z - f.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      f.facing.x = Math.round((dx / d) * 1000); f.facing.z = Math.round((dz / d) * 1000);
      f.modeFrame++;
      f.vel.x = 0; f.vel.z = 0; f.vel.y = 0;
      if (f.mode === 'attack') {
        f.moveFrame++;
        const m = DEMO_MOVES[f.moveId ?? ''];
        if (m && f.moveFrame === m.startup + 2 && d < 1500) {
          s.events.push({ type: 'hit', frame: s.frame, player: i as 0 | 1, target: (1 - i) as 0 | 1, pos: { x: o.pos.x, y: 1200, z: o.pos.z }, strength: 'medium' });
          setMode(o, 'hitstun', ['hitHigh', 'hitMid', 'hitLow'][s.frame % 3] as PoseName);
        }
        if (!m || f.moveFrame >= m.startup + m.active + m.recovery) { f.moveId = null; setMode(f, 'idle', 'idle'); }
        continue;
      }
      if (f.mode === 'hitstun') { if (f.modeFrame > 22) setMode(f, 'idle', 'idle'); continue; }
      if (f.mode === 'sidestep') {
        f.vel.x = Math.round(-dz / d * 45); f.vel.z = Math.round(dx / d * 45);
        f.pos.x += f.vel.x; f.pos.z += f.vel.z;
        if (f.modeFrame > 16) setMode(f, 'idle', 'idle');
        continue;
      }
      this.timer[i]--;
      if (d > 1500) {
        if (f.mode !== 'walk') setMode(f, 'walk', 'walk1');
        f.vel.x = Math.round(dx / d * 30); f.vel.z = Math.round(dz / d * 30);
        f.pos.x += f.vel.x; f.pos.z += f.vel.z;
      } else if (this.timer[i] <= 0) {
        this.timer[i] = 30 + ((s.frame * 7 + i * 13) % 50);
        if ((s.frame + i) % 5 === 0) { setMode(f, 'sidestep', 'sideStep'); continue; }
        const set = MOVESETS[f.char];
        const id = set[this.idx[i]++ % set.length];
        f.moveId = id; f.moveFrame = 0; setMode(f, 'attack', 'idle');
      } else if (f.mode !== 'idle') setMode(f, 'idle', 'idle');
      if (s.frame % 900 === 300 + i * 200) { f.awakened = !f.awakened; }
    }
    computeCameraHint(s);
    void this.plan;
  }
}

function setMode(f: FighterState, mode: FighterState['mode'], pose: PoseName): void {
  f.mode = mode; f.modeFrame = 0; f.pose = pose;
}
