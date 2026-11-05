import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectorySession, directoryTarget, rememberDirectoryCount, shouldRevealDirectorySelection } from '../ui/src/lib/directory-session.mjs';
import { captureTreeViewport, restoreTreeViewport } from '../ui/src/lib/tree-viewport.mjs';

test('directory navigation survives page-data release and interrupted Show more', () => {
  const session = createDirectorySession();
  rememberDirectoryCount(session, 'src', false, 521);
  assert.equal(directoryTarget(session, 'src', false, 0, 0), 521);
  assert.equal(directoryTarget(session, 'src', true, 0, 0), 200);
  assert.equal(directoryTarget(session, 'other', false, 200, 200), 400);
  assert.equal(directoryTarget(session, 'other', false, 0, 0), 400);
  rememberDirectoryCount(session, 'src', false, 35);
  assert.equal(directoryTarget(session, 'src', false, 0, 0), 200);
  assert.ok([...session.counts.values()].every(Number.isInteger));
  assert.equal(shouldRevealDirectorySelection(session, 'src/a.ts'), true);
  session.focusPath = 'src/z.ts';
  assert.equal(shouldRevealDirectorySelection(session, 'src/a.ts'), false);
  assert.equal(session.focusPath, 'src/z.ts');
  assert.equal(shouldRevealDirectorySelection(session, 'src/b.ts'), true);
  assert.equal(shouldRevealDirectorySelection(session, null), true);
});

test('viewport capture uses bounded hit tests and retains only root/path/position data', () => {
  let tests = 0;
  const sticky = { dataset: { treePath: 'src' }, position: 'sticky' };
  const row = { dataset: { treePath: 'src/a["x"].ts' }, position: 'static', closest: () => ({ dataset: { treeProject: '/two' } }), getBoundingClientRect: () => ({ top: 113 }) };
  const element = { scrollTop: 500, scrollLeft: 30, contains: () => true, getBoundingClientRect: () => ({ top: 100, left: 0, width: 224, height: 600 }), ownerDocument: { defaultView: { getComputedStyle: e => ({ position: e.position }) }, elementFromPoint: () => ({ closest: () => ++tests === 1 ? sticky : row }) } };
  assert.deepEqual(captureTreeViewport(element), { top: 500, left: 30, anchor: { project: '/two', path: 'src/a["x"].ts', offset: 13 } });
  assert.equal(tests, 2);
});

test('scroll restoration disambiguates workspace roots and follows inserted rows', () => {
  const row = (project, top) => ({ dataset: { treePath: 'src/a.ts' }, closest: () => ({ dataset: { treeProject: project } }), getBoundingClientRect: () => ({ top }) });
  const element = { scrollTop: 500, scrollLeft: 0, querySelectorAll: () => [row('/one', 999), row('/two', 137)], getBoundingClientRect: () => ({ top: 100 }) };
  restoreTreeViewport(element, { top: 500, left: 30, anchor: { project: '/two', path: 'src/a.ts', offset: 13 } });
  assert.equal(element.scrollTop, 524); assert.equal(element.scrollLeft, 30);
  element.querySelectorAll = () => [];
  restoreTreeViewport(element, { top: 500, left: 10, anchor: { project: '/two', path: 'deleted.ts', offset: 0 } });
  assert.equal(element.scrollTop, 500); assert.equal(element.scrollLeft, 10);
});
