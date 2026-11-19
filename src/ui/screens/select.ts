import type { AppApi, Mode } from '../../app/api';
import type { Difficulty } from '../../ai';
import type { MenuAction } from '../../input';
import { ALL_CHARS, ALL_STAGES, CROSSOVER_CHARS } from '../../sim/types';
import type { CharId, ControlScheme, StageId } from '../../sim/types';
import { h, sfx } from '../dom';
import { BaseScreen } from './base';
import { CHAPTER2, META, REALM, STAGES, ULT_DESC, cardOrder, charTitle, portraitEl, refreshPortraits, ultName } from '../meta';
import { ICON_GLOBE, ICON_LOCK, audioTools } from '../widgets';

/** visual order: CHAPTER 1 originals + RANDOM, then the CROSSOVER row (5 columns each) */
const ORDER = cardOrder();
const RANDOM = ORDER.indexOf('random');
const COLS = 5;
const cardOf = (id: CharId): number => Math.max(0, ORDER.indexOf(id));
const SIL =
  '<svg viewBox="0 0 100 120" preserveAspectRatio="xMidYMax meet"><path d="M50 14c-12 0-20 9-20 22 0 8 3 14 8 18-14 4-26 12-28 30l-2 36h84l-2-36c-2-18-14-26-28-30 5-4 8-10 8-18 0-13-8-22-20-22z" /></svg>';
const DIFFS: { id: Difficulty; name: string }[] = [
  { id: 'easy', name: 'EASY' }, { id: 'normal', name: 'NORMAL' }, { id: 'hard', name: 'HARD' }, { id: 'nightmare', name: 'NIGHTMARE' },
];
type Zone = 'tabs' | 'grid' | 'chips' | 'btns';
const ZONES: Zone[] = ['tabs', 'grid', 'chips', 'btns'];

interface Info {
  root: HTMLElement; tag: HTMLElement; name: HTMLElement; title: HTMLElement; tags: HTMLElement; ult: HTMLElement; desc: HTMLElement;
  realm: HTMLElement; realmName: HTMLElement; realmDesc: HTMLElement;
  scheme: HTMLElement; lock: HTMLElement; rnd: HTMLElement;
}

export class CharSelectScreen extends BaseScreen {
  private mode: Mode = 'arcade';
  private players = 1;
  private active: 0 | 1 = 0;
  private cursor: [number, number] = [0, 1];
  private rolled: [CharId, CharId] = ['kaito', 'shiori'];
  private locked: [boolean, boolean] = [false, false];
  private schemes: [ControlScheme, ControlScheme] = ['pro', 'pro'];
  private cards: HTMLElement[] = [];
  private tabs: HTMLElement[] = [];
  private tabLbl: HTMLElement[] = [];
  private stageChips: HTMLElement[] = [];
  private cpuChips: HTMLElement[] = [];
  private cpuGroup: HTMLElement;
  private stageIds: StageId[] = [];
  private friendBtn: HTMLElement; private fightBtn: HTMLElement;
  private info: [Info, Info];
  private zone: Zone = 'grid';
  private zi: Record<Zone, number> = { tabs: 1, grid: 0, chips: 0, btns: 1 };
  private finishing = false;
  private timer = 0;
  private lastPreview = '';
  private sub: HTMLElement;
  private chipsRow: HTMLElement;

