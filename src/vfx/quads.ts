// Pooled decal quads (star bursts, rings, crescents, glows) and comic onomatopoeia sprites.
import * as THREE from 'three';
import { makeDecals, makeOnomato, ONOMATO } from './tex';
import type { DecalTextures } from './tex';

export type DecalKind = 'star' | 'ring' | 'crescent' | 'glow' | 'hex' | 'spiral' | 'shuriken' | 'asura' | 'swirl';
/** 0 billboard (faces camera), 1 flat on ground, 2 faces a given normal */
export type DecalMode = 0 | 1 | 2;

interface Item {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number; life: number; s0: number; s1: number; sy: number; op: number;
  mode: DecalMode; roll: number; spin: number; on: boolean;
}

const Z = new THREE.Vector3(0, 0, 1);
const X = new THREE.Vector3(1, 0, 0);
const tmpN = new THREE.Vector3();

export class DecalFx {
  readonly tex: DecalTextures;
  private items: Item[] = [];
  private next = 0;
  constructor(root: THREE.Object3D, readonly cam: THREE.Camera, count = 40) {
    this.tex = makeDecals();
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.tex.glow, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      mat.toneMapped = false;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 20;
      root.add(mesh);
      this.items.push({ mesh, mat, age: 0, life: 1, s0: 1, s1: 1, sy: 1, op: 1, mode: 0, roll: 0, spin: 0, on: false });
    }
  }
  spawn(kind: DecalKind, x: number, y: number, z: number, s0: number, s1: number, life: number, color: number,
    mode: DecalMode = 0, roll = 0, op = 1, additive = true, nx = 0, ny = 1, nz = 0, sy = 1, spin = 0): void {
    // reuse a dead slot, else steal round-robin
    let it: Item | null = null;
    for (let k = 0; k < this.items.length; k++) {
      const c = this.items[(this.next + k) % this.items.length]!;
      if (!c.on) { it = c; this.next = (this.next + k + 1) % this.items.length; break; }
    }
    if (!it) { it = this.items[this.next]!; this.next = (this.next + 1) % this.items.length; }
    it.on = true; it.age = 0; it.life = life; it.s0 = s0; it.s1 = s1; it.sy = sy; it.op = op;
    it.mode = mode; it.roll = roll; it.spin = spin;
    it.mat.map = this.tex[kind];
    it.mat.color.setHex(color);
    it.mat.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    it.mat.opacity = op;
    it.mesh.position.set(x, y, z);
    it.mesh.visible = true;
    if (mode === 1) {
      it.mesh.quaternion.setFromAxisAngle(X, -Math.PI / 2);
      it.mesh.rotateZ(roll);
    } else if (mode === 2) {
      tmpN.set(nx, ny, nz).normalize();
      it.mesh.quaternion.setFromUnitVectors(Z, tmpN);
      it.mesh.rotateZ(roll);
    }
    it.mesh.scale.set(s0, s0 * sy, 1);
  }
  update(dt: number): void {
    for (const it of this.items) {
      if (!it.on) continue;
      it.age += dt;
      const t = it.age / it.life;
      if (t >= 1) { it.on = false; it.mesh.visible = false; continue; }
      const e = 1 - Math.pow(1 - t, 3);
      const s = it.s0 + (it.s1 - it.s0) * e;
      it.mesh.scale.set(s, s * it.sy, 1);
      it.mat.opacity = it.op * Math.pow(1 - t, 1.4);
      it.roll += it.spin * dt;
      if (it.mode === 0) {
        it.mesh.quaternion.copy(this.cam.quaternion);
        it.mesh.rotateZ(it.roll);
      } else if (it.spin !== 0) {
        it.mesh.rotateZ(it.spin * dt);
      }
    }
  }
  clear(): void {
    for (const it of this.items) { it.on = false; it.mesh.visible = false; }
  }
  dispose(): void {
    for (const it of this.items) it.mat.dispose();
    for (const k of Object.keys(this.tex) as DecalKind[]) this.tex[k as keyof DecalTextures].dispose();
  }
}

interface OSprite { spr: THREE.Sprite; mat: THREE.SpriteMaterial; age: number; life: number; scale: number; roll: number; on: boolean; y0: number; aspect: number }

/** Comic onomatopoeia ("ドン!", "COUNTER!"...) pop sprites. */
export class Onomato {
  private tex = new Map<string, THREE.CanvasTexture>();
  private pool: OSprite[] = [];
  private next = 0;
  constructor(root: THREE.Object3D, count = 8) {
    for (const k of Object.keys(ONOMATO)) this.tex.set(k, makeOnomato(k));
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.tex.get('don')!, transparent: true, depthTest: false, depthWrite: false });
      mat.toneMapped = false;
      const spr = new THREE.Sprite(mat);
      spr.visible = false;
      spr.renderOrder = 100;
      root.add(spr);
      this.pool.push({ spr, mat, age: 0, life: 0.8, scale: 1, roll: 0, on: false, y0: 0, aspect: 200 / 512 });
    }
  }
  spawn(key: string, x: number, y: number, z: number, scale = 1, life = 0.85): void {
    const tex = this.tex.get(key);
    if (!tex) return;
    let it: OSprite | null = null;
    for (let k = 0; k < this.pool.length; k++) {
      const c = this.pool[(this.next + k) % this.pool.length]!;
      if (!c.on) { it = c; break; }
    }
    if (!it) it = this.pool[this.next]!;
    this.next = (this.next + 1) % this.pool.length;
    it.on = true; it.age = 0; it.life = life; it.scale = scale; it.roll = (Math.random() - 0.5) * 0.4; it.y0 = y;
    it.mat.map = tex;
    it.mat.opacity = 1;
    it.mat.rotation = it.roll;
    it.spr.position.set(x, y, z);
    it.spr.visible = true;
    it.spr.scale.set(0.01, 0.01, 1);
  }
  update(dt: number): void {
    for (const it of this.pool) {
      if (!it.on) continue;
      it.age += dt;
      const t = it.age / it.life;
      if (t >= 1) { it.on = false; it.spr.visible = false; continue; }
      let s: number;
      if (t < 0.12) s = 0.2 + (t / 0.12) * 1.1;
      else if (t < 0.26) s = 1.3 - ((t - 0.12) / 0.14) * 0.3;
      else s = 1.0 + (t - 0.26) * 0.12;
      const w = 1.9 * it.scale * s;
      it.spr.scale.set(w, w * it.aspect, 1);
      it.spr.position.y = it.y0 + t * 0.35;
      it.mat.opacity = t < 0.62 ? 1 : Math.max(0, 1 - (t - 0.62) / 0.38);
    }
  }
  clear(): void {
    for (const it of this.pool) { it.on = false; it.spr.visible = false; }
  }
  dispose(): void {
    for (const it of this.pool) it.mat.dispose();
    for (const t of this.tex.values()) t.dispose();
  }
}
