/** Goro — MOUNTAIN TEMPLE. A stone temple court on a mountain peak above a sea of clouds: flagstone platform,
 * a ring of heavy stone pillars, distant peaks, a low golden sun that rims everything in gold, drifting clouds. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRealm, realmUniforms, env, propMat, billboards, type RealmBuild } from './kit';

const PLATFORM = 24;

const SKY = /* glsl */`
vec3 realmSky(vec3 d){
  float h = d.y;
  vec3 col = mix(vec3(1.0, 0.78, 0.45), vec3(0.3, 0.45, 0.75), smoothstep(0.0, 0.55, h));
  col = mix(col, vec3(0.12, 0.2, 0.42), smoothstep(0.5, 1.0, h));
  // low golden sun
  vec3 sd = normalize(vec3(-0.55, 0.12, -0.83));
  float s = dot(d, sd);
  col = mix(col, vec3(1.0, 0.97, 0.85), smoothstep(0.9975, 0.9985, s));
  col += vec3(1.0, 0.75, 0.3) * pow(max(s, 0.0), 30.0) * 0.9 + vec3(1.0, 0.6, 0.25) * pow(max(s, 0.0), 4.0) * 0.18;
  // distant peaks poking out of the clouds
  float a = atan(d.z, d.x);
  float pk = 0.02 + 0.09 * pow(kfbm2(vec2(a * 3.0, 4.1)), 2.0) + 0.03 * kn2(vec2(a * 14.0, 2.0));
  float peak = step(h, pk) * step(-0.01, h);
  vec3 rock = mix(vec3(0.25, 0.24, 0.3), vec3(0.85, 0.65, 0.4), smoothstep(pk - 0.02, pk, h) * max(0.0, dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(sd.x, 0.0, sd.z)))));
  col = mix(col, rock, peak);
  // sea of clouds below the horizon (gold-lit tops)
  if (h < 0.0) {
    vec2 cp = d.xz / max(-h, 0.02) * 0.6 + vec2(uTime * 0.02, 0.0);
    float c = kfbm2(cp * 0.9) * 0.7 + kn2(cp * 3.0) * 0.3;
    vec3 cl = mix(vec3(0.42, 0.42, 0.58), vec3(1.0, 0.84, 0.6), smoothstep(0.3, 0.7, c));
    col = mix(col, cl, smoothstep(0.0, -0.04, h));
  }
  // high wispy clouds
  float w = kfbm(vec3(d.x * 2.0 + uTime * 0.01, d.y * 6.0, d.z * 2.0));
  col = mix(col, vec3(1.0, 0.9, 0.75), smoothstep(0.55, 0.8, w) * smoothstep(0.05, 0.35, h) * 0.4);
  return col;
}`;
const GROUND = /* glsl */`
vec3 realmGround(vec3 wp, vec3 d){
  vec2 p = wp.xz - uC.xz;
  float dist = length(p);
  // beyond the platform edge: look straight through to the cloud sea below
  if (dist > ${PLATFORM.toFixed(1)} + 0.6) return realmSky(d);
  // flagstones: offset rows of squares, each tinted, worn seams
  float row = floor(p.y / 1.25);
  vec2 q = vec2(p.x / 1.25 + kh1(row) * 0.5, p.y / 1.25);
  vec2 cell = floor(q), f = fract(q);
  float seam = smoothstep(0.04, 0.0, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
  float tone = kh2(cell);
  vec3 col = mix(vec3(0.3, 0.27, 0.25), vec3(0.52, 0.46, 0.38), tone) * (0.85 + 0.15 * kn2(wp.xz * 4.0));
  col = mix(col, vec3(0.32, 0.36, 0.22), smoothstep(0.65, 0.85, kfbm2(wp.xz * 0.5)) * 0.5); // moss
  col *= 1.0 - seam * 0.7;
  // carved ring around the centre + golden sun wash
  col *= 1.0 - smoothstep(0.08, 0.0, abs(dist - 6.0)) * 0.4;
  col = col * vec3(1.08, 0.98, 0.85) + vec3(1.0, 0.7, 0.3) * 0.04;
  // rim of the platform: worn edge stones
  col = mix(col, vec3(0.22, 0.2, 0.2), smoothstep(${(PLATFORM - 0.8).toFixed(1)}, ${PLATFORM.toFixed(1)}, dist));
  return col;
}`;

