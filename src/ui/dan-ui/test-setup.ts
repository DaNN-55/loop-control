// jsdom omits this browser API, which React Aria uses for collection IDs.
// Keep the browser implementation untouched; provide CSSOM escaping in tests.
if (!globalThis.CSS?.escape) {
  const escape = (value: string) => Array.from(String(value), (char, index) => {
    const code = char.codePointAt(0)!;
    if (code === 0) return '\uFFFD';
    if (code < 32 || code === 127 || index === 0 && /[0-9]/.test(char) || index === 1 && /[0-9]/.test(char) && value[0] === '-') return `\\${code.toString(16)} `;
    if (index === 0 && char === '-' && value.length === 1) return '\\-';
    return code >= 128 || /[a-zA-Z0-9_-]/.test(char) ? char : `\\${char}`;
  }).join('');
  Object.defineProperty(globalThis, 'CSS', {value: {...globalThis.CSS, escape}, configurable: true});
}
