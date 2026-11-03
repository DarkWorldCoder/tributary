'use strict';
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const net = require('node:net');
const { createLanHost } = require('../server/lan-host');
const tmp = () => mkTmp('host');
const freePort = async () => { const s = net.createServer(); await new Promise((r) => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise((r) => s.close(r)); return port; };
const fixture = (t, dir = tmp()) => {
  let advertised = 0, stopped = 0;
  const host = createLanHost({ dir, addresses: () => ['127.0.0.1'], advertise: () => { advertised++; return () => stopped++; } });
  t.after(async () => { await host.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { host, dir, counts: () => ({ advertised, stopped }) };
};

test('LAN hosting is on demand, serialized, private and persistent across restarts', async (t) => {
  const { host, dir, counts } = fixture(t);
  assert.equal(host.state().running, false); assert.equal(fs.readdirSync(dir).length, 0);
  const port = await freePort();
  const [a, b] = await Promise.all([host.start({ port }), host.start({ port })]);
  assert.deepEqual(a, b); assert.equal(a.running, true); assert.equal(counts().advertised, 1);
  const { CollaborationClient } = await import('../core/collaboration/client.mjs');
  const { pinnedFetch } = await import('../core/collaboration/pinned-fetch.mjs');
  const owner = new CollaborationClient(() => {}, pinnedFetch); t.after(() => owner.disconnect());
  let key;
  await host.connectOwner(async (input) => { key = input.accessKey; await owner.connect(input); });
  assert.equal(owner.state().user.admin, true);
  assert.ok(!JSON.stringify(a).includes(key)); assert.ok(!JSON.stringify(owner.state()).includes(key));
  assert.equal(fs.statSync(path.join(dir, 'owner-access-key.txt')).mode & 0o777, 0o600);
  const project = await owner.command('createProject', { name: 'Shared work' });
  const invitation = await owner.command('invite', { name: 'Teammate' });
  const guest = new CollaborationClient(() => {}, pinnedFetch); t.after(() => guest.disconnect());
  await guest.connect({ endpoint: a.endpoint, fingerprint: a.fingerprint, accessKey: invitation.accessKey });
  await owner.command('createTask', { title: 'Verify hosting from the app' });
  await guest.refresh(project.id);
  assert.equal(guest.state().snapshot.tasks.length, 1);
  owner.disconnect(); guest.disconnect();
  await Promise.all([host.stop(), host.stop()]); assert.equal(host.state().running, false); assert.equal(counts().stopped, 1);
  const again = await host.start({ port }); assert.equal(again.fingerprint, a.fingerprint);
  await host.connectOwner((input) => owner.connect(input));
  assert.equal(owner.state().snapshot.project.id, project.id); assert.equal(owner.state().snapshot.tasks.length, 1);
  owner.disconnect(); await host.stop();
  await assert.rejects(pinnedFetch(a.endpoint + '/api/me', {}, a.fingerprint));
});

test('LAN host rejects invalid networks and ports without creating data', async (t) => {
  const { host, dir } = fixture(t);
  await assert.rejects(host.start({ address: '192.168.5.4' }), /network address/);
  for (const port of [0, -1, 65536, '4318', NaN]) await assert.rejects(host.start({ port }), /port/);
  assert.equal(fs.readdirSync(dir).length, 0);
  const empty = createLanHost({ dir, addresses: () => [] });
  await assert.rejects(empty.start(), /Wi-Fi or Ethernet/);
});

test('LAN port conflicts are actionable and can be retried without changing the owner', async (t) => {
  const { host, dir } = fixture(t);
  const s = net.createServer(); t.after(() => new Promise((r) => s.close(() => r()))); await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const port = s.address().port;
  await assert.rejects(host.start({ port }), /already in use/);
  assert.equal(host.state().running, false);
  const key = fs.readFileSync(path.join(dir, 'owner-access-key.txt'), 'utf8');
  await new Promise((r) => s.close(r));
  await host.start({ port });
  assert.equal(fs.readFileSync(path.join(dir, 'owner-access-key.txt'), 'utf8'), key);
});

test('stopping during startup waits for cleanup and does not leave a listener', async (t) => {
  const { host, counts } = fixture(t); const port = await freePort();
  await Promise.all([host.start({ port }), host.stop()]);
  assert.equal(host.state().running, false); assert.deepEqual(counts(), { advertised: 1, stopped: 1 });
});

test('missing owner credentials never silently replace access to an existing room', async (t) => {
  const { host, dir } = fixture(t); const port = await freePort();
  await host.start({ port }); await host.stop();
  fs.unlinkSync(path.join(dir, 'owner-access-key.txt'));
  await assert.rejects(host.start({ port }), /owner key is missing/);
  assert.equal(host.state().running, false);
});
