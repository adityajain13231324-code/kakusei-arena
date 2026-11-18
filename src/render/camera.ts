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
    const dist = Math.max(4.5, Math.min(10, 2.7 + sep * 0.95));
    const height = 1.42 + Math.min(0.3, sep * 0.04);
    const airY = Math.max(f0.y, f1.y);
    _p.copy(_c).addScaledVector(_n, dist); _p.y = height + airY * 0.4;
    _t.copy(_c); _t.y = 1.08 + airY * 0.5;
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
          const ang = (1 - k) * 2.4;
          const r = 9 - k * (9 - dist);
          _p.copy(_c).addScaledVector(_n, Math.cos(ang) * r).addScaledVector(_a.set(_n.z, 0, -_n.x), Math.sin(ang) * r);
          _p.y = 3.2 - k * (3.2 - height);
          _t.copy(_c); _t.y = 1.1;
          omegaP = 6; omegaL = 8;
          break;
        }
        case 'ultimate': {
          const ang = 0.5 + t * 0.35;
          const r = Math.max(2.0, 3.4 - t * 0.6);
          _p.copy(me).addScaledVector(_side, Math.cos(ang) * r).addScaledVector(_f, Math.sin(ang) * r * 0.8);
          _p.y = 0.55 + Math.sin(t * 0.8) * 0.1;
          _t.copy(me); _t.y = me.y + 1.25;
          fov = 46; omegaP = 5; omegaL = 10;
          break;
        }
        case 'awaken': {
          const r = Math.max(1.5, 3.2 - t * 1.2);
          _p.copy(me).addScaledVector(_f, r * 0.9).addScaledVector(_side, r * 0.45);
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
        case 'clash': {
          _p.copy(_c).addScaledVector(_n, sep * 0.75 + 5.2); _p.y = 1.8;
          _t.copy(_c); _t.y = 1.2;
          fov = 46; omegaP = 5;
          break;
        }
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
