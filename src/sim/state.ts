/** Match creation: every field is initialised here so object shapes (and hashes) are stable. */
import type { CharId, FighterSimData, FighterState, GameState, MatchConfig } from './types';
import { CHARS } from '../data';
import { ARENA_HALF, ARENA_HALF_TRAINING, ROUND_FRAMES, GUARD_MAX } from './constants';
import { resetRound } from './rounds';
import { updateCamera } from './camera';

function createSim(): FighterSimData {
  return {
    prevRaw: 0, rel: 0, dirEv: 0,
    press: [99, 99, 99, 99, 99, 99], held: [0, 0, 0, 0, 0, 0],
    upHeld: 0, downHeld: 0, fwdHeld: 0, backHeld: 0,
    fwdTap: 0, backTap: 0, upTap: 0, downClean: false,
    hitMask: 0, contact: 0, activeDone: false, queued: null, easyMove: false,
    pushX: 0, pushZ: 0, knockX: 0, knockZ: 0,
    bounce: false, bounceUsed: false, splatUsed: false,
    ssX: 0, ssZ: 0, ssLateral: 0, jumpX: 0, jumpZ: 0,
    turnLock: 0, landLag: 0, partner: -1, breakable: true, throwMove: '',
    regen: 0, armorUsed: false, heatUsed: 0, kiFullSent: false,
    hitPose: 'hitMid', crumple: false, airAttackUsed: false, enderUsed: false, guard: GUARD_MAX, guardIdle: 0, otgUsed: false,
  };
}

function createFighter(char: CharId, i: number): FighterState {
  const c = CHARS[char];
  return {
    char,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    facing: { x: i === 0 ? 1000 : -1000, z: 0 },
    mode: 'intro', modeFrame: 0, moveId: null, moveFrame: 0, pose: 'introPose',
    hp: c.maxHp, maxHp: c.maxHp, redHp: c.maxHp, ki: 0,
    awakened: false, awakenUsed: false, awakenTimer: 0,
    stun: 0, hitstop: 0, invuln: false, armor: false, airborne: false,
    comboHits: 0, comboDamage: 0, juggleScale: 1000, counterHitFlash: 0,
    stance: false, heatStacks: 0, wins: 0,
    side: i === 0 ? -1 : 1,
    lastInputs: [],
    sim: createSim(),
  };
}

export function createMatch(cfg: MatchConfig): GameState {
  const training = !!cfg.training;
  const st: GameState = {
    frame: 0,
    seed: (cfg.seed | 0) || 1,
    stage: cfg.stage,
    arenaHalfSize: cfg.stage === 'training' ? ARENA_HALF_TRAINING : ARENA_HALF,
    fighters: [createFighter(cfg.p1, 0), createFighter(cfg.p2, 1)],
    projectiles: [],
    nextProjectileId: 1,
    clash: { active: false, frame: 0, duration: 0, balance: 0, mash: [0, 0], point: { x: 0, y: 0, z: 0 }, moves: ['', ''], winner: -1 },
    round: { number: 1, phase: 'intro', phaseFrame: 0, timer: ROUND_FRAMES, winner: -1 },
    roundsToWin: cfg.roundsToWin ?? 2,
    camera: { center: { x: 0, y: 0, z: 0 }, normal: { x: 0, z: 1000 }, distance: 0, cinematic: null },
    slowmo: 0,
    events: [],
    training,
    schemes: cfg.schemes ? [cfg.schemes[0], cfg.schemes[1]] : ['pro', 'pro'],
    ult: null,
    trainingOpts: {
      infiniteKi: cfg.trainingOpts?.infiniteKi ?? false,
      hpRegen: cfg.trainingOpts?.hpRegen ?? true,
      dummyGuard: cfg.trainingOpts?.dummyGuard ?? 'none',
      dummyCrouch: cfg.trainingOpts?.dummyCrouch ?? false,
    },
    frameAdv: null,
    advTrack: null,
  };
  resetRound(st);
  updateCamera(st);
  return st;
}