  constructor(app: AppApi) {
    super(app, '');
    this.el.classList.add('charselect');
    // ---- header
    const title = h('h2', { class: 'cx-title' }, h('span', null, 'SELECT YOUR '), 'FIGHTER');
    this.sub = h('div', { class: 'cx-sub' });
    const back = h('button', { class: 'cx-pill', type: 'button', onclick: () => { sfx('back'); this.back(); } }, '◀ BACK');
    const how = h('button', { class: 'cx-pill alt', type: 'button', onclick: () => { sfx('select'); this.app.ui.push('howto'); } }, '? HOW TO PLAY');
    const left = h('div', { class: 'cx-tl' }, back, how);
    const vs = h('div', { class: 'cx-vs' }, h('span', null, 'VS'));
    // ---- tabs
    const mkTab = (p: 0 | 1) => {
      const lbl = h('span', { class: 'cx-tab-l' });
      const badge = h('i', null, p === 0 ? '1P' : 'CPU');
      const t = h('button', { class: 'cx-tab' + (p === 1 ? ' b' : ''), type: 'button' }, badge, lbl);
      t.addEventListener('click', () => { if (this.finishing) return; sfx('select'); this.setActive(p); this.zone = 'grid'; this.paintFocus(); });
      this.tabLbl.push(lbl); this.tabs.push(t);
      return t;
    };
    const tabsRow = h('div', { class: 'cx-tabs' }, mkTab(0), mkTab(1));
    // ---- chapter 1 grid (originals + RANDOM) and the CROSSOVER row
    const grid = h('div', { class: 'cx-grid' });
    const gridX = h('div', { class: 'cx-grid xo' });
    ORDER.forEach((slot, i) => {
      const isR = slot === 'random';
      const xo = !isR && CROSSOVER_CHARS.includes(slot);
      const card = h('button', { class: 'cx-card stg' + (isR ? ' random' : '') + (xo ? ' xo' : ''), type: 'button', style: `--c:${isR ? '#ffffff' : META[slot].color};--i:${i}` });
      if (isR) card.append(h('div', { class: 'portrait rnd' }, h('span', { class: 'q' }, '?')));
      else card.append(portraitEl(slot, '', 256));
      card.append(h('div', { class: 'cx-nm' }, isR ? 'RANDOM' : META[slot].given),
        h('span', { class: 'cx-tag t1' }, '1P'), h('span', { class: 'cx-tag t2' }, 'CPU'));
      if (xo) card.append(h('span', { class: 'cx-xo' }, 'X'));
      card.addEventListener('pointerenter', (e) => { if ((e as PointerEvent).pointerType !== 'touch') this.hover(i); });
      card.addEventListener('click', () => this.click(i));
      (xo ? gridX : grid).appendChild(card);
      this.cards.push(card);
    });
    // ---- chapter 2 (locked)
    const grid2 = h('div', { class: 'cx-grid two' });
    CHAPTER2.forEach((f, i) => {
      const c = h('button', { class: 'cx-card lockc' + (f.boss ? ' boss' : ''), type: 'button', style: `--c:${f.color}`, title: f.name },
        h('div', { class: 'portrait' }, h('div', { class: 'sil', html: SIL })),
        h('span', { class: 'cx-lock', html: ICON_LOCK }),
        h('div', { class: 'cx-nm' }, f.short),
        f.boss ? h('span', { class: 'cx-boss' }, 'BOSS') : i === 0 ? h('span', { class: 'cx-next' }, 'NEXT') : null);
      c.addEventListener('click', () => { sfx('error'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); this.app.toast(`${f.name} unlocks in Chapter 2. Clear Arcade to prepare.`); });
      grid2.appendChild(c);
    });
    // ---- chips
    const stageGroup = h('div', { class: 'cx-chipgrp' }, h('small', null, 'STAGE'));
    for (const st of ALL_STAGES) {
      const meta = STAGES.find((x) => x.id === st);
      const c = h('button', { class: 'cx-chip', type: 'button', 'data-st': st }, meta ? meta.name : st);
      c.addEventListener('click', () => { sfx('select'); this.setStage(st); this.zone = 'chips'; this.zi.chips = this.stageIds.indexOf(st); this.paintFocus(); });
      stageGroup.appendChild(c);
      this.stageChips.push(c);
    }
    this.cpuGroup = h('div', { class: 'cx-chipgrp' }, h('small', null, 'CPU'));
    DIFFS.forEach((d, i) => {
      const c = h('button', { class: 'cx-chip', type: 'button' }, d.name);
      c.addEventListener('click', () => { sfx('select'); this.setCpu(d.id); this.zone = 'chips'; this.zi.chips = this.stageIds.length + i; this.paintFocus(); });
      this.cpuGroup.appendChild(c);
      this.cpuChips.push(c);
    });
    this.chipsRow = h('div', { class: 'cx-chips' }, stageGroup, this.cpuGroup);
    // ---- buttons
    this.friendBtn = h('button', { class: 'cx-big blue', type: 'button' }, h('i', { html: ICON_GLOBE }), h('b', null, 'PLAY WITH A FRIEND'));
    this.fightBtn = h('button', { class: 'cx-big orange', type: 'button' }, h('b', null, 'FIGHT!'));
    this.friendBtn.addEventListener('click', () => { if (this.finishing) return; sfx('select'); this.app.chooseMode('online'); });
    this.fightBtn.addEventListener('click', () => { if (this.finishing) return; this.fight(); });
    const panel = h('div', { class: 'cx-panel' }, tabsRow,
      h('div', { class: 'cx-chap' }, h('div', { class: 'cx-chap-h' }, h('b', null, 'CHAPTER 1'), ' · AWAKENING'), grid),
      h('div', { class: 'cx-chap xo' }, h('div', { class: 'cx-chap-h' }, h('b', null, 'CROSSOVER'), ' · LEGENDS COLLIDE'), gridX),
      h('div', { class: 'cx-chap two' }, h('div', { class: 'cx-chap-h' }, h('b', null, 'CHAPTER 2'), ' · COMING SOON'), grid2),
      this.chipsRow, h('div', { class: 'cx-btns' }, this.friendBtn, this.fightBtn));
    this.info = [this.makeInfo(0), this.makeInfo(1)];
    this.el.append(title, this.sub, left, audioTools(app), vs, this.info[0].root, this.info[1].root, panel);
  }

