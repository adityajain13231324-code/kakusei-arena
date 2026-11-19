# KAKUSEI ARENA — Balance & combat feel (T6 side bias + T7)

All numbers come from the deterministic sim. Reproduce them with:

```bash
npm test               # side-symmetry proof, BnB combos, combat systems, move-data rules
npm run test:balance   # ~2-3 min: mirror-match side bias, hard-vs-hard win matrix, BnB damage table
npx tsx tests/combo-finder.ts kaito 3H 3   # dev tool: search follow-ups after a starter
```

## 1. P1-side bias (T6)

### Findings
1. **The "P1 always wins mirror matches" signal was mostly a test artifact.** The CPU seeds its
   random rolls from `(state.frame, player, difficulty)` only, so every match with the same two
   characters was the *same* match, whatever the match seed. One match per cell decided a 0/1
   result. With varied CPU rolls (see `tests/lib/harness.ts`, below) the old sim was already
   close to 50% in mirrors.
2. **The sim did have real P1/P2 asymmetries.** A strict mirror test (P1 and P2 doing mirrored
   inputs from mirrored positions must give mirror-image states) failed in 47 of 48 runs, within
   100–3000 frames. Root causes, all fixed:
   - **Processing order in physics** (`step.ts` → `movement.ts`): fighter 0 ran its physics
     (integration, sidestep circling, teleports, throw holds, push integration) before fighter 1,
     so fighter 1 saw fighter 0's *new* position and fighter 0 saw fighter 1's *old* one. A
     throw break pushed the breaker on the same frame for one side and a frame later for the other.
     **Fix:** two-phase physics: `physics()` computes velocities for both, reading the other
     fighter only through a start-of-phase snapshot (`snap`), then `integrate()` runs for both.
   - **Body push** (`collision.ts separate`): the odd millimetre of overlap always went to
     fighter 1, and the zero-distance case used fighter 0's facing. **Fix:** both move by the same
     rounded-up half; the zero-distance case uses the screen axis.
   - **Rounding with `>> 1`** (floor) for the camera midpoint and screen side. Negative
     coordinates rounded differently from positive ones. **Fix:** `Math.trunc(.../2)` and the
     screen side from the fighter axis itself.
   - **Strike vs throw on the same frame** depended on player order (the throw could grab even
     though its owner had just been hit; a hit on the thrower became a counter hit).
     **Fix:** strikes resolve first, then throws; a thrower who is no longer in its throw move
     cannot grab. Strikes beat throws from either side.
   - **Chirality**: local "right" (tracking `'left'/'right'`, hitbox `z`, kunai fan order) is a
     real-world direction, so P1's Blazing Elbow (`tracking: 'right'`) caught P2's sidestep *in*,
     while P2's caught P1's sidestep *out*. The CPUs mostly sidestep in, so this favoured one
     side per matchup. **Fix:** lateral directions are screen-mirrored (`lateralSign` in
     `collision.ts`).
   - Input buffering, trade resolution between two strikes and the camera-side input mapping
     were checked and were already symmetric.

### Proof
- `npm test` (g): 23 mirrored runs (all 16 character pairs with random inputs + 7 CPU-driven
  runs, 3000 frames each) stay mirror-identical on every frame. Same-frame scenarios (jab trade,
  throw vs throw, throw vs jab both ways, sidestep vs tracking, Smoke Swap vs Smoke Swap) too.
- `npm run test:balance` (1): 200 nightmare-vs-nightmare mirror matches per character, each
  with independently varied CPU rolls:

| Fighter | P1 wins | P2 wins | draws | P1 rate |
|---|---|---|---|---|
| kaito | 102 | 98 | 0 | 51% |
| shiori | 93 | 107 | 0 | 47% |
| ren | 89 | 111 | 0 | 45% |
| goro | 100 | 100 | 0 | 50% |
| **all (800)** | | | | **48%** |

All within one to two standard errors (±3.5% per fighter at n = 200). What is left is the CPU's
own randomness, not the sim.

**Harness note.** `tests/lib/harness.ts` gives each CPU a view of the state with `frame`
shifted by a per-match offset (hashed from the seed). Only the CPU's rolls change; the live
state is untouched. `src/ai/` was not modified. If the AI owner wants real per-match variety in
the game, the controller could mix `state.seed` into its PRNG seed.

