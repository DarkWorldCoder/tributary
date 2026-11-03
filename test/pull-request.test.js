'use strict';
require('./helpers/tmp').useCheckpointDir();
// A separate copy's GitHub pull request, through a stand-in `gh` on PATH (test/fake-gh.js) and a bare repository as
// origin: create (commit, secret guard, push, a drafted title and body), checks, Fix failing CI, and merged.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { mkdtemp } = require('./helpers/tmp');
const { execFileSync } = require('child_process');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');
const { parseDraft } = require('../core/pull-request');

const tmp = () => mkdtemp('pr');
const BIN = tmp(); const STATE = path.join(tmp(), 'gh.json'); const LOG = path.join(tmp(), 'gh.log');
fs.writeFileSync(path.join(BIN, 'gh'), `#!${process.execPath}\nrequire(${JSON.stringify(path.join(__dirname, 'fake-gh.js'))});\n`, { mode: 0o755 });
process.env.PATH = `${BIN}${path.delimiter}${process.env.PATH}`;
process.env.FAKE_GH_STATE = STATE; process.env.FAKE_GH_LOG = LOG;
const gh = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));
const setGh = (patch) => fs.writeFileSync(STATE, JSON.stringify({ ...gh(), ...patch }));
const calls = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

const TOKEN = 'tok_live_51Hq9secretvalue';
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
// One fake agent for every turn: it answers a drafting prompt with a title and body, a CI prompt by fixing calc.js
// and saying what it was given, and anything else by writing what the request says to calc.js.
const dev = { id: 'dev', name: 'Dev', protocol: 'codex-exec', available: true, headless: true, path: process.execPath, stdinPrompt: true,
  args: () => ['-e', `let s = ''; process.stdin.on('data', (c) => (s += c)).on('end', () => {
    const fs = require('fs'); let say = 'done';
    if (s.includes('TITLE: <one line')) say = s.includes('+module.exports = (a, b) => a + b;') ? 'TITLE: Add the numbers instead of subtracting them\\nBODY:\\nadd() subtracted.\\n\\n- calc.js adds' : 'TITLE: no diff';
    else if (s.includes('These checks failed')) { fs.writeFileSync('calc.js', 'module.exports = (a, b) => Number(a) + Number(b);\\n'); say = JSON.stringify({ first: s.includes('log line 101\\n'), cut: s.includes('log line 100\\n'), last: s.includes('log line 300'), redacted: s.includes('[REDACTED]'), preview: s.includes('Build failed') }); }
    else fs.writeFileSync('calc.js', s.trim().split('\\n').findLast((line) => line.startsWith('module.exports =')) + '\\n');
    console.log(JSON.stringify({type:'item.completed',item:{id:'i',type:'agent_message',text:say}})); console.log(JSON.stringify({type:'turn.completed'}));
  });`] };

