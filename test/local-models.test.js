'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const http = require('node:http'); const fs = require('node:fs'); const path = require('node:path');
const { mkdtemp } = require('./helpers/tmp');
const { SERVICES, localAddress, inspect, discover } = require('../core/local-models');
const { Hub } = require('../core/hub'); const { MemorySecrets } = require('../core/store');

test('local setup accepts only loopback API addresses and never expands a service key to remote hosts', () => {
  assert.equal(localAddress('http://127.0.0.1:8888/'), 'http://127.0.0.1:8888/v1');
  assert.equal(localAddress('http://localhost:8000/v1/'), 'http://localhost:8000/v1');
  assert.equal(localAddress('http://[::1]:8888/v1'), 'http://[::1]:8888/v1');
  for (const address of ['https://example.com/v1', 'http://192.168.1.5:8888/v1', 'http://127.0.0.1.example.com/v1', 'http://127.0.0.1:8888/v1?key=private', 'http://user:pass@127.0.0.1/v1', 'file:///v1', 'http://127.0.0.1:8888/admin']) assert.throws(() => localAddress(address));
});

test('discovery is bounded GET-only metadata with no prompt, key or model startup', async () => {
  const requests = [];
  const result = await discover({ fetchImpl: async (url, init) => { requests.push({ url, init }); return Response.json({ data: [{ id: 'local-model', loaded: true }, { id: 'on-disk', loaded: false }, { id: '../bad with spaces' }] }); } });
  assert.equal(requests.length, SERVICES.length);
  assert.ok(result.hardware.memoryGB > 0);
  for (const request of requests) { assert.equal(request.init.redirect, 'error'); assert.equal(request.init.headers.Authorization, undefined); assert.ok(!request.init.body); assert.match(request.url, /^http:\/\/127\.0\.0\.1:\d+\/v1\/models$/); }
  assert.deepEqual(result.services[0].models, [{ id: 'local-model', name: 'local-model', loaded: true }, { id: 'on-disk', name: 'on-disk', loaded: false }]);
});

test('model discovery distinguishes an API key requirement, no models, invalid catalogs and offline services', async () => {
  const input = { service: 'unsloth', apiKey: 'private-local-key' };
  const unauthorized = await inspect(input, { fetchImpl: async () => new Response(null, { status: 401 }) });
  assert.equal(unauthorized.status, 'needs-key'); assert.ok(!JSON.stringify(unauthorized).includes(input.apiKey));
  assert.equal((await inspect(input, { fetchImpl: async () => Response.json({ data: [] }) })).status, 'empty');
  assert.equal((await inspect(input, { fetchImpl: async () => Response.json({ unrelated: [] }) })).status, 'error');
  assert.equal((await inspect(input, { fetchImpl: async () => new Response('x'.repeat(2 * 1024 ** 2 + 1)) })).status, 'error');
  assert.equal((await inspect(input, { fetchImpl: async () => { throw new Error('private-local-key transport error'); } })).status, 'offline');
});

test('Unsloth local setup persists an encrypted-store profile, starts real streaming chat, and disables server tools', async (t) => {
  const requests = []; const key = 'test-unsloth-private-key';
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    requests.push({ url: req.url, method: req.method, headers: req.headers, body: text ? JSON.parse(text) : null });
    if (req.headers.authorization !== `Bearer ${key}`) { res.writeHead(401); res.end(); return; }
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'local-chat', loaded: true }] })); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"choices":[{"delta":{"content":"A local reply"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dataDir = mkdtemp('local-models'); const secrets = new MemorySecrets(); const hub = new Hub({ dataDir, secrets }); let restarted;
  t.after(async () => { hub.store.close(); restarted?.store.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const input = { service: 'unsloth', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: key, model: 'local-chat' };
  await assert.rejects(() => hub.connectLocalModel({ ...input, model: 'not-reported' }), /Choose a model/);
  const id = await hub.connectLocalModel(input);
  assert.equal(await hub.connectLocalModel(input), id, 'reconnecting the same model reuses its profile');
  assert.equal(requests.filter((request) => request.method === 'POST').length, 0, 'setup has not sent any generation request');
  assert.equal(hub.state().gateways[0].localRuntime, 'unsloth'); assert.ok(!JSON.stringify(hub.state()).includes(key));
  assert.equal(hub.state().gateways[0].historyBudget, 4000);
  const thread = hub.createThread(hub.personalWorkspace(), 'Local model chat');
  hub.enableMemory(thread.project);
  hub.saveMemory(thread.project, '# Decisions\n' + Array.from({ length: 100 }, (_, index) => `- Local model decision ${index}: keep private reference material on this device.`).join('\n'));
  hub.configureMemory(thread.project, { includeInPrompts: true, budget: 8000 });
  const answer = await hub.send({ threadId: thread.id, agentId: `direct:${id}`, text: 'Hello local model', mode: 'full' });
  assert.equal(answer.ok, true); assert.equal(answer.text, 'A local reply'); assert.equal(answer.mode, 'read');
  assert.equal(answer.memoryContext.budget, 2000); assert.ok(answer.memoryContext.characters <= 2000);
  const generation = requests.find((request) => request.method === 'POST');
  assert.equal(generation.url, '/v1/chat/completions'); assert.equal(generation.body.model, 'local-chat'); assert.equal(generation.body.enable_tools, false); assert.ok(!generation.body.tools);
  hub.store.save(true);
  restarted = new Hub({ dataDir, secrets });
  assert.equal((await restarted.resolveGateway(id)).apiKey, key);
  assert.equal(restarted.thread(thread.id).messages.at(-1).text, 'A local reply');
  assert.ok(!fs.readFileSync(path.join(dataDir, 'tributary.db')).includes(key));
  await hub.saveGateway({ ...hub.state().gateways[0], baseUrl: 'https://example.com/v1', localRuntime: null });
  assert.equal(hub.state().gateways[0].localRuntime, undefined, 'editing into a remote service explicitly clears the local profile');
});

test('compact local handoffs keep the current request and shrink history without deleting it', () => {
  const { plan } = require('../core/handoff');
  const messages = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', agent: 'old', text: `Message ${index}: ` + 'Long previous context. '.repeat(100) }));
  const thread = { messages, agentSessions: {} }; const text = 'Keep this exact current request.';
  const compact = plan({ thread, agentId: 'local', text, budget: 4000 });
  const extended = plan({ thread, agentId: 'local', text });
  assert.ok(compact.prompt.length < 4400); assert.ok(extended.prompt.length > compact.prompt.length);
  assert.ok(compact.prompt.endsWith(text)); assert.equal(messages.length, 30); assert.ok(messages[1].text.length > 1800);
});
