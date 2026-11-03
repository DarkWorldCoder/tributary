'use strict';
process.env.TRIBUTARY_CHECKPOINT_DIR = process.env.TRIBUTARY_CHECKPOINT_DIR || require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'tributary-ckpt-'));
// Interactive approval of agent tool calls: an ACP session/request_permission the permission mode
// does not settle waits on the thread until the person allows it once, always, or denies it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');
const { runAcp, acpPool } = require('../core/acp');

const FAKE_ACP = path.join(__dirname, 'fake-acp.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-perm-'));
const agent = { id: 'acp', name: 'Fake ACP', protocol: 'acp', available: true, path: process.execPath, acpArgs: [FAKE_ACP] };

test.after(() => acpPool.closeAll());

function setup({ approvals = true } = {}) {
  const proj = tmp();
  const hub = new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp(), approvals });
  hub.agents = [agent];
  hub.addProject(proj);
  return { hub, proj, thread: hub.createThread(proj) };
}
// The next request that starts waiting for an answer.
const nextRequest = (hub) => new Promise((resolve) => {
  const on = ({ request }) => { if (request.status === 'pending') { hub.off('permission', on); resolve(request); } };
  hub.on('permission', on);
});

test('ACP: with nobody to ask, a command the mode does not allow is declined as before', async () => {
  const ev = [];
  const r = await runAcp({ command: process.execPath, args: [FAKE_ACP], cwd: tmp(), env: process.env, prompt: 'RUN npm test', mode: 'edit', onEvent: (e) => ev.push(e) });
  assert.strictEqual(r.ok, true);
  assert.match(ev.filter((e) => e.kind === 'text').map((e) => e.text).join(''), /\|ran:npm test=no$/);
  assert.ok(ev.some((e) => e.kind === 'notice' && /Declined: Run npm test/.test(e.text)));
});

test('a command waits for the person: the thread shows it, Allow once lets it run', async () => {
  const { hub, proj, thread } = setup();
  const notes = []; hub.on('notification', (n) => notes.push(n));
  const asked = nextRequest(hub);
  const sent = hub.send({ threadId: thread.id, agentId: 'acp', text: 'RUN npm test', mode: 'edit' });
  const req = await asked;

  assert.strictEqual(req.threadId, thread.id);
  assert.strictEqual(req.title, 'Run npm test', 'the title comes from the earlier tool_call update');
  assert.strictEqual(req.kind, 'execute');
  assert.strictEqual(req.command, 'npm test');
  assert.deepStrictEqual(req.options.map((o) => o.kind), ['allow_once', 'allow_always', 'reject_once']);
  assert.deepStrictEqual(hub.permissions(thread.id).map((r) => r.id), [req.id]);
  assert.deepStrictEqual(hub.permissions().map((r) => r.id), [req.id], 'every thread when no thread is given');
  assert.strictEqual(hub.threads(proj)[0].status, 'permission');
  const live = hub.thread(thread.id).messages.at(-1);
  assert.strictEqual(live.ok, null, 'the turn is still running');
  assert.deepStrictEqual(live.permissions.map((p) => [p.id, p.status]), [[req.id, 'pending']]);
  assert.ok(notes.some((n) => n.kind === 'permission' && n.threadId === thread.id && n.title === 'Fake ACP asks to run npm test'), JSON.stringify(notes));

  hub.answerPermission(req.id, 'once');
  const msg = await sent;
  assert.strictEqual(msg.ok, true);
  assert.match(msg.text, /\|ran:npm test=once$/);
  assert.deepStrictEqual(msg.tools.map((x) => [x.name, x.status]), [['Write notes.md', 'done'], ['Run npm test', 'done']], 'updates without a title keep the tool name');
  assert.strictEqual(fs.readFileSync(path.join(proj, 'notes.md'), 'utf8'), 'from acp\n', 'edits in Edit mode still go ahead without asking');
  assert.deepStrictEqual(hub.permissions(thread.id), []);
  assert.strictEqual(msg.permissions[0].status, 'allowed');
  assert.notStrictEqual(hub.threads(proj)[0].status, 'permission');
  assert.throws(() => hub.answerPermission(req.id, 'once'), /no longer waiting/);
});

