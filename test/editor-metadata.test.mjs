import test from 'node:test';
import assert from 'node:assert/strict';
import { editorSpacing } from '../ui/src/lib/editor-spacing.mjs';
import { formatParser, formattingHint } from '../ui/src/lib/format-document.mjs';
import { changedLines, minimalChange, textAfterChanges } from '../ui/src/lib/text-change.mjs';
import { ChangeSet, Text } from '../ui/node_modules/@codemirror/state/dist/index.js';

// Previous split/regex implementations are deliberately kept as independent
// oracles for the bounded index scans and their existing sampling boundaries.
function previousSpacing(path, text = '') {
  const name = String(path).replaceAll('\\', '/').split('/').pop(), ext = name.split('.').pop().toLowerCase();
  const make = /^(?:GNUmakefile|Makefile|makefile)$/.test(name) || ext === 'mk';
  const fallback = /^(?:py|pyi|rs|c|h|cc|cpp|hpp|cs|java|kt|kts|swift|php|zig)$/.test(ext) ? 4 : 2;
  let tabs = 0, spaces = 0; const widths = [];
  for (const line of text.slice(0, 128 * 1024).split('\n').slice(0, 2000)) {
    const prefix = /^[ \t]+(?=\S)/.exec(line)?.[0]; if (!prefix) continue;
    if (prefix.startsWith('\t')) tabs++; else if (!prefix.includes('\t') && prefix.length <= 32) { spaces++; widths.push(prefix.length); }
  }
  const useTabs = make || tabs > spaces || !tabs && !spaces && ext === 'go';
  const gcd = (a, b) => b ? gcd(b, a % b) : a, detected = widths.reduce(gcd, 0);
  const tabSize = useTabs ? ext === 'go' ? 8 : 4 : detected >= 1 && detected <= 8 ? detected : fallback;
  return { useTabs, tabSize, indentUnit: useTabs ? '\t' : ' '.repeat(tabSize) };
}
function previousHint(path, text) {
  const lines = text.slice(0, 128 * 1024).split('\n');
  if (lines.some(line => line.length > 300)) return 'Long lines';
  return ['babel', 'typescript'].includes(formatParser(path, text)) && lines.some(line => /\btry\s*\{.+\}\s*catch\b/.test(line) || line.length > 100 && /;[^;]+;/.test(line)) ? 'Compact code' : null;
}
const previousLines = (after, change) => { const from = after.slice(0, change.from).split('\n').length; return { from, to: from + change.insert.replace(/\n$/, '').split('\n').length - 1 }; };
let seed = 613;
const pick = values => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return values[Math.floor(seed / 4294967296 * values.length)]; };

test('spacing scans preserve mixed indentation, Unicode whitespace, width and line/prefix limits', () => {
  const paths = ['a.rs', 'a.go', 'Makefile', 'folder\\GNUmakefile', 'a.MK', 'a.py', 'a.js', '.env', 'unknown'];
  const prefixes = ['', ' ', '  ', '    ', '      ', '\t', '\t ', ' \t ', ' '.repeat(32), ' '.repeat(33), '  \u00a0', ' \u2028', '  \ufeff'];
  const cases = ['', '\n', '   \n\t\r\n', '  a\n\tb', '  a\n    b\n      c', '\n'.repeat(1999) + '   x\n\ty', 'x'.repeat(128 * 1024 - 3) + '\n  x', 'x'.repeat(128 * 1024 - 4) + '\n  x', '\n'.repeat(2000) + '\tx'];
  for (let i = 0; i < 2000; i++) cases.push(Array.from({ length: 12 }, () => pick(prefixes) + pick(['name', 'नेपाली', '😀', '\r', '', ' '])).join(pick(['\n', '\r\n'])));
  for (const text of cases) for (const path of paths) assert.deepEqual(editorSpacing(path, text), previousSpacing(path, text), `${path}: ${JSON.stringify(text.slice(0, 100))}`);
});

