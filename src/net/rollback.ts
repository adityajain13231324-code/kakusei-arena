/**
 * GGPO-style rollback core. Transport-agnostic and headless-testable:
 *   - call `tick(localInput)` at a fixed 60 Hz,
 *   - feed every message from the other peer into `receive(msg)`,
 *   - outgoing messages go through the `send` callback.
 *
 * Model
 *   curFrame      next frame to simulate; `state` = state after frames [0, curFrame).
 *   local[f]      our input for frame f. Input sampled on tick T is scheduled for frame curFrame + delay.
 *   remote[f]     other peer's input for frame f (undefined until received). Prediction = last confirmed input.
 *   saved[f]      snapshot BEFORE frame f (ring of RING entries).
 * On receiving a remote input that differs from what we simulated with, we restore saved[f] and
 * resimulate up to curFrame. We never simulate more than MAX_PREDICTION frames past the last
 * contiguously confirmed remote input (stall instead -> "waiting" indicator).
 *
 * Events: VFX/audio/HUD see each event once. New frames forward everything. On resimulation a frame
 * that was already presented only forwards events that were NOT presented for that frame before
 * (multiset diff keyed by type/player/target/move/tag), so a hit that only exists in the corrected
 * timeline still gets its spark, but nothing is ever forwarded twice.
 */
import type { GameState, InputBits, SimEvent } from '../sim/types';
import { cloneState, hashState, step as simStep } from '../sim';
import type { RollbackMsg } from './protocol';

export const MAX_PREDICTION = 8;
export const RING = 16;
export const HASH_INTERVAL = 30;
const MAX_INPUTS_PER_PACKET = 64;
const PING_MS = 250;
const WAIT_COOLDOWN_TICKS = 12;

export interface RollbackOptions {
  localSlot: 0 | 1;
  isHost: boolean;
  initial: GameState;
  send(msg: RollbackMsg): void;
  /** clock in ms (performance.now in browsers; virtual clock in tests) */
  now(): number;
  /** forwarded once per tick with every not-yet-presented event (in frame order) and the current state */
  onEvents?(events: SimEvent[], state: GameState): void;
  onDesync?(info: { frame: number; local: number; remote: number }): void;
  /** fixed delay, or 'auto' (1..3 from ping). Default 'auto' starting at 2. */
  delay?: number | 'auto';
  /** test hooks: override sim functions */
  step?: (s: GameState, inputs: [InputBits, InputBits]) => void;
  clone?: (s: GameState) => GameState;
  hash?: (s: GameState) => number;
}

export interface RollbackStats {
  rollbacks: number;
  rolledFrames: number;
  maxRollback: number;
  stallTicks: number;
  waits: number;
  desyncs: number;
  resyncs: number;
  hashesCompared: number;
}

export type TickResult = 'advanced' | 'stalled' | 'waited';

function evKey(e: SimEvent): string {
  return `${e.type}|${e.player}|${e.target ?? ''}|${e.moveId ?? ''}|${e.tag ?? ''}`;
}

export class RollbackSession {
  state: GameState;
  curFrame = 0;
  delay: number;
  readonly autoDelay: boolean;
  readonly localSlot: 0 | 1;
  readonly isHost: boolean;
  readonly stats: RollbackStats = { rollbacks: 0, rolledFrames: 0, maxRollback: 0, stallTicks: 0, waits: 0, desyncs: 0, resyncs: 0, hashesCompared: 0 };
  /** smoothed round-trip time, ms (0 = unknown yet) */
  rtt = 0;
  /** ms timestamp of the last message received from the peer */
  lastRecvAt: number;
  /** consecutive ticks stalled on the prediction window */
  stalledFor = 0;
  /** last frame advantage estimate (frames we are ahead) */
  localAdv = 0;
  remoteAdv = 0;
  /** last confirmed-frame hash we computed (debug) */
  readonly localHashes = new Map<number, number>();

  readonly local: number[] = [];
  readonly remote: (number | undefined)[] = [];
  private usedRemote: number[] = [];
  nextLocal = 0;
  remoteConfirmed = -1;
  private peerAck = -1;
  private remoteFrame = 0;
  private remoteFrameAt = 0;
  private saved: (GameState | null)[] = new Array(RING).fill(null);
  private savedFrame: number[] = new Array(RING).fill(-1);
  private pendingRollback = Infinity;
  private ticks = 0;
  private lastWaitTick = -1000;
  private advAvg = 0;
  private lastPingAt = -1e9;
  private remoteHashes = new Map<number, number>();
  private lastHashFrame = 0;
  private epoch = 0;
  private syncFloor = -1;
  private lastSyncAt = -1e9;
  private presented = new Map<number, Map<string, number>>();
  private outEvents: SimEvent[] = [];
  private stepFn: (s: GameState, inputs: [InputBits, InputBits]) => void;
  private cloneFn: (s: GameState) => GameState;
  private hashFn: (s: GameState) => number;

