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
export type CharId = 'kaito' | 'shiori' | 'ren' | 'goro'
  // Crossover Pack (licensed by the owner for this private game; kits in src/data/chars/, see docs/CROSSOVER.md)
  | 'gojo' | 'naruto' | 'zoro' | 'luffy' | 'eren';
/** fighters that are fully implemented and selectable (the select grid lists exactly these, in this order) */
export const ALL_CHARS: CharId[] = ['kaito', 'shiori', 'ren', 'goro', 'gojo', 'naruto', 'zoro', 'luffy', 'eren'];
/** the Crossover Pack ids (subset of ALL_CHARS once each kit is done) */
export const CROSSOVER_CHARS: CharId[] = ['gojo', 'naruto', 'zoro', 'luffy', 'eren'];
export type StageId = 'rooftop' | 'shrine' | 'training';
export const ALL_STAGES: StageId[] = ['rooftop', 'shrine', 'training'];

export type Element = 'none' | 'fire' | 'shadow' | 'blade' | 'earth' | 'ki'
  // crossover elements (additive): Gojo void / cursed energy, Naruto wind chakra, Eren lightning, Luffy rubber
  | 'void' | 'wind' | 'lightning' | 'rubber';
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
  /** (optional) delayed blast: harmless while flying; with `fuse` frames of life left it stops and becomes a blast of radius `blastR` */
  fuse?: number;
  blastR?: number;
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

  // ---- optional sim extensions (added by SIM agent; all optional) ----
  /** throw-type move cannot be broken (command grabs). Command throws (kind 'special') also grab crouchers. */
  unbreakable?: boolean;
  /** move id the attacker switches to when this move CONNECTS (throw hold anim, ultimate cinematic). */
  followup?: string;
  /** for ultimate cinematic moves: move frames (0-based moveFrame) where an 'ultimateHit' lands; damage is split across them. */
  ultHits?: number[];
  /** Kaito Heat Stacks: 'gain' adds a stack on hit, 'consume' spends all stacks for +15% dmg each. */
  heat?: 'gain' | 'consume';
  /** teleport at moveFrame `frame` to behind / in front of the opponent (Smoke Swap). */
  teleport?: { frame: number; to: 'behind' | 'front' };
  /** hold-stance move (Ren Sheath Stance): loops at loopFrame while S is held; release after minHold -> releaseMove. */
  stance?: { loopFrame: number; releaseMove: string; counterMove: string; minHold: number; maxHold: number };
  /** frames immune to projectiles only */
  projInvuln?: [number, number];
  /** not selectable by input (reached through followup / stance) */
  internal?: boolean;
  /** crouching hurtbox for the whole move (defaults to true for inputs starting with '2') */
  crouching?: boolean;
  /** frame advantage on block (display; blockstun is derived from it). */
  onBlock?: number;
  /**
   * frame advantage on hit (display). Named onHitAdv because `onHit` is already the hit EFFECT field.
   * Undefined when the hit causes launch / knockdown / bounce (show the effect instead).
   */
  onHitAdv?: number;
  /** (optional) can hit an opponent lying in knockdown (ground hit / stomp), once per knockdown */
  otg?: boolean;

  // ---- crossover pack sim extensions (all optional, see docs/CROSSOVER.md) ----
  /** Soul Realm move: at moveFrame === startup the realm cinematic starts (state.realm) */
  realm?: { kind: string; duration: number };
  /** counter stance: a melee strike of one of `heights` landing on 1-based move frames from..to is parried and `move` starts */
  counter?: { from: number; to: number; heights: Height[]; move: string };
  /** move only selectable when fighter.form === needForm ('' = base form only) */
  needForm?: string;
  /** body collision off while this move runs (dash-through attacks) */
  passThrough?: boolean;
  /** Naruto: spawn shadow clones at moveFrame `frame` (up to the max) */
  summon?: { frame: number; count: number };
  /** move requires this many active shadow clones (Clone Rush) */
  needClones?: number;
  /** stance swap: starting this move cycles fighter.form through this list (Zoro's 1/2/3-sword styles) */
  cycleForms?: string[];
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
  /** Easy scheme: special the L auto-combo cancels into at the end of the string */
  autoComboEnder?: string;
  /** (optional) Soul Realm move id: replaces the awakened ultimate when awakened with 300 Ki (once per match) */
  realmId?: string;
  /** (optional) element used for awakening / realm effects */
  element?: Element;
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
  /**
   * Recent inputs, oldest first, newest last (length <= 30). Stored FACING-RELATIVE:
   * bit Btn.Left = BACK, bit Btn.Right = FORWARD; Up/Down/buttons unchanged.
   */
  lastInputs: number[];
  /** internal sim bookkeeping (always present at runtime). Other modules should treat it as opaque. */
  sim?: FighterSimData;
  /**
   * (optional, crossover) visual/mechanical form for the renderer to swap models / looks:
   * '' base, 'six_eyes' (Gojo awakened, blindfold off), 'sage' / 'kurama' (Naruto), 'gear2' / 'gear4' / 'gear5' (Luffy),
   * 'titan' (Eren, form_titan.glb), 'santoryu' / 'nitoryu' / 'ittoryu' (Zoro sword count), 'asura' (Zoro awakened).
   */
  form?: string;
  /** (optional, crossover) Gojo Infinity charges left this round (0/1) — HUD shimmer indicator */
  infinity?: number;
  /** (optional, Soul Realm) 1 = hidden by Shiori's Moonless Void (draw her invisible / a faint shimmer; she shows while attacking) */
  veiled?: number;
  /** (optional, Soul Realm) 1 = Goro's Mountain Temple armor is up (stone-skin glow); 0 while it refreshes */
  realmArmor?: number;
  /** (optional, Soul Realm) Sun Forge burn damage still to tick on this fighter (flames on the body while > 0) */
  burn?: number;
}

