'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createService } = require('../server/service');
const { Hub, MemorySecrets } = require('../core');
const ownerKey = 'test-owner-access-key-000000000000000000000';
const waitFor = async (fn) => { const until = Date.now() + 5000; while (!fn()) { if (Date.now() > until) throw new Error('Condition timed out'); await new Promise((r) => setTimeout(r, 10)); } };
test('project service supports directly hosted HTTPS with certificate verification', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-tls-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const key = path.join(dir, 'key.pem'); const cert = path.join(dir, 'cert.pem');
  require('node:child_process').execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  const service = createService({ dbPath: path.join(dir, 'db.sqlite'), bootstrapToken: ownerKey, tls: { key: fs.readFileSync(key), cert: fs.readFileSync(cert) } });
  await new Promise((resolve) => service.server.listen(0, '127.0.0.1', resolve)); t.after(() => service.close());
  const options = { hostname: '127.0.0.1', port: service.server.address().port, path: '/api/me', headers: { authorization: `Bearer ${ownerKey}` }, ca: fs.readFileSync(cert) };
  const result = await new Promise((resolve, reject) => require('node:https').get(options, (response) => { let body = ''; response.on('data', (chunk) => { body += chunk; }); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) })); }).on('error', reject));
  assert.equal(result.status, 200); assert.equal(result.body.user.admin, true);
  await assert.rejects(new Promise((resolve, reject) => require('node:https').get({ ...options, ca: undefined }, resolve).on('error', reject)), /self-signed certificate/);
  assert.throws(() => createService({ dbPath: path.join(dir, 'bad.sqlite'), publicOrigin: 'https://example.com/path' }), /public origin/);
});
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-room-'));
  let service; let url;
  const start = async () => { service = createService({ dbPath: path.join(dir, 'room.sqlite'), bootstrapToken: ownerKey, ownerName: 'Owner' }); await new Promise((r) => service.server.listen(0, '127.0.0.1', r)); url = `http://127.0.0.1:${service.server.address().port}`; };
  await start(); t.after(async () => { await service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const request = async (token, route, body, key = randomUUID(), extraHeaders = {}) => {
    const r = await fetch(url + route, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json', 'x-command-id': key } : {}), ...extraHeaders }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: await r.json() };
  };
  const create = async (name = 'Shared project') => { const r = await request(ownerKey, '/api/projects', { name }); assert.equal(r.status, 200); return r.data; };
  const invite = async (id, name) => { const r = await request(ownerKey, `/api/projects/${id}/invite`, { name }); assert.equal(r.status, 200); return r.data; };
  return { request, create, invite, get url() { return url; }, dir, async restart() { await service.close(); await start(); assert.equal(service.bootstrapToken, null); } };
}

test('project service: isolated membership, private invitation keys and bounded API surface', async (t) => {
  const f = await fixture(t); const p = await f.create(); const other = await f.create('Another project');
  const invite = await f.invite(p.id, 'Alice');
  assert.equal((await f.request(invite.accessKey, `/api/projects/${p.id}/snapshot`)).status, 200);
  assert.equal((await f.request(invite.accessKey, `/api/projects/${other.id}/snapshot`)).status, 403);
  assert.equal((await f.request(invite.accessKey, '/api/projects', { name: 'Unauthorized' })).status, 403);
  assert.equal((await f.request('invalid-key', '/api/me')).status, 401);
  assert.equal((await f.request(ownerKey, '/api/me', null, undefined, { origin: 'https://untrusted.example' })).status, 403);
  const badHost = await new Promise((resolve, reject) => { require('node:http').get(f.url + '/api/me', { headers: { host: 'untrusted.example', authorization: `Bearer ${ownerKey}` } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject); });
  assert.equal(badHost, 403);
  assert.equal((await f.request(ownerKey, `/api/projects/${p.id}/execute`, { command: 'anything' })).status, 404);
  const snapshot = await f.request(ownerKey, `/api/projects/${p.id}/snapshot`);
  assert.ok(!JSON.stringify(snapshot).includes(invite.accessKey));
  assert.ok(!JSON.stringify(snapshot).includes(ownerKey));
  for (const filename of fs.readdirSync(f.dir)) {
    const contents = fs.readFileSync(path.join(f.dir, filename));
    assert.ok(!contents.includes(Buffer.from(invite.accessKey)), `${filename} must not contain the invitation secret`);
    assert.ok(!contents.includes(Buffer.from(ownerKey)), `${filename} must not contain the owner secret`);
  }
  const key = randomUUID(); const first = await f.request(ownerKey, `/api/projects/${p.id}/invite`, { name: 'Bob' }, key);
  const replay = await f.request(ownerKey, `/api/projects/${p.id}/invite`, { name: 'Bob' }, key);
  assert.ok(first.data.accessKey); assert.equal(replay.data.accessKey, undefined); assert.equal(replay.data.invitationDelivered, true);
});

test('project service: competing claims, idempotent commands, dependencies and stale progress', async (t) => {
  const f = await fixture(t); const p = await f.create(); const alice = await f.invite(p.id, 'Alice'); const bob = await f.invite(p.id, 'Bob');
  const route = `/api/projects/${p.id}/tasks`; const key = randomUUID();
  const created = await Promise.all(Array.from({ length: 8 }, () => f.request(ownerKey, route, { title: 'Agree on API' }, key)));
  assert.ok(created.every((r) => r.status === 200 && r.data.id === created[0].data.id));
  const task = created[0].data;
  assert.equal((await f.request(ownerKey, route, { title: 'Different request' }, key)).status, 409);
  const dependent = (await f.request(ownerKey, route, { title: 'Build interface', dependencies: [task.id] })).data;
  assert.equal((await f.request(bob.accessKey, `${route}/${dependent.id}/claim`, { revision: 1, agent: 'Claude Code' })).status, 409);
  const claims = await Promise.all([alice, bob].map((u) => f.request(u.accessKey, `${route}/${task.id}/claim`, { revision: 1, agent: 'My installed agent' })));
  assert.deepEqual(claims.map((r) => r.status).sort(), [200, 409]);
  const winner = claims[0].status === 200 ? alice : bob; const loser = winner === alice ? bob : alice;
  assert.equal((await f.request(loser.accessKey, `${route}/${task.id}/update`, { revision: 2, status: 'working' })).status, 403);
  const progress = await f.request(winner.accessKey, `${route}/${task.id}/update`, { revision: 2, status: 'working', result: 'Agreed on contract v1' });
  assert.equal(progress.status, 200);
  assert.equal((await f.request(winner.accessKey, `${route}/${task.id}/update`, { revision: 2, status: 'done', result: 'Stale overwrite' })).status, 409);
  assert.equal((await f.request(winner.accessKey, `${route}/${task.id}/update`, { revision: 3, status: 'done', result: '' })).status, 400);
  assert.equal((await f.request(winner.accessKey, `${route}/${task.id}/update`, { revision: 3, status: 'done', result: 'Contract checked against API tests; see commit abc' })).status, 200);
  assert.equal((await f.request(loser.accessKey, `${route}/${dependent.id}/claim`, { revision: 1, agent: 'Codex' })).status, 200);
  const before = (await f.request(ownerKey, `/api/projects/${p.id}/snapshot`)).data;
  await f.restart();
  const after = (await f.request(ownerKey, `/api/projects/${p.id}/snapshot`)).data;
  assert.deepEqual(after, before);
  assert.equal(after.tasks.length, 2);
});

test('live clients see changes, reconcile snapshots after reconnect and lose revoked access', async (t) => {
  const { CollaborationClient } = await import('../core/collaboration/client.mjs');
  const f = await fixture(t); const p = await f.create(); const alice = await f.invite(p.id, 'Alice');
  const owner = new CollaborationClient(); const peer = new CollaborationClient();
  t.after(() => { owner.disconnect(); peer.disconnect(); });
  await owner.connect({ endpoint: f.url, accessKey: ownerKey }); await peer.connect({ endpoint: f.url, accessKey: alice.accessKey });
  await waitFor(() => owner.state().status === 'live' && peer.state().status === 'live');
  await waitFor(() => peer.state().snapshot.online.length === 2);
  const task = await owner.command('createTask', { title: 'Preview the sign-in page' });
  await waitFor(() => peer.state().snapshot.tasks.some((x) => x.id === task.id));
  assert.ok(!JSON.stringify(peer.state()).includes(alice.accessKey));
  const claimed = await peer.command('claim', { id: task.id, revision: 1, agent: 'Claude Code' });
  await waitFor(() => owner.state().snapshot.tasks.find((x) => x.id === task.id)?.owner === alice.member.id);
  peer.disconnect(); await waitFor(() => owner.state().snapshot.online.length === 1);
  const offlineTask = await owner.command('createTask', { title: 'Task created while Alice was offline' });
  await peer.connect({ endpoint: f.url, accessKey: alice.accessKey });
  await waitFor(() => peer.state().status === 'live');
  assert.ok(peer.state().snapshot.tasks.some((x) => x.id === offlineTask.id));
  assert.equal(peer.state().snapshot.tasks.find((x) => x.id === task.id).revision, claimed.revision);
  await owner.command('revoke', { userId: alice.member.id });
  await waitFor(() => peer.state().status === 'disconnected');
  assert.equal(peer.state().snapshot, null); assert.match(peer.state().error, /removed/);
  assert.equal((await f.request(alice.accessKey, `/api/projects/${p.id}/snapshot`)).status, 403);
});

test('client rejects insecure remote addresses and cross-project watches', async (t) => {
  const { CollaborationClient } = await import('../core/collaboration/client.mjs'); const client = new CollaborationClient(); t.after(() => client.disconnect());
  await assert.rejects(client.connect({ endpoint: 'http://shared.example', accessKey: ownerKey }), /HTTPS/);
  await assert.rejects(client.connect({ endpoint: 'https://user:password@example.com', accessKey: ownerKey }), /without a path/);
  await assert.rejects(client.connect({ endpoint: 'https://example.com?key=secret', accessKey: ownerKey }), /without a path/);
  const f = await fixture(t); await client.connect({ endpoint: f.url, accessKey: ownerKey });
  await assert.rejects(client.watch('not-a-member'), /Unknown project/);
  await assert.rejects(client.command('constructor', {}), /supported action/);
});

test('local turn reservations prevent duplicate starts and competing workspace writes', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-reserve-'));
  const project = path.join(dir, 'project'); fs.mkdirSync(project);
  const hub = new Hub({ dataDir: path.join(dir, 'data'), secrets: new MemorySecrets() }); hub.addProject(project);
  const a = hub.createThread(project); const b = hub.createThread(project);
  t.after(() => { hub.store.save(true); fs.rmSync(dir, { recursive: true, force: true }); });
  let entered; const started = new Promise((r) => { entered = r; }); let release; const held = new Promise((r) => { release = r; });
  const first = hub.withTurn(a.id, true, false, async () => { entered(); await held; return 'finished'; });
  assert.ok(hub.running.has(a.id), 'reservation precedes the first await');
  await assert.rejects(hub.withTurn(a.id, true, false, async () => assert.fail('must not execute')), /already running/);
  await started;
  await assert.rejects(hub.withTurn(b.id, true, false, async () => assert.fail('must not share the workspace')), /workspace is busy/);
  assert.equal(hub.running.has(b.id), false);
  release(); assert.equal(await first, 'finished');
  await hub.withTurn(b.id, true, false, async () => {});
  assert.equal(hub.running.size, 0); assert.equal(hub.workspaceReservations.size, 0);
  let executed = false;
  const pending = hub.withTurn(a.id, true, false, async () => { executed = true; }); hub.stop(a.id);
  await assert.rejects(pending, /abort/i); assert.equal(executed, false); assert.equal(hub.running.size, 0);
});

test('an uncertain create retries with the same command ID after the response is lost', async (t) => {
  const { CollaborationClient } = await import('../core/collaboration/client.mjs'); const f = await fixture(t); await f.create();
  const client = new CollaborationClient(); await client.connect({ endpoint: f.url, accessKey: ownerKey });
  const original = global.fetch; let loseResponse = true;
  t.after(() => { global.fetch = original; client.disconnect(); });
  global.fetch = async (url, options) => {
    const response = await original(url, options);
    if (loseResponse && options?.method === 'POST' && String(url).endsWith('/tasks')) { loseResponse = false; await response.text(); throw new TypeError('Connection dropped after commit'); }
    return response;
  };
  await assert.rejects(client.command('createTask', { title: 'One accepted task' }), /uncertain/);
  const result = await client.command('createTask', { title: 'One accepted task' });
  assert.equal(result.title, 'One accepted task');
  assert.equal(client.state().snapshot.tasks.filter((x) => x.title === result.title).length, 1);
});
