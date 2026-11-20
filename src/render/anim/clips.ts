/**
 * Animation v2: procedural clips in pose-channel space (see poses.ts for the channel layout).
 *
 * A clip turns (time, fighter state) into a full channel vector that FighterView's IK maps onto any rig, so these
 * clips work on every model (originals, crossover mannequin, future drop-ins) without per-rig keyframes.
 * Two kinds:
 *   - KeyClip: keyframes (pose + easing per segment). Move clips are compiled from MoveDef.anim with real timing
 *     curves: anticipation (coil past the wind-up pose), a fast accelerating strike that lands on the first active
 *     frame, overshoot / follow-through past the extension, then an eased recovery that settles with a small overshoot.
 *   - Generators: locomotion cycles with foot plants driven by distance travelled, idle breathing / weight shift /
 *     bounce per character, hit and block reactions scaled by strength and height, juggle tumbling.
 *
 * Everything here is render-side: reads FighterState, never writes it. Clips are built once (per character / move)
 * and sampled without allocations.
 */
import type { CharId, FighterState, MoveDef, PoseName } from '../../sim/types';
import { C, NCH, poseTable, customPose, isPose, type PoseSpec, type PoseTable } from './poses';

// ------------------------------------------------------------------------------------------------ easing
export type Ease = 'lin' | 'in' | 'out' | 'io' | 'back' | 'snap' | 'step';

export function ease(e: Ease, u: number): number {
  switch (e) {
    case 'in': return u * u * u; // accelerate (the strike)
    case 'out': { const v = 1 - u; return 1 - v * v * v; } // decelerate (coil / slow-in)
    case 'io': return u < 0.5 ? 4 * u * u * u : 1 - 4 * (1 - u) * (1 - u) * (1 - u);
    case 'back': { const c1 = 1.25, c3 = c1 + 1, v = u - 1; return 1 + c3 * v * v * v + c1 * v * v; } // settle with ~6% overshoot
    case 'snap': { const v = 1 - u; return 1 - v * v * v * v * v; }
    case 'step': return u >= 1 ? 1 : 0;
    default: return u;
  }
}

const BINARY = [C.weapon, C.twoHand];

/** out = a + (b - a) * k for every channel (k may be > 1: extrapolate; binary channels take b) */
export function mixPose(out: Float32Array, a: Float32Array, b: Float32Array, k: number): Float32Array {
  for (let i = 0; i < NCH; i++) out[i] = a[i] + (b[i] - a[i]) * k;
  if (k < 0 || k > 1) for (let j = 0; j < BINARY.length; j++) { const i = BINARY[j]; out[i] = k > 1 ? b[i] : a[i]; }
  // never push a planted foot through the floor
  if (out[C.fL + 1] < 0.035) out[C.fL + 1] = 0.035;
  if (out[C.fR + 1] < 0.035) out[C.fR + 1] = 0.035;
  return out;
}

