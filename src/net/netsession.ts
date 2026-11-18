/**
 * NetSession: a MatchSession whose state comes from the rollback layer.
 * The app shell drives it exactly like a local session (advance(dt) each render frame, read
 * state/prev/alpha), so renderer/VFX/audio/HUD need no changes.
 *
 * Online differences vs local:
 *   - fixed 60 Hz always: state.slowmo does NOT slow the sim (both peers must tick at the same rate);
 *   - pausing only opens the menu; the match keeps running and we send neutral input meanwhile;
 *   - events reach VFX/audio/HUD through RollbackSession's once-only presentation.
 */
import type { GameState, InputBits, MatchConfig, SimEvent } from '../sim/types';
import { MatchSession } from '../app/session';
import type { SessionHooks } from '../app/session';
import { RollbackSession } from './rollback';
import type { RollbackMsg } from './protocol';

const TICK = 1 / 60;
const END_DELAY_TICKS = 190;

export interface NetSessionOptions {
  cfg: MatchConfig;
  localSlot: 0 | 1;
  isHost: boolean;
  send(msg: RollbackMsg): void;
  readLocal(): InputBits;
  hooks: SessionHooks;
  onDesync?(info: { frame: number; local: number; remote: number }): void;
}

export class NetSession extends MatchSession {
  readonly rb: RollbackSession;
  readonly localSlot: 0 | 1;
  started = false;
  /** called at the end of every advance() (render frame), even before the match starts */
  onAdvance: ((dt: number) => void) | null = null;
  private endCount = 0;
  private lastAdvanceAt = 0;
  private pump = 0;
  private netHooks: SessionHooks;
  private readLocal: () => InputBits;

  constructor(o: NetSessionOptions) {
    super(o.cfg, 'online', [null, null], () => 0, o.hooks);
    this.netHooks = o.hooks;
    this.readLocal = o.readLocal;
    this.localSlot = o.localSlot;
    this.rb = new RollbackSession({
      localSlot: o.localSlot,
      isHost: o.isHost,
      initial: this.state,
      send: o.send,
      now: () => performance.now(),
      onEvents: (ev: SimEvent[], st: GameState) => { try { this.netHooks.onEvents(ev, st); } catch (e) { console.warn('[net] event handler', e); } },
      onDesync: o.onDesync,
    });
  }

  /** both peers loaded: start the clock */
  begin(): void {
    if (this.started) return;
    this.started = true;
    this.acc = 0;
    this.rb.lastRecvAt = performance.now();
    this.lastAdvanceAt = performance.now();
    // Fallback clock: if requestAnimationFrame is throttled (tab in background / occluded window),
    // keep the simulation and the input stream going so the opponent is not frozen.
    // In a normal foreground tab rAF always wins and this never fires.
    this.pump = window.setInterval(() => {
      const now = performance.now();
      if (now - this.lastAdvanceAt > 50) this.advance((now - this.lastAdvanceAt) / 1000);
    }, 16);
  }

  /** stop timers (called when the controller drops the session) */
  dispose(): void { clearInterval(this.pump); this.pump = 0; }

  receive(msg: RollbackMsg): void { if (!this.ended) this.rb.receive(msg); }

  override reset(): void { /* not available online */ }

  override advance(dt: number): void {
    this.lastAdvanceAt = performance.now();
    this.advanceNet(dt);
    this.onAdvance?.(dt);
  }

  private advanceNet(dt: number): void {
    if (!this.started || this.ended || this.failed) { this.alpha = 1; return; }
    this.acc += Math.min(dt, 0.25);
    let n = 0;
    while (this.acc >= TICK && n < 6) {
      this.acc -= TICK; n++;
      this.tickNet();
      if (this.ended || this.failed) break;
    }
    if (this.acc > TICK * 2) this.acc = TICK; // far behind (tab was hidden): drop time, time-sync re-aligns
    this.state = this.rb.state;
    this.prev = this.rb.prevState;
    this.alpha = Math.min(1, Math.max(0, this.acc / TICK));
  }

  private tickNet(): void {
    try {
      const input = this.paused ? 0 : this.readLocal();
      const t0 = performance.now();
      const r = this.rb.tick(input);
      this.simMs = this.simMs * 0.9 + (performance.now() - t0) * 0.1;
      if (r !== 'advanced') return;
      this.ticks++;
      const st = this.rb.state;
      if (st.round.phase !== 'matchEnd') this.endCount = 0;
      else if (++this.endCount >= END_DELAY_TICKS) {
        this.ended = true;
        this.dispose();
        const [a, b] = st.fighters;
        this.netHooks.onMatchEnd(a.wins > b.wins ? 0 : b.wins > a.wins ? 1 : -1);
      }
    } catch (e) {
      this.failed = true;
      this.netHooks.onError(e);
    }
  }

  /** ms since the last packet from the opponent */
  silenceMs(): number { return performance.now() - this.rb.lastRecvAt; }
}
