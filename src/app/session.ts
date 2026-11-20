// MatchSession: fixed-timestep driver around the sim for one match.
import { Btn } from '../sim/types';
import type { GameState, InputBits, MatchConfig, SimEvent } from '../sim/types';
import { cloneState, createMatch, getMove, step } from '../sim';
import { CpuController, dummyInput as aiDummyInput } from '../ai';
import type { Difficulty } from '../ai';
import type { Mode } from './api';

export type DummyMode = 'stand' | 'crouch' | 'jump' | 'guardAll' | 'randomGuard' | 'cpu';
export const DUMMY_MODES: DummyMode[] = ['stand', 'crouch', 'jump', 'guardAll', 'randomGuard', 'cpu'];
export const DUMMY_LABEL: Record<DummyMode, string> = {
  stand: 'Stand', crouch: 'Crouch', jump: 'Jump', guardAll: 'Guard All', randomGuard: 'Random Guard', cpu: 'CPU',
};

export interface SessionHooks {
  /** per tick, after step */
  onEvents(events: SimEvent[], state: GameState): void;
  onMatchEnd(winner: -1 | 0 | 1): void;
  onError(e: unknown): void;
}

export interface FrameInfo {
  moveName: string; startup: number; active: number; recovery: number; damage: number;
  height: string; dataOnBlock: number | null; dataOnHit: number | null;
  lastAdv: number | null; lastKind: 'hit' | 'block' | null; seq: number;
}

export interface HistEntry { bits: number; n: number }

const TICK = 1 / 60;
const END_DELAY_TICKS = 190;
/** KO slow motion (offline only, real seconds): impact hold at 0.5x while the KO hit's hitstop runs, then 0.25x */
const KO_HOLD_SCALE = 0.5, KO_SLOW_SCALE = 0.25, KO_SLOW_SECS = 1.0, KO_EASE_SECS = 0.35, KO_MAX_SECS = 3;
const HIST_MASK = Btn.Up | Btn.Down | Btn.Left | Btn.Right | Btn.L | Btn.H | Btn.K | Btn.S | Btn.Guard | Btn.Ult;

export class MatchSession {
  state: GameState;
  prev: GameState;
  acc = 0;
  alpha = 1;
  paused = false;
  ticks = 0;
  simMs = 0; // smoothed
  dummy: DummyMode = 'stand';
  infiniteKi = false;
  showHitboxes = false;
  ended = false;
  failed = false;
  /**
   * Real-time multiplier for the sim clock (1 = real time). A KO plays the last hit in slow motion by stepping the sim
   * less often (it stays deterministic: same inputs, same ticks, just fewer per real second; the renderer
   * interpolates). Online play never slows: NetSession overrides advance() and keeps a fixed 60 Hz for rollback sync.
   */
  timeScale = 1;
  private koT = -1; private koSlow = 0;
  frame: FrameInfo = { moveName: '-', startup: 0, active: 0, recovery: 0, damage: 0, height: '-', dataOnBlock: null, dataOnHit: null, lastAdv: null, lastKind: null, seq: 0 };
  hist: HistEntry[] = [];
  histVersion = 0;
  private cpus: [CpuController | null, CpuController | null];
  private trainingCpu: CpuController | null = null;
  private endTicks = 0;
  private rnd = 0;
  private guardOn = false;
  private guardLeft = 0;

  constructor(
    readonly cfg: MatchConfig,
    readonly mode: Mode,
    cpu: [Difficulty | null, Difficulty | null],
    private readIn: (slot: 0 | 1) => InputBits,
    private hooks: SessionHooks,
  ) {
    this.state = createMatch(cfg); // may throw while sim is a stub: caller handles
    this.prev = cloneState(this.state);
    this.cpus = [cpu[0] ? new CpuController(0, cpu[0]) : null, cpu[1] ? new CpuController(1, cpu[1]) : null];
    if (mode === 'training') this.trainingCpu = new CpuController(1, 'normal');
  }

  reset(): void {
    this.state = createMatch(this.cfg);
    this.prev = cloneState(this.state);
    this.acc = 0;
    this.koT = -1; this.timeScale = 1;
    this.frame = { ...this.frame, moveName: '-', lastAdv: null, lastKind: null, seq: this.frame.seq + 1 };
  }

  private dummyInput(): InputBits {
    // deterministic dummy behaviours live in the AI module (replay/rollback safe)
    if (this.dummy === 'cpu') return this.trainingCpu ? this.trainingCpu.think(this.state) : 0;
    return aiDummyInput(this.state, 1, this.dummy);
  }

  private inputs(): [InputBits, InputBits] {
    const out: [InputBits, InputBits] = [0, 0];
    if (this.ended) return out;
    for (const s of [0, 1] as const) {
      if (this.mode === 'training' && s === 1) { out[1] = this.dummyInput(); continue; }
      const cpu = this.cpus[s];
      out[s] = cpu ? cpu.think(this.state) : this.readIn(s);
    }
    return out;
  }

