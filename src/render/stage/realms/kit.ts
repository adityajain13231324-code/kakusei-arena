/**
 * Soul Realm toolkit: a realm is a "domain bubble" that expands from its owner over the stage.
 *
 *  - shell: a back-faced sphere (radius = bubble radius, centred on the owner) whose fragment colour is a
 *    procedural sky looked up by VIEW direction (so it reads as infinitely far), with a glowing rim while the
 *    bubble is small. It writes depth, so stage geometry beyond the bubble disappears behind it.
 *  - floor: a disc of the same radius with the realm's ground shader (+ a shadow-catcher disc).
 *  - props: any extra meshes whose ShaderMaterials include REALM_CLIP: fragments outside the bubble are
 *    discarded, so props appear as the bubble sweeps over them.
 *  - Realm Clash: setClip(nx, nz, d, side) keeps one half-space; shell/floor draw a grinding seam on the plane.
 *
 * setDissolve(k) maps k (0..1) to the bubble radius; setCenter(x, z) moves it (the renderer calls both).
 */
import * as THREE from 'three';
import { disposeGroup, type StageBuild } from '../common';

export interface RealmUniforms {
  uR: { value: number };
  uC: { value: THREE.Vector3 };
  uClip: { value: THREE.Vector4 };
  uTime: { value: number };
  uK: { value: number };
}

export interface RealmBuild extends StageBuild {
  setCenter(x: number, z: number): void;
  /** half-space clip for Realm Clash: keep side*(dot(p.xz, n) - d) >= 0; side 0 = off */
  setClip(nx: number, nz: number, d: number, side: number): void;
  readonly bubble: true;
}

export const GLSL_NOISE = /* glsl */`
float kh1(float n){ return fract(sin(n) * 43758.5453123); }
float kh3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123); }
float kh2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float kn3(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  float n = i.x + i.y * 57.0 + 113.0 * i.z;
  return mix(mix(mix(kh1(n), kh1(n + 1.0), f.x), mix(kh1(n + 57.0), kh1(n + 58.0), f.x), f.y),
             mix(mix(kh1(n + 113.0), kh1(n + 114.0), f.x), mix(kh1(n + 170.0), kh1(n + 171.0), f.x), f.y), f.z);
}
float kn2(vec2 x){ vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(kh2(i), kh2(i + vec2(1.0, 0.0)), f.x), mix(kh2(i + vec2(0.0, 1.0)), kh2(i + vec2(1.0, 1.0)), f.x), f.y); }
float kfbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * kn3(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
float kfbm2(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * kn2(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
vec3 kstars(vec3 d, float sc, float thr, float t){
  vec3 p = d * sc; vec3 i = floor(p); vec3 f = fract(p) - 0.5;
  float h = kh3(i);
  vec3 o = vec3(kh3(i + 1.3), kh3(i + 2.7), kh3(i + 4.1)) - 0.5;
  float r = length(f - o * 0.6);
  float s = smoothstep(0.09 * (0.4 + h), 0.0, r) * step(thr, h);
  return vec3(s) * (0.65 + 0.35 * sin(t * 2.7 + h * 50.0)) * mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.9, 0.8), kh3(i + 9.1));
}
`;

const PARS = /* glsl */`
uniform float uR; uniform vec3 uC; uniform vec4 uClip; uniform float uTime; uniform float uK;
varying vec3 vW;
`;

/** discard outside the bubble / clipped half */
export const REALM_CLIP = /* glsl */`
  if (distance(vW, uC) > uR) discard;
  if (uClip.w != 0.0 && uClip.w * (dot(vW.xz, uClip.xy) - uClip.z) < 0.0) discard;
`;

/** seam glow (Realm Clash): 0..1 near the clip plane */
const SEAM = /* glsl */`
float kseam(){ if (uClip.w == 0.0) return 0.0; float d = abs(dot(vW.xz, uClip.xy) - uClip.z);
  float flick = 0.7 + 0.3 * kn3(vec3(vW.y * 0.6, vW.x * 0.3 + vW.z * 0.3, uTime * 9.0));
  return (smoothstep(2.2, 0.0, d) * 0.6 + smoothstep(0.35, 0.0, d)) * flick; }
`;

