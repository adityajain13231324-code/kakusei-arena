/**
 * Round flow: intro (inputs ignored) -> fight (60 s timer) -> ko | timeout -> roundEnd
 * -> next round or matchEnd. Training: straight to 'fight', no timer, no KO.
 */
import type { GameState } from './types';
import { F, emit, setMode, chest, vec } from './fighter';
import { INTRO_FRAMES, KO_FRAMES, ROUND_END_FRAMES, ROUND_FRAMES, SLOWMO_KO, START_DIST } from './constants';

/** place fighters and reset per-round state (ki carries over, awakening is once per match) */
export function resetRound(state: GameState): void {
  const half = START_DIST >> 1;
  for (let i = 0; i < 2; i++) {
    const f = F(state, i), s = f.sim;
    f.pos = vec(i === 0 ? -half : half, 0, 0);
    f.vel = vec(0, 0, 0);
    f.facing = { x: i === 0 ? 1000 : -1000, z: 0 };
    f.hp = f.maxHp;
    f.redHp = f.maxHp;
    f.awakened = false;
    f.awakenTimer = 0;
    f.stun = 0; f.hitstop = 0; f.invuln = false; f.armor = false; f.airborne = false;
    f.comboHits = 0; f.comboDamage = 0; f.juggleScale = 1000; f.counterHitFlash = 0;
    f.stance = false; f.heatStacks = 0;
    f.side = i === 0 ? -1 : 1;
    setMode(f, state.training ? 'idle' : 'intro');
    s.pushX = s.pushZ = s.knockX = s.knockZ = 0;
    s.bounce = s.bounceUsed = s.splatUsed = false;
    s.turnLock = 0; s.landLag = 0; s.partner = -1; s.regen = 0; s.crumple = false; s.queued = null;
  }
  state.projectiles = [];
  state.clash.active = false; state.clash.frame = 0; state.clash.balance = 0; state.clash.mash = [0, 0]; state.clash.winner = -1;
  state.ult = null;
  state.camera.normal = { x: 0, z: 1000 };
  state.camera.cinematic = state.training ? null : { kind: 'intro', player: 0, frame: 0 };
  state.round.phase = state.training ? 'fight' : 'intro';
  state.round.phaseFrame = 0;
  state.round.timer = ROUND_FRAMES;
  state.round.winner = -1;
  state.frameAdv = null;
  state.advTrack = null;
}

export function inputsLive(state: GameState): boolean {
  return state.round.phase === 'fight';
}

/** start-of-step phase handling */
export function roundsPre(state: GameState): void {
  const r = state.round;
  if (r.phase === 'intro') {
    if (r.phaseFrame === 0) emit(state, { type: 'roundStart', player: 0, pos: vec(0, 0, 0), tag: String(r.number) });
    if (state.camera.cinematic?.kind === 'intro') state.camera.cinematic.frame = r.phaseFrame;
    if (r.phaseFrame >= INTRO_FRAMES) {
      r.phase = 'fight';
      r.phaseFrame = 0;
      state.camera.cinematic = null;
      for (let i = 0; i < 2; i++) setMode(F(state, i), 'idle');
      emit(state, { type: 'fight', player: 0, pos: vec(0, 0, 0), tag: String(r.number) });
    }
  } else if (r.phase === 'fight' && r.phaseFrame === 0 && state.training && state.frame === 1) {
    emit(state, { type: 'fight', player: 0, pos: vec(0, 0, 0), tag: 'training' });
  }
}

/** end-of-step: timer, KO, timeout, transitions */
export function roundsPost(state: GameState): void {
  const r = state.round;
  const a = F(state, 0), b = F(state, 1);
  if (r.phase === 'fight') {
    if (!state.training) {
      const frozen = !!state.ult || state.clash.active || a.mode === 'awaken' || b.mode === 'awaken';
      if (!frozen && r.timer > 0) r.timer--;
      if (!state.ult) {
        const ka = a.hp <= 0, kb = b.hp <= 0;
        if (ka || kb) {
          a.hp = Math.max(0, a.hp); b.hp = Math.max(0, b.hp);
          r.phase = 'ko';
          r.phaseFrame = 0;
          r.winner = ka && kb ? 2 : ka ? 1 : 0;
          state.slowmo = SLOWMO_KO;
          const loser = ka ? a : b;
          state.camera.cinematic = { kind: 'ko', player: (r.winner === 2 ? 0 : r.winner) as 0 | 1, frame: 0 };
          emit(state, { type: 'ko', player: (r.winner === 2 ? 0 : r.winner) as 0 | 1, target: (ka ? 0 : 1) as 0 | 1, pos: chest(loser), tag: r.winner === 2 ? 'double' : undefined });
          return;
        }
        if (r.timer <= 0) {
          r.phase = 'timeout';
          r.phaseFrame = 0;
          // higher HP percentage wins (cross-multiplied to stay in integers)
          const pa = a.hp * b.maxHp, pb = b.hp * a.maxHp;
          r.winner = pa > pb ? 0 : pb > pa ? 1 : 2;
          emit(state, { type: 'timeout', player: (r.winner === 2 ? 0 : r.winner) as 0 | 1, pos: vec(0, 0, 0), tag: r.winner === 2 ? 'draw' : undefined });
          return;
        }
      }
    }
  } else if (r.phase === 'ko' || r.phase === 'timeout') {
    if (state.camera.cinematic?.kind === 'ko') {
      state.camera.cinematic.frame = r.phaseFrame;
      if (r.phaseFrame >= SLOWMO_KO) state.camera.cinematic = null;
    }
    if (r.phaseFrame >= KO_FRAMES) {
      r.phase = 'roundEnd';
      r.phaseFrame = 0;
      if (r.winner === 0 || r.winner === 2) a.wins++;
      if (r.winner === 1 || r.winner === 2) b.wins++;
      for (let i = 0; i < 2; i++) {
        const f = F(state, i);
        setMode(f, r.winner === i ? 'win' : 'lose');
        f.airborne = false; f.pos.y = 0;
      }
      emit(state, { type: 'roundEnd', player: (r.winner === 2 ? 0 : r.winner) as 0 | 1, pos: vec(0, 0, 0), tag: r.winner === 2 ? 'draw' : String(r.number) });
      return;
    }
  } else if (r.phase === 'roundEnd') {
    if (r.phaseFrame >= ROUND_END_FRAMES) {
      const done0 = a.wins >= state.roundsToWin, done1 = b.wins >= state.roundsToWin;
      if (done0 || done1) {
        r.phase = 'matchEnd';
        r.phaseFrame = 0;
        r.winner = done0 && done1 ? 2 : done0 ? 0 : 1;
        emit(state, { type: 'matchEnd', player: (r.winner === 2 ? 0 : r.winner) as 0 | 1, pos: vec(0, 0, 0), tag: r.winner === 2 ? 'draw' : undefined });
        return;
      }
      r.number++;
      resetRound(state);
      return;
    }
  }
  r.phaseFrame++;
}
