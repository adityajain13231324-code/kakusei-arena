import { getChar } from '../sim';
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
};

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

export function portraitUrl(id: CharId, size = 256): string {
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

export function stars(n: number, max = 5): HTMLElement {
  const w = h('span', { class: 'stars' });
  for (let i = 0; i < max; i++) w.appendChild(h('i', { class: i < n ? 'on' : '' }, '★'));
  return w;
}
