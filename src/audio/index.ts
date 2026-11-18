// STUB — owned by the AUDIO agent. Keep these exported signatures.
import type { GameState, SimEvent } from '../sim/types';
export type UiSound = 'move' | 'select' | 'back' | 'start' | 'error';
export type MusicTrack = 'menu' | 'rooftop' | 'shrine' | 'training' | 'victory' | 'none';
export class AudioSystem {
  /** must be called from a user gesture */
  unlock(): void {}
  handleEvents(events: SimEvent[], state: GameState): void {}
  ui(s: UiSound): void {}
  music(t: MusicTrack): void {}
  setVolumes(master: number, music: number, sfx: number): void {}
  setPaused(p: boolean): void {}
}
