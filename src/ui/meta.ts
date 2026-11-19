import { getChar } from '../sim';
import { getLoadedCharacter } from '../render/fighter/assets';
import { ALL_CHARS, CROSSOVER_CHARS } from '../sim/types';
import type { CharId, StageId } from '../sim/types';
import { h } from './dom';

export interface CharMeta {
  id: CharId; name: string; given: string; family: string; title: string; tags: string[];
  stars: number; color: string; kanji: string; blurb: string;
}

export const META: Record<CharId, CharMeta> = {
  kaito: {
    id: 'kaito', name: 'KAITO HOMURA', given: 'KAITO', family: 'HOMURA', title: 'The Hot-Blooded Hero',
    tags: ['All-rounder', 'Fire'], stars: 2, color: '#ff4a2e', kanji: '烈',
    blurb: 'Best first pick. Every landed special feeds a Heat stack that powers up the next Blaze move.',
  },
  shiori: {
    id: 'shiori', name: 'SHIORI KAGEYAMA', given: 'SHIORI', family: 'KAGEYAMA', title: 'The Shadow Ninja',
    tags: ['Mix-up', 'Shadow'], stars: 3, color: '#a45bff', kanji: '影',
    blurb: 'Fast and fragile. Leaves a shadow clone that repeats your next attack a moment later.',
  },
  ren: {
    id: 'ren', name: 'REN TSUKISHIRO', given: 'REN', family: 'TSUKISHIRO', title: 'The Silent Swordsman',
    tags: ['Footsies', 'Blade'], stars: 4, color: '#38c6ff', kanji: '刃',
    blurb: 'Longest reach, disjointed hitboxes. Hold S for Sheath Stance, release for a lightning quick draw.',
  },
  goro: {
    id: 'goro', name: 'GORO ISHIGAMI', given: 'GORO', family: 'ISHIGAMI', title: 'The Gentle Giant',
    tags: ['Grappler', 'Earth'], stars: 3, color: '#ffb02e', kanji: '岩',
    blurb: 'Command grabs, stone armor and huge damage. Slow, but one read ends the round.',
  },
  // ---- Crossover Pack (licensed characters; private build)
  gojo: {
    id: 'gojo', name: 'SATORU GOJO', given: 'GOJO', family: 'SATORU', title: 'The Strongest',
    tags: ['Zoner', 'Control', 'Void'], stars: 4, color: '#5aa8ff', kanji: '無',
    blurb: 'Infinity slows every projectile near him and stops the first hit each round. Blue drags foes in, Red blasts them into the wall, Blink puts him behind you.',
  },
  naruto: {
    id: 'naruto', name: 'NARUTO UZUMAKI', given: 'NARUTO', family: 'UZUMAKI', title: 'The Hyperactive Ninja',
    tags: ['Rushdown', 'Pressure', 'Wind'], stars: 3, color: '#ff8a1f', kanji: '螺',
    blurb: 'Shadow clones flank the opponent and copy his next attack. Rasengan launches, Clone Rush grabs. Low on health in Sage Mode? Nine-Tails Chakra Mode.',
  },
  zoro: {
    id: 'zoro', name: 'RORONOA ZORO', given: 'ZORO', family: 'RORONOA', title: 'The Pirate Hunter',
    tags: ['Footsies', 'Stances', 'Blade'], stars: 4, color: '#3fbf5f', kanji: '斬',
    blurb: 'Swap between one, two and three swords for different strings. Oni Giri cuts straight through, Lion\'s Song counters. Asura makes every slash land twice.',
  },
  luffy: {
    id: 'luffy', name: 'MONKEY D. LUFFY', given: 'LUFFY', family: 'MONKEY D.', title: 'The Rubber Captain',
    tags: ['Long reach', 'Brawler', 'Rubber'], stars: 2, color: '#e8322e', kanji: '護',
    blurb: 'Rubber limbs give him the longest normals in the game. Gear Second speeds him up, Gear Fourth hits like a cannon, Gear Fifth turns the fight into a cartoon.',
  },
  eren: {
    id: 'eren', name: 'EREN YEAGER', given: 'EREN', family: 'YEAGER', title: 'The Attack Titan',
    tags: ['Mobility', 'Transformation', 'Lightning'], stars: 5, color: '#8fb35a', kanji: '巨',
    blurb: 'ODM gear grapple dashes and a delayed Thunder Spear. Awaken to become the Attack Titan for 10 seconds: huge, armored and slow.',
  },
};

