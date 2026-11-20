// Event-driven one-shot effects (hit sparks, elemental bursts, dust, KO, awaken...).
import * as THREE from 'three';
import type { CharId, Element, GameState, SimEvent, Strength } from '../sim/types';
import { getChar } from '../sim';
import type { GameRenderer } from '../render';
import { ParticleSystem, T, randDir, rr } from './particles';
import * as PR from './particles';
import { DecalFx, Onomato } from './quads';
import { PostFx } from './post';
import type { FlipbookFx } from './flipbook';

export interface FxCtx {
  P: ParticleSystem;
  D: DecalFx;
  O: Onomato;
  F: FlipbookFx; // owner flipbook sprite sheets
  post: PostFx;
  r: GameRenderer;
  cam: THREE.PerspectiveCamera;
  scale: number; // particle-count quality scale
  low: boolean;
}

const FALLBACK_AURA: Partial<Record<CharId, number>> = { kaito: 0xff5a1f, shiori: 0x9b5cff, ren: 0x8fd3ff, goro: 0xd9a441, gojo: 0x7fb8ff, naruto: 0xff9a2e, zoro: 0x3fd17a, luffy: 0xff3b3b, eren: 0x58e07a };
const auraCache: Partial<Record<CharId, number>> = {};
export function auraColor(id: CharId): number {
  const c = auraCache[id];
  if (c !== undefined) return c;
  let v = FALLBACK_AURA[id] ?? 0xffffff;
  try {
    const s = getChar(id).palette.aura;
    const n = parseInt(s.replace('#', ''), 16);
    if (!Number.isNaN(n)) v = n;
  } catch { /* sim stub */ }
  auraCache[id] = v;
  return v;
}

export const ELEM_COL: Record<string, [number, number]> = {
  none: [0xfff2b0, 0xffb347], fire: [0xff7a1a, 0xffd23a], shadow: [0xb07cff, 0x2a0a40],
  blade: [0xffffff, 0xbfe8ff], earth: [0xc89a5a, 0x6b5232], ki: [0x6fe8ff, 0xffffff],
  void: [0x7f9cff, 0x1a1050], wind: [0xbff6ff, 0x4ad0ff], lightning: [0xfff27a, 0xffb21a], rubber: [0xffd0dc, 0xff4a6a],
};
/** element colour pair, safe for unknown elements */
export function elemCol(el: string | undefined): [number, number] { return ELEM_COL[el ?? 'none'] ?? ELEM_COL.none!; }

const LVL: Record<Strength, number> = { light: 0, medium: 1, heavy: 2, super: 3 };
const tmpV = new THREE.Vector3();
/** camera shake per strength tier: [metres, frames] */
const SHAKE: ReadonlyArray<readonly [number, number]> = [[0.012, 3], [0.03, 5], [0.065, 8], [0.13, 14]];

export class Effects {
  // current origin (metres) for the *Burst helpers
  private x = 0; private y = 0; private z = 0;
  private ax = 0; private az = 0; // attack direction (unit, xz)
  state: GameState | null = null;
  constructor(private fx: FxCtx) {}

  private n(v: number): number { return Math.max(1, Math.round(v * this.fx.scale)); }

  /** set origin from sim pos (mm); nudge toward the camera so sparks are not hidden inside the body */
  private origin(p: { x: number; y: number; z: number }, push = 0.3): void {
    this.x = p.x / 1000; this.y = p.y / 1000; this.z = p.z / 1000;
    const c = this.fx.cam.position;
    const dx = c.x - this.x, dy = c.y - this.y, dz = c.z - this.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    this.x += (dx / l) * push; this.y += (dy / l) * push; this.z += (dz / l) * push;
  }
  private dirFrom(ev: SimEvent): void {
    this.ax = 0; this.az = 0;
    const s = this.state;
    if (!s || ev.target === undefined) return;
    const a = s.fighters[ev.player].pos, b = s.fighters[ev.target].pos;
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    this.ax = dx / l; this.az = dz / l;
  }

