'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const navigation = import('../ui/src/lib/workbench-navigation.mjs');
test('file switching keeps recent order and drops replaced preview tabs', async () => {
  const { recentFiles } = await navigation;
  assert.deepEqual(recentFiles(['a.ts', 'b.ts', 'c.ts'], ['b.ts', 'old.ts', 'a.ts'], 'c.ts'), ['c.ts', 'b.ts', 'a.ts']);
  assert.deepEqual(recentFiles(['a.ts'], [], null), ['a.ts']);
});
test('folder-chain candidates stop at files and branching directories', async () => {
  const { folderChains } = await navigation;
  const chains = folderChains(['src/a/b/main.ts', 'lib/a.ts', 'lib/nested/b.ts']);
  assert.deepEqual(chains.get('src'), ['src', 'src/a', 'src/a/b']); assert.equal(chains.has('lib'), false);
  assert.ok([...folderChains(['a/b/c/d/e/f/g/h/i/j/k/file.ts']).values()].every((chain) => chain.length <= 8));
});
test('Follow agent accepts current-project file activity and excludes unrelated paths', async () => {
  const { followedFile } = await navigation;
  const thread = (input, name = 'Read', ok = null) => ({ messages: [{ id: 'm1', role: 'assistant', ok, tools: [{ id: 't1', name, input }], files: [] }] });
  assert.equal(followedFile(thread({ file_path: '/repo/src/a.ts' }), '/repo').rel, 'src/a.ts');
  assert.equal(followedFile(thread({ path: 'src/a.ts' }, 'read_file'), '/repo').rel, 'src/a.ts');
  for (const file_path of ['/other/private.ts', '../escape.ts', 'src/../escape.ts', 'https://example.com/a.ts', 'bad\0file']) assert.equal(followedFile(thread({ file_path }), '/repo'), null);
  assert.equal(followedFile(thread({ path: 'src' }, 'read_directory'), '/repo'), null);
  assert.equal(followedFile(thread({ file_path: 'a.ts' }, 'Read', true), '/repo'), null);
});
test('document outlines locate functions and types across JavaScript, TypeScript, Python, Rust and Go', async () => {
  const { outlineCode } = await import('../ui/src/lib/code-outline.mjs');
  const examples = [
    ['a.js', 'function hello() {}\nconst arrow = () => {};\nclass Box { method() {} }', ['hello', 'arrow', 'Box', 'method']],
    ['a.ts', 'interface User { name: string }\nfunction hello(user:User) {}', ['User', 'hello']],
    ['a.py', 'class Box:\n def hello(self): pass\n', ['Box', 'hello']],
    ['a.rs', 'struct Box {x:i32}\nfn hello() {}\nimpl Box { fn method() {} }', ['Box', 'hello', 'impl Box', 'method']],
    ['a.go', 'package main\nfunc hello() {}\ntype Box struct { x int }', ['hello', 'Box']],
  ];
  for (const [path, text, names] of examples) { const items = await outlineCode(path, text); assert.deepEqual(items.map((x) => x.name), names, path); assert.ok(items.every((x) => x.line >= 1 && x.column >= 1)); }
  assert.deepEqual(await outlineCode('a.ts', 'x'.repeat(512 * 1024 + 1)), []);
  assert.equal(await outlineCode('a.bin', 'arbitrary'), null);
});

test('Markdown outlines exclude headings inside fenced code blocks', async () => {
  const { outlineCode } = await import('../ui/src/lib/code-outline.mjs');
  const items = await outlineCode('README.md', '# Real\n\n```js\n# not-heading\n```\n\n## Child\n');
  assert.deepEqual(items.map((item) => [item.name, item.line]), [['Real', 1], ['Child', 7]]);
});