const VERT = /* glsl */`
${PARS}
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;

export function realmUniforms(): RealmUniforms {
  return { uR: { value: 0 }, uC: { value: new THREE.Vector3() }, uClip: { value: new THREE.Vector4() }, uTime: { value: 0 }, uK: { value: 0 } };
}

function finish(m: THREE.ShaderMaterial): THREE.ShaderMaterial { m.toneMapped = false; return m; }

/**
 * prop material: `body` writes `vec3 col; float alpha;` (vUv / vW available, plus any extra uniforms).
 * additive props skip depth writes.
 */
export function propMat(u: RealmUniforms, body: string, opts: { additive?: boolean; extra?: Record<string, THREE.IUniform>; side?: THREE.Side; vert?: string; pars?: string } = {}): THREE.ShaderMaterial {
  return finish(new THREE.ShaderMaterial({
    uniforms: { ...u, ...(opts.extra ?? {}) },
    vertexShader: opts.vert ?? /* glsl */`${PARS}
      varying vec2 vUv; varying vec3 vN;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`${PARS}
      varying vec2 vUv; varying vec3 vN;
      ${GLSL_NOISE}
      ${opts.pars ?? ''}
      void main(){
        ${REALM_CLIP}
        vec3 col = vec3(0.0); float alpha = 1.0;
        ${body}
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
    transparent: !!opts.additive,
    depthWrite: !opts.additive,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: opts.side ?? THREE.FrontSide,
  }));
}

export interface RealmSpec {
  /** GLSL: vec3 realmSky(vec3 d) — d = view direction (world) */
  sky: string;
  /** GLSL: vec3 realmGround(vec3 wp, vec3 d) — wp = world pos on the floor, d = view direction */
  ground: string;
  /** rim colour of the bubble while it expands */
  rim: THREE.ColorRepresentation;
  seam?: THREE.ColorRepresentation;
  env: Pick<StageBuild, 'fog' | 'background' | 'sunDir' | 'sunColor' | 'sunIntensity' | 'hemiSky' | 'hemiGround' | 'hemiIntensity' | 'shadowTint' | 'rim'>;
  maxR?: number;
  /** extra per-frame update for props (age = seconds since the bubble started opening) */
  update?(t: number, dt: number, age: number): void;
  shadowOpacity?: number;
  /** floor vertex displacement GLSL (optional): modifies `vec3 p` (world) before projection */
  floorDisplace?: string;
  floorSegments?: [number, number];
}

/** assemble the bubble shell + floor + props into a RealmBuild */
export function makeRealm(name: string, u: RealmUniforms, spec: RealmSpec, props: THREE.Object3D[]): RealmBuild {
  const group = new THREE.Group();
  group.name = 'realm-' + name;
  const maxR = spec.maxR ?? 150;
  const rim = new THREE.Color(spec.rim), seam = new THREE.Color(spec.seam ?? '#ffffff');
  const shellMat = finish(new THREE.ShaderMaterial({
    uniforms: { ...u, uRim: { value: rim }, uSeam: { value: seam } },
    vertexShader: VERT,
    fragmentShader: /* glsl */`${PARS}
      uniform vec3 uRim; uniform vec3 uSeam;
      ${GLSL_NOISE}
      ${SEAM}
      ${spec.sky}
      void main(){
        if (uClip.w != 0.0 && uClip.w * (dot(vW.xz, uClip.xy) - uClip.z) < 0.0) discard;
        vec3 d = normalize(vW - cameraPosition);
        vec3 col = realmSky(d);
        vec3 n = normalize(vW - uC);
        float e = 1.0 - abs(dot(n, d));
        float small = smoothstep(40.0, 4.0, uR);
        col += uRim * (pow(e, 5.0) * 2.5 + pow(e, 1.5) * 0.25) * small;
        col += uSeam * kseam() * 2.0;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: true,
  }));
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), shellMat);
  shell.frustumCulled = false;
  shell.renderOrder = -5;
  const fs = spec.floorSegments ?? [96, 1];
  const floorGeo = new THREE.RingGeometry(0.0001, 1, fs[0], fs[1]);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = finish(new THREE.ShaderMaterial({
    uniforms: { ...u, uRim: { value: rim }, uSeam: { value: seam } },
    vertexShader: /* glsl */`${PARS}
      ${GLSL_NOISE}
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vec3 p = w.xyz; ${spec.floorDisplace ?? ''} vW = p; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
    fragmentShader: /* glsl */`${PARS}
      uniform vec3 uRim; uniform vec3 uSeam;
      ${GLSL_NOISE}
      ${SEAM}
      ${spec.sky}
      ${spec.ground}
      void main(){
        if (uClip.w != 0.0 && uClip.w * (dot(vW.xz, uClip.xy) - uClip.z) < 0.0) discard;
        vec3 d = normalize(vW - cameraPosition);
        vec3 col = realmGround(vW, d);
        float edge = smoothstep(uR - 0.6, uR, distance(vW.xz, uC.xz)) * smoothstep(40.0, 4.0, uR);
        col += uRim * edge * 2.0;
        col += uSeam * kseam() * 1.5;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }));
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.frustumCulled = false;
  floor.renderOrder = -4;
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ color: '#000008', opacity: spec.shadowOpacity ?? 0.5, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
  shadow.receiveShadow = true;
  shadow.frustumCulled = false;
  shadow.position.y = 0.002;
  group.add(shell, floor, shadow, ...props);
  let age = 0, k = 0;
  const apply = () => {
    const e = k * k * (3 - 2 * k);
    const R = k <= 0 ? 0.001 : 0.6 + (maxR - 0.6) * Math.pow(e, 1.6);
    u.uR.value = R; u.uK.value = k;
    shell.scale.setScalar(R);
    floor.scale.setScalar(R);
    shadow.scale.setScalar(Math.min(R, 30));
    shell.position.copy(u.uC.value);
    floor.position.set(u.uC.value.x, 0.012, u.uC.value.z);
    shadow.position.set(u.uC.value.x, 0.016, u.uC.value.z);
  };
  apply();
  return {
    group,
    bubble: true,
    ...spec.env,
    update(t, dt) {
      u.uTime.value = t;
      age += dt;
      spec.update?.(t, dt, age);
    },
    setDissolve(nk) {
      if (k <= 0 && nk > 0) age = 0;
      k = Math.max(0, Math.min(1, nk));
      apply();
    },
    setCenter(x, z) { u.uC.value.set(x, 0, z); apply(); },
    setClip(nx, nz, d, side) { u.uClip.value.set(nx, nz, d, side); },
    dispose() { disposeGroup(group); },
  };
}

