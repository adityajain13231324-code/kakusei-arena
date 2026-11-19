# KAKUSEI ARENA — Plan v3: "Season 1"

## Goal
Ship **KAKUSEI ARENA Season 1**: 9 fighters, cinematic "Soul Realm" ultimates on par with the biggest anime moments, a smooth fightkaro-level UI, live on Vercel + the Web Games hub, playable online with friends.

**Done when:**
- 9 fighters playable (4 current + 5 new headliners), each with a showstopper signature system, Awakening, Ultimate and a Soul Realm ultimate.
- Every menu and transition runs at 60 fps on an Iris Xe laptop and a mid-range phone, first load < 10 s.
- Online rooms tested between 2 real devices; no desyncs over 20 matches.
- 10 friends play it without being told how.

## Characters stay original
Real anime characters (and lookalikes, signature techniques by name, or copies of their designs) are owned by their studios. A public game that uses them gets taken down, and hurts the hub site and the GitHub account. So every fighter stays original — but each headliner gets one **big, unique, cinematic signature** so the roster hits the same hype level.

## 5 new headliners
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
| **P4 Mika + Lyra** | Models (Astra), moves/data/AI/VFX/audio (Claude) | Astra + Claude | both playable, balanced 40–60% |
| **P5 Daichi (Colossus) + Seraph** | Colossus needs a 2nd skeleton/model + camera mode; Seraph flight | Astra + Claude | both playable |
| **P6 Oboro** | Boss with 3 forms, Arcade final fight, playable after unlock | Astra + Claude | arcade ends with Oboro |
| **P7 Polish + launch** | Story panels (optional), trials, balance, perf, trailer | All | Season 1 launch |

## Budgets & rules
Same golden rules as `CONTINUE.md §4` (determinism, contracts, original designs, 60 fps, tests before push). Colossus model ≤ 30k tris; realm swap must not drop frames (pre-built + pre-warmed during VS screen).

## Usage note
Claude's helper agents hit the weekly usage limit (resets Nov 22, 4:30 am IST). Work resumes from P0 then.
