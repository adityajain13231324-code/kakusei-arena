# Owner-supplied 2D art

All art in this document was supplied by the owner (original work, private game). Converted for the web by
`tools/assets/convert_owner_art.py` (PIL, WebP): sources live outside the repo in `work/owner-assets/`.

| Asset | Files | Used by |
|---|---|---|
| Rooftop / Shrine painted skies | `public/stages/sky/{rooftop,shrine}_{1024,2048}.webp` | `skyPanorama()` in `src/render/stage/common.ts`; backdrop dome on both stages. 2048 for texRes 2048 + realm sky High, else 1024. The gradient `skyDome` and the procedural skyline/mountains stay as fallback until the image loads. |
| Tiling textures | `public/stages/tex/*_{512,1024}.webp` | `loadStageTex()`: concrete on rooftop floor + parapet/curb/stairhouse/bleachers, stone on shrine floor, wooden fence on shrine fence, neon sheet cropped on the rooftop ramen sign. 1024 for texRes 2048, else 512. |
| VFX flipbooks (8x8, 128 px frames, additive) | `public/vfx/{fire_burst,lightning_crackle,dust_puff,slash_arc,energy_orb}_8x8.webp` | `src/vfx/flipbook.ts` (instanced quads, frame from shader). Fire: fire-element heavy hits and Kaito fire specials. Lightning: lightning hits. Slash: blade hits (Zoro, Ren). Dust: land/knockdown/dash. Orb: ki projectile launch and ki charge/full. Counts follow the particles low/medium/high setting (3/8/16 live per sheet). |
| Character reference sheets | `tools/assets/refs/` | Reference for Astra's model builds, not shipped. |
| Market sky + wet street | `public/stages/sky/market_*.webp`, `public/stages/tex/market_wet_street_*.webp` | **Ready for the future "Monsoon Market" stage** (not built yet). Load with `skyPanorama('market', 0.4, ...)` and `loadStageTex('market_wet_street', ...)`. |

Budget: stage changes add about one draw call per stage (concrete / wood mesh); flipbooks draw only while a sprite is alive.
