/**
 * Pose library. Every PoseName from types.ts is authored here for a generic humanoid,
 * plus per-character style overrides.
 *
 * A pose is a flat Float32Array of channels (see C). Arms and legs are IK-driven:
 *   - hand targets are wrist positions in CHEST-local space (x = character left, y up, z forward)
 *   - foot targets are ankle positions in ROOT space (ground frame; root faces +Z = opponent)
 *   - elbow / knee poles are directions in root space
 * Angles are degrees, offsets metres.
 */
import type { CharId, PoseName } from '../../sim/types';
import { POSES } from '../../sim/types';

export const C = {
  hipX: 0, hipY: 1, hipZ: 2, hipP: 3, hipYaw: 4, hipR: 5,
  spP: 6, spY: 7, spR: 8, chP: 9, chY: 10, chR: 11, hdP: 12, hdY: 13, hdR: 14,
  hL: 15, eL: 18, wL: 21, hR: 24, eR: 27, wR: 30,
  fL: 33, kL: 36, fLp: 39, fLy: 40, fR: 41, kR: 44, fRp: 47, fRy: 48,
  openL: 49, openR: 50, rootYaw: 51, rootPitch: 52, weapon: 53, twoHand: 54, lift: 55,
} as const;
export const NCH = 56;

type V3 = [number, number, number];
export interface PoseSpec {
  base?: PoseName | 'stance';
  hip?: V3; hipRot?: V3; spine?: V3; chest?: V3; head?: V3;
  handL?: V3; elbowL?: V3; wristL?: V3;
  handR?: V3; elbowR?: V3; wristR?: V3;
  footL?: V3; kneeL?: V3; footLRot?: [number, number];
  footR?: V3; kneeR?: V3; footRRot?: [number, number];
  open?: [number, number]; rootYaw?: number; rootPitch?: number; weapon?: number; twoHand?: number; lift?: number;
}

function write(out: Float32Array, s: PoseSpec): void {
  const put = (i: number, v: number[] | undefined) => { if (v) for (let k = 0; k < v.length; k++) out[i + k] = v[k]; };
  put(C.hipX, s.hip); put(C.hipP, s.hipRot); put(C.spP, s.spine); put(C.chP, s.chest); put(C.hdP, s.head);
  put(C.hL, s.handL); put(C.eL, s.elbowL); put(C.wL, s.wristL);
  put(C.hR, s.handR); put(C.eR, s.elbowR); put(C.wR, s.wristR);
  put(C.fL, s.footL); put(C.kL, s.kneeL); put(C.fLp, s.footLRot);
  put(C.fR, s.footR); put(C.kR, s.kneeR); put(C.fRp, s.footRRot);
  put(C.openL, s.open);
  if (s.rootYaw !== undefined) out[C.rootYaw] = s.rootYaw;
  if (s.rootPitch !== undefined) out[C.rootPitch] = s.rootPitch;
  if (s.weapon !== undefined) out[C.weapon] = s.weapon;
  if (s.twoHand !== undefined) out[C.twoHand] = s.twoHand;
  if (s.lift !== undefined) out[C.lift] = s.lift;
}

// ------------------------------------------------------------------ base stance (orthodox, left lead)
const STANCE: PoseSpec = {
  hip: [0, -0.07, 0], hipRot: [4, -30, 0], spine: [5, -4, 0], chest: [4, -6, 0], head: [-2, 38, 0],
  handL: [0.13, 0.25, 0.3], elbowL: [0.3, -1, -0.1], wristL: [0, 0, 0],
  handR: [-0.03, 0.23, 0.2], elbowR: [-0.3, -1, -0.2], wristR: [0, 0, 0],
  footL: [0.08, 0.05, 0.22], kneeL: [0.25, 0, 1], footLRot: [0, -12],
  footR: [-0.17, 0.05, -0.2], kneeR: [-0.45, 0, 1], footRRot: [0, -48],
  open: [0, 0], rootYaw: 0, rootPitch: 0, weapon: 0, twoHand: 0, lift: 0,
};

