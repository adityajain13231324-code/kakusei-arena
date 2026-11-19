/**
 * Shared "tournament" dressing for stages: instanced crowd (one draw call, GPU-animated idle bob + cheer),
 * waving nobori banners with original text (one draw call), paper lantern strings (instanced, unlit) and
 * vendor-stall helpers. All allocation happens at build time; update() only writes uniforms.
 */
import * as THREE from 'three';
import { toonGradient } from '../materials';
import { canvas, rand, stageTuning } from './common';

// ------------------------------------------------------------------ crowd
export interface CrowdSpot { x: number; y: number; z: number; yaw: number }

/** Spots on tiered rows along the 4 sides of a square ring (inner half-size `inner`), facing the centre. */
export function ringSpots(inner: number, rows: number, opts: { spacing?: number; rowDepth?: number; tier?: number; y0?: number; sides?: Array<'n' | 's' | 'e' | 'w'>; jitter?: number; seed?: number; skip?: (x: number, z: number) => boolean } = {}): CrowdSpot[] {
  if (stageTuning.crowd <= 0) return [];
  const sp = (opts.spacing ?? 0.62) / Math.max(0.3, stageTuning.crowd), rd = opts.rowDepth ?? 0.8, tier = opts.tier ?? 0.35, y0 = opts.y0 ?? 0;
  const sides = opts.sides ?? ['n', 'e', 'w'];
  const rnd = rand(opts.seed ?? 7);
  const j = opts.jitter ?? 0.12;
  const out: CrowdSpot[] = [];
  for (let r = 0; r < rows; r++) {
    const d = inner + r * rd;
    const n = Math.floor((d * 2) / sp);
    for (const s of sides) {
      for (let i = 0; i <= n; i++) {
        const t = -d + (i + (r % 2) * 0.5) * sp;
        if (t > d) continue;
        let x = 0, z = 0;
        if (s === 'n') { x = t; z = -d; } else if (s === 's') { x = t; z = d; } else if (s === 'e') { x = d; z = t; } else { x = -d; z = t; }
        x += (rnd() - 0.5) * j; z += (rnd() - 0.5) * j;
        if (opts.skip && opts.skip(x, z)) continue;
        if (rnd() < 0.07) continue; // gaps read more natural
        out.push({ x, y: y0 + r * tier, z, yaw: Math.atan2(-x, -z) + (rnd() - 0.5) * 0.5 });
      }
    }
  }
  return out;
}

