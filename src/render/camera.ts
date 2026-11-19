/**
 * Tekken-style fight camera with critically-damped smoothing, scripted cinematics and shake.
 */
import * as THREE from 'three';
import type { GameState } from '../sim/types';

const _c = new THREE.Vector3(), _n = new THREE.Vector3(), _p = new THREE.Vector3(), _t = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _f = new THREE.Vector3(), _side = new THREE.Vector3();

/** critically damped spring for a vector */
class Spring3 {
  readonly x = new THREE.Vector3();
  readonly v = new THREE.Vector3();
  init = false;
  step(target: THREE.Vector3, omega: number, dt: number): THREE.Vector3 {
    if (!this.init) { this.x.copy(target); this.v.set(0, 0, 0); this.init = true; return this.x; }
    // exact critically damped update
    const e = Math.exp(-omega * dt);
    _a.subVectors(this.x, target); // displacement
    _b.copy(this.v).addScaledVector(_a, omega).multiplyScalar(dt); // (v + w*x)*dt
    this.v.addScaledVector(_b, -omega).multiplyScalar(e);
    this.x.copy(target).addScaledVector(_a.add(_b), e);
    return this.x;
  }
  snap(t: THREE.Vector3): void { this.x.copy(t); this.v.set(0, 0, 0); this.init = true; }
}