const P: Partial<Record<PoseName, PoseSpec>> = {
  idle: {},
  idle2: { hip: [0, -0.085, -0.01], chest: [8, -6, 0], head: [2, 38, 0], handL: [0.13, 0.22, 0.29], handR: [-0.03, 0.2, 0.19] },
  walk1: { hip: [0, -0.06, 0.04], footL: [0.08, 0.05, 0.34], footR: [-0.17, 0.09, -0.12], footRRot: [-15, -40] },
  walk2: { hip: [0, -0.08, -0.02], footL: [0.06, 0.12, 0.12], footLRot: [10, -12], footR: [-0.17, 0.05, -0.26] },
  crouch: {
    hip: [0, -0.4, -0.02], hipRot: [22, -28, 0], spine: [12, -4, 0], chest: [8, -4, 0], head: [-18, 36, 0],
    handL: [0.14, 0.22, 0.3], handR: [-0.02, 0.2, 0.22],
    footL: [0.14, 0.05, 0.22], kneeL: [0.6, 0.2, 1], footR: [-0.22, 0.05, -0.16], kneeR: [-0.7, 0.2, 1],
  },
  jumpUp: {
    hip: [0, 0.0, 0], hipRot: [-6, -20, 0], chest: [-6, -5, 0], head: [-6, 25, 0],
    handL: [0.2, 0.32, 0.2], handR: [-0.12, 0.3, 0.12],
    footL: [0.1, 0.42, 0.18], kneeL: [0, 0.3, 1], footLRot: [40, -10], footR: [-0.12, 0.3, -0.12], kneeR: [0, 0, 1], footRRot: [50, -20],
  },
  jumpFall: {
    hip: [0, 0.0, 0], hipRot: [4, -24, 0], head: [6, 30, 0],
    handL: [0.28, 0.2, 0.18], elbowL: [1, -0.5, 0], handR: [-0.24, 0.18, 0.05], elbowR: [-1, -0.5, 0],
    footL: [0.1, 0.16, 0.14], footLRot: [30, -10], footR: [-0.12, 0.2, -0.18], footRRot: [35, -30],
  },
  land: {
    hip: [0, -0.3, 0], hipRot: [24, -26, 0], spine: [10, 0, 0], head: [-20, 32, 0],
    handL: [0.22, 0.12, 0.3], handR: [-0.16, 0.1, 0.25],
    footL: [0.12, 0.05, 0.22], kneeL: [0.5, 0, 1], footR: [-0.2, 0.05, -0.2], kneeR: [-0.6, 0, 1],
  },
  dash: {
    hip: [0, -0.14, 0.12], hipRot: [26, -22, 0], spine: [10, 0, 0], chest: [6, 0, 0], head: [-26, 25, 0],
    handL: [0.16, 0.2, 0.28], handR: [-0.06, 0.16, 0.12],
    footL: [0.08, 0.2, 0.32], kneeL: [0, 0.4, 1], footLRot: [20, -10], footR: [-0.14, 0.08, -0.36], footRRot: [-30, -30],
  },
  backdash: {
    hip: [0, -0.1, -0.1], hipRot: [-8, -34, 0], chest: [-6, -6, 0], head: [8, 40, 0],
    handL: [0.14, 0.27, 0.26], handR: [-0.04, 0.25, 0.18],
    footL: [0.08, 0.14, 0.05], footLRot: [30, -10], footR: [-0.16, 0.05, -0.38],
  },
  sideStep: {
    hip: [0, -0.12, 0], hipRot: [6, -26, -12], spine: [0, 0, -6], head: [0, 34, 10],
    footL: [0.0, 0.1, 0.12], footR: [-0.24, 0.05, -0.12], kneeR: [-0.8, 0, 1],
  },
  guardHigh: {
    hip: [0, -0.1, -0.02], chest: [10, -2, 0], head: [12, 34, 0],
    handL: [0.09, 0.32, 0.22], elbowL: [0.2, -1, 0.6], wristL: [20, 0, 0], handR: [-0.06, 0.31, 0.19], elbowR: [-0.2, -1, 0.5], wristR: [20, 0, 0],
  },
  guardLow: {
    hip: [0, -0.36, -0.02], hipRot: [20, -26, 0], spine: [12, 0, 0], chest: [10, 0, 0], head: [-10, 34, 0],
    handL: [0.12, 0.04, 0.32], elbowL: [0.5, -1, 0], handR: [-0.06, 0.06, 0.28], elbowR: [-0.5, -1, 0],
    footL: [0.14, 0.05, 0.22], kneeL: [0.6, 0, 1], footR: [-0.22, 0.05, -0.16], kneeR: [-0.7, 0, 1],
  },
  hitHigh: {
    hip: [0, -0.07, -0.06], hipRot: [-6, -30, 4], spine: [-10, -6, 0], chest: [-14, -12, 6], head: [-32, 30, 14],
    handL: [0.3, 0.12, 0.08], elbowL: [1, -0.3, 0], handR: [-0.3, 0.15, -0.02], elbowR: [-1, -0.3, 0], open: [1, 1],
    footR: [-0.2, 0.05, -0.26],
  },
  hitMid: {
    hip: [0, -0.12, -0.08], hipRot: [10, -26, 0], spine: [22, -4, 0], chest: [18, -4, 0], head: [18, 34, 0],
    handL: [0.1, -0.06, 0.2], handR: [-0.08, -0.08, 0.2], open: [1, 1],
  },
  hitLow: {
    hip: [0, -0.24, -0.02], hipRot: [10, -30, -8], spine: [8, 0, 0], head: [12, 30, -8],
    handL: [0.24, 0.05, 0.22], handR: [-0.2, 0.08, 0.1], open: [1, 1],
    footL: [0.06, 0.12, 0.28], kneeL: [0.2, 0.5, 1],
  },
  stagger: {
    hip: [0.04, -0.14, -0.05], hipRot: [6, -18, -10], spine: [10, 10, -8], chest: [10, 6, -6], head: [24, 20, -20],
    handL: [0.24, -0.25, 0.08], elbowL: [0.4, -1, -0.5], handR: [-0.24, -0.28, 0.02], elbowR: [-0.4, -1, -0.5], open: [1, 1],
    footL: [0.04, 0.05, 0.16], kneeL: [-0.2, 0, 1],
  },
  launched: {
    hip: [0, -0.05, 0], hipRot: [-40, -20, 0], spine: [-14, 0, 0], chest: [-16, 0, 0], head: [-30, 15, 0],
    handL: [0.3, 0.32, -0.08], elbowL: [1, 0, -0.5], handR: [-0.3, 0.28, -0.12], elbowR: [-1, 0, -0.5], open: [1, 1],
    footL: [0.12, 0.35, 0.42], kneeL: [0, 1, 0.5], footLRot: [30, 0], footR: [-0.12, 0.2, 0.28], kneeR: [0, 1, 0.5], footRRot: [30, 0],
  },
  airHit: {
    hip: [0, -0.05, 0], hipRot: [-20, -20, 0], spine: [26, 0, 0], chest: [20, 0, 0], head: [10, 20, 0],
    handL: [0.18, 0.0, 0.24], handR: [-0.16, -0.02, 0.22], open: [1, 1],
    footL: [0.12, 0.45, 0.25], kneeL: [0, 0.6, 1], footR: [-0.1, 0.38, 0.12], kneeR: [0, 0.6, 1],
  },
  fallFlat: {
    hip: [0, -0.55, -0.12], hipRot: [-60, -10, 0], spine: [-8, 0, 0], chest: [-6, 0, 0], head: [-10, 10, 0],
    handL: [0.32, 0.18, -0.05], elbowL: [1, 0, 0], handR: [-0.32, 0.16, -0.05], elbowR: [-1, 0, 0], open: [1, 1],
    footL: [0.12, 0.3, 0.6], kneeL: [0, 1, 0.4], footLRot: [40, 0], footR: [-0.12, 0.2, 0.55], kneeR: [0, 1, 0.4], footRRot: [40, 0],
  },
  lieDown: {
    hip: [0, -0.8, -0.05], hipRot: [-90, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], head: [-6, 18, 0],
    handL: [0.36, 0.1, 0.06], elbowL: [1, 0, -1], handR: [-0.38, 0.06, 0.1], elbowR: [-1, 0, -1], open: [1, 1],
    footL: [0.14, 0.06, 0.78], kneeL: [0.2, 1, 0], footLRot: [70, -10], footR: [-0.16, 0.06, 0.74], kneeR: [-0.2, 1, 0], footRRot: [70, -20],
  },
  getUp: {
    hip: [0, -0.52, -0.04], hipRot: [24, -20, 0], spine: [14, 0, 0], head: [-20, 25, 0],
    handL: [0.22, -0.3, 0.32], elbowL: [1, -0.3, -0.4], handR: [-0.2, -0.18, 0.2], open: [1, 0],
    footL: [0.12, 0.05, 0.26], kneeL: [0.4, 0.3, 1], footR: [-0.18, 0.1, -0.3], kneeR: [-0.2, -1, 0.6], footRRot: [-50, -20],
  },
  wallSplat: {
    hip: [0, -0.08, -0.08], hipRot: [-12, -10, 0], spine: [-8, 0, 0], chest: [-10, -4, 0], head: [-22, 14, 10],
    handL: [0.38, 0.26, -0.08], elbowL: [1, -0.4, 0], handR: [-0.38, 0.3, -0.08], elbowR: [-1, -0.4, 0], open: [1, 1],
    footL: [0.14, 0.05, 0.16], footR: [-0.18, 0.05, -0.08],
  },
  throwGrab: {
    hip: [0, -0.12, 0.08], hipRot: [10, -10, 0], spine: [8, 0, 0], chest: [6, 4, 0], head: [-6, 10, 0],
    handL: [0.14, 0.16, 0.46], elbowL: [0.6, -1, 0], handR: [-0.1, 0.16, 0.48], elbowR: [-0.6, -1, 0], open: [1, 1],
    footL: [0.08, 0.05, 0.34],
  },
  throwToss: {
    hip: [0, -0.18, 0.02], hipRot: [10, 30, 0], spine: [0, 20, 0], chest: [-4, 30, 0], head: [-6, -30, 0],
    handL: [0.42, 0.22, 0.18], elbowL: [1, -0.4, 0], handR: [0.12, 0.28, 0.42], elbowR: [-0.4, -1, 0], open: [1, 1],
    footL: [0.18, 0.05, 0.2], footR: [-0.2, 0.05, -0.18],
  },
  thrown: {
    hip: [0, -0.05, 0], hipRot: [-55, -10, 10], spine: [-10, 0, 0], chest: [-12, 0, 0], head: [-26, 10, 0],
    handL: [0.34, 0.25, -0.05], handR: [-0.32, 0.3, 0.05], open: [1, 1],
    footL: [0.1, 0.55, 0.45], kneeL: [0, 1, 0.3], footR: [-0.14, 0.4, 0.5], kneeR: [0, 1, 0.3],
  },
  kiCharge: {
    hip: [0, -0.24, 0], hipRot: [6, -6, 0], spine: [-4, 0, 0], chest: [-12, -2, 0], head: [-16, 6, 0],
    handL: [0.22, -0.12, 0.02], elbowL: [1, -0.3, -1], handR: [-0.22, -0.12, 0.02], elbowR: [-1, -0.3, -1],
    footL: [0.27, 0.05, 0.08], kneeL: [0.8, 0, 1], footLRot: [0, 20], footR: [-0.27, 0.05, -0.04], kneeR: [-0.8, 0, 1], footRRot: [0, -25],
  },
  vanish: {
    hip: [0, -0.32, 0.06], hipRot: [34, -18, 0], spine: [10, 0, 0], head: [-34, 20, 0],
    handL: [0.22, -0.05, -0.12], elbowL: [1, 0.3, 0], handR: [-0.24, -0.04, -0.16], elbowR: [-1, 0.3, 0], open: [1, 1],
    footL: [0.1, 0.05, 0.3], kneeL: [0.3, 0.3, 1], footR: [-0.16, 0.12, -0.32], footRRot: [-40, -20],
  },
  awakenPose: {
    hip: [0, -0.2, 0], hipRot: [0, -4, 0], spine: [-8, 0, 0], chest: [-18, 0, 0], head: [-22, 4, 0],
    handL: [0.42, 0.24, 0.1], elbowL: [1, -0.6, 0], handR: [-0.42, 0.24, 0.1], elbowR: [-1, -0.6, 0],
    footL: [0.27, 0.05, 0.06], kneeL: [0.8, 0, 1], footLRot: [0, 20], footR: [-0.27, 0.05, -0.04], kneeR: [-0.8, 0, 1], footRRot: [0, -25],
  },
  introPose: {
    hip: [0, -0.02, 0], hipRot: [0, -14, 0], chest: [-4, -4, 0], head: [-4, 14, 0],
    handL: [-0.09, 0.08, 0.16], elbowL: [1, -0.4, 0], handR: [0.1, 0.11, 0.14], elbowR: [-1, -0.4, 0],
    footL: [0.12, 0.05, 0.04], kneeL: [0.2, 0, 1], footLRot: [0, 10], footR: [-0.14, 0.05, -0.04], kneeR: [-0.2, 0, 1], footRRot: [0, -15],
  },
  win: {
    hip: [0, -0.03, 0], hipRot: [0, -10, 0], chest: [-8, -6, 0], head: [-14, 8, 0],
    handR: [-0.14, 0.62, 0.06], elbowR: [-1, -0.2, 0], handL: [0.2, -0.12, -0.02], elbowL: [1, 0, -0.4],
    footL: [0.12, 0.05, 0.06], footLRot: [0, 10], footR: [-0.14, 0.05, -0.06], footRRot: [0, -15],
  },
  lose: {
    hip: [0, -0.5, -0.05], hipRot: [16, -12, 0], spine: [14, 0, 0], chest: [10, 0, 0], head: [32, 6, 0],
    handL: [0.2, -0.32, 0.22], handR: [-0.2, -0.34, 0.2], open: [1, 1],
    footL: [0.12, 0.05, 0.28], kneeL: [0.2, 0.5, 1], footR: [-0.14, 0.1, -0.26], kneeR: [0, -1, 0.5], footRRot: [-60, -10],
  },
  recover: {
    hip: [0, -0.22, -0.02], hipRot: [16, -26, 0], spine: [8, 0, 0], head: [-12, 32, 0],
    handL: [0.18, 0.18, 0.28], handR: [-0.1, 0.16, 0.2],
    footL: [0.12, 0.05, 0.22], footR: [-0.2, 0.05, -0.2],
  },
  // ---------------------------------------------------------------- strikes
  jabWind: { chest: [4, -14, 0], handL: [0.14, 0.24, 0.2] },
  jabExt: {
    hip: [0, -0.08, 0.04], chest: [2, -22, 0], head: [2, 44, 0], handL: [0.1, 0.22, 0.72], elbowL: [0.4, -1, 0], wristL: [0, -70, 0],
    footL: [0.08, 0.05, 0.28],
  },
  straightWind: { hipRot: [4, -34, 0], chest: [4, -16, 0], handR: [-0.12, 0.2, 0.06] },
  straightExt: {
    hip: [0, -0.1, 0.08], hipRot: [6, -6, 0], spine: [6, 10, 0], chest: [4, 22, 0], head: [2, -10, 0],
    handR: [-0.02, 0.2, 0.74], elbowR: [-0.4, -1, 0], wristR: [0, 70, 0], handL: [0.07, 0.25, 0.16],
    footL: [0.08, 0.05, 0.3], footR: [-0.15, 0.08, -0.2], footRRot: [-25, -20],
  },
  hookWind: { hipRot: [4, -36, 0], chest: [4, -18, 0], handR: [-0.3, 0.2, 0.02], elbowR: [-1, -0.2, -0.2] },
  hookExt: {
    hip: [0, -0.1, 0.05], hipRot: [6, -4, 0], spine: [4, 14, 0], chest: [6, 30, 0], head: [6, -14, 0],
    handR: [0.06, 0.26, 0.42], elbowR: [-1, 0.25, 0], wristR: [0, 90, 0],
    footR: [-0.15, 0.08, -0.2], footRRot: [-20, -10],
  },
  uppercutWind: { hip: [0, -0.2, 0], hipRot: [14, -30, 0], spine: [12, -6, 0], chest: [10, -14, 0], handR: [-0.1, -0.06, 0.18], elbowR: [-0.4, -1, -0.4], kneeL: [0.4, 0, 1] },
  uppercutExt: {
    hip: [0, -0.02, 0.05], hipRot: [-4, -10, 0], spine: [-8, 12, 0], chest: [-10, 22, 0], head: [-16, 10, 0],
    handR: [-0.02, 0.46, 0.3], elbowR: [0, -1, 0.3], wristR: [0, 0, 0],
    footR: [-0.15, 0.1, -0.18], footRRot: [-35, -20],
  },
  elbowExt: {
    hip: [0, -0.12, 0.08], hipRot: [6, 0, 0], spine: [4, 16, 0], chest: [4, 34, 0], head: [2, -18, 0],
    handR: [0.02, 0.2, 0.08], elbowR: [-0.2, -0.1, 1], handL: [0.08, 0.24, 0.18],
  },
  kneeExt: {
    hip: [0, -0.02, 0.06], hipRot: [-6, -10, 0], chest: [10, 0, 0], head: [10, 15, 0],
    handL: [0.12, 0.2, 0.42], handR: [-0.1, 0.2, 0.42], open: [1, 1],
    footL: [0.06, 0.05, 0.1], footR: [-0.08, 0.38, 0.0], kneeR: [0, 0.6, 1], footRRot: [50, 0],
  },
  lowKickWind: { hipRot: [4, -36, 0], footR: [-0.12, 0.22, -0.06], kneeR: [-0.3, 0, 1] },
  lowKickExt: {
    hip: [0, -0.1, 0.0], hipRot: [-4, 10, 0], chest: [-6, -10, 0], head: [0, 0, 0],
    footR: [0.06, 0.12, 0.68], kneeR: [0, 1, 0.6], footRRot: [30, 30],
  },
  midKickWind: { hip: [0, -0.06, 0], hipRot: [0, -34, 0], footR: [-0.06, 0.42, 0.02], kneeR: [0, 0.3, 1], footRRot: [40, -20] },
  midKickExt: {
    hip: [0, -0.04, -0.04], hipRot: [-16, 20, 0], spine: [-6, 0, 0], chest: [-4, -14, 0], head: [6, -6, 0],
    footR: [0.0, 0.88, 0.76], kneeR: [0, 1, 0.4], footRRot: [40, 0], footLRot: [0, -40],
  },
  highKickWind: { hip: [0, -0.04, 0], hipRot: [-4, -30, 0], footR: [-0.04, 0.72, 0.08], kneeR: [0, 1, 0.6], footRRot: [50, 0] },
  highKickExt: {
    hip: [0, -0.02, -0.06], hipRot: [-28, 24, 0], spine: [-8, 0, 0], chest: [-6, -14, 0], head: [16, -10, 0],
    footR: [-0.05, 1.42, 0.62], kneeR: [0, 0.6, 1], footRRot: [50, 0], footLRot: [0, -50],
  },
  roundhouseExt: {
    hip: [0, -0.04, -0.04], hipRot: [-14, 70, 10], spine: [-4, -10, -6], chest: [-4, -30, 0], head: [8, -30, 0],
    footR: [0.25, 1.15, 0.5], kneeR: [0, 1, 0], footRRot: [40, 60], footLRot: [0, 40],
    handL: [0.2, 0.22, 0.2], handR: [-0.2, 0.18, 0.12],
  },
  sweepExt: {
    hip: [0, -0.52, 0.0], hipRot: [24, 50, 0], spine: [10, 0, 0], head: [-10, -40, 0],
    handL: [0.14, -0.42, 0.36], elbowL: [1, 0, 0], handR: [-0.24, -0.1, 0.1], open: [1, 0],
    footL: [0.18, 0.05, 0.1], kneeL: [1, 0.5, 0.5], footR: [0.4, 0.08, 0.62], kneeR: [0, 1, 0.3], footRRot: [10, 60],
  },
  axeKickUp: {
    hip: [0, -0.04, -0.05], hipRot: [-24, -10, 0], chest: [-10, 0, 0], head: [10, 20, 0],
    footR: [-0.05, 1.62, 0.32], kneeR: [0, 0, 1], footRRot: [30, 0],
  },
  axeKickDown: {
    hip: [0, -0.18, 0.08], hipRot: [16, -10, 0], spine: [10, 0, 0], chest: [12, 0, 0], head: [-14, 20, 0],
    footR: [-0.05, 0.22, 0.68], kneeR: [0, 0.3, 1], footRRot: [10, 0],
  },
  flyingKick: {
    hip: [0, 0.0, 0], hipRot: [-14, -40, 0], chest: [4, -10, 0], head: [-6, 46, 0],
    handL: [0.24, 0.2, -0.02], handR: [-0.2, 0.26, 0.1],
    footL: [0.08, 0.6, 0.66], kneeL: [0, 0.6, 1], footLRot: [10, 0], footR: [-0.12, 0.42, -0.12], kneeR: [0, 0, 1], footRRot: [40, 0],
  },
  diveKick: {
    hip: [0, 0.0, 0], hipRot: [10, -36, 0], chest: [8, -6, 0], head: [-20, 40, 0], rootPitch: 26,
    handL: [0.26, 0.28, -0.04], handR: [-0.24, 0.26, -0.02],
    footL: [0.06, 0.08, 0.62], kneeL: [0, 0.5, 1], footLRot: [10, 0], footR: [-0.1, 0.5, -0.05], kneeR: [0, -0.2, 1], footRRot: [50, 0],
  },
  palmWind: { hipRot: [4, -36, 0], chest: [4, -20, 0], handR: [-0.2, -0.04, -0.06], elbowR: [-0.6, -0.4, -1], open: [0, 1] },
  palmExt: {
    hip: [0, -0.12, 0.08], hipRot: [6, -4, 0], spine: [4, 10, 0], chest: [4, 22, 0], head: [2, -12, 0],
    handR: [0.0, 0.16, 0.72], elbowR: [-0.5, -1, 0], wristR: [-70, 0, 0], open: [0, 1],
    footL: [0.08, 0.05, 0.32], footR: [-0.15, 0.08, -0.2], footRRot: [-25, -20],
  },
  beamCharge: {
    hip: [0, -0.2, -0.02], hipRot: [8, -50, 0], spine: [4, -10, 0], chest: [6, -20, 0], head: [-4, 72, 0],
    handL: [-0.12, -0.04, 0.1], elbowL: [1, -0.4, 0], wristL: [-30, 0, 0], handR: [-0.2, -0.06, 0.02], elbowR: [-1, -0.4, -0.4], wristR: [-30, 0, 0], open: [1, 1],
    footL: [0.14, 0.05, 0.22], kneeL: [0.5, 0, 1], footR: [-0.22, 0.05, -0.2], kneeR: [-0.6, 0, 1],
  },
  beamFire: {
    hip: [0, -0.18, 0.04], hipRot: [6, -14, 0], spine: [2, 6, 0], chest: [2, 8, 0], head: [0, 0, 0],
    handL: [0.05, 0.16, 0.66], elbowL: [0.6, -1, 0], wristL: [-75, 0, 0], handR: [-0.05, 0.13, 0.66], elbowR: [-0.6, -1, 0], wristR: [-75, 0, 0], open: [1, 1],
    footL: [0.14, 0.05, 0.3], kneeL: [0.4, 0, 1], footR: [-0.2, 0.05, -0.26], kneeR: [-0.5, 0, 1],
  },
  throwProjectile: {
    hip: [0, -0.12, 0.06], hipRot: [8, -6, 0], spine: [8, 12, 0], chest: [8, 26, 0], head: [-2, -14, 0],
    handR: [-0.02, 0.18, 0.62], elbowR: [-0.4, -1, 0], wristR: [30, 0, 0], open: [0, 1], handL: [0.24, 0.12, 0.02],
    footL: [0.08, 0.05, 0.3], footR: [-0.15, 0.08, -0.22], footRRot: [-25, -20],
  },
  // sword (generic one/two hand; Ren overrides to two-handed)
  slashWind: {
    hipRot: [2, -34, 0], chest: [-4, -18, 0], head: [-2, 48, 0],
    handR: [-0.12, 0.4, 0.08], elbowR: [-1, -0.2, -0.3], wristR: [65, 0, 0], weapon: 1,
    handL: [0.06, 0.34, 0.16],
  },
  slashExt: {
    hip: [0, -0.18, 0.12], hipRot: [12, -14, 0], spine: [8, 10, 0], chest: [10, 24, 0], head: [-4, 10, 0],
    handR: [0.1, -0.02, 0.46], elbowR: [-0.5, -1, 0], wristR: [45, 0, 0], weapon: 1,
    footL: [0.08, 0.05, 0.44], kneeL: [0.3, 0, 1], footR: [-0.17, 0.05, -0.22],
  },
  slashUpExt: {
    hip: [0, -0.06, 0.06], hipRot: [-4, -14, 0], spine: [-6, 8, 0], chest: [-10, 18, 0], head: [-14, 14, 0],
    handR: [0.0, 0.44, 0.36], elbowR: [-0.4, -1, 0], wristR: [-60, 0, 0], weapon: 1,
  },
  slashLowExt: {
    hip: [0, -0.42, 0.12], hipRot: [24, -18, 0], spine: [10, 10, 0], chest: [8, 20, 0], head: [-26, 14, 0],
    handR: [-0.16, -0.2, 0.42], elbowR: [-1, -0.5, 0], wristR: [60, 0, 0], weapon: 1,
    footL: [0.12, 0.05, 0.42], kneeL: [0.5, 0, 1], footR: [-0.2, 0.05, -0.22], kneeR: [-0.4, -0.6, 1],
  },
  sheathStance: {
    hip: [0, -0.3, 0], hipRot: [16, -40, 0], spine: [10, -4, 0], chest: [10, -6, 0], head: [-18, 50, 0],
    handR: [0.1, -0.12, 0.26], elbowR: [-0.6, -0.6, 0.2], wristR: [-20, 40, 0],
    handL: [0.17, -0.2, 0.12], elbowL: [1, -0.4, -0.4], weapon: 0,
    footL: [0.12, 0.05, 0.32], kneeL: [0.5, 0, 1], footR: [-0.2, 0.05, -0.26], kneeR: [-0.6, 0, 1],
  },
  quickDraw: {
    hip: [0, -0.32, 0.16], hipRot: [14, -10, 0], spine: [6, 14, 0], chest: [4, 34, 0], head: [-14, 0, 0],
    handR: [-0.28, 0.14, 0.52], elbowR: [-1, -0.5, 0], wristR: [-10, -90, 0], weapon: 1, twoHand: 0,
    handL: [0.2, -0.18, 0.06], elbowL: [1, -0.4, -0.4],
    footL: [0.1, 0.05, 0.5], kneeL: [0.4, 0, 1], footR: [-0.2, 0.05, -0.3], kneeR: [-0.4, -0.5, 1],
  },
  spinAttack: {
    hip: [0, -0.14, 0], hipRot: [4, 0, 0], chest: [0, 0, 0], head: [0, 0, 0],
    handL: [0.5, 0.15, 0.05], elbowL: [0, -1, -0.5], handR: [-0.5, 0.15, 0.05], elbowR: [0, -1, -0.5],
    footL: [0.18, 0.05, 0.05], footR: [-0.18, 0.05, -0.05], footLRot: [0, 0], footRRot: [0, 0],
  },
  stompExt: {
    hip: [0, -0.3, 0], hipRot: [6, -8, 0], chest: [-4, 0, 0], head: [-6, 10, 0],
    handL: [0.3, 0.0, 0.2], elbowL: [1, -0.4, 0], handR: [-0.3, 0.0, 0.2], elbowR: [-1, -0.4, 0], open: [1, 1],
    footL: [0.3, 0.05, 0.06], kneeL: [1, 0, 0.6], footLRot: [0, 30], footR: [-0.32, 0.05, 0.0], kneeR: [-1, 0, 0.6], footRRot: [0, -30],
  },
  bodySlam: {
    hip: [0, -0.18, 0.18], hipRot: [24, -60, 0], spine: [6, -10, 0], chest: [6, -10, 0], head: [-14, 66, 0],
    handL: [0.12, 0.12, 0.18], handR: [-0.08, 0.1, 0.12],
    footL: [0.1, 0.05, 0.38], kneeL: [0.5, 0, 1], footR: [-0.18, 0.08, -0.34], footRRot: [-30, -50],
  },
  grabReach: {
    hip: [0, -0.16, 0.08], hipRot: [16, -10, 0], spine: [10, 0, 0], chest: [8, 4, 0], head: [-14, 8, 0],
    handL: [0.28, 0.12, 0.48], elbowL: [1, -0.6, 0], handR: [-0.26, 0.12, 0.48], elbowR: [-1, -0.6, 0], open: [1, 1],
    footL: [0.12, 0.05, 0.36],
  },
  liftOverhead: {
    hip: [0, -0.16, 0], hipRot: [-4, -6, 0], spine: [-8, 0, 0], chest: [-14, 4, 0], head: [-24, 6, 0],
    handL: [0.16, 0.66, 0.12], elbowL: [1, 0, 0], handR: [-0.16, 0.66, 0.12], elbowR: [-1, 0, 0], open: [1, 1],
    footL: [0.22, 0.05, 0.08], kneeL: [0.6, 0, 1], footR: [-0.22, 0.05, -0.08], kneeR: [-0.6, 0, 1],
  },
  groundPound: {
    hip: [0, -0.46, 0.04], hipRot: [40, -6, 0], spine: [16, 0, 0], chest: [14, 0, 0], head: [-24, 6, 0],
    handL: [0.1, -0.5, 0.36], elbowL: [1, 0.2, 0], handR: [-0.1, -0.5, 0.36], elbowR: [-1, 0.2, 0],
    footL: [0.16, 0.05, 0.22], kneeL: [0.4, 0.2, 1], footR: [-0.18, 0.1, -0.3], kneeR: [-0.2, -1, 0.6], footRRot: [-50, -20],
  },
};

