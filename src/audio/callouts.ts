// Move id -> voice-line id matching for Sound v2 (pure functions; data is read-only here).
import type { CharId, MoveDef } from '../sim/types';
import type { SoundDef } from './samples';

export const slug = (s: string): string => s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export type CalloutType = 'special' | 'ultimate' | 'realm';

export function calloutType(m: MoveDef): CalloutType | '' {
  if (m.realm) return 'realm';
  if (m.kind === 'ultimate') return 'ultimate';
  if (m.kind === 'special' || m.kind === 'ki') return 'special';
  return '';
}

/**
 * Find the fighter's voice line for a move by matching the move name with the line text
 * (manifest `text`, e.g. "Blaze Knuckle!"). Follow-up moves without an input (counter cuts, internal hits) get none.
 */
export function findCallout(defs: Record<string, SoundDef>, char: CharId, m: MoveDef): string {
  const type = calloutType(m);
  if (!type) return '';
  if (!m.input && type !== 'realm') return '';
  const name = slug(m.name);
  let best = '', bestScore = 0;
  for (const id in defs) {
    const d = defs[id]!;
    if (d.fighter !== char || d.line_type !== type || !d.text) continue;
    const line = slug(d.text);
    let score = 0;
    if (line === name) score = 100;
    else if (name.endsWith('_' + line) || name.startsWith(line + '_')) score = 50 + line.length;
    else if (line.endsWith('_' + name) || name.includes('_' + line + '_')) score = 30 + line.length;
    else if (line.length > 8 && line.split('_').every((w) => name.split('_').includes(w))) score = 20 + line.length;
    if (score > bestScore) { best = id; bestScore = score; }
  }
  return best;
}
