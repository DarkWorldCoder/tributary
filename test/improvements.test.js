'use strict';
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { EventEmitter } = require('node:events');
const memory = require('../core/memory');
const state = require('../core/memory-state');
const { digest } = require('../core/handoff');
const { Hub, MemorySecrets } = require('../core');
const { FileWatches } = require('../core/file-watch');
const { report } = require('../core/connectors');
const { verdict } = require('../core/teams');
const { listMcp } = require('../core/mcp');
const { redact } = require('../core/mcp');

function temp(t) { const dir = mkTmp('improvements'); t.after(() => fs.rmSync(dir, { force: true, recursive: true })); return dir; }
test('memory rejects stale edits, preserves versions, bounds retrieval and defaults to private prompts', (t) => {
  const root = temp(t); memory.enableMemory(root);
  assert.equal(memory.readMemory(root).context.includeInPrompts, false);
  const original = memory.readMemory(root); memory.saveMemory(root, '# Decisions\n- Use SQLite for durable agent state.\n- Keep email private.\n', original.revision);
  assert.throws(() => memory.saveMemory(root, 'stale edit', original.revision), /changed since/);
  assert.equal(state.previous(root, original.revision), original.memory);
  assert.match(memory.readMemory(root).memory, /SQLite/);
  for (let i = 0; i < 25; i++) { const previous = memory.readMemory(root); memory.saveMemory(root, previous.memory + `- Item ${i}: ${'x'.repeat(500)}\n`, previous.revision); }
  assert.equal(state.history(root).length, 20);
  const result = state.retrieve(root, 'SQLite agent state', 2000);
  assert.ok(result.text.length <= 2000); assert.match(result.text.split('\n')[0], /SQLite/); assert.ok(result.sources.length); assert.ok(result.omitted > 0);
  assert.throws(() => state.previous(root, '../../private'), /Invalid memory version/);
  state.configure(root, { includeInPrompts: true, budget: 2000 }); assert.equal(memory.readMemory(root).context.includeInPrompts, true);
  const lock = path.join(root, '.tributary/memory.lock'); fs.writeFileSync(lock, '');
  assert.throws(() => memory.remember(root, 'cannot overwrite'), /being updated/); fs.unlinkSync(lock);
});
test('memory state refuses symlink escape and oversized notes without overwriting them', (t) => {
  const root = temp(t); const outside = temp(t); fs.symlinkSync(outside, path.join(root, '.tributary'));
  assert.throws(() => memory.enableMemory(root), /symbolic links/); assert.deepEqual(fs.readdirSync(outside), []);
  fs.unlinkSync(path.join(root, '.tributary')); memory.enableMemory(root);
  assert.throws(() => memory.saveMemory(root, 'x'.repeat(256 * 1024 + 1)), /256 KB/);
  assert.match(memory.readMemory(root).memory, /Project memory/);
});
test('memory excerpts reach the actual direct request only after opt-in, with persisted source attribution', async (t) => {
  const root = temp(t); const hub = new Hub({ dataDir: temp(t), secrets: new MemorySecrets() }); t.after(() => hub.store.close());
  hub.addProject(root); hub.enableMemory(root); hub.remember(root, 'SQLite is the agreed storage engine.');
  const connection = await hub.saveGateway({ name: 'Fixture', direct: true, protocol: 'openai', baseUrl: 'http://localhost:1234/v1', model: 'fixture' });
  const thread = hub.createThread(root); const original = globalThis.fetch; const prompts = []; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (_url, options) => { prompts.push(JSON.parse(options.body).messages[1].content); return new Response(JSON.stringify({ choices: [{ message: { content: 'Fixture response' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } }); };
  const first = await hub.send({ threadId: thread.id, agentId: `direct:${connection}`, text: 'Which storage engine?' });
  assert.equal(first.memoryContext, undefined); assert.ok(!prompts[0].includes('SQLite'));
  hub.configureMemory(root, { includeInPrompts: true, budget: 2000 });
  const second = await hub.send({ threadId: thread.id, agentId: `direct:${connection}`, text: 'Which storage engine?' });
  assert.match(prompts[1], /SQLite/); assert.ok(second.memoryContext.characters <= 2000); assert.equal(second.memoryContext.sources[0].source, '.tributary/memory.md');
  hub.configureMemory(root, { includeInPrompts: false, budget: 2000 });
  const next = hub.createThread(root); await hub.send({ threadId: next.id, agentId: `direct:${connection}`, text: 'Another question' });
  assert.ok(!prompts[2].includes('SQLite'));
});
test('handoff digest respects strict character budgets and retains the original and latest task context', () => {
  const messages = Array.from({ length: 50 }, (_, i) => ({ role: 'user', text: `message ${i} ${'x'.repeat(3000)}` }));
  for (const budget of [0, 40, 2000, 12000]) assert.ok(digest(messages, {}, budget).length <= budget);
  const text = digest(messages, {}, 2000); assert.match(text, /message 0/); assert.match(text, /message 49/);
});
test('teams validate every role before executing and persist successful or uncertain run records', async (t) => {
  const root = temp(t); const data = temp(t); const hub = new Hub({ dataDir: data, secrets: new MemorySecrets() }); t.after(() => hub.store.close());
  hub.addProject(root); const thread = hub.createThread(root); hub.agents = ['a', 'b'].map((id) => ({ id, name: id, available: true, protocol: 'codex-exec' }));
  let calls = 0; hub.send = async ({ agentId }) => { calls++; return { id: String(calls), ok: true, text: agentId === 'b' ? 'VERDICT: APPROVED\nActually, there is a bug.' : 'Built it' }; };
  await assert.rejects(hub.runTeam(thread.id, { recipe: 'build-review', task: 'Build', roles: { builder: 'a', reviewer: 'missing' } }), /unavailable/); assert.equal(calls, 0);
  await assert.rejects(hub.runTeam(thread.id, { recipe: 'build-review', task: 'Build', maxRounds: NaN, roles: { builder: 'a', reviewer: 'b' } }), /rounds/);
  const result = await hub.runTeam(thread.id, { recipe: 'build-review', task: 'Build', roles: { builder: 'a', reviewer: 'b' } });
  assert.equal(result.verdict, 'unknown'); assert.equal(calls, 2); assert.equal(hub.teamRuns(thread.id)[0].status, 'attention');
  const reopened = new Hub({ dataDir: data, secrets: new MemorySecrets() }); t.after(() => reopened.store.close()); assert.equal(reopened.teamRuns(thread.id)[0].steps.length, 2);
  hub.send = async () => { throw new Error('Fixture stopped'); };
  await assert.rejects(hub.runTeam(thread.id, { recipe: 'build-review', task: 'Build again', roles: { builder: 'a', reviewer: 'b' } }), /Fixture stopped/);
  assert.equal(hub.teamRuns(thread.id)[0].status, 'failed'); assert.equal(hub.teamRuns(thread.id)[0].steps[0].state, 'failed');
  assert.equal(verdict('Example: VERDICT: APPROVED'), 'unknown'); assert.equal(verdict('Reviewed\nVERDICT: APPROVED'), 'approved');
});
test('connector diagnostics omit credentials, expose configuration failures and never claim live tool access', async (t) => {
  const root = temp(t); fs.mkdirSync(path.join(root, '.gemini')); fs.writeFileSync(path.join(root, '.gemini/settings.json'), '{invalid-secret-json');
  const warnings = []; const rows = await listMcp({ home: root, agents: [{ id: 'gemini', available: true }], warnings });
  assert.equal(rows.length, 0); assert.equal(warnings.length, 1); assert.ok(!JSON.stringify(warnings).includes('invalid-secret-json'));
  const result = report({ gateways: [{ id: 'a', name: 'broken', direct: true, baseUrl: 'http://remote.example', model: 'x', protocol: 'openai', apiKey: 'private-value' }], agents: [], mcp: [], warnings });
  assert.equal(result.connections[0].status, 'needs-attention'); assert.ok(!JSON.stringify(result).includes('private-value')); assert.match(result.note, /cannot use MCP/);
  const hidden = redact('https://user:privatepass@example.com/mcp --token private-token API_TOKEN=private-env');
  for (const secret of ['privatepass', 'private-token', 'private-env']) assert.ok(!hidden.includes(secret));
});
test('live views retain a polling fallback when native filesystem events are unavailable', async (t) => {
  const root = temp(t); const file = path.join(root, 'shared.md'); fs.writeFileSync(file, 'initial');
  const original = fs.watch; fs.watch = () => { throw new Error('native events unavailable'); };
  const events = new EventEmitter(); const watches = new FileWatches((event) => events.emit('change', event));
  t.after(() => { fs.watch = original; watches.close(); });
  await watches.start(root, ['shared.md']); fs.watch = original;
  const update = once(events, 'change', { signal: AbortSignal.timeout(6000) }); fs.writeFileSync(file, 'changed through a shared mount');
  assert.ok((await update)[0].paths.includes('shared.md'));
});
test('live file views notice writes and atomic replacements, reject escapes and stop cleanly', async (t) => {
  const root = temp(t); const outside = temp(t); fs.writeFileSync(path.join(root, 'note.md'), 'initial'); fs.symlinkSync(outside, path.join(root, 'escape'));
  const events = new EventEmitter(); const watches = new FileWatches((event) => events.emit('change', event)); t.after(() => watches.close());
  await assert.rejects(watches.start(root, ['escape/private.md']), /outside project/);
  const id = await watches.start(root, ['note.md']);
  const next = () => once(events, 'change', { signal: AbortSignal.timeout(4000) });
  let changed = next(); fs.writeFileSync(path.join(root, 'note.md'), 'agent edit'); assert.ok((await changed)[0].paths.includes('note.md'));
  changed = next(); fs.writeFileSync(path.join(root, 'replacement'), 'atomic edit'); fs.renameSync(path.join(root, 'replacement'), path.join(root, 'note.md')); assert.equal((await changed)[0].watchId, id);
  watches.stop(id); assert.equal(watches.watches.size, 0);
});
test('diff presentation preserves hunk line numbers, replacement pairs and a bounded view', async () => {
  const { diffRows } = await import('../core/diff-view.mjs');
  const diff = diffRows('--- a/a.txt\n+++ b/a.txt\n@@ -10,3 +10,2 @@\n-old one\n-old two\n+new one\n unchanged');
  assert.equal(diff.added, 1); assert.equal(diff.removed, 2);
  const pair = diff.split.find((row) => row.left?.kind === 'remove');
  assert.equal(pair.left.before, 10); assert.equal(pair.right.after, 10);
  assert.equal(diff.rows.find((row) => row.kind === 'context').before, 12);
  const huge = diffRows(Array.from({ length: 3000 }, () => '+<script>text only</script>').join('\n'));
  assert.equal(huge.rows.length, 2000); assert.equal(huge.truncated, true);
});
test('Git change views preserve unicode, spaces, newlines and rename destinations', async (t) => {
  const root = temp(t); const git = (args) => require('node:child_process').execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git(['init', '-q']); const original = 'a file.txt'; const renamed = 'renamed "file".txt'; const unicode = 'नेपाल.txt'; const newline = 'line\nbreak.txt';
  for (const file of [original, unicode, newline]) fs.writeFileSync(path.join(root, file), 'before\n');
  git(['add', '-A']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'initial']);
  fs.renameSync(path.join(root, original), path.join(root, renamed)); git(['add', '-A']); fs.writeFileSync(path.join(root, unicode), 'after\n'); fs.writeFileSync(path.join(root, newline), 'changed\n');
  const { gitInfo, fileDiff } = require('../core/git'); const result = await gitInfo(root);
  assert.ok(result.changed.some((c) => c.path === unicode)); assert.ok(result.changed.some((c) => c.path === newline));
  assert.equal(result.changed.find((c) => c.path === renamed).from, original);
  assert.match(await fileDiff(root, unicode), /\+after/);
  const outside = temp(t); fs.writeFileSync(path.join(outside, 'private.txt'), 'private'); fs.symlinkSync(outside, path.join(root, 'escape'));
  await assert.rejects(fileDiff(root, 'escape/private.txt'), /outside project/);
});
test('new repositories, binary files and oversized untracked files have honest bounded comparisons', async (t) => {
  const root = temp(t); const git = (args) => require('node:child_process').execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git(['init', '-q']); fs.writeFileSync(path.join(root, 'first.txt'), 'first commit pending\n'); git(['add', 'first.txt']);
  const { fileDiff } = require('../core/git'); assert.match(await fileDiff(root, 'first.txt'), /\+first commit pending/);
  fs.writeFileSync(path.join(root, 'binary.dat'), Buffer.from([0, 1, 2])); assert.match(await fileDiff(root, 'binary.dat'), /Binary file/);
  fs.writeFileSync(path.join(root, 'large.txt'), Buffer.alloc(1024 * 1024 + 100, 'x')); assert.match(await fileDiff(root, 'large.txt'), /larger than 1 MB/);
});
