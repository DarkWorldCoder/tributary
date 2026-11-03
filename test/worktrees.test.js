'use strict';
require('./helpers/tmp').useCheckpointDir();
// Separate working copies: a conversation works in its own git worktree and branch, so two conversations
// can change one repository at once; merging brings the work back into the project's current branch.
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');

const tmp = () => mkTmp('wt');
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const commit = (cwd, message) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', message], { cwd });
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const repo = () => {
  const d = tmp(); sh(d, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(d, 'calc.js'), 'module.exports = (a, b) => a - b;\n');
  fs.writeFileSync(path.join(d, 'notes.md'), '# notes\n');
  sh(d, 'add', '.'); commit(d, 'init');
  return d;
};
// Fake agent: after `delay` ms, writes `body` to `file` in its working directory and reports where it ran.
const writer = (id, file, body, delay = 0) => ({
  id, name: id, protocol: 'codex-exec', available: true, headless: true, path: process.execPath, stdinPrompt: true,
  args: () => ['-e', `setTimeout(() => { require('fs').writeFileSync(${JSON.stringify(file)}, ${JSON.stringify(body)}); console.log(JSON.stringify({type:'item.completed',item:{id:'i',type:'agent_message',text:'ran in '+process.cwd()}})); console.log(JSON.stringify({type:'turn.completed'})); }, ${delay})`],
});
async function setup(agents) {
  const d = repo(); const data = tmp();
  const hub = await new Hub({ dataDir: data, secrets: new MemorySecrets(), home: tmp() }).init();
  hub.agents = agents;
  return { d, data, hub };
}

