// Virtual stick + buttons. Pointer events, multi-touch, no dependencies.
import { Btn } from '../sim/types';

type BtnId = 'L' | 'H' | 'K' | 'S' | 'Ult' | 'Vanish' | 'Throw' | 'Guard' | 'Awaken';
const BTN_BITS: Record<BtnId, number> = {
  L: Btn.L, H: Btn.H, K: Btn.K, S: Btn.S, Ult: Btn.Ult, Guard: Btn.Guard,
  Vanish: Btn.H | Btn.K, Throw: Btn.L | Btn.K, Awaken: Btn.L | Btn.H | Btn.K,
};

interface BtnDef { id: BtnId; label: string; sub?: string; cls: string; style: string }
const DEFS: BtnDef[] = [
  { id: 'L', label: 'L', cls: 'big', style: 'right:15.2em;bottom:5.6em' },
  { id: 'H', label: 'H', cls: 'big', style: 'right:9.4em;bottom:11em' },
  { id: 'K', label: 'K', cls: 'big', style: 'right:3.6em;bottom:5.6em' },
  { id: 'S', label: 'S', sub: 'KI', cls: 'big', style: 'right:9.4em;bottom:0.6em' },
  { id: 'Guard', label: 'GRD', cls: 'small', style: 'right:19.6em;bottom:12.2em' },
  { id: 'Throw', label: 'THR', sub: 'L+K', cls: 'small', style: 'right:15em;bottom:16.6em' },
  { id: 'Vanish', label: 'VAN', sub: 'H+K', cls: 'small', style: 'right:9.4em;bottom:17.8em' },
  { id: 'Ult', label: 'ULT', cls: 'small', style: 'right:3.4em;bottom:15em' },
  { id: 'Awaken', label: '覚', cls: 'small awaken', style: 'right:0.6em;bottom:10.6em' },
];

export class TouchControls {
  readonly root: HTMLDivElement;
  private zone: HTMLDivElement;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private pressed = new Map<number, BtnId>(); // pointerId -> button
  private stickId = -1;
  private ox = 0; private oy = 0; private dirBits = 0;
  private radius = 40;
  private visible = false;
  private btnEls = new Map<BtnId, HTMLElement>();
  onPause: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'touch-layer';
    this.zone = document.createElement('div');
    this.zone.className = 'tc-zone';
    this.base = document.createElement('div');
    this.base.className = 'tc-base';
    this.knob = document.createElement('div');
    this.knob.className = 'tc-knob';
    this.base.appendChild(this.knob);
    this.root.append(this.zone, this.base);
    for (const d of DEFS) {
      const b = document.createElement('div');
      b.className = 'tc-btn ' + d.cls;
      b.style.cssText = d.style;
      b.dataset.btn = d.id;
      b.innerHTML = `<span>${d.label}</span>${d.sub ? `<small>${d.sub}</small>` : ''}`;
      this.root.appendChild(b);
      this.btnEls.set(d.id, b);
      b.addEventListener('pointerdown', (e) => this.btnDown(e, d.id, b));
      const up = (e: PointerEvent) => this.btnUp(e, b);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
    }
    const pause = document.createElement('div');
    pause.className = 'tc-pause';
    pause.textContent = '⏸';
    pause.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onPause?.(); });
    this.root.appendChild(pause);

    this.zone.addEventListener('pointerdown', (e) => this.stickDown(e));
    this.zone.addEventListener('pointermove', (e) => this.stickMove(e));
    this.zone.addEventListener('pointerup', (e) => this.stickUp(e));
    this.zone.addEventListener('pointercancel', (e) => this.stickUp(e));
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    container.appendChild(this.root);
    this.setVisible(false);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.classList.toggle('on', v);
    if (!v) this.releaseAll();
  }
  isVisible(): boolean { return this.visible; }

  setAwakenReady(r: boolean): void {
    this.btnEls.get('Awaken')?.classList.toggle('ready', r);
  }

  bits(): number {
    let b = this.dirBits;
    for (const id of this.pressed.values()) b |= BTN_BITS[id];
    return b;
  }

  private vibrate(ms: number): void {
    try { if (typeof navigator.vibrate === 'function') navigator.vibrate(ms); } catch { /* ignore */ }
  }

  private btnDown(e: PointerEvent, id: BtnId, el: HTMLElement): void {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.pressed.set(e.pointerId, id);
    el.classList.add('down');
    this.vibrate(id === 'Ult' || id === 'Awaken' ? 25 : 8);
  }
  private btnUp(e: PointerEvent, el: HTMLElement): void {
    if (!this.pressed.has(e.pointerId)) return;
    this.pressed.delete(e.pointerId);
    let still = false;
    for (const id of this.pressed.values()) if (this.btnEls.get(id) === el) still = true;
    if (!still) el.classList.remove('down');
  }

  private stickDown(e: PointerEvent): void {
    if (this.stickId !== -1) return;
    e.preventDefault();
    this.stickId = e.pointerId;
    try { this.zone.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const r = this.root.getBoundingClientRect();
    this.ox = e.clientX - r.left; this.oy = e.clientY - r.top;
    this.radius = Math.max(28, this.base.offsetWidth * 0.5);
    this.base.style.left = this.ox + 'px';
    this.base.style.top = this.oy + 'px';
    this.base.classList.add('active');
    this.stickMove(e);
  }
  private stickMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    const r = this.root.getBoundingClientRect();
    let dx = e.clientX - r.left - this.ox;
    let dy = e.clientY - r.top - this.oy;
    const d = Math.hypot(dx, dy);
    const R = this.radius;
    if (d > R * 1.25) { // drag the origin along so direction changes stay snappy
      const k = (d - R * 1.25) / d;
      this.ox += dx * k; this.oy += dy * k;
      this.base.style.left = this.ox + 'px';
      this.base.style.top = this.oy + 'px';
      dx = e.clientX - r.left - this.ox; dy = e.clientY - r.top - this.oy;
    }
    const m = Math.hypot(dx, dy) || 1;
    const kx = Math.min(1, R / m);
    this.knob.style.transform = `translate(${dx * kx}px, ${dy * kx}px)`;
    const th = R * 0.38;
    let b = 0;
    if (dx < -th) b |= Btn.Left;
    if (dx > th) b |= Btn.Right;
    if (dy < -th) b |= Btn.Up;
    if (dy > th) b |= Btn.Down;
    this.dirBits = b;
  }
  private stickUp(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    this.stickId = -1;
    this.dirBits = 0;
    this.knob.style.transform = '';
    this.base.classList.remove('active');
    this.base.style.left = ''; this.base.style.top = '';
  }

  private releaseAll(): void {
    this.pressed.clear();
    this.stickId = -1; this.dirBits = 0;
    this.knob.style.transform = '';
    this.base.classList.remove('active');
    this.base.style.left = ''; this.base.style.top = '';
    for (const el of this.btnEls.values()) el.classList.remove('down');
  }
}
