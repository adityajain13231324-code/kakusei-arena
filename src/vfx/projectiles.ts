// Projectile visuals, beam clash and continuous auras (state-driven each frame).
import * as THREE from 'three';
import type { Element, GameState, ProjectileState } from '../sim/types';
import { T, rr, randDir } from './particles';
import * as PR from './particles';
import { auraColor, elemCol } from './effects';
import type { Effects, FxCtx } from './effects';
import type { DecalTextures } from './tex';
import { formAura } from './xover';

export type ChestFn = (p: 0 | 1, out: THREE.Vector3) => void;

const Y = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 18, 1, true);
const sphGeo = new THREE.SphereGeometry(1, 16, 12);

function addMat(map: THREE.Texture | null, color = 0xffffff, opacity = 1): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  m.toneMapped = false;
  return m;
}
function spriteMat(map: THREE.Texture, color: number, opacity = 1): THREE.SpriteMaterial {
  const m = new THREE.SpriteMaterial({ map, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  m.toneMapped = false;
  return m;
}
/** view-angle rim shader: core colour in the middle, rim colour at the silhouette (additive or normal blend) */
export function fresnelMat(core: number, rim: number, additive: boolean, power = 2.2, opacity = 1): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: { uCore: { value: new THREE.Color(core) }, uRim: { value: new THREE.Color(rim) }, uPow: { value: power }, uOp: { value: opacity }, uTime: { value: 0 } },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; vP = position; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`uniform vec3 uCore; uniform vec3 uRim; uniform float uPow; uniform float uOp; uniform float uTime;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPow);
        float n = 0.85 + 0.15 * sin(vP.x * 9.0 + uTime * 7.0) * sin(vP.y * 8.0 - uTime * 5.0);
        gl_FragColor = vec4(mix(uCore, uRim, f) * n, clamp(uOp * (0.55 + f), 0.0, 1.0));
      }`,
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  m.toneMapped = false;
  return m;
}

function cloneTex(t: THREE.Texture): THREE.Texture {
  const c = t.clone();
  c.needsUpdate = true;
  return c;
}

/** Glowing beam cylinder (core + striped glow + halo + end flares). */
class BeamVis {
  readonly root = new THREE.Group();
  readonly flares = new THREE.Group();
  private core: THREE.Mesh; private glow: THREE.Mesh; private halo: THREE.Mesh;
  private tip: THREE.Sprite; private base: THREE.Sprite;
  private map: THREE.Texture;
  constructor(tex: DecalTextures) {
    this.map = cloneTex(tex.aura);
    this.core = new THREE.Mesh(cylGeo, addMat(null, 0xffffff, 1));
    this.glow = new THREE.Mesh(cylGeo, addMat(this.map, 0xffffff, 0.95));
    this.halo = new THREE.Mesh(cylGeo, addMat(tex.glow, 0xffffff, 0.28));
    for (const m of [this.halo, this.glow, this.core]) { m.frustumCulled = false; m.renderOrder = 15; this.root.add(m); }
    this.tip = new THREE.Sprite(spriteMat(tex.glow, 0xffffff, 1));
    this.base = new THREE.Sprite(spriteMat(tex.glow, 0xffffff, 1));
    this.tip.renderOrder = 16; this.base.renderOrder = 16;
    this.flares.add(this.tip, this.base);
    this.root.visible = false; this.flares.visible = false;
  }
  addTo(parent: THREE.Object3D): void { parent.add(this.root, this.flares); }
  show(on: boolean): void { this.root.visible = on; this.flares.visible = on; }
  set(f: THREE.Vector3, t: THREE.Vector3, radius: number, color: number, time: number, alpha = 1): void {
    v1.copy(t).sub(f);
    const len = Math.max(0.05, v1.length());
    v1.multiplyScalar(1 / len);
    this.root.position.copy(f).addScaledVector(v1, len * 0.5);
    this.root.quaternion.setFromUnitVectors(Y, v1);
    this.root.scale.set(1, len, 1);
    const pulse = 1 + Math.sin(time * 40) * 0.08 + Math.sin(time * 23) * 0.05;
    const r = radius * pulse;
    this.core.scale.set(r * 0.38, 1, r * 0.38);
    this.glow.scale.set(r * 0.85, 1, r * 0.85);
    this.halo.scale.set(r * 1.5, 1, r * 1.5);
    (this.core.material as THREE.MeshBasicMaterial).opacity = alpha;
    const gm = this.glow.material as THREE.MeshBasicMaterial;
    gm.color.setHex(color); gm.opacity = 0.95 * alpha;
    const hm = this.halo.material as THREE.MeshBasicMaterial;
    hm.color.setHex(color); hm.opacity = 0.28 * alpha;
    this.map.repeat.set(2, Math.max(1, len / 1.4));
    this.map.offset.y = -time * 3.2;
    this.tip.position.copy(t); this.base.position.copy(f);
    const ts = r * 3.4;
    this.tip.scale.set(ts, ts, 1); this.base.scale.set(r * 2.6, r * 2.6, 1);
    (this.tip.material as THREE.SpriteMaterial).color.setHex(color);
    (this.base.material as THREE.SpriteMaterial).color.setHex(color);
    (this.tip.material as THREE.SpriteMaterial).opacity = alpha;
    (this.base.material as THREE.SpriteMaterial).opacity = alpha;
  }
  dispose(): void {
    this.map.dispose();
    for (const m of [this.core, this.glow, this.halo]) (m.material as THREE.Material).dispose();
    (this.tip.material as THREE.Material).dispose(); (this.base.material as THREE.Material).dispose();
  }
}

const K_FIRE = 0, K_KUNAI = 1, K_CRESC = 2, K_BOULDER = 3, K_BEAM = 4, K_ORB = 5;
// crossover kinds
const K_BLUE = 6, K_RED = 7, K_PURPLE = 8, K_SHURI = 9, K_SPEAR = 10, K_ROAR = 11;
const N_KINDS = 12;
function kindOf(p: ProjectileState): number {
  const k = p.kind.toLowerCase();
  if (k.includes('purple')) return K_PURPLE;
  if (k === 'blue' || k.startsWith('blue_')) return K_BLUE;
  if (k === 'red' || k.startsWith('red_')) return K_RED;
  if (k.includes('rasenshuriken') || k.includes('rasen_shuriken')) return K_SHURI;
  if (k.includes('spear')) return K_SPEAR;
  if (k.includes('roar')) return K_ROAR;
  if (p.beam || k.includes('beam')) return K_BEAM;
  if (k.includes('fire') || k.includes('flame') || k.includes('ember')) return K_FIRE;
  if (k.includes('kunai') || k.includes('shuriken') || k.includes('dagger')) return K_KUNAI;
  if (k.includes('cresc') || k.includes('slash') || k.includes('wave')) return K_CRESC;
  if (k.includes('boulder') || k.includes('rock') || k.includes('stone')) return K_BOULDER;
  return K_ORB;
}

interface Vis {
  kind: number; id: number; stamp: number; acc: number; seed: number; slowAcc: number; hexT: number;
  root: THREE.Group; a: THREE.Object3D | null; b: THREE.Object3D | null; c: THREE.Object3D | null;
  beam: BeamVis | null;
}

function rockGeo(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const n = g.attributes.position!.count;
  const col = new Float32Array(n * 3);
  for (let f = 0; f < n / 3; f++) {
    const s = 0.55 + Math.random() * 0.5;
    for (let k = 0; k < 3; k++) { col[(f * 3 + k) * 3] = 0.52 * s; col[(f * 3 + k) * 3 + 1] = 0.4 * s; col[(f * 3 + k) * 3 + 2] = 0.28 * s; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export class ProjectileFx {
  private pools: Vis[][] = Array.from({ length: N_KINDS }, () => [] as Vis[]);
  private active: Vis[] = [];
  private byId = new Map<number, Vis>();
  private stamp = 0;
  private time = 0;
  readonly group = new THREE.Group();
  private tex: DecalTextures;
  private rock = rockGeo();

  constructor(private fx: FxCtx, private chest: ChestFn) {
    this.tex = fx.D.tex;
  }

  private build(kind: number): Vis {
    const v: Vis = { kind, id: -1, stamp: 0, acc: 0, slowAcc: 0, hexT: 0, seed: Math.random() * 100, root: new THREE.Group(), a: null, b: null, c: null, beam: null };
    const t = this.tex;
    switch (kind) {
      case K_FIRE: {
        v.a = new THREE.Mesh(sphGeo, addMat(null, 0xfff0b0, 1));
        v.b = new THREE.Mesh(sphGeo, addMat(null, 0xff7a1a, 0.55));
        v.c = new THREE.Sprite(spriteMat(t.glow, 0xff8a2a, 0.9));
        break;
      }
      case K_KUNAI: {
        const steel = new THREE.MeshBasicMaterial({ color: 0x2b2f3a });
        const blade = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.6, 6), steel);
        blade.position.y = 0.15;
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.28, 6), new THREE.MeshBasicMaterial({ color: 0x5a1a8a }));
        handle.position.y = -0.3;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 10), steel);
        ring.position.y = -0.46;
        const g = new THREE.Group();
        g.add(blade, handle, ring);
        v.a = g;
        v.c = new THREE.Sprite(spriteMat(t.glow, 0xb07cff, 0.8));
        break;
      }
      case K_CRESC: {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), addMat(t.crescent, 0xffffff, 1));
        v.a = m;
        v.c = new THREE.Sprite(spriteMat(t.glow, 0x9fdcff, 0.6));
        break;
      }
      case K_BOULDER: {
        const m = new THREE.Mesh(this.rock, new THREE.MeshBasicMaterial({ vertexColors: true }));
        v.a = m;
        break;
      }
      case K_BEAM: {
        v.beam = new BeamVis(t);
        v.beam.addTo(v.root);
        break;
      }
      case K_BLUE: {
        // imploding sphere: dark core with a hot blue rim, swirling distortion ring, halo
        v.a = new THREE.Mesh(sphGeo, fresnelMat(0x050a30, 0x6fb4ff, false, 1.6, 0.97));
        const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), addMat(t.ring, 0x9fd0ff, 0.9));
        const ring2 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), addMat(t.spiral, 0x1a3cc0, 0.55));
        const g = new THREE.Group(); g.add(ring, ring2);
        v.b = g;
        v.c = new THREE.Sprite(spriteMat(t.glow, 0x2a5cff, 0.6));
        break;
      }
      case K_RED: {
        v.a = new THREE.Mesh(sphGeo, fresnelMat(0xfff0e0, 0xff1a2a, true, 1.4, 1));
        const st = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), addMat(t.star, 0xff3a2a, 0.9));
        v.b = st;
        v.c = new THREE.Sprite(spriteMat(t.glow, 0xff2a1a, 1));
        break;
      }
      case K_PURPLE: {
        v.beam = new BeamVis(t);
        v.beam.addTo(v.root);
        // the "imaginary mass" at the tip: white core, violet rim, red / blue swirl discs
        const g = new THREE.Group();
        const core = new THREE.Mesh(sphGeo, fresnelMat(0xffffff, 0xa040ff, true, 1.2, 1));
        const sw1 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), addMat(t.spiral, 0xff3a6a, 0.8));
        const sw2 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), addMat(t.spiral, 0x4a6cff, 0.8));
        for (const m of [core, sw1, sw2]) { m.frustumCulled = false; m.renderOrder = 17; g.add(m); }
        v.a = g;
        v.c = new THREE.Sprite(spriteMat(t.glow, 0xb04aff, 1));
        break;
      }
      case K_SHURI: {
        v.a = new THREE.Mesh(sphGeo, fresnelMat(0xffffff, 0x4ac8ff, true, 1.5, 1));
        const disc = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), addMat(t.shuriken, 0xd8f6ff, 1));
        const disc2 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), addMat(t.spiral, 0x7ad8ff, 0.7));
        const g = new THREE.Group(); g.add(disc, disc2);
        v.b = g;
        v.c = new THREE.Sprite(spriteMat(t.glow, 0x6fd8ff, 0.9));
        break;
      }
      case K_SPEAR: {
        const g = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6), new THREE.MeshBasicMaterial({ color: 0x3a3e48 }));
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.28, 6), new THREE.MeshBasicMaterial({ color: 0xb8bcc8 }));
        head.position.y = 0.48;
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 8), new THREE.MeshBasicMaterial({ color: 0x8a2a1a }));
        can.position.y = 0.2;
        g.add(shaft, head, can);
        v.a = g;
        v.c = new THREE.Sprite(spriteMat(t.glow, 0xffd040, 0.9));
        break;
      }
      case K_ROAR: {
        const r1 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), addMat(t.ring, 0xffe0c0, 0.8));
        const r2 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), addMat(t.ring, 0xff8a5a, 0.6));
        const g = new THREE.Group(); g.add(r1, r2);
        v.a = g;
        v.c = new THREE.Sprite(spriteMat(t.glow, 0xffb080, 0.5));
        break;
      }
      default: {
        v.a = new THREE.Mesh(sphGeo, addMat(null, 0xffffff, 1));
        v.b = new THREE.Mesh(sphGeo, addMat(null, 0x6fe8ff, 0.5));
        v.c = new THREE.Sprite(spriteMat(t.glow, 0x6fe8ff, 0.9));
      }
    }
    for (const o of [v.a, v.b, v.c]) if (o) { v.root.add(o); (o as THREE.Mesh).frustumCulled = false; (o as THREE.Mesh).renderOrder = 15; }
    this.group.add(v.root);
    v.root.visible = false;
    return v;
  }

  private acquire(kind: number): Vis {
    const pool = this.pools[kind]!;
    return pool.pop() ?? this.build(kind);
  }

  private color(p: ProjectileState, state: GameState): number {
    const e: Element = p.element;
    if (e && e !== 'none') return elemCol(e)[0];
    return auraColor(state.fighters[p.owner].char);
  }

  update(dt: number, state: GameState): void {
    this.time += dt;
    this.stamp++;
    const clashing = state.clash.active;
    for (const p of state.projectiles) {
      const kind = kindOf(p);
      if (clashing && (kind === K_BEAM || kind === K_PURPLE)) continue;
      let v = this.byId.get(p.id);
      if (!v || v.kind !== kind) {
        if (v) this.release(v);
        v = this.acquire(kind);
        v.id = p.id; v.acc = 0;
        this.byId.set(p.id, v);
        this.active.push(v);
        v.root.visible = true;
        if (v.beam) v.beam.show(true);
      }
      v.stamp = this.stamp;
      this.updateOne(v, p, state, dt);
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      const v = this.active[i]!;
      if (v.stamp !== this.stamp) {
        this.active[i] = this.active[this.active.length - 1]!;
        this.active.pop();
        this.release(v, false);
      }
    }
  }

  private release(v: Vis, removeFromActive = true): void {
    this.byId.delete(v.id);
    v.root.visible = false;
    if (v.beam) v.beam.show(false);
    if (removeFromActive) {
      const i = this.active.indexOf(v);
      if (i >= 0) { this.active[i] = this.active[this.active.length - 1]!; this.active.pop(); }
    }
    this.pools[v.kind]!.push(v);
  }

  private updateOne(v: Vis, p: ProjectileState, state: GameState, dt: number): void {
    const P = this.fx.P;
    const x = p.pos.x / 1000, y = Math.max(0.15, p.pos.y / 1000), z = p.pos.z / 1000;
    const r = Math.max(0.12, p.r / 1000);
    const vx = (p.vel.x * 60) / 1000, vy = (p.vel.y * 60) / 1000, vz = (p.vel.z * 60) / 1000;
    const sp = Math.hypot(vx, vy, vz);
    const col = this.color(p, state);
    const sc = this.fx.scale;
    const tm = this.time + v.seed;
    // Gojo's Infinity: stretched blue shimmer streaks + hex ripples while slowed
    if (p.slow !== undefined && p.slow < 100 && v.kind !== K_BEAM && v.kind !== K_PURPLE) {
      v.slowAcc += dt * 40 * sc;
      while (v.slowAcc >= 1) {
        v.slowAcc -= 1;
        P.spec.reset().at(x + rr(-r, r) * 0.8, y + rr(-r, r) * 0.8, z + rr(-r, r) * 0.8).v(vx * 3 + 0.01, vy * 3, vz * 3 + 0.01).ph(6, 0)
          .ttl(rr(0.3, 0.5)).tx(T.STREAK, 0.35).sz(r * 0.5, r * 0.15, r * 2.5, r * 1.2).col(0xe8f4ff, 0x5a9cff, 0.55, 0, 1.2);
        P.emit(true);
      }
      v.hexT -= dt;
      if (v.hexT <= 0) { v.hexT = 0.22; this.fx.D.spawn('hex', x, y, z, r * 2, r * 6, 0.4, 0x9fd0ff, 0, rr(0, 6), 0.6, true); }
    }
    switch (v.kind) {
      case K_BLUE: {
        v.root.position.set(x, y, z);
        const pulse = 1 + Math.sin(tm * 22) * 0.06;
        v.a!.scale.setScalar(r * 0.75 * pulse);
        (v.a as THREE.Mesh).material && (((v.a as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uTime!.value = tm);
        const g = v.b as THREE.Group;
        g.quaternion.copy(this.fx.cam.quaternion);
        const ring = g.children[0]!, ring2 = g.children[1]!;
        const ph = (tm * 1.8) % 1; // ring collapses inward on a loop
        ring.scale.setScalar(r * (5.5 - ph * 4.2));
        ((ring as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.25 + ph * 0.7;
        ring2.scale.setScalar(r * 4.2); ring2.rotation.z = tm * 6;
        (v.c as THREE.Sprite).scale.setScalar(r * 6 * pulse);
        // particles sucked inward
        v.acc += dt * 110 * sc;
        while (v.acc >= 1) {
          v.acc -= 1;
          randDir();
          const d = r * rr(2.2, 4.5);
          P.spec.reset().at(x + PR.dx * d, y + PR.dy * d, z + PR.dz * d).v(-PR.dx * d * 4 + vx, -PR.dy * d * 4 + vy, -PR.dz * d * 4 + vz).ph(0, 0)
            .ttl(0.24).tx(T.STREAK, 0.05).sz(0.04, 0.01, 0.25, 0.05).col(0xdfeaff, 0x2a5cff, 0.95, 0.2, 1.6);
          P.emit(true);
        }
        break;
      }
      case K_RED: {
        v.root.position.set(x, y, z);
        const pulse = 1 + Math.sin(tm * 30) * 0.1;
        v.a!.scale.setScalar(r * 0.8 * pulse);
        ((v.a as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uTime!.value = tm;
        const st = v.b as THREE.Mesh;
        st.quaternion.copy(this.fx.cam.quaternion); st.rotateZ(tm * 3);
        st.scale.setScalar(r * 5 * (1 + Math.sin(tm * 17) * 0.15));
        (v.c as THREE.Sprite).scale.setScalar(r * 7 * pulse);
        v.acc += dt * 120 * sc;
        while (v.acc >= 1) {
          v.acc -= 1;
          randDir();
          const sp = rr(5, 10);
          P.spec.reset().at(x + PR.dx * r * 0.5, y + PR.dy * r * 0.5, z + PR.dz * r * 0.5).v(PR.dx * sp + vx * 0.5, PR.dy * sp, PR.dz * sp + vz * 0.5).ph(4, 0)
            .ttl(rr(0.12, 0.24)).tx(T.STREAK, 0.05).sz(0.05, 0.01, 0.35, 0.1).col(0xffffff, 0xff2a1a, 1, 0, 1.7);
          P.emit(true);
        }
        v.hexT -= dt;
        if (v.hexT <= 0) { v.hexT = 0.09; this.fx.D.spawn('ring', x, y, z, r * 1.5, r * 7, 0.22, 0xff4a3a, 0, 0, 0.7, true); }
        break;
      }
      case K_PURPLE: {
        this.chest(p.owner, v2);
        const f = state.fighters[p.owner];
        v2.x += (f.facing.x / 1000) * 0.4; v2.z += (f.facing.z / 1000) * 0.4;
        v3.set(x, y, z);
        const R = Math.max(0.4, r);
        v.beam!.set(v2, v3, R * 1.25, 0x9a3aff, tm, 1);
        this.beamSparks(v2, v3, 0xc070ff, dt, v, 2);
        const g = v.a as THREE.Group;
        g.position.copy(v3);
        const core = g.children[0]!, sw1 = g.children[1]!, sw2 = g.children[2]!;
        core.scale.setScalar(R * 1.5 * (1 + Math.sin(tm * 35) * 0.06));
        ((core as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uTime!.value = tm;
        for (const [m, sgn] of [[sw1, 1], [sw2, -1]] as Array<[THREE.Object3D, number]>) {
          m.quaternion.copy(this.fx.cam.quaternion); m.rotateZ(tm * 9 * sgn);
          m.scale.setScalar(R * 5.5);
        }
        (v.c as THREE.Sprite).position.copy(v3);
        (v.c as THREE.Sprite).scale.setScalar(R * 12);
        // matter being erased: debris pulled into the sphere
        v.slowAcc += dt * 90 * sc;
        while (v.slowAcc >= 1) {
          v.slowAcc -= 1;
          randDir();
          const d = R * rr(2.5, 5);
          P.spec.reset().at(v3.x + PR.dx * d, v3.y + Math.abs(PR.dy) * d, v3.z + PR.dz * d).v(-PR.dx * d * 3, -Math.abs(PR.dy) * d * 3, -PR.dz * d * 3).ph(0, 0)
            .ttl(0.3).tx(T.STREAK, 0.08).sz(0.06, 0.01, 0.4, 0.1).col(0xffffff, 0x8a3aff, 1, 0.3, 1.7);
          P.emit(true);
        }
        break;
      }
      case K_SHURI: {
        v.root.position.set(x, y, z);
        const big = p.kind.includes('kurama') ? 1.35 : 1;
        v.a!.scale.setScalar(r * 0.55 * big);
        ((v.a as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uTime!.value = tm;
        const g = v.b as THREE.Group;
        // disc faces the camera, tilted a bit so it reads as a spinning blade wheel
        g.quaternion.copy(this.fx.cam.quaternion); g.rotateX(-0.5);
        g.children[0]!.rotation.z = -tm * 22; g.children[0]!.scale.setScalar(r * 5.2 * big);
        g.children[1]!.rotation.z = tm * 9; g.children[1]!.scale.setScalar(r * 3.2 * big);
        (v.c as THREE.Sprite).scale.setScalar(r * 6 * big);
        v.acc += dt * 90 * sc;
        while (v.acc >= 1) {
          v.acc -= 1;
          const a = rr(0, 6.28), rad = r * 2.4 * big;
          const cr = this.fx.cam.matrixWorld.elements;
          const ca = Math.cos(a), sa = Math.sin(a);
          const ox = (cr[0]! * ca + cr[4]! * sa) * rad, oy = (cr[1]! * ca + cr[5]! * sa) * rad, oz = (cr[2]! * ca + cr[6]! * sa) * rad;
          // tangential wind streaks
          P.spec.reset().at(x + ox, y + oy, z + oz).v(-oy * 8 + vx * 0.4, ox * 8, vz * 0.4).ph(3, 0)
            .ttl(rr(0.12, 0.22)).tx(T.STREAK, 0.05).sz(0.05, 0.01, 0.4, 0.1).col(0xffffff, 0x6fd8ff, 1, 0, 1.5);
          P.emit(true);
        }
        break;
      }
      case K_SPEAR: {
        v.root.position.set(x, y, z);
        if (sp > 0.01) { v1.set(vx, vy, vz).multiplyScalar(1 / sp); v.a!.quaternion.setFromUnitVectors(Y, v1); }
        const armed = p.fuse !== undefined && p.life <= p.fuse + 20;
        const blink = armed ? (Math.sin(tm * 60) > 0 ? 1 : 0.2) : 0.6;
        (v.c as THREE.Sprite).scale.setScalar(armed ? 0.9 : 0.5);
        ((v.c as THREE.Sprite).material as THREE.SpriteMaterial).opacity = blink;
        v.acc += dt * 70 * sc;
        while (v.acc >= 1) {
          v.acc -= 1;
          P.spec.reset().at(x - vx * 0.02, y - vy * 0.02, z - vz * 0.02).v(rr(-0.3, 0.3), rr(0.1, 0.6), rr(-0.3, 0.3)).ph(2, -0.3)
            .ttl(rr(0.4, 0.8)).tx(T.SMOKE).sz(0.12, 0.45).rt(rr(0, 6), rr(-1, 1)).col(0xd8d2c8, 0x6a6460, 0.5, 0);
          P.emit(false);
          if (Math.random() < 0.5) {
            P.spec.reset().at(x, y, z).v(-vx * 0.2 + rr(-1, 1), rr(-0.5, 1), -vz * 0.2 + rr(-1, 1)).ph(2, 4).ttl(rr(0.15, 0.3)).tx(T.SPARK).sz(0.1, 0.02).col(0xffffff, 0xffb020, 1, 0, 1.7);
            P.emit(true);
          }
        }
        break;
      }
      case K_ROAR: {
        v.root.position.set(x, y, z);
        const g = v.a as THREE.Group;
        g.quaternion.copy(this.fx.cam.quaternion);
        const ph = (tm * 3) % 1;
        g.children[0]!.scale.setScalar(r * (1 + ph * 4));
        ((g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - ph);
        const ph2 = (ph + 0.5) % 1;
        g.children[1]!.scale.setScalar(r * (1 + ph2 * 4));
        ((g.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - ph2);
        (v.c as THREE.Sprite).scale.setScalar(r * 4);
        v.acc += dt * 40 * sc;
        while (v.acc >= 1) {
          v.acc -= 1;
          P.spec.reset().at(x + rr(-r, r), y + rr(-r, r) * 0.5, z + rr(-r, r)).v(vx * 0.3 + rr(-0.5, 0.5), rr(0.3, 1.2), vz * 0.3 + rr(-0.5, 0.5)).ph(1.5, -0.5)
            .ttl(rr(0.6, 1.0)).tx(T.SMOKE).sz(r * 0.6, r * 2.2).rt(rr(0, 6), rr(-1, 1)).col(0xf4ece4, 0xb8aca0, 0.45, 0);
          P.emit(false);
        }
        break;
      }
      case K_FIRE: {
        v.root.position.set(x, y, z);
        const s = r * (1 + Math.sin(tm * 30) * 0.08);
        v.a!.scale.setScalar(s * 0.7);
        v.b!.scale.setScalar(s * 1.25);
        (v.c as THREE.Sprite).scale.setScalar(s * 5.5);
        v.acc += dt * 90 * sc;
        while (v.acc >= 1) {
          v.acc -= 1;
          P.spec.reset().at(x + rr(-r, r) * 0.5, y + rr(-r, r) * 0.5, z + rr(-r, r) * 0.5).v(-vx * 0.12 + rr(-0.6, 0.6), rr(0.2, 1.4), -vz * 0.12 + rr(-0.6, 0.6)).ph(2, -1)
            .ttl(rr(0.3, 0.55)).tx(T.FLAME).sz(r * 1.5, r * 0.3, r * 2.0, r * 0.5).rt(rr(-0.4, 0.4), 0).col(0xffd060, 0xff2a08, 1, 0, 1.3);
          P.emit(true);
          if (Math.random() < 0.4) {
            P.spec.reset().at(x, y, z).v(rr(-1, 1), rr(0.5, 2.5), rr(-1, 1)).ph(1.5, -1.5).ttl(rr(0.4, 0.9)).tx(T.SPARK).sz(0.12, 0.02).col(0xffc050, 0xff3010, 1, 0, 1.6);
            P.emit(true);
          }
          if (Math.random() < 0.18) {
            P.spec.reset().at(x, y, z).v(rr(-0.4, 0.4), rr(0.8, 1.5), rr(-0.4, 0.4)).ph(1.5, 0).ttl(rr(0.6, 1.0)).tx(T.SMOKE).sz(r, r * 3).col(0x3a2a24, 0x100a08, 0.4, 0);
            P.emit(false);
          }
        }
        break;
      }
      case K_KUNAI: {
        v.root.position.set(x, y, z);
        if (sp > 0.01) { v1.set(vx, vy, vz).multiplyScalar(1 / sp); v.a!.quaternion.setFromUnitVectors(Y, v1); }
        v.a!.scale.setScalar(Math.max(1, r * 3));
        (v.c as THREE.Sprite).scale.setScalar(0.7);
        v.acc += dt * 120 * sc;
        while (v.acc >= 1) {
          v.acc -= 1;
          P.spec.reset().at(x, y, z).v(-vx * 0.05, -vy * 0.05, -vz * 0.05).ttl(0.22).tx(T.STREAK, 0.02)
            .sz(0.06, 0.01, 0.5, 0.1).col(0xc8a0ff, 0x4a1a8a, 0.9, 0, 1.3);
          // streak trail aligned with velocity: tiny velocity along flight direction
          P.spec.vx = vx * 0.4; P.spec.vy = vy * 0.4; P.spec.vz = vz * 0.4;
          P.spec.x -= vx * 0.012; P.spec.y -= vy * 0.012; P.spec.z -= vz * 0.012;
          P.emit(true);
        }
        break;
      }
      case K_CRESC: {
        v.root.position.set(x, y, z);
        const m = v.a as THREE.Mesh;
        m.quaternion.copy(this.fx.cam.quaternion);
        // roll so the crescent bulge points along travel direction in screen space
        v1.set(vx, vy, vz);
        v2.set(1, 0, 0).applyQuaternion(this.fx.cam.quaternion);
        v3.set(0, 1, 0).applyQuaternion(this.fx.cam.quaternion);
        m.rotateZ(Math.atan2(v1.dot(v3), v1.dot(v2)));
        const s = Math.max(1.3, r * 5);
        m.scale.set(s, s * 1.15, 1);
        const zor = state.fighters[p.owner].char === 'zoro';
        (m.material as THREE.MeshBasicMaterial).color.setHex(zor ? 0xc8ffd8 : 0xffffff);
        ((v.c as THREE.Sprite).material as THREE.SpriteMaterial).color.setHex(zor ? 0x3fd17a : 0x9fdcff);
        (v.c as THREE.Sprite).scale.setScalar(s * 1.6);
        v.acc += dt * 70 * sc;
        while (v.acc >= 1) {
          v.acc -= 1;
          P.spec.reset().at(x + rr(-0.2, 0.2), y + rr(-0.5, 0.5), z + rr(-0.2, 0.2)).v(-vx * 0.08, rr(-0.2, 0.2), -vz * 0.08).ph(3, 0).ttl(rr(0.18, 0.32))
            .tx(T.STREAK, 0.05).sz(0.04, 0.01, 0.5, 0.1).col(0xffffff, 0x9fdcff, 0.9, 0, 1.5);
          P.spec.vx = vx * 0.3; P.spec.vz = vz * 0.3;
          P.emit(true);
        }
        break;
      }
      case K_BOULDER: {
        v.root.position.set(x, y, z);
        const m = v.a as THREE.Mesh;
        m.scale.setScalar(Math.max(0.3, r));
        m.rotation.x += dt * 5; m.rotation.z += dt * 3.3;
        v.acc += dt * 50 * sc;
        while (v.acc >= 1) {
          v.acc -= 1;
          P.spec.reset().at(x + rr(-r, r) * 0.6, y - r * 0.5, z + rr(-r, r) * 0.6).v(-vx * 0.1 + rr(-0.5, 0.5), rr(0.3, 1.2), -vz * 0.1 + rr(-0.5, 0.5)).ph(2, 0)
            .ttl(rr(0.4, 0.8)).tx(T.SMOKE).sz(r * 0.8, r * 2.2).rt(rr(0, 6), rr(-1, 1)).col(0xc2ae8c, 0x6e6050, 0.55, 0);
          P.emit(false);
          if (Math.random() < 0.35) {
            P.spec.reset().at(x, y, z).v(rr(-2, 2), rr(0, 3), rr(-2, 2)).ph(0.4, 12).ttl(rr(0.5, 0.9)).tx(T.SHARD).sz(rr(0.05, 0.1), rr(0.05, 0.1)).rt(rr(0, 6), rr(-8, 8)).col(0xb8895a, 0x7a5a3a, 1, 1);
            P.spec.pe = 6;
            P.emit(false);
          }
        }
        break;
      }
      case K_BEAM: {
        this.chest(p.owner, v2);
        const f = state.fighters[p.owner];
        v2.x += (f.facing.x / 1000) * 0.35; v2.z += (f.facing.z / 1000) * 0.35;
        v3.set(x, y, z);
        v.beam!.set(v2, v3, Math.max(0.25, r), col, tm, 1);
        this.beamSparks(v2, v3, col, dt, v, 1);
        break;
      }
      default: {
        v.root.position.set(x, y, z);
        const s = r * (1 + Math.sin(tm * 25) * 0.1);
        v.a!.scale.setScalar(s * 0.6);
        v.b!.scale.setScalar(s * 1.1);
        (v.b as THREE.Mesh as THREE.Mesh & { material: THREE.MeshBasicMaterial }).material.color.setHex(col);
        (v.c as THREE.Sprite).scale.setScalar(s * 5);
        (v.c as THREE.Sprite).material.color.setHex(col);
        v.acc += dt * 60 * sc;
        while (v.acc >= 1) {
          v.acc -= 1;
          P.spec.reset().at(x, y, z).v(rr(-0.5, 0.5), rr(-0.5, 0.5), rr(-0.5, 0.5)).ph(2, 0).ttl(rr(0.25, 0.45)).tx(T.SOFT).sz(r * 0.9, r * 0.1).col(col, 0xffffff, 0.8, 0, 1.4);
          P.emit(true);
        }
      }
    }
  }

  /** sparks crackling along a beam (shared by projectile beams and clash) */
  beamSparks(a: THREE.Vector3, b: THREE.Vector3, col: number, dt: number, v: { acc: number }, k: number): void {
    const P = this.fx.P;
    v.acc += dt * 70 * this.fx.scale * k;
    while (v.acc >= 1) {
      v.acc -= 1;
      const t = Math.random();
      randDir();
      P.spec.reset().at(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t).v(PR.dx * 3, PR.dy * 3, PR.dz * 3).ph(3, 0).ttl(rr(0.15, 0.35))
        .tx(T.STREAK, 0.1).sz(0.04, 0.01, 0.25, 0.1).col(0xffffff, col, 1, 0, 1.6);
      P.emit(true);
    }
  }

  clear(): void {
    for (let i = this.active.length - 1; i >= 0; i--) this.release(this.active[i]!, false);
    this.active.length = 0;
    this.byId.clear();
  }
  dispose(): void {
    this.group.removeFromParent();
  }
}

// ===================================================================== beam clash
export class ClashFx {
  readonly group = new THREE.Group();
  private b0: BeamVis; private b1: BeamVis;
  private ball: THREE.Mesh; private halo: THREE.Sprite; private starS: THREE.Sprite;
  private was = false;
  private last = new THREE.Vector3();
  private time = 0;
  private acc = { acc: 0 }; private acc2 = { acc: 0 }; private accC = 0;
  private proj: ProjectileFx;
  constructor(private fx: FxCtx, private chest: ChestFn, private effects: Effects, proj: ProjectileFx) {
    this.proj = proj;
    this.b0 = new BeamVis(fx.D.tex); this.b1 = new BeamVis(fx.D.tex);
    this.b0.addTo(this.group); this.b1.addTo(this.group);
    this.ball = new THREE.Mesh(sphGeo, addMat(null, 0xffffff, 0.95));
    this.halo = new THREE.Sprite(spriteMat(fx.D.tex.glow, 0xaad8ff, 1));
    this.starS = new THREE.Sprite(spriteMat(fx.D.tex.star, 0xffffff, 0.9));
    for (const o of [this.ball, this.halo, this.starS]) { o.renderOrder = 17; (o as THREE.Mesh).frustumCulled = false; this.group.add(o); }
    this.hide();
  }
  private hide(): void { this.b0.show(false); this.b1.show(false); this.ball.visible = false; this.halo.visible = false; this.starS.visible = false; }
  update(dt: number, state: GameState): void {
    const c = state.clash;
    if (!c.active) {
      if (this.was) { this.was = false; this.hide(); this.effects.clashEnd(this.last); }
      return;
    }
    this.time += dt;
    const P = this.fx.P;
    if (!this.was) {
      this.was = true;
      this.b0.show(true); this.b1.show(true);
      this.ball.visible = true; this.halo.visible = true; this.starS.visible = true;
      v1.set(c.point.x / 1000, Math.max(0.6, c.point.y / 1000), c.point.z / 1000);
      this.effects.clashStart(v1);
    }
    const bal = Math.max(-1000, Math.min(1000, c.balance)) / 1000;
    this.chest(0, v1); this.chest(1, v2);
    // meeting point, pushed toward the losing side by balance
    v3.set(c.point.x / 1000, Math.max(0.8, c.point.y / 1000), c.point.z / 1000);
    const ax = v2.x - v1.x, az = v2.z - v1.z, al = Math.hypot(ax, az) || 1;
    v3.x += (ax / al) * bal * 0.28 * al; v3.z += (az / al) * bal * 0.28 * al;
    this.last.copy(v3);
    const f0 = state.fighters[0], f1 = state.fighters[1];
    v1.x += (f0.facing.x / 1000) * 0.4; v1.z += (f0.facing.z / 1000) * 0.4;
    v2.x += (f1.facing.x / 1000) * 0.4; v2.z += (f1.facing.z / 1000) * 0.4;
    const c0 = auraColor(f0.char), c1 = auraColor(f1.char);
    const prog = Math.min(1, c.frame / Math.max(1, c.duration));
    const realm = (c as { kind?: string }).kind === 'realm';
    this.b0.show(!realm); this.b1.show(!realm);
    if (realm) {
      // Realm Clash: the two worlds grind along a seam through the meeting point (environment split is in render)
      this.ball.visible = false;
      this.accC += dt * 160 * this.fx.scale;
      const sx = -(v2.z - v1.z), sz = v2.x - v1.x, sl = Math.hypot(sx, sz) || 1;
      while (this.accC >= 1) {
        this.accC -= 1;
        const along = rr(-9, 9), h = rr(0, 7);
        const px = v3.x + (sx / sl) * along, pz = v3.z + (sz / sl) * along;
        const side = Math.random() < 0.5 ? -1 : 1;
        P.spec.reset().at(px, h, pz).v((ax / al) * side * rr(3, 9), rr(-2, 4), (az / al) * side * rr(3, 9)).ph(2.5, 3).ttl(rr(0.15, 0.4)).tx(T.STREAK, 0.1)
          .sz(0.05, 0.015, 0.4, 0.15).col(0xffffff, side < 0 ? c0 : c1, 1, 0, 1.7);
        P.emit(true);
      }
      this.halo.position.copy(v3); this.halo.scale.setScalar(5 + Math.sin(this.time * 30) * 0.5);
      this.starS.position.copy(v3); this.starS.scale.setScalar(3.5);
      (this.starS.material as THREE.SpriteMaterial).rotation = this.time * 5;
      if ((state.frame & 3) === 0) this.fx.r.addShake(0.03 + prog * 0.03, 3);
      return;
    }
    this.ball.visible = true;
    this.b0.set(v1, v3, 0.45 * (1 + bal * 0.4), c0, this.time, 1);
    this.b1.set(v2, v3, 0.45 * (1 - bal * 0.4), c1, this.time + 3, 1);
    const R = 0.55 + prog * 0.9 + Math.sin(this.time * 33) * 0.06;
    this.ball.position.copy(v3);
    this.ball.scale.setScalar(R * 0.5);
    this.halo.position.copy(v3);
    this.halo.scale.setScalar(R * 3.6);
    const mixc = bal > 0 ? c0 : c1;
    (this.halo.material as THREE.SpriteMaterial).color.setHex(mixc);
    this.starS.position.copy(v3);
    this.starS.scale.setScalar(R * 2.4);
    (this.starS.material as THREE.SpriteMaterial).rotation = this.time * 5;
    // lightning sparks + swirling orbit particles
    this.accC += dt * 110 * this.fx.scale;
    while (this.accC >= 1) {
      this.accC -= 1;
      randDir();
      const sp = rr(6, 14);
      P.spec.reset().at(v3.x, v3.y, v3.z).v(PR.dx * sp, PR.dy * sp, PR.dz * sp).ph(2.5, 0).ttl(rr(0.15, 0.4)).tx(T.STREAK, 0.12)
        .sz(0.05, 0.015, 0.4, 0.15).col(0xffffff, Math.random() < 0.5 ? c0 : c1, 1, 0, 1.7);
      P.emit(true);
      const a = this.time * 9 + rr(0, 6.28), rad = R * rr(0.6, 1.1);
      P.spec.reset().at(v3.x + Math.cos(a) * rad, v3.y + Math.sin(a) * rad * 0.7, v3.z + Math.sin(a * 0.7) * rad * 0.5).v(0, 0, 0).ttl(0.25).tx(T.SOFT)
        .sz(0.22, 0.04).col(0xffffff, mixc, 1, 0, 1.5);
      P.emit(true);
    }
    this.proj.beamSparks(v1, v3, c0, dt, this.acc, 0.6);
    this.proj.beamSparks(v2, v3, c1, dt, this.acc2, 0.6);
    // constant rumble
    if ((state.frame & 3) === 0) this.fx.r.addShake(0.02 + prog * 0.025 + Math.abs(bal) * 0.01, 3);
  }
  clear(): void { this.was = false; this.hide(); }
  dispose(): void { this.b0.dispose(); this.b1.dispose(); this.group.removeFromParent(); }
}

// ===================================================================== continuous auras
export class Auras {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh[] = [];
  private maps: THREE.Texture[] = [];
  private a = [0, 0];
  private acc = [0, 0];
  private ring = [0, 0];
  private time = 0;
  constructor(private fx: FxCtx) {
    for (let i = 0; i < 2; i++) {
      const map = cloneTex(fx.D.tex.aura);
      map.repeat.set(2, 1);
      this.maps.push(map);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.78, 2.4, 20, 1, true), addMat(map, 0xffffff, 0));
      m.visible = false; m.frustumCulled = false; m.renderOrder = 14;
      this.mesh.push(m);
      this.group.add(m);
    }
  }
  update(dt: number, state: GameState): void {
    this.time += dt;
    const P = this.fx.P;
    for (let i = 0; i < 2; i++) {
      const f = state.fighters[i]!;
      const charge = f.mode === 'kicharge';
      const fa = formAura(f);
      const awake = f.awakened || !!fa;
      const target = charge ? 1 : fa ? fa.k : awake ? 0.55 : 0;
      this.a[i]! += (target - this.a[i]!) * Math.min(1, dt * 8);
      const a = this.a[i]!;
      const m = this.mesh[i]!;
      if (a < 0.02) { m.visible = false; continue; }
      m.visible = true;
      let col = auraColor(f.char);
      if (fa && !charge) col = fa.col;
      else if (awake && !charge) col = lerpHex(col, 0xfff1a8, 0.45);
      const fs = fa ? fa.scale : 1;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.setHex(col);
      mat.opacity = a * (charge ? 0.9 : 0.6);
      const grow = charge ? 0.8 + Math.min(1, f.modeFrame / 120) * 0.5 : 1.0;
      const pulse = 1 + Math.sin(this.time * (charge ? 16 : 9) + i) * 0.07;
      m.position.set(f.pos.x / 1000, f.pos.y / 1000 + 1.2 * (f.form === 'titan' ? fs : 1), f.pos.z / 1000);
      m.scale.set(grow * pulse * fs, f.form === 'titan' ? fs : 1, grow * pulse * fs);
      m.rotation.y += dt * 2.5;
      this.maps[i]!.offset.y -= dt * (charge ? 2.4 : 1.4);
      this.maps[i]!.offset.x += dt * 0.2;
      // particles
      const x = f.pos.x / 1000, y = f.pos.y / 1000, z = f.pos.z / 1000;
      const rate = (charge ? 80 : 26) * this.fx.scale;
      this.acc[i]! += dt * rate;
      while (this.acc[i]! >= 1) {
        this.acc[i]! -= 1;
        const ang = rr(0, 6.28), rad = rr(0.25, charge ? 0.65 : 0.5);
        if (charge || Math.random() < 0.5) {
          P.spec.reset().at(x + Math.cos(ang) * rad, y + rr(0, 0.5), z + Math.sin(ang) * rad).v(0, rr(1.8, 4.2), 0).ph(0.4, 0)
            .ttl(rr(0.5, 0.9)).tx(T.FLAME).sz(0.38, 0.06, 0.55, 0.15).rt(rr(-0.15, 0.15), 0).col(lerpHex(col, 0xffffff, 0.45), col, 0.9, 0, 1.4);
          P.emit(true);
        } else {
          P.spec.reset().at(x + Math.cos(ang) * rad, y + rr(0.1, 1.8), z + Math.sin(ang) * rad).v(rr(-0.4, 0.4), rr(1.5, 3.5), rr(-0.4, 0.4)).ph(0.3, 0)
            .ttl(rr(0.6, 1.2)).tx(T.SPARK).sz(0.14, 0.02).rt(rr(0, 3), 0).col(0xffffff, col, 1, 0, 1.6);
          P.emit(true);
        }
      }
      if (charge) {
        this.ring[i]! += dt;
        if (this.ring[i]! > 0.45) {
          this.ring[i] = 0;
          this.fx.D.spawn('ring', x, 0.05, z, 2.4, 0.4, 0.45, col, 1, 0, 0.8, true);
        }
      }
    }
  }
  clear(): void {
    for (let i = 0; i < 2; i++) { this.a[i] = 0; this.mesh[i]!.visible = false; }
  }
  dispose(): void { this.group.removeFromParent(); for (const t of this.maps) t.dispose(); }
}

export function lerpHex(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t;
  const g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t;
  const bl = (a & 255) * (1 - t) + (b & 255) * t;
  return ((r | 0) << 16) | ((g | 0) << 8) | (bl | 0);
}