/** Per-character overrides (merged on top of the generic pose). */
const STYLE: Partial<Record<CharId, Partial<Record<PoseName | 'stance', PoseSpec>>>> = {
  goro: {
    stance: {
      hip: [0, -0.1, 0], hipRot: [6, -18, 0], chest: [6, -2, 0], head: [-4, 20, 0],
      handL: [0.2, 0.12, 0.34], elbowL: [0.8, -1, 0], handR: [-0.16, 0.1, 0.3], elbowR: [-0.8, -1, 0], open: [1, 1],
      footL: [0.17, 0.05, 0.16], kneeL: [0.6, 0, 1], footLRot: [0, 10], footR: [-0.21, 0.05, -0.16], kneeR: [-0.7, 0, 1], footRRot: [0, -35],
    },
    introPose: { handL: [0.16, -0.02, 0.24], handR: [-0.16, -0.02, 0.24], elbowL: [1, -1, 0], elbowR: [-1, -1, 0], open: [1, 1], chest: [6, 0, 0], head: [8, 6, 0] },
    win: { handL: [0.3, 0.2, 0.25], handR: [-0.3, 0.2, 0.25], open: [1, 1], chest: [-6, 0, 0], head: [-10, 0, 0] },
  },
  shiori: {
    stance: {
      hip: [0, -0.2, -0.02], hipRot: [12, -38, 0], spine: [10, -4, 0], chest: [6, -6, 0], head: [-10, 46, 0],
      handL: [0.18, 0.18, 0.34], elbowL: [0.6, -1, 0], wristL: [0, 0, 0], handR: [-0.1, 0.02, 0.06], elbowR: [-1, -0.4, -0.6],
      footL: [0.06, 0.05, 0.28], kneeL: [0.5, 0, 1], footR: [-0.2, 0.05, -0.24], kneeR: [-0.6, 0, 1], open: [1, 0],
    },
    crouch: { hip: [0, -0.48, -0.02], hipRot: [30, -36, 0], handL: [0.2, -0.3, 0.36], open: [1, 0] },
    introPose: { handL: [0.0, 0.22, 0.22], elbowL: [1, -0.6, 0], handR: [-0.05, 0.22, 0.24], open: [1, 1], wristL: [-60, 0, 0], wristR: [-60, 0, 0] },
    win: { handR: [-0.02, 0.24, 0.24], handL: [0.02, 0.22, 0.26], open: [1, 1], head: [-4, 10, 0] },
  },
  ren: {
    stance: {
      hip: [0, -0.1, 0], hipRot: [6, -34, 0], spine: [4, -4, 0], chest: [4, -6, 0], head: [0, 44, 0],
      handR: [0.1, -0.08, 0.22], elbowR: [-0.6, -0.8, 0.2], wristR: [-10, 40, 0],
      handL: [0.17, -0.2, 0.1], elbowL: [1, -0.4, -0.4], weapon: 0,
    },
    slashWind: { twoHand: 1 }, slashExt: { twoHand: 1 }, slashUpExt: { twoHand: 1 }, slashLowExt: { twoHand: 1 },
    introPose: { handR: [0.1, -0.1, 0.2], handL: [0.17, -0.2, 0.1], elbowL: [1, -0.4, -0.4], elbowR: [-0.6, -0.8, 0.2], head: [6, 14, 0] },
    win: { handR: [-0.1, 0.36, 0.36], elbowR: [-1, -0.5, 0], wristR: [-60, 0, 0], weapon: 1, handL: [0.17, -0.2, 0.1], twoHand: 0 },
  },
};

