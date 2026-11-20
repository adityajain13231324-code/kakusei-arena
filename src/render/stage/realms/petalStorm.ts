/** Ren — PETAL STORM DOJO. A night dojo open to a full moon: polished plank floor, a ring of shoji walls glowing
 * warm between dark pillars, red paper lanterns bobbing, and a storm of pink petals swirling around the fight. */
import * as THREE from 'three';
import { makeRealm, realmUniforms, env, propMat, billboards, type RealmBuild } from './kit';

const SKY = /* glsl */`
vec3 realmSky(vec3 d){
  float h = d.y;
  vec3 col = mix(vec3(0.1, 0.07, 0.16), vec3(0.01, 0.015, 0.05), smoothstep(-0.05, 0.6, h));
  col += kstars(d, 90.0, 0.85, uTime) * 0.6;
  // full moon with a soft pink halo
  vec3 md = normalize(vec3(0.35, 0.5, -0.79));
  float m = dot(d, md);
  col = mix(col, vec3(1.0, 0.96, 0.9) * (0.85 + 0.15 * kn3(d * 60.0)), smoothstep(0.9966, 0.998, m));
  col += vec3(1.0, 0.65, 0.8) * pow(max(m, 0.0), 80.0) * 0.5 + vec3(0.6, 0.3, 0.5) * pow(max(m, 0.0), 8.0) * 0.12;
  // distant cherry trees: a pink band of blobs on the horizon
  float a = atan(d.z, d.x);
  float tree = 0.06 + 0.05 * kfbm2(vec2(a * 9.0, 1.3));
  col = mix(col, vec3(0.55, 0.22, 0.36) * (0.6 + 0.4 * kn2(vec2(a * 40.0, h * 40.0))), step(h, tree) * step(-0.02, h));
  return col;
}`;
const GROUND = /* glsl */`
vec3 realmGround(vec3 wp, vec3 d){
  float dist = distance(wp.xz, uC.xz);
  // planks along x, staggered seams
  vec2 p = wp.xz - uC.xz;
  float row = floor(p.y / 0.55);
  float seamZ = smoothstep(0.0, 0.02, abs(fract(p.y / 0.55) - 0.5) - 0.48);
  float seamX = smoothstep(0.0, 0.01, abs(fract(p.x / 3.2 + kh1(row) * 0.7) - 0.5) - 0.49);
  float grain = kn2(vec2(p.x * 0.8, p.y * 14.0 + row * 3.0));
  vec3 col = mix(vec3(0.16, 0.08, 0.04), vec3(0.3, 0.16, 0.08), grain * 0.6 + kh1(row * 1.7) * 0.4);
  col *= 1.0 - (seamZ + seamX) * 0.55;
  // polished: moon + lantern reflections
  vec3 r = reflect(d, vec3(0.0, 1.0, 0.0));
  col += realmSky(r) * 0.22;
  col += vec3(1.0, 0.45, 0.25) * exp(-dist * 0.09) * 0.06;
  // tatami edge where the dojo ends, garden gravel beyond
  col = mix(col, vec3(0.1, 0.09, 0.12) * (0.7 + 0.3 * kn2(wp.xz * 3.0)), smoothstep(26.0, 27.0, dist));
  return col;
}`;

