/**
 * Character asset library: loads public/characters/<id>/model(.glb|_1024.glb) + awakened atlas (+ Goro plates)
 * once, prepares shared data (smoothed outline normals, drawable katana) and hands out per-view clones
 * (SkeletonUtils.clone shares geometry / textures). Failures are not cached, so a later call retries.
 * Robust to model upgrades: nothing depends on triangle counts, extra bones are ignored, bone names may carry
 * a 'mixamorig' prefix.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharId } from '../../sim/types';

export type ModelRes = 2048 | 1024;

export interface WeaponGeo {
  geo: THREE.BufferGeometry; // already in "socket" space: grip at origin, blade along +Z
  length: number;
  /** second-hand grip (socket space) */
  grip2: THREE.Vector3;
}

export interface CharAsset {
  id: CharId;
  res: ModelRes;
  scene: THREE.Group; // template (never added to a scene)
  awakenTex: THREE.Texture | null;
  plates: THREE.Group | null;
  katana: WeaponGeo | null;
  height: number;
}

function baseUrl(): string {
  const env = (import.meta as unknown as { env?: { DEV?: boolean; BASE_URL?: string } }).env;
  if (env?.DEV) return '/';
  return env?.BASE_URL ?? './';
}

const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const cache = new Map<string, Promise<CharAsset>>();
const done = new Map<string, CharAsset>();

export function normBoneName(n: string): string { return n.replace(/^mixamorig\d*[:_]?/i, ''); }

export function loadCharacter(id: CharId, res: ModelRes): Promise<CharAsset> {
  const key = `${id}:${res}`;
  let p = cache.get(key);
  if (!p) {
    p = loadImpl(id, res).then((a) => { done.set(key, a); return a; });
    p.catch(() => { cache.delete(key); });
    cache.set(key, p);
  }
  return p;
}

export function getLoadedCharacter(id: CharId, res: ModelRes): CharAsset | null {
  return done.get(`${id}:${res}`) ?? null;
}

async function loadTex(url: string): Promise<THREE.Texture | null> {
  try {
    const t = await texLoader.loadAsync(url);
    t.flipY = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  } catch { return null; }
}

/**
 * Load a GLB. Some static hosts (e.g. claude.ai artifact pages) can't serve .glb files, so the
 * artifact packer (tools/pack-artifact.mjs) ships each model as `<name>.glb.json` = {"b64": "..."}.
 * Try the real .glb first, then that fallback.
 */
async function loadGLB(url: string) {
  try {
    return await loader.loadAsync(url);
  } catch (err) {
    const res = await fetch(url + '.json');
    if (!res.ok) throw err;
    const { b64 } = (await res.json()) as { b64: string };
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return loader.parseAsync(buf.buffer, url.slice(0, url.lastIndexOf('/') + 1));
  }
}

async function loadImpl(id: CharId, res: ModelRes): Promise<CharAsset> {
  const dir = `${baseUrl()}characters/${id}/`;
  const sfx = res === 1024 ? '_1024' : '';
  const [gltf, awk, plates] = await Promise.all([
    loadGLB(`${dir}model${sfx}.glb`),
    loadTex(`${dir}tex_awakened${sfx}.png`),
    id === 'goro' ? loadGLB(`${dir}shoulder_plates.glb`).catch(() => null) : Promise.resolve(null),
  ]);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  let katana: WeaponGeo | null = null;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    fixInsideOut(m.geometry);
    ensureOutlineNormals(m.geometry);
    if (!katana && /katana|sword|blade/i.test(m.name + ' ' + (m.parent?.name ?? ''))) katana = buildKatana(m);
  });
  if (plates) plates.scene.traverse((o: THREE.Object3D) => { const m = o as THREE.Mesh; if (m.isMesh) { fixInsideOut(m.geometry); ensureOutlineNormals(m.geometry); } });
  const box = new THREE.Box3().setFromObject(scene);
  // match the embedded map's sampling to the external awakened atlas
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat?.map) { mat.map.anisotropy = 4; mat.map.colorSpace = THREE.SRGBColorSpace; }
  });
  return { id, res, scene, awakenTex: awk, plates: plates ? plates.scene : null, katana, height: Math.max(1, box.max.y) };
}

/** per-view clone (skeleton re-bound, geometry & textures shared) */
export function cloneCharacter(a: CharAsset): THREE.Object3D {
  return skeletonClone(a.scene);
}

export function clonePlates(a: CharAsset): THREE.Object3D | null {
  return a.plates ? skeletonClone(a.plates) : null;
}

/**
 * Some exports are inside-out (winding AND normals flipped, hidden by a double-sided material). The toon pass
 * culls back faces and the outline pass draws back faces, so orientation matters: detect via signed volume
 * and flip in place (once per loaded geometry).
 */
