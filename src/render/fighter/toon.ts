/**
 * Fighter materials for the skinned GLB models.
 *
 * Toon: MeshToonMaterial + onBeforeCompile:
 *   - hard 3-step light/shadow with a coloured shadow tint (gradient map + tint override)
 *   - awakened atlas blended in with a bottom→top wipe (object-space height) and a glowing wipe edge
 *   - emissive glow from bright saturated texels of the awakened atlas (atlas-agnostic mask), pulsed
 *   - fresnel rim light, hit flash, optional hue rotation (alternate palette for mirror matches; skin kept)
 * Outline: inverted hull with skinning, extruded along a smoothed normal (attribute `onormal`, built by
 * assets.ts) in view space, thickness growing slightly with distance so it reads on far cameras.
 */
import * as THREE from 'three';
import { toonGradient } from '../materials';

export interface FighterUniforms {
  uWipe: { value: number };
  uHasMap2: { value: number };
  uMap2: { value: THREE.Texture | null };
  uGlow: { value: number };
  uGlowColor: { value: THREE.Color };
  uEdge: { value: number };
  uRimColor: { value: THREE.Color };
  uRimStrength: { value: number };
  uRimWidth: { value: number };
  uShadowTint: { value: THREE.Color };
  uFlash: { value: number };
  uFlashColor: { value: THREE.Color };
  uHue: { value: number };
  uOutlineColor: { value: THREE.Color };
  uOutlineWidth: { value: number };
  /** Face_Expressions panel offset (glTF UV space), only read by the face material */
  uFaceOff: { value: THREE.Vector2 };
  /** outline opacity (ghost copies) */
  uOpacity: { value: number };
}

export function makeFighterUniforms(): FighterUniforms {
  return {
    uWipe: { value: -1 },
    uHasMap2: { value: 0 },
    uMap2: { value: null },
    uGlow: { value: 0 },
    uGlowColor: { value: new THREE.Color('#ffffff') },
    uEdge: { value: 0 },
    uRimColor: { value: new THREE.Color('#ffffff') },
    uRimStrength: { value: 0.22 },
    uRimWidth: { value: 0.62 },
    uShadowTint: { value: new THREE.Color('#7a6a9a') },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color('#ffffff') },
    uHue: { value: 0 },
    uOutlineColor: { value: new THREE.Color('#120c14') },
    uOutlineWidth: { value: 0.0055 },
    uFaceOff: { value: new THREE.Vector2(0, 0) },
    uOpacity: { value: 1 },
  };
}

