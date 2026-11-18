// Pooled GPU-instanced billboard particle system. Zero allocations per frame.
import * as THREE from 'three';
import { makeAtlas } from './tex';

export const T = { SOFT: 0, SPARK: 1, SMOKE: 2, PETAL: 3, RING: 4, STREAK: 5, FLAME: 6, SHARD: 7 } as const;

const S = 28; // floats per particle
const O_AGE = 8, O_LIFE = 9;

function hexR(c: number): number { return ((c >> 16) & 255) / 255; }
function hexG(c: number): number { return ((c >> 8) & 255) / 255; }
function hexB(c: number): number { return (c & 255) / 255; }

/** Reusable, mutable particle description (chainable setters, no allocation). */
export class PSpec {
  x = 0; y = 0; z = 0; vx = 0; vy = 0; vz = 0;
  drag = 0; grav = 0; life = 1; delay = 0;
  s0 = 0.2; s1 = 0.2; h0 = -1; h1 = -1;
  rot = 0; spin = 0; stretch = 0; tile = 0;
  r0 = 1; g0 = 1; b0 = 1; a0 = 1; r1 = 1; g1 = 1; b1 = 1; a1 = 0;
  fadeIn = 0.06; pe = 1;
  reset(): this {
    this.x = this.y = this.z = this.vx = this.vy = this.vz = 0;
    this.drag = this.grav = 0; this.life = 1; this.delay = 0;
    this.s0 = this.s1 = 0.2; this.h0 = this.h1 = -1;
    this.rot = this.spin = this.stretch = this.tile = 0;
    this.r0 = this.g0 = this.b0 = this.a0 = 1;
    this.r1 = this.g1 = this.b1 = 1; this.a1 = 0;
    this.fadeIn = 0.06; this.pe = 1;
    return this;
  }
  at(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this; }
  v(x: number, y: number, z: number): this { this.vx = x; this.vy = y; this.vz = z; return this; }
  ttl(life: number, delay = 0): this { this.life = life; this.delay = delay; return this; }
  /** width start/end; optional height start/end (for streaks: s = thickness, h = base length) */
  sz(s0: number, s1: number, h0 = -1, h1 = -1): this { this.s0 = s0; this.s1 = s1; this.h0 = h0; this.h1 = h1; return this; }
  ph(drag: number, grav: number): this { this.drag = drag; this.grav = grav; return this; }
  rt(rot: number, spin: number): this { this.rot = rot; this.spin = spin; return this; }
  tx(tile: number, stretch = 0): this { this.tile = tile; this.stretch = stretch; return this; }
  /** colours as 0xRRGGBB; gain >1 = overbright (additive) */
  col(c0: number, c1: number, a0 = 1, a1 = 0, gain = 1): this {
    this.r0 = hexR(c0) * gain; this.g0 = hexG(c0) * gain; this.b0 = hexB(c0) * gain;
    this.r1 = hexR(c1) * gain; this.g1 = hexG(c1) * gain; this.b1 = hexB(c1) * gain;
    this.a0 = a0; this.a1 = a1;
    return this;
  }
}

