# KAKUSEI ARENA fighter asset pack

Four original low-poly anime fighters, authored with scripted mesh construction in **Blender 5.2.2 LTS**, exported with Blender's glTF 2.0 exporter. No downloaded character meshes, reference-character tracing, or third-party artwork. The editable construction source is `tools/assets/build_assets.py`.

## Files and budgets

All geometry is in metres, Y-up, facing +Z, feet at Y=0, in an A-pose. Each GLB embeds its texture, so it loads independently. The separate PNGs support runtime palette and expression changes. The 1024 models use the same geometry and UVs with a smaller embedded atlas.

| Folder | Fighter | Base triangles, including carried weapon | Awakened triangles | Skinned meshes | Materials |
| --- | --- | ---: | ---: | ---: | ---: |
| `kaito/` | Kaito Homura | 5,969 | 5,969 | 2 | 1 |
| `shiori/` | Shiori Kageyama | 5,551 | 5,551 | 2 | 1 |
| `ren/` | Ren Tsukishiro | 5,903 | 5,903 | 3 | 1 |
| `goro/` | Goro Ishigami | 7,211 | 7,323 | 2, plus optional plates | 1 |

Each of the four folders contains these files:

| File | Contents |
| --- | --- |
| `model.glb` | Rigged fighter, embedded 2048 x 2048 normal atlas |
| `model_1024.glb` | Same rig and geometry, embedded 1024 x 1024 normal atlas |
| `tex.png` | 2048 x 2048 normal atlas |
| `tex_awakened.png` | 2048 x 2048 awakened atlas, identical UV layout |
| `tex_1024.png` | 1024 x 1024 normal atlas |
| `tex_awakened_1024.png` | 1024 x 1024 awakened atlas |
| `manifest.json` | Geometry counts, height, materials, mesh count, and complete bone list |

`goro/shoulder_plates.glb` contains the optional awakened shoulder plates: **112 triangles**, one atlas material, and the same rig. Attach its skinned plate mesh to the base fighter's bones. Do not display its duplicate skeleton as a second character. Goro is authored at 1.2 times the base scale, with a wider torso and limbs.

Additional files:

- `toon-materials.js`: optional three.js toon, emissive, outline, and Goro plate attachment helper.
- `validation.json`: Khronos glTF validator results and accessor-level skin/texture/budget checks.
- `deformation-check.json`: Blender reimport, foot-height, and finite posed-vertex checks.
- `browser-check.json`: three.js load/render checks, including awakened states and attached plates.
- `previews/<fighter>_front.png`, `_side.png`, `_back.png`: actual Blender orthographic renders.
- `previews/<fighter>_awakened_front.png`, `_awakened_side.png`, `_awakened_back.png`: the same geometry with the alternate atlas and optional Goro plates. These neutral Blender renders do not show the runtime glow or outline shader.
- `previews/<fighter>_deformation.png`: reimported GLB stress pose.
- `previews/<fighter>_three_normal.png`, `_three_awakened.png`, `_three_pose.png`: actual three.js screenshots, including the outline shader.

## Skeleton and skinning

Every character uses these exact Mixamo-style names, without a `mixamorig:` prefix:

```text
Hips
  Spine
    Spine1
      Spine2
        Neck
          Head
            Hair_01
            Ponytail_01
              Ponytail_02
        LeftShoulder
          LeftArm
            LeftForeArm
              LeftHand
        RightShoulder
          RightArm
            RightForeArm
              RightHand
        Scarf_01
          Scarf_02
  LeftUpLeg
    LeftLeg
      LeftFoot
        LeftToeBase
  RightUpLeg
    RightLeg
      RightFoot
        RightToeBase
```

All 27 bones are present in each file for consistent mapping. Hair, scarf and ponytail bones are only weighted where those accessories exist. Limbs have additional rings around elbows and knees, with normalized blended weights on either side of each joint. Hands have individually modeled fingers, weighted to the hand bone. There are no finger bones or facial morph targets.

The asset includes a separate `Face_Expressions` skinned mesh. It shares the atlas with `Fighter`. Ren also has a separate `Katana` skinned mesh, including the blade, handle and guard, initially weighted to Hips inside its separate sheath geometry. For drawing the weapon, detach/rebind the Katana to the hand or animate its vertices through an attachment transform; simply parenting a still-skinned sword under a hand does not replace its Hips weights.

