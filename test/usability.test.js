'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { execFileSync } = require('node:child_process');
const { Hub } = require('../core/hub'); const { MemorySecrets } = require('../core/store'); const { BUILTIN } = require('../core/agents');
const files = require('../core/attachments');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-usability-'));

test('project renaming persists without changing paths, folders or conversations', (t) => {
  const root = tmp(); t.after(() => fs.rmSync(root, { recursive: true, force: true })); const project = path.join(root, 'project'); fs.mkdirSync(project);
  const dataDir = path.join(root, 'data'); const hub = new Hub({ dataDir, secrets: new MemorySecrets() }); hub.addProject(project); const chat = hub.createThread(project);
  hub.renameProject(project, '  My project  '); hub.store.save(true); hub.store.close();
  const loaded = new Hub({ dataDir, secrets: new MemorySecrets() }); t.after(() => loaded.store.close());
  assert.equal(loaded.project(project).name, 'My project'); assert.equal(loaded.thread(chat.id).project, project); assert.ok(fs.existsSync(project));
  for (const name of ['', ' ', 'a\nname', 'a'.repeat(121), null]) assert.throws(() => loaded.renameProject(project, name));
  assert.throws(() => loaded.renameProject('/missing', 'Name'), /project/i);
});

test('formatting preserves JSONC comments, formats TS and CSS, and rejects malformed input', async () => {
  const { formatDocument } = await import('../ui/src/lib/format-document.mjs');
  const json = await formatDocument('settings.jsonc', '{"one":1,// keep\n"two":2}'); assert.match(json, /\/\/ keep/); assert.match(json, /"one": 1/);
  assert.match(await formatDocument('a.ts', 'const x:number=1'), /const x: number = 1;/);
  assert.match(await formatDocument('a.css', 'a{color:red}'), /color: red;/);
  await assert.rejects(formatDocument('a.ts', 'const = ???')); await assert.rejects(formatDocument('a.unknown', 'sample'), /not available/);
});

