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
 */
import * as THREE from 'three';
import type { GameState, Capsule, CharId, StageId, MoveDef, FighterState } from '../sim/types';
import { ALL_CHARS } from '../sim/types';
import { FighterView, type SocketName } from './fighter/FighterView';
import { loadCharacter, getLoadedCharacter, disposeCharacterCache, type ModelRes, type CharAsset } from './fighter/assets';
import { charLook, resolvePalette } from './fighter/looks';
import { FightCamera } from './camera';
import { DebugBoxes } from './debug';
import { buildStage, type StageBuild } from './stage';
import { blankFighter } from './util';
import type { MoveLookup } from './anim/sampler';
import { defaultMoveLookup } from './anim/sampler';

export type Quality = 'low' | 'medium' | 'high';
export type BoneName = 'head' | 'chest' | 'hips' | 'handL' | 'handR' | 'footL' | 'footR' | 'weapon';

const STRENGTH: Record<string, number> = { light: 0.2, medium: 0.45, heavy: 0.75, super: 1 };
const _v = new THREE.Vector3();
const _c = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _MENU_SUN = new THREE.Vector3();

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
  private stage: StageBuild | null = null;
  private stageId: StageId | null = null;
  private stageHalf = 0;
  private stageQuality: Quality | null = null;
  private sun = new THREE.DirectionalLight(0xffffff, 2.4);
  /** flat ambient (anime look: no smooth hemisphere gradients on toon surfaces) */
  private hemi = new THREE.AmbientLight(0xffffff, 1.2);
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

  constructor(canvas: HTMLCanvasElement) {
    this.quality = initialQuality();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality === 'high', powerPreference: 'high-performance', alpha: false, stencil: false });
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
    this.scene.add(this.sun, this.sun.target, this.hemi, this.debug.group);
    this.scene.background = new THREE.Color('#0b0b14');
    this.applyQualityToLights();
    this.camera.position.set(0, 1.5, 6);
    this.camera.lookAt(0, 1.1, 0);
    // warm the cache: every fighter at the current resolution
    for (const c of ALL_CHARS) loadCharacter(c, this.res()).catch((e) => console.warn('[render] preload failed', c, e));
  }

  // ------------------------------------------------------------------ setup
  private res(): ModelRes { return this.quality === 'low' ? 1024 : 2048; }

  private pixelRatioFor(dpr: number): number {
    if (this.quality === 'low') return Math.min(dpr, 0.75);
    if (this.quality === 'medium') return Math.min(dpr, 1);
    return Math.min(dpr, 1.5);
  }

  private applyQualityToLights(): void {
    this.sun.castShadow = this.quality !== 'low';
  }

  private setStage(id: StageId, halfM: number): void {
    if (this.stage && this.stageId === id && Math.abs(this.stageHalf - halfM) < 1e-3 && this.stageQuality === this.quality) return;
    if (this.stage) { this.stage.dispose(); this.scene.remove(this.stage.group); }
    this.stage = buildStage(id, halfM, this.quality);
    this.stageId = id;
    this.stageHalf = halfM;
    this.stageQuality = this.quality;
    this.scene.add(this.stage.group);
    this.scene.fog = this.stage.fog;
    this.scene.background = this.stage.background;
    this.sun.color.copy(this.stage.sunColor);
    this.sun.intensity = this.stage.sunIntensity;
    this.hemi.color.copy(this.stage.hemiSky).lerp(this.stage.hemiGround, 0.35);
    this.hemi.intensity = this.stage.hemiIntensity;
    for (const v of this.views) v?.setShadowTint(this.stage.shadowTint);
    for (const s of this.menu.slots) s.view?.setShadowTint(this.stage.shadowTint);
  }

  private makeView(char: CharId, asset: CharAsset, alt: boolean): FighterView {
    const v = new FighterView(char, asset, { alt });
    v.lookup = this.moveLookup;
    v.setQuality(this.quality);
    v.setShadowTint(this.stage ? this.stage.shadowTint : null);
    this.scene.add(v.group);
    return v;
  }

  private clearMatch(): void {
    for (const v of this.views) v?.dispose();
    this.views = [null, null];
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
          this.views[e.target]?.onHit(STRENGTH[e.strength ?? 'medium'] ?? 0.4);
        }
        if (e.type === 'ko') cheer = Math.max(cheer, 1);
        else if (e.type === 'ultimateHit') cheer = Math.max(cheer, 0.75);
        else if (e.type === 'counter' || e.type === 'awaken') cheer = Math.max(cheer, 0.55);
        else if (e.type === 'wallSplat' || e.type === 'launch' || e.type === 'throw') cheer = Math.max(cheer, 0.35);
      }
      if (cheer > 0) this.stage?.cheer?.(cheer);
    }
    for (let i = 0; i < 2; i++) {
      const v = this.views[i];
      const f = state.fighters[i];
      if (v) {
        v.update(f, prev ? prev.fighters[i] : null, alpha, dt, this.time);
        this.fcam.fighterPos[i].copy(v.group.position);
      } else this.fcam.fighterPos[i].set(f.pos.x / 1000, f.pos.y / 1000, f.pos.z / 1000);
    }
    this.fcam.update(prev, state, alpha, dt);
    // light follows the fight (tight shadow camera)
    if (this.stage) {
      _c.copy(this.fcam.fighterPos[0]).add(this.fcam.fighterPos[1]).multiplyScalar(0.5);
      _c.y = 0;
      const sep = this.fcam.fighterPos[0].distanceTo(this.fcam.fighterPos[1]);
      this.placeSun(_c, Math.max(2.6, sep * 0.5 + 1.8));
      this.stage.update(this.time, dt);
    }
  }

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

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    const oldRes = this.res();
    this.quality = q;
    try { localStorage.setItem('kakusei-quality', q); } catch { /* ignore */ }
    this.renderer.setPixelRatio(this.pixelRatioFor(this.dpr));
    this.renderer.setSize(this.size.w, this.size.h, true);
    this.applyQualityToLights();
    for (const v of this.views) v?.setQuality(q);
    for (const v of this.menuPool.values()) v.setQuality(q);
    if (this.stageId) this.setStage(this.stageId, this.stageHalf);
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

  setDebugBoxes(boxes: Capsule[] | null): void { this.debug.set(boxes); }

  addShake(intensity: number, frames: number): void { this.fcam.addShake(intensity, frames); }

  getBoneWorld(player: 0 | 1, bone: BoneName, out: THREE.Vector3): THREE.Vector3 {
    const v = this.views[player];
    if (!v) return out.set(player === 0 ? -1.3 : 1.3, 1.2, 0);
    let s: SocketName = bone;
    if (bone === 'weapon' && !v.visibleWeapon) s = 'handR';
    return v.socket(s).getWorldPosition(out);
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
      const x = layout === 'title' ? (left ? -1.55 : 1.55) : (left ? -1.95 : 1.95);
      const ang = layout === 'title' ? (left ? 0.45 : -0.45) : (left ? 0.62 : -0.62);
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
      const key = `${slot.char}:${i}:${res}`;
      const pooled = this.menuPool.get(key);
      if (pooled) { slot.view = pooled; pooled.group.visible = true; return; }
      const mirror = i === 1 && this.menu.slots[0]?.char === slot.char;
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
      const a = Math.sin(t * 0.15) * 0.08;
      _v.set(Math.sin(a) * 5.6, 1.25 + Math.sin(t * 0.23) * 0.05, Math.cos(a) * 5.6);
      _c.set(0, 1.05, 0);
    } else {
      const a = t * 0.05;
      _v.set(Math.sin(a) * 7, 2.4, Math.cos(a) * 7);
      _c.set(0, 1.6, 0);
    }
    this.fcam.set(_v, _c, dt === 0, dt || 1 / 60);
    // menus: key light from the camera side so faces read (stage sun often back-lights for drama)
    _MENU_SUN.set(this.stage ? this.stage.sunDir.x * 0.5 : 0.4, 0.75, 0.75).normalize();
    this.placeSun(_origin, 4, _MENU_SUN);
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
    this.debug.dispose();
    disposeCharacterCache();
    this.renderer.dispose();
  }
}

/** All characters the renderer can build (convenience for UI). */
export const RENDER_CHARS: readonly CharId[] = ALL_CHARS;
