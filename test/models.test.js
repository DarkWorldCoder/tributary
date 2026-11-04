'use strict';
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { validateModel, selectable, normalize, providerModels, codexModels, catalog } = require('../core/models');
const { Hub, MemorySecrets } = require('../core');
function temp(t) { const root = mkTmp('models'); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
const json = (data) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

test('model IDs are bounded, catalogs handle malformed entries, and unsupported integrations are explicit', async () => {
  for (const id of ['sonnet', 'opus[1m]', 'provider/model:tag', 'arn:aws:bedrock:us-east-1:123:profile/test']) assert.equal(validateModel(id), id);
  for (const id of ['--help', 'model\nother', 'two words', 'x'.repeat(201), {}, 5]) assert.throws(() => validateModel(id), /model ID/);
  assert.equal(validateModel(null), '');
  assert.deepEqual(normalize([null, {}, { id: '--bad' }, { name: 5 }, { id: 'one' }, { id: 'one', displayName: 'One' }]), [{ id: 'one', name: 'One', hidden: false }]);
  assert.equal(normalize(Array.from({ length: 700 }, (_, i) => ({ id: `model-${i}` }))).length, 500);
  assert.equal(selectable({ id: 'opencode', protocol: 'acp' }), false);
  const unsupported = await catalog({ id: 'opencode', protocol: 'acp' });
  assert.equal(unsupported.supportsSelection, false);
  assert.deepEqual(unsupported.models, []);
  const claude = await catalog({ id: 'claude' });
  assert.equal(claude.source, 'aliases');
  assert.ok(claude.models.some((m) => m.id === 'sonnet'));
  assert.match(claude.note, /not an account/);
});

test('provider model discovery uses only metadata endpoints, exact auth, pagination and generation-method filtering', async () => {
  const calls = [];
  const anthropic = await providerModels({ protocol: 'anthropic', baseUrl: 'https://provider.example/v1', apiKey: 'fixture-key' }, { fetchImpl: async (url, opts) => {
    calls.push({ url, opts }); const next = new URL(url).searchParams.get('after_id');
    return json(next ? { data: [{ id: 'model-two' }], has_more: false } : { data: [{ id: 'model-one', display_name: 'One' }], has_more: true, last_id: 'model-one' });
  } });
  assert.deepEqual(anthropic.map((m) => m.id), ['model-one', 'model-two']);
  assert.equal(calls[0].opts.headers['x-api-key'], 'fixture-key');
  assert.equal(calls[0].opts.redirect, 'error');
  assert.equal(new URL(calls[0].url).pathname, '/v1/models');
  assert.equal(calls[0].opts.method, undefined); // GET, never an inference POST.
  assert.ok(!calls[0].url.includes('fixture-key'));
  const gemini = await providerModels({ protocol: 'gemini', apiKey: 'fixture-google' }, { fetchImpl: async (url, opts) => {
    assert.equal(opts.headers['x-goog-api-key'], 'fixture-google');
    assert.equal(new URL(url).pathname, '/v1beta/models');
    return json({ models: [{ name: 'models/gemini-chat', displayName: 'Chat', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed-only', supportedGenerationMethods: ['embedContent'] }] });
  } });
  assert.deepEqual(gemini.map((m) => m.id), ['gemini-chat']);
  const openai = await providerModels({ protocol: 'openai', baseUrl: 'http://localhost:1234/v1', apiKey: 'fixture-openai' }, { fetchImpl: async (url, opts) => {
    assert.equal(url, 'http://localhost:1234/v1/models'); assert.equal(opts.headers.Authorization, 'Bearer fixture-openai'); return json({ data: [{ id: 'chat-local' }] });
  } });
  assert.equal(openai[0].id, 'chat-local');
  const ollama = await providerModels({ protocol: 'ollama', baseUrl: 'http://localhost:11434/v1' }, { fetchImpl: async (url) => { assert.equal(url, 'http://localhost:11434/api/tags'); return json({ models: [{ name: 'local:latest' }] }); } });
  assert.equal(ollama[0].id, 'local:latest');
});

test('model discovery rejects unsafe endpoints, provider errors and oversized data without leaking response bodies', async () => {
  for (const baseUrl of ['http://remote.example/v1', 'https://user:secret@provider.example/v1', 'https://provider.example/v1?api-key=secret']) await assert.rejects(providerModels({ protocol: 'openai', baseUrl }, { fetchImpl: () => assert.fail('must not fetch') }), /HTTPS/);
  await assert.rejects(providerModels({ protocol: 'openai', baseUrl: 'https://provider.example/v1' }, { fetchImpl: async () => new Response('private-provider-error', { status: 401 }) }), (e) => /401/.test(e.message) && !/private-provider/.test(e.message));
  await assert.rejects(providerModels({ protocol: 'openai', baseUrl: 'https://provider.example/v1' }, { fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) }), /size limit/);
});

test('Codex catalog uses initialize and paginated model/list without creating a thread or turn', async (t) => {
  const root = temp(t); const file = path.join(root, 'fake codex');
  fs.writeFileSync(file, `#!${process.execPath}\nconst readline=require('readline');const io=readline.createInterface({input:process.stdin});io.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')console.log(JSON.stringify({id:m.id,result:{}}));else if(m.method==='initialized'){}else if(m.method==='model/list'){console.log(JSON.stringify({id:m.id,result:m.params.cursor?{data:[{id:'two',model:'two',displayName:'Two',hidden:true}],nextCursor:null}:{data:[{id:'one',model:'one',displayName:'One'}],nextCursor:'next'}}));}else process.exit(2);});`);
  fs.chmodSync(file, 0o700);
  const models = await codexModels({ path: file }, { timeoutMs: 3000 });
  assert.deepEqual(models.map((m) => [m.id, m.hidden]), [['one', false], ['two', true]]);
  fs.writeFileSync(file, `#!${process.execPath}\nconsole.error('private CLI details');setInterval(()=>{},1000);`);
  await assert.rejects(codexModels({ path: file }, { timeoutMs: 80 }), /timed out/);
});

test('model choices reach native runs and persist; switching models isolates resumable sessions', async (t) => {
  const root = temp(t); const project = path.join(root, 'project'); fs.mkdirSync(project);
  const script = path.join(root, 'agent.js');
  fs.writeFileSync(script, `console.log(JSON.stringify({type:'system',subtype:'init',session_id:'session-'+process.argv[2]}));console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:process.argv[2]+'|'+process.argv[3]+'|'+(process.env.ANTHROPIC_MODEL||'none')}]}}));console.log(JSON.stringify({type:'result',subtype:'success',result:'ok'}));`);
  const hub = new Hub({ dataDir: path.join(root, 'data'), secrets: new MemorySecrets(), home: root });
  t.after(() => { hub.fileWatches.close(); hub.store.close(); });
  hub.addProject(project);
  hub.agents = [{ id: 'claude', name: 'Fixture', available: true, headless: true, path: process.execPath, protocol: 'claude-stream', gateways: ['anthropic'], stdinPrompt: true, args: ({ model, resumeId }) => [script, model || 'default', resumeId || 'fresh'] }];
  const thread = hub.createThread(project);
  const send = (model) => hub.send({ threadId: thread.id, agentId: 'claude', mode: 'read', model, text: 'fixture' });
  const one = await send('sonnet'); const two = await send('sonnet'); const three = await send('opus'); const four = await send('sonnet');
  assert.match(one.text, /sonnet\|fresh/); assert.match(two.text, /sonnet\|session-sonnet/); assert.match(three.text, /opus\|fresh/); assert.match(four.text, /sonnet\|session-sonnet/);
  assert.equal(three.model, 'opus');
  assert.equal(hub.thread(thread.id).messages.filter((m) => m.role === 'assistant').length, 4);
  const count = thread.messages.length; await assert.rejects(send('--help'), /model ID/); assert.equal(thread.messages.length, count);
  const gateway = await hub.saveGateway({ name: 'Gateway', protocol: 'anthropic', baseUrl: 'https://provider.example', model: 'profile-default' });
  const override = await hub.send({ threadId: thread.id, agentId: 'claude', model: 'selected-gateway-model', gatewayId: gateway, text: 'fixture', mode: 'read' });
  assert.match(override.text, /selected-gateway-model\|fresh\|selected-gateway-model/);
  assert.equal(override.gatewayId, gateway);
});

test('selected models reach direct provider request bodies instead of the saved default', async (t) => {
  const root = temp(t); const project = path.join(root, 'project'); fs.mkdirSync(project);
  const hub = new Hub({ dataDir: path.join(root, 'data'), secrets: new MemorySecrets(), home: root });
  t.after(() => { hub.fileWatches.close(); hub.store.close(); }); hub.addProject(project);
  const id = await hub.saveGateway({ direct: true, name: 'Fixture', protocol: 'openai', baseUrl: 'http://localhost:1234/v1', model: 'saved-default' });
  const previous = global.fetch; t.after(() => { global.fetch = previous; }); let body;
  global.fetch = async (_url, options) => { body = JSON.parse(options.body); return json({ choices: [{ message: { content: 'fixture reply' }, finish_reason: 'stop' }] }); };
  const thread = hub.createThread(project);
  const result = await hub.send({ threadId: thread.id, agentId: `direct:${id}`, model: 'selected-model', text: 'fixture' });
  assert.equal(body.model, 'selected-model'); assert.equal(result.model, 'selected-model'); assert.equal(result.ok, true);
});

test('Claude catalog uses native model display names without sending a model turn', async (t) => {
  const root = temp(t); const file = path.join(root, 'fake-claude');
  fs.writeFileSync(file, `#!${process.execPath}\nconst readline=require('node:readline');readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type!=='control_request'||m.request.subtype!=='initialize')process.exit(2);console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{models:[{value:'opus',displayName:'Opus fixture version',resolvedModel:'claude-opus-fixture'},{value:'sonnet',displayName:'Sonnet fixture version',resolvedModel:'claude-sonnet-fixture'}]}}}));});`);
  fs.chmodSync(file, 0o700);
  const result = await catalog({ id: 'claude', path: file }, null, { timeoutMs: 3000 });
  assert.equal(result.source, 'claude');
  assert.deepEqual(result.models.map((m) => [m.id, m.name, m.resolvedModel]), [['opus', 'Opus fixture version', 'claude-opus-fixture'], ['sonnet', 'Sonnet fixture version', 'claude-sonnet-fixture']]);
  fs.writeFileSync(file, `#!${process.execPath}\nprocess.exit(1)`);
  const fallback = await catalog({ id: 'claude', path: file }, null, { timeoutMs: 1000 });
  assert.equal(fallback.source, 'aliases'); assert.ok(fallback.models.some((m) => m.id === 'opus'));
});
