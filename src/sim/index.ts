// STUB — owned by the SIM agent. Keep these exported signatures.
import type { GameState, MatchConfig, InputBits, CharId, CharDef, MoveDef, Capsule } from './types';
export * from './types';
export function createMatch(cfg: MatchConfig): GameState { throw new Error('sim not implemented'); }
export function step(state: GameState, inputs: [InputBits, InputBits]): void { throw new Error('sim not implemented'); }
export function serialize(state: GameState): Uint8Array { return new TextEncoder().encode(JSON.stringify(state)); }
export function deserialize(bytes: Uint8Array): GameState { return JSON.parse(new TextDecoder().decode(bytes)); }
export function cloneState(state: GameState): GameState { return JSON.parse(JSON.stringify(state)); }
export function hashState(state: GameState): number { return 0; }
export function getChar(id: CharId): CharDef { throw new Error('sim not implemented'); }
export function getMove(char: CharId, moveId: string): MoveDef | undefined { return undefined; }
export function debugBoxes(state: GameState): Capsule[] { return []; }