const STANCE_DERIVED = new Set<PoseName>([
  'idle', 'idle2', 'walk1', 'walk2', 'dash', 'backdash', 'sideStep', 'guardHigh', 'recover',
  'jabWind', 'jabExt', 'straightWind', 'straightExt', 'hookWind', 'hookExt', 'uppercutWind', 'uppercutExt', 'elbowExt', 'kneeExt',
  'lowKickWind', 'lowKickExt', 'midKickWind', 'midKickExt', 'highKickWind', 'highKickExt', 'roundhouseExt', 'axeKickUp', 'axeKickDown',
  'palmWind', 'palmExt', 'throwProjectile', 'slashWind', 'slashExt', 'slashUpExt', 'slashLowExt', 'hitHigh', 'hitMid', 'hitLow', 'stagger', 'throwGrab', 'grabReach', 'bodySlam',
]);

export type PoseTable = Record<PoseName, Float32Array>;
const tables = new Map<CharId, PoseTable>();

export function poseTable(id: CharId): PoseTable {
  const hit = tables.get(id);
  if (hit) return hit;
  const style = STYLE[id] ?? {};
  const stanceArr = new Float32Array(NCH);
  write(stanceArr, STANCE);
  if (style.stance) write(stanceArr, style.stance);
  const neutralArr = new Float32Array(NCH);
  write(neutralArr, STANCE);
  const t = {} as PoseTable;
  for (const name of POSES) {
    const a = new Float32Array(NCH);
    // derive from (character) stance for stance-based poses, generic stance otherwise
    a.set(STANCE_DERIVED.has(name) ? stanceArr : neutralArr);
    const spec = P[name];
    // keep character hand style (open hands etc.) for stance-derived poses unless the pose specifies
    if (spec) write(a, spec);
    const ov = style[name];
    if (ov) write(a, ov);
    t[name] = a;
  }
  // idle == character stance exactly (+ breathing variant)
  t.idle.set(stanceArr);
  const i2 = new Float32Array(stanceArr);
  i2[C.hipY] -= 0.015; i2[C.chP] += 4; i2[C.hL + 1] -= 0.025; i2[C.hR + 1] -= 0.025; i2[C.hdP] += 3;
  t.idle2 = i2;
  tables.set(id, t);
  return t;
}