  // ------------------------------------------------------------ building blocks
  glow(size: number, life: number, c0: number, c1: number, a = 1, gain = 1.4): void {
    this.fx.P.spec.reset().at(this.x, this.y, this.z).ttl(life).sz(size * 0.5, size).tx(T.SOFT).col(c0, c1, a, 0, gain);
    this.fx.P.emit(true);
  }
  sparks(n: number, speed: number, spread: number, c0: number, c1: number, size: number, life: number, grav = 7, drag = 2.2): void {
    const P = this.fx.P;
    for (let i = 0; i < this.n(n); i++) {
      randDir();
      const sp = speed * rr(0.35, 1);
      P.spec.reset().at(this.x, this.y, this.z)
        .v((this.ax * 0.9 + PR.dx * spread) * sp, (PR.dy * spread + 0.25) * sp, (this.az * 0.9 + PR.dz * spread) * sp)
        .ph(drag, grav).ttl(rr(0.5, 1) * life).tx(T.STREAK, 0.045)
        .sz(size * 0.3, size * 0.08, size * 0.5, size * 0.2).col(c0, c1, 1, 0, 1.6);
      P.spec.pe = 1.6;
      P.emit(true);
    }
  }
  /** radial streaks in the camera plane (speed-line burst around the contact point) */
  streaks(n: number, speed: number, len: number, c0: number, c1: number, life: number): void {
    const P = this.fx.P;
    const cr = this.fx.cam.matrixWorld.elements;
    const rx = cr[0]!, ry = cr[1]!, rz = cr[2]!, ux = cr[4]!, uy = cr[5]!, uz = cr[6]!;
    const cnt = this.n(n), off = rr(0, 6.2832);
    for (let i = 0; i < cnt; i++) {
      const a = off + (i / cnt) * 6.2832 + rr(-0.22, 0.22), sp = speed * rr(0.6, 1);
      const ca = Math.cos(a) * sp, sa = Math.sin(a) * sp;
      P.spec.reset().at(this.x, this.y, this.z).v(rx * ca + ux * sa, ry * ca + uy * sa, rz * ca + uz * sa).ph(5, 0)
        .ttl(rr(0.6, 1) * life).tx(T.STREAK, 0.1).sz(0.05, 0.012, len, len * 0.3).col(c0, c1, 1, 0, 1.7);
      P.emit(true);
    }
  }
  /** slow glowing embers that drift up and linger after a heavy hit */
  embers(n: number, c0: number, c1: number, life: number): void {
    const P = this.fx.P;
    for (let i = 0; i < this.n(n); i++) {
      randDir();
      P.spec.reset().at(this.x + PR.dx * 0.12, this.y + PR.dy * 0.12, this.z + PR.dz * 0.12)
        .v(PR.dx * 1.8 + this.ax * 0.9, Math.abs(PR.dy) * 1.5 + 0.4, PR.dz * 1.8 + this.az * 0.9).ph(2.6, -0.5)
        .ttl(rr(0.55, 1) * life).tx(T.SOFT).sz(rr(0.05, 0.1), 0.01).col(c0, c1, 1, 0, 1.6);
      P.spec.pe = 2;
      P.emit(true);
    }
  }
  smokePuffs(n: number, speed: number, size: number, life: number, c0: number, c1: number, a = 0.5, up = 0.5): void {
    const P = this.fx.P;
    for (let i = 0; i < this.n(n); i++) {
      randDir();
      P.spec.reset().at(this.x, this.y, this.z).v(PR.dx * speed, PR.dy * speed * 0.6 + up, PR.dz * speed)
        .ph(2.2, -0.4).ttl(rr(0.6, 1) * life).tx(T.SMOKE).sz(size * 0.5, size * 1.5).rt(rr(0, 6.28), rr(-1, 1)).col(c0, c1, a, 0);
      P.emit(false);
    }
  }
  shock(size: number, life: number, c: number, ground = false, op = 0.9): void {
    const D = this.fx.D;
    if (ground) D.spawn('ring', this.x, 0.04, this.z, size * 0.15, size, life, c, 1, 0, op, true);
    else D.spawn('ring', this.x, this.y, this.z, size * 0.15, size, life, c, 0, 0, op, true);
  }
  star(size: number, life: number, c: number, roll = rr(-0.4, 0.4), op = 1, spin = 0): void {
    this.fx.D.spawn('star', this.x, this.y, this.z, size * 0.55, size, life, c, 0, roll, op, true, 0, 1, 0, 1, spin);
  }
  dustRing(x: number, z: number, n: number, speed: number, size: number, life = 0.7, c = 0xb8a68a): void {
    const P = this.fx.P;
    const cnt = this.n(n);
    for (let i = 0; i < cnt; i++) {
      const a = (i / cnt) * 6.2832 + rr(-0.2, 0.2), sp = speed * rr(0.6, 1.1);
      P.spec.reset().at(x + Math.cos(a) * 0.2, 0.08, z + Math.sin(a) * 0.2).v(Math.cos(a) * sp, rr(0.2, 0.9), Math.sin(a) * sp)
        .ph(3.2, -0.3).ttl(rr(0.6, 1) * life).tx(T.SMOKE).sz(size * 0.5, size * 1.6).rt(rr(0, 6.28), rr(-1, 1))
        .col(c, 0x6e6458, 0.55, 0);
      P.emit(false);
    }
    this.fx.D.spawn('ring', x, 0.05, z, size * 0.5, size * 5, life * 0.6, 0xe8dcc8, 1, 0, 0.55, true);
  }