test('turning on a separate copy makes a branch and a worktree in the data folder, and turns run there', async () => {
  const { d, data, hub } = await setup([writer('fixer', 'calc.js', 'module.exports = (a, b) => a + b;\n')]);
  const t = hub.createThread(d);
  const short = t.id.replace(/-/g, '').slice(0, 8);
  const st = await hub.createWorktree(t.id);
  assert.strictEqual(st.branch, `tributary/thread-${short}`);
  assert.strictEqual(st.into, 'main');
  assert.ok(fs.realpathSync(st.path).startsWith(fs.realpathSync(path.join(data, 'worktrees'))), st.path);
  assert.strictEqual(sh(st.path, 'branch', '--show-current'), st.branch);
  assert.strictEqual(sh(d, 'worktree', 'list').split('\n').length, 2);
  assert.deepStrictEqual(hub.threads(d)[0].branch, st.branch, 'the sidebar row carries the branch');
  // Turning it on again changes nothing.
  assert.strictEqual((await hub.createWorktree(t.id)).path, st.path);

  const msg = await hub.send({ threadId: t.id, agentId: 'fixer', text: 'fix add' });
  assert.strictEqual(msg.ok, true, msg.error);
  assert.match(msg.text, new RegExp(`ran in ${fs.realpathSync(st.path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.ok(msg.checkpoint, 'a checkpoint is taken in the worktree');
  assert.deepStrictEqual(msg.files.map((f) => f.rel), ['calc.js']);
  // The project folder is untouched.
  assert.strictEqual(read(d, 'calc.js'), 'module.exports = (a, b) => a - b;\n');
  assert.strictEqual(read(st.path, 'calc.js'), 'module.exports = (a, b) => a + b;\n');
  assert.match(await hub.turnDiff(t.id, msg.id), /\+module\.exports = \(a, b\) => a \+ b;/);

  const after = await hub.worktreeStatus(t.id);
  assert.deepStrictEqual(after.files, [{ path: 'calc.js', code: 'M' }]);
  assert.strictEqual(after.uncommitted, 1);
  assert.strictEqual(after.ahead, 0); assert.strictEqual(after.behind, 0);
  // File listings and reads work on the worktree path.
  assert.ok((await hub.listFiles(st.cwd)).includes('calc.js'));
  assert.strictEqual((await hub.readFile(st.cwd, 'calc.js')).content, 'module.exports = (a, b) => a + b;\n');
  assert.ok((await hub.gitInfo(st.cwd)).changed.some((c) => c.path === 'calc.js'));
  await assert.rejects(hub.listFiles(path.join(data, 'worktrees')), /Unknown project/);
});

test('two conversations write to the same repository at once, each in its own copy, and both merge back', async () => {
  const { d, hub } = await setup([writer('one', 'calc.js', 'module.exports = (a, b) => a + b;\n'), writer('two', 'notes.md', '# notes\n\nship it\n')]);
  const a = hub.createThread(d); const b = hub.createThread(d); const c = hub.createThread(d);
  // Holds a writing turn in `a` open until release() is called.
  const hold = async () => {
    let entered; const inside = new Promise((r) => { entered = r; }); let release; const held = new Promise((r) => { release = r; });
    const turn = hub.withTurn(a.id, true, false, async () => { entered(); await held; });
    await inside;
    return async () => { release(); await turn; };
  };
  // Without separate copies a second writer is refused while the first is working.
  let done = await hold();
  await assert.rejects(hub.send({ threadId: b.id, agentId: 'two', text: 'write notes' }), /workspace is busy/);
  await done();

  await hub.createWorktree(a.id); await hub.createWorktree(b.id);
  // Now `b` writes in its copy, and `c` in the project folder itself, while `a` is still working in its copy.
  done = await hold();
  const mb = await hub.send({ threadId: b.id, agentId: 'two', text: 'write notes' });
  assert.strictEqual(mb.ok, true, mb.error);
  await hub.withTurn(c.id, true, false, async () => {});
  await done();
  // And both can run real turns at the same moment.
  const [ma, again] = await Promise.all([hub.send({ threadId: a.id, agentId: 'one', text: 'fix add' }), hub.send({ threadId: b.id, agentId: 'two', text: 'write notes again' })]);
  assert.strictEqual(ma.ok, true, ma.error); assert.strictEqual(again.ok, true, again.error);

  const ra = await hub.mergeWorktree(a.id);
  assert.deepStrictEqual(ra.files, ['calc.js']); assert.strictEqual(ra.into, 'main');
  const rb = await hub.mergeWorktree(b.id);
  assert.deepStrictEqual(rb.files, ['notes.md']);
  assert.strictEqual(read(d, 'calc.js'), 'module.exports = (a, b) => a + b;\n');
  assert.strictEqual(read(d, 'notes.md'), '# notes\n\nship it\n');
  // The work is committed on the project's branch, and the project folder is clean.
  assert.strictEqual(sh(d, 'branch', '--show-current'), 'main');
  assert.strictEqual(sh(d, 'status', '--porcelain'), '');
  assert.strictEqual(sh(d, 'show', 'HEAD:calc.js'), 'module.exports = (a, b) => a + b;');
  const st = await hub.worktreeStatus(a.id);
  assert.strictEqual(st.ahead, 0); assert.strictEqual(st.uncommitted, 0);
  // Nothing new to merge.
  assert.deepStrictEqual((await hub.mergeWorktree(a.id)).files, []);
});

test('merging refuses on conflicts, names the files and keeps the branch', async () => {
  const { d, hub } = await setup([writer('one', 'calc.js', 'module.exports = (a, b) => a + b; // one\n', 100), writer('two', 'calc.js', 'module.exports = (a, b) => b + a; // two\n', 100)]);
  const a = hub.createThread(d); const b = hub.createThread(d);
  const wa = await hub.createWorktree(a.id); const wb = await hub.createWorktree(b.id);
  await Promise.all([hub.send({ threadId: a.id, agentId: 'one', text: 'x' }), hub.send({ threadId: b.id, agentId: 'two', text: 'y' })]);
  await hub.mergeWorktree(a.id);
  const head = sh(d, 'rev-parse', 'HEAD');
  await assert.rejects(hub.mergeWorktree(b.id), (e) => {
    assert.match(e.message, /conflict[\s\S]*calc\.js/i);
    assert.match(e.message, new RegExp(wb.branch));
    assert.deepStrictEqual(e.conflicts, ['calc.js']);
    return true;
  });
  // Nothing moved: the project branch, its files, and the refused copy are as they were.
  assert.strictEqual(sh(d, 'rev-parse', 'HEAD'), head);
  assert.strictEqual(read(d, 'calc.js'), 'module.exports = (a, b) => a + b; // one\n');
  assert.strictEqual(sh(d, 'status', '--porcelain'), '');
  assert.strictEqual(read(wb.path, 'calc.js'), 'module.exports = (a, b) => b + a; // two\n');
  assert.ok(sh(d, 'branch', '--list', wb.branch));
  assert.ok(fs.existsSync(wa.path));
  const st = await hub.worktreeStatus(b.id);
  assert.strictEqual(st.behind, 1); assert.strictEqual(st.ahead, 1);
});

test('merging refuses to overwrite uncommitted changes in the project folder', async () => {
  const { d, hub } = await setup([writer('one', 'calc.js', 'module.exports = (a, b) => a + b;\n')]);
  const t = hub.createThread(d);
  await hub.createWorktree(t.id);
  await hub.send({ threadId: t.id, agentId: 'one', text: 'fix add' });
  fs.writeFileSync(path.join(d, 'calc.js'), 'module.exports = (a, b) => a * b;\n');
  fs.writeFileSync(path.join(d, 'scratch.txt'), 'unrelated work\n');
  await assert.rejects(hub.mergeWorktree(t.id), /uncommitted[\s\S]*calc\.js/i);
  assert.strictEqual(read(d, 'calc.js'), 'module.exports = (a, b) => a * b;\n');
  // Unrelated uncommitted work does not block a merge and survives it.
  sh(d, 'checkout', '--', 'calc.js');
  const r = await hub.mergeWorktree(t.id);
  assert.deepStrictEqual(r.files, ['calc.js']);
  assert.strictEqual(read(d, 'scratch.txt'), 'unrelated work\n');
  assert.strictEqual(read(d, 'calc.js'), 'module.exports = (a, b) => a + b;\n');
});

test('discarding removes the copy and its branch, and the conversation works in the project folder again', async () => {
  const { d, hub } = await setup([writer('one', 'calc.js', 'module.exports = (a, b) => a + b;\n')]);
  const t = hub.createThread(d);
  // An earlier turn in the project folder keeps its diff after the thread moves. Its change stays uncommitted
  // in the project folder; the copy starts from the last commit.
  const first = await hub.send({ threadId: t.id, agentId: 'one', text: 'fix add' });
  const wt = await hub.createWorktree(t.id);
  assert.strictEqual(read(wt.path, 'calc.js'), 'module.exports = (a, b) => a - b;\n');
  const second = await hub.send({ threadId: t.id, agentId: 'one', text: 'again' });
  assert.ok(second.checkpoint);
  assert.match(await hub.turnDiff(t.id, first.id), /\+module\.exports = \(a, b\) => a \+ b;/);
  assert.match(await hub.turnDiff(t.id, second.id), /\+module\.exports = \(a, b\) => a \+ b;/);
  await hub.discardWorktree(t.id);
  assert.ok(!fs.existsSync(path.dirname(wt.path)), 'the thread folder in the data folder goes too');
  assert.strictEqual(sh(d, 'branch', '--list', wt.branch), '');
  assert.strictEqual(sh(d, 'worktree', 'list').split('\n').length, 1);
  assert.strictEqual(hub.thread(t.id).worktree, undefined);
  assert.strictEqual(hub.threads(d)[0].branch, undefined);
  await assert.rejects(hub.worktreeStatus(t.id), /not working in a separate copy/);
  await assert.rejects(hub.turnDiff(t.id, second.id), /discarded/);
  const third = await hub.send({ threadId: t.id, agentId: 'one', text: 'in the project' });
  assert.strictEqual(third.ok, true);
  assert.strictEqual(read(d, 'calc.js'), 'module.exports = (a, b) => a + b;\n');
});

test('deleting a conversation removes its copy but keeps the branch', async () => {
  const { d, hub } = await setup([writer('one', 'calc.js', 'x\n')]);
  const t = hub.createThread(d);
  const wt = await hub.createWorktree(t.id);
  await hub.send({ threadId: t.id, agentId: 'one', text: 'x' });
  await hub.deleteThread(t.id);
  assert.ok(!fs.existsSync(path.dirname(wt.path)));
  assert.strictEqual(sh(d, 'worktree', 'list').split('\n').length, 1);
  assert.ok(sh(d, 'branch', '--list', wt.branch));
});

test('a separate copy needs a git repository with a commit, and is refused while a turn runs', async () => {
  const { hub } = await setup([writer('slow', 'calc.js', 'x\n', 300)]);
  const plain = hub.createThread(tmp());
  await assert.rejects(hub.createWorktree(plain.id), /git repository/);
  const empty = tmp(); sh(empty, 'init', '-q');
  await assert.rejects(hub.createWorktree(hub.createThread(empty).id), /first commit/);
  const d = repo(); const t = hub.createThread(d);
  const running = hub.send({ threadId: t.id, agentId: 'slow', text: 'x' });
  await new Promise((r) => setTimeout(r, 100));
  await assert.rejects(hub.createWorktree(t.id), /Stop the running turn/);
  await running;
  await assert.rejects(hub.mergeWorktree(t.id), /not working in a separate copy/);
});

test('a project in a subfolder of the repository works in the same subfolder of the copy', async () => {
  const d = repo(); fs.mkdirSync(path.join(d, 'app')); fs.writeFileSync(path.join(d, 'app', 'index.js'), '1\n');
  sh(d, 'add', '.'); commit(d, 'app');
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  hub.agents = [writer('one', 'index.js', '2\n')];
  const t = hub.createThread(path.join(d, 'app'));
  const wt = await hub.createWorktree(t.id);
  assert.strictEqual(wt.cwd, path.join(wt.path, 'app'));
  const m = await hub.send({ threadId: t.id, agentId: 'one', text: 'x' });
  assert.strictEqual(m.ok, true, m.error);
  assert.strictEqual(read(wt.cwd, 'index.js'), '2\n');
  assert.strictEqual(read(d, 'app', 'index.js'), '1\n');
  const r = await hub.mergeWorktree(t.id);
  assert.deepStrictEqual(r.files, ['app/index.js']);
  assert.strictEqual(read(d, 'app', 'index.js'), '2\n');
});

test('a Manager team in a conversation with a separate copy builds into the copy', async () => {
  const reply = (text) => `console.log(JSON.stringify({ type: 'item.completed', item: { id: 'i', type: 'agent_message', text: ${JSON.stringify(text)} } })); console.log(JSON.stringify({ type: 'turn.completed' }));`;
  const plan = { tasks: [{ id: 'a', title: 'Write a', instructions: 'Create a.txt', files: ['a.txt'], dependsOn: [] }] };
  const boss = { ...writer('boss', 'unused.txt', ''), args: () => ['-e', reply(`\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``)] };
  const { d, hub } = await setup([boss, writer('w1', 'a.txt', 'a\n')]);
  const t = hub.createThread(d, 'Build it');
  const wt = await hub.createWorktree(t.id);
  await hub.runTeam(t.id, { recipe: 'manager', task: 'Build it', roles: { planner: 'boss', workers: ['w1'] }, testCommand: 'node -e "process.exit(require(\'fs\').existsSync(\'a.txt\') ? 0 : 1)"' });
  const m = hub.thread(t.id).messages.find((x) => x.kind === 'manager');
  assert.deepStrictEqual(m.manager.tasks.map((x) => x.state), ['done'], JSON.stringify(m.manager.tasks.map((x) => x.note)));
  assert.strictEqual(read(wt.cwd, 'a.txt'), 'a\n');
  assert.ok(!fs.existsSync(path.join(d, 'a.txt')), 'the project folder is untouched');
  assert.deepStrictEqual(m.files.map((f) => f.path), [path.join(wt.cwd, 'a.txt')]);
});

