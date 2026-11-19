import type { AppApi } from '../../app/api';
import type { MenuAction } from '../../input';
import type { CharId, ControlScheme, MoveDef } from '../../sim/types';
import { getChar } from '../../sim';
import { DUMMY_LABEL, DUMMY_MODES } from '../../app/session';
import { h, sfx } from '../dom';
import { BaseScreen, mbtn } from './base';
import { KIT_NOTES, META, REALM, charName } from '../meta';

// ------------------------------------------------------------------ pause
interface PRow { label: () => string; act: () => void; side?: (d: -1 | 1) => void; cls?: string }

export class PauseScreen extends BaseScreen {
  private rows: PRow[] = [];
  private list: HTMLElement;
  constructor(app: AppApi) {
    super(app, '');
    this.opaque = false;
    this.el.classList.add('pause');
    this.list = h('div', { class: 'menu-list pause-list' });
    this.note = h('div', { class: 'pause-note' }, 'ONLINE: THE MATCH KEEPS RUNNING. YOU STAND STILL UNTIL YOU RESUME.');
    this.el.append(h('div', { class: 'pause-card' }, h('h2', { class: 'pause-title' }, h('span', null, 'PAUSED'), ' 一時停止'), this.list, this.note));
  }
  private note: HTMLElement;
  enter(): void {
    const s = this.app.session;
    this.note.style.display = s?.mode === 'online' ? '' : 'none';
    const training = s?.mode === 'training';
    this.rows = [{ label: () => 'RESUME', act: () => this.app.resume() }];
    if (s && training) {
      this.rows.push(
        { label: () => `DUMMY: ${DUMMY_LABEL[s.dummy].toUpperCase()}`, act: () => this.cyc(1), side: (d) => this.cyc(d), cls: 'tr' },
        { label: () => `HITBOXES: ${s.showHitboxes ? 'ON' : 'OFF'}`, act: () => { s.showHitboxes = !s.showHitboxes; this.rebuild(); }, side: () => { s.showHitboxes = !s.showHitboxes; this.rebuild(); }, cls: 'tr' },
        { label: () => `INFINITE KI: ${s.infiniteKi ? 'ON' : 'OFF'}`, act: () => { s.infiniteKi = !s.infiniteKi; this.rebuild(); }, side: () => { s.infiniteKi = !s.infiniteKi; this.rebuild(); }, cls: 'tr' },
        { label: () => 'RESET POSITIONS', act: () => { try { s.reset(); } catch { /* ignore */ } this.app.resume(); }, cls: 'tr' },
      );
    }
    this.rows.push(
      { label: () => 'MOVE LIST', act: () => this.app.openMoveList() },
      { label: () => 'CONTROLS', act: () => this.app.ui.push('howto', { tab: 0 }) },
      { label: () => 'SETTINGS', act: () => this.app.ui.push('settings') },
      { label: () => 'QUIT TO MENU', act: () => this.app.quitToMenu(), cls: 'danger' },
    );
    this.rebuild(true);
  }
  private cyc(d: -1 | 1): void {
    const s = this.app.session; if (!s) return;
    s.dummy = DUMMY_MODES[(DUMMY_MODES.indexOf(s.dummy) + d + DUMMY_MODES.length) % DUMMY_MODES.length];
    this.rebuild();
  }
  private rebuild(first = false): void {
    const keep = first ? 0 : this.nav.index;
    this.list.replaceChildren();
    const btns = this.rows.map((r, i) => {
      const b = mbtn(r.label(), undefined, r.cls ?? '');
      b.style.setProperty('--i', String(i));
      this.list.appendChild(b);
      return b;
    });
    this.nav.setItems(btns, true);
    this.nav.index = keep; this.nav.paint();
    this.nav.onActivate = (i) => this.rows[i].act();
    this.nav.onSide = (i, d) => { const r = this.rows[i]; if (r.side) { sfx('move'); r.side(d); return true; } return false; };
  }
  onMenu(a: MenuAction): void {
    if (a === 'back') { sfx('back'); this.app.resume(); return; }
    this.nav.handle(a);
  }
}

// ------------------------------------------------------------------ move list
const NUM: Record<string, string> = { '1': '↙', '2': '↓', '3': '↘', '4': '←', '6': '→', '7': '↖', '8': '↑', '9': '↗', '5': '·' };
function notate(s: string): string {
  let out = '';
  for (const ch of s) out += NUM[ch] ?? ch;
  return out.replace(/([←-↙·])(?=[A-Za-z])/g, '$1 ');
}
const sgn = (n: number) => (n > 0 ? '+' + n : String(n));
const m2o = (k: string, o: Record<string, number>): number => (k === 'realm' ? 6 : o[k] ?? 9);

