# KAKUSEI ARENA — Team Contracts (v0.1 build)

Full design: `docs/KAKUSEI_ARENA_PROJECT_PLAN.md`. Shared types: `src/sim/types.ts` (source of truth).

## v0.1 scope (this build)
- Roster: **Kaito** (fire hero), **Shiori** (shadow ninja), **Ren** (iaido swordsman), **Goro** (earth grappler). Original designs only.
- Stages: **rooftop** (Neon Rooftop, night city), **shrine** (Sakura Shrine), **training** (grid void).
- Modes: Arcade vs CPU, Local Versus (2 players one keyboard / gamepads), Training (hitbox viewer, frame data, dummy settings). Online rooms come in a later pass (module `src/net`).
- Systems: 3D movement (sidestep/sidewalk/dash/backdash/jump/crouch), heights, throws + breaks, counter hits, launch + juggles with scaling, walls + wall splat, Ki gauge (3 bars) + Ki charge + Ki specials, Vanish Step, Awakening (once/match <35% HP), Ultimates (cinematic), Beam Clash, best-of-3 rounds, 60 s timer.
- Renderer: three.js **WebGLRenderer** (decision: simpler + widest support for v0.1; WebGPU later). Procedural anime-style humanoids (no external model files) with toon shading + inverted-hull outlines, stepped "limited animation".
- Audio: fully synthesized with WebAudio (no audio files).
- Performance: 60 fps on Intel Iris Xe laptop and mid-range phones.

## Module ownership (each agent edits ONLY its own folders)
| Module | Folder(s) | Public API (keep signatures) |
|---|---|---|
| Sim + data | `src/core/`, `src/sim/`, `src/data/`, `tests/`, `docs/CONTROLS.md` | `src/sim/index.ts` |
| Render | `src/render/` | `src/render/index.ts` → `GameRenderer` |
| VFX | `src/vfx/` | `src/vfx/index.ts` → `VfxSystem` |
| Audio | `src/audio/` | `src/audio/index.ts` → `AudioSystem` |
| UI / input / app shell | `src/ui/`, `src/input/`, `src/main.ts`, `src/styles/`, `index.html`, `public/` | `src/input/index.ts` → `InputManager` |
| AI | `src/ai/` | `src/ai/index.ts` → `CpuController` |
| Net | `src/net/` | later |

Rules:
1. Never edit another module's folder. If you need an API change, add `// CONTRACT-REQUEST:` note in your own code and mention it in your final report; work around it meanwhile.
2. `src/sim/types.ts` changes: only the SIM agent, and only additive (new optional fields), never renames.
3. Do not run `git commit` / `git push`. The lead integrates and commits.
4. `npx tsc --noEmit` must show **zero errors inside your folders** before you finish (ignore errors from folders still being built by others).
5. No new npm dependencies without a strong reason (three is installed). Never use network assets at runtime — everything procedural or bundled.
6. Coordinates: sim uses integer mm; renderer converts with `/1000` to metres.
7. Screenshots: Google Chrome + Python Playwright are available (`/usr/bin/google-chrome`, `python3 -c "import playwright"`). Use `npx vite --port <unique>` + a playwright script with `--use-gl=swiftshader` / `--enable-unsafe-swiftshader` to check visuals. Use your own port: render 5181, vfx 5182, ui 5183, sim 5184, ai 5185.
