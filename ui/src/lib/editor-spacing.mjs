// Infer indentation from existing source without rewriting it. These defaults
// also work for plain-text languages without a syntax grammar.
export function editorSpacing(path, text = '') {
  const name = String(path).replaceAll('\\', '/').split('/').pop();
  const ext = name.split('.').pop().toLowerCase();
  const make = /^(?:GNUmakefile|Makefile|makefile)$/.test(name) || ext === 'mk';
  const fallback = /^(?:py|pyi|rs|c|h|cc|cpp|hpp|cs|java|kt|kts|swift|php|zig)$/.test(ext) ? 4 : 2;
  let tabs = 0; let spaces = 0; const widths = [];
  for (const line of text.slice(0, 128 * 1024).split('\n').slice(0, 2000)) {
    const prefix = /^[ \t]+(?=\S)/.exec(line)?.[0]; if (!prefix) continue;
    if (prefix.startsWith('\t')) tabs++;
    else if (!prefix.includes('\t') && prefix.length <= 32) { spaces++; widths.push(prefix.length); }
  }
  const useTabs = make || tabs > spaces || !tabs && !spaces && ext === 'go';
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const detected = widths.reduce(gcd, 0);
  const tabSize = useTabs ? ext === 'go' ? 8 : 4 : detected >= 1 && detected <= 8 ? detected : fallback;
  return { useTabs, tabSize, indentUnit: useTabs ? '\t' : ' '.repeat(tabSize) };
}
