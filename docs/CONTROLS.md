# KAKUSEI ARENA — Controls & Combat Rules (sim reference)

Every rule here is implemented in `src/sim/`. Inputs reach the sim as **screen-relative** bits
(`Btn` in `src/sim/types.ts`). The sim converts Left/Right to Forward/Back from the fighter's
screen side every frame. Notation: numpad, relative to facing (6 = forward, 4 = back,
2 = down, 8 = Up = into the screen). Buttons: **L** Light, **H** Heavy, **K** Kick, **S** Ki/Special.

## Movement

| Action | Input | Notes |
|---|---|---|
| Walk forward / back | hold 6 / 4 | Holding back also guards (see Guard) |
| **Sidestep in** | tap Up | 18 frames, circles the opponent (distance kept), into the screen |
| **Sidewalk** | keep holding Up after the sidestep (or hold Up from neutral) | slower lateral walk |
| **Sidestep out** | tap Down (press and release within 10 frames, nothing else pressed) | toward the camera |
| Crouch | hold Down | Ducks highs; crouching while holding Down also guards lows |
| Forward / back jump | Up+6 / Up+4 (or press 6/4 while holding Up) | 3-frame pre-jump, ~40 frames airborne. Up then 6/4 within the first 2 sidestep frames also jumps |
| **Neutral jump** | double-tap Up (Up, release, Up within 12 frames) | also works from inside the first sidestep |
| Dash | double-tap 6 (tap, release, tap within 12 frames) | 16 frames, attacks allowed from frame 3, 4 cancels it |
| Backdash | double-tap 4 | 20 frames, can act from frame 12 |
| Early wake-up | any button or Up while knocked down, after 14 frames | otherwise stand after 40 frames |

SOCD: Left+Right = neutral, Up+Down = Up.

**Screen sides & camera.** `state.camera.normal` is perpendicular to the fighter axis. Of the two
possible normals, the sim always picks the one closest to last frame's, so the camera never
jumps to the other side. Screen-right = (normal.z, −normal.x). A fighter's `side` (−1 left,
+1 right) comes from that, so after a side switch (jump over, vanish) Left/Right flip correctly.

**Facing.** Fighters face each other in neutral. Facing **locks** when an attack starts.
Moves with `tracking` other than `'none'` keep re-aiming until their first active frame.
After the opponent vanishes or Smoke Swaps behind you, your facing is locked for 24 frames
(`turnLock`). Starting any attack turns you around at once ("vanish read").

## Attacks

| Input | Pro scheme | Easy scheme |
|---|---|---|
| Normals | L, H, K; 2L, 2K, 3H, 6H, 4K; in the air L/H/K (j.K, j.H) | same |
| Strings | L,L,H and H,H (press the next button during the move) | **mash L** = L → L,L → L,L,H → auto ender special (on contact) |
| Specials | 236S, 623S, 214S, 41236S (Ren: 4S hold = Sheath Stance) | 6S, 2S, 4S, 8S (8 = Up) |
| Ki specials (1 bar) | 236S+K; 41236S+K (awakened-only move) | S+K; 2S+K (awakened-only move) |
| Throw | L+K | L+K |
| **Vanish Step** (1 bar) | H+K | H+K |
| **Awakening** | L+H+K | L+H+K |
| **Ultimate** (3 bars, 2 when awakened) | 236 + H+S | Ult button |
| Guard | hold 4, or hold Guard (add 2 for a low guard) | same |
| Ki Charge | hold S alone (no direction) for 15+ frames | same |

Normal lookup by direction: 3 → 3x, else 2x, else x. 1 → 2x, else x. 6/4 → 6x/4x, else x.
7/8/9 (while sidestepping) → x. Easy specials: 2S also accepts 1/3, 8S accepts 7/9. Easy-scheme
specials and ki specials do **10% less damage**.

**Input leniency.** Motions must be finished within **12 frames** of the button press (optional
in-between diagonals: 2→6 counts as 236, 2→4 as 214, 4→2→6 as 41236; 623 needs 6, 2 (or 1), 3).
Priority when several match: 41236 > 623 > 236 > 214. Buttons are **buffered for 6 frames**.
The buffer does not count down during hitstop. Multi-button inputs (L+K, H+K, L+H+K, S+K, H+S)
must have their presses within 3 frames of each other. Pressing the second button within the
first 3 frames of a normal upgrades the normal (jab → throw / vanish / ki / ultimate).

**Action priority:** Ultimate > Awakening > Vanish > Throw > Ki special > Special > Normal.

## Frame data convention

- The step a move starts on is **move frame 1** (`fighter.moveFrame === 0`).
- `startup` = frames before the first active frame. The first active frame is **frame startup+1**
  (`moveFrame === startup`). A 10f jab hits on the 11th step counting the input step. Equivalently,
  it hits 10 steps after the input step. Verified for every move by `npm test`.
