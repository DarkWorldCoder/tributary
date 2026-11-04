'use strict';
require('./helpers/tmp').useCheckpointDir();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter, once } = require('node:events');
const { mkdtemp } = require('./helpers/tmp');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');
const { createPatcher } = require('../core/message-patch');
const { parseNumstat } = require('../core/change-stats');
const clone = (value) => JSON.parse(JSON.stringify(value));

function fixture(t) {
  const root = mkdtemp('reply-position');
  const hub = new Hub({ dataDir: mkdtemp('reply-store'), home: root, secrets: new MemorySecrets() });
  t.after(() => { hub.fileWatches.close(); hub.store.close(); });
  const thread = hub.createThread(root);
  const message = { id: 'reply', role: 'assistant', agent: 'fixture', text: '', thinking: '', thinkingLength: 0, trace: [], tools: [], files: [], notices: [], permissions: [], ok: null };
  thread.messages.push(message);
  return { hub, thread, message, apply: (event) => hub.apply(thread, message, event) };
}

test('thinking, tools, approvals and reply text retain their stream order without duplicate tool updates', async (t) => {
  const { hub, thread, message, apply } = fixture(t);
  apply({ kind: 'thinking', text: 'Initial thought.' });
  apply({ kind: 'text', text: 'First paragraph.\n\n' });
  apply({ kind: 'tool', id: 'read', name: 'Read', status: 'running', input: { file_path: 'a.ts' } });
  apply({ kind: 'tool', id: 'read', name: 'Read', status: 'done', output: 'source' });
  apply({ kind: 'text', text: 'Second paragraph.\n\n' });
  const answer = hub.askPermission(thread, message, { id: 'fixture' }, { title: 'Test', kind: 'execute', command: 'test', options: [] }, new AbortController().signal);
  apply({ kind: 'tool', id: 'test', name: 'Bash', status: 'running', input: { command: 'test' } });
  hub.answerPermission(message.permissions[0].id, 'once'); await answer;
  apply({ kind: 'thinking', text: 'Final thought.' });
  apply({ kind: 'text', text: 'Final paragraph.' });
  const { replySegments, thinkingExcerpt } = await import('../ui/src/lib/reply-segments.mjs');
  const parts = replySegments(message.text, message.permissions, message.trace);
  assert.deepEqual(parts.map((part) => part.kind), ['activity', 'text', 'activity', 'text', 'permission', 'activity', 'text']);
  assert.equal(parts.filter((part) => part.kind === 'text').map((part) => part.text).join(''), message.text);
  assert.equal(message.trace.filter((entry) => entry.kind === 'tool').length, 2);
  assert.equal(thinkingExcerpt(message, message.trace[0]), 'Initial thought.');
  assert.equal(thinkingExcerpt(message, message.trace.at(-1)), 'Final thought.');
  assert.equal(message.tools[0].status, 'done');
});

test('bounded thinking ranges and incremental activity patches survive streamed updates and removal', async (t) => {
  const { message, apply } = fixture(t);
  const { applyPatch } = await import('../ui/src/lib/message-patch.mjs');
  const { thinkingExcerpt } = await import('../ui/src/lib/reply-segments.mjs');
  const patcher = createPatcher(); patcher.full(message); let windowCopy = clone(message);
  for (let i = 0; i < 40; i++) {
    apply({ kind: 'thinking', text: 'x'.repeat(1000) });
    if (i % 4 === 0) apply({ kind: 'text', text: `Paragraph ${i}.\n\n` });
    const patch = clone(patcher.patch(message));
    windowCopy = applyPatch(windowCopy, patch);
    assert.deepEqual(windowCopy, clone(message));
  }
  assert.equal(message.thinking.length, 20000);
  assert.equal(thinkingExcerpt(message, message.trace[0]), '');
  assert.ok(thinkingExcerpt(message, message.trace.at(-1)).length > 0);
  delete message.trace;
  windowCopy = applyPatch(windowCopy, clone(patcher.patch(message)));
  assert.deepEqual(windowCopy, clone(message));
});

test('continuous file writes are published while writing continues, rather than only after the last write', async (t) => {
  const root = mkdtemp('live-writing'); const file = path.join(root, 'active.ts'); fs.writeFileSync(file, 'before');
  const events = new EventEmitter(); const { FileWatches } = require('../core/file-watch');
  const watches = new FileWatches((event) => events.emit('change', event)); t.after(() => watches.close());
  await watches.start(root, ['active.ts']);
  let writes = 0;
  const timer = setInterval(() => { fs.writeFileSync(file, `write ${++writes}`); }, 30); t.after(() => clearInterval(timer));
  const [event] = await once(events, 'change', { signal: AbortSignal.timeout(1500) });
  assert.ok(event.paths.includes('active.ts')); assert.ok(writes >= 2); assert.ok(writes < 45);
});

test('line counts preserve unusual filenames and distinguish binary changes', async (t) => {
  const weird = 'src/a\tline\nbreak.ts';
  assert.deepEqual(parseNumstat(`2\t3\t${weird}\0-\t-\timage.png\0`).get(weird), { added: 2, removed: 3 });
  assert.deepEqual(parseNumstat('-\t-\timage.png\0').get('image.png'), { binary: true });
  const root = mkdtemp('turn-counts');
  const git = (args) => require('node:child_process').execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git(['init', '-q']); fs.writeFileSync(path.join(root, 'code.ts'), 'one\ntwo\n'); git(['add', '-A']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'initial']);
  fs.writeFileSync(path.join(root, 'code.ts'), 'one\ntwo\npreexisting\n');
  const { createCheckpoint, changeStatsBetween } = require('../core/checkpoint');
  const before = await createCheckpoint(root, 'before');
  fs.writeFileSync(path.join(root, 'code.ts'), 'one\nreplacement\npreexisting\nnew\n');
  fs.writeFileSync(path.join(root, 'new.ts'), 'new file\n');
  const after = await createCheckpoint(root, 'after');
  const counts = await changeStatsBetween(root, before, after);
  assert.deepEqual(counts.get('code.ts'), { added: 2, removed: 1 });
  assert.deepEqual(counts.get('new.ts'), { added: 1, removed: 0 });
  const status = await require('../core/git').gitInfo(root);
  assert.deepEqual({ added: status.changed.find((file) => file.path === 'code.ts').added, removed: status.changed.find((file) => file.path === 'code.ts').removed }, { added: 3, removed: 1 });
});

test('editor change markers anchor additions and deletions to actual source lines', async () => {
  const { editorDiffMarkers } = await import('../ui/src/lib/editor-diff.mjs');
  assert.deepEqual(editorDiffMarkers('--- a/a.ts\n+++ b/a.ts\n@@ -2,2 +2,2 @@\n-old\n+new\n same\n@@ -7,1 +7,0 @@\n-removed'), [{ line: 2, added: 1, removed: 1 }, { line: 7, added: 0, removed: 1 }]);
});

test('Follow retries a newly created file when its tool finishes', async () => {
  const { followedFile } = await import('../ui/src/lib/workbench-navigation.mjs');
  const message = { id: 'reply', role: 'assistant', ok: null, tools: [{ id: 'write', name: 'Write', status: 'running', input: { file_path: 'new.ts' } }] };
  const first = followedFile({ messages: [message] }, '/repo'); message.tools[0].status = 'done';
  const next = followedFile({ messages: [message] }, '/repo');
  assert.equal(next.rel, first.rel); assert.notEqual(next.key, first.key);
});
