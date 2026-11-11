// Đổi sự kiện phím của uiohook thành nhãn dễ đọc để hiện lên video
// → { type: 'char', ch } (gõ chữ, gom thành 1 nhãn) | { type: 'combo', text } (phím tắt / phím đặc biệt) | null
const MODS = new Set(['Ctrl', 'CtrlRight', 'Alt', 'AltRight', 'Shift', 'ShiftRight', 'Meta', 'MetaRight']);
const PUNCT = {   // [thường, khi giữ Shift] — bàn phím US
  Semicolon: [';', ':'], Equal: ['=', '+'], Comma: [',', '<'], Minus: ['-', '_'], Period: ['.', '>'], Slash: ['/', '?'],
  Backquote: ['`', '~'], BracketLeft: ['[', '{'], Backslash: ['\\', '|'], BracketRight: [']', '}'], Quote: ["'", '"'],
};
const SHIFT_DIGIT = [')', '!', '@', '#', '$', '%', '^', '&', '*', '('];
const NAMES = {
  Enter: '↵ Enter', Backspace: '⌫', Delete: 'Del', Escape: 'Esc', Tab: 'Tab', Space: 'Space', CapsLock: 'Caps',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', PageUp: 'PgUp', PageDown: 'PgDn',
  Home: 'Home', End: 'End', Insert: 'Ins', PrintScreen: 'PrtSc',
};

let nameOf = null;
function keyName(code, UiohookKey) {
  if (!nameOf) { nameOf = {}; for (const [k, v] of Object.entries(UiohookKey)) if (!(v in nameOf)) nameOf[v] = k; }
  return nameOf[code] || null;
}

function label(ev, UiohookKey) {
  const name = keyName(ev.keycode, UiohookKey);
  if (!name || MODS.has(name)) return null;                    // chỉ bấm Ctrl/Shift… thì chưa hiện
  const ctrl = ev.ctrlKey, alt = ev.altKey, meta = ev.metaKey, shift = ev.shiftKey;
  const mods = [ctrl && 'Ctrl', alt && 'Alt', meta && 'Win', shift && 'Shift'].filter(Boolean);
  const plain = !ctrl && !alt && !meta;
  // gõ chữ / số / dấu bình thường → gom thành chuỗi
  if (plain) {
    if (/^[A-Z]$/.test(name)) return { type: 'char', ch: shift ? name : name.toLowerCase() };
    if (/^[0-9]$/.test(name)) return { type: 'char', ch: shift ? SHIFT_DIGIT[+name] : name };
    if (PUNCT[name]) return { type: 'char', ch: PUNCT[name][shift ? 1 : 0] };
    if (name === 'Space') return { type: 'char', ch: ' ' };
  }
  let key = NAMES[name] || name.replace(/^Numpad/, 'Num ').replace(/^(\w)/, c => c.toUpperCase());
  if (/^[A-Z0-9]$/.test(name)) key = name;
  if (PUNCT[name]) key = PUNCT[name][0];
  const showShift = shift && (!plain || !NAMES[name] || name === 'Tab' || name === 'Enter');
  const parts = [...mods.filter(m => m !== 'Shift' || showShift), key];
  return { type: 'combo', text: parts.join(' + ') };
}

module.exports = { label };