  private makeInfo(p: 0 | 1): Info {
    const tag = h('div', { class: 'ci-tag' });
    const name = h('div', { class: 'ci-name' }), title = h('div', { class: 'ci-title' });
    const ult = h('div', { class: 'ci-ult' }), desc = h('p', { class: 'ci-desc' });
    const tags = h('div', { class: 'ci-tags' });
    const realmName = h('b', null), realmDesc = h('span', null);
    const realm = h('div', { class: 'ci-realm' }, h('small', null, 'SOUL REALM'), realmName, realmDesc);
    const rnd = h('span', { class: 'ci-rnd' }, 'RANDOM');
    const mkSeg = (v: ControlScheme) => h('button', { class: 'seg', type: 'button', 'data-v': v }, v.toUpperCase());
    const e = mkSeg('easy'), pr = mkSeg('pro');
    const scheme = h('div', { class: 'ci-scheme' }, h('small', null, 'CONTROLS'), e, pr);
    for (const b of [e, pr]) b.addEventListener('click', () => this.setScheme(p, b.getAttribute('data-v') as ControlScheme));
    const lock = h('div', { class: 'ci-lock' }, 'LOCKED IN');
    const root = h('div', { class: 'cx-info p' + (p + 1) }, tag, name, rnd, title, tags, ult, desc, realm, scheme, lock);
    return { root, tag, name, title, tags, ult, desc, realm, realmName, realmDesc, scheme, lock, rnd };
  }

