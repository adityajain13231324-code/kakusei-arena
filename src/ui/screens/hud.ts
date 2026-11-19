import type { AppApi } from '../../app/api';
import { Btn } from '../../sim/types';
import type { CharId, GameState, SimEvent } from '../../sim/types';
import { DUMMY_LABEL, DUMMY_MODES } from '../../app/session';
import type { MatchSession } from '../../app/session';
import { h, sfx } from '../dom';
import { BaseScreen } from './base';
import { getChar } from '../../sim';
import { META, charName, fillPortrait, portraitEl, realmOfKind } from '../meta';
import { Broadcast } from '../broadcast';

function secsOf(t: number): number { return t > 99 ? Math.ceil(t / 60) : Math.max(0, Math.ceil(t)); }

interface SideEls {
  root: HTMLElement; fill: HTMLElement; trail: HTMLElement; name: HTMLElement; family: HTMLElement; scheme: HTMLElement;
  portrait: HTMLElement; pips: HTMLElement; ki: HTMLElement[]; kiFill: HTMLElement[]; kiBlock: HTMLElement; kiNum: HTMLElement;
  awk: HTMLElement; awkTxt: HTMLElement; combo: HTMLElement; comboHits: HTMLElement; comboDmg: HTMLElement; pct: HTMLElement;
  hp: HTMLElement; chip: HTMLElement; chipTxt: HTMLElement; inf: HTMLElement; soul: HTMLElement;
}

/** form id (FighterState.form) -> chip text + colour */
const FORMS: Record<string, { t: string; c: string }> = {
  six_eyes: { t: 'SIX EYES', c: '#7cc4ff' },
  sage: { t: 'SAGE MODE', c: '#ff9a2a' },
  kurama: { t: 'NINE-TAILS', c: '#ffd23f' },
  santoryu: { t: 'SANTORYU', c: '#4ae07a' },
  ittoryu: { t: 'ITTORYU', c: '#4ae07a' },
  nitoryu: { t: 'NITORYU', c: '#4ae07a' },
  gear2: { t: 'GEAR 2', c: '#ff7a5c' },
  gear4: { t: 'GEAR 4', c: '#ff3b3b' },
  gear5: { t: 'GEAR 5', c: '#ffffff' },
  titan: { t: 'TITAN', c: '#b8d96a' },
};
/** brush-stroke band behind the realm title (irregular ink edges) */
const INK = '<svg viewBox="0 0 800 140" preserveAspectRatio="none"><path d="M0 38 C60 22 120 44 190 30 S330 14 420 30 S590 20 680 32 S780 22 800 34 L792 60 C770 66 790 84 772 96 C700 108 640 94 560 108 S400 120 320 108 S170 124 100 108 S20 112 0 100 L8 70 C-6 60 6 48 0 38 Z" fill="currentColor"/><path d="M40 12 L180 18 L120 26 Z M600 126 L720 118 L690 132 Z" fill="currentColor"/></svg>';
const ICON_INF = '<svg viewBox="0 0 24 14"><path d="M12 7C10 4 8 2.5 6 2.5a4.5 4.5 0 0 0 0 9c2 0 4-1.5 6-4.5zm0 0c2 3 4 4.500 6 4.500a4.500 4.500 0 0 0 0-9c-2 0-4 1.500-6 4.500z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';

export class HudScreen extends BaseScreen {
  opaque = true;
  private sides: [SideEls, SideEls];
  private timer: HTMLElement;
  private roundLbl: HTMLElement;
  private callouts: HTMLElement;
  private clash: HTMLElement; private clashMark: HTMLElement; private clashP1: HTMLElement; private clashP2: HTMLElement; private clashT: HTMLElement;
  private realmTag: HTMLElement; private realmTagTxt: HTMLElement; private bars: HTMLElement; private lastClashKind = '';
  private hpShake: [number, number] = [0, 0];
  private session: MatchSession | null = null;
  private trail: [number, number] = [1, 1];
  private hold: [number, number] = [0, 0];
  private lastHp: [number, number] = [1, 1];
  private cache: Record<string, string | number> = {};
  private comboShow: { hits: number; dmg: number; hold: number }[] = [{ hits: 0, dmg: 0, hold: 0 }, { hits: 0, dmg: 0, hold: 0 }];
  private training: TrainingPanel;
  private chars: [CharId, CharId] = ['kaito', 'shiori'];
  private bc = new Broadcast();
  awakenReady = false;
  private realmChars: [boolean, boolean] = [false, false];