test('Always allow answers the same command for the rest of the agent session', async () => {
  const { hub, thread } = setup();
  let asked = 0; hub.on('permission', ({ request }) => { if (request.status === 'pending') asked++; });
  const first = nextRequest(hub);
  const sent = hub.send({ threadId: thread.id, agentId: 'acp', text: 'RUN npm test;npm test', mode: 'edit' });
  hub.answerPermission((await first).id, 'always');
  const msg = await sent;
  assert.match(msg.text, /\|ran:npm test=always,npm test=always$/, 'the agent was given its allow_always option both times');
  assert.strictEqual(asked, 1);
  assert.strictEqual(msg.permissions[0].status, 'always');

  const again = await hub.send({ threadId: thread.id, agentId: 'acp', text: 'RUN npm test', mode: 'edit' });
  assert.match(again.text, /ran:npm test=always$/, 'a later turn in the same session is not asked again');
  assert.strictEqual(asked, 1);

  const other = nextRequest(hub);
  const third = hub.send({ threadId: thread.id, agentId: 'acp', text: 'RUN npm publish', mode: 'edit' });
  assert.strictEqual((await other).command, 'npm publish', 'a different command still asks');
  hub.answerPermission((await other).id, 'reject');
  await third;
});

test('Deny sends the agent its reject option and notes it on the turn', async () => {
  const { hub, thread } = setup();
  const asked = nextRequest(hub);
  const sent = hub.send({ threadId: thread.id, agentId: 'acp', text: 'RUN rm -rf build', mode: 'read' });
  const req = await asked;
  assert.strictEqual(req.command, 'rm -rf build', 'Read-only mode asks too');
  hub.answerPermission(req.id, 'reject');
  const msg = await sent;
  assert.match(msg.text, /\|ran:rm -rf build=no$/);
  assert.strictEqual(msg.permissions[0].status, 'rejected');
  assert.ok(msg.notices.some((n) => /Denied: Run rm -rf build/.test(n)), JSON.stringify(msg.notices));
  assert.ok(msg.notices.some((n) => /Declined: Write notes\.md \(mode: read\)/.test(n)), 'Read-only mode still declines edits without asking');
});

test('stopping the turn answers its waiting requests as cancelled', async () => {
  const { hub, proj, thread } = setup();
  const asked = nextRequest(hub);
  const sent = hub.send({ threadId: thread.id, agentId: 'acp', text: 'RUN npm test', mode: 'edit' });
  const req = await asked;
  hub.stop(thread.id);
  const msg = await sent;
  assert.strictEqual(msg.ok, false);
  assert.match(msg.text, /ran:npm test=cancelled$/, 'the agent was told the request was cancelled');
  assert.strictEqual(msg.permissions[0].status, 'cancelled');
  assert.deepStrictEqual(hub.permissions(), []);
  assert.strictEqual(hub.threads(proj)[0].status, null, 'a stop is not a failure');
  assert.throws(() => hub.answerPermission(req.id, 'once'), /no longer waiting/);
});

test('Full auto never asks, and a host without approvals keeps the automatic answers', async () => {
  const auto = setup();
  let asked = 0; auto.hub.on('permission', () => asked++);
  const full = await auto.hub.send({ threadId: auto.thread.id, agentId: 'acp', text: 'RUN npm test', mode: 'full' });
  assert.match(full.text, /ran:npm test=once$/);
  assert.strictEqual(asked, 0);

  const cli = setup({ approvals: false });
  cli.hub.on('permission', () => asked++);
  const declined = await cli.hub.send({ threadId: cli.thread.id, agentId: 'acp', text: 'RUN npm test', mode: 'edit' });
  assert.match(declined.text, /ran:npm test=no$/);
  assert.ok(declined.notices.some((n) => /Declined: Run npm test/.test(n)));
  assert.strictEqual(asked, 0);
});

test('answers name a choice or one of the agent\'s own options', async () => {
  const { hub, thread } = setup();
  assert.throws(() => hub.answerPermission('nope', 'once'), /no longer waiting/);
  const asked = nextRequest(hub);
  const sent = hub.send({ threadId: thread.id, agentId: 'acp', text: 'RUN make', mode: 'edit' });
  const req = await asked;
  assert.throws(() => hub.answerPermission(req.id, 'sometimes'), /Choose/);
  hub.answerPermission(req.id, req.options[0].optionId);
  assert.match((await sent).text, /ran:make=once$/);
});
