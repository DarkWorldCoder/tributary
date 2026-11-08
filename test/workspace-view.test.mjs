import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkspaceView, patchWorkspaceViews } from '../ui/src/lib/workspace-view.mjs';
import * as before from './fixtures/workspace-view-before.mjs';

const fallback = Object.freeze({ layout: 'editor', expanded: false, panel: Object.freeze({ open: false, tab: 'files' }) });
const opened = Object.freeze({ layout: 'chat', expanded: true, panel: Object.freeze({ open: true, tab: 'review' }) });

test('workspace view normalization and patches preserve the previous persisted settings contract', () => {
  const values = [undefined, null, false, 0, '', 'chat', [], {}, fallback, opened,
    { layout: 'wrong', expanded: 1, panel: { open: 'true', tab: 'unknown' } },
    { layout: 'editor', expanded: true }, { panel: { tab: 'memory' } }];
  const patches = [undefined, null, {}, { layout: undefined }, { expanded: undefined }, { panel: undefined },
    { layout: 'chat' }, { expanded: false }, { panel: { open: true } }, { panel: { tab: 'tests' } },
    ...['files', 'review', 'changes', 'memory', 'preview', 'tests'].map(tab => ({ panel: { open: true, tab } })),
    { layout: null, expanded: 'no', panel: null }, { panel: { open: 0, tab: 'invalid' } },
    Object.create({ layout: 'chat', panel: opened.panel }), Object.defineProperty({}, 'expanded', { value: true })];
  for (const defaults of [fallback, opened]) for (const value of values) {
    assert.deepEqual(normalizeWorkspaceView(value, defaults), before.normalizeWorkspaceView(value, defaults));
    for (const patch of patches) {
      const views = Object.freeze({ '/one': value, '/other': opened });
      const next = patchWorkspaceViews(views, '/one', patch, defaults);
      assert.deepEqual(next, before.patchWorkspaceViews(views, '/one', patch, defaults));
      assert.equal(next['/other'], opened, 'unrelated projects keep their identity');
      assert.equal(views['/one'], value, 'input map is never mutated');
    }
  }
});

test('reopening an already open panel keeps the map and view without a save', () => {
  const views = Object.freeze({ '/one': opened, '/other': fallback });
  for (let i = 0; i < 1000; i++) {
    assert.equal(patchWorkspaceViews(views, '/one', { panel: { ...opened.panel } }, fallback), views);
    assert.equal(patchWorkspaceViews(views, '/one', { layout: 'chat' }, fallback), views);
    assert.equal(patchWorkspaceViews(views, '/one', { expanded: true }, fallback), views);
  }
  assert.equal(patchWorkspaceViews(views, null, { layout: 'editor' }, fallback), views);
});

test('the first explicit save is recorded and incomplete or invalid settings are repaired', () => {
  const empty = Object.freeze({});
  const saved = patchWorkspaceViews(empty, '/new', {}, fallback);
  assert.notEqual(saved, empty); assert.deepEqual(saved['/new'], fallback);
  assert.equal(patchWorkspaceViews(saved, '/new', {}, fallback), saved);
  for (const stored of [null, { layout: 'editor' }, { ...fallback, panel: { open: false, tab: 'missing' } }]) {
    const views = { '/new': stored };
    const repaired = patchWorkspaceViews(views, '/new', {}, fallback);
    assert.notEqual(repaired, views); assert.deepEqual(repaired['/new'], fallback);
  }
});

test('rapid successive updates and switching projects preserve each latest layout', () => {
  let views = { '/one': opened, '/other': fallback };
  views = patchWorkspaceViews(views, '/one', { layout: 'editor' }, fallback);
  views = patchWorkspaceViews(views, '/one', { expanded: false }, fallback);
  views = patchWorkspaceViews(views, '/other', { panel: { open: true, tab: 'tests' } }, fallback);
  assert.deepEqual(views['/one'], { layout: 'editor', expanded: false, panel: opened.panel });
  assert.deepEqual(views['/other'], { ...fallback, panel: { open: true, tab: 'tests' } });
  // Partially replacing a panel uses global defaults, not the previous tab.
  views = patchWorkspaceViews(views, '/one', { panel: { open: true } }, fallback);
  assert.equal(views['/one'].panel.tab, 'files');
  const restored = JSON.parse(JSON.stringify(views));
  assert.deepEqual(restored, views);
  assert.equal(patchWorkspaceViews(restored, '/one', { panel: { open: true, tab: 'files' } }, fallback), restored);
});
