'use strict';
// Comments on diff lines go to the agent as one message: where, the line as it reads, and what to do.
const test = require('node:test');
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
});

test('a file\'s change over the whole conversation spans every turn; one turn shows only its own part', async () => {
  process.env.TRIBUTARY_CHECKPOINT_DIR = process.env.TRIBUTARY_CHECKPOINT_DIR || require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'tributary-ckpt-'));
  const fs = require('fs'); const os = require('os'); const { execFileSync } = require('child_process');
  const { Hub } = require('../core/hub'); const { MemorySecrets } = require('../core/store');
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-rc-'));
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
