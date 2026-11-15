export function decodeCssUrl(value) {
  return value.replace(/\\(?:([0-9a-f]{1,6})[ \t\r\n\f]?|(\r\n|[\n\r\f])|([\s\S]))/gi, (_escape, hex, newline, character) => {
    if (hex) {
      const code = parseInt(hex, 16);
      return String.fromCodePoint(code === 0 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff ? 0xfffd : code);
    }
    return newline ? "" : character;
  });
}
