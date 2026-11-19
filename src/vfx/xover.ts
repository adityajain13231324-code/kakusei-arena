// Crossover Pack effects (Gojo, Naruto, Zoro, Luffy, Eren): move-hint flourishes, forms, Infinity, clones,
// realm cinematic overlays, lightning, tornado, ODM wire, Hollow Purple trench. Effects only: no character
// likenesses are drawn here (the fighters are the owner's models / the mannequin).
//
// Driven like the rest of the VFX: handle(ev, state) once per sim event, update(dt, state) each render frame.
import * as THREE from 'three';
import type { CharId, GameState, MoveDef, SimEvent, FighterState } from '../sim/types';
import { getMove, getChar } from '../sim';
import { T, rr, randDir } from './particles';
import * as PR from './particles';
import type { Effects, FxCtx } from './effects';
import { auraColor, elemCol } from './effects';
import { fresnelMat } from './projectiles';
import type { ChestFn } from './projectiles';

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const sph = new THREE.SphereGeometry(1, 20, 14);
const plane = new THREE.PlaneGeometry(1, 1);

function add(map: THREE.Texture | null, color: number, opacity = 1): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  m.toneMapped = false;
  return m;
}
function sprite(map: THREE.Texture, color: number, opacity = 1): THREE.Sprite {
  const m = new THREE.SpriteMaterial({ map, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  m.toneMapped = false;
  const s = new THREE.Sprite(m);
  s.frustumCulled = false;
  s.renderOrder = 18;
  return s;
}

/** colour of the awakened / form aura shell for a fighter form (null = default awakened colour) */
export function formAura(f: FighterState): { col: number; k: number; scale: number } | null {
  switch (f.form) {
    case 'six_eyes': return { col: 0x8fd8ff, k: 0.55, scale: 1 };
    case 'sage': return { col: 0xff8a1a, k: 0.6, scale: 1 };
    case 'kurama': return { col: 0xffc21a, k: 0.75, scale: 1.15 };
    case 'gear2': return { col: 0xff6a8a, k: 0.55, scale: 1 };
    case 'gear4': return { col: 0xff2a1a, k: 0.85, scale: 1.3 };
    case 'gear5': return { col: 0xfff4e0, k: 0.45, scale: 1.15 };
    case 'titan': return { col: 0xff4a1a, k: 0.3, scale: 2.4 };
    default: return null;
  }
}

const REALM_GRADE: Record<string, number> = {
  infinite_void: 0x2a1a6a, tailed_beast_bomb: 0x7a0a1a, king_of_hell: 0x8a0a10, gear_fifth: 0xfff4d0, paths: 0x1a3a6a,
};
const REALM_COL: Record<string, number> = {
  infinite_void: 0x9fb0ff, tailed_beast_bomb: 0xff4a2a, king_of_hell: 0xff2a3a, gear_fifth: 0xffffff, paths: 0x8fe0ff,
};

type HandOrb = { g: THREE.Group; core: THREE.Mesh; d1: THREE.Mesh; d2: THREE.Mesh; glow: THREE.Sprite; on: boolean };

/** Jagged lightning ribbon (CPU-rebuilt; few verts). */
class Bolt {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private geo = new THREE.BufferGeometry();
  life = 0; ttl = 0; private seed = 0; private regen = 0;
  a = new THREE.Vector3(); b = new THREE.Vector3(); width = 0.3; color = 0xfff27a;
  static N = 18;
  constructor() {
    const N = Bolt.N;
    this.pos = new Float32Array(N * 2 * 3);
    const uv = new Float32Array(N * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i < N; i++) {
      uv[i * 4] = 0; uv[i * 4 + 1] = i / (N - 1); uv[i * 4 + 2] = 1; uv[i * 4 + 3] = i / (N - 1);
      if (i < N - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Color(0xfff27a) }, uA: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uCol; uniform float uA; varying vec2 vUv;
        void main(){ float d = abs(vUv.x - 0.5) * 2.0; float core = smoothstep(0.35, 0.0, d); float glow = smoothstep(1.0, 0.0, d);
          gl_FragColor = vec4(mix(uCol * glow, vec3(1.0), core) * (glow * 0.6 + core) * 1.6, (glow * 0.5 + core) * uA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    m.toneMapped = false;
    this.mesh = new THREE.Mesh(this.geo, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 19;
    this.mesh.visible = false;
  }
  fire(a: THREE.Vector3, b: THREE.Vector3, width: number, ttl: number, color: number): void {
    this.a.copy(a); this.b.copy(b); this.width = width; this.ttl = ttl; this.life = ttl; this.color = color;
    this.seed = Math.random() * 1000; this.regen = 0;
    (this.mesh.material as THREE.ShaderMaterial).uniforms.uCol!.value.setHex(color);
    this.mesh.visible = true;
  }
  update(dt: number, cam: THREE.Camera): void {
    if (this.life <= 0) { this.mesh.visible = false; return; }
    this.life -= dt;
    const k = Math.max(0, this.life / this.ttl);
    (this.mesh.material as THREE.ShaderMaterial).uniforms.uA!.value = Math.min(1, k * 2.5) * (0.7 + Math.random() * 0.3);
    this.regen -= dt;
    if (this.regen > 0) return;
    this.regen = 0.045;
    this.seed += 1.7;
    const N = Bolt.N, P = this.pos;
    v1.subVectors(this.b, this.a);
    const len = v1.length();
    v1.normalize();
    v2.subVectors(cam.position, this.a).cross(v1).normalize(); // ribbon side (faces the camera)
    v3.crossVectors(v1, v2).normalize();
    let ox = 0, oz = 0;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const amp = len * 0.06 * Math.sin(t * Math.PI);
      if (i > 0 && i < N - 1) { ox = (Math.random() - 0.5) * 2 * amp + ox * 0.3; oz = (Math.random() - 0.5) * 2 * amp + oz * 0.3; } else { ox = 0; oz = 0; }
      v4.copy(this.a).addScaledVector(v1, len * t).addScaledVector(v2, ox).addScaledVector(v3, oz);
      const w = this.width * (0.35 + 0.65 * (1 - t * 0.6));
      P[i * 6] = v4.x - v2.x * w; P[i * 6 + 1] = v4.y - v2.y * w; P[i * 6 + 2] = v4.z - v2.z * w;
      P[i * 6 + 3] = v4.x + v2.x * w; P[i * 6 + 4] = v4.y + v2.y * w; P[i * 6 + 5] = v4.z + v2.z * w;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

interface PState {
  moveId: string | null; lastFrame: number; fx: string; def: MoveDef | null;
  infAmt: number; infPulse: number; orbA: HandOrb; orbB: HandOrb;
  tornado: THREE.Mesh; tornK: number; wire: THREE.Mesh; wireK: number; wireAnchor: THREE.Vector3;
  glyph: THREE.Sprite; glyphK: number; bubble: THREE.Mesh; blades: THREE.Sprite[];
  acc: number; acc2: number; ringT: number; form: string;
}

export class XoverFx {
  readonly group = new THREE.Group();
  private ps: PState[] = [];
  private bolts: Bolt[] = [];
  private trench: THREE.Mesh;
  private trenchK = 0; private trenchOn = false;
  private time = 0;
  private realmKind: string | null = null;
  private realmPhase: string | null = null;
  private realmAcc = 0; private beatT = 0;
  state: GameState | null = null;

  constructor(private fx: FxCtx, private eff: Effects, private chest: ChestFn) {
    const t = fx.D.tex;
    for (let i = 0; i < 2; i++) {
      const orb = (): HandOrb => {
        const g = new THREE.Group();
        const core = new THREE.Mesh(sph, fresnelMat(0xffffff, 0x4ab8ff, true, 1.3, 1));
        const d1 = new THREE.Mesh(plane, add(t.spiral, 0x8fd8ff, 0.9));
        const d2 = new THREE.Mesh(plane, add(t.spiral, 0x3a8cff, 0.7));
        const glow = sprite(t.glow, 0x4ab8ff, 0.9);
        for (const m of [core, d1, d2]) { m.frustumCulled = false; m.renderOrder = 18; }
        g.add(core, d1, d2, glow);
        g.visible = false;
        this.group.add(g);
        return { g, core, d1, d2, glow, on: false };
      };
      const tornado = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.35, 3.6, 22, 1, true), add(t.swirl, 0xc8ffd8, 0));
      tornado.frustumCulled = false; tornado.renderOrder = 16; tornado.visible = false;
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true), new THREE.MeshBasicMaterial({ color: 0xd8dce8 }));
      wire.frustumCulled = false; wire.visible = false;
      const glyph = sprite(t.asura, 0x6fffb0, 0);
      glyph.visible = false;
      const bubble = new THREE.Mesh(sph, bubbleMat());
      bubble.frustumCulled = false; bubble.renderOrder = 17; bubble.visible = false;
      const blades: THREE.Sprite[] = [];
      for (let k = 0; k < 3; k++) { const b = sprite(t.glow, 0x6fffb0, 0.9); b.visible = false; blades.push(b); this.group.add(b); }
      this.group.add(tornado, wire, glyph, bubble);
      this.ps.push({
        moveId: null, lastFrame: -1, fx: '', def: null, infAmt: 0, infPulse: 0, orbA: orb(), orbB: orb(),
        tornado, tornK: 0, wire, wireK: 0, wireAnchor: new THREE.Vector3(), glyph, glyphK: 0, bubble, blades, acc: 0, acc2: 0, ringT: 0, form: '',
      });
    }
    for (let i = 0; i < 4; i++) { const b = new Bolt(); this.bolts.push(b); this.group.add(b.mesh); }
    this.trench = new THREE.Mesh(plane, add(t.glow, 0xb04aff, 0));
    this.trench.rotation.x = -Math.PI / 2;
    this.trench.frustumCulled = false; this.trench.visible = false; this.trench.renderOrder = 12;
    this.group.add(this.trench);
  }

  private n(v: number): number { return Math.max(1, Math.round(v * this.fx.scale)); }
  private bolt(a: THREE.Vector3, b: THREE.Vector3, w: number, ttl: number, col: number): void {
    let best = this.bolts[0]!;
    for (const x of this.bolts) if (x.life < best.life) best = x;
    best.fire(a, b, w, ttl, col);
  }
  private bone(p: 0 | 1, b: 'head' | 'chest' | 'hips' | 'handL' | 'handR' | 'footL' | 'footR', out: THREE.Vector3): THREE.Vector3 {
    this.fx.r.getBoneWorld(p, b, out);
    if (out.lengthSq() < 1e-6 && this.state) { const f = this.state.fighters[p]; out.set(f.pos.x / 1000, f.pos.y / 1000 + 1.2, f.pos.z / 1000); }
    return out;
  }
  private at(x: number, y: number, z: number): Effects {
    const e = this.eff as unknown as { x: number; y: number; z: number; ax: number; az: number };
    e.x = x; e.y = y; e.z = z; e.ax = 0; e.az = 0;
    return this.eff;
  }
  private atV(v: THREE.Vector3): Effects { return this.at(v.x, v.y, v.z); }
  private facing(p: 0 | 1, out: THREE.Vector3): THREE.Vector3 {
    const f = this.state!.fighters[p];
    return out.set(f.facing.x / 1000, 0, f.facing.z / 1000);
  }
  private fxOf(char: CharId, moveId: string | undefined | null): string {
    if (!moveId) return '';
    return lookupMove(char, moveId)?.fx ?? '';
  }

  // ------------------------------------------------------------------------------------------- events
  handle(ev: SimEvent, state: GameState): void {
    this.state = state;
    const fx = this.fx, P = fx.P;
    switch (ev.type) {
      case 'realmStart': this.realmStart(ev, state); break;
      case 'realmEnd': {
        const c = REALM_COL[ev.tag === 'cap' || ev.tag === 'time' ? (this.realmKind ?? '') : ''] ?? 0xffffff;
        this.chest(ev.player, v1);
        this.atV(v1);
        fx.post.screenFlash(0xffffff, 0.55, 4);
        this.eff.shock(9, 0.6, c, true);
        this.eff.shock(6, 0.5, 0xffffff);
        this.eff.sparks(40, 12, 1.4, 0xffffff, c, 0.9, 0.9, 2);
        fx.r.addShake(0.06, 14);
        fx.post.letterbox(0);
        break;
      }
      case 'realmClash': {
        v1.set(ev.pos.x / 1000, Math.max(1.0, ev.pos.y / 1000), ev.pos.z / 1000);
        this.atV(v1);
        fx.post.screenFlash(0xffffff, 0.8, 3);
        fx.post.colorGrade(0x4a1a7a, 0.35, 3);
        fx.post.speedLines(1, 1.2, 0xffffff);
        this.eff.shock(10, 0.8, 0xc06cff);
        fx.O.clear();
        fx.O.spawn('rv_clash', v1.x, v1.y + 1.6, v1.z, 1.8, 1.8);
        fx.r.addShake(0.12, 30);
        break;
      }
      case 'infinityBlock': {
        const s = this.ps[ev.player]!;
        s.infPulse = 1;
        this.chest(ev.player, v1);
        const hx = ev.pos.x / 1000, hy = ev.pos.y / 1000, hz = ev.pos.z / 1000;
        this.at(hx, hy, hz);
        fx.D.spawn('hex', hx, hy, hz, 0.3, 2.6, 0.45, 0x9fd8ff, 0, rr(0, 6), 1, true);
        fx.D.spawn('hex', v1.x, v1.y, v1.z, 1.6, 3.4, 0.55, 0x6fb4ff, 0, rr(0, 6), 0.7, true);
        fx.D.spawn('ring', hx, hy, hz, 0.2, 1.8, 0.3, 0xffffff, 0, 0, 0.9, true);
        this.eff.glow(1.6, 0.2, 0xffffff, 0x6fb4ff, 1, 1.5);
        fx.post.screenFlash(0xd8ecff, 0.22, 10);
        fx.O.spawn('mugen', hx, hy + 0.6, hz, 1.25, 0.9);
        if (ev.tag === 'sixEyes' || ev.tag === 'sixEyesRead') this.sixEyesGlint(ev.player, 1.6);
        break;
      }
      case 'formChange': this.formChange(ev, state); break;
      case 'summon':
      case 'summonDispel': {
        const x = ev.pos.x / 1000, z = ev.pos.z / 1000;
        this.at(x, 1.0, z);
        this.eff.smokePuffs(ev.type === 'summon' ? 16 : 14, 2.4, 1.0, 0.75, 0xffffff, 0xd8d0c8, 0.85, 0.5);
        this.eff.smokePuffs(6, 1.2, 0.7, 0.6, 0xfff4e0, 0xbfb4a8, 0.7, 0.2);
        fx.D.spawn('ring', x, 1.0, z, 0.3, 2.2, 0.25, 0xffffff, 0, 0, 0.7, true);
        if (ev.type === 'summonDispel' && ev.tag === 'hit') this.eff.sparks(8, 5, 1.3, 0xffffff, 0x9fd8ff, 0.5, 0.3);
        fx.O.spawn('pon', x, 1.9, z, 0.75, 0.7);
        break;
      }
      case 'moveStart': this.moveStart(ev, state); break;
      case 'projectile': {
        if (ev.tag === 'detonate') this.detonate(ev, state);
        else if (ev.tag === 'hollow_purple') {
          v1.set(ev.pos.x / 1000, ev.pos.y / 1000, ev.pos.z / 1000);
          this.atV(v1);
          fx.post.screenFlash(0xffffff, 0.9, 2.5);
          fx.post.impact(3);
          fx.post.colorGrade(0x3a0a6a, 0.45, 1.6);
          fx.post.speedLines(1, 1.4, 0xe8c8ff);
          this.eff.shock(7, 0.6, 0xb04aff);
          this.eff.shock(4, 0.5, 0xffffff);
          this.eff.glow(6, 0.5, 0xffffff, 0xa040ff, 1, 1.6);
          fx.O.spawn('doom', v1.x, v1.y + 1.0, v1.z, 1.6, 1.4);
          fx.r.addShake(0.12, 40);
          this.trenchOn = true;
        } else if (ev.tag === 'rasenshuriken' || ev.tag === 'rasenshuriken_kurama') {
          v1.set(ev.pos.x / 1000, ev.pos.y / 1000, ev.pos.z / 1000);
          this.atV(v1);
          this.eff.elemental('wind', 1.2);
          fx.post.speedLines(0.5, 0.2, 0xd8f6ff);
        } else if (ev.tag === 'thunder_spear') {
          v1.set(ev.pos.x / 1000, ev.pos.y / 1000, ev.pos.z / 1000);
          this.atV(v1);
          this.eff.smokePuffs(6, 1.2, 0.5, 0.6, 0xe8e2d8, 0x8a847c, 0.6, 0.3);
        } else if (ev.tag === 'titan_roar') {
          this.bone(ev.player, 'head', v1);
          this.atV(v1);
          this.eff.smokePuffs(14, 2.6, 1.3, 1.2, 0xffffff, 0xc8beb4, 0.6, 0.8);
          this.eff.shock(5, 0.5, 0xffe0c0);
          fx.post.speedLines(0.8, 0.5, 0xffffff);
          fx.r.addShake(0.08, 30);
        }
        break;
      }
      case 'projectileHit': {
        const k = this.fxOf(state.fighters[ev.player].char, ev.moveId);
        if (k.startsWith('rasenshuriken')) this.shurikenHit(ev, true);
        break;
      }
      case 'hit': case 'counter': case 'ultimateHit': this.hitFlourish(ev, state, true); break;
      case 'block': this.hitFlourish(ev, state, false); break;
      case 'groundBounce': {
        if (ev.tag === 'gear5') {
          const x = ev.pos.x / 1000, z = ev.pos.z / 1000;
          this.at(x, 0.3, z);
          fx.D.spawn('ring', x, 0.06, z, 0.4, 4.2, 0.4, 0x2a1a20, 1, 0, 0.8, false);
          fx.D.spawn('ring', x, 0.5, z, 0.3, 3.0, 0.35, 0x2a1a20, 0, 0, 0.6, false, 0, 1, 0, 0.5);
          this.eff.smokePuffs(8, 2.2, 0.8, 0.6, 0xffffff, 0xfff0d8, 0.8, 0.3);
          fx.O.spawn('boing', x, 1.4, z, 1.1, 0.8);
        }
        break;
      }
      case 'awaken': {
        const f = state.fighters[ev.player];
        if (f.char === 'eren') this.lightningStrike(ev.player, 1);
        void P;
        break;
      }
      default: break;
    }
  }

  private realmStart(ev: SimEvent, state: GameState): void {
    const fx = this.fx;
    const kind = ev.tag ?? '';
    const c = REALM_COL[kind] ?? auraColor(state.fighters[ev.player].char);
    this.chest(ev.player, v1);
    this.atV(v1);
    fx.post.screenFlash(0xffffff, 0.6, 4);
    fx.post.speedLines(0.9, 0.5, kind === 'gear_fifth' ? 0x101010 : 0xffffff);
    fx.post.vignettePulse(1);
    fx.post.colorGrade(REALM_GRADE[kind] ?? 0x202040, kind === 'gear_fifth' ? 0.12 : 0.28, 1.6);
    if (state.realm && state.realm.phase === 'cine') fx.post.letterbox(0.11);
    this.eff.shock(12, 1.0, c, true);
    this.eff.shock(8, 0.8, 0xffffff, true, 0.7);
    this.eff.shock(6, 0.7, c);
    this.eff.glow(7, 0.6, 0xffffff, c, 1, 1.5);
    this.eff.sparks(50, 12, 1.5, 0xffffff, c, 1.0, 1.0, -1, 1.2);
    fx.O.spawn('rv_' + kind, v1.x, v1.y + 1.3, v1.z, 1.9, 1.9);
    fx.r.addShake(0.08, 40);
    if (kind === 'paths') this.lightningStrike(ev.player, 0.8);
    this.beatT = 0;
  }

  private formChange(ev: SimEvent, state: GameState): void {
    const fx = this.fx;
    const form = ev.tag ?? 'base';
    const f = state.fighters[ev.player];
    this.chest(ev.player, v1);
    this.atV(v1);
    const fa = formAura(f);
    const col = fa ? fa.col : auraColor(f.char);
    const sword = form === 'santoryu' || form === 'ittoryu' || form === 'nitoryu';
    if (form === 'titan') {
      this.lightningStrike(ev.player, 1.2);
    } else if (sword) {
      // quick sheath flash: crossing green slashes
      for (let k = 0; k < (form === 'santoryu' ? 3 : form === 'nitoryu' ? 2 : 1); k++)
        fx.D.spawn('crescent', v1.x, v1.y, v1.z, 1.0, 2.4, 0.22, 0xb8ffd0, 0, -0.8 + k * 0.8, 0.9, true, 0, 1, 0, 1);
      this.eff.sparks(10, 6, 1.2, 0xffffff, 0x3fd17a, 0.5, 0.3);
    } else if (form !== 'base') {
      fx.post.screenFlash(col, 0.35, 5);
      fx.post.speedLines(0.8, 0.5, col === 0xffffff ? 0x202020 : 0xffffff);
      this.eff.shock(5, 0.55, col, true);
      this.eff.shock(3.5, 0.45, 0xffffff);
      this.eff.glow(4, 0.4, 0xffffff, col, 1, 1.4);
      this.eff.sparks(30, 9, 1.4, 0xffffff, col, 0.8, 0.8, -2, 1.4);
      if (form === 'gear2' || form === 'gear4' || form === 'gear5') this.eff.smokePuffs(14, 2.4, 1.0, 1.0, 0xffffff, 0xffd8e0, 0.6, 1.2);
      fx.r.addShake(0.05, 12);
    } else {
      this.eff.smokePuffs(8, 1.6, 0.8, 0.8, 0xf0ece8, 0xa8a09a, 0.5, 0.8);
    }
    if (form !== 'base' && ev.player !== undefined) fx.O.spawn('fm_' + form, v1.x, v1.y + 1.2 * (form === 'titan' ? 2.2 : 1), v1.z, sword ? 1.0 : 1.3, 1.1);
  }

  private moveStart(ev: SimEvent, state: GameState): void {
    const f = state.fighters[ev.player];
    const k = this.fxOf(f.char, ev.moveId);
    const fx = this.fx;
    if (!k) return;
    if (k === 'void_blink') {
      this.chest(ev.player, v1);
      this.atV(v1);
      fx.D.spawn('hex', v1.x, v1.y, v1.z, 0.4, 2.6, 0.35, 0x8fb8ff, 0, rr(0, 6), 0.9, true);
      this.eff.glow(1.8, 0.2, 0xffffff, 0x5a7cff, 1);
      this.eff.ghosts(f.pos.x / 1000, f.pos.z / 1000, f.pos.x / 1000, f.pos.z / 1000, 0x7f9cff, 2, 0.35);
    } else if (k === 'six_eyes_glint' || k === 'lions_song_stance' || k === 'hardening') {
      if (k === 'six_eyes_glint') this.sixEyesGlint(ev.player, 1.3);
      else if (k === 'lions_song_stance') { this.bone(ev.player, 'handR', v1); this.atV(v1); this.eff.star(1.2, 0.18, 0xd8ffe8, 0.0, 1); }
      else { this.bone(ev.player, 'handR', v1); this.atV(v1); this.crystals(v1, 10, 0.6); }
    } else if (k === 'clone_smoke' || k === 'clone_rush' || k === 'clone_barrage') {
      this.chest(ev.player, v1);
      this.atV(v1);
      this.eff.smokePuffs(8, 1.6, 0.8, 0.6, 0xffffff, 0xd8d0c8, 0.6, 0.4);
      if (k !== 'clone_smoke') fx.post.speedLines(0.7, 0.4, 0xffffff);
    } else if (k === 'infinite_void' || k === 'tailed_beast_bomb' || k === 'king_of_hell' || k === 'gear_fifth' || k === 'paths') {
      // hand sign charge-up before the realm opens
      this.chest(ev.player, v1);
      this.atV(v1);
      const c = REALM_COL[k] ?? 0xffffff;
      this.eff.glow(3, 0.35, 0xffffff, c, 1);
      this.eff.shock(3, 0.4, c, true);
      fx.post.vignettePulse(0.8);
    } else if (k === 'odm_grapple') {
      const s = this.ps[ev.player]!;
      this.facing(ev.player, v2);
      s.wireAnchor.set(f.pos.x / 1000 + v2.x * 7, 4.5, f.pos.z / 1000 + v2.z * 7);
      s.wireK = 1;
      this.bone(ev.player, 'hips', v1);
      this.atV(v1);
      this.eff.smokePuffs(8, 1.8, 0.5, 0.5, 0xffffff, 0xd0d4dc, 0.7, 0.2);
    } else if (k === 'titan_roar') {
      fx.post.vignettePulse(0.8);
    }
  }

  /** big hit / block flourishes keyed by the attacker's move fx hint (crossover moves only) */
  private hitFlourish(ev: SimEvent, state: GameState, hit: boolean): void {
    const fx = this.fx;
    const atk = state.fighters[ev.player];
    const k = this.fxOf(atk.char, ev.moveId);
    const x = ev.pos.x / 1000, y = Math.max(0.3, ev.pos.y / 1000), z = ev.pos.z / 1000;
    if (ev.tag === 'echo') {
      // Asura echo slash: ghost-green crossing arcs
      fx.D.spawn('crescent', x, y, z, 1.2, 3.0, 0.3, 0x6fffb0, 0, rr(-1, 1), 0.85, true);
      fx.D.spawn('crescent', x, y, z, 1.0, 2.6, 0.3, 0xffffff, 0, rr(-1, 1), 0.6, true);
      return;
    }
    if (ev.tag === 'clone') {
      this.at(x, y, z);
      this.eff.smokePuffs(3, 1.0, 0.4, 0.4, 0xffffff, 0xd8d0c8, 0.5, 0.2);
    }
    if (!k) return;
    const sc = hit ? 1 : 0.55;
    this.at(x, y, z);
    if (k.startsWith('rasengan')) {
      const big = k === 'rasengan_giant' ? 1.7 : k === 'rasengan_kurama' ? 1.35 : 1;
      const col = k === 'rasengan_kurama' ? 0xffb020 : 0x6fc8ff;
      fx.D.spawn('spiral', x, y, z, 0.8 * big, 3.2 * big * sc, 0.45, col, 0, rr(0, 6), 1, true, 0, 1, 0, 1, 18);
      fx.D.spawn('spiral', x, y, z, 0.5 * big, 2.2 * big * sc, 0.4, 0xffffff, 0, rr(0, 6), 0.8, true, 0, 1, 0, 1, -24);
      this.eff.elemental('wind', 1.3 * big * sc);
      if (hit) { this.eff.shock(4 * big, 0.4, col); fx.post.speedLines(0.6, 0.25, 0xffffff); fx.r.addShake(0.06 * big, 10); }
    } else if (k.startsWith('rasenshuriken')) {
      this.shurikenHit(ev, false);
    } else if (k.startsWith('red_blast')) {
      const big = k === 'red_blast_max' ? 1.4 : 1;
      fx.D.spawn('ring', x, y, z, 0.4, 4.5 * big * sc, 0.35, 0xff3a2a, 0, 0, 1, true);
      fx.D.spawn('star', x, y, z, 1.5, 3.6 * big * sc, 0.22, 0xff2a1a, 0, rr(0, 6), 1, true);
      this.eff.glow(3 * big * sc, 0.25, 0xff8a7a, 0xff1a0a, 1, 1.5);
      this.eff.sparks(30 * sc, 12, 1.5, 0xffffff, 0xff3a1a, 0.9, 0.5, 1);
      if (hit) { fx.post.screenFlash(0xff4a3a, 0.25, 7); fx.r.addShake(0.08, 10); }
    } else if (k.startsWith('blue_orb')) {
      this.eff.elemental('void', 1.3 * sc);
    } else if (k.startsWith('hollow_purple')) {
      fx.D.spawn('ring', x, y, z, 0.6, 5 * sc, 0.4, 0xb04aff, 0, 0, 1, true);
      this.eff.glow(4 * sc, 0.3, 0xffffff, 0xa040ff, 1, 1.6);
      this.eff.sparks(24 * sc, 12, 1.5, 0xffffff, 0xb04aff, 1, 0.5, 0);
    } else if (k === 'oni_giri' || k === 'rengoku' || k === 'sanzen_sekai' || k === 'lions_song') {
      // triple cross slash
      const n = k === 'lions_song' ? 1 : 3;
      for (let i = 0; i < n; i++) {
        const roll = n === 1 ? 1.57 : -0.7 + i * 0.7;
        fx.D.spawn('crescent', x, y, z, 1.4, 3.8 * sc, 0.32, 0xd8ffe8, 0, roll, 1, true);
        fx.D.spawn('crescent', x, y, z, 1.0, 4.4 * sc, 0.36, 0x3fd17a, 0, roll + 0.06, 0.8, true);
      }
      this.eff.star(2.4 * sc, 0.16, 0xffffff, 0, 1);
      if (hit) { fx.post.impact(2); fx.O.spawn('zan', x, y + 0.7, z, 1.3, 0.9); fx.r.addShake(0.07, 10); }
    } else if (k === 'asura') {
      for (let i = 0; i < 3; i++) fx.D.spawn('crescent', x, y, z, 1.2, 4 * sc, 0.3, i ? 0x6fffb0 : 0xffffff, 0, rr(-1.2, 1.2), 0.9, true);
    } else if (k === 'tatsumaki' || k === 'pound_cannon' || k.startsWith('blade_')) {
      if (atk.char === 'zoro') fx.D.spawn('crescent', x, y, z, 1.0, 2.6 * sc, 0.22, 0x8fffc0, 0, rr(-1, 1), 0.7, true);
    } else if (k === 'kong_gun' || k === 'king_kong_gun' || k === 'bajrang_gun' || k === 'elephant_gun' || k === 'leo_bazooka') {
      const big = k === 'bajrang_gun' ? 2 : k === 'king_kong_gun' ? 1.6 : 1.2;
      fx.D.spawn('ring', x, y, z, 0.5, 6 * big * sc, 0.45, 0xffffff, 0, 0, 1, true, 0, 1, 0, 0.7);
      fx.D.spawn('star', x, y, z, 2, 5 * big * sc, 0.25, 0xffe0c0, 0, rr(0, 6), 1, true);
      this.eff.smokePuffs(10 * big, 3, 1.2, 0.8, 0xffffff, 0xd8c8c0, 0.6, 0.3);
      if (hit) { fx.post.impact(3); fx.r.addShake(0.1 * big, 16); fx.O.spawn('doka', x, y + 0.9, z, 1.4 * Math.min(1.4, big), 1.0); }
    } else if (k === 'gum_pistol' || k === 'jet_pistol' || k === 'gum_rocket' || k === 'gum_bell' || k === 'red_hawk' || k === 'gum_gatling') {
      if (hit) fx.D.spawn('ring', x, y, z, 0.3, 2.6, 0.24, 0xffffff, 0, 0, 0.9, true, 0, 1, 0, 0.6);
      if (k === 'jet_pistol') this.eff.smokePuffs(4, 1.4, 0.5, 0.5, 0xffffff, 0xffd8e0, 0.6, 0.6);
    } else if (k === 'hardened_punch' || k === 'titan_hardening') {
      this.crystals(v1.set(x, y, z), 18 * sc, 1.2);
      if (hit) fx.r.addShake(0.08, 12);
    } else if (k.startsWith('titan_') || k === 'titan_army_stomp') {
      const big = k === 'titan_army_stomp' || k === 'titan_smash' ? 2 : 1.2;
      this.eff.dustRing(x, z, 16 * big, 5 * big, 1.2 * big, 1.0);
      fx.D.spawn('ring', x, 0.06, z, 0.5, 6 * big, 0.5, 0xffe0c0, 1, 0, 0.8, true);
      this.at(x, y, z);
      this.eff.smokePuffs(8 * big, 2, 1.2 * big, 1.0, 0xffffff, 0xc8beb4, 0.5, 1.0);
      if (hit) fx.r.addShake(0.08 * big, 16);
    } else if (k === 'tailed_beast_bomb_blast') {
      this.at(x, y, z);
      fx.post.screenFlash(0xffffff, 1, 2);
      fx.post.impact(3);
      fx.post.colorGrade(0x5a0a2a, 0.4, 1.2);
      this.eff.glow(12, 0.8, 0xffffff, 0x8a2aff, 1, 1.6);
      this.eff.shock(16, 1.1, 0x9a3aff);
      this.eff.shock(12, 1.0, 0xffffff, true);
      this.eff.sparks(80, 18, 1.5, 0xffffff, 0xb05aff, 1.4, 1.2, 1);
      this.eff.smokePuffs(30, 6, 2.5, 2.0, 0x3a1a4a, 0x0a0410, 0.7, 1.2);
      fx.O.spawn('doka', x, y + 1.5, z, 1.9, 1.4);
      fx.r.addShake(0.22, 50);
    } else if (k === 'chakra_arm') {
      fx.D.spawn('crescent', x, y, z, 2, 5 * sc, 0.35, 0xffb020, 0, rr(-0.4, 0.4), 1, true);
      this.eff.elemental('fire', 0.8 * sc);
    } else if (k.startsWith('odm_')) {
      fx.D.spawn('crescent', x, y, z, 0.8, 2.2 * sc, 0.2, 0xd8f0ff, 0, rr(-1, 1), 0.8, true);
    }
  }

  private shurikenHit(ev: SimEvent, final: boolean): void {
    const fx = this.fx;
    const x = ev.pos.x / 1000, y = Math.max(0.5, ev.pos.y / 1000), z = ev.pos.z / 1000;
    this.at(x, y, z);
    fx.D.spawn('star', x, y, z, 1.2, final ? 5 : 2.8, 0.18, 0xffffff, 0, rr(0, 6), 1, true);
    fx.D.spawn('shuriken', x, y, z, 1.0, final ? 6 : 3.2, final ? 0.6 : 0.3, 0xbff0ff, 0, rr(0, 6), 0.9, true, 0, 1, 0, 1, 20);
    this.eff.elemental('wind', final ? 2.0 : 1.0);
    fx.post.screenFlash(0xe8f8ff, final ? 0.5 : 0.18, final ? 4 : 10);
    if (final) {
      this.eff.glow(7, 0.6, 0xffffff, 0x6fd8ff, 1, 1.6);
      this.eff.shock(9, 0.8, 0xbff6ff);
      this.eff.sparks(50, 14, 1.5, 0xffffff, 0x6fd8ff, 1.1, 0.8, 0);
      fx.post.impact(3);
      fx.r.addShake(0.14, 24);
    } else fx.r.addShake(0.04, 6);
  }

  private crystals(p: THREE.Vector3, n: number, k: number): void {
    const P = this.fx.P;
    for (let i = 0; i < this.n(n); i++) {
      randDir();
      const sp = rr(2, 6) * k;
      P.spec.reset().at(p.x, p.y, p.z).v(PR.dx * sp, PR.dy * sp + 1, PR.dz * sp).ph(1, 9)
        .ttl(rr(0.5, 0.9)).tx(T.SHARD).sz(rr(0.08, 0.2) * k, rr(0.05, 0.12) * k).rt(rr(0, 6), rr(-10, 10)).col(0xe8fbff, 0x7ad0ff, 1, 0, 1.4);
      P.spec.pe = 6;
      P.emit(true);
    }
    this.atV(p);
    this.eff.glow(1.4 * k, 0.2, 0xffffff, 0x8fe0ff, 0.9);
  }

  private sixEyesGlint(p: 0 | 1, k: number): void {
    this.bone(p, 'head', v1);
    this.facing(p, v2);
    v1.addScaledVector(v2, 0.1);
    v3.set(-v2.z, 0, v2.x);
    for (const sgn of [-1, 1]) {
      v4.copy(v1).addScaledVector(v3, 0.035 * sgn);
      this.fx.D.spawn('star', v4.x, v4.y, v4.z, 0.3 * k, 0.9 * k, 0.35, 0x8fe0ff, 0, sgn * 0.3, 1, true);
    }
    this.atV(v1);
    this.eff.glow(0.8 * k, 0.25, 0xffffff, 0x4ac8ff, 1, 1.6);
  }

  /** lightning bolt from the sky onto a fighter + blast ring + steam (Eren's transformation, Paths) */
  private lightningStrike(p: 0 | 1, k: number): void {
    const f = this.state!.fighters[p];
    const fx = this.fx;
    const x = f.pos.x / 1000, z = f.pos.z / 1000;
    v1.set(x + rr(-1, 1), 30, z + rr(-1, 1));
    v2.set(x, 0.05, z);
    this.bolt(v1, v2, 0.55 * k, 0.6, 0xfff27a);
    v1.set(x + rr(-6, 6), 26, z + rr(-4, 4));
    this.bolt(v1, v2, 0.25 * k, 0.4, 0xffe04a);
    this.at(x, 1.0, z);
    fx.post.screenFlash(0xfff8c0, 0.9 * k, 2.5);
    fx.post.impact(3);
    this.eff.shock(10 * k, 0.8, 0xffd21a, true);
    this.eff.shock(6 * k, 0.6, 0xffffff, true);
    this.eff.glow(8 * k, 0.5, 0xffffff, 0xffd21a, 1, 1.8);
    this.eff.sparks(40, 14, 1.4, 0xffffff, 0xffd21a, 1, 0.6, 3);
    this.eff.smokePuffs(26 * k, 4, 2.2, 2.2, 0xffffff, 0xd8ccc0, 0.65, 2.2);
    this.eff.dustRing(x, z, 18, 7, 1.4, 1.1);
    fx.O.spawn('doom', x, 3.2, z, 1.7, 1.2);
    fx.r.addShake(0.18, 36);
  }

  private detonate(ev: SimEvent, state: GameState): void {
    const fx = this.fx;
    const x = ev.pos.x / 1000, y = Math.max(0.4, ev.pos.y / 1000), z = ev.pos.z / 1000;
    let R = 0.48;
    for (const p of state.projectiles) if (p.blastR && Math.abs(p.pos.x - ev.pos.x) < 50 && Math.abs(p.pos.z - ev.pos.z) < 50) R = p.blastR / 1000;
    this.at(x, y, z);
    this.eff.elemental('fire', 1.6);
    this.eff.glow(R * 9, 0.35, 0xffffff, 0xffa020, 1, 1.7);
    this.eff.star(R * 7, 0.2, 0xfff0a0, rr(0, 6), 1);
    fx.D.spawn('ring', x, y, z, R, R * 6, 0.35, 0xffd060, 0, 0, 1, true);
    this.eff.sparks(30, 12, 1.5, 0xffffff, 0xffc020, 0.9, 0.6, 6);
    this.eff.smokePuffs(14, 2.4, 1.2, 1.4, 0x5a4a3a, 0x181210, 0.7, 0.8);
    v1.set(x, y, z);
    for (let i = 0; i < 2; i++) { v2.set(x + rr(-1.2, 1.2), y + rr(-0.6, 1), z + rr(-1.2, 1.2)); this.bolt(v1, v2, 0.08, 0.2, 0xffe86a); }
    fx.post.screenFlash(0xffd8a0, 0.3, 7);
    fx.r.addShake(0.08, 12);
    fx.O.spawn('doka', x, y + 0.9, z, 1.1, 0.8);
  }

  // ------------------------------------------------------------------------------------------- per frame
  update(dt: number, state: GameState): void {
    this.state = state;
    this.time += dt;
    for (const b of this.bolts) b.update(dt, this.fx.cam);
    for (let i = 0; i < 2; i++) this.updatePlayer(i as 0 | 1, state, dt);
    this.updateTrench(state, dt);
    this.updateRealm(state, dt);
  }

  private updatePlayer(p: 0 | 1, state: GameState, dt: number): void {
    const s = this.ps[p]!;
    const f = state.fighters[p];
    const fx = this.fx, P = fx.P;
    const sc = fx.scale;
    // ---- current move + fx hint
    if (f.moveId !== s.moveId) {
      s.moveId = f.moveId; s.lastFrame = -1;
      s.def = null; s.fx = '';
      if (f.moveId) { s.def = lookupMove(f.char, f.moveId); s.fx = s.def?.fx ?? ''; }
    }
    const def = s.def, k = s.fx, mf = f.moveFrame;
    const attacking = f.mode === 'attack' && !!def;
    const active = attacking && mf >= def!.startup && mf < def!.startup + def!.active;
    const enterActive = attacking && s.lastFrame < def!.startup && mf >= def!.startup;
    s.lastFrame = attacking ? mf : -1;
    const tm = this.time;

    // ---- hand orbs (Rasengan, Blue / Red charge, Hollow Purple merge)
    let orbA = false, orbB = false;
    if (attacking) {
      const spawn = def!.projectile ? def!.projectile.spawnFrame : def!.startup + def!.active;
      if (k.startsWith('rasengan')) {
        const big = k === 'rasengan_giant' ? 2.2 : k === 'rasengan_kurama' ? 1.4 : 1;
        if (mf >= 3 && mf < def!.startup + def!.active + 2) {
          orbA = true;
          this.bone(p, 'handR', v1);
          this.facing(p, v2);
          v1.addScaledVector(v2, 0.12 * big);
          this.placeOrb(s.orbA, v1, 0.2 * big * Math.min(1, (mf - 2) / 6), k === 'rasengan_kurama' ? 0xffb020 : 0x4ab8ff, k === 'rasengan_kurama' ? 0xffe070 : 0x9fe0ff, tm);
          s.acc += dt * 50 * sc;
          while (s.acc >= 1) {
            s.acc -= 1;
            randDir();
            const d = 0.35 * big;
            P.spec.reset().at(v1.x + PR.dx * d, v1.y + PR.dy * d, v1.z + PR.dz * d).v(-PR.dz * 6 * big, PR.dy, PR.dx * 6 * big).ph(4, 0)
              .ttl(0.15).tx(T.STREAK, 0.04).sz(0.03, 0.01, 0.2, 0.05).col(0xffffff, k === 'rasengan_kurama' ? 0xffb020 : 0x6fd0ff, 1, 0, 1.5);
            P.emit(true);
          }
        }
      } else if ((k === 'blue_orb' || k === 'blue_orb_max') && mf < spawn) {
        orbA = true;
        this.bone(p, 'handR', v1);
        this.placeOrb(s.orbA, v1, 0.15 * Math.min(1, mf / 10) * (k === 'blue_orb_max' ? 1.4 : 1), 0x1a2a8a, 0x6fb4ff, tm);
      } else if ((k === 'red_blast' || k === 'red_blast_max') && mf < Math.max(spawn, def!.startup + 1)) {
        orbA = true;
        this.bone(p, 'handR', v1);
        this.placeOrb(s.orbA, v1, 0.13 * Math.min(1, (mf + 2) / 8), 0xff2a1a, 0xffc0a0, tm);
      } else if (k.startsWith('hollow_purple') && mf < spawn + 2) {
        // blue (left) and red (right) converge in front of the chest, merge into purple at the spawn frame
        const t = Math.min(1, Math.max(0, (mf - spawn * 0.45) / (spawn * 0.5)));
        const e = t * t * (3 - 2 * t);
        this.chest(p, v3);
        this.facing(p, v2);
        v3.addScaledVector(v2, 0.55);
        this.bone(p, 'handL', v1); v1.lerp(v3, e);
        this.bone(p, 'handR', v4); v4.lerp(v3, e);
        const r0 = 0.12 + 0.06 * Math.min(1, mf / 12);
        orbA = orbB = true;
        this.placeOrb(s.orbA, v1, r0, 0x1a2a8a, 0x6fb4ff, tm);
        this.placeOrb(s.orbB, v4, r0, 0xff2a1a, 0xffc0a0, tm + 1);
        if (t > 0) fx.post.colorGrade(0x2a0a4a, 0.3 * e, 0.1);
        if (t > 0.2) fx.post.letterbox(0.06);
        // energy arcs between the two
        if (e > 0.4 && Math.random() < 0.3) this.bolt(v1, v4, 0.04, 0.08, 0xd08aff);
        s.acc += dt * 60 * sc;
        while (s.acc >= 1) {
          s.acc -= 1;
          const src = Math.random() < 0.5 ? v1 : v4;
          randDir();
          P.spec.reset().at(src.x + PR.dx * 0.5, src.y + PR.dy * 0.5, src.z + PR.dz * 0.5).v(-PR.dx * 2.5, -PR.dy * 2.5, -PR.dz * 2.5).ph(0, 0)
            .ttl(0.2).tx(T.STREAK, 0.05).sz(0.03, 0.01, 0.2, 0.05).col(0xffffff, src === v1 ? 0x4a6cff : 0xff3a4a, 1, 0, 1.6);
          P.emit(true);
        }
        if (mf === spawn - 1) fx.post.letterbox(0);
      }
    }
    if (!orbA) s.orbA.g.visible = false;
    if (!orbB) s.orbB.g.visible = false;

    // ---- active-frame flourishes (once, at the first active frame)
    if (enterActive) this.onActive(p, f, k, def!);

    // ---- continuous move effects
    // Gatling: blurred fist afterimages
    if (active && (k === 'gum_gatling' || k === 'leo_bazooka' || k === 'odm_barrage' || k === 'clone_barrage')) {
      const n = k === 'gum_gatling' ? 140 : 70;
      s.acc2 += dt * n * sc;
      this.chest(p, v3);
      this.facing(p, v2);
      v4.set(-v2.z, 0, v2.x);
      while (s.acc2 >= 1) {
        s.acc2 -= 1;
        const reach = rr(0.6, 1.5);
        const lat = rr(-0.45, 0.45), up = rr(-0.35, 0.3);
        const px = v3.x + v2.x * reach + v4.x * lat, py = v3.y + up, pz = v3.z + v2.z * reach + v4.z * lat;
        const c = k === 'gum_gatling' ? 0xffe0d0 : k === 'odm_barrage' ? 0xd8f0ff : 0xffd8a0;
        P.spec.reset().at(px, py, pz).ttl(rr(0.06, 0.12)).tx(T.SOFT).sz(0.32, 0.22).col(0xffffff, c, 0.85, 0, 1.2);
        P.emit(true);
        P.spec.reset().at(px - v2.x * 0.3, py, pz - v2.z * 0.3).v(v2.x * 8, 0, v2.z * 8).ttl(0.08).tx(T.STREAK, 0.02).sz(0.12, 0.05, 0.6, 0.3).col(0xffffff, c, 0.7, 0, 1.1);
        P.emit(true);
      }
      if ((this.time * 30 | 0) % 3 === 0) fx.post.speedLines(0.35, 0.05, 0xffffff);
    }
    // stretch moves: speed streak along the arm to the fist
    if (active && (k === 'gum_pistol' || k === 'jet_pistol' || k === 'gum_rocket' || k === 'kong_gun' || k === 'red_hawk' || k === 'elephant_gun' || k === 'king_kong_gun' || k === 'bajrang_gun')) {
      this.bone(p, 'handR', v1);
      this.chest(p, v3);
      s.acc2 += dt * 60 * sc;
      while (s.acc2 >= 1) {
        s.acc2 -= 1;
        const t = Math.random();
        P.spec.reset().at(v3.x + (v1.x - v3.x) * t, v3.y + (v1.y - v3.y) * t + rr(-0.08, 0.08), v3.z + (v1.z - v3.z) * t)
          .v((v1.x - v3.x) * 4, 0, (v1.z - v3.z) * 4).ttl(0.1).tx(T.STREAK, 0.03).sz(0.05, 0.02, 0.4, 0.2).col(0xffffff, 0xffd0d8, 0.8, 0, 1.2);
        P.emit(true);
      }
      const giant = k === 'kong_gun' || k === 'king_kong_gun' || k === 'bajrang_gun' || k === 'elephant_gun';
      if (giant) {
        // giant fist glow (haki-dark core + hot rim)
        const R = k === 'bajrang_gun' ? 2.6 : k === 'king_kong_gun' ? 1.8 : 1.1;
        this.placeOrb(s.orbB, v1, R * 0.35, 0x2a0a10, 0xff3a2a, tm);
        s.orbB.g.visible = true;
      }
      if (k === 'red_hawk') { this.atV(v1); if (Math.random() < 0.6) this.eff.elemental('fire', 0.35); }
    }
    // Tatsumaki tornado column
    const torn = attacking && (k === 'tatsumaki') && mf >= def!.startup - 2 && mf < def!.startup + def!.active + 10;
    s.tornK += ((torn ? 1 : 0) - s.tornK) * Math.min(1, dt * 10);
    if (s.tornK > 0.02) {
      const m = s.tornado;
      m.visible = true;
      m.position.set(f.pos.x / 1000, f.pos.y / 1000 + 1.6, f.pos.z / 1000);
      m.rotation.y -= dt * 14;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.85 * s.tornK;
      mat.map!.offset.y = (mat.map!.offset.y - dt * 2.5) % 1;
      m.scale.set(0.6 + s.tornK * 0.6, 0.5 + s.tornK * 0.7, 0.6 + s.tornK * 0.6);
      s.acc2 += dt * 60 * sc * s.tornK;
      while (s.acc2 >= 1) {
        s.acc2 -= 1;
        const a = rr(0, 6.28), rad = rr(0.4, 1.3), h = rr(0, 3.2);
        P.spec.reset().at(f.pos.x / 1000 + Math.cos(a) * rad, h, f.pos.z / 1000 + Math.sin(a) * rad).v(-Math.sin(a) * 9, rr(1, 4), Math.cos(a) * 9).ph(3, 0)
          .ttl(rr(0.15, 0.3)).tx(T.STREAK, 0.05).sz(0.05, 0.01, 0.5, 0.1).col(0xffffff, 0x6fffb0, 1, 0, 1.5);
        P.emit(true);
      }
    } else s.tornado.visible = false;
    // ODM wire
    if (s.wireK > 0) {
      const grappling = attacking && k === 'odm_grapple';
      if (!grappling) s.wireK = Math.max(0, s.wireK - dt * 6);
      this.bone(p, 'hips', v1);
      const w = s.wire;
      w.visible = s.wireK > 0.05;
      v2.subVectors(s.wireAnchor, v1);
      const L = v2.length() * Math.min(1, s.wireK * 1.2);
      v2.normalize();
      w.position.copy(v1).addScaledVector(v2, L / 2);
      w.quaternion.setFromUnitVectors(_Y, v2);
      w.scale.set(1, L, 1);
      if (grappling && Math.random() < 0.6 * sc) {
        P.spec.reset().at(v1.x, v1.y, v1.z).v(-v2.x * 3 + rr(-0.5, 0.5), rr(-0.2, 0.6), -v2.z * 3 + rr(-0.5, 0.5)).ph(2.5, -0.2)
          .ttl(rr(0.3, 0.5)).tx(T.SMOKE).sz(0.15, 0.6).rt(rr(0, 6), rr(-1, 1)).col(0xffffff, 0xc8ccd4, 0.6, 0);
        P.emit(false);
      }
    }
    // Asura glyph afterimage (ultimate, plus a faint flicker while Zoro is awakened)
    const asura = (attacking && k === 'asura') ? 1 : (f.char === 'zoro' && f.awakened ? 0.28 : 0);
    s.glyphK += (asura - s.glyphK) * Math.min(1, dt * 6);
    if (s.glyphK > 0.02) {
      const g = s.glyph;
      g.visible = true;
      this.chest(p, v1);
      this.facing(p, v2);
      g.position.copy(v1).addScaledVector(v2, -0.35);
      g.position.y += 0.25;
      const fl = 0.75 + 0.25 * Math.sin(tm * 23) * Math.sin(tm * 7);
      g.scale.setScalar(2.9 + Math.sin(tm * 2) * 0.1);
      (g.material as THREE.SpriteMaterial).opacity = s.glyphK * fl;
      if (asura >= 1 && Math.random() < 0.25) {
        fx.D.spawn('crescent', v1.x + rr(-1, 1), v1.y + rr(-0.6, 0.8), v1.z + rr(-1, 1), 1, 3, 0.18, Math.random() < 0.5 ? 0x6fffb0 : 0xffffff, 0, rr(-1.5, 1.5), 0.8, true);
      }
    } else s.glyph.visible = false;

    // ---- forms
    if (f.form !== s.form) s.form = f.form ?? '';
    this.formFx(p, f, s, dt);

    // ---- Infinity shimmer
    const inf = f.char === 'gojo' && (f.infinity ?? 0) > 0 ? 1 : 0;
    s.infAmt += (inf - s.infAmt) * Math.min(1, dt * 4);
    s.infPulse = Math.max(0, s.infPulse - dt * 2.2);
    const show = s.infAmt + s.infPulse;
    if (show > 0.01) {
      const b = s.bubble;
      b.visible = true;
      this.chest(p, v1);
      b.position.copy(v1);
      b.position.y -= 0.15;
      const R = 1.05 + s.infPulse * 0.35 + Math.sin(tm * 3) * 0.02;
      b.scale.set(R * 0.9, R * 1.15, R * 0.9);
      const u = (b.material as THREE.ShaderMaterial).uniforms;
      u.uAmt!.value = Math.min(1.5, s.infAmt * 0.12 + s.infPulse * 1.3);
      u.uTime!.value = tm;
    } else s.bubble.visible = false;
  }

  /** one-shot flourishes on the first active frame of a move */
  private onActive(p: 0 | 1, f: FighterState, k: string, def: MoveDef): void {
    const fx = this.fx;
    if (!k) return;
    this.facing(p, v2);
    if (k === 'oni_giri' || k === 'sanzen_sekai' || k === 'lions_song' || k === 'rengoku') {
      this.chest(p, v1);
      // dash-through afterimages + crossing arcs where he lands
      const x = f.pos.x / 1000, z = f.pos.z / 1000;
      this.eff.ghosts(x - v2.x * 2, z - v2.z * 2, x, z, 0x3fd17a, 6, 0.4);
      const n = k === 'lions_song' ? 1 : 3;
      for (let i = 0; i < n; i++) fx.D.spawn('crescent', v1.x, v1.y, v1.z, 1.6, 3.6, 0.3, i === 1 ? 0xffffff : 0x8fffc0, 0, n === 1 ? 1.57 : -0.7 + i * 0.7, 0.95, true);
      fx.post.speedLines(0.8, 0.25, 0xffffff);
      if (k === 'lions_song') fx.post.screenFlash(0xffffff, 0.3, 10);
    } else if (k === 'pound_cannon') {
      this.bone(p, 'handR', v1);
      this.atV(v1);
      this.eff.glow(1.6, 0.18, 0xffffff, 0x3fd17a, 1);
      fx.D.spawn('crescent', v1.x, v1.y, v1.z, 1.2, 3, 0.2, 0xc8ffd8, 0, 0, 0.9, true);
    } else if (k.startsWith('blade_') || k === 'tatsumaki') {
      if (f.char !== 'zoro') return;
      // green-white arcs per sword style: three / two / one
      const cnt = f.form === 'ittoryu' ? 1 : f.form === 'nitoryu' ? 2 : 3;
      this.chest(p, v1);
      v1.addScaledVector(v2, 0.65);
      const base = k === 'blade_rise' || k === 'tatsumaki' ? 1.57 : k === 'blade_low' || k === 'blade_sweep' ? 0.2 : rr(-0.9, 0.9);
      if (k === 'blade_low' || k === 'blade_sweep') v1.y = 0.4;
      const big = f.form === 'ittoryu' ? 1.4 : 1;
      for (let i = 0; i < cnt; i++) {
        const off = (i - (cnt - 1) / 2) * 0.22;
        fx.D.spawn('crescent', v1.x, v1.y + off, v1.z, 1.0 * big, 2.5 * big, 0.2, i === 0 ? 0xffffff : 0x8fffc0, 0, base + off * 0.5, 0.85, true);
      }
    } else if (k.startsWith('odm_') && k !== 'odm_grapple') {
      this.chest(p, v1);
      v1.addScaledVector(v2, 0.6);
      fx.D.spawn('crescent', v1.x, v1.y, v1.z, 0.9, 2.2, 0.18, 0xd8f0ff, 0, rr(-1, 1), 0.8, true);
      fx.D.spawn('crescent', v1.x, v1.y, v1.z, 0.9, 2.0, 0.2, 0xffffff, 0, rr(-1, 1), 0.6, true);
    } else if (k.startsWith('red_blast')) {
      this.bone(p, 'handR', v1);
      this.atV(v1);
      const big = k === 'red_blast_max' ? 1.4 : 1;
      // expanding red shock sphere + radial streaks
      fx.D.spawn('ring', v1.x, v1.y, v1.z, 0.3, 3.4 * big, 0.3, 0xff3a2a, 0, 0, 1, true);
      fx.D.spawn('star', v1.x, v1.y, v1.z, 1.0, 3.0 * big, 0.2, 0xff2a1a, 0, rr(0, 6), 1, true);
      this.eff.glow(2.5 * big, 0.22, 0xff7a6a, 0xff1a0a, 1, 1.5);
      this.eff.sparks(26, 13, 1.6, 0xffffff, 0xff3a1a, 0.9, 0.4, 0);
      fx.post.screenFlash(0xff5a3a, 0.2, 9);
      fx.r.addShake(0.05, 8);
    } else if (k === 'gum_bell') {
      this.bone(p, 'head', v1);
      this.atV(v1);
      fx.D.spawn('ring', v1.x, v1.y, v1.z, 0.3, 2.4, 0.3, 0xffffff, 0, 0, 0.9, true, 0, 1, 0, 0.55);
    } else if (k === 'gum_rocket') {
      this.eff.ghosts(f.pos.x / 1000 - v2.x * 1.4, f.pos.z / 1000 - v2.z * 1.4, f.pos.x / 1000, f.pos.z / 1000, 0xff6a8a, 4, 0.3);
      fx.post.speedLines(0.6, 0.2, 0xffffff);
    } else if (k === 'titan_stomp' || k === 'titan_hammer' || k === 'titan_smash' || k === 'titan_charge' || k === 'titan_upper' || k === 'titan_swat' || k === 'titan_hook') {
      this.bone(p, k === 'titan_stomp' ? 'footR' : 'handR', v1);
      this.atV(v1);
      this.eff.smokePuffs(8, 2.2, 1.2, 0.9, 0xffffff, 0xc8beb4, 0.5, 0.8);
      if (k === 'titan_stomp' || k === 'titan_hammer' || k === 'titan_smash') { this.eff.dustRing(v1.x, v1.z, 14, 5, 1.2, 0.9); fx.r.addShake(0.07, 12); }
    } else if (k === 'thunder_spear') {
      this.bone(p, 'handR', v1);
      this.atV(v1);
      this.eff.smokePuffs(6, 1.4, 0.5, 0.6, 0xe8e2d8, 0x8a847c, 0.6, 0.3);
    } else if (k === 'chakra_arm') {
      this.chest(p, v1);
      v1.addScaledVector(v2, 1.2);
      fx.D.spawn('crescent', v1.x, v1.y, v1.z, 2.2, 5.5, 0.35, 0xffb020, 0, 0.2, 1, true);
    } else if (k.startsWith('void_') && k !== 'void_blink') {
      this.bone(p, 'handR', v1);
      fx.D.spawn('hex', v1.x, v1.y, v1.z, 0.15, 1.0, 0.2, 0x8fb0ff, 0, rr(0, 6), 0.6, true);
    } else if (k === 'wind_sweep' || k === 'wind_rise') {
      this.bone(p, 'footR', v1);
      this.atV(v1);
      this.eff.elemental('wind', 0.6);
    } else if (k === 'clone_kick_up') {
      this.chest(p, v1);
      this.atV(v1);
      this.eff.smokePuffs(5, 1.5, 0.5, 0.5, 0xffffff, 0xd8d0c8, 0.5, 0.2);
    } else if (k === 'jet_pistol') {
      this.bone(p, 'handR', v1);
      this.atV(v1);
      this.eff.smokePuffs(4, 1.6, 0.4, 0.4, 0xffffff, 0xffd8e0, 0.6, 0.6);
    }
    void def;
  }

  /** orb at a point. dark = normal-blended dark core with a hot rim (Blue / haki fist), else additive white-hot core */
  private placeOrb(o: HandOrb, at: THREE.Vector3, r: number, core: number, rim: number, tm: number): void {
    const dark = core === 0x1a2a8a || core === 0x2a0a10;
    o.g.visible = r > 0.005;
    o.g.position.copy(at);
    const m = o.core.material as THREE.ShaderMaterial;
    m.uniforms.uCore!.value.setHex(dark ? core : 0xffffff);
    m.uniforms.uRim!.value.setHex(dark ? rim : core);
    m.uniforms.uTime!.value = tm;
    const blend = dark ? THREE.NormalBlending : THREE.AdditiveBlending;
    if (m.blending !== blend) { m.blending = blend; m.needsUpdate = true; }
    o.core.scale.setScalar(r);
    o.d1.quaternion.copy(this.fx.cam.quaternion); o.d1.rotateZ(tm * 16); o.d1.scale.setScalar(r * 3.6);
    o.d2.quaternion.copy(this.fx.cam.quaternion); o.d2.rotateX(1.1); o.d2.rotateZ(-tm * 22); o.d2.scale.setScalar(r * 3.2);
    (o.d1.material as THREE.MeshBasicMaterial).color.setHex(dark ? rim : rim);
    (o.d2.material as THREE.MeshBasicMaterial).color.setHex(dark ? rim : core);
    o.glow.scale.setScalar(r * 7);
    o.glow.material.color.setHex(dark ? rim : core);
  }

  private formFx(p: 0 | 1, f: FighterState, s: PState, dt: number): void {
    const P = this.fx.P, sc = this.fx.scale;
    const form = f.form ?? '';
    const x = f.pos.x / 1000, y = f.pos.y / 1000, z = f.pos.z / 1000;
    const sword = form === 'santoryu' || form === 'ittoryu' || form === 'nitoryu';
    // sword-count hint: glowing points at the hands (+ mouth) = number of swords in this style
    for (let k = 0; k < 3; k++) {
      const b = s.blades[k]!;
      const on = sword && (form === 'santoryu' || (form === 'nitoryu' && k < 2) || (form === 'ittoryu' && k === 0));
      b.visible = on;
      if (!on) continue;
      this.bone(p, k === 0 ? 'handR' : k === 1 ? 'handL' : 'head', v1);
      if (k === 2) { this.facing(p, v2); v1.addScaledVector(v2, 0.12); v1.y -= 0.1; }
      b.position.copy(v1);
      const pulse = 0.85 + 0.15 * Math.sin(this.time * 8 + k * 2);
      b.scale.setScalar((f.mode === 'attack' ? 0.55 : 0.32) * pulse);
      b.material.opacity = f.awakened ? 1 : 0.75;
    }
    if (!form) return;
    s.ringT += dt;
    const tall = form === 'titan' ? 2.5 : 1;
    switch (form) {
      case 'six_eyes': {
        if (Math.random() < dt * 3) this.sixEyesGlint(p, 0.7);
        break;
      }
      case 'sage': case 'kurama': {
        const gold = form === 'kurama';
        s.acc += dt * (gold ? 50 : 14) * sc;
        while (s.acc >= 1) {
          s.acc -= 1;
          const a = rr(0, 6.28), rad = rr(0.25, gold ? 0.7 : 0.5);
          P.spec.reset().at(x + Math.cos(a) * rad, y + rr(0, gold ? 1.8 : 1.4), z + Math.sin(a) * rad).v(rr(-0.2, 0.2), rr(1.2, gold ? 3.5 : 1.8), rr(-0.2, 0.2)).ph(0.6, 0)
            .ttl(rr(0.4, 0.9)).tx(gold ? T.FLAME : T.SOFT).sz(gold ? 0.3 : 0.1, 0.04, gold ? 0.45 : -1, gold ? 0.1 : -1).col(gold ? 0xfff2a0 : 0xffc070, gold ? 0xff9a00 : 0xff6a10, 0.9, 0, 1.5);
          P.emit(true);
        }
        if (form === 'sage' && Math.random() < dt * 1.5) { this.bone(p, 'head', v1); this.atV(v1); this.eff.glow(0.5, 0.4, 0xffd080, 0xff7a10, 0.8); }
        break;
      }
      case 'gear2': case 'gear4': {
        // steam rising off the body
        s.acc += dt * (form === 'gear4' ? 26 : 18) * sc;
        while (s.acc >= 1) {
          s.acc -= 1;
          const a = rr(0, 6.28), rad = rr(0.15, 0.4) * (form === 'gear4' ? 1.4 : 1);
          P.spec.reset().at(x + Math.cos(a) * rad, y + rr(0.6, 1.6), z + Math.sin(a) * rad).v(rr(-0.2, 0.2), rr(0.8, 1.6), rr(-0.2, 0.2)).ph(1.2, -0.5)
            .ttl(rr(0.6, 1.1)).tx(T.SMOKE).sz(0.2, 0.7).rt(rr(0, 6), rr(-1, 1)).col(form === 'gear4' ? 0xffd8d0 : 0xffe8ec, 0xc8b8bc, 0.45, 0);
          P.emit(false);
        }
        break;
      }
      case 'gear5': {
        // white flowing aura: wisps streaming up and back like cloth / flame
        s.acc += dt * 34 * sc;
        while (s.acc >= 1) {
          s.acc -= 1;
          const a = rr(0, 6.28), rad = rr(0.25, 0.7);
          P.spec.reset().at(x + Math.cos(a) * rad, y + rr(0, 1.9), z + Math.sin(a) * rad).v(rr(-0.4, 0.4), rr(2, 4.5), rr(-0.4, 0.4)).ph(0.8, 0)
            .ttl(rr(0.4, 0.8)).tx(T.FLAME).sz(0.3, 0.06, 0.5, 0.12).rt(rr(-0.3, 0.3), 0).col(0xffffff, 0xfff0d0, 0.5, 0, 1.0);
          P.emit(true);
        }
        if (s.ringT > 0.9) { s.ringT = 0; this.fx.D.spawn('ring', x, 0.06, z, 0.5, 3.2, 0.45, 0xffffff, 1, 0, 0.4, true); }
        break;
      }
      case 'titan': {
        s.acc += dt * 24 * sc;
        while (s.acc >= 1) {
          s.acc -= 1;
          const a = rr(0, 6.28), rad = rr(0.2, 0.6) * tall;
          P.spec.reset().at(x + Math.cos(a) * rad, y + rr(0.5, 1.7) * tall, z + Math.sin(a) * rad).v(rr(-0.3, 0.3), rr(1, 2.2), rr(-0.3, 0.3)).ph(1, -0.6)
            .ttl(rr(0.8, 1.4)).tx(T.SMOKE).sz(0.4, 1.4).rt(rr(0, 6), rr(-1, 1)).col(0xfff4ee, 0xb8aca8, 0.5, 0);
          P.emit(false);
        }
        break;
      }
      default: break;
    }
  }

  private updateTrench(state: GameState, dt: number): void {
    let purple = null as null | typeof state.projectiles[number];
    for (const p of state.projectiles) if (p.kind.includes('purple')) { purple = p; break; }
    if (purple && this.trenchOn) {
      this.chest(purple.owner, v1);
      v2.set(purple.pos.x / 1000, 0.03, purple.pos.z / 1000);
      v1.y = 0.03;
      const L = v1.distanceTo(v2);
      this.trench.position.copy(v1).add(v2).multiplyScalar(0.5);
      this.trench.rotation.set(-Math.PI / 2, 0, -Math.atan2(v2.z - v1.z, v2.x - v1.x));
      this.trench.scale.set(L + 3, Math.max(1.6, purple.r / 1000 * 4), 1);
      this.trenchK = 1;
      this.trench.visible = true;
    } else {
      this.trenchOn = this.trenchOn && !!purple;
      if (this.trenchK > 0) {
        this.trenchK = Math.max(0, this.trenchK - dt * 0.6);
        this.trench.visible = this.trenchK > 0.01;
        if (Math.random() < this.trenchK * this.fx.scale) {
          const t = rr(-0.5, 0.5);
          const c = Math.cos(-this.trench.rotation.z), s = Math.sin(-this.trench.rotation.z);
          const px = this.trench.position.x + c * t * this.trench.scale.x * 0.8, pz = this.trench.position.z + s * t * this.trench.scale.x * 0.8;
          this.fx.P.spec.reset().at(px, 0.05, pz).v(rr(-0.2, 0.2), rr(0.6, 1.6), rr(-0.2, 0.2)).ph(1, -0.4).ttl(rr(0.6, 1.2)).tx(T.SOFT).sz(0.18, 0.02).col(0xe0b0ff, 0x7a2aff, 1, 0, 1.6);
          this.fx.P.emit(true);
        }
      }
    }
    (this.trench.material as THREE.MeshBasicMaterial).opacity = this.trenchK * (0.85 + Math.sin(this.time * 30) * 0.1);
  }

  private updateRealm(state: GameState, dt: number): void {
    const r = state.realm;
    const fx = this.fx, P = fx.P;
    const kind = r ? r.kind : null;
    const phase = r ? r.phase : null;
    if (phase !== this.realmPhase) {
      if (phase === 'cine') fx.post.letterbox(0.11);
      else fx.post.letterbox(0);
      this.realmPhase = phase;
    }
    this.realmKind = kind ?? this.realmKind;
    if (!r) return;
    const owner = r.owner, opp = (1 - owner) as 0 | 1;
    const fo = state.fighters[owner], fp = state.fighters[opp];
    const sc = fx.scale;
    if (r.phase === 'cine') {
      // charge: energy pulled into the owner, slow pulses
      this.realmAcc += dt * 60 * sc;
      const c = REALM_COL[r.kind] ?? 0xffffff;
      this.chest(owner, v1);
      while (this.realmAcc >= 1) {
        this.realmAcc -= 1;
        randDir();
        const d = rr(2, 4);
        P.spec.reset().at(v1.x + PR.dx * d, v1.y + PR.dy * d * 0.6, v1.z + PR.dz * d).v(-PR.dx * d * 2.5, -PR.dy * d * 1.5, -PR.dz * d * 2.5).ph(0, 0)
          .ttl(0.4).tx(T.STREAK, 0.08).sz(0.05, 0.01, 0.4, 0.1).col(0xffffff, c, 1, 0.2, 1.5);
        P.emit(true);
      }
      return;
    }
    this.beatT += dt;
    switch (r.kind) {
      case 'infinite_void': {
        // information overload around the frozen opponent (first 90 frames): white streams + glitch flashes
        if (r.frame < 95) {
          this.realmAcc += dt * 120 * sc;
          this.chest(opp, v1);
          while (this.realmAcc >= 1) {
            this.realmAcc -= 1;
            const a = rr(0, 6.28), rad = rr(0.5, 1.4), h = rr(-1, 1.2);
            const px = v1.x + Math.cos(a) * rad, pz = v1.z + Math.sin(a) * rad;
            P.spec.reset().at(px, v1.y + h, pz).v(-Math.sin(a) * 10, rr(-2, 2), Math.cos(a) * 10).ph(0, 0)
              .ttl(rr(0.1, 0.25)).tx(T.STREAK, 0.04).sz(0.03, 0.01, rr(0.3, 1.2), 0.1).col(0xffffff, Math.random() < 0.3 ? 0x8fa8ff : 0xffffff, 1, 0, 1.6);
            P.emit(true);
          }
          if (Math.random() < dt * 6) fx.D.spawn('hex', v1.x, v1.y + rr(-0.5, 0.5), v1.z, 0.5, 2.2, 0.25, 0xd8e0ff, 0, rr(0, 6), 0.6, true);
        }
        break;
      }
      case 'gear_fifth': {
        // drum beat: pulse rings around the owner
        if (this.beatT > 0.42) {
          this.beatT = 0;
          const x = fo.pos.x / 1000, z = fo.pos.z / 1000;
          // comic ink rings (normal blend, dark) read on the bright cartoon world
          fx.D.spawn('ring', x, 0.08, z, 0.6, 7, 0.5, 0x2a1a20, 1, 0, 0.7, false);
          fx.D.spawn('ring', x, 1.2, z, 0.5, 4.0, 0.4, 0x2a1a20, 0, 0, 0.45, false);
          if (Math.random() < 0.3) fx.O.spawn('dodon', x + rr(-1.5, 1.5), 2.6, z, 0.9, 0.7);
        }
        break;
      }
      case 'king_of_hell': {
        if (Math.random() < dt * 5) {
          this.chest(Math.random() < 0.5 ? owner : opp, v1);
          fx.D.spawn('crescent', v1.x + rr(-2.5, 2.5), v1.y + rr(-0.5, 2), v1.z + rr(-2.5, 2.5), 1.5, 4.5, 0.25, Math.random() < 0.5 ? 0xff2a3a : 0xffd0d0, 0, rr(-1.6, 1.6), 0.8, true);
        }
        break;
      }
      case 'paths': {
        this.realmAcc += dt * 30 * sc;
        while (this.realmAcc >= 1) {
          this.realmAcc -= 1;
          const x = (fo.pos.x + fp.pos.x) / 2000 + rr(-6, 6), z = (fo.pos.z + fp.pos.z) / 2000 + rr(-4, 4);
          P.spec.reset().at(x, 0.05, z).v(rr(-0.2, 0.2), rr(0.5, 1.5), rr(-0.2, 0.2)).ph(0.5, 0).ttl(rr(1.2, 2.2)).tx(T.SOFT).sz(0.08, 0.02).col(0xfff4c0, 0x5ad0ff, 1, 0, 1.6);
          P.emit(true);
        }
        break;
      }
      case 'tailed_beast_bomb': {
        this.realmAcc += dt * 20 * sc;
        while (this.realmAcc >= 1) {
          this.realmAcc -= 1;
          const x = (fo.pos.x + fp.pos.x) / 2000 + rr(-6, 6), z = (fo.pos.z + fp.pos.z) / 2000 + rr(-4, 4);
          P.spec.reset().at(x, rr(0, 3), z).v(rr(-0.3, 0.3), rr(0.4, 1.2), rr(-0.3, 0.3)).ph(0.5, 0).ttl(rr(1, 2)).tx(T.SPARK).sz(0.1, 0.02).col(0xffb08a, 0xff2a1a, 1, 0, 1.6);
          P.emit(true);
        }
        break;
      }
      default: break;
    }
    void q1;
  }

  clear(): void {
    for (const s of this.ps) {
      s.orbA.g.visible = s.orbB.g.visible = false; s.tornado.visible = false; s.wire.visible = false; s.glyph.visible = false; s.bubble.visible = false;
      s.tornK = s.wireK = s.glyphK = s.infAmt = s.infPulse = 0; s.moveId = null;
      for (const b of s.blades) b.visible = false;
    }
    for (const b of this.bolts) { b.life = 0; b.mesh.visible = false; }
    this.trenchK = 0; this.trench.visible = false; this.trenchOn = false;
    this.realmKind = null; this.realmPhase = null;
  }
  dispose(): void { this.group.removeFromParent(); }
}

const _Y = new THREE.Vector3(0, 1, 0);

/** move lookup that also resolves sim-generated cinematic copies ('<id>_cine') to their source move's fx */
function lookupMove(char: CharId, id: string): MoveDef | null {
  try {
    const m = getMove(char, id);
    if (m && m.fx) return m;
    if (id.endsWith('_cine')) { const src = getMove(char, id.slice(0, -5)); if (src) return m ? { ...m, fx: src.fx } : src; }
    return m ?? null;
  } catch { return null; }
}

/** Infinity refraction bubble: faint fresnel shell with a drifting hex lattice and a shimmer band */
function bubbleMat(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: { uAmt: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vV; varying vec3 vO;
      void main(){ vO = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`uniform float uAmt; uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vO;
      float hexLine(vec2 p){ p *= 7.0; vec2 q = vec2(p.x * 1.1547, p.y + p.x * 0.57735); vec2 pi = floor(q); vec2 pf = fract(q);
        float v = mod(pi.x + pi.y, 3.0); float ca = step(1.0, v); float cb = step(2.0, v); vec2 ma = step(pf.xy, pf.yx);
        float e = dot(ma, 1.0 - pf.yx + ca * (pf.x + pf.y - 1.0) + cb * (pf.yx - 2.0 * pf.xy));
        return smoothstep(0.06, 0.0, abs(fract(e) - 0.0) ) + smoothstep(0.94, 1.0, fract(e)); }
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
        vec2 sp = vec2(atan(vO.z, vO.x) / 3.14159, vO.y * 0.75);
        float hx = hexLine(sp + vec2(uTime * 0.02, 0.0));
        float band = smoothstep(0.25, 0.0, abs(fract(vO.y * 0.5 - uTime * 0.45) - 0.5) - 0.2);
        vec3 col = vec3(0.75, 0.9, 1.0) * (f * 0.75 + hx * (0.06 + band * 0.55)) + vec3(0.5, 0.7, 1.0) * band * 0.1;
        gl_FragColor = vec4(col * uAmt, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  m.toneMapped = false;
  return m;
}

// silence unused-import lint for helpers kept for future hints
void elemCol; void getChar;
