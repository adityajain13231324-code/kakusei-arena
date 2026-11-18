# KAKUSEI ARENA — Master Project Prompt & Step-by-Step Planner

> **A 3D-ish, Tekken-style anime fighting game that runs in the browser.**
> Cel-shaded anime fighters, flashy powers, transformations, cinematic ultimates, beam clashes, rollback online play with room codes — all at 60 fps on an integrated-GPU laptop and a mid-range phone.

*Working title: **KAKUSEI ARENA** (覚醒 = "awakening"). Rename freely.*

---

## 0. How to use this file

This file is two things at once:

1. **A master prompt** — paste Section 1 into any AI coding agent (Claude Code, Cursor, etc.) together with this whole file. The agent builds the game phase by phase.
2. **A planner** — Sections 4 to 18 are a checklist. Tick boxes as you go. Each phase ends with a "Done when" test so you always know if a phase is truly finished.

Golden rule: **one phase at a time.** Do not start a new phase until the "Done when" list of the current one passes.

---

## 1. MASTER PROMPT (copy-paste this to your AI agent)

```text
You are a senior gameplay engineer and technical artist. Build "KAKUSEI ARENA",
a browser-based 3D anime fighting game in the style of Tekken (3D movement,
sidestep, juggles, wall splats) mixed with anime-fighter flair (ki meter,
transformations, cinematic ultimates, beam clashes).

Follow the attached planner (KAKUSEI_ARENA_PROJECT_PLAN.md) EXACTLY:
- Work one phase at a time. At the end of each phase, list what you built,
  show how to run it, and check every "Done when" item. Wait for my OK before
  the next phase.
- Tech: Vite + TypeScript (strict), three.js (WebGPURenderer with automatic
  WebGL2 fallback, TSL for shaders), @pixiv/three-vrm for anime characters,
  three.quarks for VFX, Howler.js for audio. No heavy game engine.
- The SIMULATION must be deterministic and fully separate from RENDERING:
  fixed 60 Hz tick, integer/fixed-point math for gameplay, seeded PRNG, no
  Date.now()/Math.random() in sim code, whole game state serializable to a
  byte array (needed for rollback netcode and replays).
- All moves, hitboxes, frame data, and character stats live in JSON data
  files, not hard-coded logic.
- Performance budget is law: 60 fps on an Intel Iris Xe class laptop and a
  mid-range Android phone. Check the budget table in Section 13 every phase.
- Write clean, modular code. Add a debug overlay (F1) from day one: fps,
  frame time, draw calls, triangles, sim tick, rollback count, hitboxes.
- Characters are ORIGINAL anime-style fighters defined in Section 7. Do not
  copy or imitate existing anime characters, names, logos, or designs.
- Use placeholder capsules until the art pipeline (Phase 5) is ready.
- When unsure, pick the simpler option, note it in DECISIONS.md, and continue.
```

---

## 2. Game vision (one page)

| Pillar | What it means in practice |
|---|---|
| **Feels like an anime episode** | Impact frames, speed lines, hitstop, camera punches, hair turning white on Awakening, beam struggles, crater KOs. |
| **Plays like a real 3D fighter** | Frame data, sidestep vs. homing moves, launchers & juggles, wall splats, throws & breaks, punishes. Deep, not button-mash. |
| **Easy in, hard to master** | "Easy" control scheme (one-button specials) and "Pro" scheme (motion inputs) — same characters, same game. |
| **Instant & light** | Opens in a browser tab, no install, plays in < 10 s on first load, < 3 s after. Room-code online with a friend. |
| **Runs on a potato** | Integrated laptop GPUs and phones at 60 fps. Quality presets scale up for strong PCs. |

**Reference for feel & UX:** fightkaro.com (Sansad Showdown) — it is a 2D side-view satire fighter, but its UX is worth copying: a super meter, simple 4-button layout, touch stick + buttons, CPU difficulty levels, a boss, random select, landscape prompt, and online rooms via codes with a share link (WhatsApp / copy link). KAKUSEI ARENA takes that accessibility and adds real 3D movement and anime spectacle.

