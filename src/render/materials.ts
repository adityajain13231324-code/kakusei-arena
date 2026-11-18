/**
 * Shared toon + outline materials.
 *
 * Toon: MeshToonMaterial with a hard 3-step gradient map, a per-material shadow tint,
 * a fresnel rim term, an awakened colour blend (vertex attribute `color2`) and a per-vertex
 * glow attribute (`glow`: x = always-on emission, y = emission only while awakened).
 *
 * Outline: inverted hull. Back faces of a duplicate mesh pushed out along a smoothed normal
 * (attribute `outlineW` scales thickness per part).
 */
import * as THREE from 'three';

let gradTex: THREE.DataTexture | null = null;

/** 3-step hard gradient: deep shadow / mid / lit. Sampled with NearestFilter. */
export function toonGradient(): THREE.DataTexture {
  if (gradTex) return gradTex;
  // dotNL*0.5+0.5 → 6 texels: <-0.66 shadow, -0.66..-0.15 mid, > -0.15 lit (wide lit area = anime look)
  const v = [0, 70, 70, 255, 255, 255];
  const data = new Uint8Array(v.length * 4);
  for (let i = 0; i < v.length; i++) {
    data[i * 4] = v[i]; data[i * 4 + 1] = v[i]; data[i * 4 + 2] = v[i]; data[i * 4 + 3] = 255;
  }
  gradTex = new THREE.DataTexture(data, v.length, 1, THREE.RGBAFormat);
  gradTex.minFilter = THREE.NearestFilter;
  gradTex.magFilter = THREE.NearestFilter;
  gradTex.generateMipmaps = false;
  gradTex.needsUpdate = true;
  return gradTex;
}

export interface ToonUniforms {
  uAwaken: { value: number };
  uRimColor: { value: THREE.Color };
  uRimStrength: { value: number };
  uRimWidth: { value: number };
  uShadowTint: { value: THREE.Color };
  uFlash: { value: number };
  uFlashColor: { value: THREE.Color };
  uGlow: { value: number };
}

export type ToonMaterial = THREE.MeshToonMaterial & { userData: { u: ToonUniforms } };

export interface ToonOpts {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  /** use vertex attributes color2 + glow (fighters) */
  fighter?: boolean;
  shadowTint?: THREE.ColorRepresentation;
  rimColor?: THREE.ColorRepresentation;
  rimStrength?: number;
  rimWidth?: number;
  map?: THREE.Texture | null;
  side?: THREE.Side;
  fog?: boolean;
}

export function makeToonMaterial(o: ToonOpts = {}): ToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color: o.color ?? 0xffffff,
    vertexColors: o.vertexColors ?? false,
    gradientMap: toonGradient(),
    map: o.map ?? null,
    side: o.side ?? THREE.FrontSide,
    fog: o.fog ?? true,
  }) as ToonMaterial;
  const u: ToonUniforms = {
    uAwaken: { value: 0 },
    uRimColor: { value: new THREE.Color(o.rimColor ?? 0xffffff) },
    uRimStrength: { value: o.rimStrength ?? 0.25 },
    uRimWidth: { value: o.rimWidth ?? 0.62 },
    uShadowTint: { value: new THREE.Color(o.shadowTint ?? 0x7a6a9a) },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(0xffffff) },
    uGlow: { value: 1 },
  };
  m.userData.u = u;
  const fighter = !!o.fighter;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    if (fighter) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <color_pars_vertex>', `#include <color_pars_vertex>
attribute vec3 color2;
attribute vec2 glow;
attribute float shade;
uniform float uAwaken;
varying float vGlow;
varying float vShade;`)
        .replace('#include <color_vertex>', `#include <color_vertex>
#ifdef USE_COLOR
vColor.rgb = mix( vColor.rgb, color2, uAwaken );
#endif
vGlow = glow.x + glow.y * uAwaken;
vShade = shade;`);
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <gradientmap_pars_fragment>', `
#ifdef USE_GRADIENTMAP
uniform sampler2D gradientMap;
#endif
uniform vec3 uShadowTint;
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
  float dotNL = dot( normal, lightDirection );
  ${fighter ? 'dotNL += vShade;' : ''}
  vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
  #ifdef USE_GRADIENTMAP
  float g = texture2D( gradientMap, coord ).r;
  #else
  float g = step( 0.45, coord.x );
  #endif
  return mix( uShadowTint, vec3( 1.0 ), g );
}`)
      .replace('#include <common>', `#include <common>
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uRimWidth;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uGlow;
${fighter ? 'varying float vGlow;\nvarying float vShade;' : ''}`)
      .replace('#include <opaque_fragment>', `
{
  vec3 vdirR = normalize( vViewPosition );
  float fres = 1.0 - clamp( dot( normal, vdirR ), 0.0, 1.0 );
  float rimM = smoothstep( uRimWidth, uRimWidth + 0.05, fres );
  outgoingLight += uRimColor * rimM * uRimStrength;
  ${fighter ? 'outgoingLight += diffuseColor.rgb * vGlow * uGlow * 1.6;' : ''}
  outgoingLight = mix( outgoingLight, uFlashColor, uFlash );
}
#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => (fighter ? 'kk-toon-f' : 'kk-toon');
  return m;
}

export interface OutlineUniforms {
  uOutline: { value: number };
  uOutlineColor: { value: THREE.Color };
}
export type OutlineMaterial = THREE.MeshBasicMaterial & { userData: { u: OutlineUniforms } };

/** Inverted-hull outline. thickness is in metres (multiplied by per-vertex outlineW). */
export function makeOutlineMaterial(color: THREE.ColorRepresentation = 0x120c14, thickness = 0.012): OutlineMaterial {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide }) as OutlineMaterial;
  const u: OutlineUniforms = {
    uOutline: { value: thickness },
    uOutlineColor: { value: new THREE.Color(color) },
  };
  m.userData.u = u;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float outlineW;
uniform float uOutline;`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
#ifdef USE_SKINNING
  transformed += normalize( objectNormal ) * outlineW * uOutline;
#else
  transformed += normalize( normal ) * outlineW * uOutline;
#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uOutlineColor;`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( uOutlineColor, opacity );');
  };
  m.customProgramCacheKey = () => 'kk-outline';
  return m;
}

/** A plain unlit material that ignores tone mapping (neon, windows, sky). */
export function makeGlowMaterial(color: THREE.ColorRepresentation, opts: { map?: THREE.Texture; additive?: boolean; opacity?: number } = {}): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color,
    map: opts.map ?? null,
    transparent: !!opts.additive || (opts.opacity ?? 1) < 1 || !!opts.map,
    opacity: opts.opacity ?? 1,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: !opts.additive,
    toneMapped: false,
    fog: false,
  });
  return m;
}
