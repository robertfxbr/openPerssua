// Conversão entre teclas apertadas e o formato de atalho do Electron
// ("CommandOrControl+Shift+X"), e o caminho inverso para exibir na tela.

// KeyboardEvent.code -> nome da tecla no formato do Electron
const NAMED_KEYS = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Backquote: '`',
};

function keyFromCode(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);           // KeyX -> X
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);         // Digit1 -> 1
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`; // Numpad1 -> num1
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;      // F1..F24
  return NAMED_KEYS[code] || null;
}

// Devolve { accelerator } quando a combinação é válida, { pending } enquanto
// só modificadores estão apertados, ou { error } quando não serve.
export function acceleratorFromEvent(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');

  const key = keyFromCode(e.code);
  if (!key) return { pending: true }; // ainda só Ctrl/Alt/Shift

  // Tecla comum sem Ctrl/Alt/Win viraria atalho global e "roubaria" a letra
  // de todos os apps. Teclas F1..F24 sozinhas são aceitas.
  const isFunctionKey = /^F\d+$/.test(key);
  const hasRealModifier = e.ctrlKey || e.altKey || e.metaKey;
  if (!isFunctionKey && !hasRealModifier) {
    return { error: 'use Ctrl, Alt ou Win junto com a tecla' };
  }
  return { accelerator: [...mods, key].join('+') };
}

// "CommandOrControl+Shift+X" -> "Ctrl+Shift+X" para mostrar na tela
export function prettyAccelerator(accelerator) {
  if (!accelerator) return 'desativado';
  return accelerator
    .replace(/CommandOrControl|CmdOrCtrl/g, 'Ctrl')
    .replace(/Super/g, 'Win')
    .replace(/\bUp\b/g, '↑')
    .replace(/\bDown\b/g, '↓')
    .replace(/\bLeft\b/g, '←')
    .replace(/\bRight\b/g, '→');
}
