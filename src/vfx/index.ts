// VFX system: pooled particles, decals, projectile visuals, beam clash, auras, post effects.
// Call order per render frame: vfx.update(dt, state) BEFORE renderer.render();
// vfx.handleEvents(state.events, state) once after each sim step.
import * as THREE from 'three';
import type { GameState, SimEvent } from '../sim/types';
import type { GameRenderer, Quality } from '../render';
import { ParticleSystem } from './particles';
import { DecalFx, Onomato } from './quads';
import { PostFx } from './post';
import { Effects } from './effects';
import type { FxCtx } from './effects';
import { Auras, ClashFx, ProjectileFx } from './projectiles';
import { XoverFx } from './xover';

export class VfxSystem {
  private readonly root = new THREE.Group();
  private readonly P = new ParticleSystem();
  private readonly D: DecalFx;
  private readonly O: Onomato;
  private readonly post = new PostFx();
  private readonly fx: FxCtx;
  private readonly eff: Effects;
  private readonly proj: ProjectileFx;
  private readonly clash: ClashFx;
  private readonly auras: Auras;
  private readonly xover: XoverFx;
  private quality: Quality = 'high';
  private lastState: GameState | null = null;
  private warned = false;

  constructor(private r: GameRenderer) {
    this.root.name = 'vfx';
    this.D = new DecalFx(this.root, r.camera);
    this.O = new Onomato(this.root);
    this.fx = { P: this.P, D: this.D, O: this.O, post: this.post, r, cam: r.camera, scale: 1, low: false };
    this.eff = new Effects(this.fx);
    const chest = (p: 0 | 1, out: THREE.Vector3): THREE.Vector3 => this.chest(p, out);
    this.proj = new ProjectileFx(this.fx, chest);
    this.clash = new ClashFx(this.fx, chest, this.eff, this.proj);
    this.auras = new Auras(this.fx);
    this.xover = new XoverFx(this.fx, this.eff, chest);
    this.root.add(this.P.group, this.proj.group, this.clash.group, this.auras.group, this.xover.group);
    r.scene.add(this.root);
    r.setPostPass((rr) => this.post.render(rr));
    this.setQuality('high');
  }

  /** chest world position; falls back to the fighter's sim position if the renderer has no rig yet */
  private chest(p: 0 | 1, out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    this.r.getBoneWorld(p, 'chest', out);
    if (out.lengthSq() < 1e-6) {
      const f = this.lastState?.fighters[p];
      if (f) out.set(f.pos.x / 1000, f.pos.y / 1000 + 1.25, f.pos.z / 1000);
    }
    return out;
  }

  /** spawn effects for sim events of the latest step */
  handleEvents(events: SimEvent[], state: GameState): void {
    this.lastState = state;
    this.eff.state = state;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]!;
      switch (ev.type) {
        case 'hit': {
          // a 'counter' event for the same contact supersedes the plain hit
          let dup = false;
          for (let j = 0; j < events.length; j++) {
            const o = events[j]!;
            if (o.type === 'counter' && o.player === ev.player && o.frame === ev.frame) { dup = true; break; }
          }
          if (!dup) this.eff.hit(ev, false);
          break;
        }
        case 'counter': this.eff.hit(ev, true); break;
        case 'block': this.eff.block(ev); break;
        case 'guardCrush': this.eff.guardCrush(ev); break;
        case 'parry': this.eff.parry(ev); break;
        case 'throw': this.eff.throwImpact(ev); break;
        case 'throwBreak': this.eff.throwBreak(ev); break;
        case 'launch': this.eff.launch(ev); break;
        case 'wallSplat': this.eff.wallSplat(ev, state); break;
        case 'groundBounce': this.eff.land(ev, true); break;
        case 'knockdown': this.eff.land(ev, true); break;
        case 'land': this.eff.land(ev, false); break;
        case 'dash': this.eff.dash(ev); break;
        case 'sidestep': this.eff.sidestep(ev); break;
        case 'vanish': this.eff.vanish(ev, state, (p, o) => this.chest(p, o)); break;
        case 'kiCharge': this.eff.kiBurst(ev, false); break;
        case 'kiFull': this.eff.kiBurst(ev, true); break;
        case 'awaken': this.eff.awaken(ev, state); break;
        case 'ultimateStart': this.eff.ultimateStart(ev, state); break;
        case 'ultimateHit': this.eff.ultimateHit(ev); break;
        case 'projectile': this.eff.projectileLaunch(ev); break;
        case 'projectileHit': this.eff.projectileHit(ev); break;
        case 'projectileDestroy': this.eff.projectileDestroy(ev); break;
        case 'ko': this.eff.ko(ev, state); break;
        default: break; // clash start/end are driven from state.clash.active in update()
      }
      // crossover pack: hint-driven flourishes, forms, realms, clones (never let one bad effect break the rest)
      try { this.xover.handle(ev, state); } catch (e) { if (!this.warned) { this.warned = true; console.warn('[vfx] xover', e); } }
    }
  }

  /** per render frame */
  update(dt: number, state: GameState): void {
    dt = Math.min(Math.max(dt, 0), 0.05);
    this.lastState = state;
    this.eff.state = state;
    this.post.update(dt);
    this.P.update(dt);
    this.D.update(dt);
    this.O.update(dt);
    this.auras.update(dt, state);
    this.proj.update(dt, state);
    this.clash.update(dt, state);
    try { this.xover.update(dt, state); } catch (e) { if (!this.warned) { this.warned = true; console.warn('[vfx] xover', e); } }
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const max = q === 'low' ? 600 : q === 'medium' ? 1100 : 1500;
    this.P.setMax(max);
    this.fx.scale = q === 'low' ? 0.45 : q === 'medium' ? 0.75 : 1;
    this.fx.low = q === 'low';
    this.post.level = q === 'low' ? 0 : q === 'medium' ? 1 : 2;
  }

  /** individual graphics toggles from the settings screen (particle level is independent of the coarse quality bucket) */
  setGfx(o: { particles: Quality; impactFrames: boolean; speedLines: boolean; colorGrade: boolean; bloom: boolean }): void {
    const q = o.particles;
    this.P.setMax(q === 'low' ? 600 : q === 'medium' ? 1100 : 1500);
    this.fx.scale = q === 'low' ? 0.45 : q === 'medium' ? 0.75 : 1;
    this.fx.low = q === 'low';
    this.post.allowImpact = o.impactFrames; this.post.allowLines = o.speedLines; this.post.allowGrade = o.colorGrade; this.post.allowBloom = o.bloom;
    if (!o.impactFrames) this.post.impactLeft = 0;
  }

  /** turn flashing effects (impact frames, strong screen flashes) on/off for accessibility */
  setReduceFlashing(on: boolean): void {
    this.post.reduce = on;
    if (on) this.post.clear();
  }

  clear(): void {
    this.P.clear();
    this.D.clear();
    this.O.clear();
    this.post.clear();
    this.proj.clear();
    this.clash.clear();
    this.auras.clear();
    this.xover.clear();
  }

  /** extra (not part of the contract): remove everything from the scene */
  dispose(): void {
    this.r.setPostPass(null);
    this.root.removeFromParent();
    this.P.dispose(); this.D.dispose(); this.O.dispose(); this.post.dispose();
    this.proj.dispose(); this.clash.dispose(); this.auras.dispose(); this.xover.dispose();
  }
}
