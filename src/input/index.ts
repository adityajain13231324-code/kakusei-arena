// STUB — owned by the UI/INPUT agent. Keep these exported signatures.
import type { InputBits } from '../sim/types';
export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause';
export class InputManager {
  /** current held bits for local player slot 0/1 */
  read(slot: 0 | 1): InputBits { return 0; }
  onMenu(cb: (a: MenuAction, slot: 0 | 1) => void): () => void { return () => {}; }
  attachTouch(container: HTMLElement): void {}
  setTouchVisible(v: boolean): void {}
}
