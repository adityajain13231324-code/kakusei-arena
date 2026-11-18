/**
 * KAKUSEI ARENA CPU opponent. Public API:
 *   new CpuController(player, difficulty).think(state) -> raw screen-relative InputBits
 *   dummyInput(state, player, mode) -> InputBits for the training dummy
 */
export { CpuController } from './controller';
export type { Difficulty } from './profiles';
export { dummyInput } from './dummy';
export type { DummyMode } from './dummy';
