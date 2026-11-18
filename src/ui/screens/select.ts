import type { AppApi, Mode } from '../../app/api';
import type { MenuAction } from '../../input';
import { ALL_CHARS, ALL_STAGES } from '../../sim/types';
import type { CharId, ControlScheme, StageId } from '../../sim/types';
import { h, sfx } from '../dom';
import { BaseScreen } from './base';
import { META, STAGES, charName, charTitle, fillPortrait, portraitEl, refreshPortraits, stars } from '../meta';

const RANDOM = 4;

interface Panel {
  root: HTMLElement; tag: HTMLElement; given: HTMLElement; family: HTMLElement; title: HTMLElement;
  tags: HTMLElement; stars: HTMLElement; scheme: HTMLButtonElement; blurb: HTMLElement; lock: HTMLElement;
}

export class CharSelectScreen extends BaseScreen {
  private mode: Mode = 'versus';
  private players = 2;
  private cursor: [number, number] = [0, 1];
  private locked: [boolean, boolean] = [false, false];
  private picked: [CharId, CharId] = ['kaito', 'shiori'];
  private schemes: [ControlScheme, ControlScheme] = ['pro', 'pro'];
  private cards: HTMLElement[] = [];
  private marks: [HTMLElement, HTMLElement][] = [];
  private panels: [Panel, Panel];
  private finishing = false;
  private timer = 0;
  private lastPreview = '';
  private head: HTMLElement;
  private ladder: HTMLElement;
  private hint: HTMLElement;

  constructor(app: AppApi) {
    super(app, '');
    this.el.classList.add('charselect');
    this.head = h('h2', { class: 'scr-head' });
    const strip = h('div', { class: 'cs-strip' });
    for (let i = 0; i <= RANDOM; i++) {
      const isR = i === RANDOM;
      const card = h('button', { class: 'cs-card' + (isR ? ' random' : ''), type: 'button', style: isR ? '--c:#ffffff' : `--c:${META[ALL_CHARS[i]].color}` });
      if (isR) card.append(h('div', { class: 'portrait rnd' }, h('span', { class: 'kanji' }, '?')));
      else card.append(portraitEl(ALL_CHARS[i], '', 256));
      card.append(h('div', { class: 'cs-name' }, isR ? 'RANDOM' : META[ALL_CHARS[i]].given));
      const m1 = h('span', { class: 'mk p1' }, 'P1'), m2 = h('span', { class: 'mk p2' }, 'P2');
      card.append(m1, m2);
      card.addEventListener('pointerenter', (e) => { if ((e as PointerEvent).pointerType !== 'touch') this.hover(i); });
      card.addEventListener('click', () => this.click(i));
      strip.appendChild(card);
      this.cards.push(card);
      this.marks.push([m1, m2]);
    }
    this.panels = [this.makePanel(0), this.makePanel(1)];
    this.ladder = h('div', { class: 'cs-ladder' }, h('b', null, 'CPU LADDER'), h('span', null, 'Defeat every rival to clear Arcade'),
      h('div', { class: 'ladder-icons' }, h('i', null, '?'), h('i', null, '?'), h('i', null, '?')));
    this.hint = h('div', { class: 'hint' });
    this.el.append(this.head, this.panels[0].root, this.panels[1].root, this.ladder, strip, this.hint);
  }

  private makePanel(p: 0 | 1): Panel {
    const tag = h('div', { class: 'pn-tag' }, p === 0 ? 'P1' : 'P2');
    const given = h('div', { class: 'pn-given' }), family = h('div', { class: 'pn-family' });
    const title = h('div', { class: 'pn-title' }), tags = h('div', { class: 'pn-tags' });
    const st = h('div', { class: 'pn-stars' });
    const scheme = h('button', { class: 'scheme', type: 'button' }) as HTMLButtonElement;
    scheme.addEventListener('click', () => this.toggleScheme(p));
    const blurb = h('p', { class: 'pn-blurb' });
    const lock = h('div', { class: 'pn-lock' }, 'LOCKED IN');
    const root = h('div', { class: 'cs-panel p' + (p + 1) }, tag, given, family, title, tags, st, scheme, blurb, lock);
    return { root, tag, given, family, title, tags, stars: st, scheme, blurb, lock };
  }

  enter(params?: { mode?: Mode }): void {
    const f = this.app.flow;
    this.mode = params?.mode ?? f.mode;
    this.players = this.mode === 'arcade' ? 1 : 2;
    this.locked = [false, false];
    this.finishing = false;
    this.cursor = [Math.max(0, ALL_CHARS.indexOf(f.p1)), Math.max(0, ALL_CHARS.indexOf(f.p2))];
    if (this.players === 2 && this.cursor[0] === this.cursor[1]) this.cursor[1] = (this.cursor[0] + 1) % 4;
    this.schemes = [...this.app.settings.data.scheme];
    this.picked = [ALL_CHARS[this.cursor[0]], ALL_CHARS[this.cursor[1] % 4]];
    this.app.input.setVersus(this.mode === 'versus');
    this.head.replaceChildren(h('span', null, this.mode === 'arcade' ? 'ARCADE' : this.mode === 'versus' ? 'VERSUS' : 'TRAINING'), ' SELECT YOUR FIGHTER');
    this.el.classList.toggle('one', this.players === 1);
    this.panels[1].root.style.display = this.players === 1 ? 'none' : '';
    this.ladder.style.display = this.players === 1 ? '' : 'none';
    this.panels[1].tag.textContent = this.mode === 'training' ? 'DUMMY' : 'P2';
    this.hint.textContent = this.mode === 'versus'
      ? 'P1: WASD + J  /  Pad 1        P2: ARROWS + , or Num1  /  Pad 2        ↑ toggles EASY / PRO'
      : '← → choose    ENTER / A lock in    ↑ EASY / PRO    ESC / B back';
    refreshPortraits();
    this.refresh();
  }
  exit(): void { clearTimeout(this.timer); }

