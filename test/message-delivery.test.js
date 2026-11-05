'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { bindMessageDelivery } = require('../core/message-delivery');
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(setImmediate);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async fn => { const deadline = Date.now() + 5000; while (!fn()) { if (Date.now() > deadline) throw Error('Delivery did not settle'); await wait(2); } };
const gate = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const message = id => ({ id, role: 'assistant', text: '', thinking: '', tools: [], ok: null });
function fixture(deliver, options) {
  const hub = new EventEmitter(); let held = 0, peak = 0;
  hub.holdHistory = () => { held++; peak = Math.max(peak, held); let owned = true; return () => { if (owned) { owned = false; held--; } }; };
  const dispose = bindMessageDelivery(hub, deliver, 2, options);
  return { hub, dispose, held: () => held, peak: () => peak, emit: (name, value, threadId = 'chat') => hub.emit(name, { threadId, message: value }) };
}

test('a slow transport owns one in-flight and one latest update, then delivers the exact final message', async t => {
  const posts = []; const gates = [];
  const f = fixture((name, data) => { const pending = gate(); posts.push({ name, data: clone(data) }); gates.push(pending); return pending.promise; }); t.after(f.dispose);
  const m = message('reply'); f.emit('message', m);
  m.trace = [{ kind: 'tool', textOffset: 0, toolIndex: 0 }];
  m.permissions = [{ id: 'permission', state: 'pending' }];
  for (let i = 0; i < 500; i++) { m.text += `word-${i} `; m.tools = [{ id: 'tool', status: 'running', output: String(i) }]; f.emit('event', m); }
  await wait(6); assert.equal(posts.length, 1); assert.equal(f.held(), 2); assert.equal(f.peak(), 2);
  m.ok = true; m.tools[0].status = 'done'; m.permissions[0].state = 'allowed'; f.emit('message', m);
  gates[0].resolve(true); await until(() => posts.length === 2);
  assert.equal(posts[1].name, 'message'); assert.deepEqual(posts[1].data.message, clone(m));
  gates[1].resolve(true); await until(() => f.held() === 0);
  assert.equal(posts.length, 2);
});

test('coalesced patches use the last sent base and preserve in-place tool and field changes', async t => {
  const { applyPatch } = await import('../ui/src/lib/message-patch.mjs');
  const posts = [], gates = []; let received;
  const f = fixture((name, data) => { const pending = gate(); posts.push({ name, data: clone(data) }); gates.push(pending); return pending.promise; }); t.after(f.dispose);
  const accept = index => { const p = posts[index]; received = p.name === 'message' ? p.data.message : applyPatch(received, p.data.patch); assert.ok(received); gates[index].resolve(true); };
  const m = message('reply'); f.emit('message', m); accept(0); await tick();
  m.text = 'first'; f.emit('event', m); await until(() => posts.length === 2);
  m.tools.push({ id: 'tool', status: 'running', files: [] });
  for (let i = 0; i < 80; i++) { m.text += '-next'; m.tools[0].files.push(`file-${i}.ts`); m.plan = [{ text: String(i) }]; f.emit('event', m); }
  delete m.plan; await wait(6); assert.equal(posts.length, 2);
  accept(1); await until(() => posts.length === 3); assert.equal(posts[2].name, 'message-patch'); accept(2);
  await until(() => f.held() === 0); assert.deepEqual(received, clone(m));
});

test('a blocked message does not serialize unrelated message delivery', async t => {
  const blocked = gate(), posts = [];
  const f = fixture((name, data) => { posts.push({ name, data: clone(data) }); return data.message?.id === 'blocked' ? blocked.promise : Promise.resolve(true); }); t.after(f.dispose);
  f.emit('message', message('blocked'));
  const other = message('other'); f.emit('message', other, 'other-chat'); await tick();
  other.text = 'independent'; f.emit('event', other, 'other-chat'); await until(() => posts.length === 3);
  assert.equal(posts[2].data.id, 'other'); assert.equal(f.held(), 1);
  blocked.resolve(true); await until(() => f.held() === 0);
});

test('rejected transport invalidates the patch base and sends a full latest snapshot', async t => {
  const posts = [], failed = gate(); t.mock.method(console, 'error', () => {});
  const f = fixture((name, data) => { posts.push({ name, data: clone(data) }); return posts.length === 2 ? failed.promise : Promise.resolve(true); }); t.after(f.dispose);
  const m = message('reply'); f.emit('message', m); await tick();
  m.text = 'not received'; f.emit('event', m); await until(() => posts.length === 2);
  m.text += ' newest'; f.emit('event', m); await wait(6);
  failed.reject(Error('transport failed')); await until(() => posts.length === 3);
  assert.equal(posts[2].name, 'message'); assert.deepEqual(posts[2].data.message, clone(m));
  await until(() => f.held() === 0);
});

test('disposal drops queued state without releasing transport ownership early or resurrecting sends', async () => {
  const pending = gate(); let posts = 0;
  const f = fixture(() => { posts++; return pending.promise; });
  const m = message('reply'); f.emit('message', m); m.text = 'queued'; f.emit('event', m); await wait(6);
  f.dispose(); f.dispose(); assert.equal(f.held(), 1); assert.equal(f.hub.listenerCount('event'), 0);
  pending.resolve(true); await until(() => f.held() === 0); await wait(6); assert.equal(posts, 1);
});

