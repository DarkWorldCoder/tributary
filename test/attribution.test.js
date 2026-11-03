'use strict';
process.env.TRIBUTARY_CHECKPOINT_DIR = process.env.TRIBUTARY_CHECKPOINT_DIR || require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'tributary-ckpt-'));
// Agent blame: which agent's turn last changed each line of a file, across every conversation in the project.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');
const { replay } = require('../core/attribution');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-blame-'));
// An agent that runs a snippet of JavaScript in the project (fs and the file name are in scope).
const agent = (id, code) => ({ id, name: id, protocol: 'codex-exec', available: true, path: process.execPath, stdinPrompt: true,
  args: () => ['-e', `const fs = require('fs'); ${code}; console.log(JSON.stringify({ type: 'item.completed', item: { id: 'i', type: 'agent_message', text: 'ok' } })); console.log(JSON.stringify({ type: 'turn.completed' }));`] });

test('replaying a diff moves authors with their lines and gives added lines to the turn', () => {
  const diff = ['--- a/a.txt', '+++ b/a.txt', '@@ -1,3 +1,4 @@', '+new top', ' one', '-two', '+TWO', ' three'].join('\n');
  assert.deepStrictEqual(replay([-1, 0, -1], diff, 1), [1, -1, 1, -1]);
  const append = ['@@ -2,0 +3,2 @@', '+x', '+y'].join('\n');
  assert.deepStrictEqual(replay([0, 0], append, 2), [0, 0, 2, 2]);
  assert.deepStrictEqual(replay([], ['--- /dev/null', '+++ b/n.txt', '@@ -0,0 +1,2 @@', '+a', '+b'].join('\n'), 3), [3, 3]);
});

test('each line names the agent whose turn changed it, across conversations; untouched lines name nobody', async () => {
  const proj = tmp(); execFileSync('git', ['init', '-q'], { cwd: proj });
  fs.writeFileSync(path.join(proj, 'a.txt'), 'one\ntwo\nthree\n');
  execFileSync('git', ['add', '.'], { cwd: proj }); execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: proj });
  const hub = new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() });
  hub.agents = [
    agent('alpha', "fs.writeFileSync('a.txt', fs.readFileSync('a.txt', 'utf8').replace('two', 'TWO by alpha'))"),
    agent('beta', "fs.appendFileSync('a.txt', 'four by beta\\n'); fs.writeFileSync('b.txt', 'made by beta\\nsecond\\n')"),
    agent('gamma', "fs.writeFileSync('a.txt', 'zero by gamma\\n' + fs.readFileSync('a.txt', 'utf8'))"),
  ];
  const one = hub.createThread(proj, 'First'); const two = hub.createThread(proj, 'Second');
  await hub.send({ threadId: one.id, agentId: 'alpha', text: 'capitalize two' });
  await hub.send({ threadId: two.id, agentId: 'beta', text: 'add four' });
  await hub.send({ threadId: one.id, agentId: 'gamma', text: 'add zero' });

  const blame = await hub.lineAuthors(proj, 'a.txt');
  const who = blame.authors.map((i) => (i < 0 ? null : blame.turns[i].agent));
  assert.deepStrictEqual(who, ['gamma', null, 'alpha', null, 'beta']);
  const beta = blame.turns[blame.authors[4]];
  assert.strictEqual(beta.threadId, two.id); assert.strictEqual(beta.title, 'Second'); assert.strictEqual(beta.request, 'add four');
  assert.ok(beta.messageId && beta.ts);

  const fresh = await hub.lineAuthors(proj, 'b.txt');
  assert.deepStrictEqual(fresh.authors.map((i) => fresh.turns[i].agent), ['beta', 'beta'], 'a file an agent created is all its own');
  const untouched = await hub.lineAuthors(proj, 'README.md').catch((e) => e);
  assert.ok(untouched instanceof Error || untouched.authors.length === 0, 'a missing file has no lines');
  await assert.rejects(hub.lineAuthors(tmp(), 'a.txt'), /Unknown project/);
  hub.store.save(true);
});
