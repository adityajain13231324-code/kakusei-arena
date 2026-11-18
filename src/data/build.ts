/**
 * Move-data builders. Frame data is authored as ADVANTAGE (onBlock / onHit) and
 * converted to blockstun / hitstun here so the numbers on the page match what
 * happens in game.
 *
 * FRAME CONVENTION (see docs/CONTROLS.md):
 *   - The step on which a move starts is move frame 1 (fighter.moveFrame === 0).
 *   - `startup` = frames BEFORE the first active frame, so the first active frame is
 *     frame startup+1 (moveFrame === startup). Hitboxes default to from = startup+1,
 *     to = startup+active (1-based).
 *   - total = startup + active + recovery; the fighter can act again on the step after.
 *   - Advantage for a hit landing on 1-based frame F:  stun - (total - F).
 */
import type {
  MoveDef, PoseName, HitboxDef, Height, Strength, OnHitEffect, Element, Tracking, ProjectileDef,
} from '../sim/types';

export interface Box { x: number; y: number; len: number; r: number; z?: number; from?: number; to?: number }

export interface MoveSpec {
  id: string;
  name: string;
  kind?: MoveDef['kind'];
  input: string;
  easy?: string;
  requires?: MoveDef['requires'];
  s: number; a: number; r: number;
  dmg: number;
  h: Height;
  str: Strength;
  el?: Element;
  trk?: Tracking;
  /** frame advantage on block / hit (ignored for an explicit hitstun/blockstun) */
  blk?: number;
  hit?: number;
  hitstun?: number;
  blockstun?: number;
  onHit?: OnHitEffect;
  onCH?: OnHitEffect;
  launch?: number;
  ki?: number;
  kiCost?: number;
  chip?: number;
  push?: number;
  hitstop?: number;
  box?: Box | Box[];
  wind?: PoseName;
  ext?: PoseName;
  anim?: Array<[number, PoseName]>;
  cancel?: string[];
  window?: [number, number];
  movement?: Array<[number, number, number]>;
  invuln?: [number, number];
  armor?: [number, number];
  projectile?: ProjectileDef;
  fx?: string;
  cinematic?: MoveDef['cinematic'];
  extra?: Partial<MoveDef>;
}

export function mv(sp: MoveSpec): MoveDef {
  const total = sp.s + sp.a + sp.r;
  const boxes: HitboxDef[] = [];
  const list = sp.box ? (Array.isArray(sp.box) ? sp.box : [sp.box]) : [];
  for (const b of list) {
    boxes.push({
      from: b.from ?? sp.s + 1,
      to: b.to ?? sp.s + sp.a,
      x: b.x, y: b.y, z: b.z ?? 0, len: b.len, r: b.r,
    });
  }
  // stun is computed relative to the LAST hitbox's first frame (the hit that ends a multi-hit move)
  let lastFrom = sp.s + 1;
  for (const b of boxes) if (b.from > lastFrom) lastFrom = b.from;
  if (sp.projectile) lastFrom = total; // projectiles: author explicit stun
  const remaining = total - lastFrom;
  const hitstun = sp.hitstun ?? Math.max(1, (sp.hit ?? 0) + remaining);
  const blockstun = sp.blockstun ?? Math.max(1, (sp.blk ?? 0) + remaining);

  const wind = sp.wind ?? 'jabWind';
  const ext = sp.ext ?? 'jabExt';
  const anim: Array<[number, PoseName]> = sp.anim ?? [
    [0, wind],
    [Math.max(1, sp.s), ext],
    [sp.s + sp.a + Math.max(1, Math.trunc(sp.r / 2)), 'recover'],
    [Math.max(sp.s + sp.a + 1, total - 2), 'idle'],
  ];

  const kind = sp.kind ?? 'normal';
  const strengthKi = sp.str === 'light' ? 4 : sp.str === 'medium' ? 6 : sp.str === 'heavy' ? 8 : 0;
  const m: MoveDef = {
    id: sp.id,
    name: sp.name,
    kind,
    input: sp.input,
    startup: sp.s,
    active: sp.a,
    recovery: sp.r,
    damage: sp.dmg,
    height: sp.h,
    tracking: sp.trk ?? 'none',
    strength: sp.str,
    element: sp.el ?? 'none',
    hitstun,
    blockstun,
    kiGain: sp.ki ?? (kind === 'ki' || kind === 'ultimate' ? 0 : strengthKi),
    hitboxes: boxes,
    anim,
  };
  if (sp.easy) m.easyInput = sp.easy;
  // display frame advantage (UI move list / training panel)
  if (list.length > 0 && sp.h !== 'throw') {
    m.onBlock = blockstun - remaining;
    const eff = sp.onHit ?? 'normal';
    if (eff === 'normal' || eff === 'stagger') m.onHitAdv = hitstun - remaining + (eff === 'stagger' ? 10 : 0);
  }
  if (sp.requires) m.requires = sp.requires;
  if (sp.chip !== undefined) m.chip = sp.chip;
  else if (kind === 'special' || kind === 'ki') m.chip = Math.trunc(sp.dmg / 10);
  if (sp.hitstop !== undefined) m.hitstop = sp.hitstop;
  if (sp.push !== undefined) m.pushback = sp.push;
  if (sp.onHit) m.onHit = sp.onHit;
  if (sp.onCH) m.onCounterHit = sp.onCH;
  if (sp.launch !== undefined) m.launchVel = sp.launch;
  if (sp.kiCost !== undefined) m.kiCost = sp.kiCost;
  if (sp.cancel) m.cancelInto = sp.cancel;
  if (sp.window) m.cancelWindow = sp.window;
  if (sp.movement) m.movement = sp.movement;
  if (sp.invuln) m.invuln = sp.invuln;
  if (sp.armor) m.armor = sp.armor;
  if (sp.projectile) m.projectile = sp.projectile;
  if (sp.fx) m.fx = sp.fx;
  if (sp.cinematic) m.cinematic = sp.cinematic;
  if (sp.extra) Object.assign(m, sp.extra);
  return m;
}