/** Internal per-fighter sim data (plain JSON). Not part of the render contract. */
export interface FighterSimData {
  prevRaw: number;
  /** current facing-relative input bits (see lastInputs) */
  rel: number;
  /** direction edge events this frame (bit flags, see sim/input.ts EV_*) */
  dirEv: number;
  /** frames since last press per button [L,H,K,S,Guard,Ult]; 99 = none / consumed */
  press: number[];
  /** frames held per button [L,H,K,S,Guard,Ult] (0 = released) */
  held: number[];
  upHeld: number; downHeld: number; fwdHeld: number; backHeld: number;
  /** double-tap windows remaining (frames) */
  fwdTap: number; backTap: number; upTap: number;
  /** Down was pressed alone and nothing else happened while held (release = sidestep out) */
  downClean: boolean;
  /** bit per hitbox index of the current move that already connected */
  hitMask: number;
  /** current move connected: 0 none, 1 hit, 2 block */
  contact: number;
  activeDone: boolean;
  /** string follow-up queued before its window opened */
  queued: string | null;
  /** current move was started with an Easy shortcut (-10% damage on specials) */
  easyMove: boolean;
  pushX: number; pushZ: number;
  knockX: number; knockZ: number;
  bounce: boolean; bounceUsed: boolean; splatUsed: boolean;
  ssX: number; ssZ: number; ssLateral: number;
  jumpX: number; jumpZ: number;
  turnLock: number;
  landLag: number;
  /** throw partner index or -1 */
  partner: number;
  breakable: boolean;
  throwMove: string;
  regen: number;
  armorUsed: boolean;
  heatUsed: number;
  kiFullSent: boolean;
  hitPose: PoseName;
  crumple: boolean;
  airAttackUsed: boolean;
  /** (optional, sim) a combo ender (special in a juggle) landed: no more hits until this fighter lands */
  enderUsed?: boolean;
  /** (optional, sim) hidden guard meter 0..GUARD_MAX; drains on block, empty = guard crush */
  guard?: number;
  /** (optional, sim) frames since this fighter last blocked (guard meter regen delay) */
  guardIdle?: number;
  /** (optional, sim) already took a ground hit during this knockdown */
  otgUsed?: boolean;
  /** (optional, crossover) Soul Realm already used this match */
  realmUsed?: boolean;
  /** (optional, crossover) frames this fighter is frozen by an opponent's realm (no inputs, cannot guard) */
  realmFreeze?: number;
  /** (optional, crossover) Six Eyes: auto-guard frames left after an opponent teleport / charges left this awakening */
  autoGuard?: number;
  sixEyes?: number;
  /** (optional, crossover) Asura echo: second slash of `echoMove` lands when echoT reaches 0 */
  echoMove?: string;
  echoT?: number;
  /** (optional, crossover) frames left in a timed form (Eren titan) */
  formTimer?: number;
  /** (optional, crossover) extra ground bounces left in this juggle (Gear Fifth) */
  bounceExtra?: number;
  /** (optional, crossover) training: frames until Gojo's Infinity recharges */
  infinityCd?: number;
  /** (optional, Soul Realm) Mountain Temple: frames until Goro's realm armor refreshes */
  templeCd?: number;
}

