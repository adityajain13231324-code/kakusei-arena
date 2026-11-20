/** Shiori — MOONLESS VOID. A black void with no stars, a faint halo where the moon should be (the moon itself is
 * missing), drifting clouds of violet ink and a still black-water floor that ripples. */
import * as THREE from 'three';
import { makeRealm, realmUniforms, env, billboards, type RealmBuild } from './kit';

const SKY = /* glsl */`
vec3 realmSky(vec3 d){
  float h = d.y;
  vec3 col = mix(vec3(0.012, 0.008, 0.02), vec3(0.0, 0.0, 0.004), smoothstep(-0.1, 0.6, h));
  // slow ink fog
  float n = kfbm(d * 2.2 + vec3(uTime * 0.02, -uTime * 0.03, 0.0));
  col += vec3(0.09, 0.04, 0.16) * pow(smoothstep(0.45, 0.85, n), 2.0) * 0.6;
  // the missing moon: a faint halo ring around an empty black disc
  vec3 md = normalize(vec3(-0.3, 0.45, -0.84));
  float m = dot(d, md);
  float ring = smoothstep(0.0025, 0.0, abs(m - 0.9945));
  col += vec3(0.7, 0.62, 1.0) * ring * (0.55 + 0.15 * sin(uTime * 0.8));
  col += vec3(0.25, 0.18, 0.45) * pow(max(m, 0.0), 40.0) * 0.35 * smoothstep(0.9945, 0.99, m);
  col *= mix(1.0, 0.0, smoothstep(0.994, 0.996, m)); // the empty disc is pure black
  col += vec3(0.25, 0.15, 0.45) * smoothstep(0.08, 0.0, abs(h)) * 0.08;
  return col;
}`;
const GROUND = /* glsl */`
vec3 realmGround(vec3 wp, vec3 d){
  float dist = distance(wp.xz, uC.xz);
  vec3 r = reflect(d, vec3(0.0, 1.0, 0.0));
  // black water: ripples bend the reflection a little
  float rip = sin(dist * 2.4 - uTime * 1.6) * 0.5 + 0.5;
  r.xz += (kn2(wp.xz * 0.6 + uTime * 0.1) - 0.5) * 0.04;
  vec3 col = vec3(0.004, 0.002, 0.008) + realmSky(normalize(r)) * 0.45;
  col += vec3(0.35, 0.25, 0.6) * smoothstep(0.48, 0.5, abs(fract(dist * 0.18 - uTime * 0.08) - 0.5)) * 0.05 * smoothstep(50.0, 4.0, dist);
  col += vec3(0.2, 0.12, 0.35) * rip * 0.015 * smoothstep(20.0, 2.0, dist);
  // ink seeping across the surface
  float ink = smoothstep(0.55, 0.8, kfbm2(wp.xz * 0.08 + vec2(uTime * 0.03, 0.0)));
  col = mix(col, vec3(0.05, 0.02, 0.09), ink * 0.5);
  return col;
}`;

export function buildMoonlessVoid(half: number, quality: 'low' | 'medium' | 'high'): RealmBuild {
  void half;
  const u = realmUniforms();
  // drifting ink clouds: soft noisy blobs, one draw call; they swirl slowly around the centre
  const n = quality === 'low' ? 18 : 30;
  const ink = billboards(u, n, (i, c, s, tint) => {
    const a = (i / n) * 6.2832 + Math.random() * 0.4;
    const r = 10 + Math.random() * 40;
    c.set(Math.cos(a) * r, 1 + Math.random() * 14, Math.sin(a) * r);
    const sz = 7 + Math.random() * 12;
    s.set(sz, sz * (0.5 + Math.random() * 0.3));
    tint.set(i % 4 === 0 ? '#5a3a9a' : '#2a1a4a');
    return Math.random() * 6.28;
  }, /* glsl */`
    vec2 p = vUv - 0.5;
    float nz = kfbm2(p * 3.0 + vec2(vId * 3.1, uTime * 0.05));
    float m = smoothstep(0.5, 0.1, length(p) + (nz - 0.5) * 0.35);
    col = tint * m * 0.26; alpha = m;`, {
    vertExtra: /* glsl */`
      float sw = uTime * 0.03 * (0.5 + fract(vId * 0.37));
      float cs = cos(sw), sn = sin(sw);
      ctr = vec3(ctr.x * cs - ctr.z * sn, ctr.y + sin(uTime * 0.3 + vId) * 0.6, ctr.x * sn + ctr.z * cs) + uC;`,
  });
  return makeRealm('moonless_void', u, {
    sky: SKY, ground: GROUND, rim: '#9a7cff', seam: '#d8c8ff',
    env: env({ fog: '#06040c', bg: '#010003', sun: '#b8a8ff', sunI: 1.5, sky: '#6a5a9a', ground: '#140c22', hemiI: 0.75, shadow: '#2a1a4a', rim: '#a88cff', dir: [-0.3, 0.5, -0.8], near: 30, far: 140 }),
    shadowOpacity: 0.7,
  }, [ink]);
}