/** standard L+K throw + its hold animation (damage lands on thrown frame 24) */
export function throwPair(prefix: string, name: string, dmg: number, el: Element = 'none'): MoveDef[] {
  return [
    mv({
      id: `${prefix}_throw`, name, kind: 'throw', input: 'L+K', s: 10, a: 2, r: 28, dmg, h: 'throw', str: 'heavy', el,
      blk: 0, hit: 0, box: { x: 150, y: 1100, len: 450, r: 230 }, wind: 'grabReach', ext: 'grabReach',
      extra: { followup: `${prefix}_throw_hold` }, ki: 10,
    }),
    holdMove(`${prefix}_throw_hold`, `${name} (hold)`, 'throw'),
  ];
}

/** internal animation-only move for a connected throw (40 frames) */
export function holdMove(id: string, name: string, kind: MoveDef['kind'], anim?: Array<[number, PoseName]>): MoveDef {
  return mv({
    id, name, kind, input: '', s: 1, a: 1, r: 38, dmg: 0, h: 'throw', str: 'heavy',
    anim: anim ?? [[0, 'throwGrab'], [16, 'throwGrab'], [22, 'throwToss'], [32, 'recover'], [38, 'idle']],
    extra: { internal: true }, cinematic: 'throw',
  });
}

/**
 * Ultimate cinematic move. `hits` are 0-based moveFrames of each ultimateHit.
 * Total length = `len` frames. Anim is built from a list of beats.
 */
export function ultCine(id: string, name: string, len: number, hits: number[], anim: Array<[number, PoseName]>, el: Element, fx: string): MoveDef {
  return mv({
    id, name, kind: 'ultimate', input: '', s: 1, a: 1, r: len - 2, dmg: 0, h: 'unblockable', str: 'super', el,
    anim, fx, cinematic: 'ultimate', extra: { internal: true, ultHits: hits },
  });
}

/** alternating flurry anim helper: poses cycle every `every` frames from `from` to `to` */
export function flurry(from: number, to: number, every: number, poses: PoseName[]): Array<[number, PoseName]> {
  const out: Array<[number, PoseName]> = [];
  let i = 0;
  for (let f = from; f < to; f += every) out.push([f, poses[i++ % poses.length]]);
  return out;
}

// common hitbox shapes (attacker local space, mm). Body radius ~300; jab reaches ~0.8 m from centre.
export const BOX = {
  jab: { x: 250, y: 1450, len: 450, r: 120 },
  high: { x: 250, y: 1480, len: 550, r: 130 },
  mid: { x: 250, y: 1150, len: 500, r: 140 },
  midKick: { x: 250, y: 1050, len: 600, r: 130 },
  low: { x: 250, y: 300, len: 500, r: 120 },
  sweep: { x: 200, y: 220, len: 700, r: 140 },
  launcher: { x: 200, y: 1150, len: 420, r: 170 },
  throw: { x: 150, y: 1100, len: 450, r: 230 },
} as const;
