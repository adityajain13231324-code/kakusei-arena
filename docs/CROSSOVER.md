# Crossover Pack: kits, Soul Realm, contracts

Five licensed crossover fighters for this private build: **Gojo, Naruto, Zoro, Luffy, Eren**. They use the same
systems as the original four (`src/data/chars/*.ts`, `mv()` builders). They also add a few generic sim systems,
all deterministic and side-symmetric (`src/sim/crossover.ts`). All five are in `ALL_CHARS`, so they show up in the
select grid in that order after the original four.

Inputs use numpad notation for a fighter facing right (6 = forward). Easy scheme: specials are direction+S
(6S / 2S / 4S / 8S), Ki specials are S+K / 2S+K, the ultimate is `Ult`.

---------------------------------------------------------------------------------------------------------------

## 1. Soul Realm (generic framework)

| Step | Rule |
|---|---|
| Trigger | While **awakened** with **300 Ki**, the ultimate input (236H+S / Ult) starts the fighter's realm move (`CharDef.realmId`) instead of the awakened ultimate. **Once per match** (`sim.realmUsed`). Costs 300 Ki. With less than 300 Ki you still get the awakened ultimate (200). |
| Realm move | 20-frame hand sign, invulnerable (sure-hit). On move frame `startup`, `state.realm` opens. |
| Cinematic | `realm.phase = 'cine'` for 90 frames. The whole sim is frozen (like an ultimate cinematic). `camera.cinematic = { kind: 'realm', player, frame }`. Event `realmStart` (tag = realm kind). |
| Realm Clash | If the opponent opens its own realm during that window (ult input with awakened + 300 Ki, or its realm move reaching startup), you get a **Realm Clash**. It reuses the beam-clash mash (`state.clash`, `clash.kind = 'realm'`, 180 frames, presses + stick rotation). Events: `realmClash`, `clashStart` (tag `realm`), then `clashEnd` (tag `realm`, player = winner) or (tag `realmDraw`). The winner's realm opens straight into its active phase (a second `realmStart`). A draw cancels both. Both realms count as used. |
| Active | `realm.phase = 'active'` for `realm.duration` frames. The rule twist runs (table below), then event `realmEnd` (tag `time` or `cap`). |

`state.realm: RealmState | null` = `{ owner, kind, phase, frame, duration, cine, moveId, dealt, cap }`.

| Fighter | Realm (kind) | Active | Rule twist |
|---|---|---|---|
| Gojo | Domain Expansion: Infinite Void (`infinite_void`) | 240 f | The opponent is **frozen for 90 frames**: it ignores all inputs, cannot guard or tech, and is put in a stagger if it was standing. Gojo's total damage during the realm is **capped at 35% of the opponent's max HP** (`realm.cap` / `realm.dealt`). The realm ends early (`realmEnd` tag `cap`) once the cap is reached. |
| Naruto | Tailed Beast Bomb (`tailed_beast_bomb`) | 300 f | When it opens, an unblockable 200-damage arena blast hits (knockdown) and 2 shadow clones appear. Clones respawn every 90 frames while the realm lasts. |
| Zoro | King of Hell (`king_of_hell`) | 360 f | Blocked slashes still cut: chip = 40% of the move's damage, and guard meter drain is doubled. |
| Luffy | Gear Fifth (`gear_fifth`) | 360 f | Cartoon physics: the opponent's juggle gravity is 2/3, and a juggled opponent bounces off the floor up to 2 extra times (event `groundBounce` tag `gear5`). Juggle hit cap still applies. `form = 'gear5'`. |
| Eren | The Paths (`paths`) | 360 f | Every 60 frames (on frames 30, 90, ...) a Titan-army stomp hits a grounded opponent: 45-damage **low**, knockdown. The opponent can crouch-block it or jump over it. |

---------------------------------------------------------------------------------------------------------------

## 2. Kits

### GOJO (`gojo`): zoner / control, element `void`
HP 980. Passive **Infinity**:
- Enemy projectiles within 1.2 m of him move at **30% speed** (`projectile.slow = 30`). This turns off while he is being comboed (hitstun / juggle / down).
- The **first hit each round** that would land is auto-guarded instead: blockstun, no chip, no guard drain, works from any side. Event `infinityBlock` (tag `infinity`). `fighter.infinity` goes from 1 to 0 (HUD shimmer indicator). Throws and ultimates go through. In training it recharges 5 s after use.