export function fixInsideOut(g: THREE.BufferGeometry): void {
  if (g.userData.kkOriented) return;
  g.userData.kkOriented = true;
  const P = g.getAttribute('position') as THREE.BufferAttribute;
  const idx = g.index;
  const nt = idx ? idx.count / 3 : P.count / 3;
  if (nt < 4) return;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < P.count; i++) { cx += P.getX(i); cy += P.getY(i); cz += P.getZ(i); }
  cx /= P.count; cy /= P.count; cz /= P.count;
  let vol = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < nt; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.set(P.getX(i0) - cx, P.getY(i0) - cy, P.getZ(i0) - cz);
    b.set(P.getX(i1) - cx, P.getY(i1) - cy, P.getZ(i1) - cz);
    c.set(P.getX(i2) - cx, P.getY(i2) - cy, P.getZ(i2) - cz);
    vol += a.dot(n.crossVectors(b, c));
  }
  if (vol >= 0) return;
  if (idx) {
    const arr = idx.array as Uint16Array | Uint32Array;
    for (let t = 0; t < nt; t++) { const k = t * 3; const tmp = arr[k + 1]; arr[k + 1] = arr[k + 2]; arr[k + 2] = tmp; }
    idx.needsUpdate = true;
  } else {
    for (const name of Object.keys(g.attributes)) {
      const at = g.getAttribute(name) as THREE.BufferAttribute;
      const s = at.itemSize, arr = at.array as Float32Array;
      for (let t = 0; t < nt; t++) for (let k = 0; k < s; k++) {
        const i1 = (t * 3 + 1) * s + k, i2 = (t * 3 + 2) * s + k;
        const tmp = arr[i1]; arr[i1] = arr[i2]; arr[i2] = tmp;
      }
      at.needsUpdate = true;
    }
  }
  const N = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (N) { const arr = N.array as Float32Array; for (let i = 0; i < arr.length; i++) arr[i] = -arr[i]; N.needsUpdate = true; }
}