export interface TrainingOptions {
  infiniteKi: boolean;
  hpRegen: boolean;
  /** P2 dummy auto-guard when it is free to act */
  dummyGuard: 'none' | 'all' | 'random';
  dummyCrouch: boolean;
}

/** Ultimate cinematic in progress */
export interface UltState {
  player: 0 | 1;
  target: 0 | 1;
  frame: number;
  duration: number;
  damage: number; // total damage to deal (already scaled)
  dealt: number;
  hitIndex: number;
  moveId: string; // the cinematic move id
  /** (optional) hit-freeze frames remaining: the cinematic pauses (connect + final hit = 14, others 3) */
  freeze?: number;
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
  /** frames until this projectile may hit again (multi-hit beams) */
  cooldown?: number;
  /** (optional, crossover) speed percent this frame (Gojo Infinity slows enemy projectiles near him to 30) */
  slow?: number;
  /** (optional) delayed blast: frames of life at which it detonates, blast radius */
  fuse?: number;
  blastR?: number;
}

/**
 * (crossover) Soul Realm in progress. phase 'cine' = 90-frame cinematic (everything frozen, the
 * opponent may answer with its own realm -> Realm Clash), then 'active' = the rule twist runs for `duration` frames.
 */
export interface RealmState {
  owner: 0 | 1;
  kind: string; // 'infinite_void' | 'tailed_beast_bomb' | 'king_of_hell' | 'gear_fifth' | 'paths' | 'sun_forge' | 'moonless_void' | 'petal_storm' | 'mountain_temple'
  phase: 'cine' | 'active';
  frame: number; // frames since this phase began
  duration: number; // active-phase length
  cine: number; // cinematic length (90)
  moveId: string;
  /** damage the owner dealt during the realm and its cap (0 = no cap) — Infinite Void keeps its total <= 35% HP */
  dealt: number;
  cap: number;
}

/** (crossover) Naruto's shadow clones: sim entities that copy his next attack from a flanking angle */
export interface SummonState {
  id: number;
  owner: 0 | 1;
  kind: 'clone';
  pos: Vec3;
  facing: { x: number; z: number };
  /** -1 / +1 flank side (screen-mirrored) */
  slot: number;
  mode: 'appear' | 'idle' | 'attack';
  modeFrame: number;
  /** move it is copying (owner's move id) and its frame */
  moveId: string | null;
  moveFrame: number;
  /** queued copy: move id + frames until it starts */
  queued: string | null;
  delay: number;
  hitMask: number;
  life: number;
  pose: PoseName;
}

export interface ClashState {
  active: boolean;
  frame: number;
  duration: number;
  balance: number; // -1000 (p1 losing) .. 1000 (p1 winning)
  mash: [number, number];
  point: Vec3; // where beams meet
  /** beam move ids [p1, p2] */
  moves?: [string, string];
  /** -1 none yet, 0 / 1 winner, 2 draw (set on the clashEnd frame) */
  winner?: -1 | 0 | 1 | 2;
  /** (optional, crossover) 'beam' (default) or 'realm' (Realm Clash: winner's realm opens) */
  kind?: 'beam' | 'realm';
}

export type RoundPhase = 'intro' | 'fight' | 'ko' | 'timeout' | 'roundEnd' | 'matchEnd';