test('attachments validate content, stay outside the project, and reject traversal and oversized input', (t) => {
  const root = tmp(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6mVQAAAAASUVORK5CYII=', 'base64');
  const [image, text] = files.add(root, [{ name: '../../Screenshot.png', base64: png.toString('base64') }, { name: 'notes.md', base64: Buffer.from('# Notes').toString('base64') }]);
  assert.equal(image.name, 'Screenshot.png'); assert.equal(image.mime, 'image/png'); assert.equal(files.resolve(root, [text.id])[0].mime, 'text/plain');
  assert.ok(files.read(root, image.id).path.startsWith(path.join(root, 'attachments'))); assert.deepEqual(Buffer.from(files.read(root, image.id).base64, 'base64'), png);
  assert.throws(() => files.read(root, '../private')); assert.throws(() => files.add(root, [{ name: 'big', base64: 'A'.repeat(24 * 1024 * 1024) }]));
  const [fake] = files.add(root, [{ name: 'fake.png', base64: Buffer.from('not an image').toString('base64') }]); assert.equal(fake.mime, 'application/octet-stream');
});

test('Codex resume keeps sandbox, cwd and gateway arguments on exec, and image arguments on resume', () => {
  const codex = BUILTIN.find((agent) => agent.id === 'codex');
  for (const mode of ['read', 'edit', 'full']) {
    const args = codex.args({ mode, resumeId: 'session', cwd: '/project', model: 'fixture', extraDirs: ['/extra'], gatewayArgs: ['--oss', '--local-provider', 'ollama'], images: [{ path: '/image.png' }] });
    const resume = args.indexOf('resume'); assert.ok(resume > args.indexOf('-C')); assert.ok(resume > args.indexOf('--add-dir')); assert.ok(resume > args.indexOf('--oss'));
    assert.ok(args.indexOf('-i') > resume); assert.deepEqual(args.slice(-2), ['session', '-']);
    if (mode !== 'full') assert.ok(args.indexOf('-s') < resume); else assert.ok(args.indexOf('--dangerously-bypass-approvals-and-sandbox') < resume);
  }
});

test('Antigravity model catalog parses installed CLI output without starting a turn', async (t) => {
  const root = tmp(); t.after(() => fs.rmSync(root, { recursive: true, force: true })); const file = path.join(root, 'agy');
  fs.writeFileSync(file, '#!/usr/bin/env node\nif(process.argv[2]!=="models")process.exit(9); console.log("Fetching available models...\\ngemini-fixture\\tGemini Fixture\\nclaude-fixture\\tClaude Fixture")'); fs.chmodSync(file, 0o755);
  const { catalog } = require('../core/models'); const result = await catalog({ id: 'antigravity', path: file }); assert.equal(result.source, 'antigravity'); assert.deepEqual(result.models.map((model) => model.id), ['gemini-fixture', 'claude-fixture']);
});

test('LAN TLS pin is checked before any access key is sent; two invited clients share updates', async (t) => {
  const root = tmp(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-keyout', path.join(root, 'key'), '-out', path.join(root, 'cert')], { stdio: 'ignore' });
  const cert = fs.readFileSync(path.join(root, 'cert')); const fingerprint = new (require('node:crypto').X509Certificate)(cert).fingerprint256;
  const { createService } = require('../server/service'); const service = createService({ dbPath: path.join(root, 'room.sqlite'), tls: { cert, key: fs.readFileSync(path.join(root, 'key')) } });
  await new Promise((resolve) => service.server.listen(0, '127.0.0.1', resolve)); const endpoint = `https://127.0.0.1:${service.server.address().port}`;
  const { pinnedFetch } = await import('../core/collaboration/pinned-fetch.mjs'); const { CollaborationClient } = await import('../core/collaboration/client.mjs');
  let requests = 0; service.server.on('request', () => requests++);
  await assert.rejects(pinnedFetch(endpoint + '/api/me', { headers: { authorization: 'Bearer do-not-send' } }, 'a'.repeat(64)), /does not match/); assert.equal(requests, 0);
  const owner = new CollaborationClient(() => {}, pinnedFetch); const member = new CollaborationClient(() => {}, pinnedFetch);
  t.after(async () => { owner.disconnect(); member.disconnect(); await service.close(); });
  await owner.connect({ endpoint, accessKey: service.bootstrapToken, fingerprint }); const project = await owner.command('createProject', { name: 'LAN room' });
  const invitation = await owner.command('invite', { name: 'Teammate' }); await member.connect({ endpoint, accessKey: invitation.accessKey, fingerprint }); assert.equal(member.state().snapshot.project.id, project.id);
  const task = await owner.command('createTask', { title: 'Shared task' }); await member.refresh(project.id); assert.equal(member.state().snapshot.tasks[0].id, task.id);
  const { decodePeer } = require('../core/collaboration/peers'); const packet = Buffer.from(JSON.stringify({ type: 'tributary-room-v1', name: 'Host', port: 4318, fingerprint: fingerprint.replaceAll(':', '').toLowerCase() }));
  assert.equal(decodePeer(packet, '192.168.1.2').endpoint, 'https://192.168.1.2:4318'); assert.equal(decodePeer(packet, '8.8.8.8'), null);
});

test('image attachment reaches a native Claude stream and persists in the conversation', async (t) => {
  const root = tmp(); t.after(() => fs.rmSync(root, { recursive: true, force: true })); const project = path.join(root, 'project'); fs.mkdirSync(project);
  const hub = new Hub({ dataDir: path.join(root, 'data'), secrets: new MemorySecrets() }); t.after(() => hub.store.close()); hub.addProject(project);
  const capture = path.join(root, 'input.json'); const script = path.join(root, 'agent.cjs');
  fs.writeFileSync(script, `let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{require('fs').writeFileSync(${JSON.stringify(capture)},input);console.log(JSON.stringify({type:'result',result:'Saw the attachment',is_error:false}));});`);
  hub.agents = [{ id: 'claude', name: 'Fixture', available: true, headless: true, protocol: 'claude-stream', path: process.execPath, stdinPrompt: true, args: () => [script] }];
  const [file] = hub.addAttachments([{ name: 'tiny.png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6mVQAAAAASUVORK5CYII=' }]);
  const chat = hub.createThread(project); await hub.send({ threadId: chat.id, agentId: 'claude', text: 'Inspect this', mode: 'read', attachments: [file.id] });
  const message = JSON.parse(fs.readFileSync(capture, 'utf8')); assert.equal(message.message.content[0].type, 'image'); assert.equal(message.message.content[0].source.media_type, 'image/png');
  assert.deepEqual(chat.messages[0].attachments, [file]); assert.ok(!fs.existsSync(path.join(project, 'tiny.png')));
});

test('direct vision sends actual image content and supplied text to the provider', async (t) => {
  const { runDirectTurn } = require('../core/direct'); const original = global.fetch; let body;
  t.after(() => { global.fetch = original; });
  global.fetch = async (_url, options) => { body = JSON.parse(options.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'Inspected' } }] }), { headers: { 'content-type': 'application/json' } }); };
  const result = await runDirectTurn({ gateway: { protocol: 'openai', baseUrl: 'http://localhost:1234/v1', model: 'vision-fixture' }, prompt: 'Inspect image', images: [{ mime: 'image/png', base64: 'aGVsbG8=' }], onEvent() {} });
  assert.ok(result.ok); assert.equal(body.messages[1].content[0].text, 'Inspect image'); assert.equal(body.messages[1].content[1].image_url.url, 'data:image/png;base64,aGVsbG8=');
});
