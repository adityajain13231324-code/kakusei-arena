/** Tuning constants for the sim (frames at 60 Hz, mm). */
export const INTRO_FRAMES = 90;
export const ROUND_FRAMES = 60 * 60;
export const KO_FRAMES = 150; // ko / timeout phase length before roundEnd
export const ROUND_END_FRAMES = 120;
export const START_DIST = 2600;
export const ARENA_HALF = 6000;
export const ARENA_HALF_TRAINING = 20000;

export const GRAVITY = 4; // jumps / air moves
export const BUFFER = 6; // button buffer (frames)
export const MOTION_WINDOW = 12; // motion input leniency (frames)
export const COMBO_SPREAD = 3; // max frames between buttons of a multi-button input
export const TAP_MAX = 10; // a "tap" is a press held at most this long
export const DOUBLE_TAP = 12; // second press must come within this many frames of the first release

export const SIDESTEP_FRAMES = 18;
export const SIDESTEP_EVADE_FROM = 2;
export const SIDESTEP_EVADE_TO = 14;
export const SIDESTEP_EVADE_DIST = 120; // lateral mm needed before linear moves whiff
export const SIDEWALK_PCT = 55;
export const DASH_FRAMES = 16;
export const DASH_ACT = 3;
export const BACKDASH_FRAMES = 20;
export const BACKDASH_ACT = 12;
export const PREJUMP = 3;
export const JUMP_FWD = 30;
export const LAND_LAG = 4;
export const AIR_LAND_LAG = 6;

export const KI_MAX = 300;
export const KI_BAR = 100;
export const KICHARGE_HOLD = 15;
export const KICHARGE_RATE = 2;
export const VANISH_COST = 100;
export const VANISH_FRAMES = 16;
export const VANISH_TP = 5;
export const VANISH_INVULN = 10;
export const VANISH_DIST = 900;
export const TURN_LOCK = 24;

export const AWAKEN_FRAMES = 50;
export const AWAKEN_DURATION = 12 * 60;
export const AWAKEN_HP_PCT = 35;

export const THROW_BREAK = 18;
export const THROW_LAND = 24;
export const THROW_DIST = 650;

export const KD_LIE = 40;
export const KD_MIN = 14;
export const WAKE_FRAMES = 22;
export const WAKE_INVULN = 12;
export const SPLAT_FRAMES = 45;
export const CLASH_FRAMES = 180;
export const CLASH_PUSH = 30;
export const SLOWMO_KO = 60;
export const TRAIN_REGEN_DELAY = 60;
export const HURT_HEIGHT = 1700; // gameplay hurtboxes use one standard height for all fighters

export const HITSTOP: Record<string, number> = { light: 8, medium: 10, heavy: 12, super: 14 };
export const PUSHBACK: Record<string, number> = { light: 120, medium: 180, heavy: 260, super: 400 };
