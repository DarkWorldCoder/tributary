'use strict';
// While a reply streams, the window receives what changed instead of the whole message every 80 ms.
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert');
const path = require('path');
const { createPatcher } = require('../core/message-patch');

const loadApply = () => import(path.join(__dirname, '..', 'ui', 'src', 'lib', 'message-patch.mjs'));
const clone = (v) => JSON.parse(JSON.stringify(v)); // what crosses IPC

test('comparison bases evict least recently used entries and misses preserve complete messages', async () => {
  const { applyPatch } = await loadApply(); const patcher = createPatcher({ maxEntries: 2 });
  const messages = ['a', 'b', 'c'].map(id => ({ id, role: 'assistant', text: id, ok: null }));
  patcher.full(messages[0]); patcher.full(messages[1]);
  messages[0].text += ' touched'; assert.ok(patcher.patch(messages[0]).text);
  patcher.full(messages[2]); assert.equal(patcher.stats().entries, 2);
  assert.equal(patcher.patch(messages[1]), null, 'b was older than the recently used a');
  const windowCopies = new Map(messages.map(m => [m.id, clone(m)]));
  for (let i = 0; i < 24; i++) {
    const m = messages[i % messages.length]; m.text += ` ${i}`; m.tools = [{ id: 'tool', output: String(i) }];
    const patch = patcher.patch(m);
    if (patch === null) { patcher.full(m); windowCopies.set(m.id, clone(m)); }
    else windowCopies.set(m.id, applyPatch(windowCopies.get(m.id), clone(patch)));
    assert.deepEqual(windowCopies.get(m.id), clone(m)); assert.equal(patcher.stats().entries, 2);
  }
  for (const m of messages) { m.ok = true; patcher.full(m); }
  assert.equal(patcher.stats().entries, 0); assert.equal(patcher.stats().accountedBytes, 0);
});

test('cache accounting bounds retained strings and structural entries without evicting for an oversized base', () => {
  const message = { id: 'a', role: 'assistant', text: 'small', tools: [], ok: null };
  const probe = createPatcher(); probe.full(message); const one = probe.stats().accountedBytes;
  const patcher = createPatcher({ maxEntries: Infinity, maxBytes: one * 2 });
  patcher.full(message); patcher.full({ ...message, id: 'b' }); patcher.full({ ...message, id: 'c' });
  assert.equal(patcher.stats().entries, 2); assert.equal(patcher.patch(message), null);
  const large = { ...message, id: 'large', text: 'x'.repeat(one * 2) };
  patcher.full(large); assert.equal(patcher.stats().entries, 2, 'one oversized reply does not evict unrelated useful bases');
  const growing = { ...message, id: 'c' }; growing.tools = Array.from({ length: one }, () => undefined);
  assert.ok(patcher.patch(growing).tools); assert.equal(patcher.patch(growing), null, 'structural slots count even when JSON values are undefined');
  assert.ok(patcher.stats().accountedBytes <= one * 2);
  patcher.forget('b'); assert.equal(patcher.stats().accountedBytes, 0);
});

test('zero budgets disable comparison retention and invalid budgets fail clearly', () => {
  const message = { id: 'a', role: 'assistant', text: 'content', ok: null };
  for (const options of [{ maxEntries: 0 }, { maxBytes: 0 }]) { const p = createPatcher(options); p.full(message); assert.equal(p.patch(message), null); assert.equal(p.stats().accountedBytes, 0); }
  for (const value of [-1, NaN, 0.5, '64']) for (const key of ['maxEntries', 'maxBytes']) assert.throws(() => createPatcher({ [key]: value }), /limits/);
});

test('large tool and metadata values use compact comparison signatures while patches carry actual values', async () => {
  const { applyPatch } = await loadApply(); const patcher = createPatcher();
  const m = { id: 'large', role: 'assistant', text: 'start', ok: null, tools: [{ id: 'tool', output: 'a'.repeat(1024 * 1024) }], details: { output: 'b'.repeat(1024 * 1024) } };
  patcher.full(m); let received = clone(m);
  assert.ok(patcher.stats().accountedBytes < 4096, 'multi-megabyte serialized comparison copies are not retained');
  assert.deepEqual(patcher.patch(m), {});
  m.text += ' more'; m.tools[0].output += '\ud800'; m.details.output += '\ud801';
  let patch = patcher.patch(m); assert.equal(patch.tools.set[0].output, m.tools[0].output); assert.deepEqual(patch.set.details, m.details);
  received = applyPatch(received, clone(patch)); assert.deepEqual(received, clone(m));
  m.tools[0].output = m.tools[0].output.slice(0, -1) + '\ud801';
  patch = patcher.patch(m); assert.ok(patch.tools); received = applyPatch(received, clone(patch)); assert.deepEqual(received, clone(m));
  delete m.details; m.tools = []; m.ok = true;
  patch = patcher.patch(m); received = applyPatch(received, clone(patch)); assert.deepEqual(received, clone(m)); assert.equal(patcher.stats().entries, 0);
});

