/**
 * Crossover VFX harness (real sim + real renderer + real VFX):
 *   http://localhost:5181/src/render/dev/xover.html?p1=gojo&p2=kaito&stage=training
 * Automation: window.__x = { input(seq), advance(n), mutate(fn), state, stats(), restart(p1, p2, stage) }.
 * Inputs are screen-relative bits for P1 (P1 starts on the left, facing right: 6 = Right).
 */
import { GameRenderer } from '../index';
import { VfxSystem } from '../../vfx';
import { createMatch, step, cloneState, Btn, type CharId, type StageId, type GameState } from '../../sim';

const qs = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const R = new GameRenderer(canvas);
const V = new VfxSystem(R);
if (qs.get('noimpact') === '1') (V as unknown as { post: { impact: () => void } }).post.impact = () => { /* stills: no impact frames */ };

let state: GameState;
let prev: GameState | null = null;
let ready: Promise<void> = Promise.resolve();

function restart(p1: CharId, p2: CharId, stage: StageId): Promise<void> {
  state = createMatch({ p1, p2, stage, seed: 7, training: true, schemes: ['easy', 'easy'], trainingOpts: { infiniteKi: true, hpRegen: false, dummyGuard: 'none', dummyCrouch: false } });
  // skip intro / round start
  for (let i = 0; i < 400 && state.round.phase !== 'fight'; i++) step(state, [0, 0]);
  prev = null;
  V.clear();
  ready = R.loadMatch(state);
  return ready;
}
function resize(): void { R.resize(window.innerWidth, window.innerHeight, 1); }
window.addEventListener('resize', resize);
resize();
void restart((qs.get('p1') ?? 'gojo') as CharId, (qs.get('p2') ?? 'kaito') as CharId, (qs.get('stage') ?? 'training') as StageId);

const TOK: Record<string, number> = { U: Btn.Up, D: Btn.Down, B: Btn.Left, F: Btn.Right, L: Btn.L, H: Btn.H, K: Btn.K, S: Btn.S, G: Btn.Guard, X: Btn.Ult };
/** seq: space-separated frames, each a '+'-joined token list ('F+S'), optional ':n' hold count; '.' = neutral */
function input(seq: string, player: 0 | 1 = 0): void {
  for (const part of seq.trim().split(/\s+/)) {
    const [k, n] = part.split(':');
    let bits = 0;
    if (k !== '.') for (const t of k!.split('+')) bits |= TOK[t] ?? 0;
    for (let i = 0; i < (n ? parseInt(n, 10) : 1); i++) {
      pending.push([player, bits]);
    }
  }
}
const pending: Array<[0 | 1, number]> = [];
function simStep(): void {
  const inp: [number, number] = [0, 0];
  const p = pending.shift();
  if (p) inp[p[0]] = p[1];
  prev = cloneState(state);
  step(state, inp);
  V.handleEvents(state.events, state);
}
function draw(dt: number): void {
  R.update(prev, state, 1, dt);
  V.update(dt, state);
  R.render();
  const st = R.getStats();
  const f = state.fighters;
  hud.textContent = `${f[0].char} vs ${f[1].char}  frame ${state.frame}  calls ${st.drawCalls} tris ${st.triangles}\n` +
    `P1 ${f[0].mode} ${f[0].moveId ?? ''}:${f[0].moveFrame} form=${f[0].form ?? ''}  realm=${state.realm ? state.realm.kind + ':' + state.realm.phase + ':' + state.realm.frame : '-'}`;
}
let paused = qs.get('paused') === '1';
let last = performance.now(), acc = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!paused && state) {
    acc += dt;
    while (acc >= 1 / 60) { acc -= 1 / 60; simStep(); }
    draw(dt);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as { __x: unknown }).__x = {
  get state() { return state; },
  get ready() { return ready; },
  restart, input,
  pause(p: boolean) { paused = p; },
  advance(n: number, drawEvery = 1) {
    for (let i = 0; i < n; i++) {
      simStep();
      if (i === n - 1 || i % drawEvery === 0) draw(1 / 60);
      else { R.update(prev, state, 1, 1 / 60); V.update(1 / 60, state); }
    }
  },
  /** run vfx/render time without stepping the sim (cinematic freeze look) */
  idle(n: number) { for (let i = 0; i < n; i++) draw(1 / 60); },
  mutate(fn: (s: GameState) => void) { fn(state); },
  stats: () => R.getStats(),
  R, V,
};