// ---------------------------------------------------------------- ultimates (one-line pitch per fighter)
export const ULT_DESC: Record<CharId, string> = {
  kaito: 'Rushes in with a hundred blazing punches, then ends it with a phoenix-shaped beam. Big damage, bigger hair.',
  shiori: 'Vanishes into a moonless void and carves twelve shadow slashes before anyone can blink.',
  ren: 'One sheathed breath, a thousand petals. A single draw cuts through everything in front of him.',
  goro: 'Grabs the opponent, leaps into the sky and returns as a falling mountain. Please clap.',
  gojo: 'Merges Blue and Red into Hollow Purple: an imaginary mass that erases everything in its path.',
  naruto: 'Calls a crowd of shadow clones for a Rasengan barrage that launches the opponent skyward.',
  zoro: 'Nine swords, three heads, one demon: Asura Ichibugin. A slash for every head.',
  luffy: 'Gear Fourth\'s King Kong Gun: a fist the size of a house.',
  eren: 'A barrage of ODM blade cuts to the nape. Awakened: Hardened Titan Smash cracks the floor.',
};
// ---------------------------------------------------------------- Soul Realms (select info panel, HUD title card, move list)
export interface RealmMeta {
  kind: string;
  /** small line above the name on the title card */
  kicker: string;
  name: string;
  /** big brush kanji behind the name */
  jp: string;
  /** one-line rule twist */
  desc: string;
  color: string;
}
export const REALM: Partial<Record<CharId, RealmMeta>> = {
  gojo: { kind: 'infinite_void', kicker: 'DOMAIN EXPANSION', name: 'INFINITE VOID', jp: '無量空処', color: '#7cc4ff', desc: 'Freezes the opponent in a flood of information. Your damage is capped at 35% of their HP.' },
  naruto: { kind: 'tailed_beast_bomb', kicker: 'NINE-TAILS LINK', name: 'TAILED BEAST BOMB', jp: '尾獣玉', color: '#ff9a2a', desc: 'An unblockable arena blast, then shadow clones keep joining the fight.' },
  zoro: { kind: 'king_of_hell', kicker: 'ASURA UNSHEATHED', name: 'KING OF HELL', jp: '閻魔', color: '#4ae07a', desc: 'Blocked slashes still cut, and their guard drains twice as fast.' },
  luffy: { kind: 'gear_fifth', kicker: 'THE SUN GOD AWAKENS', name: 'GEAR FIFTH', jp: '五', color: '#ffffff', desc: 'Cartoon physics: floaty juggles and extra floor bounces.' },
  eren: { kind: 'paths', kicker: 'THE RUMBLING', name: 'THE PATHS', jp: '道', color: '#b8d96a', desc: 'A Titan army stomps the floor every second. Crouch or jump it.' },
};
export function realmOfKind(kind: string): RealmMeta | undefined {
  for (const id of CROSSOVER_CHARS) if (REALM[id]?.kind === kind) return REALM[id];
  return undefined;
}

/** Passive / form notes shown on top of a crossover fighter's move list */
export const KIT_NOTES: Partial<Record<CharId, string[]>> = {
  gojo: ['INFINITY: slows enemy projectiles near him and auto-guards the first hit each round (the ∞ icon under your health bar).', 'SIX EYES (awakened): Ki x2, reads one teleport, next strike is auto-guarded.', 'BLINK costs 50 Ki. Hold the ultimate input with 3 Ki bars awake for INFINITE VOID.'],
  naruto: ['SHADOW CLONES (4S / 214S): up to 2 clones flank the opponent and copy your next attack at 40% damage. Any hit dispels them.', 'SAGE MODE (awakened). Under 20% HP: NINE-TAILS chakra mode, faster, with Kurama moves.', 'CLONE RUSH needs a clone out. With 3 Ki bars awake: TAILED BEAST BOMB.'],
  zoro: ['TAP S (5S) to cycle SANTORYU, ITTORYU and NITORYU. Only the H strings change.', 'ASURA (awakened): every slash hits twice.', 'With 3 Ki bars awake: KING OF HELL.'],
  luffy: ['Longest normals in the game. Slightly slower startup.', 'GEAR SECOND (awakened), GEAR FOURTH below 20% HP, with armored Kong Gun and Leo Bazooka.', 'With 3 Ki bars awake: GEAR FIFTH.'],
  eren: ['TITAN SHIFT (awakened): 10 seconds as the Attack Titan. Huge, armored, slow, takes 75% damage.', 'Thunder Spear flies harmless, then detonates. Hardened Fist is a counter stance.', 'With 3 Ki bars awake: THE PATHS.'],
};

export function ultName(id: CharId): string {
  try {
    const c = getChar(id);
    const m = c.moves.find((x) => x.id === c.ultimateId);
    if (m?.name) return m.name;
  } catch { /* sim not ready */ }
  return 'Ultimate';
}

