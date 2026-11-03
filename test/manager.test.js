'use strict';
require('./helpers/tmp').useCheckpointDir();
// Manager: one agent splits the task into a graph of pieces; workers build pieces at the same time in their own
// copies; a piece is merged only when it applies cleanly and the tests pass with it.
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');
const { parsePlan } = require('../core/manager');

const tmp = () => mkTmp('manager');
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

test('a judge agent compares race candidates by their diffs and tests, and its pick is recorded', async () => {
  const proj = repo();
  const hub = new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() });
  const writes = (id, body) => agent(id, `require('fs').writeFileSync('calc.js', ${JSON.stringify(body)}); ${reply(`done by ${id}`)}`);
  // The judge reads the candidates from its prompt and picks the one whose tests passed.
  const judge = agent('judge', `let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () => {
    const passed = [...s.matchAll(/## Candidate: \\S+ \\(id: (\\w+)\\)\\nTests: passed/g)].map((m) => m[1]);
    const seesDiffs = s.includes('+module.exports = (a, b) => a + b;') && s.includes('+module.exports = (a, b) => a * b;');
    ${reply('').replace('""', "(seesDiffs ? 'Both diffs read. ' : 'Missing diffs. ') + 'The first one is right.\\nWINNER: ' + (passed[0] || 'none')")}
  });`);
  hub.agents = [writes('alpha', 'module.exports = (a, b) => a + b;\n'), writes('beta', 'module.exports = (a, b) => a * b;\n'), judge];
  const t = hub.createThread(proj, 'Fix calc');
  await hub.runRace(t.id, { task: 'make calc add', agents: ['alpha', 'beta'], testCommand: `node -e "process.exit(require('./calc.js')(2, 3) === 5 ? 0 : 1)"` });
  const race = hub.thread(t.id).messages.find((m) => m.role === 'assistant' && m.kind === 'race');
  const verdict = await hub.judgeRace(t.id, race.id, 'judge');
  assert.strictEqual(verdict.winner, 'alpha');
  assert.deepStrictEqual(hub.thread(t.id).messages.find((m) => m.id === race.id).race.judge, { agent: 'judge', winner: 'alpha', messageId: verdict.messageId });
  const turn = hub.thread(t.id).messages.find((m) => m.id === verdict.messageId);
  assert.match(turn.text, /^Both diffs read\./);
  assert.strictEqual(turn.team.role, 'judge'); assert.strictEqual(turn.mode, 'read');
  assert.strictEqual(hub.thread(t.id).messages.at(-2).text, 'Pick the best result of the race');
  await assert.rejects(hub.judgeRace(t.id, 'nope', 'judge'), /Race not found/);
  hub.store.save(true);
});

test('the lead can assign selected workers, and cannot invent or enable other agents', () => {
  const plan = { tasks: [{ id: 'api', title: 'API', agent: 'codex' }, { id: 'ui', title: 'UI', agent: 'claude' }] };
  assert.deepStrictEqual(parsePlan(JSON.stringify(plan), ['claude', 'codex']).map((t) => t.agent), ['codex', 'claude']);
  assert.throws(() => parsePlan(JSON.stringify(plan), ['claude']), /selected worker/);
  assert.throws(() => parsePlan(JSON.stringify({ tasks: [{ id: 'bad', agent: 12 }] }), ['claude']), /selected worker/);
  assert.strictEqual(parsePlan(JSON.stringify({ tasks: [{ id: 'old', title: 'Old plan' }] }), ['claude'])[0].agent, null);
});

test('delegated workers honor lead assignments, a concurrency cap and completed dependency results', async (t) => {
  const proj = repo(); const data = tmp(); const logs = tmp(); const log = path.join(logs, 'workers.log');
  const hub = new Hub({ dataDir: data, secrets: new MemorySecrets(), home: logs });
  t.after(() => { hub.store.close(); for (const d of [proj, data, logs]) fs.rmSync(d, { recursive: true, force: true }); });
  const plan = { tasks: [
    { id: 'ui', title: 'Build UI', instructions: 'Create ui.txt', agent: 'worker-b', files: ['ui.txt'] },
    { id: 'api', title: 'Build API', instructions: 'Create api.txt', agent: 'worker-a', files: ['api.txt'] },
    { id: 'link', title: 'Link results', instructions: 'Check both dependency results; create link.txt', agent: 'worker-b', files: ['link.txt'], dependsOn: ['ui', 'api'] },
  ] };
  const delegate = (id) => agent(id, `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    const fs=require('fs'); const part=/Your part \\(id: (\\w+)\\)/.exec(s)[1];
    fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({part,agent:${JSON.stringify(id)},state:'start',at:Date.now()})+'\\n');
    if(part==='link'&&(!s.includes('## Completed dependencies')||!s.includes('finished ui by worker-b')||!s.includes('finished api by worker-a')||!fs.existsSync('ui.txt')||!fs.existsSync('api.txt')))process.exit(2);
    if(!s.includes('Files you will likely change: '+part+'.txt'))process.exit(3);
    fs.writeFileSync(part+'.txt',${JSON.stringify(id)});
    setTimeout(()=>{fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({part,agent:${JSON.stringify(id)},state:'end',at:Date.now()})+'\\n');console.log(JSON.stringify({type:'item.completed',item:{id:'answer',type:'agent_message',text:'finished '+part+' by '+${JSON.stringify(id)}}}));console.log(JSON.stringify({type:'turn.completed'}));},100);
  });`);
  const lead = agent('lead', `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    if(!s.includes('## Selected workers')||!s.includes('worker-a')||!s.includes('worker-b'))process.exit(4);
    ${reply(JSON.stringify(plan))}
  });`);
  hub.agents = [lead, delegate('worker-a'), delegate('worker-b')];
  const chat = hub.createThread(proj);
  const result = await hub.runTeam(chat.id, { recipe: 'manager', task: 'Build and link', roles: { planner: 'lead', workers: ['worker-a', 'worker-b'] }, maxParallel: 1 });
  assert.strictEqual(result.verdict, 'merged');
  assert.strictEqual(chat.title, 'Build and link');
  assert.deepStrictEqual(result.tasks.map((task) => task.agent), ['worker-b', 'worker-a', 'worker-b']);
  assert.strictEqual(fs.readFileSync(path.join(proj, 'link.txt'), 'utf8'), 'worker-b');
  assert.match(result.tasks[2].result, /finished link by worker-b/);
  const events = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse); let active = 0;
  for (const event of events) { active += event.state === 'start' ? 1 : -1; assert.ok(active >= 0 && active <= 1, 'parallel worker cap must be enforced'); }
  assert.strictEqual(active, 0);
  assert.strictEqual(hub.teamRuns(chat.id)[0].status, 'done');
  assert.strictEqual(hub.notifications().at(-1).kind, 'done');
  await assert.rejects(hub.runTeam(chat.id, { recipe: 'manager', task: 'Read-only delegation', mode: 'read', roles: { planner: 'lead', workers: ['worker-a'] } }), /Edit files/);
  await assert.rejects(hub.runTeam(chat.id, { recipe: 'manager', task: 'Invalid cap', roles: { planner: 'lead', workers: ['worker-a'] }, maxParallel: 2 }), /parallel worker limit/);
});

