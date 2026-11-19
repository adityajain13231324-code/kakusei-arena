/**
 * Input processing: screen -> facing-relative mapping, press/hold tracking,
 * direction edge events, motion parsing and move-notation parsing.
 *
 * Relative bits (stored in fighter.lastInputs / sim.rel):
 *   R_UP = Btn.Up (into screen), R_DOWN = Btn.Down, R_BACK = Btn.Left bit, R_FWD = Btn.Right bit.
 * SOCD: Left+Right = neutral; Up+Down = Up.
 */
import { Btn, type CharId, type MoveDef } from './types';
import type { SF } from './fighter';
import { CHARS } from '../data';
import { BUFFER, COMBO_SPREAD, DOUBLE_TAP, MOTION_WINDOW, TAP_MAX } from './constants';

export const R_UP = Btn.Up;
export const R_DOWN = Btn.Down;
export const R_BACK = Btn.Left;
export const R_FWD = Btn.Right;
export const DIR_MASK = R_UP | R_DOWN | R_BACK | R_FWD;

/** button indices into sim.press / sim.held */
export const B_L = 0, B_H = 1, B_K = 2, B_S = 3, B_G = 4, B_U = 5;
export const BTN_BITS = [Btn.L, Btn.H, Btn.K, Btn.S, Btn.Guard, Btn.Ult];
export const BTN_TOKENS: Record<string, number> = { L: B_L, H: B_H, K: B_K, S: B_S, G: B_G, Ult: B_U };

// direction edge events (sim.dirEv)
export const EV_UP = 1;
export const EV_UP_DOUBLE = 2;
export const EV_DOWN = 4;
export const EV_DOWN_TAP = 8; // Down released after a clean tap -> sidestep out
export const EV_FWD = 16;
export const EV_FWD_DOUBLE = 32;
export const EV_BACK = 64;
export const EV_BACK_DOUBLE = 128;

export function toRelative(raw: number, side: -1 | 1): number {
  let r = raw & ~(Btn.Left | Btn.Right | Btn.Up | Btn.Down);
  const up = (raw & Btn.Up) !== 0;
  const down = (raw & Btn.Down) !== 0;
  if (up) r |= R_UP; else if (down) r |= R_DOWN;
  const l = (raw & Btn.Left) !== 0;
  const rt = (raw & Btn.Right) !== 0;
  if (l !== rt) {
    // side -1 = fighter on the LEFT of the screen -> opponent is to the right -> Right = forward
    const fwd = side === -1 ? rt : l;
    r |= fwd ? R_FWD : R_BACK;
  }
  return r;
}

/** numpad digit of relative bits (8 = up/into screen) */
export function digitOf(rel: number): number {
  const v = rel & R_UP ? 8 : rel & R_DOWN ? 2 : 5;
  const h = rel & R_FWD ? 1 : rel & R_BACK ? -1 : 0;
  if (v === 5) return h === 1 ? 6 : h === -1 ? 4 : 5;
  if (v === 8) return h === 1 ? 9 : h === -1 ? 7 : 8;
  return h === 1 ? 3 : h === -1 ? 1 : 2;
}

