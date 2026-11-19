/** Character registry + static (non-state) lookup tables. */
import type { CharDef, CharId, MoveDef } from '../sim/types';
import { KAITO } from './chars/kaito';
import { SHIORI } from './chars/shiori';
import { REN } from './chars/ren';
import { GORO } from './chars/goro';
import { GOJO } from './chars/gojo';
import { NARUTO } from './chars/naruto';
import { ZORO } from './chars/zoro';
import { LUFFY } from './chars/luffy';
import { EREN } from './chars/eren';

export const CHARS: Record<CharId, CharDef> = {
  kaito: KAITO, shiori: SHIORI, ren: REN, goro: GORO,
  gojo: GOJO, naruto: NARUTO, zoro: ZORO, luffy: LUFFY, eren: EREN,
};

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

export { KAITO, SHIORI, REN, GORO, GOJO, NARUTO, ZORO, LUFFY, EREN };
