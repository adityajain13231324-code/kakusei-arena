/**
 * Animation v2 clip layer (one per FighterView): picks the clip for the fighter's state / move, samples it at the
 * interpolated sim time, crossfades 2-4 frames between clips (frozen-source blend) and adds small additive layers
 * (stun shake). Output: a pose-channel vector for FighterView's IK, plus a request naming the authored clip
 * (anims.glb) that should play on top of it when one is loaded (see extclips.ts).
 *
 * Reads FighterState only. Render time / Math.sin are fine here (render side, no determinism needed).
 */
import type { CharId, FighterState, MoveDef } from '../../sim/types';
import { C, NCH, poseTable } from './poses';
import { clipLib, moveClip, mixPose, type AnimCtx, type Clip, type ClipLib, type SampleOut } from './clips';
import type { MoveLookup } from './sampler';

/** which authored clip should play now (names: docs/ANIMATION.md) */
export interface ExtRequest {
  /** preferred clip name ('' = none) */
  name: string;
  /** fallback clip name ('' = none) */
  alt: string;
  /** move being played (time-warp via clipTiming) or null */
  mv: MoveDef | null;
  /** state / move time, 60 Hz frames */
  t: number;
  /** loop by render time (idle, guard...) */
  loop: boolean;
  /** locomotion: clip time = cycle phase (0..1) instead of t */
  phase: number;
  /** crossfade frames */
  fade: number;
}