- Hitboxes, `invuln`, `armor`, `cancelWindow` and `projectile.spawnFrame` are **1-based frames**.
  `anim`, `movement`, `teleport.frame`, `ultHits` and `stance.loopFrame` use **0-based moveFrame**.
- `movement` keys `[frame, fwd, up]`: `fwd` mm/frame holds until the next key. A non-zero `up`
  is an upward impulse applied once on that frame, then gravity (4 mm/f²) takes over.
- Data is authored as advantage: `MoveDef.onBlock` / `MoveDef.onHitAdv` are the advantages, and
  `blockstun` / `hitstun` are derived from them for the last hitbox. The training HUD can read
  the advantage measured in play from `state.frameAdv`.
- Total = startup + active + recovery. The fighter acts again on the following step.

## Combat rules

- **Heights.** High: whiffs on crouchers, blocked standing. Mid: must be blocked standing (hits
  crouch guard). Low: must be blocked crouching. Throw: not blockable. Unblockable: not blockable.
- **Guard.** You block when free (idle/walk/crouch/guard/sidewalk, backdash ≥ frame 10, sidestep ≥
  frame 12), the attack comes from in front, and you hold 4 / Guard (or are already in
  blockstun). Hold 2 to crouch-guard. You cannot guard in the air or from behind.
- **Hitstop.** Both fighters freeze on contact: light 8, medium 10, heavy 12, super 14 frames
  (block −2, counter +2). Projectiles freeze only the defender.
- **Pushback.** Spread over a few frames. A defender pinned on a wall passes the remaining push
  to the attacker.
- **Counter hit.** A hit during the opponent's startup frames, during Ki Charge, or from behind:
  +20% damage, the move's `onCounterHit` effect, +4 hitstun, `counter` event (tag `backHit` from behind).
- **Trades.** Both fighters' hitboxes are found first and resolved after, so simultaneous hits trade.
- **Sidestep vs tracking.** During sidestep frames 2–14, once the sidestepper has moved ≥ 120 mm
  sideways, **linear** strikes (`tracking: 'none'`) miss. `'left'` / `'right'` catch sidesteps
  toward the attacker's left / right. `'full'` always catches. Projectiles use geometry only.
- **Launch & juggle.** Launchers pop the defender into `juggle`. Juggle gravity = (4 + hits/2,
  max +6) × weight/100. Each juggle hit gives a small pop (46 − 3×hits, min 20 mm/f).
  **Damage scaling** per hit in a combo: 100, 90, 80, 70 … minimum 30%.
- **Ground bounce.** `groundbounce` moves bounce a grounded or juggled opponent off the floor
  once per combo.
- **Wall splat.** A juggled fighter knocked into a wall at ≥ 8 mm/f sticks to it for 45 frames
  and stays hittable. Once per combo. `wallbounce` moves knock hard so they splat near walls.
- **Knockdown.** Landing from a juggle = knockdown (invulnerable while lying, 40 frames, early wake
  from 14). Wake-up is 22 frames, invulnerable for the first 12.