  constructor(private o: RollbackOptions) {
    this.state = o.initial;
    this.localSlot = o.localSlot;
    this.isHost = o.isHost;
    this.autoDelay = o.delay === undefined || o.delay === 'auto';
    this.delay = typeof o.delay === 'number' ? o.delay : 2;
    this.stepFn = o.step ?? simStep;
    this.cloneFn = o.clone ?? cloneState;
    this.hashFn = o.hash ?? hashState;
    this.lastRecvAt = o.now();
  }

  /** highest frame where both inputs are known and the state is final */
  get confirmedFrame(): number { return Math.min(this.remoteConfirmed, this.curFrame - 1); }
  /** true while we are blocked waiting for the other player's inputs */
  get waiting(): boolean { return this.stalledFor > 6; }
  /** state before the last simulated frame (for render interpolation) */
  get prevState(): GameState { return this.savedAt(this.curFrame - 1) ?? this.state; }

  // ------------------------------------------------------------------ main tick
  tick(localInput: InputBits): TickResult {
    this.ticks++;
    const now = this.o.now();
    this.applyRollback();
    this.checkHashes();
    if (now - this.lastPingAt >= PING_MS) { this.lastPingAt = now; this.o.send({ t: 'ping', ts: now }); }
    if (this.autoDelay && this.ticks % 60 === 0) this.updateDelay();

    let res: TickResult;
    if (this.curFrame - this.remoteConfirmed > MAX_PREDICTION) {
      this.stalledFor++; this.stats.stallTicks++;
      res = 'stalled';
    } else if (this.shouldWait(now)) {
      this.stats.waits++;
      res = 'waited';
    } else {
      this.stalledFor = 0;
      const target = this.curFrame + this.delay;
      while (this.nextLocal <= target) this.local[this.nextLocal++] = localInput;
      this.simulate(this.curFrame, false);
      this.curFrame++;
      res = 'advanced';
    }
    this.sendInputs();
    this.flushEvents();
    if (this.ticks % 120 === 0) this.prune();
    return res;
  }

  // ------------------------------------------------------------------ receive
  receive(msg: RollbackMsg): void {
    const now = this.o.now();
    this.lastRecvAt = now;
    switch (msg.t) {
      case 'in': {
        for (let k = 0; k < msg.i.length; k++) {
          const f = msg.f + k;
          if (this.remote[f] !== undefined) continue;
          const v = msg.i[k];
          this.remote[f] = v;
          if (f < this.curFrame && this.usedRemote[f] !== v && f < this.pendingRollback) this.pendingRollback = f;
        }
        while (this.remote[this.remoteConfirmed + 1] !== undefined) this.remoteConfirmed++;
        if (msg.ack > this.peerAck) this.peerAck = msg.ack;
        if (msg.cf >= this.remoteFrame) { this.remoteFrame = msg.cf; this.remoteFrameAt = now; this.remoteAdv = msg.adv; }
        break;
      }
      case 'ping': this.o.send({ t: 'pong', ts: msg.ts }); break;
      case 'pong': {
        const s = Math.max(0, now - msg.ts);
        this.rtt = this.rtt === 0 ? s : this.rtt * 0.85 + s * 0.15;
        break;
      }
      case 'hash': {
        if (msg.ep < this.epoch || msg.f <= this.syncFloor) break;
        this.remoteHashes.set(msg.f, msg.h);
        this.compareHash(msg.f);
        break;
      }
      case 'sync': if (!this.isHost) this.applySync(msg.f, msg.ep, msg.state as GameState); break;
    }
  }

  // ------------------------------------------------------------------ internals
  private savedAt(f: number): GameState | null {
    if (f < 0) return null;
    const i = f % RING;
    return this.savedFrame[i] === f ? this.saved[i] : null;
  }

  private remoteFor(f: number): number {
    const r = this.remote[f];
    if (r !== undefined) return r;
    return this.remoteConfirmed >= 0 ? (this.remote[this.remoteConfirmed] as number) : 0;
  }

  private simulate(f: number, resim: boolean): void {
    const i = f % RING;
    this.saved[i] = this.cloneFn(this.state);
    this.savedFrame[i] = f;
    const r = this.remoteFor(f);
    this.usedRemote[f] = r;
    const l = this.local[f] ?? 0;
    this.stepFn(this.state, this.localSlot === 0 ? [l, r] : [r, l]);
    this.present(f, this.state.events ?? [], resim);
  }

  private applyRollback(): void {
    const from = this.pendingRollback;
    this.pendingRollback = Infinity;
    if (from >= this.curFrame) return;
    const snap = this.savedAt(from);
    if (!snap) {
      // should be impossible (prediction window < RING); fail loudly in dev, keep running
      console.warn('[net] rollback target not in ring', from, this.curFrame);
      return;
    }
    const depth = this.curFrame - from;
    this.stats.rollbacks++;
    this.stats.rolledFrames += depth;
    if (depth > this.stats.maxRollback) this.stats.maxRollback = depth;
    this.state = this.cloneFn(snap);
    for (let f = from; f < this.curFrame; f++) this.simulate(f, true);
  }

