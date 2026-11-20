// InputManager: keyboard + Gamepad API + touch -> Btn bits per local slot, plus menu actions.
import { Btn } from '../sim/types';
import type { InputBits } from '../sim/types';
import { ACTIONS, DEFAULT_P1, DEFAULT_P2, cloneBindings } from './bindings';
import type { Action, Bindings } from './bindings';
import { TouchControls } from './touch';

export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause' | 'reset';
export type InputContext = 'menu' | 'game';
export type { Action, Bindings } from './bindings';
export * from './bindings';

const ACTION_BIT: Record<Action, number> = {
  up: Btn.Up, down: Btn.Down, left: Btn.Left, right: Btn.Right,
  L: Btn.L, H: Btn.H, K: Btn.K, S: Btn.S, Ult: Btn.Ult, Guard: Btn.Guard,
};

// Menu key maps: code -> [action, slot]
const MENU_KEYS: Record<string, [MenuAction, 0 | 1]> = {
  KeyW: ['up', 0], KeyS: ['down', 0], KeyA: ['left', 0], KeyD: ['right', 0],
  KeyJ: ['confirm', 0], Enter: ['confirm', 0], Space: ['confirm', 0],
  KeyK: ['back', 0], Escape: ['back', 0], Backspace: ['back', 0],
  ArrowUp: ['up', 1], ArrowDown: ['down', 1], ArrowLeft: ['left', 1], ArrowRight: ['right', 1],
  NumpadEnter: ['confirm', 1], Numpad1: ['confirm', 1], Comma: ['confirm', 1],
  Numpad2: ['back', 1], Period: ['back', 1],
};
const NAV_ACTIONS = new Set<MenuAction>(['up', 'down', 'left', 'right']);

const PAD_DEAD = 0.4;
const REPEAT_DELAY = 0.4;
const REPEAT_RATE = 0.11;

interface PadMemo { held: boolean[]; nav: Record<string, number>; navHeld: Record<string, boolean>; }

export class InputManager {
  context: InputContext = 'menu';
  private held = new Set<string>();
  private binds: [Bindings, Bindings] = [cloneBindings(DEFAULT_P1), cloneBindings(DEFAULT_P2)];
  private menuCbs = new Set<(a: MenuAction, s: 0 | 1) => void>();
  private anyCbs = new Set<() => void>();
  private capture: ((code: string) => void) | null = null;
  private touch: TouchControls | null = null;
  private touchWanted = false;
  readonly touchCapable: boolean;
  private versus = false;
  private kbP1Used = false;
  private padBits: [number, number] = [0, 0];
  private pads = new Map<number, PadMemo>();
  private lastPoll = 0;
  padCount = 0;