  // ------------------------------------------------------------ elemental bursts (at current origin)
  elemental(el: Element | undefined, k: number): void {
    const P = this.fx.P;
    switch (el) {
      case 'fire': {
        for (let i = 0; i < this.n(9 * k); i++) {
          randDir();
          P.spec.reset().at(this.x, this.y, this.z).v(PR.dx * 2.5, Math.abs(PR.dy) * 3 + 1, PR.dz * 2.5).ph(1.4, -2.2)
            .ttl(rr(0.6, 1.3)).tx(i % 2 ? T.SOFT : T.SPARK).sz(0.16, 0.03).rt(rr(0, 6), rr(-3, 3)).col(0xffb02e, 0xff2a10, 1, 0, 1.5);
          P.emit(true);
        }
        for (let i = 0; i < this.n(4 * k); i++) {
          P.spec.reset().at(this.x + rr(-0.2, 0.2), this.y + rr(-0.1, 0.2), this.z + rr(-0.2, 0.2)).v(rr(-0.6, 0.6), rr(1.5, 3.2), rr(-0.6, 0.6)).ph(1.5, 0)
            .ttl(rr(0.35, 0.55)).tx(T.FLAME).sz(0.5 * k, 0.9 * k, 0.7 * k, 1.3 * k).rt(rr(-0.3, 0.3), rr(-1, 1)).col(0xffe27a, 0xff3b10, 1, 0, 1.3);
          P.emit(true);
        }
        this.smokePuffs(3 * k, 0.8, 0.7, 0.9, 0x3a2a24, 0x120c0a, 0.45, 0.9);
        this.glow(1.6 * k, 0.16, 0xffd070, 0xff4a10, 0.9);
        break;
      }
      case 'shadow': {
        for (let i = 0; i < this.n(10 * k); i++) {
          randDir();
          P.spec.reset().at(this.x, this.y, this.z).v(PR.dx * 1.6, PR.dy * 1.2 + 0.8, PR.dz * 1.6).ph(1.6, -0.6)
            .ttl(rr(0.55, 1.0)).tx(T.SMOKE).sz(0.45 * k, 1.1 * k).rt(rr(0, 6), rr(-3, 3)).col(0x2d0f48, 0x0a0410, 0.8, 0);
          P.emit(false);
        }
        for (let i = 0; i < this.n(6 * k); i++) {
          randDir();
          P.spec.reset().at(this.x, this.y, this.z).v(PR.dx * 2, PR.dy * 2 + 0.6, PR.dz * 2).ph(2, 0)
            .ttl(rr(0.3, 0.55)).tx(T.SOFT).sz(0.35, 0.08).col(0xc08cff, 0x5a22b0, 1, 0, 1.4);
          P.emit(true);
        }
        this.glow(1.3 * k, 0.2, 0xb07cff, 0x401080, 0.8);
        break;
      }
      case 'blade': {
        const roll = rr(-0.9, 0.9);
        this.fx.D.spawn('crescent', this.x, this.y, this.z, 1.4 * k, 2.8 * k, 0.24, 0xffffff, 0, roll, 1, true, 0, 1, 0, 1.0);
        this.fx.D.spawn('crescent', this.x, this.y, this.z, 1.0 * k, 3.4 * k, 0.3, 0x9fdcff, 0, roll + 0.05, 0.7, true, 0, 1, 0, 1.0);
        this.star(1.2 * k, 0.1, 0xffffff, roll + 1.57, 0.9);
        for (let i = 0; i < this.n(7 * k); i++) {
          const a = roll + 1.57 + rr(-0.5, 0.5), sp = rr(7, 14);
          // slash streaks fly in the camera plane
          const cr = this.fx.cam.matrixWorld.elements;
          const rx = cr[0]!, ry = cr[1]!, rz = cr[2]!, ux = cr[4]!, uy = cr[5]!, uz = cr[6]!;
          const ca = Math.cos(a) * sp, sa = Math.sin(a) * sp;
          P.spec.reset().at(this.x, this.y, this.z).v(rx * ca + ux * sa, ry * ca + uy * sa, rz * ca + uz * sa).ph(3, 0)
            .ttl(rr(0.15, 0.3)).tx(T.STREAK, 0.12).sz(0.05, 0.015, 0.4, 0.1).col(0xffffff, 0x9fdcff, 1, 0, 1.6);
          P.emit(true);
        }
        break;
      }
      case 'earth': {
        for (let i = 0; i < this.n(12 * k); i++) {
          randDir();
          P.spec.reset().at(this.x, this.y, this.z).v(PR.dx * 3.2 + this.ax * 2, Math.abs(PR.dy) * 5 + 2, PR.dz * 3.2 + this.az * 2).ph(0.4, 14)
            .ttl(rr(0.7, 1.1)).tx(T.SHARD).sz(rr(0.16, 0.32), rr(0.16, 0.32)).rt(rr(0, 6), rr(-9, 9)).col(0xb8895a, 0x7a5a3a, 1, 1);
          P.spec.pe = 6;
          P.emit(false);
        }
        this.smokePuffs(5 * k, 1.6, 0.8, 0.9, 0xc2ae8c, 0x6e6050, 0.6, 0.4);
        this.glow(1.0 * k, 0.12, 0xffe0a0, 0xc88a30, 0.6);
        break;
      }
      case 'ki': {
        this.shock(1.8 * k, 0.26, 0x6fe8ff);
        this.glow(1.5 * k, 0.18, 0xffffff, 0x3fc8ff, 1, 1.6);
        for (let i = 0; i < this.n(8 * k); i++) {
          randDir();
          P.spec.reset().at(this.x, this.y, this.z).v(PR.dx * 4, PR.dy * 4, PR.dz * 4).ph(3, 0)
            .ttl(rr(0.2, 0.4)).tx(T.SPARK).sz(0.28, 0.05).rt(rr(0, 3), 0).col(0xb8f4ff, 0x2090ff, 1, 0, 1.6);
          P.emit(true);
        }
        break;
      }
      case 'void': {
        // implosion: bright ring collapsing inward + dark core + inward streaks
        this.fx.D.spawn('ring', this.x, this.y, this.z, 2.6 * k, 0.2, 0.22, 0x9fb8ff, 0, 0, 0.9, true);
        this.fx.D.spawn('hex', this.x, this.y, this.z, 0.4, 2.2 * k, 0.3, 0x7f9cff, 0, rr(0, 6), 0.7, true);
        this.glow(1.5 * k, 0.18, 0xe0e8ff, 0x3a2aff, 1, 1.5);
        for (let i = 0; i < this.n(12 * k); i++) {
          randDir();
          const d = rr(0.8, 1.4) * k;
          P.spec.reset().at(this.x + PR.dx * d, this.y + PR.dy * d, this.z + PR.dz * d).v(-PR.dx * d * 5, -PR.dy * d * 5, -PR.dz * d * 5).ph(0, 0)
            .ttl(0.2).tx(T.STREAK, 0.06).sz(0.05, 0.01, 0.3, 0.05).col(0xffffff, 0x5a6aff, 1, 0, 1.6);
          P.emit(true);
        }
        break;
      }
      case 'wind': {
        // spiralling wind blades
        for (let i = 0; i < this.n(14 * k); i++) {
          const a = (i / 14) * 6.2832, sp = rr(4, 8) * k;
          const cr = this.fx.cam.matrixWorld.elements;
          const ca = Math.cos(a), sa = Math.sin(a);
          P.spec.reset().at(this.x, this.y, this.z)
            .v((cr[0]! * ca + cr[4]! * sa) * sp - sa * 2, (cr[1]! * ca + cr[5]! * sa) * sp, (cr[2]! * ca + cr[6]! * sa) * sp + ca * 2).ph(4, 0)
            .ttl(rr(0.18, 0.32)).tx(T.STREAK, 0.08).sz(0.06, 0.01, 0.5, 0.15).col(0xffffff, 0x6fe0ff, 1, 0, 1.5);
          P.emit(true);
        }
        this.fx.D.spawn('spiral', this.x, this.y, this.z, 0.6 * k, 2.4 * k, 0.26, 0xbff6ff, 0, rr(0, 6), 0.8, true, 0, 1, 0, 1, 14);
        this.glow(1.3 * k, 0.15, 0xffffff, 0x4ad0ff, 0.9);
        break;
      }
      case 'lightning': {
        for (let i = 0; i < this.n(10 * k); i++) {
          randDir();
          const sp = rr(6, 12);
          P.spec.reset().at(this.x, this.y, this.z).v(PR.dx * sp, PR.dy * sp, PR.dz * sp).ph(5, 0)
            .ttl(rr(0.08, 0.18)).tx(T.STREAK, 0.03).sz(0.05, 0.02, 0.6, 0.3).col(0xffffff, 0xffd21a, 1, 0, 2.0);
          P.emit(true);
        }
        this.glow(1.6 * k, 0.12, 0xffffff, 0xffd21a, 1, 1.7);
        this.star(1.4 * k, 0.1, 0xfff27a, rr(0, 6), 1);
        break;
      }
      case 'rubber': {
        // cartoon "boing": squashed white ring + soft pink puff
        this.fx.D.spawn('ring', this.x, this.y, this.z, 0.3, 2.4 * k, 0.24, 0xffffff, 0, 0, 0.9, true, 0, 1, 0, 0.55);
        this.fx.D.spawn('ring', this.x, this.y, this.z, 0.2, 1.6 * k, 0.3, 0xff8aa8, 0, 0, 0.7, true, 0, 1, 0, 1.4);
        this.smokePuffs(4 * k, 1.4, 0.5, 0.45, 0xffffff, 0xffc0d0, 0.55, 0.2);
        break;
      }
      default:
    }
  }

