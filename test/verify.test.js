'use strict';
process.env.TRIBUTARY_CHECKPOINT_DIR = process.env.TRIBUTARY_CHECKPOINT_DIR || require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'tributary-ckpt-'));
// Checks after every turn: the project's verify script (.tributary/settings.json, trusted like the setup script)
// runs in the background after a turn that changed files. A failure keeps its output, marks the conversation
// failed, and the next turn or Stop cancels a check still running.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');
const { threadStatus } = require('../core/status');
const { scriptHash } = require('../core/workspace-setup');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-verify-'));
const node = JSON.stringify(process.execPath);
// The check passes while calc.js adds; an agent that makes it subtract breaks it.
const VERIFY = `${node} -e "const add = require('./calc.js'); if (add(2, 3) !== 5) { console.error('expected 5, got ' + add(2, 3)); process.exit(1) }"`;
const agent = (id, code) => ({ id, name: id, protocol: 'codex-exec', available: true, headless: true, path: process.execPath, stdinPrompt: true,
  args: () => ['-e', `const fs = require('fs'); ${code}; console.log(JSON.stringify({type:'item.completed',item:{id:'i',type:'agent_message',text:'ok'}})); console.log(JSON.stringify({type:'turn.completed'}));`] });
const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 50)); } };
async function setup(agents, verify = VERIFY, trust = true) {
  const d = tmp(); const git = (...a) => execFileSync('git', a, { cwd: d });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(d, 'calc.js'), 'module.exports = (a, b) => a + b;\n');
  fs.mkdirSync(path.join(d, '.tributary')); fs.writeFileSync(path.join(d, '.tributary', 'settings.json'), JSON.stringify({ scripts: { verify } }));
  git('add', '.'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  hub.agents = agents; hub.addProject(d);
  if (trust) hub.trustScript(d, scriptHash(verify));
  return { d, hub };
}
const last = (hub, t) => hub.thread(t.id).messages.filter((m) => m.role === 'assistant').at(-1);

test('after a turn that changes files, the checks run; a failure keeps its output and marks the conversation failed', async () => {
  const { d, hub } = await setup([agent('good', "fs.writeFileSync('notes.md', 'hi')"), agent('bad', "fs.writeFileSync('calc.js', 'module.exports = (a, b) => a - b;')")]);
  const t = hub.createThread(d);
  await hub.send({ threadId: t.id, agentId: 'good', text: 'add notes' });
  await until(() => ['passed', 'failed'].includes(last(hub, t).verify?.state));
  assert.strictEqual(last(hub, t).verify.state, 'passed');
  await hub.send({ threadId: t.id, agentId: 'bad', text: 'break it' });
  await until(() => ['passed', 'failed'].includes(last(hub, t).verify?.state));
  const v = last(hub, t).verify;
  assert.strictEqual(v.state, 'failed'); assert.match(v.output, /expected 5, got -1/); assert.ok(v.ms >= 0);
  assert.strictEqual(threadStatus(hub.thread(t.id)), 'failed');
  assert.strictEqual(hub.threads(d).find((x) => x.id === t.id).status, 'failed');
  hub.store.save(true);
});

test('no checks after a read-only turn or one that changed nothing; an untrusted script waits for your OK', async () => {
  const { d, hub } = await setup([agent('reader', 'void 0'), agent('writer', "fs.writeFileSync('notes.md', 'x')")], VERIFY, false);
  const t = hub.createThread(d);
  await hub.send({ threadId: t.id, agentId: 'reader', text: 'look', mode: 'read' });
  await hub.send({ threadId: t.id, agentId: 'reader', text: 'look again' });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(hub.thread(t.id).messages.every((m) => !m.verify));
  await hub.send({ threadId: t.id, agentId: 'writer', text: 'write' });
  const v = last(hub, t).verify;
  assert.strictEqual(v.state, 'untrusted'); assert.strictEqual(v.hash, scriptHash(VERIFY));
  hub.trustScript(d, v.hash);
  const r = await hub.runVerify(t.id, last(hub, t).id);
  assert.strictEqual(r.state, 'passed');
  hub.store.save(true);
});

test('the next turn cancels a check that is still running', async () => {
  const slow = `${node} -e "setTimeout(() => {}, 8000)"`;
  const { d, hub } = await setup([agent('writer', "fs.writeFileSync('notes.md', String(Date.now()))")], slow);
  const t = hub.createThread(d);
  await hub.send({ threadId: t.id, agentId: 'writer', text: 'one' });
  const first = last(hub, t);
  await until(() => first.verify?.state === 'running');
  await hub.send({ threadId: t.id, agentId: 'writer', text: 'two' });
  await until(() => first.verify?.state === 'stopped');
  hub.stop(t.id);
  await until(() => last(hub, t).verify?.state === 'stopped');
  hub.store.save(true);
});
