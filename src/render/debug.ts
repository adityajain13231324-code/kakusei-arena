/** Pooled wireframe capsules for the hitbox viewer. */
import * as THREE from 'three';
import type { Capsule } from '../sim/types';

const COLORS: Record<Capsule['kind'], number> = { hit: 0xff3030, hurt: 0x30ff60, throw: 0x3080ff, projectile: 0xff9a20 };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

interface Item { g: THREE.Group; cyl: THREE.Mesh; s0: THREE.Mesh; s1: THREE.Mesh }

export class DebugBoxes {
  readonly group = new THREE.Group();
  private pool: Item[] = [];
  private mats = new Map<string, THREE.MeshBasicMaterial>();
  private cylGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
  private sphGeo = new THREE.SphereGeometry(1, 12, 8);

  constructor() { this.group.name = 'debug-boxes'; this.group.renderOrder = 50; }

  private mat(kind: Capsule['kind']): THREE.MeshBasicMaterial {
    let m = this.mats.get(kind);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: COLORS[kind], wireframe: true, transparent: true, opacity: 0.85, depthTest: false, fog: false, toneMapped: false });
      this.mats.set(kind, m);
    }
    return m;
  }

  set(boxes: Capsule[] | null): void {
    const n = boxes ? boxes.length : 0;
    while (this.pool.length < n) {
      const m = this.mat('hurt');
      const it: Item = { g: new THREE.Group(), cyl: new THREE.Mesh(this.cylGeo, m), s0: new THREE.Mesh(this.sphGeo, m), s1: new THREE.Mesh(this.sphGeo, m) };
      for (const x of [it.cyl, it.s0, it.s1]) { x.renderOrder = 50; x.frustumCulled = false; }
      it.g.add(it.cyl, it.s0, it.s1);
      this.group.add(it.g);
      this.pool.push(it);
    }
    for (let i = 0; i < this.pool.length; i++) {
      const it = this.pool[i];
      if (!boxes || i >= n) { it.g.visible = false; continue; }
      const c = boxes[i];
      const m = this.mat(c.kind);
      it.cyl.material = m; it.s0.material = m; it.s1.material = m;
      it.g.visible = true;
      _a.set(c.a.x, c.a.y, c.a.z).multiplyScalar(0.001);
      _b.set(c.b.x, c.b.y, c.b.z).multiplyScalar(0.001);
      const r = Math.max(0.005, c.r * 0.001);
      _d.subVectors(_b, _a);
      const len = _d.length();
      it.s0.position.copy(_a); it.s0.scale.setScalar(r);
      it.s1.position.copy(_b); it.s1.scale.setScalar(r);
      it.cyl.visible = len > 1e-4;
      if (len > 1e-4) {
        it.cyl.position.addVectors(_a, _b).multiplyScalar(0.5);
        it.cyl.quaternion.setFromUnitVectors(_up, _d.divideScalar(len));
        it.cyl.scale.set(r, len, r);
      }
    }
  }

  dispose(): void {
    this.cylGeo.dispose(); this.sphGeo.dispose();
    for (const m of this.mats.values()) m.dispose();
    this.group.removeFromParent();
  }
}