/** petal sprite (single heart-ish leaf shape with a soft gradient) */
function petalTex(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const gr = g.createRadialGradient(32, 40, 2, 32, 32, 30);
  gr.addColorStop(0, '#fff4f8'); gr.addColorStop(0.6, '#ffb8d0'); gr.addColorStop(1, '#ff7aa8');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(32, 60); g.bezierCurveTo(4, 40, 10, 6, 26, 8); g.lineTo(32, 16); g.lineTo(38, 8); g.bezierCurveTo(54, 6, 60, 40, 32, 60);
  g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildPetalStorm(half: number, quality: 'low' | 'medium' | 'high'): RealmBuild {
  void half;
  const u = realmUniforms();
  // shoji walls: dark pillars + glowing paper panels with a lattice, on an open cylinder around the dojo
  const walls = new THREE.Mesh(new THREE.CylinderGeometry(27, 27, 7.5, 64, 1, true), propMat(u, /* glsl */`
    float x = vUv.x * 40.0;
    float pil = smoothstep(0.0, 0.02, abs(fract(x) - 0.5) - 0.42);
    float lx = smoothstep(0.0, 0.015, abs(fract(x * 3.0) - 0.5) - 0.47);
    float ly = smoothstep(0.0, 0.015, abs(fract(vUv.y * 6.0) - 0.5) - 0.47);
    float flick = 0.9 + 0.1 * sin(uTime * 3.0 + floor(x) * 2.3);
    vec3 paper = vec3(1.0, 0.72, 0.42) * (0.55 + 0.35 * vUv.y) * flick;
    col = mix(paper, vec3(0.08, 0.03, 0.02), max(lx, ly) * 0.85);
    col = mix(col, vec3(0.05, 0.02, 0.015), pil);
    col = mix(col, vec3(0.06, 0.025, 0.02), step(0.88, vUv.y) + step(vUv.y, 0.07));`, { side: THREE.BackSide }));
  walls.position.y = 3.75;
  walls.frustumCulled = false;
  // red paper lanterns hanging just inside the walls (camera-facing glow quads, bobbing)
  const lanterns = billboards(u, 12, (i, c, s, tint) => {
    const a = (i / 12) * 6.2832 + 0.13;
    c.set(Math.cos(a) * 24, 5.2, Math.sin(a) * 24);
    s.set(1.6, 2.1);
    tint.set(i % 3 === 0 ? '#ffd27a' : '#ff4a3a');
    return 0;
  }, /* glsl */`
    vec2 p = (vUv - 0.5) * vec2(2.0, 2.0);
    float body = smoothstep(1.0, 0.92, length(p * vec2(1.25, 1.05)));
    float rib = 0.85 + 0.15 * sin(p.y * 18.0);
    float glow = exp(-length(p) * 2.2);
    float flick = 0.85 + 0.15 * sin(uTime * 7.0 + vId * 2.1);
    tint = mod(vId, 3.0) < 0.5 ? vec3(1.0, 0.78, 0.4) : vec3(1.0, 0.22, 0.12);
    col = (tint * body * rib * 1.4 + tint * glow * 0.6) * flick; alpha = max(body, glow);`, {
    vertExtra: 'ctr += uC; ctr.y += sin(uTime * 1.4 + vId * 1.3) * 0.12; roll = sin(uTime * 1.1 + vId) * 0.08;',
  });
  // the petal storm: textured quads swirling around the centre on rising / falling spirals
  const P = quality === 'low' ? 160 : quality === 'medium' ? 280 : 420;
  const petals = billboards(u, P, (i, c, s, tint) => {
    c.set(Math.random() * 6.2832, 1.5 + Math.pow(Math.random(), 0.8) * 22, Math.random()); // (angle, radius, phase)
    const sz = 0.16 + Math.random() * 0.14;
    s.set(sz, sz);
    tint.set(Math.random() < 0.2 ? '#ffffff' : '#ffc8dc');
    return Math.random() * 6.28;
  }, /* glsl */`
    vec4 tx = texture2D(uMap, vUv);
    col = tx.rgb * (fract(vId * 0.618) < 0.2 ? 1.0 : 0.85); alpha = tx.a;`, {
    map: petalTex(), additive: false,
    vertExtra: /* glsl */`
      float ang = ctr.x + uTime * (0.9 + 2.5 / ctr.y);
      float ph = fract(ctr.z + uTime * 0.05);
      float yy = 0.1 + ph * 9.0 + sin(uTime * 1.7 + vId) * 0.5;
      ctr = uC + vec3(cos(ang) * ctr.y, yy, sin(ang) * ctr.y);
      roll += uTime * (1.5 + fract(vId * 0.13) * 2.0);
      sz *= vec2(0.4 + 0.6 * abs(sin(uTime * 3.0 + vId)), 1.0);`,
  });
  return makeRealm('petal_storm', u, {
    sky: SKY, ground: GROUND, rim: '#ffb8d8', seam: '#ffe0ec',
    env: env({ fog: '#1a1026', bg: '#0a0614', sun: '#e8e0ff', sunI: 2.0, sky: '#c8a8e8', ground: '#4a2a1a', hemiI: 1.05, shadow: '#4a2a5a', rim: '#ffb0d0', dir: [0.35, 0.6, -0.7] }),
    update() { walls.position.x = u.uC.value.x; walls.position.z = u.uC.value.z; },
  }, [walls, lanterns, petals]);
}
