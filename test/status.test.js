'use strict';
require('./helpers/tmp').useCheckpointDir();
// Sidebar status per thread: working, needs review, failed, done. Derived from the thread's last turn.
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { threadStatus } = require('../core/status');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');

const tmp = () => mkTmp('status');
const FAKE = path.join(__dirname, 'fake-agent.js');
const thread = (last, extra = {}) => ({ messages: [{ role: 'user', text: 'x' }, { role: 'assistant', ts: 1000, durationMs: 500, notices: [], files: [], ...last }], ...extra });

test('status comes from the running list and the last turn: ok, error and changed files', () => {
  assert.strictEqual(threadStatus(thread({ ok: true }), { running: true }), 'working');
  assert.strictEqual(threadStatus(thread({ ok: null }), { running: true }), 'working');
  const asking = (status) => thread({ ok: null, permissions: [{ id: 'p1', title: 'Run npm test', status }] });
  assert.strictEqual(threadStatus(asking('pending'), { running: true }), 'permission', 'a running turn waiting on a request');
  assert.strictEqual(threadStatus(asking('allowed'), { running: true }), 'working');
  assert.strictEqual(threadStatus(asking('pending')), null, 'a request left over from a turn that is no longer running');
  assert.strictEqual(threadStatus(thread({ ok: false, error: 'Exited with code 3' })), 'failed');
  assert.strictEqual(threadStatus(thread({ ok: true })), 'done');
  assert.strictEqual(threadStatus(thread({ ok: true, files: [{ rel: 'a.js' }] })), 'review', 'changed files you have not looked at');
  assert.strictEqual(threadStatus(thread({ ok: true, files: [{ rel: 'a.js' }] }, { seenAt: 1500 })), 'done', 'opened after it finished');
  assert.strictEqual(threadStatus(thread({ ok: true, files: [{ rel: 'a.js' }] }, { seenAt: 1200 })), 'review', 'opened while it was still running');
  assert.strictEqual(threadStatus(thread({ ok: true, files: [{ rel: '/etc/hosts', external: true }] })), 'done', 'files outside the project do not count');
  assert.strictEqual(threadStatus(thread({ ok: false, notices: ['Stopped by user'] })), null, 'a stop is not a failure');
  assert.strictEqual(threadStatus(thread({ ok: false, error: 'Stopped' })), null);
  assert.strictEqual(threadStatus({ messages: [] }), null);
  assert.strictEqual(threadStatus({ messages: [{ role: 'user', text: 'x' }] }), null);
  const race = (applied) => thread({ ok: true, kind: 'race', race: { applied, candidates: [{ agent: 'a', files: ['x.js'] }, { agent: 'b', files: [] }] } });
  assert.strictEqual(threadStatus(race(null)), 'review', 'a race waits for you to pick a result');
  assert.strictEqual(threadStatus({ ...race('a'), seenAt: 9999 }), 'done');
});

test('thread summaries carry the status, and opening a thread clears "needs review"', async () => {
  const proj = tmp();
  const hub = new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() });
  const agent = (id, extra = []) => ({ id, name: id, protocol: 'codex-exec', available: true, path: process.execPath, stdinPrompt: true, args: () => [FAKE, 'codex-exec', ...extra] });
  hub.agents = [agent('edits'), agent('broken', ['--fail'])];
  hub.addProject(proj);
  const a = hub.createThread(proj); const b = hub.createThread(proj); const idle = hub.createThread(proj);
  const statuses = () => Object.fromEntries(hub.threads(proj).map((x) => [x.id, x.status]));
  const seen = []; const listed = [];
  hub.on('running', ({ threadId, running }) => { if (running) seen.push(hub.threads(proj).find((x) => x.id === threadId).status); });
  hub.on('threads', (p) => listed.push(hub.threads(p).find((x) => x.id === b.id)?.status));
  await hub.send({ threadId: a.id, agentId: 'edits', text: 'add b.txt' });
  await hub.send({ threadId: b.id, agentId: 'broken', text: 'try' });
  assert.deepStrictEqual(seen, ['working', 'working']);
  assert.strictEqual(listed.at(-1), 'failed', 'the thread list is refreshed once the run has ended');
  assert.deepStrictEqual(statuses(), { [a.id]: 'review', [b.id]: 'failed', [idle.id]: null });
  const before = hub.threads(proj).find((x) => x.id === a.id).updatedAt;
  hub.markThreadSeen(a.id);
  assert.strictEqual(statuses()[a.id], 'done');
  assert.strictEqual(hub.threads(proj).find((x) => x.id === a.id).updatedAt, before, 'opening a thread does not reorder the list');
  hub.store.save(true);
});
