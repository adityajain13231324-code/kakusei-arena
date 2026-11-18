// STUB — owned by the RENDER agent. Keep these exported signatures.
import * as THREE from 'three';
import type { GameState, Capsule, CharId, StageId } from '../sim/types';
export type Quality = 'low' | 'medium' | 'high';
export type BoneName = 'head' | 'chest' | 'hips' | 'handL' | 'handR' | 'footL' | 'footR' | 'weapon';
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  /** world-space camera shake offset added after camera placement (vfx writes via addShake) */
  constructor(canvas: HTMLCanvasElement) { this.renderer = new THREE.WebGLRenderer({ canvas }); }
  async loadMatch(state: GameState): Promise<void> {}
  /** prev/state = last two sim states, alpha = interpolation 0..1, dt = real seconds since last call */
  update(prev: GameState | null, state: GameState, alpha: number, dt: number): void {}
  render(): void {}
  resize(w: number, h: number, pixelRatio: number): void {}
  setQuality(q: Quality): void {}
  setDebugBoxes(boxes: Capsule[] | null): void {}
  addShake(intensity: number, frames: number): void {}
  getBoneWorld(player: 0 | 1, bone: BoneName, out: THREE.Vector3): THREE.Vector3 { return out; }
  /** called each render() after the scene is drawn; vfx uses it for screen-space post effects */
  setPostPass(fn: ((r: THREE.WebGLRenderer) => void) | null): void {}
  /** standalone menu scene: shows a character posing on a turntable, for title/char select */
  showMenuScene(chars: CharId[] | null, stage?: StageId): void {}
  /** returns a PNG data URL portrait of a character (for char select cards) */
  snapshotCharacter(id: CharId, size: number): string { return ''; }
  getStats(): { drawCalls: number; triangles: number } { return { drawCalls: 0, triangles: 0 }; }
  dispose(): void {}
}