## 2. Combat systems changed or added

| System | Rule |
|---|---|
| Hitstop | light 7, medium 9, heavy 11, super 14; counter hit / guard crush +3; block −2 |
| Ultimate hit-freeze | cinematic pauses 14 f on the connect and on the final hit, 3 f on the others (`ult.freeze`) |
| Juggle gravity | floaty at the start (2 mm/f²), +0.5 mm/f² per combo hit (max +4.5); weight counts half |
| Juggle pop | 38 − 2×hits (min 16) mm/f per hit, 4 mm/f carry; a launcher mid-juggle is just a bigger pop |
| Juggle cap | from hit 9, juggle hits stop popping → every juggle ends (no infinites) |
| **Ender rule** | a special / Ki move hitting a juggled opponent sends them into a knockdown arc; no more hits until they land (bounce and wallbounce moves excepted) |
| Ground bounce | once per combo; a standing opponent only bounces on a counter hit |
| Stagger | +20 f hitstun (combo starter), only on a fresh hit (no stagger loops) |
| Wake-up | a hit after getting up is a new combo (no scaling carried over) |
| **Guard Crush** (new) | hidden meter 1000, block costs 40 + 2×damage (projectiles / ults half), regen 6/f after 60 f; empty → 44 f stagger, `guardCrush` event |
| **Ground hits** (new) | `otg` moves hit a lying opponent once per knockdown from KD frame 6: Kaito 2K, Shiori 2K, Ren 2L, Goro 4K; 70% damage, `hit` tag `otg` |
| **Clash rotation** (new) | every new cardinal stick direction counts as one mash press |
| Armor | absorbs highs / mids only; lows go through |
| Throws | damage up (130 / 120 / 125 / 150), break window 18 → 15 frames |
| Invincible reversals | Rising Phoenix / Rising Moon: knockdown on hit, launch only on counter hit |

## 3. Frame data rules (enforced by `npm test` (j))

- Every move that launches on hit **or** counter hit is ≤ −10 on block (punishable by a 10f jab).
  Normal-hit launchers (3H) are −14/−15.
- Every low (non-projectile) is ≤ −12 on block. Light lows are +3/+4 on hit.
- `onBlock` / `onHitAdv` in move data are derived from the frame data and checked against
  `blockstun` / `hitstun` for every move (stagger moves show the +20).

## 4. Fighters: game plan, key data, BnB combos

Damage below is with no Heat stacks, vs any opponent (the BnBs are verified on all four).
Notation: numpad, `,` = string / follow-up, `xx` = cancel, `66` = dash, `(wall)` = defender ~0.7 m from a wall.

### Kaito — all-rounder (1020 HP)
Plan: mid-range pressure. Jab (+1) and Blazing Elbow (−3, counter-hit stagger) keep turns,
Homura Shot controls mid range, every hit-confirm ends in Blaze Knuckle (cashes in Heat stacks).
Rising Phoenix (7f, invincible) is the reversal; Cinder Drop bounces juggles.
Changes: Blaze Knuckle −4 → −12 on block (125 dmg, still a CH launcher), L,L,H now cancellable on
hit, launcher 72 → 62 launch, Rising Phoenix knockdown (launch on CH), Cinder Drop 23f, bounce on CH.

| Combo | Inputs | Hits | Damage |
|---|---|---|---|
| Jab string confirm | `L, L, H xx 41236S` | 4 | 224 |
| Launcher (bounce) | `3H, 214S (bounce), H xx 41236S` | 4 | 349 |
| Launcher (simple) | `3H, H, H,H` | 3 | 243 |
| Ultimate ender (3 bars) | `3H, 214S, H, 236H+S` | 15 | 480 |
| Wall splat (wall) | `3H, H xx 41236S (splat), 66 H, H,H` | 5 | 387 |

### Shiori — fast trickster (1040 HP)
Plan: get in and mix up. +2 jab, Shadow Knee (−2, full tracking), Crescent Kick high vs Shadow
Stitch low (staggers → full combo, −14 if blocked), Crow Dive from the air, Smoke Swap to cross
up, kunai fan to cover the approach.
Changes: HP 900 → 1040, weight 92 → 100, most damage +10%, kunai fan 4 f faster recovery,
Shadow Stitch hit +4 with a real stagger (no more 44 f stun loops), launcher 14f.