  ono(el: Element | undefined, lvl: number, counter: boolean): string {
    if (counter) return 'counter';
    if (el === 'blade') return 'zuba';
    if (el === 'fire') return lvl >= 3 ? 'doka' : 'bam';
    if (el === 'earth') return 'zudon';
    if (el === 'ki') return 'don';
    if (el === 'shadow') return 'baki';
    if (el === 'void') return 'don';
    if (el === 'wind') return 'zuba';
    if (el === 'lightning') return 'gorogoro';
    if (el === 'rubber') return lvl >= 3 ? 'doka' : 'boing';
    return lvl >= 3 ? 'doka' : ['baki', 'don', 'bam'][(Math.random() * 3) | 0]!;
  }

  // ------------------------------------------------------------ event effects
  /**
   * Hit spark, tiered by strength (P8 Feel):
   *  light   - small quick star + a few short sparks
   *  medium  - bigger crossed double star + radial streaks
   *  heavy   - large burst + shock ring + lingering embers
   *  super   - ultimates / supers: the biggest (two rings, long streaks, ember cloud, orb flash)
   *  counter - one tier bigger and red / gold: spinning spiky star, gold + red double ring, "COUNTER!"
   * Particle counts go through n() (particles setting); screen flashes respect reduceFlashing in PostFx.
   * `force` = strength tier override (ultimate hits), -1 = from the event.
   */
  hit(ev: SimEvent, counter: boolean, force = -1): void {
    const fx = this.fx;
    this.dirFrom(ev);
    this.origin(ev.pos, 0.3);
    const base = force >= 0 ? force : LVL[ev.strength ?? 'medium'];
    const lvl = counter ? Math.min(3, base + 1) : base;
    const el = ev.element;
    const col = elemCol(el);
    const tint = counter ? 0xff4a2a : col[0];
    const roll = rr(-0.4, 0.4);
    // core flash + star (quick on light, held a little longer as strength grows)
    this.glow([0.7, 1.15, 1.9, 3.1][lvl]!, [0.08, 0.12, 0.17, 0.26][lvl]!, 0xffffff, tint, 1, 1.5);
    this.star([0.75, 1.25, 2.05, 3.3][lvl]!, [0.09, 0.14, 0.2, 0.3][lvl]!, counter ? 0xffe14a : lvl >= 2 ? 0xffffff : 0xfff2c0, roll);
    if (lvl >= 1) this.star([0, 0.8, 1.35, 2.2][lvl]!, [0, 0.11, 0.15, 0.22][lvl]!, counter ? 0xff7a2a : 0xffffff, roll + 0.785, 0.8);
    // sparks: a few short ones on light, more / faster / longer-lived as strength grows
    const sparkN = [7, 12, 22, 40][lvl]!, speed = [5, 7, 9.5, 13][lvl]!;
    this.sparks(sparkN, speed, 0.9, 0xfff6c8, tint, [0.45, 0.65, 0.95, 1.3][lvl]!, [0.28, 0.38, 0.48, 0.6][lvl]!);
    if (lvl >= 1) this.streaks([0, 6, 10, 16][lvl]!, [0, 9, 12, 16][lvl]!, [0, 0.35, 0.55, 0.9][lvl]!, 0xffffff, tint, [0, 0.12, 0.16, 0.22][lvl]!);
    if (lvl >= 2) {
      this.shock(lvl === 2 ? 2.2 : 3.2, lvl === 2 ? 0.26 : 0.32, tint);
      this.embers(lvl === 2 ? 10 : 22, counter ? 0xffd040 : 0xfff0b0, counter ? 0xff2a10 : col[0], lvl === 2 ? 1.1 : 1.6);
      this.sparks(sparkN * 0.35, speed * 0.55, 1.3, 0xffffff, 0xffb347, 0.35, 0.45, 12);
    }
    if (lvl >= 3) {
      this.shock(4.6, 0.42, 0xffffff, false, 0.7);
      fx.F.spawn('orb', this.x, this.y, this.z, 2.6, 0.32, 0xffffff, roll, 0.85);
    }
    if (counter) {
      this.star(3.4, 0.32, 0xff3a2a, rr(-0.3, 0.3), 0.95, 3.2);
      this.shock(3.6, 0.36, 0xffe14a);
      fx.D.spawn('ring', this.x, this.y, this.z, 0.5, 2.4, 0.24, 0xff3a2a, 0, 0, 0.85, true);
      fx.post.screenFlash(0xfff0d0, 0.3, 14);
      fx.post.vignettePulse(0.6);
    }
    if (el && el !== 'none') this.elemental(el, [0.6, 0.85, 1.15, 1.5][lvl]!);
    this.flipHit(ev, lvl, el);
    const sh = SHAKE[lvl]!;
    fx.r.addShake(sh[0], sh[1]);
    if (counter || lvl >= 3) fx.post.impact(3);
    else if (lvl >= 2) fx.post.impact(2);
    const otg = ev.tag === 'otg';
    if ((lvl >= 2 || counter) && !otg) {
      const key = this.ono(el, lvl, counter);
      tmpV.set(this.x, this.y + 0.55, this.z);
      fx.O.spawn(key, tmpV.x, tmpV.y, tmpV.z, lvl >= 3 ? 1.35 : 1.0);
    }
    if (otg) this.otg(ev);
  }

