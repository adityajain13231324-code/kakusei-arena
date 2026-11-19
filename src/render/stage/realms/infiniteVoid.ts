/** Gojo — Domain Expansion: INFINITE VOID. Endless black/indigo cosmos, galaxies, star streams flowing past,
 * a glowing white horizon ring, a dark mirror floor. */
import * as THREE from 'three';
import { makeRealm, realmUniforms, env, propMat, type RealmBuild } from './kit';

const SKY = /* glsl */`
vec3 galaxy(vec3 d, vec3 ax, float size, vec3 tint, float spin){
  vec3 t1 = normalize(cross(ax, vec3(0.0, 1.0, 0.0))); vec3 t2 = cross(ax, t1);
  float w = dot(d, ax); if (w < 0.0) return vec3(0.0);
  vec2 p = vec2(dot(d, t1), dot(d, t2)) / size;
  float r = length(p); float a = atan(p.y, p.x);
  float arms = 0.5 + 0.5 * sin(2.0 * a - log(r + 0.02) * 5.0 + uTime * spin);
  float disk = exp(-r * 3.2) * (0.35 + 0.65 * arms * smoothstep(0.02, 0.4, r));
  return tint * disk * 1.4 + vec3(1.0, 0.95, 0.9) * exp(-r * 18.0) * 2.0;
}
vec3 realmSky(vec3 d){
  float h = d.y;
  vec3 col = mix(vec3(0.001, 0.0, 0.004), vec3(0.008, 0.003, 0.028), smoothstep(-0.3, 0.7, h));
  float n = kfbm(d * 2.6 + vec3(0.0, uTime * 0.015, 0.0));
  col += vec3(0.16, 0.05, 0.42) * pow(smoothstep(0.35, 0.85, n), 2.0) * 0.55;
  col += vec3(0.03, 0.1, 0.32) * pow(smoothstep(0.4, 0.9, kfbm(d * 5.0 - vec3(uTime * 0.02))), 2.0) * 0.4;
  col += kstars(d, 70.0, 0.82, uTime) * 1.2 + kstars(d, 180.0, 0.7, uTime) * 0.7;
  // star streams: short streaks flowing around the horizon, a different speed per thin lane
  float ang = atan(d.z, d.x) / 6.2831853;
  float lanePos = h * 26.0;
  float band = floor(lanePos);
  float spd = (kh1(band * 7.1 + 3.0) - 0.5) * 0.25;
  float sx = ang * 40.0 + uTime * spd + kh1(band) * 10.0;
  float u = fract(sx);
  float lane = smoothstep(0.08, 0.0, abs(fract(lanePos) - 0.5));
  float streak = smoothstep(0.0, 0.14, u) * smoothstep(0.2, 0.14, u) * lane * step(0.7, kh1(band * 3.3 + floor(sx) * 1.37));
  col += vec3(0.7, 0.8, 1.0) * streak * 1.2 * smoothstep(0.8, 0.05, abs(h));
  col += galaxy(d, normalize(vec3(0.55, 0.42, -0.72)), 0.32, vec3(0.6, 0.45, 1.0), 0.15);
  col += galaxy(d, normalize(vec3(-0.7, 0.25, -0.5)), 0.18, vec3(0.4, 0.7, 1.0), -0.2);
  col += galaxy(d, normalize(vec3(0.1, 0.75, 0.6)), 0.25, vec3(1.0, 0.6, 0.8), 0.1);
  // the white horizon ring
  float hr = abs(h + 0.015);
  col += vec3(0.92, 0.96, 1.0) * (smoothstep(0.008, 0.0, hr) * 3.0 + smoothstep(0.06, 0.0, hr) * 0.25 + smoothstep(0.25, 0.0, hr) * 0.02);
  return col;
}`;

const GROUND = /* glsl */`
vec3 realmGround(vec3 wp, vec3 d){
  vec3 r = reflect(d, vec3(0.0, 1.0, 0.0));
  float dist = distance(wp.xz, uC.xz);
  vec3 col = vec3(0.002, 0.001, 0.008) + kstars(r, 70.0, 0.82, uTime) * 0.35;
  col += vec3(0.6, 0.7, 1.0) * smoothstep(0.02, 0.0, abs(r.y - 0.015)) * 0.08;
  // faint concentric rings and a soft white glow under the fight
  col += vec3(0.6, 0.7, 1.0) * smoothstep(0.47, 0.5, abs(fract(dist * 0.25) - 0.5)) * 0.06 * smoothstep(60.0, 5.0, dist);
  col += vec3(0.5, 0.55, 1.0) * exp(-dist * 0.18) * 0.05;
  return col;
}`;

export function buildInfiniteVoid(half: number, quality: 'low' | 'medium' | 'high'): RealmBuild {
  void half;
  const u = realmUniforms();
  // star streams flowing past the fighters: a cloud of points orbiting the centre (moved in the vertex shader)
  const N = quality === 'low' ? 400 : 900;
  const geo = new THREE.BufferGeometry();
  const seed = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) seed.set([Math.random() * 6.2832, 3 + Math.pow(Math.random(), 0.7) * 40, Math.random() * 12 - 2, 0.2 + Math.random()], i * 4);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  const pm = propMat(u, /* glsl */`
    vec2 c = gl_PointCoord - 0.5; float r = length(c);
    col = mix(vec3(0.6, 0.7, 1.0), vec3(1.0), vB) * smoothstep(0.5, 0.0, r) * 1.6; alpha = 1.0;`, {
    additive: true,
    vert: /* glsl */`uniform float uR; uniform vec3 uC; uniform vec4 uClip; uniform float uTime; uniform float uK;
      varying vec3 vW; varying vec2 vUv; varying vec3 vN; varying float vB;
      attribute vec4 seed;
      void main(){
        float a = seed.x + uTime * seed.w * 0.6 / sqrt(seed.y);
        vec3 w = uC + vec3(cos(a) * seed.y, seed.z, sin(a) * seed.y);
        vW = w; vUv = vec2(0.0); vN = vec3(0.0, 1.0, 0.0); vB = fract(seed.w * 7.0);
        vec4 mv = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(150.0 / -mv.z, 1.0, 5.0) * (0.5 + vB);
      }`,
    pars: 'varying float vB;',
  });
  const pts = new THREE.Points(geo, pm);
  pts.frustumCulled = false;
  return makeRealm('infinite_void', u, {
    sky: SKY, ground: GROUND, rim: '#c8d4ff', seam: '#d8e0ff',
    env: env({ fog: '#06041a', bg: '#020108', sun: '#d8e0ff', sunI: 2.0, sky: '#9aa8ff', ground: '#20184a', hemiI: 1.0, shadow: '#3a3a7a', rim: '#b8c8ff' }),
    shadowOpacity: 0.6,
  }, [pts]);
}
