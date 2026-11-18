/**
 * Pose sampling: MoveDef.anim keyframes (stepped "limited animation" + ease-out snap)
 * or fighter.pose with procedural motion by mode / modeFrame.
 */
import type { CharId, FighterState, MoveDef, PoseName } from '../../sim/types';
import { getMove } from '../../sim';
import { C, NCH, poseTable, isPose, STRIKE_POSES } from './poses';

export type MoveLookup = (char: CharId, moveId: string) => MoveDef | undefined;

export const defaultMoveLookup: MoveLookup = (char, id) => {
  try { return getMove(char, id); } catch { return undefined; }
};

export interface SampleInfo {
  snap: boolean; // strikes / hit reactions snap (no smoothing)
  pose: PoseName; // dominant pose (for expressions)
  strike: boolean;
}

const tmpA = new Float32Array(NCH);

function lerpInto(out: Float32Array, a: Float32Array, b: Float32Array, t: number): void {
  for (let i = 0; i < NCH; i++) out[i] = a[i] + (b[i] - a[i]) * t;
}

function easeOut(t: number): number { const u = 1 - t; return 1 - u * u * u; }

/** cheap hash noise in [-1, 1] */
function noise(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

export function sampleFighter(char: CharId, f: FighterState, alpha: number, time: number, out: Float32Array, info: SampleInfo, lookup: MoveLookup): void {
  const T = poseTable(char);
  info.snap = false; info.strike = false;
  // ---- move keyframes
  if (f.moveId) {
    const mv = lookup(char, f.moveId);
    const anim = mv?.anim;
    if (anim && anim.length) {
      const hold = 2;
      const fq = Math.floor(f.moveFrame / hold) * hold;
      let i = 0;
      for (let k = 0; k < anim.length; k++) if (anim[k][0] <= fq) i = k;
      const [f0, p0] = anim[i];
      const A = T[isPose(p0) ? p0 : 'idle'];
      if (i + 1 < anim.length && fq >= f0) {
        const [f1, p1] = anim[i + 1];
        const B = T[isPose(p1) ? p1 : 'idle'];
        const t = f1 > f0 ? Math.min(1, (fq - f0) / (f1 - f0)) : 1;
        lerpInto(out, A, B, easeOut(t));
        info.pose = t > 0.5 ? (p1 as PoseName) : (p0 as PoseName);
      } else {
        out.set(A);
        info.pose = p0 as PoseName;
      }
      for (let k = 0; k < anim.length; k++) if (anim[k][1] === 'spinAttack') { out[C.rootYaw] += fq * 26; break; }
      info.snap = true;
      info.strike = true;
      return;
    }
  }
  // ---- named pose + procedural motion
  const pose: PoseName = isPose(f.pose) ? f.pose : 'idle';
  info.pose = pose;
  const mf = f.modeFrame + alpha;
  const base = T[pose];
  out.set(base);
  switch (pose) {
    case 'idle':
    case 'idle2': {
      const k = 0.5 + 0.5 * Math.sin(time * 2.4);
      lerpInto(out, T.idle, T.idle2, k);
      break;
    }
    case 'walk1':
    case 'walk2': {
      // forward/back from velocity projected on facing
      const fwd = (f.vel.x * f.facing.x + f.vel.z * f.facing.z) / 1000;
      const dir = fwd < -1 ? -1 : 1;
      const ph = mf * 0.17 * dir;
      lerpInto(out, T.walk1, T.walk2, 0.5 + 0.5 * Math.sin(ph));
      out[C.hipY] += Math.abs(Math.sin(ph)) * 0.015;
      break;
    }
    case 'sideStep': {
      const lat = (f.vel.x * -f.facing.z + f.vel.z * f.facing.x) / 1000; // + = toward character left
      const s = lat >= 0 ? 1 : -1;
      out[C.hipR] *= -s; out[C.spR] *= -s; out[C.hdR] *= -s;
      out[C.hipY] += Math.sin(mf * 0.4) * 0.01;
      break;
    }
    case 'dash': {
      const ph = mf * 0.5;
      lerpInto(tmpA, T.dash, T.walk2, 0.5 + 0.5 * Math.sin(ph));
      lerpInto(out, T.dash, tmpA, 0.4);
      break;
    }
    case 'kiCharge': {
      out[C.hipX] += noise(Math.floor(mf)) * 0.006;
      out[C.chP] += Math.sin(mf * 0.9) * 1.5;
      break;
    }
    case 'stagger': {
      out[C.hipX] += Math.sin(mf * 0.12) * 0.05;
      out[C.spR] += Math.sin(mf * 0.12) * 8;
      out[C.hdR] += Math.sin(mf * 0.1 + 1) * 10;
      break;
    }
    case 'win': {
      out[C.hR + 1] += Math.abs(Math.sin(mf * 0.15)) * 0.04;
      out[C.chP] += Math.sin(time * 2.2) * 1.5;
      break;
    }
    case 'introPose': {
      const b = Math.sin(time * 2.1);
      out[C.chP] += b * 1.6; out[C.hipY] += b * 0.006; out[C.hdP] += Math.sin(time * 0.7) * 2;
      out[C.hL + 1] += b * 0.008; out[C.hR + 1] += b * 0.008;
      break;
    }
    default: break;
  }
  if (f.mode === 'hitstun' || f.mode === 'blockstun') {
    const decay = Math.max(0, 1 - f.modeFrame / 12);
    const amp = (f.mode === 'hitstun' ? 0.03 : 0.012) * decay;
    out[C.hipX] += noise(f.modeFrame * 3.1) * amp;
    out[C.hipZ] += noise(f.modeFrame * 5.7) * amp;
    out[C.chY] += noise(f.modeFrame * 2.3) * 300 * amp;
    info.snap = f.modeFrame < 3;
  }
  if (f.mode === 'juggle' || f.mode === 'thrown') {
    // rotate whole body with vertical velocity: rising = arched back, falling = tipping over
    const vy = f.vel.y;
    out[C.rootPitch] += Math.max(-85, -20 - Math.max(0, -vy) * 1.1);
  }
  if (STRIKE_POSES.has(pose)) { info.snap = true; info.strike = true; }
}