  /** owner flipbook sprites layered on top of the procedural hit: fire burst, lightning crackle, sword slash arc */
  private flipHit(ev: SimEvent, lvl: number, el: Element | undefined): void {
    const F = this.fx.F, x = this.x, y = this.y, z = this.z;
    if (el === 'fire' && (lvl >= 2 || (lvl >= 1 && ev.moveId?.startsWith('kaito_')))) F.spawn('fire', x, y + 0.1, z, [0, 1.5, 2.3, 3.2][lvl]!, [0, 0.45, 0.55, 0.7][lvl]!, 0xffffff, 0, 0.95);
    else if (el === 'lightning') F.spawn('lightning', x, y, z, 1.4 + lvl * 0.45, 0.4, 0xffffff, rr(-0.4, 0.4), 0.95);
    else if (el === 'blade') F.spawn('slash', x, y, z, 1.5 + lvl * 0.5, 0.3, 0xffffff, rr(-0.5, 0.35) + (this.az > 0 ? 0.35 : 0), 0.95);
  }

  /** ground hit on a lying opponent: dust ring, small debris, "ドスッ!" */
  otg(ev: SimEvent): void {
    const fx = this.fx, P = fx.P;
    const x = ev.pos.x / 1000, z = ev.pos.z / 1000;
    this.dustRing(x, z, 10, 3.0, 0.7, 0.65);
    for (let i = 0; i < this.n(11); i++) {
      const a = rr(0, 6.2832), sp = rr(1.2, 3.4);
      P.spec.reset().at(x + Math.cos(a) * 0.15, 0.1, z + Math.sin(a) * 0.15).v(Math.cos(a) * sp, rr(2.2, 4.8), Math.sin(a) * sp).ph(0.4, 15)
        .ttl(rr(0.5, 0.9)).tx(T.SHARD).sz(rr(0.05, 0.11), rr(0.05, 0.11)).rt(rr(0, 6), rr(-9, 9)).col(0xb09a78, 0x6a5a44, 1, 1);
      P.spec.pe = 6;
      P.emit(false);
    }
    this.x = x; this.y = 0.12; this.z = z;
    this.shock(2.6, 0.22, 0xe8dcc8, true, 0.7);
    fx.r.addShake(0.022, 4);
    this.origin({ x: ev.pos.x, y: 900, z: ev.pos.z }, 0.3);
    fx.O.spawn('dosu', this.x, this.y, this.z, 1.0, 0.8);
  }

  /** guard meter emptied: glass-shatter burst of blue shards + "GUARD CRUSH!" */
  guardCrush(ev: SimEvent): void {
    const fx = this.fx, P = fx.P;
    this.dirFrom(ev);
    this.origin(ev.pos, 0.3);
    for (let i = 0; i < this.n(30); i++) {
      randDir();
      const sp = rr(2.5, 7.5);
      P.spec.reset().at(this.x, this.y, this.z).v(PR.dx * sp + this.ax * 1.5, PR.dy * sp + 1.2, PR.dz * sp + this.az * 1.5).ph(0.8, 9)
        .ttl(rr(0.6, 1.1)).tx(T.SHARD).sz(rr(0.1, 0.3), rr(0.05, 0.14)).rt(rr(0, 6), rr(-12, 12)).col(0xe6f6ff, 0x2f7cff, 1, 0, 1.5);
      P.spec.pe = 6;
      P.emit(true);
    }
    this.sparks(18, 8, 1.2, 0xffffff, 0x3a8cff, 0.6, 0.45, 8);
    this.glow(3.0, 0.22, 0xffffff, 0x3a8cff, 1, 1.5);
    this.star(2.6, 0.22, 0xbfe4ff, 0, 0.95);
    this.shock(3.4, 0.32, 0x8fd3ff);
    fx.D.spawn('ring', this.x, this.y, this.z, 0.3, 2.2, 0.26, 0xffffff, 0, 0, 0.9, true);
    fx.post.screenFlash(0x9fd0ff, 0.22, 10);
    fx.post.vignettePulse(0.4);
    fx.r.addShake(0.07, 9);
    fx.post.impact(2);
    tmpV.set(this.x, this.y + 0.65, this.z);
    fx.O.spawn('guardcrush', tmpV.x, tmpV.y, tmpV.z, 1.25, 1.0);
  }

  /**
   * Guard spark: a flat blue-white hex 'shield plane' facing the attacker + a thin flat ring, sparks glancing back off it.
   * Deliberately flat and cool (no star, no warm core) so a block never reads as a hit.
   */
  block(ev: SimEvent): void {
    this.dirFrom(ev);
    this.origin(ev.pos, 0.3);
    const k = LVL[ev.strength ?? 'medium'];
    const nx = this.ax || 1, nz = this.az, roll = rr(0, 1.05);
    this.fx.D.spawn('hex', this.x, this.y, this.z, 0.35 + k * 0.08, 1.0 + k * 0.32, 0.16 + k * 0.03, 0xcfeaff, 2, roll, 0.95, true, nx, 0, nz);
    this.fx.D.spawn('ring', this.x, this.y, this.z, 0.25, 1.3 + k * 0.35, 0.2, 0x8fd3ff, 2, 0, 0.75, true, nx, 0, nz);
    this.glow(0.7 + k * 0.2, 0.09, 0xeaf6ff, 0x3a8cff, 0.75);
    // glance back toward the attacker and out to the sides
    this.ax = -this.ax * 0.6; this.az = -this.az * 0.6;
    this.sparks(6 + k * 4, 5 + k * 1.2, 1.15, 0xffffff, 0x5aa8ff, 0.4, 0.3, 6);
    this.fx.r.addShake(0.005 + k * 0.005, 3);
  }

  parry(ev: SimEvent): void {
    this.origin(ev.pos, 0.3);
    this.shock(2.6, 0.3, 0xffffff);
    this.star(1.8, 0.18, 0xfff6a0);
    this.sparks(18, 9, 1.1, 0xffffff, 0xffe14a, 0.7, 0.4);
    this.fx.post.screenFlash(0xffffff, 0.25, 14);
  }

  throwImpact(ev: SimEvent): void {
    this.dirFrom(ev);
    this.origin(ev.pos, 0.3);
    this.sparks(16, 8, 1.2, 0xfff6c8, 0xffb347, 0.8, 0.45);
    this.star(2.0, 0.18, 0xffffff);
    this.shock(3.0, 0.3, 0xffe9a0);
    this.dustRing(ev.pos.x / 1000, ev.pos.z / 1000, 12, 3.2, 0.7);
    this.fx.r.addShake(0.06, 8);
    tmpV.set(this.x, this.y + 0.6, this.z);
    this.fx.O.spawn('don', tmpV.x, tmpV.y, tmpV.z, 1.1);
  }