| Combo | Inputs | Hits | Damage |
|---|---|---|---|
| Jab string confirm | `L, L, H xx 623S` | 4 | 240 |
| Launcher | `3H, H, H,H xx 623S` | 4 | 355 |
| Low stagger | `41236S (stagger), H xx 623S, 2K (ground hit)` | 4 | 354 |
| Ultimate ender (3 bars) | `3H, K, H, 236H+S` | 15 | 472 |
| Wall splat (wall) | `3H, H, H,H (splat), 66 K, H` | 5 | 379 |

### Ren — long-range swordsman (920 HP)
Plan: control space with the longest reach. Piercing Thrust and Crescent Cut poke from outside
the opponent's range, Crescent Wave zones, Moon Step (full tracking) beats sidesteps, Sheath
Stance counters highs. Low HP is the price for range.
Changes: HP 1000 → 920, Crescent Wave 100 → 70 dmg and +6 f recovery, Rising Moon 125 → 92 and
knockdown (launch on CH, invuln 1–7), Moon Step 115 → 85 / 20f / −11, Quick Draw −6 → −11,
Thrust −4 → −8.

| Combo | Inputs | Hits | Damage |
|---|---|---|---|
| Jab string confirm | `L, L, H xx 623S` | 4 | 202 |
| Launcher | `3H, H, H,H xx 623S` | 4 | 306 |
| Launcher (long) | `3H, L, H, H,H xx 214S` | 5 | 310 |
| Ultimate ender (3 bars) | `3H, H, 236H+S` | 8 | 418 |
| Wall splat (wall) | `3H, H, H,H (splat), 66 H, H,H` | 5 | 369 |

### Goro — armored grappler (1080 HP)
Plan: walk forward behind Stone Skin (H, 3H, 6H armor highs/mids), force the opponent to block
or crouch, then Mountain Hug (unbreakable, grabs crouchers) or a normal throw. Avalanche Charge
ends combos into the wall. Lows and throws beat his armor.
Changes: Mountain Hug 12f/200 → 22f/120 with 40 f recovery, Avalanche armor [1,24] → [10,18],
22f, 92 dmg, −15; armor removed from L,L,H and H,H and narrowed elsewhere; palm / shoulder −10
damage; walk 36 → 40, dash 78 → 86; HP 1150 → 1080.

| Combo | Inputs | Hits | Damage |
|---|---|---|---|
| Poke confirm + ground hit | `H xx 214S, 4K (ground stomp)` | 3 | 239 |
| Launcher | `3H, L, H xx 41236S` | 4 | 278 |
| Launcher (long) | `3H, L, H, H,H` | 4 | 301 |
| Ultimate ender (3 bars) | `3H, L, H, 236H+S` | 6 | 445 |
| Wall splat (wall) | `H, H (wallbounce splat), 66 H, 4K (ground stomp)` | 4 | 352 |

## 5. Win-rate matrix (CPU hard vs hard)

100 matches per cell, sides alternating every match, row fighter's win rate:

| vs | kaito | shiori | ren | goro | avg |
|---|---|---|---|---|---|
| **kaito** | — | 52% | 49% | 45% | 48% |
| **shiori** | 49% | — | 58% | 46% | 51% |
| **ren** | 51% | 42% | — | 57% | 50% |
| **goro** | 55% | 54% | 43% | — | 51% |

Every cell is within 42–58% (target 40–60%). Average fight time per round: **31.8 s**
(1497 rounds, 4 time-outs). Target 25–45 s.

Before this pass, at hard: Goro won 90–100% against Kaito and Shiori, Shiori lost every
matchup, and juggles barely worked (launcher recovery outlasted the opponent's airtime).

## 6. Caveats / follow-ups
- Balance is measured CPU-vs-CPU. The CPU leans on specials (Blaze Knuckle, Crow Dive, Moon Step,
  Avalanche) and rarely uses strings or juggles, so human balance will differ. Re-run
  `npm run test:balance` after any data change. The matrix is sensitive: one data change can move
  a cell by ±10%.
- BnBs are verified against an idle dummy. Ground hits can be avoided by an early wake-up.
- `tests/ai.ts` "think() worst frame < 8 ms" fails now and then on a busy machine, also on the
  unchanged base commit (timing noise, not logic).
