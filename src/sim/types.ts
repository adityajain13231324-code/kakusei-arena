/**
 * KAKUSEI ARENA — SHARED CONTRACTS
 * ------------------------------------------------------------------
 * Every module (sim, render, vfx, audio, ui, ai, net) codes against
 * this file. Change it only with care: other modules depend on it.
 *
 * UNITS (sim):
 *   - Distance: integer millimetres (1000 = 1 metre). Y is up. Arena floor is y = 0.
 *   - Time: integer frames at 60 Hz.
 *   - Speeds: mm per frame.
 *   - Direction vectors: integers scaled by 1000 (so (1000,0) = unit +X).
 *   - Meter values: integers.
 * The sim MUST be deterministic: no Math.random, no Date, no Math.sin/cos/atan2/sqrt
 * on gameplay-critical paths (use integer helpers in src/core/fixed.ts). State must
 * be plain JSON-serialisable data (no class instances, no Maps, no functions).
 */

export const TICK_RATE = 60;
export const MM = 1000; // 1 metre

// ---------------------------------------------------------------- input
/** Raw per-frame input bits. Directions are SCREEN-RELATIVE (as the player sees it). */
export const Btn = {
  Up: 1 << 0, // into the screen  (sidestep / sidewalk "up")
  Down: 1 << 1, // out of screen / crouch
  Left: 1 << 2,
  Right: 1 << 3,
  L: 1 << 4, // 1 – Light
  H: 1 << 5, // 2 – Heavy
  K: 1 << 6, // 3 – Kick
  S: 1 << 7, // 4 – Ki / Special
  Guard: 1 << 8, // optional dedicated guard
  Ult: 1 << 9, // Easy-mode Ultimate shortcut
  Start: 1 << 10,
} as const;
export type InputBits = number;

/**
 * Sim-side controls. "Up"/"Down" mean sidestep axis (Up = into screen) AND jump/crouch:
 *   - tap Up = sidestep in, hold Up = sidewalk in; Up+Forward = jump forward, Up+Back = jump back.
 *     (Tekken style: neutral jump is Up held while already sidewalking is avoided — the sim agent
 *      decides exact rules and documents them in docs/CONTROLS.md)
 *   - Down = crouch (tap Down = sidestep out). Down held = crouch.
 * Forward/back are derived from facing and screen side by the sim.
 */
export type ControlScheme = 'pro' | 'easy';

// ---------------------------------------------------------------- ids
export type CharId = 'kaito' | 'shiori' | 'ren' | 'goro';
export const ALL_CHARS: CharId[] = ['kaito', 'shiori', 'ren', 'goro'];
export type StageId = 'rooftop' | 'shrine' | 'training';
export const ALL_STAGES: StageId[] = ['rooftop', 'shrine', 'training'];

export type Element = 'none' | 'fire' | 'shadow' | 'blade' | 'earth' | 'ki';
export type Height = 'high' | 'mid' | 'low' | 'throw' | 'unblockable';
export type Tracking = 'none' | 'left' | 'right' | 'full';
export type Strength = 'light' | 'medium' | 'heavy' | 'super';

// ---------------------------------------------------------------- poses (shared vocabulary for animation)
/**
 * Named poses. Move data references these by frame; the renderer implements each
 * pose for every character (procedural humanoid rig). Renderer interpolates between
 * keyframes, stepped to ~24 poses/sec for the anime "limited animation" feel.
 */
export const POSES = [
  // locomotion & states
  'idle', 'idle2', 'walk1', 'walk2', 'crouch', 'jumpUp', 'jumpFall', 'land',
  'dash', 'backdash', 'sideStep', 'guardHigh', 'guardLow',
  'hitHigh', 'hitMid', 'hitLow', 'stagger', 'launched', 'airHit', 'fallFlat', 'lieDown', 'getUp',
  'wallSplat', 'throwGrab', 'throwToss', 'thrown', 'kiCharge', 'vanish', 'awakenPose',
  'introPose', 'win', 'lose', 'recover',
  // strikes
  'jabWind', 'jabExt', 'straightWind', 'straightExt', 'hookWind', 'hookExt',
  'uppercutWind', 'uppercutExt', 'elbowExt', 'kneeExt',
  'lowKickWind', 'lowKickExt', 'midKickWind', 'midKickExt', 'highKickWind', 'highKickExt',
  'roundhouseExt', 'sweepExt', 'axeKickUp', 'axeKickDown', 'flyingKick', 'diveKick',
  'palmWind', 'palmExt', 'beamCharge', 'beamFire', 'throwProjectile',
  'slashWind', 'slashExt', 'slashUpExt', 'slashLowExt', 'sheathStance', 'quickDraw',
  'spinAttack', 'stompExt', 'bodySlam', 'grabReach', 'liftOverhead', 'groundPound',
] as const;
export type PoseName = (typeof POSES)[number];