function spectatorGeometry(): THREE.BufferGeometry {
  const parts: Array<[THREE.BufferGeometry, number]> = [];
  const body = new THREE.CapsuleGeometry(0.2, 0.55, 2, 7); body.scale(1, 1, 0.75); body.translate(0, 0.78, 0);
  parts.push([body, 0]);
  const legs = new THREE.CylinderGeometry(0.17, 0.13, 0.5, 6); legs.translate(0, 0.27, 0);
  parts.push([legs, 4]);
  const head = new THREE.IcosahedronGeometry(0.15, 1); head.translate(0, 1.36, 0.0);
  parts.push([head, 1]);
  const hair = new THREE.IcosahedronGeometry(0.158, 1); hair.scale(1, 0.75, 1); hair.translate(0, 1.42, -0.02);
  parts.push([hair, 2]);
  for (const s of [-1, 1]) {
    const arm = new THREE.CapsuleGeometry(0.055, 0.42, 1, 5); arm.translate(s * 0.25, 1.22 - 0.27, 0.02);
    parts.push([arm, 3]);
  }
  const pos: number[] = [], nrm: number[] = [], part: number[] = [];
  for (const [g0, id] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const P = g.getAttribute('position'), N = g.getAttribute('normal');
    for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nrm.push(N.getX(i), N.getY(i), N.getZ(i)); part.push(id); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  return g;
}

const SHIRTS = ['#e8413c', '#f2c14e', '#3d7be8', '#ffffff', '#2fb67a', '#ff7aa8', '#7a55e0', '#ff8a2a', '#22262e', '#55d0ff', '#c9333e', '#f4f1ea'];
const HAIRS = ['#16131a', '#2a1c14', '#5a3a22', '#c8a060', '#1d2440', '#a8322a', '#ece6dc'];
const SKINS = ['#f6d2b4', '#e8b48e', '#c88e66', '#8e5e40', '#f3dcc8'];

export class Crowd {
  readonly mesh: THREE.InstancedMesh;
  private u = { uTime: { value: 0 }, uCheer: { value: 0 } };
  private cheerV = 0;

  constructor(spots: CrowdSpot[], shadowTint = '#6a5aa8', seed = 11) {
    const g = spectatorGeometry();
    const n = spots.length;
    const rnd = rand(seed);
    const shirt = new Float32Array(n * 3), hair = new Float32Array(n * 3), skin = new Float32Array(n * 3), phase = new Float32Array(n);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      c.set(SHIRTS[Math.floor(rnd() * SHIRTS.length)]).toArray(shirt, i * 3);
      c.set(HAIRS[Math.floor(rnd() * HAIRS.length)]).toArray(hair, i * 3);
      c.set(SKINS[Math.floor(rnd() * SKINS.length)]).toArray(skin, i * 3);
      phase[i] = rnd();
    }
    g.setAttribute('aShirt', new THREE.InstancedBufferAttribute(shirt, 3));
    g.setAttribute('aHair', new THREE.InstancedBufferAttribute(hair, 3));
    g.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skin, 3));
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient() });
    const u = this.u;
    const tint = new THREE.Color(shadowTint);
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u, { uTint: { value: tint } });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute float aPart; attribute vec3 aShirt; attribute vec3 aHair; attribute vec3 aSkin; attribute float aPhase;
uniform float uTime; uniform float uCheer;
varying vec3 vCrowd;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float ph = aPhase * 6.2831;
  float me = clamp( uCheer * 1.5 - aPhase * 0.5, 0.0, 1.0 );
  float bob = sin( uTime * ( 1.6 + aPhase ) + ph ) * 0.015 + me * abs( sin( uTime * ( 8.0 + aPhase * 3.0 ) + ph ) ) * 0.16;
  if ( aPart > 2.5 && aPart < 3.5 ) {
    float side = sign( position.x );
    float a = mix( 0.12, 2.75, me ) + sin( uTime * 11.0 + ph ) * 0.35 * me;
    vec2 pv = vec2( side * 0.25, 1.22 );
    vec2 d = transformed.xy - pv;
    float ca = cos( a * side ), sa = sin( a * side );
    transformed.xy = pv + vec2( ca * d.x - sa * d.y, sa * d.x + ca * d.y );
  }
  if ( aPart < 3.5 ) transformed.y += bob;
  vCrowd = aPart < 0.5 ? aShirt : ( aPart < 1.5 ? aSkin : ( aPart < 2.5 ? aHair : ( aPart < 3.5 ? aSkin : aShirt * 0.35 ) ) );
}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vCrowd;
uniform vec3 uTint;`)
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse * vCrowd, opacity );')
        .replace('#include <gradientmap_pars_fragment>', `