This is a segmented low-poly construction with overlapping clothing and body parts, not a single watertight sculpt. The included stress poses check basic limb deformation. Full Mixamo retargeting, extreme combat poses, cloth collision and final game-device performance have not been validated. Rest-pose calibration remains necessary when retargeting. No idle, walk or other animation clips are embedded.

## Atlas and expressions

The atlas is an 8 x 8 palette grid. Each surface samples the center of one swatch, allowing clean flat colors and reliable 1024 resizing. UVs are shared across both variants. This is a palette atlas, not a unique texel-density unwrap for detailed hand painting.

Blender cell index is `row * 8 + column`, with row zero at the image's bottom. In the PNG, that row is at the bottom; exported glTF flips V. The shader helper accounts for this.

| Cell | Use |
| ---: | --- |
| 0 | Skin |
| 1 | Light clothing / robe |
| 2 | Dark clothing / mask / gloves |
| 3 | Hair / dark accessory |
| 4 | Accent |
| 5 | Silver / stone highlight |
| 6 | Sole / stone shadow |
| 7 | Eye white / Ren closed-eye skin |
| 8 | Iris |
| 9 | Pupil |
| 10 | Eye glint |
| 11 | Lash |
| 12 | Mouth |
| 13 | Goro shoulder stone |
| 14 | Reserved outline color |
| 15 | Ren closed eyelid / awakened eye highlight |

Changing swatches changes eye and mouth colors. Swapping the `Face_Expressions` geometry supports different expression shapes. Ren's supplied closed/open effect uses the same eye geometry and changes its colors through the alternate atlas; it is not an eyelid morph.

## three.js integration

Standard glTF materials preserve the baked colors. Use the optional helper for stepped cel lighting, silhouettes and emissive accents. A texture alone cannot create a camera-dependent white outline or a light halo.

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { configureFighter } from '/characters/toon-materials.js';

const loader = new GLTFLoader();
const { scene: fighter } = await loader.loadAsync('/characters/kaito/model.glb');
scene.add(fighter);
const appearance = await configureFighter(fighter, 'kaito');
appearance.setAwakened(true);

// For Goro, after configuring the base Goro fighter:
// const plates = await loader.loadAsync('/characters/goro/shoulder_plates.glb');
// appearance.attachShoulderPlates(plates.scene);
```

Pass `{ resolution: 1024 }` when loading `model_1024.glb`. External color textures require `SRGBColorSpace` and `flipY = false`, handled by the helper. Kaito receives warm emissive hair/accent colors; Ren receives pale-blue emissive eyes. Add bloom in the game renderer if a halo is desired. Shiori receives an ink-black palette and a white inverted-hull outline. Goro's plates toggle with awakening.

The optional helper uses one toon material and one outline material. Outlines reuse the existing geometry and skeleton, adding a render pass rather than a second exported character. Even with outlines, each fighter remains below 25,000 rendered triangles. The helper expects a unique character instance; clone rigs with `SkeletonUtils.clone` before configuring multiple fighters.

## Props

Props live in `public/props/`, with flat colors, metre scale, and no skeletons or animations. Each has one embedded 128 x 128 palette material.

| File | Triangles |
| --- | ---: |
| `water_tank.glb` | 472 |
| `ac_unit.glb` | 200 |
| `neon_sign_frame.glb` | 84 |
| `stone_lantern.glb` | 280 |
| `red_shrine_gate.glb` | 268 |
| `cherry_tree.glb` | 1,178 |

The neon panel is blank and brand-free. The tree has modeled blossom clusters and no alpha cards.

## Rebuild and inspect

```sh
blender --background --factory-startup --python tools/assets/build_assets.py
blender --background --factory-startup --python tools/assets/build_assets.py -- props
blender --background --factory-startup --python tools/assets/check_deformation.py
```

Install `gltf-validator` in a scratch directory and expose its `node_modules` through `NODE_PATH` to run `node tools/assets/validate_assets.cjs`. No runtime dependencies were added to the game.

`tools/assets/check_browser.cjs` runs the browser checks. It needs `three` and `playwright` available through `NODE_PATH`, plus Google Chrome at the Windows path configured in the script. Update that path on other systems.

`tools/assets/preview.html` is a standalone inspection page. Serve the repo root, map `/characters/` to `public/characters/`, and `/vendor/three/` to the installed `three` package. It loads the delivered GLBs and lets you toggle awakening, a stress pose, and front/side/back views. It does not modify the game's renderer or gameplay code.