/**
 * A pose outside the PoseName list (render-only: intros, win poses, idle stances, procedural clip keys):
 * starts from the character's own pose `base` (or stance) and overwrites the channels `spec` names.
 */
export function customPose(id: CharId, base: PoseName | 'stance', spec: PoseSpec, out: Float32Array = new Float32Array(NCH)): Float32Array {
  const T = poseTable(id);
  out.set(base === 'stance' ? T.idle : T[base]);
  write(out, spec);
  return out;
}

export function isPose(p: string): p is PoseName { return (POSES as readonly string[]).includes(p); }

export const STRIKE_POSES = new Set<PoseName>([
  'jabWind', 'jabExt', 'straightWind', 'straightExt', 'hookWind', 'hookExt', 'uppercutWind', 'uppercutExt', 'elbowExt', 'kneeExt',
  'lowKickWind', 'lowKickExt', 'midKickWind', 'midKickExt', 'highKickWind', 'highKickExt', 'roundhouseExt', 'sweepExt', 'axeKickUp', 'axeKickDown',
  'flyingKick', 'diveKick', 'palmWind', 'palmExt', 'beamCharge', 'beamFire', 'throwProjectile', 'slashWind', 'slashExt', 'slashUpExt', 'slashLowExt',
  'sheathStance', 'quickDraw', 'spinAttack', 'stompExt', 'bodySlam', 'grabReach', 'liftOverhead', 'groundPound', 'throwGrab', 'throwToss',
]);
export const PAIN_POSES = new Set<PoseName>(['hitHigh', 'hitMid', 'hitLow', 'stagger', 'launched', 'airHit', 'fallFlat', 'lieDown', 'wallSplat', 'thrown', 'lose']);
