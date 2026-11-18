/**
 * PeerJS / WebRTC transport.
 *  - Signaling: the free PeerJS cloud server (0.peerjs.com) unless VITE_PEER_HOST is set.
 *  - Peer id = 'kakusei-' + roomCode. The host claims the id, the guest connects to it.
 *  - Two data channels: 'ctl' (PeerJS DataConnection, reliable + ordered, JSON) for lobby/hash/sync,
 *    and 'game' (raw negotiated RTCDataChannel, unordered + maxRetransmits 0) for inputs/pings.
 *    If the unreliable channel can't be created we fall back to sending everything over 'ctl'.
 *  - ICE: public Google STUN servers + optional TURN from env (see docs/NETCODE.md).
 */
import Peer from 'peerjs';
import type { DataConnection, PeerOptions } from 'peerjs';
import { NetError, isReliable, peerIdFor } from './protocol';
import type { NetMsg, Role, Transport, TransportFactory } from './protocol';

const env: Record<string, string | undefined> = ((import.meta as unknown as { env?: Record<string, string> }).env) ?? {};

export function iceServers(): RTCIceServer[] {
  const list: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: ['stun:stun2.l.google.com:19302', 'stun:stun3.l.google.com:19302'] },
  ];
  if (env.VITE_TURN_URLS) {
    list.push({
      urls: env.VITE_TURN_URLS.split(',').map((s) => s.trim()).filter(Boolean),
      username: env.VITE_TURN_USERNAME,
      credential: env.VITE_TURN_CREDENTIAL,
    });
  }
  return list;
}

function peerOptions(): PeerOptions {
  const o: PeerOptions = { debug: 1, config: { iceServers: iceServers() } };
  if (env.VITE_PEER_HOST) {
    o.host = env.VITE_PEER_HOST;
    if (env.VITE_PEER_PORT) o.port = Number(env.VITE_PEER_PORT);
    o.path = env.VITE_PEER_PATH ?? '/';
    o.secure = env.VITE_PEER_SECURE !== 'false';
    if (env.VITE_PEER_KEY) o.key = env.VITE_PEER_KEY;
  }
  return o;
}

const GAME_CHANNEL_ID = 7;

class PeerTransport implements Transport {
  kind = 'webrtc';
  private msgCbs: ((m: NetMsg) => void)[] = [];
  private closeCbs: ((r: string) => void)[] = [];
  private game: RTCDataChannel | null = null;
  private closed = false;

  constructor(readonly role: Role, private peer: Peer, private ctl: DataConnection) {
    ctl.on('data', (d) => this.deliver(d));
    ctl.on('close', () => this.fail('connection closed'));
    ctl.on('error', (e) => this.fail('connection error: ' + (e as Error).message));
    const pc = ctl.peerConnection;
    try {
      const dc = pc.createDataChannel('game', { negotiated: true, id: GAME_CHANNEL_ID, ordered: false, maxRetransmits: 0 });
      dc.onmessage = (e) => { try { this.deliver(JSON.parse(String(e.data))); } catch { /* ignore */ } };
      this.game = dc;
      this.kind = 'webrtc (unreliable game channel)';
    } catch {
      this.kind = 'webrtc (reliable only)';
    }
    pc.addEventListener('iceconnectionstatechange', () => {
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') this.fail('network path lost');
    });
  }
  private deliver(d: unknown): void {
    if (this.closed || !d || typeof d !== 'object') return;
    for (const cb of this.msgCbs) cb(d as NetMsg);
  }
  private fail(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const cb of this.closeCbs) cb(reason);
    this.teardown();
  }
  send(msg: NetMsg): void {
    if (this.closed) return;
    try {
      if (!isReliable(msg) && this.game && this.game.readyState === 'open') this.game.send(JSON.stringify(msg));
      else if (this.ctl.open) this.ctl.send(msg);
    } catch { /* dropped */ }
  }
  onMessage(cb: (m: NetMsg) => void): void { this.msgCbs.push(cb); }
  onClose(cb: (r: string) => void): void { this.closeCbs.push(cb); }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.teardown();
  }
  private teardown(): void {
    try { this.game?.close(); } catch { /* */ }
    try { this.ctl.close(); } catch { /* */ }
    try { this.peer.destroy(); } catch { /* */ }
  }
}

function mapError(err: unknown): NetError {
  const type = (err as { type?: string })?.type ?? '';
  switch (type) {
    case 'unavailable-id': return new NetError('room-taken', 'That room code is already in use.');
    case 'peer-unavailable': return new NetError('room-not-found', 'Room not found. Check the code, or ask your friend to create a new room.');
    case 'browser-incompatible': return new NetError('unsupported', 'This browser does not support WebRTC.');
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed':
      return new NetError('network', 'Could not reach the matchmaking server. Check your connection.');
    default: return new NetError('network', 'Connection error' + (type ? ` (${type})` : '') + '.');
  }
}

export const peerFactory: TransportFactory = {
  host(code, onOpen) {
    let peer: Peer | null = null;
    let cancelled = false;
    const done = new Promise<Transport>((resolve, reject) => {
      if (typeof RTCPeerConnection === 'undefined') { reject(new NetError('unsupported', 'This browser does not support WebRTC.')); return; }
      peer = new Peer(peerIdFor(code), peerOptions());
      let accepted = false;
      peer.on('open', () => { if (!cancelled) onOpen(); });
      peer.on('error', (e) => { if (!accepted) { reject(mapError(e)); try { peer?.destroy(); } catch { /* */ } } });
      peer.on('connection', (conn) => {
        if (accepted || conn.label !== 'ctl') { conn.on('open', () => conn.close()); return; }
        accepted = true;
        conn.on('open', () => {
          if (cancelled) { conn.close(); return; }
          resolve(new PeerTransport('host', peer!, conn));
        });
      });
    });
    return { done, cancel: () => { cancelled = true; try { peer?.destroy(); } catch { /* */ } } };
  },
  join(code) {
    let peer: Peer | null = null;
    let cancelled = false;
    let timer = 0;
    const done = new Promise<Transport>((resolve, reject) => {
      if (typeof RTCPeerConnection === 'undefined') { reject(new NetError('unsupported', 'This browser does not support WebRTC.')); return; }
      peer = new Peer(peerOptions());
      let opened = false;
      timer = window.setTimeout(() => {
        if (opened) return;
        reject(new NetError('timeout', 'Could not connect to your friend. If one of you is on a strict network (some mobile data / office Wi-Fi), a TURN server is needed.'));
        try { peer?.destroy(); } catch { /* */ }
      }, 20000);
      peer.on('error', (e) => { if (!opened) { clearTimeout(timer); reject(mapError(e)); try { peer?.destroy(); } catch { /* */ } } });
      peer.on('open', () => {
        if (cancelled) return;
        const conn = peer!.connect(peerIdFor(code), { label: 'ctl', reliable: true, serialization: 'json' });
        conn.on('open', () => {
          opened = true; clearTimeout(timer);
          if (cancelled) { conn.close(); return; }
          resolve(new PeerTransport('guest', peer!, conn));
        });
      });
    });
    return { done, cancel: () => { cancelled = true; clearTimeout(timer); try { peer?.destroy(); } catch { /* */ } } };
  },
};
