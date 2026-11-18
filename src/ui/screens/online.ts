// Online screens: room menu (create / join) and the room lobby (share link, character pick, ready, stage).
import type { AppApi } from '../../app/api';
import type { MenuAction } from '../../input';
import { ALL_CHARS } from '../../sim/types';
import type { CharId, StageId } from '../../sim/types';
import { ONLINE_STAGES } from '../../net/online';
import type { LobbySide } from '../../net/online';
import { normalizeRoomCode } from '../../net/protocol';
import { qualityBars } from '../../net/overlay';
import { h, sfx } from '../dom';
import { BaseScreen, mbtn } from './base';
import { META, STAGES, charName, charTitle, portraitEl, refreshPortraits } from '../meta';

// ------------------------------------------------------------------ online menu
export class OnlineMenuScreen extends BaseScreen {
  private input: HTMLInputElement;
  private err: HTMLElement;
  constructor(app: AppApi) {
    super(app, '');
    this.el.classList.add('online-menu');
    this.input = h('input', {
      class: 'on-code-in', type: 'text', maxlength: '40', placeholder: 'ROOM CODE', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
      'aria-label': 'Room code',
    }) as HTMLInputElement;
    this.input.addEventListener('input', () => { this.input.value = this.input.value.toUpperCase(); this.err.textContent = ''; });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.join();
      if (e.key === 'Escape') this.input.blur();
    });
    this.err = h('div', { class: 'on-err' });
    const create = mbtn('CREATE ROOM', '部屋を作る');
    const joinBtn = mbtn('JOIN ROOM', '参加');
    const back = mbtn('BACK', '戻る');
    this.el.append(
      h('h2', { class: 'scr-head' }, h('span', null, 'ONLINE'), ' 1 VS 1'),
      h('div', { class: 'on-card' },
        h('p', { class: 'on-lead' }, 'Fight a friend over the internet. Create a room and send them the link, or enter their 6-letter room code.'),
        h('div', { class: 'menu-list on-list' }, create,
          h('div', { class: 'on-join' }, this.input, joinBtn),
          back),
        this.err,
        h('p', { class: 'on-note' }, 'Peer-to-peer with rollback netcode. Best on Wi-Fi or wired, same region.')),
      h('div', { class: 'hint' }, '↑ ↓ choose    ENTER / A confirm    ESC / B back'),
    );
    this.nav.setItems([create, this.input, joinBtn, back]);
    this.nav.onActivate = (i) => {
      if (i === 0) { this.app.online.create(); this.app.ui.go('onlinelobby'); }
      else if (i === 1) this.input.focus();
      else if (i === 2) this.join();
      else this.app.goMenu();
    };
    this.nav.onFocus = (i) => { if (i === 1) this.input.focus(); else this.input.blur(); };
  }
  private join(): void {
    const code = normalizeRoomCode(this.input.value);
    if (!code) { this.err.textContent = 'Enter the 6-character room code (letters and numbers).'; sfx('error'); return; }
    sfx('select');
    this.input.blur();
    this.app.online.join(code);
    this.app.ui.go('onlinelobby');
  }
  enter(): void {
    this.err.textContent = '';
    this.app.menuScene([...ALL_CHARS]);
    this.nav.focus(0, true);
  }
  onMenu(a: MenuAction): void {
    if (a === 'back') { sfx('back'); this.app.goMenu(); return; }
    this.nav.handle(a);
  }
}

// ------------------------------------------------------------------ lobby
const PICKS: (CharId | 'random')[] = [...ALL_CHARS, 'random'];

export class OnlineLobbyScreen extends BaseScreen {
  private off: (() => void) | null = null;
  private status: HTMLElement;
  private share: HTMLElement;
  private codeEl: HTMLElement;
  private linkEl: HTMLInputElement;
  private copyBtn: HTMLButtonElement;
  private you: HTMLElement;
  private rival: HTMLElement;
  private strip: HTMLElement;
  private cards: HTMLElement[] = [];
  private stageRow: HTMLElement;
  private stageBtns: HTMLElement[] = [];
  private readyBtn: HTMLButtonElement;
  private startBtn: HTMLButtonElement;
  private schemeBtn: HTMLButtonElement;
  private pingEl: HTMLElement;
  private cursor = 0;
  private lastPreview = '';

