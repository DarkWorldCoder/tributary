'use strict';
require('./helpers/tmp').useCheckpointDir();
// The live view: every agent at work across conversations, teams and races, what it is doing and what it changed.
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');

const tmp = () => mkTmp('activity');
const repo = () => {
  const d = tmp(); execFileSync('git', ['init', '-q'], { cwd: d });
  fs.writeFileSync(path.join(d, 'a.txt'), 'one\n');
  execFileSync('git', ['add', '.'], { cwd: d }); execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: d });
  return d;
};
// Hold work until its activity is observed, including on slow worktree setup.
// The gate lives outside the project so it cannot affect diffs or race merges.
const slow = (id, gate) => ({
  id, name: id, protocol: 'codex-exec', available: true, path: process.execPath, stdinPrompt: true,
  args: () => ['-e', `const out = (o) => console.log(JSON.stringify(o));
    out({ type: 'thread.started', thread_id: 's' });
    out({ type: 'item.started', item: { id: 'c1', type: 'command_execution', command: 'npm test', status: 'in_progress' } });
    require('fs').appendFileSync('a.txt', 'edited by ${id}\\n');
    out({ type: 'item.completed', item: { id: 'f1', type: 'file_change', changes: [{ path: require('path').resolve('a.txt'), kind: 'update' }], status: 'completed' } });
    const timer = setInterval(() => { if (!require('fs').existsSync(${JSON.stringify(gate)})) return; clearInterval(timer); out({ type: 'item.completed', item: { id: 'i', type: 'agent_message', text: 'done' } }); out({ type: 'turn.completed' }); }, 10);`],
});
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 25)); } };

test('the live view shows each running agent, what it is doing and the files it changed, with a live diff', async () => {
  const one = repo(); const two = repo();
  const hub = new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() });
  const gate = path.join(tmp(), 'release');
  hub.agents = [slow('alpha', gate), slow('beta', gate)];
  const a = hub.createThread(one, 'Fix the parser'); const b = hub.createThread(two, 'Add tests');
  const events = []; hub.on('activity', (x) => events.push(x));
  const runs = [hub.send({ threadId: a.id, agentId: 'alpha', text: 'go' }), hub.send({ threadId: b.id, agentId: 'beta', text: 'go' })];
  try {
    await until(() => hub.activity().length === 2 && hub.activity().every((e) => e.workers[0]?.files.length));

    const now = hub.activity();
    const entry = now.find((e) => e.threadId === a.id);
    assert.strictEqual(entry.title, 'Fix the parser');
    assert.strictEqual(entry.kind, 'turn');
    assert.strictEqual(entry.project, one);
    const [w] = entry.workers;
    assert.strictEqual(w.agent, 'alpha'); assert.strictEqual(w.state, 'working');
    assert.match(w.doing, /npm test/);
    assert.deepStrictEqual(w.files.map((f) => f.rel), ['a.txt']);
    assert.match(await hub.turnDiff(a.id, w.messageId, 'a.txt'), /\+edited by alpha/, 'the file diff is readable while the agent is still working');
    await until(() => events.some((x) => x.length === 2)); // the window is told as work starts (at most 4 times a second)

  } finally { fs.writeFileSync(gate, 'release'); await Promise.all(runs); }
  await until(() => events.at(-1)?.length === 0);
  assert.deepStrictEqual(hub.activity(), [], 'finished work leaves the live view');
  hub.store.save(true);
});

test('a race shows every candidate working side by side in its own copy', async () => {
  const proj = repo();
  const hub = new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() });
  const gate = path.join(tmp(), 'release');
  hub.agents = [slow('alpha', gate), slow('beta', gate)];
  const t = hub.createThread(proj, 'Race it');
  const run = hub.runRace(t.id, { task: 'improve a.txt', agents: ['alpha', 'beta'] });
  try {
    await until(() => (hub.activity()[0]?.workers || []).filter((w) => w.state === 'working' && /npm test|edit/.test(w.doing)).length === 2);
    const [entry] = hub.activity();
    assert.strictEqual(entry.kind, 'race');
    assert.deepStrictEqual(entry.workers.map((w) => [w.agent, w.role, w.state]), [['alpha', 'candidate', 'working'], ['beta', 'candidate', 'working']]);
  } finally { fs.writeFileSync(gate, 'release'); await run; }
  assert.deepStrictEqual(hub.activity(), []);
  assert.strictEqual(fs.readFileSync(path.join(proj, 'a.txt'), 'utf8'), 'one\n', 'candidates worked in their own copies');
  hub.store.save(true);
});
