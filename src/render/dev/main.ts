/**
 * Render dev harness: http://localhost:5181/src/render/dev/index.html
 *   ?mode=poses|fight|menu  &p1=kaito &p2=goro &stage=rooftop &pose=jabExt &q=high &cam=fight|front|face|side|wide &awake=1
 * Keys: 1-4 P1 char, Shift+1-4 P2 char, S stage, ←/→ pose, Space auto-cycle poses, A awaken, D hitboxes,
 *       F fight demo, P poses mode, M menu, C camera preset, Q quality.
 */
import * as THREE from 'three';
import { GameRenderer, type Quality } from '../index';
import { POSES, ALL_CHARS, ALL_STAGES, type CharId, type StageId, type PoseName, type GameState, type Capsule } from '../../sim/types';
import { blankState, computeCameraHint } from '../util';
import { DemoFight, demoLookup } from './fakeState';

const qs = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const poseLabel = document.getElementById('pose')!;
const R = new GameRenderer(canvas);
R.setMoveLookup(demoLookup);
if (qs.get('q')) R.setQuality(qs.get('q') as Quality);

let mode = (qs.get('mode') ?? 'poses') as 'poses' | 'fight' | 'menu';
let p1 = (qs.get('p1') ?? 'kaito') as CharId;
let p2 = (qs.get('p2') ?? 'shiori') as CharId;
let stage = (qs.get('stage') ?? 'rooftop') as StageId;
let poseIdx = Math.max(0, POSES.indexOf((qs.get('pose') ?? 'idle') as PoseName));
let auto = qs.get('auto') === '1';
let cam = qs.get('cam') ?? 'fight';
let awake = qs.get('awake') === '1';
let debug = false;
let solo = qs.get('solo') === '1';
let state: GameState = blankState(p1, p2, stage);
let prev: GameState | null = null;
let demo: DemoFight | null = null;
let paused = qs.get('paused') === '1';

function resize(): void { R.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1); }
window.addEventListener('resize', resize);
resize();

function rebuild(): void {
  if (mode === 'menu') { R.showMenuScene([p1, p2, ...ALL_CHARS.filter((c) => c !== p1 && c !== p2)], stage); return; }
  if (mode === 'fight') { demo = new DemoFight(p1, p2, stage); state = demo.state; }
  else { demo = null; state = blankState(p1, p2, stage); }
  prev = null;
  void R.loadMatch(state);
}

function applyPose(): void {
  const pose = POSES[poseIdx];
  for (const f of state.fighters) {
    f.pose = pose; f.moveId = null; f.awakened = awake;
    f.mode = pose === 'idle' || pose === 'idle2' ? 'idle' : pose.startsWith('walk') ? 'walk' : 'attack';
    if (pose === 'launched' || pose === 'airHit') { f.mode = 'juggle'; }
  }
  // poses that need airtime
  const air = ['jumpUp', 'jumpFall', 'flyingKick', 'diveKick', 'launched', 'airHit', 'thrown'].includes(pose);
  for (const f of state.fighters) f.pos.y = air ? 700 : 0;
  state.fighters[1].pos.x = solo ? 30000 : 1300;
  state.fighters[0].pos.x = -1300;
}

function boxes(): Capsule[] {
  const out: Capsule[] = [];
  state.fighters.forEach((f, i) => {
    out.push({ a: { x: f.pos.x, y: f.pos.y + 300, z: f.pos.z }, b: { x: f.pos.x, y: f.pos.y + 1450, z: f.pos.z }, r: 280, owner: i as 0 | 1, kind: 'hurt' });
    if (f.mode === 'attack') out.push({ a: { x: f.pos.x + f.facing.x * 0.3, y: 1300, z: f.pos.z + f.facing.z * 0.3 }, b: { x: f.pos.x + f.facing.x * 0.9, y: 1300, z: f.pos.z + f.facing.z * 0.9 }, r: 90, owner: i as 0 | 1, kind: 'hit' });
  });
  return out;
}

let frameCount = 0;
function simStep(): void {
  prev = JSON.parse(JSON.stringify(state));
  frameCount++;
  if (demo) { demo.step(); state = demo.state; }
  else {
    state.frame++;
    state.events = [];
    if (auto && frameCount % 90 === 0) { poseIdx = (poseIdx + 1) % POSES.length; }
    applyPose();
    for (const f of state.fighters) { f.modeFrame++; }
    computeCameraHint(state);
  }
  if (debug) R.setDebugBoxes(boxes());
}

const v = new THREE.Vector3(), t = new THREE.Vector3();
function camOverride(): void {
  if (mode === 'menu' || cam === 'fight') return;
  const view = (R as unknown as { views: Array<{ group: THREE.Group } | null> }).views[0];
  if (!view) return;
  const g = view.group;
  const fwd = new THREE.Vector3(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y));
  const s = g.scale.x;
  if (cam === 'front') { v.copy(g.position).addScaledVector(fwd, 3.2 * s).add(new THREE.Vector3(0, 1.1 * s, 0)); t.copy(g.position).setY(0.95 * s); }
  else if (cam === 'face') {
    R.getBoneWorld(0, 'head', t);
    const hf = new THREE.Vector3(0, 0, 1).applyQuaternion((view as unknown as { socket(n: string): THREE.Object3D }).socket('head').getWorldQuaternion(new THREE.Quaternion()));
    v.copy(t).addScaledVector(hf, 0.8 * s).add(new THREE.Vector3(0, 0.02, 0));
  }
  else if (cam === 'side') { v.copy(g.position).add(new THREE.Vector3(fwd.z, 0, -fwd.x).multiplyScalar(-3.4 * s)).add(new THREE.Vector3(0, 1.1 * s, 0)); t.copy(g.position).setY(0.95 * s); }
  else if (cam === 'back') { v.copy(g.position).addScaledVector(fwd, -3 * s).add(new THREE.Vector3(0, 1.3 * s, 0)); t.copy(g.position).setY(1.0 * s); }
  else if (cam === 'q') { v.copy(g.position).addScaledVector(fwd, 2.4 * s).add(new THREE.Vector3(fwd.z, 0, -fwd.x).multiplyScalar(-2.0 * s)).add(new THREE.Vector3(0, 1.2 * s, 0)); t.copy(g.position).setY(0.9 * s); }
  else if (cam === 'wide') { v.set(0, 4.5, 11); t.set(0, 1, 0); }
  R.camera.position.copy(v);
  R.camera.up.set(0, 1, 0);
  R.camera.lookAt(t);
}

