import type { AppApi } from '../../app/api';
import type { MenuAction } from '../../input';
import { ALL_CHARS } from '../../sim/types';
import type { CharId } from '../../sim/types';
import { audioTools } from '../widgets';
import type { Difficulty } from '../../ai';
import { h, sfx } from '../dom';
import { BaseScreen, mbtn } from './base';
import { stars } from '../meta';

// ------------------------------------------------------------------ title
// pairs that pose over the stage in turn (title layout needs >2 ids; the first two are the ones shown)
const TITLE_PAIRS: CharId[][] = [
  ['kaito', 'ren', 'shiori', 'goro'], ['shiori', 'goro', 'kaito', 'ren'], ['ren', 'shiori', 'goro', 'kaito'], ['goro', 'kaito', 'ren', 'shiori'],
];

export class TitleScreen extends BaseScreen {
  private off: (() => void) | null = null;
  private started = false;
  private pressEl: HTMLElement;
  private pair = 0;
  private clock = 0;
  constructor(app: AppApi) {
    super(app, '');
    this.el.classList.add('title');
    this.pressEl = h('div', { class: 'press' }, h('span', null, 'PRESS ENTER / CLICK TO START'));
    this.el.append(
      h('div', { class: 'rays' }),
      h('div', { class: 'big-kanji', 'aria-hidden': 'true' }, '覚醒'),
      audioTools(app),
      h('div', { class: 'logo' },
        h('div', { class: 'logo-k' }, h('span', null, 'KAKUSEI')),
        h('div', { class: 'logo-a' }, h('span', null, 'ARENA')),
        h('div', { class: 'logo-seal', 'aria-hidden': 'true' }, h('span', null, '覚'), h('span', null, '醒'))),
      h('div', { class: 'tagline' }, h('i', null), 'AWAKEN YOUR POWER', h('i', null)),
      this.pressEl,
      h('div', { class: 'ver' }, 'v0.2  /  ANIME 3D FIGHTING'),
      h('div', { class: 'legal' }, 'An original game. All characters and stories are fictional.'),
    );
  }
  enter(): void {
    this.started = false;
    this.el.classList.remove('leaving');
    this.clock = 0;
    this.pressEl.querySelector('span')!.textContent = this.app.input.touchCapable ? 'TAP TO START' : 'PRESS ENTER / CLICK TO START';
    this.app.menuScene(TITLE_PAIRS[this.pair % TITLE_PAIRS.length]);
    this.off = this.app.input.onAnyInput(() => this.go());
  }
  exit(): void { this.off?.(); this.off = null; }
  update(dt: number): void {
    if (this.started || this.app.ui.top() !== 'title') return;
    this.clock += dt;
    if (this.clock > 15) { this.clock = 0; this.pair++; this.app.menuScene(TITLE_PAIRS[this.pair % TITLE_PAIRS.length]); }
  }
  private go(): void {
    if (this.started) return;
    // taps on the sound / music buttons must not start the game
    const ev = (window as unknown as { event?: Event }).event;
    if (ev && (ev.target as HTMLElement | null)?.closest?.('.tools')) return;
    this.started = true;
    this.el.classList.add('leaving');
    this.app.startFromTitle();
  }
  onMenu(): void { /* handled by onAnyInput */ }
}

// ------------------------------------------------------------------ main menu
interface Item { label: string; sub: string; desc: string; act: () => void; off?: boolean }