| Input | Move | Notes |
|---|---|---|
| L, L, H | Flick / Double Flick / Cursed Palm | string |
| H, H | Limitless Palm / Repulse | knockdown |
| K · 2L · 2K | Long Kick · Low Tap · Void Sweep | 2K ground hit |
| 3H | Upward Flick | launcher |
| 6H · 4K | Pressure Step · Heel Drop | 6H staggers on CH; 4K launches on CH |
| j.K · j.H | Falling Kick · Void Hammer | |
| 236S (6S) | **Blue** | slow pull orb; on hit or block it **drags the opponent ~0.9 m toward Gojo** (negative pushback) with 40 f hitstun = combo starter |
| 623S (2S) | **Red** | point-blank repel blast, 7 f invulnerable, wall bounce / wall splat |
| 214S (4S) | **Blink** | teleport behind, **50 Ki** |
| 41236S (8S) | **Six Eyes Counter** | parries high/mid strikes on frames 4-20, answers with Red: Point Blank (130, wall bounce) |
| 236S+K (S+K) | Maximum Output: Blue | 4-hit pull orb, 1 bar |
| 214S+K (2S+K) | Reversal Red: Maximum | fast projectile, wall bounce, 1 bar |
| L+K | Infinity Toss | throw |
| 236H+S | **Hollow Purple** | 6-hit **beam** (clash-capable), 3 bars; awakened: 200%, 2 bars |
| awakened + 300 Ki, 236H+S | **Infinite Void** | Soul Realm |

Awakening **Six Eyes** (blindfold off, `form = 'six_eyes'`): Ki gain is doubled (awakened default is x1.5), and it reads **one** enemy teleport (Vanish / Blink / Smoke Swap behind him). There is no turn-lock, and the next strike within 45 f is auto-guarded. Events: `infinityBlock` tag `sixEyesRead`, then tag `sixEyes`.

BnBs (damage vs Kaito): `L, L, H xx 623S` 203 · `236S, 3H, H xx 623S` 291 · `3H, L, H, H,H` 258 · `3H, H, 236H+S` 212 (3 bars) · wall `3H, H xx 623S, 66 H, H,H` 365.

### NARUTO (`naruto`): rushdown / pressure, element `wind`
HP 920. **Shadow Clones** (`state.summons`):
- 214S **Shadow Clone Jutsu** spawns up to 2 clones at flanking spots (±70° around the opponent, screen-mirrored, 0.75-1.4 m away). They appear in 12 f and last 8 s.
- When Naruto starts a ground normal or melee special, each idle clone queues a copy. After 4 / 8 f it flash-steps to its flank spot and plays the same move from there at **40% damage**. Hits are tagged `clone`. Flank angles mean the opponent must block a second direction. After its copy the clone vanishes.
- Any enemy active hitbox or projectile touching a clone dispels it (`summonDispel` tag `hit`). Clones also vanish when Naruto is thrown or knocked down.

| Input | Move | Notes |
|---|---|---|
| L, L, K · H, H | Leaf Jab string · Straight Punch / Uppercut Finish | |
| K · 2L · 2K · 3H · 6H · 4K | Whirlwind Kick · Low Kick · Leaf Sweep · Uzumaki Uppercut · Shunshin Elbow · Heel Drop | 3H launcher, 6H tracks |
| 236S (6S) | **Rasengan** | dash orb, launches |
| 623S (2S) | Uzumaki Barrage | 7 f invulnerable reversal |
| 214S (4S) | **Shadow Clone Jutsu** | 2 clones |
| 41236S (8S) | **Clone Rush** | needs ≥1 clone; the clones are used up; long-range unbreakable command grab |
| 236S+K (S+K) | **Rasen-Shuriken** | 4-hit Ki projectile |
| 41236S+K (2S+K) | Sage Art: Giant Rasengan | awakened only |
| L+K | Clone Toss | |
| 236H+S | **Rasengan Barrage** | cinematic with clones; awakened: Sage Art version |
| awakened + 300 Ki | **Tailed Beast Bomb** | Soul Realm |

