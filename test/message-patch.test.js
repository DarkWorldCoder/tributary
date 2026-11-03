'use strict';
// While a reply streams, the window receives what changed instead of the whole message every 80 ms.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { createPatcher } = require('../core/message-patch');

const loadApply = () => import(path.join(__dirname, '..', 'ui', 'src', 'lib', 'message-patch.mjs'));
const clone = (v) => JSON.parse(JSON.stringify(v)); // what crosses IPC

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
  process.env.TRIBUTARY_CHECKPOINT_DIR = process.env.TRIBUTARY_CHECKPOINT_DIR || require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'tributary-ckpt-'));
  const { applyPatch } = await loadApply();
  const fs = require('fs'); const os = require('os');
  const { Hub } = require('../core/hub'); const { MemorySecrets } = require('../core/store');
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-patch-'));
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
