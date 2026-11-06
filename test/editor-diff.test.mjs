import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { editorDiff, editorDiffMarkers, editorDiffStats } from '../ui/src/lib/editor-diff.mjs';
const require = createRequire(import.meta.url); const { fileDiff } = require('../core/git');

test('full Git replacement covers changes after the review preview limit with exact counts', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-diff-scan-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.name', 'Diff test'); git('config', 'user.email', 'diff@localhost');
  const count = 4000, filename = path.join(root, 'source.ts');
  fs.writeFileSync(filename, Array.from({ length: count }, (_, i) => `old ${i}\n`).join('')); git('add', '.'); git('commit', '-qm', 'base');
  fs.writeFileSync(filename, Array.from({ length: count }, (_, i) => `new ${i}\n`).join(''));
  const result = editorDiff(await fileDiff(root, 'source.ts'));
  assert.deepEqual(result.stats, { added: count, removed: count }); assert.equal(result.markers.length, count);
  assert.deepEqual(result.markers[0], { line: 1, added: 1, removed: count }); assert.deepEqual(result.markers.at(-1), { line: count, added: 1, removed: 0 });
});
test('hunk-body header-like source text and no-newline records remain real changes', () => {
  const diff = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -3,3 +3,3 @@\n---not a file header\n-+ source\n-removed\n+++not a file header\n+- source\n+added\n\\ No newline at end of file\n';
  assert.deepEqual(editorDiffStats(diff), { added: 3, removed: 3 });
  assert.deepEqual(editorDiffMarkers(diff), [{ line: 3, added: 1, removed: 3 }, { line: 4, added: 1, removed: 0 }, { line: 5, added: 1, removed: 0 }]);
});
test('zero-count deletions, EOF anchors, implicit counts and separated hunks retain positions', () => {
  assert.deepEqual(editorDiffMarkers('--- a/a\n+++ b/a\n@@ -1,2 +0,0 @@\n-a\n-b\n'), [{ line: 1, added: 0, removed: 2 }]);
  assert.deepEqual(editorDiffMarkers('@@ -2,2 +2,2 @@\n-old\n+new\n same\n@@ -7 +7,0 @@\n-removed'), [{ line: 2, added: 1, removed: 1 }, { line: 7, added: 0, removed: 1 }]);
  assert.deepEqual(editorDiff('@@ -0,0 +1 @@\n+hello'), { markers: [{ line: 1, added: 1, removed: 0 }], stats: { added: 1, removed: 0 } });
});
test('untracked patches include every added line and metadata/binary output is not counted as source', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-diff-untracked-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'a.txt'), '++looks like a header\n世界\n\nlast');
  const result = editorDiff(await fileDiff(root, 'a.txt')); assert.deepEqual(result.stats, { added: 4, removed: 0 }); assert.equal(result.markers.at(-1).line, 4);
  for (const text of ['Binary files a/a and b/a differ', 'GIT binary patch\nliteral 12\nA123', 'Binary file. Open it in a suitable viewer.']) assert.deepEqual(editorDiff(text), { markers: [], stats: { binary: true } });
  assert.deepEqual(editorDiff('new file mode 100644\n--- a/a\n+++ b/a\n'), { markers: [], stats: { added: 0, removed: 0 } });
});
test('multiple standard file sections reset their line counters and metadata cannot add phantom lines', () => {
  const diff = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -20 +20 @@\n-c\n+d\n';
  assert.deepEqual(editorDiffStats(diff), { added: 2, removed: 2 });
  assert.deepEqual(editorDiffMarkers(diff), [{ line: 1, added: 1, removed: 1 }, { line: 20, added: 1, removed: 1 }]);
});
