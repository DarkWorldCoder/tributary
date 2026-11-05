// Keep collapsed command cards small, including tools that return a single huge line.
export function toolPreview(value, { lines = 6, characters = 1800 } = {}) {
  if (typeof value !== 'string' || !value) return { text: '', truncated: false };
  const bounded = value.slice(0, characters + 256);
  const clean = bounded.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r\n/g, '\n');
  let end = Math.min(characters, clean.length);
  let count = 0;
  for (let i = 0; i < end; i++) {
    if (clean[i] === '\n' && ++count === lines) { end = i; break; }
  }
  // Avoid ending a preview halfway through a surrogate pair.
  if (end > 0 && /[\uD800-\uDBFF]/.test(clean[end - 1])) end--;
  return { text: clean.slice(0, end), truncated: end < clean.length || bounded.length < value.length };
}