  throwBreak(ev: SimEvent): void {
    this.origin(ev.pos, 0.2);
    this.shock(2.2, 0.25, 0x8fd3ff);
    this.sparks(14, 7, 1.2, 0xffffff, 0x8fd3ff, 0.6, 0.4);
    this.fx.r.addShake(0.02, 4);
  }

  launch(ev: SimEvent): void {
    const P = this.fx.P;
    const x = ev.pos.x / 1000, z = ev.pos.z / 1000, y = Math.max(0.2, ev.pos.y / 1000);
    for (let i = 0; i < this.n(14); i++) {
      P.spec.reset().at(x + rr(-0.45, 0.45), y + rr(-0.2, 1.4), z + rr(-0.45, 0.45)).v(0, rr(-9, -16), 0).ph(0, 0)
        .ttl(rr(0.18, 0.32)).tx(T.STREAK, 0.05).sz(0.035, 0.012, rr(0.8, 1.6), 0.4).col(0xffffff, 0xcfe8ff, 0.9, 0, 1.3);
      // rotate streak to vertical: streaks align to velocity automatically
      P.emit(true);
    }
    this.dustRing(x, z, 8, 3.4, 0.7, 0.6);
    this.fx.D.spawn('ring', x, 0.05, z, 0.3, 3.2, 0.3, 0xffffff, 1, 0, 0.9, true);
    this.fx.r.addShake(0.03, 6);
    this.fx.post.speedLines(0.2, 0.06);
  }

  wallSplat(ev: SimEvent, state: GameState): void {
    const P = this.fx.P;
    const x = ev.pos.x / 1000, y = Math.max(0.3, ev.pos.y / 1000 + 1.0), z = ev.pos.z / 1000;
    let nx = 0, nz = 0;
    if (Math.abs(ev.pos.x) >= Math.abs(ev.pos.z)) nx = -Math.sign(ev.pos.x) || 1; else nz = -Math.sign(ev.pos.z) || 1;
    void state;
    const tx = -nz, tz = nx; // tangent along the wall
    // impact ring + star on the wall
    this.fx.D.spawn('ring', x - nx * 0.05, y, z - nz * 0.05, 0.4, 4.2, 0.4, 0xe8dcc8, 2, 0, 0.9, true, nx, 0, nz);
    this.fx.D.spawn('star', x - nx * 0.05, y, z - nz * 0.05, 1.2, 2.6, 0.22, 0xffffff, 2, rr(0, 6), 0.9, true, nx, 0, nz);
    for (let i = 0; i < this.n(22); i++) {
      const a = rr(0, 6.2832), sp = rr(1.5, 5);
      P.spec.reset().at(x, y, z).v(tx * Math.cos(a) * sp + nx * rr(0.5, 2), Math.sin(a) * sp, tz * Math.cos(a) * sp + nz * rr(0.5, 2)).ph(2.4, -0.2)
        .ttl(rr(0.5, 1.0)).tx(T.SMOKE).sz(0.5, 1.5).rt(rr(0, 6), rr(-1, 1)).col(0xc8b89a, 0x6e6458, 0.6, 0);
      P.emit(false);
    }
    for (let i = 0; i < this.n(10); i++) {
      P.spec.reset().at(x, y + rr(-0.5, 0.5), z).v(nx * rr(1, 4) + tx * rr(-3, 3), rr(0, 5), nz * rr(1, 4) + tz * rr(-3, 3)).ph(0.3, 13)
        .ttl(rr(0.7, 1.1)).tx(T.SHARD).sz(rr(0.08, 0.18), rr(0.08, 0.18)).rt(rr(0, 6), rr(-8, 8)).col(0xb8895a, 0x7a5a3a, 1, 1);
      P.spec.pe = 6;
      P.emit(false);
    }
    this.origin(ev.pos, 0.3);
    this.y = y;
    this.sparks(14, 8, 1.2, 0xffffff, 0xffd080, 0.8, 0.4);
    this.fx.r.addShake(0.1, 12);
    this.fx.post.impact(2);
    this.fx.O.spawn('baki', x + nx * 0.5, y + 0.7, z + nz * 0.5, 1.2);
  }

  land(ev: SimEvent, big: boolean): void {
    const x = ev.pos.x / 1000, z = ev.pos.z / 1000;
    this.dustRing(x, z, big ? 12 : 6, big ? 3.6 : 2.2, big ? 0.8 : 0.5, big ? 0.7 : 0.45);
    this.fx.F.spawn('dust', x, big ? 0.65 : 0.45, z, big ? 2.2 : 1.3, big ? 0.6 : 0.45, 0xffffff, 0, big ? 0.8 : 0.6);
    if (big) {
      this.fx.D.spawn('ring', x, 0.05, z, 0.3, 4.5, 0.35, 0xffffff, 1, 0, 0.8, true);
      this.fx.r.addShake(0.045, 6);
    }
  }

  dash(ev: SimEvent): void {
    const P = this.fx.P;
    const x = ev.pos.x / 1000, z = ev.pos.z / 1000;
    let bx = 0, bz = 0;
    const s = this.state;
    if (s) {
      const f = s.fighters[ev.player];
      bx = -f.facing.x / 1000; bz = -f.facing.z / 1000;
      if (f.mode === 'backdash') { bx = -bx; bz = -bz; }
    }
    this.fx.F.spawn('dust', x + bx * 0.3, 0.35, z + bz * 0.3, 1.0, 0.45, 0xffffff, 0, 0.55);
    for (let i = 0; i < this.n(7); i++) {
      P.spec.reset().at(x + rr(-0.2, 0.2), 0.1, z + rr(-0.2, 0.2)).v(bx * rr(1.5, 3) + rr(-0.5, 0.5), rr(0.2, 0.8), bz * rr(1.5, 3) + rr(-0.5, 0.5))
        .ph(2.5, -0.2).ttl(rr(0.3, 0.55)).tx(T.SMOKE).sz(0.35, 0.9).rt(rr(0, 6), rr(-1, 1)).col(0xcfc4b0, 0x6e6458, 0.5, 0);
      P.emit(false);
    }
    this.fx.post.speedLines(0.3, 0.06, 0xffffff);
  }

