'use strict';
require('./helpers/tmp').useCheckpointDir();
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const { EventEmitter } = require('node:events');
const { mkdtemp } = require('./helpers/tmp'); const { SqliteStore, Store, MemorySecrets } = require('../core/store');
const { HistoryCache, manageHistories } = require('../core/history-cache'); const { Hub } = require('../core/hub');
const { bindMessageDelivery } = require('../core/message-delivery');
const defaults = { version: 1, projects: [], threads: [], gateways: [], notifications: [], settings: {} };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(setImmediate);
function fixture(t, count = 2) {
  const dir = mkdtemp('history-cache'); const store = new SqliteStore(dir, defaults);
  for (let i = 0; i < count; i++) store.data.threads.push({ id: `chat-${i}`, project: dir, title: `Chat ${i}`, agentSessions: { fixture: 'session' }, messages: [0, 1, 2].map((j) => ({ id: `${i}-${j}`, role: 'assistant', text: `reply-${j}`, tools: [{ output: `log-${j}` }], ok: true })) });
  store.save(true); store.close();
  const opened = new SqliteStore(dir, defaults); const errors = []; const cache = new HistoryCache(opened, { idleMs: 60000, onError: (e) => errors.push(e.message) });
  t.after(() => opened.close()); return { dir, store: opened, cache, errors, thread: opened.data.threads[0] };
}
const own = (cache, thread, fn) => cache.run(() => { cache.touch(thread.id); return fn(thread); });

test('release saves pending rows and explicit deletions before forgetting fingerprints; full save preserves lazy histories', (t) => {
  const { dir, store, cache, thread } = fixture(t);
  own(cache, thread, (thread) => { thread.messages[0].text = 'saved stream'; thread.messages.splice(1, 1); thread.messages.push({ id: 'new', role: 'assistant', text: 'final', model: 'fixture', trace: [{ kind: 'tool' }], ok: true }); store.save(false, thread.id, 'new'); });
  assert.equal(cache.trim(Infinity), 1); assert.equal(store.isLoaded(thread), false);
  assert.equal([...store.snap.keys()].filter((key) => key.startsWith('m:chat-0\0')).length, 0);
  store.save(true); const read = store.readThread(thread); assert.deepEqual(read.messages.map((m) => m.id), ['0-0', '0-2', 'new']); assert.equal(read.messages[0].text, 'saved stream');
  assert.deepEqual(read.agentSessions, { fixture: 'session' }); assert.deepEqual(read.messages[2].trace, [{ kind: 'tool' }]); assert.equal(store.isLoaded(thread), false);
  const reopened = new SqliteStore(dir, defaults); t.after(() => reopened.close()); assert.deepEqual(reopened.readThread(reopened.data.threads[0]), read);
});

test('nested and overlapping owners retain the same messages until the final operation ends', async (t) => {
  const { store, cache, thread } = fixture(t); const gate = deferred(); let message;
  const outer = own(cache, thread, async () => { message = thread.messages[0]; await cache.run(async () => { cache.touch(thread.id); message.text = 'inner'; store.save(true, thread.id); }); assert.equal(cache.trim(Infinity), 0); await gate.promise; message.text = 'outer final'; store.save(false, thread.id); });
  await tick(); assert.strictEqual(thread.messages[0], message); assert.equal(store.releaseMessages(thread), false, 'a direct release cannot bypass an active owner');
  const otherGate = deferred(); const other = own(cache, thread, async () => { await otherGate.promise; assert.strictEqual(thread.messages[0], message); });
  gate.resolve(); await outer; assert.equal(cache.trim(Infinity), 0); otherGate.resolve(); await other;
  assert.equal(cache.trim(Infinity), 1); assert.equal(store.readThread(thread).messages[0].text, 'outer final'); assert.equal(cache.pins.size, 0);
});