test('synchronous reentrancy, delivery throws, false returns and invalid thenables release their owners', async t => {
  for (const failure of ['throw', 'false', 'thenable']) {
    const posts = []; let count = 0;
    const f = fixture((name, data) => { posts.push({ name, data: clone(data) }); if (++count === 1) { if (failure === 'throw') throw Error('send failed'); if (failure === 'thenable') return Object.defineProperty({}, 'then', { get() { throw Error('then failed'); } }); return false; } }); t.after(f.dispose);
    const m = message(failure);
    if (failure === 'false') f.emit('message', m); else assert.throws(() => f.emit('message', m), /failed/);
    assert.equal(f.held(), 0); m.text = 'next'; f.emit('event', m); await until(() => posts.length === 2);
    assert.equal(posts[1].name, 'message'); assert.equal(f.held(), 0);
  }
  let f; const posts = [];
  f = fixture((name, data) => { posts.push(clone(data)); if (posts.length === 1) { const next = { ...data.message, text: 'reentrant final', ok: true }; f.emit('message', next); } }); t.after(f.dispose);
  f.emit('message', message('reentrant')); assert.equal(posts.length, 2); assert.equal(posts[1].message.text, 'reentrant final'); assert.equal(f.held(), 0);
});


test('shared admission caps distinct replies, sends waiting replies fairly and preserves every final state', async t => {
  const posts = [], gates = []; let active = 0, peak = 0;
  const f = fixture((name, data) => {
    const pending = gate(); posts.push({ name, data: clone(data) }); gates.push(pending);
    active++; peak = Math.max(peak, active);
    return pending.promise.finally(() => { active--; });
  }, { maxInFlight: 8 }); t.after(f.dispose);
  const messages = Array.from({ length: 48 }, (_, i) => ({ ...message(`reply-${i}`), text: `initial-${i}` }));
  for (const m of messages) f.emit('message', m);
  assert.equal(posts.length, 8);
  for (const m of messages) { m.text += ' final'; m.ok = true; f.emit('message', m); }
  assert.equal(posts.length, 8); assert.equal(f.held(), 56);
  let settled = 0;
  while (f.held()) {
    const end = gates.length;
    for (; settled < end; settled++) gates[settled].resolve(true);
    await tick();
  }
  assert.equal(peak, 8); assert.equal(posts.length, 56);
  assert.equal(posts[8].data.message.id, 'reply-8', 'a waiting conversation precedes an active conversation update');
  const final = new Map(posts.filter(p => p.data.message.ok === true).map(p => [p.data.message.id, p.data.message]));
  assert.equal(final.size, messages.length);
  for (const m of messages) assert.deepEqual(final.get(m.id), m);
});

test('queued sources do not create patch snapshots before an admission slot is free', async t => {
  const blocked = gate(), posts = []; let snapshotReads = 0;
  const f = fixture((name, data) => { posts.push({ name, data: clone(data) }); return posts.length === 1 ? blocked.promise : true; }, { maxInFlight: 1 }); t.after(f.dispose);
  f.emit('message', message('active'));
  const queued = message('queued'); Object.defineProperty(queued, 'tools', { enumerable: true, get() { snapshotReads++; return []; } });
  f.emit('message', queued); await wait(6); assert.equal(snapshotReads, 0); assert.equal(posts.length, 1);
  blocked.resolve(true); await until(() => f.held() === 0); assert.ok(snapshotReads > 0); assert.equal(posts.length, 2);
});

test('shared draining is iterative for synchronous completions and disposal drops unsent owners', async t => {
  const blocked = gate(); let posts = 0;
  const f = fixture(() => ++posts === 1 ? blocked.promise : true, { maxInFlight: 1 }); t.after(f.dispose);
  for (let i = 0; i < 4000; i++) f.emit('message', message(String(i)));
  assert.equal(posts, 1); blocked.resolve(true); await until(() => f.held() === 0); assert.equal(posts, 4000);
  const last = gate(); const other = fixture(() => last.promise, { maxInFlight: 1 }); t.after(other.dispose);
  for (let i = 0; i < 40; i++) other.emit('message', message(String(i)));
  other.dispose(); assert.equal(other.held(), 1); last.resolve(true); await until(() => other.held() === 0);
});

test('failed active and queued deliveries do not strand other admitted replies', async t => {
  t.mock.method(console, 'error', () => {});
  const failed = gate(), posts = [];
  const f = fixture((name, data) => { posts.push(data.message.id); if (data.message.id === 'active') return failed.promise; if (data.message.id === 'bad') throw Error('bad receiver'); return true; }, { maxInFlight: 1 }); t.after(f.dispose);
  for (const id of ['active', 'bad', 'good']) f.emit('message', message(id));
  failed.reject(Error('disconnected')); await until(() => f.held() === 0); assert.deepEqual(posts, ['active', 'bad', 'good']);
  for (const maxInFlight of [0, -1, NaN, 1.5, '8']) assert.throws(() => bindMessageDelivery(new EventEmitter(), () => {}, 1, { maxInFlight }), /concurrency/);
});