export class FightCamera {
  private pos = new Spring3();
  private look = new Spring3();
  private fov = 40;
  private roll = 0;
  private shakeAmp = 0;
  private shakeT = 0;
  private shakeDur = 1;
  private seed = Math.random() * 100;
  private lastCine: string | null = null;
  private cineT = 0;
  readonly fighterPos = [new THREE.Vector3(), new THREE.Vector3()];
  readonly fighterFacing = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1)];
  readonly normal = new THREE.Vector3(0, 0, 1);
  /** camera x/z are kept inside ±bound (stage walls / props never block the view); 0 = off */
  bound = 0;
  /** framing scale (>1 pulls back, e.g. while a fighter is in a giant form) */
  zoom = 1;

  constructor(readonly cam: THREE.PerspectiveCamera) {}

  addShake(intensity: number, frames: number): void {
    // intensity = metres of offset (≈0.012 light .. 0.2 KO)
    if (intensity >= this.shakeAmp * (this.shakeT / this.shakeDur)) {
      this.shakeAmp = intensity;
      this.shakeDur = Math.max(1, frames) / 60;
      this.shakeT = this.shakeDur;
    }
  }

  reset(): void { this.pos.init = false; this.look.init = false; this.lastCine = null; }

  update(prev: GameState | null, s: GameState, alpha: number, dt: number): void {
    const p = prev ?? s;
    const ch = s.camera;
    // centre & normal
    const cx = (p.camera.center.x + (ch.center.x - p.camera.center.x) * alpha) / 1000;
    const cz = (p.camera.center.z + (ch.center.z - p.camera.center.z) * alpha) / 1000;
    _c.set(cx, 0, cz);
    let nx = ch.normal.x, nz = ch.normal.z;
    const f0 = this.fighterPos[0], f1 = this.fighterPos[1];
    if (nx * nx + nz * nz < 1) {
      // derive from fighter axis
      _a.subVectors(f1, f0); _a.y = 0;
      if (_a.lengthSq() < 1e-6) _a.set(1, 0, 0);
      _a.normalize();
      nx = -_a.z; nz = _a.x;
      if (Math.abs(_c.x) + Math.abs(_c.z) < 1e-6) _c.addVectors(f0, f1).multiplyScalar(0.5).setY(0);
    }
    _n.set(nx, 0, nz).normalize();
    this.normal.copy(_n);
    const sep = Math.max(ch.distance / 1000, f0.distanceTo(f1));
    // ---- neutral fight framing
    // Tekken-like: both fighters head to toe with margin, camera ~1.4 m high, distance grows with separation
    const aspect = Math.max(0.5, this.cam.aspect || 16 / 9);
    const halfTan = Math.tan((40 * Math.PI) / 360);
    const needW = (sep + 2.6) / (2 * halfTan * aspect); // horizontal fit (+1.3 m margin each side)
    const dist = Math.max(5.6, Math.min(13, Math.max(3.4 + sep * 0.85, needW)));
    const height = 1.38 + Math.min(0.22, sep * 0.03);
    const airY = Math.max(f0.y, f1.y);
    const z = this.zoom;
    _p.copy(_c).addScaledVector(_n, dist * z); _p.y = height * (1 + (z - 1) * 0.8) + airY * 0.35;
    _t.copy(_c); _t.y = 1.22 * (1 + (z - 1) * 0.9) + airY * 0.45;
    let omegaP = 7, omegaL = 9;
    let fov = 40, roll = 0;
    // ---- cinematics
    const cine = ch.cinematic;
    const key = cine ? `${cine.kind}:${cine.player}` : null;
    if (key !== this.lastCine) { this.cineT = 0; this.lastCine = key; }
    this.cineT += dt;
    if (cine) {
      const t = cine.frame / 60;
      const me = this.fighterPos[cine.player], other = this.fighterPos[1 - cine.player];
      _f.subVectors(other, me).setY(0);
      if (_f.lengthSq() < 1e-6) _f.set(1, 0, 0);
      _f.normalize();
      _side.set(-_f.z, 0, _f.x);
      if (_side.dot(_n) < 0) _side.negate();
      switch (cine.kind) {
        case 'intro': {
          const k = Math.min(1, t / 3);
          const e = k * k * (3 - 2 * k);
          const ang = (1 - e) * 1.25;
          const r = 7.2 - e * (7.2 - dist);
          _p.copy(_c).addScaledVector(_n, Math.cos(ang) * r).addScaledVector(_a.set(_n.z, 0, -_n.x), Math.sin(ang) * r);
          _p.y = 2.6 - e * (2.6 - height);
          _t.copy(_c); _t.y = 1.1 + e * 0.12;
          omegaP = 6; omegaL = 8;
          break;
        }
        case 'ultimate': {
          // side-on, sweeping from behind the attacker's shoulder toward profile: never between the fighters
          const ang = -0.55 + Math.min(1, t * 0.45) * 0.75;
          const r = Math.max(2.4, 3.6 - t * 0.5);
          _p.copy(me).addScaledVector(_side, Math.cos(ang) * r).addScaledVector(_f, Math.sin(ang) * r);
          _p.y = 0.55 + Math.sin(t * 0.8) * 0.1;
          _t.copy(me); _t.y = me.y + 1.25;
          fov = 46; omegaP = 5; omegaL = 10;
          break;
        }
        case 'awaken': {
          const r = Math.max(1.7, 3.2 - t * 1.2);
          _p.copy(me).addScaledVector(_f, r * 0.55).addScaledVector(_side, r * 0.8);
          _p.y = me.y + 1.25;
          _t.copy(me); _t.y = me.y + 1.35;
          roll = 0.26; fov = 34; omegaP = 6; omegaL = 12;
          break;
        }
        case 'throw': {
          _p.copy(_c).addScaledVector(_side, 3.0).addScaledVector(_f, -0.8); _p.y = 1.1;
          _t.copy(_c); _t.y = 1.0;
          fov = 42; omegaP = 6;
          break;
        }
        case 'ko': {
          const ang = t * 0.25;
          _p.copy(_c).addScaledVector(_n, Math.cos(ang) * 4.8).addScaledVector(_a.set(_n.z, 0, -_n.x), Math.sin(ang) * 4.8);
          _p.y = 0.9;
          _t.copy(other); _t.y = 0.6;
          omegaP = 3; omegaL = 5; fov = 38;
          break;
        }
        case 'realm': {
          // Soul Realm opening: slow rising orbit around the owner, wide lens
          const ang = -0.9 + t * 0.5;
          const r = 4.2 - Math.min(1, t / 1.5) * 1.0;
          _p.copy(me).addScaledVector(_side, Math.cos(ang) * r).addScaledVector(_f, Math.sin(ang) * r);
          _p.y = 0.6 + Math.min(1, t / 1.5) * 1.4;
          _t.copy(me); _t.y = me.y + 1.3;
          fov = 50; omegaP = 4; omegaL = 8;
          break;
        }
        case 'clash': {
          _p.copy(_c).addScaledVector(_n, sep * 0.75 + 5.2); _p.y = 1.8;
          _t.copy(_c); _t.y = 1.2;
          fov = 46; omegaP = 5;
          break;
        }
      }
    }
    if (cine) {
      // keep the lens out of both bodies (min 1.25 m on the ground plane)
      for (let i = 0; i < 2; i++) {
        const q = this.fighterPos[i];
        const dx = _p.x - q.x, dz = _p.z - q.z;
        const d = Math.hypot(dx, dz);
        const minD = 1.25;
        if (d < minD) {
          if (d < 1e-4) { _p.addScaledVector(_n, minD); continue; }
          _p.x = q.x + (dx / d) * minD; _p.z = q.z + (dz / d) * minD;
        }
      }
    }
    if (this.bound > 0) {
      const b = this.bound;
      if (Math.abs(_p.x) > b || Math.abs(_p.z) > b) {
        // slide toward the look target until inside, then lift a little so the shot stays readable
        const over = Math.max(Math.abs(_p.x) - b, Math.abs(_p.z) - b);
        _p.x = THREE.MathUtils.clamp(_p.x, -b, b); _p.z = THREE.MathUtils.clamp(_p.z, -b, b);
        _p.y += Math.min(0.8, over * 0.25);
      }
    }
    this.pos.step(_p, omegaP, dt);
    this.look.step(_t, omegaL, dt);
    this.fov += (fov - this.fov) * Math.min(1, dt * 6);
    this.roll += (roll - this.roll) * Math.min(1, dt * 6);
    this.apply(dt);
  }

  /** place camera from springs + shake */
  apply(dt: number): void {
    const cam = this.cam;
    cam.position.copy(this.pos.x);
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      const k = this.shakeT / this.shakeDur;
      const a = this.shakeAmp * k * k;
      const tt = performance.now() / 1000 * 40 + this.seed;
      cam.position.x += (Math.sin(tt * 1.7) + Math.sin(tt * 3.1) * 0.5) * a;
      cam.position.y += (Math.sin(tt * 2.3 + 1) + Math.sin(tt * 4.7) * 0.5) * a;
      cam.position.z += Math.sin(tt * 1.3 + 2) * a * 0.5;
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look.x);
    if (Math.abs(this.roll) > 1e-4) cam.rotateZ(this.roll);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }

  /** direct placement (menu / snapshots) */
  set(pos: THREE.Vector3, look: THREE.Vector3, snap = false, dt = 1 / 60): void {
    if (snap) { this.pos.snap(pos); this.look.snap(look); } else { this.pos.step(pos, 3, dt); this.look.step(look, 3, dt); }
    this.fov += (40 - this.fov) * 0.1;
    this.roll = 0;
    this.apply(dt);
  }
}
