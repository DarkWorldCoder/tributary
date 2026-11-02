'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runDirectTurn, connectionConfig } = require('../core/direct');
const { TEMPLATES, taskPrompt } = require('../core/tasks');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');

async function server(t, handler) {
  const requests = [];
  const s = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}'); requests.push({ body, headers: req.headers, url: req.url });
    handler(req, res, body);
  });
  await new Promise((resolve, reject) => { s.once('error', reject); s.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { s.closeAllConnections(); s.close(resolve); }));
  return { baseUrl: `http://127.0.0.1:${s.address().port}/v1`, requests };
}
const gateway = (baseUrl) => ({ protocol: 'openai', baseUrl, model: 'fixture-model', maxOutputTokens: 1024 });
function stream(res, content) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\r\n\r\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 10 } })}\r\n\r\ndata: [DONE]\r\n\r\n`);
}

test('everyday templates validate material and expose ten distinct supported tasks', () => {
  assert.equal(TEMPLATES.length, 10); assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, 10);
  assert.ok(TEMPLATES.every((t) => !Object.hasOwn(t, 'instruction')));
  assert.throws(() => taskPrompt({ templateId: 'missing', goal: 'x' }), /supported task/);
  assert.throws(() => taskPrompt({ templateId: 'summarize', goal: 'x' }), /Paste or attach/);
  assert.throws(() => taskPrompt({ templateId: 'write', goal: '' }), /Describe/);
  assert.throws(() => taskPrompt({ templateId: 'write', goal: 'x', material: 'a'.repeat(40001) }), /Shorten/);
});

test('direct connections constrain transport, credentials, protocol, and output limits', () => {
  assert.equal(connectionConfig(gateway('http://localhost:11434/v1/')).endpoint, 'http://localhost:11434/v1/chat/completions');
  for (const baseUrl of ['file:///tmp/test', 'http://example.com/v1', 'https://name:secret@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/v1#secret']) assert.throws(() => connectionConfig(gateway(baseUrl)));
  assert.throws(() => connectionConfig({ ...gateway('https://example.com/v1'), model: '' }), /model name/);
  assert.throws(() => connectionConfig({ ...gateway('https://example.com/v1'), protocol: 'anthropic' }), /compatible/);
  assert.throws(() => connectionConfig({ ...gateway('https://example.com/v1'), maxOutputTokens: 999999 }), /limit/);
});

test('direct runtime decodes split Unicode SSE, usage, and completion without a CLI', async (t) => {
  const endpoint = await server(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const bytes = Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello ✓ 世界' } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 7 } })}\n\ndata: [DONE]\n\n`);
    for (let i = 0; i < bytes.length; i += 3) res.write(bytes.subarray(i, i + 3));
    res.end();
  });
  const events = [];
  const r = await runDirectTurn({ gateway: gateway(endpoint.baseUrl), prompt: 'Hello', onEvent: (e) => events.push(e) });
  assert.equal(r.ok, true); assert.equal(r.text, 'Hello ✓ 世界');
  assert.equal(events.filter((e) => e.kind === 'done').length, 1);
  assert.equal(events.find((e) => e.kind === 'usage').usage.total_tokens, 7);
  assert.equal(endpoint.requests[0].url, '/v1/chat/completions');
  assert.equal(endpoint.requests[0].body.max_tokens, 1024);
  assert.ok(!Object.hasOwn(endpoint.requests[0].body, 'tools'));
});

test('truncated streams preserve partial output and report failure', async (t) => {
  const endpoint = await server(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('data: {"choices":[{"delta":{"content":"Partial answer"}}]}\n\n'); });
  const events = [];
  const r = await runDirectTurn({ gateway: gateway(endpoint.baseUrl), prompt: 'x', onEvent: (e) => events.push(e) });
  assert.equal(r.ok, false); assert.equal(r.text, 'Partial answer');
  assert.match(events.find((e) => e.kind === 'error').message, /before the response finished/);
});

