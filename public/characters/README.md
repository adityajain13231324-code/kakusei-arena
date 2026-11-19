# KAKUSEI ARENA character assets, v2

Original designs built with the existing Blender v2 pipeline: SDF heads, smoothly lofted limbs, finger bones, layered hair and clothing, uniquely packed UVs, painted cel colors and four expression panels. Source: `tools/assets/build_assets_v2.py`, `v2_geom.py`, `v2_face.py`, `v2_chars.py`, and `v2_ch2.py`. Chapter 2 exports use Blender 5.2.2 LTS, NumPy, Pillow and SciPy.

## Inventory

| ID | Base triangles | Awakened triangles | Notes |
| --- | ---: | ---: | --- |
| kaito | 23,338 | 23,338 | Existing v2 fire fighter |
| shiori | 24,634 | 24,634 | Existing v2 shadow fighter |
| ren | 24,760 | 24,760 | Existing v2 swordsman, separate Katana mesh |
| goro | 20,862 | 21,334 | Existing v2 grappler, optional shoulder plates |
| mika | 21,200 | 21,200 | Cobalt/yellow track jacket, neck headphones, short blue twin tails |
| lyra | 22,400 | 22,400 | Ash-grey/teal ceremonial layers, paper charms and bell cords |
| kitsu | 17,064 | 19,144 | Spectral fox with a quadruped rig and eight optional spirit tails |

Every character folder contains:

- `model.glb`: rigged mesh with embedded 2048 atlas.
- `model_1024.glb`: identical mesh, UVs and weights with an embedded 1024 atlas.
- `tex.png`, `tex_awakened.png`: 2048 normal/awakened color atlases.
- `tex_1024.png`, `tex_awakened_1024.png`: mobile color atlases.
- `tex_glow.png`: 512 emission mask, enabled on awakening.
- `manifest.json`: exact triangles, bone names, mesh names and expression offsets.

New Chapter 2 folders also contain `validation.json` and `browser-check.json`. All new base models are within 15,000 to 25,000 triangles and use one material. Optional outlines add a second material and roughly double rendered triangle counts. They do not count as additional exported character geometry.

Special files: `goro/shoulder_plates.glb`; `kitsu/awakened_tails.glb`; and `lyra/kitsu.glb`, an identical convenience copy of `kitsu/model.glb`. Kitsu's external atlases remain in `kitsu/`. Its normal GLB includes one tail; the optional mesh supplies the other eight. All nine tails use the three shared tail bones.

## Coordinates and rig

Metres, Y-up, +Z forward, feet/paws at Y=0. Humanoids use an A-pose. No animations are embedded.

Core humanoid bones:

```text
Hips, Spine, Spine1, Spine2, Neck, Head
LeftShoulder, LeftArm, LeftForeArm, LeftHand
RightShoulder, RightArm, RightForeArm, RightHand
LeftUpLeg, LeftLeg, LeftFoot, LeftToeBase
RightUpLeg, RightLeg, RightFoot, RightToeBase
Hair_01, Scarf_01, Scarf_02, Ponytail_01, Ponytail_02
```

Each hand also has `LeftHand` or `RightHand` + `Thumb/Index/Middle/Ring/Pinky` + `1/2/3`, for 30 finger bones. Positive local X curls the fingers. The standard rig has 57 bones; Mika adds LeftTail_01/02 and RightTail_01/02 (61 total). Lyra adds Charm_01, SkirtFront_01 and SkirtBack_01 (60 total). Exact parentage and complete names are in each manifest. Mika's tail chains carry the twin-tail weights. Lyra's skirt panels blend Hips and the corresponding thigh for kick clearance; her extra skirt bones are available for later secondary-motion authoring.

Kitsu has Hips, Spine, Spine1, Neck, Head, Tail_01/02/03, and FrontLeft/FrontRight/HindLeft/HindRight + UpLeg/Leg/Foot, 20 bones total. It is a quadruped and must not be retargeted with humanoid clips.

## Atlas and expressions

V2 uses a unique packed unwrap, not the old 8x8 palette grid. The top 512 pixels of each 2048 atlas contain four 512-square face panels: neutral, shout, pain, determined. The matching mobile panels are 256 square.

`Face_Expressions` is a separate skinned mesh. Add the following U offset to its original UVs only: neutral 0, shout 0.25, pain 0.5, determined 0.75. V stays unchanged. Both normal and awakened atlases use exactly the same layout. These are painted expression swaps, not morph targets. Keep a copy of the original UVs to avoid accumulating offsets.

Color textures: `SRGBColorSpace`, `flipY=false`. Emission mask: `NoColorSpace`, `flipY=false`. The embedded GLB texture loads without external configuration. `toon-materials.js` is an optional asset-viewer helper for stepped lighting, skinned outlines, awakening and extra mesh attachment. Bloom is a renderer feature; an atlas alone cannot create a light halo.

## Previews and checks

Actual three.js renders live in `previews/<id>_three_<view>.png`: front, side, back, three, awakened, punch, kick, crouch, face_neutral, face_shout, face_pain, face_determined and face_awakened. For Kitsu, the pose checks bend quadruped legs and tail bones. Earlier Blender/v1 images are retained for historical reference; use the `_three_` images for the current models.

Chapter 2 validation checks Khronos glTF errors/warnings, triangle and bone budgets, normalized weights, atlas dimensions, matching 2048/1024 geometry/UVs/weights, and expression UV bounds. Browser checks load the exported GLBs and capture all listed states. These are software/browser checks, not owner-device performance measurements. Actual combat clips, Mixamo retargeting, cloth physics and arbitrary extreme poses still need integration testing. New fighters are asset deliveries only; no `src/` files are changed or new gameplay slots wired.

## Build

Using Blender with NumPy, Pillow and SciPy on its Python path:

```sh
blender --background --factory-startup --python tools/assets/build_assets_v2.py -- mika lyra --no-render
blender --background --factory-startup --python tools/assets/build_kitsu.py
```

Omit `--no-render` to also produce Blender turnarounds. The v2 script also runs with Python's `bpy` package. `build_assets.py` is retained as the historical v1 builder; do not use it to regenerate v2 fighters.

Install verification dependencies in a scratch folder, not the game package: `gltf-validator` and `playwright`. Expose that folder's `node_modules` through `NODE_PATH`. Then:

```sh
node tools/assets/validate_ch2.cjs mika lyra kitsu
node tools/assets/check_ch2.cjs mika lyra kitsu
```

The browser checker serves the repo on localhost:5198 and reads three.js from the repository's existing `node_modules`. Set `CHROME_PATH` if Chrome is not at the default Windows installation path. The manual viewer is `tools/assets/preview.html`; the checker maps its local asset and three.js routes.
