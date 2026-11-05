'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { getEventListeners } = require('node:events');
const http = require('node:http');
const { LocalRequests, localRequests, requestLimit, endpointKey, MAX_WAITING } = require('../core/local-requests');
const { runDirectTurn } = require('../core/direct');
const gateway = { baseUrl: 'http://127.0.0.1:11434/v1' };
const empty = { services: 0, active: 0, waiting: 0 };
const tick = () => new Promise(setImmediate);

test('local generations share a FIFO slot across loopback aliases, paths and profiles', async () => {
  const queue = new LocalRequests(); const order = [];
  const first = await queue.acquire(gateway);
  const second = queue.acquire({ baseUrl: 'http://localhost:11434/other/v1', model: 'other' }, { onQueued: () => order.push('queued second') }).then((release) => { order.push('second'); return release; });
  const third = queue.acquire({ baseUrl: 'http://[::1]:11434/v1' }).then((release) => { order.push('third'); return release; });
  assert.deepEqual(queue.counts(), { services: 1, active: 1, waiting: 2 });
  first(); first(); const releaseSecond = await second;
  assert.deepEqual(order, ['queued second', 'second']); releaseSecond(); (await third)();
  assert.deepEqual(order, ['queued second', 'second', 'third']); assert.deepEqual(queue.counts(), empty);
});

test('explicit parallelism respects active stricter profiles and does not block another service', async () => {
  const queue = new LocalRequests(); const parallel = { ...gateway, localConcurrency: 2 };
  const one = await queue.acquire(parallel); const two = await queue.acquire(parallel);
  let granted = false;
  const strict = queue.acquire(gateway).then((release) => { granted = true; return release; });
  const other = await queue.acquire({ baseUrl: 'http://localhost:1234/v1' });
  one(); await tick(); assert.equal(granted, false, 'one strict request waits for both current generations');
  two(); const release = await strict;
  let nextGranted = false; const next = queue.acquire({ ...gateway, localConcurrency: 4 }).then((release) => { nextGranted = true; return release; });
  await tick(); assert.equal(nextGranted, false); release(); (await next)(); other();
  assert.deepEqual(queue.counts(), empty);
});

test('cancellation removes waiting work and abort listeners without occupying a model slot', async () => {
  const queue = new LocalRequests(); const release = await queue.acquire(gateway);
  for (let i = 0; i < 100; i++) {
    const controller = new AbortController();
    const waiting = queue.acquire(gateway, { signal: controller.signal });
    const rejected = assert.rejects(waiting, { name: 'AbortError' }); controller.abort(); await rejected;
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    assert.deepEqual(queue.counts(), { services: 1, active: 1, waiting: 0 });
  }
  release(); assert.deepEqual(queue.counts(), empty);
  const stopped = new AbortController(); stopped.abort();
  assert.throws(() => queue.acquire(gateway, { signal: stopped.signal }), { name: 'AbortError' });
  assert.deepEqual(queue.counts(), empty);
});

test('a bounded waiting queue rejects excess work and cleans up notification errors', async () => {
  const queue = new LocalRequests(); const release = await queue.acquire(gateway);
  const controllers = Array.from({ length: MAX_WAITING }, () => new AbortController());
  const settled = Promise.allSettled(controllers.map((controller) => queue.acquire(gateway, { signal: controller.signal })));
  await assert.rejects(queue.acquire(gateway), /queue is full/);
  controllers.forEach((controller) => controller.abort()); await settled;
  await assert.rejects(queue.acquire(gateway, { onQueued() { throw new Error('UI disconnected'); } }), /UI disconnected/);
  release(); assert.deepEqual(queue.counts(), empty);
});

test('local request keys reject remote addresses and concurrency settings remain explicit', () => {
  assert.equal(requestLimit(), 1);
  for (const limit of [1, 2, 4]) assert.equal(requestLimit(limit), limit);
  for (const invalid of [0, -1, 3, 99, '2', NaN]) assert.throws(() => requestLimit(invalid));
  assert.equal(endpointKey('http://localhost/v1'), endpointKey('http://127.0.0.1:80/x/v1'));
  assert.throws(() => endpointKey('https://example.com/v1'));
});

