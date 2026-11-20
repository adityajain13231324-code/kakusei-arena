# KAKUSEI ARENA — Plan v3: "Season 1"

## Goal
Ship **KAKUSEI ARENA Season 1**: 9 fighters, cinematic "Soul Realm" ultimates on par with the biggest anime moments, a smooth fightkaro-level UI, live on Vercel + the Web Games hub, playable online with friends.

**Done when:**
- Crossover Pack (5) playable, then 9 original fighters (4 current + 5 new headliners), each with a showstopper signature system, Awakening, Ultimate and a Soul Realm ultimate.
- Every menu and transition runs at 60 fps on an Iris Xe laptop and a mid-range phone, first load < 10 s.
- Online rooms tested between 2 real devices; no desyncs over 20 matches.
- 10 friends play it without being told how.


## ★ PRIORITY: Crossover Pack (owner says: private/local game, licensed characters)
Five crossover fighters, built on the same systems as the current roster. **Claude builds the kits** (moves, frame data, mechanics, AI, VFX, sound, UI text). **Models come from the owner** (licensed assets): Claude does not create or draw the characters' looks. Until a model is dropped in, the fighter uses a neutral mannequin body.

**Model drop-in spec:** `public/characters/<id>/model.glb` — humanoid, Mixamo-style bone names (or standard Mixamo rig), A- or T-pose, metres, Y-up, ≤ 30k tris, one material/atlas preferred; optional `tex_awakened.png` (same UVs) and extra meshes for forms (`form_titan.glb`, `form_gear4.glb`, …). The loader already handles Mixamo prefixes and extra bones.

| Fighter | Style | Signature systems | Specials | Awakening | Ultimate / Soul Realm |
|---|---|---|---|---|---|
| **Gojo** (`gojo`) | Zoner / control | **Infinity**: projectiles slow down near him; first hit each round is nullified (shimmer). Blink teleport. | *Blue* (pull orb, drags opponent in), *Red* (point-blank repel blast, wall splat), *Blink* (teleport behind), *Six Eyes counter* | **Blindfold off**: faster Ki, sees through vanish/teleports (auto-guard 1 hit) | Ult: **Hollow Purple** (merging blue+red → huge beam, clash-capable). Soul Realm: **Domain Expansion: Infinite Void** — black-and-star void swallows the arena, opponent frozen ~1.5 s (scaled damage, once per match) |
| **Naruto** (`naruto`) | Rushdown / pressure | **Shadow Clones**: up to 2 clones that copy his next attack from other angles | *Rasengan* (dash orb, launches), *Shadow Clone Jutsu*, *Clone Rush* (clones grab + throw), *Rasen-Shuriken* (Ki projectile, multi-hit) | **Sage Mode** → at low HP **Nine-Tails Chakra Mode** (golden aura, speed + new moves) | Ult: **Rasengan barrage** with clones. Soul Realm: **Tailed Beast Bomb** arena blast |
| **Eren** (`eren`) | Mobility + transformation | **ODM gear**: grapple-dash in any direction, air blade strikes | *Spinning slash*, *Grapple dash*, *Thunder Spear* (delayed blast), *Hardened fist counter* | **Titan Shift**: lightning strike → 10 s in Titan form (needs `form_titan.glb`, 4–5 m, armored, slow heavy moveset, camera pulls back) | Ult (Titan form): **Hardened Titan smash**. Soul Realm: **Paths** — sand-and-light world, Titan army stomp |
| **Luffy** (`luffy`) | Long-reach brawler | **Rubber body**: stretch limbs = longest-range normals; bounces off walls | *Gum-Gum Pistol* (long punch), *Gatling*, *Rocket* (stretch dash), *Bell* (headbutt) | **Gear Second** (speed, steam) → low HP **Gear Fourth** (bounce form, `form_gear4.glb` optional) | Ult: **King Kong Gun**. Soul Realm: **Gear Fifth** — cartoon-physics world (everything squash-and-stretch, his hits bounce opponents around) |
| **Zoro** (`zoro`) | Sword footsies | **Three-Sword Style** stance: swap 1/2/3-sword strings | *Oni Giri* (dash-through slash), *Tatsumaki* (tornado launcher), *Pound Cannon* (flying slash projectile), *Lion's Song* (iai counter) | **Asura**: 9-sword afterimage form, every slash hits twice | Ult: **Asura: Ichibugin**. Soul Realm: **King of Hell** slash storm. Joke taunt: walks off the wrong way |

**Done when:** all 5 playable in every mode, each signature mechanic works and is deterministic (rollback tests green), Infinite Void / Titan Shift / Gear Fifth cinematics run at 60 fps, balance 40–60% vs the current 4, CPU personalities for each.

