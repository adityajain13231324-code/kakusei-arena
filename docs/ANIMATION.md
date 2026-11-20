# Animation v2: clip drop-in spec

Animation v2 (Polish Pass P8, row 1) has two layers. Both are render-side only. They read `FighterState` and never change it, so the sim, AI, netcode and frame data are unaffected.

1. **Procedural clips** (`src/render/anim/clips.ts`, `animator.ts`). These always run. They are built in code from the pose library (`poses.ts`) and played through FighterView's IK, so they work on every rig: the originals, the crossover mannequin and future drop-ins.
2. **Authored clips** (`src/render/anim/extclips.ts`). These are optional. They are loaded from `public/characters/<id>/anims.glb`, or from animations embedded in `model.glb`, and matched by **clip name**. When a clip with the requested name exists, it plays on top of the procedural clip and crossfades in over 2 to 4 frames. When it doesn't exist, the procedural clip of the same state shows. A missing file is not an error.

So clips can be added one at a time. Each one replaces its procedural fallback as soon as it is in the file.

## Files

| Path | What |
|---|---|
| `public/characters/<id>/anims.glb` | Clip library for one fighter (any number of clips, one per action). Optional. |
| `public/characters/<id>/model.glb` | Animations embedded in the model are used too (same names). |
| `public/characters/<id>/manifest.json` | `"anims": false` skips probing for `anims.glb`. |

Crossover fighters without their own model use the shared mannequin rig. A clip made on that rig goes in their own folder, `characters/<id>/anims.glb`.

## Rig and export rules

- **Bone names:** Mixamo style. A `mixamorig:` / `mixamorig` prefix is fine, because it is stripped. Required for full-body clips: `Hips, Spine, Spine1, Spine2, Neck, Head, LeftShoulder, LeftArm, LeftForeArm, LeftHand, RightShoulder, RightArm, RightForeArm, RightHand, LeftUpLeg, LeftLeg, LeftFoot, LeftToeBase, RightUpLeg, RightLeg, RightFoot, RightToeBase`. Finger bones (`LeftHandIndex1..3` and so on) are optional.
- **Units / axes:** metres, Y-up, +Z forward (glTF default). The character faces +Z.
- **Rest pose:** the clip's rig should rest in the same A-pose as the model. Clips are retargeted per bone with rest-pose world deltas, so different bone rolls or an armature rotation (Blender / Mixamo FBX) cancel out. A *different rest pose* (T-pose clips on an A-pose model) shows up as a constant offset. Re-target to the A-pose first, for example by uploading the game model to Mixamo and downloading the animations "with skin", or by baking in Blender.
- **Root motion: OFF.** The sim owns position. Only the vertical part of the `Hips` translation is used (crouch, hop in place). Forward / sideways root translation is thrown away, so export clips **in place**.
- **Frame rate:** any. Clips are sampled continuously by time, and 30 or 60 fps keys are both fine. The sim runs at 60 Hz.
- **Spring bones:** bones whose names contain `hair, pony, scarf, tail, cape, ribbon, tassel, sash, skirt, coat, cloth, robe, hood, braid, mane, flap, sleeve` are driven by the spring simulation. Tracks on them are overridden.
- **Clip names:** the action name in Blender, or the clip name in the GLB. A `Armature|` style prefix is stripped. Matching is exact, with a lower-case fallback. Mixamo's default `mixamo.com` name must be renamed.
- **Format:** glTF binary (`.glb`). The mesh can be left out, since only the armature + actions are needed.

## Clip names

### States

| Name | Plays during | Time mapping |
|---|---|---|
| `idle` | standing | loops (state time) |
| `walk_fwd`, `walk_back` | walking | **one full cycle** per clip, synced to distance travelled: one cycle = the fighter's stride (≈ 1.0 m) |
| `walk_side` | side-walking | one cycle, synced to lateral distance (≈ 0.56 m per cycle) |
| `run` | forward dash (16 f) | one cycle, synced to distance (≈ 1.6 m per cycle) |
| `backdash` | back dash (20 f) | plays once |
| `sidestep` | sidestep (18 f) | plays once |
| `jump` | jump | plays once |
| `land` | landing lag | plays once |
| `crouch` | crouching | loops |
| `guard_high`, `guard_low` | holding guard | loops |
| `block_high`, `block_low` | block stun (flinch) | plays once |
| `hit_high`, `hit_mid`, `hit_low` | hit stun | plays once |
| `hit_heavy` | hit stun from heavy / super hits (falls back to `hit_high/mid/low`) | plays once |
| `stagger` | stagger / crumple | plays once |
| `juggle` | airborne after a launch | plays once |
| `knockdown` | lying after a knockdown (40 f) | plays once |
| `getup` | wake-up (22 f) | plays once |
| `wallsplat` | wall splat (45 f) | plays once |
| `thrown` | being thrown | plays once |
| `ki_charge` | holding Ki charge | loops |
| `vanish` | vanish (16 f) | plays once |
| `awaken` | awakening (50 f) | plays once |
| `intro` | round intro (90 f) | plays once |
| `win`, `lose` | after the round | plays once, then holds the last frame |
| `clash` | beam clash | loops |

"Plays once" clips play at their own speed from the start of the state. A clip shorter than the state holds its last frame. A longer one is cut off when the state ends.

### Moves