/** instanced camera-facing quads (one draw call): per-instance centre, size, roll, tint; `body` gets vUv / vTint */
export function billboards(u: RealmUniforms, count: number, init: (i: number, c: THREE.Vector3, s: THREE.Vector2, tint: THREE.Color) => number, body: string, opts: { additive?: boolean; map?: THREE.Texture; vertExtra?: string } = {}): THREE.Mesh {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.getAttribute('position'));
  g.setAttribute('uv', base.getAttribute('uv'));
  const iC = new Float32Array(count * 4), iS = new Float32Array(count * 4);
  const c = new THREE.Vector3(), s = new THREE.Vector2(), tint = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const roll = init(i, c, s, tint);
    iC.set([c.x, c.y, c.z, roll], i * 4);
    iS.set([s.x, s.y, tint.getHex() / 16777215, i], i * 4);
  }
  g.setAttribute('iC', new THREE.InstancedBufferAttribute(iC, 4));
  g.setAttribute('iS', new THREE.InstancedBufferAttribute(iS, 4));
  g.instanceCount = count;
  const m = finish(new THREE.ShaderMaterial({
    uniforms: { ...u, uMap: { value: opts.map ?? null } },
    vertexShader: /* glsl */`${PARS}
      attribute vec4 iC; attribute vec4 iS;
      varying vec2 vUv; varying float vTint; varying float vId;
      void main(){
        vUv = uv; vTint = iS.z; vId = iS.w;
        vec3 ctr = iC.xyz; vec2 sz = iS.xy; float roll = iC.w;
        ${opts.vertExtra ?? ''}
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float c = cos(roll), s = sin(roll);
        vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * sz;
        vec3 w = ctr + right * p.x + up * p.y;
        vW = w;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */`${PARS}
      uniform sampler2D uMap;
      varying vec2 vUv; varying float vTint; varying float vId;
      ${GLSL_NOISE}
      vec3 unpackTint(float t){ float v = floor(t * 16777215.0 + 0.5); return vec3(floor(v / 65536.0), mod(floor(v / 256.0), 256.0), mod(v, 256.0)) / 255.0; }
      void main(){
        ${REALM_CLIP}
        vec3 tint = unpackTint(vTint);
        vec3 col = vec3(0.0); float alpha = 1.0;
        ${body}
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
  }));
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return mesh;
}

export function env(o: {
  fog: string; bg: string; sun: string; sunI: number; sky: string; ground: string; hemiI: number; shadow: string; rim: string; dir?: [number, number, number]; near?: number; far?: number;
}): RealmSpec['env'] {
  const d = o.dir ?? [0.3, 0.8, 0.5];
  return {
    fog: new THREE.Fog(o.fog, o.near ?? 40, o.far ?? 160),
    background: new THREE.Color(o.bg),
    sunDir: new THREE.Vector3(d[0], d[1], d[2]).normalize(),
    sunColor: new THREE.Color(o.sun),
    sunIntensity: o.sunI,
    hemiSky: new THREE.Color(o.sky),
    hemiGround: new THREE.Color(o.ground),
    hemiIntensity: o.hemiI,
    shadowTint: new THREE.Color(o.shadow),
    rim: new THREE.Color(o.rim),
  };
}