uniform sampler2D gradientMap;
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
  float dotNL = dot( normal, lightDirection );
  float g = texture2D( gradientMap, vec2( dotNL * 0.5 + 0.5, 0.0 ) ).r;
  return mix( uTint, vec3( 1.0 ), g );
}`);
    };
    mat.customProgramCacheKey = () => 'kk-crowd';
    this.mesh = new THREE.InstancedMesh(g, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const sp = spots[i];
      const sc = 0.92 + rnd() * 0.18;
      m.compose(p.set(sp.x, sp.y, sp.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), sp.yaw), s.set(sc, sc, sc));
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  get tris(): number { return (this.mesh.geometry.getAttribute('position').count / 3) * this.mesh.count; }

  cheer(intensity: number): void { this.cheerV = Math.max(this.cheerV, Math.min(1, intensity) * 1.4); }

  update(t: number, dt: number): void {
    this.u.uTime.value = t;
    this.cheerV = Math.max(0, this.cheerV - dt * 0.45);
    this.u.uCheer.value = Math.min(1, 0.06 + this.cheerV);
  }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

// ------------------------------------------------------------------ banners
export interface BannerSpec { text: string; bg: string; fg: string; edge?: string }

export const DEFAULT_BANNERS: BannerSpec[] = [
  { text: '覚醒', bg: '#c8202a', fg: '#ffffff', edge: '#ffd24a' },
  { text: 'KAKUSEI', bg: '#141018', fg: '#ffd24a', edge: '#c8202a' },
  { text: 'FIGHT!', bg: '#ffd24a', fg: '#141018', edge: '#c8202a' },
  { text: 'GO KAITO!', bg: '#ff6a1a', fg: '#ffffff', edge: '#141018' },
  { text: '影 SHIORI', bg: '#3a2366', fg: '#e9dcff', edge: '#a066ff' },
  { text: '月 REN', bg: '#f4f1ea', fg: '#1f2b4d', edge: '#4aa8e0' },
  { text: '岩 GORO', bg: '#7a5232', fg: '#ffe0b0', edge: '#ffb347' },
  { text: '必勝', bg: '#ffffff', fg: '#c8202a', edge: '#c8202a' },
];

/** 4x2 atlas of vertical banner faces (256 x 512 each). */
export function bannerAtlas(specs: BannerSpec[] = DEFAULT_BANNERS): THREE.CanvasTexture {
  const { cv, c } = canvas(1024, 1024);
  specs.slice(0, 8).forEach((s, i) => {
    const x = (i % 4) * 256, y = Math.floor(i / 4) * 512;
    c.fillStyle = s.bg; c.fillRect(x, y, 256, 512);
    c.fillStyle = s.edge ?? s.fg; c.fillRect(x, y, 256, 26); c.fillRect(x, y + 486, 256, 26);
    c.fillRect(x + 228, y, 28, 512);
    c.fillStyle = s.fg; c.textAlign = 'center'; c.textBaseline = 'middle';
    const chars = [...s.text.replace(/ /g, '')];
    const step = Math.min(110, 420 / chars.length);
    c.font = `900 ${Math.floor(step * 0.92)}px "Noto Sans JP", "Hiragino Sans", "Yu Gothic", Impact, sans-serif`;
    chars.forEach((ch, k) => c.fillText(ch, x + 114, y + 256 + (k - (chars.length - 1) / 2) * step));
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export interface BannerPlace { x: number; z: number; yaw: number; cell: number; h?: number; w?: number }

/** Nobori banners (cloth + pole), two draw calls total, cloth waves in the vertex shader. */
export class Banners {
  readonly group = new THREE.Group();
  private u = { uTime: { value: 0 } };
  private tex: THREE.CanvasTexture;
  constructor(places: BannerPlace[], specs?: BannerSpec[], fog = true) {
    this.tex = bannerAtlas(specs);
    const pos: number[] = [], uv: number[] = [], wave: number[] = [], idx: number[] = [];
    const ppos: number[] = [], pidx: number[] = [];
    const SX = 5, SY = 8;
    const v = new THREE.Vector3();
    places.forEach((pl, bi) => {
      const w = pl.w ?? 0.62, h = pl.h ?? 2.1, top = h + 0.75;
      const ca = Math.cos(pl.yaw), sa = Math.sin(pl.yaw);
      const cu = (pl.cell % 4) / 4, cv0 = Math.floor(pl.cell / 4) / 2;
      const base = pos.length / 3;
      for (let j = 0; j <= SY; j++) for (let i = 0; i <= SX; i++) {
        const lx = (i / SX) * w, ly = top - (j / SY) * h;
        v.set(lx * ca, ly, -lx * sa);
        pos.push(pl.x + v.x, v.y, pl.z + v.z);
        uv.push(cu + (1 - i / SX) * 0.25 * 0.0 + (i / SX) * 0.25, 1 - (cv0 + (j / SY) * 0.5));
        wave.push(i / SX, bi * 1.7, j / SY);
      }
      for (let j = 0; j < SY; j++) for (let i = 0; i < SX; i++) {
        const a = base + j * (SX + 1) + i, b = a + 1, c = a + SX + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      // pole (box) + top bar
      const pb = ppos.length / 3;
      const r = 0.03;
      const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
        const b0 = ppos.length / 3;
        const corners = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
        for (const cc of corners) ppos.push(cc[0], cc[1], cc[2]);
        const f = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
        for (const q of f) pidx.push(b0 + q[0], b0 + q[1], b0 + q[2], b0 + q[0], b0 + q[2], b0 + q[3]);
      };
      box(pl.x - r, 0, pl.z - r, pl.x + r, top + 0.1, pl.z + r);
      const ex = pl.x + w * ca, ez = pl.z - w * sa;
      box(Math.min(pl.x, ex) - 0.015, top - 0.015, Math.min(pl.z, ez) - 0.015, Math.max(pl.x, ex) + 0.015, top + 0.015, Math.max(pl.z, ez) + 0.015);
      void pb;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aWave', new THREE.Float32BufferAttribute(wave, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = new THREE.MeshToonMaterial({ map: this.tex, side: THREE.DoubleSide, gradientMap: toonGradient(), fog });
    const u = this.u;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aWave;\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float k = aWave.x;
  float w = sin( uTime * 3.1 + aWave.y + aWave.x * 3.5 + aWave.z * 1.3 ) * 0.09 + sin( uTime * 5.3 + aWave.y * 2.0 + aWave.x * 6.0 ) * 0.03;
  transformed += objectNormal * w * k;
  transformed.y -= k * k * 0.03;
}`);
    };
    mat.customProgramCacheKey = () => 'kk-banner';
    const cloth = new THREE.Mesh(g, mat);
    cloth.frustumCulled = false;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(ppos, 3));
    pg.setIndex(pidx);
    const pgn = pg.toNonIndexed(); pgn.computeVertexNormals();
    const poles = new THREE.Mesh(pgn, new THREE.MeshToonMaterial({ color: '#2a2024', gradientMap: toonGradient(), fog }));
    this.group.add(cloth, poles);
  }
  update(t: number): void { this.u.uTime.value = t; }
}