  /** advance by real dt seconds; runs 0..n sim ticks */
  advance(dt: number): void {
    if (this.paused || this.failed) { this.alpha = 1; return; }
    const real = Math.min(dt, 0.25);
    this.timeScale = this.slowScale(real);
    this.acc += real * this.timeScale;
    let guard = 0;
    while (this.acc >= TICK && guard++ <= 12) {
      this.acc -= TICK;
      this.tick();
      if (this.failed) break;
    }
    this.alpha = Math.min(1, Math.max(0, this.acc / TICK));
  }

  /** KO slow-motion curve (real seconds): hold 0.5x during the KO hitstop, 0.25x for ~1 s, ease back to 1x */
  private slowScale(real: number): number {
    // (the sim's state.slowmo hint is only set on KO; the KO curve below replaces the old flat 0.5x for it)
    if (this.koT < 0) return 1;
    this.koT += real;
    const fs = this.state.fighters;
    if (this.koSlow === 0 && (fs[0].hitstop > 0 || fs[1].hitstop > 0) && this.koT < 1) return KO_HOLD_SCALE;
    this.koSlow += real;
    const u = (this.koSlow - KO_SLOW_SECS) / KO_EASE_SECS;
    if (u >= 1 || this.koT > KO_MAX_SECS) { this.koT = -1; return 1; }
    if (u <= 0) return KO_SLOW_SCALE;
    return KO_SLOW_SCALE + (1 - KO_SLOW_SCALE) * u * u * (3 - 2 * u);
  }

  private tick(): void {
    try {
      this.prev = cloneState(this.state);
      const inputs = this.inputs();
      this.pushHist(inputs[0]);
      if (this.infiniteKi) for (const f of this.state.fighters) f.ki = 300;
      const t0 = performance.now();
      step(this.state, inputs);
      this.simMs = this.simMs * 0.9 + (performance.now() - t0) * 0.1;
      this.ticks++;
      if (this.infiniteKi) for (const f of this.state.fighters) f.ki = 300;
      this.processFrameData(this.state.events);
      if (this.mode !== 'online') for (const e of this.state.events) if (e.type === 'ko') { this.koT = 0; this.koSlow = 0; }
      this.hooks.onEvents(this.state.events, this.state);
      if (this.mode !== 'training' && !this.ended && this.state.round.phase === 'matchEnd') {
        if (++this.endTicks >= END_DELAY_TICKS) {
          this.ended = true;
          const [a, b] = this.state.fighters;
          this.hooks.onMatchEnd(a.wins > b.wins ? 0 : b.wins > a.wins ? 1 : -1);
        }
      }
    } catch (e) {
      this.failed = true;
      this.hooks.onError(e);
    }
  }

  private pushHist(bits: number): void {
    const b = bits & HIST_MASK;
    const top = this.hist[0];
    if (top && top.bits === b) { if (top.n < 99) top.n++; return; }
    if (!top && b === 0) return;
    this.hist.unshift({ bits: b, n: 1 });
    if (this.hist.length > 14) this.hist.pop();
    this.histVersion++;
  }

  private processFrameData(events: SimEvent[]): void {
    if (this.mode !== 'training') return;
    for (const e of events) {
      if (e.player !== 0) continue;
      if (e.type === 'moveStart' && e.moveId) {
        const m = getMove(this.state.fighters[0].char, e.moveId);
        if (!m) continue;
        this.frame = {
          moveName: m.name, startup: m.startup, active: m.active, recovery: m.recovery, damage: m.damage, height: m.height,
          dataOnBlock: m.blockstun - m.recovery - (m.active - 1), dataOnHit: m.hitstun - m.recovery - (m.active - 1),
          lastAdv: null, lastKind: null, seq: this.frame.seq + 1,
        };
      } else if ((e.type === 'hit' || e.type === 'block' || e.type === 'counter') && e.target === 1) {
        const a = this.state.fighters[0], d = this.state.fighters[1];
        const m = e.moveId ? getMove(a.char, e.moveId) : a.moveId ? getMove(a.char, a.moveId) : undefined;
        if (m && this.frame.moveName !== m.name) {
          this.frame = { ...this.frame, moveName: m.name, startup: m.startup, active: m.active, recovery: m.recovery, damage: m.damage, height: m.height,
            dataOnBlock: m.blockstun - m.recovery - (m.active - 1), dataOnHit: m.hitstun - m.recovery - (m.active - 1) };
        }
        const total = m ? m.startup + m.active + m.recovery : a.moveFrame;
        const adv = d.stun - Math.max(0, total - a.moveFrame);
        this.frame = { ...this.frame, lastAdv: adv, lastKind: e.type === 'block' ? 'block' : 'hit', seq: this.frame.seq + 1 };
      }
    }
  }
}
