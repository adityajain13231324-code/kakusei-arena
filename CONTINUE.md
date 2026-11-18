# CONTINUE.md — Handoff for the next agent

Read this whole file before touching code. Then read `CONTRACTS.md`, `docs/KAKUSEI_ARENA_PROJECT_PLAN.md` (start with the **★ v2 QUALITY UPGRADE** section), `docs/CONTROLS.md`, `docs/NETCODE.md`.

## 1. What this is
KAKUSEI ARENA: a browser 3D anime fighting game (Tekken-style 3D movement + anime powers). Vite + TypeScript strict + three.js 0.181 (WebGLRenderer). 4 ORIGINAL fighters: Kaito (fire), Shiori (shadow ninja), Ren (iaido sword), Goro (earth grappler). Stages: rooftop, shrine, training.

## 2. Branches
| Branch | What's in it |
|---|---|
| `main` | Stable, tested modules: sim + roster data, CPU AI, VFX, synth audio, UI/menus/HUD/touch, online rollback, Astra's v1 models. |
| `claude-wip` | Snapshot of work still in progress: GLB-skinned renderer (`src/render/`), upgraded v2 models (`public/characters/`), UI polish v2 (fightkaro-style select, broadcast commentator/ticker). May be unfinished. The lead may push a newer snapshot or merge it into `main` — always fetch first and start from the newest of the two. |
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
- [ ] **T1 Sync.** `git fetch`, branch `astra/continue` from the newest of `main` / `claude-wip`. Run all commands in §3. Fix any errors first.
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
- 2026-11-18 — Claude (lead): v0.1 modules merged to `main`; v2 renderer/models/UI polish snapshot on `claude-wip`.