Awakening **Sage Mode** (`form = 'sage'`, +5% speed). While awakened and below 20% HP he enters **Nine-Tails Chakra Mode** (`form = 'kurama'`: golden, +25% walk/dash speed). In that mode **Kurama Rasengan** (armored, bigger), **Chakra Arm Sweep** (623S, huge reach) and **Tailed Beast Rasen-Shuriken** replace the base moves.

BnBs: `L, L, K xx 236S` 196 · `236S, L, H, H,H xx 236S` 334 · `3H, H, H,H xx 236S` 302 · `3H, H, 236H+S` 416 · wall `3H, H, H,H, 66 K, H` 352.

### ZORO (`zoro`): sword footsies, element `blade`
HP 940. **Three-Sword Style**: tap **S with no direction (5S)** to cycle `santoryu` → `ittoryu` → `nitoryu` (`fighter.form`, event `formChange`). This tells the renderer how many swords to show. Only the H strings change:
- Santoryu: `H` Tora Gari, `H,H` Ushi Bari (long, heavy, knockdown).
- Ittoryu: `H` Shishi Sonson (slow iai lunge, knockdown, **launch on counter hit**).
- Nitoryu: `H, H, H` Taka Nami / Nigiri / Rashomon (fast 3-hit).

| Input | Move | Notes |
|---|---|---|
| L, L, H · K · 2L · 2K · 3H · 6H · 4K | Hilt Strike string · Front Kick · Ankle Cut · Sweeping Blade · Rising Dragon · Sai Kuru Thrust · Spinning Slash | |
| 236S (6S) | **Oni Giri** | dash **through** the opponent (`passThrough`: no body collision), ends behind |
| 623S (2S) | **Tatsumaki** | tornado reversal, launches on CH |
| 214S (4S) | **Pound Cannon** | flying slash projectile |
| 41236S (8S) | **Lion's Song** | iai counter (frames 3-18, high/mid) → Shishi Sonson pass-through cut |
| 236S+K | Sanzen Sekai | invulnerable pass-through, 1 bar |
| 41236S+K | Rengoku Onigiri | awakened only, 3-hit launcher |
| 236H+S | **Asura: Ichibugin** | awakened: Asura: Makyusen |
| awakened + 300 Ki | **King of Hell** | Soul Realm |

Awakening **Asura** (Zoro keeps his style form; use `awakened` for the 9-sword afterimage look): **every slash hits twice**. 6 f after a strike connects (hit or block), an echo slash with 50% damage lands if the opponent is still within 2.2 m (`hit` / `block` tag `echo`).

BnBs: `L, L, H xx 236S` 205 · `3H, H, H,H xx 236S` 316 · `3H, L, H, H,H` 268 · `3H, H, 236H+S` 426 · wall `3H, H, H,H, 66 H, H,H` 386.

### LUFFY (`luffy`): long-reach brawler, element `rubber`
HP 1000. **Rubber body**: the longest normals in the game (jab reaches ~1 m, H ~1.3 m), with 1-2 f slower startup than the originals.

| Input | Move | Notes |
|---|---|---|
| L, L, K · H, H · K · 2L · 2K · 3H · 6H · 4K | Gum-Gum Jab string · Punch / Bazooka · Lash · Snap · Sickle · Uppercut · Spear · Axe | |
| 214S (4S) | **Gum-Gum Pistol** | very long punch (~1.7 m) |
| 236S (6S) | **Gum-Gum Gatling** | 5 hits |
| 41236S (8S) | **Gum-Gum Rocket** | stretch dash, wall bounce |
| 623S (2S) | **Gum-Gum Bell** | armored headbutt, stagger (combo starter) |
| 236S+K | Red Hawk | invulnerable dash punch, element fire |
| 41236S+K | Elephant Gun | awakened only, armored launcher |
| 236H+S | **King Kong Gun** | awakened: Bajrang Gun |
| awakened + 300 Ki | **Gear Fifth** | Soul Realm |

Awakening **Gear Second** (`form = 'gear2'`, steam, +15% speed, Jet Pistol replaces Pistol). While awakened and below 20% HP: **Gear Fourth** (`form = 'gear4'`, +20% speed, optional `form_gear4.glb`). Kong Gun (214S) and Leo Bazooka (236S) replace Pistol / Gatling, both armored with wall bounce.

