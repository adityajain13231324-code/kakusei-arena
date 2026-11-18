/**
 * BroadcastChannel transport: two tabs of the same origin play each other with no server.
 * Used for development and the Playwright e2e test. Enable with `?net=local` in the URL.
 * Optional `&lag=<ms>&jitter=<ms>&loss=<0..1>` simulate a bad network for unreliable messages.
 */
import { NetError, isReliable } from './protocol';
import type { NetMsg, Role, Transport, TransportFactory } from './protocol';

type Wire =
  | { k: 'join'; id: string }
  | { k: 'accept'; to: string; id: string }
  | { k: 'm'; from: string; to: string; msg: NetMsg }
  | { k: 'bye'; from: string };

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const LAG = Number(params.get('lag') ?? 0) || 0;
const JITTER = Number(params.get('jitter') ?? 0) || 0;
const LOSS = Number(params.get('loss') ?? 0) || 0;

class LocalTransport implements Transport {
  readonly kind = 'local (BroadcastChannel)';
  private msgCbs: ((m: NetMsg) => void)[] = [];
  private closeCbs: ((r: string) => void)[] = [];
  private closed = false;
  private lastReliable = 0;
  private onUnload = () => this.close();

  constructor(readonly role: Role, private ch: BroadcastChannel, private me: string, private other: string) {
    ch.onmessage = (e) => {
      const w = e.data as Wire;
      if (this.closed) return;
      if (w.k === 'm' && w.to === this.me && w.from === this.other) for (const cb of this.msgCbs) cb(w.msg);
      else if (w.k === 'bye' && w.from === this.other) this.fail('opponent left');
    };
    window.addEventListener('pagehide', this.onUnload);
  }
  private fail(r: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const cb of this.closeCbs) cb(r);
    this.ch.close();
    window.removeEventListener('pagehide', this.onUnload);
  }
  send(msg: NetMsg): void {
    if (this.closed) return;
    const post = () => { if (!this.closed) this.ch.postMessage({ k: 'm', from: this.me, to: this.other, msg } satisfies Wire); };
    if (!LAG && !JITTER && !LOSS) { post(); return; }
    if (isReliable(msg)) {
      const at = Math.max(performance.now() + LAG, this.lastReliable);
      this.lastReliable = at;
      setTimeout(post, at - performance.now());
    } else {
      if (Math.random() < LOSS) return;
      setTimeout(post, LAG + Math.random() * JITTER);
    }
  }
  onMessage(cb: (m: NetMsg) => void): void { this.msgCbs.push(cb); }
  onClose(cb: (r: string) => void): void { this.closeCbs.push(cb); }
  close(): void {
    if (this.closed) return;
    try { this.ch.postMessage({ k: 'bye', from: this.me } satisfies Wire); } catch { /* */ }
    this.closed = true;
    this.ch.close();
    window.removeEventListener('pagehide', this.onUnload);
  }
}

const rid = () => Math.random().toString(36).slice(2, 10);

export const localFactory: TransportFactory = {
  host(code, onOpen) {
    const ch = new BroadcastChannel('kakusei-room-' + code);
    const me = rid();
    let done = false;
    const p = new Promise<Transport>((resolve) => {
      ch.onmessage = (e) => {
        const w = e.data as Wire;
        if (done || w.k !== 'join') return;
        done = true;
        ch.postMessage({ k: 'accept', to: w.id, id: me } satisfies Wire);
        resolve(new LocalTransport('host', ch, me, w.id));
      };
      setTimeout(onOpen, 50);
    });
    return { done: p, cancel: () => { done = true; ch.close(); } };
  },
  join(code) {
    const ch = new BroadcastChannel('kakusei-room-' + code);
    const me = rid();
    let finished = false;
    let timer = 0;
    const p = new Promise<Transport>((resolve, reject) => {
      ch.onmessage = (e) => {
        const w = e.data as Wire;
        if (finished || w.k !== 'accept' || w.to !== me) return;
        finished = true; clearTimeout(timer);
        resolve(new LocalTransport('guest', ch, me, w.id));
      };
      ch.postMessage({ k: 'join', id: me } satisfies Wire);
      timer = window.setTimeout(() => {
        if (finished) return;
        finished = true; ch.close();
        reject(new NetError('room-not-found', 'Room not found (local mode: open the host tab first).'));
      }, 3000);
    });
    return { done: p, cancel: () => { finished = true; clearTimeout(timer); ch.close(); } };
  },
};
