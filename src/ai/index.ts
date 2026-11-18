// STUB — owned by the AI agent. Keep these exported signatures.
import type { GameState, InputBits } from '../sim/types';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'nightmare';
/** Deterministic CPU controller. Must only use state + its own plain-data memory. */
export class CpuController {
  constructor(public player: 0 | 1, public difficulty: Difficulty) {}
  think(state: GameState): InputBits { return 0; }
}
