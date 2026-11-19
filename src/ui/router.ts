import type { MenuAction } from '../input';

export interface Screen {
  readonly el: HTMLElement;
  /** if true the screens below are hidden; otherwise they stay visible behind (overlays) */
  opaque: boolean;
  enter(params?: any): void;
  exit(): void;
  onMenu?(a: MenuAction, slot: 0 | 1): void;
  update?(dt: number): void;
}

/** Stack-based screen router with CSS transitions. */
export class UI {
  readonly root: HTMLElement;
  private screens = new Map<string, Screen>();
  private stack: string[] = [];

  constructor(root: HTMLElement) { this.root = root; }

  register(name: string, s: Screen): void {
    s.el.classList.add('screen', 'scr-' + name);
    this.screens.set(name, s);
    this.root.appendChild(s.el);
  }
  get<T extends Screen>(name: string): T { return this.screens.get(name) as T; }
  top(): string | null { return this.stack[this.stack.length - 1] ?? null; }
  has(name: string): boolean { return this.stack.includes(name); }

  /** replace the whole stack */
  go(name: string, params?: any): void {
    for (const n of this.stack) if (n !== name) this.screens.get(n)?.exit();
    const reenter = this.stack.length === 1 && this.stack[0] === name;
    if (reenter) this.screens.get(name)?.exit();
    this.stack = [name];
    this.screens.get(name)?.enter(params);
    this.refresh();
  }
  push(name: string, params?: any): void {
    this.stack.push(name);
    this.screens.get(name)?.enter(params);
    this.refresh();
  }
  pop(): void {
    const n = this.stack.pop();
    if (n) this.screens.get(n)?.exit();
    this.refresh();
  }
  /** remove a named overlay anywhere in the stack */
  remove(name: string): void {
    const i = this.stack.lastIndexOf(name);
    if (i < 0) return;
    this.stack.splice(i, 1);
    this.screens.get(name)?.exit();
    this.refresh();
  }

  private refresh(): void {
    let first = this.stack.length - 1;
    while (first > 0 && !this.screens.get(this.stack[first])!.opaque) first--;
    const visible = new Set(this.stack.slice(Math.max(0, first)));
    const top = this.top();
    for (const [name, s] of this.screens) {
      const was = s.el.classList.contains('on');
      const on = visible.has(name);
      if (was && !on) this.leave(s.el);
      else if (on) s.el.classList.remove('leaving');
      s.el.classList.toggle('on', on);
      s.el.classList.toggle('top', name === top);
    }
  }

  /** keep a screen visible for one short exit transition (CSS .leaving), then hide it */
  private leave(el: HTMLElement): void {
    el.classList.add('leaving');
    const t = this.leaveT.get(el);
    if (t) clearTimeout(t);
    this.leaveT.set(el, window.setTimeout(() => { el.classList.remove('leaving'); this.leaveT.delete(el); }, 260));
  }
  private leaveT = new Map<HTMLElement, number>();

  handleMenu(a: MenuAction, slot: 0 | 1): void {
    const t = this.top();
    if (t) this.screens.get(t)?.onMenu?.(a, slot);
  }
  update(dt: number): void {
    for (const n of this.stack) this.screens.get(n)?.update?.(dt);
  }
}
