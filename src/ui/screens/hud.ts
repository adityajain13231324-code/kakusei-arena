import type { AppApi } from '../../app/api';
import { Btn } from '../../sim/types';
import type { CharId, GameState, SimEvent } from '../../sim/types';
import { DUMMY_LABEL, DUMMY_MODES } from '../../app/session';
import type { MatchSession } from '../../app/session';
import { h, sfx } from '../dom';
import { BaseScreen } from './base';
import { META, charName, fillPortrait, portraitEl } from '../meta';

function secsOf(t: number): number { return t > 99 ? Math.ceil(t / 60) : Math.max(0, Math.ceil(t)); }

interface SideEls {
  root: HTMLElement; fill: HTMLElement; trail: HTMLElement; name: HTMLElement; family: HTMLElement; scheme: HTMLElement;
  portrait: HTMLElement; pips: HTMLElement; ki: HTMLElement[]; kiFill: HTMLElement[]; awk: HTMLElement; awkTxt: HTMLElement; combo: HTMLElement;
  comboHits: HTMLElement; comboDmg: HTMLElement;
}

export class HudScreen extends BaseScreen {
  opaque = true;
  private sides: [SideEls, SideEls];
  private timer: HTMLElement;
  private roundLbl: HTMLElement;
  private callouts: HTMLElement;
  private clash: HTMLElement; private clashMark: HTMLElement; private clashP1: HTMLElement; private clashP2: HTMLElement;
  private session: MatchSession | null = null;
  private trail: [number, number] = [1, 1];
  private hold: [number, number] = [0, 0];
  private lastHp: [number, number] = [1, 1];
  private cache: Record<string, string | number> = {};
  private comboShow: { hits: number; dmg: number; hold: number }[] = [{ hits: 0, dmg: 0, hold: 0 }, { hits: 0, dmg: 0, hold: 0 }];
  private training: TrainingPanel;
  private chars: [CharId, CharId] = ['kaito', 'shiori'];
  awakenReady = false;

  constructor(app: AppApi) {
    super(app, '');
    this.el.classList.add('hud');
    const mk = (p: 0 | 1): SideEls => {
      const portrait = portraitEl('kaito', 'hud-portrait', 256);
      const name = h('b', { class: 'hn-given' }), family = h('span', { class: 'hn-family' });
      const scheme = h('i', { class: 'hn-scheme' });
      const fill = h('div', { class: 'hp-fill' }), trail = h('div', { class: 'hp-trail' });
      const pips = h('div', { class: 'pips' });
      const ki: HTMLElement[] = [], kiFill: HTMLElement[] = [];
      const kiWrap = h('div', { class: 'ki' });
      for (let i = 0; i < 3; i++) {
        const f = h('i', { class: 'ki-f' });
        const s = h('div', { class: 'ki-seg' }, f);
        kiWrap.appendChild(s); ki.push(s); kiFill.push(f);
      }
      const awkTxt = h('small', null, '');
      const awk = h('div', { class: 'awk', title: 'Awakening' }, h('b', null, '覚'), awkTxt);
      const comboHits = h('b', null, ''), comboDmg = h('span', null, '');
      const combo = h('div', { class: 'combo' }, comboHits, comboDmg);
      const root = h('div', { class: 'side p' + (p + 1) },
        h('div', { class: 'who' }, portrait, h('div', { class: 'hn' }, name, family), scheme),
        h('div', { class: 'hp' }, h('div', { class: 'hp-bg' }), trail, fill, h('div', { class: 'hp-gloss' })),
        h('div', { class: 'sub' }, pips, kiWrap, awk));
      return { root, fill, trail, name, family, scheme, portrait, pips, ki, kiFill, awk, awkTxt, combo, comboHits, comboDmg };
    };
    this.sides = [mk(0), mk(1)];
    this.timer = h('div', { class: 'timer' }, '60');
    this.roundLbl = h('div', { class: 'rnd' }, 'ROUND 1');
    const mid = h('div', { class: 'mid' }, h('div', { class: 'timer-frame' }, this.timer), this.roundLbl);
    this.callouts = h('div', { class: 'callouts' });
    this.clashMark = h('i', { class: 'clash-mark' });
    this.clashP1 = h('b', null, '0'); this.clashP2 = h('b', null, '0');
    this.clash = h('div', { class: 'clash' }, h('div', { class: 'clash-t' }, 'CLASH! MASH!'),
      h('div', { class: 'clash-row' }, this.clashP1, h('div', { class: 'clash-bar' }, this.clashMark), this.clashP2));
    this.training = new TrainingPanel(app);
    this.el.append(h('div', { class: 'hud-top' }, this.sides[0].root, mid, this.sides[1].root),
      this.sides[0].combo, this.sides[1].combo, this.callouts, this.clash, this.training.root);
    this.sides[0].combo.classList.add('c1'); this.sides[1].combo.classList.add('c2');
  }

