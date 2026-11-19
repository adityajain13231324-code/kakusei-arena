/** Stage-building utilities: static mesh merger, sky dome, canvas helpers. */
import * as THREE from 'three';

export interface StageBuild {
  group: THREE.Group;
  update(t: number, dt: number): void;
  fog: THREE.Fog | null;
  background: THREE.Color;
  sunDir: THREE.Vector3; // direction TO the light
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  shadowTint: THREE.Color; // for fighters
  rim: THREE.Color | null;
  /** crowd reaction hook (0..1), optional */
  cheer?(intensity: number): void;
  /** optional custom dissolve (realm takeover): 0 = hidden … 1 = fully visible */
  setDissolve?(k: number): void;
  dispose(): void;
}

const _v = new THREE.Vector3();
const _c = new THREE.Color();

/** Accumulates static geometry (pos/normal/color/uv) into one indexed BufferGeometry. */
export class Merger {
  pos: number[] = []; nrm: number[] = []; col: number[] = []; uv: number[] = []; idx: number[] = [];
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4 | null, color: THREE.ColorRepresentation | ((p: THREE.Vector3, out: THREE.Color) => void), uvScale = 1): this {
    const P = geo.attributes.position as THREE.BufferAttribute;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const N = geo.attributes.normal as THREE.BufferAttribute;
    const U = geo.attributes.uv as THREE.BufferAttribute | undefined;
    const nm = new THREE.Matrix3();
    if (m) nm.getNormalMatrix(m);
    const base = this.pos.length / 3;
    const fn = typeof color === 'function' ? color : null;
    if (!fn) _c.set(color as THREE.ColorRepresentation);
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i);
      if (m) _v.applyMatrix4(m);
      this.pos.push(_v.x, _v.y, _v.z);
      if (fn) fn(_v, _c);
      this.col.push(_c.r, _c.g, _c.b);
      _v.fromBufferAttribute(N, i);
      if (m) _v.applyMatrix3(nm).normalize();
      this.nrm.push(_v.x, _v.y, _v.z);
      if (U) this.uv.push(U.getX(i) * uvScale, U.getY(i) * uvScale); else this.uv.push(0, 0);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) this.idx.push(base + geo.index.getX(i));
    else for (let i = 0; i < P.count; i++) this.idx.push(base + i);
    return this;
  }
  get tris(): number { return this.idx.length / 3; }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export function M(pos: [number, number, number], rotDeg: [number, number, number] = [0, 0, 0], scale: [number, number, number] | number = 1): THREE.Matrix4 {
  const s = typeof scale === 'number' ? [scale, scale, scale] : scale;
  const D = Math.PI / 180;
  return new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotDeg[0] * D, rotDeg[1] * D, rotDeg[2] * D)), new THREE.Vector3(s[0], s[1], s[2]));
}

/** Gradient sky dome (unlit). stops: [t (0 = horizon, 1 = zenith), colour] */
export function skyDome(stops: Array<[number, string]>, opts: { radius?: number; sunDir?: THREE.Vector3; sunColor?: string; sunSize?: number; glow?: number } = {}): THREE.Mesh {
  const r = opts.radius ?? 180;
  const g = new THREE.SphereGeometry(r, 32, 16);
  const cols = stops.map((s) => new THREE.Color(s[1]));
  const ts = stops.map((s) => s[0]);
  while (cols.length < 5) { cols.push(cols[cols.length - 1].clone()); ts.push(1.01 + cols.length); }
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uC: { value: cols.slice(0, 5) },
      uT: { value: ts.slice(0, 5) },
      uSun: { value: (opts.sunDir ?? new THREE.Vector3(0, -1, 0)).clone().normalize() },
      uSunCol: { value: new THREE.Color(opts.sunColor ?? '#ffffff') },
      uSunSize: { value: opts.sunSize ?? 0.0 },
      uGlow: { value: opts.glow ?? 0.0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uC[5]; uniform float uT[5];
      uniform vec3 uSun; uniform vec3 uSunCol; uniform float uSunSize; uniform float uGlow;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        h = pow(h, 0.6);
        vec3 col = uC[0];
        for (int i = 1; i < 5; i++) {
          float k = clamp((h - uT[i-1]) / max(1e-4, uT[i] - uT[i-1]), 0.0, 1.0);
          col = mix(col, uC[i], k);
        }
        if (vDir.y < 0.0) col = mix(uC[0], uC[0] * 0.5, clamp(-vDir.y * 4.0, 0.0, 1.0));
        float sd = dot(normalize(vDir), uSun);
        col += uSunCol * uGlow * pow(max(sd, 0.0), 12.0);
        col = mix(col, uSunCol, smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.7, sd));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  m.toneMapped = false;
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

export function canvas(w: number, h: number): { cv: HTMLCanvasElement; c: CanvasRenderingContext2D } {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return { cv, c: cv.getContext('2d')! };
}

export function canvasTex(cv: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

export function rand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return (s & 0xffffff) / 0x1000000; };
}

/** Neon sign texture (glowing text). */
export function neonTexture(text: string, color: string, font: string, w = 512, h = 160, vertical = false): THREE.CanvasTexture {
  const { cv, c } = canvas(w, h);
  c.clearRect(0, 0, w, h);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = font;
  const draw = (blur: number, col: string, lw: number, fill: boolean) => {
    c.shadowColor = color; c.shadowBlur = blur;
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = lw;
    if (vertical) {
      const chars = [...text];
      const step = h / (chars.length + 0.5);
      chars.forEach((ch, i) => { if (fill) c.fillText(ch, w / 2, step * (i + 0.75)); else c.strokeText(ch, w / 2, step * (i + 0.75)); });
    } else if (fill) c.fillText(text, w / 2, h / 2); else c.strokeText(text, w / 2, h / 2);
  };
  draw(30, color, 10, false);
  draw(14, color, 6, false);
  draw(4, '#ffffff', 2.5, true);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft radial glow texture for halos / moon glow. */
export function glowTexture(inner: string, outer = 'rgba(0,0,0,0)', size = 128): THREE.CanvasTexture {
  const { cv, c } = canvas(size, size);
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  c.fillStyle = g; c.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (mat) {
      const arr = Array.isArray(mat) ? mat : [mat];
      for (const x of arr) {
        for (const k of Object.keys(x)) {
          const v = (x as unknown as Record<string, unknown>)[k];
          if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
        }
        x.dispose();
      }
    }
  });
}

export function freeze(o: THREE.Object3D): void {
  o.updateMatrixWorld(true);
  o.traverse((x) => { x.matrixAutoUpdate = false; });
}

/**
 * Screen-door fade for geometry close to the camera (walls/fences between camera and fighters).
 * Works on built-in lit materials (uses vViewPosition) — MeshToon / Lambert / Phong / Standard.
 */
export function addNearFade(m: THREE.Material, near = 2.2): void {
  const prev = m.onBeforeCompile;
  const key = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `float kkBayer(vec2 p){ p = mod(floor(p), 4.0); float a = mod(p.x*2.0 + p.y*3.0, 4.0); return (a + mod(p.x + p.y*2.0, 2.0) * 0.5 + 0.25) / 4.5; }
void main() {
  { float kkD = length(vViewPosition); if (kkD < ${near.toFixed(2)}) { if (kkBayer(gl_FragCoord.xy) > (kkD - 0.6) / ${(near - 0.6).toFixed(2)}) discard; } }`);
  };
  m.customProgramCacheKey = () => key + '-nf';
}
