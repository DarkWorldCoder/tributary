// Infer indentation from existing source without rewriting it. These defaults
// also work for plain-text languages without a syntax grammar.
const nonWhitespace = /\S/;
const gcd = (a, b) => { while (b) { const remainder = a % b; a = b; b = remainder; } return a; };
export function editorSpacing(path, text = '') {
  const name = String(path).replaceAll('\\', '/').split('/').pop();
  const ext = name.split('.').pop().toLowerCase();
  const make = /^(?:GNUmakefile|Makefile|makefile)$/.test(name) || ext === 'mk';
  const fallback = /^(?:py|pyi|rs|c|h|cc|cpp|hpp|cs|java|kt|kts|swift|php|zig)$/.test(ext) ? 4 : 2;
  if (make) return { useTabs: true, tabSize: 4, indentUnit: '\t' };
  let tabs = 0; let spaces = 0; let detected = 0;
  const sample = text.slice(0, 128 * 1024);
  // Scan the same bounded prefix without creating an array/string per line.
  for (let start = 0, row = 0; row < 2000; row++) {
    const newline = sample.indexOf('\n', start), end = newline < 0 ? sample.length : newline;
    let at = start, mixed = false;
    while (at < end && (sample.charCodeAt(at) === 32 || sample.charCodeAt(at) === 9)) { mixed ||= sample.charCodeAt(at) === 9; at++; }
    if (at > start && at < end && nonWhitespace.test(sample[at])) {
      if (sample.charCodeAt(start) === 9) tabs++;
      else if (!mixed && at - start <= 32) { spaces++; detected = gcd(detected, at - start); }
    }
    if (newline < 0) break;
    start = newline + 1;
  }
  const useTabs = tabs > spaces || !tabs && !spaces && ext === 'go';
  const tabSize = useTabs ? ext === 'go' ? 8 : 4 : detected >= 1 && detected <= 8 ? detected : fallback;
  return { useTabs, tabSize, indentUnit: useTabs ? '\t' : ' '.repeat(tabSize) };
}
