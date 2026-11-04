'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { activityOf } = require('../core/activity');

test('activity counts approvals separately and reads live task dependencies with real file counts', async () => {
  const { activityCounts } = await import('../ui/src/lib/collaboration-view.mjs');
  const message = { id: 'm', role: 'assistant', agent: 'a', permissions: [{ status: 'pending' }], tools: [{ name: 'read', input: { filePath: 'a.ts' } }], files: [{ rel: 'a.ts', added: 4, removed: 2 }] };
  const hub = { running: new Map([['t', {}]]), teams: new Map(), thread: () => ({ title: 'task', project: '/p', messages: [message] }) };
  let entries = activityOf(hub); assert.equal(entries[0].workers[0].state, 'waiting'); assert.equal(entries[0].workers[0].attention, true);
  assert.deepEqual(activityCounts(entries), { running: 0, waiting: 0, attention: 1, done: 0, total: 1, files: 1 });
  delete message.permissions; entries = activityOf(hub); assert.match(entries[0].workers[0].doing, /a.ts/); assert.equal(entries[0].workers[0].files[0].added, 4);
  message.kind = 'manager'; message.manager = { tasks: [{ id: 'first', title: 'API', agent: 'a', state: 'failed' }, { id: 'next', title: 'UI', agent: 'b', state: 'waiting', dependsOn: ['first'] }] };
  entries = activityOf(hub); assert.deepEqual(entries[0].workers[1].dependsOn, [{ id: 'first', title: 'API', state: 'failed' }]); assert.equal(entries[0].workers[1].task, 'UI');
});

test('finished activity retains failed/skipped task outcomes and never guesses success from disappearance', async () => {
  const { finishedActivity } = await import('../ui/src/lib/collaboration-view.mjs');
  const entry = { threadId: 't', workers: ['a', 'b', 'c', 'missing'].map((taskId) => ({ key: taskId, taskId, messageId: 'm', state: 'working', files: [] })) };
  const thread = { messages: [{ id: 'm', ok: true, manager: { tasks: [{ id: 'a', state: 'done', files: [{ rel: 'a.ts', added: 2, removed: 1 }] }, { id: 'b', state: 'failed', note: 'Tests failed' }, { id: 'c', state: 'skipped', note: 'Dependency failed' }] } }] };
  const final = finishedActivity(entry, thread); assert.deepEqual(final.workers.map((worker) => worker.state), ['done', 'failed', 'skipped', 'stopped']); assert.equal(final.workers[0].files[0].added, 2); assert.equal(final.workers[1].note, 'Tests failed');
  assert.ok(finishedActivity(entry, null).workers.every((worker) => worker.state === 'stopped'));
});

test('team steps preserve a native pending approval instead of displaying working', () => {
  const message = { id: 'm', role: 'assistant', agent: 'a', permissions: [{ status: 'pending' }], files: [] };
  const hub = { running: new Map([['t', {}]]), teams: new Map([['t', { recipe: 'build-review', steps: [{ messageId: 'm', role: 'builder', state: 'running' }] }]]), thread: () => ({ title: 'task', project: '/p', messages: [message] }) };
  const worker = activityOf(hub)[0].workers[0]; assert.equal(worker.state, 'waiting'); assert.equal(worker.attention, true);
});