  private present(f: number, events: SimEvent[], resim: boolean): void {
    let rec = this.presented.get(f);
    if (!rec) { rec = new Map(); this.presented.set(f, rec); }
    if (!events.length) return;
    if (!resim) {
      for (const e of events) { const k = evKey(e); rec.set(k, (rec.get(k) ?? 0) + 1); this.outEvents.push(e); }
      return;
    }
    const seen = new Map<string, number>();
    for (const e of events) {
      const k = evKey(e);
      const c = (seen.get(k) ?? 0) + 1;
      seen.set(k, c);
      if (c > (rec.get(k) ?? 0)) { rec.set(k, c); this.outEvents.push(e); }
    }
  }

  private flushEvents(): void {
    if (!this.outEvents.length) return;
    const ev = this.outEvents;
    this.outEvents = [];
    this.o.onEvents?.(ev, this.state);
  }

  private sendInputs(): void {
    const from = Math.max(0, this.peerAck + 1);
    const to = Math.min(this.nextLocal - 1, from + MAX_INPUTS_PER_PACKET - 1);
    this.o.send({
      t: 'in', f: from, i: to >= from ? this.local.slice(from, to + 1) : [],
      ack: this.remoteConfirmed, cf: this.curFrame, adv: Math.round(this.localAdv * 100) / 100,
    });
  }

  /** frame-advantage throttling: if we're ahead of the peer, idle one tick occasionally */
  private shouldWait(now: number): boolean {
    if (this.remoteFrameAt === 0) return false;
    const est = this.remoteFrame + ((this.rtt / 2) + (now - this.remoteFrameAt)) * 0.06;
    this.localAdv = this.curFrame - est;
    const diff = (this.localAdv - this.remoteAdv) / 2;
    this.advAvg = this.advAvg * 0.9 + diff * 0.1;
    if (this.ticks - this.lastWaitTick < WAIT_COOLDOWN_TICKS) return false;
    if (this.advAvg >= 1) { this.lastWaitTick = this.ticks; this.advAvg -= 1; return true; }
    return false;
  }

  private updateDelay(): void {
    if (this.rtt <= 0) return;
    const want = this.rtt < 50 ? 1 : this.rtt < 130 ? 2 : 3;
    if (want > this.delay) this.delay++;
    else if (want < this.delay) this.delay--;
  }

  // ------------------------------------------------------------------ desync detection
  private checkHashes(): void {
    const conf = this.confirmedFrame;
    while (this.lastHashFrame + HASH_INTERVAL <= conf) {
      const f = this.lastHashFrame + HASH_INTERVAL;
      this.lastHashFrame = f;
      if (f <= this.syncFloor) continue;
      const st = f + 1 === this.curFrame ? this.state : this.savedAt(f + 1);
      if (!st) continue;
      const h = this.hashFn(st);
      this.localHashes.set(f, h);
      this.o.send({ t: 'hash', f, h, ep: this.epoch });
      this.compareHash(f);
    }
  }

  private compareHash(f: number): void {
    const a = this.localHashes.get(f), b = this.remoteHashes.get(f);
    if (a === undefined || b === undefined) return;
    this.remoteHashes.delete(f);
    this.stats.hashesCompared++;
    if (a === b) return;
    this.stats.desyncs++;
    this.o.onDesync?.({ frame: f, local: a, remote: b });
    if (this.isHost) this.sendSync();
  }

  private sendSync(): void {
    const now = this.o.now();
    if (now - this.lastSyncAt < 1000) return;
    const F = this.confirmedFrame;
    const st = F + 1 === this.curFrame ? this.state : this.savedAt(F + 1);
    if (!st) return;
    this.lastSyncAt = now;
    this.epoch++;
    this.syncFloor = F;
    this.stats.resyncs++;
    for (const k of [...this.remoteHashes.keys()]) if (k <= F) this.remoteHashes.delete(k);
    this.o.send({ t: 'sync', f: F, ep: this.epoch, state: this.cloneFn(st) });
  }

  private applySync(F: number, ep: number, st: GameState): void {
    this.epoch = ep;
    this.syncFloor = F;
    this.stats.resyncs++;
    for (const k of [...this.remoteHashes.keys()]) if (k <= F) this.remoteHashes.delete(k);
    for (const k of [...this.localHashes.keys()]) if (k <= F) this.localHashes.delete(k);
    if (this.lastHashFrame < F) this.lastHashFrame = F - (F % HASH_INTERVAL);
    this.state = this.cloneFn(st);
    if (F + 1 >= this.curFrame) {
      this.curFrame = F + 1;
      while (this.nextLocal < this.curFrame) this.local[this.nextLocal++] = 0;
      return;
    }
    // re-run the frames after F on top of the authoritative state (events already presented are deduped)
    for (let f = F + 1; f < this.curFrame; f++) this.simulate(f, true);
    if (this.pendingRollback <= this.curFrame) this.pendingRollback = Infinity;
  }

  private prune(): void {
    const lim = this.curFrame - 64;
    for (const k of this.presented.keys()) if (k < lim) this.presented.delete(k);
    for (const k of this.localHashes.keys()) if (k < lim - 600) this.localHashes.delete(k);
    for (const k of this.remoteHashes.keys()) if (k < lim - 600) this.remoteHashes.delete(k);
  }
}