// ---------------------------------------------------------------- character & move data
/** Capsule hitbox in the attacker's LOCAL space (x = forward, y = up, z = right), mm. */
export interface HitboxDef {
  from: number; // first active frame (1-based, relative to move start)
  to: number; // last active frame (inclusive)
  x: number; // start point forward offset
  y: number; // height
  z?: number;
  len: number; // capsule length along forward axis (0 = sphere)
  r: number; // radius
}

export type OnHitEffect =
  | 'normal' | 'launch' | 'knockdown' | 'wallbounce' | 'groundbounce' | 'stagger' | 'crumple' | 'throw';

export interface ProjectileDef {
  kind: string; // e.g. 'fireball', 'kunai', 'crescent', 'boulder', 'beam'
  spawnFrame: number;
  x: number; y: number; // spawn offset (local)
  speed: number; // mm/frame forward
  life: number; // frames
  r: number; // radius mm
  hits: number; // how many hits before vanishing
  beam?: boolean; // beams can CLASH with beams
  count?: number; spread?: number; // fan of projectiles, spread in 1/1000 of lateral per forward
}

export interface MoveDef {
  id: string; // unique within character, e.g. 'kaito_blaze_knuckle'
  name: string; // display name
  kind: 'normal' | 'special' | 'ki' | 'ultimate' | 'throw' | 'universal';
  /**
   * Input notation (numpad, relative to facing; 6 = forward, 4 = back, 2 = down, 8 = up(side-in)):
   *   '1' 'H' etc not used — buttons are L H K S. Examples:
   *   'L', 'L,L', 'H', 'K', '2K', '6H', '3H', '236S', '623S', '214S', 'L+K' (throw), 'H+K' (vanish), 'L+H+K' (awaken).
   * easyInput is the Easy-scheme alternative (e.g. '6S', '4S', '2S', 'Ult').
   */
  input: string;
  easyInput?: string;
  requires?: 'grounded' | 'air' | 'crouch' | 'awakened' | 'stance';
  startup: number; // frames before first active frame
  active: number;
  recovery: number;
  damage: number; // HP damage (HP is ~1000)
  chip?: number;
  height: Height;
  tracking?: Tracking;
  strength: Strength;
  element?: Element;
  hitstun: number;
  blockstun: number;
  hitstop?: number;
  pushback?: number; // mm
  onHit?: OnHitEffect;
  onCounterHit?: OnHitEffect;
  launchVel?: number; // mm/frame upward for launch effects
  kiCost?: number; // 0..300 (100 per bar)
  kiGain?: number;
  cancelInto?: string[]; // move ids or 'special' | 'ki' | 'ultimate'
  cancelWindow?: [number, number];
  /** forward / up velocity keyframes [frame, forwardMmPerFrame, upMmPerFrame] */
  movement?: Array<[number, number, number]>;
  invuln?: [number, number]; // frames fully invincible
  armor?: [number, number]; // frames with 1-hit armor
  hitboxes: HitboxDef[];
  projectile?: ProjectileDef;
  /** pose keyframes: [frame, pose]. frame 0 = first frame of move. */
  anim: Array<[number, PoseName]>;
  /** cinematic flag for ultimates/awakening: renderer runs a scripted camera */
  cinematic?: 'ultimate' | 'awaken' | 'throw';
  fx?: string; // vfx preset hint on active frames, e.g. 'fire_swipe'
}

export interface CharDef {
  id: CharId;
  name: string; // "KAITO HOMURA"
  title: string; // "The Hot-Blooded Hero"
  maxHp: number; // ~1000
  walkSpeed: number; // mm/frame (≈ 40–60)
  backWalkSpeed: number;
  dashSpeed: number;
  sidestepSpeed: number;
  jumpVel: number;
  weight: number; // 100 = normal; affects juggle gravity
  height: number; // standing hurtbox height mm (≈ 1700)
  radius: number; // body radius mm (≈ 300)
  palette: { primary: string; secondary: string; accent: string; hair: string; skin: string; aura: string };
  moves: MoveDef[];
  ultimateId: string;
  awakenedUltimateId?: string;
}

// ---------------------------------------------------------------- runtime state
export interface Vec3 { x: number; y: number; z: number }

export type FighterMode =
  | 'idle' | 'walk' | 'crouch' | 'jump' | 'dash' | 'backdash' | 'sidestep' | 'sidewalk'
  | 'guard' | 'attack' | 'hitstun' | 'blockstun' | 'juggle' | 'knockdown' | 'wakeup'
  | 'wallsplat' | 'thrown' | 'kicharge' | 'vanish' | 'awaken' | 'intro' | 'win' | 'lose' | 'clash';