  constructor(app: AppApi) {
    super(app, '');
    this.el.classList.add('hud');
    const mk = (p: 0 | 1): SideEls => {
      const portrait = portraitEl('kaito', 'hud-portrait', 256);
      const name = h('b', { class: 'hn-given' }), family = h('span', { class: 'hn-family' });
      const scheme = h('i', { class: 'hn-scheme' });
      const fill = h('div', { class: 'hp-fill' }), trail = h('div', { class: 'hp-trail' });
      const pct = h('span', { class: 'hp-pct' }, '100');
      const pips = h('div', { class: 'pips' });
      const ki: HTMLElement[] = [], kiFill: HTMLElement[] = [];
      const kiWrap = h('div', { class: 'ki' });
      for (let i = 0; i < 3; i++) {
        const f = h('i', { class: 'ki-f' });
        const s = h('div', { class: 'ki-seg' }, f);
        kiWrap.appendChild(s); ki.push(s); kiFill.push(f);
      }
      const awkTxt = h('small', null, '');
      const awk = h('div', { class: 'awk', title: 'Awakening' }, h('b', null, '覚'), h('span', null, 'AWAKEN'), awkTxt);
      const kiNum = h('em', null, '0');
      const soul = h('div', { class: 'soul', title: 'Soul Realm ready' }, h('b', null, '魂'), h('span', null, 'SOUL REALM'));
      const kiBlock = h('div', { class: 'kiblock p' + (p + 1) },
        h('div', { class: 'ki-head' }, h('b', null, 'KI'), kiNum, awk), kiWrap, soul);
      const comboHits = h('b', null, ''), comboDmg = h('span', null, '');
      const combo = h('div', { class: 'combo' }, comboHits, comboDmg);
      const frame = h('div', { class: 'frame' }, portrait);
      const chipTxt = h('b', null, '');
      const chip = h('div', { class: 'fchip' }, h('i', null), chipTxt);
      const inf = h('div', { class: 'inf', title: 'Infinity ready', html: ICON_INF });
      const hpEl = h('div', { class: 'hp' }, h('div', { class: 'hp-bg' }), trail, fill, h('div', { class: 'hp-gloss' }), h('div', { class: 'hp-flash' }), pct);
      const root = h('div', { class: 'side p' + (p + 1) },
        frame,
        h('div', { class: 'col' },
          h('div', { class: 'who' }, h('div', { class: 'hn' }, name, family), scheme),
          hpEl,
          h('div', { class: 'sub' }, h('div', { class: 'fx-row' }, chip, inf), pips)));
      return { root, fill, trail, name, family, scheme, portrait, pips, ki, kiFill, kiBlock, kiNum, awk, awkTxt, combo, comboHits, comboDmg, pct, hp: hpEl, chip, chipTxt, inf, soul };
    };
    this.sides = [mk(0), mk(1)];
    this.timer = h('div', { class: 'timer' }, '60');
    this.roundLbl = h('div', { class: 'rnd' }, 'ROUND 1');
    const pauseBtn = h('button', { class: 'pause-btn', type: 'button', 'aria-label': 'Pause' }, h('i', null), h('i', null));
    for (const ev of ['pointerdown', 'touchstart', 'mousedown']) pauseBtn.addEventListener(ev, (e) => e.stopPropagation());
    pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); sfx('select'); app.pause(); });
    this.realmTagTxt = h('b', null, '');
    this.realmTag = h('div', { class: 'realm-tag' }, h('small', null, 'SOUL REALM'), this.realmTagTxt);
    this.bars = h('div', { class: 'letterbox' }, h('i', { class: 't' }), h('i', { class: 'b' }));
    const mid = h('div', { class: 'mid' }, h('div', { class: 'timer-frame' }, this.timer), this.roundLbl, this.realmTag, pauseBtn);
    this.callouts = h('div', { class: 'callouts' });
    this.clashMark = h('i', { class: 'clash-mark' });
    this.clashP1 = h('b', null, '0'); this.clashP2 = h('b', null, '0');
    this.clashT = h('div', { class: 'clash-t' }, 'CLASH! MASH!');
    this.clash = h('div', { class: 'clash' }, this.clashT,
      h('div', { class: 'clash-row' }, this.clashP1, h('div', { class: 'clash-bar' }, this.clashMark), this.clashP2));
    this.training = new TrainingPanel(app);
    this.el.append(this.bars, h('div', { class: 'hud-top' }, this.sides[0].root, mid, this.sides[1].root),
      this.sides[0].kiBlock, this.sides[1].kiBlock,
      this.sides[0].combo, this.sides[1].combo, this.callouts, this.clash, this.training.root,
      this.bc.panel, this.bc.ticker);
    this.sides[0].combo.classList.add('c1'); this.sides[1].combo.classList.add('c2');
    app.settings.onChange(() => this.bc.setMode(app.settings.data.broadcastMode));
    this.bc.setMode(app.settings.data.broadcastMode);
  }

  begin(session: MatchSession): void {
    this.session = session;
    const st = session.state;
    this.chars = [st.fighters[0].char, st.fighters[1].char];
    this.realmChars = [!!this.hasRealm(this.chars[0]), !!this.hasRealm(this.chars[1])];
    const cpu1 = session.mode === 'arcade';
    for (const p of [0, 1] as const) {
      const id = this.chars[p];
      const s = this.sides[p];
      fillPortrait(s.portrait, id, 256);
      s.root.style.setProperty('--c', META[id].color);
      s.kiBlock.style.setProperty('--c', META[id].color);
      s.name.textContent = META[id].given;
      s.family.textContent = charName(id).split(' ').slice(1).join(' ');
      const tag = session.mode === 'training' && p === 1 ? 'DUMMY' : cpu1 && p === 1 ? 'CPU' : st.schemes[p].toUpperCase();
      s.scheme.textContent = tag;
      s.scheme.className = 'hn-scheme ' + (tag === 'EASY' ? 'easy' : tag === 'PRO' ? 'pro' : 'cpu');
      s.pips.replaceChildren(...Array.from({ length: st.roundsToWin }, () => h('i', null)));
      s.combo.classList.remove('show');
    }
    this.trail = [1, 1]; this.hold = [0, 0]; this.lastHp = [1, 1];
    this.cache = {};
    this.comboShow.forEach((c) => { c.hits = 0; c.hold = 0; });
    this.callouts.replaceChildren();
    this.clash.classList.remove('on');
    this.el.classList.remove('realm-cine');
    this.realmTag.classList.remove('on');
    this.el.querySelectorAll('.realm-card').forEach((n) => n.remove());
    this.hpShake = [0, 0];
    this.el.classList.toggle('training', session.mode === 'training');
    this.training.begin(session);
    this.bc.setMode(this.app.settings.data.broadcastMode);
    this.bc.begin(this.chars, session.mode);
  }

  private hasRealm(id: CharId): boolean { try { return !!getChar(id).realmId; } catch { return false; } }

  private set(key: string, el: HTMLElement, v: string | number, prop: 'text' | 'scale' | 'class', cls?: string): void {
    if (this.cache[key] === v) return;
    this.cache[key] = v;
    if (prop === 'text') el.textContent = String(v);
    else if (prop === 'scale') el.style.transform = `scaleX(${v})`;
    else if (cls) el.classList.toggle(cls, !!v);
  }

  /** per render frame */
  refresh(dt: number, st: GameState, session: MatchSession): void {
    const r = st.round;
    this.set('timer', this.timer, session.mode === 'training' || st.training ? '∞' : String(secsOf(r.timer)), 'text');
    this.set('timerlow', this.timer, session.mode !== 'training' && !st.training && secsOf(r.timer) <= 10 && r.phase === 'fight' ? 1 : 0, 'class', 'low');
    this.set('rnd', this.roundLbl, session.mode === 'training' ? 'TRAINING' : `ROUND ${r.number}`, 'text');
    let ready = false;
    for (const p of [0, 1] as const) {
      const f = st.fighters[p];
      const s = this.sides[p];
      const k = 'p' + p;
      const hp = Math.max(0, f.hp / f.maxHp);
      const target = Math.max(hp, Math.min(1, f.redHp / f.maxHp));
      // delayed trail
      if (hp < this.lastHp[p] - 0.0005) this.hold[p] = 0.55;
      if (hp < this.lastHp[p] - 0.07 && this.hpShake[p] <= 0) {
        // big hit: shake + flash the bar (restart the CSS animation)
        s.hp.classList.remove('shake'); void s.hp.offsetWidth; s.hp.classList.add('shake');
        this.hpShake[p] = 0.3;
      }
      if (this.hpShake[p] > 0) this.hpShake[p] -= dt;
      this.lastHp[p] = hp;
      if (target >= this.trail[p]) this.trail[p] = target;
      else if (this.hold[p] > 0) this.hold[p] -= dt;
      else this.trail[p] = Math.max(target, this.trail[p] - dt * 0.7);
      this.set(k + 'hp', s.fill, Math.round(hp * 1000) / 1000, 'scale');
      this.set(k + 'tr', s.trail, Math.round(this.trail[p] * 1000) / 1000, 'scale');
      this.set(k + 'pct', s.pct, String(Math.ceil(hp * 100)), 'text');
      this.set(k + 'low', s.root, hp < 0.35 ? 1 : 0, 'class', 'danger');
      for (let i = 0; i < 3; i++) {
        const frac = Math.min(1, Math.max(0, (f.ki - i * 100) / 100));
        this.set(k + 'ki' + i, s.kiFill[i], Math.round(frac * 50) / 50, 'scale');
        this.set(k + 'kif' + i, s.ki[i], frac >= 1 ? 1 : 0, 'class', 'full');
      }
      this.set(k + 'kin', s.kiNum, String(Math.min(3, Math.floor(f.ki / 100))), 'text');
      this.set(k + 'kiall', s.kiBlock, f.ki >= 300 ? 1 : 0, 'class', 'kimax');
      const awkReady = hp * 100 < 35 && !f.awakenUsed && !f.awakened && f.hp > 0;
      if (p === 0 && awkReady) ready = true;
      this.set(k + 'awr', s.awk, awkReady ? 1 : 0, 'class', 'ready');
      this.set(k + 'awa', s.awk, f.awakened ? 1 : 0, 'class', 'active');
      this.set(k + 'awu', s.awk, f.awakenUsed && !f.awakened ? 1 : 0, 'class', 'used');
      this.set(k + 'awt', s.awkTxt, f.awakened ? Math.ceil(f.awakenTimer / 60) + 's' : '', 'text');
      // ---- crossover: form chip, Infinity shimmer, Soul Realm ready glow
      let form = f.form ?? '';
      let fm = FORMS[form];
      if (!fm && f.awakened && f.char === 'zoro') fm = { t: 'ASURA', c: '#ff4a2e' };
      let label = fm ? fm.t : '';
      if (fm && f.char === 'zoro' && f.awakened && form) label += ' · ASURA';
      if (form === 'titan' && f.sim?.formTimer) label += ' ' + Math.ceil(f.sim.formTimer / 60) + 's';
      this.set(k + 'chipv', s.chip, label ? 1 : 0, 'class', 'show');
      if (label) {
        this.set(k + 'chipt', s.chipTxt, label, 'text');
        if (this.cache[k + 'chipc'] !== fm!.c) { this.cache[k + 'chipc'] = fm!.c; s.chip.style.setProperty('--fc', fm!.c); }
        if (this.cache[k + 'chipf'] !== form) { this.cache[k + 'chipf'] = form; s.chip.classList.remove('pop'); void s.chip.offsetWidth; s.chip.classList.add('pop'); }
      }
      this.set(k + 'inf', s.inf, f.char === 'gojo' && (f.infinity ?? 0) > 0 && f.hp > 0 ? 1 : 0, 'class', 'on');
      const hasRealm = !!this.realmChars[p];
      const soulReady = hasRealm && f.awakened && f.ki >= 300 && !f.sim?.realmUsed && !st.realm;
      this.set(k + 'soul', s.soul, soulReady ? 1 : 0, 'class', 'on');
      this.set(k + 'soulk', s.kiBlock, soulReady ? 1 : 0, 'class', 'soulready');
      // pips
      for (let i = 0; i < s.pips.children.length; i++) {
        (s.pips.children[i] as HTMLElement).classList.toggle('on', i < f.wins);
      }
      // combo (attacker is the other player)
      const def = st.fighters[1 - p as 0 | 1];
      const cs = this.comboShow[p];
      if (def.comboHits >= 2) { cs.hits = def.comboHits; cs.dmg = def.comboDamage; cs.hold = 1.1; }
      else if (cs.hold > 0) cs.hold -= dt;
      const showC = def.comboHits >= 2 || cs.hold > 0;
      this.set(k + 'cs', s.combo, showC ? 1 : 0, 'class', 'show');
      if (showC) {
        this.set(k + 'ch', s.comboHits, `${cs.hits} HITS`, 'text');
        this.set(k + 'cd', s.comboDmg, `${Math.round(cs.dmg)} DMG`, 'text');
      }
    }
    this.awakenReady = ready;
    // clash
    const c = st.clash;
    this.set('clash', this.clash, c.active ? 1 : 0, 'class', 'on');
    const ck = c.active ? (c.kind === 'realm' ? 'realm' : 'beam') : '';
    if (ck && ck !== this.lastClashKind) {
      this.lastClashKind = ck;
      this.clashT.textContent = ck === 'realm' ? 'REALM CLASH! MASH!' : 'CLASH! MASH!';
      this.clash.classList.toggle('realm', ck === 'realm');
    } else if (!ck) this.lastClashKind = '';
    if (c.active) {
      this.clashMark.style.left = `${Math.min(100, Math.max(0, (c.balance + 1000) / 20))}%`;
      this.set('cm0', this.clashP1, c.mash[0], 'text');
      this.set('cm1', this.clashP2, c.mash[1], 'text');
    }
    // realm: letterbox bars during the cinematic, small tag with the countdown while the rule twist runs
    const rl = st.realm ?? null;
    this.set('rcine', this.el, rl && rl.phase === 'cine' ? 1 : 0, 'class', 'realm-cine');
    this.set('rtag', this.realmTag, rl && rl.phase === 'active' ? 1 : 0, 'class', 'on');
    if (rl) {
      const rm = realmOfKind(rl.kind);
      if (rm) {
        this.realmTag.style.setProperty('--rc', rm.color);
        this.set('rtagn', this.realmTagTxt, rl.phase === 'active' ? `${rm.name}  ${Math.max(0, Math.ceil((rl.duration - rl.frame) / 60))}s` : rm.name, 'text');
      }
    }
    this.training.update(session);
    this.bc.update(dt, st);
  }

  /** big brush-ink realm title card: "DOMAIN EXPANSION - INFINITE VOID" */
  realmCard(kind: string, owner: 0 | 1): void {
    const rm = realmOfKind(kind);
    if (!rm) return;
    this.el.querySelectorAll('.realm-card').forEach((n) => n.remove());
    const card = h('div', { class: 'realm-card r' + (owner + 1), style: `--rc:${rm.color}` },
      h('div', { class: 'rc-jp' }, rm.jp),
      h('div', { class: 'rc-ink', html: INK }),
      h('div', { class: 'rc-txt' }, h('small', null, rm.kicker), h('b', null, rm.name), h('em', null, charName(this.chars[owner]).toUpperCase())));
    this.el.appendChild(card);
    card.addEventListener('animationend', (e) => { if ((e.target as HTMLElement) === card && (e as AnimationEvent).animationName === 'rc-life') card.remove(); });
    window.setTimeout(() => card.remove(), 4200);
  }

  // ------------------------------------------------------------ callouts
  callout(text: string, cls = '', color?: string): void {
    const el = h('div', { class: 'callout ' + cls, style: color ? `--c:${color}` : '' }, h('span', null, text));
    this.callouts.appendChild(el);
    el.addEventListener('animationend', (e) => { if ((e as AnimationEvent).animationName.startsWith('co-')) el.remove(); });
    window.setTimeout(() => el.remove(), 3200);
    while (this.callouts.children.length > 5) this.callouts.firstElementChild?.remove();
  }

  handleEvents(events: SimEvent[], st: GameState): void {
    this.bc.onEvents(events, st);
    for (const e of events) {
      switch (e.type) {
        case 'roundStart': {
          const fin = st.roundsToWin > 1 && st.fighters[0].wins === st.roundsToWin - 1 && st.fighters[1].wins === st.roundsToWin - 1;
          this.callout(st.training ? 'TRAINING' : fin ? 'FINAL ROUND' : `ROUND ${st.round.number}`, 'big round');
          break;
        }
        case 'fight': this.callout('FIGHT!', 'big fight'); break;
        case 'counter': this.callout('COUNTER!', 'mini counter ' + (e.target === 0 ? 'l' : 'r')); break;
        case 'guardCrush': this.callout('GUARD CRUSH!', 'mini guardcrush ' + (e.target === 0 ? 'l' : 'r')); break;
        case 'ko': {
          const dbl = st.fighters[0].hp <= 0 && st.fighters[1].hp <= 0;
          this.callout(dbl ? 'DOUBLE K.O.' : 'K.O.', 'big ko');
          break;
        }
        case 'timeout': this.callout('TIME', 'big time'); break;
        case 'roundEnd': {
          const w = st.round.winner;
          if (w === 0 || w === 1) {
            const f = st.fighters[w];
            if (f.hp >= f.maxHp) this.callout('PERFECT', 'big perfect');
          }
          break;
        }
        case 'awaken': this.callout('AWAKENING!', 'big awaken', e.charId ? META[e.charId].color : META[st.fighters[e.player].char].color); break;
        case 'ultimateStart': this.callout('ULTIMATE', 'mini ultimate ' + (e.player === 0 ? 'l' : 'r'), META[st.fighters[e.player].char].color); break;
        case 'clashStart': this.callout(e.tag === 'realm' ? 'REALM CLASH!' : 'CLASH! MASH!', 'big clash' + (e.tag === 'realm' ? ' realm' : '')); break;
        case 'realmStart': this.realmCard(e.tag ?? '', e.player); break;
        case 'infinityBlock': this.callout(e.tag === 'infinity' ? 'INFINITY' : 'SIX EYES', 'mini infinity ' + (e.player === 0 ? 'l' : 'r'), '#7cc4ff'); break;
        case 'formChange': {
          const fm = FORMS[e.tag ?? ''];
          if (fm && e.tag !== 'santoryu' && e.tag !== 'ittoryu' && e.tag !== 'nitoryu') this.callout(fm.t + '!', 'big form', fm.c);
          break;
        }
        default: break;
      }
    }
  }
}

