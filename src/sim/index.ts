/**
 * KAKUSEI ARENA — deterministic simulation public API.
 * See docs/CONTROLS.md for every control and combat rule.
 */
import type { GameState, MatchConfig, InputBits, CharId, CharDef, MoveDef, Capsule } from './types';
import { charDef, moveDef } from '../data';
import { serializeJson, deserializeJson, cloneJson, hashJson } from '../core/serial';
import { createMatch as create } from './state';
import { step as doStep } from './step';
import { debugBoxes as boxes } from './debug';

export * from './types';

export function createMatch(cfg: MatchConfig): GameState { return create(cfg); }
/** Advance one 60 Hz frame. Mutates `state` in place; `state.events` holds this frame's events. */
export function step(state: GameState, inputs: [InputBits, InputBits]): void { doStep(state, inputs); }
export function serialize(state: GameState): Uint8Array { return serializeJson(state); }
export function deserialize(bytes: Uint8Array): GameState { return deserializeJson<GameState>(bytes); }
export function cloneState(state: GameState): GameState { return cloneJson(state); }
/** FNV-1a over the serialized state */
export function hashState(state: GameState): number { return hashJson(state); }
export function getChar(id: CharId): CharDef { return charDef(id); }
export function getMove(char: CharId, moveId: string): MoveDef | undefined { return moveDef(char, moveId); }
export function debugBoxes(state: GameState): Capsule[] { return boxes(state); }
