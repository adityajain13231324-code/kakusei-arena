// Application shell: owns modules, screens, flow and the fixed-timestep loop.
import { ALL_CHARS } from '../sim/types';
import type { CharId, ControlScheme, MatchConfig, StageId } from '../sim/types';
import { debugBoxes } from '../sim';
import { GameRenderer } from '../render';
import { VfxSystem } from '../vfx';
import { AudioSystem } from '../audio';
import { InputManager } from '../input';
import type { MenuAction } from '../input';
import type { Difficulty } from '../ai';
import { UI } from '../ui/router';
import { setSfx, h } from '../ui/dom';
import { charName, refreshPortraits, setPortraitSource } from '../ui/meta';
import { TitleScreen, MainMenuScreen, DifficultyScreen, CreditsScreen } from '../ui/screens/menus';
import { CharSelectScreen, StageSelectScreen } from '../ui/screens/select';
import { VsScreen, InterludeScreen, ResultsScreen } from '../ui/screens/flow';
import { HudScreen } from '../ui/screens/hud';
import { PauseScreen, MoveListScreen } from '../ui/screens/pause';
import { SettingsScreen, RemapScreen } from '../ui/screens/settings';
import { HowToScreen } from '../ui/screens/howto';
import { OnlineMenuScreen, OnlineLobbyScreen } from '../ui/screens/online';
import { OnlineController } from '../net/online';
import { JOIN_HASH_RE } from '../net/protocol';
import { SettingsStore, detectPhone } from './settings';
import { GfxBenchmark, presetValues, applyPreset } from './gfx';
import type { GfxSettings } from './gfx';
import { MatchSession } from './session';
import type { SessionHooks } from './session';
import type { AppApi, Flow, Mode } from './api';

