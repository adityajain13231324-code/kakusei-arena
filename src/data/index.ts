/** Character registry + static (non-state) lookup tables. */
import type { CharDef, CharId, MoveDef } from '../sim/types';
import { KAITO } from './chars/kaito';
import { SHIORI } from './chars/shiori';
import { REN } from './chars/ren';
import { GORO } from './chars/goro';

export const CHARS: Record<CharId, CharDef> = { kaito: KAITO, shiori: SHIORI, ren: REN, goro: GORO };

const moveIndex: Record<string, Record<string, MoveDef>> = {};
for (const id of Object.keys(CHARS) as CharId[]) {
  const m: Record<string, MoveDef> = {};
  for (const mv of CHARS[id].moves) {
    if (m[mv.id]) throw new Error(`duplicate move id ${mv.id}`);
    m[mv.id] = mv;
  }
  moveIndex[id] = m;
}

export function charDef(id: CharId): CharDef {
  return CHARS[id];
}

export function moveDef(char: CharId, moveId: string): MoveDef | undefined {
  return moveIndex[char]?.[moveId];
}

export { KAITO, SHIORI, REN, GORO };
