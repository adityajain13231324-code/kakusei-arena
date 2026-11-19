# KAKUSEI ARENA - bug log (T6 full playtest, UI/QA pass)

Run on 2026-11-19 against `main` working tree. Driver: Python Playwright + `/usr/bin/google-chrome`
(SwiftShader GL for visuals, `--disable-3d-apis` for fast logic runs) at 1280x720 and 844x390 (touch emulation).
Dev server: a copy of the vite config with HMR + file watching off, so other agents' edits do not reload the page mid-test.

Severity: S1 = blocks play / data loss, S2 = clearly wrong behaviour, S3 = polish.
Status: FIXED (re-tested), OPEN (owner has to act), NOTE (not a bug, environment artifact).

## Fixed in this pass (owner: UI / app / input / styles)

| ID | Sev | Bug | Repro | Owner folder | Status |
|---|---|---|---|---|---|
| QA-01 | S1 | Gamepad **Start** never paused in game and never confirmed in menus. `edge(9)` was consumed by the generic button loop before `startEdge` read it, so it was always false. | Plug pad, enter a match, press Start. (Emulated with a fake `navigator.getGamepads`.) | `src/input/index.ts` | FIXED. Start now pauses in game and confirms in menus. |
| QA-02 | S1 | **Enter after a mouse click double-activates.** The clicked button keeps DOM focus, Enter fires the native click and the menu "confirm" -> toggles twice (settings row stays unchanged, menu rows can fire twice). | Settings -> click "Reduce flashing" (ON) -> press Enter: stays ON (expected OFF). | `src/input/index.ts` (preventDefault for Enter like Space) | FIXED |
| QA-03 | S2 | Settings / key-binding lists do not scroll to the focused row. With keyboard/pad the Controls rows, Reset and Back were off-screen with no feedback (1280x720 and worse at 844x390). | Settings, press Down 10 times. | `src/ui/dom.ts` (`Nav.reveal`) | FIXED |
| QA-04 | S2 | Phone: settings list cannot be scrolled by touch. The global `touchmove` blocker only whitelisted `.ml-scroll, .ht-body`, not `.set-card`. | 844x390 touch, Settings, drag the list. | `src/app/app.ts` | FIXED |
| QA-05 | S2 | Phone / touch: **How to play** and **Move list** had no on-screen back button (only ESC / B). Touch players were stuck. | 844x390 touch, Main menu -> How to play. | `src/ui/screens/howto.ts`, `pause.ts`, `main.css` | FIXED (BACK pill top-right) |
| QA-06 | S2 | Move list / pause / HUD layering: every `.screen > *` is `z-index:1` and screens did not form stacking contexts, so the pause menu text drew **through** the move list and HUD bars drew above the pause dim layer. | Training, pause, Move list (any size, worst at 844x390). | `src/styles/main.css` (`.screen {isolation:isolate}`, movelist bg .97) | FIXED |
| QA-07 | S2 | Phone training: the open training panel sat under the touch buttons (VAN / ULT / H / K unusable or hidden). Collapse-on-touch code was disabled (`&& false`). | 844x390 touch, Training. | `src/ui/screens/hud.ts` | FIXED (starts collapsed on coarse pointers; the TRAINING tab re-opens it) |
| QA-08 | S2 | Phone held upright: the "rotate your device" overlay covers the game but the match keeps running behind it (you get hit while looking at the overlay). | Match at 844x390, resize to 390x844. | `src/app/app.ts` (auto-pause on portrait, offline modes only) | FIXED |
| QA-09 | S2 | **RANDOM** pick changed fighter on confirm: preview showed e.g. Goro, locking in re-rolled to Shiori (hover + click rolled twice too). | Versus: P2 presses right to RANDOM (shows a fighter), then confirms. | `src/ui/screens/select.ts` | FIXED (the previewed fighter is the pick; move off and back to re-roll) |
| QA-10 | S3 | Two stacked pause buttons on touch (HUD button plus the touch layer's own). | 844x390 touch, any match. | `src/styles/main.css` | FIXED (touch-layer one hidden) |
| QA-11 | S3 | Training panel buttons (Hitboxes / Infinite Ki / dummy name) out of sync after F2 or pause-menu toggles. | Training, press F2: hitboxes show, panel button stays off. | `src/ui/screens/hud.ts` | FIXED |
| QA-12 | S3 | Training: input history covered the P1 Ki meter, frame-data card overlapped the P2 Ki meter (1280x720). | Training, any size. | `src/styles/main.css` | FIXED (7 history rows, card 0.6em higher) |
| QA-13 | S3 | Select screen: sub-title crowded the heading, and the CONTROLS EASY / PRO switch was clipped by the centre panel (PRO cut off at 1280x720). Keyboard hint line shown on phones. | Select screen, 1280x720 and 844x390. | `src/styles/main.css` | FIXED |
| QA-14 | S3 | "Reduce flashing" only affected the 3D post pass; looping UI pulses (low-HP glow, ki glow, awaken glow) kept running. | Settings -> Reduce flashing ON, low HP. | `src/app/app.ts`, `main.css` | FIXED (`.reduce-flash` limits CSS loops to one iteration) |
| QA-15 | S3 | With WebGL unavailable the app showed a black screen and no message. | Chrome with GPU/WebGL disabled. | `src/app/app.ts` | FIXED (toast on the title screen) |
| QA-16 | S3 | Online pause menu gave no hint that the match keeps running. | Online match, pause. | `src/ui/screens/pause.ts` | FIXED (note under the menu) |
| QA-24 | S2 | Touch pad stayed visible over the **results** and **interlude** screens (and kept swallowing taps near the result buttons). `updateTouch()` ran before the screen changed. | 844x390 touch, lose or win a fight. | `src/app/app.ts` (loop re-evaluates touch visibility whenever the top screen changes) | FIXED |
| QA-17 | S3 | `tests/e2e_online.py` selector `get_by_text('SAKURA SHRINE')` became ambiguous after the v2 select screen also has a SAKURA SHRINE chip (strict-mode error). | `python3 tests/e2e_online.py` | `tests/e2e_online.py` (net test) | FIXED (`.on-stage` scoped) |

## Open: other owners

| ID | Sev | Bug | Repro | Owner | Status |
|---|---|---|---|---|---|
| QA-20 | S2 | Training dummy **Jump** does not jump: it taps Up for 4 frames every 100 frames, which the sim treats as a **sidestep in** (CONTROLS.md: jump needs Up+6/4 or double-tap Up). | Training -> pause -> Dummy: JUMP, watch P2: pose `sideStep`, mode `sidestep`, it never leaves the ground. | `src/ai/dummy.ts` (e.g. Up, release, Up within 12 frames, or Up + Btn forward) | FIXED (lead: double-tap Up) |
| QA-21 | S3 | Mirror-match P1-side advantage hinted at by AI tests (CONTINUE.md T6) was not investigated in this UI pass. | `npm run test:ai` mirror matches | `src/sim` (step / movement order) | OPEN (sim owner) |
| QA-22 | S3 | Render canvas backing store is always 0.75 x the CSS size (633x292 for 844x390 at DPR 1, 960x540 at 1280x720, also on `medium`/`high`). Looks soft; presumably an intentional render scale. | Any match, compare `canvas.width` to `innerWidth`. | `src/render` | NOTE for render owner: confirm intended |
| QA-23 | S3 | 3D stage sign ("KAKUSEI" banner) sits behind the top-left HUD name on 844x390 (pink letters under REN / TSUKISHIRO). Cosmetic. | 844x390, Rooftop, match start. | `src/render/stage` | OPEN (render owner, low) |

## Notes (not bugs)

- Console in normal play under SwiftShader shows only SwiftShader artifacts: `GL Driver Message ... GPU stall due to ReadPixels` (portrait snapshots via readPixels) and `THREE.WebGLRenderer: KHR_parallel_shader_compile extension not supported`. No app errors or warnings. With `--disable-3d-apis` three logs its "context could not be created" error, which is expected there.
- The 3D renderer under SwiftShader runs at about 5-10 fps, so the sim runs in slow motion in GL runs; all logic checks were done with the renderer off (same sim, input and UI code) and visuals with GL.
- A mouse pointer resting over a menu button focuses it (pointerenter), which can start the focus on the 2nd results button after clicking FIGHT. Expected hover behaviour.

## Coverage matrix (what was driven)

| Area | Result |
|---|---|
| Title / main menu / How to play / Settings / Credits / Online menu, keyboard + mouse + touch taps, back with ESC / B / on-screen | pass (after QA-05) |
| Arcade: easy full fight with scripted keyboard inputs (2 rounds), hard + nightmare with HP assist, next challenger x2, arcade clear, defeat -> results -> CONTINUE (rematch), CHARACTER SELECT, MAIN MENU | pass |
| Versus one keyboard: P1 WASD + JKLI, P2 arrows + Numpad / `,` `.` `/`, easy/pro toggles (W / Up), RANDOM, rooftop + shrine, win -> results -> rematch, P2 navigating results | pass (after QA-09) |
| Training: all 6 dummy modes, F2 hitboxes, infinite ki, R reset, frame data, input display, pause menu rows, move list, training grid stage | pass except QA-20 |
| Online with `?net=local` (BroadcastChannel): create, join by link, picks, ready, start, full match, results, rematch, leave, rollback + hash agreement (`tests/e2e_online.py`), phone-size lobby and pause | pass |
| Settings persistence after reload (volumes, quality, flashing, announcer, broadcast, touch, schemes, key remap) and remap in game | pass |
| Pause / resume, tab hidden auto-pause, resize 1920 / 1280 / 600 / 844, portrait overlay | pass (after QA-08) |
| Touch controls: stick 4 directions + diagonal, every button incl. THR / VAN / 覚 combos, multi-touch stick + L + K, pause | pass (checked via the bits the sim receives) |
| Gamepad (emulated): menu nav (d-pad, stick, A, B), in-game buttons + axis, Start | pass after QA-01 |
| Audio: volume settings reach the engine, master 0 is silent, announcer flag | pass |