// ======================================================================== training panel
const GLYPH: Record<number, string> = {
  [Btn.Up]: '↑', [Btn.Down]: '↓', [Btn.Left]: '←', [Btn.Right]: '→',
  [Btn.Up | Btn.Left]: '↖', [Btn.Up | Btn.Right]: '↗', [Btn.Down | Btn.Left]: '↙', [Btn.Down | Btn.Right]: '↘',
};
const DIRMASK = Btn.Up | Btn.Down | Btn.Left | Btn.Right;

class TrainingPanel {
  readonly root: HTMLElement;
  private session: MatchSession | null = null;
  private dummyVal: HTMLElement; private hbtn: HTMLElement; private kbtn: HTMLElement;
  private fd: HTMLElement; private hist: HTMLElement;
  private seq = -1; private hv = -1;
  private body: HTMLElement;

  constructor(private app: AppApi) {
    this.dummyVal = h('b', null, 'Stand');
    const arrow = (d: -1 | 1, t: string) => h('button', { class: 'tp-arrow', type: 'button', onclick: () => this.cycle(d) }, t);
    this.hbtn = h('button', { class: 'tp-toggle', type: 'button', onclick: () => this.toggleBoxes() }, 'Hitboxes');
    this.kbtn = h('button', { class: 'tp-toggle', type: 'button', onclick: () => this.toggleKi() }, 'Infinite Ki');
    this.fd = h('div', { class: 'tp-fd' });
    this.hist = h('div', { class: 'tp-hist' });
    this.body = h('div', { class: 'tp-body' },
      h('div', { class: 'tp-row' }, h('small', null, 'DUMMY'), arrow(-1, '◀'), this.dummyVal, arrow(1, '▶')),
      h('div', { class: 'tp-row two' }, this.hbtn, this.kbtn),
      h('button', { class: 'tp-reset', type: 'button', onclick: () => this.reset() }, 'RESET POSITIONS  [R]'),
      h('div', { class: 'tp-title' }, 'FRAME DATA'), this.fd);
    const collapse = h('button', { class: 'tp-collapse', type: 'button', onclick: () => this.root.classList.toggle('closed') }, '☰ TRAINING');
    this.root = h('div', { class: 'tpanel' }, collapse, this.body);
    this.root.append(h('div', { class: 'tp-input' }, h('div', { class: 'tp-title' }, 'INPUT'), this.hist));
  }

