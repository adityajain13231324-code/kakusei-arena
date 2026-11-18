// Key bindings (remappable). Codes are KeyboardEvent.code values.
export type Action = 'up' | 'down' | 'left' | 'right' | 'L' | 'H' | 'K' | 'S' | 'Ult' | 'Guard';
export const ACTIONS: Action[] = ['up', 'down', 'left', 'right', 'L', 'H', 'K', 'S', 'Ult', 'Guard'];
export type Bindings = Record<Action, string[]>;

export const ACTION_LABEL: Record<Action, string> = {
  up: 'Up / Sidestep In', down: 'Down / Crouch', left: 'Left', right: 'Right',
  L: 'Light (L)', H: 'Heavy (H)', K: 'Kick (K)', S: 'Ki / Special (S)', Ult: 'Ultimate', Guard: 'Guard',
};

export const DEFAULT_P1: Bindings = {
  up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  L: ['KeyJ'], H: ['KeyK'], K: ['KeyL'], S: ['KeyI'], Ult: ['KeyU'], Guard: ['Space', 'Semicolon'],
};
export const DEFAULT_P2: Bindings = {
  up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
  L: ['Numpad1', 'Comma'], H: ['Numpad2', 'Period'], K: ['Numpad3', 'Slash'], S: ['Numpad5', 'Quote'],
  Ult: ['Numpad0', 'BracketRight'], Guard: ['NumpadEnter', 'ShiftRight'],
};

export function cloneBindings(b: Bindings): Bindings {
  const o = {} as Bindings;
  for (const a of ACTIONS) o[a] = [...(b[a] ?? [])];
  return o;
}

/** Sanitise bindings loaded from storage. */
export function sanitizeBindings(raw: unknown, def: Bindings): Bindings {
  const out = cloneBindings(def);
  if (raw && typeof raw === 'object') {
    for (const a of ACTIONS) {
      const v = (raw as Record<string, unknown>)[a];
      if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string')) out[a] = v as string[];
    }
  }
  return out;
}

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) {
    const r = code.slice(6);
    return r === 'Enter' ? 'Num Enter' : 'Num ' + r.replace('Add', '+').replace('Subtract', '-').replace('Multiply', '*').replace('Divide', '/').replace('Decimal', '.');
  }
  const map: Record<string, string> = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Space: 'Space', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', ShiftLeft: 'L Shift', ShiftRight: 'R Shift',
    ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', AltRight: 'R Alt', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab',
  };
  return map[code] ?? code;
}
