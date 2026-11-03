'use strict';
process.env.TRIBUTARY_CHECKPOINT_DIR = process.env.TRIBUTARY_CHECKPOINT_DIR || require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'tributary-ckpt-'));
// Manager: one agent splits the task into a graph of pieces; workers build pieces at the same time in their own
// copies; a piece is merged only when it applies cleanly and the tests pass with it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');
const { parsePlan } = require('../core/manager');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-manager-'));
const repo = () => {
  const d = tmp(); execFileSync('git', ['init', '-q'], { cwd: d });
  fs.writeFileSync(path.join(d, 'README.md'), '# demo\n');
  execFileSync('git', ['add', '.'], { cwd: d }); execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: d });
  return d;
};
const PLAN = { tasks: [
  { id: 'a', title: 'Write a', instructions: 'Create a.txt', files: ['a.txt'], dependsOn: [] },
  { id: 'b', title: 'Write b', instructions: 'Create b.txt', files: ['b.txt'], dependsOn: [] },
  { id: 'c', title: 'Extend a', instructions: 'Append to a.txt', files: ['a.txt'], dependsOn: ['a'] },
  { id: 'd', title: 'Break things', instructions: 'Create bad.txt', files: ['bad.txt'], dependsOn: [] },
] };
const agent = (id, code) => ({ id, name: id, protocol: 'codex-exec', available: true, path: process.execPath, stdinPrompt: true, args: () => ['-e', code] });
const reply = (text) => `const out = (o) => console.log(JSON.stringify(o)); out({ type: 'item.completed', item: { id: 'i', type: 'agent_message', text: ${JSON.stringify(text)} } }); out({ type: 'turn.completed' });`;
// A worker reads its part from the prompt, logs when it starts and ends, and builds that part.
const worker = (id, log) => agent(id, `let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () => {
  const fs = require('fs'); const part = /Your part \\(id: (\\w+)\\)/.exec(s)[1];
  fs.appendFileSync(${JSON.stringify(log)}, 'start ' + part + ' ' + Date.now() + '\\n');
  if (part === 'a') fs.writeFileSync('a.txt', 'a\\n');
  if (part === 'b') fs.writeFileSync('b.txt', 'b\\n');
  if (part === 'c') fs.appendFileSync('a.txt', 'c\\n');
  if (part === 'd') fs.writeFileSync('bad.txt', 'oops\\n');
  setTimeout(() => { fs.appendFileSync(${JSON.stringify(log)}, 'end ' + part + ' ' + Date.now() + '\\n'); ${reply('built it')} }, part === 'a' || part === 'b' ? 600 : 50);
});`);
const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 25)); } };

test('a plan is a small graph of pieces: ids, dependencies and no cycles', () => {
  const tasks = parsePlan(`Here is the plan:\n\`\`\`json\n${JSON.stringify(PLAN)}\n\`\`\`\nGood luck.`);
  assert.deepStrictEqual(tasks.map((t) => [t.id, t.dependsOn]), [['a', []], ['b', []], ['c', ['a']], ['d', []]]);
  assert.throws(() => parsePlan('no plan here'), /task list/);
  assert.throws(() => parsePlan(JSON.stringify({ tasks: [{ id: 'x', title: 'X', dependsOn: ['y'] }, { id: 'y', title: 'Y', dependsOn: ['x'] }] })), /cycle/);
  assert.throws(() => parsePlan(JSON.stringify({ tasks: [{ id: 'x', title: 'X', dependsOn: ['nope'] }] })), /depends on/);
  assert.throws(() => parsePlan(JSON.stringify({ tasks: Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, title: 't' })) })), /at most 8/);
});

test('the manager splits the work, workers build pieces in parallel, and only passing pieces are merged', async () => {
  const proj = repo(); const log = path.join(tmp(), 'log.txt');
  const hub = new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() });
  hub.agents = [agent('boss', reply(`Plan:\n\`\`\`json\n${JSON.stringify(PLAN)}\n\`\`\``)), worker('w1', log), worker('w2', log)];
  const t = hub.createThread(proj, 'Build the feature');
  const seen = new Set();
  hub.on('activity', (a) => { for (const e of a) if (e.kind === 'manager') for (const w of e.workers) seen.add(`${w.role}:${w.state}`); });
  const result = await hub.runTeam(t.id, { recipe: 'manager', task: 'Build the feature', roles: { planner: 'boss', workers: ['w1', 'w2'] },
    testCommand: `node -e "process.exit(require('fs').existsSync('bad.txt') ? 1 : 0)"` });

  assert.strictEqual(result.verdict, 'partial');
  assert.strictEqual(fs.readFileSync(path.join(proj, 'a.txt'), 'utf8'), 'a\nc\n', 'c started from files that already had a');
  assert.strictEqual(fs.readFileSync(path.join(proj, 'b.txt'), 'utf8'), 'b\n');
  assert.ok(!fs.existsSync(path.join(proj, 'bad.txt')), 'a piece that fails the tests is never merged');

  const m = hub.thread(t.id).messages.find((x) => x.kind === 'manager');
  assert.deepStrictEqual(m.manager.tasks.map((x) => [x.id, x.state]), [['a', 'done'], ['b', 'done'], ['c', 'done'], ['d', 'failed']]);
  assert.match(m.manager.tasks[3].note, /tests/i);
  assert.deepStrictEqual(m.manager.tasks.map((x) => x.agent), ['w1', 'w2', 'w1', 'w2'], 'pieces are spread across the workers');
  assert.match(m.text, /3 of 4 pieces merged/);
  assert.deepStrictEqual(m.files.map((f) => f.rel).sort(), ['a.txt', 'b.txt']);
  assert.ok(hub.thread(t.id).messages.some((x) => x.team?.role === 'planner'), 'the plan is a turn in the thread');
  assert.strictEqual(hub.thread(t.id).messages[0].text, 'Split into pieces: Build the feature', 'the conversation shows the task, not the manager prompt');

  const at = Object.fromEntries(fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => { const [k, id, ts] = l.split(' '); return [`${k} ${id}`, Number(ts)]; }));
  assert.ok(at['start a'] < at['end b'] && at['start b'] < at['end a'], 'independent pieces ran at the same time');
  assert.ok(at['start c'] > at['end a'], 'a dependent piece waits for its dependency');
  await until(() => seen.has('Write a:working') && seen.has('Write a:done'));
  assert.strictEqual(hub.threads(proj)[0].status, 'review', 'merged changes wait for review');
  hub.store.save(true);
});