  private activeSlot(): 0 | 1 {
    if (this.players === 1) return 0;
    return this.locked[0] ? 1 : 0;
  }
  private hoverId(p: 0 | 1): CharId { const c = this.cursor[p]; return c === RANDOM ? this.picked[p] : ALL_CHARS[c]; }

  private hover(i: number): void {
    if (this.finishing) return;
    const p = this.mode === 'versus' ? (this.locked[0] ? 1 : 0) : this.activeSlot();
    if (this.locked[p] || this.cursor[p] === i) return;
    this.cursor[p] = i; sfx('move'); this.refresh();
  }
  private click(i: number): void {
    if (this.finishing) return;
    const p = this.mode === 'versus' ? (this.locked[0] ? 1 : 0) : this.activeSlot();
    if (this.locked[p]) return;
    this.cursor[p] = i;
    this.lock(p);
  }
  private toggleScheme(p: 0 | 1): void {
    if (p >= this.players || this.finishing) return;
    this.schemes[p] = this.schemes[p] === 'pro' ? 'easy' : 'pro';
    this.app.settings.data.scheme[p] = this.schemes[p];
    this.app.settings.save();
    sfx('move'); this.refresh();
  }
  private lock(p: 0 | 1): void {
    if (this.cursor[p] === RANDOM) {
      this.picked[p] = ALL_CHARS[Math.floor(Math.random() * ALL_CHARS.length)];
    } else this.picked[p] = ALL_CHARS[this.cursor[p]];
    this.locked[p] = true;
    sfx('select');
    this.refresh();
    if (this.locked[0] && (this.players === 1 || this.locked[1])) {
      this.finishing = true;
      this.timer = window.setTimeout(() => {
        this.app.pickChars(this.picked[0], this.players === 1 ? this.picked[1] : this.picked[1], [this.schemes[0], this.schemes[1]]);
      }, 650);
    }
  }

  onMenu(a: MenuAction, slot: 0 | 1): void {
    if (this.finishing) return;
    const p: 0 | 1 = this.players === 1 ? 0 : this.mode === 'versus' ? slot : this.activeSlot();
    if (a === 'back') {
      if (this.locked[p]) { this.locked[p] = false; sfx('back'); this.refresh(); return; }
      if (this.mode === 'training' && p === 1 && this.locked[0]) { this.locked[0] = false; sfx('back'); this.refresh(); return; }
      sfx('back');
      if (this.mode === 'arcade') this.app.ui.go('difficulty'); else this.app.goMenu();
      return;
    }
    if (this.locked[p]) return;
    switch (a) {
      case 'left': this.cursor[p] = (this.cursor[p] + RANDOM) % (RANDOM + 1); sfx('move'); break;
      case 'right': this.cursor[p] = (this.cursor[p] + 1) % (RANDOM + 1); sfx('move'); break;
      case 'up': this.toggleScheme(p); return;
      case 'confirm': this.lock(p); return;
      default: return;
    }
    this.refresh();
  }

  private refresh(): void {
    for (let i = 0; i <= RANDOM; i++) {
      const c = this.cards[i];
      const s1 = this.cursor[0] === i, s2 = this.players === 2 && this.cursor[1] === i;
      c.classList.toggle('s1', s1); c.classList.toggle('s2', s2);
      c.classList.toggle('l1', s1 && this.locked[0]); c.classList.toggle('l2', s2 && this.locked[1]);
      this.marks[i][0].style.display = s1 ? '' : 'none';
      this.marks[i][1].style.display = s2 ? '' : 'none';
      this.marks[i][1].textContent = this.mode === 'training' ? 'DUM' : 'P2';
    }
    for (const p of [0, 1] as const) {
      if (p >= this.players) continue;
      const pn = this.panels[p];
      const rnd = this.cursor[p] === RANDOM && !this.locked[p];
      const id = this.hoverId(p);
      const m = META[id];
      pn.root.style.setProperty('--c', rnd ? '#ffffff' : m.color);
      pn.root.classList.toggle('locked', this.locked[p]);
      pn.given.textContent = rnd ? 'RANDOM' : m.given;
      pn.family.textContent = rnd ? '??????' : charName(id).split(' ').slice(1).join(' ') || m.family;
      pn.title.textContent = rnd ? 'Fate decides' : charTitle(id);
      pn.tags.replaceChildren(...(rnd ? [] : m.tags.map((t) => h('span', null, t))));
      pn.stars.replaceChildren(h('small', null, 'DIFFICULTY'), stars(rnd ? 0 : m.stars));
      pn.scheme.replaceChildren(h('b', null, this.schemes[p].toUpperCase()), h('small', null, this.schemes[p] === 'pro' ? 'motion inputs' : 'simple specials'));
      pn.scheme.className = 'scheme ' + this.schemes[p];
      pn.blurb.textContent = rnd ? 'Let the arena choose your fighter.' : m.blurb;
    }
    const key = this.players === 1 ? this.hoverId(0) : this.hoverId(0) + '|' + this.hoverId(1);
    if (key !== this.lastPreview) {
      this.lastPreview = key;
      this.app.menuScene(this.players === 1 ? [this.hoverId(0)] : [this.hoverId(0), this.hoverId(1)]);
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
