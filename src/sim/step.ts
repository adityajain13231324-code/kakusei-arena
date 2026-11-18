/**
 * The fixed-timestep simulation step. Order of operations per frame:
 *   1. clear events, frame++, round pre-phase (intro -> fight)
 *   2. read inputs for both fighters (always, so buffers work during hitstop)
 *   3. special global states: beam clash / ultimate cinematic run INSTEAD of 4-9
 *   4. hitstop: frozen fighters skip think/physics/advance
 *   5. think (inputs -> actions/movement) for live, non-frozen fighters
 *   6. physics, walls, body separation, facing
 *   7. invulnerability flags, projectiles, strike/throw detection + resolution
 *   8. advance timers (moveFrame, modeFrame, stun) and end timed modes
 *   9. meters, poses, rounds post-phase (timer / KO), camera
 */
import type { GameState, InputBits } from './types';
import { F, setMode, moveOf, totalFrames, isFreeMode, type SF } from './fighter';
import { updateInput, R_UP, R_DOWN } from './input';
import { think, physics, walls } from './movement';
import { separate } from './collision';
import { detectStrikes, checkWhiff, stunnedThisStep, toJuggle } from './hit';
import { updateProjectiles, updateClash } from './projectiles';
import { updateMeters, updateUltCine } from './meters';
import { roundsPre, roundsPost, inputsLive } from './rounds';
import { updateCamera, updateFacing } from './camera';
import { updatePoses } from './pose';
import {
  SIDESTEP_FRAMES, DASH_FRAMES, BACKDASH_FRAMES, VANISH_FRAMES, VANISH_INVULN, AWAKEN_FRAMES,
  WAKE_FRAMES, WAKE_INVULN, KD_LIE, SPLAT_FRAMES, PREJUMP,
} from './constants';

const frozen = [false, false];

function computeInvuln(f: SF): void {
  let inv = false;
  let armor = false;
  switch (f.mode) {
    case 'knockdown': case 'awaken': case 'intro': case 'win': case 'lose': case 'clash': inv = true; break;
    case 'wakeup': inv = f.modeFrame < WAKE_INVULN; break;
    case 'vanish': inv = f.modeFrame < VANISH_INVULN; break;
    case 'attack': {
      const m = moveOf(f);
      if (m) {
        const fr = f.moveFrame + 1;
        if (m.invuln && fr >= m.invuln[0] && fr <= m.invuln[1]) inv = true;
        if (m.armor && !f.sim.armorUsed && fr >= m.armor[0] && fr <= m.armor[1]) armor = true;
        if (f.sim.partner >= 0) inv = true; // throwing someone
      }
      break;
    }
  }
  f.invuln = inv;
  f.armor = armor;
}

function endMove(f: SF): void {
  if (f.airborne) {
    setMode(f, 'jump');
    f.modeFrame = PREJUMP + 1;
    f.sim.airAttackUsed = true;
  } else setMode(f, 'idle');
}

function resetCombo(f: SF): void {
  f.comboHits = 0;
  f.comboDamage = 0;
  f.juggleScale = 1000;
  f.sim.bounceUsed = false;
  f.sim.splatUsed = false;
  f.sim.crumple = false;
}

