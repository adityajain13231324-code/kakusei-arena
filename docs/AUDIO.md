# Audio (Sound v2)

Everything is bundled under `public/` (no runtime network assets). Samples layer on top of the synth; if any file is missing or fails to decode, the synth / procedural music / browser speech plays instead, silently.

## Library (bundled)
- `public/sfx/*.mp3`, `public/voice/*.mp3`, index `public/audio-manifest.json` (sound id -> files, category, gain; voice lines carry fighter, line_type, text).
- Credits: `public/CREDITS-audio.md`. Generators: `tools/audio/`. Check: `npm run test:audio` (every manifest file exists).

## Owner music: `public/music/`
Drop files in, no code change. Extensions tried in order: `.mp3`, `.ogg`, `.wav`. A file replaces the procedural track as soon as it is found (short crossfade).

| File name (without extension) | Plays |
|---|---|
| `music_menu` | title / menus |
| `music_char_select` | character select (falls back to the menu track) |
| `music_rooftop` | rooftop stage |
| `music_shrine` | shrine stage |
| `music_training` | training stage |
| `music_market` | market stage (when that stage exists; falls back to menu) |
| `music_victory` | results screen, plays once (not looped) |
| `music_oboro_boss` | Oboro boss fight (falls back to rooftop) |
| `realm_infinite_void`, `realm_tailed_beast_bomb`, `realm_king_of_hell`, `realm_gear_fifth`, `realm_paths`, `realm_sun_forge`, `realm_moonless_void`, `realm_petal_storm`, `realm_mountain_temple` | Soul Realm theme, layered over (and ducking) the stage track; looped |

Loop points: optional `public/music/music.json`, seconds from the file start. The loop always starts at 0.
```json
{ "music_menu": { "loopEnd": 93.2 }, "realm_paths": 61.5 }
```
No entry = loop the whole file. The music ducks under announcer and fighter voice lines.

## Owner announcer lines: `public/voice/ann_<line>.(mp3|wav)`
Same line name as the bundled `announcer_<line>.mp3`; the owner file overrides it. Lines:
`round_1 round_2 round_3 final_round ready fight ko double_ko perfect time draw_game p1_wins p2_wins you_win you_lose wins counter guard_crush awakening soul_realm domain_expansion realm_clash` and `name_<char>` / `win_<char>` for `kaito shiori ren goro gojo naruto zoro luffy eren`.
Example: `public/voice/ann_round_1.wav`, `public/voice/ann_name_kaito.mp3`.

## Mixer
Settings -> Audio: master, music, sound effects, fighter voices, announcer. Reverb per stage: training short room, rooftop open-air slapback, shrine wooden hall, Soul Realms big wash.