  begin(s: MatchSession): void {
    this.session = s; this.seq = -1; this.hv = -1;
    // on touch screens the open panel sits under the action buttons: start collapsed (the TRAINING tab re-opens it)
    let coarse = false;
    try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch { /* ignore */ }
    this.root.classList.toggle('closed', coarse && window.innerWidth < 1100);
    this.refreshLabels();
  }
  cycle(d: -1 | 1): void {
    const s = this.session; if (!s) return;
    const i = DUMMY_MODES.indexOf(s.dummy);
    s.dummy = DUMMY_MODES[(i + d + DUMMY_MODES.length) % DUMMY_MODES.length];
    sfx('move'); this.refreshLabels();
  }
  toggleBoxes(): void { const s = this.session; if (!s) return; s.showHitboxes = !s.showHitboxes; sfx('select'); this.refreshLabels(); }
  toggleKi(): void { const s = this.session; if (!s) return; s.infiniteKi = !s.infiniteKi; sfx('select'); this.refreshLabels(); }
  reset(): void { try { this.session?.reset(); this.app.vfx?.clear(); sfx('select'); } catch { /* sim not ready */ } }
  refreshLabels(): void {
    const s = this.session; if (!s) return;
    this.dummyVal.textContent = DUMMY_LABEL[s.dummy];
    this.hbtn.classList.toggle('on', s.showHitboxes);
    this.kbtn.classList.toggle('on', s.infiniteKi);
  }