function noise(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

// ------------------------------------------------------------------------------------------------ clip interface
export interface AnimCtx {
  char: CharId;
  f: FighterState;
  T: PoseTable;
  prof: Profile;
  /** clip time in 60 Hz frames (continuous, interpolated between sim frames) */
  t: number;
  /** render seconds (free running) */
  time: number;
  /** locomotion cycle phase (cycles, signed, from distance travelled) */
  phase: number;
  /** lateral cycle phase (sidewalk) */
  latPhase: number;
  /** locomotion amplitude 0..1 (ramps in over the first steps) */
  ramp: number;
  /** + forward / - backward (walk direction) */
  dir: number;
  /** + toward the character's left / - right (sidestep direction) */
  lat: number;
  /** interpolated vertical velocity, mm/frame */
  vy: number;
  /** nominal length of the current state (hit / block stun) in frames */
  dur: number;
  /** strength of the last hit taken 0..1 (0.2 light .. 1 super) */
  strength: number;
  /** alternates per hit (spin / sway direction variety) */
  side: number;
}

export interface SampleOut { label: PoseName; strike: boolean }

export interface Clip {
  readonly name: string;
  /** length in frames (0 = open-ended) */
  readonly dur: number;
  /** crossfade-in length, frames (2..4) */
  readonly fade: number;
  /** keeps playing to its end when the state falls back to plain idle (landing, getting up, dash stops) */
  readonly settle?: boolean;
  sample(out: Float32Array, ctx: AnimCtx, so: SampleOut): void;
}

export interface Key { t: number; p: Float32Array; e: Ease; label: PoseName; hit?: boolean }

/** keyframed clip: per-segment easing toward the next key */
export class KeyClip implements Clip {
  /** extra yaw per frame (spinning moves) */
  spin = 0;
  settle = false;
  constructor(readonly name: string, readonly keys: Key[], readonly dur: number, readonly fade = 3, readonly loop = false) {}
  sample(out: Float32Array, ctx: AnimCtx, so: SampleOut): void {
    const keys = this.keys, n = keys.length;
    let t = ctx.t;
    if (this.loop && this.dur > 0) t = ((t % this.dur) + this.dur) % this.dur;
    if (n === 1 || t <= keys[0].t) { out.set(keys[0].p); so.label = keys[0].label; so.strike = !!keys[0].hit; }
    else {
      let done = false;
      for (let i = 0; i < n - 1; i++) {
        const a = keys[i], b = keys[i + 1];
        if (t < b.t) {
          const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
          mixPose(out, a.p, b.p, ease(b.e, u));
          so.label = u < 0.5 ? a.label : b.label;
          so.strike = !!(a.hit || b.hit);
          done = true;
          break;
        }
      }
      if (!done) { const z = keys[n - 1]; out.set(z.p); so.label = z.label; so.strike = !!z.hit; }
    }
    if (this.spin) out[C.rootYaw] += Math.max(0, ctx.t) * this.spin;
  }
}

class GenClip implements Clip {
  constructor(readonly name: string, readonly fade: number, readonly fn: (out: Float32Array, ctx: AnimCtx, so: SampleOut) => void,
    readonly dur = 0, readonly settle = false) {}
  sample(out: Float32Array, ctx: AnimCtx, so: SampleOut): void { this.fn(out, ctx, so); }
}

// ------------------------------------------------------------------------------------------------ pose roles
const STRIKE_EXT = new Set<PoseName>([
  'jabExt', 'straightExt', 'hookExt', 'uppercutExt', 'elbowExt', 'kneeExt', 'lowKickExt', 'midKickExt', 'highKickExt',
  'roundhouseExt', 'sweepExt', 'axeKickDown', 'flyingKick', 'diveKick', 'palmExt', 'beamFire', 'throwProjectile',
  'slashExt', 'slashUpExt', 'slashLowExt', 'quickDraw', 'stompExt', 'bodySlam', 'groundPound', 'throwToss', 'grabReach',
]);

/** is this anim key the strike (extension) of the move? */
export function isStrikePose(p: PoseName): boolean { return STRIKE_EXT.has(p); }

// ------------------------------------------------------------------------------------------------ move clips
const moveClips = new Map<CharId, WeakMap<MoveDef, KeyClip | null>>();

/**
 * Compile MoveDef.anim into a timed clip. Strike keys land where the data puts them (default: the first active
 * frame); the curve around them is what changes: coil → whip in → overshoot → hold → recover → settle.
 */
export function moveClip(char: CharId, mv: MoveDef): KeyClip | null {
  let m = moveClips.get(char);
  if (!m) { m = new WeakMap(); moveClips.set(char, m); }
  if (m.has(mv)) return m.get(mv)!;
  const clip = buildMoveClip(char, mv);
  m.set(mv, clip);
  return clip;
}

function buildMoveClip(char: CharId, mv: MoveDef): KeyClip | null {
  const anim = mv.anim;
  if (!anim || !anim.length) return null;
  const T = poseTable(char);
  const P = (n: PoseName): Float32Array => T[isPose(n) ? n : 'idle'];
  const total = Math.max(1, mv.startup + mv.active + mv.recovery);
  const big = mv.strength === 'heavy' || mv.strength === 'super' || mv.kind === 'special' || mv.kind === 'ultimate';
  const light = mv.strength === 'light' && mv.kind === 'normal';
  const antK = light ? 0.14 : big ? 0.3 : 0.22;
  const ovK = light ? 0.07 : big ? 0.16 : 0.11;
  const keys: Key[] = [];
  let spin = 0;
  for (let i = 0; i < anim.length; i++) {
    const [fr, name] = anim[i];
    if (name === 'spinAttack') spin = 26;
    const B = P(name);
    const prevName = i > 0 ? anim[i - 1][1] : null;
    const fa = i > 0 ? anim[i - 1][0] : 0;
    const nextT = i + 1 < anim.length ? anim[i + 1][0] : total;
    const strike = isStrikePose(name) && prevName !== null && prevName !== name;
    if (strike) {
      const A = P(prevName!);
      const span = fr - fa;
      // the display lags the sim by up to a frame (interpolation): land the strike a touch early so the limb is
      // extended for the whole first active frame
      const fs = span >= 4 ? fr - 0.75 : fr;
      if (span >= 3) {
        const ta = fa + (fs - fa) * (big ? 0.68 : 0.58);
        keys.push({ t: ta, p: mixPose(new Float32Array(NCH), B, A, 1 + antK), e: 'out', label: prevName! });
      }
      keys.push({ t: fs, p: B, e: span >= 3 ? 'in' : 'snap', label: name, hit: true });
      const room = nextT - fs;
      if (room >= 3) {
        const to = fs + Math.min(Math.max(1.5, Math.min(mv.active, 3)), room * 0.45);
        keys.push({ t: to, p: mixPose(new Float32Array(NCH), A, B, 1 + ovK), e: 'out', label: name, hit: true });
        if (nextT - to > 5) keys.push({ t: nextT - (light ? 2 : 4), p: B, e: 'io', label: name });
      }
      continue;
    }
    const last = i === anim.length - 1;
    const e: Ease = i === 0 ? 'out' : last && (name === 'idle' || name === 'recover') ? 'back' : 'io';
    if (keys.length && keys[keys.length - 1].t >= fr) keys[keys.length - 1] = { t: fr, p: B, e, label: name };
    else keys.push({ t: fr, p: B, e, label: name });
  }
  // a move that only reaches 'recover' still settles into the stance by its last frame
  const z = keys[keys.length - 1];
  if (z.label === 'recover' && z.t < total - 1) keys.push({ t: total, p: T.idle, e: 'back', label: 'idle' });
  const clip = new KeyClip(mv.id, keys, total, 2);
  clip.spin = spin;
  return clip;
}

// ------------------------------------------------------------------------------------------------ per-character profiles
export interface Profile {
  /** idle / walk base: the character stance with its idle-only offsets */
  stance: Float32Array;
  breathHz: number; breath: number;
  swayHz: number; sway: number;
  bounceHz: number; bounce: number;
  scan: number;
  /** walk cycle length (reference metres per full cycle) and swing-foot lift */
  stride: number; lift: number;
  /** springs up off the floor instead of a slow push-up */
  agile: boolean;
  /** heavier body: slower recoil, less spin */
  heavy: boolean;
  intro: KeyClip; win: KeyClip; lose: KeyClip;
}

interface ProfileSpec {
  stance?: PoseSpec;
  breathHz?: number; breath?: number; swayHz?: number; sway?: number; bounceHz?: number; bounce?: number; scan?: number;
  stride?: number; lift?: number; agile?: boolean; heavy?: boolean;
}

const SPECS: Partial<Record<CharId, ProfileSpec>> = {
  // boxer: light on the balls of the feet
  kaito: { bounceHz: 2.1, bounce: 0.022, breath: 1.6, sway: 0.006, stride: 1.05 },
  // low ninja crouch, scanning
  shiori: {
    stance: { hip: [0, -0.26, -0.02], hipRot: [16, -40, 0], spine: [12, -4, 0], footL: [0.08, 0.05, 0.3], kneeL: [0.6, 0, 1], footR: [-0.22, 0.05, -0.26], kneeR: [-0.7, 0, 1] },
    breath: 1.4, breathHz: 0.42, sway: 0.012, swayHz: 0.33, scan: 7, stride: 1.0, lift: 0.07, agile: true,
  },
  // iaido ready: still, deep slow breath
  ren: { breath: 1.2, breathHz: 0.24, sway: 0.003, swayHz: 0.2, stride: 0.95 },
  // wide sumo stance, heavy side-to-side weight shift
  goro: {
    stance: { hip: [0, -0.2, 0], hipRot: [10, -24, 0], spine: [6, 0, 0], footL: [0.27, 0.05, 0.2], kneeL: [0.9, 0, 0.8], footLRot: [0, 24], footR: [-0.3, 0.05, -0.2], kneeR: [-0.9, 0, 0.8], footRRot: [0, -40] },
    breath: 2.4, breathHz: 0.3, sway: 0.03, swayHz: 0.45, stride: 0.85, lift: 0.05, heavy: true,
  },
  // crossover pack: their own reads on the generic body
  gojo: {
    stance: { hip: [0, -0.03, 0], hipRot: [0, -18, 0], chest: [-3, -4, 0], head: [-6, 22, 0], handL: [0.2, -0.17, 0.02], elbowL: [1, -0.4, -0.6], handR: [-0.2, -0.17, 0.0], elbowR: [-1, -0.4, -0.6], footL: [0.1, 0.05, 0.12], kneeL: [0.2, 0, 1], footR: [-0.13, 0.05, -0.1], footRRot: [0, -25], open: [0.4, 0.4] },
    breath: 1.0, breathHz: 0.28, sway: 0.01, swayHz: 0.25, stride: 1.0,
  },
  naruto: {
    stance: { hip: [0, -0.2, 0.02], hipRot: [16, -30, 0], spine: [12, -4, 0], chest: [6, -6, 0], head: [-16, 36, 0], handL: [0.2, 0.06, 0.3], elbowL: [0.6, -1, 0], handR: [-0.12, 0.0, 0.14], elbowR: [-0.8, -0.6, -0.4], footL: [0.12, 0.05, 0.26], kneeL: [0.5, 0, 1], footR: [-0.22, 0.05, -0.24], kneeR: [-0.6, 0, 1], open: [0.2, 0] },
    bounceHz: 1.6, bounce: 0.012, breath: 1.5, sway: 0.008, agile: true,
  },
  zoro: {
    stance: { hip: [0, -0.16, 0], hipRot: [8, -30, 0], chest: [6, -6, 0], head: [-6, 36, 0], handL: [0.15, 0.12, 0.3], handR: [-0.08, 0.08, 0.18], footL: [0.16, 0.05, 0.27], kneeL: [0.5, 0, 1], footR: [-0.24, 0.05, -0.23], kneeR: [-0.6, 0, 1] },
    breath: 1.3, breathHz: 0.3, sway: 0.006, stride: 1.0,
  },
  luffy: {
    stance: { hip: [0, -0.1, 0], hipRot: [4, -20, 0], chest: [2, -4, 0], head: [-4, 26, 0], handL: [0.22, 0.04, 0.24], elbowL: [1, -0.6, 0], handR: [-0.18, 0.02, 0.16], elbowR: [-1, -0.6, 0], footL: [0.12, 0.05, 0.16], footR: [-0.17, 0.05, -0.14], open: [0.2, 0.2] },
    bounceHz: 2.6, bounce: 0.03, breath: 1.6, sway: 0.012, swayHz: 0.6, agile: true, lift: 0.1,
  },
  eren: {
    stance: { hip: [0, -0.12, 0], hipRot: [8, -32, 0], chest: [8, -6, 0], head: [-8, 38, 0], handL: [0.14, 0.27, 0.28], handR: [-0.04, 0.25, 0.18] },
    breath: 2.0, breathHz: 0.4, sway: 0.006, stride: 1.05,
  },
};

type SeqKey = [number, PoseName | 'stance' | (PoseSpec & { from?: PoseName | 'stance' }), Ease?];

function seq(char: CharId, name: string, list: SeqKey[], dur: number, prof: Profile, fade = 4): KeyClip {
  const T = poseTable(char);
  const keys: Key[] = list.map(([t, ref, e]) => {
    if (ref === 'stance') return { t, p: prof.stance, e: e ?? 'io', label: 'idle' as PoseName };
    if (typeof ref === 'string') return { t, p: T[ref], e: e ?? 'io', label: ref };
    const base = ref.from ?? 'stance';
    let p: Float32Array;
    if (base === 'stance') { p = new Float32Array(prof.stance); writeOver(p, customPose(char, 'idle', ref), ref); }
    else p = customPose(char, base, ref);
    return { t, p, e: e ?? 'io', label: (base === 'stance' ? 'idle' : base) as PoseName };
  });
  return new KeyClip(name, keys, dur, fade);
}

/** copy into `dst` only the channels a spec names (keeps the profile stance for the rest) */
function writeOver(dst: Float32Array, src: Float32Array, s: PoseSpec): void {
  const put = (i: number, n: number) => { for (let k = 0; k < n; k++) dst[i + k] = src[i + k]; };
  if (s.hip) put(C.hipX, 3); if (s.hipRot) put(C.hipP, 3); if (s.spine) put(C.spP, 3); if (s.chest) put(C.chP, 3); if (s.head) put(C.hdP, 3);
  if (s.handL) put(C.hL, 3); if (s.elbowL) put(C.eL, 3); if (s.wristL) put(C.wL, 3);
  if (s.handR) put(C.hR, 3); if (s.elbowR) put(C.eR, 3); if (s.wristR) put(C.wR, 3);
  if (s.footL) put(C.fL, 3); if (s.kneeL) put(C.kL, 3); if (s.footLRot) put(C.fLp, 2);
  if (s.footR) put(C.fR, 3); if (s.kneeR) put(C.kR, 3); if (s.footRRot) put(C.fRp, 2);
  if (s.open) put(C.openL, 2);
  if (s.rootYaw !== undefined) put(C.rootYaw, 1); if (s.rootPitch !== undefined) put(C.rootPitch, 1);
  if (s.weapon !== undefined) put(C.weapon, 1); if (s.twoHand !== undefined) put(C.twoHand, 1); if (s.lift !== undefined) put(C.lift, 1);
}

const profiles = new Map<CharId, Profile>();

export function profileOf(char: CharId): Profile {
  const hit = profiles.get(char);
  if (hit) return hit;
  const sp = SPECS[char] ?? {};
  const T = poseTable(char);
  const stance = new Float32Array(T.idle);
  if (sp.stance) { const tmp = customPose(char, 'stance', sp.stance); writeOver(stance, tmp, sp.stance); }
  const prof: Profile = {
    stance,
    breathHz: sp.breathHz ?? 0.35, breath: sp.breath ?? 1.5,
    swayHz: sp.swayHz ?? 0.3, sway: sp.sway ?? 0.006,
    bounceHz: sp.bounceHz ?? 0, bounce: sp.bounce ?? 0,
    scan: sp.scan ?? 0,
    stride: sp.stride ?? 1.0, lift: sp.lift ?? 0.08,
    agile: sp.agile ?? false, heavy: sp.heavy ?? false,
    intro: null as unknown as KeyClip, win: null as unknown as KeyClip, lose: null as unknown as KeyClip,
  };
  profiles.set(char, prof);
  buildShowClips(char, prof);
  return prof;
}

/** intros (90 f), win and lose poses per fighter */
function buildShowClips(char: CharId, P: Profile): void {
  const s = (list: SeqKey[], name: string, dur: number) => seq(char, name, list, dur, P);
  switch (char) {
    case 'kaito':
      P.intro = s([
        [0, 'introPose'],
        [18, { handL: [0.02, 0.2, 0.3], elbowL: [1, -0.6, 0], handR: [0.0, 0.22, 0.27], elbowR: [-1, -0.6, 0], open: [1, 0], chest: [6, 0, 0], head: [6, 6, 0], hipRot: [4, -10, 0] }, 'back'],
        [32, { handL: [0.02, 0.2, 0.31], elbowL: [1, -0.6, 0], handR: [0.0, 0.22, 0.28], elbowR: [-1, -0.6, 0], open: [1, 0], chest: [8, 0, 0], head: [8, 6, 0], hipRot: [4, -10, 0] }],
        [46, { handR: [-0.16, 0.44, 0.12], elbowR: [-1, -0.3, 0], handL: [0.14, 0.06, 0.22], chest: [-8, -6, 0], head: [-10, 10, 0], hipRot: [0, -20, 0] }, 'back'],
        [62, { handR: [-0.16, 0.46, 0.12], elbowR: [-1, -0.3, 0], handL: [0.14, 0.06, 0.22], chest: [-9, -6, 0], head: [-12, 10, 0], hipRot: [0, -20, 0] }],
        [78, 'stance'], [90, 'stance'],
      ], 'intro', 90);
      P.win = s([[0, 'recover'], [10, 'win', 'back'], [24, 'win']], 'win', 24);
      break;
    case 'shiori':
      P.intro = s([
        [0, { from: 'crouch', head: [30, 20, 0], handL: [0.1, -0.3, 0.3], open: [1, 1] }],
        [22, 'introPose', 'out'], [52, 'introPose'],
        [70, 'stance'], [90, 'stance'],
      ], 'intro', 90);
      P.win = s([[0, 'recover'], [14, 'win', 'back'], [40, 'win'], [60, { from: 'crouch', head: [-6, 50, 0], handL: [0.22, -0.3, 0.34], open: [1, 0] }]], 'win', 60);
      break;
    case 'ren':
      P.intro = s([
        [0, { from: 'introPose', head: [16, 10, 0] }],
        [26, 'sheathStance'],
        [38, 'quickDraw', 'in'],
        [48, 'quickDraw'],
        [62, 'sheathStance', 'io'],
        [78, 'stance'], [90, 'stance'],
      ], 'intro', 90);
      P.win = s([
        [0, 'slashExt'], [14, 'slashExt'],
        [24, { from: 'slashExt', handR: [-0.28, -0.08, 0.34], elbowR: [-1, -0.6, 0], wristR: [70, 0, 0], chest: [6, 10, 0] }, 'snap'],
        [40, 'sheathStance'], [58, { from: 'introPose', head: [4, 14, 0] }],
      ], 'win', 58);
      break;
    case 'goro': {
      const upR: PoseSpec & { from: PoseName } = { from: 'introPose', hip: [0.09, -0.12, 0], hipRot: [6, -6, -12], spine: [6, 0, 8], footR: [-0.42, 0.62, 0.02], kneeR: [-1, 0.4, 0.2], footRRot: [10, -20], handL: [0.24, -0.32, 0.22], handR: [-0.28, -0.04, 0.24], open: [1, 1], rootYaw: 75 };
      const upL: PoseSpec & { from: PoseName } = { from: 'introPose', hip: [-0.09, -0.12, 0], hipRot: [6, -6, 12], spine: [6, 0, -8], footL: [0.42, 0.62, 0.02], kneeL: [1, 0.4, 0.2], footLRot: [10, 20], handL: [0.28, -0.04, 0.24], handR: [-0.24, -0.32, 0.22], open: [1, 1], rootYaw: 75 };
      const sumo: PoseSpec & { from: PoseName } = { from: 'stompExt', rootYaw: 75 };
      P.intro = s([
        // shiko, turned side-on so the leg raise reads from the side camera
        [0, 'introPose'], [16, upR, 'out'], [25, sumo, 'in'], [36, sumo],
        [48, upL, 'out'], [57, sumo, 'in'], [68, sumo],
        [82, 'stance'], [90, 'stance'],
      ], 'intro', 90);
      P.win = s([[0, 'stompExt'], [12, 'win', 'back'], [30, 'win']], 'win', 30);
      break;
    }
    default:
      // crossover / future fighters: gather Ki, flex, drop into the stance
      P.intro = s([
        [0, 'introPose'], [26, 'introPose'], [40, 'kiCharge', 'io'],
        [52, { from: 'awakenPose', chest: [-10, 0, 0] }, 'back'], [64, { from: 'awakenPose', chest: [-12, 0, 0] }],
        [80, 'stance'], [90, 'stance'],
      ], 'intro', 90);
      P.win = s([[0, 'recover'], [12, 'win', 'back'], [24, 'win']], 'win', 24);
  }
  P.lose = s([[0, 'stagger'], [10, 'stagger'], [26, 'lose', 'io'], [40, 'lose']], 'lose', 40);
}

// ------------------------------------------------------------------------------------------------ helpers
const TAU = Math.PI * 2;
const _a = new Float32Array(NCH), _b = new Float32Array(NCH);

function breathe(out: Float32Array, ctx: AnimCtx, scale: number): void {
  const P = ctx.prof;
  const br = Math.sin(ctx.time * TAU * P.breathHz);
  out[C.chP] += br * P.breath * scale;
  out[C.hdP] -= br * P.breath * 0.35 * scale;
  out[C.hL + 1] += br * 0.006 * scale; out[C.hR + 1] += br * 0.006 * scale;
}

/** one foot of a shuffle cycle: u in [0,1): plant (0..0.5, slides back with the body) then swing (lifted) */
function footCycle(u: number, A: number, o: { z: number; lift: number }): { z: number; lift: number } {
  if (u < 0.5) { o.z = A * (1 - 4 * u); o.lift = 0; }
  else { const s = (u - 0.5) * 2; const k = s * s * (3 - 2 * s); o.z = -A + 2 * A * k; o.lift = Math.sin(Math.PI * s); }
  return o;
}
const _fl = { z: 0, lift: 0 }, _fr = { z: 0, lift: 0 };
const frac = (x: number) => x - Math.floor(x);

// ------------------------------------------------------------------------------------------------ state clips
function idleFn(out: Float32Array, ctx: AnimCtx, so: SampleOut): void {
  const P = ctx.prof, t = ctx.time;
  out.set(P.stance);
  // weight shift (hips sway over the feet, shoulders counter)
  const sw = Math.sin(t * TAU * P.swayHz);
  out[C.hipX] += sw * P.sway;
  out[C.hipR] += sw * P.sway * 160;
  out[C.spR] -= sw * P.sway * 90;
  out[C.hdR] -= sw * P.sway * 60;
  breathe(out, ctx, 1);
  if (P.bounce > 0) {
    // boxer bounce: sharp contact at the bottom, heels up at the top
    const b = Math.abs(Math.sin(t * Math.PI * P.bounceHz));
    out[C.hipY] += (b - 0.35) * P.bounce;
    const heel = Math.max(0, b - 0.25) * P.bounce;
    out[C.fL + 1] += heel * 0.9; out[C.fR + 1] += heel * 0.9;
    out[C.fLp] += b * 10; out[C.fRp] += b * 10;
    out[C.hL + 1] += b * P.bounce * 0.5; out[C.hR + 1] += b * P.bounce * 0.5;
  }
  if (P.scan) out[C.hdY] += Math.sin(t * TAU * 0.13) * P.scan + Math.sin(t * TAU * 0.31) * P.scan * 0.4;
  so.label = 'idle'; so.strike = false;
}

function walkFn(out: Float32Array, ctx: AnimCtx, so: SampleOut): void {
  const P = ctx.prof, ph = ctx.phase, r = ctx.ramp;
  out.set(P.stance);
  const A = (P.stride / 4) * r;
  const L = footCycle(frac(ph), A, _fl);
  out[C.fL + 2] += L.z; out[C.fL + 1] += L.lift * P.lift * r; out[C.fLp] += L.lift * 18 * r;
  const R = footCycle(frac(ph + 0.5), A, _fr);
  out[C.fR + 2] += R.z; out[C.fR + 1] += R.lift * P.lift * r; out[C.fRp] += R.lift * 18 * r;
  const c2 = Math.cos(ph * TAU * 2), s1 = Math.sin(ph * TAU);
  out[C.hipY] -= (0.5 + 0.5 * c2) * 0.016 * r;
  out[C.hipR] += s1 * 3 * r;
  out[C.chY] += s1 * 4 * r;
  out[C.hL + 1] += c2 * 0.008 * r; out[C.hR + 1] += c2 * 0.008 * r;
  // lean into the direction of travel
  out[C.spP] += ctx.dir * 3 * r; out[C.hdP] -= ctx.dir * 2 * r;
  breathe(out, ctx, 0.5);
  so.label = frac(ph) < 0.5 ? 'walk1' : 'walk2'; so.strike = false;
}

function sideWalkFn(out: Float32Array, ctx: AnimCtx, so: SampleOut): void {
  const P = ctx.prof, ph = ctx.latPhase, r = ctx.ramp;
  out.set(P.stance);
  const A = 0.14 * r;
  const L = footCycle(frac(ph), A, _fl), R = footCycle(frac(ph + 0.5), A, _fr);
  out[C.fL] += L.z; out[C.fL + 1] += L.lift * P.lift * r;
  out[C.fR] += R.z; out[C.fR + 1] += R.lift * P.lift * r;
  out[C.hipY] -= (0.5 + 0.5 * Math.cos(ph * TAU * 2)) * 0.012 * r;
  out[C.hipR] += -ctx.lat * 4 * r; out[C.spR] += -ctx.lat * 3 * r;
  breathe(out, ctx, 0.5);
  so.label = 'sideStep'; so.strike = false;
}

function runFn(out: Float32Array, ctx: AnimCtx, so: SampleOut): void {
  const P = ctx.prof, T = ctx.T, ph = ctx.phase, r = Math.max(0.35, ctx.ramp);
  mixPose(out, P.stance, T.dash, 0.85);
  const A = (P.stride * 1.6 / 4) * r;
  const L = footCycle(frac(ph), A, _fl), R = footCycle(frac(ph + 0.5), A, _fr);
  out[C.fL] = P.stance[C.fL] * 0.6; out[C.fR] = P.stance[C.fR] * 0.6;
  out[C.fL + 2] = 0.04 + L.z; out[C.fL + 1] = 0.05 + L.lift * 0.2 * r; out[C.fLp] = L.lift * 35 - 10;
  out[C.fR + 2] = -0.04 + R.z; out[C.fR + 1] = 0.05 + R.lift * 0.2 * r; out[C.fRp] = R.lift * 35 - 10;
  const s1 = Math.sin(ph * TAU);
  out[C.hL + 2] += -s1 * 0.1 * r; out[C.hR + 2] += s1 * 0.1 * r;
  out[C.chY] += s1 * 8 * r; out[C.hipYaw] -= s1 * 6 * r;
  out[C.hipY] -= (0.5 + 0.5 * Math.cos(ph * TAU * 2)) * 0.03 * r;
  so.label = 'dash'; so.strike = false;
}

function jumpFn(out: Float32Array, ctx: AnimCtx, so: SampleOut): void {
  const f = ctx.f, T = ctx.T;
  if (!f.airborne && f.pose === 'crouch') { mixPose(out, ctx.prof.stance, T.crouch, Math.min(1, (ctx.t + 1) / 3) * 0.8); so.label = 'crouch'; so.strike = false; return; }
  const k = Math.min(1, Math.max(0, 0.5 - ctx.vy / 50));
  mixPose(out, T.jumpUp, T.jumpFall, k);
  const apex = Math.max(0, 1 - Math.abs(ctx.vy) / 30);
  out[C.fL + 1] += apex * 0.1; out[C.fR + 1] += apex * 0.08; out[C.hipP] -= apex * 6;
  so.label = k < 0.5 ? 'jumpUp' : 'jumpFall'; so.strike = false;
}

function holdFn(name: PoseName, breath: number) {
  return (out: Float32Array, ctx: AnimCtx, so: SampleOut): void => {
    out.set(ctx.T[name]);
    breathe(out, ctx, breath);
    so.label = name; so.strike = false;
  };
}

/** hit reaction: impact overshoot → hit pose → recoil back, head snap (high), body fold (mid), knee buckle (low), spin (heavy) */
function hitFn(out: Float32Array, ctx: AnimCtx, so: SampleOut): void {
  const f = ctx.f, P = ctx.prof, t = Math.max(0, ctx.t), D = Math.max(6, ctx.dur);
  const pose: PoseName = f.pose === 'hitHigh' || f.pose === 'hitMid' || f.pose === 'hitLow' || f.pose === 'stagger' ? f.pose : 'hitMid';
  const H = ctx.T[pose];
  const s = ctx.strength * (P.heavy ? 0.75 : 1);
  if (pose === 'stagger') {
    mixPose(out, P.stance, H, Math.min(1, 0.4 + t / 4));
    out[C.hipX] += Math.sin(t * 0.12) * 0.05;
    out[C.spR] += Math.sin(t * 0.12) * 8;
    out[C.hdR] += Math.sin(t * 0.1 + 1) * 10;
    out[C.hipY] -= Math.abs(Math.sin(t * 0.12)) * 0.03;
    so.label = 'stagger'; so.strike = false;
    return;
  }
  // amount of the hit pose: overshoots on impact, holds, recovers over the last ~40% of the stun
  const peak = 0.75 + s * 0.6;
  let k: number;
  if (t < 2) k = peak;
  else if (t < D * 0.55) k = peak + (1 - peak) * ease('out', (t - 2) / Math.max(1, D * 0.55 - 2));
  else k = 1 - 0.75 * ease('io', Math.min(1, (t - D * 0.55) / (D * 0.45)));
  mixPose(out, P.stance, H, k);
  const e1 = Math.exp(-t / 4), e2 = Math.exp(-t / 7);
  if (pose === 'hitHigh') {
    out[C.hdP] -= (12 + 22 * s) * e1 * Math.cos(t * 0.55);
    out[C.hdY] += ctx.side * 14 * s * e2;
    out[C.chP] -= 6 * s * e2;
  } else if (pose === 'hitMid') {
    out[C.spP] += 16 * s * e2; out[C.chP] += 10 * s * e2;
    out[C.hipZ] -= 0.06 * s * e2; out[C.hdP] += 10 * s * e1;
  } else {
    out[C.hipY] -= 0.06 * s * e2;
    out[C.fL + 1] += 0.08 * s * e1; out[C.hdP] += 8 * s * e1;
  }
  if (s > 0.6) {
    // heavy: the hit twists the whole body around and back
    const u = Math.min(1, t / (D * 0.7));
    out[C.rootYaw] += ctx.side * (40 + 50 * (s - 0.6)) * Math.sin(Math.PI * u) * (1 - 0.3 * u);
  }
  so.label = pose; so.strike = false;
}

/** block flinch: pushed back into the guard, chin tucked, arms squeezed */
function blockFn(out: Float32Array, ctx: AnimCtx, so: SampleOut): void {
  const f = ctx.f, t = Math.max(0, ctx.t);
  const pose: PoseName = f.pose === 'guardLow' ? 'guardLow' : 'guardHigh';
  out.set(ctx.T[pose]);
  const e = Math.exp(-t / 3.5) * (0.6 + ctx.strength * 0.8);
  out[C.chP] -= 9 * e; out[C.spP] -= 4 * e; out[C.hipZ] -= 0.05 * e; out[C.hipY] -= 0.02 * e;
  out[C.hdP] += 6 * e;
  out[C.hL + 2] -= 0.05 * e; out[C.hR + 2] -= 0.05 * e; out[C.hL] -= 0.02 * e; out[C.hR] += 0.02 * e;
  out[C.fL + 2] -= 0.03 * e;
  so.label = pose; so.strike = false;
}

function juggleFn(out: Float32Array, ctx: AnimCtx, so: SampleOut): void {
  const f = ctx.f, T = ctx.T, vy = ctx.vy;
  const k = Math.min(1, Math.max(0, 0.5 - vy / 50));
  mixPose(out, T.launched, T.fallFlat, k);
  if (f.pose === 'airHit') {
    const w = Math.max(0, 1 - ctx.t / 6);
    mixPose(_a, out, T.airHit, w);
    out.set(_a);
  }
  // limbs trail the tumble
  const tt = ctx.time;
  out[C.hL + 1] += Math.sin(tt * 9) * 0.04; out[C.hR + 1] += Math.sin(tt * 9 + 1.7) * 0.04;
  out[C.fL + 1] += Math.sin(tt * 7 + 0.5) * 0.05; out[C.fR + 1] += Math.sin(tt * 7 + 2.3) * 0.05;
  out[C.rootPitch] += Math.max(-85, -20 - Math.max(0, -vy) * 1.1);
  so.label = f.pose === 'airHit' && ctx.t < 6 ? 'airHit' : vy > 0 ? 'launched' : 'fallFlat'; so.strike = false;
}

function thrownFn(out: Float32Array, ctx: AnimCtx, so: SampleOut): void {
  out.set(ctx.T.thrown);
  const tt = ctx.time;
  out[C.hL + 1] += Math.sin(tt * 11) * 0.05; out[C.hR + 1] += Math.sin(tt * 11 + 2) * 0.05;
  out[C.rootPitch] += Math.max(-85, -20 - Math.max(0, -ctx.vy) * 1.1);
  so.label = 'thrown'; so.strike = false;
}

function kiFn(out: Float32Array, ctx: AnimCtx, so: SampleOut): void {
  const t = Math.max(0, ctx.t);
  mixPose(out, ctx.prof.stance, ctx.T.kiCharge, Math.min(1, (t + 1) / 6));
  const amp = Math.min(1, t / 40);
  out[C.hipX] += noise(Math.floor(ctx.time * 60)) * 0.006 * (0.4 + amp);
  out[C.chP] += Math.sin(ctx.time * 3.2) * 3 * (0.5 + amp);
  out[C.hdP] -= Math.sin(ctx.time * 3.2) * 2;
  so.label = 'kiCharge'; so.strike = false;
}

function clashFn(out: Float32Array, ctx: AnimCtx, so: SampleOut): void {
  out.set(ctx.T.beamFire);
  const n = noise(Math.floor(ctx.time * 60));
  out[C.hipX] += n * 0.008; out[C.chY] += n * 2; out[C.hipZ] += Math.sin(ctx.time * 5) * 0.02;
  so.label = 'beamFire'; so.strike = true;
}

/** fallback: show the sim's named pose (dev pose viewer, unknown states) */
function poseFn(out: Float32Array, ctx: AnimCtx, so: SampleOut): void {
  const p = isPose(ctx.f.pose) ? ctx.f.pose : 'idle';
  out.set(ctx.T[p]);
  so.label = p; so.strike = false;
}

function landFn(out: Float32Array, ctx: AnimCtx, so: SampleOut): void {
  const t = Math.max(0, ctx.t), P = ctx.prof, T = ctx.T;
  // impact squash then rise, settling with a little overshoot
  const k = t < 2 ? 1.1 : 1.1 - 1.1 * ease('back', Math.min(1, (t - 2) / 9));
  mixPose(out, P.stance, T.land, k);
  so.label = t < 4 ? 'land' : 'idle'; so.strike = false;
}

// ------------------------------------------------------------------------------------------------ library
export interface ClipLib {
  prof: Profile;
  idle: Clip; walk: Clip; side: Clip; run: Clip; jump: Clip; land: Clip; backdash: Clip; sidestep: Clip; vanish: Clip;
  crouch: Clip; guardHigh: Clip; guardLow: Clip; block: Clip; hit: Clip; juggle: Clip; knockdown: Clip; getup: Clip;
  wallsplat: Clip; thrown: Clip; ki: Clip; awaken: Clip; clash: Clip; pose: Clip;
  intro: Clip; win: Clip; lose: Clip;
}

const libs = new Map<CharId, ClipLib>();

export function clipLib(char: CharId): ClipLib {
  const hit = libs.get(char);
  if (hit) return hit;
  const P = profileOf(char);
  const T = poseTable(char);
  const s = (list: SeqKey[], name: string, dur: number, fade = 3) => seq(char, name, list, dur, P, fade);
  const kd = s([
    [0, 'fallFlat'], [4, 'lieDown', 'in'],
    [7, { from: 'lieDown', lift: 0.07, hipRot: [-78, 0, 0], head: [-16, 18, 0] }, 'out'],
    [11, 'lieDown', 'in'], [16, { from: 'lieDown', head: [-2, 22, 0] }], [40, 'lieDown'],
  ], 'knockdown', 40, 2);
  const getup = P.agile
    ? s([
      [0, 'lieDown'],
      [5, { from: 'lieDown', footL: [0.12, 0.5, 0.24], kneeL: [0, 1, 0], footR: [-0.12, 0.46, 0.2], kneeR: [0, 1, 0], handL: [0.24, 0.3, -0.1], handR: [-0.24, 0.3, -0.1], rootPitch: -14 }, 'out'],
      [10, 'land', 'snap'], [16, 'recover'], [22, 'stance', 'back'],
    ], 'getup', 22, 2)
    : s([[0, 'lieDown'], [8, 'getUp', 'out'], [15, 'recover', 'io'], [22, 'stance', 'back']], 'getup', 22, 2);
  getup.settle = true;
  const backdash = s([[0, { from: 'crouch', hipRot: [10, -30, 0] }, 'snap'], [3, 'backdash', 'out'], [13, 'backdash'], [17, 'land', 'in'], [26, 'stance', 'back']], 'backdash', 26, 2);
  backdash.settle = true;
  const sidestep = new GenClip('sidestep', 2, (out, ctx, so) => {
    const t = Math.max(0, ctx.t);
    const k = t < 3 ? ease('out', t / 3) : t < 13 ? 1 : 1 - ease('io', Math.min(1, (t - 13) / 7));
    mixPose(out, P.stance, T.sideStep, k);
    const sg = ctx.lat >= 0 ? 1 : -1;
    out[C.hipR] = P.stance[C.hipR] + (out[C.hipR] - P.stance[C.hipR]) * -sg;
    out[C.spR] = P.stance[C.spR] + (out[C.spR] - P.stance[C.spR]) * -sg;
    out[C.hdR] = P.stance[C.hdR] + (out[C.hdR] - P.stance[C.hdR]) * -sg;
    out[C.hipY] -= Math.sin(Math.min(1, t / 16) * Math.PI) * 0.04;
    so.label = 'sideStep'; so.strike = false;
  }, 20, true);
  const vanish = s([[0, 'vanish', 'snap'], [10, 'vanish'], [18, 'stance', 'back']], 'vanish', 18, 2);
  vanish.settle = true;
  const awaken = s([
    [0, 'stance'], [12, 'kiCharge', 'out'], [19, { from: 'kiCharge', hip: [0, -0.32, 0], chest: [10, 0, 0], head: [12, 0, 0] }, 'io'],
    [23, 'awakenPose', 'snap'], [31, { from: 'awakenPose', chest: [-22, 0, 0], head: [-26, 4, 0] }], [44, 'awakenPose'], [50, 'stance', 'back'],
  ], 'awaken', 50, 3);
  const wallsplat = s([[0, { from: 'wallSplat', chest: [-18, -4, 0], head: [-30, 14, 10] }, 'snap'], [5, 'wallSplat', 'out'], [45, { from: 'wallSplat', hip: [0, -0.16, -0.08] }, 'io']], 'wallsplat', 45, 2);
  const lib: ClipLib = {
    prof: P,
    idle: new GenClip('idle', 4, idleFn),
    walk: new GenClip('walk', 4, walkFn),
    side: new GenClip('walk_side', 4, sideWalkFn),
    run: new GenClip('run', 3, runFn),
    jump: new GenClip('jump', 3, jumpFn),
    land: new GenClip('land', 2, landFn, 11, true),
    backdash, sidestep, vanish,
    crouch: new GenClip('crouch', 3, holdFn('crouch', 0.6)),
    guardHigh: new GenClip('guard_high', 3, holdFn('guardHigh', 0.4)),
    guardLow: new GenClip('guard_low', 3, holdFn('guardLow', 0.4)),
    block: new GenClip('block', 2, blockFn),
    hit: new GenClip('hit', 2, hitFn),
    juggle: new GenClip('juggle', 3, juggleFn),
    knockdown: kd, getup,
    wallsplat,
    thrown: new GenClip('thrown', 2, thrownFn),
    ki: new GenClip('ki_charge', 4, kiFn),
    awaken,
    clash: new GenClip('clash', 3, clashFn),
    pose: new GenClip('pose', 3, poseFn),
    intro: P.intro, win: P.win, lose: P.lose,
  };
  void _b;
  libs.set(char, lib);
  return lib;
}
