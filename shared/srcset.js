export function mapSrcset(value, mapUrl) {
  const candidates = [];
  let position = 0;
  while (position < value.length) {
    while (/[\s,]/.test(value[position] || "") && position < value.length) position++;
    const start = position;
    while (position < value.length && !/\s/.test(value[position])) position++;
    let url = value.slice(start, position);
    if (!url) break;
    let descriptor = "";
    if (url.endsWith(",")) url = url.replace(/,+$/, "");
    else {
      const begin = position;
      while (position < value.length && value[position] !== ",") position++;
      descriptor = value.slice(begin, position).trim();
      position++;
    }
    candidates.push(`${mapUrl(url)}${descriptor ? ` ${descriptor}` : ""}`);
  }
  return candidates.join(", ");
}
