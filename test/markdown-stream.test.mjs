import test from 'node:test';
import assert from 'node:assert/strict';
import { splitBlocks } from '../ui/src/lib/markdown-blocks.mjs';
import { createMarkdownStream, MARKDOWN_GROUP_SIZE } from '../ui/src/lib/markdown-stream.mjs';

const samples = [
  '# Heading\n\nFirst paragraph.\n\n- first\n   \n- second\n\n  continued\n\nEnd.\n',
  'Intro\n\n````md\n```js\na\n\n```\n\ninside\n````\n\nAfter.\n',
  '~~~ts\nconst n = 1;\n\n\nconst next = 2;\n~~~\n\nEnd.',
  '```bad`info\n\nnot a fence\n\n[id]: https://example.com',
  'a\n\n[^note]:\n  explanation\n\nuse [^note]',
  'a\r\n\r\n```js\r\nlet n = 1;\r\n```\r\n\r\nend',
  '\n \n\t\n', '😀\ud800\n\nsecond \udfff\ufeff\0\n\nthird', 'a\u2028[x]:\n\nreference',
];
test('every streamed prefix preserves the legacy fence/list/definition/UTF-16 split and prior snapshots', () => {
  for (const source of samples) {
    const stream = createMarkdownStream(), history = [];
    for (let n = 0; n <= source.length; n++) {
      const value = source.slice(0, n), expected = splitBlocks(value, 0);
      assert.deepEqual(stream.split(value, 0), expected, JSON.stringify(value));
      assert.deepEqual(stream.groups(value, 0).flat(), expected);
      if (n % 17 === 0) history.push({ groups: stream.groups(value, 0), expected });
    }
    for (const entry of history) assert.deepEqual(entry.groups.flat(), entry.expected);
  }
});
test('arbitrary edits, rewinds, threshold changes and interleaved flat/group reads remain exact', () => {
  let random = 4287; const pick = n => { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; return (random >>> 0) % n; };
  const parts = ['text', '\n', '\n\n', ' ', '\t', '\r', '\u2028', '```', '~~~', '`info', '[x]: ', '[^f]:\n', '- item', '1. step', '  continuation', '😀', '\ud800', '| a | b |', '# heading'];
  const stream = createMarkdownStream(); let text = '';
  for (let n = 0; n < 3000; n++) {
    if (pick(7) === 0) text = text.slice(0, pick(text.length + 1));
    if (pick(9) === 0) { const at = pick(text.length + 1); text = text.slice(0, at) + parts[pick(parts.length)] + text.slice(at); }
    else text += parts[pick(parts.length)];
    const min = [0, 20, 1500, Infinity][pick(4)], expected = splitBlocks(text, min);
    if (n % 2) { assert.deepEqual(stream.groups(text, min).flat(), expected); assert.deepEqual(stream.split(text, min), expected); }
    else { assert.deepEqual(stream.split(text, min), expected); if (n % 3) assert.deepEqual(stream.groups(text, min).flat(), expected); }
  }
});
test('completed groups retain identity, while threshold and edit invalidation cannot reuse stale groups', () => {
  const prefix = Array.from({ length: MARKDOWN_GROUP_SIZE * 3 }, (_, n) => `Paragraph ${n}.\n\n`).join('');
  const stream = createMarkdownStream(), first = stream.groups(prefix, 0);
  const next = stream.groups(prefix + 'new tail', 0);
  assert.equal(next[0], first[0]); assert.equal(next[1], first[1]); assert.notEqual(next.at(-1), first.at(-1));
  assert.deepEqual(first.flat(), splitBlocks(prefix, 0));
  const manyShort = 'a\n\n'.repeat(400); stream.groups(manyShort, 1500);
  assert.deepEqual(stream.groups(manyShort + 'b'.repeat(400), 1500).flat(), splitBlocks(manyShort + 'b'.repeat(400), 1500));
  stream.groups(prefix, Infinity); assert.deepEqual(stream.groups(prefix, 0).flat(), splitBlocks(prefix, 0));
  const changed = prefix.replace('Paragraph 0.', 'Edited first paragraph.');
  assert.deepEqual(stream.groups(changed, 0).flat(), splitBlocks(changed, 0));
  stream.reset(); assert.deepEqual(stream.groups('fresh', 0).flat(), ['fresh']);
});
test('late reference definitions fall back to the complete document and edits can leave fallback', () => {
  const stream = createMarkdownStream(), prefix = 'paragraph\n\n'.repeat(200);
  stream.groups(prefix); assert.equal(stream.split(prefix + '[x]:').length, 201);
  assert.deepEqual(stream.groups(prefix + '[x]:\n').flat(), [prefix + '[x]:\n']);
  assert.deepEqual(stream.split(prefix + '[x]:\nnext'), [prefix + '[x]:\nnext']);
  assert.deepEqual(stream.groups(prefix + 'ordinary tail').flat(), splitBlocks(prefix + 'ordinary tail'));
});