export class MoveListScreen extends BaseScreen {
  private tabs: HTMLElement; private body: HTMLElement; private scroller: HTMLElement;
  private ids: CharId[] = []; private schemes: ControlScheme[] = ['pro', 'pro'];
  private tab = 0;
  constructor(app: AppApi) {
    super(app, '');
    this.opaque = false;
    this.el.classList.add('movelist');
    this.tabs = h('div', { class: 'ml-tabs' });
    this.body = h('div', { class: 'ml-table' });
    this.scroller = h('div', { class: 'ml-scroll' }, this.body);
    const back = h('button', { class: 'cx-pill scr-back', type: 'button', onclick: () => { sfx('back'); app.ui.pop(); } }, '◀ BACK');
    this.el.append(h('div', { class: 'ml-card' }, h('h2', { class: 'scr-head' }, h('span', null, 'MOVE LIST'), ' 技表'), back, this.tabs, this.scroller,
      h('div', { class: 'hint' }, '← → switch fighter    ↑ ↓ scroll    ESC / B back    *on-block / on-hit are estimates')));
  }
  enter(p: { ids: CharId[]; schemes: ControlScheme[]; tab?: number }): void {
    this.ids = p.ids; this.schemes = p.schemes; this.tab = p.tab ?? 0;
    this.tabs.replaceChildren(...this.ids.map((id, i) => {
      const b = h('button', { class: 'ml-tab', type: 'button', style: `--c:${META[id].color}`, onclick: () => { this.tab = i; sfx('move'); this.render(); } },
        h('b', null, 'P' + (i + 1)), ' ', META[id].given, h('small', null, this.schemes[i]?.toUpperCase() ?? ''));
      return b;
    }));
    this.render();
  }
  private render(): void {
    [...this.tabs.children].forEach((t, i) => t.classList.toggle('on', i === this.tab));
    const id = this.ids[this.tab];
    this.scroller.scrollTop = 0;
    let moves: MoveDef[] = [];
    try { moves = getChar(id).moves; } catch { moves = []; }
    if (!moves.length) { this.body.replaceChildren(h('div', { class: 'ml-empty' }, 'Move data is still loading. Try again once the fighting engine is ready.')); return; }
    const easy = this.schemes[this.tab] === 'easy';
    const order: Record<string, number> = { universal: 0, normal: 1, throw: 2, special: 3, ki: 4, ultimate: 5 };
    const SEC: Record<string, string> = { universal: 'SYSTEM', normal: 'NORMALS', throw: 'THROWS', special: 'SPECIALS', ki: 'KI MOVES', ultimate: 'ULTIMATE', realm: 'SOUL REALM' };
    const ch = getChar(id);
    const ult = ch.moves.find((x) => x.id === ch.ultimateId);
    const secOf = (m: MoveDef): string => (m.realm ? 'realm' : m.kind);
    const shown = moves.filter((m) => !m.internal || m.realm);
    const sorted = [...shown].sort((a, b) => (m2o(secOf(a), order)) - (m2o(secOf(b), order)));
    const head = h('div', { class: 'ml-row head' }, h('span', null, 'MOVE'), h('span', null, 'INPUT'), h('span', null, 'TYPE'), h('span', null, 'DMG'), h('span', null, 'START'), h('span', null, 'BLOCK*'));
    const out: HTMLElement[] = [];
    const notes = KIT_NOTES[id];
    if (notes) {
      const rm = REALM[id];
      out.push(h('div', { class: 'ml-kit', style: `--c:${META[id].color}` },
        h('b', null, 'KIT'), ...notes.map((n) => h('p', null, n)),
        rm ? h('p', { class: 'ml-realm', style: `--rc:${rm.color}` }, h('i', null, rm.name), ' ' + rm.desc) : null));
    }
    out.push(head);
    let lastSec = '';
    sorted.forEach((m) => {
      const sec = secOf(m);
      if (notes && sec !== lastSec) { lastSec = sec; out.push(h('div', { class: 'ml-sec' }, SEC[sec] ?? sec.toUpperCase())); }
      let inp = easy && m.easyInput ? m.easyInput : m.input;
      let alt: string | null = !easy && m.easyInput ? 'easy ' + notate(m.easyInput) : null;
      if (m.realm && ult) { inp = easy ? (ult.easyInput || 'Ult') : ult.input; alt = 'awakened + 3 Ki'; }
      const blk = m.blockstun - m.recovery - (m.active - 1);
      const tags: HTMLElement[] = [];
      if (m.needForm) tags.push(h('i', { class: 'ml-tag' }, m.needForm.toUpperCase()));
      if (m.requires === 'awakened') tags.push(h('i', { class: 'ml-tag aw' }, 'AWAKENED'));
      else if (m.requires === 'air') tags.push(h('i', { class: 'ml-tag' }, 'AIR'));
      if (m.kiCost) tags.push(h('i', { class: 'ml-tag ki' }, Math.round(m.kiCost / 100 * 10) / 10 + ' KI'));
      out.push(h('div', { class: 'ml-row k-' + (m.realm ? 'ultimate' : m.kind) },
        h('span', { class: 'mv' }, m.name, ...tags),
        h('span', { class: 'in' }, inp ? notate(inp) : 'AUTO', alt ? h('small', null, alt) : null),
        h('span', { class: 'ty' }, m.realm ? 'realm' : m.kind),
        h('span', null, m.realm ? '-' : String(m.damage)),
        h('span', null, m.startup + 'f'),
        m.realm ? h('span', null, '-') : h('span', { class: blk >= 0 ? 'pos' : 'neg' }, sgn(blk))));
    });
    this.body.replaceChildren(...out);
  }
  onMenu(a: MenuAction): void {
    if (a === 'back' || a === 'confirm') { sfx('back'); this.app.ui.pop(); return; }
    if (a === 'left' || a === 'right') {
      if (this.ids.length > 1) { this.tab = (this.tab + (a === 'left' ? -1 : 1) + this.ids.length) % this.ids.length; sfx('move'); this.render(); }
    } else if (a === 'up') this.scroller.scrollBy({ top: -90, behavior: 'smooth' });
    else if (a === 'down') this.scroller.scrollBy({ top: 90, behavior: 'smooth' });
  }
}

export { charName };