  constructor() {
    this.touchCapable =
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0 || (window.matchMedia?.('(pointer: coarse)').matches ?? false));
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => { this.held.clear(); });
    window.addEventListener('pointerdown', () => this.fireAny(), { capture: true });
    window.addEventListener('gamepadconnected', () => this.fireAny());
  }

  // ------------------------------------------------------------ bindings
  getBindings(slot: 0 | 1): Bindings { return this.binds[slot]; }
  setBindings(slot: 0 | 1, b: Bindings): void { this.binds[slot] = cloneBindings(b); }
  /** Capture the next key press (for remapping). cb gets the code; Escape cancels with ''. */
  captureNextKey(cb: ((code: string) => void) | null): void { this.capture = cb; }

  setContext(c: InputContext): void { this.context = c; }
  /** In versus the first gamepad becomes P2 if keyboard P1 is in use. */
  setVersus(v: boolean): void { this.versus = v; if (v) this.kbP1Used = false; }

  // ------------------------------------------------------------ menu / any
  onMenu(cb: (a: MenuAction, slot: 0 | 1) => void): () => void {
    this.menuCbs.add(cb);
    return () => { this.menuCbs.delete(cb); };
  }
  onAnyInput(cb: () => void): () => void {
    this.anyCbs.add(cb);
    return () => { this.anyCbs.delete(cb); };
  }
  private emit(a: MenuAction, s: 0 | 1): void { for (const cb of [...this.menuCbs]) cb(a, s); }
  private fireAny(): void { for (const cb of [...this.anyCbs]) cb(); }

  // ------------------------------------------------------------ keyboard
  private onKeyDown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range' || t.tagName === 'TEXTAREA')) return;
    if (e.code === 'F1' || e.code === 'F2' || e.code === 'F3') return; // app-level
    if (this.capture) {
      e.preventDefault();
      const cb = this.capture;
      this.capture = null;
      cb(e.code === 'Escape' ? '' : e.code);
      return;
    }
    const pre = e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Enter' || e.code.startsWith('Numpad') || e.code === 'Tab' || e.code === 'Backspace' || e.code === 'Quote' || e.code === 'Slash';
    if (pre) e.preventDefault();
    if (!e.repeat) this.fireAny();
    if (!this.held.has(e.code)) {
      for (const a of ACTIONS) if (this.binds[0][a].includes(e.code)) this.kbP1Used = true;
    }
    this.held.add(e.code);

    if (this.context === 'game') {
      if (e.repeat) return;
      if (e.code === 'Escape' || e.code === 'Enter') this.emit('pause', 0);
      else if (e.code === 'KeyR') this.emit('reset', 0);
      return;
    }
    const m = MENU_KEYS[e.code];
    if (!m) return;
    if (e.repeat && !NAV_ACTIONS.has(m[0])) return;
    this.emit(m[0], m[1]);
  }

  private keyBits(slot: 0 | 1): number {
    let b = 0;
    const bd = this.binds[slot];
    for (const a of ACTIONS) {
      for (const c of bd[a]) if (this.held.has(c)) { b |= ACTION_BIT[a]; break; }
    }
    return b;
  }

  // ------------------------------------------------------------ gamepad
  private padSlot(rank: number): 0 | 1 | -1 {
    if (!this.versus) return rank === 0 ? 0 : rank === 1 ? 1 : -1;
    if (this.kbP1Used) return rank === 0 ? 1 : -1;
    return rank === 0 ? 0 : rank === 1 ? 1 : -1;
  }

  /** Call once per animation frame. */
  poll(): void {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - (this.lastPoll || now));
    this.lastPoll = now;
    let list: (Gamepad | null)[] = [];
    try { list = Array.from(navigator.getGamepads?.() ?? []); } catch { list = []; }
    const pads = list.filter((g): g is Gamepad => !!g && g.connected);
    this.padCount = pads.length;
    this.padBits = [0, 0];
    pads.forEach((g, rank) => {
      const slot = this.padSlot(rank);
      let memo = this.pads.get(g.index);
      if (!memo) { memo = { held: [], nav: {}, navHeld: {} }; this.pads.set(g.index, memo); }
      const btn = (i: number) => !!g.buttons[i]?.pressed;
      const ax = g.axes[0] ?? 0, ay = g.axes[1] ?? 0;
      const left = btn(14) || ax < -PAD_DEAD, right = btn(15) || ax > PAD_DEAD;
      const up = btn(12) || ay < -PAD_DEAD, down = btn(13) || ay > PAD_DEAD;
      let bits = 0;
      if (left) bits |= Btn.Left; if (right) bits |= Btn.Right;
      if (up) bits |= Btn.Up; if (down) bits |= Btn.Down;
      if (btn(2)) bits |= Btn.L; if (btn(3)) bits |= Btn.H;
      if (btn(0)) bits |= Btn.K; if (btn(1)) bits |= Btn.S;
      if (btn(5)) bits |= Btn.Ult; if (btn(4)) bits |= Btn.Guard;
      if (slot !== -1) {
        if (this.versus) this.padBits[slot] |= bits; else this.padBits[0] |= bits;
      }
      // edges
      const edge = (i: number) => { const n = btn(i); const was = memo!.held[i] === true; memo!.held[i] = n; return n && !was; };
      let any = false;
      const startEdge = edge(9), selEdge = edge(8); // read these before the loop (edge() latches the state)
      for (let i = 0; i < 12; i++) if (i !== 8 && i !== 9 && edge(i)) any = true;
      if (startEdge) any = true;
      if (any) this.fireAny();
      const s: 0 | 1 = slot === 1 ? 1 : 0;
      if (this.context === 'game') {
        if (startEdge) this.emit('pause', s);
        if (selEdge) this.emit('reset', s);
      } else {
        if (this.justPressed(memo, 'a', btn(0))) this.emit('confirm', s);
        if (this.justPressed(memo, 'b', btn(1))) this.emit('back', s);
        if (startEdge) this.emit('confirm', s);
        const dirs: [string, boolean, MenuAction][] = [['l', left, 'left'], ['r', right, 'right'], ['u', up, 'up'], ['d', down, 'down']];
        for (const [k, on, act] of dirs) {
          if (!on) { memo.navHeld[k] = false; memo.nav[k] = 0; continue; }
          if (!memo.navHeld[k]) { memo.navHeld[k] = true; memo.nav[k] = REPEAT_DELAY; this.emit(act, s); }
          else { memo.nav[k] -= dt; if (memo.nav[k] <= 0) { memo.nav[k] = REPEAT_RATE; this.emit(act, s); } }
        }
      }
    });
  }
  private justPressed(memo: PadMemo, key: string, now: boolean): boolean {
    const was = memo.navHeld['e_' + key] === true;
    memo.navHeld['e_' + key] = now;
    return now && !was;
  }

  // ------------------------------------------------------------ bits
  read(slot: 0 | 1): InputBits {
    let b = this.keyBits(slot) | this.padBits[slot];
    // single-player modes: the arrow-key layout also drives P1
    if (slot === 0 && !this.versus) b |= this.keyBits(1);
    if (slot === 0 && this.touch) b |= this.touch.bits();
    return cleanSocd(b);
  }

  // ------------------------------------------------------------ touch
  attachTouch(container: HTMLElement): void {
    if (this.touch) return;
    this.touch = new TouchControls(container);
    this.touch.onPause = () => this.emit('pause', 0);
    this.touch.setVisible(this.touchWanted);
  }
  setTouchVisible(v: boolean): void {
    this.touchWanted = v;
    this.touch?.setVisible(v);
  }
  setAwakenReady(r: boolean): void { this.touch?.setAwakenReady(r); }
}

/** SOCD cleaning: Left+Right -> neutral, Up+Down -> Up. */
export function cleanSocd(b: number): number {
  if ((b & Btn.Left) && (b & Btn.Right)) b &= ~(Btn.Left | Btn.Right);
  if ((b & Btn.Up) && (b & Btn.Down)) b &= ~Btn.Down;
  return b;
}
