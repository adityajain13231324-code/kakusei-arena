/** Zoro — KING OF HELL. Blood-red sky with dark clouds, giant crescent slash marks hanging in the air,
 * jagged dark mountains, scarred ground. */
import * as THREE from 'three';
import { makeRealm, realmUniforms, env, propMat, billboards, type RealmBuild } from './kit';

const SKY = /* glsl */`
vec3 realmSky(vec3 d){
  float h = d.y;
  vec3 col = mix(vec3(0.55, 0.03, 0.03), vec3(0.08, 0.0, 0.01), smoothstep(-0.05, 0.6, h));
  float c = kfbm(vec3(d.x * 1.6, d.y * 4.0, d.z * 1.6) + vec3(uTime * 0.05, 0.0, uTime * 0.02));
  col = mix(col, vec3(0.04, 0.0, 0.0), smoothstep(0.42, 0.75, c) * smoothstep(0.0, 0.3, h));
  // red moon
  vec3 md = normalize(vec3(-0.35, 0.42, -0.84));
  float m = dot(d, md);
  col = mix(col, vec3(1.0, 0.75, 0.6), smoothstep(0.9965, 0.998, m));
  col += vec3(1.0, 0.15, 0.08) * pow(max(m, 0.0), 60.0) * 0.8;
  col += vec3(1.0, 0.2, 0.1) * smoothstep(0.15, 0.0, abs(h)) * 0.4;
  return col;
}`;
const GROUND = /* glsl */`
vec3 realmGround(vec3 wp, vec3 d){
  float dist = distance(wp.xz, uC.xz);
  vec3 col = mix(vec3(0.07, 0.01, 0.01), vec3(0.16, 0.03, 0.02), kfbm2(wp.xz * 0.4));
  // slash scars: long diagonal grooves glowing faintly
  float s1 = abs(fract(dot(wp.xz, vec2(0.7, 0.7)) * 0.08) - 0.5);
  float s2 = abs(fract(dot(wp.xz, vec2(-0.6, 0.8)) * 0.06 + 0.3) - 0.5);
  float scar = smoothstep(0.012, 0.0, s1) * step(0.5, kn2(wp.xz * 0.05)) + smoothstep(0.01, 0.0, s2) * step(0.55, kn2(wp.xz * 0.04 + 3.0));
  col += vec3(1.0, 0.15, 0.1) * scar * (0.6 + 0.4 * sin(uTime * 4.0 + dist));
  vec3 r = reflect(d, vec3(0.0, 1.0, 0.0));
  col += realmSky(r) * 0.08;
  col = mix(col, vec3(0.35, 0.03, 0.02), smoothstep(40.0, 140.0, dist));
  return col;
}`;

function crescentTex(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  g.shadowColor = '#fff'; g.shadowBlur = 18;
  const lg = g.createLinearGradient(40, 0, 210, 0);
  lg.addColorStop(0, 'rgba(255,255,255,0.1)'); lg.addColorStop(0.7, 'rgba(255,255,255,0.85)'); lg.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = lg;
  g.beginPath(); g.moveTo(40, 8); g.quadraticCurveTo(330, 128, 40, 248); g.quadraticCurveTo(190, 128, 40, 8); g.fill();
  const t = new THREE.CanvasTexture(cv);
  return t;
}

export function buildKingOfHell(half: number, quality: 'low' | 'medium' | 'high'): RealmBuild {
  void half; void quality;
  const u = realmUniforms();
  // mountain ring: an open cylinder whose top edge is a jagged noise profile
  const mtnGeo = new THREE.CylinderGeometry(105, 105, 40, 160, 1, true);
  const mtn = new THREE.Mesh(mtnGeo, propMat(u, /* glsl */`
    float a = vUv.x * 60.0;
    float prof = 0.25 + 0.5 * kfbm2(vec2(a * 0.35, 1.7)) + 0.25 * kn2(vec2(a * 1.6, 3.1)) * kn2(vec2(a * 0.2, 9.0));
    float hgt = vUv.y;
    if (hgt > prof) discard;
    float top = smoothstep(prof - 0.02, prof, hgt);
    col = mix(vec3(0.02, 0.0, 0.005), vec3(0.06, 0.005, 0.01), hgt) + vec3(0.8, 0.08, 0.05) * top * 0.9;`, { side: THREE.BackSide }));
  mtn.position.y = 19.5;
  mtn.frustumCulled = false;
  const mtn2 = new THREE.Mesh(new THREE.CylinderGeometry(75, 75, 26, 120, 1, true), propMat(u, /* glsl */`
    float a = vUv.x * 50.0 + 17.0;
    float prof = 0.2 + 0.55 * kfbm2(vec2(a * 0.4, 5.3));
    if (vUv.y > prof) discard;
    col = vec3(0.035, 0.0, 0.006) + vec3(0.5, 0.05, 0.03) * smoothstep(prof - 0.03, prof, vUv.y);`, { side: THREE.BackSide }));
  mtn2.position.y = 12.5;
  mtn2.frustumCulled = false;
  // giant crescent slash marks hanging in the sky (instanced billboards, slowly pulsing)
  const tex = crescentTex();
  const slashes = billboards(u, 14, (i, c, s, tint) => {
    const a = (i / 14) * 6.2832 + Math.sin(i * 7.3) * 0.3;
    const r = 35 + (i % 4) * 12;
    c.set(Math.cos(a) * r, 10 + (i % 5) * 6, Math.sin(a) * r);
    const sz = 14 + (i % 3) * 10;
    s.set(sz, sz * 1.1);
    tint.set(i % 3 === 0 ? '#ffd8d8' : '#ff2a30');
    return Math.sin(i * 3.7) * 1.6;
  }, /* glsl */`
    vec4 tx = texture2D(uMap, vUv);
    float flick = 0.75 + 0.25 * sin(uTime * 3.0 + vId * 1.7);
    col = tint * tx.a * 1.6 * flick; alpha = tx.a;`, { map: tex, vertExtra: 'ctr += uC; ctr.y += sin(uTime * 0.7 + vId) * 0.6;' });
  return makeRealm('king_of_hell', u, {
    sky: SKY, ground: GROUND, rim: '#ff3040', seam: '#ffc0c0',
    env: env({ fog: '#3a0306', bg: '#1a0102', sun: '#ffb0a0', sunI: 2.1, sky: '#ff6a5a', ground: '#2a0606', hemiI: 0.95, shadow: '#6a1018', rim: '#ff3a3a', dir: [-0.35, 0.6, -0.7] }),
    update() {
      mtn.position.x = u.uC.value.x; mtn.position.z = u.uC.value.z;
      mtn2.position.x = u.uC.value.x; mtn2.position.z = u.uC.value.z;
    },
  }, [mtn, mtn2, slashes]);
}