export interface SimEvent {
  type:
    | 'hit' | 'block' | 'counter' | 'whiff' | 'parry' | 'throw' | 'throwBreak'
    | 'launch' | 'wallSplat' | 'groundBounce' | 'land' | 'knockdown'
    | 'projectile' | 'projectileHit' | 'projectileDestroy'
    | 'kiCharge' | 'kiFull' | 'vanish' | 'awaken' | 'ultimateStart' | 'ultimateHit'
    | 'clashStart' | 'clashEnd' | 'sidestep' | 'dash' | 'jump' | 'guardCrush'
    | 'moveStart' | 'roundStart' | 'fight' | 'ko' | 'timeout' | 'roundEnd' | 'matchEnd'
    // crossover pack (additive, see docs/CROSSOVER.md)
    | 'realmStart' | 'realmEnd' | 'realmClash' | 'infinityBlock' | 'formChange' | 'summon' | 'summonDispel'
    | 'burn';
  frame: number;
  player: 0 | 1; // who caused it
  target?: 0 | 1;
  pos: Vec3; // world position (mm) of the effect
  strength?: Strength;
  element?: Element;
  damage?: number;
  moveId?: string;
  charId?: CharId;
  /** sub-kind for richer feedback: 'armor' | 'backHit' | 'heat' | 'stance' | 'beam' | 'wake' | 'tech' | 'airHit' | 'juggle' ... */
  tag?: string;
  /** combo hit count of the target after this event */
  combo?: number;
}

export interface CameraHint {
  /** midpoint between fighters (mm) */
  center: Vec3;
  /** unit vector *1000 perpendicular to the fighter axis, pointing from the fight TOWARD the camera */
  normal: { x: number; z: number };
  distance: number; // separation between fighters (mm)
  /** cinematic override */
  cinematic: null | { kind: 'ultimate' | 'awaken' | 'throw' | 'ko' | 'clash' | 'intro' | 'realm'; player: 0 | 1; frame: number };
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
  /**
   * timer is in FRAMES (60 per second; UI divides by 60). phaseFrame = frames since phase began.
   * winner: -1 none yet, 0/1 player, 2 draw. At 'matchEnd' it holds the MATCH winner.
   */
  round: { number: number; phase: RoundPhase; phaseFrame: number; timer: number; winner: -1 | 0 | 1 | 2 };
  roundsToWin: number;
  camera: CameraHint;
  slowmo: number; // frames of slow motion remaining (render hint; sim still steps fixed)
  events: SimEvent[]; // events produced during the LAST step (cleared at start of step)
  training: boolean; // training mode: infinite HP refill, no timer
  schemes: [ControlScheme, ControlScheme];
  /** active ultimate cinematic (null when none) */
  ult?: UltState | null;
  /** training-mode options (UI may mutate between steps) */
  trainingOpts?: TrainingOptions;
  /** last measured frame advantage (attacker's perspective) after a hit/block, for the training HUD */
  frameAdv?: { player: 0 | 1; value: number; moveId: string; frame: number } | null;
  /** internal: frame-advantage tracker */
  advTrack?: { att: number; moveId: string; aFree: number; dFree: number } | null;
  /** (optional, crossover) active Soul Realm (null when none) */
  realm?: RealmState | null;
  /** (optional, crossover) summoned entities (Naruto shadow clones) */
  summons?: SummonState[];
  nextSummonId?: number;
}

export interface MatchConfig {
  p1: CharId;
  p2: CharId;
  stage: StageId;
  seed: number;
  roundsToWin?: number; // default 2
  training?: boolean;
  schemes?: [ControlScheme, ControlScheme];
  trainingOpts?: Partial<TrainingOptions>;
}

/**
 * SIM API (implemented in src/sim/index.ts):
 *   createMatch(cfg: MatchConfig): GameState
 *   step(state: GameState, inputs: [InputBits, InputBits]): void   // mutates in place, fills state.events
 *   serialize(state): Uint8Array ; deserialize(bytes): GameState ; hashState(state): number
 *   getChar(id: CharId): CharDef
 *   getMove(char: CharId, moveId: string): MoveDef | undefined
 *   debugBoxes(state): Capsule[]  // world-space capsules (kind = hurt | hit | throw | projectile) for the hitbox viewer
 */
export interface Capsule { a: Vec3; b: Vec3; r: number; owner: 0 | 1; kind: 'hit' | 'hurt' | 'throw' | 'projectile' }
