// Flipbook sprite path: owner-supplied 8x8 sprite sheets (public/vfx/<name>_8x8.webp, 128 px frames on black) drawn as
// instanced camera-facing quads with additive blending. The frame index is derived in the vertex shader from a per-instance
// 0..1 progress value, so nothing is allocated per frame (typed arrays, swap-remove pool). One draw call per sheet, and only
// while that sheet has live sprites. If a sheet fails to load, spawn() is a no-op and the procedural effects carry on.
import * as THREE from 'three';

export type FlipKind = 'fire' | 'lightning' | 'dust' | 'slash' | 'orb';

const FILE: Record<FlipKind, string> = {
  fire: 'fire_burst', lightning: 'lightning_crackle', dust: 'dust_puff', slash: 'slash_arc', orb: 'energy_orb',
};
/** number of meaningful frames in each sheet (the tail frames are empty) */
const FRAMES: Record<FlipKind, number> = { fire: 56, lightning: 60, dust: 60, slash: 54, orb: 60 };

function assetBase(): string {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  return env?.BASE_URL ?? './';
}

const VERT = /* glsl */ `
attribute vec4 iA; attribute vec4 iB; attribute vec4 iC;
uniform float uFrames;
varying vec2 vUv; varying vec4 vCol;
void main(){
  vec4 mv = viewMatrix * vec4(iA.xyz, 1.0);
  float c = cos(iA.w), s = sin(iA.w);
  vec2 p = position.xy * iB.x;
  mv.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  gl_Position = projectionMatrix * mv;
  float f = min(floor(iB.y * uFrames), uFrames - 1.0);
  vec2 tc = vec2(mod(f, 8.0), 7.0 - floor(f / 8.0));
  vUv = (uv + tc) / 8.0;
  vCol = vec4(iC.rgb, iB.z);
}`;
const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
varying vec2 vUv; varying vec4 vCol;
void main(){
  vec3 t = texture2D(uMap, vUv).rgb;
  gl_FragColor = vec4(t * vCol.rgb, vCol.a);
}`;

class FlipPool {
  n = 0;
  limit: number;
  ready = false;
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly A: Float32Array; private readonly B: Float32Array; private readonly C: Float32Array;
  private readonly attrs: THREE.InstancedBufferAttribute[];
  private readonly age: Float32Array; private readonly life: Float32Array; private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  constructor(kind: FlipKind, readonly cap: number) {
    this.limit = cap;
    this.A = new Float32Array(cap * 4); this.B = new Float32Array(cap * 4); this.C = new Float32Array(cap * 4);
    this.age = new Float32Array(cap); this.life = new Float32Array(cap); this.size = new Float32Array(cap); this.alpha = new Float32Array(cap);
    const plane = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = plane.index;
    this.geo.setAttribute('position', plane.getAttribute('position'));
    this.geo.setAttribute('uv', plane.getAttribute('uv'));
    const mk = (arr: Float32Array, name: string): THREE.InstancedBufferAttribute => {
      const a = new THREE.InstancedBufferAttribute(arr, 4);
      a.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(name, a);
      return a;
    };
    this.attrs = [mk(this.A, 'iA'), mk(this.B, 'iB'), mk(this.C, 'iC')];
    this.geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: null }, uFrames: { value: FRAMES[kind] } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.visible = false;
    new THREE.TextureLoader().load(`${assetBase()}vfx/${FILE[kind]}_8x8.webp`, (t) => {
      t.colorSpace = THREE.NoColorSpace;
      t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
      this.mat.uniforms.uMap!.value = t;
      this.ready = true;
    }, undefined, () => { /* procedural effects remain the fallback */ });
  }
  spawn(x: number, y: number, z: number, size: number, life: number, rot: number, r: number, g: number, b: number, alpha: number): void {
    if (!this.ready || this.n >= this.limit) return;
    const i = this.n++;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size; this.alpha[i] = alpha;
    const w = i * 4;
    this.A[w] = x; this.A[w + 1] = y; this.A[w + 2] = z; this.A[w + 3] = rot;
    this.C[w] = r; this.C[w + 1] = g; this.C[w + 2] = b; this.C[w + 3] = 1;
    this.B[w] = size; this.B[w + 1] = 0; this.B[w + 2] = alpha; this.B[w + 3] = 0;
  }
  update(dt: number): void {
    let i = 0;
    while (i < this.n) {
      this.age[i]! += dt;
      const t = this.age[i]! / this.life[i]!;
      if (t >= 1) {
        const l = this.n - 1;
        if (i !== l) {
          this.age[i] = this.age[l]!; this.life[i] = this.life[l]!; this.size[i] = this.size[l]!; this.alpha[i] = this.alpha[l]!;
          const a = i * 4, b = l * 4;
          for (let k = 0; k < 4; k++) { this.A[a + k] = this.A[b + k]!; this.B[a + k] = this.B[b + k]!; this.C[a + k] = this.C[b + k]!; }
        }
        this.n--;
        continue;
      }
      const w = i * 4;
      this.B[w] = this.size[i]!;
      this.B[w + 1] = t;
      this.B[w + 2] = this.alpha[i]! * (t > 0.8 ? (1 - t) / 0.2 : 1);
      i++;
    }
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n > 0) for (const a of this.attrs) a.needsUpdate = true;
  }
  clear(): void { this.n = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
  dispose(): void {
    this.geo.dispose();
    (this.mat.uniforms.uMap!.value as THREE.Texture | null)?.dispose();
    this.mat.dispose();
  }
}

export class FlipbookFx {
  readonly group = new THREE.Group();
  private readonly pools: Record<FlipKind, FlipPool>;
  private readonly kinds: FlipKind[] = ['fire', 'lightning', 'dust', 'slash', 'orb'];
  constructor() {
    this.pools = { fire: new FlipPool('fire', 16), lightning: new FlipPool('lightning', 16), dust: new FlipPool('dust', 16), slash: new FlipPool('slash', 16), orb: new FlipPool('orb', 16) };
    for (const k of this.kinds) this.group.add(this.pools[k].mesh);
  }
  /** particle quality: low = a few sprites, medium = some, high = all */
  setQuality(q: 'low' | 'medium' | 'high'): void {
    const lim = q === 'low' ? 3 : q === 'medium' ? 8 : 16;
    for (const k of this.kinds) this.pools[k].limit = Math.min(this.pools[k].cap, lim);
  }
  /** size in metres (quad edge), life in seconds; tint is 0xRRGGBB multiplied with the sheet (white = as painted) */
  spawn(kind: FlipKind, x: number, y: number, z: number, size: number, life: number, tint = 0xffffff, rot = 0, alpha = 1, gain = 1): void {
    this.pools[kind].spawn(x, y, z, size, life, rot,
      ((tint >> 16) & 255) / 255 * gain, ((tint >> 8) & 255) / 255 * gain, (tint & 255) / 255 * gain, alpha);
  }
  update(dt: number): void { for (const k of this.kinds) this.pools[k].update(dt); }
  clear(): void { for (const k of this.kinds) this.pools[k].clear(); }
  dispose(): void { for (const k of this.kinds) this.pools[k].dispose(); }
}
