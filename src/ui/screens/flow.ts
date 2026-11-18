import type { AppApi } from '../../app/api';
import type { MenuAction } from '../../input';
import type { CharId } from '../../sim/types';
import { h, sfx } from '../dom';
import { BaseScreen, mbtn } from './base';
import { META, STAGES, charName, charTitle, portraitEl, refreshPortraits } from '../meta';

// ------------------------------------------------------------------ VS screen
export interface VsParams { p1: CharId; p2: CharId; stage: string; label: string; cpu: boolean }

export class VsScreen extends BaseScreen {
  private l: HTMLElement; private r: HTMLElement; private info: HTMLElement; private status: HTMLElement;
  constructor(app: AppApi) {
    super(app, '');
    this.el.classList.add('vs');
    this.l = h('div', { class: 'vs-side l' });
    this.r = h('div', { class: 'vs-side r' });
    this.info = h('div', { class: 'vs-info' });
    this.status = h('div', { class: 'vs-status' }, h('i', null), 'LOADING');
    this.el.append(this.l, this.r, h('div', { class: 'vs-slash' }), h('div', { class: 'vs-mark' }, h('span', null, 'VS')), this.info, this.status);
  }
  private side(el: HTMLElement, id: CharId, tag: string): void {
    el.style.setProperty('--c', META[id].color);
    el.replaceChildren(
      h('div', { class: 'vs-kanji' }, META[id].kanji),
      portraitEl(id, 'vs-portrait', 256),
      h('div', { class: 'vs-name' }, h('small', null, tag), h('b', null, META[id].given), h('span', null, charName(id).split(' ').slice(1).join(' ')), h('em', null, charTitle(id))),
    );
  }
  enter(p: VsParams): void {
    refreshPortraits();
    this.side(this.l, p.p1, 'PLAYER 1');
    this.side(this.r, p.p2, p.cpu ? 'CPU' : 'PLAYER 2');
    const st = STAGES.find((s) => s.id === p.stage);
    this.info.replaceChildren(h('b', null, p.label), h('span', null, st ? st.name : ''));
    this.status.classList.remove('done');
    this.status.lastChild!.textContent = 'LOADING';
    this.el.classList.remove('play');
    void this.el.offsetWidth;
    this.el.classList.add('play');
  }
  setReady(): void { this.status.classList.add('done'); this.status.lastChild!.textContent = 'READY'; }
  onMenu(): void {}
}

// ------------------------------------------------------------------ interlude (next challenger / arcade clear)
export interface InterludeParams {
  kind: 'next' | 'clear';
  nextId?: CharId; index?: number; total?: number;
  time?: string;
}

export class InterludeScreen extends BaseScreen {
  private timer = 0;
  private params: InterludeParams | null = null;
  constructor(app: AppApi) { super(app, ''); this.el.classList.add('interlude'); }
  enter(p: InterludeParams): void {
    this.params = p;
    clearTimeout(this.timer);
    this.el.className = 'screen scr-interlude interlude ' + p.kind;
    if (p.kind === 'next' && p.nextId) {
      const id = p.nextId;
      this.el.style.setProperty('--c', META[id].color);
      this.el.replaceChildren(
        h('div', { class: 'il-band' }),
        h('div', { class: 'il-text' },
          h('small', null, `FIGHT ${(p.index ?? 0) + 1} OF ${p.total ?? 3}`),
          h('b', null, 'NEXT CHALLENGER'),
          h('div', { class: 'il-name' }, h('span', null, META[id].given), ' ', charName(id).split(' ').slice(1).join(' ')),
          h('em', null, charTitle(id))),
        portraitEl(id, 'il-portrait', 256),
        h('div', { class: 'hint' }, 'ENTER / A to skip'),
      );
      refreshPortraits();
      this.timer = window.setTimeout(() => this.app.nextFight(), 2600);
    } else {
      this.el.style.setProperty('--c', '#ffd23f');
      const mk = (label: string, act: () => void, sub?: string) => { const b = mbtn(label, sub); b.addEventListener('click', act); return b; };
      const btns = [
        mk('MAIN MENU', () => this.app.goMenu(), 'メニュー'),
        mk('PLAY AGAIN', () => this.app.toCharSelect(), 'もう一度'),
      ];
      this.el.replaceChildren(
        h('div', { class: 'il-band' }),
        h('div', { class: 'il-text clear' }, h('small', null, `${this.app.flow.difficulty.toUpperCase()} MODE`), h('b', null, 'ARCADE CLEAR'),
          h('div', { class: 'il-time' }, 'TOTAL TIME ', h('span', null, p.time ?? '--:--')), h('em', null, 'Every rival has fallen.')),
        h('div', { class: 'il-btns' }, ...btns),
      );
      this.nav.cols = 1;
      this.nav.onActivate = (i) => (i === 0 ? this.app.goMenu() : this.app.toCharSelect());
      this.nav.setItems(btns);
    }
  }
  exit(): void { clearTimeout(this.timer); }
  onMenu(a: MenuAction): void {
    if (this.params?.kind === 'next') { if (a === 'confirm') { clearTimeout(this.timer); sfx('start'); this.app.nextFight(); } return; }
    this.nav.handle(a);
  }
}

// ------------------------------------------------------------------ results
export interface ResultButton { label: string; sub?: string; act: () => void }
export interface ResultsParams { winner: -1 | 0 | 1; id?: CharId; title: string; sub?: string; buttons: ResultButton[]; side: 0 | 1 }

export class ResultsScreen extends BaseScreen {
  private acts: (() => void)[] = [];
  constructor(app: AppApi) { super(app, ''); this.el.classList.add('results'); }
  enter(p: ResultsParams): void {
    const c = p.id ? META[p.id].color : '#ffffff';
    this.el.style.setProperty('--c', c);
    this.el.classList.toggle('right', p.side === 1);
    this.acts = p.buttons.map((b) => b.act);
    const btns = p.buttons.map((b, i) => { const e = mbtn(b.label, b.sub); e.style.setProperty('--i', String(i)); return e; });
    this.el.replaceChildren(
      h('div', { class: 'res-band' }),
      h('div', { class: 'res-text' },
        h('small', null, p.sub ?? (p.winner === -1 ? '' : 'VICTORY')),
        h('b', { class: 'res-name' }, p.title),
        p.winner === -1 ? null : h('div', { class: 'res-wins' }, 'WINS')),
      h('div', { class: 'res-btns' }, ...btns),
    );
    this.nav.cols = 1;
    this.nav.onActivate = (i) => this.acts[i]?.();
    this.nav.setItems(btns);
  }
}