function advance(state: GameState, i: number): void {
  const f = F(state, i), s = f.sim;
  if (f.mode === 'attack') {
    const m = moveOf(f);
    if (!m) setMode(f, 'idle');
    else {
      checkWhiff(state, i);
      const holding = f.stance && m.stance && f.moveFrame >= m.stance.loopFrame;
      if (!holding) f.moveFrame++;
      if (f.moveFrame >= totalFrames(m) && !(m.stance && f.stance)) endMove(f);
      else if (m.kind === 'ultimate' && !m.internal && f.moveFrame > m.startup + m.active && state.camera.cinematic?.kind === 'ultimate' && !state.ult) {
        state.camera.cinematic = null; // whiffed / blocked ultimate: drop the cinematic camera
      } else if (state.camera.cinematic?.kind === 'ultimate' && !state.ult && state.camera.cinematic.player === i) {
        state.camera.cinematic.frame = f.moveFrame;
      }
    }
  }
  f.modeFrame++;
  if (s.landLag > 0) s.landLag--;
  if (s.turnLock > 0) s.turnLock--;
  switch (f.mode) {
    case 'hitstun':
    case 'blockstun':
      if (!stunnedThisStep[i]) f.stun--;
      if (f.stun <= 0) {
        f.stun = 0;
        if (f.mode === 'hitstun' && s.crumple) { s.crumple = false; setMode(f, 'knockdown'); }
        else {
          if (f.mode === 'hitstun') resetCombo(f);
          setMode(f, s.rel & R_DOWN ? 'crouch' : 'idle');
        }
      }
      break;
    case 'sidestep':
      if (f.modeFrame >= SIDESTEP_FRAMES) {
        if ((s.rel & R_UP) && s.ssX * state.camera.normal.x + s.ssZ * state.camera.normal.z < 0) setMode(f, 'sidewalk');
        else setMode(f, 'idle');
      }
      break;
    case 'dash': if (f.modeFrame >= DASH_FRAMES) setMode(f, 'idle'); break;
    case 'backdash': if (f.modeFrame >= BACKDASH_FRAMES) setMode(f, 'idle'); break;
    case 'vanish': if (f.modeFrame >= VANISH_FRAMES) setMode(f, 'idle'); break;
    case 'awaken':
      if (state.camera.cinematic?.kind === 'awaken') state.camera.cinematic.frame = f.modeFrame;
      if (f.modeFrame >= AWAKEN_FRAMES) { setMode(f, 'idle'); if (state.camera.cinematic?.kind === 'awaken') state.camera.cinematic = null; }
      break;
    case 'knockdown': if (f.modeFrame >= KD_LIE) setMode(f, 'wakeup'); break;
    case 'wakeup': if (f.modeFrame >= WAKE_FRAMES) { resetCombo(f); setMode(f, 'idle'); } break;
    case 'wallsplat': if (f.modeFrame >= SPLAT_FRAMES) toJuggle(state, i, F(state, 1 - i), 0, 0); break;
    case 'idle': case 'walk': case 'crouch': case 'guard': case 'sidewalk': case 'kicharge': case 'jump':
      if (f.comboHits > 0 && f.mode !== 'jump') resetCombo(f);
      break;
  }
}

function trackAdvantage(state: GameState): void {
  const t = state.advTrack;
  if (!t) return;
  const a = F(state, t.att), d = F(state, 1 - t.att);
  if (t.aFree < 0 && isFreeMode(a)) t.aFree = state.frame;
  if (t.dFree < 0 && isFreeMode(d)) t.dFree = state.frame;
  if (t.aFree >= 0 && t.dFree >= 0) {
    state.frameAdv = { player: t.att as 0 | 1, value: t.dFree - t.aFree, moveId: t.moveId, frame: state.frame };
    state.advTrack = null;
  }
}

export function step(state: GameState, inputs: [InputBits, InputBits]): void {
  state.events.length = 0;
  state.frame++;
  if (state.slowmo > 0) state.slowmo--;
  roundsPre(state);
  const live = inputsLive(state);
  for (let i = 0; i < 2; i++) updateInput(F(state, i), live ? inputs[i] | 0 : 0);

  if (state.clash.active) {
    updateClash(state);
    finish(state);
    return;
  }
  if (state.ult) {
    updateUltCine(state);
    finish(state);
    return;
  }

  stunnedThisStep[0] = stunnedThisStep[1] = false;
  for (let i = 0; i < 2; i++) {
    const f = F(state, i);
    if (f.hitstop > 0) { f.hitstop--; frozen[i] = true; } else frozen[i] = false;
  }
  if (live) for (let i = 0; i < 2; i++) if (!frozen[i]) think(state, i);
  for (let i = 0; i < 2; i++) if (!frozen[i]) physics(state, i);
  separate(state, F(state, 0), F(state, 1));
  walls(state, 0);
  walls(state, 1);
  updateFacing(state);
  for (let i = 0; i < 2; i++) computeInvuln(F(state, i));
  const hitsLive = live || state.training;
  updateProjectiles(state, hitsLive);
  if (state.clash.active) { finish(state); return; }
  if (hitsLive) detectStrikes(state, frozen);
  for (let i = 0; i < 2; i++) if (!frozen[i]) advance(state, i);
  if (live) updateMeters(state);
  trackAdvantage(state);
  finish(state);
}

function finish(state: GameState): void {
  updatePoses(state);
  roundsPost(state);
  updateCamera(state);
}