async function serverFixture(t, handler) {
  let active = 0; let peak = 0; const requests = []; const waiters = [];
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    requests.push({ input: JSON.parse(text), res }); active++; peak = Math.max(peak, active);
    res.once('finish', () => active--);
    for (const notify of waiters.splice(0)) notify();
    await handler?.(req, res, requests.length);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const generation = { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, protocol: 'openai', model: 'test', localRuntime: 'ollama' };
  const waitRequests = async (count) => { const deadline = Date.now() + 3000; while (requests.length < count) { if (Date.now() > deadline) throw Error('Missing local request'); await Promise.race([new Promise((resolve) => waiters.push(resolve)), new Promise((resolve) => setTimeout(resolve, 20))]); } };
  const finish = (index, content = 'done') => { const res = requests[index].res; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] })); };
  return { generation, requests, waitRequests, finish, peak: () => peak };
}

test('real local requests queue before sending JSON and a cancelled chat never reaches the server', async (t) => {
  const fixture = await serverFixture(t); const events = []; const cancelled = new AbortController();
  const run = (extra = {}) => runDirectTurn({ gateway: fixture.generation, prompt: 'hello', onEvent: (event) => events.push(event), ...extra });
  const first = run(); await fixture.waitRequests(1);
  const second = run({ signal: cancelled.signal }); await tick();
  assert.ok(events.some((event) => event.kind === 'model-phase' && event.phase === 'waiting-model'));
  assert.equal(fixture.requests.length, 1); cancelled.abort();
  assert.equal((await second).ok, false); fixture.finish(0); assert.equal((await first).ok, true);
  assert.equal(fixture.requests.length, 1); assert.equal(fixture.peak(), 1);
  assert.deepEqual(localRequests.counts(), empty);
});

test('service errors release the generation slot so the next chat can finish', async (t) => {
  const fixture = await serverFixture(t); const phases = [];
  const run = () => runDirectTurn({ gateway: fixture.generation, prompt: 'hello', onEvent: (event) => { if (event.kind === 'model-phase') phases.push(event.phase); } });
  const first = run(); await fixture.waitRequests(1); const second = run(); await tick();
  fixture.requests[0].res.writeHead(503); fixture.requests[0].res.end();
  assert.equal((await first).ok, false); await fixture.waitRequests(2); fixture.finish(1);
  assert.equal((await second).ok, true); assert.ok(phases.includes('waiting-model')); assert.equal(phases.at(-1), null);
  assert.deepEqual(localRequests.counts(), empty);
});

test('a generation timeout releases the slot; the waiting chat has its own request deadline', async (t) => {
  const fixture = await serverFixture(t); const events = [];
  const first = runDirectTurn({ gateway: fixture.generation, prompt: 'hello', timeoutMs: 100, onEvent: (event) => events.push(event) });
  await fixture.waitRequests(1);
  const second = runDirectTurn({ gateway: fixture.generation, prompt: 'next', timeoutMs: 500, onEvent() {} });
  assert.equal((await first).ok, false);
  assert.ok(events.some((event) => event.kind === 'error' && /timed out/.test(event.message)));
  await fixture.waitRequests(2); fixture.finish(1);
  assert.equal((await second).ok, true); assert.deepEqual(localRequests.counts(), empty);
});

test('invalid streamed output releases its reader and local generation slot', async (t) => {
  const fixture = await serverFixture(t); const run = () => runDirectTurn({ gateway: fixture.generation, prompt: 'hello', onEvent() {} });
  const first = run(); await fixture.waitRequests(1); const second = run();
  const response = fixture.requests[0].res;
  response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end('data: not-json\n\n');
  assert.equal((await first).ok, false); await fixture.waitRequests(2); fixture.finish(1);
  assert.equal((await second).ok, true); assert.deepEqual(localRequests.counts(), empty);
});

test('two local generations can overlap when selected; ordinary provider connections bypass admission control', async (t) => {
  for (const profile of [{ localConcurrency: 2 }, { localRuntime: undefined }]) {
    const fixture = await serverFixture(t);
    const gateway = { ...fixture.generation, ...profile };
    const run = () => runDirectTurn({ gateway, prompt: 'hello', onEvent() {} });
    const first = run(); const second = run(); await fixture.waitRequests(2);
    assert.equal(fixture.peak(), 2); fixture.finish(0); fixture.finish(1);
    assert.ok((await Promise.all([first, second])).every((result) => result.ok));
  }
  assert.deepEqual(localRequests.counts(), empty);
});
