import type { MenuAction } from '../input';
import type { UiSound } from '../audio';

export type Kid = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs?: Record<string, any> | null, ...kids: Kid[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') { if (typeof v === 'string') el.style.cssText = v; else Object.assign(el.style, v); }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, kids);
  return el;
}
export function append(el: HTMLElement, kids: Kid[]): void {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    el.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k)));
  }
}
export function clear(el: HTMLElement): void { while (el.firstChild) el.removeChild(el.firstChild); }

// UI sound hook, set by the app
let sfxFn: (s: UiSound) => void = () => {};
export function setSfx(f: (s: UiSound) => void): void { sfxFn = f; }
export function sfx(s: UiSound): void { try { sfxFn(s); } catch { /* ignore */ } }

/** Focusable list/grid navigation shared by every menu. */
export class Nav {
  items: HTMLElement[] = [];
  index = 0;
  cols = 1;
  wrap = true;
  /** called when an item is activated by confirm/click; return false to suppress sound */
  onActivate: ((i: number) => void) | null = null;
  onFocus: ((i: number) => void) | null = null;
  /** left/right on an item (e.g. sliders); return true if consumed */
  onSide: ((i: number, dir: -1 | 1) => boolean) | null = null;
  disabled = new Set<number>();

  constructor(opts: { cols?: number; wrap?: boolean } = {}) {
    this.cols = opts.cols ?? 1;
    this.wrap = opts.wrap ?? true;
  }

  setItems(els: HTMLElement[], keepIndex = false): void {
    this.items = els;
    if (!keepIndex) this.index = Math.max(0, els.findIndex((_, i) => !this.disabled.has(i)));
    this.index = Math.min(this.index, Math.max(0, els.length - 1));
    els.forEach((el, i) => {
      el.addEventListener('pointerenter', (e) => {
        if ((e as PointerEvent).pointerType === 'touch') return;
        if (this.index !== i && !this.disabled.has(i)) this.focus(i, true);
      });
      el.addEventListener('click', () => {
        if (this.disabled.has(i)) { sfx('error'); return; }
        this.focus(i, true);
        sfx('select');
        this.onActivate?.(i);
      });
    });
    this.paint();
  }

  focus(i: number, silent = false): void {
    if (i < 0 || i >= this.items.length) return;
    const changed = i !== this.index;
    this.index = i;
    this.paint();
    if (changed) { if (!silent) sfx('move'); this.onFocus?.(i); }
  }

  paint(): void {
    this.items.forEach((el, i) => {
      el.classList.toggle('focus', i === this.index);
      el.classList.toggle('disabled', this.disabled.has(i));
    });
    this.reveal();
  }

  /** keep the focused row visible inside a scrolling list card (settings, key bindings) */
  private reveal(): void {
    const el = this.items[this.index];
    const sc = el?.closest('.set-card') as HTMLElement | null;
    if (!el || !sc || sc.clientHeight <= 0) return;
    const prev = el.previousElementSibling as HTMLElement | null;
    const top = prev && prev.classList.contains('set-sec') ? prev : el;
    const c = sc.getBoundingClientRect();
    const t = top.getBoundingClientRect(), b = el.getBoundingClientRect();
    const pad = 6;
    if (t.top < c.top + pad) sc.scrollTop += t.top - c.top - pad;
    else if (b.bottom > c.bottom - pad) sc.scrollTop += b.bottom - c.bottom + pad;
  }

  private step(dx: number, dy: number): void {
    const n = this.items.length;
    if (!n) return;
    let i = this.index;
    for (let tries = 0; tries < n; tries++) {
      if (this.cols === 1) {
        i += dy !== 0 ? dy : 0;
        if (dy === 0) return;
        if (i < 0) i = this.wrap ? n - 1 : 0;
        if (i >= n) i = this.wrap ? 0 : n - 1;
      } else {
        if (dx) {
          i += dx;
          if (i < 0) i = this.wrap ? n - 1 : 0;
          if (i >= n) i = this.wrap ? 0 : n - 1;
        } else {
          const rows = Math.ceil(n / this.cols);
          let r = Math.floor(i / this.cols) + dy, c = i % this.cols;
          if (r < 0) r = this.wrap ? rows - 1 : 0;
          if (r >= rows) r = this.wrap ? 0 : rows - 1;
          i = Math.min(n - 1, r * this.cols + c);
        }
      }
      if (!this.disabled.has(i)) break;
    }
    this.focus(i);
  }

  /** returns true if handled */
  handle(a: MenuAction): boolean {
    switch (a) {
      case 'up': this.step(0, -1); return true;
      case 'down': this.step(0, 1); return true;
      case 'left':
        if (this.onSide?.(this.index, -1)) return true;
        if (this.cols > 1) { this.step(-1, 0); return true; }
        return false;
      case 'right':
        if (this.onSide?.(this.index, 1)) return true;
        if (this.cols > 1) { this.step(1, 0); return true; }
        return false;
      case 'confirm':
        if (this.disabled.has(this.index)) { sfx('error'); return true; }
        sfx('select');
        this.onActivate?.(this.index);
        return true;
      default: return false;
    }
  }
}