  /** tall fading silhouette streaks (afterimage) from a to b (metres, feet level) */
  ghosts(ax: number, az: number, bx: number, bz: number, c: number, n: number, life: number): void {
    const P = this.fx.P;
    for (let i = 0; i < this.n(n); i++) {
      const t = n <= 1 ? 0 : i / (n - 1);
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      P.spec.reset().at(x, 0.95, z).ttl(life, t * 0.05).sz(0.75, 0.45, 2.0, 1.9).tx(T.SOFT).col(c, 0xffffff, 0.55, 0, 1.2);
      P.spec.pe = 1.5;
      P.emit(true);
      P.spec.reset().at(x, 0.95, z).ttl(life * 1.1, t * 0.05).sz(0.5, 0.3, 1.8, 1.7).tx(T.SOFT).col(0x10061c, 0x10061c, 0.55, 0);
      P.emit(false);
    }
  }

  sidestep(ev: SimEvent): void {
    const s = this.state;
    const x = ev.pos.x / 1000, z = ev.pos.z / 1000;
    const c = s ? auraColor(s.fighters[ev.player].char) : 0xffffff;
    this.ghosts(x, z, x, z, c, 3, 0.28);
    const P = this.fx.P;
    for (let i = 0; i < this.n(5); i++) {
      P.spec.reset().at(x + rr(-0.3, 0.3), rr(0.3, 1.6), z + rr(-0.3, 0.3)).v(rr(-1, 1), 0, rr(-1, 1)).ph(2, 0)
        .ttl(rr(0.15, 0.3)).tx(T.STREAK, 0.2).sz(0.03, 0.01, 0.6, 0.2).col(0xffffff, c, 0.8, 0, 1.3);
      P.emit(true);
    }
    this.fx.post.speedLines(0.16, 0.04);
  }

  vanish(ev: SimEvent, state: GameState, chest: (p: 0 | 1, out: THREE.Vector3) => void): void {
    const c = auraColor(state.fighters[ev.player].char);
    const ax = ev.pos.x / 1000, az = ev.pos.z / 1000;
    chest(ev.player, tmpV);
    const bx = tmpV.x, bz = tmpV.z;
    this.ghosts(ax, az, bx, bz, c, 9, 0.45);
    this.x = ax; this.y = 1.0; this.z = az;
    this.smokePuffs(8, 2.0, 0.9, 0.7, 0x2a1840, 0x0a0410, 0.6, 0.6);
    this.glow(2.0, 0.2, 0xffffff, c, 0.9);
    this.sparks(10, 6, 1.3, 0xffffff, c, 0.6, 0.4);
    // exit flash at arrival
    this.x = bx; this.y = 1.0; this.z = bz;
    this.glow(1.6, 0.2, 0xffffff, c, 0.8);
    this.sparks(8, 5, 1.3, 0xffffff, c, 0.5, 0.35);
    this.fx.post.speedLines(0.8, 0.18, 0xffffff);
    this.fx.post.screenFlash(0xffffff, 0.12, 14);
  }

  kiBurst(ev: SimEvent, full: boolean): void {
    const s = this.state;
    const c = s ? auraColor(s.fighters[ev.player].char) : 0xffffff;
    this.x = ev.pos.x / 1000; this.y = 0.9; this.z = ev.pos.z / 1000;
    this.shock(full ? 4.0 : 2.4, 0.4, c, true);
    this.shock(full ? 3.0 : 1.6, 0.35, c, false, 0.6);
    this.glow(full ? 3 : 1.6, 0.25, 0xffffff, c, 0.8);
    this.fx.F.spawn('orb', this.x, this.y + 0.2, this.z, full ? 3.2 : 1.8, full ? 0.6 : 0.45, 0xffffff, 0, 0.9);
    if (full) {
      this.sparks(26, 7, 1.4, 0xffffff, c, 0.8, 0.7, -1, 1.2);
      this.fx.post.screenFlash(c, 0.16, 8);
    }
  }

  awaken(ev: SimEvent, state: GameState): void {
    const P = this.fx.P;
    const c = auraColor(state.fighters[ev.player].char);
    const x = ev.pos.x / 1000, z = ev.pos.z / 1000;
    this.x = x; this.y = 1.0; this.z = z;
    this.fx.post.screenFlash(0xffffff, 0.75, 4.5);
    this.fx.post.speedLines(1.0, 0.9, c);
    this.fx.post.vignettePulse(1.0);
    this.shock(7, 0.7, c, true);
    this.shock(5, 0.55, 0xffffff, true, 0.7);
    this.shock(4, 0.5, c, false);
    this.glow(5, 0.5, 0xffffff, c, 1);
    for (let i = 0; i < this.n(40); i++) {
      const a = rr(0, 6.28), r0 = rr(0.2, 0.8);
      P.spec.reset().at(x + Math.cos(a) * r0, rr(0, 0.4), z + Math.sin(a) * r0).v(0, rr(3, 9), 0).ph(0.3, 0)
        .ttl(rr(0.6, 1.4)).tx(T.STREAK, 0.08).sz(0.05, 0.02, rr(0.5, 1.2), 0.3).col(0xffffff, c, 1, 0, 1.5);
      P.emit(true);
    }
    for (let i = 0; i < this.n(26); i++) {
      randDir();
      P.spec.reset().at(x, 1.0, z).v(PR.dx * 8, Math.abs(PR.dy) * 6, PR.dz * 8).ph(2.2, -1).ttl(rr(0.8, 1.6)).tx(T.SPARK).sz(0.25, 0.05).rt(rr(0, 3), 0).col(0xffffff, c, 1, 0, 1.5);
      P.emit(true);
    }
    this.dustRing(x, z, 14, 6, 1.0, 0.9);
    this.fx.r.addShake(0.07, 40);
    this.fx.O.spawn('gogogo', x, 2.4, z, 1.5, 1.6);
  }

