import type { AppApi } from '../../app/api';
import { ACTIONS, ACTION_LABEL, keyLabel } from '../../input/bindings';
import type { Action } from '../../input/bindings';
import type { MenuAction } from '../../input';
import { h, sfx } from '../dom';
import { BaseScreen } from './base';

const TABS = ['KEYBOARD', 'GAMEPAD', 'TOUCH', 'SYSTEMS'];

const SYSTEMS: { k: string; jp: string; t: string; c: string }[] = [
  { k: 'SIDESTEP vs TRACKING', jp: '歩法', c: '#38c6ff', t: 'Tap Up or Down to sidestep into or out of the screen, hold it to sidewalk. Straight attacks whiff on a sidestep, but tracking moves curve to catch you. Read which side they track.' },
  { k: 'GUARD', jp: '防御', c: '#9aa7ff', t: 'Hold back, or use the Guard button. Low attacks need a crouching guard. Throws beat guard: press the same throw buttons to break them.' },
  { k: 'KI CHARGE', jp: '気', c: '#ffd23f', t: 'Hold S to charge Ki, three bars in all. Ki fuels special moves, Vanish and your Ultimate. You also gain Ki by landing and taking hits. A bar glows when it is full.' },
  { k: 'VANISH STEP', jp: '消影', c: '#a45bff', t: 'Press H + K to blink away, invincible for a moment. It dodges slow attacks and reappears beside your rival. It costs Ki, and a read Vanish gets punished.' },
  { k: 'AWAKENING', jp: '覚醒', c: '#ff4a2e', t: 'Once per match, when you drop below 35% HP, press L + H + K. Your fighter powers up with new properties for a limited time. The 覚 icon lights up when it is ready.' },
  { k: 'ULTIMATE', jp: '必殺', c: '#ff2e63', t: 'With enough Ki, Easy scheme: one button. Pro scheme: a motion plus H + S. A cinematic super with huge damage. Blocking it still hurts.' },
  { k: 'BEAM CLASH', jp: '激突', c: '#38ffd2', t: 'When two beams collide you are locked in a clash. Mash your attack buttons as fast as you can. Whoever mashes harder pushes the beam through.' },
  { k: 'EASY vs PRO', jp: '操作', c: '#ffb02e', t: 'Pro uses motion inputs like down, down-forward, forward + S for specials, with a little more damage. Easy turns them into direction + S, and gives a one-button Ultimate.' },
];

function cap(t: string, cls = ''): HTMLElement { return h('kbd', { class: cls }, t); }

export class HowToScreen extends BaseScreen {
  private tab = 0;
  private tabsEl: HTMLElement;
  private body: HTMLElement;
  constructor(app: AppApi) {
    super(app, '');
    this.el.classList.add('howto');
    this.tabsEl = h('div', { class: 'ht-tabs' });
    this.body = h('div', { class: 'ht-body' });
    TABS.forEach((t, i) => this.tabsEl.appendChild(h('button', { class: 'ht-tab', type: 'button', onclick: () => { this.tab = i; sfx('move'); this.render(); } }, t)));
    this.el.append(h('h2', { class: 'scr-head' }, h('span', null, 'HOW TO PLAY'), ' 遣い方'), this.tabsEl, this.body,
      h('div', { class: 'hint' }, '← → change tab    ↑ ↓ scroll    ESC / B back'));
  }
  enter(p?: { tab?: number }): void {
    this.tab = p?.tab ?? 0;
    this.render();
  }
  private render(): void {
    [...this.tabsEl.children].forEach((t, i) => t.classList.toggle('on', i === this.tab));
    this.body.scrollTop = 0;
    this.body.className = 'ht-body t' + this.tab;
    this.body.replaceChildren(...[this.keyboard(), this.gamepad(), this.touch(), this.systems()][this.tab]);
  }

  private keyboard(): HTMLElement[] {
    const col = (slot: 0 | 1) => {
      const b = this.app.input.getBindings(slot);
      const row = (a: Action) => h('div', { class: 'kr' }, h('span', null, ACTION_LABEL[a]), h('div', null, ...b[a].map((c) => cap(keyLabel(c)))));
      const dirs = h('div', { class: 'wasd' },
        h('div', { class: 'wu' }, cap(keyLabel(b.up[0]))),
        h('div', { class: 'wl' }, cap(keyLabel(b.left[0]))), h('div', { class: 'wd' }, cap(keyLabel(b.down[0]))), h('div', { class: 'wr' }, cap(keyLabel(b.right[0]))));
      return h('div', { class: 'ht-card' }, h('h3', null, `PLAYER ${slot + 1}`), dirs,
        ...(['L', 'H', 'K', 'S', 'Ult', 'Guard'] as Action[]).map(row));
    };
    void ACTIONS;
    return [
      h('div', { class: 'ht-cols' }, col(0), col(1),
        h('div', { class: 'ht-card combos' }, h('h3', null, 'COMBINATIONS'),
          h('div', { class: 'kr' }, h('span', null, 'Throw'), h('div', null, cap('L'), '+', cap('K'))),
          h('div', { class: 'kr' }, h('span', null, 'Vanish Step'), h('div', null, cap('H'), '+', cap('K'))),
          h('div', { class: 'kr' }, h('span', null, 'Awakening'), h('div', null, cap('L'), '+', cap('H'), '+', cap('K'))),
          h('div', { class: 'kr' }, h('span', null, 'Ki Charge'), h('div', null, 'Hold ', cap('S'))),
          h('div', { class: 'kr' }, h('span', null, 'Dash'), h('div', null, 'Double-tap →')),
          h('div', { class: 'kr' }, h('span', null, 'Pause'), h('div', null, cap('Esc'), cap('Enter'))),
          h('div', { class: 'kr' }, h('span', null, 'Training reset'), h('div', null, cap('R'))),
          h('div', { class: 'kr' }, h('span', null, 'Debug overlay'), h('div', null, cap('F1'))))),
      h('p', { class: 'ht-note' }, 'Directions are screen-relative: Up moves into the screen, Down out of it. Left + Right cancel out. Remap keys in Settings.'),
    ];
  }

