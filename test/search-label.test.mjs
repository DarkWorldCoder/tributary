import test from 'node:test';
import assert from 'node:assert/strict';
import { searchLabelRanges } from '../ui/src/lib/search-label.mjs';
import { extensionThemeVariables } from '../ui/src/lib/extension-theme-variables.mjs';
import { quickOpenQuery } from '../ui/src/lib/quick-open-query.mjs';

test('Quick Open separates caret locations from file names and keeps unsupported queries literal', () => {
  assert.deepEqual(quickOpenQuery(' src/main.ts:12:7 '), { file: 'src/main.ts', line: 12, column: 7 });
  assert.deepEqual(quickOpenQuery('main.ts:12'), { file: 'main.ts', line: 12, column: 1 });
  assert.deepEqual(quickOpenQuery('main.ts:'), { file: 'main.ts', line: 1, column: 1 });
  assert.deepEqual(quickOpenQuery('main.ts#4,2'), { file: 'main.ts', line: 4, column: 2 });
  assert.deepEqual(quickOpenQuery('main.ts:0:0'), { file: 'main.ts', line: 1, column: 1 });
  assert.deepEqual(quickOpenQuery('C:\\src\\main.ts:3:2'), { file: 'C:\\src\\main.ts', line: 3, column: 2 });
  for (const file of ['src/a:b.ts', 'main.ts:2-4', 'main.ts:99999999999999999999', 'main.ts:not-a-line', ':12', 'main.ts']) assert.deepEqual(quickOpenQuery(file), { file });
});

test('picker labels prefer contiguous ranges and merge adjacent letters', () => {
  assert.deepEqual(searchLabelRanges('Memory: Open Memory', 'memory'), [{ start: 0, end: 6 }]);
  assert.deepEqual(searchLabelRanges('m_e_m Memory', 'mem'), [{ start: 6, end: 9 }]);
  assert.deepEqual(searchLabelRanges('Preferences: Open Settings', 'pos'), [{ start: 0, end: 1 }, { start: 13, end: 14 }, { start: 18, end: 19 }]);
});

test('path ranges can cross the directory and basename boundary', () => {
  assert.deepEqual(searchLabelRanges('src/helper.ts', 'src/help'), [{ start: 0, end: 8 }]);
  assert.deepEqual(searchLabelRanges('src/helper.ts', 'helper'), [{ start: 4, end: 10 }]);
  assert.deepEqual(searchLabelRanges('src/helper.ts', 'missing'), []);
  assert.deepEqual(searchLabelRanges('src/helper.ts', '  '), []);
});

test('Unicode labels retain exact source offsets and never split surrogate pairs', () => {
  assert.deepEqual(searchLabelRanges('İ/😀Helper.ts', 'help'), [{ start: 4, end: 8 }]);
  assert.deepEqual(searchLabelRanges('İ/😀Helper.ts', '😀h'), [{ start: 2, end: 5 }]);
  assert.deepEqual(searchLabelRanges('İ/😀Helper.ts', 'İ'), [{ start: 0, end: 1 }]);
  assert.deepEqual(searchLabelRanges('<script>file.ts', 'script'), [{ start: 1, end: 7 }]);
});

test('installed VS Code theme colors distinguish normal and selected search matches', () => {
  const variables = extensionThemeVariables({ dark: true, colors: {
    'list.highlightForeground': '#44aaff', 'quickInputList.focusHighlightForeground': '#ffffff',
  }, tokenColors: [] });
  assert.equal(variables['--search-match-foreground'], '#44aaff');
  assert.equal(variables['--search-focus-match-foreground'], '#ffffff');
  const fallback = extensionThemeVariables({ dark: false, colors: {}, tokenColors: [] });
  assert.equal(fallback['--search-match-foreground'], undefined);
  assert.equal(fallback['--search-focus-match-foreground'], undefined);
});