test('agent blame counts the turns that ran in that folder: the project, or one separate copy', async () => {
  const { d, hub } = await setup([writer('one', 'calc.js', 'module.exports = (a, b) => a + b;\n'), writer('two', 'notes.md', '# notes\n\nship it\n')]);
  const p = hub.createThread(d); const c = hub.createThread(d);
  await hub.send({ threadId: p.id, agentId: 'one', text: 'fix add' });
  const wt = await hub.createWorktree(c.id);
  await hub.send({ threadId: c.id, agentId: 'two', text: 'write notes' });
  // The copy's later turn does not break the project folder's history.
  const here = await hub.lineAuthors(d, 'calc.js');
  assert.deepStrictEqual(here.turns.map((x) => x.agent), ['one']);
  assert.deepStrictEqual(here.authors, [0]);
  const there = await hub.lineAuthors(wt.cwd, 'notes.md');
  assert.deepStrictEqual(there.turns.map((x) => x.agent), ['two']);
  assert.deepStrictEqual(there.authors, [-1, 0, 0]);
  assert.deepStrictEqual((await hub.lineAuthors(wt.cwd, 'calc.js')).turns, [], 'the project folder\'s turn is not in the copy');
});

test('live file views and hunk undo stay inside the conversation working copy', async () => {
  const { d, hub } = await setup([writer('fixer', 'calc.js', 'module.exports = (a, b) => a + b;\n')]);
  const t = hub.createThread(d);
  const copy = await hub.createWorktree(t.id);
  const watch = await hub.watchFiles(copy.cwd, ['calc.js']);
  try {
    const msg = await hub.send({ threadId: t.id, agentId: 'fixer', text: 'fix add' });
    assert.equal(msg.workdir, copy.cwd);
    const blame = await hub.lineAuthors(copy.cwd, 'calc.js');
    assert.equal(blame.turns[blame.authors[0]].messageId, msg.id);
    const rootBlame = await hub.lineAuthors(d, 'calc.js');
    assert.ok(rootBlame.authors.every((author) => author === -1), 'copy edits never become project-folder blame');
    const undo = await hub.revertTurnHunk(copy.cwd, 'calc.js', msg.id, 1);
    assert.equal(undo.text, 'module.exports = (a, b) => a - b;\n');
    assert.equal(read(copy.cwd, 'calc.js'), undo.text);
    assert.equal(read(d, 'calc.js'), undo.text, 'the original project remains unchanged');
    const after = await hub.lineAuthors(copy.cwd, 'calc.js');
    assert.ok(after.authors.every((author) => author === -1), 'the reverted line no longer belongs to the agent');
    assert.throws(() => hub.watchFiles(path.dirname(copy.path), ['calc.js']), /Unknown project/);
  } finally {
    hub.unwatchFiles(watch);
    hub.fileWatches.close();
  }
});
