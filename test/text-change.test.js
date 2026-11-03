'use strict';
// When an agent edits the open file, the editor applies only the part that changed, so the cursor, selection,
// scroll position and folds elsewhere stay put.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const load = () => import(path.join(__dirname, '..', 'ui', 'src', 'lib', 'text-change.mjs'));
const apply = (s, c) => s.slice(0, c.from) + c.insert + s.slice(c.to);

test('the smallest replacement keeps the common start and end', async () => {
  const { minimalChange } = await load();
  assert.strictEqual(minimalChange('same', 'same'), null);
  const cases = [['one\ntwo\nthree\n', 'one\nTWO\nthree\n'], ['abc', 'abXc'], ['', 'new file\n'], ['gone\n', ''], ['a\nb\n', 'a\nb\nc\n'], ['x\ny', 'z\nx\ny'], ['aaaa', 'aa'], ['😀 hi', '😀 ho']];
  for (const [a, b] of cases) { const c = minimalChange(a, b); assert.strictEqual(apply(a, c), b, JSON.stringify([a, b, c])); }
  assert.deepStrictEqual(minimalChange('one\ntwo\nthree\n', 'one\nTWO\nthree\n'), { from: 4, to: 7, insert: 'TWO' });
});

test('changed lines are the lines of the new text that the change covers', async () => {
  const { minimalChange, changedLines } = await load();
  const after = 'one\nTWO\nthree\nfour\n';
  assert.deepStrictEqual(changedLines(after, minimalChange('one\ntwo\nthree\n', after)), { from: 2, to: 4 });
  assert.deepStrictEqual(changedLines('zero\na\n', minimalChange('a\n', 'zero\na\n')), { from: 1, to: 1 });
});