  // ------------------------------------------------------------ lifecycle
  enter(params?: { mode?: Mode }): void {
    const f = this.app.flow;
    this.mode = params?.mode ?? f.mode;
    if (this.mode === 'online') this.mode = 'arcade';
    this.players = this.mode === 'versus' ? 2 : 1;
    this.locked = [false, false];
    this.finishing = false;
    this.active = 0;
    this.cursor = [cardOf(f.p1), cardOf(f.p2)];
    if (this.cursor[0] === this.cursor[1]) this.cursor[1] = this.cursor[0] === 0 ? 1 : 0;
    this.rolled = [this.id(0), this.id(1)];
    this.schemes = [...this.app.settings.data.scheme];
    this.app.input.setVersus(this.mode === 'versus');
    this.stageIds = ALL_STAGES.filter((s) => this.mode === 'training' || s !== 'training');
    if (!this.stageIds.includes(f.stage)) f.stage = this.stageIds[0];
    this.stageChips.forEach((c) => { c.style.display = this.stageIds.includes(c.getAttribute('data-st') as StageId) ? '' : 'none'; });
    this.cpuGroup.style.display = this.mode === 'arcade' ? '' : 'none';
    this.el.classList.toggle('versus', this.mode === 'versus');
    this.el.classList.toggle('training', this.mode === 'training');
    this.tabLbl[0].textContent = 'PLAY AS';
    this.tabLbl[1].textContent = this.mode === 'arcade' ? 'FIGHT AGAINST' : this.mode === 'versus' ? 'PLAY AS' : 'DUMMY AGAINST';
    (this.tabs[1].firstChild as HTMLElement).textContent = this.mode === 'arcade' ? 'CPU' : this.mode === 'versus' ? '2P' : 'DUM';
    (this.el.querySelectorAll('.cx-tag.t2') as NodeListOf<HTMLElement>).forEach((t) => { t.textContent = this.mode === 'arcade' ? 'CPU' : this.mode === 'versus' ? '2P' : 'DUM'; });
    const modeName = this.mode === 'arcade' ? 'ARCADE' : this.mode === 'versus' ? 'VERSUS' : 'TRAINING';
    this.sub.textContent = this.mode === 'versus'
      ? 'P1  WASD + J     P2  ARROWS + ,     PAD 1 / PAD 2     ·     ↑ EASY / PRO'
      : `${modeName} MODE   ·   ← → CHOOSE   ·   ENTER LOCK IN   ·   ESC BACK`;
    this.zone = 'grid'; this.zi = { tabs: 1, grid: this.cursor[0], chips: 0, btns: 1 };
    this.setActive(0, true);
    this.paintChips();
    refreshPortraits();
    this.refresh();
    this.paintFocus();
    this.reveal();
  }
  /** staggered card reveal (CSS animation restarts when the class is re-added) */
  private reveal(): void {
    this.el.classList.remove('reveal'); void this.el.offsetWidth; this.el.classList.add('reveal');
  }
  exit(): void { clearTimeout(this.timer); }

  // ------------------------------------------------------------ state helpers
  private id(p: 0 | 1): CharId { const c = this.cursor[p]; return c === RANDOM ? this.rolled[p] : ORDER[c] as CharId; }
  private roll(p: 0 | 1): void {
    const other = this.players === 2 ? this.id(1 - p as 0 | 1) : null;
    let c: CharId;
    let guard = 0;
    do { c = ALL_CHARS[Math.floor(Math.random() * ALL_CHARS.length)]; } while ((c === this.rolled[p] || (other && c === other && this.cursor[1 - p] !== RANDOM && this.mode === 'versus')) && guard++ < 12);
    this.rolled[p] = c;
  }
  private setCursor(p: 0 | 1, i: number): void {
    const was = this.cursor[p];
    this.cursor[p] = i;
    if (i === RANDOM && was !== RANDOM) this.roll(p);
    this.zi.grid = i;
  }
  private setActive(p: 0 | 1, silent = false): void {
    this.active = p;
    this.tabs.forEach((t, i) => t.classList.toggle('on', i === p));
    this.zi.grid = this.cursor[p];
    if (!silent) this.refresh();
  }
  private setStage(s: StageId): void { this.app.flow.stage = s; this.paintChips(); this.lastPreview = ''; this.refresh(); }
  private setCpu(d: Difficulty): void { this.app.flow.difficulty = d; this.paintChips(); this.refresh(); }
  private setScheme(p: 0 | 1, v: ControlScheme): void {
    if (this.finishing) return;
    if (this.schemes[p] !== v) sfx('move');
    this.schemes[p] = v;
    this.app.settings.data.scheme[p] = v;
    this.app.settings.save();
    this.refresh();
  }
  private paintChips(): void {
    const f = this.app.flow;
    this.stageChips.forEach((c) => c.classList.toggle('sel', c.getAttribute('data-st') === f.stage));
    this.cpuChips.forEach((c, i) => c.classList.toggle('sel', DIFFS[i].id === f.difficulty));
  }
  private back(): void { this.app.goMenu(); }