export function buildMountainTemple(half: number, quality: 'low' | 'medium' | 'high'): RealmBuild {
  void half;
  const u = realmUniforms();
  // a ring of 10 stone pillars with capitals (merged into one geometry, one draw call)
  const parts: THREE.BufferGeometry[] = [];
  const seg = quality === 'low' ? 8 : 12;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.31;
    const x = Math.cos(a) * (PLATFORM - 2), z = Math.sin(a) * (PLATFORM - 2);
    const shaft = new THREE.CylinderGeometry(0.75, 0.9, 9, seg, 1);
    shaft.translate(x, 4.5, z);
    const cap = new THREE.BoxGeometry(2.4, 0.8, 2.4);
    cap.translate(x, 9.4, z);
    const base = new THREE.BoxGeometry(2.2, 0.6, 2.2);
    base.translate(x, 0.3, z);
    parts.push(shaft.toNonIndexed(), cap.toNonIndexed(), base.toNonIndexed());
  }
  const pg = mergeGeometries(parts)!;
  for (const g of parts) g.dispose();
  const pillars = new THREE.Mesh(pg, propMat(u, /* glsl */`
    vec3 n = normalize(vN);
    vec3 sd = normalize(vec3(-0.55, 0.25, -0.83));
    float lit = max(dot(n, sd), 0.0);
    float rim = pow(1.0 - abs(dot(n, normalize(cameraPosition - vW))), 3.0);
    vec3 stone = mix(vec3(0.3, 0.28, 0.27), vec3(0.45, 0.42, 0.38), kn3(vW * 2.0)) * (0.85 + 0.15 * kn3(vW * 9.0));
    stone *= 1.0 - smoothstep(0.06, 0.0, abs(fract(vW.y * 0.5) - 0.5)) * 0.35; // carved bands
    col = stone * (0.45 + 0.55 * max(n.y, 0.0) * 0.4 + lit * 0.9) + vec3(1.0, 0.75, 0.35) * (lit * 0.25 + rim * lit * 1.2);`));
  pillars.frustumCulled = false;
  // drifting clouds around (and slightly below) the platform edge
  const nc = quality === 'low' ? 14 : 24;
  const clouds = billboards(u, nc, (i, c, s, tint) => {
    const a = (i / nc) * 6.2832 + Math.random() * 0.3;
    const r = PLATFORM + 8 + Math.random() * 40;
    c.set(Math.cos(a) * r, -3 + Math.random() * 6, Math.sin(a) * r);
    const sz = 12 + Math.random() * 14;
    s.set(sz, sz * 0.4);
    tint.set(i % 3 === 0 ? '#ffe2b0' : '#f4ecf0');
    return 0;
  }, /* glsl */`
    vec2 p = vUv - 0.5;
    float nz = kfbm2(p * vec2(4.0, 2.0) + vec2(vId * 2.7 + uTime * 0.02, vId));
    float m = smoothstep(0.5, 0.15, length(p * vec2(1.0, 1.6)) + (0.5 - nz) * 0.4);
    col = tint * (0.75 + 0.25 * vUv.y); alpha = m * 0.85;`, {
    additive: false,
    vertExtra: /* glsl */`
      float sw = uTime * 0.015;
      float cs = cos(sw), sn = sin(sw);
      ctr = vec3(ctr.x * cs - ctr.z * sn, ctr.y + sin(uTime * 0.2 + vId) * 0.3, ctr.x * sn + ctr.z * cs) + uC;`,
  });
  return makeRealm('mountain_temple', u, {
    sky: SKY, ground: GROUND, rim: '#ffd27a', seam: '#fff0c8',
    env: env({ fog: '#d8b88a', bg: '#7a8ab8', sun: '#ffd8a0', sunI: 2.8, sky: '#c8d8ff', ground: '#8a7058', hemiI: 1.15, shadow: '#5a4a6a', rim: '#ffcf6a', dir: [-0.55, 0.35, -0.75], near: 60, far: 220 }),
    update() { pillars.position.set(u.uC.value.x, 0, u.uC.value.z); },
  }, [pillars, clouds]);
}
