/** Kaito — SUN FORGE. A molten forge under an orange-gold sky: a huge blazing sun, heat haze, a ring of black
 * forge walls with lava pouring over their rims, a basalt floor split by glowing molten veins, embers rising. */
import * as THREE from 'three';
import { makeRealm, realmUniforms, env, propMat, type RealmBuild } from './kit';

const SKY = /* glsl */`
vec3 realmSky(vec3 d){
  float h = d.y;
  vec3 col = mix(vec3(1.0, 0.42, 0.08), vec3(0.32, 0.06, 0.02), smoothstep(-0.05, 0.75, h));
  // heat haze: slow rolling bands of brighter / darker smoke
  float n = kfbm(vec3(d.x * 2.0, d.y * 5.0 - uTime * 0.25, d.z * 2.0));
  col = mix(col, vec3(0.12, 0.02, 0.01), smoothstep(0.5, 0.8, n) * smoothstep(0.05, 0.5, h) * 0.8);
  col += vec3(1.0, 0.55, 0.1) * pow(smoothstep(0.35, 0.7, n), 3.0) * 0.25;
  // the forge sun: white-gold core, pulsing corona with flares
  vec3 sd = normalize(vec3(0.15, 0.32, -0.94));
  float s = dot(d, sd);
  float flare = 0.6 + 0.4 * kn3(vec3(atan(d.x - sd.x, d.y - sd.y) * 3.0, uTime * 0.8, 0.0));
  col = mix(col, vec3(1.0, 0.97, 0.82), smoothstep(0.988, 0.991, s));
  col += vec3(1.0, 0.7, 0.2) * pow(max(s, 0.0), 90.0) * 2.2 * flare;
  col += vec3(1.0, 0.45, 0.08) * pow(max(s, 0.0), 12.0) * 0.6;
  // glowing horizon (molten sea far away)
  col += vec3(1.0, 0.5, 0.1) * smoothstep(0.12, 0.0, abs(h)) * 0.7;
  return col;
}`;
const GROUND = /* glsl */`
vec3 realmGround(vec3 wp, vec3 d){
  float dist = distance(wp.xz, uC.xz);
  vec3 col = mix(vec3(0.05, 0.025, 0.02), vec3(0.13, 0.07, 0.05), kfbm2(wp.xz * 0.35));
  // molten veins: cracks of a cellular-ish noise, slowly pulsing
  float v = abs(kfbm2(wp.xz * 0.12 + 4.0) - 0.5);
  float v2 = abs(kn2(wp.xz * 0.45 + 9.0) - 0.5);
  float crack = smoothstep(0.018, 0.0, v) + smoothstep(0.012, 0.0, v2) * 0.5;
  float pulse = 0.7 + 0.3 * sin(uTime * 2.2 + dist * 0.4 + kn2(wp.xz * 0.2) * 6.0);
  col += mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.8, 0.3), smoothstep(0.6, 1.0, crack)) * crack * pulse * 1.1;
  // forge glow pooling under the fight
  col += vec3(1.0, 0.35, 0.05) * exp(-dist * 0.12) * 0.05;
  vec3 r = reflect(d, vec3(0.0, 1.0, 0.0));
  col += realmSky(r) * 0.025;
  col = mix(col, vec3(0.45, 0.12, 0.02), smoothstep(50.0, 140.0, dist));
  return col;
}`;

export function buildSunForge(half: number, quality: 'low' | 'medium' | 'high'): RealmBuild {
  void half;
  const u = realmUniforms();
  // forge walls: an open cylinder with a jagged top, lava falls streaming down from the rim
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(92, 92, 34, 128, 1, true), propMat(u, /* glsl */`
    float a = vUv.x * 56.0;
    float prof = 0.45 + 0.35 * kfbm2(vec2(a * 0.3, 2.3)) + 0.1 * kn2(vec2(a * 2.0, 7.0));
    if (vUv.y > prof) discard;
    float top = smoothstep(prof - 0.035, prof, vUv.y);
    col = mix(vec3(0.02, 0.008, 0.006), vec3(0.07, 0.025, 0.012), vUv.y);
    // lava falls: narrow bright streams in some columns, flowing downward
    float lane = floor(a * 1.5);
    float on = step(0.72, kh1(lane * 3.7));
    float w = smoothstep(0.5, 0.15, abs(fract(a * 1.5) - 0.5));
    float flow = 0.6 + 0.4 * kn2(vec2(a * 6.0, vUv.y * 20.0 + uTime * 3.0));
    col += vec3(1.0, 0.38, 0.05) * on * w * flow * 1.6 * smoothstep(0.0, 0.2, prof - vUv.y + 0.2);
    col += vec3(1.0, 0.55, 0.15) * top * 1.4;`, { side: THREE.BackSide }));
  wall.position.y = 15;
  wall.frustumCulled = false;
  // embers rising through the heat (moved in the vertex shader, one draw call)
  const N = quality === 'low' ? 350 : quality === 'medium' ? 650 : 900;
  const geo = new THREE.BufferGeometry();
  const seed = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * 6.2832, r = 2 + Math.pow(Math.random(), 0.6) * 45;
    seed.set([Math.cos(a) * r, Math.sin(a) * r, Math.random(), 0.4 + Math.random()], i * 4);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  const em = propMat(u, /* glsl */`
    vec2 c = gl_PointCoord - 0.5; float r = length(c);
    col = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.85, 0.4), vB) * smoothstep(0.5, 0.0, r) * 1.8 * vF; alpha = 1.0;`, {
    additive: true,
    vert: /* glsl */`uniform float uR; uniform vec3 uC; uniform vec4 uClip; uniform float uTime; uniform float uK;
      varying vec3 vW; varying vec2 vUv; varying vec3 vN; varying float vB; varying float vF;
      attribute vec4 seed;
      void main(){
        float ph = fract(seed.z + uTime * 0.09 * seed.w);
        float y = ph * 22.0;
        vec3 w = uC + vec3(seed.x + sin(uTime * 1.3 * seed.w + seed.z * 20.0) * 0.8, y, seed.y + cos(uTime * 1.1 + seed.z * 13.0) * 0.8);
        vW = w; vUv = vec2(0.0); vN = vec3(0.0, 1.0, 0.0); vB = fract(seed.w * 5.3);
        vF = smoothstep(0.0, 0.08, ph) * smoothstep(1.0, 0.6, ph);
        vec4 mv = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(170.0 / -mv.z, 1.0, 6.0) * (0.6 + vB * 0.8);
      }`,
    pars: 'varying float vB; varying float vF;',
  });
  const embers = new THREE.Points(geo, em);
  embers.frustumCulled = false;
  return makeRealm('sun_forge', u, {
    sky: SKY, ground: GROUND, rim: '#ffb040', seam: '#ffe0a0',
    env: env({ fog: '#5a1a06', bg: '#2a0a02', sun: '#ffd08a', sunI: 2.6, sky: '#ff9a4a', ground: '#4a1a0a', hemiI: 1.05, shadow: '#7a2a10', rim: '#ffb04a', dir: [0.15, 0.6, -0.8] }),
    update() { wall.position.x = u.uC.value.x; wall.position.z = u.uC.value.z; },
  }, [wall, embers]);
}
