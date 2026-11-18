// Dev harness for VFX + audio. Open: npx vite --port 5182  ->  /src/vfx/dev/index.html
// Uses a fake GameRenderer + fake GameState so it works while sim/render are still stubs.
import * as THREE from 'three';
import { VfxSystem } from '../index';
import { AudioSystem } from '../../audio';
import type { MusicTrack, UiSound } from '../../audio';
import type { GameState, SimEvent, FighterState, ProjectileState, Element, Strength, CharId } from '../../sim/types';
import type { GameRenderer } from '../../render';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setClearColor(0x14142a);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x14142a, 12, 40);
const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
const camBase = new THREE.Vector3(0, 1.7, 6.2);
camera.position.copy(camBase);
camera.lookAt(0, 1.2, 0);

// --- placeholder stage + capsules
const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: 0x23233f }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor, new THREE.GridHelper(30, 30, 0x4a4a80, 0x2d2d55));
const caps: THREE.Mesh[] = [];
for (let i = 0; i < 2; i++) {
  const m = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.3, 1.1, 4, 12),
    new THREE.MeshBasicMaterial({ color: i === 0 ? 0xc84a2a : 0x5a4ab0 }),
  );
  scene.add(m);
  caps.push(m);
}

// --- fake renderer
let shakeI = 0, shakeF = 0;
let postFn: ((r: THREE.WebGLRenderer) => void) | null = null;
const fakeR = {
  renderer, scene, camera,
  addShake(i: number, f: number) { if (i >= shakeI) { shakeI = i; shakeF = f; } },
  getBoneWorld(p: 0 | 1, bone: string, out: THREE.Vector3) {
    const f = state.fighters[p];
    out.set(f.pos.x / 1000, f.pos.y / 1000 + (bone === 'hips' ? 0.9 : 1.25), f.pos.z / 1000);
    return out;
  },
  setPostPass(fn: ((r: THREE.WebGLRenderer) => void) | null) { postFn = fn; },
};

