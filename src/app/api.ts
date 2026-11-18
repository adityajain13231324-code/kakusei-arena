import type { CharId, ControlScheme, StageId } from '../sim/types';
import type { Difficulty } from '../ai';
import type { AudioSystem } from '../audio';
import type { InputManager } from '../input';
import type { GameRenderer } from '../render';
import type { VfxSystem } from '../vfx';
import type { UI } from '../ui/router';
import type { SettingsStore } from './settings';
import type { MatchSession } from './session';

export type Mode = 'arcade' | 'versus' | 'training';

export interface Flow {
  mode: Mode;
  difficulty: Difficulty;
  p1: CharId; p2: CharId; stage: StageId;
  schemes: [ControlScheme, ControlScheme];
  ladder: CharId[]; ladderIndex: number;
  arcadeFrames: number;
}

/** What screens may call on the application shell. */
export interface AppApi {
  settings: SettingsStore;
  audio: AudioSystem;
  input: InputManager;
  renderer: GameRenderer | null;
  vfx: VfxSystem | null;
  ui: UI;
  flow: Flow;
  session: MatchSession | null;
  startFromTitle(): void;
  goMenu(): void;
  chooseMode(m: Mode): void;
  setDifficulty(d: Difficulty): void;
  pickChars(p1: CharId, p2: CharId, schemes: [ControlScheme, ControlScheme]): void;
  pickStage(s: StageId): void;
  pause(): void;
  resume(): void;
  quitToMenu(): void;
  rematch(): void;
  nextFight(): void;
  toCharSelect(): void;
  applySettings(): void;
  menuScene(chars: CharId[] | null, stage?: StageId): void;
  toast(msg: string): void;
  openMoveList(): void;
}
