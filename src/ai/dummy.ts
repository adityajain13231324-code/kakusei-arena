import { Btn, type GameState, type InputBits } from '../sim/types';

export type DummyMode = 'stand' | 'crouch' | 'jump' | 'guardAll' | 'randomGuard';

/** Deterministic training dummy (pure function of state; no Math.random). */
export function dummyInput(state: GameState, player: 0 | 1, mode: DummyMode): InputBits {
  const f = state.fighters[player];
  const back = f.side === -1 ? Btn.Left : Btn.Right;
  switch (mode) {
    case 'stand': return 0;
    case 'crouch': return Btn.Down;
    case 'jump': { const t = state.frame % 100; return t < 3 || (t >= 6 && t < 12) ? Btn.Up : 0; } // double-tap Up = neutral jump
    case 'guardAll': return back | Btn.Guard;
    case 'randomGuard': {
      // blocks in 30-frame blocks chosen by a hash of the frame bucket; crouch-guards lows by reading the attacker
      const bucket = Math.floor(state.frame / 40);
      const h = Math.imul(bucket + 1, 2654435761) >>> 0;
      return (h >>> 8) % 100 < 60 ? back | Btn.Guard : 0;
    }
  }
}