test('a background child outlives its synchronous parent and still pins active ancestors on later touches', async (t) => {
  const { store, cache } = fixture(t); const thread = store.data.threads[1]; const start = deferred(); const childFinished = deferred(); const rootFinished = deferred(); let child;
  const root = cache.run(async () => {
    cache.run(() => { child = cache.run(async () => { await start.promise; cache.touch(thread.id); thread.messages[0].text = 'child result'; await childFinished.promise; }); });
    await rootFinished.promise;
  });
  start.resolve(); await tick(); assert.equal(cache.pins.get(thread.id), 2);
  childFinished.resolve(); await child; assert.equal(cache.pins.get(thread.id), 1); assert.equal(cache.trim(Infinity), 0);
  rootFinished.resolve(); await root; assert.equal(cache.trim(Infinity), 1); assert.equal(store.readThread(thread).messages[0].text, 'child result');
});

test('independent history owners do not keep unrelated completed chats loaded, and throws release owners', async (t) => {
  const { store, cache, thread } = fixture(t); const other = store.data.threads[1]; const gate = deferred();
  const active = own(cache, thread, async () => { thread.messages[0].text = 'active'; await gate.promise; });
  own(cache, other, () => { other.messages[0].text = 'completed'; });
  assert.equal(cache.trim(Infinity), 1); assert.equal(store.isLoaded(other), false); assert.equal(store.isLoaded(thread), true);
  gate.resolve(); await active; cache.trim(Infinity);
  assert.throws(() => own(cache, thread, () => { thread.messages[0].text = 'sync error'; throw new Error('sync'); }), /sync/);
  await assert.rejects(own(cache, thread, async () => { await tick(); thread.messages[0].text = 'async error'; throw new Error('async'); }), /async/);
  assert.equal(cache.pins.size, 0); cache.trim(Infinity); assert.equal(store.readThread(thread).messages[0].text, 'async error');
});

test('external updates and removals reconcile with local dirty precedence before and after release', (t) => {
  const { dir, store, cache, thread } = fixture(t); const external = new SqliteStore(dir, defaults); t.after(() => external.close()); const remote = external.data.threads[0];
  own(cache, thread, () => {
    thread.messages[0].text = 'local unsaved wins'; store.save(false, thread.id, thread.messages[0].id);
    remote.messages[0].text = 'external edit'; remote.messages.splice(1, 1); remote.messages.push({ id: 'remote-new', text: 'remote append', role: 'assistant', ok: true }); external.save(true);
    store.sync(); assert.equal(thread.messages[0].text, 'local unsaved wins'); assert.deepEqual(thread.messages.map((m) => m.id), ['0-0', '0-2', 'remote-new']);
  });
  assert.equal(cache.trim(Infinity), 1); store.save(true);
  external.sync(); remote.messages[1].text = 'external after release'; external.save(true); store.sync();
  const result = store.readThread(thread); assert.equal(result.messages[0].text, 'local unsaved wins'); assert.equal(result.messages[1].text, 'external after release'); assert.equal(store.isLoaded(thread), false);
  own(cache, thread, () => { assert.equal(thread.messages.at(-1).id, 'remote-new'); thread.messages.pop(); });
  cache.trim(Infinity); store.save(true); external.sync(); assert.equal(remote.messages.length, 2);
  external.data.threads = external.data.threads.filter((item) => item.id !== thread.id); external.save(true); store.sync(); store.save(true);
  assert.equal(store.data.threads.some((item) => item.id === thread.id), false);
  assert.equal(store.q.messageCount.get(`m:${thread.id}`).count, 0, 'a full save after an external thread deletion cannot resurrect released rows');
});

test('a failed save retains live messages and fingerprints for retry, never pretending they were released', (t) => {
  const { store, cache, thread, errors } = fixture(t); own(cache, thread, () => { thread.messages[0].text = 'must survive'; });
  const flush = store.flush; const snapshots = store.snap.size; store.flush = () => { throw new Error('database is busy'); };
  assert.equal(cache.trim(Infinity), 0); assert.equal(store.isLoaded(thread), true); assert.equal(store.snap.size, snapshots); assert.equal(thread.messages[0].text, 'must survive'); assert.deepEqual(errors, ['database is busy']);
  store.flush = flush; assert.equal(cache.trim(Infinity), 1); assert.equal(store.readThread(thread).messages[0].text, 'must survive');
});