const ARCADE_STAGES: StageId[] = ['rooftop', 'shrine', 'rooftop'];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class App implements AppApi {
  readonly settings = new SettingsStore();
  readonly audio = new AudioSystem();
  readonly input = new InputManager();
  renderer: GameRenderer | null = null;
  vfx: VfxSystem | null = null;
  readonly ui: UI;
  session: MatchSession | null = null;
  readonly online: OnlineController;
  flow: Flow = {
    mode: 'arcade', difficulty: 'normal', p1: 'kaito', p2: 'shiori', stage: 'rooftop',
    schemes: ['pro', 'pro'], ladder: [], ladderIndex: 0, arcadeFrames: 0,
  };

  private hud: HudScreen;
  private vs: VsScreen;
  private warned = new Set<string>();
  private token = 0;
  private last = performance.now() / 1000;
  private menuKey = '';
  private toastEl: HTMLElement;
  private debugEl: HTMLElement;
  private fpsEl: HTMLElement;
  private fpsT = 0;
  private lastFrameT = 0;
  private bench: GfxBenchmark | null = null;
  private debugOn = false;
  private fpsAvg = 60; private workAvg = 0; private debugT = 0;

  constructor(private canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    let noWebGl = false;
    try {
      this.renderer = new GameRenderer(canvas, { antialias: this.settings.data.gfx.aa });
      this.vfx = new VfxSystem(this.renderer);
    } catch (e) {
      console.warn('[app] renderer unavailable', e);
      this.renderer = null; this.vfx = null;
      noWebGl = true;
    }
    setPortraitSource((id, size) => this.renderer?.snapshotCharacter(id, size) ?? '');
    setSfx((s) => this.audio.ui(s));

    this.ui = new UI(uiRoot);
    this.online = new OnlineController(this);
    this.hud = new HudScreen(this);
    this.vs = new VsScreen(this);
    this.ui.register('title', new TitleScreen(this));
    this.ui.register('menu', new MainMenuScreen(this));
    this.ui.register('difficulty', new DifficultyScreen(this));
    this.ui.register('charselect', new CharSelectScreen(this));
    this.ui.register('stage', new StageSelectScreen(this));
    this.ui.register('vs', this.vs);
    this.ui.register('hud', this.hud);
    this.ui.register('interlude', new InterludeScreen(this));
    this.ui.register('results', new ResultsScreen(this));
    this.ui.register('pause', new PauseScreen(this));
    this.ui.register('movelist', new MoveListScreen(this));
    this.ui.register('howto', new HowToScreen(this));
    this.ui.register('settings', new SettingsScreen(this));
    this.ui.register('remap', new RemapScreen(this));
    this.ui.register('credits', new CreditsScreen(this));
    this.ui.register('online', new OnlineMenuScreen(this));
    this.ui.register('onlinelobby', new OnlineLobbyScreen(this));

    this.toastEl = h('div', { class: 'toast' });
    this.debugEl = h('pre', { class: 'debug' });
    this.fpsEl = h('div', { class: 'fps-badge' });
    uiRoot.append(this.toastEl, this.debugEl, this.fpsEl);
    this.input.attachTouch(uiRoot);
    this.attachUiFeel(uiRoot);

    this.input.onMenu((a, slot) => this.onMenu(a, slot));
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 150));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.autoPause(); });
    window.addEventListener('blur', () => this.autoPause());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F1') { e.preventDefault(); this.toggleDebug(); }
      if (e.code === 'F2' && this.session?.mode === 'training') { e.preventDefault(); this.session.showHitboxes = !this.session.showHitboxes; }
      // Animation v2 vs the v1 pose blender, for comparison (Training, with F1 or F2 debug on)
      if (e.code === 'F3' && this.session?.mode === 'training' && (this.debugOn || this.session.showHitboxes) && this.renderer) {
        e.preventDefault();
        this.renderer.setAnimV2(!this.renderer.animV2On);
        this.toast(this.renderer.animV2On ? 'Animation: v2 clips (F3)' : 'Animation: v1 poses (F3)');
      }
    });
    window.addEventListener('gamepadconnected', () => this.toast('Gamepad connected'));
    const unlock = () => { this.safe('audio.unlock', () => this.audio.unlock()); };
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    window.addEventListener('keydown', unlock, { once: true, capture: true });
    // block page scroll/zoom/context menu on touch
    for (const ev of ['gesturestart', 'gesturechange', 'dblclick'] as const) document.addEventListener(ev, (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => { if ((e.target as HTMLElement).closest('.ml-scroll, .ht-body, .set-card')) return; e.preventDefault(); }, { passive: false });

    this.applySettings();
    this.resize();
    this.ui.go('title');
    if (noWebGl) this.toast('3D graphics are not available in this browser (WebGL is off). Enable hardware acceleration to see the fighters.');
    this.checkJoinHash();
    window.addEventListener('hashchange', () => this.checkJoinHash());
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------ hover / press feel (sounds; the CSS does the motion)
  private hoverEl: Element | null = null;
  private attachUiFeel(root: HTMLElement): void {
    // elements whose own Nav/hover logic already plays sounds are left out
    const HOVER = '.cx-pill, .cx-chip, .cx-tab, .cx-big, .tool-btn, .seg, .tp-toggle, .tp-arrow, .tp-reset, .ml-tab, .pause-btn, .on-btn';
    const PRESS = '.cx-card, .mbtn, .cx-big, .st-card';
    root.addEventListener('pointerover', (e) => {
      if ((e as PointerEvent).pointerType === 'touch') return;
      const el = (e.target as Element).closest(HOVER);
      if (el && el !== this.hoverEl) { this.hoverEl = el; this.audio.ui('hover'); } else if (!el) this.hoverEl = null;
    });
    root.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest(PRESS)) this.audio.ui('press');
    });
  }

  // ------------------------------------------------------------ helpers
  private safe<T>(name: string, fn: () => T): T | undefined {
    try { return fn(); } catch (e) {
      if (!this.warned.has(name)) { this.warned.add(name); console.warn(`[app] ${name} failed:`, e); }
      return undefined;
    }
  }
  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('on');
    clearTimeout((this as any)._tt);
    (this as any)._tt = window.setTimeout(() => this.toastEl.classList.remove('on'), 3600);
  }
  menuScene(chars: CharId[] | null, stage?: StageId): void {
    const key = (chars ? chars.join(',') : 'null') + '|' + (stage ?? '');
    if (key === this.menuKey && !this.session) return;
    this.menuKey = key;
    this.safe('showMenuScene', () => this.renderer?.showMenuScene(chars, stage));
  }
  private toggleDebug(): void {
    this.debugOn = !this.debugOn;
    this.debugEl.classList.toggle('on', this.debugOn);
  }

  // ------------------------------------------------------------ settings / sizing
  applySettings(): void {
    const s = this.settings.data;
    this.safe('audio.setVolumes', () => this.audio.setVolumes(s.master, s.music, s.sfx, s.voice, s.announcerVol));
    this.applyGfx(s.gfx);
    this.ui.root.style.setProperty('--hud-scale', String(s.hudScale));
    this.fpsEl.classList.toggle('on', s.gfx.showFps);
    this.safe('audio.setAnnouncer', () => (this.audio as unknown as { setAnnouncer?: (on: boolean) => void }).setAnnouncer?.(s.announcer));
    this.safe('vfx.setReduceFlashing', () => this.vfx?.setReduceFlashing(s.reduceFlashing));
    this.safe('renderer.setCameraFeel', () => this.renderer?.setCameraFeel(s.cameraShake, s.reduceFlashing));
    this.ui.root.classList.toggle('reduce-flash', s.reduceFlashing); // stops looping UI pulses/flicker (css)
    this.input.setBindings(0, s.keys.p1);
    this.input.setBindings(1, s.keys.p2);
    this.resize();
    this.updateTouch();
  }
  /** push graphics settings to the renderer + vfx (live); `g` may be a temporary benchmark preset */
  private applyGfx(g: GfxSettings): void {
    this.safe('renderer.setGfx', () => this.renderer?.setGfx({ quality: g.base, scale: g.renderScale, shadows: g.shadows, outlines: g.outlines, texRes: g.texRes, crowd: g.crowd, sky: g.realmSky }));
    this.safe('vfx.setQuality', () => this.vfx?.setQuality(g.base));
    this.safe('vfx.setGfx', () => this.vfx?.setGfx({ particles: g.particles, impactFrames: g.impactFrames, speedLines: g.speedLines, colorGrade: g.colorGrade, bloom: g.bloom }));
  }

  /** restart the first-launch benchmark (settings screen button) */
  runBenchmark(): void { this.settings.data.gfx.benchDone = false; this.bench = null; this.toast('Benchmark runs on the title / main menu. Go back to the menu and wait a few seconds.'); }

  private stepBenchmark(dt: number): void {
    const g = this.settings.data.gfx;
    const top = this.ui.top();
    const onMenu = !this.session && (top === 'title' || top === 'menu');
    if (!this.bench) {
      if (g.benchDone || !onMenu || !this.renderer || document.hidden) return;
      this.bench = new GfxBenchmark(detectPhone());
      this.applyGfx({ ...g, ...presetValues(this.bench.current) });
      return;
    }
    if (!onMenu) { this.bench = null; this.applySettings(); return; } // left the menu: discard, retry next launch
    if (document.hidden) { this.bench.restart(); return; }
    const next = this.bench.step(dt);
    if (this.bench.done) {
      const r = this.bench.result;
      applyPreset(g, r); g.benchDone = true; g.benchMs = Math.round(this.bench.resultMs * 10) / 10;
      this.bench = null;
      this.settings.save();
      this.applySettings();
      this.toast(`Graphics set to ${r.toUpperCase()} (auto-detected). Change it any time in Settings.`);
    } else if (next) this.applyGfx({ ...g, ...presetValues(next) });
  }
  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, hgt = window.innerHeight;
    this.safe('renderer.resize', () => this.renderer?.resize(w, hgt, dpr));
    // phone held upright: the "rotate your device" overlay covers the game, so don't let a match run behind it
    if (hgt > w && this.input.touchCapable && w <= 900) this.autoPause();
  }
  private updateTouch(): void {
    const t = this.settings.data.touch;
    const want = t === 'on' || (t === 'auto' && this.input.touchCapable);
    const inGame = !!this.session && !this.session.paused && this.ui.top() === 'hud';
    this.input.setTouchVisible(want && inGame);
  }

  // ------------------------------------------------------------ menu input routing
  private onMenu(a: MenuAction, slot: 0 | 1): void {
    if (a === 'pause') { this.pause(); return; }
    if (a === 'reset') { if (this.session?.mode === 'training' && this.ui.top() === 'hud') this.safe('reset', () => { this.session!.reset(); this.vfx?.clear(); }); return; }
    this.ui.handleMenu(a, slot);
  }
  private autoPause(): void {
    if (this.session?.mode === 'online') return; // online matches never pause
    if (this.session && this.ui.top() === 'hud' && !this.session.paused && !this.session.ended) this.pause();
  }

  // ------------------------------------------------------------ navigation / flow
  startFromTitle(): void {
    this.safe('audio.unlock', () => this.audio.unlock());
    this.safe('audio.music', () => this.audio.music('menu'));
    this.safe('audio.ui', () => this.audio.ui('start'));
    window.setTimeout(() => this.ui.go('menu'), 380);
  }
  goMenu(): void {
    this.online.shutdown();
    this.endSession();
    this.input.setContext('menu');
    this.input.setVersus(false);
    this.safe('audio.music', () => this.audio.music('menu'));
    this.ui.go('menu');
  }
  chooseMode(m: Mode): void {
    this.flow.mode = m;
    this.input.setVersus(m === 'versus');
    if (m === 'online') { this.ui.go('online'); return; }
    this.ui.go('charselect', { mode: m }); // difficulty + stage are chips on the select screen now
  }
  setDifficulty(d: Difficulty): void { this.flow.difficulty = d; this.ui.go('charselect', { mode: 'arcade' }); }
  toCharSelect(): void {
    this.endSession();
    this.input.setContext('menu');
    this.safe('audio.music', () => this.audio.music('char_select'));
    this.ui.go('charselect', { mode: this.flow.mode });
  }
  pickChars(p1: CharId, p2: CharId, schemes: [ControlScheme, ControlScheme]): void {
    const f = this.flow;
    f.p1 = p1; f.p2 = p2; f.schemes = schemes;
    if (f.mode === 'arcade') {
      const i = ALL_CHARS.indexOf(p1);
      // the CPU fighter picked on the select screen is the first rival; the rest follow in roster order
      const rest = [1, 2, 3].map((k) => ALL_CHARS[(i + k) % ALL_CHARS.length]).filter((c) => c !== p2);
      f.ladder = [p2, ...rest].slice(0, 3);
      f.ladderIndex = 0; f.arcadeFrames = 0;
      void this.startMatch();
    } else void this.startMatch(); // stage was chosen with the chips on the select screen
  }
  pickStage(s: StageId): void { this.flow.stage = s; void this.startMatch(); }
  rematch(): void { void this.startMatch(); }
  nextFight(): void {
    const f = this.flow;
    f.ladderIndex++;
    void this.startMatch();
  }

  private endSession(): void {
    this.token++;
    this.session = null;
    this.safe('setDebugBoxes', () => this.renderer?.setDebugBoxes(null));
    this.safe('vfx.clear', () => this.vfx?.clear());
    this.safe('audio.setPaused', () => this.audio.setPaused(false));
    this.menuKey = '';
    this.updateTouch();
  }

  private async startMatch(): Promise<void> {
    const f = this.flow;
    this.endSession();
    const my = this.token;
    const arcade = f.mode === 'arcade';
    const p2 = arcade ? f.ladder[f.ladderIndex] : f.p2;
    const stage: StageId = arcade ? (f.ladderIndex === 0 && f.stage !== 'training' ? f.stage : ARCADE_STAGES[(f.ladderIndex + (f.stage === 'shrine' ? 1 : 0)) % ARCADE_STAGES.length]) : f.stage;
    const cfg: MatchConfig = {
      p1: f.p1, p2, stage, seed: (Math.random() * 0x7fffffff) | 0, roundsToWin: 2,
      training: f.mode === 'training', schemes: [f.schemes[0], arcade ? 'pro' : f.schemes[1]],
    };
    let session: MatchSession;
    try {
      session = new MatchSession(cfg, f.mode, [null, arcade ? f.difficulty : null], (slot) => this.input.read(slot), {
        onEvents: (ev, st) => {
          this.safe('vfx.handleEvents', () => this.vfx?.handleEvents(ev, st));
          this.safe('audio.handleEvents', () => this.audio.handleEvents(ev, st));
          this.hud.handleEvents(ev, st);
        },
        onMatchEnd: (w) => this.onMatchEnd(w),
        onError: (e) => this.onSimError(e),
      });
    } catch (e) {
      console.warn('[app] createMatch failed (sim module not ready?)', e);
      this.toast('Fighting engine is still loading. Try again in a moment.');
      this.goMenu();
      return;
    }
    const label = arcade ? `ARCADE  FIGHT ${f.ladderIndex + 1} / ${f.ladder.length}` : f.mode === 'versus' ? 'VERSUS' : 'TRAINING';
    this.safe('audio.prepareMatch', () => this.audio.prepareMatch({ p1: f.p1, p2, stage, mode: f.mode }));
    this.ui.go('vs', { p1: f.p1, p2, stage, label, cpu: arcade });
    this.input.setContext('menu');
    const load = this.safe('loadMatch', () => this.renderer?.loadMatch(session.state));
    await Promise.all([Promise.resolve(load).catch((e) => console.warn('[app] loadMatch failed', e)), sleep(2000)]);
    if (my !== this.token) return;
    this.vs.setReady();
    await sleep(260);
    if (my !== this.token) return;
    this.session = session;
    this.menuKey = '';
    this.hud.begin(session);
    this.ui.go('hud');
    this.input.setContext('game');
    this.safe('audio.music', () => this.audio.music(stage === 'training' ? 'training' : stage));
    this.updateTouch();
  }

  private onSimError(e: unknown): void {
    console.error('[app] sim error', e);
    this.toast('Fighting engine error: ' + (e instanceof Error ? e.message : String(e)));
    this.pause();
  }

  private onMatchEnd(winner: -1 | 0 | 1): void {
    const s = this.session; if (!s) return;
    const f = this.flow;
    f.arcadeFrames += s.ticks;
    this.safe('vfx.clear', () => this.vfx?.clear());
    this.input.setContext('menu');
    this.updateTouch();
    const st = s.state;
    const winId = winner === -1 ? undefined : st.fighters[winner].char;
    if (f.mode === 'arcade' && winner === 0) {
      if (f.ladderIndex + 1 < f.ladder.length) {
        this.ui.go('interlude', { kind: 'next', nextId: f.ladder[f.ladderIndex + 1], index: f.ladderIndex + 1, total: f.ladder.length });
      } else {
        const sec = f.arcadeFrames / 60;
        const time = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
        this.safe('audio.music', () => this.audio.music('victory'));
        this.ui.go('interlude', { kind: 'clear', time });
      }
      return;
    }
    this.safe('audio.music', () => this.audio.music('victory'));
    const buttons = f.mode === 'arcade'
      ? [{ label: 'CONTINUE', sub: '続ける', act: () => this.rematch() }, { label: 'CHARACTER SELECT', act: () => this.toCharSelect() }, { label: 'MAIN MENU', act: () => this.goMenu() }]
      : [{ label: 'REMATCH', sub: '再戦', act: () => this.rematch() }, { label: 'CHARACTER SELECT', act: () => this.toCharSelect() }, { label: 'MAIN MENU', act: () => this.goMenu() }];
    const title = winner === -1 ? 'DRAW' : f.mode === 'arcade' ? `${charName(st.fighters[1].char)}` : charName(winId!);
    this.ui.go('results', {
      winner, id: winId, title, side: winner === 1 ? 1 : 0,
      sub: f.mode === 'arcade' ? 'DEFEATED BY' : winner === -1 ? 'TIME OVER' : f.mode === 'versus' ? `PLAYER ${winner + 1}` : 'VICTORY',
      buttons,
    });
  }

  // ------------------------------------------------------------ online (src/net drives these)
  private checkJoinHash(): void {
    const m = JOIN_HASH_RE.exec(location.hash);
    if (!m) return;
    const code = m[1].toUpperCase();
    if (this.online.active && this.online.code === code) return;
    this.endSession();
    this.flow.mode = 'online';
    this.input.setVersus(false);
    this.input.setContext('menu');
    this.safe('audio.music', () => this.audio.music('menu'));
    this.ui.go('onlinelobby');
    this.online.join(code);
  }
  startNetMatch(o: { cfg: MatchConfig; label: string; create(onEvents: SessionHooks['onEvents']): MatchSession; onShown(): void }): void {
    void (async () => {
      this.endSession();
      const my = this.token;
      const { cfg } = o;
      const session = o.create((ev, st) => {
        this.safe('vfx.handleEvents', () => this.vfx?.handleEvents(ev, st));
        this.safe('audio.handleEvents', () => this.audio.handleEvents(ev, st));
        this.hud.handleEvents(ev, st);
      });
      this.safe('audio.prepareMatch', () => this.audio.prepareMatch({ p1: cfg.p1, p2: cfg.p2, stage: cfg.stage, mode: 'online' }));
      this.ui.go('vs', { p1: cfg.p1, p2: cfg.p2, stage: cfg.stage, label: o.label, cpu: false });
      this.input.setContext('menu');
      const load = this.safe('loadMatch', () => this.renderer?.loadMatch(session.state));
      await Promise.all([Promise.resolve(load).catch((e) => console.warn('[app] loadMatch failed', e)), sleep(2000)]);
      if (my !== this.token) return;
      this.vs.setReady();
      await sleep(260);
      if (my !== this.token) return;
      this.session = session;
      this.menuKey = '';
      this.hud.begin(session);
      this.ui.go('hud');
      this.input.setContext('game');
      this.safe('audio.music', () => this.audio.music(cfg.stage === 'training' ? 'training' : cfg.stage));
      this.updateTouch();
      o.onShown();
    })();
  }
  finishNetMatch(): void {
    this.safe('vfx.clear', () => this.vfx?.clear());
    this.input.setContext('menu');
    this.updateTouch();
    this.safe('audio.music', () => this.audio.music('victory'));
  }
  leaveNetMatch(screen: 'online' | 'onlinelobby'): void {
    this.endSession();
    this.input.setContext('menu');
    this.input.setVersus(false);
    this.safe('audio.music', () => this.audio.music('menu'));
    this.ui.go(screen);
  }

  // ------------------------------------------------------------ pause
  pause(): void {
    const s = this.session;
    if (!s || s.paused || this.ui.top() !== 'hud' || s.ended) return;
    s.paused = true; // online: menu only, the match keeps running (NetSession sends neutral input)
    if (s.mode !== 'online') this.safe('audio.setPaused', () => this.audio.setPaused(true));
    this.input.setContext('menu');
    this.ui.push('pause');
    this.updateTouch();
  }
  resume(): void {
    const s = this.session;
    while (this.ui.has('hud') && this.ui.top() !== 'hud') this.ui.pop();
    if (!s) return;
    s.paused = false;
    this.safe('audio.setPaused', () => this.audio.setPaused(false));
    this.input.setContext('game');
    this.updateTouch();
  }
  quitToMenu(): void { this.goMenu(); }
  openMoveList(): void {
    const f = this.flow;
    const s = this.session;
    const ids: CharId[] = s ? [s.state.fighters[0].char, s.state.fighters[1].char] : [f.p1, f.p2];
    this.ui.push('movelist', { ids, schemes: s ? s.state.schemes : f.schemes });
  }

  // ------------------------------------------------------------ main loop
  private loop = (t: number): void => {
    requestAnimationFrame(this.loop);
    // FPS cap: skip display frames (dt keeps accumulating, so the sim stays in real time); never while benchmarking
    const cap = this.settings.data.gfx.fpsCap;
    if (cap > 0 && !this.bench && t - this.lastFrameT < 1000 / cap - 1.5) return;
    this.lastFrameT = t;
    const now = t / 1000;
    const dt = Math.min(0.25, Math.max(0, now - this.last));
    this.last = now;
    const w0 = performance.now();
    this.input.poll();
    this.stepBenchmark(dt);
    this.ui.update(dt);
    const topNow = this.ui.top();
    if (topNow !== this.lastTop) { this.lastTop = topNow; this.updateTouch(); } // touch pad follows whichever screen is on top
    const s = this.session;
    const r = this.renderer;
    if (s) {
      const top = this.ui.top();
      s.advance(dt);
      // KO slow motion (offline): animation / VFX follow the slowed sim clock; online timeScale stays 1
      const ts = s.timeScale;
      if (r) r.timeScale = ts;
      this.safe('renderer.update', () => r?.update(s.prev, s.state, s.alpha, dt));
      this.safe('vfx.update', () => this.vfx?.update(dt * ts, s.state, dt));
      if (top === 'hud' || top === 'pause' || top === 'settings' || top === 'howto' || top === 'movelist' || top === 'remap') {
        this.hud.refresh(dt, s.state, s);
        this.input.setAwakenReady(this.hud.awakenReady);
      }
      if (s.mode === 'training' && s.showHitboxes) this.safe('setDebugBoxes', () => r?.setDebugBoxes(debugBoxes(s.state)));
      else if (s.mode === 'training') this.safe('setDebugBoxes', () => r?.setDebugBoxes(null));
    } else {
      this.safe('renderer.updateMenu', () => (r as unknown as { updateMenu?: (dt: number) => void } | null)?.updateMenu?.(dt));
    }
    this.safe('renderer.render', () => r?.render());
    const work = performance.now() - w0;
    this.workAvg = this.workAvg * 0.92 + work * 0.08;
    this.fpsAvg = this.fpsAvg * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
    if (this.settings.data.gfx.showFps && (this.fpsT -= dt) <= 0) {
      this.fpsT = 0.5;
      this.fpsEl.textContent = `${Math.round(this.fpsAvg)} FPS`;
    }
    if (this.debugOn && (this.debugT -= dt) <= 0) {
      this.debugT = 0.25;
      const st = this.safe('getStats', () => r?.getStats()) ?? { drawCalls: 0, triangles: 0 };
      this.debugEl.textContent =
        `fps      ${this.fpsAvg.toFixed(0)}\nframe    ${this.workAvg.toFixed(2)} ms\nsim      ${(s?.simMs ?? 0).toFixed(2)} ms\n` +
        `draws    ${st.drawCalls}\ntris     ${st.triangles}\nframe#   ${s?.state.frame ?? '-'}\nscreen   ${this.ui.top()}\n` +
        `pads     ${this.input.padCount}${this.warned.size ? '\nwarn     ' + [...this.warned].join(', ') : ''}` +
        (s && r ? `\nanim     ${r.animV2On ? 'v2 clips' : 'v1 poses'}${s.mode === 'training' ? ' (F3)' : ''}\n         ${r.animDebug()}` : '');
    }
    if (this.ui.top() === 'charselect' || this.ui.top() === 'vs' || this.ui.top() === 'interlude') {
      if ((this.debugT2 -= dt) <= 0) { this.debugT2 = 1.5; refreshPortraits(); }
    }
  };
  private debugT2 = 0;
  private lastTop: string | null = null;
}