async function setup() {
  fs.writeFileSync(STATE, '{}'); fs.writeFileSync(LOG, '');
  const origin = tmp(); sh(origin, 'init', '-q', '--bare', '-b', 'main');
  const d = tmp(); sh(d, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(d, '.gitignore'), '.env\n'); fs.writeFileSync(path.join(d, 'calc.js'), 'module.exports = (a, b) => a - b;\n');
  sh(d, 'add', '.'); sh(d, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  sh(d, 'remote', 'add', 'origin', origin); sh(d, 'push', '-q', '-u', 'origin', 'main');
  fs.writeFileSync(path.join(d, '.env'), `API_TOKEN=${TOKEN}\n`);
  const hub = await new Hub({ dataDir: tmp(), secrets: new MemorySecrets(), home: tmp() }).init();
  hub.agents = [dev];
  const t = hub.createThread(d);
  await hub.createWorktree(t.id);
  return { d, origin, hub, t, branch: hub.thread(t.id).worktree.branch };
}
const onRemote = (origin, branch) => execFileSync('git', ['for-each-ref', '--format=%(objectname)', `refs/heads/${branch}`], { cwd: origin, encoding: 'utf8' }).trim() || null;

test('Create pull request commits and pushes the copy, and opens one with the title and body an agent drafted', async () => {
  const { origin, hub, t, branch } = await setup();
  await assert.rejects(hub.createPullRequest(t.id, 'dev'), /Nothing to put in a pull request yet: tributary\/thread-\w+ has no changes compared with main/);
  assert.strictEqual(onRemote(origin, branch), null, 'nothing pushed');

  await hub.send({ threadId: t.id, agentId: 'dev', text: 'module.exports = (a, b) => a + b;' });
  const pr = await hub.createPullRequest(t.id, 'dev');
  assert.deepStrictEqual({ ...pr, createdAt: 0 }, { number: 7, url: 'https://github.com/acme/shop/pull/7', title: 'Add the numbers instead of subtracting them', base: 'main', state: 'OPEN', createdAt: 0 });
  assert.deepStrictEqual(hub.thread(t.id).worktree.pr, pr, 'stored on the copy');
  // The copy's work was committed on its branch and pushed before gh ran.
  const copy = hub.thread(t.id).worktree.path;
  assert.strictEqual(sh(copy, 'status', '--porcelain'), '');
  assert.strictEqual(onRemote(origin, branch), sh(copy, 'rev-parse', 'HEAD'));
  assert.strictEqual(sh(origin, 'show', `${branch}:calc.js`), 'module.exports = (a, b) => a + b;');
  assert.deepStrictEqual(gh().prs.map(({ head, base, title, body }) => ({ head, base, title, body })), [{ head: branch, base: 'main', title: pr.title, body: 'add() subtracted.\n\n- calc.js adds' }]);
  assert.deepStrictEqual(calls().map((c) => c.argv.slice(0, 2).join(' ')), ['auth status', 'repo view', 'auth status', 'repo view', 'pr create']);
  // The draft was a read-only turn in the conversation.
  const msgs = hub.thread(t.id).messages;
  assert.strictEqual(msgs.at(-2).text, 'Draft a pull request for this branch');
  assert.strictEqual(msgs.at(-1).mode, 'read'); assert.strictEqual(msgs.at(-1).team.role, 'writer');
  // Asking again gives the same pull request.
  assert.strictEqual((await hub.createPullRequest(t.id, 'dev')).url, pr.url);
  assert.strictEqual(gh().prs.length, 1);
  hub.store.save(true);
});

test('gh missing, signed out, or a pull request already open on GitHub', async () => {
  const { origin, hub, t, branch } = await setup();
  await hub.send({ threadId: t.id, agentId: 'dev', text: 'module.exports = (a, b) => a + b;' });
  process.env.TRIBUTARY_GH = path.join(BIN, 'no-such-gh');
  try { await assert.rejects(hub.createPullRequest(t.id, 'dev'), /The GitHub CLI \(gh\) is not installed\. Install it from https:\/\/cli\.github\.com/); } finally { delete process.env.TRIBUTARY_GH; }
  process.env.FAKE_GH_AUTH = 'none';
  try { await assert.rejects(hub.createPullRequest(t.id, 'dev'), /The GitHub CLI is not signed in\. Run "gh auth login"/); } finally { delete process.env.FAKE_GH_AUTH; }
  assert.strictEqual(onRemote(origin, branch), null, 'nothing pushed');
  // One opened on GitHub meanwhile is adopted instead of failing.
  setGh({ prs: [{ number: 12, url: 'https://github.com/acme/shop/pull/12', head: branch, base: 'main', title: 'Mine', state: 'OPEN' }] });
  const pr = await hub.createPullRequest(t.id, 'dev');
  assert.strictEqual(pr.number, 12); assert.strictEqual(pr.url, 'https://github.com/acme/shop/pull/12');
  hub.store.save(true);
});

test('a push that would publish a .env value is refused until you push anyway', async () => {
  const { origin, hub, t, branch } = await setup();
  await hub.send({ threadId: t.id, agentId: 'dev', text: `module.exports = '${TOKEN}';` });
  await assert.rejects(hub.createPullRequest(t.id, 'dev'), (e) => /looks like a secret/.test(e.message) && /API_TOKEN from \.env in calc\.js/.test(e.message) && !e.message.includes(TOKEN));
  assert.strictEqual(onRemote(origin, branch), null, 'nothing pushed');
  assert.ok(!calls().some((c) => c.argv[1] === 'create'));
  const pr = await hub.createPullRequest(t.id, 'dev', { allowSecrets: true });
  assert.strictEqual(pr.state, 'OPEN');
  assert.ok(onRemote(origin, branch));
  hub.store.save(true);
});

test('checks show with the pull request; Fix failing CI sends the failed logs to the agent, and Push sends the fix', async () => {
  const { origin, hub, t, branch } = await setup();
  assert.strictEqual(await hub.pullRequestStatus(t.id), null, 'no pull request yet');
  await hub.send({ threadId: t.id, agentId: 'dev', text: 'module.exports = (a, b) => a + b;' });
  const pr = await hub.createPullRequest(t.id, 'dev');
  assert.deepStrictEqual((await hub.pullRequestStatus(t.id)).checks, [], 'no checks reported yet');

  const log = Array.from({ length: 300 }, (_, i) => `test\tRun npm test\tlog line ${i + 1}${i === 250 ? ` token=${TOKEN}` : ''}`).join('\n');
  setGh({ checks: { 7: [
    { name: 'test', workflow: 'CI', state: 'FAILURE', bucket: 'fail', link: 'https://github.com/acme/shop/actions/runs/555/job/9001', description: '' },
    { name: 'lint', workflow: 'CI', state: 'IN_PROGRESS', bucket: 'pending', link: 'https://github.com/acme/shop/actions/runs/555/job/9002', description: '' },
    { name: 'Vercel', workflow: '', state: 'FAILURE', bucket: 'fail', link: 'https://vercel.com/acme/shop/abc', description: 'Build failed' },
  ] }, logs: { 555: `${log}\n` } });
  const st = await hub.pullRequestStatus(t.id);
  assert.strictEqual(st.state, 'OPEN'); assert.strictEqual(st.unpushed, 0);
  assert.deepStrictEqual(st.checks.map((c) => [c.name, c.bucket, c.runId]), [['test', 'fail', '555'], ['lint', 'pending', '555'], ['Vercel', 'fail', undefined]]);

  const fix = await hub.fixFailingChecks(t.id, 'dev');
  assert.deepStrictEqual(fix.checks, ['test', 'Vercel']);
  const msgs = hub.thread(t.id).messages;
  assert.strictEqual(msgs.at(-2).text, `Fix the failing checks on pull request #${pr.number}: test, Vercel`);
  assert.strictEqual(msgs.at(-1).mode, 'edit');
  // The agent got the last 200 lines of the failed steps, with the .env value masked, and the other check's note.
  assert.deepStrictEqual(JSON.parse(msgs.at(-1).text), { first: true, cut: false, last: true, redacted: true, preview: true });
  assert.ok(!JSON.stringify(msgs).includes(TOKEN));
  assert.deepStrictEqual(calls().find((c) => c.argv[0] === 'run').argv, ['run', 'view', '555', '--log-failed', '-R', 'github.com/acme/shop']);

  // The fix is in the copy, not on GitHub, until it is pushed.
  const before = onRemote(origin, branch);
  const pushed = await hub.pushPullRequest(t.id);
  assert.notStrictEqual(onRemote(origin, branch), before);
  assert.strictEqual(sh(origin, 'show', `${branch}:calc.js`), 'module.exports = (a, b) => Number(a) + Number(b);');
  assert.strictEqual(pushed.unpushed, 0);
  setGh({ checks: { 7: [{ name: 'test', workflow: 'CI', state: 'SUCCESS', bucket: 'pass', link: 'https://github.com/acme/shop/actions/runs/556/job/9003', description: '' }] } });
  await assert.rejects(hub.fixFailingChecks(t.id, 'dev'), /No checks are failing on pull request #7/);
  hub.store.save(true);
});

test('a merged pull request is recorded on the copy, which can then be discarded', async () => {
  const { d, hub, t, branch } = await setup();
  await hub.send({ threadId: t.id, agentId: 'dev', text: 'module.exports = (a, b) => a + b;' });
  await hub.createPullRequest(t.id, 'dev');
  const state = gh(); state.prs[0].state = 'MERGED'; state.prs[0].mergedAt = '2026-11-03T12:00:00Z'; setGh(state);
  const st = await hub.pullRequestStatus(t.id);
  assert.strictEqual(st.state, 'MERGED');
  assert.strictEqual(hub.thread(t.id).worktree.pr.state, 'MERGED');
  assert.strictEqual(hub.thread(t.id).worktree.pr.mergedAt, Date.parse('2026-11-03T12:00:00Z'));
  await hub.discardWorktree(t.id);
  assert.strictEqual(hub.thread(t.id).worktree, undefined);
  assert.strictEqual(sh(d, 'branch', '--list', branch), '', 'the local branch went with the copy');
  hub.store.save(true);
});

test('drafts are read from TITLE and BODY, with fallbacks', () => {
  assert.deepStrictEqual(parseDraft('**TITLE:** "Fix login"\n**BODY:**\n```markdown\nIt works.\n```'), { title: 'Fix login', body: 'It works.' });
  assert.deepStrictEqual(parseDraft('TITLE: Only a title'), { title: 'Only a title', body: '' });
  assert.deepStrictEqual(parseDraft('Just some prose.', 'Thread title'), { title: 'Thread title', body: 'Just some prose.' });
});
