'use strict';
require('./helpers/tmp').useCheckpointDir();
// Undo one agent's change: put back what a single turn replaced in one place of a file, leaving everything else alone.
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');

const tmp = () => mkTmp('undo');
// An agent that runs a snippet of JavaScript in the project (fs is in scope).
const agent = (id, code) => ({ id, name: id, protocol: 'codex-exec', available: true, path: process.execPath, stdinPrompt: true,
  args: () => ['-e', `const fs = require('fs'); ${code}; console.log(JSON.stringify({ type: 'item.completed', item: { id: 'i', type: 'agent_message', text: 'ok' } })); console.log(JSON.stringify({ type: 'turn.completed' }));`] });
const edit = (file, from, to) => `fs.writeFileSync('${file}', fs.readFileSync('${file}', 'utf8').replace('${from}', '${to}'))`;

async function project(files, agents) {
  const proj = tmp(); execFileSync('git', ['init', '-q'], { cwd: proj });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(proj, name), text);
  execFileSync('git', ['add', '.'], { cwd: proj }); execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: proj });
  const hub = new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() });
  hub.agents = agents;
  return { proj, hub, read: (name) => fs.readFileSync(path.join(proj, name), 'utf8') };
}
// The turn that wrote a line, as the blame gutter sees it.
async function turnAt(hub, proj, rel, line) {
  const blame = await hub.lineAuthors(proj, rel);
  return blame.turns[blame.authors[line - 1]];
}

test('undoing a change puts back only that place, and leaves the turn\'s other changes and other agents\' lines alone', async () => {
  const lines = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const { proj, hub, read } = await project({ 'a.txt': `${lines.join('\n')}\n` }, [
    // Lines 2 and 4 are close enough to share one git hunk; line 10 is a hunk of its own.
    agent('alpha', [edit('a.txt', 'two', 'TWO by alpha'), edit('a.txt', 'four', 'FOUR by alpha'), edit('a.txt', 'ten', 'TEN by alpha')].join('; ')),
    agent('beta', "fs.appendFileSync('a.txt', 'thirteen by beta\\n')"),
    agent('gamma', "fs.writeFileSync('a.txt', 'zero by gamma\\n' + fs.readFileSync('a.txt', 'utf8'))"),
  ]);
  const t = hub.createThread(proj, 'Edits');
  await hub.send({ threadId: t.id, agentId: 'alpha', text: 'shout' });
  await hub.send({ threadId: t.id, agentId: 'beta', text: 'add thirteen' });
  await hub.send({ threadId: t.id, agentId: 'gamma', text: 'add zero' });

  // "FOUR by alpha" is line 5 now that gamma added a line at the top.
  const alpha = await turnAt(hub, proj, 'a.txt', 5);
  assert.strictEqual(alpha.agent, 'alpha');
  const r = await hub.revertTurnHunk(proj, 'a.txt', alpha.messageId, 5);
  const want = ['zero by gamma', 'one', 'TWO by alpha', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'TEN by alpha', 'eleven', 'twelve', 'thirteen by beta'];
  assert.strictEqual(read('a.txt'), `${want.join('\n')}\n`);
  assert.strictEqual(r.text, read('a.txt'), 'the new text comes back for the editor');
  assert.ok(r.mtime > 0);
  assert.deepStrictEqual({ from: r.from, removed: r.removed, restored: r.restored, agent: r.agent }, { from: 5, removed: 1, restored: 1, agent: 'alpha' });

  // The restored line has no author now; the turn's other changes keep theirs.
  const blame = await hub.lineAuthors(proj, 'a.txt');
  const who = blame.authors.map((i) => (i < 0 ? null : blame.turns[i].agent));
  assert.deepStrictEqual(who, ['gamma', null, 'alpha', null, null, null, null, null, null, null, 'alpha', null, null, 'beta']);

  // Another change from the same turn, on its own.
  await hub.revertTurnHunk(proj, 'a.txt', alpha.messageId, 11);
  assert.strictEqual(read('a.txt'), `${want.map((l) => (l === 'TEN by alpha' ? 'ten' : l)).join('\n')}\n`);
  hub.store.save(true);
});

