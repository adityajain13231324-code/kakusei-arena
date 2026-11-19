/** Naruto — TAILED BEAST BOMB. Crimson night, a giant swirling dark chakra sphere forming overhead, shockwave domes,
 * scorched ground with glowing cracks. */
import * as THREE from 'three';
import { makeRealm, realmUniforms, env, propMat, type RealmBuild } from './kit';

const SKY = /* glsl */`
vec3 realmSky(vec3 d){
  float h = d.y;
  vec3 col = mix(vec3(0.42, 0.03, 0.04), vec3(0.03, 0.0, 0.015), smoothstep(-0.05, 0.55, h));
  float c = kfbm(vec3(d.x * 2.2, d.y * 6.0, d.z * 2.2) + vec3(uTime * 0.03, 0.0, 0.0));
  col = mix(col, vec3(0.08, 0.0, 0.01), smoothstep(0.45, 0.8, c) * smoothstep(-0.05, 0.4, h));
  col += vec3(0.7, 0.08, 0.04) * pow(c, 3.0) * smoothstep(0.6, 0.0, h) * 0.9;
  col += kstars(d, 90.0, 0.9, uTime) * 0.35 * smoothstep(0.1, 0.6, h);
  col += vec3(1.0, 0.25, 0.1) * smoothstep(0.12, 0.0, abs(h)) * 0.35;
  return col;
}`;
const GROUND = /* glsl */`
vec3 realmGround(vec3 wp, vec3 d){
  vec2 p = wp.xz * 0.35;
  vec2 ip = floor(p); vec2 fp = fract(p);
  float m1 = 9.0, m2 = 9.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = vec2(kh2(ip + g), kh2(ip + g + 7.7));
    float dd = length(g + o - fp);
    if (dd < m1) { m2 = m1; m1 = dd; } else if (dd < m2) m2 = dd;
  }
  float crack = smoothstep(0.08, 0.0, m2 - m1);
  float dist = distance(wp.xz, uC.xz);
  vec3 rock = mix(vec3(0.05, 0.02, 0.02), vec3(0.12, 0.05, 0.04), kfbm2(wp.xz * 0.6));
  float pulse = 0.6 + 0.4 * sin(uTime * 3.0 - dist * 0.4);
  vec3 col = rock + vec3(1.0, 0.25, 0.05) * crack * pulse * 1.4;
  col = mix(col, vec3(0.3, 0.03, 0.03), smoothstep(30.0, 140.0, dist));
  return col;
}`;

export function buildTailedBeastBomb(half: number, quality: 'low' | 'medium' | 'high'): RealmBuild {
  void half; void quality;
  const u = realmUniforms();
  // the chakra sphere (dark core, swirling red/violet bands, hot rim)
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), propMat(u, /* glsl */`
    vec3 vd = normalize(vW - cameraPosition);
    float f = pow(1.0 - abs(dot(normalize(vN), -vd)), 2.0);
    vec3 op = normalize(vW - uSphere);
    float sw = kfbm(op * 3.0 + vec3(0.0, uTime * 0.8, 0.0) + vec3(sin(op.y * 4.0 + uTime), 0.0, cos(op.y * 4.0 + uTime)));
    vec3 core = vec3(0.04, 0.0, 0.06);
    col = core + vec3(0.6, 0.05, 0.25) * pow(sw, 2.5) * 1.6 + vec3(0.25, 0.05, 0.5) * pow(sw, 5.0) * 2.0;
    col += vec3(1.0, 0.3, 0.5) * f * 1.6;`, { extra: { uSphere: { value: new THREE.Vector3() } }, pars: 'uniform vec3 uSphere;' }));
  sphere.frustumCulled = false;
  // halo + shock dome
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), propMat(u, /* glsl */`
    vec3 vd = normalize(vW - cameraPosition);
    float f = pow(1.0 - abs(dot(normalize(vN), -vd)), 3.0);
    col = vec3(1.0, 0.2, 0.3) * f * 0.9; alpha = 1.0;`, { additive: true, side: THREE.BackSide }));
  halo.frustumCulled = false;
  const domeMat = propMat(u, /* glsl */`
    vec3 vd = normalize(vW - cameraPosition);
    float f = pow(1.0 - abs(dot(normalize(vN), -vd)), 2.5);
    col = vec3(1.0, 0.25, 0.15) * f * uFade * 1.5; alpha = 1.0;`, { additive: true, side: THREE.DoubleSide, extra: { uFade: { value: 0 } }, pars: 'uniform float uFade;' });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome.frustumCulled = false;
  // debris ring orbiting the sphere
  const N = 260;
  const geo = new THREE.BufferGeometry();
  const seed = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) seed.set([Math.random() * 6.2832, 1.2 + Math.random() * 0.8, (Math.random() - 0.5) * 0.4, 0.5 + Math.random()], i * 4);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  const ringMat = propMat(u, /* glsl */`vec2 c = gl_PointCoord - 0.5; col = vec3(1.0, 0.45, 0.3) * smoothstep(0.5, 0.0, length(c)) * 1.5;`, {
    additive: true,
    extra: { uSphere: { value: new THREE.Vector3() }, uS: { value: 1 } },
    vert: /* glsl */`uniform float uR; uniform vec3 uC; uniform vec4 uClip; uniform float uTime; uniform float uK; uniform vec3 uSphere; uniform float uS;
      varying vec3 vW; varying vec2 vUv; varying vec3 vN; attribute vec4 seed;
      void main(){ float a = seed.x + uTime * seed.w * 1.2; float r = seed.y * uS;
        vec3 w = uSphere + vec3(cos(a) * r, seed.z * uS + sin(a * 2.0) * 0.1 * uS, sin(a) * r);
        vW = w; vUv = vec2(0.0); vN = vec3(0.0); vec4 mv = viewMatrix * vec4(w, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(500.0 / -mv.z, 1.0, 10.0); }`,
  });
  const ring = new THREE.Points(geo, ringMat);
  ring.frustumCulled = false;
  const sp = (sphere.material as THREE.ShaderMaterial).uniforms.uSphere!.value as THREE.Vector3;
  return makeRealm('tailed_beast_bomb', u, {
    sky: SKY, ground: GROUND, rim: '#ff4a2a', seam: '#ffb08a',
    env: env({ fog: '#2a0408', bg: '#120204', sun: '#ff9a7a', sunI: 2.2, sky: '#ff7a6a', ground: '#3a0a0a', hemiI: 1.0, shadow: '#6a1a2a', rim: '#ff5a3a', dir: [-0.2, 0.9, -0.3] }),
    update(t, dt, age) {
      void dt;
      const grow = Math.min(1, age / 3.5);
      const s = 3 + grow * 6 + Math.sin(t * 6) * 0.15;
      sp.set(u.uC.value.x + 4, 9 + grow * 2, u.uC.value.z - 30);
      sphere.position.copy(sp); sphere.scale.setScalar(s);
      halo.position.copy(sp); halo.scale.setScalar(s * 1.35);
      (ringMat.uniforms.uSphere!.value as THREE.Vector3).copy(sp);
      ringMat.uniforms.uS!.value = s;
      const ph = (age * 0.45) % 1;
      dome.position.set(u.uC.value.x, 0, u.uC.value.z);
      dome.scale.setScalar(2 + ph * 70);
      domeMat.uniforms.uFade!.value = Math.pow(1 - ph, 1.5);
    },
  }, [sphere, halo, dome, ring]);
}