Every move plays the clip named by its **move id** (for example `kaito_jab`, `shiori_kick`; the ids are in `src/data/chars/<id>.ts`), unless the move names another clip with `clip`.

## Syncing a move clip to its hitbox (`clip` + `clipTiming`)

`MoveDef` has two optional, render-only fields (`src/sim/types.ts`). The sim never reads them, so adding them changes no frame data:

```ts
mv({ id: 'kaito_straight', /* ...frame data unchanged... */,
  extra: {
    clip: 'kaito_straight_v2',                              // optional: default = the move id
    clipTiming: { startup: 0.30, activeEnd: 0.40, end: 0.95 }, // CLIP seconds
  } }),
```

The clip is **time-warped** piecewise-linearly:

| Move frame | Clip time |
|---|---|
| 0 (move starts) | 0 |
| `startup` (first active frame, hitbox appears) | `clipTiming.startup` (the strike pose) |
| `startup + active` (last active frame) | `clipTiming.activeEnd` (default: proportional) |
| `startup + active + recovery` (move ends) | `clipTiming.end` (default: clip length) |

Without `clipTiming`, the clip is stretched evenly over the whole move (`startup + active + recovery`). So when you author a clip, put the strike at `startup / total` of its length, or give `clipTiming`.

How to read the times off a clip: in Blender, the frame of the strike divided by the scene fps. In Mixamo / Cascadeur, the time on the timeline where the fist or foot is fully extended.

The strike-assist that pulls the striking hand / foot onto the hitbox still runs, at half weight while an authored clip plays. Smear frames (limb stretch on heavy / special / Ki / ultimate strikes) are applied on top.

## What the procedural layer does today

- **Moves:** compiled from each move's `anim` keyframes, with timing curves instead of linear blends. The wind-up coils past the wind pose (anticipation, slow-in). The strike accelerates in and lands on the first active frame. It overshoots past the extension (follow-through) and holds for the active frames. Recovery is eased and settles into the stance with a small overshoot. Spinning moves keep their spin.
- **Idle stances per fighter:** breathing and weight shift for everyone, plus Kaito's boxer bounce, Shiori's low ninja crouch with a head scan, Ren's still iaido ready with slow breath, and Goro's wide sumo stance with a heavy side-to-side shift. Crossover fighters each get a variant: Gojo relaxed with hands low, Naruto low and bouncy, Zoro wide, Luffy loose and bouncy, Eren tense.
- **Locomotion:** walk, side-walk and dash cycles. Foot plants are driven by the distance actually travelled (feet don't slide at sim speed), with lean, hip bob and arm pump. Back dash, sidestep, jump (up / apex tuck / fall by vertical speed) and landing squash are also covered.
- **Reactions:** hit reactions scale with the strength of the hit and its height. High hits get a head snap, mid hits a body fold and low hits a knee buckle; heavy hits also twist the body round and back. There is also a block flinch, a stagger sway, a juggle tumble with trailing limbs, and a knockdown bounce, lying, then getting up. Agile fighters spring up; Goro pushes up.
- **Show:** intros per fighter (90 f): Kaito punches his palm and raises his fist, Shiori rises from a crouch into a hand seal, Ren does a half quick-draw and re-sheathes, and Goro does two shiko stomps. Crossover fighters (P8 Feel) each have their own: Gojo glances sideways, raises two fingers by his eyes and beckons; Naruto drops in low, holds a hand seal and points a fist; Zoro unfolds his arms, sinks to a hip draw and sweeps wide; Luffy windmills an arm, punches his palm and puts a hand on his head; Eren coils with a trembling fist, grips at both hips and snaps into a crossed guard. There are win clips per fighter (Ren flicks and sheathes his blade, Gojo raises a hand with a hip shift, Naruto puts his hands behind his head, Zoro folds his arms and turns away, Luffy bounces with both arms up, Eren raises a fist to the sky), and a lose clip (drops to a knee, heavy breathing). At round end / match end the camera frames the winner with a slow front-side orbit (render only).
- **Hitstop feel (render only, sim frame counts unchanged):** the defender shakes along the hit direction with an amplitude by strength that decays over the freeze, the attacker's strike pose is held exactly, a 2-frame contact pop (body flash + striking-limb smear), then a 4-frame ease from the held position back onto the sim position.
- **Crossfades:** 2 to 4 frames between clips. A hit or block that lands again restarts the reaction.
- **Secondary motion:** hair, scarf and cloth spring chains in sub-steps of at most 1/120 s, so they behave the same at 30 to 144 fps.

## Testing a clip without rebuilding

1. Drop `anims.glb` into `public/characters/<id>/` and reload. The dev server serves it directly.
2. Training, then F1 (overlay) or F2 (hitboxes), then **F3** switches Animation v2 against the old v1 pose blender. The F1 overlay shows the clip each fighter is playing, plus `+clip NN%` while an authored clip is blended in.
3. From the console: `__app.renderer.registerClips('<id>', clips, rigRoot?)` adds `THREE.AnimationClip`s to the live fighters. `rigRoot` defaults to the fighter's own model.

## Performance

The clip layer samples a 56-channel pose per fighter, using fixed buffers and no allocations per frame. Authored clips evaluate one interpolant per animated bone. Measured in the browser pane, two fighters plus crowd: `renderer.update` took about 0.30 ms with v2, against 0.29 ms with v1. Draw calls are unchanged (31 in the Training rooftop scene).