/** Feed one frame of raw input into the fighter's input state. Runs every frame (also in hitstop). */
export function updateInput(f: SF, raw: number): void {
  const s = f.sim;
  const prevRel = s.rel;
  const rel = toRelative(raw, f.side);
  s.rel = rel;
  const pressed = raw & ~s.prevRaw;
  for (let i = 0; i < 6; i++) {
    const bit = BTN_BITS[i];
    s.held[i] = raw & bit ? s.held[i] + 1 : 0;
    if (pressed & bit) s.press[i] = 0;
    else if (s.press[i] < 99 && f.hitstop === 0) s.press[i]++; // buffer does not age during hitstop
  }
  if (s.fwdTap > 0) s.fwdTap--;
  if (s.backTap > 0) s.backTap--;
  if (s.upTap > 0) s.upTap--;

  let ev = 0;
  // Up
  if (rel & R_UP) {
    if (!(prevRel & R_UP)) { ev |= EV_UP; if (s.upTap > 0) { ev |= EV_UP_DOUBLE; s.upTap = 0; } }
    s.upHeld++;
  } else {
    if (s.upHeld > 0 && s.upHeld <= TAP_MAX) s.upTap = DOUBLE_TAP;
    s.upHeld = 0;
  }
  // Down (tap = sidestep out on release, hold = crouch)
  if (rel & R_DOWN) {
    if (!(prevRel & R_DOWN)) { ev |= EV_DOWN; s.downClean = true; }
    if (rel & (R_FWD | R_BACK) || pressed & (Btn.L | Btn.H | Btn.K | Btn.S | Btn.Guard)) s.downClean = false;
    s.downHeld++;
  } else {
    if (s.downHeld > 0 && s.downHeld <= TAP_MAX && s.downClean && !(rel & DIR_MASK)) ev |= EV_DOWN_TAP;
    s.downHeld = 0;
    s.downClean = false;
  }
  // Forward
  if (rel & R_FWD) {
    if (!(prevRel & R_FWD)) { ev |= EV_FWD; if (s.fwdTap > 0) { ev |= EV_FWD_DOUBLE; s.fwdTap = 0; } }
    s.fwdHeld++;
  } else {
    if (s.fwdHeld > 0 && s.fwdHeld <= TAP_MAX && !(rel & (R_UP | R_DOWN))) s.fwdTap = DOUBLE_TAP;
    s.fwdHeld = 0;
  }
  // Back
  if (rel & R_BACK) {
    if (!(prevRel & R_BACK)) { ev |= EV_BACK; if (s.backTap > 0) { ev |= EV_BACK_DOUBLE; s.backTap = 0; } }
    s.backHeld++;
  } else {
    if (s.backHeld > 0 && s.backHeld <= TAP_MAX && !(rel & (R_UP | R_DOWN))) s.backTap = DOUBLE_TAP;
    s.backHeld = 0;
  }
  s.dirEv = ev;
  s.prevRaw = raw;
  const h = f.lastInputs;
  h.push(rel);
  if (h.length > 30) h.shift();
}

/** button i was pressed within the buffer and not yet consumed */
export function fresh(f: SF, i: number): boolean {
  return f.sim.press[i] <= BUFFER;
}

/**
 * Multi-button input (e.g. L+K). Each button counts if it has an unconsumed press in
 * the buffer, OR is still held and was pressed within BUFFER+1 frames (so a button
 * already consumed by a single-button move can upgrade into the combo, e.g. jab -> throw).
 * The presses must be at most COMBO_SPREAD frames apart and at least one must be unconsumed.
 */
export function together(f: SF, mask: number[]): boolean {
  const s = f.sim;
  let lo = 999, hi = -1, anyFresh = false;
  for (const i of mask) {
    let age: number;
    if (s.press[i] <= BUFFER) { age = s.press[i]; anyFresh = true; }
    else if (s.held[i] >= 1 && s.held[i] <= BUFFER + 1) age = s.held[i] - 1;
    else return false;
    if (age < lo) lo = age;
    if (age > hi) hi = age;
  }
  return anyFresh && hi - lo <= COMBO_SPREAD;
}

export function consume(f: SF, mask: number[]): void {
  for (const i of mask) f.sim.press[i] = 99;
}

// ---------------------------------------------------------------- motions
interface MotionStep { d: number[]; opt?: boolean }
const MOTIONS: Record<string, MotionStep[]> = {
  '236': [{ d: [2] }, { d: [3], opt: true }, { d: [6] }],
  '214': [{ d: [2] }, { d: [1], opt: true }, { d: [4] }],
  '623': [{ d: [6] }, { d: [2, 1] }, { d: [3] }],
  '41236': [{ d: [4] }, { d: [1], opt: true }, { d: [2] }, { d: [3], opt: true }, { d: [6] }],
};
/** priority order when several motions are present in the buffer */
export const MOTION_PRIORITY = ['41236', '623', '236', '214'];

/**
 * True if `motion` was completed within the last MOTION_WINDOW (+extra for buffered presses) frames.
 * Steps are matched in order; optional steps may be skipped.
 */
