# CONTINUE.md — Handoff for the next agent

Read this whole file before touching code. Then read `CONTRACTS.md`, `docs/KAKUSEI_ARENA_PROJECT_PLAN.md` (start with the **★ v2 QUALITY UPGRADE** section), `docs/CONTROLS.md`, `docs/NETCODE.md`.

## 1. What this is
KAKUSEI ARENA: a browser 3D anime fighting game (Tekken-style 3D movement + anime powers). Vite + TypeScript strict + three.js 0.181 (WebGLRenderer). 4 ORIGINAL fighters: Kaito (fire), Shiori (shadow ninja), Ren (iaido sword), Goro (earth grappler). Stages: rooftop, shrine, training.

## 2. Branches
| Branch | What's in it |
|---|---|
| `main` | Stable, tested modules: sim + roster data, CPU AI, VFX, synth audio, UI/menus/HUD/touch, online rollback, Astra's v1 models. |
| `claude-wip` | Old snapshot — now fully MERGED into `main`. Ignore it; start from `main`. |
| `astra/*` | Your work. **Never commit to `main` directly.** Open a PR into `main`. |

## 3. Commands
```bash
npm install
npm run dev          # http://localhost:5173
npm run typecheck    # must be 0 errors
npm test             # sim: 256 checks must pass
npm run test:ai      # CPU AI (AI_QUICK=1 for fast)
npm run test:net     # rollback netcode, 46 checks
npm run build        # production build to dist/
```
Playable preview page (claude.ai, no online play there): `npm run build && node tools/pack-artifact.mjs` → `dist-artifact/` (GLBs shipped as `.glb.json`, auto-loaded by `loadGLB` fallback).
Online dev without internet: open two tabs with `?net=local` (add `&lag=40&jitter=15&loss=3` to simulate lag).

## 4. Golden rules (breaking these = bugs)
1. **Determinism.** `src/sim/`, `src/data/`, `src/ai/` must never use `Math.random`, `Date`, float trig (`Math.sin/cos/atan2/sqrt`) on gameplay paths, or non-plain-data state. Use `src/core/` integer helpers. Online play and replays depend on it. After ANY sim/ai change run `npm test && npm run test:ai && npm run test:net`.
2. **Units.** Sim = integer millimetres and 60 Hz frames. Renderer converts `/1000` to metres. `round.timer` is in frames.
3. **Contracts.** `src/sim/types.ts` is the shared contract: additive changes only (new optional fields), never rename/remove. Keep every exported signature in each module's `index.ts`.
4. **Sim never imports three.js; renderer never changes game state.** VFX/audio/HUD react only to `state.events` + `state`.
5. **Models.** Keep file names (`public/characters/<id>/model.glb`, `model_1024.glb`, `tex.png`, `tex_awakened.png`, `manifest.json`, `goro/shoulder_plates.glb`), Mixamo-style bone names, metres, Y-up, +Z forward, A-pose. Build source: `tools/assets/`.
6. **IP.** Characters, names, logos and designs stay original. No real anime characters or lookalikes, no copyrighted music/art, no real brand names on props.
7. **No runtime network assets** (everything bundled or procedural). Google Fonts link is the only external thing.
8. **Performance budget:** 60 fps on an Intel Iris Xe laptop and a mid-range phone. ≤150 draw calls, ≤250k tris on screen, no per-frame allocations. Check with F1 debug overlay.
9. **Small commits**, clear messages, one topic each. Before every push: `typecheck` + all three test suites + `build` pass, and you looked at the game running (screenshot).
10. Don't rewrite working modules. Fix in place. If unsure, write the question in `DECISIONS.md` and pick the simpler option.

## 5. Task list (do in order, tick as you go)
- [ ] **T1 Sync.** `git fetch`, branch `astra/continue` from `main`. Run all commands in §3. Fix any errors first.
- [ ] **T2 Renderer finish.** In a live match (Versus or Training): GLB fighters load, every pose in `POSES` reads correctly on the bones, attacks line up with hitboxes (F2 hitbox view in Training), toon shading + outlines, awakened texture swap (+ Goro shoulder plates), hair/scarf secondary motion, Ren's katana in hand only during sword poses, P2 mirror-match palette tint. Title + character-select menu scenes show posed fighters. *Done when:* screenshots of all 4 fighters fighting on both stages look polished.
- [ ] **T3 Models.** Compare `public/characters/previews/*` for all 4 fighters. Any fighter still looking blocky/toyish → improve via `tools/assets/` build script (same rules as §4.5). Re-export + re-check in game.
- [ ] **T4 Stages.** Rooftop + Shrine rich and lit: crowd that cheers on KO/ultimate/counter, banners with original text, props, petals/neon. Walls visible at `arenaHalfSize`. ≤80k tris each.
- [ ] **T5 UI polish v2 check.** Title, fightkaro-style select (3D fighters left/right, chapter grid, locked Chapter 2 cards, stage + CPU chips, PLAY WITH A FRIEND + FIGHT!), HUD, commentator + ticker. Test at 1280×720 and 844×390 with touch controls.
- [ ] **T6 Full playtest.** Every mode (Arcade all difficulties, Versus on one keyboard, Training, Online via `?net=local`). Write bugs in `docs/BUGS.md`, fix them. Known: AI tests hint at a **P1-side advantage in mirror matches** — investigate `src/sim/step.ts` / `movement.ts` (processing order / push resolution) and keep it deterministic.
- [ ] **T7 Feel + balance.** Hitstop, shake, juggle gravity, damage. Make each fighter's combos (launcher → juggle → ender) work and feel good. Update move data in `src/data/chars/*.ts`; keep frame-data tests green.
- [ ] **T8 Audio listen pass.** Audio was only checked by meters, never listened to. Balance volumes, fix harsh sounds (`src/audio/`).
- [ ] **T9 Perf pass** on a real Iris Xe laptop + a phone. Quality presets auto-pick. Record numbers in `PERF.md`.
- [ ] **T10 Deploy** to Vercel (static `dist/`). Test online with 2 real devices (one on mobile data). If players can't connect, add a TURN server per `docs/NETCODE.md`.
- [ ] **T11 (later)** Known gaps: guard crush, wall/floor breaks into new stage zones, Shiori's shadow clone, clash stick-rotation mashing. New fighters (Mika, Lyra, Daichi, Aiko, Seraph-09, Koji, boss Oboro) follow the `src/data/chars/` pattern + a model in `tools/assets/`.


