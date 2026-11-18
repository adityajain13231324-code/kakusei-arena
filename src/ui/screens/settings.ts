import type { AppApi } from '../../app/api';
import { ACTIONS, ACTION_LABEL, DEFAULT_P1, DEFAULT_P2, cloneBindings, keyLabel } from '../../input/bindings';
import type { Action } from '../../input/bindings';
import type { MenuAction } from '../../input';
import { defaultSettings } from '../../app/settings';
import { h, sfx } from '../dom';
import { BaseScreen, mbtn } from './base';

interface SRow {
  label: string;
  hint?: string;
  value: () => string;
  slider?: () => number;
  left?: () => void; right?: () => void; act?: () => void;
  section?: string;
}

export class SettingsScreen extends BaseScreen {
  private rows: SRow[] = [];
  private list: HTMLElement;
  constructor(app: AppApi) {
    super(app, '');
    this.el.classList.add('settings');
    this.list = h('div', { class: 'set-list' });
    this.el.append(h('h2', { class: 'scr-head' }, h('span', null, 'SETTINGS'), ' 設定'), h('div', { class: 'set-card' }, this.list),
      h('div', { class: 'hint' }, '↑ ↓ select    ← → adjust    ESC / B back'));
    this.nav.onActivate = (i) => { const r = this.rows[i]; (r.act ?? r.right)?.(); this.paintRows(); };
    this.nav.onSide = (i, d) => { const r = this.rows[i]; const f = d < 0 ? r.left : r.right; if (f) { f(); sfx('move'); this.paintRows(); return true; } return false; };
  }
  private cycle<T>(list: T[], cur: T, d: number): T { return list[(list.indexOf(cur) + d + list.length) % list.length]; }
  private save(): void { this.app.settings.save(); this.app.applySettings(); }

  enter(): void {
    const s = this.app.settings.data;
    const vol = (k: 'master' | 'music' | 'sfx', label: string): SRow => ({
      label, value: () => Math.round(s[k] * 100) + '%', slider: () => s[k],
      left: () => { s[k] = Math.max(0, Math.round((s[k] - 0.05) * 100) / 100); this.save(); },
      right: () => { s[k] = Math.min(1, Math.round((s[k] + 0.05) * 100) / 100); this.save(); },
    });
    const Q: ('auto' | 'low' | 'medium' | 'high')[] = ['auto', 'low', 'medium', 'high'];
    const T: ('auto' | 'on' | 'off')[] = ['auto', 'on', 'off'];
    const sch = (p: 0 | 1): SRow => ({
      label: `Default scheme P${p + 1}`, value: () => s.scheme[p].toUpperCase(),
      left: () => { s.scheme[p] = s.scheme[p] === 'pro' ? 'easy' : 'pro'; this.save(); },
      right: () => { s.scheme[p] = s.scheme[p] === 'pro' ? 'easy' : 'pro'; this.save(); },
    });
    this.rows = [
      { section: 'AUDIO', ...vol('master', 'Master volume') } as SRow, vol('music', 'Music'), vol('sfx', 'Sound effects'),
      { section: 'GRAPHICS', label: 'Quality', value: () => s.quality.toUpperCase(),
        left: () => { s.quality = this.cycle(Q, s.quality, -1); this.save(); }, right: () => { s.quality = this.cycle(Q, s.quality, 1); this.save(); } },
      { label: 'Reduce flashing', value: () => (s.reduceFlashing ? 'ON' : 'OFF'),
        left: () => { s.reduceFlashing = !s.reduceFlashing; this.save(); }, right: () => { s.reduceFlashing = !s.reduceFlashing; this.save(); } },
      { label: 'Announcer voice', value: () => (s.announcer ? 'ON' : 'OFF'),
        left: () => { s.announcer = !s.announcer; this.save(); }, right: () => { s.announcer = !s.announcer; this.save(); } },
      { label: 'Broadcast (commentary + ticker)', value: () => (s.broadcast ? 'ON' : 'OFF'),
        left: () => { s.broadcast = !s.broadcast; this.save(); }, right: () => { s.broadcast = !s.broadcast; this.save(); } },
      { section: 'CONTROLS', label: 'Touch controls', value: () => s.touch.toUpperCase(),
        left: () => { s.touch = this.cycle(T, s.touch, -1); this.save(); }, right: () => { s.touch = this.cycle(T, s.touch, 1); this.save(); } },
      sch(0), sch(1),
      { label: 'Key bindings: Player 1', value: () => 'REMAP ▶', act: () => this.app.ui.push('remap', { slot: 0 }) },
      { label: 'Key bindings: Player 2', value: () => 'REMAP ▶', act: () => this.app.ui.push('remap', { slot: 1 }) },
      { label: 'Reset all settings', value: () => 'RESET', act: () => { Object.assign(s, defaultSettings()); this.save(); } },
      { label: 'Back', value: () => '', act: () => this.back() },
    ];
    this.list.replaceChildren();
    const els: HTMLElement[] = [];
    this.rows.forEach((r, i) => {
      if (r.section) this.list.appendChild(h('div', { class: 'set-sec' }, r.section));
      const val = h('div', { class: 'set-val' });
      if (r.slider) {
        const fill = h('i', null);
        const track = h('div', { class: 'set-track' }, fill);
        track.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          const b = track.getBoundingClientRect();
          const v = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width));
          const key = (['master', 'music', 'sfx'] as const)[i];
          s[key] = Math.round(v * 20) / 20; this.nav.focus(i, true); this.save(); this.paintRows();
        });
        val.append(track, h('b', null, ''));
      } else if (r.left && r.right) {
        val.append(h('button', { class: 'arr', type: 'button', onclick: (e: Event) => { e.stopPropagation(); r.left!(); sfx('move'); this.paintRows(); } }, '◀'), h('b', null, ''),
          h('button', { class: 'arr', type: 'button', onclick: (e: Event) => { e.stopPropagation(); r.right!(); sfx('move'); this.paintRows(); } }, '▶'));
      } else val.append(h('b', null, ''));
      const row = h('button', { class: 'set-row' + (r.label === 'Back' ? ' back' : ''), type: 'button' }, h('span', { class: 'set-label' }, r.label), val);
      this.list.appendChild(row);
      els.push(row);
    });
    this.nav.setItems(els);
    this.paintRows();
  }
  private paintRows(): void {
    const els = this.nav.items;
    this.rows.forEach((r, i) => {
      const el = els[i]; if (!el) return;
      const b = el.querySelector('.set-val > b'); if (b) b.textContent = r.value();
      const fill = el.querySelector('.set-track i') as HTMLElement | null;
      if (fill && r.slider) fill.style.transform = `scaleX(${r.slider()})`;
    });
  }
  private back(): void { sfx('back'); this.app.ui.pop(); }
  onMenu(a: MenuAction): void {
    if (a === 'back') { this.back(); return; }
    this.nav.handle(a);
  }
}

