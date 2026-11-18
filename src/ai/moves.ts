/**
 * Move analysis + input synthesis for the CPU.
 *
 * Everything here is derived from the data tables (CharDef/MoveDef) so a retuned move
 * is picked up automatically. Inputs are produced FACING-RELATIVE (same convention as the
 * sim: Btn.Right = forward, Btn.Left = back, Up / Down unchanged) and converted to screen
 * bits by `toRaw()` at emission time using fighter.side.
 */
import { Btn, type CharId, type ControlScheme, type MoveDef } from '../sim/types';
import { getChar } from '../sim/index';

export const R_UP = Btn.Up;
export const R_DOWN = Btn.Down;
export const R_BACK = Btn.Left;
export const R_FWD = Btn.Right;
export const BTN_MASK = Btn.L | Btn.H | Btn.K | Btn.S | Btn.Guard | Btn.Ult;

/** relative frame -> raw screen-relative bits for a fighter standing on `side` (-1 left, +1 right) */
export function toRaw(rel: number, side: -1 | 1): number {
  let r = rel & ~(R_FWD | R_BACK);
  if (rel & R_FWD) r |= side === -1 ? Btn.Right : Btn.Left;
  else if (rel & R_BACK) r |= side === -1 ? Btn.Left : Btn.Right;
  return r;
}

export type Motion = '236' | '214' | '623' | '41236';
const BTN_TOK: Record<string, number> = { L: Btn.L, H: Btn.H, K: Btn.K, S: Btn.S };

export interface ParsedNotation { chain: string | null; motion: Motion | null; dir: number; btn: number; ult: boolean }

export function parseNotation(input: string): ParsedNotation {
  let chain: string | null = null;
  let tok = input;
  const c = input.lastIndexOf(',');
  if (c >= 0) { chain = input.slice(0, c); tok = input.slice(c + 1); }
  let j = 0;
  while (j < tok.length && tok.charCodeAt(j) >= 48 && tok.charCodeAt(j) <= 57) j++;
  const digits = tok.slice(0, j);
  const rest = tok.slice(j);
  let btn = 0;
  let ult = false;
  if (rest === 'Ult') ult = true;
  else for (const b of rest.split('+')) btn |= BTN_TOK[b] ?? 0;
  return {
    chain,
    motion: digits.length >= 3 ? (digits as Motion) : null,
    dir: digits.length === 1 ? +digits : 0,
    btn,
    ult,
  };
}

/** numpad direction -> relative bits */
export function dirBits(d: number): number {
  switch (d) {
    case 1: return R_DOWN | R_BACK;
    case 2: return R_DOWN;
    case 3: return R_DOWN | R_FWD;
    case 4: return R_BACK;
    case 6: return R_FWD;
    case 7: return R_UP | R_BACK;
    case 8: return R_UP;
    case 9: return R_UP | R_FWD;
    default: return 0;
  }
}

/** numpad digit of relative bits (mirrors sim/input.ts digitOf) */
export function digitOf(rel: number): number {
  const v = rel & R_UP ? 8 : rel & R_DOWN ? 2 : 5;
  const h = rel & R_FWD ? 1 : rel & R_BACK ? -1 : 0;
  if (v === 5) return h === 1 ? 6 : h === -1 ? 4 : 5;
  if (v === 8) return h === 1 ? 9 : h === -1 ? 7 : 8;
  return h === 1 ? 3 : h === -1 ? 1 : 2;
}

// ---------------------------------------------------------------- motion resolution (mirror of the sim parser)
interface Step { d: number[]; opt?: boolean }
const MOTIONS: Record<Motion, Step[]> = {
  '236': [{ d: [2] }, { d: [3], opt: true }, { d: [6] }],
  '214': [{ d: [2] }, { d: [1], opt: true }, { d: [4] }],
  '623': [{ d: [6] }, { d: [2, 1] }, { d: [3] }],
  '41236': [{ d: [4] }, { d: [1], opt: true }, { d: [2] }, { d: [3], opt: true }, { d: [6] }],
};
const PRIORITY: Motion[] = ['41236', '623', '236', '214'];
const WINDOW = 12;