export class MainMenuScreen extends BaseScreen {
  private desc: HTMLElement;
  private items: Item[];
  constructor(app: AppApi) {
    super(app, '');
    this.el.classList.add('mainmenu');
    this.items = [
      { label: 'ARCADE', sub: 'アーケード', desc: 'Fight your way through every rival. Beat the ladder against the CPU.', act: () => app.chooseMode('arcade') },
      { label: 'VERSUS', sub: '対戦', desc: 'Local 2-player: two keyboards layouts, two gamepads, or keyboard + pad.', act: () => app.chooseMode('versus') },
      { label: 'TRAINING', sub: '修行', desc: 'Hitboxes, frame data, input display and a dummy to punish.', act: () => app.chooseMode('training') },
      { label: 'ONLINE', sub: 'オンライン', desc: 'Play a friend online: create a room, share the link, rollback netcode.', act: () => app.chooseMode('online') },
      { label: 'HOW TO PLAY', sub: '遣い方', desc: 'Controls for keyboard, gamepad and touch, plus every system explained.', act: () => app.ui.push('howto') },
      { label: 'SETTINGS', sub: '設定', desc: 'Volume, graphics quality, accessibility, touch controls and key remapping.', act: () => app.ui.push('settings') },
      { label: 'CREDITS', sub: '制作', desc: 'Who built this.', act: () => app.ui.push('credits') },
    ];
    const list = h('div', { class: 'menu-list' });
    const btns = this.items.map((it, i) => {
      const b = mbtn(it.label, it.sub, it.off ? 'off' : '');
      b.style.setProperty('--i', String(i));
      list.appendChild(b);
      return b;
    });
    this.desc = h('div', { class: 'menu-desc' });
    this.el.append(
      h('div', { class: 'menu-logo' }, h('b', null, 'KAKUSEI'), h('span', null, 'ARENA')),
      list, this.desc,
      h('div', { class: 'menu-kanji', 'aria-hidden': 'true' }, '覚醒'),
    );
    this.items.forEach((it, i) => { if (it.off) this.nav.disabled.add(i); });
    this.nav.setItems(btns);
    this.nav.onActivate = (i) => this.items[i].act();
    this.nav.onFocus = (i) => this.showDesc(i);
    this.showDesc(0);
  }
  private showDesc(i: number): void { this.desc.textContent = this.items[i].desc; }
  enter(): void {
    this.app.menuScene([...ALL_CHARS]);
    this.app.input.setVersus(false);
    this.showDesc(this.nav.index);
  }
  onMenu(a: MenuAction): void { this.nav.handle(a); }
}

// ------------------------------------------------------------------ arcade difficulty
const DIFFS: { id: Difficulty; name: string; jp: string; desc: string; stars: number }[] = [
  { id: 'easy', name: 'EASY', jp: '初心者', desc: 'Relaxed CPU. Learn the systems.', stars: 1 },
  { id: 'normal', name: 'NORMAL', jp: '普通', desc: 'A fair fight. Blocks, punishes, mixes it up.', stars: 2 },
  { id: 'hard', name: 'HARD', jp: '難しい', desc: 'Fast reactions and real punishes.', stars: 4 },
  { id: 'nightmare', name: 'NIGHTMARE', jp: '悪夢', desc: 'Frame-perfect. Good luck.', stars: 5 },
];

export class DifficultyScreen extends BaseScreen {
  constructor(app: AppApi) {
    super(app, '');
    this.el.classList.add('difficulty');
    const row = h('div', { class: 'diff-row' });
    const btns = DIFFS.map((d, i) => {
      const b = h('button', { class: 'diff-card', type: 'button', style: `--i:${i}` },
        h('div', { class: 'diff-jp' }, d.jp), h('b', null, d.name), stars(d.stars), h('p', null, d.desc));
      row.appendChild(b);
      return b;
    });
    this.el.append(h('h2', { class: 'scr-head' }, h('span', null, 'ARCADE'), ' CPU DIFFICULTY'), row,
      h('div', { class: 'hint' }, '← → choose    ENTER / A confirm    ESC / B back'));
    this.nav.cols = 4;
    this.nav.setItems(btns);
    this.nav.onActivate = (i) => app.setDifficulty(DIFFS[i].id);
  }
  enter(): void {
    const i = Math.max(0, DIFFS.findIndex((d) => d.id === this.app.flow.difficulty));
    this.nav.focus(i, true);
  }
  onMenu(a: MenuAction): void {
    if (a === 'back') { sfx('back'); this.app.goMenu(); return; }
    this.nav.handle(a);
  }
}

// ------------------------------------------------------------------ credits
export class CreditsScreen extends BaseScreen {
  constructor(app: AppApi) {
    super(app, '');
    this.el.classList.add('credits');
    this.el.append(
      h('h2', { class: 'scr-head' }, h('span', null, 'CREDITS'), ' 制作'),
      h('div', { class: 'credits-body' },
        h('p', null, h('b', null, 'KAKUSEI ARENA'), ' is an original browser fighting game.'),
        h('p', null, 'All characters, moves, music and sound are original. Everything is procedural: three.js models and WebAudio synthesis, with no external assets.'),
        h('p', null, 'Built with TypeScript, Vite and three.js. Fighting engine, rendering, VFX, audio, AI and UI developed as separate modules.'),
        h('p', { class: 'dim' }, 'Thanks for playing. Go find your Kakusei.')),
      h('button', { class: 'mbtn back', type: 'button', onclick: () => { sfx('back'); app.ui.pop(); } }, h('span', { class: 'mbtn-in' }, h('b', null, 'BACK'))),
    );
  }
  onMenu(a: MenuAction): void { if (a === 'back' || a === 'confirm') { sfx('back'); this.app.ui.pop(); } }
}
