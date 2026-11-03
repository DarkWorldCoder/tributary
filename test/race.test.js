'use strict';
require('./helpers/tmp').useCheckpointDir();
// Race: several agents attempt the same task in isolated git worktrees; tests run in each; the user applies one.
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');

const tmp = () => mkTmp('race');
const repo = () => {
  const d = tmp(); execFileSync('git', ['init', '-q'], { cwd: d });
  fs.writeFileSync(path.join(d, 'calc.js'), 'module.exports = (a, b) => a - b;\n');
  execFileSync('git', ['add', '.'], { cwd: d });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: d });
  return d;
};
// Fake agent that rewrites calc.js in its working directory with the body given on its command line.
const writer = (id, body) => ({
  id, name: id, protocol: 'codex-exec', available: true, path: process.execPath, stdinPrompt: true,
  args: () => ['-e', `require('fs').writeFileSync('calc.js', ${JSON.stringify(body)});console.log(JSON.stringify({type:'item.completed',item:{id:'i',type:'agent_message',text:'done by ${id} notes='+require('fs').existsSync('notes.txt')}}));console.log(JSON.stringify({type:'turn.completed'}))`],
});

test('race: each agent works in its own worktree, tests decide, and applying copies only the winner', async () => {
  const d = repo();
  fs.writeFileSync(path.join(d, 'notes.txt'), 'uncommitted work the agents should see\n');
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  hub.agents = [writer('good', 'module.exports = (a, b) => a + b;\n'), writer('bad', 'module.exports = () => 0;\n')];
  const t = hub.createThread(d);
  const race = await hub.runRace(t.id, { task: 'fix add', agents: ['good', 'bad'], testCommand: `node -e "process.exit(require('./calc.js')(2,3)===5?0:1)"` });

  // The project itself is untouched until something is applied.
  assert.strictEqual(fs.readFileSync(path.join(d, 'calc.js'), 'utf8'), 'module.exports = (a, b) => a - b;\n');
  const by = Object.fromEntries(race.candidates.map((c) => [c.agent, c]));
  assert.strictEqual(by.good.tests, 'passed');
  assert.strictEqual(by.bad.tests, 'failed');
  assert.deepStrictEqual(by.good.files, ['calc.js']);
  assert.match(by.good.diff, /\+module\.exports = \(a, b\) => a \+ b;/);
  assert.match(by.good.text, /done by good/);
  // Worktrees start from the current files, including uncommitted ones.
  assert.match(by.good.text, /notes=true/);
  assert.ok(!by.good.files.includes('notes.txt'));

  const msg = hub.thread(t.id).messages.find((m) => m.role === 'assistant' && m.kind === 'race');
  assert.strictEqual(msg.race.candidates.length, 2);

  await hub.applyRace(t.id, msg.id, 'good');
  assert.strictEqual(fs.readFileSync(path.join(d, 'calc.js'), 'utf8'), 'module.exports = (a, b) => a + b;\n');
  assert.strictEqual(fs.readFileSync(path.join(d, 'notes.txt'), 'utf8'), 'uncommitted work the agents should see\n');
  assert.strictEqual(hub.thread(t.id).messages.find((m) => m.role === 'assistant' && m.kind === 'race').race.applied, 'good');
  // Worktrees are cleaned up.
  assert.strictEqual(execFileSync('git', ['worktree', 'list'], { cwd: d, encoding: 'utf8' }).trim().split('\n').length, 1);
  await assert.rejects(hub.applyRace(t.id, msg.id, 'bad'), /already applied/);
});

test('race: needs a git repository and at least two agents', async () => {
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  hub.agents = [writer('a', 'x'), writer('b', 'y')];
  const plain = tmp(); const t1 = hub.createThread(plain);
  await assert.rejects(hub.runRace(t1.id, { task: 'x', agents: ['a', 'b'] }), /git repository/);
  const t2 = hub.createThread(repo());
  await assert.rejects(hub.runRace(t2.id, { task: 'x', agents: ['a'] }), /at least two/);
});

test('race: every candidate keeps a branch you can continue from, and conflicting applies are explained', async () => {
  const d = repo();
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  hub.agents = [writer('alpha', 'module.exports = (a, b) => a + b; // alpha\n'), writer('beta', 'module.exports = (a, b) => b + a; // beta\n')];
  const t = hub.createThread(d);
  const race = await hub.runRace(t.id, { task: 'fix add', agents: ['alpha', 'beta'] });
  for (const c of race.candidates) {
    assert.match(c.branch, /^tributary\/race-[0-9a-f]+\/(alpha|beta)$/);
    const body = execFileSync('git', ['show', `${c.branch}:calc.js`], { cwd: d, encoding: 'utf8' });
    assert.match(body, new RegExp(`// ${c.agent}`));
  }
  // The project branch did not move.
  assert.strictEqual(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: d, encoding: 'utf8' }).trim(), execFileSync('git', ['branch', '--show-current'], { cwd: d, encoding: 'utf8' }).trim());
  // The user edits the same line before applying: the apply is refused with the file named.
  fs.writeFileSync(path.join(d, 'calc.js'), 'module.exports = (a, b) => Number(a) + Number(b);\n');
  const msg = hub.thread(t.id).messages.find((m) => m.role === 'assistant' && m.kind === 'race');
  await assert.rejects(hub.applyRace(t.id, msg.id, 'alpha'), /conflict[\s\S]*calc\.js/i);
  assert.strictEqual(fs.readFileSync(path.join(d, 'calc.js'), 'utf8'), 'module.exports = (a, b) => Number(a) + Number(b);\n');
});

test('race: a diff without a race branch applies only when it applies cleanly', async () => {
  const { applyDiff } = require('../core/race');
  const d = repo();
  const diff = 'diff --git a/calc.js b/calc.js\n--- a/calc.js\n+++ b/calc.js\n@@ -1 +1 @@\n-module.exports = (a, b) => a - b;\n+module.exports = (a, b) => a + b;\n';
  await applyDiff(d, diff);
  assert.strictEqual(fs.readFileSync(path.join(d, 'calc.js'), 'utf8'), 'module.exports = (a, b) => a + b;\n');
  await assert.rejects(applyDiff(d, diff), /conflict/);
  assert.strictEqual(fs.readFileSync(path.join(d, 'calc.js'), 'utf8'), 'module.exports = (a, b) => a + b;\n');
});
