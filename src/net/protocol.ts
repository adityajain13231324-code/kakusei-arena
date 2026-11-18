/**
 * Wire protocol + transport abstraction for KAKUSEI ARENA online play.
 * All messages are small plain-JSON objects.
 */
import type { CharId, ControlScheme, MatchConfig, StageId } from '../sim/types';

export const NET_VERSION = 1;

// ---------------------------------------------------------------- game channel (unreliable ok)
/** Local inputs for frames [f, f + i.length), plus ack of the sender's confirmed remote frame. */
export interface InputMsg {
  t: 'in';
  /** first frame of `i` */
  f: number;
  i: number[];
  /** highest frame of the RECEIVER's inputs the sender has received contiguously (-1 none) */
  ack: number;
  /** sender's current frame (next frame it will simulate) */
  cf: number;
  /** sender's frame advantage estimate (frames ahead of the receiver) */
  adv: number;
  /** match number (added by the online controller; stale packets from an older match are dropped) */
  m?: number;
}
export interface PingMsg { t: 'ping'; ts: number }
export interface PongMsg { t: 'pong'; ts: number }

// ---------------------------------------------------------------- control channel (reliable)
export interface HashMsg { t: 'hash'; f: number; h: number; ep: number; m?: number }
/** Host -> guest resync: full state after confirmed frame `f`. */
export interface SyncMsg { t: 'sync'; f: number; ep: number; state: unknown; m?: number }

export interface HelloMsg { t: 'hello'; v: number }
export interface LobbyMsg { t: 'lobby'; char: CharId | 'random'; scheme: ControlScheme; ready: boolean }
export interface StartMsg { t: 'start'; cfg: MatchConfig; match: number }
export interface LoadedMsg { t: 'loaded'; match: number }
export interface RematchMsg { t: 'rematch'; want: 'rematch' | 'lobby' }
export interface StageMsg { t: 'stage'; stage: StageId | 'random' }
export interface LeaveMsg { t: 'leave' }

export type RollbackMsg = InputMsg | PingMsg | PongMsg | HashMsg | SyncMsg;
export type NetMsg = RollbackMsg | HelloMsg | LobbyMsg | StartMsg | LoadedMsg | RematchMsg | StageMsg | LeaveMsg;

/** Messages that must be delivered reliably + in order. Everything else may use the unreliable channel. */
export function isReliable(m: NetMsg): boolean {
  return m.t !== 'in' && m.t !== 'ping' && m.t !== 'pong';
}

// ---------------------------------------------------------------- transport
export type Role = 'host' | 'guest';

/**
 * A connected 1:1 link to the other player. Implementations: PeerJS/WebRTC (production),
 * BroadcastChannel (two tabs, dev/e2e tests), in-memory fake (headless tests).
 * Swap the signaling layer (e.g. a custom WebSocket server) by writing another TransportFactory.
 */
export interface Transport {
  readonly role: Role;
  /** human readable, e.g. 'webrtc (unreliable)' */
  readonly kind: string;
  send(msg: NetMsg): void;
  onMessage(cb: (msg: NetMsg) => void): void;
  onClose(cb: (reason: string) => void): void;
  close(): void;
}

export interface TransportFactory {
  /** Open a room with this code and resolve once a guest has connected. `onOpen` fires when the room is listening. */
  host(code: string, onOpen: () => void): { done: Promise<Transport>; cancel: () => void };
  /** Connect to an existing room. */
  join(code: string): { done: Promise<Transport>; cancel: () => void };
}

export class NetError extends Error {
  constructor(readonly code: 'room-taken' | 'room-not-found' | 'network' | 'unsupported' | 'timeout' | 'cancelled', msg: string) {
    super(msg);
  }
}

// ---------------------------------------------------------------- room codes
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export function makeRoomCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHA[Math.floor(rand() * ALPHA.length)];
  return s;
}
export function normalizeRoomCode(s: string): string | null {
  // accept a pasted share link too
  const m = /#join-([A-Za-z0-9]{6})/.exec(s);
  const c = (m ? m[1] : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{6}$/.test(c) ? c : null;
}
export const peerIdFor = (code: string) => 'kakusei-' + code;
export const JOIN_HASH_RE = /^#join-([A-Za-z0-9]{6})$/;
export function shareLink(code: string, loc: { origin: string; pathname: string; search?: string } = location): string {
  return `${loc.origin}${loc.pathname}${loc.search ?? ''}#join-${code}`;
}
