'use strict';
require('./helpers/tmp').useCheckpointDir();
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { mkdtemp } = require('./helpers/tmp');
const { runLocalAgent, executeTool, definitions } = require('../core/local-agent');
const { Hub } = require('../core/hub'); const { MemorySecrets } = require('../core/store');
const { openDelegation } = require('../core/delegation');
const call = (name, input, id = 'call-one') => ({ id, type: 'function', function: { name, arguments: JSON.stringify(input) } });
async function fixture(t, answer) {
  const requests = []; const root = mkdtemp('local-agent'); const cwd = path.join(root, 'project'); fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, 'file.txt'), 'original\n');
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'tool-model' }] })); return; }
    const input = JSON.parse(body); requests.push(input);
    try { await answer(input, res, requests.length); } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const gateway = { id: 'local', name: 'Test local', direct: true, localRuntime: 'ollama', localAgent: true, historyBudget: 4000, protocol: 'openai', model: 'tool-model', baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, cwd, gateway, requests };
}
const json = (res, content, calls) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content, ...(calls ? { tool_calls: calls } : {}) }, finish_reason: calls ? 'tool_calls' : 'stop' }] })); };

test('local agent streams fragmented structured calls, reads, edits and runs a real approved command', async (t) => {
  const { root, cwd, gateway, requests } = await fixture(t, (input, res, step) => {
    if (step === 1) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const delta of [{ content: 'I will read the file.\n' }, { tool_calls: [{ index: 0, id: 'read-one', function: { name: 'read_file', arguments: '{"pa' } }] }, { tool_calls: [{ index: 0, function: { arguments: 'th":"file.txt"}' } }] }]) res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
      res.end('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'); return;
    }
    if (step === 2) { assert.match(input.messages.at(-1).content, /original/); return json(res, 'I will edit it.\n', [call('edit_file', { path: 'file.txt', old_text: 'original', new_text: 'updated' })]); }
    if (step === 3) return json(res, 'Checking the change.\n', [call('run_command', { command: 'echo local-command-verified' })]);
    assert.match(input.messages.at(-1).content, /local-command-verified/); json(res, 'Done and checked.');
  });
  const events = []; const result = await runLocalAgent({ gateway, cwd, mode: 'edit', trusted: true, prompt: 'Update the file and verify.', onEvent: (event) => { events.push(event); if (event.kind === 'permission') event.answer = Promise.resolve('once'); } });
  assert.equal(result.ok, true); assert.match(result.text, /Done and checked/); assert.equal(fs.readFileSync(path.join(cwd, 'file.txt'), 'utf8'), 'updated\n');
  assert.equal(events.filter((event) => event.kind === 'permission').length, 2);
  assert.equal(events.filter((event) => event.kind === 'done').length, 1); assert.ok(events.some((event) => event.kind === 'file'));
  assert.equal(requests[0].tools.find((tool) => tool.function.name === 'run_command').type, 'function');
  assert.ok(!fs.readdirSync(cwd).some((name) => name.startsWith('.tributary-edit')));
});

test('local file tools preserve external edits, reject escapes/symlinks, and enforce read-only and trust modes', async (t) => {
  const { root, cwd } = await fixture(t, (input, res) => json(res, 'unused'));
  const base = { cwd, mode: 'full', trusted: true, onEvent() {} };
  await assert.rejects(executeTool(base, 'read_file', { path: '../outside' }), /outside/);
  fs.writeFileSync(path.join(root, 'outside'), 'private'); fs.symlinkSync(path.join(root, 'outside'), path.join(cwd, 'link'));
  await assert.rejects(executeTool(base, 'write_file', { path: 'link', content: 'bad', expected_hash: 'new' }), /outside/);
  await assert.rejects(executeTool({ ...base, mode: 'read' }, 'run_command', { command: 'echo forbidden' }), /disabled/);
  await assert.rejects(executeTool({ ...base, trusted: false }, 'edit_file', { path: 'file.txt', old_text: 'original', new_text: 'bad' }), /disabled/);
  await assert.rejects(executeTool(base, 'write_file', { path: '.git/config', content: 'bad', expected_hash: 'new' }), /Git internals/);
  await assert.rejects(executeTool(base, 'write_file', { path: 'file.txt', content: 'bad', expected_hash: 'new' }), /changed or was not read/);
  await assert.rejects(executeTool({ ...base, mode: 'edit', onEvent(event) { if (event.kind === 'permission') { fs.writeFileSync(path.join(cwd, 'file.txt'), 'external edit'); event.answer = Promise.resolve('once'); } } }, 'edit_file', { path: 'file.txt', old_text: 'original', new_text: 'bad' }), /changed while awaiting/);
  assert.equal(fs.readFileSync(path.join(cwd, 'file.txt'), 'utf8'), 'external edit');
  assert.equal(fs.readFileSync(path.join(root, 'outside'), 'utf8'), 'private');
  const denied = { ...base, mode: 'edit', onEvent(event) { if (event.kind === 'permission') event.answer = Promise.resolve('reject'); } };
  await assert.rejects(executeTool(denied, 'write_file', { path: 'new.txt', content: 'bad', expected_hash: 'new' }), /denied/);
  assert.ok(!fs.existsSync(path.join(cwd, 'new.txt')));
});