// ------------------------------------------------------------------ key remap
export class RemapScreen extends BaseScreen {
  private slot: 0 | 1 = 0;
  private capturing = -1;
  private list: HTMLElement;
  private title: HTMLElement;
  constructor(app: AppApi) {
    super(app, '');
    this.el.classList.add('remap');
    this.list = h('div', { class: 'set-list' });
    this.title = h('h2', { class: 'scr-head' });
    this.el.append(this.title, h('div', { class: 'set-card' }, this.list), h('div', { class: 'hint' }, 'ENTER on a row, then press the new key.  ESC cancels.'));
  }
  enter(p?: { slot: 0 | 1 }): void {
    this.slot = p?.slot ?? 0;
    this.capturing = -1;
    this.title.replaceChildren(h('span', null, 'KEY BINDINGS'), ` PLAYER ${this.slot + 1}`);
    this.build();
  }
  exit(): void { this.app.input.captureNextKey(null); this.capturing = -1; }
  private binds() { return this.app.settings.data.keys[this.slot === 0 ? 'p1' : 'p2']; }
  private build(): void {
    this.list.replaceChildren();
    const b = this.binds();
    const els: HTMLElement[] = ACTIONS.map((a) => {
      const caps = h('div', { class: 'caps' });
      const row = h('button', { class: 'set-row', type: 'button' }, h('span', { class: 'set-label' }, ACTION_LABEL[a]), caps);
      this.list.appendChild(row);
      void b;
      return row;
    });
    const reset = h('button', { class: 'set-row', type: 'button' }, h('span', { class: 'set-label' }, 'Reset to default'), h('div', { class: 'caps' }, h('b', null, 'RESET')));
    const back = h('button', { class: 'set-row back', type: 'button' }, h('span', { class: 'set-label' }, 'Back'), h('div', { class: 'caps' }));
    this.list.append(reset, back);
    els.push(reset, back);
    this.nav.setItems(els);
    this.nav.onActivate = (i) => {
      if (i < ACTIONS.length) this.startCapture(i);
      else if (i === ACTIONS.length) {
        this.app.settings.data.keys[this.slot === 0 ? 'p1' : 'p2'] = cloneBindings(this.slot === 0 ? DEFAULT_P1 : DEFAULT_P2);
        this.apply();
      } else this.back();
    };
    this.paint();
  }
  private paint(): void {
    const b = this.binds();
    ACTIONS.forEach((a: Action, i) => {
      const caps = this.nav.items[i].querySelector('.caps')!;
      caps.replaceChildren(...(this.capturing === i ? [h('b', { class: 'wait' }, 'PRESS A KEY...')] : b[a].map((c) => h('kbd', null, keyLabel(c)))));
    });
  }
  private startCapture(i: number): void {
    this.capturing = i;
    this.paint();
    this.app.input.captureNextKey((code) => {
      this.capturing = -1;
      if (code) {
        const b = this.binds();
        const a = ACTIONS[i];
        for (const o of ACTIONS) if (o !== a) b[o] = b[o].filter((c) => c !== code);
        for (const o of ACTIONS) if (!b[o].length) b[o] = [...(this.slot === 0 ? DEFAULT_P1 : DEFAULT_P2)[o].filter((c) => c !== code)];
        b[a] = [code];
        this.apply();
        sfx('select');
      } else { sfx('back'); this.paint(); }
    });
  }
  private apply(): void { this.app.settings.save(); this.app.applySettings(); this.paint(); }
  private back(): void { sfx('back'); this.app.ui.pop(); }
  onMenu(a: MenuAction): void {
    if (this.capturing >= 0) return;
    if (a === 'back') { this.back(); return; }
    this.nav.handle(a);
  }
}
export { mbtn };