test('format hints preserve line boundaries, long-line priority and bounded sampling', () => {
  const cases = ['', 'try { x(); } catch {}', 'try\n{ x(); }\ncatch {}', 'try { x(); }\r catch {}', 'try { x(); }\u2028catch {}', 'try { a\u2028b } catch {}', 'try { x(); } catch {}\n' + 'x'.repeat(301), 'x'.repeat(100) + ';a;', 'x'.repeat(128 * 1024) + '\ntry { x(); } catch {}'];
  const chunks = ['try', 'entry', ' catch', '\n', '\r', '\t', '\u2028', '\u2029', '\u00a0', ' {', ' }', ';x;', ';;', 'let value=0;', 'a'.repeat(101), 'a'.repeat(301), '😀'];
  for (let i = 0; i < 3000; i++) cases.push(Array.from({ length: 20 }, () => pick(chunks)).join(''));
  for (const text of cases) for (const path of ['a.js', 'a.ts', 'a.py', 'notes.md', '.prettierrc']) assert.equal(formattingHint(path, text), previousHint(path, text), `${path}: ${JSON.stringify(text.slice(0, 150))}`);
});

test('change highlighting uses the same line ranges with or without the editor line index', () => {
  const chunks = ['a', '\n', '\r\n', '😀', 'नेपाली', 'x\n\n', '\t', ''];
  const pairs = [['a\nb\nc\n', 'a\nB\nc\nd\n'], ['a\n', ''], ['', '\n\n'], ['a', 'a\n'], ['a', '']];
  for (let i = 0; i < 3000; i++) pairs.push([Array.from({ length: 12 }, () => pick(chunks)).join(''), Array.from({ length: 12 }, () => pick(chunks)).join('')]);
  for (const [before, after] of pairs) {
    const change = minimalChange(before, after); if (!change) continue;
    const expected = previousLines(after, change);
    assert.deepEqual(changedLines(after, change), expected);
    assert.deepEqual(changedLines(after, change, expected.from), expected);
  }
});

test('canonical text updates match CodeMirror for multiple edits and UTF-16 edge cases', () => {
  const cases = [
    ['before\nsecond\n', [{ from: 0, insert: 'start\r\n' }, { from: 8, to: 10, insert: '😀' }]],
    ['entire document', { from: 0, to: 15, insert: 'x' }],
    ['abcdef', { from: 1, to: 6 }], ['abcdef', { from: 0, to: 6 }],
    ['abcdef', { from: 0, to: 6, insert: '\ud800' }],
    ['', { from: 0, insert: 'new\nfile' }], ['abc', []],
  ];
  for (let i = 0; i < 2000; i++) {
    const before = Array.from({ length: 20 }, () => pick(['a', '\n', '\ud800', '\udc00', '😀', 'नेपाली', '\t'])).join('');
    const first = Math.floor(before.length / 3), last = Math.floor(before.length * 2 / 3);
    cases.push([before, [{ from: 0, to: first, insert: pick(['', 'new\r\n', '\ud800', '😀']) }, { from: last, to: before.length, insert: pick(['tail', '\n', '\udc00', '']) }]]);
  }
  for (const [before, spec] of cases) {
    const changes = ChangeSet.of(spec, before.length), doc = Text.of(before.split('\n'));
    assert.equal(textAfterChanges(before, changes), changes.apply(doc).toString());
  }
  const original = 'one\ntwo\nthree', first = ChangeSet.of({from: 4, to: 7, insert: 'TWO'}, original.length), second = ChangeSet.of({from: 0, insert: 'start\n'}, first.newLength), composed = first.compose(second);
  assert.equal(textAfterChanges(original, composed), second.apply(first.apply(Text.of(original.split('\n')))).toString());
  assert.throws(() => textAfterChanges('wrong', ChangeSet.empty(1)), /does not match/);
});