  private gamepad(): HTMLElement[] {
    const svg = `
<svg viewBox="0 0 360 220" class="pad-svg">
  <path d="M70 40h220c30 0 50 40 56 100l6 50c3 20-20 30-36 14l-40-44H84l-40 44c-16 16-39 6-36-14l6-50c6-60 26-100 56-100z" class="pad-body"/>
  <rect x="86" y="24" width="50" height="14" rx="6" class="pad-bump"/><rect x="224" y="24" width="50" height="14" rx="6" class="pad-bump"/>
  <circle cx="108" cy="92" r="20" class="pad-stick"/><circle cx="108" cy="92" r="9" class="pad-knob"/>
  <path d="M168 128h14v-14h14v14h14v14h-14v14h-14v-14h-14z" class="pad-dpad" transform="translate(-28 -12)"/>
  <circle cx="276" cy="92" r="13" class="fb y"/><circle cx="276" cy="130" r="13" class="fb a"/><circle cx="257" cy="111" r="13" class="fb x"/><circle cx="295" cy="111" r="13" class="fb b"/>
  <text x="276" y="97" class="fl">H</text><text x="276" y="135" class="fl">K</text><text x="257" y="116" class="fl">L</text><text x="295" y="116" class="fl">S</text>
  <text x="111" y="20" class="pl">LB  GUARD</text><text x="249" y="20" class="pl">RB  ULTIMATE</text>
  <text x="108" y="130" class="pl">STICK / D-PAD  MOVE</text>
  <rect x="160" y="82" width="14" height="8" rx="3" class="pad-bump"/><rect x="186" y="82" width="14" height="8" rx="3" class="pad-bump"/>
</svg>`;
    const list = h('div', { class: 'ht-card' }, h('h3', null, 'GAMEPAD'),
      ...[
        ['X / □', 'Light (L)'], ['Y / △', 'Heavy (H)'], ['A / ✕', 'Kick (K)'], ['B / ○', 'Ki / Special (S)'],
        ['RB', 'Ultimate'], ['LB', 'Guard'], ['X + A', 'Throw'], ['Y + A', 'Vanish Step'], ['X + Y + A', 'Awakening'],
        ['Hold B', 'Ki Charge'], ['Start', 'Pause'], ['Select', 'Reset (training)'],
      ].map(([a, b]) => h('div', { class: 'kr' }, h('span', null, b), h('div', null, cap(a)))));
    return [h('div', { class: 'ht-cols pad' }, h('div', { class: 'ht-card padcard', html: svg }), list),
      h('p', { class: 'ht-note' }, 'Left stick has a 0.4 dead zone. With two pads, the first is Player 1. In Versus, if Player 1 is on keyboard, the first pad becomes Player 2.')];
  }

  private touch(): HTMLElement[] {
    const mock = h('div', { class: 'tmock' },
      h('div', { class: 'tm-stick' }, h('i', null), h('span', null, 'MOVE')),
      h('div', { class: 'tm-b l' }, 'L'), h('div', { class: 'tm-b hh' }, 'H'), h('div', { class: 'tm-b k' }, 'K'), h('div', { class: 'tm-b s' }, 'S'),
      h('div', { class: 'tm-s g' }, 'GRD'), h('div', { class: 'tm-s t' }, 'THR'), h('div', { class: 'tm-s v' }, 'VAN'), h('div', { class: 'tm-s u' }, 'ULT'), h('div', { class: 'tm-s a' }, '覚'));
    const list = h('div', { class: 'ht-card' }, h('h3', null, 'TOUCH'),
      ...[
        ['Left side', 'Drag anywhere: floating stick'], ['Swipe stick up / down', 'Sidestep'], ['Double-tap stick direction', 'Dash'],
        ['L H K S', 'Attacks (S = Ki / special)'], ['THR', 'Throw (L + K)'], ['VAN', 'Vanish Step (H + K)'], ['覚', 'Awakening, glows when ready'], ['ULT / GRD', 'Ultimate / Guard'],
      ].map(([a, b]) => h('div', { class: 'kr' }, h('span', null, b), h('div', null, a))));
    return [h('div', { class: 'ht-cols pad' }, mock, list),
      h('p', { class: 'ht-note' }, 'Multi-touch: hold the stick and tap buttons at the same time. Rotate to landscape. Toggle touch controls in Settings.')];
  }

  private systems(): HTMLElement[] {
    return [h('div', { class: 'ht-grid' }, ...SYSTEMS.map((s, i) =>
      h('div', { class: 'sys-card', style: `--c:${s.c};--i:${i}` }, h('div', { class: 'sys-jp' }, s.jp), h('h3', null, s.k), h('p', null, s.t))))];
  }

  onMenu(a: MenuAction): void {
    if (a === 'back' || a === 'confirm') { sfx('back'); this.app.ui.pop(); return; }
    if (a === 'left') { this.tab = (this.tab + TABS.length - 1) % TABS.length; sfx('move'); this.render(); }
    else if (a === 'right') { this.tab = (this.tab + 1) % TABS.length; sfx('move'); this.render(); }
    else if (a === 'up') this.body.scrollBy({ top: -100, behavior: 'smooth' });
    else if (a === 'down') this.body.scrollBy({ top: 100, behavior: 'smooth' });
  }
}
