import test from 'node:test';
import assert from 'node:assert/strict';
import { toolPreview } from '../ui/src/lib/tool-preview.mjs';

test('tool cards bound multiline and huge single-line output without dropping short output', () => {
  assert.deepEqual(toolPreview('ok\n'), { text: 'ok\n', truncated: false });
  assert.deepEqual(toolPreview(undefined), { text: '', truncated: false });
  assert.deepEqual(toolPreview('one\ntwo\nthree', { lines: 2 }), { text: 'one\ntwo', truncated: true });
  const huge = toolPreview('x'.repeat(2_000_000));
  assert.equal(huge.text.length, 1800);
  assert.equal(huge.truncated, true);
  const expanded = toolPreview('x'.repeat(2_000_000), { characters: 60000, lines: 500 });
  assert.equal(expanded.text.length, 60000);
  assert.equal(expanded.truncated, true);
});

test('tool previews render ANSI output as readable text and preserve Unicode boundaries', () => {
  assert.deepEqual(toolPreview('\x1b[32mBuild passed\x1b[0m\r\n'), { text: 'Build passed\n', truncated: false });
  assert.deepEqual(toolPreview('a🙂b', { characters: 2 }), { text: 'a', truncated: true });
  assert.deepEqual(toolPreview('a🙂b', { characters: 3 }), { text: 'a🙂', truncated: true });
});