const VERT = /* glsl */ `
attribute vec4 iA; attribute vec4 iB; attribute vec4 iC; attribute vec4 iCol;
uniform vec2 uAtlas;
varying vec2 vUv; varying vec4 vCol;
void main(){
  vec4 mv = viewMatrix * vec4(iA.xyz, 1.0);
  vec2 sz = iC.xy;
  vec2 off;
  if (iB.w > 0.0) {
    vec2 d = (viewMatrix * vec4(iB.xyz, 0.0)).xy;
    float sp = length(d);
    vec2 dir = sp > 1e-4 ? d / sp : vec2(1.0, 0.0);
    float len = sz.y + length(iB.xyz) * iB.w;
    off = dir * position.x * len + vec2(-dir.y, dir.x) * position.y * sz.x;
  } else {
    float c = cos(iA.w), s = sin(iA.w);
    vec2 p = position.xy * sz;
    off = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  vec2 tc = vec2(mod(iC.z, uAtlas.x), uAtlas.y - 1.0 - floor(iC.z / uAtlas.x));
  vUv = (uv + tc) / uAtlas;
  vCol = iCol;
}`;
const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
varying vec2 vUv; varying vec4 vCol;
void main(){
  vec4 t = texture2D(uMap, vUv);
  float a = clamp(t.a * vCol.a, 0.0, 1.0);
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol.rgb * t.rgb, a);
}`;

class Pool {
  readonly data: Float32Array;
  n = 0;
  limit: number;
  readonly A: Float32Array; readonly B: Float32Array; readonly C: Float32Array; readonly COL: Float32Array;
  readonly attrs: THREE.InstancedBufferAttribute[];
  readonly geo: THREE.InstancedBufferGeometry;
  readonly mesh: THREE.Mesh;
  constructor(readonly cap: number, mat: THREE.ShaderMaterial, order: number) {
    this.limit = cap;
    this.data = new Float32Array(cap * S);
    this.A = new Float32Array(cap * 4); this.B = new Float32Array(cap * 4);
    this.C = new Float32Array(cap * 4); this.COL = new Float32Array(cap * 4);
    const plane = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = plane.index;
    this.geo.setAttribute('position', plane.getAttribute('position'));
    this.geo.setAttribute('uv', plane.getAttribute('uv'));
    const mk = (arr: Float32Array, name: string) => {
      const a = new THREE.InstancedBufferAttribute(arr, 4);
      a.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(name, a);
      return a;
    };
    this.attrs = [mk(this.A, 'iA'), mk(this.B, 'iB'), mk(this.C, 'iC'), mk(this.COL, 'iCol')];
    this.geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
  }
  emit(p: PSpec): void {
    if (this.n >= this.limit) return;
    const d = this.data, o = this.n * S;
    d[o] = p.x; d[o + 1] = p.y; d[o + 2] = p.z;
    d[o + 3] = p.vx; d[o + 4] = p.vy; d[o + 5] = p.vz;
    d[o + 6] = p.drag; d[o + 7] = p.grav;
    d[o + 8] = -p.delay; d[o + 9] = p.life;
    d[o + 10] = p.s0; d[o + 11] = p.s1; d[o + 12] = p.h0; d[o + 13] = p.h1;
    d[o + 14] = p.rot; d[o + 15] = p.spin; d[o + 16] = p.stretch; d[o + 17] = p.tile;
    d[o + 18] = p.r0; d[o + 19] = p.g0; d[o + 20] = p.b0; d[o + 21] = p.a0;
    d[o + 22] = p.r1; d[o + 23] = p.g1; d[o + 24] = p.b1; d[o + 25] = p.a1;
    d[o + 26] = p.fadeIn; d[o + 27] = p.pe;
    this.n++;
  }
  update(dt: number): void {
    const d = this.data, A = this.A, B = this.B, C = this.C, COL = this.COL;
    let i = 0;
    while (i < this.n) {
      const o = i * S;
      d[o + O_AGE]! += dt;
      const age = d[o + O_AGE]!, life = d[o + O_LIFE]!;
      if (age >= life) {
        const last = (this.n - 1) * S;
        if (o !== last) d.copyWithin(o, last, last + S);
        this.n--;
        continue;
      }
      const w = i * 4;
      if (age < 0) {
        C[w] = 0; C[w + 1] = 0; COL[w + 3] = 0;
        i++;
        continue;
      }
      const t = age / life;
      const k = Math.max(0, 1 - d[o + 6]! * dt);
      let vx = d[o + 3]! * k, vy = d[o + 4]! * k - d[o + 7]! * dt, vz = d[o + 5]! * k;
      d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
      const px = (d[o]! += vx * dt), py = (d[o + 1]! += vy * dt), pz = (d[o + 2]! += vz * dt);
      const rot = (d[o + 14]! += d[o + 15]! * dt);
      const sx = d[o + 10]! + (d[o + 11]! - d[o + 10]!) * t;
      const h0 = d[o + 12]!;
      const sy = h0 < 0 ? sx : h0 + (d[o + 13]! - h0) * t;
      const pe = d[o + 27]!;
      const tt = pe === 1 ? t : Math.pow(t, pe);
      let a = d[o + 21]! + (d[o + 25]! - d[o + 21]!) * tt;
      const fi = d[o + 26]!;
      if (t < fi) a *= t / fi;
      A[w] = px; A[w + 1] = py; A[w + 2] = pz; A[w + 3] = rot;
      B[w] = vx; B[w + 1] = vy; B[w + 2] = vz; B[w + 3] = d[o + 16]!;
      C[w] = sx; C[w + 1] = sy; C[w + 2] = d[o + 17]!; C[w + 3] = 0;
      COL[w] = d[o + 18]! + (d[o + 22]! - d[o + 18]!) * t;
      COL[w + 1] = d[o + 19]! + (d[o + 23]! - d[o + 19]!) * t;
      COL[w + 2] = d[o + 20]! + (d[o + 24]! - d[o + 20]!) * t;
      COL[w + 3] = a;
      i++;
    }
    this.geo.instanceCount = this.n;
    for (const a of this.attrs) a.needsUpdate = true;
  }
  clear(): void {
    this.n = 0;
    this.geo.instanceCount = 0;
  }
}

export class ParticleSystem {
  readonly spec = new PSpec();
  readonly group = new THREE.Group();
  private readonly add: Pool;
  private readonly norm: Pool;
  private readonly atlas: THREE.CanvasTexture;
  /** quality multiplier applied to particle counts by effects */
  countScale = 1;

  constructor() {
    this.atlas = makeAtlas();
    const mk = (blending: THREE.Blending) =>
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: this.atlas }, uAtlas: { value: new THREE.Vector2(4, 2) } },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending,
      });
    this.norm = new Pool(480, mk(THREE.NormalBlending), 10);
    this.add = new Pool(1020, mk(THREE.AdditiveBlending), 11);
    this.group.add(this.norm.mesh, this.add.mesh);
    this.setMax(1500);
  }
  setMax(total: number): void {
    this.add.limit = Math.min(this.add.cap, Math.floor(total * 0.68));
    this.norm.limit = Math.min(this.norm.cap, Math.floor(total * 0.32));
  }
  get live(): number { return this.add.n + this.norm.n; }
  /** emit the current spec; additive=true for glowing stuff, false for smoke/rocks/petals */
  emit(additive: boolean): void {
    (additive ? this.add : this.norm).emit(this.spec);
  }
  update(dt: number): void {
    this.norm.update(dt);
    this.add.update(dt);
  }
  clear(): void {
    this.norm.clear();
    this.add.clear();
  }
  dispose(): void {
    this.norm.geo.dispose(); this.add.geo.dispose();
    (this.norm.mesh.material as THREE.Material).dispose();
    (this.add.mesh.material as THREE.Material).dispose();
    this.atlas.dispose();
  }
}

// ---- tiny random helpers (module-level temps to avoid allocation) ----
export const rr = (a: number, b: number): number => a + Math.random() * (b - a);
export let dx = 0, dy = 0, dz = 0;
/** random unit vector into dx,dy,dz */
export function randDir(): void {
  const u = Math.random() * 2 - 1, a = Math.random() * 6.2832, s = Math.sqrt(1 - u * u);
  dx = s * Math.cos(a); dy = u; dz = s * Math.sin(a);
}