function motionDone(h: number[], motion: Motion, win = WINDOW): boolean {
  const steps = MOTIONS[motion];
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

/** which motion would the sim pick for this history (highest priority wins) */
export function resolveMotion(h: number[]): Motion | null {
  for (const m of PRIORITY) if (motionDone(h, m)) return m;
  return null;
}

/** relative direction frames of a motion (last frame = completing direction) */
function motionFrames(m: Motion): number[] {
  switch (m) {
    case '236': return [R_DOWN, R_DOWN, R_FWD];
    case '214': return [R_DOWN, R_DOWN, R_BACK];
    case '623': return [R_FWD, R_DOWN, R_DOWN | R_FWD];
    case '41236': return [R_BACK, R_DOWN | R_BACK, R_DOWN, R_DOWN | R_FWD, R_FWD];
  }
}

// ---------------------------------------------------------------- catalog
export interface MoveInfo {
  m: MoveDef;
  id: string;
  kind: MoveDef['kind'];
  p: ParsedNotation;
  startup: number;
  total: number;
  damage: number;
  /** centre-to-tip reach (mm) at the first active frame, incl. forward travel */
  reach: number;
  /** maximum reach over the whole move */
  reachMax: number;
  /** lowest reach edge: hitboxes starting behind the fighter (Titan Quake) */
  height: MoveDef['height'];
  onBlock: number; // attacker advantage on block (<= 0 = unsafe)
  launches: boolean;
  knocks: boolean;
  projectile: boolean;
  beam: boolean;
  kiCost: number;
  special: boolean;
  armored: boolean;
  invulnTo: number; // last invulnerable frame (0 = none)
  tracking: 'none' | 'left' | 'right' | 'full';
  /** can hit a crouching opponent */
  hitsCrouch: boolean;
  /** lowest hit height class */
  isLow: boolean;
  isHigh: boolean;
  /** mean forward travel until first active frame */
  travel: number;
  /** tests whether this move's hitbox (tip) can ever reach `dist` */
  strings: boolean;
}

function fwdTravel(m: MoveDef, untilFrame: number): number {
  const mov = m.movement;
  if (!mov) return 0;
  let tot = 0;
  let v = 0;
  let k = 0;
  for (let f = 0; f < untilFrame; f++) {
    while (k < mov.length && mov[k][0] <= f) { v = mov[k][1]; k++; }
    tot += v;
  }
  return tot;
}

function analyse(m: MoveDef): MoveInfo {
  const p = parseNotation(m.input);
  let tip = 0;
  let tipMax = 0;
  let first = 9999;
  let last = 0;
  for (const hb of m.hitboxes) {
    first = Math.min(first, hb.from);
    last = Math.max(last, hb.to);
  }
  for (const hb of m.hitboxes) {
    const t = hb.x + hb.len + hb.r;
    if (hb.from === first) tip = Math.max(tip, t);
    tipMax = Math.max(tipMax, t);
  }
  let reach = tip + (first < 9999 ? fwdTravel(m, first - 1) : 0);
  let reachMax = tipMax + (last > 0 ? fwdTravel(m, last) : 0);
  if (m.projectile) {
    const pr = m.projectile;
    reach = pr.x + pr.speed * pr.life;
    reachMax = reach;
  }
  const eff = m.onHit ?? 'normal';
  const chd = m.onCounterHit;
  return {
    m, id: m.id, kind: m.kind, p,
    startup: m.projectile ? m.projectile.spawnFrame - 1 : m.startup,
    total: m.startup + m.active + m.recovery,
    damage: m.damage * (m.projectile?.count ?? 1),
    reach, reachMax,
    height: m.height,
    onBlock: m.onBlock ?? (m.projectile ? 0 : -8),
    launches: eff === 'launch' || chd === 'launch',
    knocks: eff === 'knockdown' || eff === 'groundbounce' || eff === 'wallbounce',
    projectile: !!m.projectile,
    beam: !!m.projectile?.beam,
    kiCost: m.kiCost ?? 0,
    special: m.kind === 'special',
    armored: !!m.armor,
    invulnTo: m.invuln ? m.invuln[1] : 0,
    tracking: m.tracking ?? 'none',
    hitsCrouch: m.height !== 'high',
    isLow: m.height === 'low',
    isHigh: m.height === 'high',
    travel: fwdTravel(m, first < 9999 ? first - 1 : 0),
    strings: !!p.chain,
  };
}

export interface CharCatalog {
  id: CharId;
  all: MoveInfo[];
  byId: Record<string, MoveInfo>;
  /** ground normals incl. strings (chain moves excluded from `normals`) */
  normals: MoveInfo[];
  specials: MoveInfo[];
  kis: MoveInfo[];
  launchers: MoveInfo[];
  lows: MoveInfo[];
  throwInfo: MoveInfo;
  ult: MoveInfo;
  ultAw: MoveInfo | null;
  stance: MoveInfo | null;
  maxReach: number;
  fastest: MoveInfo; // fastest ground normal
}

const cache: Partial<Record<CharId, CharCatalog>> = {};

export function catalog(id: CharId): CharCatalog {
  const c = cache[id];
  if (c) return c;
  const def = getChar(id);
  const all = def.moves.map(analyse);
  const byId: Record<string, MoveInfo> = {};
  for (const i of all) byId[i.id] = i;
  const sel = all.filter((i) => !i.m.internal && i.m.input);
  const normals = sel.filter((i) => i.kind === 'normal' && !i.p.chain && i.m.requires !== 'air');
  const specials = sel.filter((i) => i.kind === 'special');
  const kis = sel.filter((i) => i.kind === 'ki');
  const launchers = normals.filter((i) => i.launches);
  const lows = normals.filter((i) => i.isLow);
  const throwInfo = byId[`${id}_throw`];
  const ult = byId[def.ultimateId];
  const ultAw = def.awakenedUltimateId ? byId[def.awakenedUltimateId] : null;
  const stance = specials.find((i) => !!i.m.stance) ?? null;
  let maxReach = 0;
  for (const i of normals.concat(specials.filter((s) => !s.projectile))) maxReach = Math.max(maxReach, i.reach);
  const fastest = normals.slice().sort((a, b) => a.startup - b.startup)[0];
  const cat: CharCatalog = { id, all, byId, normals, specials, kis, launchers, lows, throwInfo, ult, ultAw, stance, maxReach, fastest };
  cache[id] = cat;
  return cat;
}

// ---------------------------------------------------------------- input synthesis
/**
 * Frames (facing-relative) that execute `mi`. The LAST frame holds the button press, i.e. the move
 * starts on frame `length`. `hist` = fighter.lastInputs so motion conflicts (623 vs 236, 41236 vs 236)
 * can be flushed with neutral frames first.
 */
export function moveFrames(mi: MoveInfo, scheme: ControlScheme, hist: number[]): number[] {
  const p = mi.p;
  const easy = scheme === 'easy';
  if (mi.kind === 'ultimate') {
    if (easy) return [Btn.Ult];
    return withMotion('236', Btn.H | Btn.S, hist);
  }
  if (mi.kind === 'throw') return [Btn.L | Btn.K, 0];
  if (mi.kind === 'special' || mi.kind === 'ki') {
    if (easy) {
      const e = parseNotation(mi.m.easyInput ?? mi.m.input);
      return [dirBits(e.dir) | e.btn, dirBits(e.dir)];
    }
    if (p.motion) return withMotion(p.motion, p.btn, hist);
    return [dirBits(p.dir) | p.btn, dirBits(p.dir)];
  }
  // normals
  const d = dirBits(p.dir);
  return [d | p.btn, d, d];
}

function withMotion(motion: Motion, btn: number, hist: number[]): number[] {
  const seq = motionFrames(motion).slice();
  const last = seq.length - 1;
  seq[last] |= btn;
  // flush conflicting priorities: prepend neutral frames until the sim would resolve our motion
  for (let pad = 0; pad <= WINDOW; pad++) {
    const h = hist.slice(-WINDOW);
    for (let k = 0; k < pad; k++) h.push(0);
    for (const s of seq) h.push(s & ~BTN_MASK);
    const got = resolveMotion(h);
    if (got === motion || (motion === '236' && btn === (Btn.H | Btn.S) && got === '236')) {
      const out: number[] = [];
      for (let k = 0; k < pad; k++) out.push(0);
      return out.concat(seq);
    }
  }
  return seq;
}

