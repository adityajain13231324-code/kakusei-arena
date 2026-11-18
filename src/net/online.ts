/**
 * OnlineController: room lifecycle (create / join / lobby / match / results / rematch / leave)
 * on top of a Transport, and the bridge between the network and the app shell.
 * UI screens (src/ui/screens/online.ts) read its fields and call its methods; they re-render on `subscribe`.
 */
import { ALL_CHARS } from '../sim/types';
import type { CharId, ControlScheme, MatchConfig, StageId } from '../sim/types';
import type { AppApi } from '../app/api';
import { charName } from '../ui/meta';
import { NetSession } from './netsession';
import { NetOverlay } from './overlay';
import { peerFactory } from './peer';
import { localFactory } from './local';
import { NET_VERSION, NetError, makeRoomCode, shareLink } from './protocol';
import type { NetMsg, Role, Transport, TransportFactory } from './protocol';

export type OnlinePhase = 'idle' | 'creating' | 'waiting' | 'joining' | 'lobby' | 'match' | 'results' | 'error';
export interface LobbySide { char: CharId | 'random'; scheme: ControlScheme; ready: boolean }
export const ONLINE_STAGES: (StageId | 'random')[] = ['rooftop', 'shrine', 'random'];

const DISCONNECT_MS = 10000;

/** dev/e2e only: `?net=local&rounds=1` shortens matches */
function devRounds(): number | null {
  try {
    const q = new URLSearchParams(location.search);
    const r = Number(q.get('rounds'));
    return q.get('net') === 'local' && r >= 1 && r <= 5 ? r : null;
  } catch { return null; }
}

function pickFactory(): TransportFactory {
  try {
    if (new URLSearchParams(location.search).get('net') === 'local') return localFactory;
  } catch { /* */ }
  return peerFactory;
}

export class OnlineController {
  phase: OnlinePhase = 'idle';
  role: Role = 'host';
  code = '';
  error = '';
  me: LobbySide = { char: 'kaito', scheme: 'pro', ready: false };
  them: LobbySide | null = null;
  stage: StageId | 'random' = 'rooftop';
  /** lobby round-trip time (ms) */
  rtt = 0;
  myWant: 'rematch' | 'lobby' | null = null;
  theirWant: 'rematch' | 'lobby' | null = null;
  transportKind = '';
  readonly factory: TransportFactory = pickFactory();

  private transport: Transport | null = null;
  private pending: { cancel: () => void } | null = null;
  private session: NetSession | null = null;
  private overlay: NetOverlay | null = null;
  private matchNo = 0;
  private localLoaded = false;
  private remoteLoadedMatch = -1;
  private lastCfg: MatchConfig | null = null;
  private pingTimer = 0;
  private listeners = new Set<() => void>();
  private gen = 0;

  constructor(private app: AppApi) {}

  get active(): boolean { return this.phase !== 'idle' && this.phase !== 'error'; }
  get connected(): boolean { return !!this.transport; }
  get isHost(): boolean { return this.role === 'host'; }
  get link(): string { return this.code ? shareLink(this.code) : ''; }

  subscribe(cb: () => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  private changed(): void { for (const cb of [...this.listeners]) { try { cb(); } catch (e) { console.warn(e); } } }

  // ------------------------------------------------------------------ room lifecycle
  create(): void {
    this.shutdown();
    const my = ++this.gen;
    this.role = 'host';
    this.resetLobby();
    this.phase = 'creating';
    this.changed();
    const attempt = (tries: number) => {
      this.code = makeRoomCode();
      const p = this.factory.host(this.code, () => { if (my === this.gen && this.phase === 'creating') { this.phase = 'waiting'; this.changed(); } });
      this.pending = p;
      p.done.then((t) => { if (my !== this.gen) { t.close(); return; } this.attach(t); })
        .catch((e: unknown) => {
          if (my !== this.gen) return;
          if (e instanceof NetError && e.code === 'room-taken' && tries < 3) { attempt(tries + 1); return; }
          this.fail(e);
        });
    };
    attempt(0);
  }

  join(code: string): void {
    this.shutdown();
    const my = ++this.gen;
    this.role = 'guest';
    this.code = code;
    this.resetLobby();
    this.phase = 'joining';
    this.changed();
    const p = this.factory.join(code);
    this.pending = p;
    p.done.then((t) => { if (my !== this.gen) { t.close(); return; } this.attach(t); })
      .catch((e: unknown) => { if (my === this.gen) this.fail(e); });
  }

  private fail(e: unknown): void {
    this.pending = null;
    this.phase = 'error';
    this.error = e instanceof Error ? e.message : String(e);
    this.changed();
  }

  private resetLobby(): void {
    const f = this.app.flow;
    this.me = { char: this.me.char === 'random' ? 'random' : (f.p1 ?? 'kaito'), scheme: this.app.settings.data.scheme[0] ?? 'pro', ready: false };
    this.them = null;
    this.error = '';
    this.myWant = this.theirWant = null;
    this.rtt = 0;
  }

  private attach(t: Transport): void {
    this.pending = null;
    this.transport = t;
    this.transportKind = t.kind;
    t.onMessage((m) => this.handle(m));
    t.onClose((r) => this.onClosed(r));
    this.phase = 'lobby';
    t.send({ t: 'hello', v: NET_VERSION });
    this.sendLobby();
    if (this.isHost) t.send({ t: 'stage', stage: this.stage });
    clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => { if (!this.session || this.session.ended) this.transport?.send({ t: 'ping', ts: performance.now() }); }, 1000);
    this.app.toast('Opponent connected!');
    this.changed();
  }