BnBs: `L, L, K xx 41236S` 208 · `3H, H, H,H xx 41236S` 319 · `3H, L, H, H,H` 258 · `3H, H, 236H+S` 418 · wall `3H, H xx 41236S, 66 H, H,H` 372.

### EREN (`eren`): mobility + transformation, element `lightning`
HP 970. Human moveset (`needForm: ''`):

| Input | Move | Notes |
|---|---|---|
| L, L, H · H, H · K · 2L · 2K · 3H · 6H · 4K | ODM blade strings · Survey Corps Kick · Low Cut · Spin Sweep · Rising Blade · ODM Lunge · Back Spin Slash | j.K / j.H air blade strikes |
| 236S (6S) | **Grapple Dash** | 85 mm/f ODM dash slash |
| 623S (2S) | **Spinning Slash** | 8 f invulnerable reversal |
| 41236S (8S) | **Thunder Spear** | flies harmless, **detonates** with 12 f of life left (r 480 blast, event `projectile` tag `detonate`) |
| 214S (4S) | **Hardened Fist** | counter (frames 4-18, high/mid) → Crystal Punch (wall bounce) |
| 236S+K | Thunder Spear Volley | 2 spears, 1 bar |
| 236H+S | ODM Nape Barrage | ultimate |
| awakened + 300 Ki | **The Paths** | Soul Realm |

Awakening **Titan Shift** (lightning strike): `form = 'titan'` for **600 frames** (`sim.formTimer`), then back to `''`. While in Titan form:
- hurtbox height and body radius are ×2.5;
- he takes 75% damage and cannot be grabbed by normal throws;
- walk / dash speed is 75%.
- All moves are swapped for the Titan set: L, L Titan Backhand / Hook · H Titan Hammer Fist · K Titan Stomp (low, ground hit) · 3H Titan Uppercut · 236S Titan Charge · 623S Hardening Punch · 214S Titan Roar. Most are armored.
- The awakened ultimate is **Hardened Titan Smash** (Titan only; after the Titan ends you get the human ultimate).

BnBs: `L, L, H xx 236S` 194 · `3H, H, H,H xx 236S` 299 · `3H, L, H, H,H` 256 · `3H, H, 236H+S` 418 · wall `3H, H, H,H, 66 H, H,H` 366.

---------------------------------------------------------------------------------------------------------------

## 3. New contract fields and events (all additive, `src/sim/types.ts`)

**For render / vfx / audio / HUD:**

