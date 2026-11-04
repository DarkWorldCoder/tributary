'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { once } = require('node:events');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const { Hub } = require('../core/hub'); const { MemorySecrets } = require('../core/store'); const { runTurn } = require('../core/runner'); const { createParser } = require('../core/parsers'); const { BUILTIN } = require('../core/agents');
const agent = { id: 'native-claude', name: 'Native Claude fixture', available: true, protocol: 'claude-stream', controlProtocol: 'claude-stdio', stdinPrompt: true, path: process.execPath, args: () => [path.join(__dirname, 'fake-claude-control.js')] };
function setup(t, approvals = true) { const root = mkTmp('native'); const hub = new Hub({ dataDir: path.join(root, 'data'), secrets: new MemorySecrets(), home: root, approvals }); const project = path.join(root, 'project'); fs.mkdirSync(project); hub.addProject(project); hub.agents = [agent]; t.after(() => { hub.store.close(); fs.rmSync(root, { recursive: true, force: true }); }); return { hub, thread: hub.createThread(project) }; }
const request = async (hub) => { while (true) { const [value] = await once(hub, 'permission', { signal: AbortSignal.timeout(8000) }); if (value.request.status === 'pending') return value.request; } };

test('native Claude streams a plan, waits for approval, and resumes its actual session', async (t) => {
 const { hub, thread } = setup(t); const next = request(hub); const turn = hub.send({ threadId: thread.id, agentId: agent.id, text: 'RUN fixture', mode: 'edit' }); const pending = await next;
 assert.equal(pending.kind, 'execute'); assert.equal(pending.command, 'npm test'); assert.equal(hub.permissions(thread.id).length, 1);
 assert.deepEqual(thread.messages.at(-1).plan, [{ text: 'Check the project', done: false }]);
 hub.answerPermission(pending.id, 'once'); const result = await turn; assert.equal(result.ok, true); assert.match(result.text, /allow:RUN fixture/); assert.equal(hub.permissions().length, 0);
 assert.ok(Object.values(thread.agentSessions).includes('native-fixture-session'));
});
test('native Claude session allowance answers the same command once and leaves no pending requests', async (t) => {
 const { hub, thread } = setup(t); let asked = 0; hub.on('permission', ({ request }) => { if (request.status === 'pending') { asked++; hub.answerPermission(request.id, 'always'); } });
 const result = await hub.send({ threadId: thread.id, agentId: agent.id, text: 'TWICE', mode: 'edit' }); assert.equal(result.ok, true); assert.match(result.text, /allow,allow/); assert.equal(asked, 1);
 const next = await hub.send({ threadId: thread.id, agentId: agent.id, text: 'Again', mode: 'edit' }); assert.equal(next.resumed, true); assert.equal(asked, 1);
});
test('native Claude denies without an approval host and rejects file edits in Read-only', async (t) => {
 const { hub, thread } = setup(t, false); const denied = await hub.send({ threadId: thread.id, agentId: agent.id, text: 'RUN fixture', mode: 'edit' }); assert.match(denied.text, /deny:RUN fixture/);
 const { hub: readonly, thread: rt } = setup(t); const edit = await readonly.send({ threadId: rt.id, agentId: agent.id, text: 'EDIT fixture', mode: 'read' }); assert.match(edit.text, /deny:EDIT fixture/); assert.equal(readonly.permissions().length, 0); assert.ok(edit.notices.some((n) => n.includes('Read-only')));
});
test('native Claude withdrawal and stop cancel pending approvals without hanging stdin', async (t) => {
 const { hub, thread } = setup(t); const withdrawn = await hub.send({ threadId: thread.id, agentId: agent.id, text: 'WITHDRAW', mode: 'edit' }); assert.equal(withdrawn.ok, true); assert.equal(hub.permissions().length, 0); assert.equal(withdrawn.permissions[0].status, 'cancelled');
 const next = request(hub); const turn = hub.send({ threadId: thread.id, agentId: agent.id, text: 'Wait for stop', mode: 'edit' }); await next; hub.stop(thread.id); const result = await turn; assert.equal(result.ok, false); assert.equal(hub.permissions().length, 0);
});
test('native Claude tools appear as their input streams, with one final text and task plan', () => {
 const p = createParser('claude-stream'); const ev = []; const emit = (value) => ev.push(...p.line(JSON.stringify(value)));
 emit({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm' } } }); emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'shell', name: 'Bash', input: {} } } });
 assert.equal(ev.at(-1).name, 'Bash'); assert.equal(ev.at(-1).status, 'running');
 emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"npm test"}' } } }); emit({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } }); assert.equal(ev.at(-1).input.command, 'npm test');
 const args = BUILTIN.find((a) => a.id === 'claude').args({ mode: 'edit', control: true }); assert.ok(args.includes('--permission-prompt-tool')); assert.ok(args.includes('--input-format'));
});

test('native Claude questions wait for actual answers and cannot be approved as generic tools', async (t) => {
 const { hub, thread } = setup(t); const next = request(hub); const turn = hub.send({ threadId: thread.id, agentId: agent.id, text: 'QUESTION', mode: 'edit' }); const pending = await next;
 assert.equal(pending.questions[0].question, 'Which database?');
 assert.throws(() => hub.answerPermission(pending.id, 'once'), /Answer each question/);
 assert.throws(() => hub.answerPermission(pending.id, { answers: {} }), /Answer each question/);
 hub.answerPermission(pending.id, { answers: { 'Which database?': 'SQLite' } }); const result = await turn;
 assert.match(result.text, /allow:.*SQLite/); assert.equal(result.permissions[0].answers['Which database?'], 'SQLite'); assert.equal(hub.permissions().length, 0);
});

test('current Claude Task tools use structured results and only complete tasks after success', () => {
 const p = createParser('claude-stream'); const ev = []; const emit = (value) => ev.push(...p.line(JSON.stringify(value)));
 emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'create', name: 'TaskCreate', input: { subject: 'Implement parser' } }] } });
 emit({ type: 'user', tool_use_result: { task: { id: '1', subject: 'Implement parser' } }, message: { content: [{ type: 'tool_result', tool_use_id: 'create', content: 'Created task' }] } });
 assert.deepEqual(ev.at(-1), { kind: 'plan', items: [{ text: 'Implement parser', done: false }] });
 emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'update', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } }] } });
 emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'update', is_error: true, content: 'Failed update' }] } });
 assert.equal(ev.filter((e) => e.kind === 'plan').at(-1).items[0].done, false);
 emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'retry', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } }] } });
 emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'retry', content: 'Updated task' }] } });
 assert.equal(ev.at(-1).items[0].done, true);
});
test('Claude background task runs retain distinct IDs and report their real lifecycle', () => {
 const p = createParser('claude-stream'); const event = (subtype, values) => p.line(JSON.stringify({ type: 'system', subtype, task_id: 'task', ...values }));
 const first = event('task_started', { run_id: 'one', description: 'Review parser', task_type: 'local_agent' })[0]; assert.equal(first.status, 'running');
 assert.equal(event('task_progress', { run_id: 'one', summary: 'Checking tests' })[0].output, 'Checking tests');
 assert.equal(event('task_notification', { run_id: 'one', status: 'completed' })[0].status, 'done');
 assert.notEqual(event('task_started', { run_id: 'two', description: 'Review again' })[0].id, first.id);
 assert.deepEqual(event('task_started', { ambient: true }), []);
});

