/** Sound v2 dev check: every file in public/audio-manifest.json exists on disk, ids the layer uses exist, callouts resolve. Run: npm run test:audio */
// @ts-ignore node builtin (tsconfig has no node types)
import * as fs from 'node:fs';
import { CHARS } from '../src/data';
import { ALL_CHARS } from '../src/sim/index';
import { calloutType, findCallout } from '../src/audio/callouts';
import type { SoundDef } from '../src/audio/samples';

declare const process: { exit(code: number): never };
let fails = 0, passes = 0;
const check = (name: string, ok: boolean): void => { if (ok) passes++; else { fails++; console.log('  FAIL ' + name); } };

const man = JSON.parse(fs.readFileSync('public/audio-manifest.json', 'utf8')) as { sounds: Record<string, SoundDef> };
const defs = man.sounds;
let files = 0;
for (const id in defs) {
  const d = defs[id]!;
  check(`${id}: has files`, d.files.length > 0);
  check(`${id}: gain in range`, d.gain > 0 && d.gain <= 1.5);
  for (const f of d.files) { files++; check(`${f} exists`, fs.existsSync('public/' + f) && fs.statSync('public/' + f).size > 200); }
}
// ids the sample layer plays by name
const need = ['hit_light_flesh', 'hit_medium_flesh', 'hit_heavy_flesh', 'hit_light_metal', 'hit_medium_metal', 'hit_heavy_metal',
  'hit_light_stone', 'hit_medium_stone', 'hit_heavy_stone', 'block_light', 'block_medium', 'block_heavy', 'parry', 'guard_crush',
  'whoosh_jab', 'whoosh_punch', 'whoosh_kick', 'whoosh_heavy', 'whoosh_sword', 'whoosh_sword_long', 'foot_concrete', 'foot_wood', 'foot_stone',
  'fall_body', 'fall_knockdown_heavy', 'cloth', 'cloth_belt', 'ko_blast', 'fx_awaken', 'crowd_cheer', 'crowd_gasp', 'crowd_boo',
  'ui_hover', 'ui_select', 'ui_back', 'ui_confirm', 'ui_error', 'ui_slider_tick', 'ui_toggle', 'ui_open',
  'announcer_round_1', 'announcer_round_2', 'announcer_final_round', 'announcer_ready', 'announcer_fight', 'announcer_ko', 'announcer_double_ko',
  'announcer_perfect', 'announcer_time', 'announcer_draw_game', 'announcer_you_win', 'announcer_you_lose', 'announcer_wins', 'announcer_counter',
  'announcer_guard_crush', 'announcer_awakening', 'announcer_soul_realm', 'announcer_domain_expansion', 'announcer_realm_clash'];
for (const id of need) check(`layer id ${id} in manifest`, !!defs[id]);
for (const c of ALL_CHARS) {
  check(`announcer_name_${c}`, !!defs[`announcer_name_${c}`]);
  for (const t of ['intro', 'win', 'attack', 'hurt', 'ko']) check(`voice_${c}_${t}`, !!defs[`voice_${c}_${t}`]);
  // each fighter's base ultimate and realm resolve to a callout
  const ch = CHARS[c];
  const ult = ch.moves.find((m) => m.id === ch.ultimateId);
  const realm = ch.moves.find((m) => m.id === ch.realmId);
  check(`${c} ultimate callout`, !!ult && !!findCallout(defs, c, ult));
  check(`${c} realm callout`, !!realm && !!findCallout(defs, c, realm));
  check(`${c} has special callouts`, ch.moves.filter((m) => calloutType(m) === 'special' && findCallout(defs, c, m)).length >= 2);
}
console.log(`audio: ${files} files checked, ${passes} checks ok, ${fails} failed`);
if (fails) process.exit(1);