## 5b. Work split (from 2026-11-19)
**Claude track (code, on `main` via Claude's helpers):** §5 tasks T2–T9 — renderer polish, camera/lighting, stages + crowd, playtest + bug fixes, P1-side bias, feel + balance, perf, re-publish preview.

**Astra track (assets only, branch `astra/assets-ch2`, never touch `src/`):**
- [ ] A1 **Chapter 2 fighter models** with the same v2 pipeline + specs as the current 4 (`tools/assets/`, same bone names, file layout `public/characters/<id>/…`, 15–25k tris, awakened atlas, expression strip, previews). Order: **mika** (lightning speedster: blue-yellow track jacket, headphones round neck, electric-blue twin tails), **lyra** (spirit summoner: shrine-maiden-inspired ash-grey + teal outfit, paper charms in hair) **+ `kitsu.glb`** (her spectral fox, rigged: spine + 4 legs + 3 tail bones), **daichi** (cursed arm: bandaged sealed right arm, tired eyes, long coat, chain earrings), **aiko** (mecha inventor: oversized goggles, oil-stained overalls, robotic backpack arm), **seraph** (android: white-gold, segmented light-wing meshes on extra bones, visor), **koji** (delinquent: long school coat with original kanji-style patches, pompadour), **oboro** (boss demon king, 1.3× scale, horned armor + cape bones). Full looks: plan doc Section 7. All ORIGINAL — no resemblance to existing anime characters.
- [ ] A2 **Stage prop pack v2** (`public/props/`, ≤5k tris each, toon flat colors, no real brands): rooftop (water tank, AC units, antenna, vending machine, neon frames, billboard frame), shrine (gate, lanterns, cherry trees, stone path tiles, offering box, bamboo fence), **new stage "Monsoon Market"** (spice stall with awning, chai stall, hanging string lights, wet street tiles, auto-rickshaw-style generic 3-wheeler, crates, railway platform bench).
- [ ] A3 **Crowd spectator models** (3–4 low-poly stylized body types, ≤800 tris each, one atlas with color variants, simple rig: Hips/Spine/Head/Arms for a cheer motion).
Each item: previews in `public/characters/previews/` or `public/props/previews/`, update the README/manifest, commit on `astra/assets-ch2`, PR into `main` when A1 (mika + lyra) is done.

## 6. Module map
| Folder | What |
|---|---|
| `src/core/` | integer math, PRNG, serialize/hash |
| `src/sim/` | combat sim (step, input/motion parser, movement, collision, hit, meters, rounds, camera hint, poses) |
| `src/data/chars/` | fighter stats + move data (frame data, hitboxes, anim keyframes) |
| `src/ai/` | CPU controller + training dummy |
| `src/render/` | GameRenderer: GLB fighters, pose→bone animation, stages, camera, debug boxes, menu scenes |
| `src/vfx/` | particles, projectiles, beam clash, impact frames, speed lines, comic text |
| `src/audio/` | WebAudio synth SFX + procedural music + announcer |
| `src/ui/`, `src/app/`, `src/input/`, `src/styles/` | screens, HUD, broadcast layer, app loop, keyboard/gamepad/touch |
| `src/net/` | PeerJS transport, rollback core, online lobby, overlay |
| `tests/` | `run.ts` (sim), `ai.ts`, `net.ts`, `e2e_online.py` |
| `tools/assets/` | Blender scripts that build the fighter GLBs |

## 7. When you finish a task
Commit on `astra/continue`, push, and add a line under "Log" below: date, task, what changed, anything left.

## Log
- 2026-11-18 — Claude (lead): all modules on `main`. The v2 renderer, model upgrade and UI polish helpers were STOPPED mid-work and their work committed as-is. State at handoff: typecheck 0 errors, sim tests 256/256, build OK, a live match runs with GLB fighters, HUD, commentator + ticker, crowd (see `docs/screenshots/live-match-v2.png`), no console errors in a smoke test. NOT verified: every pose on bones, awakened swap, Goro plates, menu 3D scenes, phone layout, All 4 models ARE at v2 (manifest version 2, 21–25k tris each) — T3 is a visual quality check, not a rebuild. Match camera looked close/dark in the smoke test — check framing + lighting in T2/T4.