  ultimateStart(ev: SimEvent, state: GameState): void {
    const c = auraColor(state.fighters[ev.player].char);
    const x = ev.pos.x / 1000, z = ev.pos.z / 1000;
    this.x = x; this.y = 1.0; this.z = z;
    this.fx.post.screenFlash(0xffffff, 0.6, 5);
    this.fx.post.speedLines(0.95, 1.1, 0xffffff);
    this.fx.post.vignettePulse(1.0);
    this.shock(6, 0.6, c, true);
    this.shock(4, 0.45, 0xffffff);
    this.glow(4, 0.4, 0xffffff, c, 1);
    this.sparks(24, 9, 1.4, 0xffffff, c, 0.9, 0.7, -1);
    this.fx.r.addShake(0.08, 20);
  }

  ultimateHit(ev: SimEvent): void {
    this.hit(ev, false, 3);
    this.fx.post.vignettePulse(0.8);
  }

  projectileLaunch(ev: SimEvent): void {
    const s = this.state;
    const el = ev.element ?? 'none';
    const col = elemCol(el);
    this.x = ev.pos.x / 1000; this.y = ev.pos.y / 1000; this.z = ev.pos.z / 1000;
    if (this.y < 0.2 && s) this.y = 1.2;
    this.glow(1.2, 0.14, 0xffffff, col[0], 0.9);
    this.fx.F.spawn('orb', this.x, this.y, this.z, 1.3, 0.4, 0xffffff, 0, 0.9);
    this.sparks(6, 4, 1.2, 0xffffff, col[0], 0.5, 0.3);
    this.shock(1.2, 0.18, col[0]);
  }

  projectileHit(ev: SimEvent): void {
    this.origin(ev.pos, 0.25);
    this.ax = 0; this.az = 0;
    const el = ev.element ?? 'none';
    const col = elemCol(el);
    this.sparks(12, 7, 1.2, 0xffffff, col[0], 0.7, 0.4);
    this.glow(1.8, 0.16, 0xffffff, col[0], 1);
    this.star(1.4, 0.14, 0xffffff);
    this.elemental(el, 0.9);
    this.fx.r.addShake(0.03, 5);
  }

  projectileDestroy(ev: SimEvent): void {
    this.origin(ev.pos, 0.2);
    const col = elemCol(ev.element);
    this.ax = 0; this.az = 0;
    this.sparks(7, 4, 1.2, 0xffffff, col[0], 0.5, 0.3);
    this.glow(1.0, 0.12, 0xffffff, col[0], 0.7);
  }

  ko(ev: SimEvent, state: GameState): void {
    const P = this.fx.P;
    const tgt = ev.target ?? (ev.player === 0 ? 1 : 0);
    const f = state.fighters[tgt];
    const x = (ev.pos.x || f.pos.x) / 1000, z = (ev.pos.z || f.pos.z) / 1000;
    this.x = x; this.y = 1.1; this.z = z; this.ax = 0; this.az = 0;
    const c = auraColor(state.fighters[ev.player].char);
    this.fx.post.impact(3);
    this.fx.post.screenFlash(0xffffff, 0.85, 3.5);
    this.fx.post.vignettePulse(1.0);
    this.fx.post.speedLines(0.7, 0.2);
    this.glow(7, 0.5, 0xffffff, 0xffa030, 1, 1.4);
    this.star(6, 0.4, 0xffffff);
    this.shock(8, 0.7, 0xffe9a0);
    this.shock(5, 0.5, c, true);
    this.sparks(60, 14, 1.4, 0xffffff, 0xff7a1a, 1.1, 0.9, 6);
    for (let i = 0; i < this.n(20); i++) {
      randDir();
      P.spec.reset().at(x, 1.1, z).v(PR.dx * 5, PR.dy * 5 + 1, PR.dz * 5).ph(2, -0.2).ttl(rr(0.5, 1.0)).tx(T.FLAME)
        .sz(1.0, 2.2, 1.4, 3).rt(rr(-0.4, 0.4), rr(-1, 1)).col(0xffe27a, 0xff3010, 1, 0, 1.3);
      P.emit(true);
    }
    this.smokePuffs(12, 3, 1.4, 1.4, 0x403028, 0x100a08, 0.6, 1.0);
    // slow lingering embers
    for (let i = 0; i < this.n(60); i++) {
      randDir();
      P.spec.reset().at(x + PR.dx * 0.3, 1.0 + PR.dy * 0.4, z + PR.dz * 0.3).v(PR.dx * 4, Math.abs(PR.dy) * 3 + 0.5, PR.dz * 4).ph(1.8, -0.35)
        .ttl(rr(2.2, 4.2)).tx(T.SOFT).sz(rr(0.08, 0.16), 0.01).col(0xffc860, 0xff3010, 1, 0, 1.6).rt(0, 0);
      P.spec.pe = 2;
      P.emit(true);
    }
    this.dustRing(x, z, 16, 7, 1.2, 1.0);
    this.fx.r.addShake(0.2, 30);
    this.fx.O.spawn('ko', x, 2.3, z, 1.7, 1.4);
  }

  clashStart(p: THREE.Vector3): void {
    this.x = p.x; this.y = p.y; this.z = p.z;
    this.fx.post.screenFlash(0xffffff, 0.5, 6);
    this.shock(5, 0.4, 0xffffff);
    this.glow(3, 0.3, 0xffffff, 0xaad8ff, 1);
    this.fx.r.addShake(0.06, 12);
  }

  clashEnd(p: THREE.Vector3): void {
    const P = this.fx.P;
    this.x = p.x; this.y = p.y; this.z = p.z; this.ax = 0; this.az = 0;
    this.fx.post.screenFlash(0xffffff, 0.8, 4);
    this.fx.post.impact(3);
    this.glow(8, 0.5, 0xffffff, 0x60b8ff, 1, 1.4);
    this.star(6, 0.35, 0xffffff);
    this.shock(9, 0.7, 0xaad8ff);
    this.sparks(50, 14, 1.4, 0xffffff, 0x6fe8ff, 1.0, 0.9);
    for (let i = 0; i < this.n(30); i++) {
      randDir();
      P.spec.reset().at(p.x, p.y, p.z).v(PR.dx * 9, PR.dy * 9, PR.dz * 9).ph(2.2, 0).ttl(rr(0.6, 1.4)).tx(T.SPARK).sz(0.3, 0.05).rt(rr(0, 3), 0).col(0xffffff, 0x3a90ff, 1, 0, 1.6);
      P.emit(true);
    }
    this.fx.r.addShake(0.15, 22);
  }
}