test('direct mutable access stays unmanaged, while the JSON store keeps its original behavior', (t) => {
  const { store, cache, thread } = fixture(t);
  const direct = thread.messages[0]; assert.equal(cache.unmanaged.has(thread.id), true); direct.text = 'later SDK mutation'; cache.trim(Infinity); assert.equal(store.isLoaded(thread), true); store.save(true); assert.equal(thread.messages[0].text, direct.text);
  const json = new Store(path.join(mkdtemp('json-history'), 'hub.json'), defaults); assert.equal(manageHistories({ store: json }, {}), null); json.data.threads.push({ id: 'json', messages: [] }); json.save(true); assert.equal(json.isLoaded(json.data.threads[0]), true); json.close();
});

test('coalesced and asynchronous transport delivery hold their own message lease through settlement', async (t) => {
  const { store, cache, thread } = fixture(t); const hub = new EventEmitter(); hub.holdHistory = (id) => cache.hold(id); const delivered = deferred(); const settle = deferred();
  const dispose = bindMessageDelivery(hub, (_name, data) => { delivered.resolve(data); return settle.promise; }, 5); t.after(dispose);
  let message; own(cache, thread, () => { message = thread.messages[0]; hub.emit('event', { threadId: thread.id, message }); });
  assert.equal(cache.trim(Infinity), 0); const data = await delivered.promise; assert.strictEqual(data.message, message); assert.equal(cache.trim(Infinity), 0, 'await webview serialization');
  settle.resolve(true); await tick(); assert.equal(cache.trim(Infinity), 1);
  own(cache, thread, () => { message = thread.messages[0]; hub.emit('event', { threadId: thread.id, message }); hub.emit('message', { threadId: thread.id, message }); });
  await tick(); assert.equal(cache.pins.size, 0); assert.equal(cache.trim(Infinity), 1);
  own(cache, thread, () => { hub.emit('event', { threadId: thread.id, message: thread.messages[0] }); }); dispose(); dispose(); assert.equal(cache.pins.size, 0); assert.equal(cache.trim(Infinity), 1);
});

test('Hub operations pin before verification root lookup and preserve race judgments after nested turns', async (t) => {
  const root = mkdtemp('hub-history'); const hub = new Hub({ dataDir: path.join(root, 'profile'), home: root, secrets: new MemorySecrets(), historyCache: { idleMs: 60000 } }); t.after(() => { hub.fileWatches.close(); hub.store.close(); });
  const thread = hub.withHistoryOperation(() => { const thread = hub.createThread(root); thread.messages.push({ id: 'race', role: 'assistant', text: 'race', ok: true, race: { task: 'Compare', candidates: [{ agent: 'winner', status: 'done', files: [], diff: '' }] } }); hub.store.save(true); return thread; });
  // The lookup crosses an await even outside a Git repository.
  const checking = hub.runVerify(thread.id, 'race'); assert.equal(hub.histories.trim(Infinity), 0); await checking; assert.equal(hub.histories.trim(Infinity), 1);
  hub.agents = [{ id: 'judge', name: 'Judge' }];
  const entered = deferred(); const finish = deferred();
  hub.send = async ({ threadId }) => hub.withHistoryOperation(async () => { const current = hub.thread(threadId); current.messages.push({ id: 'judgment', role: 'assistant', text: 'WINNER: winner', ok: true }); entered.resolve(); await finish.promise; return current.messages.at(-1); });
  const judging = hub.judgeRace(thread.id, 'race', 'judge'); await entered.promise; assert.equal(hub.histories.trim(Infinity), 0); finish.resolve(); await judging;
  assert.equal(hub.histories.trim(Infinity), 1); const saved = hub.withHistoryOperation(() => hub.readThread(thread.id)); assert.equal(saved.messages[0].race.judge.winner, 'winner'); assert.equal(saved.messages[0].race.judge.messageId, 'judgment'); assert.equal(hub.histories.pins.size, 0);
});