function noise(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

export class Animator {
  readonly out = new Float32Array(NCH);
  readonly so: SampleOut = { label: 'idle', strike: false };
  readonly ext: ExtRequest = { name: '', alt: '', mv: null, t: 0, loop: false, phase: -1, fade: 3 };
  private cur = new Float32Array(NCH);
  private from = new Float32Array(NCH);
  private lib: ClipLib;
  private ctx: AnimCtx;
  private clip: Clip | null = null;
  private clipT = 0;
  private fadeT = 0; private fadeLen = 0;
  private lastMode = ''; private lastModeFrame = -1; private lastMoveId: string | null = null; private lastMoveFrame = -1;
  private lastX = 1e9; private lastZ = 0;
  private speedF = 0;
  private hitDur = 12;
  /** name of the clip playing (debug overlay) */
  clipName = '';
  /** set by FighterView.onHit (0.2 light .. 1 super) */
  hitStrength = 0.45;
  private hitSide = 1;
  /** model leg length / reference leg (foot plants scale with it) */
  legScale = 1;

  constructor(readonly char: CharId) {
    this.lib = clipLib(char);
    this.ctx = {
      char, f: null as unknown as FighterState, T: poseTable(char), prof: this.lib.prof,
      t: 0, time: 0, phase: 0, latPhase: 0, ramp: 0, dir: 1, lat: 1, vy: 0, dur: 12, strength: 0.45, side: 1,
    };
    this.out.set(this.lib.prof.stance);
  }

  onHit(strength: number): void { this.hitStrength = strength; this.hitSide = -this.hitSide; }

  update(f: FighterState, prev: FighterState | null, alpha: number, dt: number, time: number, lookup: MoveLookup): void {
    const ctx = this.ctx, lib = this.lib;
    ctx.f = f; ctx.time = time;
    const p = prev ?? f;
    const modeT = prev && prev.mode === f.mode && prev.modeFrame <= f.modeFrame ? p.modeFrame + (f.modeFrame - p.modeFrame) * alpha : f.modeFrame;
    ctx.vy = p.vel.y + (f.vel.y - p.vel.y) * alpha;
    // ---- locomotion phase from distance actually travelled (foot plants match sim speed)
    const x = (p.pos.x + (f.pos.x - p.pos.x) * alpha) / 1000, z = (p.pos.z + (f.pos.z - p.pos.z) * alpha) / 1000;
    let dx = x - this.lastX, dz = z - this.lastZ;
    if (dx * dx + dz * dz > 0.25) { dx = 0; dz = 0; } // teleport / round reset
    this.lastX = x; this.lastZ = z;
    const fl = Math.hypot(f.facing.x, f.facing.z) || 1;
    const fx = f.facing.x / fl, fz = f.facing.z / fl;
    const fwd = dx * fx + dz * fz, lat = dx * -fz + dz * fx;
    const ls = Math.max(0.5, this.legScale);
    ctx.phase += fwd / (lib.prof.stride * ls);
    ctx.latPhase += lat / (0.56 * ls);
    if (dt > 0) {
      const sp = fwd / dt;
      this.speedF += (sp - this.speedF) * Math.min(1, dt * 12);
    }
    if (Math.abs(this.speedF) > 0.15) ctx.dir = this.speedF > 0 ? 1 : -1;
    const lv = f.vel.x * -fz + f.vel.z * fx;
    if (Math.abs(lv) > 1) ctx.lat = lv > 0 ? 1 : -1;
    // ---- pick the clip
    const ext = this.ext;
    ext.mv = null; ext.loop = false; ext.phase = -1; ext.alt = '';
    let clip: Clip = lib.idle;
    let t = modeT;
    let restart = false;
    let mv: MoveDef | undefined;
    if (f.moveId && (mv = lookup(f.char, f.moveId)) && mv.anim && mv.anim.length) {
      const mc = moveClip(f.char, mv);
      if (mc) {
        clip = mc;
        t = prev && prev.moveId === f.moveId && prev.moveFrame <= f.moveFrame ? p.moveFrame + (f.moveFrame - p.moveFrame) * alpha : f.moveFrame;
        restart = f.moveId === this.lastMoveId && f.moveFrame < this.lastMoveFrame;
        ext.name = mv.clip ?? mv.id; ext.alt = mv.clip ? mv.id : ''; ext.mv = mv;
      }
    }
    if (clip === lib.idle) {
      const sameMode = f.mode === this.lastMode;
      switch (f.mode) {
        case 'idle':
          if (f.pose === 'land') { clip = lib.land; ext.name = 'land'; }
          else if (f.pose !== 'idle' && f.pose !== 'idle2') { clip = lib.pose; ext.name = ''; } // dev pose viewer
          else { ext.name = 'idle'; ext.loop = true; }
          break;
        case 'walk':
          clip = lib.walk; ctx.ramp = Math.min(1, (modeT + 1) / 6);
          ext.name = ctx.dir > 0 ? 'walk_fwd' : 'walk_back'; ext.phase = ctx.dir > 0 ? ctx.phase : -ctx.phase;
          break;
        case 'sidewalk':
          clip = lib.side; ctx.ramp = Math.min(1, (modeT + 1) / 5);
          ext.name = 'walk_side'; ext.phase = ctx.lat > 0 ? ctx.latPhase : -ctx.latPhase;
          break;
        case 'dash': clip = lib.run; ctx.ramp = Math.min(1, (modeT + 1) / 4); ext.name = 'run'; ext.phase = ctx.phase; break;
        case 'backdash': clip = lib.backdash; ext.name = 'backdash'; break;
        case 'sidestep': clip = lib.sidestep; ext.name = 'sidestep'; break;
        case 'jump': clip = lib.jump; ext.name = 'jump'; break;
        case 'crouch': clip = lib.crouch; ext.name = 'crouch'; ext.loop = true; break;
        case 'guard':
          clip = f.pose === 'guardLow' ? lib.guardLow : lib.guardHigh;
          ext.name = f.pose === 'guardLow' ? 'guard_low' : 'guard_high'; ext.loop = true;
          break;
        case 'blockstun':
          clip = lib.block; ext.name = f.pose === 'guardLow' ? 'block_low' : 'block_high';
          restart = sameMode && f.modeFrame < this.lastModeFrame;
          break;
        case 'hitstun':
          clip = lib.hit;
          restart = sameMode && f.modeFrame < this.lastModeFrame;
          if (f.pose === 'stagger') ext.name = 'stagger';
          else {
            ext.alt = f.pose === 'hitHigh' ? 'hit_high' : f.pose === 'hitLow' ? 'hit_low' : 'hit_mid';
            ext.name = this.hitStrength > 0.6 ? 'hit_heavy' : ext.alt;
          }
          break;
        case 'juggle': clip = lib.juggle; ext.name = 'juggle'; break;
        case 'knockdown': clip = lib.knockdown; ext.name = 'knockdown'; break;
        case 'wakeup': clip = lib.getup; ext.name = 'getup'; break;
        case 'wallsplat': clip = lib.wallsplat; ext.name = 'wallsplat'; break;
        case 'thrown': clip = lib.thrown; ext.name = 'thrown'; break;
        case 'kicharge': clip = lib.ki; ext.name = 'ki_charge'; ext.loop = true; break;
        case 'vanish': clip = lib.vanish; ext.name = 'vanish'; break;
        case 'awaken': clip = lib.awaken; ext.name = 'awaken'; break;
        case 'intro': clip = lib.intro; ext.name = 'intro'; break;
        case 'win': clip = lib.win; ext.name = 'win'; break;
        case 'lose': clip = lib.lose; ext.name = 'lose'; break;
        case 'clash': clip = lib.clash; ext.name = 'clash'; ext.loop = true; break;
        case 'attack': clip = lib.pose; ext.name = ''; break; // move without anim keys
        default: ext.name = 'idle'; ext.loop = true;
      }
      // a landing / get-up / dash stop finishes its settle before plain idle takes over
      const c0 = this.clip;
      if (clip === lib.idle && c0 && c0.settle && !restart && this.clipT + dt * 60 < c0.dur) {
        clip = c0; t = this.clipT + dt * 60; ext.name = '';
      }
    }
    if (clip !== this.clip || restart) {
      if ((f.mode === 'hitstun' || f.mode === 'blockstun') && (clip === lib.hit || clip === lib.block)) {
        this.hitDur = Math.max(6, f.stun + f.modeFrame);
      }
      if (this.clip && dt > 0) {
        this.from.set(this.out);
        this.fadeT = 0;
        this.fadeLen = clip.fade;
      } else this.fadeLen = 0;
      this.clip = clip;
      this.clipName = clip.name;
    }
    this.clipT = t;
    ctx.t = t;
    ctx.dur = this.hitDur;
    ctx.strength = this.hitStrength;
    ctx.side = this.hitSide;
    clip.sample(this.cur, ctx, this.so);
    if (f.moveId && clip !== lib.pose) this.so.strike = true;
    // ---- crossfade (frozen source → live clip)
    if (this.fadeLen > 0 && this.fadeT < this.fadeLen) {
      this.fadeT += dt * 60;
      const u = Math.min(1, this.fadeT / this.fadeLen);
      mixPose(this.out, this.from, this.cur, u * u * (3 - 2 * u));
      this.out[C.weapon] = this.cur[C.weapon]; this.out[C.twoHand] = this.cur[C.twoHand];
    } else this.out.set(this.cur);
    // ---- additive: stun shake
    if (f.mode === 'hitstun' || f.mode === 'blockstun') {
      const decay = Math.max(0, 1 - f.modeFrame / 12);
      const amp = (f.mode === 'hitstun' ? 0.03 : 0.012) * decay;
      this.out[C.hipX] += noise(f.modeFrame * 3.1) * amp;
      this.out[C.hipZ] += noise(f.modeFrame * 5.7) * amp;
      this.out[C.chY] += noise(f.modeFrame * 2.3) * 300 * amp;
    }
    // ---- additive: breathing on held end poses (win / lose / intro tail)
    if ((clip === lib.win || clip === lib.lose) && t > clip.dur) {
      const br = Math.sin(time * (clip === lib.lose ? 4.2 : 2.4));
      this.out[C.chP] += br * (clip === lib.lose ? 4 : 2);
      this.out[C.hdP] -= br * 1.5;
      if (clip === lib.win) this.out[C.hR + 1] += Math.abs(Math.sin(time * 2.6)) * 0.03;
    }
    ext.t = t;
    ext.fade = clip.fade;
    this.lastMode = f.mode; this.lastModeFrame = f.modeFrame; this.lastMoveId = f.moveId; this.lastMoveFrame = f.moveFrame;
  }
}