  // ------------------------------------------------------------ pointer
  private hover(i: number): void {
    if (this.finishing || this.locked[this.active]) return;
    if (this.cursor[this.active] === i) return;
    this.setCursor(this.active, i); sfx('move');
    this.zone = 'grid'; this.refresh(); this.paintFocus();
  }
  private click(i: number): void {
    if (this.finishing) return;
    if (this.mode === 'versus') {
      const p = this.locked[0] ? 1 : this.active;
      if (this.locked[p]) return;
      this.setCursor(p, i);
      this.lock(p);
      return;
    }
    this.setCursor(this.active, i);
    this.commit();
  }
  /** single-player pick confirmed (click/enter on a card) */
  private commit(): void {
    sfx('select');
    if (this.active === 0) { this.setActive(1); this.zone = 'grid'; this.zi.grid = this.cursor[1]; }
    else { this.zone = 'btns'; this.zi.btns = 1; this.refresh(); }
    this.refresh(); this.paintFocus();
  }

  // ------------------------------------------------------------ versus lock
  private lock(p: 0 | 1): void {
    this.locked[p] = true;
    sfx('select');
    if (!this.locked[1 - p as 0 | 1]) this.setActive((1 - p) as 0 | 1, true);
    this.refresh();
    if (this.locked[0] && this.locked[1]) {
      this.finishing = true;
      this.timer = window.setTimeout(() => this.go(), 650);
    }
  }
  private fight(): void {
    if (this.finishing) return;
    sfx('start');
    this.finishing = true;
    this.fightBtn.classList.add('go');
    this.timer = window.setTimeout(() => this.go(), 320);
  }
  private go(): void {
    this.app.pickChars(this.id(0), this.id(1), [this.schemes[0], this.schemes[1]]);
  }

  // ------------------------------------------------------------ keyboard / pad
  private zoneItems(z: Zone): HTMLElement[] {
    switch (z) {
      case 'tabs': return [this.info[0].scheme, this.tabs[0], this.tabs[1], this.info[1].scheme].filter((e) => e.offsetParent !== null || e === this.tabs[0] || e === this.tabs[1]);
      case 'grid': return this.cards;
      case 'chips': return [...this.stageChips.filter((c) => c.style.display !== 'none'), ...(this.mode === 'arcade' ? this.cpuChips : [])];
      case 'btns': return [this.friendBtn, this.fightBtn];
    }
  }
  private paintFocus(): void {
    for (const z of ZONES) this.zoneItems(z).forEach((e) => e.classList.remove('focus'));
    const items = this.zoneItems(this.zone);
    const i = Math.min(this.zi[this.zone], items.length - 1);
    this.zi[this.zone] = Math.max(0, i);
    // tabs zone: keep the focus ring on the active tab by default
    items[Math.max(0, i)]?.classList.add('focus');
  }