  constructor(app: AppApi) {
    super(app, '');
    this.el.classList.add('online-lobby');
    const ctl = app.online;
    this.status = h('div', { class: 'on-status' });
    this.codeEl = h('b', { class: 'on-code' }, '------');
    this.linkEl = h('input', { class: 'on-link', type: 'text', readonly: 'true', 'aria-label': 'Share link' }) as HTMLInputElement;
    this.linkEl.addEventListener('focus', () => this.linkEl.select());
    this.copyBtn = h('button', { class: 'on-btn', type: 'button', onclick: () => this.copy() }, 'COPY LINK') as HTMLButtonElement;
    const wa = h('button', { class: 'on-btn wa', type: 'button', onclick: () => this.whatsapp() }, 'WHATSAPP');
    this.share = h('div', { class: 'on-share' },
      h('div', { class: 'on-code-wrap' }, h('small', null, 'ROOM CODE'), this.codeEl),
      h('div', { class: 'on-share-row' }, this.linkEl, this.copyBtn, wa));
    this.you = h('div', { class: 'on-pl you' });
    this.rival = h('div', { class: 'on-pl rival' });
    this.strip = h('div', { class: 'on-strip' });
    PICKS.forEach((id, i) => {
      const c = h('button', { class: 'cs-card on-card-c' + (id === 'random' ? ' random' : ''), type: 'button', style: `--c:${id === 'random' ? '#fff' : META[id].color}` });
      if (id === 'random') c.append(h('div', { class: 'portrait rnd' }, h('span', { class: 'kanji' }, '?')));
      else c.append(portraitEl(id, '', 256));
      c.append(h('div', { class: 'cs-name' }, id === 'random' ? 'RANDOM' : META[id].given));
      c.addEventListener('click', () => { this.cursor = i; ctl.setChar(id); sfx('move'); });
      this.strip.appendChild(c);
      this.cards.push(c);
    });
    this.stageRow = h('div', { class: 'on-stages' });
    ONLINE_STAGES.forEach((s) => {
      const meta = STAGES.find((m) => m.id === s);
      const b = h('button', { class: 'on-stage', type: 'button', onclick: () => { ctl.setStage(s); sfx('move'); } }, meta ? meta.name : 'RANDOM');
      this.stageRow.appendChild(b);
      this.stageBtns.push(b);
    });
    this.schemeBtn = h('button', { class: 'on-btn', type: 'button', onclick: () => { ctl.toggleScheme(); sfx('move'); } }) as HTMLButtonElement;
    this.readyBtn = h('button', { class: 'on-btn big ready', type: 'button', onclick: () => { ctl.toggleReady(); sfx('select'); } }, 'READY') as HTMLButtonElement;
    this.startBtn = h('button', { class: 'on-btn big start', type: 'button', onclick: () => this.start() }, 'START MATCH') as HTMLButtonElement;
    const leave = h('button', { class: 'on-btn leave', type: 'button', onclick: () => { sfx('back'); ctl.leave(); } }, 'LEAVE');
    this.pingEl = h('div', { class: 'on-ping' });
    this.el.append(
      h('h2', { class: 'scr-head' }, h('span', null, 'ONLINE'), ' ROOM'),
      this.share, this.status,
      h('div', { class: 'on-players' }, this.you, h('div', { class: 'on-vs' }, 'VS'), this.rival),
      this.strip,
      h('div', { class: 'on-bottom' },
        h('div', { class: 'on-stage-wrap' }, h('small', null, 'STAGE'), this.stageRow),
        h('div', { class: 'on-actions' }, this.schemeBtn, this.readyBtn, this.startBtn, leave)),
      this.pingEl,
      h('div', { class: 'hint' }, '← → fighter    ↑ EASY/PRO    ENTER ready / start    ↓ stage (host)    ESC leave'),
    );
  }

  enter(): void {
    this.off?.();
    this.off = this.app.online.subscribe(() => this.render());
    const c = this.app.online.me.char;
    this.cursor = Math.max(0, PICKS.indexOf(c));
    refreshPortraits();
    this.render();
  }
  exit(): void { this.off?.(); this.off = null; }

  private start(): void {
    const ctl = this.app.online;
    if (!ctl.canStart) { sfx('error'); return; }
    sfx('start');
    ctl.start();
  }
  private async copy(): Promise<void> {
    const link = this.app.online.link;
    if (!link) return;
    let ok = false;
    try { await navigator.clipboard.writeText(link); ok = true; } catch {
      this.linkEl.focus(); this.linkEl.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
    }
    this.copyBtn.textContent = ok ? 'COPIED!' : 'SELECT + COPY';
    sfx(ok ? 'select' : 'error');
    window.setTimeout(() => { this.copyBtn.textContent = 'COPY LINK'; }, 1600);
  }
  private whatsapp(): void {
    const ctl = this.app.online;
    if (!ctl.link) return;
    const text = `Fight me in KAKUSEI ARENA! Room ${ctl.code}: ${ctl.link}`;
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }

  private side(el: HTMLElement, s: LobbySide | null, label: string, empty: string): void {
    if (!s) {
      el.style.setProperty('--c', '#555');
      el.replaceChildren(h('small', null, label), h('b', { class: 'on-pl-name' }, empty), h('span', { class: 'on-pl-sub' }, ''));
      el.classList.remove('rdy');
      return;
    }
    const id = s.char;
    el.style.setProperty('--c', id === 'random' ? '#ffffff' : META[id].color);
    el.classList.toggle('rdy', s.ready);
    const rdy = h('em', { class: 'on-pl-ready' }, s.ready ? 'READY' : 'CHOOSING…');
    const right = el.classList.contains('rival');
    el.replaceChildren(
      h('small', null, right ? rdy : null, label, right ? null : rdy),
      h('b', { class: 'on-pl-name' }, id === 'random' ? 'RANDOM' : charName(id)),
      h('span', { class: 'on-pl-sub' }, (id === 'random' ? 'Fate decides' : charTitle(id)) + '  ·  ' + s.scheme.toUpperCase()),
    );
  }

