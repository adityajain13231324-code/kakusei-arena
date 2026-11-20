/**
 * KAKUSEI ARENA renderer (three.js WebGLRenderer).
 * Owned by the RENDER agent. Public signatures are the shared contract; extra helpers are additive.
 *
 * Notes for other modules:
 *  - Fighters are skinned GLB models (public/characters/<id>/model.glb, model_1024.glb on low quality),
 *    loaded asynchronously. loadMatch() awaits them and pre-compiles shaders. Until loaded, update()/render()
 *    still work (stage + camera only).
 *  - The scene is drawn straight to the default framebuffer, then the post pass (setPostPass) runs
 *    with autoClear disabled.
 *  - addShake(intensity, frames): intensity is metres of camera offset (≈0.012 light … 0.2 KO).
 *  - getBoneWorld returns real bone world positions (metres). 'weapon' = blade centre (Ren) / kunai tip
 *    (Shiori) while drawn, otherwise the right hand.
 *  - Antialias is decided at construction: localStorage 'kakusei-quality' ('low'|'medium'|'high') if set,
 *    otherwise high on desktop / medium on touch devices. setQuality() changes everything else live.
 *  - While a menu scene is shown, call updateMenu(dt) every frame; render() draws the menu scene when no match
 *    is loaded.
 *  - Any CharId works: fighters without public/characters/<id>/model.glb render as a grey mannequin
 *    (public/characters/_mannequin/model.glb) with their palette accent as rim colour. Dropped-in models may use
 *    Mixamo names (with or without the mixamorig prefix), A- or T-pose, centimetre armatures.
 *  - Forms: while FighterState.form is set and characters/<id>/form_<form>.glb exists, that model replaces the
 *    base one (camera pulls back for giant forms). setFormResolver / prewarmForm are optional hooks.
 *  - Summons (state.summons) draw as translucent tinted copies of the owner's model.
 *  - Realms: registerRealm(kind, builder) + state.realm.kind (or setRealm) cross-dissolve the stage into a realm
 *    StageBuild; prewarmRealm builds/compiles it ahead of time.
 */
import * as THREE from 'three';
import type { GameState, Capsule, CharId, StageId, MoveDef, FighterState } from '../sim/types';
import { ALL_CHARS } from '../sim/types';
import { getChar, getMove } from '../sim';
import './stage/realms';
import type { RealmBuild } from './stage/realms/kit';
import { FighterView, type SocketName } from './fighter/FighterView';
import { loadCharacter, loadForm, getLoadedCharacter, disposeCharacterCache, type ModelRes, type CharAsset } from './fighter/assets';
import { charLook, resolvePalette } from './fighter/looks';
import { FightCamera } from './camera';
import { DebugBoxes } from './debug';
import { buildStage, getRealmBuilder, type StageBuild } from './stage';
import { stageTuning } from './stage/common';
export { registerRealm, unregisterRealm, registeredRealms, type RealmBuilder } from './stage';
import { blankFighter } from './util';
import type { MoveLookup } from './anim/sampler';
import { defaultMoveLookup } from './anim/sampler';

export type Quality = 'low' | 'medium' | 'high';
/** individual graphics toggles (settings screen); `quality` is the coarse bucket for everything without its own toggle */
export interface GfxOptions {
  quality: Quality;
  /** render resolution multiplier (applied on top of min(devicePixelRatio, 1.5)) */
  scale: number;
  shadows: 'off' | 'low' | 'high';
  outlines: boolean;
  texRes: 1024 | 2048;
  crowd: 'off' | 'low' | 'high';
  sky: 'low' | 'high';
}
export type BoneName = 'head' | 'chest' | 'hips' | 'handL' | 'handR' | 'footL' | 'footR' | 'weapon';

const STRENGTH: Record<string, number> = { light: 0.2, medium: 0.45, heavy: 0.75, super: 1 };
const _v = new THREE.Vector3();
const _c = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _MENU_SUN = new THREE.Vector3();
const _KEY = new THREE.Vector3();
const _RIM = new THREE.Vector3();
const _side = new THREE.Vector3();
const _hc = new THREE.Color();

function initialQuality(): Quality {
  try {
    const q = typeof localStorage !== 'undefined' ? localStorage.getItem('kakusei-quality') : null;
    if (q === 'low' || q === 'medium' || q === 'high') return q;
  } catch { /* ignore */ }
  const touch = typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 1 && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return touch ? 'medium' : 'high';
}

