// STUB — owned by the VFX agent. Keep these exported signatures.
import type { GameState, SimEvent } from '../sim/types';
import type { GameRenderer, Quality } from '../render';
export class VfxSystem {
  constructor(r: GameRenderer) {}
  /** spawn effects for sim events of the latest step */
  handleEvents(events: SimEvent[], state: GameState): void {}
  /** per render frame */
  update(dt: number, state: GameState): void {}
  setQuality(q: Quality): void {}
  /** turn flashing effects (impact frames) on/off for accessibility */
  setReduceFlashing(on: boolean): void {}
  clear(): void {}
}