let acc = 0, last = performance.now(), fpsT = 0, fpsN = 0, fps = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    acc += dt;
    while (acc >= 1 / 60) { acc -= 1 / 60; if (mode !== 'menu') simStep(); }
  }
  if (!paused) draw(acc * 60, dt);
  fpsN++; fpsT += dt;
  if (fpsT > 0.5) { fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
  requestAnimationFrame(frame);
}

function draw(alpha: number, dt: number): void {
  if (mode === 'menu') R.updateMenu(dt);
  else { R.update(prev, state, Math.min(1, alpha), dt); camOverride(); }
  R.render();
  const st = R.getStats();
  hud.textContent = `KAKUSEI render harness  [${mode}]  ${p1} vs ${p2}  stage:${stage}  cam:${cam}  awake:${awake}\n` +
    `draw calls ${st.drawCalls}   tris ${st.triangles}   fps ${fps}\n` +
    `keys: 1-4/⇧1-4 chars · S stage · ←/→ pose · Space auto · A awaken · D boxes · F fight · P poses · M menu · C cam · Q quality`;
  poseLabel.textContent = mode === 'poses' ? `${poseIdx + 1}/${POSES.length}  ${POSES[poseIdx]}` : '';
}

const CAMS = ['fight', 'front', 'q', 'side', 'face', 'back', 'wide'];
const QS: Quality[] = ['high', 'medium', 'low'];
let qi = 0;
window.addEventListener('keydown', (e) => {
  const n = parseInt(e.key, 10);
  const shiftDigit = ({ '!': 1, '@': 2, '#': 3, '$': 4 } as Record<string, number>)[e.key];
  if (n >= 1 && n <= 4) { p1 = ALL_CHARS[n - 1]; rebuild(); }
  else if (shiftDigit) { p2 = ALL_CHARS[shiftDigit - 1]; rebuild(); }
  else if (e.key === 's' || e.key === 'S') { stage = ALL_STAGES[(ALL_STAGES.indexOf(stage) + 1) % ALL_STAGES.length]; rebuild(); }
  else if (e.key === 'ArrowRight') { poseIdx = (poseIdx + 1) % POSES.length; applyPose(); }
  else if (e.key === 'ArrowLeft') { poseIdx = (poseIdx + POSES.length - 1) % POSES.length; applyPose(); }
  else if (e.key === ' ') auto = !auto;
  else if (e.key === 'a' || e.key === 'A') { awake = !awake; for (const f of state.fighters) f.awakened = awake; }
  else if (e.key === 'd' || e.key === 'D') { debug = !debug; R.setDebugBoxes(debug ? boxes() : null); }
  else if (e.key === 'f' || e.key === 'F') { mode = 'fight'; rebuild(); }
  else if (e.key === 'p' || e.key === 'P') { mode = 'poses'; rebuild(); }
  else if (e.key === 'm' || e.key === 'M') { mode = 'menu'; rebuild(); }
  else if (e.key === 'c' || e.key === 'C') cam = CAMS[(CAMS.indexOf(cam) + 1) % CAMS.length];
  else if (e.key === 'q' || e.key === 'Q') { qi = (qi + 1) % 3; R.setQuality(QS[qi]); }
});

// automation hooks for screenshots
(window as unknown as { __dev: unknown }).__dev = {
  set(o: { mode?: typeof mode; p1?: CharId; p2?: CharId; stage?: StageId; pose?: PoseName; cam?: string; awake?: boolean; solo?: boolean; quality?: Quality; debug?: boolean }) {
    let rb = false;
    if (o.mode && o.mode !== mode) { mode = o.mode; rb = true; }
    if (o.p1 && o.p1 !== p1) { p1 = o.p1; rb = true; }
    if (o.p2 && o.p2 !== p2) { p2 = o.p2; rb = true; }
    if (o.stage && o.stage !== stage) { stage = o.stage; rb = true; }
    if (o.quality) R.setQuality(o.quality);
    if (rb) rebuild();
    if (o.pose) poseIdx = POSES.indexOf(o.pose);
    if (o.cam) cam = o.cam;
    if (o.solo !== undefined) solo = o.solo;
    if (o.awake !== undefined) awake = o.awake;
    if (o.debug !== undefined) { debug = o.debug; R.setDebugBoxes(debug ? boxes() : null); }
    if (mode === 'poses') applyPose();
  },
  pause(p: boolean) { paused = p; },
  advance(n: number) { for (let i = 0; i < n; i++) { if (mode !== 'menu') simStep(); draw(1, 1 / 60); } },
  stats: () => R.getStats(),
  snapshot: (id: CharId, size: number) => R.snapshotCharacter(id, size),
  poses: () => POSES.slice(),
  renderer: R,
};

rebuild();
applyPose();
requestAnimationFrame(frame);