| Where | Field | Meaning |
|---|---|---|
| `CharId` | `'gojo' \| 'naruto' \| 'zoro' \| 'luffy' \| 'eren'` | new ids. `CROSSOVER_CHARS` lists them. Any `Record<CharId, …>` table needs 5 more keys. |
| `Element` | `'void' \| 'wind' \| 'lightning' \| 'rubber'` | new move / event elements (Luffy's Red Hawk uses `fire`) |
| `FighterState.form` | string | `''` base · `six_eyes` · `sage` / `kurama` · `santoryu` / `ittoryu` / `nitoryu` · `gear2` / `gear4` / `gear5` · `titan`. Swap models / looks on it (`form_titan.glb`, `form_gear4.glb`). The camera should pull back for `titan`. |
| `FighterState.infinity` | 0/1 | Gojo's Infinity charge this round (shimmer while 1) |
| `GameState.realm` | `RealmState \| null` | active realm: `phase` `'cine'` (90 f, stage dissolve / letterbox) → `'active'` (stage swapped to the realm world) |
| `GameState.summons` | `SummonState[]` | Naruto's clones: `pos`, `facing`, `mode` (`appear` / `idle` / `attack`), `pose` (sim-driven `PoseName`), `moveId` / `moveFrame` while copying, `slot`. Draw them as Naruto (semi-transparent / smoke on appear). |
| `ProjectileState.slow` | 100 / 30 | 30 = inside Gojo's Infinity (ripple / slow-motion shader) |
| `ProjectileState.fuse / blastR` | numbers | Thunder Spear: harmless while `life > fuse`, then a blast of radius `blastR` |
| `ClashState.kind` | `'beam' \| 'realm'` | Realm Clash uses the clash HUD with the two realm worlds grinding |
| `camera.cinematic.kind` | `'realm'` | realm cinematic (frame 0-89) |

**New `SimEvent.type`s:**

| Event | When | Useful fields |
|---|---|---|
| `realmStart` | realm cinematic opens (and again when a Realm Clash winner's realm opens) | `player`, `tag` = realm kind, `moveId`, `element` |
| `realmEnd` | realm over | `tag` `time` / `cap` |
| `realmClash` | both players opened a realm in the window | (`clashStart` / `clashEnd` with tag `realm` follow) |
| `infinityBlock` | Gojo auto-guard | `tag` `infinity` (first hit each round), `sixEyes` (teleport read), `sixEyesRead` (teleport read, guard armed) |
| `formChange` | form switches | `tag` = new form (`base` for `''`) |
| `summon` / `summonDispel` | clone appears / poofs | `pos`, `tag` `clone` / `hit` / `done` / `expire` / `owner` / `rush` |

Existing events get new tags: `hit` / `block` tag `clone` (clone copy), `echo` (Asura), `realm` (realm blast / stomp). `parry` tag `counter` (counter stances). `groundBounce` tag `gear5`. `projectile` tag `detonate`.

**Sim data fields** (`MoveDef`, optional): `realm`, `counter`, `needForm`, `passThrough`, `summon`, `needClones`, `cycleForms`. `ProjectileDef`: `fuse`, `blastR`. `CharDef`: `realmId`, `element`.
Specials may now carry a `kiCost` (Blink, 50).

**VFX hints** (`MoveDef.fx`): `blue_orb`, `red_blast`, `void_blink`, `six_eyes_glint`, `hollow_purple`, `infinite_void`, `rasengan`, `rasengan_kurama`, `rasenshuriken`, `clone_smoke`, `clone_rush`, `clone_barrage`, `tailed_beast_bomb(_blast)`, `oni_giri`, `tatsumaki`, `pound_cannon`, `lions_song`, `sanzen_sekai`, `asura`, `king_of_hell`, `gum_pistol`, `gum_gatling`, `gum_rocket`, `gum_bell`, `kong_gun`, `king_kong_gun`, `gear_fifth`, `odm_grapple`, `thunder_spear`, `hardening`, `titan_*`, `paths`, `titan_army_stomp`.
**Poses:** only existing `POSES` are used. Nice-to-have new poses for later: `handSign` (realms / clone jutsu), `iaiStance` (Lion's Song), `titanRoar`.

## 4. CPU personalities (`src/ai/profiles.ts` + controller)
- **Gojo**: keeps zoning distance (spacing 1.6), throws Blue and turns a Blue hit into a combo (generic "opponent in long hitstun → best lookahead combo" rule). Blinks behind, uses Six Eyes Counter against readable highs and mids, and opens Infinite Void as soon as it is available.
- **Naruto**: clones up from range, then rushes in so the clones copy his pressure. Uses Clone Rush while clones are out.
- **Zoro**: footsies with style swaps and Lion's Song counters.
- **Luffy**: long pokes, Rocket / Pistol.
- **Eren**: Grapple Dash in, Thunder Spears, Titan Shift on awakening (automatic).
- All realms: the CPU opens its realm when awakened with 300 Ki (sure-hit, invulnerable startup).

## 5. Balance (hard vs hard, 100 matches per cell, sides alternate)
Target: each crossover fighter's **average** against the original four is 40-60%. `tests/balance.ts` checks this.

| Fighter | vs kaito | vs shiori | vs ren | vs goro | **avg** |
|---|---|---|---|---|---|
| gojo | 61% | 44% | 36% | 70% | **53%** |
| naruto | 44% | 64% | 48% | 65% | **55%** |
| zoro | 57% | 51% | 49% | 76% | **58%** |
| luffy | 56% | 52% | 43% | 63% | **53%** |
| eren | 25% | 36% | 85% | 67% | **53%** |

Known outliers (next tuning pass): Eren's matchups are polarized (Kaito's Blaze Knuckle punishes his dashes; his Grapple Dash shuts down Ren's range). Gojo vs Ren and Luffy vs Ren rounds run long (~53 s, some timeouts). Gojo mirror matches at nightmare often time out (both zone).