test('Claude text updates keep paragraph boundaries without splitting streamed words or duplicating snapshots', () => {
 const p = createParser('claude-stream'); const events = [];
 const emit = (event) => events.push(...p.line(JSON.stringify(event)));
 const stream = (event) => emit({ type: 'stream_event', event });
 stream({ type: 'message_start', message: { id: 'first' } });
 stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
 for (const text of ['I will check the ', 'draft', 's today.']) stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
 emit({ type: 'assistant', message: { id: 'first', content: [{ type: 'text', text: 'I will check the drafts today.' }] } });
 emit({ type: 'assistant', message: { id: 'tool', content: [{ type: 'tool_use', id: 'read', name: 'Read', input: { file_path: 'a.ts' } }] } });
 stream({ type: 'message_start', message: { id: 'second' } });
 stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Next, ' } });
 stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'read the code.' } });
 stream({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } });
 stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '```js\n' } });
 stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'const value = 1;\n```' } });
 emit({ type: 'assistant', message: { id: 'second', content: [{ type: 'text', text: 'Next, read the code.' }] } });
 const final = { type: 'assistant', message: { id: 'last', content: [{ type: 'text', text: 'Checks passed.\n\n' }, { type: 'text', text: 'Ready to review.' }] } };
 emit(final); emit(final);
 assert.equal(events.filter((e) => e.kind === 'text').map((e) => e.text).join(''), 'I will check the drafts today.\n\nNext, read the code.\n\n```js\nconst value = 1;\n```\n\nChecks passed.\n\nReady to review.');
});
