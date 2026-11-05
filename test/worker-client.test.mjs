import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createWorkerClient, moduleWorker } from '../ui/src/lib/worker-client.mjs';

class Clock {
  now = 0; next = 0; tasks = new Map();
  setTimeout(fn, delay) { const id = ++this.next; this.tasks.set(id, { fn, at: this.now + delay }); return id; }
  clearTimeout(id) { this.tasks.delete(id); }
  advance(ms) {
    const until = this.now + ms;
    while (true) { const next = [...this.tasks].sort((a,b) => a[1].at - b[1].at).find(([, task]) => task.at <= until); if (!next) break; this.now = next[1].at; this.tasks.delete(next[0]); next[1].fn(); }
    this.now = until;
  }
}
class FakeWorker {
  posts = []; terminated = 0; onmessage = null; onerror = null; onmessageerror = null;
  postMessage(value) { this.posts.push(value); }
  terminate() { this.terminated++; }
  reply(index, result) { this.onmessage?.({ data: { id: this.posts[index].id, result } }); }
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const empty = { ready: false, loading: false, active: 0, waiting: 0 };
function fixture(options = {}) {
  const clock = new Clock(); const workers = []; let cleaned = 0;
  const client = createWorkerClient({ clock, idleMs: 60, timeoutMs: 100, create() { const worker = new FakeWorker(); workers.push(worker); return { worker, dispose() { cleaned++; } }; }, ...options });
  return { client, clock, workers, cleaned: () => cleaned };
}

test('one posted request bounds worker copies, preserves FIFO results, and reclaims idle resources', async () => {
  const { client, clock, workers, cleaned } = fixture();
  assert.deepEqual(client.stats(), empty);
  const a = client.request({ text: 'first' }); const b = client.request({ text: 'second' }); await flush();
  assert.equal(workers.length, 1); assert.equal(workers[0].posts.length, 1);
  workers[0].reply(0, 'first result'); assert.equal(await a, 'first result'); await flush();
  assert.equal(workers[0].posts.length, 2); workers[0].reply(1, 'second result'); assert.equal(await b, 'second result');
  clock.advance(59); assert.equal(workers[0].terminated, 0); clock.advance(1);
  assert.equal(workers[0].terminated, 1); assert.equal(cleaned(), 1); assert.deepEqual(client.stats(), empty);
  const c = client.request({ text: 'after idle' }); await flush();
  assert.equal(workers.length, 2); workers[1].reply(0, 'works again'); assert.equal(await c, 'works again'); client.dispose();
  assert.equal(clock.tasks.size, 0);
});

test('idle expiry never interrupts a pending request and resets after reuse', async () => {
  const { client, clock, workers } = fixture();
  const first = client.request({ text: 'working' }); await flush(); clock.advance(70);
  assert.equal(workers[0].terminated, 0); workers[0].reply(0, 'ok'); await first;
  clock.advance(50); const next = client.request({ text: 'reuse' }); await flush(); clock.advance(20);
  assert.equal(workers.length, 1); assert.equal(workers[0].terminated, 0);
  workers[0].reply(1, 'ok'); await next; client.dispose();
});

test('obsolete waiting work never posts and removes its abort listener immediately', async () => {
  const { client, workers } = fixture(); const first = client.request({ text: 'active' }); await flush();
  for (let i = 0; i < 100; i++) {
    const controller = new AbortController(); const queued = client.request({ text: `old draft ${i}` }, { signal: controller.signal });
    const failed = assert.rejects(queued, { name: 'AbortError' }); controller.abort(); await failed;
    assert.equal(client.stats().waiting, 0); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
  assert.equal(workers[0].posts.length, 1); workers[0].reply(0, 'done'); await first; client.dispose();
});

test('cancelling posted work preserves another caller, and ignores the cancelled result', async () => {
  const { client, workers } = fixture(); const controller = new AbortController();
  const first = client.request({ text: 'obsolete' }, { signal: controller.signal }); await flush();
  const next = client.request({ text: 'current' }); const failed = assert.rejects(first, { name: 'AbortError' }); controller.abort(); await failed;
  assert.equal(workers[0].terminated, 0); assert.equal(workers[0].posts.length, 1);
  workers[0].reply(0, 'discarded'); await flush(); workers[0].reply(1, 'current result');
  assert.equal(await next, 'current result'); client.dispose();
});

test('cancelling the last caller terminates work and clears timers', async () => {
  const { client, clock, workers } = fixture(); const controller = new AbortController();
  const request = client.request({ text: 'draft' }, { signal: controller.signal }); await flush();
  const failed = assert.rejects(request, { name: 'AbortError' }); controller.abort(); await failed;
  assert.equal(workers[0].terminated, 1); assert.deepEqual(client.stats(), empty); assert.equal(clock.tasks.size, 0);
});

test('cancelled asynchronous startup cannot resurrect or dispose a newer worker', async () => {
  const starts = []; const workers = []; let cleaned = 0;
  const { client } = fixture({ create({ signal }) { return new Promise((resolve) => starts.push({ signal, resolve })); } });
  const oldController = new AbortController(); const old = client.request({ text: 'old' }, { signal: oldController.signal }); await flush();
  const failed = assert.rejects(old, { name: 'AbortError' }); oldController.abort(); await failed;
  assert.equal(starts[0].signal.aborted, true);
  const next = client.request({ text: 'new' }); await flush();
  for (const start of starts) { const worker = new FakeWorker(); workers.push(worker); start.resolve({ worker, dispose() { cleaned++; } }); }
  await flush(); assert.equal(workers[0].terminated, 1); assert.equal(workers[1].terminated, 0);
  assert.equal(workers[0].posts.length, 0); workers[1].reply(0, 'new result'); assert.equal(await next, 'new result');
  client.dispose(); assert.equal(cleaned, 2);
});

test('cancelling startup with another queued caller reuses startup and posts only the new input', async () => {
  let start; const worker = new FakeWorker();
  const { client } = fixture({ create: () => new Promise((resolve) => { start = resolve; }) });
  const controller = new AbortController(); const old = client.request({ text: 'old' }, { signal: controller.signal }); await flush();
  const next = client.request({ text: 'next' }); const failed = assert.rejects(old); controller.abort(); await failed;
  start({ worker }); await flush(); assert.equal(worker.posts.length, 1); assert.equal(worker.posts[0].text, 'next');
  worker.reply(0, 'next result'); assert.equal(await next, 'next result'); client.dispose();
});

test('timeouts and worker errors settle all callers once and allow a fresh request', async () => {
  for (const fail of ['timeout', 'worker-error', 'message-error']) {
    const { client, clock, workers, cleaned } = fixture({ timeoutMessage: 'Timed out. Draft unchanged.' });
    const a = client.request({ text: 'one' }); const b = client.request({ text: 'two' }); const settled = Promise.allSettled([a,b]); await flush();
    if (fail === 'timeout') clock.advance(100); else if (fail === 'worker-error') workers[0].onerror(); else workers[0].onmessageerror();
    const results = await settled; assert.ok(results.every((r) => r.status === 'rejected')); assert.equal(cleaned(), 1); assert.equal(clock.tasks.size, 0);
    const c = client.request({ text: 'retry' }); await flush(); workers[1].reply(0, 'recovered'); assert.equal(await c, 'recovered'); client.dispose();
  }
});

test('bounded admission and disposal do not silently drop requests or mutate inputs', async () => {
  const { client, workers } = fixture({ maxPending: 2 }); const input = Object.freeze({ path: 'file.ts', text: 'original' });
  const first = client.request(input); const second = client.request(input); const failed = Promise.allSettled([first,second]);
  await assert.rejects(client.request(input), /busy/); await flush();
  assert.equal(workers[0].posts.length, 1); client.dispose();
  assert.ok((await failed).every((result) => result.status === 'rejected')); assert.equal(input.text, 'original'); assert.deepEqual(client.stats(), empty);
});

test('startup and structured-clone failures release every waiting owner and permit retry', async () => {
  for (const failure of ['startup', 'post']) {
    let fail = true; const workers = [];
    const { client, clock } = fixture({ create() {
      if (fail && failure === 'startup') throw new Error('Cannot load worker');
      const worker = new FakeWorker(); workers.push(worker);
      if (fail) worker.postMessage = () => { throw new DOMException('Cannot clone input', 'DataCloneError'); };
      return { worker };
    } });
    const results = await Promise.allSettled([client.request({ text: 'one' }), client.request({ text: 'two' })]);
    assert.ok(results.every((result) => result.status === 'rejected'));
    assert.deepEqual(client.stats(), empty); assert.equal(clock.tasks.size, 0);
    if (workers.length) assert.equal(workers[0].terminated, 1);
    fail = false; const retry = client.request({ text: 'retry' }); await flush();
    workers.at(-1).reply(0, 'recovered'); assert.equal(await retry, 'recovered'); client.dispose();
  }
});

test('formatter response decoding and per-request errors preserve the next queued request', async () => {
  const { client, workers } = fixture({ readResult: (data) => data.text });
  const first = client.request({ text: 'invalid' }); const failed = assert.rejects(first, /Invalid source/);
  const next = client.request({ text: 'valid' }); await flush(); const worker = workers[0];
  worker.onmessage({ data: { id: worker.posts[0].id, error: 'Invalid source' } }); await failed; await flush();
  worker.onmessage({ data: { id: worker.posts[1].id, text: 'formatted source' } });
  assert.equal(await next, 'formatted source'); assert.equal(worker.terminated, 0); client.dispose();
});

test('webview startup revokes its own blob on construction failure and after successful disposal', async (t) => {
  const descriptors = Object.fromEntries(['window', 'Worker', 'fetch'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const create = URL.createObjectURL; const revoke = URL.revokeObjectURL;
  t.after(() => {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
    URL.createObjectURL = create; URL.revokeObjectURL = revoke;
  });
  let sequence = 0; const revoked = []; let fail = true; let fetchedSignal;
  globalThis.window = { hub: { platform: 'vscode' } };
  globalThis.fetch = async (_source, { signal }) => { fetchedSignal = signal; return { ok: true, text: async () => 'self.onmessage = () => {}' }; };
  URL.createObjectURL = () => `blob:worker-${++sequence}`; URL.revokeObjectURL = (url) => revoked.push(url);
  globalThis.Worker = class { constructor(url) { if (fail) throw new Error('Blocked worker'); this.url = url; } };
  const controller = new AbortController();
  await assert.rejects(moduleWorker('worker.js', { signal: controller.signal }), /Blocked worker/);
  assert.equal(fetchedSignal, controller.signal); assert.deepEqual(revoked, ['blob:worker-1']);
  fail = false; const resource = await moduleWorker('worker.js', { signal: controller.signal });
  assert.equal(resource.worker.url, 'blob:worker-2'); assert.deepEqual(revoked, ['blob:worker-1']);
  resource.dispose(); assert.deepEqual(revoked, ['blob:worker-1', 'blob:worker-2']);
  controller.abort(); await assert.rejects(moduleWorker('worker.js', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(sequence, 2);
});
