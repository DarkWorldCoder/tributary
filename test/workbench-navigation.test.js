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


test('explorer changes stay in the open folder and keep unsaved drafts separate from Git', async () => {
  const { explorerDecorations } = await import('../ui/src/lib/explorer-decorations.mjs');
  const git = { root: '/repo', changed: [{ path: 'web/src/main.ts', code: ' M' }, { path: 'web/src/new.ts', code: '??' }, { path: 'server/main.ts', code: ' M' }, { path: '../private.ts', code: ' M' }] };
  const result = explorerDecorations('/repo/web', git, ['src/main.ts', 'local-only.ts']);
  assert.equal(result.files.get('src/main.ts').label, 'Modified'); assert.equal(result.files.get('src/main.ts').dirty, true);
  assert.equal(result.files.get('src/new.ts').code, 'A'); assert.equal(result.files.get('local-only.ts').code, undefined);
  assert.equal(result.files.has('server/main.ts'), false); assert.equal(result.files.has('../private.ts'), false); assert.ok(result.folders.has('src'));
  assert.equal(explorerDecorations('/unrelated', git).files.size, 0);
  assert.equal(explorerDecorations('C:\\Repo\\web', { root: 'c:/repo', changed: [{ path: 'web/src/main.ts', code: 'A ' }] }).files.get('src/main.ts').code, 'A');
});

test('workspace change lists scope repository paths, retain counts, and classify conflicts and renames', async () => {
  const { workspaceChanges } = await import('../ui/src/lib/workspace-changes.mjs');
  const git = { root: '/repo', branch: 'main', changed: [
    { path: 'web/a.ts', code: 'M', added: 4, removed: 2 },
    { path: 'web/deleted.ts', code: 'D' }, { path: 'web/new.ts', code: '??' },
    { path: 'web/renamed.ts', from: 'web/old.ts', code: 'R' },
    { path: 'web/conflict.ts', code: 'UU' }, { path: 'web/both.ts', code: 'AA' },
    { path: 'web-sibling/no.ts', code: 'M' }, { path: 'api/no.ts', code: 'M' },
    { path: '../escape.ts', code: 'M' }, { path: '/private.ts', code: 'M' }, { path: 'C:/private.ts', code: 'M' },
  ] };
  const list = workspaceChanges('/repo/web', git);
  assert.deepEqual(list.map((file) => [file.rel, file.status]), [['a.ts', 'M'], ['both.ts', 'U'], ['conflict.ts', 'U'], ['deleted.ts', 'D'], ['new.ts', 'A'], ['renamed.ts', 'R']]);
  assert.equal(list[0].added, 4); assert.equal(list[0].removed, 2);
  assert.equal(list.at(-1).from, 'web/old.ts'); assert.equal(list.find((file) => file.rel === 'new.ts').added, undefined);
  assert.deepEqual(workspaceChanges('/other', git), []); assert.deepEqual(workspaceChanges('/repo', null), []);
  assert.equal(workspaceChanges('C:\\Repo\\Web', { root: 'c:/repo', changed: [{ path: 'web/a.ts', code: 'M' }] })[0].rel, 'a.ts');
});