  /** Close everything silently (no UI navigation). Safe to call any time. */
  shutdown(): void {
    this.gen++;
    try { this.pending?.cancel(); } catch { /* */ }
    this.pending = null;
    if (this.transport) { try { this.transport.send({ t: 'leave' }); } catch { /* */ } this.transport.close(); }
    this.transport = null;
    clearInterval(this.pingTimer);
    this.dropSession();
    if (this.phase !== 'idle') { this.phase = 'idle'; this.changed(); }
    if (typeof location !== 'undefined' && /^#join-/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  }

  /** user pressed LEAVE in the lobby / online screens */
  leave(): void {
    this.shutdown();
    this.app.leaveNetMatch('online');
  }

  private onClosed(reason: string): void {
    if (!this.transport) return;
    this.transport = null;
    const wasMatch = this.phase === 'match';
    this.shutdown();
    this.app.toast(wasMatch ? 'Opponent disconnected — match ended.' : `Opponent left the room (${reason}).`);
    this.app.leaveNetMatch('online');
  }

  // ------------------------------------------------------------------ lobby
  private sendLobby(): void {
    this.transport?.send({ t: 'lobby', char: this.me.char, scheme: this.me.scheme, ready: this.me.ready });
  }
  setChar(c: CharId | 'random'): void {
    if (this.me.ready || this.phase !== 'lobby' && this.phase !== 'creating' && this.phase !== 'waiting' && this.phase !== 'joining') return;
    this.me.char = c;
    if (c !== 'random') this.app.flow.p1 = c;
    this.sendLobby(); this.changed();
  }
  toggleScheme(): void {
    if (this.me.ready) return;
    this.me.scheme = this.me.scheme === 'pro' ? 'easy' : 'pro';
    this.app.settings.data.scheme[0] = this.me.scheme;
    this.app.settings.save();
    this.sendLobby(); this.changed();
  }
  toggleReady(): void {
    if (this.phase !== 'lobby') return;
    if (!this.me.ready && this.me.char === 'random') this.me.char = ALL_CHARS[Math.floor(Math.random() * ALL_CHARS.length)];
    this.me.ready = !this.me.ready;
    this.sendLobby(); this.changed();
  }
  setStage(s: StageId | 'random'): void {
    if (!this.isHost) return;
    this.stage = s;
    this.transport?.send({ t: 'stage', stage: s });
    this.changed();
  }
  get canStart(): boolean { return this.isHost && this.phase === 'lobby' && this.me.ready && !!this.them?.ready; }

  /** host: both ready -> send config and start */
  start(): void {
    if (!this.canStart || !this.them || this.me.char === 'random' || this.them.char === 'random') return;
    const pool: StageId[] = ['rooftop', 'shrine'];
    const stage = this.stage === 'random' ? pool[Math.floor(Math.random() * pool.length)] : this.stage;
    const cfg: MatchConfig = {
      p1: this.me.char, p2: this.them.char, stage, seed: (Math.random() * 0x7fffffff) | 0, roundsToWin: devRounds() ?? 2,
      training: false, schemes: [this.me.scheme, this.them.scheme],
    };
    this.launch(cfg, this.matchNo + 1);
  }

  private launch(cfg: MatchConfig, match: number): void {
    if (this.isHost) this.transport?.send({ t: 'start', cfg, match });
    this.matchNo = match;
    this.lastCfg = cfg;
    this.myWant = this.theirWant = null;
    this.localLoaded = false;
    this.phase = 'match';
    this.dropSession();
    const localSlot: 0 | 1 = this.isHost ? 0 : 1;
    this.app.startNetMatch({
      cfg,
      label: `ONLINE  ·  ROOM ${this.code}`,
      create: (onEvents) => {
        const s = new NetSession({
          cfg, localSlot, isHost: this.isHost,
          send: (m) => this.transport?.send({ ...m, m: match } as NetMsg),
          readLocal: () => this.app.input.read(0),
          hooks: {
            onEvents,
            onMatchEnd: (w) => this.onMatchEnd(w),
            onError: (e) => { console.error('[net] sim error', e); this.app.toast('Engine error: ' + (e instanceof Error ? e.message : String(e))); },
          },
          onDesync: (d) => this.overlay?.desync(d.frame, this.isHost),
        });
        s.onAdvance = (dt) => this.frame(dt);
        this.session = s;
        return s;
      },
      onShown: () => {
        if (this.matchNo !== match || !this.session) return;
        this.localLoaded = true;
        this.transport?.send({ t: 'loaded', match });
        this.overlay ??= new NetOverlay(this.app.ui.root);
        this.overlay.show(true, localSlot);
        this.maybeBegin();
      },
    });
    this.changed();
  }

  private maybeBegin(): void {
    if (this.session && this.localLoaded && this.remoteLoadedMatch === this.matchNo) this.session.begin();
  }

  /** per render frame while a NetSession is attached */
  private frame(dt: number): void {
    const s = this.session;
    if (!s || !this.overlay) return;
    this.overlay.update(dt, s, this.connected);
    if (s.started && !s.ended && s.silenceMs() > DISCONNECT_MS) this.onClosed('timed out');
  }

  private dropSession(): void {
    this.session?.dispose();
    this.session = null;
    this.overlay?.show(false);
  }

  private onMatchEnd(winner: -1 | 0 | 1): void {
    const s = this.session;
    if (!s) return;
    this.phase = 'results';
    this.overlay?.show(false);
    this.app.finishNetMatch();
    const st = s.state;
    const mine = s.localSlot;
    const id = winner === -1 ? undefined : st.fighters[winner].char;
    this.app.ui.go('results', {
      winner, id, side: winner === 1 ? 1 : 0,
      title: winner === -1 ? 'DRAW' : charName(id!),
      sub: winner === -1 ? 'TIME OVER' : winner === mine ? 'YOU WIN' : 'YOU LOSE',
      buttons: [
        { label: 'REMATCH', sub: '再戦', act: () => this.requestRematch() },
        { label: 'CHARACTER SELECT', sub: 'ロビー', act: () => this.requestLobby() },
        { label: 'LEAVE ROOM', act: () => this.app.goMenu() },
      ],
    });
    this.changed();
  }

  // ------------------------------------------------------------------ rematch
  requestRematch(): void {
    if (this.phase !== 'results') return;
    this.myWant = 'rematch';
    this.transport?.send({ t: 'rematch', want: 'rematch' });
    if (this.theirWant !== 'rematch') this.app.toast('Rematch requested — waiting for opponent…');
    this.checkRematch();
  }
  requestLobby(): void {
    this.transport?.send({ t: 'rematch', want: 'lobby' });
    this.goLobby();
  }
  private goLobby(): void {
    this.phase = 'lobby';
    this.myWant = this.theirWant = null;
    this.me.ready = false;
    if (this.them) this.them.ready = false;
    this.dropSession();
    this.app.leaveNetMatch('onlinelobby');
    this.sendLobby();
    this.changed();
  }
  private checkRematch(): void {
    if (this.isHost && this.myWant === 'rematch' && this.theirWant === 'rematch' && this.lastCfg) {
      this.launch({ ...this.lastCfg, seed: (Math.random() * 0x7fffffff) | 0 }, this.matchNo + 1);
    }
  }

  // ------------------------------------------------------------------ messages
  private handle(m: NetMsg): void {
    switch (m.t) {
      case 'in': case 'hash': case 'sync':
        if (this.session && m.m === this.matchNo) this.session.receive(m);
        return;
      case 'ping':
        if (this.session && !this.session.ended) this.session.receive(m);
        else this.transport?.send({ t: 'pong', ts: m.ts });
        return;
      case 'pong':
        if (this.session && !this.session.ended) this.session.receive(m);
        else { const s = performance.now() - m.ts; this.rtt = this.rtt ? this.rtt * 0.7 + s * 0.3 : s; this.changed(); }
        return;
      case 'hello':
        if (m.v !== NET_VERSION) { this.app.toast('Your friend is on a different game version — both reload the page.'); }
        return;
      case 'lobby':
        this.them = { char: m.char, scheme: m.scheme, ready: m.ready };
        this.changed();
        return;
      case 'stage':
        if (!this.isHost) { this.stage = m.stage; this.changed(); }
        return;
      case 'start':
        if (!this.isHost) this.launch(m.cfg, m.match);
        return;
      case 'loaded':
        this.remoteLoadedMatch = m.match;
        this.maybeBegin();
        return;
      case 'rematch':
        this.theirWant = m.want;
        if (m.want === 'lobby' && (this.phase === 'results' || this.phase === 'match')) { this.app.toast('Opponent went back to character select.'); this.goLobby(); return; }
        if (m.want === 'rematch' && this.myWant !== 'rematch') this.app.toast('Opponent wants a rematch!');
        this.checkRematch();
        this.changed();
        return;
      case 'leave':
        this.onClosed('left');
        return;
    }
  }
}
