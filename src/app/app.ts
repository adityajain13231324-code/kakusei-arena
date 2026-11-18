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
import { SettingsStore } from './settings';
import { MatchSession } from './session';
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
  private debugOn = false;
  private fpsAvg = 60; private workAvg = 0; private debugT = 0;

  constructor(private canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    try {
      this.renderer = new GameRenderer(canvas);
      this.vfx = new VfxSystem(this.renderer);
    } catch (e) {
      console.warn('[app] renderer unavailable', e);
      this.renderer = null; this.vfx = null;
    }
    setPortraitSource((id, size) => this.renderer?.snapshotCharacter(id, size) ?? '');
    setSfx((s) => this.audio.ui(s));

    this.ui = new UI(uiRoot);
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

    this.toastEl = h('div', { class: 'toast' });
    this.debugEl = h('pre', { class: 'debug' });
    uiRoot.append(this.toastEl, this.debugEl);
    this.input.attachTouch(uiRoot);

    this.input.onMenu((a, slot) => this.onMenu(a, slot));
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 150));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.autoPause(); });
    window.addEventListener('blur', () => this.autoPause());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F1') { e.preventDefault(); this.toggleDebug(); }
      if (e.code === 'F2' && this.session?.mode === 'training') { e.preventDefault(); this.session.showHitboxes = !this.session.showHitboxes; }
    });
    window.addEventListener('gamepadconnected', () => this.toast('Gamepad connected'));
    const unlock = () => { this.safe('audio.unlock', () => this.audio.unlock()); };
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    window.addEventListener('keydown', unlock, { once: true, capture: true });
    // block page scroll/zoom/context menu on touch
    for (const ev of ['gesturestart', 'gesturechange', 'dblclick'] as const) document.addEventListener(ev, (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => { if ((e.target as HTMLElement).closest('.ml-scroll, .ht-body')) return; e.preventDefault(); }, { passive: false });

    this.applySettings();
    this.resize();
    this.ui.go('title');
    requestAnimationFrame(this.loop);
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
    this.safe('audio.setVolumes', () => this.audio.setVolumes(s.master, s.music, s.sfx));
    const q = this.settings.resolveQuality();
    this.safe('renderer.setQuality', () => this.renderer?.setQuality(q));
    this.safe('vfx.setQuality', () => this.vfx?.setQuality(q));
    this.safe('audio.setAnnouncer', () => (this.audio as unknown as { setAnnouncer?: (on: boolean) => void }).setAnnouncer?.(s.announcer));
    this.safe('vfx.setReduceFlashing', () => this.vfx?.setReduceFlashing(s.reduceFlashing));
    this.input.setBindings(0, s.keys.p1);
    this.input.setBindings(1, s.keys.p2);
    this.resize();
    this.updateTouch();
  }
  private resize(): void {
    const q = this.settings.resolveQuality();
    const cap = q === 'low' ? 1 : q === 'medium' ? 1.5 : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    const w = window.innerWidth, hgt = window.innerHeight;
    this.safe('renderer.resize', () => this.renderer?.resize(w, hgt, dpr));
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
    this.endSession();
    this.input.setContext('menu');
    this.input.setVersus(false);
    this.safe('audio.music', () => this.audio.music('menu'));
    this.ui.go('menu');
  }
  chooseMode(m: Mode): void {
    this.flow.mode = m;
    this.input.setVersus(m === 'versus');
    if (m === 'arcade') this.ui.go('difficulty'); else this.ui.go('charselect', { mode: m });
  }
  setDifficulty(d: Difficulty): void { this.flow.difficulty = d; this.ui.go('charselect', { mode: 'arcade' }); }
  toCharSelect(): void {
    this.endSession();
    this.input.setContext('menu');
    this.safe('audio.music', () => this.audio.music('menu'));
    this.ui.go('charselect', { mode: this.flow.mode });
  }
  pickChars(p1: CharId, p2: CharId, schemes: [ControlScheme, ControlScheme]): void {
    const f = this.flow;
    f.p1 = p1; f.p2 = p2; f.schemes = schemes;
    if (f.mode === 'arcade') {
      const i = ALL_CHARS.indexOf(p1);
      f.ladder = [1, 2, 3].map((k) => ALL_CHARS[(i + k) % ALL_CHARS.length]);
      f.ladderIndex = 0; f.arcadeFrames = 0;
      void this.startMatch();
    } else this.ui.go('stage');
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
    const stage: StageId = arcade ? ARCADE_STAGES[f.ladderIndex % ARCADE_STAGES.length] : f.stage;
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

  // ------------------------------------------------------------ pause
  pause(): void {
    const s = this.session;
    if (!s || s.paused || this.ui.top() !== 'hud' || s.ended) return;
    s.paused = true;
    this.safe('audio.setPaused', () => this.audio.setPaused(true));
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
    const now = t / 1000;
    const dt = Math.min(0.25, Math.max(0, now - this.last));
    this.last = now;
    const w0 = performance.now();
    this.input.poll();
    this.ui.update(dt);
    const s = this.session;
    const r = this.renderer;
    if (s) {
      const top = this.ui.top();
      s.advance(dt);
      this.safe('renderer.update', () => r?.update(s.prev, s.state, s.alpha, dt));
      this.safe('vfx.update', () => this.vfx?.update(dt, s.state));
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
    if (this.debugOn && (this.debugT -= dt) <= 0) {
      this.debugT = 0.25;
      const st = this.safe('getStats', () => r?.getStats()) ?? { drawCalls: 0, triangles: 0 };
      this.debugEl.textContent =
        `fps      ${this.fpsAvg.toFixed(0)}\nframe    ${this.workAvg.toFixed(2)} ms\nsim      ${(s?.simMs ?? 0).toFixed(2)} ms\n` +
        `draws    ${st.drawCalls}\ntris     ${st.triangles}\nframe#   ${s?.state.frame ?? '-'}\nscreen   ${this.ui.top()}\n` +
        `pads     ${this.input.padCount}${this.warned.size ? '\nwarn     ' + [...this.warned].join(', ') : ''}`;
    }
    if (this.ui.top() === 'charselect' || this.ui.top() === 'vs' || this.ui.top() === 'interlude') {
      if ((this.debugT2 -= dt) <= 0) { this.debugT2 = 1.5; refreshPortraits(); }
    }
  };
  private debugT2 = 0;
}
