/** Luffy — GEAR FIFTH. A bright cartoon world: cream sky with halftone dots and comic speed lines, puffy bouncing
 * clouds (plain shapes, no faces), drum-beat pulse rings, a rubbery wobbling ground. */
import * as THREE from 'three';
import { makeRealm, realmUniforms, env, billboards, type RealmBuild } from './kit';

const SKY = /* glsl */`
vec3 realmSky(vec3 d){
  float h = d.y;
  vec3 col = mix(vec3(1.0, 0.93, 0.78), vec3(0.98, 0.98, 1.0), smoothstep(-0.1, 0.8, h));
  // halftone dots (bigger toward the horizon)
  vec2 sp = vec2(atan(d.z, d.x) * 40.0, h * 40.0);
  vec2 cell = fract(sp) - 0.5;
  float rad = 0.32 * smoothstep(0.7, 0.0, h);
  col = mix(col, vec3(1.0, 0.78, 0.42), smoothstep(rad, rad - 0.06, length(cell)) * 0.6);
  // comic burst lines around the zenith, rotating slowly
  float a = atan(d.z, d.x) / 6.2831853 * 72.0 + uTime * 0.6;
  float id = floor(a);
  float on = step(0.55, kh1(id * 3.1 + floor(uTime * 4.0) * 0.0));
  float line = smoothstep(0.5, 0.42, abs(fract(a) - 0.5)) * on * smoothstep(0.2, 0.75, h);
  col = mix(col, vec3(0.08, 0.06, 0.08), line * 0.55);
  // sun with a cartoon outline
  vec3 sd = normalize(vec3(0.3, 0.55, -0.78));
  float s = dot(d, sd);
  col = mix(col, vec3(1.0, 1.0, 0.92), smoothstep(0.984, 0.986, s));
  col = mix(col, vec3(0.05), smoothstep(0.981, 0.982, s) * (1.0 - smoothstep(0.984, 0.985, s)));
  return col;
}`;
const GROUND = /* glsl */`
vec3 realmGround(vec3 wp, vec3 d){
  float dist = distance(wp.xz, uC.xz);
  vec3 col = vec3(1.0, 0.96, 0.86);
  // big soft checker + halftone
  vec2 q = floor(wp.xz * 0.25);
  col = mix(col, vec3(1.0, 0.86, 0.7), mod(q.x + q.y, 2.0) * 0.5);
  vec2 cell = fract(wp.xz * 1.2) - 0.5;
  col = mix(col, vec3(0.98, 0.62, 0.45), smoothstep(0.2, 0.15, length(cell)) * 0.25);
  // drum-beat pulse rings travelling outward (beat every 0.42 s)
  float beat = fract(uTime / 0.42);
  float ring = smoothstep(0.35, 0.0, abs(dist - beat * 22.0)) * (1.0 - beat);
  col = mix(col, vec3(0.06, 0.05, 0.08), ring * 0.8);
  float ring2 = smoothstep(0.46, 0.5, abs(fract(dist * 0.12 - uTime * 0.5) - 0.5));
  col = mix(col, vec3(0.2, 0.15, 0.2), ring2 * 0.25);
  col = mix(col, vec3(1.0, 0.97, 0.9), smoothstep(30.0, 140.0, dist));
  return col;
}`;
// rubbery ground: waves travel out from the centre, flat under the fighters
const DISPLACE = /* glsl */`
  float dd = distance(p.xz, uC.xz);
  p.y += sin(dd * 0.6 - uTime * 6.0) * 0.35 * smoothstep(5.0, 16.0, dd) * smoothstep(120.0, 60.0, dd);
`;

function cloudTex(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 160;
  const g = cv.getContext('2d')!;
  const blobs: Array<[number, number, number]> = [[70, 100, 46], [120, 72, 58], [178, 92, 48], [140, 112, 44], [96, 118, 36], [206, 116, 30]];
  const path = () => { g.beginPath(); for (const [x, y, r] of blobs) { g.moveTo(x + r, y); g.arc(x, y, r, 0, 6.2832); } };
  g.fillStyle = '#141018'; g.save(); g.translate(0, 0); path(); g.lineWidth = 14; g.strokeStyle = '#141018'; g.stroke(); g.restore();
  g.fillStyle = '#ffffff'; path(); g.fill();
  g.fillStyle = 'rgba(255,214,170,0.55)';
  g.beginPath(); for (const [x, y, r] of blobs) { g.moveTo(x + r * 0.8, y + r * 0.35); g.arc(x, y + r * 0.35, r * 0.8, 0, 3.1416); } g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildGearFifth(half: number, quality: 'low' | 'medium' | 'high'): RealmBuild {
  void half; void quality;
  const u = realmUniforms();
  const clouds = billboards(u, 16, (i, c, s, tint) => {
    const a = (i / 16) * 6.2832 + Math.sin(i * 5.1) * 0.25;
    const r = 26 + (i % 4) * 14;
    c.set(Math.cos(a) * r, 7 + (i % 5) * 4, Math.sin(a) * r);
    const sz = 9 + (i % 3) * 5;
    s.set(sz, sz * 0.62);
    tint.set('#ffffff');
    return 0;
  }, /* glsl */`
    vec4 tx = texture2D(uMap, vUv);
    col = tx.rgb; alpha = tx.a;`, {
    map: cloudTex(), additive: false,
    // bounce: hop up and squash on landing
    vertExtra: /* glsl */`
      float ph = fract(uTime * 0.9 + vId * 0.37);
      float hop = 4.0 * ph * (1.0 - ph);
      ctr += uC; ctr.y += hop * 2.2;
      float sq = 1.0 - 0.25 * smoothstep(0.12, 0.0, min(ph, 1.0 - ph));
      sz *= vec2(2.0 - sq, sq);`,
  });
  return makeRealm('gear_fifth', u, {
    sky: SKY, ground: GROUND, rim: '#ffffff', seam: '#ffe48a',
    env: env({ fog: '#fff4dc', bg: '#fff8ec', sun: '#ffffff', sunI: 2.6, sky: '#fffaf0', ground: '#ffd8b0', hemiI: 1.5, shadow: '#a88aa8', rim: '#ffffff', dir: [0.3, 0.9, 0.4] }),
    floorDisplace: DISPLACE, floorSegments: [96, 40], shadowOpacity: 0.35,
  }, [clouds]);
}