const { execFileSync } = require('node:child_process');
function repository(root) {
  fs.mkdirSync(root, { recursive: true }); execFileSync('git', ['init', '-q'], { cwd: root }); fs.writeFileSync(path.join(root, 'file.txt'), 'original\n');
  execFileSync('git', ['add', '.'], { cwd: root }); execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Initial'], { cwd: root });
}
const until = async (fn) => { const start = Date.now(); while (!fn()) { if (Date.now() - start > 15000) throw new Error('Timed out'); await new Promise((resolve) => setTimeout(resolve, 10)); } };
const emitReply = (text) => `console.log(JSON.stringify({type:'item.completed',item:{id:'reply',type:'agent_message',text:${JSON.stringify(text)}}}));console.log(JSON.stringify({type:'turn.completed'}));`;
const localAgent = (id, code = emitReply('Fixture answer')) => ({ id, name: id, protocol: 'codex-exec', available: true, headless: true, path: process.execPath, stdinPrompt: true, args: () => ['-e', code] });

test('a team keeps one history through gaps between real CLI turns and releases it after the whole team finishes', async (t) => {
  const root = mkdtemp('team-history'); const hub = new Hub({ dataDir: path.join(root, 'profile'), home: root, secrets: new MemorySecrets(), historyCache: { idleMs: 10 } }); t.after(() => { hub.fileWatches.close(); hub.store.close(); });
  hub.agents = [localAgent('one'), localAgent('two')]; const thread = hub.withHistoryOperation(() => hub.createThread(root));
  const send = hub.send; let gaps = 0;
  hub.send = async (input) => { const reply = await send(input); gaps++; assert.equal(hub.histories.trim(Infinity), 0, 'team still owns between turns'); await new Promise((resolve) => setTimeout(resolve, 20)); return reply; };
  const result = await hub.runTeam(thread.id, { recipe: 'council', task: 'Compare fixture answers', roles: { members: ['one', 'two'], synthesizer: 'one' } });
  assert.equal(result.verdict, 'answered'); assert.equal(gaps, 3); assert.equal(hub.histories.unmanaged.size, 0); assert.equal(hub.histories.trim(Infinity), 1);
  const saved = hub.withHistoryOperation(() => hub.readThread(thread.id)); assert.equal(saved.messages.filter((m) => m.role === 'assistant').length, 3); assert.equal(saved.teamRuns.at(-1).status, 'done'); assert.equal(hub.store.isLoaded(thread), false);
});

test('checkpoint restoration and delayed untrusted verification persist results to the original message', async (t) => {
  const root = mkdtemp('checkpoint-history'); const project = path.join(root, 'project'); repository(project);
  fs.mkdirSync(path.join(project, '.tributary')); fs.writeFileSync(path.join(project, '.tributary', 'settings.json'), JSON.stringify({ scripts: { verify: 'node -e "process.exit(0)"' } }));
  const checkpoint = await require('../core/checkpoint').createCheckpoint(project, 'history-before');
  const hub = new Hub({ dataDir: path.join(root, 'profile'), home: root, secrets: new MemorySecrets(), historyCache: { idleMs: 10 } }); t.after(() => { hub.fileWatches.close(); hub.store.close(); });
  const thread = hub.withHistoryOperation(() => { const thread = hub.createThread(project); thread.messages.push({ id: 'edit', role: 'assistant', text: 'changed file', checkpoint, notices: [], ok: true }); hub.store.save(true); return thread; });
  fs.writeFileSync(path.join(project, 'file.txt'), 'changed\n'); const restoring = hub.restoreCheckpoint(thread.id, 'edit'); assert.equal(hub.histories.trim(Infinity), 0); await restoring;
  assert.equal(hub.histories.trim(Infinity), 1); assert.equal(fs.readFileSync(path.join(project, 'file.txt'), 'utf8'), 'original\n');
  const checking = hub.runVerify(thread.id, 'edit'); assert.equal(hub.histories.trim(Infinity), 0); const verification = await checking; assert.equal(verification.state, 'untrusted');
  hub.histories.trim(Infinity); const saved = hub.withHistoryOperation(() => hub.readThread(thread.id)); assert.match(saved.messages[0].notices[0], /Files restored/); assert.equal(saved.messages[0].verify.state, 'untrusted');
});