// --- fake state
function fighter(char: CharId, x: number, side: -1 | 1): FighterState {
  return {
    char, pos: { x, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, facing: { x: -side * 1000, z: 0 }, mode: 'idle', modeFrame: 0,
    moveId: null, moveFrame: 0, pose: 'idle', hp: 1000, maxHp: 1000, redHp: 1000, ki: 300, awakened: false, awakenUsed: false, awakenTimer: 0,
    stun: 0, hitstop: 0, invuln: false, armor: false, airborne: false, comboHits: 0, comboDamage: 0, juggleScale: 1000, counterHitFlash: 0,
    stance: false, heatStacks: 0, wins: 0, side, lastInputs: [],
  };
}
const state = {
  frame: 0, seed: 1, stage: 'training', arenaHalfSize: 6000,
  fighters: [fighter('kaito', -1500, -1), fighter('shiori', 1500, 1)],
  projectiles: [] as ProjectileState[], nextProjectileId: 1,
  clash: { active: false, frame: 0, duration: 300, balance: 0, mash: [0, 0], point: { x: 0, y: 1300, z: 0 } },
  round: { number: 1, phase: 'fight', phaseFrame: 0, timer: 60, winner: -1 },
  roundsToWin: 2, camera: { center: { x: 0, y: 0, z: 0 }, normal: { x: 0, z: 1000 }, distance: 3000, cinematic: null },
  slowmo: 0, events: [] as SimEvent[], training: true, schemes: ['pro', 'pro'],
} as unknown as GameState;

const vfx = new VfxSystem(fakeR as unknown as GameRenderer);
const audio = new AudioSystem();
(window as unknown as Record<string, unknown>).vfx = vfx;
(window as unknown as Record<string, unknown>).audio = audio;

// --- event helpers
function ev(type: SimEvent['type'], o: Partial<SimEvent> = {}): SimEvent {
  return { type, frame: state.frame, player: 0, target: 1, pos: { x: 0, y: 1200, z: 0 }, ...o } as SimEvent;
}
function fire(events: SimEvent[]): void {
  state.events = events;
  vfx.handleEvents(events, state);
  audio.handleEvents(events, state);
}
const ELEMS: Element[] = ['none', 'fire', 'shadow', 'blade', 'earth', 'ki'];
let selEl: Element = 'none';
let selSt: Strength = 'heavy';

// --- projectile demos
type PK = { id: number; t: number; kind: string; el: Element; owner: 0 | 1; dir: number; r: number; speed: number; beam: boolean };
const demos: PK[] = [];
function shoot(kind: string, el: Element, speed: number, r: number, beam = false): void {
  const id = state.nextProjectileId++;
  demos.push({ id, t: 0, kind, el, owner: 0, dir: 1, r, speed, beam });
  fire([ev('projectile', { element: el, pos: { x: -1000, y: 1250, z: 0 } })]);
}
function stepDemos(dt: number): void {
  state.projectiles.length = 0;
  for (let i = demos.length - 1; i >= 0; i--) {
    const d = demos[i]!;
    d.t += dt;
    const x = -1000 + d.t * d.speed * 60;
    if (x > 2600 || d.t > 3) {
      fire([ev('projectileHit', { element: d.el, pos: { x: 1500, y: 1200, z: 0 } })]);
      demos.splice(i, 1);
      continue;
    }
    state.projectiles.push({
      id: d.id, owner: d.owner, kind: d.kind, element: d.el, pos: { x: d.beam ? Math.min(x, 1400) : x, y: 1250, z: 0 },
      vel: { x: d.speed, y: 0, z: 0 }, r: d.r, life: 100, hitsLeft: 1, beam: d.beam, moveId: 'x',
    });
  }
}

// --- UI
const panel = document.getElementById('panel')!;
function h(t: string): void { const e = document.createElement('h4'); e.textContent = t; panel.appendChild(e); }
function btn(label: string, fn: () => void): void {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => { audio.unlock(); fn(); };
  panel.appendChild(b);
}
function sel(opts: string[], init: string, cb: (v: string) => void): void {
  const s = document.createElement('select');
  for (const o of opts) { const op = document.createElement('option'); op.value = op.textContent = o; s.appendChild(op); }
  s.value = init;
  s.onchange = () => cb(s.value);
  panel.appendChild(s);
}
h('selectors');
sel(ELEMS, 'none', (v) => (selEl = v as Element));
sel(['light', 'medium', 'heavy', 'super'], 'heavy', (v) => (selSt = v as Strength));
h('hits');
btn('hit (sel)', () => fire([ev('hit', { strength: selSt, element: selEl })]));
for (const s of ['light', 'medium', 'heavy', 'super'] as Strength[]) btn('hit ' + s, () => fire([ev('hit', { strength: s, element: selEl })]));
btn('counter', () => fire([ev('counter', { strength: 'heavy', element: selEl })]));
btn('block', () => fire([ev('block', { strength: 'medium' })]));
btn('parry', () => fire([ev('parry')]));
btn('whiff', () => fire([ev('whiff', { strength: 'medium' })]));
btn('throw', () => fire([ev('throw', { strength: 'heavy' })]));
btn('throwBreak', () => fire([ev('throwBreak')]));
btn('launch', () => fire([ev('launch', { pos: { x: 1500, y: 0, z: 0 }, strength: 'heavy' })]));
btn('wallSplat', () => fire([ev('wallSplat', { pos: { x: 3200, y: 300, z: 0 }, strength: 'heavy' })]));
btn('groundBounce', () => fire([ev('groundBounce', { pos: { x: 1500, y: 0, z: 0 } })]));
btn('knockdown', () => fire([ev('knockdown', { pos: { x: 1500, y: 0, z: 0 } })]));
btn('land', () => fire([ev('land', { pos: { x: -1500, y: 0, z: 0 } })]));
h('movement');
btn('jump', () => fire([ev('jump', { pos: { x: -1500, y: 0, z: 0 } })]));
btn('dash', () => fire([ev('dash', { pos: { x: -1500, y: 0, z: 0 } })]));
btn('sidestep', () => fire([ev('sidestep', { pos: { x: -1500, y: 0, z: 0 } })]));
btn('vanish', () => {
  fire([ev('vanish', { pos: { x: -1500, y: 0, z: 0 } })]);
  state.fighters[0].pos.x = -1500;
  state.fighters[0].pos.x = 1800;
  setTimeout(() => (state.fighters[0].pos.x = -1500), 900);
});
h('specials');
btn('kiCharge on/off', () => {
  const f = state.fighters[0];
  f.mode = f.mode === 'kicharge' ? 'idle' : 'kicharge'; f.modeFrame = 0;
});
btn('awakened on/off', () => (state.fighters[0].awakened = !state.fighters[0].awakened));
btn('kiFull', () => fire([ev('kiFull', { pos: { x: -1500, y: 0, z: 0 } })]));
btn('awaken', () => fire([ev('awaken', { pos: { x: -1500, y: 0, z: 0 } })]));
btn('ultimateStart', () => fire([ev('ultimateStart', { pos: { x: -1500, y: 0, z: 0 } })]));
btn('ultimateHit', () => fire([ev('ultimateHit', { element: selEl })]));
btn('KO', () => fire([ev('ko', { pos: { x: 1500, y: 1000, z: 0 } })]));
h('rounds');
btn('roundStart', () => fire([ev('roundStart')]));
btn('fight', () => fire([ev('fight')]));
btn('timeout', () => fire([ev('timeout')]));
btn('matchEnd', () => fire([ev('matchEnd')]));
h('projectiles');
btn('fireball', () => shoot('fireball', 'fire', 18, 280));
btn('kunai', () => shoot('kunai', 'shadow', 34, 80));
btn('crescent', () => shoot('crescent', 'blade', 26, 450));
btn('boulder', () => shoot('boulder', 'earth', 14, 420));
btn('beam', () => shoot('beam', 'ki', 40, 450, true));
btn('orb', () => shoot('mystery', 'none', 20, 250));
h('beam clash');
btn('clash on/off', () => {
  state.clash.active = !state.clash.active;
  state.clash.frame = 0;
  if (state.clash.active) {
    fire([ev('clashStart')]);
  } else fire([ev('clashEnd')]);
});
sel(['-800', '-400', '0', '400', '800'], '0', (v) => (state.clash.balance = Number(v)));
btn('mash tick', () => { state.clash.mash[0] += 1; });
h('quality / a11y');
btn('low', () => vfx.setQuality('low'));
btn('medium', () => vfx.setQuality('medium'));
btn('high', () => vfx.setQuality('high'));
btn('reduce flash ON', () => vfx.setReduceFlashing(true));
btn('reduce flash OFF', () => vfx.setReduceFlashing(false));
btn('clear', () => vfx.clear());
h('music');
for (const t of ['menu', 'rooftop', 'shrine', 'training', 'victory', 'none'] as MusicTrack[]) btn(t, () => audio.music(t));
h('ui sounds');
for (const u of ['move', 'select', 'back', 'start', 'error'] as UiSound[]) btn(u, () => audio.ui(u));
h('audio');
btn('pause on', () => audio.setPaused(true));
btn('pause off', () => audio.setPaused(false));
btn('announcer off', () => (audio as unknown as { setAnnouncer?: (b: boolean) => void }).setAnnouncer?.(false));
btn('announcer on', () => (audio as unknown as { setAnnouncer?: (b: boolean) => void }).setAnnouncer?.(true));

// --- main loop
function resize(): void {
  const w = window.innerWidth, h2 = window.innerHeight;
  renderer.setSize(w, h2, false);
  camera.aspect = w / h2;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let frameAcc = 0;
const statsEl = document.getElementById('stats')!;
let frozen = false;
function renderOnce(): void {
  camera.position.copy(camBase);
  camera.lookAt(0, 1.2, 0);
  camera.updateMatrixWorld();
  renderer.autoClear = true;
  renderer.render(scene, camera);
  postFn?.(renderer);
}
/** deterministic stepping for screenshots */
function advance(sec: number, keepImpact = false): void {
  frozen = true;
  const n = Math.round(sec * 60);
  for (let i = 0; i < n; i++) {
    state.frame++;
    for (const f of state.fighters) f.modeFrame++;
    if (state.clash.active) state.clash.frame++;
    stepDemos(1 / 60);
    vfx.update(1 / 60, state);
  }
  caps[0]!.position.set(state.fighters[0].pos.x / 1000, 0.85, state.fighters[0].pos.z / 1000);
  caps[1]!.position.set(state.fighters[1].pos.x / 1000, 0.85, state.fighters[1].pos.z / 1000);
  if (!keepImpact) (vfx as unknown as { post: { impactLeft: number } }).post.impactLeft = 0;
  renderOnce();
}
function loop(): void {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (frozen) { requestAnimationFrame(loop); return; }
  frameAcc += dt * 60;
  while (frameAcc >= 1) {
    frameAcc -= 1;
    state.frame++;
    for (const f of state.fighters) f.modeFrame++;
    if (state.clash.active) state.clash.frame++;
    fire([]); // audio polls state every call
  }
  stepDemos(dt);
  caps[0]!.position.set(state.fighters[0].pos.x / 1000, 0.85, state.fighters[0].pos.z / 1000);
  caps[1]!.position.set(state.fighters[1].pos.x / 1000, 0.85, state.fighters[1].pos.z / 1000);
  // shake
  camera.position.copy(camBase);
  if (shakeF > 0) {
    camera.position.x += (Math.random() - 0.5) * shakeI * 2;
    camera.position.y += (Math.random() - 0.5) * shakeI * 2;
    shakeF -= dt * 60;
    if (shakeF <= 0) shakeI = 0;
  }
  camera.lookAt(0, 1.2, 0);
  camera.updateMatrixWorld();
  vfx.update(dt, state);
  renderer.autoClear = true;
  renderer.render(scene, camera);
  postFn?.(renderer);
  statsEl.textContent = `fps ${(1 / Math.max(dt, 1e-4)).toFixed(0)}`;
  requestAnimationFrame(loop);
}
loop();
(window as unknown as Record<string, unknown>).H = {
  fire, ev, state, shoot, demos, advance,
  hidePanel() { panel.style.display = 'none'; statsEl.style.display = 'none'; },
  unfreeze() { frozen = false; },
};
