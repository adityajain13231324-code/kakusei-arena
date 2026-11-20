import type { AppApi } from '../../app/api';
import { ACTIONS, ACTION_LABEL, DEFAULT_P1, DEFAULT_P2, cloneBindings, keyLabel } from '../../input/bindings';
import type { Action } from '../../input/bindings';
import type { MenuAction } from '../../input';
import { defaultSettings } from '../../app/settings';
import { PRESET_ORDER, applyPreset, relabel } from '../../app/gfx';
import type { CrowdQ, FpsCap, GfxPreset, Level3, ShadowQ } from '../../app/gfx';
import { h, sfx } from '../dom';
import { BaseScreen, mbtn } from './base';

interface SRow {
  label: string;
  hint?: string;
  value: () => string;
  /** 0..1 fill for slider rows; `setFrac` is called when the track is clicked / touched */
  slider?: () => number;
  setFrac?: (f: number) => void;
  left?: () => void; right?: () => void; act?: () => void;
  section?: string;
}

const FPS_CAPS: FpsCap[] = [30, 60, 120, 0];

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
    const g = s.gfx;
    /** a manual graphics tweak: relabel (matching preset or Custom), persist, apply live */
    const gsave = (): void => { relabel(g); g.benchDone = true; this.save(); };
    const pct = (v: number) => Math.round(v * 100) + '%';
    const vol = (k: 'master' | 'music' | 'sfx' | 'voice' | 'announcerVol', label: string): SRow => ({
      label, value: () => pct(s[k]), slider: () => s[k],
      setFrac: (f) => { s[k] = Math.round(f * 20) / 20; this.save(); },
      left: () => { s[k] = Math.max(0, Math.round((s[k] - 0.05) * 100) / 100); this.save(); },
      right: () => { s[k] = Math.min(1, Math.round((s[k] + 0.05) * 100) / 100); this.save(); },
    });
    /** numeric slider row (min..max in steps of `step`), `after` runs on every change */
    const num = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, after: () => void): SRow => {
      const q = (v: number) => Math.round(Math.min(max, Math.max(min, v)) / step) * step;
      const apply = (v: number) => { set(Math.round(q(v) * 100) / 100); after(); };
      return {
        label, value: () => pct(get()), slider: () => (get() - min) / (max - min),
        setFrac: (f) => apply(min + f * (max - min)),
        left: () => apply(get() - step), right: () => apply(get() + step),
      };
    };
    const choice = <T,>(label: string, list: T[], get: () => T, set: (v: T) => void, fmt: (v: T) => string, after: () => void): SRow => ({
      label, value: () => fmt(get()),
      left: () => { set(this.cycle(list, get(), -1)); after(); }, right: () => { set(this.cycle(list, get(), 1)); after(); },
    });
    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void, after: () => void): SRow =>
      choice<boolean>(label, [true, false], get, set, (v) => (v ? 'ON' : 'OFF'), after);
    const up = (v: string) => v.toUpperCase();
    const T: ('auto' | 'on' | 'off')[] = ['auto', 'on', 'off'];
    const sch = (p: 0 | 1): SRow => ({
      label: `Default scheme P${p + 1}`, value: () => s.scheme[p].toUpperCase(),
      left: () => { s.scheme[p] = s.scheme[p] === 'pro' ? 'easy' : 'pro'; this.save(); },
      right: () => { s.scheme[p] = s.scheme[p] === 'pro' ? 'easy' : 'pro'; this.save(); },
    });
    const presetRow = choice<GfxPreset>('Preset', PRESET_ORDER, () => g.preset, (v) => { applyPreset(g, v); g.benchDone = true; }, up, () => this.save());
    this.rows = [
      { section: 'AUDIO', ...vol('master', 'Master volume') } as SRow, vol('music', 'Music'), vol('sfx', 'Sound effects'), vol('voice', 'Fighter voices'), vol('announcerVol', 'Announcer'),
      { section: 'DISPLAY', ...presetRow } as SRow,
      num('Render scale', 0.5, 1.5, 0.05, () => g.renderScale, (v) => { g.renderScale = v; }, gsave),
      choice<FpsCap>('FPS cap', FPS_CAPS, () => g.fpsCap, (v) => { g.fpsCap = v; }, (v) => (v ? String(v) : 'UNLIMITED'), gsave),
      toggle('Show FPS counter', () => g.showFps, (v) => { g.showFps = v; }, () => this.save()),
      toggle('Anti-aliasing (next launch)', () => g.aa, (v) => { g.aa = v; }, gsave),
      choice<1024 | 2048>('Texture resolution', [1024, 2048], () => g.texRes, (v) => { g.texRes = v; }, (v) => String(v), gsave),
      toggle('Reduce flashing', () => s.reduceFlashing, (v) => { s.reduceFlashing = v; }, () => this.save()),
      { label: 'Re-run auto benchmark', value: () => (g.benchMs ? `LAST ${g.benchMs} ms` : 'RUN'), act: () => { this.app.runBenchmark(); } },
      { section: 'GRAPHICS', ...choice<ShadowQ>('Shadows', ['off', 'low', 'high'], () => g.shadows, (v) => { g.shadows = v; }, up, gsave) } as SRow,
      toggle('Outlines', () => g.outlines, (v) => { g.outlines = v; }, gsave),
      choice<Level3>('Particles', ['low', 'medium', 'high'], () => g.particles, (v) => { g.particles = v; }, up, gsave),
      choice<CrowdQ>('Crowd density', ['off', 'low', 'high'], () => g.crowd, (v) => { g.crowd = v; }, up, gsave),
      choice<'low' | 'high'>('Realm / sky quality', ['low', 'high'], () => g.realmSky, (v) => { g.realmSky = v; }, up, gsave),
      toggle('Post FX: bloom', () => g.bloom, (v) => { g.bloom = v; }, gsave),
      toggle('Post FX: impact frames', () => g.impactFrames, (v) => { g.impactFrames = v; }, gsave),
      toggle('Post FX: speed lines', () => g.speedLines, (v) => { g.speedLines = v; }, gsave),
      toggle('Post FX: color grade', () => g.colorGrade, (v) => { g.colorGrade = v; }, gsave),
      { section: 'HUD', ...num('HUD scale', 0.7, 1.2, 0.05, () => s.hudScale, (v) => { s.hudScale = v; }, () => this.save()) } as SRow,
      { section: 'GAMEPLAY', ...toggle('Announcer voice', () => s.announcer, (v) => { s.announcer = v; }, () => this.save()) } as SRow,
      { section: 'CONTROLS', label: 'Touch controls', value: () => s.touch.toUpperCase(),
        left: () => { s.touch = this.cycle(T, s.touch, -1); this.save(); }, right: () => { s.touch = this.cycle(T, s.touch, 1); this.save(); } },
      sch(0), sch(1),
      { label: 'Key bindings: Player 1', value: () => 'REMAP ▶', act: () => this.app.ui.push('remap', { slot: 0 }) },
      { label: 'Key bindings: Player 2', value: () => 'REMAP ▶', act: () => this.app.ui.push('remap', { slot: 1 }) },
      { label: 'Reset all settings', value: () => 'RESET', act: () => { Object.assign(s, defaultSettings()); this.save(); this.enter(); } },
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
        const setFromPointer = (e: PointerEvent) => {
          const b = track.getBoundingClientRect();
          r.setFrac?.(Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)));
          this.paintRows();
        };
        track.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          this.nav.focus(i, true);
          setFromPointer(e);
          track.setPointerCapture?.(e.pointerId);
          const move = (ev: PointerEvent) => setFromPointer(ev);
          const end = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', end); track.removeEventListener('pointercancel', end); };
          track.addEventListener('pointermove', move); track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);
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
      if (fill && r.slider) fill.style.transform = `scaleX(${Math.min(1, Math.max(0, r.slider()))})`;
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