  private render(): void {
    const ctl = this.app.online;
    const ph = ctl.phase;
    const msg: Record<string, string> = {
      idle: 'Not connected.', creating: 'Creating room…', waiting: 'Waiting for your friend — send them the link or the code.',
      joining: `Connecting to room ${ctl.code}…`, lobby: ctl.them ? (ctl.isHost ? 'Connected! Pick your fighter. You choose the stage.' : 'Connected! Pick your fighter. The host chooses the stage.') : 'Connected. Waiting for opponent…',
      match: 'Match in progress…', results: '', error: ctl.error || 'Connection failed.',
    };
    this.status.textContent = msg[ph] ?? '';
    this.status.className = 'on-status ' + ph;
    this.share.style.display = ctl.code && ph !== 'error' && (ctl.isHost || ph === 'lobby') ? '' : 'none';
    this.codeEl.textContent = ctl.code || '------';
    this.linkEl.value = ctl.link;
    this.side(this.you, ctl.me, ctl.isHost ? 'YOU · P1 (HOST)' : 'YOU · P2', '');
    this.side(this.rival, ctl.them, ctl.isHost ? 'RIVAL · P2' : 'RIVAL · P1 (HOST)', ph === 'lobby' ? 'CONNECTING…' : 'WAITING…');
    this.cursor = Math.max(0, PICKS.indexOf(ctl.me.char));
    this.cards.forEach((c, i) => { c.classList.toggle('s1', i === this.cursor); c.classList.toggle('l1', i === this.cursor && ctl.me.ready); });
    this.stageBtns.forEach((b, i) => {
      b.classList.toggle('sel', ONLINE_STAGES[i] === ctl.stage);
      (b as HTMLButtonElement).disabled = !ctl.isHost;
    });
    this.schemeBtn.textContent = ctl.me.scheme === 'pro' ? 'PRO INPUTS' : 'EASY INPUTS';
    const inLobby = ph === 'lobby';
    this.readyBtn.disabled = !inLobby;
    this.readyBtn.textContent = ctl.me.ready ? 'NOT READY' : 'READY';
    this.readyBtn.classList.toggle('on', ctl.me.ready);
    this.startBtn.style.display = ctl.isHost ? '' : 'none';
    this.startBtn.disabled = !ctl.canStart;
    this.el.classList.toggle('connected', inLobby);
    const rtt = ctl.rtt;
    const q = inLobby ? qualityBars(rtt) : 0;
    this.pingEl.replaceChildren(
      h('span', { class: 'on-bars q' + q }, h('i', null), h('i', null), h('i', null), h('i', null)),
      inLobby && rtt > 0 ? `${Math.round(rtt)} ms` : '',
      ctl.transportKind ? h('small', null, ctl.transportKind) : '');
    const key = (ctl.me.char === 'random' ? 'r' : ctl.me.char) + '|' + (ctl.them && ctl.them.char !== 'random' ? ctl.them.char : '');
    if (key !== this.lastPreview) {
      this.lastPreview = key;
      const chars: CharId[] = [];
      if (ctl.me.char !== 'random') chars.push(ctl.me.char);
      if (ctl.them && ctl.them.char !== 'random') chars.push(ctl.them.char);
      const st = ctl.stage === 'random' ? undefined : (ctl.stage as StageId);
      this.app.menuScene(chars.length ? chars : [...ALL_CHARS], st);
    }
  }

  onMenu(a: MenuAction): void {
    const ctl = this.app.online;
    switch (a) {
      case 'back':
        if (ctl.me.ready) { ctl.toggleReady(); sfx('back'); return; }
        sfx('back'); ctl.leave(); return;
      case 'left': case 'right': {
        if (ctl.me.ready) return;
        this.cursor = (this.cursor + (a === 'left' ? PICKS.length - 1 : 1)) % PICKS.length;
        ctl.setChar(PICKS[this.cursor]); sfx('move'); return;
      }
      case 'up': ctl.toggleScheme(); sfx('move'); return;
      case 'down': {
        if (!ctl.isHost) return;
        const i = ONLINE_STAGES.indexOf(ctl.stage);
        ctl.setStage(ONLINE_STAGES[(i + 1) % ONLINE_STAGES.length]); sfx('move'); return;
      }
      case 'confirm':
        if (ctl.phase === 'error') { ctl.leave(); return; }
        if (ctl.canStart) { this.start(); return; }
        if (ctl.phase === 'lobby') { ctl.toggleReady(); sfx('select'); }
        return;
      default: return;
    }
  }
}
