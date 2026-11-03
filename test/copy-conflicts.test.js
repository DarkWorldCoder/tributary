'use strict';
require('./helpers/tmp').useCheckpointDir();
// When a separate copy conflicts with the project's branch, an agent resolves it inside the copy: the project's
// changes are merged into the copy, the agent fixes the conflict markers there, and Merge is then clean. Your
// project folder never sees a conflict marker.
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');

const tmp = () => mkTmp('cc');
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const commit = (cwd, message) => sh(cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', message);
const agent = (id, code) => ({ id, name: id, protocol: 'codex-exec', available: true, headless: true, path: process.execPath, stdinPrompt: true,
  args: () => ['-e', `const fs = require('fs'); ${code}; console.log(JSON.stringify({type:'item.completed',item:{id:'i',type:'agent_message',text:'ok'}})); console.log(JSON.stringify({type:'turn.completed'}));`] });

// The copy changes line 1 one way; meanwhile the project's main branch changes it another way.
async function conflicted(agents) {
  const d = tmp(); sh(d, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(d, 'calc.js'), 'const rate = 1;\nmodule.exports = rate;\n'); sh(d, 'add', '.'); commit(d, 'init');
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  hub.agents = [agent('copywriter', "fs.writeFileSync('calc.js', 'const rate = 2; // from the copy\\nmodule.exports = rate;\\n')"), ...agents];
  const t = hub.createThread(d);
  await hub.createWorktree(t.id);
  await hub.send({ threadId: t.id, agentId: 'copywriter', text: 'set the rate to 2' });
  fs.writeFileSync(path.join(d, 'calc.js'), 'const rate = 3; // from main\nmodule.exports = rate;\n'); commit(d, 'rate 3 on main');
  return { d, hub, t };
}

test('a copy that would conflict says so before you merge, and an agent resolves it in the copy', async () => {
  const fixer = agent('fixer', "const s = fs.readFileSync('calc.js', 'utf8'); if (!s.includes('<<<<<<<')) throw new Error('no markers'); fs.writeFileSync('calc.js', 'const rate = 3; // main\\'s value, the copy\\'s comment kept\\nmodule.exports = rate;\\n')");
  const { d, hub, t } = await conflicted([fixer]);
  const st = await hub.worktreeStatus(t.id);
  assert.deepStrictEqual(st.conflicts, ['calc.js']);
  await assert.rejects(hub.mergeWorktree(t.id), /conflict/);
  assert.ok(!fs.readFileSync(path.join(d, 'calc.js'), 'utf8').includes('<<<<<<<'), 'your folder never gets markers');

  const r = await hub.resolveCopyConflicts(t.id, 'fixer');
  assert.deepStrictEqual(r, { resolved: true, files: ['calc.js'] });
  const user = hub.thread(t.id).messages.at(-2);
  assert.match(user.text, /Resolve the merge conflicts with main/);
  assert.deepStrictEqual((await hub.worktreeStatus(t.id)).conflicts, []);
  const merged = await hub.mergeWorktree(t.id);
  assert.deepStrictEqual(merged.files, ['calc.js']);
  assert.strictEqual(fs.readFileSync(path.join(d, 'calc.js'), 'utf8'), "const rate = 3; // main's value, the copy's comment kept\nmodule.exports = rate;\n");
  hub.store.save(true);
});

test('markers an agent leaves behind are never committed, and the merge can be undone', async () => {
  const lazy = agent('lazy', "fs.writeFileSync('notes.txt', 'looked at it')");
  const { hub, t } = await conflicted([lazy]);
  const st = await hub.worktreeStatus(t.id);
  const r = await hub.resolveCopyConflicts(t.id, 'lazy');
  assert.deepStrictEqual(r, { resolved: false, files: ['calc.js'], remaining: ['calc.js'] });
  const mid = await hub.worktreeStatus(t.id);
  assert.strictEqual(mid.merging, true);
  await assert.rejects(hub.mergeWorktree(t.id), /Finish or undo/);
  await hub.abortCopyMerge(t.id);
  const after = await hub.worktreeStatus(t.id);
  assert.ok(!after.merging);
  assert.strictEqual(fs.readFileSync(path.join(st.path, 'calc.js'), 'utf8'), 'const rate = 2; // from the copy\nmodule.exports = rate;\n', 'the copy is back as it was');
  assert.deepStrictEqual(after.conflicts, ['calc.js']);
  hub.store.save(true);
});
