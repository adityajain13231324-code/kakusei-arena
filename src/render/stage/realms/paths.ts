/** Eren — THE PATHS. An endless desert of glowing sand under a starry sky, with a giant branching tree of light. */
import * as THREE from 'three';
import { makeRealm, realmUniforms, env, propMat, type RealmBuild } from './kit';

const SKY = /* glsl */`
vec3 realmSky(vec3 d){
  float h = d.y;
  vec3 col = mix(vec3(0.02, 0.035, 0.08), vec3(0.002, 0.004, 0.015), smoothstep(-0.05, 0.6, h));
  col += kstars(d, 85.0, 0.78, uTime) * 1.3 + kstars(d, 220.0, 0.66, uTime) * 0.7;
  // milky way band
  vec3 bn = normalize(vec3(0.3, 0.55, 0.78));
  float b = 1.0 - abs(dot(d, bn));
  float dust = kfbm(d * 6.0);
  col += vec3(0.3, 0.4, 0.65) * pow(b, 10.0) * (0.3 + dust * 0.9) * 0.45;
  col -= vec3(0.12) * pow(b, 14.0) * smoothstep(0.5, 0.7, kfbm(d * 12.0));
  col += vec3(0.4, 0.65, 1.0) * smoothstep(0.12, 0.0, abs(h)) * 0.12;
  return max(col, vec3(0.0));
}`;
const GROUND = /* glsl */`
vec3 realmGround(vec3 wp, vec3 d){
  float dist = distance(wp.xz, uC.xz);
  float dune = kfbm2(wp.xz * 0.05) * 0.7 + kn2(wp.xz * 0.4) * 0.15;
  float rip = sin(wp.x * 2.2 + kn2(wp.xz * 0.3) * 4.0) * 0.5 + 0.5;
  vec3 col = mix(vec3(0.06, 0.07, 0.12), vec3(0.2, 0.21, 0.3), dune) * (0.85 + rip * 0.15);
  // glowing grains: twinkling sparkles
  vec2 gp = wp.xz * 6.0;
  vec2 g = floor(gp);
  float h = kh2(g);
  float dot1 = smoothstep(0.12, 0.0, length(fract(gp) - 0.5 - (vec2(kh2(g + 3.1), kh2(g + 5.7)) - 0.5) * 0.6));
  float tw = step(0.95, h) * dot1 * (0.5 + 0.5 * sin(uTime * 4.0 + h * 80.0));
  col += vec3(0.7, 0.9, 1.0) * tw * 1.6 * smoothstep(40.0, 4.0, dist);
  // light flowing along the sand toward the tree
  float flow = smoothstep(0.45, 0.5, abs(fract(dist * 0.08 - uTime * 0.3) - 0.5));
  col += vec3(0.3, 0.6, 1.0) * flow * 0.15;
  col = mix(col, vec3(0.05, 0.09, 0.18), smoothstep(30.0, 140.0, dist));
  return col;
}`;

/** recursive light tree as one merged geometry of thin tapered prisms (uv.y = along branch, attribute depth) */
function treeGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], dep: number[] = [], idx: number[] = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const up = new THREE.Vector3(0, 1, 0);
  const seg = (a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, depth: number) => {
    const dir = b.clone().sub(a).normalize();
    const side = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up;
    const t1 = new THREE.Vector3().crossVectors(dir, side).normalize();
    const t2 = new THREE.Vector3().crossVectors(dir, t1).normalize();
    const base = pos.length / 3;
    const S = 5;
    for (let ring = 0; ring < 2; ring++) {
      const c = ring ? b : a, r = ring ? r1 : r0;
      for (let k = 0; k < S; k++) {
        const ang = (k / S) * Math.PI * 2;
        const p = c.clone().addScaledVector(t1, Math.cos(ang) * r).addScaledVector(t2, Math.sin(ang) * r);
        pos.push(p.x, p.y, p.z); uv.push(k / S, ring); dep.push(depth);
      }
    }
    for (let k = 0; k < S; k++) {
      const a0 = base + k, a1 = base + ((k + 1) % S), b0 = a0 + S, b1 = a1 + S;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  };
  const grow = (a: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number) => {
    const b = a.clone().addScaledVector(dir, len);
    seg(a, b, r, r * 0.7, depth);
    if (depth >= 7) return;
    const n = depth < 2 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const nd = dir.clone();
      const yaw = rnd() * Math.PI * 2, tilt = 0.35 + rnd() * 0.5;
      nd.add(new THREE.Vector3(Math.cos(yaw) * tilt, 0.15 + rnd() * 0.2, Math.sin(yaw) * tilt)).normalize();
      grow(b, nd, len * (0.62 + rnd() * 0.15), r * 0.65, depth + 1);
    }
  };
  // trunk + a few roots spreading over the sand
  grow(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0), 13, 0.7, 0);
  for (let i = 0; i < 5; i++) {
    const yaw = (i / 5) * Math.PI * 2 + 0.3;
    const a = new THREE.Vector3(0, 0.2, 0);
    let p = a, d = new THREE.Vector3(Math.cos(yaw), -0.02, Math.sin(yaw));
    for (let k = 0; k < 4; k++) { const b = p.clone().addScaledVector(d, 9); seg(p, b, 0.7 - k * 0.15, 0.55 - k * 0.12, 3 + k); p = b; d = d.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.6, 0, (rnd() - 0.5) * 0.6)).normalize(); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('depth', new THREE.Float32BufferAttribute(dep, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildPaths(half: number, quality: 'low' | 'medium' | 'high'): RealmBuild {
  void half; void quality;
  const u = realmUniforms();
  const tree = new THREE.Mesh(treeGeometry(), propMat(u, /* glsl */`
    float pulse = 0.5 + 0.5 * sin(vUv.y * 6.0 - uTime * 3.0 + vD * 1.3);
    col = mix(vec3(0.25, 0.55, 1.0), vec3(1.0, 0.98, 0.9), pulse * 0.5) * (0.25 + pulse * 0.5) * (0.45 + 0.08 * vD);
    alpha = 1.0;`, {
    additive: true, side: THREE.DoubleSide,
    vert: /* glsl */`uniform float uR; uniform vec3 uC; uniform vec4 uClip; uniform float uTime; uniform float uK;
      varying vec3 vW; varying vec2 vUv; varying vec3 vN; varying float vD; attribute float depth;
      void main(){ vUv = uv; vD = depth; vN = normal; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    pars: 'varying float vD;',
  }));
  tree.frustumCulled = false;
  // soft glow behind the tree
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), propMat(u, /* glsl */`
    float r = length(vUv - vec2(0.5, 0.35)) * 2.0;
    col = vec3(0.25, 0.5, 1.0) * exp(-r * 4.0) * 0.22 * smoothstep(1.0, 0.55, r); alpha = 1.0;`, { additive: true }));
  glow.frustumCulled = false;
  return makeRealm('paths', u, {
    sky: SKY, ground: GROUND, rim: '#8fe0ff', seam: '#d8f4ff',
    env: env({ fog: '#0c1a34', bg: '#04081a', sun: '#c8dcff', sunI: 2.0, sky: '#9ab8ff', ground: '#3a3a52', hemiI: 1.05, shadow: '#3a4a7a', rim: '#8fd8ff', dir: [0.2, 0.8, -0.6] }),
    update() {
      const c = u.uC.value;
      tree.position.set(c.x + 10, 0, c.z - 80);
      glow.position.set(c.x + 10, 26, c.z - 97);
      glow.scale.set(110, 90, 1);
    },
  }, [glow, tree]);
}