  onMenu(a: MenuAction, slot: 0 | 1): void {
    if (this.finishing) return;
    if (this.mode === 'versus') { this.onVersus(a, slot); return; }
    if (a === 'back') { sfx('back'); this.back(); return; }
    const items = this.zoneItems(this.zone);
    const z = ZONES.indexOf(this.zone);
    switch (a) {
      case 'up':
        if (this.zone === 'grid' && this.cursor[this.active] >= COLS) { this.setCursor(this.active, this.cursor[this.active] - COLS); sfx('move'); this.refresh(); }
        else if (z > 0) { this.zone = ZONES[z - 1]; this.entering(); sfx('move'); }
        break;
      case 'down':
        if (this.zone === 'grid' && this.cursor[this.active] < COLS) { this.setCursor(this.active, this.cursor[this.active] + COLS); sfx('move'); this.refresh(); }
        else if (z < ZONES.length - 1) { this.zone = ZONES[z + 1]; this.entering(); sfx('move'); }
        break;
      case 'left': case 'right': {
        const d = a === 'left' ? -1 : 1;
        if (this.zone === 'grid') {
          const n = items.length;
          this.setCursor(this.active, (this.cursor[this.active] + d + n) % n);
          sfx('move'); this.refresh();
        } else {
          const n = items.length;
          const ni = Math.min(n - 1, Math.max(0, this.zi[this.zone] + d));
          if (ni !== this.zi[this.zone]) { this.zi[this.zone] = ni; sfx('move'); }
        }
        break;
      }
      case 'confirm': this.confirmZone(items); return;
      default: return;
    }
    this.paintFocus();
  }
  private entering(): void {
    if (this.zone === 'grid') this.zi.grid = this.cursor[this.active];
    if (this.zone === 'tabs') this.zi.tabs = this.zoneItems('tabs').indexOf(this.tabs[this.active]);
  }
  private confirmZone(items: HTMLElement[]): void {
    const el = items[Math.min(this.zi[this.zone], items.length - 1)];
    if (!el) return;
    if (this.zone === 'grid') {
      this.commit();
      return;
    }
    if (this.zone === 'tabs') {
      if (el === this.tabs[0] || el === this.tabs[1]) { sfx('select'); this.setActive(el === this.tabs[0] ? 0 : 1); this.zone = 'grid'; this.zi.grid = this.cursor[this.active]; this.paintFocus(); return; }
      const p: 0 | 1 = el === this.info[0].scheme ? 0 : 1;
      this.setScheme(p, this.schemes[p] === 'pro' ? 'easy' : 'pro');
      return;
    }
    el.click();
  }

  private onVersus(a: MenuAction, slot: 0 | 1): void {
    const p: 0 | 1 = slot;
    if (a === 'back') {
      if (this.locked[p]) { this.locked[p] = false; this.setActive(p, true); sfx('back'); this.refresh(); return; }
      sfx('back'); this.back(); return;
    }
    if (this.locked[p]) return;
    switch (a) {
      case 'left': this.setCursor(p, (this.cursor[p] + ORDER.length - 1) % ORDER.length); sfx('move'); break;
      case 'right': this.setCursor(p, (this.cursor[p] + 1) % ORDER.length); sfx('move'); break;
      case 'down': this.setCursor(p, (this.cursor[p] + COLS) % ORDER.length); sfx('move'); break; // jump between the two rows
      case 'up': this.setScheme(p, this.schemes[p] === 'pro' ? 'easy' : 'pro'); return;
      case 'confirm': this.setActive(p, true); this.lock(p); return;
      default: return;
    }
    this.active = p; this.tabs.forEach((t, i) => t.classList.toggle('on', i === p));
    this.refresh();
  }