  update(s: MatchSession): void {
    if (s.mode !== 'training') return;
    // F2 / pause-menu toggles change the session directly: keep the panel buttons in sync
    if (this.hbtn.classList.contains('on') !== s.showHitboxes || this.kbtn.classList.contains('on') !== s.infiniteKi || this.dummyVal.textContent !== DUMMY_LABEL[s.dummy]) this.refreshLabels();
    const f = s.frame;
    if (f.seq !== this.seq) {
      this.seq = f.seq;
      const adv = (n: number | null) => (n === null ? '-' : (n > 0 ? '+' : '') + n);
      const cls = (n: number | null) => (n === null ? '' : n >= 0 ? 'pos' : 'neg');
      this.fd.replaceChildren(
        h('div', { class: 'fd-name' }, f.moveName),
        h('div', { class: 'fd-grid' },
          h('span', null, 'Startup'), h('b', null, f.moveName === '-' ? '-' : `${f.startup}f`),
          h('span', null, 'Active / Rec'), h('b', null, f.moveName === '-' ? '-' : `${f.active} / ${f.recovery}`),
          h('span', null, 'Damage'), h('b', null, f.moveName === '-' ? '-' : `${f.damage}`),
          h('span', null, 'On block*'), h('b', { class: cls(f.dataOnBlock) }, adv(f.dataOnBlock)),
          h('span', null, 'On hit*'), h('b', { class: cls(f.dataOnHit) }, adv(f.dataOnHit)),
          h('span', null, 'Last contact'), h('b', { class: cls(f.lastAdv) }, f.lastAdv === null ? '-' : `${adv(f.lastAdv)} ${f.lastKind}`)));
    }
    if (s.histVersion !== this.hv) {
      this.hv = s.histVersion;
      this.hist.replaceChildren(...s.hist.slice(0, 12).map((e) => this.row(e.bits, e.n)));
    } else if (s.hist[0] && this.hist.firstElementChild) {
      const c = this.hist.firstElementChild.querySelector('.n');
      if (c && c.textContent !== String(s.hist[0].n)) c.textContent = String(s.hist[0].n);
    }
  }
  private row(bits: number, n: number): HTMLElement {
    const d = bits & DIRMASK;
    const r = h('div', { class: 'ir' }, h('span', { class: 'dir' }, d ? GLYPH[d] ?? '•' : '·'));
    const btn = (bit: number, t: string, c: string) => { if (bits & bit) r.appendChild(h('i', { class: 'bt ' + c }, t)); };
    btn(Btn.L, 'L', 'l'); btn(Btn.H, 'H', 'h'); btn(Btn.K, 'K', 'k'); btn(Btn.S, 'S', 's'); btn(Btn.Guard, 'G', 'g'); btn(Btn.Ult, 'U', 'u');
    r.appendChild(h('span', { class: 'n' }, String(n)));
    return r;
  }
}
