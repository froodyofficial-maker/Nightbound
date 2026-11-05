// Changeable keybinds. The game's input code is written against the default keys; every key the
// player presses is translated back to the default key of the action it's bound to, so the
// rest of the game never needs to know about bindings.
export const ACTIONS = [
  { id: 'forward', label: 'Move forward', def: 'KeyW' },
  { id: 'back', label: 'Move back', def: 'KeyS' },
  { id: 'left', label: 'Move left', def: 'KeyA' },
  { id: 'right', label: 'Move right', def: 'KeyD' },
  { id: 'run', label: 'Run', def: 'ShiftLeft', alt: ['ShiftRight'] },
  { id: 'crouch', label: 'Crouch', def: 'ControlLeft', alt: ['KeyC'] },
  { id: 'interact', label: 'Interact (hold)', def: 'KeyE' },
  { id: 'space', label: 'Vault / jump / skill check / unhook attempt', def: 'Space' },
  { id: 'item', label: 'Ghost trap · Possess / let go (Chucky)', def: 'KeyG' },
  { id: 'ability2', label: 'Second power (killers)', def: 'KeyR' },
  { id: 'drop', label: 'Drop survivor (killers)', def: 'KeyQ' },
  { id: 'execute', label: 'Execute (killers) · Web Swing (Spider-Man) · next player (spectating)', def: 'KeyF' },
  { id: 'split', label: 'Soul Split (Chucky)', def: 'KeyV' },
  { id: 'takeover', label: 'Take over a bot (after dying)', def: 'KeyT' },
  { id: 'emotes', label: 'Emotes (survivors)', def: 'KeyB' },
  { id: 'shoulder', label: 'Swap camera shoulder', def: 'KeyH' },
  { id: 'status', label: 'Status / scoreboard (hold)', def: 'Tab' },
];
const BY_ID = Object.fromEntries(ACTIONS.map(a => [a.id, a]));
export const bound = (settings, id) => (settings && settings.keys && settings.keys[id]) || BY_ID[id].def;

// pressed key -> the default key the game understands (null: the key does nothing now)
export function remapCode(settings, code) {
  const keys = settings && settings.keys;
  if (!keys || !Object.keys(keys).length) return code;
  for (const a of ACTIONS) if (bound(settings, a.id) === code) return a.def;
  for (const a of ACTIONS) {
    const custom = keys[a.id] && keys[a.id] !== a.def;
    if (custom && (code === a.def || (a.alt || []).includes(code))) return null; // its old key is free now
  }
  return code;
}

// readable key names: KeyE -> E, ShiftLeft -> Shift, ControlLeft -> Ctrl, Digit3 -> 3, ...
export function keyName(code) {
  if (!code) return '?';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return 'Num ' + code.slice(6);
  const map = { ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'Alt', AltRight: 'R-Alt', Space: 'Space', Tab: 'Tab', CapsLock: 'Caps', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Enter: 'Enter', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  return map[code] || code.replace(/(Left|Right)$/, '');
}
export const label = (settings, id) => keyName(bound(settings, id));
// the movement keys as one label: "WASD" when they're all single letters
export function moveLabel(settings) {
  const ks = ['forward', 'left', 'back', 'right'].map(id => label(settings, id));
  return ks.every(k => k.length === 1) ? ks.join('') : ks.join('/');
}
// keys that can't be bound (menus, emote numbers)
export const RESERVED = new Set(['Escape', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'MetaLeft', 'MetaRight', 'F5', 'F11', 'F12']);