/** Smoothed normal (averaged over coincident vertices) so the inverted hull doesn't crack at hard edges. */
export function ensureOutlineNormals(g: THREE.BufferGeometry): void {
  if (g.getAttribute('onormal')) return;
  const P = g.getAttribute('position') as THREE.BufferAttribute;
  let N = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!N) { g.computeVertexNormals(); N = g.getAttribute('normal') as THREE.BufferAttribute; }
  const n = P.count;
  const acc = new Map<string, number[]>();
  const keys: string[] = new Array(n);
  const q = 1e4;
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(P.getX(i) * q)},${Math.round(P.getY(i) * q)},${Math.round(P.getZ(i) * q)}`;
    keys[i] = k;
    let a = acc.get(k);
    if (!a) { a = [0, 0, 0]; acc.set(k, a); }
    a[0] += N.getX(i); a[1] += N.getY(i); a[2] += N.getZ(i);
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = acc.get(keys[i])!;
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    out[i * 3] = a[0] / l; out[i * 3 + 1] = a[1] / l; out[i * 3 + 2] = a[2] / l;
  }
  g.setAttribute('onormal', new THREE.BufferAttribute(out, 3));
}

/** Static copy of the (sheathed, hip-weighted) katana re-expressed in hand-socket space. */
function buildKatana(mesh: THREE.Mesh): WeaponGeo | null {
  const g = mesh.geometry.clone();
  g.deleteAttribute('skinIndex'); g.deleteAttribute('skinWeight');
  g.deleteAttribute('onormal');
  g.applyMatrix4(mesh.matrixWorld);
  const P = g.getAttribute('position') as THREE.BufferAttribute;
  const n = P.count;
  if (n < 4) return null;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) c.add(v.fromBufferAttribute(P, i));
  c.divideScalar(n);
  // principal axis (power iteration on the covariance)
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(P, i).sub(c);
    xx += v.x * v.x; xy += v.x * v.y; xz += v.x * v.z; yy += v.y * v.y; yz += v.y * v.z; zz += v.z * v.z;
  }
  const ax = new THREE.Vector3(1, 1, 1).normalize();
  for (let it = 0; it < 32; it++) {
    ax.set(xx * ax.x + xy * ax.y + xz * ax.z, xy * ax.x + yy * ax.y + yz * ax.z, xz * ax.x + yz * ax.y + zz * ax.z).normalize();
  }
  let tMin = Infinity, tMax = -Infinity;
  for (let i = 0; i < n; i++) { const t = v.fromBufferAttribute(P, i).sub(c).dot(ax); tMin = Math.min(tMin, t); tMax = Math.max(tMax, t); }
  const L = tMax - tMin;
  // vertices crowd the handle / guard end: the vertex mean (t = 0) lies toward the handle
  const mid = (tMin + tMax) / 2;
  const handleSign = mid < 0 ? 1 : -1; // handle at tMax if mid < 0
  const tHandle = handleSign > 0 ? tMax : tMin;
  const handleEnd = c.clone().addScaledVector(ax, tHandle);
  const bladeDir = ax.clone().multiplyScalar(-handleSign);
  const grip = handleEnd.clone().addScaledVector(bladeDir, 0.14 * L);
  const q = new THREE.Quaternion().setFromUnitVectors(bladeDir, new THREE.Vector3(0, 0, 1));
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  const t = grip.clone().applyQuaternion(q).negate();
  m.setPosition(t);
  g.applyMatrix4(m);
  g.computeBoundingSphere();
  ensureOutlineNormals(g);
  return { geo: g, length: L, grip2: new THREE.Vector3(0, 0, -0.1 * L) };
}

let katanaGeo: THREE.BufferGeometry | null = null;
/**
 * Drawn katana (socket space: right-hand grip at origin, blade along +Z, edge toward -Y). Procedural so the
 * drawn blade reads clearly on camera (bright steel, gold guard); the GLB's own katana stays in the sheath.
 */
export function katanaGeometry(): WeaponGeo {
  if (!katanaGeo) {
    const pos: number[] = [], col: number[] = [];
    const tri = (a: number[], b: number[], c: number[], k: number[]) => { pos.push(...a, ...b, ...c); col.push(...k, ...k, ...k); };
    const quad = (a: number[], b: number[], c: number[], d: number[], k: number[]) => { tri(a, b, c, k); tri(a, c, d, k); };
    // blade: diamond cross-section, slight curve, taper to a kissaki
    const N = 10, z0 = 0.06, len = 0.74;
    const steel = [0.86, 0.9, 0.96], back = [0.55, 0.6, 0.7];
    const ring = (t: number): number[][] => {
      const z = z0 + t * len;
      const curve = 0.045 * t * t;
      const w = t < 0.9 ? 0.034 : 0.034 * (1 - (t - 0.9) / 0.1) + 0.002;
      const th = 0.007;
      return [[0, curve - w * 0.55, z], [th, curve, z], [0, curve + w * 0.45, z], [-th, curve, z]];
    };
    let prev = ring(0);
    for (let i = 1; i <= N; i++) {
      const cur = ring(i / N);
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        quad(prev[k], prev[k2], cur[k2], cur[k], k === 0 || k === 3 ? steel : back);
      }
      prev = cur;
    }
    // tip cap
    tri(prev[0], prev[1], prev[2], steel); tri(prev[0], prev[2], prev[3], steel);
    const add = (g: THREE.BufferGeometry, k: number[]) => {
      const ng = g.index ? g.toNonIndexed() : g;
      const P = ng.getAttribute('position');
      for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); col.push(...k); }
    };
    const guard = new THREE.CylinderGeometry(0.045, 0.045, 0.012, 10); guard.rotateX(Math.PI / 2); guard.translate(0, 0, 0.05);
    add(guard, [0.85, 0.66, 0.25]);
    const handle = new THREE.CylinderGeometry(0.016, 0.018, 0.27, 6); handle.rotateX(Math.PI / 2); handle.translate(0, 0, -0.085);
    add(handle, [0.1, 0.12, 0.2]);
    const cap = new THREE.CylinderGeometry(0.02, 0.02, 0.02, 6); cap.rotateX(Math.PI / 2); cap.translate(0, 0, -0.225);
    add(cap, [0.85, 0.66, 0.25]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    ensureOutlineNormals(g);
    katanaGeo = g;
  }
  return { geo: katanaGeo, length: 1.03, grip2: new THREE.Vector3(0, 0, -0.17) };
}

let kunaiGeo: THREE.BufferGeometry | null = null;
/** small procedural kunai (socket space, blade along +Z) for Shiori's throws */
export function kunaiGeometry(): THREE.BufferGeometry {
  if (kunaiGeo) return kunaiGeo;
  const blade = new THREE.ConeGeometry(0.028, 0.16, 4, 1);
  blade.rotateX(Math.PI / 2); blade.translate(0, 0, 0.12);
  const grip = new THREE.CylinderGeometry(0.011, 0.011, 0.09, 6);
  grip.rotateX(Math.PI / 2); grip.translate(0, 0, 0.0);
  const ring = new THREE.TorusGeometry(0.02, 0.006, 4, 10);
  ring.translate(0, 0, -0.065);
  const parts = [blade, grip, ring].map((x) => x.toNonIndexed());
  const pos: number[] = [], nrm: number[] = [], col: number[] = [];
  const cols = [[0.78, 0.8, 0.86], [0.12, 0.1, 0.16], [0.6, 0.6, 0.66]];
  parts.forEach((p, i) => {
    const P = p.getAttribute('position'), N = p.getAttribute('normal');
    for (let k = 0; k < P.count; k++) { pos.push(P.getX(k), P.getY(k), P.getZ(k)); nrm.push(N.getX(k), N.getY(k), N.getZ(k)); col.push(...cols[i]); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  ensureOutlineNormals(g);
  kunaiGeo = g;
  return g;
}

export function disposeCharacterCache(): void {
  for (const a of done.values()) {
    a.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.map?.dispose(); mat.dispose();
    });
    a.awakenTex?.dispose();
    a.katana?.geo.dispose();
  }
  done.clear();
  cache.clear();
}