test('local agent never executes an unsupported batch or incomplete streamed tool call', async (t) => {
  let attempt = 0;
  const { cwd, gateway } = await fixture(t, (input, res) => {
    if (++attempt === 1) return json(res, '', [call('write_file', { path: 'bad.txt', content: 'bad', expected_hash: 'new' }), call('unknown', {}, 'two')]);
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [call('write_file', { path: 'bad.txt', content: 'bad', expected_hash: 'new' })] } }] })}\n\n`);
  });
  for (let index = 0; index < 2; index++) {
    const events = []; const result = await runLocalAgent({ gateway, cwd, mode: 'full', trusted: true, prompt: 'Make a file', onEvent: (event) => events.push(event) });
    assert.equal(result.ok, false); assert.ok(!fs.existsSync(path.join(cwd, 'bad.txt'))); assert.ok(!events.some((event) => event.kind === 'tool'));
  }
});

test('local agent read mode offers no edit/command tools and stop kills a running shell', async (t) => {
  const { cwd, gateway } = await fixture(t, (input, res) => {
    assert.ok(!input.tools.some((tool) => ['write_file', 'run_command'].includes(tool.function.name)));
    json(res, '', [call('run_command', { command: 'echo bad' })]);
  });
  const result = await runLocalAgent({ gateway, cwd, mode: 'read', prompt: 'Read only', onEvent() {} }); assert.equal(result.ok, false);
  const remote = await runLocalAgent({ gateway, cwd, host: { remote: true }, mode: 'full', prompt: 'Remote', onEvent() {} }); assert.equal(remote.ok, false); assert.match(remote.text, /^$/);
  const controller = new AbortController();
  const command = executeTool({ cwd, mode: 'full', trusted: true, signal: controller.signal, onEvent() {} }, 'run_command', { command: `"${process.execPath}" -e "setTimeout(()=>{},60000)"` });
  setTimeout(() => controller.abort(), 100); const stopped = await command; assert.equal(stopped.stopped, true); assert.notEqual(stopped.exitCode, 0);
});

test('local agents run as independent Hub chats, show approvals, and are available to background delegation', async (t) => {
  const { root, cwd, gateway } = await fixture(t, (input, res) => {
    const toolResult = input.messages.find((message) => message.role === 'tool');
    if (!toolResult) return json(res, 'Editing the fixture.\n', [call('write_file', { path: 'generated.txt', content: 'local change', expected_hash: 'new' })]);
    json(res, 'Finished the real file change.');
  });
  execFileSync('git', ['init', '-q'], { cwd }); execFileSync('git', ['add', '.'], { cwd }); execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Initial'], { cwd });
  const hub = new Hub({ dataDir: path.join(root, 'profile'), home: root, secrets: new MemorySecrets(), approvals: true }); hub.addProject(cwd);
  t.after(() => hub.store.close());
  await hub.saveGateway(gateway); const id = `direct:${gateway.id}`; assert.equal(hub.agent(id).protocol, 'local-agent');
  const first = hub.createThread(cwd); const second = hub.createThread(cwd); await hub.createWorktree(first.id); await hub.createWorktree(second.id);
  const requests = []; hub.on('permission', ({ request }) => { if (request.status === 'pending') { requests.push(request); hub.answerPermission(request.id, 'once'); } });
  const results = await Promise.all([first, second].map((chat) => hub.send({ threadId: chat.id, agentId: id, text: 'Create the fixture file', mode: 'edit' })));
  assert.ok(results.every((result) => result.ok && result.mode === 'edit' && result.files.some((file) => file.rel === 'generated.txt'))); assert.equal(requests.length, 2);
  assert.ok(!fs.existsSync(path.join(cwd, 'generated.txt'))); for (const chat of [first, second]) assert.equal(fs.readFileSync(path.join(chat.worktree.cwd, 'generated.txt'), 'utf8'), 'local change');
  const parent = hub.createThread(cwd); const bridge = await openDelegation(hub, parent, { id: 'parent', agent: id, gatewayId: gateway.id }, { mode: 'edit' });
  try {
    assert.ok((await bridge.call('agents')).some((agent) => agent.id === id));
    const worker = await bridge.call('start', { agentId: id, task: 'Create the background file' });
    const start = Date.now(); while (hub.running.has(worker.id) || hub.thread(worker.id).delegation.state === 'running') { assert.ok(Date.now() - start < 15000); await new Promise((resolve) => setTimeout(resolve, 20)); }
    assert.equal(hub.thread(worker.id).delegation.state, 'done'); assert.equal(hub.thread(worker.id).delegation.gatewayId, gateway.id);
    assert.equal(fs.readFileSync(path.join(hub.thread(worker.id).worktree.cwd, 'generated.txt'), 'utf8'), 'local change');
  } finally { bridge.close(); }
});

test('network resume survives restart and carries completed tool results without repeating the edit', async (t) => {
  const { root, cwd, gateway, requests } = await fixture(t, async (input, res, step) => {
    if (step === 1) return json(res, 'Creating a file.\n', [call('write_file', { path: 'resume.txt', content: 'written once', expected_hash: 'new' })]);
    if (step === 2) {
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {"choices":[{"delta":{"content":"Checking"}}]}\n\n');
      await new Promise((resolve) => setTimeout(resolve, 15)); res.destroy(); return;
    }
    assert.ok(input.messages.some((message) => message.role === 'tool' && /written/.test(message.content)));
    assert.match(input.messages[0].content, /Network resume/);
    json(res, 'Resumed after the completed edit.');
  });
  const profile = path.join(root, 'profile'); const secrets = new MemorySecrets();
  let hub = new Hub({ dataDir: profile, home: root, secrets }); hub.addProject(cwd); await hub.saveGateway(gateway);
  t.after(() => hub.store.close());
  const chat = hub.createThread(cwd); const interrupted = await hub.send({ threadId: chat.id, agentId: `direct:${gateway.id}`, text: 'Create resume.txt', mode: 'full' });
  assert.equal(interrupted.ok, false); assert.equal(interrupted.networkInterrupted, true); assert.equal(fs.readFileSync(path.join(cwd, 'resume.txt'), 'utf8'), 'written once');
  const before = fs.statSync(path.join(cwd, 'resume.txt')).mtimeMs;
  hub.store.close(); hub = new Hub({ dataDir: profile, home: root, secrets });
  const resumed = await hub.resumeTurn(chat.id, interrupted.id);
  assert.equal(resumed.ok, true, resumed.error); assert.match(resumed.text, /Resumed/); assert.equal(requests.length, 3);
  assert.equal(fs.statSync(path.join(cwd, 'resume.txt')).mtimeMs, before); assert.equal(require('../core/local-resume').read(profile, chat.id), null);
  await assert.rejects(async () => hub.resumeTurn(chat.id, interrupted.id), /most recent/);
});

test('native coding agents resume their recorded session after a network interruption', async (t) => {
  const root = mkdtemp('native-network-resume');
  const hub = new Hub({ dataDir: path.join(root, 'profile'), home: root, secrets: new MemorySecrets() }); hub.addProject(root);
  t.after(() => { hub.store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const resumes = [];
  hub.agents = [{ id: 'native', name: 'Native fixture', protocol: 'codex-exec', available: true, gateways: [], path: process.execPath, args: ({ resumeId, prompt }) => {
    resumes.push(resumeId); const events = resumeId ? [{ type: 'item.completed', item: { type: 'agent_message', text: 'Continued the existing native session.' } }, { type: 'turn.completed' }] : [{ type: 'thread.started', thread_id: 'native-session' }, { type: 'turn.failed', error: { message: 'Network connection reset ECONNRESET' } }];
    if (resumeId) assert.match(prompt, /Do not repeat completed/);
    return ['-e', `for (const event of ${JSON.stringify(events)}) console.log(JSON.stringify(event))`];
  } }];
  const chat = hub.createThread(root); const interrupted = await hub.send({ threadId: chat.id, agentId: 'native', text: 'Build the original task.', mode: 'read' });
  assert.equal(interrupted.networkInterrupted, true);
  const result = await hub.resumeTurn(chat.id, interrupted.id); assert.equal(result.ok, true); assert.deepEqual(resumes, [null, 'native-session']);
});

test('disconnect detection covers DNS, offline, timeout and connection failures without treating ordinary errors as retryable', () => {
  const { networkFailure } = require('../core/local-resume');
  for (const message of ['getaddrinfo EAI_AGAIN api.example.test', 'getaddrinfo ENOTFOUND api.example.test', 'connect EHOSTUNREACH', 'connect ETIMEDOUT', 'Connection refused', 'Connection lost', 'You are offline', 'net::ERR_INTERNET_DISCONNECTED', 'net::ERR_NETWORK_CHANGED', 'net::ERR_CONNECTION_CLOSED', 'Request timeout', 'The assistant timed out', 'Assistant returned HTTP 503', 'The connection ended before the response finished.']) {
    assert.equal(networkFailure(message), true, message);
  }
  for (const message of [null, '', 'Stopped by user', 'Permission denied', 'Assistant returned HTTP 401', 'Assistant returned HTTP 429', 'Invalid tool arguments.', 'The model returned an unsupported or duplicate tool call.']) {
    assert.equal(networkFailure(message), false, String(message));
  }
});

test('thrown connection failures expose resume and preserve the original task in the fallback context', async (t) => {
  const root = mkdtemp('thrown-network-resume');
  const hub = new Hub({ dataDir: path.join(root, 'profile'), home: root, secrets: new MemorySecrets() }); hub.addProject(root);
  t.after(() => hub.store.close());
  let attempts = 0;
  hub.agents = [{ id: 'native', name: 'Native fixture', protocol: 'codex-exec', available: true, gateways: [], path: process.execPath, args: ({ prompt }) => {
    if (++attempts === 1) throw new Error('getaddrinfo EAI_AGAIN api.example.test');
    assert.match(prompt, /Investigate the build failure/); assert.match(prompt, /Do not repeat completed/);
    return ['-e', `console.log(JSON.stringify({type:'turn.completed'}))`];
  } }];
  const chat = hub.createThread(root);
  const interrupted = await hub.send({ threadId: chat.id, agentId: 'native', text: 'Investigate the build failure', mode: 'read' });
  assert.equal(interrupted.ok, false); assert.equal(interrupted.networkInterrupted, true); assert.equal(hub.running.has(chat.id), false);
  assert.equal((await hub.resumeTurn(chat.id, interrupted.id)).ok, true);
  assert.equal(attempts, 2);
});

test('a second disconnect replaces the checkpoint and keeps completed local edits through another restart', async (t) => {
  const { root, cwd, gateway, requests } = await fixture(t, (input, res, step) => {
    if (step === 1) return json(res, 'Writing once.', [call('write_file', { path: 'repeat.txt', content: 'kept', expected_hash: 'new' })]);
    if (step < 4) { res.writeHead(503); res.end('temporarily unavailable'); return; }
    assert.ok(input.messages.some((message) => message.role === 'tool' && /written/.test(message.content)));
    json(res, 'Finished from the saved tool result.');
  });
  const profile = path.join(root, 'profile'); const secrets = new MemorySecrets();
  let hub = new Hub({ dataDir: profile, home: root, secrets }); hub.addProject(cwd); await hub.saveGateway(gateway);
  t.after(() => hub.store.close());
  const chat = hub.createThread(cwd);
  const first = await hub.send({ threadId: chat.id, agentId: `direct:${gateway.id}`, text: 'Write repeat.txt', mode: 'full' });
  const before = fs.statSync(path.join(cwd, 'repeat.txt')).mtimeMs;
  const second = await hub.resumeTurn(chat.id, first.id);
  assert.equal(second.networkInterrupted, true);
  assert.equal(require('../core/local-resume').read(profile, chat.id).messageId, second.id);
  await assert.rejects(async () => hub.resumeTurn(chat.id, first.id), /most recent/);
  hub.store.close(); hub = new Hub({ dataDir: profile, home: root, secrets });
  assert.equal((await hub.resumeTurn(chat.id, second.id)).ok, true);
  assert.equal(requests.length, 4); assert.equal(fs.statSync(path.join(cwd, 'repeat.txt')).mtimeMs, before);
  assert.equal(fs.readFileSync(path.join(cwd, 'repeat.txt'), 'utf8'), 'kept');
  assert.equal(require('../core/local-resume').read(profile, chat.id), null);
});
