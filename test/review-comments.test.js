'use strict';
// Comments on diff lines go to the agent as one message: where, the line as it reads, and what to do.
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert');
const path = require('path');

const load = () => import(path.join(__dirname, '..', 'ui', 'src', 'lib', 'review-comments.mjs'));

test('comments become one numbered message, grouped by file in line order', async () => {
  const { commentsMessage } = await load();
  const text = commentsMessage([
    { file: 'src/b.ts', line: 3, side: 'after', quote: '  return a - b;', note: 'This should add.' },
    { file: 'src/a.ts', line: 10, side: 'after', quote: 'const x = 1', note: 'Rename x\nto count.' },
    { file: 'src/a.ts', line: 2, side: 'before', quote: 'import fs', note: 'Why was this removed?' },
  ]);
  assert.strictEqual(text, [
    'Please address these review comments on your changes:',
    '',
    '1. @src/a.ts:2 (removed line)',
    '   > import fs',
    '   Why was this removed?',
    '',
    '2. @src/a.ts:10',
    '   > const x = 1',
    '   Rename x',
    '   to count.',
    '',
    '3. @src/b.ts:3',
    '   >   return a - b;',
    '   This should add.',
  ].join('\n'));
});

test('long lines are shortened, and a comment from a reviewer agent says so', async () => {
  const { commentsMessage } = await load();
  const text = commentsMessage([{ file: 'x.js', line: 1, side: 'after', quote: 'y'.repeat(300), note: 'Too long.', by: 'Codex' }]);
  assert.match(text, /> y{160}…\n/);
  assert.match(text, /\(from Codex's review\) Too long\./);
  assert.strictEqual(commentsMessage([]), '');
  assert.strictEqual(commentsMessage([{ file: 'x.js', line: 4, side: 'after', quote: '', note: 'Found by a reviewer.' }]), 'Please address these review comments on your changes:\n\n1. @x.js:4\n   Found by a reviewer.', 'no quote line when the text is not known');
});

test('a file\'s change over the whole conversation spans every turn; one turn shows only its own part', async () => {
  require('./helpers/tmp').useCheckpointDir();
  const fs = require('fs'); const os = require('os'); const { execFileSync } = require('child_process');
  const { Hub } = require('../core/hub'); const { MemorySecrets } = require('../core/store');
  const tmp = () => mkTmp('rc');
  const d = tmp(); const git = (...a) => execFileSync('git', a, { cwd: d });
  git('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(d, 'a.txt'), 'one\ntwo\n'); git('add', '.'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const agent = (id, code) => ({ id, name: id, protocol: 'codex-exec', available: true, headless: true, path: process.execPath, stdinPrompt: true,
    args: () => ['-e', `require('fs').${code}; console.log(JSON.stringify({type:'item.completed',item:{id:'i',type:'agent_message',text:'ok'}})); console.log(JSON.stringify({type:'turn.completed'}));`] });
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  hub.agents = [agent('first', "appendFileSync('a.txt', 'three\\n')"), agent('second', "appendFileSync('a.txt', 'four\\n')")];
  const t = hub.createThread(d);
  await hub.send({ threadId: t.id, agentId: 'first', text: 'add three' });
  const second = await hub.send({ threadId: t.id, agentId: 'second', text: 'add four' });
  const whole = await hub.conversationDiff(t.id, second.id, 'a.txt');
  assert.match(whole, /\+three\n\+four/);
  const turn = await hub.turnDiff(t.id, second.id, 'a.txt');
  assert.match(turn, /\+four/); assert.doesNotMatch(turn, /\+three/);
  hub.store.save(true);
});

test('a reviewer agent reads the conversation\'s changes and its findings come back by file and line', async () => {
  const fs = require('fs'); const os = require('os'); const { execFileSync } = require('child_process');
  const { Hub } = require('../core/hub'); const { MemorySecrets } = require('../core/store'); const { parseFindings } = require('../core/review');
  const tmp = () => mkTmp('rv');
  const d = tmp(); const git = (...a) => execFileSync('git', a, { cwd: d });
  git('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(d, 'calc.js'), 'const a = 1;\n'); git('add', '.'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const out = (text) => `console.log(JSON.stringify({type:'item.completed',item:{id:'i',type:'agent_message',text:${text}}})); console.log(JSON.stringify({type:'turn.completed'}));`;
  const builder = { id: 'builder', name: 'Builder', protocol: 'codex-exec', available: true, headless: true, path: process.execPath, stdinPrompt: true,
    args: () => ['-e', `require('fs').appendFileSync('calc.js', 'const total = a + 40;\\n'); ${out("'done'")}`] };
  // The reviewer answers from the diff in its prompt: it flags the line that adds 40.
  const reviewer = { id: 'reviewer', name: 'Reviewer', protocol: 'codex-exec', available: true, headless: true, path: process.execPath, stdinPrompt: true,
    args: () => ['-e', `let s = ''; process.stdin.on('data', (c) => (s += c)).on('end', () => { const sees = s.includes('+const total = a + 40;'); ${out("(sees ? 'One problem.\\nFINDING: calc.js:2 | medium | 40 is a magic number; name it.\\nFINDING: nowhere | low | not a finding\\n' : 'No diff.\\n') + 'VERDICT: CHANGES REQUESTED'")} });`] };
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  hub.agents = [builder, reviewer];
  const t = hub.createThread(d);
  await assert.rejects(hub.reviewChanges(t.id, 'reviewer'), /Nothing has changed/);
  await hub.send({ threadId: t.id, agentId: 'builder', text: 'add a total' });
  const r = await hub.reviewChanges(t.id, 'reviewer');
  assert.deepStrictEqual(r.findings, [{ file: 'calc.js', line: 2, severity: 'medium', note: '40 is a magic number; name it.' }]);
  assert.strictEqual(r.verdict, 'changes requested');
  const msgs = hub.thread(t.id).messages;
  assert.strictEqual(msgs.at(-2).text, 'Review the changes in this conversation');
  assert.strictEqual(msgs.at(-1).mode, 'read'); assert.deepStrictEqual(msgs.at(-1).review, { findings: r.findings, verdict: r.verdict });
  assert.deepStrictEqual(parseFindings('FINDING: src/a b.ts:12 | HIGH | Off by one\nFINDING: x.js:3 | text without severity'), [
    { file: 'src/a b.ts', line: 12, severity: 'high', note: 'Off by one' }, { file: 'x.js', line: 3, severity: 'medium', note: 'text without severity' }]);
  hub.store.save(true);
});