test('a delegated worker owns the parent message until publication after the parent turn and bridge close', async (t) => {
  const root = mkdtemp('delegate-history'); const project = path.join(root, 'project'); repository(project); const gate = path.join(root, 'worker-finish');
  const hub = new Hub({ dataDir: path.join(root, 'profile'), home: root, secrets: new MemorySecrets(), historyCache: { idleMs: 10 } }); let bridge;
  t.after(async () => { fs.writeFileSync(gate, 'finish'); bridge?.close(); for (const id of hub.running.keys()) hub.stop(id); await until(() => !hub.running.size); hub.fileWatches.close(); hub.store.close(); });
  hub.agents = [localAgent('worker', `process.stdin.resume();const timer=setInterval(()=>{if(require('node:fs').existsSync(${JSON.stringify(gate)})){clearInterval(timer);${emitReply('Worker completed after parent')}}},10);`)];
  const started = deferred(); const finishParent = deferred(); let parent, message;
  const turn = hub.withHistoryOperation(async () => { parent = hub.createThread(project); message = { id: 'parent-message', role: 'assistant', text: 'delegating', ok: null, notices: [] }; parent.messages.push(message); hub.store.save(true); bridge = await require('../core/delegation').openDelegation(hub, parent, message, { mode: 'edit', signal: new AbortController().signal }); started.resolve(); await finishParent.promise; message.ok = true; hub.store.save(true); });
  await started.promise; const child = await bridge.call('start', { agentId: 'worker', task: 'Run the delayed fixture task' }); finishParent.resolve(); await turn; bridge.close();
  assert.equal(hub.histories.trim(Infinity), 0); await new Promise((resolve) => setTimeout(resolve, 30)); assert.equal(hub.store.isLoaded(parent), true);
  fs.writeFileSync(gate, 'finish'); await until(() => message.delegations?.[0]?.state === 'done' && hub.histories.pins.size === 0);
  assert.equal(hub.histories.unmanaged.size, 0); hub.histories.trim(Infinity);
  const saved = hub.withHistoryOperation(() => hub.readThread(parent.id)); assert.equal(saved.messages[0].delegations[0].state, 'done'); assert.equal(saved.messages[0].delegations[0].id, child.id);
});

test('one failed idle batch defers the other chats instead of retrying a locked database for every history', (t) => {
  const { store, cache, errors } = fixture(t); for (const thread of store.data.threads) own(cache, thread, () => { thread.messages[0].text = 'pending'; });
  const flush = store.flush; let attempts = 0; store.flush = () => { attempts++; throw new Error('locked'); };
  assert.equal(cache.trim(Infinity), 0); assert.equal(attempts, 1); assert.deepEqual(errors, ['locked']); assert.equal(store.data.threads.every((thread) => store.isLoaded(thread)), true);
  store.flush = flush; assert.equal(cache.trim(Infinity), 2);
});

test('failed thenable inspection releases its owner and closing prevents late callbacks from reopening ownership', async (t) => {
  const { cache, thread } = fixture(t);
  assert.throws(() => own(cache, thread, () => ({ get then() { throw new Error('invalid thenable'); } })), /invalid thenable/); assert.equal(cache.pins.size, 0);
  const gate = deferred(); let active;
  const operation = own(cache, thread, async () => { active = cache.context.getStore(); await gate.promise; cache.touch(thread.id); assert.equal(cache.pins.size, 0); assert.equal(cache.closed, true); });
  assert.equal(active.active, true); cache.close(); gate.resolve(); await operation;
  assert.equal(cache.timer, null); assert.equal(cache.pins.size, 0); assert.equal(cache.idle.size, 0);
});