export function motionDone(f: SF, motion: string, extra = 0): boolean {
  const steps = MOTIONS[motion];
  if (!steps) return false;
  const h = f.lastInputs;
  const win = MOTION_WINDOW + extra;
  let i = h.length - win;
  if (i < 0) i = 0;
  let k = 0;
  for (; i < h.length && k < steps.length; i++) {
    const d = digitOf(h[i]);
    if (steps[k].d.indexOf(d) >= 0) { k++; continue; }
    if (steps[k].opt && k + 1 < steps.length && steps[k + 1].d.indexOf(d) >= 0) { k += 2; continue; }
  }
  return k >= steps.length;
}

// ---------------------------------------------------------------- notation
export interface ParsedInput {
  chainPrefix: string | null; // 'L,L' for 'L,L,H'
  motion: string | null;
  dir: number; // 0 = any, otherwise numpad digit
  buttons: number[]; // button indices
  ult: boolean;
}

const parseCache: Record<string, ParsedInput> = {};

export function parseInput(input: string): ParsedInput {
  const c = parseCache[input];
  if (c) return c;
  let chainPrefix: string | null = null;
  let tok = input;
  const comma = input.lastIndexOf(',');
  if (comma >= 0) { chainPrefix = input.slice(0, comma); tok = input.slice(comma + 1); }
  let motion: string | null = null;
  let dir = 0;
  let j = 0;
  while (j < tok.length && tok.charCodeAt(j) >= 48 && tok.charCodeAt(j) <= 57) j++;
  const digits = tok.slice(0, j);
  if (digits.length >= 3) motion = digits;
  else if (digits.length === 1) dir = +digits;
  const rest = tok.slice(j);
  const buttons: number[] = [];
  let ult = false;
  if (rest === 'Ult') ult = true;
  else if (rest.length) for (const b of rest.split('+')) { const bi = BTN_TOKENS[b]; if (bi !== undefined) buttons.push(bi); }
  const p: ParsedInput = { chainPrefix, motion, dir, buttons, ult };
  parseCache[input] = p;
  return p;
}

/** easy-scheme direction matching: 2 also accepts 1/3, 8 accepts 7/9, 0 accepts anything */
export function dirMatches(want: number, cur: number): boolean {
  if (want === 0) return true;
  if (want === 2) return cur === 1 || cur === 2 || cur === 3;
  if (want === 8) return cur === 7 || cur === 8 || cur === 9;
  return want === cur;
}

// ---------------------------------------------------------------- static move tables per character
export interface CharTables {
  chain: Record<string, string>; // 'L,L' -> move id
  normals: MoveDef[]; // selectable single-token normals (ground + air)
  specials: MoveDef[]; // sorted by motion priority
  kis: MoveDef[];
}

const tables: Partial<Record<CharId, CharTables>> = {};

function motionRank(m: MoveDef): number {
  const p = parseInput(m.input);
  if (!p.motion) return 10;
  const r = MOTION_PRIORITY.indexOf(p.motion);
  return r < 0 ? 9 : r;
}

export function charTables(id: CharId): CharTables {
  const t = tables[id];
  if (t) return t;
  const def = CHARS[id];
  const out: CharTables = { chain: {}, normals: [], specials: [], kis: [] };
  for (const m of def.moves) {
    if (m.internal || !m.input) continue;
    const p = parseInput(m.input);
    if (m.kind === 'normal') {
      if (p.chainPrefix) out.chain[(m.needForm ? m.needForm + ':' : '') + m.input] = m.id;
      else out.normals.push(m);
    } else if (m.kind === 'special') out.specials.push(m);
    else if (m.kind === 'ki') out.kis.push(m);
  }
  // awakened-only versions first, then by motion priority (stable)
  // form-specific moves first (they replace base moves), then awakened-only, then motion priority
  const sorter = (a: MoveDef, b: MoveDef) =>
    (a.needForm ? 0 : 1) - (b.needForm ? 0 : 1) || (a.requires === 'awakened' ? 0 : 1) - (b.requires === 'awakened' ? 0 : 1) || motionRank(a) - motionRank(b);
  out.normals.sort((a, b) => (a.needForm ? 0 : 1) - (b.needForm ? 0 : 1));
  out.specials.sort(sorter);
  out.kis.sort(sorter);
  tables[id] = out;
  return out;
}