test('a change that was edited since is left alone, with the reason', async () => {
  const { proj, hub, read } = await project({ 'b.txt': 'keep\nold one\nold two\nend\n' }, [
    agent('alpha', "fs.writeFileSync('b.txt', 'keep\\nnew one\\nnew two\\nnew three\\nend\\n')"),
    agent('beta', edit('b.txt', 'new two', 'new TWO by beta')),
  ]);
  const t = hub.createThread(proj, 'Edits');
  await hub.send({ threadId: t.id, agentId: 'alpha', text: 'rewrite' });
  // Another agent changes one of alpha's lines afterwards.
  await hub.send({ threadId: t.id, agentId: 'beta', text: 'shout two' });
  const alpha = await turnAt(hub, proj, 'b.txt', 2);
  assert.strictEqual(alpha.agent, 'alpha');
  const before = read('b.txt');
  await assert.rejects(hub.revertTurnHunk(proj, 'b.txt', alpha.messageId, 2), /changed since/);
  assert.strictEqual(read('b.txt'), before, 'nothing was written');

  // A line the turn didn't write.
  await assert.rejects(hub.revertTurnHunk(proj, 'b.txt', alpha.messageId, 1), /didn't change this line|did not change this line/);
  // Unknown turns and projects.
  await assert.rejects(hub.revertTurnHunk(proj, 'b.txt', 'no-such-turn', 2), /turn/i);
  await assert.rejects(hub.revertTurnHunk(tmp(), 'b.txt', alpha.messageId, 2), /Unknown project/);
  hub.store.save(true);
});

test('a change edited by hand after its turn is left alone too, so the hand edit survives', async () => {
  const { proj, hub, read } = await project({ 'b.txt': 'keep\nold one\nold two\nend\n' }, [
    agent('alpha', "fs.writeFileSync('b.txt', 'keep\\nnew one\\nnew two\\nnew three\\nend\\n')"),
  ]);
  const t = hub.createThread(proj, 'Edits');
  await hub.send({ threadId: t.id, agentId: 'alpha', text: 'rewrite' });
  // No turn comes after: the person changes one of alpha's lines in the editor.
  fs.writeFileSync(path.join(proj, 'b.txt'), read('b.txt').replace('new two', 'new TWO by hand'));
  const alpha = await turnAt(hub, proj, 'b.txt', 2);
  assert.strictEqual(alpha.agent, 'alpha');
  assert.strictEqual(await turnAt(hub, proj, 'b.txt', 3), undefined, 'the edited line is nobody\'s');
  const before = read('b.txt');
  await assert.rejects(hub.revertTurnHunk(proj, 'b.txt', alpha.messageId, 2), /changed since/);
  assert.strictEqual(read('b.txt'), before, 'nothing was written');
  hub.store.save(true);
});

test('undoing a change at the end of a file puts back the missing final newline exactly', async () => {
  const { proj, hub, read } = await project({ 'c.txt': 'a\nb' }, [
    agent('alpha', "fs.writeFileSync('c.txt', 'a\\nb\\nc by alpha\\n')"),
  ]);
  const t = hub.createThread(proj, 'Edits');
  await hub.send({ threadId: t.id, agentId: 'alpha', text: 'append c' });
  const alpha = await turnAt(hub, proj, 'c.txt', 3);
  assert.strictEqual(alpha.agent, 'alpha');
  const r = await hub.revertTurnHunk(proj, 'c.txt', alpha.messageId, 3);
  assert.strictEqual(read('c.txt'), 'a\nb');
  assert.strictEqual(r.text, 'a\nb');
  hub.store.save(true);
});

test('undoing a file an agent created leaves it empty, and an agent\'s change in another conversation is found', async () => {
  const { proj, hub, read } = await project({ 'keep.txt': 'x\n' }, [
    agent('alpha', "fs.writeFileSync('new.txt', 'made\\nby alpha\\n')"),
    agent('beta', "fs.appendFileSync('keep.txt', 'y by beta\\n')"),
  ]);
  const one = hub.createThread(proj, 'One'); const two = hub.createThread(proj, 'Two');
  await hub.send({ threadId: one.id, agentId: 'alpha', text: 'make new' });
  await hub.send({ threadId: two.id, agentId: 'beta', text: 'add y' });
  const alpha = await turnAt(hub, proj, 'new.txt', 2);
  await hub.revertTurnHunk(proj, 'new.txt', alpha.messageId, 2);
  assert.strictEqual(read('new.txt'), '');
  const beta = await turnAt(hub, proj, 'keep.txt', 2);
  assert.strictEqual(beta.threadId, two.id);
  await hub.revertTurnHunk(proj, 'keep.txt', beta.messageId, 2);
  assert.strictEqual(read('keep.txt'), 'x\n');
  hub.store.save(true);
});