// ------------------------------------------------------------------ paper lanterns
/** Strings of glowing chōchin between pairs of points (catenary sag), instanced + one line draw. */
export class LanternStrings {
  readonly group = new THREE.Group();
  private mat: THREE.MeshBasicMaterial;
  private base: THREE.Color[] = [];
  private mesh: THREE.InstancedMesh;
  constructor(lines: Array<{ a: [number, number, number]; b: [number, number, number]; n: number; sag?: number }>, colors = ['#ff4a3a', '#ffe0a0', '#ff8a3a']) {
    const lg = new THREE.SphereGeometry(0.16, 8, 6); lg.scale(1, 1.25, 1);
    // dark caps via vertex colours
    const P = lg.getAttribute('position');
    const col = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      const y = P.getY(i) / 0.2;
      const k = Math.abs(y) > 0.85 ? 0.15 : 1 - Math.abs(y) * 0.25;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
    }
    lg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    let total = 0;
    for (const l of lines) total += l.n;
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false });
    this.mesh = new THREE.InstancedMesh(lg, this.mat, total);
    const seg: number[] = [];
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    let k = 0;
    for (const l of lines) {
      const sag = l.sag ?? 0.6;
      const pts: THREE.Vector3[] = [];
      const S = 16;
      for (let i = 0; i <= S; i++) {
        const t = i / S;
        pts.push(new THREE.Vector3(l.a[0] + (l.b[0] - l.a[0]) * t, l.a[1] + (l.b[1] - l.a[1]) * t - Math.sin(t * Math.PI) * sag, l.a[2] + (l.b[2] - l.a[2]) * t));
      }
      for (let i = 0; i < S; i++) seg.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
      for (let i = 0; i < l.n; i++) {
        const t = (i + 0.5) / l.n;
        const x = l.a[0] + (l.b[0] - l.a[0]) * t, y = l.a[1] + (l.b[1] - l.a[1]) * t - Math.sin(t * Math.PI) * sag - 0.22, z = l.a[2] + (l.b[2] - l.a[2]) * t;
        m.makeTranslation(x, y, z);
        this.mesh.setMatrixAt(k, m);
        c.set(colors[k % colors.length]).multiplyScalar(1.6);
        this.base.push(c.clone());
        this.mesh.setColorAt(k, c);
        k++;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.frustumCulled = false;
    const lineG = new THREE.BufferGeometry();
    lineG.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    const lines3 = new THREE.LineSegments(lineG, new THREE.LineBasicMaterial({ color: '#141018' }));
    lines3.frustumCulled = false;
    this.group.add(this.mesh, lines3);
  }
  private tmp = new THREE.Color();
  update(t: number): void {
    if (!this.mesh.instanceColor) return;
    // gentle flicker on a few lanterns per frame (no allocation)
    const n = this.base.length;
    for (let i = (Math.floor(t * 30) % 7); i < n; i += 7) {
      const f = 0.85 + 0.15 * Math.sin(t * 9 + i * 1.7);
      this.mesh.setColorAt(i, this.tmp.copy(this.base[i]).multiplyScalar(f));
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
}