**Order:** Gojo → Naruto → Zoro → Luffy → Eren (Eren last: Titan form needs a second model + camera mode).

## 5 new original headliners (later, after the Crossover Pack)
| # | Fighter | Archetype | Signature showstopper | Ultimate |
|---|---|---|---|---|
| 5 | **MIKA "VOLT" RAIDEN** | Lightning speedster | **OVERCLOCK** — 4 s where the world runs at half speed for the opponent; Mika leaves hitting afterimages | *Railgun Heart*: coin flick → hyper-speed beam (clash-capable) |
| 6 | **LYRA ASHVEIL + KITSU** | Spirit summoner / puppet | **SPIRIT FUSION** — Awakening fuses Lyra with her fox into a nine-tailed armored form with a new moveset | *Lantern Festival*: hundreds of lanterns dive as fox-fire |
| 7 | **DAICHI "NULL" KUROGANE** | Cursed-arm shifter | **COLOSSUS SHIFT** — a void-lightning strike turns him into a 4 m obsidian colossus for 10 s: slow, armored, stomps shake the arena, camera pulls back | *Singularity*: black hole crush |
| 8 | **SERAPH-09** | Android angel | **FLIGHT STANCE** — hovers, air-dashes, fights from angles nobody else can | *Judgment Array*: orbital satellite barrage |
| 9 | **EMPEROR OBORO** | Demon king (boss → playable) | **THREE FORMS** — human → horned armor → giant shadow (boss only for the 3rd) | *Throne of Night*: the moon falls |

Chapter 3 later: Aiko Gearhart (mecha inventor), Koji Tanaka (delinquent brawler).