**Look & feel references (study, don't copy):** the Guilty Gear Xrd / Dragon Ball FighterZ "3D that looks 2D" art style (see Section 19 — the GDC talk is the bible for this), Tekken 8 for movement & wall systems, anime opening sequences for camera language.

---

## 3. A note on characters & IP (read once)

The roster in Section 7 is **original**: each fighter is built from a classic anime archetype (hot-blooded hero, shadow ninja, iaido swordsman, gentle-giant grappler…) so the game *feels* like a crossover of famous shonen series without copying any of them. That keeps the project safe to publish, share, monetize, and put on a portfolio — real anime characters and lookalike models are owned by their studios and get fan games taken down fast.

The **Character Slot System** (Phase 5) means any VRM/GLB humanoid can be dropped in. If you ever get a license, or design your own characters, they plug straight in.

---

## 4. Tech stack (researched, Nov 2026)

| Layer | Pick | Why |
|---|---|---|
| Build | **Vite + TypeScript** | Fast dev server, tree-shaking, easy code-split per character. |
| Renderer | **three.js r186+** (`three/webgpu`) | `WebGPURenderer` uses WebGPU when available and falls back to WebGL2 with the same API. Needs `await renderer.init()`. Pin the version — the node/TSL API still moves between releases. |
| Shaders | **TSL** (Three Shading Language) | Write a shader once in JS → compiles to WGSL (WebGPU) or GLSL (WebGL). Use it for the toon shader, outlines, impact-frame and speed-line effects. |
| Anime characters | **VRM + @pixiv/three-vrm** | VRM is the standard anime avatar format; three-vrm handles MToon toon materials, spring bones (hair/cloth jiggle), expressions. Has `MToonNodeMaterial` for the WebGPU path. |
| Character creation | **VRoid Studio** (free, Win/Mac) | Anime-style models without modeling experience; exports `.vrm`. |
| Animation base | **Mixamo** + **Quaternius Universal Animation Library (CC0)** + hand-keyed in **Blender** / **Cascadeur** | Mixamo still works and is free, but is in maintenance mode — keep CC0 alternatives ready. Fighting moves need custom keyframing for snappy frame data anyway. |
| Retarget | `vrm-mixamo-retarget` (npm) or Blender VRM add-on | Moves Mixamo FBX clips onto VRM skeletons. |
| AI assets (optional) | **Meshy** (text/image → 3D, auto-rig, animation API) | Fast props, stage pieces, rough concept models. Best rigging results from A-pose / T-pose characters. |
| VFX | **three.quarks** (+ quarks.art editor) | Unity-like particle system for three.js; one `BatchedRenderer` per scene batches all effects. Alternative for WebGPU-heavy effects: Three VFX (GPU compute particles). |
| Asset compression | **gltf-transform** CLI / **gltfpack** | Meshopt geometry (not Draco for animated characters), KTX2 textures for GPU memory. |
| Audio | **Howler.js** | Sprite sheets for SFX, WebAudio, mobile unlock handling. |
| Input | **Gamepad API** + keyboard + **nipplejs** (touch stick) | Arcade-stick & controller support plus phone touch. |
| Netcode | Custom GGPO-style rollback **or** `rollback-netcode` / `netplayjs` (npm) over **WebRTC** | P2P, no game server needed; tiny signaling server for room codes. Advanced: Rust `fortress-rollback` (GGRS fork) + Matchbox compiled to WASM. |
| Signaling | Tiny WebSocket server (Cloudflare Workers / Fly.io / Render free tier) or PeerJS cloud | Only used to connect peers; gameplay goes P2P. |
| Hosting | Cloudflare Pages / Netlify / Vercel / itch.io | Static hosting, global CDN, free. |
| PWA | Vite PWA plugin | "Add to home screen", offline after first load, landscape lock. |

---

## 5. Architecture overview

```
┌──────────────────────────────────────────────────────────────┐
│                       BROWSER TAB                            │
│                                                              │
│  INPUT LAYER  ──►  INPUT BUFFER (per player, per frame)      │
│  keyboard / gamepad / touch       │                          │
│                                   ▼                          │
│  ┌───────────── DETERMINISTIC SIM (60 Hz) ─────────────┐     │
│  │ GameState (plain data, serializable)                │     │
│  │  ├ fighters: pos, vel, facing, state, frame, hp,    │     │
│  │  │  ki, awakening, combo counter, juggle gravity    │     │
│  │  ├ projectiles, summons, clash state               │     │
│  │  ├ round timer, stage walls, rng seed              │     │
│  │ Systems: input → state machine → movement →         │     │
│  │  hit detection → hit resolution → meters → round    │     │
│  └─────────────────────────────────────────────────────┘     │
│        │ snapshot (read-only)          ▲ save/load state      │
│        ▼                               │                      │
│  RENDER LAYER (variable fps)     ROLLBACK NETCODE             │
│  three.js scene, VRM models,     WebRTC DataChannel           │
│  animation sampling by sim       predict → rollback →         │
│  frame, VFX, camera, HUD         resimulate                   │
│        │                                                      │
│  AUDIO LAYER (event queue from sim, deduped on rollback)      │
└──────────────────────────────────────────────────────────────┘
```

**Key rules**

- The sim never touches three.js. The renderer never changes game state.
- Animations are **sampled at the sim frame** (frame 14 of move X = pose at 14/60 s). This keeps visuals locked to frame data and survives rollbacks.
- Hitboxes are **authored data** (spheres/capsules relative to the character root per frame), not physics-engine colliders. Optional: auto-generate first drafts from bone positions in a tool, then bake to data.
- VFX and audio are triggered by sim **events** with a frame stamp; on rollback, already-played events are matched and not replayed.

### Folder structure

```
kakusei-arena/
├─ public/
│  ├─ characters/<id>/model.vrm (or .glb), anims.glb, portrait.webp, data.json
│  ├─ stages/<id>/stage.glb, lightmap.ktx2, data.json
│  ├─ vfx/*.json (three.quarks), textures/*.ktx2
│  └─ audio/sfx.webm, sfx.json, music/*.webm, voice/<id>/*.webm
├─ src/
│  ├─ core/        loop.ts, fixed.ts (fixed-point math), rng.ts, serialize.ts
│  ├─ sim/         state.ts, fighter.ts, moves.ts, hit.ts, meters.ts, round.ts, ai/
│  ├─ input/       devices.ts, buffer.ts, motion.ts (QCF/DP parser), touch.ts, bindings.ts
│  ├─ net/         rollback.ts, transport-webrtc.ts, signaling.ts, lobby.ts
│  ├─ render/      renderer.ts, toon/ (TSL toon + outline), camera.ts, fighterView.ts,
│  │               stageView.ts, postfx/ (impact frame, speed lines, bloom)
│  ├─ vfx/         vfxManager.ts, presets/
│  ├─ audio/       audio.ts, events.ts
│  ├─ ui/          hud/, menus/, charselect/, training/, results/
│  ├─ data/        schema.ts (zod/TS types for move & character JSON)
│  └─ tools/       hitbox-editor/, frame-data-viewer/, replay-viewer/
├─ tools-node/     optimize-assets.mjs (gltf-transform pipeline), build-atlas.mjs
├─ DECISIONS.md    every judgment call the agent makes
└─ PERF.md         budget measurements per phase
```

---

## 6. Core combat design

### 6.1 Controls

| Input | Keyboard (P1) | Gamepad | Touch |
|---|---|---|---|
| Move / walk | WASD | Stick / D-pad | Left virtual stick |
| **Sidestep** | Tap W / S (into / out of screen) | Tap up / down | Swipe up / down on stick |
| Sidewalk | Hold W / S | Hold up / down | Hold up / down |
| Dash / backdash | Double-tap D / A | Double-tap → / ← | Double-tap stick |
| **1 – Light** | J | X / □ | Button |
| **2 – Heavy** | K | Y / △ | Button |
| **3 – Kick** | U | A / ✕ | Button |
| **4 – Ki / Special** | I | B / ○ | Button |
| Guard | Hold back (Tekken style) **+** optional dedicated guard button (L) | Hold back / LB | Auto-guard toggle in Easy mode |
| Throw | 1+3 | X+A | Grab button |
| **Ki Charge** | Hold 4 | Hold B | Hold Ki |
| **Vanish Step** | 2+3 | Y+A | Vanish button |
| **Awakening** | 1+2+3 (once per match, below 35% HP) | X+Y+A | Glowing button appears |
| **Ultimate** | ↓↘→ + 2+4 (Pro) / R (Easy) | Same / RB | Ult button |
| Pause | Esc | Start | ⏸ |

Two control schemes:

- **Pro:** motion inputs (QCF, DP, HCB, charge) for specials → slightly more damage.
- **Easy:** direction + 4 button = special, R = Ultimate, auto-combo on mashing 1. ~10% damage reduction on specials. Switchable per match, shown on the HUD.

### 6.2 Frame-data model (every move has this)

```jsonc
// characters/kaito/data.json  (excerpt)
{
  "id": "kaito_blaze_knuckle",
  "name": "Blaze Knuckle",
  "input": { "pro": "236+2", "easy": "6+4" },
  "startup": 14, "active": 3, "recovery": 18,
  "onBlock": -4, "onHit": 6, "onCounterHit": "launch",
  "damage": 220, "chip": 20, "kiGain": { "onHit": 8, "onBlock": 4, "onWhiff": 1 },
  "height": "mid",          // high | mid | low | unblockable | throw
  "tracking": "right",      // none | left | right | full  (beats sidestep that way)
  "hitboxes": [
    { "frames": [14, 16], "shape": "capsule", "a": [0.3, 1.3, 0], "b": [1.1, 1.3, 0], "r": 0.25 }
  ],
  "hurtboxOverride": [{ "frames": [1, 13], "lowerBodyInvuln": false }],
  "cancelInto": ["kaito_rising_phoenix", "ultimate"],
  "cancelWindow": [17, 22],
  "hitstop": 9, "hitstun": 22, "pushback": 0.4,
  "launch": null,
  "vfx": { "14": "fire_swipe", "onHit": "fire_burst_m" },
  "sfx": { "10": "kaito_shout_hah", "onHit": "hit_heavy_fire" },
  "anim": { "clip": "blaze_knuckle", "speedCurve": "stepped12" }
}
```

### 6.3 Core rules

- **Heights:** high (duck under), mid (must stand block), low (must crouch block), throw (break with matching button within 20 frames).
- **3D movement:** sidestep evades *linear* moves; **tracking/homing** moves (marked with a blue streak VFX, like Tekken's sidestep-catching moves) catch sidesteps. This rock-paper-scissors is the heart of 3D neutral.
- **Counter hit:** hitting during the opponent's startup = bonus stun / launch, big "COUNTER!" text.
- **Launch & juggle:** launchers pop the opponent up; juggles use **increasing gravity** + **damage scaling** (100% → 80% → 70% → … floor 30%) to cap infinite combos. Max 1 "bound" (floor bounce) per combo.
- **Walls:** splats extend combos; **Wall Break** after enough wall damage sends both fighters into the next stage area (see Stages).
- **Floor Break:** certain enders break the floor → fall to a lower stage zone (anime crater moment).
- **Guard Crush:** guarding drains a hidden guard meter; empty → stagger.
- **Parry:** forward + guard at the exact moment (6-frame window) → small advantage + flash. Lows have a low-parry.
- **Input buffer:** 6-frame buffer for specials, 3-frame leniency for links, SOCD cleaning for keyboards (last input wins for left/right, up wins for up/down).

### 6.4 Resources & anime systems (the creative part)

| System | How it works | Why it's fun |
|---|---|---|
| **Ki Gauge** (3 bars) | Fills on attacking, getting hit, and by **Ki Charge** (hold 4: you glow, slowly charge, fully vulnerable). | Classic anime "powering up" pose — risky, readable, hype. |
| **Ki Specials** | Spend ½ bar → enhanced version of any special (more hits, armor, or launch). | Tactical spending. |
| **Vanish Step** | Spend 1 bar: teleport behind the opponent with an afterimage. Works in neutral and as a combo extender / escape on block (not on hit). | Signature anime "instant movement". Counterplay: opponent can **Vanish Read** (turn & attack on the exact frame) for a counter hit. |
| **Awakening** | Once per match, under 35% HP: transformation cutscene (0.8 s, invincible), visual change (hair/eyes/aura), +10% damage, new moves unlocked, faster Ki gain for 12 s. Recovers 10% HP. | Every character gets their "transformation episode". Comeback mechanic. |
| **Ultimate** | 3 bars (or 2 while Awakened). Cinematic camera, invincible startup, 3–5 s sequence, ~35% damage. If blocked, short whiff-punish window. | The money shot. |
| **Beam Clash** | When two beam/projectile Ultimates (or two projectile specials) collide, the game enters **CLASH**: split-screen faces, both players mash + rotate stick, rhythm-timing ring prompts. Winner's beam overwhelms. Loser takes reduced damage. | The most iconic anime moment, in your fighter. |
| **Rivalry Intros** | Special intro dialogue for certain matchups (e.g., the two swordsmen); a "rivals" flag gives a unique round-3 music remix. | Story without a story mode. |
| **Finishing Blow** | Last-hit KO with a heavy or Ultimate → slow-mo, freeze frame, ink-splash "K.O." card, optional "Domain" style stage tint. | Clip-worthy every round. |
| **Arena Shift** | Wall/floor breaks move the fight to the next zone of a stage (rooftop → street → subway). | Big-budget feel with small assets. |

---

## 7. Original roster (anime archetypes, fully original designs)

Every character: **8–10 normals strings, 4 specials, 2 Ki-specials, 1 throw pair, 1 Awakening, 1 Ultimate, 1 Awakened Ultimate variant.** Start with **2** (Kaito + Shiori), ship v1.0 with **6**, grow to **10 + boss**.

### 1. KAITO HOMURA — "The Hot-Blooded Hero" (Shonen protagonist)
- **Playstyle:** All-rounder. Best first pick. Teaches every system.
- **Signature mechanic — Heat Stacks:** each landed special adds a flame stack (max 3) that powers up the next Blaze move.
- **Specials:** *Blaze Knuckle* (fire straight, mid, tracking right) · *Rising Phoenix* (anti-air launcher) · *Ember Step* (fire dash, passes through projectiles) · *Cinder Drop* (overhead axe kick, ground bounce).
- **Awakening — Crimson Soul:** hair goes white-gold with ember particles, fists leave fire trails, Blaze Knuckle becomes 3-hit.
- **Ultimate — Hundred Sun Barrage:** rapid punch flurry (impact frames every 4th hit) → final punch shapes a phoenix that flies through the opponent and explodes off-screen.
- **Look:** spiky red hair, torn school jacket tied at the waist, bandaged hands, determined grin.

### 2. SHIORI KAGEYAMA — "The Shadow Ninja"
- **Playstyle:** Mix-up / trickster. Fast, low HP.
- **Signature — Shadow Clones:** leave a clone that repeats your next attack 20 frames later (max 1 on screen).
- **Specials:** *Kunai Fan* (3 projectiles, spread) · *Shadow Stitch* (low, roots opponent briefly) · *Smoke Swap* (swap places with your clone) · *Crow Dive* (air dive kick).
- **Awakening — Moonless Mode:** body turns ink-black with white outline, 2 clones allowed, moves become partly invisible.
- **Ultimate — Night Without Moon:** stage lights cut to black, 12 white slash lines appear on screen, lights snap back, opponent crumples.
- **Look:** dark purple scarf that trails, short black hair with silver streak, half-mask, fingerless gloves.

### 3. REN TSUKISHIRO — "The Silent Swordsman" (iaido master)
- **Playstyle:** Footsies / counters. Longest range, disjointed hitboxes.
- **Signature — Sheath Stance:** hold 4 to enter stance; release for a lightning-fast quick draw. Stance auto-counters highs.
- **Specials:** *Crescent Draw* (long mid slash) · *Falling Petal* (counter stance) · *Moon Step* (sidestep slash, tracks) · *Blade Rain* (air downward stab).
- **Awakening — Edge of Silence:** sound drops to near silence (music lowpass), blade glows pale blue, quick draw cancels into itself once.
- **Ultimate — Thousand Petal Severance:** one draw, freeze frame, camera orbits as cherry-blossom petals fall, then the delayed cut lands.
- **Look:** white haori with crescent motif, long ponytail, closed eyes (opens on Awakening).

### 4. MIKA "VOLT" RAIDEN — "The Lightning Speedster"
- **Playstyle:** Rushdown. Fastest dash, weakest defense.
- **Signature — Overcharge:** chain 3 different specials in a combo → speed boost for 3 s.
- **Specials:** *Spark Rush* (dash punch, cancelable) · *Thunder Hook* (launcher) · *Static Field* (small trap, stuns) · *Flash Step* (teleport-dash, 2 directions).
- **Awakening — Storm Heart:** lightning crackle on body, every dash leaves an afterimage that hits.
- **Ultimate — Railgun Heart:** charges a coin, flicks it, a hyper-speed electric beam (CLASH-capable).
- **Look:** blue-yellow track jacket, headphones around neck, electric-blue twin tails.

### 5. GORO ISHIGAMI — "The Gentle Giant" (grappler)
- **Playstyle:** Command grabs, armor, huge damage, slow.
- **Signature — Stone Skin:** 1 hit of armor on most heavies; armor turns to visible rock texture.
- **Specials:** *Mountain Hug* (command throw) · *Earthsplitter* (ground punch shockwave, low) · *Boulder Toss* (rips stage rock, projectile) · *Avalanche Charge* (armored shoulder rush).
- **Awakening — Titan Form:** grows 15% bigger, rock plates on shoulders, all throws +range.
- **Ultimate — Tectonic Suplex:** grabs, leaps into the sky, camera follows up through clouds, crashes back down — crater, arena shift.
- **Look:** huge but kind face, monk beads, sleeveless robe, tiny bird that sits on his head during intro.

### 6. LYRA ASHVEIL — "The Spirit Summoner" (zoner / puppet)
- **Playstyle:** Keep-away. Controls a spectral fox spirit, **Kitsu**.
- **Signature — Spirit Link:** command Kitsu with 4 + direction; both can attack at once.
- **Specials:** *Foxfire Orbs* (slow homing projectiles) · *Spirit Leap* (Kitsu pounces) · *Veil* (short reflect barrier) · *Recall* (Kitsu returns, hits on the way).
- **Awakening — Nine-Tail Bond:** Kitsu grows nine glowing tails, attacks gain a second hit.
- **Ultimate — Lantern Festival:** dozens of floating lanterns rise, then dive at the opponent as fox-flame.
- **Look:** shrine-maiden-inspired outfit in ash grey & teal, paper charms in hair.

### 7. DAICHI "NULL" KUROGANE — "The Cursed Arm" (risk/reward)
- **Playstyle:** Life-steal and self-damage. High risk, high reward.
- **Signature — Hunger:** void moves cost a little of your own HP but steal it back on hit.
- **Specials:** *Void Grip* (pull opponent in) · *Hollow Burst* (close-range explosion) · *Black Spiral* (rising spin) · *Devour* (heal-steal throw).
- **Awakening — Event Horizon:** arm fully black with purple cracks, Hunger heals double.
- **Ultimate — Singularity:** creates a black hole that sucks the opponent in and crushes them.
- **Look:** bandaged right arm with seals, tired eyes, long coat, chain earrings.

### 8. AIKO GEARHART — "The Mecha Inventor" (setplay / traps)
- **Playstyle:** Traps, drones, calls down mech parts.
- **Signature — Scrap Meter:** gains scrap on hit; spend to build turrets or upgrades mid-match.
- **Specials:** *Drone Ping* (drone projectile) · *Wrench Smash* (overhead) · *Mine Toss* · *Rocket Boots* (air dash).
- **Awakening — Pilot Mode:** hops into a small mech suit (new moveset for 10 s).
- **Ultimate — Giga Drill Drop:** giant mech arm drills down from orbit (CLASH-capable beam version when Awakened).
- **Look:** oversized goggles, oil-stained overalls, robotic backpack arm.

### 9. SERAPH-09 — "The Android Angel" (air fighter)
- **Playstyle:** Air dashes, flight stance, laser angles.
- **Signature — Flight:** hold up-forward + 4 to hover for 2 s, aerial normals change.
- **Specials:** *Halo Laser* (angled beam) · *Feather Spread* (air projectiles) · *Wing Guard* (armor) · *Descent* (dive).
- **Awakening — Overclock:** wings turn red, flight time infinite for 8 s.
- **Ultimate — Judgment Array:** a ring of satellites fires from the sky.
- **Look:** white & gold android, segmented light wings, visor that shows emotion icons.

### 10. KOJI "BIG BRO" TANAKA — "The Delinquent Brawler" (comedy & guts)
- **Playstyle:** Unorthodox street fighting, taunts that build Ki, can take a hit to counter.
- **Signature — Guts:** survive a KO hit once per match at 1 HP (not during Ultimate).
- **Specials:** *Headbutt of Justice* · *Bicycle Kick* · *Pocket Sand* (blind = HUD flicker) · *Lead Pipe Swing* (stage item).
- **Awakening — Pompadour Rising:** hair grows, sunglasses appear, everything does +1 hit.
- **Ultimate — Rooftop Showdown:** drags opponent into a sunset "rooftop" mini-cutscene for a one-sided brawl.
- **Look:** long school coat with kanji-style patches (original text), pompadour, toothpick.

### BOSS — EMPEROR OBORO — "The Demon King"
- **Three phases:** human form → horned armor → giant shadow form (camera pulls back).
- Super armor on some moves, arena-wide attacks, desperation Ultimate at 10% HP.
- Unlocked for versus after beating Arcade on Normal.

### Character data checklist (per fighter)
- [ ] `data.json`: stats (HP 900–1150, walk speed, dash, weight/gravity), all moves w/ frame data
- [ ] Model: VRM/GLB ≤ 25k tris, ≤ 3 materials, ≤ 2048² KTX2 atlas, spring bones for hair/cloth
- [ ] Awakened variant: texture swap + aura VFX + optional extra mesh (not a whole new model)
- [ ] ~45–70 animation clips (see Phase 5 list)
- [ ] 4 VFX presets, 12–20 SFX, 15–25 voice lines (optional), portrait, select render, victory pose
- [ ] Rival intros (2 lines each)

---

## 8. Stages (3D, small, layered)

Each stage = 2–3 **zones** linked by Wall/Floor Breaks. Closed-ish arenas with walls (Tekken style) plus one "infinite" training stage.

| Stage | Zones | Flavor |
|---|---|---|
| **Neon Rooftop** | rooftop → billboard collapse → rainy street | City-at-night anime opening vibe. |
| **Sakura Shrine** | courtyard → bridge over koi pond → bamboo forest | Ren & Lyra home stage. Falling petals. |
| **Monsoon Market** (Indian-inspired) | spice market → rooftops → railway platform | Rain, hanging lights, chai stall; regional flavor like fightkaro's Desi stages. |
| **Volcano Dojo** | dojo → lava cliffs | Kaito/Goro home stage. Heat shimmer. |
| **Orbital Lab** | lab → zero-g corridor (slower juggles!) | Aiko/Seraph home. |
| **Throne of Night** | boss only | Oboro's castle, moon. |
| **Training Void** | infinite grid | Frame meter, hitbox viewer. |

Stage tech budget: ≤ 80k tris per zone, **baked lighting** into lightmaps (Blender bake → KTX2), 1 real-time directional light for character shadows only, background as cheap cards/skybox, animated details via vertex shaders (petals, rain) not particles where possible.

---

## 9. Art direction: "3D that looks like an anime frame"

Study the Guilty Gear Xrd GDC talk (link in Section 19) — it explains every trick below.

- **Toon shading:** 2-tone (lit/shadow) with a hard step. Use MToon from three-vrm or a custom TSL toon node. Control shadow shapes with **hand-edited vertex normals** on the face (no ugly blotches).
- **Outlines:** inverted-hull outline (extruded back-faces, black, thickness via vertex color) — cheap and anime-correct. Optional screen-space outline in High preset only.
- **Limited animation:** play character animations **stepped at 12–24 poses per second** (hold frames) while the sim runs at 60. Huge style win, zero cost. Smooth (unstepped) only for camera & VFX.
- **Rim light + flat ambient**, no realistic GI. Colored shadow tint per character.
- **Impact frames:** on heavy hits and Ultimate hits flash 2–3 frames of inverted / high-contrast black-red silhouette (TSL post effect).
- **Speed lines & focus lines:** screen-space radial lines on dashes, Vanish, Ultimates.
- **Camera language:** dutch angle on Awakening, push-in on counter hit, orbit on Ultimates, whip-pan on Vanish.
- **Hitstop + screen shake** scaled by move strength (light 5 f, heavy 9 f, Ultimate 14 f).
- **Ink-style UI:** brushed health bars, manga-panel character select, katakana-flavored (original) SFX text like 「ドン」 as comic onomatopoeia on big hits.

---

## 10. Audio

- SFX in one **audio sprite** (Howler) for fast loading: hits by strength & element (fire, lightning, blade, void), guard, whiff, footsteps, UI.
- Music: one theme per stage + boss + menu + a **rival remix** layer. Use royalty-free / commissioned / self-made tracks only.
- Voice: optional per character; can be recorded by friends. Language toggle (e.g., English / Hindi / Japanese-style gibberish "anime grunts") is a fun touch.
- **Rollback-safe audio:** sound events are keyed by `(frame, eventId)`; replays after rollback are skipped if already played; mispredicted sounds are cut with a 30 ms fade.

---

## 11. Game modes

| Mode | Notes |
|---|---|
| **Arcade** | 6 fights + rival fight + boss. Difficulty Easy/Normal/Hard/Nightmare. |
| **Versus (local)** | Same keyboard (2 layouts), 2 gamepads, or keyboard + gamepad. |
| **Online Room** | Create room → 6-letter code + share link (WhatsApp / copy) → friend joins → rollback match. Rematch button. Spectator later. |
| **Training** | Frame meter, hitbox/hurtbox viewer, input display, damage counter, dummy record/playback (5 slots), counter-hit toggle, reset position, move list with frame data. |
| **Combo Trials** | 10 trials per character, from easy to "tournament". |
| **Tutorial** | Interactive lessons: blocking, sidestep vs. tracking, launch & juggle, Ki, Vanish, Awakening, Ultimate, Clash. |
| **Survival / Boss Rush** | Later. |
| **Replays** | Store inputs only (tiny), replay deterministically. Share replay code. |

---

## 12. Netcode plan (rollback)

1. **Deterministic sim first** (Phase 1) — without this, nothing works. Test: run the same input log twice → identical state hash every frame.
2. **Local rollback test harness:** two sims in one tab with artificial delay/jitter/packet loss; force rollbacks every frame to catch bugs.
3. **Transport:** WebRTC DataChannel in **unreliable, unordered** mode; send the last N frames of inputs every packet (redundancy beats retransmit).
4. **Signaling & rooms:** tiny WebSocket server creates a room code, swaps SDP/ICE, then gets out of the way. Use public STUN; add a TURN server for strict NATs (some players will need it).
5. **Rollback core:** save state each frame (ring buffer of 8–10 frames), predict remote input = last known, on correction → load state → resimulate to present (budget: ≤ 7 rollback frames in 4 ms).
6. **Input delay:** 1–2 frames default, auto-tuned from ping.
7. **Desync detection:** exchange state hash every 30 frames; on mismatch, log both states and show "desync" (dev) / resync from host (release).
8. **Libraries to evaluate before writing your own:** `rollback-netcode` (npm, TypeScript, WebRTC, desync detection, still under active development), `netplayjs` (rollback + WebRTC, includes a matchmaking/signaling server), or Rust `fortress-rollback` + Matchbox via WASM.

---

## 13. Performance budget (non-negotiable)

**Targets:** 60 fps stable on an Intel Iris Xe class laptop at 1080p (render scale 0.8–1.0) and on a mid-range Android phone (render scale 0.6–0.75). 120/144 Hz rendering on strong PCs while sim stays at 60.

| Item | Budget |
|---|---|
| Sim tick (2 fighters + projectiles) | ≤ 0.5 ms |
| Rollback worst case (7 frames resim) | ≤ 4 ms |
| Draw calls (scene total) | ≤ 120 (Low) / ≤ 200 (High) |
| Triangles on screen | ≤ 250k |
| Character | ≤ 25k tris, ≤ 3 materials, ≤ 65 bones, 1× 2048² KTX2 atlas (1024² on mobile) |
| Stage zone | ≤ 80k tris, baked lightmap, ≤ 6 materials (atlased) |
| Real-time lights | 1 directional (character shadows only, tight shadow camera, 1024² map) |
| Particles alive | ≤ 1,500 (Low 600) via one three.quarks BatchedRenderer |
| First load (menu + 2 fighters + 1 stage) | ≤ 8 MB, playable < 10 s on 4G |
| Per character download | ≤ 3 MB (model + anims + sfx) |
| JS bundle (initial) | ≤ 400 KB gzip |
| Memory | ≤ 500 MB on mobile |

**Optimization checklist**
- [ ] `gltf-transform` pipeline: inspect → resize textures → KTX2 (UASTC for normals/faces, ETC1S for others) → quantize → **Meshopt** (not Draco for skinned/animated models) → prune/dedup. Always pass the texture format explicitly — the default `auto` re-encodes in the original format and can make files bigger.
- [ ] Animations: resample to 30 fps keys + let stepped playback do the rest; strip unused bone tracks; share clip libraries across fighters with the same skeleton.
- [ ] Freeze matrices on static stage objects (`matrixAutoUpdate = false`), merge static meshes, instance repeated props.
- [ ] Quality presets: Low / Medium / High / Ultra + **dynamic resolution** (drop render scale when frame time > 15 ms for 30 frames).
- [ ] Pre-compile shaders during the "VS" splash screen (no hitch on first hit effect). Pre-warm every VFX once off-screen.
- [ ] Object pools for projectiles, VFX, damage numbers — zero allocations per frame in the sim.
- [ ] Lazy-load characters & stages; cache with Service Worker.
- [ ] Pause rendering when tab hidden; cap to 30 fps on battery saver (optional toggle).
- [ ] Profile with Chrome DevTools Performance + `renderer.info` every phase; log numbers in PERF.md.

---

## 14. STEP-BY-STEP PLANNER

Estimated time is for one motivated student working part-time with an AI agent. Adjust freely.

### Phase 0 — Setup & research (2–3 days)
- [ ] Create repo, Vite + TS strict, ESLint + Prettier, GitHub Actions build check.
- [ ] Add three.js (pinned version), basic `WebGPURenderer` scene with WebGL fallback and feature detection.
- [ ] Debug overlay (F1): fps, ms, draw calls, tris, backend (WebGPU/WebGL).
- [ ] Read: Infil's Fighting Game Glossary (frame data, plus-minus, juggles), "Fix Your Timestep", the Guilty Gear Xrd GDC talk.
- [ ] Write DECISIONS.md and PERF.md stubs.
- **Done when:** a spinning toon-shaded test cube runs at 60 fps on your laptop with the overlay showing the active backend.

### Phase 1 — Deterministic core & greybox (1 week)
- [ ] Fixed 60 Hz loop with accumulator, render interpolation, "spiral of death" clamp.
- [ ] Fixed-point math lib (e.g., 1 unit = 1/1000 m as integers) + seeded PRNG.
- [ ] `GameState` as plain data; `serialize()` / `deserialize()` to `Uint8Array`; `hash()`.
- [ ] Two capsule fighters on a flat floor with walls; always face each other (3D facing on the axis between them).
- [ ] Input layer: keyboard + gamepad → per-frame input bits; input buffer; SOCD cleaning.
- [ ] Record & replay input logs.
- **Done when:** a 60-second input log replays with identical state hashes on every frame, 10 runs in a row, in Chrome and Firefox.

### Phase 2 — Combat system (1.5 weeks)
- [ ] Fighter state machine: idle, walk, crouch, jump, dash, backdash, guard (stand/crouch), hitstun, blockstun, knockdown, wakeup, juggle, wall splat, throw, thrown.
- [ ] Move system from JSON: startup/active/recovery, cancel windows, hitstop, pushback.
- [ ] Hit detection (capsule-vs-capsule) with heights, counter hit, trades, throw & throw break.
- [ ] Damage scaling, juggle gravity, bound, wall splat.
- [ ] Health, round timer (60 s), round/match flow (best of 3), KO and time-out.
- [ ] Training-mode basics: hitbox viewer, frame meter, input display.
- **Done when:** two capsules can play a full best-of-3 with blocking, throws, a launcher → 3-hit juggle → wall splat, and the frame meter matches the JSON frame data exactly.

### Phase 3 — 3D movement (4–5 days)
- [ ] Sidestep (tap up/down), sidewalk (hold), sidestep cancel, backdash.
- [ ] Tracking property per move (none/left/right/full) — sidestep beats linear moves, loses to tracking.
- [ ] Ring-out-free walls, corner logic, camera stays perpendicular to the fighter axis.
- [ ] Fighting camera: auto-distance, smooth orbit, never clips into walls, framing both fighters.
- **Done when:** you can sidestep a linear heavy and punish it, and a tracking move catches the same sidestep.

### Phase 4 — Anime systems (1 week)
- [ ] Ki Gauge (gain rules, Ki Charge, Ki Specials).
- [ ] Vanish Step + Vanish Read counter.
- [ ] Awakening state (timer, stat buffs, unlocks, cutscene hook).
- [ ] Ultimate framework (cinematic state, invincibility, scripted camera track, damage events).
- [ ] Beam Clash minigame (mash + timing rings, deterministic so it works online).
- [ ] Easy vs Pro control schemes; motion-input parser (QCF 236, DP 623, HCB 41236, charge).
- **Done when:** on capsules, you can charge Ki, Vanish behind, Awaken, trigger two beam Ultimates into a Clash, and the winner is decided by input — identically on replay.

### Phase 5 — Character art pipeline (2 weeks, overlaps with 6)
- [ ] **Character Slot System:** loader accepts `.vrm` or rigged `.glb` humanoid; maps to a standard humanoid skeleton.
- [ ] Make Kaito & Shiori in **VRoid Studio** (or Blender / Meshy as a starting mesh) → export VRM.
- [ ] Blender + VRM add-on: cleanup, reduce tris, atlas textures, face normal editing, add inverted-hull outline mesh or use MToon outline.
- [ ] Animation list per character (~45–70 clips): idle, walk f/b, sidewalk l/r, dash, backdash, crouch, jump, land, guard stand/crouch, hit high/mid/low (light/heavy), launch, juggle, wall splat, knockdown, wakeup ×2, throw/thrown, all normals & strings, 4 specials, 2 Ki specials, Vanish, Ki Charge loop, Awakening transform, Ultimate sequence, intro ×2, win ×2, lose, taunt.
- [ ] Base clips from Mixamo / Quaternius (retarget), fighting moves hand-keyed in Blender or Cascadeur for crisp poses.
- [ ] Export single `anims.glb` per character; run `tools-node/optimize-assets.mjs`.
- [ ] Animation sampling by sim frame + stepped playback (12/24 fps) + per-move speed curves.
- [ ] Spring bones (hair, scarf) — render-side only, never affects sim.
- **Done when:** Kaito vs Shiori plays at 60 fps on Iris Xe with both models toon-shaded and outlined, every move's animation lined up with its hitbox in the hitbox viewer.

### Phase 6 — VFX & game feel ("juice") (1 week)
- [ ] three.quarks setup, one BatchedRenderer; build presets in the quarks.art editor: hit sparks (light/heavy/counter), elemental bursts (fire, shadow, lightning, blade, void), guard sparks, dash dust, Ki aura, Awakening aura, Vanish afterimage, beam.
- [ ] TSL post effects: impact frames, radial speed lines, chromatic punch on Ultimates, selective bloom (High only).
- [ ] Hitstop, screen shake, camera punch, slow-mo KO, ink-splash K.O. card, comic onomatopoeia text.
- [ ] Afterimage trails (cheap: ghost copies of the skinned mesh with fading color, max 4).
- **Done when:** a blindfold test — a friend hears and sees one heavy hit and says "that felt strong".

### Phase 7 — UI & menus (1 week)
- [ ] Title screen with animated character render.
- [ ] Manga-panel character select (portraits, color variants, random select, rival highlights).
- [ ] VS screen (shader pre-compile happens here), round intro, HUD (HP with red recoverable part, Ki bars, Awakening icon, timer, combo counter, "COUNTER!", "PUNISH!").
- [ ] Pause, settings (controls remap, Easy/Pro, quality preset, render scale, audio, language), move list.
- [ ] Results screen with rematch / character select.
- [ ] Touch UI: left stick (nipplejs) + 4 buttons + Vanish + Ult; landscape prompt; adjustable layout & opacity.
- **Done when:** a new player can go from URL → playing a match on phone and on laptop with zero instructions.

### Phase 8 — CPU AI (1 week)
- [ ] Utility/behavior-tree AI reading sim state (distance, frame advantage, meters).
- [ ] Difficulty = reaction time (Easy 30 f → Nightmare 10 f), block rate, combo knowledge, punish rate.
- [ ] Per-character "personality" weights (Goro grabs, Lyra zones, Mika rushes).
- [ ] AI must be deterministic (uses sim PRNG) so replays work.
- **Done when:** Easy is beatable by a first-timer, Hard beats you sometimes, Nightmare punishes unsafe moves consistently.

### Phase 9 — Online rollback (2 weeks)
- [ ] Local two-sim harness with delay/jitter/loss sliders; force-rollback mode.
- [ ] Evaluate `rollback-netcode` / `netplayjs`; choose or build custom (record in DECISIONS.md).
- [ ] WebRTC transport (unreliable, unordered) + input redundancy.
- [ ] Signaling server + room codes + share link + rematch; STUN + TURN fallback.
- [ ] Ping display, connection quality bars, input delay auto-tune, desync detection.
- **Done when:** two players in different cities (e.g., your hostel and home) play 10 matches at ~100 ms ping with no desyncs and the game still feels responsive.

### Phase 10 — Stages (1.5 weeks)
- [ ] Build Neon Rooftop + Sakura Shrine (2 zones each) with baked lighting.
- [ ] Wall Break / Floor Break transitions (cutscene camera, load next zone instantly — keep all zones in memory, ≤ 80k tris each).
- [ ] Ambient animation via shaders (rain, petals, neon flicker).
- **Done when:** a Wall Break moves the fight to zone 2 with no frame drop.

### Phase 11 — Audio (4–5 days)
- [ ] Howler audio sprites, rollback-safe event system, ducking during Ultimates.
- [ ] Music per stage, rival remix layer, menu theme.
- [ ] Voice lines (optional), volume sliders.
- **Done when:** a full match sounds right with rollback forced every frame (no doubled or stuck sounds).

### Phase 12 — Performance & device pass (1 week)
- [ ] Measure every budget in Section 13 on: your laptop (Iris Xe), a mid Android phone, an old phone, a gaming PC.
- [ ] Dynamic resolution, presets auto-picked by a 3-second benchmark on first launch.
- [ ] Service worker cache, lazy loading, bundle split.
- **Done when:** PERF.md shows all budgets green on laptop and mid phone.

### Phase 13 — Roster expansion (ongoing, ~1 week per character)
- [ ] Ren, Mika, Goro, Lyra → v1.0 (6 characters). Then Daichi, Aiko, Seraph-09, Koji, Boss Oboro.
- [ ] Per character: data → greybox test → model → anims → VFX → AI personality → trials → balance pass.

### Phase 14 — Polish, test, launch (1–2 weeks)
- [ ] Tutorial + combo trials, arcade endings (one illustrated panel each).
- [ ] Balance spreadsheet (damage per bar, frame advantage, best punish) per character.
- [ ] Playtest with 5+ friends; fix the top 10 complaints.
- [ ] Accessibility: remapping, colorblind-safe hit/guard colors, reduce flashing option (impact frames off), hold-to-toggle options.
- [ ] Deploy to Cloudflare Pages / itch.io; PWA manifest; share card image; trailer clip.
- **Done when:** 10 strangers play online without you explaining anything.

---

## 15. Milestones summary

| Milestone | Contents | Rough time |
|---|---|---|
| **M1 – Greybox Fighter** | Phases 0–3: capsules with full combat & 3D movement | ~4 weeks |
| **M2 – Anime Core** | Phase 4–6: Ki, Vanish, Awakening, Ultimate, Clash, 2 real characters, juice | ~4 weeks |
| **M3 – Playable Game** | Phase 7–8: menus, touch, CPU AI | ~2 weeks |
| **M4 – Online** | Phase 9: rollback room codes | ~2 weeks |
| **M5 – Content** | Phase 10–13: stages, audio, perf, 6 characters | ~6–8 weeks |
| **v1.0 Launch** | Phase 14 | ~2 weeks |

---

## 16. Testing & quality

- **Determinism tests (CI):** replay 20 recorded matches headless in Node, compare final state hash.
- **Frame-data tests:** for every move, auto-run "move X vs blocking dummy" → check onBlock/onHit equals JSON.
- **Rollback fuzz:** random inputs + forced 1–8 frame rollbacks for 10,000 frames, compare against non-rollback run.
- **Perf CI (optional):** headless Chrome with GPU flag, record frame time on the training stage.
- **Playtest log:** what felt bad, which matchups felt unfair.

---

## 17. Risk list & fallbacks

| Risk | Fallback |
|---|---|
| WebGPU bugs on some browsers/drivers | Force WebGL2 path (same three.js API); expose a toggle in settings. |
| Custom animation takes too long | Ship fewer normals per character (6 instead of 10), reuse universal clips (hit reactions, knockdowns) across all fighters. |
| Rollback is hard | Ship delay-based netcode first (works over the same transport), add rollback in v1.1. |
| Models too heavy for phones | Mobile LOD (10k tris, 1024² atlas, no outlines mesh — use cheap post outline or none). |
| Scope explosion | v1.0 = 6 characters, 4 stages, Arcade + Versus + Online + Training. Everything else is v1.x. |

---

## 18. Stretch ideas (after v1.0)

- **2v2 Tag Duo** (assist calls & tag Ultimates — two characters' Ultimates combine).
- **Story mode** told as manga panels between fights.
- **Character creator** for custom fighters (VRoid import + pick a moveset archetype).
- **Ranked online** with Elo, seasons, replays library.
- **Spectator mode** & tournament brackets with room codes.
- **Photo mode** with anime filters for sharing.
- **Hinglish/Hindi voice pack** for regional flavor.

---

## 19. Research resources (verified Nov 2026)

### Fighting-game design
- Infil's **The Fighting Game Glossary** — 800+ terms with videos (frame data, juggles, tracking, mix-ups): https://infil.net/
- SuperCombo Wiki glossaries & hitbox color conventions (red = hitbox, green = hurtbox, blue = throw hurtbox): https://srk.shib.live/w/Street_Fighter_6/Glossary
- Tekken 8 mechanics overview (Heat, Rage Art, sidestep, wall/floor breaks): https://tekken8.pages.dev/mechanics
- Frame data concepts primer: https://gameplay.tips/guides/street-fighter-6-frame-data-isnt-scary-frame-data-concepts.html
- fightkaro.com — UX reference (meter, 4 buttons, touch layout, room codes): https://fightkaro.com

### Anime art style in 3D
- **Guilty Gear Xrd's Art Style: The X Factor Between 2D and 3D** (GDC 2015, Junya C. Motomura) — talk: https://gdcvault.com/play/1022031/GuiltyGearXrd-s-Art-Style-The · handout PDF: https://www.ggxrd.com/Motomura_Junya_GuiltyGearXrd.pdf
- "The Animation of Guilty Gear Xrd & Dragon Ball FighterZ" (New Frame Plus video essay on limited animation)
- three-vrm (VRM loader, MToon, spring bones): https://github.com/pixiv/three-vrm
- MToon node material for WebGPU: https://www.npmjs.com/package/@pixiv/three-vrm-materials-mtoon
- VRoid Studio (free anime character maker): https://vroid.com/en/studio · VRoid Hub (check each model's license!): https://hub.vroid.com/en/

### Rendering & engine
- three.js: https://threejs.org · WebGPU migration guide: https://www.utsubo.com/blog/webgpu-threejs-migration-guide
- What changed in three.js 2026: https://www.utsubo.com/blog/threejs-2026-what-changed

### Game loop & determinism
- Glenn Fiedler, **Fix Your Timestep!**: https://gafferongames.com/post/fix_your_timestep/
- Fixed timestep for input too: https://jakubtomsu.github.io/posts/input_in_fixed_timestep

### Netcode
- `rollback-netcode` (TypeScript, WebRTC, N-player, desync detection): https://www.npmjs.com/package/rollback-netcode
- NetplayJS (rollback + WebRTC + signaling server): https://github.com/rameshvarun/netplayjs
- WebRTC Pong with rollback (readable small example + write-up): https://github.com/mitxela/webrtc-pong
- Fortress Rollback (GGRS fork, works in WASM with Matchbox): https://docs.rs/crate/fortress-rollback/0.2.0
- Netplay quality checker (GGPO port demo): https://lucasnate.github.io/speedtest/index.html

### Animation & rigging
- Mixamo (free, maintenance mode): https://www.mixamo.com
- Free animation & auto-rig alternatives, incl. Quaternius Universal Animation Library (CC0): https://app.cinevva.com/guides/free-character-animations-rigging
- `vrm-mixamo-retarget`: https://www.npmjs.com/package/vrm-mixamo-retarget
- Meshy API (text/image → 3D, rigging, animation): https://docs.meshy.ai

### VFX
- three.quarks: https://github.com/alchemist0823/three.quarks · editor/marketplace: https://quarks.art
- Three VFX (WebGPU compute particles): https://github.com/mustache-dev/Three-VFX

### Asset optimization
- GLB optimization guide (Meshopt vs Draco, KTX2, order of operations): https://app.cinevva.com/guides/optimize-glb-for-web
- glTF-Transform: https://gltf-transform.dev · gltfpack / meshoptimizer: https://github.com/zeux/meshoptimizer

### Audio & input
- Howler.js: https://howlerjs.com · nipplejs (touch joystick): https://github.com/yoannmoinet/nipplejs · MDN Gamepad API: https://developer.mozilla.org/docs/Web/API/Gamepad_API

---

## 20. First command to give your agent

```text
Read KAKUSEI_ARENA_PROJECT_PLAN.md fully. Start Phase 0 only.
Set up the repo exactly as Section 5 describes, build the debug overlay,
render a toon-shaded test cube with WebGPURenderer + WebGL fallback,
then stop and report against Phase 0's "Done when" list.
```

*Good luck. Make it hype.* 🔥