  begin(session: MatchSession): void {
    this.session = session;
    const st = session.state;
    this.chars = [st.fighters[0].char, st.fighters[1].char];
    const cpu1 = session.mode === 'arcade';
    for (const p of [0, 1] as const) {
      const id = this.chars[p];
      const s = this.sides[p];
      fillPortrait(s.portrait, id, 256);
      s.root.style.setProperty('--c', META[id].color);
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
    this.el.classList.toggle('training', session.mode === 'training');
    this.training.begin(session);
  }

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
      this.lastHp[p] = hp;
      if (target >= this.trail[p]) this.trail[p] = target;
      else if (this.hold[p] > 0) this.hold[p] -= dt;
      else this.trail[p] = Math.max(target, this.trail[p] - dt * 0.7);
      this.set(k + 'hp', s.fill, Math.round(hp * 1000) / 1000, 'scale');
      this.set(k + 'tr', s.trail, Math.round(this.trail[p] * 1000) / 1000, 'scale');
      this.set(k + 'low', s.root, hp < 0.35 ? 1 : 0, 'class', 'danger');
      for (let i = 0; i < 3; i++) {
        const frac = Math.min(1, Math.max(0, (f.ki - i * 100) / 100));
        this.set(k + 'ki' + i, s.kiFill[i], Math.round(frac * 50) / 50, 'scale');
        this.set(k + 'kif' + i, s.ki[i], frac >= 1 ? 1 : 0, 'class', 'full');
      }
      this.set(k + 'kiall', s.root, f.ki >= 300 ? 1 : 0, 'class', 'kimax');
      const awkReady = hp * 100 < 35 && !f.awakenUsed && !f.awakened && f.hp > 0;
      if (p === 0 && awkReady) ready = true;
      this.set(k + 'awr', s.awk, awkReady ? 1 : 0, 'class', 'ready');
      this.set(k + 'awa', s.awk, f.awakened ? 1 : 0, 'class', 'active');
      this.set(k + 'awu', s.awk, f.awakenUsed && !f.awakened ? 1 : 0, 'class', 'used');
      this.set(k + 'awt', s.awkTxt, f.awakened ? Math.ceil(f.awakenTimer / 60) + 's' : '', 'text');
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
    if (c.active) {
      this.clashMark.style.left = `${Math.min(100, Math.max(0, (c.balance + 1000) / 20))}%`;
      this.set('cm0', this.clashP1, c.mash[0], 'text');
      this.set('cm1', this.clashP2, c.mash[1], 'text');
    }
    this.training.update(session);
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
    for (const e of events) {
      switch (e.type) {
        case 'roundStart': {
          const fin = st.roundsToWin > 1 && st.fighters[0].wins === st.roundsToWin - 1 && st.fighters[1].wins === st.roundsToWin - 1;
          this.callout(st.training ? 'TRAINING' : fin ? 'FINAL ROUND' : `ROUND ${st.round.number}`, 'big round');
          break;
        }
        case 'fight': this.callout('FIGHT!', 'big fight'); break;
        case 'counter': this.callout('COUNTER!', 'mini counter ' + (e.target === 0 ? 'l' : 'r')); break;
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
        case 'clashStart': this.callout('CLASH! MASH!', 'big clash'); break;
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
    this.root.classList.toggle('closed', window.innerWidth < 700 && false);
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
