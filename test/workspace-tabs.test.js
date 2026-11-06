const { test } = require('node:test');
const assert = require('node:assert/strict');
const transitions = import('../ui/src/lib/workspace-tabs.mjs');
const groups = import('../ui/src/lib/editor-groups.mjs');
const tab = (rel, overrides = {}) => ({ rel, pinned: false, dirty: false, text: rel, ...overrides });

test('preview replacement preserves pinned tabs and never replaces dirty drafts', async () => {
  const { openFileTab } = await transitions;
  const tabs = [tab('keep.ts', { pinned: true }), tab('draft.ts', { dirty: true }), tab('preview.ts')];
  const next = openFileTab(tabs, tab('next.ts'));
  assert.deepEqual(next.map((item) => item.rel), ['keep.ts', 'draft.ts', 'next.ts']);
  assert.equal(next[1], tabs[1]);
  assert.deepEqual(tabs.map((item) => item.rel), ['keep.ts', 'draft.ts', 'preview.ts']);
});

test('pinning an existing preview keeps its draft and avoids duplicate tabs', async () => {
  const { openFileTab } = await transitions;
  const draft = tab('app.ts', { text: 'local edits', dirty: true });
  const next = openFileTab([draft], tab('app.ts', { text: 'disk' }), 'pinned');
  assert.equal(next.length, 1);
  assert.equal(next[0].text, 'local edits');
  assert.equal(next[0].pinned, true);
  assert.equal(next[0].dirty, true);
  assert.equal(openFileTab(next, tab('app.ts')).length, 1);
});

test('new pinned files coexist with a single replaceable preview', async () => {
  const { openFileTab } = await transitions;
  const tabs = openFileTab([tab('preview.ts')], tab('pinned.ts'), 'pinned');
  const next = openFileTab(tabs, tab('last.ts'));
  assert.deepEqual(next.map((item) => [item.rel, item.pinned]), [['last.ts', false], ['pinned.ts', true]]);
  assert.equal(openFileTab([tab('dirty.ts', { dirty: true })], tab('next.ts')).length, 2);
});

test('closing tabs selects the nearest survivor or clears the active document', async () => {
  const { closeFileTabs } = await transitions;
  const tabs = [tab('a'), tab('b'), tab('c')];
  assert.equal(closeFileTabs(tabs, 'b', ['b']).active, 'c');
  assert.equal(closeFileTabs(tabs, 'c', ['c']).active, 'b');
  assert.equal(closeFileTabs(tabs, 'b', ['a', 'c']).active, 'b');
  assert.deepEqual(closeFileTabs(tabs, 'a', ['a', 'b', 'c']), { tabs: [], active: null });
});

test('duplicate names use distinguishing parents, including shared parent names', async () => {
  const { fileTabLabel } = await transitions;
  const paths = ['app.ts', 'src/app.ts', 'one/src/index.ts', 'two/src/index.ts'];
  assert.equal(fileTabLabel('app.ts', paths), 'app.ts · .');
  assert.equal(fileTabLabel('src/app.ts', paths), 'app.ts · src');
  assert.equal(fileTabLabel('one/src/index.ts', paths), 'index.ts · one/src');
  assert.equal(fileTabLabel('two/src/index.ts', paths), 'index.ts · two/src');
  assert.equal(fileTabLabel('notes.md', paths), 'notes.md');
});

test('editor groups select independent files and closing a view keeps its other group', async () => {
  const { editorGroups, splitEditorGroup, selectGroupFile, closeGroupFiles } = await groups;
  const original = editorGroups(['a.ts', 'b.ts'], 'a.ts');
  const split = splitEditorGroup(original);
  assert.equal(split.groups.length, 2);
  assert.deepEqual(split.groups.map(group => group.active), ['a.ts', 'a.ts']);
  const selected = selectGroupFile(split, split.focused, 'b.ts');
  assert.deepEqual(selected.groups.map(group => group.active), ['a.ts', 'b.ts']);
  const closed = closeGroupFiles(selected, 'editor-1', ['a.ts']);
  assert.equal(closed.groups[0].active, 'b.ts');
  assert.deepEqual(selected.groups[0].paths, ['a.ts', 'b.ts']);
  assert.equal(original.groups.length, 1);
});

test('joining a split preserves all unsaved file references and saved layouts validate paths', async () => {
  const { editorGroups, splitEditorGroup, selectGroupFile, joinEditorGroup, restoreEditorGroups } = await groups;
  const split = splitEditorGroup(editorGroups(['a.ts'], 'a.ts'), 'vertical');
  const selected = selectGroupFile(split, split.focused, 'draft.ts');
  const joined = joinEditorGroup(selected, selected.focused);
  assert.deepEqual(joined.groups[0].paths, ['a.ts', 'draft.ts']);
  assert.equal(joined.groups[0].active, 'draft.ts');
  assert.equal(joined.direction, 'vertical');
  assert.deepEqual(restoreEditorGroups(selected, ['a.ts', 'draft.ts'], 'draft.ts'), selected);
  const malformed = restoreEditorGroups({ focused: 'arbitrary', groups: [{ id: 'bad', paths: ['missing', 'a.ts', 'a.ts'], active: 'missing' }] }, ['a.ts', 'draft.ts'], 'a.ts');
  assert.deepEqual(malformed.groups[0].paths, ['a.ts', 'draft.ts']);
  assert.equal(malformed.groups[0].active, 'a.ts');
});