// ---------------------------------------------------------------- chapter 2 (locked, coming soon)
export interface FutureMeta { id: string; name: string; short: string; color: string; boss?: boolean }
export const CHAPTER2: FutureMeta[] = [
  { id: 'mika', name: "MIKA 'VOLT' RAIDEN", short: 'MIKA', color: '#ffe14a' },
  { id: 'lyra', name: 'LYRA ASHVEIL', short: 'LYRA', color: '#ff7ac8' },
  { id: 'daichi', name: "DAICHI 'NULL' KUROGANE", short: 'DAICHI', color: '#8e9bb5' },
  { id: 'aiko', name: 'AIKO GEARHART', short: 'AIKO', color: '#ff9a3d' },
  { id: 'seraph', name: 'SERAPH-09', short: 'SERAPH', color: '#7df9ff' },
  { id: 'koji', name: 'KOJI TANAKA', short: 'KOJI', color: '#6ee06e' },
  { id: 'oboro', name: 'EMPEROR OBORO', short: 'OBORO', color: '#b0305a', boss: true },
];

export interface StageMeta { id: StageId; name: string; sub: string; kanji: string }
export const STAGES: StageMeta[] = [
  { id: 'rooftop', name: 'NEON ROOFTOP', sub: 'Night city / rain-slick steel', kanji: '夜' },
  { id: 'shrine', name: 'SAKURA SHRINE', sub: 'Falling petals / stone lanterns', kanji: '桜' },
  { id: 'training', name: 'TRAINING GRID', sub: 'The void / training only', kanji: '道' },
];

export function charName(id: CharId): string {
  try { return getChar(id).name || META[id].name; } catch { return META[id].name; }
}
export function charTitle(id: CharId): string {
  try { return getChar(id).title || META[id].title; } catch { return META[id].title; }
}
export function charColor(id: CharId): string { return META[id].color; }

// ---------------------------------------------------------------- portraits
let snapFn: ((id: CharId, size: number) => string) | null = null;
const snapCache = new Map<string, string>();
export function setPortraitSource(fn: ((id: CharId, size: number) => string) | null): void { snapFn = fn; }

/** true if the fighter has no real model yet (grey mannequin stand-in): then the card shows a stylized silhouette instead */
export function isMannequin(id: CharId): boolean {
  try { return !!(getLoadedCharacter(id, 2048) ?? getLoadedCharacter(id, 1024))?.mannequin; } catch { return false; }
}

export function portraitUrl(id: CharId, size = 256): string {
  if (isMannequin(id)) return '';
  const key = id + size;
  const c = snapCache.get(key);
  if (c) return c;
  if (!snapFn) return '';
  try {
    const u = snapFn(id, size);
    if (u && u.startsWith('data:')) { snapCache.set(key, u); return u; }
  } catch { /* renderer not ready */ }
  return '';
}

const SIL =
  '<svg viewBox="0 0 100 120" preserveAspectRatio="xMidYMax meet"><path d="M50 14c-12 0-20 9-20 22 0 8 3 14 8 18-14 4-26 12-28 30l-2 36h84l-2-36c-2-18-14-26-28-30 5-4 8-10 8-18 0-13-8-22-20-22z" /></svg>';

export function fillPortrait(el: HTMLElement, id: CharId, size = 256): void {
  el.dataset.id = id;
  el.dataset.size = String(size);
  el.style.setProperty('--c', charColor(id));
  el.classList.toggle('xo', CROSSOVER_CHARS.includes(id));
  const k = el.querySelector('.kanji');
  if (k) k.textContent = META[id].kanji;
  const img = el.querySelector('img') as HTMLImageElement | null;
  if (img) {
    const u = portraitUrl(id, size);
    if (u) { if (img.src !== u) img.src = u; el.classList.add('has'); } else { img.removeAttribute('src'); el.classList.remove('has'); }
  }
}

export function portraitEl(id: CharId, cls = '', size = 256): HTMLElement {
  const el = h('div', { class: 'portrait ' + cls }, h('div', { class: 'sil', html: SIL }), h('span', { class: 'kanji' }), h('img', { alt: '', draggable: 'false' }));
  fillPortrait(el, id, size);
  return el;
}

/** Re-fill any portrait that still shows the fallback silhouette. */
export function refreshPortraits(): void {
  document.querySelectorAll<HTMLElement>('.portrait[data-id]:not(.has)').forEach((el) => {
    fillPortrait(el, el.dataset.id as CharId, Number(el.dataset.size) || 256);
  });
}

export function cardOrder(): (CharId | 'random')[] {
  const base = ALL_CHARS.filter((c) => !CROSSOVER_CHARS.includes(c));
  return [...base, 'random', ...ALL_CHARS.filter((c) => CROSSOVER_CHARS.includes(c))];
}

export function stars(n: number, max = 5): HTMLElement {
  const w = h('span', { class: 'stars' });
  for (let i = 0; i < max; i++) w.appendChild(h('i', { class: i < n ? 'on' : '' }, '★'));
  return w;
}