interface MenuSlot { char: CharId; view: FighterView | null; state: FighterState; x: number; ang: number }
interface MenuState { active: boolean; slots: MenuSlot[]; t: number; layout: 'title' | 'select' | 'empty'; token: number }

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 400);
  private quality: Quality;
  private dpr = 1;
  private size = { w: 1280, h: 720 };
  private fcam: FightCamera;
  private views: [FighterView | null, FighterView | null] = [null, null];
  /** alternate-form views per player (form_<name>.glb), built lazily; null entry = no such model */
  private formViews: [Map<string, FighterView | null>, Map<string, FighterView | null>] = [new Map(), new Map()];
  /** the view currently drawn per player (base or form) */
  private active: [FighterView | null, FighterView | null] = [null, null];
  private formOf: (f: FighterState) => string | null = (f) => {
    const v = (f as FighterState & { form?: unknown }).form;
    return typeof v === 'string' && v ? v : null;
  };
  /** summoned copies (e.g. shadow clones): pooled ghost views of the owner's model */
  private clones: Array<{ view: FighterView; st: FighterState; char: CharId }> = [];
  // realm takeover layer
  private realmBuilds = new Map<string, StageBuild>();
  private realmId: string | null = null;
  /** realms currently shown (up to two during a Realm Clash), with their dissolve amount */
  private realmSlots: Array<{ id: string; b: StageBuild; k: number; side: number }> = [];
  private realmManual = false;
  private clashSeam = new THREE.Vector4();
  private baseFog = new THREE.Color();
  private baseBg = new THREE.Color();
  private stage: StageBuild | null = null;
  private stageId: StageId | null = null;
  private stageHalf = 0;
  private stageQuality: Quality | null = null;
  private stageKey = '';
  private gfx: GfxOptions;
  private sun = new THREE.DirectionalLight(0xffffff, 2.4);
  /** flat ambient (anime look: no smooth hemisphere gradients on toon surfaces) */
  private hemi = new THREE.AmbientLight(0xffffff, 1.2);
  /** back light (stage moon / sun colour) so fighters pop off the background; no shadows */
  private rimLight = new THREE.DirectionalLight(0xffffff, 1.6);
  private stageRim = new THREE.Color('#ffffff');
  private debug = new DebugBoxes();
  private post: ((r: THREE.WebGLRenderer) => void) | null = null;
  private time = 0;
  private lastEventFrame = -1;
  private menu: MenuState = { active: false, slots: [], t: 0, layout: 'empty', token: 0 };
  private menuPool = new Map<string, FighterView>();
  private snapCache = new Map<string, string>();
  private moveLookup: MoveLookup = defaultMoveLookup;
  private matchKey: string | null = null;
  private matchLoad: Promise<void> | null = null;
  private matchToken = 0;

  constructor(canvas: HTMLCanvasElement, opts: { antialias?: boolean } = {}) {
    this.quality = initialQuality();
    this.gfx = { quality: this.quality, scale: 1, shadows: this.quality === 'low' ? 'off' : 'high', outlines: true, texRes: this.quality === 'low' ? 1024 : 2048, crowd: 'high', sky: 'high' };
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: opts.antialias ?? this.quality === 'high', powerPreference: 'high-performance', alpha: false, stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.renderer.setPixelRatio(this.pixelRatioFor(this.dpr));
    this.fcam = new FightCamera(this.camera);
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.025;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.near = 0.5; sc.far = 40;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.rimLight, this.rimLight.target, this.debug.group);
    this.scene.background = new THREE.Color('#0b0b14');
    this.applyQualityToLights();
    this.camera.position.set(0, 1.5, 6);
    this.camera.lookAt(0, 1.1, 0);
    // warm the cache: every fighter id the sim knows (read dynamically; fighters without a model share the mannequin)
    for (const c of ALL_CHARS) loadCharacter(c, this.res()).catch((e) => console.warn('[render] preload failed', c, e));
  }

  // ------------------------------------------------------------------ setup
  private res(): ModelRes { return this.gfx.texRes; }

  private pixelRatioFor(dpr: number): number {
    return Math.min(2.5, Math.max(0.35, Math.min(dpr, 1.5) * this.gfx.scale));
  }

  private applyQualityToLights(): void {
    const sh = this.gfx.shadows;
    this.sun.castShadow = sh !== 'off';
    const ms = sh === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== ms) {
      this.sun.shadow.mapSize.set(ms, ms);
      this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; // re-allocated at the new size on next render
    }
  }

  private applyViewGfx(v: FighterView): void {
    v.setQuality(this.quality);
    v.setShadows(this.gfx.shadows !== 'off');
    v.setOutlines(this.gfx.outlines);
    v.animV2 = this.animV2;
  }

  // ------------------------------------------------------------------ Animation v2 (docs/ANIMATION.md)
  private animV2 = true;
  private eachView(fn: (v: FighterView) => void): void {
    for (const v of this.views) if (v) fn(v);
    for (const m of this.formViews) for (const v of m.values()) if (v) fn(v);
    for (const v of this.menuPool.values()) fn(v);
    for (const c of this.clones) fn(c.view);
  }
  /** true = Animation v2 clip layer, false = the v1 pose blender (Training debug comparison, F3) */
  get animV2On(): boolean { return this.animV2; }
  setAnimV2(on: boolean): void { this.animV2 = on; this.eachView((v) => { v.animV2 = on; }); }
  /**
   * Add authored clips to every live view of a fighter (dev / tests; files go in characters/<id>/anims.glb).
   * `root` = the rig the clips were made on, at rest (default: the fighter's own model). Returns views updated.
   */
  registerClips(char: CharId, clips: THREE.AnimationClip[], root?: THREE.Object3D): number {
    let n = 0;
    this.eachView((v) => { if (v.char === char) { v.addClips({ clips, root }); n++; } });
    return n;
  }
  /** one line per active fighter: clip playing (+ authored clip weight) */
  animDebug(): string {
    const out: string[] = [];
    for (let i = 0; i < 2; i++) {
      const v = this.active[i];
      if (!v) continue;
      const w = v.clips.weight;
      if (!v.animV2) { out.push(`P${i + 1} pose ${v.poseName}`); continue; }
      out.push(`P${i + 1} ${v.anim.clipName}${w > 0.01 ? ` +clip ${(w * 100) | 0}%` : ''}`);
    }
    return out.join(' · ');
  }

  private setStage(id: StageId, halfM: number): void {
    if (this.stage && this.stageId === id && Math.abs(this.stageHalf - halfM) < 1e-3 && this.stageQuality === this.quality && this.stageKey === this.stageTuneKey()) return;
    if (this.stage) { this.stage.dispose(); this.scene.remove(this.stage.group); }
    this.disposeRealms();
    stageTuning.crowd = this.gfx.crowd === 'off' ? 0 : this.gfx.crowd === 'low' ? 0.55 : 1;
    stageTuning.sky = this.gfx.sky === 'low' ? 0 : 1;
    stageTuning.texRes = this.gfx.texRes;
    this.stage = buildStage(id, halfM, this.quality);
    this.stageKey = this.stageTuneKey();
    this.stageId = id;
    this.stageHalf = halfM;
    this.stageQuality = this.quality;
    this.scene.add(this.stage.group);
    // copies: the realm layer blends these in place
    this.scene.fog = this.stage.fog ? this.stage.fog.clone() : null;
    this.scene.background = this.stage.background.clone();
    this.sun.color.copy(this.stage.sunColor);
    this.sun.intensity = this.stage.sunIntensity;
    this.hemi.color.copy(this.stage.hemiSky).lerp(this.stage.hemiGround, 0.35);
    this.hemi.intensity = this.stage.hemiIntensity;
    this.stageRim.copy(this.stage.rim ?? this.stage.sunColor);
    this.rimLight.color.copy(this.stageRim);
    this.rimLight.intensity = 1.5;
    this.fcam.bound = halfM + (id === 'training' ? 6 : 3.1);
    for (const v of this.views) { v?.setShadowTint(this.stage.shadowTint); v?.setStageRim(this.stageRim); }
    for (const m of this.formViews) for (const v of m.values()) { v?.setShadowTint(this.stage.shadowTint); v?.setStageRim(this.stageRim); }
    for (const v of this.menuPool.values()) { v.setShadowTint(this.stage.shadowTint); v.setStageRim(this.stageRim); }
  }

  private makeView(char: CharId, asset: CharAsset, alt: boolean): FighterView {
    const v = new FighterView(char, asset, { alt });
    v.lookup = this.moveLookup;
    this.applyViewGfx(v);
    v.setShadowTint(this.stage ? this.stage.shadowTint : null);
    if (this.stage) v.setStageRim(this.stageRim);
    this.scene.add(v.group);
    return v;
  }

  private clearMatch(): void {
    for (const v of this.views) v?.dispose();
    for (const m of this.formViews) { for (const v of m.values()) v?.dispose(); m.clear(); }
    for (const c of this.clones) c.view.dispose();
    this.clones = [];
    this.views = [null, null];
    this.active = [null, null];
    this.matchKey = null;
    this.matchLoad = null;
    this.matchToken++;
  }

  private clearMenu(): void {
    for (const v of this.menuPool.values()) v.dispose();
    this.menuPool.clear();
    this.menu = { active: false, slots: [], t: 0, layout: 'empty', token: this.menu.token + 1 };
  }

  private ensureMatch(state: GameState): Promise<void> {
    const half = (state.arenaHalfSize || 5000) / 1000;
    const c0 = state.fighters[0].char, c1 = state.fighters[1].char;
    if (this.menu.active) this.clearMenu();
    this.setStage(state.stage, half);
    const key = `${c0}|${c1}|${this.res()}`;
    if (this.matchKey === key && this.matchLoad) return this.matchLoad;
    this.clearMatch();
    this.matchKey = key;
    this.fcam.reset();
    const token = this.matchToken;
    const res = this.res();
    this.matchLoad = Promise.all([loadCharacter(c0, res), loadCharacter(c1, res)]).then(([a0, a1]) => {
      if (token !== this.matchToken) return;
      this.views = [this.makeView(c0, a0, false), this.makeView(c1, a1, c0 === c1)];
    });
    this.matchLoad.catch((e) => console.warn('[render] fighter load failed', e));
    return this.matchLoad;
  }

  async loadMatch(state: GameState): Promise<void> {
    await this.ensureMatch(state);
    // pre-build + compile both fighters' Soul Realms (no hitch when one opens)
    for (const f of state.fighters) { const k = this.realmKindOf(f.char); if (k) this.prewarmRealm(k); }
    this.update(null, state, 1, 1 / 60);
    // pre-compile every shader variant (no hitch on first hit)
    try {
      const r = this.renderer as THREE.WebGLRenderer & { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown> };
      if (r.compileAsync) await r.compileAsync(this.scene, this.camera);
      else this.renderer.compile(this.scene, this.camera);
    } catch { /* ignore */ }
  }

  /** Optional (additive): supply MoveDef lookup (dev harness / tests). Defaults to sim getMove. */
  setMoveLookup(fn: ((char: CharId, moveId: string) => MoveDef | undefined) | null): void {
    this.moveLookup = fn ?? defaultMoveLookup;
    for (const v of this.views) if (v) v.lookup = this.moveLookup;
    for (const m of this.formViews) for (const v of m.values()) if (v) v.lookup = this.moveLookup;
  }

  // ------------------------------------------------------------------ per frame
  /** prev/state = last two sim states, alpha = interpolation 0..1, dt = real seconds since last call */
  update(prev: GameState | null, state: GameState, alpha: number, dt: number): void {
    void this.ensureMatch(state);
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;
    // events (once per sim frame)
    if (state.frame !== this.lastEventFrame) {
      this.lastEventFrame = state.frame;
      let cheer = 0;
      for (const e of state.events) {
        if ((e.type === 'hit' || e.type === 'counter' || e.type === 'ultimateHit' || e.type === 'throw') && e.target !== undefined) {
          const st = e.type === 'ultimateHit' ? 1 : STRENGTH[e.strength ?? 'medium'] ?? 0.4;
          const atk = state.fighters[e.player], def = state.fighters[e.target];
          this.active[e.target]?.onHit(st, def.pos.x - atk.pos.x, def.pos.z - atk.pos.z, e.type === 'counter');
          this.active[e.player]?.onStrike(st);
          // Gear Fifth cartoon physics: hit reactions squash & stretch
          if (atk && (atk.form === 'gear5' || state.realm?.kind === 'gear_fifth')) this.active[e.target]?.squash(0.12 + st * 0.3);
        }
        if (e.type === 'groundBounce' && e.tag === 'gear5' && e.target !== undefined) this.active[e.target]?.squash(0.35);
        if (e.type === 'ko') cheer = Math.max(cheer, 1);
        else if (e.type === 'ultimateHit') cheer = Math.max(cheer, 0.75);
        else if (e.type === 'counter' || e.type === 'awaken') cheer = Math.max(cheer, 0.55);
        else if (e.type === 'wallSplat' || e.type === 'launch' || e.type === 'throw') cheer = Math.max(cheer, 0.35);
      }
      if (cheer > 0) this.stage?.cheer?.(cheer);
    }
    let tall = 1;
    for (let i = 0; i < 2; i++) {
      const f = state.fighters[i];
      const v = this.pickView(i as 0 | 1, f);
      if (v) {
        const form = this.formOf(f) ?? '';
        v.setForm(form, !!form && v === this.views[i] && form === 'titan');
        v.update(f, prev ? prev.fighters[i] : null, alpha, dt, this.time);
        this.fcam.fighterPos[i].copy(v.group.position);
        if (v.form) tall = Math.max(tall, v.modelHeight / 2.05);
        if (v.formScale > 1.3) tall = Math.max(tall, v.formScale * 0.95);
      } else this.fcam.fighterPos[i].set(f.pos.x / 1000, f.pos.y / 1000, f.pos.z / 1000);
    }
    this.updateSummons(state, dt);
    // giant forms: pull the fight camera back
    this.fcam.zoom += (Math.min(2.6, tall) - this.fcam.zoom) * Math.min(1, dt * 3);
    this.fcam.update(prev, state, alpha, dt);
    this.updateRealm(state, dt);
    // light follows the fight (tight shadow camera)
    if (this.stage) {
      _c.copy(this.fcam.fighterPos[0]).add(this.fcam.fighterPos[1]).multiplyScalar(0.5);
      _c.y = 0;
      const sep = this.fcam.fighterPos[0].distanceTo(this.fcam.fighterPos[1]);
      // key light from the camera side (faces read), stage light becomes the back/rim light
      this.keyDir(this.fcam.normal, _KEY);
      this.placeSun(_c, Math.max(2.6, sep * 0.5 + 1.8), _KEY);
      this.placeRim(_c, this.fcam.normal);
      this.stage.update(this.time, dt);
    }
  }

  /** key light direction: mostly from the camera, raised, a bit to the side of the stage light */
  private keyDir(camN: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const sd = this.stage ? this.stage.sunDir : _RIM.set(0.4, 0.8, 0.4);
    _side.set(-camN.z, 0, camN.x);
    const sgn = _side.dot(sd) >= 0 ? 1 : -1;
    return out.copy(camN).multiplyScalar(0.8).addScaledVector(_side, 0.45 * sgn).setY(1.05).normalize();
  }

  /** rim/back light opposite the camera, on the stage light's side */
  private placeRim(center: THREE.Vector3, camN: THREE.Vector3): void {
    const sd = this.stage ? this.stage.sunDir : _RIM.set(0.4, 0.8, 0.4);
    _side.set(-camN.z, 0, camN.x);
    const sgn = _side.dot(sd) >= 0 ? 1 : -1;
    _RIM.copy(camN).multiplyScalar(-1).addScaledVector(_side, 0.6 * sgn).setY(0.55).normalize();
    this.rimLight.target.position.copy(center);
    this.rimLight.position.copy(center).addScaledVector(_RIM, 15);
    this.rimLight.target.updateMatrixWorld();
  }

  // ------------------------------------------------------------------ forms
  /** base view, or the alternate-form view while the fighter is in that form (once its model is loaded) */
  private pickView(i: 0 | 1, f: FighterState): FighterView | null {
    const base = this.views[i];
    let want: FighterView | null = base;
    const form = base ? this.formOf(f) : null;
    if (form && base) {
      const m = this.formViews[i];
      if (!m.has(form)) {
        m.set(form, null);
        const token = this.matchToken;
        loadForm(f.char, form, this.res()).then((a) => {
          if (!a || token !== this.matchToken) return;
          const v = this.makeView(f.char, a, base.u.uHue.value !== 0);
          v.group.visible = false;
          m.set(form, v);
        }).catch(() => { /* stays null: base model keeps playing */ });
      }
      want = m.get(form) ?? base;
    }
    const cur = this.active[i];
    if (cur !== want) {
      if (cur) cur.group.visible = false;
      if (want) want.group.visible = true;
      this.active[i] = want;
    }
    return want;
  }

  /** Optional (additive): how to read a fighter's current form name (default: optional FighterState.form). */
  setFormResolver(fn: ((f: FighterState) => string | null) | null): void {
    this.formOf = fn ?? ((f) => { const v = (f as FighterState & { form?: unknown }).form; return typeof v === 'string' && v ? v : null; });
  }

  /** Optional (additive): load a fighter's form model ahead of time (e.g. during the VS screen). */
  prewarmForm(char: CharId, form: string): Promise<boolean> {
    return loadForm(char, form, this.res()).then((a) => !!a);
  }

  // ------------------------------------------------------------------ summons
  private updateSummons(state: GameState, dt: number): void {
    const list = state.summons;
    const n = list ? list.length : 0;
    let used = 0;
    for (let k = 0; k < n; k++) {
      const sm = list![k];
      const owner = state.fighters[sm.owner];
      const base = this.views[sm.owner];
      if (!base) continue;
      let slot = -1;
      for (let j = used; j < this.clones.length; j++) if (this.clones[j].char === owner.char) { slot = j; break; }
      if (slot < 0) {
        const asset = getLoadedCharacter(owner.char, this.res());
        if (!asset) continue;
        const view = this.makeView(owner.char, asset, base.u.uHue.value !== 0);
        this.clones.push({ view, st: blankFighter(owner.char), char: owner.char });
        slot = this.clones.length - 1;
      }
      if (slot !== used) { const t = this.clones[used]; this.clones[used] = this.clones[slot]; this.clones[slot] = t; }
      const c = this.clones[used++];
      const st = c.st;
      st.pos.x = sm.pos.x; st.pos.y = sm.pos.y; st.pos.z = sm.pos.z;
      st.facing.x = sm.facing.x; st.facing.z = sm.facing.z;
      st.vel.x = 0; st.vel.y = 0; st.vel.z = 0;
      st.mode = sm.mode === 'attack' ? 'attack' : 'idle';
      st.moveId = sm.mode === 'attack' ? sm.moveId : null;
      st.moveFrame = sm.moveFrame; st.modeFrame = sm.modeFrame;
      st.pose = sm.pose; st.awakened = owner.awakened;
      const fade = sm.mode === 'appear' ? Math.min(1, sm.modeFrame / 12) : sm.life < 12 ? Math.max(0, sm.life / 12) : 1;
      c.view.setGhost(0.72 * fade, owner.awakened ? '#ffb347' : '#9fd8ff');
      c.view.group.visible = fade > 0.01;
      c.view.update(st, null, 1, dt, this.time);
    }
    for (let j = used; j < this.clones.length; j++) this.clones[j].view.group.visible = false;
  }

  // ------------------------------------------------------------------ realm takeover
  private realmBuild(id: string): StageBuild | null {
    let b = this.realmBuilds.get(id) ?? null;
    if (b) return b;
    const builder = getRealmBuilder(id);
    if (!builder) return null;
    try { b = builder(this.stageHalf || 5, this.quality); } catch (e) { console.warn('[render] realm build failed', id, e); return null; }
    b.group.visible = false;
    this.scene.add(b.group);
    this.realmBuilds.set(id, b);
    return b;
  }

  /** Optional (additive): build a registered realm + compile its shaders ahead of time. */
  prewarmRealm(id: string): void {
    const b = this.realmBuild(id);
    if (!b) return;
    b.group.visible = true;
    b.setDissolve?.(0.5);
    try { this.renderer.compile(this.scene, this.camera); } catch { /* ignore */ }
    const sl = this.realmSlots.find((x) => x.b === b);
    b.setDissolve?.(sl ? sl.k : 0);
    b.group.visible = !!sl && sl.k > 0;
  }

  /**
   * Optional (additive): show a registered realm over the stage (cross-dissolve), null = back to the stage.
   * While set manually this overrides state.realm.
   */
  setRealm(id: string | null): void {
    this.realmManual = id !== null;
    this.realmId = id;
  }

  /** realm kind of a fighter's Soul Realm move (CharDef.realmId -> MoveDef.realm.kind) */
  private realmKindOf(char: CharId): string | null {
    try {
      const id = getChar(char).realmId;
      if (!id) return null;
      return getMove(char, id)?.realm?.kind ?? null;
    } catch { return null; }
  }

  private updateRealm(state: GameState, dt: number): void {
    // which realms should be on screen
    const want: Array<{ id: string; side: number }> = [];
    let cx = (this.fcam.fighterPos[0].x + this.fcam.fighterPos[1].x) / 2, cz = (this.fcam.fighterPos[0].z + this.fcam.fighterPos[1].z) / 2;
    const clash = state.clash as GameState['clash'] & { kind?: string; moves?: string[] };
    if (this.realmManual) { if (this.realmId) want.push({ id: this.realmId, side: 0 }); }
    else if (clash.active && clash.kind === 'realm') {
      // Realm Clash: both worlds, split down the middle, seam through the clash point
      const k0 = this.realmKindOf(state.fighters[0].char), k1 = this.realmKindOf(state.fighters[1].char);
      const a = this.fcam.fighterPos[0], b = this.fcam.fighterPos[1];
      let nx = b.x - a.x, nz = b.z - a.z;
      const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      const px = clash.point.x / 1000, pz = clash.point.z / 1000;
      this.clashSeam.set(nx, nz, nx * px + nz * pz, 1);
      cx = px; cz = pz;
      if (k0) want.push({ id: k0, side: -1 });
      if (k1 && k1 !== k0) want.push({ id: k1, side: 1 });
      else if (k1 && want.length) want[0]!.side = 0;
    } else if (state.realm && typeof state.realm.kind === 'string') {
      want.push({ id: state.realm.kind, side: 0 });
      const o = this.fcam.fighterPos[state.realm.owner];
      cx = o.x; cz = o.z;
    }
    this.realmId = want.length ? want[0]!.id : null;
    // add slots
    for (const w of want) {
      let slot = this.realmSlots.find((x) => x.id === w.id);
      if (!slot) {
        const b = this.realmBuild(w.id);
        if (!b) continue;
        slot = { id: w.id, b, k: 0, side: w.side };
        this.realmSlots.push(slot);
        b.group.visible = true;
      }
      slot.side = w.side;
    }
    // animate
    const inClash = want.length > 1 || (want.length === 1 && want[0]!.side !== 0);
    for (let i = this.realmSlots.length - 1; i >= 0; i--) {
      const sl = this.realmSlots[i]!;
      const on = want.some((w) => w.id === sl.id);
      // opening fills most of the 90-frame cinematic; a clash snaps both worlds in; closing is quicker
      const rate = on ? (inClash ? 1 / 0.45 : 1 / 1.25) : 1 / 0.55;
      sl.k += Math.sign((on ? 1 : 0) - sl.k) * Math.min(Math.abs((on ? 1 : 0) - sl.k), dt * rate);
      const rb = sl.b as Partial<RealmBuild>;
      rb.setCenter?.(cx, cz);
      if (rb.setClip) {
        if (sl.side !== 0) rb.setClip(this.clashSeam.x, this.clashSeam.y, this.clashSeam.z, sl.side);
        else rb.setClip(0, 0, 0, 0);
      }
      if (sl.k > 0) sl.b.update(this.time, dt);
      if (sl.k <= 0 && !on) { sl.b.setDissolve?.(0); sl.b.group.visible = false; this.realmSlots.splice(i, 1); }
    }
    this.applyRealm();
  }

  private disposeRealms(): void {
    for (const b of this.realmBuilds.values()) { b.dispose(); this.scene.remove(b.group); }
    this.realmBuilds.clear();
    this.realmSlots = [];
  }

  private applyRealm(): void {
    const st = this.stage;
    if (!st) return;
    let top: { b: StageBuild; k: number } | null = null;
    let kMax = 0, kMin = 1;
    for (const sl of this.realmSlots) {
      const r = sl.b;
      if (r.setDissolve) { r.group.visible = sl.k > 0; r.setDissolve(sl.k); } else r.group.visible = sl.k >= 0.5;
      if (!top || sl.k > top.k) top = sl;
      kMax = Math.max(kMax, sl.k); kMin = Math.min(kMin, sl.k);
    }
    const split = this.realmSlots.length > 1 && this.realmSlots.every((x) => x.side !== 0);
    // bubble realms hide the stage only once fully expanded (both halves in a clash); others swap at the midpoint
    const bubble = !!top && !!(top.b as Partial<RealmBuild>).bubble;
    const hideStage = top ? (bubble ? (split ? kMin >= 0.999 : kMax >= 0.999) : kMax >= 0.5) : false;
    if (st.setDissolve) { st.group.visible = kMax < 1; st.setDissolve(1 - kMax); } else st.group.visible = !hideStage;
    const r = top?.b ?? null;
    const k = top ? (bubble ? Math.min(1, top.k * 1.15) : top.k) : 0;
    // environment blend
    this.baseBg.copy(st.background);
    if (r) this.baseBg.lerp(r.background, k);
    (this.scene.background as THREE.Color | null)?.copy?.(this.baseBg);
    if (this.scene.fog && st.fog) {
      this.baseFog.copy(st.fog.color);
      if (r?.fog) this.baseFog.lerp(r.fog.color, k);
      (this.scene.fog as THREE.Fog).color.copy(this.baseFog);
    }
    this.sun.color.copy(st.sunColor);
    this.sun.intensity = st.sunIntensity;
    this.hemi.color.copy(st.hemiSky).lerp(st.hemiGround, 0.35);
    this.hemi.intensity = st.hemiIntensity;
    this.rimLight.color.copy(this.stageRim);
    if (r) {
      this.sun.color.lerp(r.sunColor, k);
      this.sun.intensity += (r.sunIntensity - st.sunIntensity) * k;
      _hc.copy(r.hemiSky).lerp(r.hemiGround, 0.35);
      this.hemi.color.lerp(_hc, k);
      this.hemi.intensity += (r.hemiIntensity - st.hemiIntensity) * k;
      if (r.rim) this.rimLight.color.lerp(r.rim, k);
    }
  }

  /** Optional (additive): realm kinds currently on screen (dev / tests) */
  get realmsShown(): string[] { return this.realmSlots.filter((s) => s.k > 0).map((s) => s.id); }

  private placeSun(center: THREE.Vector3, extent: number, dir?: THREE.Vector3): void {
    if (!this.stage) return;
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(dir ?? this.stage.sunDir, 18);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    if (Math.abs(sc.right - extent) > 0.05) {
      sc.left = -extent; sc.right = extent; sc.top = extent; sc.bottom = -extent;
      sc.updateProjectionMatrix();
    }
    this.sun.target.updateMatrixWorld();
  }

  render(): void {
    const r = this.renderer;
    r.info.reset();
    r.autoClear = true;
    r.render(this.scene, this.camera);
    if (this.post) {
      r.autoClear = false;
      this.post(r);
      r.autoClear = true;
    }
  }

  resize(w: number, h: number, pixelRatio: number): void {
    this.size.w = Math.max(1, w); this.size.h = Math.max(1, h);
    this.dpr = pixelRatio || 1;
    this.renderer.setPixelRatio(this.pixelRatioFor(this.dpr));
    this.renderer.setSize(this.size.w, this.size.h, true);
    this.camera.aspect = this.size.w / this.size.h;
    this.camera.updateProjectionMatrix();
  }

  private stageTuneKey(): string { return `${this.gfx.crowd}|${this.gfx.sky}|${this.gfx.texRes}`; }

  /** apply all graphics toggles live (cheap no-op when nothing changed) */
  setGfx(o: GfxOptions): void {
    const prev = this.gfx;
    const same = prev.quality === o.quality && prev.scale === o.scale && prev.shadows === o.shadows && prev.outlines === o.outlines && prev.texRes === o.texRes && prev.crowd === o.crowd && prev.sky === o.sky;
    if (same) return;
    const oldRes = this.res();
    this.gfx = { ...o };
    this.quality = o.quality;
    try { localStorage.setItem('kakusei-quality', o.quality); } catch { /* ignore */ }
    this.renderer.setPixelRatio(this.pixelRatioFor(this.dpr));
    this.renderer.setSize(this.size.w, this.size.h, true);
    this.applyQualityToLights();
    const each = (v: FighterView | null | undefined) => { if (v) this.applyViewGfx(v); };
    for (const v of this.views) each(v);
    for (const m of this.formViews) for (const v of m.values()) each(v);
    for (const v of this.menuPool.values()) each(v);
    for (const c of this.clones) each(c.view);
    if (this.stageId && (prev.quality !== o.quality || prev.crowd !== o.crowd || prev.sky !== o.sky || prev.texRes !== o.texRes)) this.setStage(this.stageId, this.stageHalf);
    if (this.res() !== oldRes) {
      // swap model resolution: match views reload on next update(); menu rebuilds its slots
      for (const c of ALL_CHARS) loadCharacter(c, this.res()).catch(() => { /* retried on demand */ });
      if (this.menu.active) {
        for (const v of this.menuPool.values()) v.dispose();
        this.menuPool.clear();
        for (const s of this.menu.slots) s.view = null;
        this.fillMenuViews();
      }
    }
  }

  /** legacy single-bucket setter */
  setQuality(q: Quality): void { this.setGfx({ ...this.gfx, quality: q }); }

  setDebugBoxes(boxes: Capsule[] | null): void { this.debug.set(boxes); }

  addShake(intensity: number, frames: number): void { this.fcam.addShake(intensity, frames); }

  getBoneWorld(player: 0 | 1, bone: BoneName, out: THREE.Vector3): THREE.Vector3 {
    const v = this.active[player] ?? this.views[player];
    if (!v) return out.set(player === 0 ? -1.3 : 1.3, 1.2, 0);
    let s: SocketName = bone;
    if (bone === 'weapon' && !v.visibleWeapon) s = 'handR';
    return v.socket(s).getWorldPosition(out);
  }

  /** Optional (additive): world orientation of a bone socket (canonical frame: +Z forward / blade direction). */
  getBoneQuat(player: 0 | 1, bone: BoneName, out: THREE.Quaternion): THREE.Quaternion {
    const v = this.active[player] ?? this.views[player];
    if (!v) return out.identity();
    let s: SocketName = bone;
    if (bone === 'weapon' && !v.visibleWeapon) s = 'handR';
    return v.socket(s).getWorldQuaternion(out);
  }

  /** called each render() after the scene is drawn; vfx uses it for screen-space post effects */
  setPostPass(fn: ((r: THREE.WebGLRenderer) => void) | null): void { this.post = fn; }

  // ------------------------------------------------------------------ menu scene
  /**
   * Menu backdrop. chars.length > 2 (title): the first two fighters pose centre stage, hero camera.
   * 1–2 chars (character select): chars[0] posing on the left, chars[1] on the right, facing each other /
   * the camera, slow camera drift. null / [] = stage only.
   */
  showMenuScene(chars: CharId[] | null, stage?: StageId): void {
    this.clearMatch();
    this.setStage(stage ?? 'rooftop', 5);
    const list = (chars ?? []).slice(0, 2);
    const layout: MenuState['layout'] = !chars || chars.length === 0 ? 'empty' : chars.length > 2 ? 'title' : 'select';
    const wasActive = this.menu.active;
    const prevLayout = this.menu.layout;
    // hide previous slot views (kept in the pool for fast hover changes)
    for (const s of this.menu.slots) if (s.view) s.view.group.visible = false;
    this.menu.active = true;
    this.menu.layout = layout;
    this.menu.token++;
    this.menu.slots = list.map((c, i) => {
      const left = i === 0;
      // select: fighters flank the bottom-centre DOM panel (screen x ≈ 12% / 88%), upper body above the info cards
      const x = layout === 'title' ? (left ? -1.55 : 1.55) : (left ? -1.85 : 1.85);
      const ang = layout === 'title' ? (left ? 0.45 : -0.45) : (left ? 0.5 : -0.5);
      const pose = layout === 'title' ? (left ? 'introPose' : 'win') : 'introPose';
      const st = blankFighter(c, x * 1000, 0, Math.round(Math.sin(ang) * 1000), Math.round(Math.cos(ang) * 1000), pose);
      st.mode = 'intro';
      return { char: c, view: null, state: st, x, ang };
    });
    if (!wasActive || prevLayout !== layout) { this.menu.t = 0; this.fcam.reset(); }
    this.fillMenuViews();
    this.updateMenu(0);
  }

  private fillMenuViews(): void {
    const token = this.menu.token;
    const res = this.res();
    this.menu.slots.forEach((slot, i) => {
      const mirror = i === 1 && this.menu.slots[0]?.char === slot.char;
      const key = `${slot.char}:${i}:${res}:${mirror ? 'alt' : 'main'}`;
      const pooled = this.menuPool.get(key);
      if (pooled) { slot.view = pooled; pooled.group.visible = true; return; }
      loadCharacter(slot.char, res).then((a) => {
        if (token !== this.menu.token || !this.menu.active) return;
        let v = this.menuPool.get(key);
        if (!v) { v = this.makeView(slot.char, a, mirror); this.menuPool.set(key, v); }
        v.group.visible = true;
        slot.view = v;
        v.update(slot.state, null, 1, 0, this.time);
      }).catch((e) => console.warn('[render] menu fighter load failed', e));
    });
  }

  /** animate the menu scene (idle poses / camera drift). Call every frame while a menu is shown. */
  updateMenu(dt: number): void {
    if (!this.menu.active) return;
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.menu.t += dt;
    this.time += dt;
    const t = this.menu.t;
    for (const s of this.menu.slots) {
      s.state.modeFrame = Math.floor(t * 60);
      s.view?.update(s.state, null, 1, dt, this.time);
    }
    const lay = this.menu.layout;
    if (lay === 'title') {
      const a = Math.sin(t * 0.12) * 0.22;
      _v.set(Math.sin(a) * 4.3, 0.75 + Math.sin(t * 0.21) * 0.06, Math.cos(a) * 4.3);
      _c.set(0, 1.32, 0);
    } else if (lay === 'select') {
      const a = Math.sin(t * 0.15) * 0.03;
      const d = 3.7 * Math.max(0.75, Math.min(1.25, (16 / 9) / Math.max(0.5, this.camera.aspect)));
      _v.set(Math.sin(a) * d, 1.45 + Math.sin(t * 0.23) * 0.03, Math.cos(a) * d);
      _c.set(0, 1.32, 0);
    } else {
      const a = t * 0.05;
      _v.set(Math.sin(a) * 7, 2.4, Math.cos(a) * 7);
      _c.set(0, 1.6, 0);
    }
    this.fcam.set(_v, _c, dt === 0, dt || 1 / 60);
    // menus: key light from the camera side so faces read (stage sun often back-lights for drama)
    _MENU_SUN.set(this.stage ? this.stage.sunDir.x * 0.5 : 0.4, 0.75, 0.75).normalize();
    this.placeSun(_origin, 4, _MENU_SUN);
    _v.sub(_c).setY(0).normalize();
    this.placeRim(_origin, _v);
    this.stage?.update(this.time, dt);
  }

  /** returns a PNG data URL portrait of a character (for char select cards); '' until the model is loaded */
  snapshotCharacter(id: CharId, size: number): string {
    const key = `${id}:${size}`;
    const hit = this.snapCache.get(key);
    if (hit) return hit;
    const asset = getLoadedCharacter(id, 2048) ?? getLoadedCharacter(id, 1024);
    if (!asset) { loadCharacter(id, this.res()).catch(() => { /* retried */ }); return ''; }
    const r = this.renderer;
    const scene = new THREE.Scene();
    const pal = resolvePalette(id);
    scene.background = new THREE.Color(pal.aura).multiplyScalar(0.18);
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    sun.position.set(1.5, 3, 4);
    const rim = new THREE.DirectionalLight(new THREE.Color(pal.aura), 1.6);
    rim.position.set(-3, 2, -2);
    scene.add(sun, rim, new THREE.AmbientLight(0xffffff, 1.1));
    const v = new FighterView(id, asset);
    v.lookup = this.moveLookup;
    v.u.uRimColor.value.set(pal.aura);
    scene.add(v.group);
    const st = blankFighter(id, 0, 0, 0, 1000, 'introPose');
    st.mode = 'intro';
    v.update(st, null, 1, 0, 0);
    v.u.uRimColor.value.set(charLook(id).rimAwk);
    v.u.uRimStrength.value = 0.5;
    v.socket('head').getWorldPosition(_v);
    const cam = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
    const hy = _v.y - 0.12;
    cam.position.set(0.32, hy + 0.06, 1.55 * (asset.height / 1.85));
    cam.lookAt(0, hy - 0.08, 0);
    const prevPR = r.getPixelRatio();
    const cur = r.getSize(new THREE.Vector2());
    const needW = Math.max(cur.x, size), needH = Math.max(cur.y, size);
    const prevClear = r.getClearColor(new THREE.Color());
    r.setPixelRatio(1);
    r.setSize(needW, needH, false);
    r.setScissorTest(true);
    r.setScissor(0, 0, size, size);
    r.setViewport(0, 0, size, size);
    r.render(scene, cam);
    const out = document.createElement('canvas');
    out.width = size; out.height = size;
    out.getContext('2d')!.drawImage(r.domElement, 0, needH - size, size, size, 0, 0, size, size);
    r.setScissorTest(false);
    r.setPixelRatio(prevPR);
    r.setSize(cur.x, cur.y, false);
    r.setViewport(0, 0, cur.x, cur.y);
    r.setClearColor(prevClear);
    v.dispose();
    const url = out.toDataURL('image/png');
    this.snapCache.set(key, url);
    return url;
  }

  getStats(): { drawCalls: number; triangles: number } {
    const i = this.renderer.info.render;
    return { drawCalls: i.calls, triangles: i.triangles };
  }

  dispose(): void {
    this.clearMatch();
    this.clearMenu();
    if (this.stage) { this.stage.dispose(); this.scene.remove(this.stage.group); this.stage = null; }
    this.disposeRealms();
    this.debug.dispose();
    disposeCharacterCache();
    this.renderer.dispose();
  }
}

/** All characters the renderer can build (convenience for UI). */
export const RENDER_CHARS: readonly CharId[] = ALL_CHARS;