## New roster-wide system: SOUL REALM
- Unlocked while Awakened with 3 Ki bars. The fighter's **awakened ultimate** becomes a **Soul Realm**: a 1.5 s cinematic, then for 6 s the stage itself transforms into that fighter's inner world with one rule twist.
- Realms: Kaito *Sun Forge* (blocked hits still burn), Shiori *Moonless Void* (she turns invisible between attacks), Ren *Petal Storm Dojo* (his quick draws cancel into each other), Goro *Mountain Temple* (permanent armor), Mika *Static Sky* (Overclock refills), Lyra *Foxfire Shrine* (Kitsu attacks twice), Daichi *Event Horizon* (opponent pulled toward him), Seraph *Orbit* (zero-g, slower juggles), Oboro *Throne of Night* (opponent's Ki drains).
- If both players open a realm at once → **REALM CLASH**: split-screen worlds grinding into each other, mash + timing rings, winner's realm wins.
- Tech: stage swap via dissolve shader + skybox/fog/color-grade swap + realm props layer; letterbox bars, scripted camera track, music stinger. Deterministic: rule twists live in the sim; visuals in render.

## UI: better + smoother
- **Motion system:** one easing set, every screen enters/exits with GPU-only transforms (translate/scale/opacity), staggered card reveals, no layout thrash; 60 fps menus.
- **Select screen:** fighters play a short intro pose on hover, name slam animation, ultimate preview clip (in-engine loop) in the info panel, skins/colors row.
- **VS screen:** cinematic split with speed lines, both fighters' intro lines (text + voice stinger), loading bar with tips.
- **HUD:** smooth HP drain with shake on big hits, Ki bar fill animation, Awakening/Soul Realm ready glow, damage-number toggle, cleaner combo counter.
- **Loading:** preload next fighter while on select; shader pre-warm on VS screen; first load target < 10 s, menus < 100 ms response.
- **Feel:** button hover/press sounds everywhere, controller rumble, phone haptics, pause blur.

## More ideas (pick what you like)
1. **Story mode** — manga-panel chapters between fights, one arc per fighter.
2. **Daily challenges + combo trials** — 10 trials per fighter, daily featured trial.
3. **Ranked online** — Elo + seasons + leaderboard (needs a small server).
4. **Spectate & replays** — replays are just inputs (tiny); share a replay code.
5. **Skins & color palettes** — unlock by playing.
6. **Photo mode** — pause, free camera, anime filters, share image.
7. **Tournament mode** — 4/8-player bracket with room codes.
8. **Hub integration** — card on randomwebgames.vercel.app, PWA install.
9. **Voice packs** — record friends; EN / Hinglish / "anime grunts".
10. **Assist calls (2v2 tag)** — later.

## Phases
| Phase | What | Owner | Done when |
|---|---|---|---|
| **P0 Finish v2** | Merge renderer polish + guard-crush wiring (branch `claude-wip-2`), verify poses/camera/stages, re-publish preview | Claude | live match screenshots look polished, all tests green |
| **P1 Deploy** | Vercel deploy, hub card, real-device online test | You + Claude | friend plays online from another city |
| **P2 UI motion pass** | Motion system, select/VS/HUD upgrades, loading + preload | Claude (Sonnet) | screen recordings smooth at 60 fps on laptop + phone |
| **P3 Soul Realm system** | Sim rules + render realm swap for current 4 | Claude (Opus) | each of the 4 realms works, Realm Clash works, rollback tests green |
| **P3b Crossover Pack** | Gojo → Naruto → Zoro → Luffy → Eren kits (Claude) + licensed models dropped in by owner | Claude + owner | see Crossover Pack 'Done when' |
| **P4 Mika + Lyra** | Models (Astra), moves/data/AI/VFX/audio (Claude) | Astra + Claude | both playable, balanced 40–60% |
| **P5 Daichi (Colossus) + Seraph** | Colossus needs a 2nd skeleton/model + camera mode; Seraph flight | Astra + Claude | both playable |
| **P6 Oboro** | Boss with 3 forms, Arcade final fight, playable after unlock | Astra + Claude | arcade ends with Oboro |
| **P7 Polish + launch** | Story panels (optional), trials, balance, perf, trailer | All | Season 1 launch |

## Budgets & rules
Same golden rules as `CONTINUE.md §4` (determinism, contracts, original designs, 60 fps, tests before push). Colossus model ≤ 30k tris; realm swap must not drop frames (pre-built + pre-warmed during VS screen).

## Usage note
Claude's helper agents hit the weekly usage limit (resets Nov 22, 4:30 am IST). Work resumes from P0 then.

## ★ NEXT: Polish Pass "P8" (Nov 19 owner feedback)
Goal: the fight is the star — real animation, real sound, clean small HUD, full graphics settings.

| # | Track | What | Owner |
|---|---|---|---|
| 1 | **Animation v2** | Clip-based animation with the pose system as fallback: idle/walk/run/dash/hit/knockdown/getup/win/lose/intro + every attack as real keyframed clips (Mixamo / Cascadeur / Blender keyframes), blended (crossfade 2–4 f), root motion off (sim drives position), anticipation + follow-through + smear frames, per-character idle stances, secondary motion (hair/cloth springs). Move data gets optional `clip` + timing map so active frames still match hitboxes. | Claude (Opus) code; clips from owner/Astra |
| 2 | **Models** | Owner's licensed crossover models dropped in + checked; Astra: Kitsu redo, crowd, props, remaining originals. Optional Meshy on owner's PC. | Owner + Astra |
| 3 | **Compact HUD** | Smaller HP/Ki bars hugging the top/bottom edges, timer smaller, commentator panel collapsed to a one-line ticker by default (toggle "Broadcast: Off / Ticker / Full"), callouts shorter + smaller, training panel collapsible, HUD scale slider (70–120%) + safe-area aware. | Claude (Sonnet) |
| 4 | **Sound v2** | Real recorded/sample SFX library (CC0 packs bundled, e.g. Kenney / Sonniss-free / Freesound CC0) layered with the synth: impacts by strength × material, whooshes per limb, footsteps, body falls, cloth, blocks, parries, crowd reactions (cheer/gasp/boo), UI. Voice lines per fighter (intro, specials, ultimate, win, hurt) + announcer ("ROUND 1", "FIGHT", "K.O.", "PERFECT", "DOMAIN EXPANSION"), optional AI-generated (ElevenLabs connector, owner's credits). Mixer: master/music/SFX/voice/announcer sliders, ducking, reverb per stage. | Claude (Sonnet) + owner approval for generated audio |
| 5 | **Graphics settings** | Presets (Low/Medium/High/Ultra/Custom) + toggles: render scale 50–150%, FPS cap (30/60/120/unlimited), shadows (off/low/high), outlines, post FX (bloom, impact frames, speed lines, color grade), particles (low/med/high), crowd density, realm sky quality, texture res (1024/2048), anti-aliasing, show FPS, auto-benchmark on first launch. | Claude (Sonnet) |
| 6 | **Feel** ✓ | Hit sparks per strength, better hitstop curves, camera punch on heavy hits, slow-mo KO replay, intros + win poses per fighter, parry flash. Done 2026-11-21 (see CONTINUE.md status). | Claude |
| 7 | **Ship** | Vercel deploy + hub card, real-device perf (Iris Xe + phone), online test 2 devices. | Owner + Claude |