test('canceling a direct request keeps partial output and emits one failed completion', async (t) => {
  const endpoint = await server(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: {"choices":[{"delta":{"content":"Started"}}]}\n\n'); });
  const ac = new AbortController(); const events = [];
  const r = await runDirectTurn({ gateway: gateway(endpoint.baseUrl), prompt: 'x', signal: ac.signal, onEvent: (e) => { events.push(e); if (e.kind === 'text') ac.abort(); } });
  assert.equal(r.ok, false); assert.equal(r.text, 'Started');
  assert.match(events.find((e) => e.kind === 'error').message, /Stopped/);
  assert.equal(events.filter((e) => e.kind === 'done').length, 1);
});

test('tool requests and provider errors cannot become successful responses or expose credentials', async (t) => {
  const secret = 'fixture-private-token';
  const endpoint = await server(t, (_req, res, body) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body.messages.at(-1).content === 'error' ? { error: { message: `Invalid ${secret}` } } : { choices: [{ message: { tool_calls: [{ function: { name: 'shell', arguments: 'touch test' } }] } }] }));
  });
  for (const prompt of ['tool', 'error']) {
    const events = [];
    const r = await runDirectTurn({ gateway: { ...gateway(endpoint.baseUrl), apiKey: secret }, prompt, onEvent: (e) => events.push(e) });
    assert.equal(r.ok, false); assert.ok(!JSON.stringify(events).includes(secret));
  }
});

test('ordinary JSON responses are supported and empty responses fail clearly', async (t) => {
  const endpoint = await server(t, (_req, res, body) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: body.messages.at(-1).content === 'empty' ? '' : 'A complete answer' }, finish_reason: 'stop' }] }));
  });
  const r = await runDirectTurn({ gateway: gateway(endpoint.baseUrl), prompt: 'x', onEvent: () => {} });
  assert.equal(r.text, 'A complete answer'); assert.equal(r.ok, true);
  assert.equal((await runDirectTurn({ gateway: gateway(endpoint.baseUrl), prompt: 'empty', onEvent: () => {} })).ok, false);
});

test('personal task to direct response to document survives restart without agent installs or Git', async (t) => {
  const endpoint = await server(t, (_req, res) => stream(res, '# Workshop welcome\n\nWelcome to our community workshop.'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-everyday-'));
  const secrets = new MemorySecrets(); const hub = new Hub({ dataDir, secrets });
  t.after(() => { hub.store.save(true); fs.rmSync(dataDir, { recursive: true, force: true }); });
  assert.equal(hub.agents.length, 0);
  const id = await hub.saveGateway({ ...gateway(endpoint.baseUrl), name: 'Test assistant', direct: true, apiKey: 'fixture-private-key' });
  assert.equal(hub.state().agents.length, 1);
  const { thread, prompt, displayText } = hub.createTask({ templateId: 'write', goal: 'Welcome new members', material: 'Meeting starts at 9am.' });
  assert.equal(hub.project(thread.project).kind, 'personal');
  assert.equal(fs.existsSync(path.join(thread.project, '.git')), false);
  const reply = await hub.send({ threadId: thread.id, agentId: `direct:${id}`, text: prompt, displayText, mode: 'full' });
  assert.equal(reply.ok, true); assert.equal(reply.mode, 'read'); assert.equal(thread.messages[0].text, displayText);
  assert.ok(!thread.messages[0].text.includes('Do not run commands'));
  await hub.send({ threadId: thread.id, agentId: `direct:${id}`, text: 'Make it shorter' });
  assert.match(endpoint.requests.at(-1).body.messages.at(-1).content, /Meeting starts at 9am/);
  const doc = hub.createDocument(thread.id, reply.id);
  assert.equal(hub.createDocument(thread.id, reply.id).id, doc.id);
  const saved = hub.saveDocument(thread.id, doc.id, { title: 'My welcome note', content: 'Welcome, everyone!', expectedRevision: 1 });
  assert.equal(saved.revision, 2); assert.equal(saved.history[0].revision, 1);
  assert.throws(() => hub.saveDocument(thread.id, doc.id, { title: 'Wrong', content: 'stale', expectedRevision: 1 }), /changed since/);
  const restarted = new Hub({ dataDir, secrets });
  assert.equal(restarted.document(thread.id, doc.id).content, 'Welcome, everyone!');
  assert.equal(restarted.thread(thread.id).task.material, 'Meeting starts at 9am.');
  assert.ok(!JSON.stringify(hub.state()).includes('fixture-private-key'));
  assert.ok(!fs.readFileSync(path.join(dataDir, 'hub.json'), 'utf8').includes('fixture-private-key'));
  const count = hub.store.data.threads.length;
  assert.equal((await hub.testConnection(id)).ok, true); assert.equal(hub.store.data.threads.length, count);
  await hub.deleteGateway(id); assert.equal(hub.state().agents.length, 0);
});