export function makeFighterToon(map: THREE.Texture | null, u: FighterUniforms, face = false): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, map, gradientMap: toonGradient() });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying float vObjY;`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
vObjY = transformed.y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vObjY;
uniform sampler2D uMap2;
uniform float uHasMap2, uWipe, uGlow, uEdge, uRimStrength, uRimWidth, uFlash, uHue;
uniform vec3 uGlowColor, uRimColor, uFlashColor;
uniform vec2 uFaceOff;
vec3 kkSrgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(0.4545)); }
float kkSat(vec3 s) { float mx = max(s.r, max(s.g, s.b)); float mn = min(s.r, min(s.g, s.b)); return mx > 1e-4 ? (mx - mn) / mx : 0.0; }
float kkHueOf(vec3 s) {
  float mx = max(s.r, max(s.g, s.b)); float mn = min(s.r, min(s.g, s.b)); float d = mx - mn + 1e-5;
  float h = mx == s.r ? mod((s.g - s.b) / d, 6.0) : (mx == s.g ? (s.b - s.r) / d + 2.0 : (s.r - s.g) / d + 4.0);
  return h / 6.0;
}
vec3 kkRotHue(vec3 c, float a) { const vec3 k = vec3(0.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }`)
      .replace('#include <map_fragment>', `
float kkGlowMask = 0.0;
float kkEdgeK = 0.0;
#ifdef USE_MAP
{
  vec2 kkUv = vMapUv;
  #ifdef KK_FACE
  kkUv += uFaceOff;
  #endif
  vec4 texA = texture2D( map, kkUv );
  float wipeK = uHasMap2 * smoothstep( vObjY - 0.03, vObjY + 0.03, uWipe );
  vec4 tex = texA;
  if ( wipeK > 0.0 ) {
    vec4 texB = texture2D( uMap2, kkUv );
    tex = mix( texA, texB, wipeK );
    vec3 sB = kkSrgb( texB.rgb );
    kkGlowMask = wipeK * smoothstep( 0.45, 0.75, kkSat( sB ) ) * smoothstep( 0.55, 0.85, max( sB.r, max( sB.g, sB.b ) ) );
  }
  kkEdgeK = uEdge * ( 1.0 - smoothstep( 0.0, 0.07, abs( vObjY - uWipe ) ) );
  if ( abs( uHue ) > 0.001 ) {
    vec3 s = kkSrgb( tex.rgb );
    float sat = kkSat( s ); float hue = kkHueOf( s ); float val = max( s.r, max( s.g, s.b ) );
    float skin = step( 0.025, hue ) * step( hue, 0.13 ) * step( sat, 0.58 ) * step( 0.42, val );
    float mask = smoothstep( 0.14, 0.3, sat ) * ( 1.0 - skin );
    tex.rgb = mix( tex.rgb, max( kkRotHue( tex.rgb, uHue ), vec3( 0.0 ) ), mask );
  }
  diffuseColor *= tex;
}
#endif`)
      .replace('#include <gradientmap_pars_fragment>', `
#ifdef USE_GRADIENTMAP
uniform sampler2D gradientMap;
#endif
uniform vec3 uShadowTint;
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
  float dotNL = dot( normal, lightDirection );
  vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
  #ifdef USE_GRADIENTMAP
  float g = texture2D( gradientMap, coord ).r;
  #else
  float g = step( 0.45, coord.x );
  #endif
  return mix( uShadowTint, vec3( 1.0 ), g );
}`)
      .replace('#include <opaque_fragment>', `
{
  vec3 vdirR = normalize( vViewPosition );
  float fres = 1.0 - clamp( abs( dot( normal, vdirR ) ), 0.0, 1.0 );
  float rimM = smoothstep( uRimWidth, uRimWidth + 0.05, fres );
  outgoingLight += uRimColor * rimM * uRimStrength;
  outgoingLight += diffuseColor.rgb * uGlowColor * kkGlowMask * uGlow;
  outgoingLight += uGlowColor * kkEdgeK * 2.5;
  outgoingLight = mix( outgoingLight, uFlashColor, uFlash );
}
#include <opaque_fragment>`);
  };
  if (face) (m as unknown as { defines: Record<string, string> }).defines = { KK_FACE: '' };
  m.customProgramCacheKey = () => (face ? 'kk-fighter-toon-face' : 'kk-fighter-toon');
  return m;
}

export function makeFighterOutline(u: FighterUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uOutlineColor: u.uOutlineColor, uOutlineWidth: u.uOutlineWidth, uOpacity: u.uOpacity },
    vertexShader: /* glsl */`
      #include <common>
      #include <skinning_pars_vertex>
      attribute vec3 onormal;
      uniform float uOutlineWidth;
      void main() {
        vec3 objectNormal = onormal;
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        vec4 mv = modelViewMatrix * vec4( transformed, 1.0 );
        vec3 vn = normalize( normalMatrix * objectNormal );
        float w = uOutlineWidth * clamp( 0.55 + -mv.z * 0.11, 0.6, 2.4 );
        mv.xyz += vn * w;
        mv.z -= w * 0.6;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uOutlineColor;
      uniform float uOpacity;
      void main() {
        gl_FragColor = vec4( uOutlineColor, uOpacity );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