test('stopping delegated background work stops workers and skips unstarted dependent tasks', async (t) => {
  const proj = repo(); const data = tmp(); const home = tmp();
  const hub = new Hub({ dataDir: data, secrets: new MemorySecrets(), home });
  t.after(() => { hub.store.close(); for (const d of [proj, data, home]) fs.rmSync(d, { recursive: true, force: true }); });
  const plan = { tasks: [{ id: 'first', title: 'Wait', agent: 'worker' }, { id: 'later', title: 'Must not start', agent: 'worker', dependsOn: ['first'] }] };
  const marker = path.join(home, 'worker-started');
  hub.agents = [agent('lead', reply(JSON.stringify(plan))), agent('worker', `require('fs').writeFileSync(${JSON.stringify(marker)},'started');setInterval(()=>{},1000)`)];
  const chat = hub.createThread(proj, 'Stopped delegation');
  const run = hub.runTeam(chat.id, { recipe: 'manager', task: 'Wait for stop', roles: { planner: 'lead', workers: ['worker'] } });
  await until(() => fs.existsSync(marker));
  hub.stop(chat.id);
  const result = await run;
  assert.strictEqual(result.verdict, 'stopped');
  assert.strictEqual(result.tasks[1].state, 'skipped');
  assert.strictEqual(hub.teamRuns(chat.id)[0].status, 'stopped');
  assert.strictEqual(hub.thread(chat.id).messages.find((m) => m.manager).manager.phase, 'stopped');
  assert.ok(!hub.running.has(chat.id) && !hub.teams.has(chat.id));
  assert.strictEqual(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: proj, encoding: 'utf8' }).match(/^worktree /gm).length, 1);
});

test('stopping a test command kills its process tree instead of waiting for the test timeout', async (t) => {
  const { runTests } = require('../core/race'); const root = tmp(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ready = path.join(root, 'ready'); const control = new AbortController();
  const quote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";
  const code = `require('fs').writeFileSync(${JSON.stringify(ready)},'started');setInterval(()=>{},1000)`;
  const run = runTests(root, `${quote(process.execPath)} -e ${quote(code)}`, 30000, { signal: control.signal });
  await until(() => fs.existsSync(ready)); control.abort();
  const result = await run;
  assert.strictEqual(result.aborted, true); assert.strictEqual(result.passed, false); assert.match(result.output, /stopped/);
  let spawned = false;
  const skipped = await runTests(root, 'must-not-run', 30000, { signal: control.signal, host: { spawn() { spawned = true; } } });
  assert.strictEqual(spawned, false); assert.strictEqual(skipped.aborted, true);
});

test('failed delegation skips every descendant even when dependencies are listed in reverse order', async (t) => {
  const proj = repo(); const data = tmp(); const home = tmp();
  const hub = new Hub({ dataDir: data, secrets: new MemorySecrets(), home });
  t.after(() => { hub.store.close(); for (const d of [proj, data, home]) fs.rmSync(d, { recursive: true, force: true }); });
  const plan = { tasks: [
    { id: 'last', title: 'Last', agent: 'worker', dependsOn: ['middle'] },
    { id: 'middle', title: 'Middle', agent: 'worker', dependsOn: ['first'] },
    { id: 'first', title: 'First', agent: 'worker' },
  ] };
  hub.agents = [agent('lead', reply(JSON.stringify(plan))), agent('worker', 'process.exit(2)')];
  const chat = hub.createThread(proj, 'Failure propagation');
  const result = await hub.runTeam(chat.id, { recipe: 'manager', task: 'Fail safely', roles: { planner: 'lead', workers: ['worker'] } });
  assert.deepStrictEqual(result.tasks.map((task) => task.state), ['skipped', 'skipped', 'failed']);
  assert.strictEqual(hub.teamRuns(chat.id)[0].status, 'failed');
});