export interface FighterState {
  char: CharId;
  pos: Vec3; // mm
  vel: Vec3; // mm/frame
  facing: { x: number; z: number }; // unit vector * 1000, points toward opponent
  mode: FighterMode;
  modeFrame: number; // frames since mode began
  moveId: string | null; // active move (mode === 'attack' etc)
  moveFrame: number; // frames since move began (0-based)
  /** pose the renderer should show if moveId is null (e.g. 'idle', 'hitMid'); renderer may vary by modeFrame */
  pose: PoseName;
  hp: number;
  maxHp: number;
  redHp: number; // recoverable portion (visual only)
  ki: number; // 0..300
  awakened: boolean;
  awakenUsed: boolean;
  awakenTimer: number;
  stun: number; // remaining hit/block stun frames
  hitstop: number;
  invuln: boolean;
  armor: boolean;
  airborne: boolean;
  comboHits: number; // hits taken in current combo (for the defender)
  comboDamage: number;
  juggleScale: number; // 0..1000
  counterHitFlash: number;
  stance: boolean; // e.g. Ren sheath stance
  heatStacks: number; // char-specific counter (Kaito heat stacks, Shiori clone, etc.)
  wins: number;
  side: -1 | 1; // -1 = currently on the LEFT of the screen, 1 = right (for input mapping & UI)
  lastInputs: number[]; // ring of recent input bits (for motion parsing); keep length <= 30
}

export interface ProjectileState {
  id: number;
  owner: 0 | 1;
  kind: string;
  element: Element;
  pos: Vec3;
  vel: Vec3;
  r: number;
  life: number;
  hitsLeft: number;
  beam: boolean;
  moveId: string;
}

export interface ClashState {
  active: boolean;
  frame: number;
  duration: number;
  balance: number; // -1000 (p1 losing) .. 1000 (p1 winning)
  mash: [number, number];
  point: Vec3; // where beams meet
}

export type RoundPhase = 'intro' | 'fight' | 'ko' | 'timeout' | 'roundEnd' | 'matchEnd';

export interface SimEvent {
  type:
    | 'hit' | 'block' | 'counter' | 'whiff' | 'parry' | 'throw' | 'throwBreak'
    | 'launch' | 'wallSplat' | 'groundBounce' | 'land' | 'knockdown'
    | 'projectile' | 'projectileHit' | 'projectileDestroy'
    | 'kiCharge' | 'kiFull' | 'vanish' | 'awaken' | 'ultimateStart' | 'ultimateHit'
    | 'clashStart' | 'clashEnd' | 'sidestep' | 'dash' | 'jump'
    | 'moveStart' | 'roundStart' | 'fight' | 'ko' | 'timeout' | 'roundEnd' | 'matchEnd';
  frame: number;
  player: 0 | 1; // who caused it
  target?: 0 | 1;
  pos: Vec3; // world position (mm) of the effect
  strength?: Strength;
  element?: Element;
  damage?: number;
  moveId?: string;
  charId?: CharId;
}

export interface CameraHint {
  /** midpoint between fighters (mm) */
  center: Vec3;
  /** unit vector *1000 perpendicular to the fighter axis, pointing from the fight TOWARD the camera */
  normal: { x: number; z: number };
  distance: number; // separation between fighters (mm)
  /** cinematic override */
  cinematic: null | { kind: 'ultimate' | 'awaken' | 'throw' | 'ko' | 'clash' | 'intro'; player: 0 | 1; frame: number };
}

export interface GameState {
  frame: number;
  seed: number; // PRNG state
  stage: StageId;
  arenaHalfSize: number; // square arena: walls at +/- this on x and z (mm)
  fighters: [FighterState, FighterState];
  projectiles: ProjectileState[];
  nextProjectileId: number;
  clash: ClashState;
  round: { number: number; phase: RoundPhase; phaseFrame: number; timer: number; winner: -1 | 0 | 1 | 2 };
  roundsToWin: number;
  camera: CameraHint;
  slowmo: number; // frames of slow motion remaining (render hint; sim still steps fixed)
  events: SimEvent[]; // events produced during the LAST step (cleared at start of step)
  training: boolean; // training mode: infinite HP refill, no timer
  schemes: [ControlScheme, ControlScheme];
}

export interface MatchConfig {
  p1: CharId;
  p2: CharId;
  stage: StageId;
  seed: number;
  roundsToWin?: number; // default 2
  training?: boolean;
  schemes?: [ControlScheme, ControlScheme];
}

/**
 * SIM API (implemented in src/sim/index.ts):
 *   createMatch(cfg: MatchConfig): GameState
 *   step(state: GameState, inputs: [InputBits, InputBits]): void   // mutates in place, fills state.events
 *   serialize(state): Uint8Array ; deserialize(bytes): GameState ; hashState(state): number
 *   getChar(id: CharId): CharDef
 *   getMove(char: CharId, moveId: string): MoveDef | undefined
 *   debugBoxes(state): { hit: Capsule[], hurt: Capsule[] }  // world-space capsules for the hitbox viewer
 */
export interface Capsule { a: Vec3; b: Vec3; r: number; owner: 0 | 1; kind: 'hit' | 'hurt' | 'throw' | 'projectile' }
