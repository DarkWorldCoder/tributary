'use strict';
require('./helpers/tmp').useCheckpointDir();
// Fewer things to watch: one list of the conversations that need you, most urgent first; system notifications only
// when an agent is blocked; and the computer stays awake while agents run.
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');
const { shouldNotify, keepAwake } = require('../core/attention');

const tmp = () => mkTmp('att');
const turn = (extra) => ({ id: Math.random().toString(36).slice(2), role: 'assistant', agent: 'claude', text: '', tools: [], files: [], notices: [], ok: true, ts: Date.now(), durationMs: 10, ...extra });

test('what needs you: approvals first, then failures, then changes you have not looked at, across projects', async () => {
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  const a = tmp(); const b = tmp(); hub.addProject(a); hub.addProject(b);
  const review = hub.createThread(a); review.title = 'Unseen changes'; review.messages.push(turn({ files: [{ path: path.join(a, 'x.js'), rel: 'x.js', external: false }] }));
  const failed = hub.createThread(b); failed.title = 'Broke'; failed.messages.push(turn({ ok: false, error: 'boom' }));
  const checks = hub.createThread(a); checks.title = 'Checks failed'; checks.messages.push(turn({ files: [{ path: path.join(a, 'y.js'), rel: 'y.js', external: false }], verify: { state: 'failed', command: 'npm test', hash: 'x' } }));
  const waiting = hub.createThread(b); waiting.title = 'Waiting'; waiting.messages.push(turn({ ok: null, permissions: [{ id: 'p', status: 'pending' }] }));
  const done = hub.createThread(a); done.title = 'Done'; done.messages.push(turn({})); done.seenAt = Date.now() + 1000;
  hub.running.set(waiting.id, new AbortController());
  const list = hub.attention();
  assert.deepStrictEqual(list.map((x) => [x.title, x.status]), [['Waiting', 'permission'], ['Checks failed', 'failed'], ['Broke', 'failed'], ['Unseen changes', 'review']]);
  assert.strictEqual(list[0].project, b);
  hub.running.delete(waiting.id); hub.store.save(true);
});

test('system notifications only when you are needed, unless you ask for finished turns too', () => {
  assert.ok(shouldNotify({ kind: 'permission' }, {}));
  assert.ok(shouldNotify({ kind: 'failed' }, {}));
  assert.ok(shouldNotify({ kind: 'attention' }, {}));
  assert.ok(!shouldNotify({ kind: 'done' }, {}));
  assert.ok(!shouldNotify({ kind: 'info' }, {}));
  assert.ok(shouldNotify({ kind: 'done' }, { notifyDone: true }));
});

test('the computer is kept awake while any agent runs, unless you turn that off', () => {
  const calls = []; let n = 0;
  const blocker = { start: (type) => { calls.push(['start', type]); return ++n; }, stop: (id) => calls.push(['stop', id]) };
  const hub = Object.assign(new EventEmitter(), { running: new Map(), teams: new Map(), store: { data: { settings: {} } } });
  keepAwake(blocker, hub);
  hub.running.set('a', 1); hub.emit('running', { threadId: 'a', running: true });
  hub.running.set('b', 1); hub.emit('running', { threadId: 'b', running: true });
  hub.running.delete('a'); hub.emit('running', { threadId: 'a', running: false });
  assert.deepStrictEqual(calls, [['start', 'prevent-app-suspension']], 'one blocker while any run');
  hub.running.delete('b'); hub.emit('running', { threadId: 'b', running: false });
  assert.deepStrictEqual(calls.at(-1), ['stop', 1]);
  hub.store.data.settings.keepAwake = false;
  hub.running.set('c', 1); hub.emit('running', { threadId: 'c', running: true });
  assert.strictEqual(calls.length, 2, 'off means off');
});