  // ------------------------------------------------------------ render
  private refresh(): void {
    const f = this.app.flow;
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i];
      const s1 = this.cursor[0] === i, s2 = this.cursor[1] === i;
      c.classList.toggle('s1', s1); c.classList.toggle('s2', s2);
      c.classList.toggle('act', this.cursor[this.active] === i);
      c.classList.toggle('l1', s1 && this.locked[0]); c.classList.toggle('l2', s2 && this.locked[1]);
    }
    for (const p of [0, 1] as const) {
      const pn = this.info[p];
      const id = this.id(p);
      const m = META[id];
      const rnd = this.cursor[p] === RANDOM;
      pn.root.style.setProperty('--c', m.color);
      pn.root.classList.toggle('locked', this.locked[p]);
      pn.root.classList.toggle('cur', this.active === p);
      const who = p === 0 ? '1P' : this.mode === 'arcade' ? 'CPU' : this.mode === 'versus' ? '2P' : 'DUMMY';
      const extra = p === 0 ? 'PLAYER' : this.mode === 'arcade' ? f.difficulty.toUpperCase() : this.mode === 'versus' ? 'PLAYER 2' : 'TRAINING';
      pn.tag.replaceChildren(h('b', null, who), ` · ${extra}`);
      pn.name.textContent = m.given;
      pn.rnd.style.display = rnd ? '' : 'none';
      pn.title.textContent = charTitle(id);
      pn.ult.replaceChildren(h('b', null, 'ULTIMATE'), ' · ', ultName(id));
      pn.desc.textContent = ULT_DESC[id];
      pn.tags.replaceChildren(...m.tags.map((t) => h('i', null, t)));
      const rm = REALM[id];
      pn.realm.style.display = rm ? '' : 'none';
      if (rm) {
        pn.realm.style.setProperty('--rc', rm.color);
        pn.realmName.textContent = rm.name;
        pn.realmDesc.textContent = rm.desc;
      }
      const showScheme = p === 0 || this.mode === 'versus';
      pn.scheme.style.display = showScheme ? '' : 'none';
      pn.scheme.querySelectorAll('.seg').forEach((b) => b.classList.toggle('on', b.getAttribute('data-v') === this.schemes[p]));
    }
    const key = this.id(0) + '|' + this.id(1) + '|' + f.stage;
    if (key !== this.lastPreview) {
      this.lastPreview = key;
      this.app.menuScene([this.id(0), this.id(1)], f.stage);
    }
  }
}

// ------------------------------------------------------------------ stage select
export class StageSelectScreen extends BaseScreen {
  private ids: (StageId | 'random')[] = [];
  private cardsEl: HTMLElement;
  constructor(app: AppApi) {
    super(app, '');
    this.el.classList.add('stagesel');
    this.cardsEl = h('div', { class: 'st-row' });
    this.el.append(h('h2', { class: 'scr-head' }, h('span', null, 'STAGE'), ' SELECT'), this.cardsEl,
      h('div', { class: 'hint' }, '← → choose    ENTER / A confirm    ESC / B back'));
  }
  enter(): void {
    const training = this.app.flow.mode === 'training';
    this.ids = ALL_STAGES.filter((s) => training || s !== 'training');
    this.ids.push('random');
    this.cardsEl.replaceChildren();
    const btns = this.ids.map((id, i) => {
      const meta = STAGES.find((s) => s.id === id);
      const b = h('button', { class: 'st-card st-' + id, type: 'button', style: `--i:${i}` },
        h('div', { class: 'st-art' }, h('i', { class: 'a' }), h('i', { class: 'b' }), h('i', { class: 'c' }),
          h('span', { class: 'st-kanji' }, meta ? meta.kanji : '?')),
        h('div', { class: 'st-name' }, meta ? meta.name : 'RANDOM'),
        h('div', { class: 'st-sub' }, meta ? meta.sub : 'Let fate pick the arena'));
      this.cardsEl.appendChild(b);
      return b;
    });
    this.nav.cols = this.ids.length;
    this.nav.setItems(btns);
    this.nav.onFocus = (i) => this.preview(i);
    this.nav.onActivate = (i) => this.choose(i);
    this.preview(0);
  }
  private preview(i: number): void {
    const id = this.ids[i];
    if (id === 'random') return;
    const f = this.app.flow;
    this.app.menuScene([f.p1, f.p2], id);
  }
  private choose(i: number): void {
    let id = this.ids[i];
    if (id === 'random') {
      const pool = this.ids.filter((s): s is StageId => s !== 'random' && (this.app.flow.mode === 'training' || s !== 'training'));
      id = pool[Math.floor(Math.random() * pool.length)];
    }
    this.app.pickStage(id);
  }
  onMenu(a: MenuAction): void {
    if (a === 'back') { sfx('back'); this.app.toCharSelect(); return; }
    this.nav.handle(a);
  }
}
