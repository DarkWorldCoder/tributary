'use strict';
// Long streamed replies are split into top-level blocks so only the last one re-renders. The split must not change the output.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { createRequire } = require('module');

const UI = path.join(__dirname, '..', 'ui');
const uiRequire = createRequire(path.join(UI, 'package.json'));
const load = () => import(path.join(UI, 'src', 'lib', 'markdown-blocks.mjs'));

async function renderer() {
  const React = uiRequire('react');
  const { renderToStaticMarkup } = uiRequire('react-dom/server');
  const { default: ReactMarkdown } = await import(uiRequire.resolve('react-markdown'));
  const { default: remarkGfm } = await import(uiRequire.resolve('remark-gfm'));
  return (t) => renderToStaticMarkup(React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, t));
}

const SAMPLES = {
  mixed: '# Plan\n\nFirst a paragraph with **bold** and `code`.\n\n## Steps\n\n1. Read the file\n2. Change it\n\n3. Run the tests\n   with a continuation line\n\n- one\n- two\n\n  indented paragraph inside the list item\n\n- three\n\n> a quote\n> on two lines\n\n> a second quote\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst a = 1;\n\n\nconst b = 2;\n```\n\n~~~\nplain fence\n\nwith a blank line\n~~~\n\n    indented code\n\n    more indented code\n\nTitle\n=====\n\nThe end.',
  openFence: 'Intro paragraph.\n\n```js\nfunction f() {\n\n  return 1;',
  nestedFence: '````md\n```js\nx\n```\n\nstill inside\n````\n\nafter',
  tight: 'Line one\nline two\n\n* a\n* b\n\n---\n\nlast',
};

test('markdown blocks: split at blank lines outside fences, keeping lists and indented lines together', async () => {
  const { splitBlocks } = await load();
  assert.deepStrictEqual(splitBlocks('short reply'), ['short reply'], 'short replies are not split');
  const blocks = splitBlocks(SAMPLES.mixed, 0);
  assert.ok(blocks.length > 8, String(blocks.length));
  assert.ok(blocks.some((b) => b.startsWith('```ts') && b.includes('\n\n\nconst b = 2;\n```')), 'blank lines inside a fence stay inside');
  assert.ok(blocks.some((b) => b.startsWith('1. Read the file') && b.includes('3. Run the tests\n   with a continuation line')), 'a list with a blank line stays one block');
  assert.ok(blocks.some((b) => b.includes('- one') && b.includes('indented paragraph') && b.endsWith('- three')), 'a loose list stays one block');
  assert.deepStrictEqual(splitBlocks('x'.repeat(2000) + '\n\n[1]: https://example.com', 0).length, 1, 'reference definitions keep the reply whole');
  assert.deepStrictEqual(splitBlocks('a\n\n[^1]: footnote', 0).length, 1);
  assert.strictEqual(blocks.join('\n\n'), SAMPLES.mixed, 'nothing is lost or reordered');
});

test('markdown blocks: rendering block by block gives the same HTML as rendering the whole reply', async () => {
  const { splitBlocks } = await load();
  const render = await renderer();
  for (const [name, text] of Object.entries(SAMPLES)) {
    const whole = render(text);
    const parts = splitBlocks(text, 0).map(render).join('');
    assert.strictEqual(parts.replace(/>\s+</g, '><'), whole.replace(/>\s+</g, '><'), name);
  }
});