- **Throws.** L+K: 10f startup, short range, whiffs on crouchers, airborne opponents, and
  opponents in hit- or blockstun. Break with a fresh **L or K** on thrown frames 1–18 →
  `throwBreak`, both fighters reset. Damage lands on thrown frame 24. Throws from behind, and
  command throws (Goro's Mountain Hug), are **unbreakable**. Command throws also grab crouchers.
  If both fighters throw on the same frame, the throws break automatically.
- **Armor** (`armor: [a,b]`, Goro's Stone Skin): absorbs one hit during those frames. The armored
  fighter takes the damage but gets no stun (`hit` event tag `armor`).
- **Invulnerability:** `invuln` frames, knockdown, early wake-up, vanish frames 0–9, awakening,
  throws in progress, ultimate cinematics. `projInvuln` = immune only to projectiles.

## Meters & anime systems

- **Ki** 0–300 (3 bars). You gain the move's `kiGain` on hit, half on block, a quarter on whiff.
  Defenders gain damage/12. Awakened fighters gain ×1.5.
- **Ki Charge:** hold S alone 15 frames → `kicharge` mode, +2 ki/frame, fully vulnerable (a hit
  here is a counter hit). Events `kiCharge` and `kiFull`.
- **Vanish Step** (H+K, 100 ki): 16 frames, invulnerable on frames 0–9, teleports behind the
  opponent on frame 5 (`vanish` events tagged `depart` / `arrive`). Works in neutral, and as a
  cancel any time after a move connects (hit or block).
- **Awakening** (L+H+K, once per match, HP < 35%): 50-frame invulnerable transformation. The
  opponent is frozen and `camera.cinematic.kind = 'awaken'`. Then 12 s awakened: +10% damage,
  +10% max HP healed, ki ×1.5, awakened-only moves unlocked, ultimate costs 200 and uses the
  awakened variant. Ends at round end; it cannot be used again that match.
- **Ultimate** (Pro 236+H+S, Easy Ult; 300 ki or 200 awakened): invulnerable startup, and
  `camera.cinematic.kind = 'ultimate'` during startup. On a hit, the attacker switches to the
  cinematic move (`MoveDef.followup`). The opponent is locked, `ultimateHit` events land on
  `ultHits` frames for ~330 total damage (combo-scaled, +10% awakened), and the opponent is
  launched at the end. The timer pauses during the cinematic. KO is checked after the cinematic.
  Blocked or whiffed, the ultimate has ~50 frames of recovery and is punishable.
- **Beam Clash:** two beam projectiles (`ProjectileDef.beam`) from different players meeting →
  `state.clash.active`, both fighters in `clash` for 180 frames. Every fresh L/H/K/S press adds
  to `mash` and moves `balance` by ±30. At ±1000 or time-out the winner's beam hits for 60% of
  its full damage and launches the loser. A balance of exactly 0 is a draw (both pushed back).
  Events `clashStart` and `clashEnd` (`player` = winner, tag `win` / `draw`). Beams: Kaito
  *Phoenix Cannon*, Ren *Moonlight Severance*, Goro *Titan Roar* (all 236S+K / Easy S+K).
  A beam overpowers normal projectiles. Two normal projectiles cancel each other.

## Character mechanics

- **Kaito — Heat Stacks** (`heatStacks`, max 3): landing a special marked `heat: 'gain'`
  (Homura Shot, Rising Phoenix, Cinder Drop) adds a stack. Blaze moves (`heat: 'consume'`:
  Blaze Knuckle, Crimson Soul Knuckle) spend every stack for +15% damage each.
- **Shiori — Smoke Swap** (214S / Easy 4S): invulnerable teleport behind the opponent on frame 8.
  Kunai Fan throws 3 kunai in a spread (5 in awakened Moonless Fan).
- **Ren — Sheath Stance** (hold 4S): while S is held, Ren stays in stance (`fighter.stance`).
  Releasing S, or reaching 150 frames, fires **Quick Draw** (6f). A high strike that hits Ren in
  stance is auto-countered: `parry` event, the attacker staggers, and Ren does *Falling Petal*.
  Down or Guard drops the stance.
- **Goro — Stone Skin & Mountain Hug:** most heavies have 1-hit armor. Mountain Hug (623S / Easy
  2S) is an unbreakable command throw that also grabs crouchers. Tectonic Suplex is a grab
  ultimate (unblockable).

## Rounds

Intro is 90 frames (`intro` mode, inputs ignored, `roundStart` event) → `fight` event → 60 s
timer (`round.timer` in frames). KO: `ko` event, `slowmo` = 60, `camera.cinematic.kind = 'ko'`.
Timeout: the higher HP percentage wins (equal = draw, both get the round). After 150 frames →
`roundEnd` (winner in `win`, loser in `lose`) → 120 frames → next round (positions and HP reset,
ki carries over) or `matchEnd`. First to `roundsToWin` (default 2) wins. `round.winner` holds the
match winner (2 = draw).

**Training** (`training: true`): no intro, no timer, no KO (HP floors at 1). HP refills 60 frames
after a combo ends. `state.trainingOpts` (UI may change it live): `infiniteKi`, `hpRegen`,
`dummyGuard` ('none' | 'all' | 'random', applies to P2), `dummyCrouch`. `debugBoxes(state)`
returns hurt, hit, throw and projectile capsules.

## Events (VFX / audio hooks)

Every event has `frame`, `player` and a world `pos` (mm). Hit-type events use the contact point on
the defender's hurtbox. Main events: `moveStart` (tag = move kind or `heat`), `whiff` (end of
active frames, at the hitbox tip), `hit` (`damage`, `combo`, tag `juggle` / `armor` / `throw` /
`beam` / `ultimate` / `heat`), `block`, `counter`, `parry`, `launch`, `groundBounce`, `wallSplat`,
`land` (tag `body` for a fallen fighter, `tech` for early wake), `knockdown`, `projectile` (tag =
kind), `projectileHit`, `projectileDestroy` (tag `expire` / `wall` / `spent` / `cancel` /
`overpowered`), `throw`, `throwBreak`, `kiCharge`, `kiFull`, `vanish`, `awaken`,
`ultimateStart`, `ultimateHit` (tag `final` on the last), `clashStart`, `clashEnd`, `sidestep`
(tag `in` / `out`), `dash` (tag `forward` / `back`), `jump`, `roundStart`, `fight`, `ko`,
`timeout`, `roundEnd`, `matchEnd`.