test('user and system messages never retain streaming snapshots or serialize their fields for patch bookkeeping', () => {
  const patcher = createPatcher();
  for (const role of ['user', 'system']) {
    const message = { id: role, role, text: 'saved prompt', metadata: { toJSON() { throw new Error('Non-streaming bookkeeping should not serialize this'); } } };
    assert.doesNotThrow(() => patcher.full(message));
    assert.strictEqual(patcher.patch(message), null);
  }
  const message = { id: 'owned', role: 'assistant', text: 'stream', ok: null };
  patcher.full(message); message.text += ' update';
  assert.ok(patcher.patch(message).text);
  patcher.forget(message.id); assert.strictEqual(patcher.patch(message), null);
  patcher.full(message); message.role = 'user'; patcher.full(message);
  assert.strictEqual(patcher.patch(message), null, 'a full non-streaming replacement releases an earlier snapshot');
  message.role = 'assistant'; patcher.full(message); message.role = 'user';
  assert.strictEqual(patcher.patch(message), null, 'an event-only role replacement also releases its base');
});

function streamingTurn() {
  const m = { id: 'm1', role: 'assistant', agent: 'claude', text: '', thinking: '', tools: [], files: [], notices: [], error: null, ok: null, ts: 1 };
  const steps = [];
  for (let i = 0; i < 300; i++) {
    steps.push(() => { m.text += `word${i} `; });
    if (i % 3 === 0) steps.push(() => { m.thinking = (m.thinking + 'thinking about it '.repeat(20)).slice(-20000); });
    if (i % 25 === 0) steps.push(() => { m.tools.push({ id: `t${i}`, name: 'Bash', input: { command: `npm test -- ${i}` }, status: 'running', files: [] }); });
    if (i % 25 === 10) steps.push(() => { const t = m.tools[m.tools.length - 1]; t.status = 'done'; t.output = 'ok\n'.repeat(1000); });
    if (i === 150) steps.push(() => { m.files.push({ path: '/p/a.js', rel: 'a.js', change: 'M' }); m.plan = [{ text: 'Run tests', done: false }]; });
    if (i === 200) steps.push(() => { delete m.plan; });
  }
  return { m, steps };
}

test('patches rebuild the exact message in the window, at a fraction of the bytes', async () => {
  const { applyPatch } = await loadApply();
  const { m, steps } = streamingTurn();
  const patcher = createPatcher();
  assert.strictEqual(patcher.patch(m), null, 'a message the window has never seen goes whole');
  patcher.full(m); let windowCopy = clone(m);
  let fullBytes = 0; let patchBytes = 0;
  steps.forEach((step, i) => {
    step();
    if (i % 10 !== 9) return; // one flush per 80 ms window
    fullBytes += JSON.stringify(m).length;
    const p = patcher.patch(m);
    if (!Object.keys(p).length) return;
    patchBytes += JSON.stringify(p).length;
    windowCopy = applyPatch(windowCopy, clone(p));
    assert.deepStrictEqual(windowCopy, clone(m), `after step ${i}`);
  });
  assert.ok(patchBytes * 10 < fullBytes, `patches ${patchBytes} B vs full ${fullBytes} B`);
  m.ok = true; patcher.full(m);
  assert.strictEqual(patcher.patch(m), null, 'a finished message is forgotten');
});

test('a window that is behind ignores a patch it cannot apply, and unchanged tools keep their identity', async () => {
  const { applyPatch } = await loadApply();
  const base = { id: 'm', text: 'abc', tools: [{ id: 'a' }, { id: 'b' }] };
  assert.strictEqual(applyPatch(base, { text: { from: 10, add: 'x' } }), null);
  const next = applyPatch(base, { text: { from: 3, add: 'd' }, tools: { length: 3, set: { 2: { id: 'c' } } } });
  assert.strictEqual(next.text, 'abcd');
  assert.strictEqual(next.tools[0], base.tools[0]);
  assert.deepStrictEqual(next.tools.map((t) => t.id), ['a', 'b', 'c']);
  assert.notStrictEqual(next, base);
});

test('a real streamed turn: the window rebuilt from patches matches the hub after every update', async () => {
  require('./helpers/tmp').useCheckpointDir();
  const { applyPatch } = await loadApply();
  const fs = require('fs'); const os = require('os');
  const { Hub } = require('../core/hub'); const { MemorySecrets } = require('../core/store');
  const tmp = () => mkTmp('patch');
  const hub = new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() });
  hub.agents = [{ id: 'claude', name: 'Fake', protocol: 'claude-stream', available: true, path: process.execPath, stdinPrompt: true, args: () => [path.join(__dirname, 'fake-agent.js'), 'claude-stream'] }];
  const t = hub.createThread(tmp());
  // The same flow as desktop/main.js wireEvents, flushing after every event (the worst case).
  const patcher = createPatcher(); const windowCopies = new Map(); let patches = 0;
  hub.on('message', ({ message }) => { patcher.full(message); windowCopies.set(message.id, clone(message)); });
  hub.on('event', ({ message }) => {
    const p = patcher.patch(message);
    if (!p) { patcher.full(message); windowCopies.set(message.id, clone(message)); return; }
    if (!Object.keys(p).length) return;
    patches++;
    windowCopies.set(message.id, applyPatch(windowCopies.get(message.id), clone(p)));
    assert.deepStrictEqual(windowCopies.get(message.id), clone(message));
  });
  const m = await hub.send({ threadId: t.id, agentId: 'claude', text: 'build it', mode: 'edit' });
  assert.ok(patches >= 3, String(patches));
  assert.strictEqual(m.text, 'ECHO:build it');
  assert.deepStrictEqual(windowCopies.get(m.id), clone(m));
  hub.store.save(true);
});
