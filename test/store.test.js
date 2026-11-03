'use strict';
process.env.TRIBUTARY_CHECKPOINT_DIR = process.env.TRIBUTARY_CHECKPOINT_DIR || require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'tributary-ckpt-'));
// Shared history: threads and settings live in SQLite so the desktop app and the CLI can use one data folder at once.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Hub } = require('../core/hub');
const { MemorySecrets } = require('../core/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-store-'));
const open = (dataDir) => new Hub({ dataDir, secrets: new MemorySecrets(), home: dataDir });
const reply = (text) => ({ id: `m-${Math.random().toString(36).slice(2)}`, role: 'assistant', agent: 'claude', text, tools: [], files: [], notices: [], ok: true, ts: Date.now() });

test('the first start moves hub.json into the database once and keeps the old file as a backup', () => {
  const dataDir = tmp(); const proj = tmp();
  const legacy = {
    version: 1, settings: { mode: 'full', agent: 'codex' },
    projects: [{ path: proj, name: 'demo', trusted: true, addedAt: 1 }],
    gateways: [{ id: 'g1', name: 'Local', protocol: 'openai', baseUrl: 'http://localhost:4000/v1', model: '', hasKey: false }],
    notifications: [{ id: 'n2', ts: 20, read: false, kind: 'done', title: 'newer' }, { id: 'n1', ts: 10, read: true, kind: 'failed', title: 'older' }],
    threads: [{ id: 't1', project: proj, title: 'Old thread', createdAt: 5, updatedAt: 6, agentSessions: { claude: 's1' }, lastAgent: 'claude', seenAt: 7,
      messages: [{ id: 'u1', role: 'user', text: 'hi', target: 'claude' }, { id: 'a1', role: 'assistant', agent: 'claude', text: 'hello', ok: true, files: [], tools: [], notices: [] }] }],
  };
  fs.writeFileSync(path.join(dataDir, 'hub.json'), JSON.stringify(legacy));
  const hub = open(dataDir);
  assert.deepStrictEqual(hub.store.data.settings, legacy.settings);
  assert.deepStrictEqual(hub.store.data.projects, legacy.projects);
  assert.deepStrictEqual(hub.store.data.gateways, legacy.gateways);
  assert.deepStrictEqual(hub.notifications().map((n) => n.id), ['n2', 'n1'], 'newest first');
  assert.deepStrictEqual(hub.thread('t1'), legacy.threads[0]);
  assert.ok(!fs.existsSync(path.join(dataDir, 'hub.json')), 'hub.json is no longer read or written');
  assert.ok(fs.existsSync(path.join(dataDir, 'hub.json.migrated')), 'the original is kept as a backup');
  hub.store.close();

  // A stray hub.json (an old build, a restored backup) is not imported a second time.
  fs.writeFileSync(path.join(dataDir, 'hub.json'), JSON.stringify({ ...legacy, threads: [] }));
  const again = open(dataDir);
  assert.strictEqual(again.thread('t1').title, 'Old thread');
  assert.ok(fs.existsSync(path.join(dataDir, 'hub.json')));
  again.store.close();
});

test('two hubs on one data folder see each other’s changes and never overwrite them', async () => {
  const dataDir = tmp(); const proj = tmp();
  const desktop = open(dataDir); const cli = open(dataDir);
  const t = desktop.createThread(proj, 'Shared');
  desktop.store.save(true);

  // The other process picks up the new thread and project.
  const events = [];
  for (const name of ['threads', 'message', 'state']) desktop.on(name, (d) => events.push([name, d]));
  cli.store.sync();
  assert.strictEqual(cli.thread(t.id).title, 'Shared');
  assert.ok(cli.project(proj));

  // Both append to the same thread at the same time: both turns survive.
  desktop.thread(t.id).messages.push(reply('from the desktop'));
  cli.thread(t.id).messages.push(reply('from the CLI'));
  cli.thread(t.id).agentSessions = { codex: 'cx-1' };
  desktop.store.save(true); cli.store.save(true);
  desktop.store.sync(); cli.store.sync();
  for (const h of [desktop, cli]) assert.deepStrictEqual(h.thread(t.id).messages.map((m) => m.text).sort(), ['from the CLI', 'from the desktop']);
  assert.deepStrictEqual(desktop.thread(t.id).agentSessions, { codex: 'cx-1' });
  assert.ok(events.some(([n, d]) => n === 'message' && d.threadId === t.id && d.message.text === 'from the CLI'), 'the open thread updates live');
  assert.ok(events.some(([n, d]) => n === 'threads' && d === proj), 'the thread list refreshes');

  // Unrelated edits in each process are kept: a gateway here, a setting and a notification there.
  await cli.saveGateway({ name: 'From the CLI', protocol: 'openai', baseUrl: 'http://localhost:1/v1' });
  desktop.setSettings({ mode: 'read' });
  desktop.notify({ kind: 'done', title: 'Desktop note' });
  cli.store.save(true); desktop.store.save(true);
  desktop.store.sync(); cli.store.sync();
  for (const h of [desktop, cli]) {
    assert.deepStrictEqual(h.store.data.gateways.map((g) => g.name), ['From the CLI']);
    assert.strictEqual(h.store.data.settings.mode, 'read');
    assert.deepStrictEqual(h.notifications().map((n) => n.title), ['Desktop note']);
  }
  assert.ok(events.some(([n]) => n === 'state'), 'settings and gateways refresh the window');

  // A deleted thread disappears from the other process too, and a restart reads the merged result.
  const gone = cli.createThread(proj, 'Short-lived'); cli.store.save(true); desktop.store.sync();
  assert.ok(desktop.thread(gone.id));
  desktop.deleteThread(gone.id); desktop.store.save(true); cli.store.sync();
  assert.strictEqual(cli.thread(gone.id), null);
  const restarted = open(dataDir);
  assert.deepStrictEqual(restarted.threads(proj).map((x) => x.title), ['Shared']);
  assert.strictEqual(restarted.thread(t.id).messages.length, 2);
  for (const h of [desktop, cli, restarted]) h.store.close();
});

test('a second process writing through the CLI code path is merged, not clobbered', async () => {
  const { spawnSync } = require('child_process');
  const dataDir = tmp(); const proj = tmp();
  const desktop = open(dataDir);
  const t = desktop.createThread(proj, 'Busy'); desktop.store.save(true);
  const script = `const { Hub } = require(${JSON.stringify(path.join(__dirname, '..', 'core', 'hub'))}); const { MemorySecrets } = require(${JSON.stringify(path.join(__dirname, '..', 'core', 'store'))});
    const hub = new Hub({ dataDir: process.argv[1], secrets: new MemorySecrets() });
    for (let i = 0; i < 20; i++) { hub.thread(process.argv[2]).messages.push({ id: 'child-' + i, role: 'user', text: 'child ' + i, target: 'claude' }); hub.store.save(true); }`;
  for (let i = 0; i < 20; i++) desktop.thread(t.id).messages.push({ id: `parent-${i}`, role: 'user', text: `parent ${i}`, target: 'claude' });
  const child = spawnSync(process.execPath, ['-e', script, dataDir, t.id], { encoding: 'utf8' });
  assert.strictEqual(child.status, 0, child.stderr);
  desktop.store.save(true); desktop.store.sync();
  assert.strictEqual(desktop.thread(t.id).messages.length, 40);
  const fresh = open(dataDir);
  assert.strictEqual(fresh.thread(t.id).messages.length, 40);
  desktop.store.close(); fresh.store.close();
});

test('the database keeps API keys out, like hub.json did, and only this user can read it', { skip: process.platform === 'win32' }, async () => {
  const dataDir = tmp();
  const hub = open(dataDir);
  await hub.saveGateway({ name: 'Keyed', protocol: 'openai', baseUrl: 'http://localhost:1/v1', apiKey: 'sk-never-in-the-db' });
  hub.store.save(true);
  const files = fs.readdirSync(dataDir).filter((f) => f.startsWith('tributary.db'));
  assert.ok(files.includes('tributary.db'));
  for (const f of files) assert.ok(!fs.readFileSync(path.join(dataDir, f)).includes('sk-never-in-the-db'), f);
  assert.strictEqual(fs.statSync(path.join(dataDir, 'tributary.db')).mode & 0o077, 0);
  hub.store.close();
});

test('a save for one thread writes that thread without re-serializing the rest of the history', () => {
  const dataDir = tmp(); const proj = tmp();
  const hub = open(dataDir);
  const busy = hub.createThread(proj, 'Busy'); const other = hub.createThread(proj, 'Other');
  let reads = 0;
  hub.thread(other.id).messages.push({ id: 'old', role: 'user', text: 'x', target: 'claude', toJSON() { reads++; return { id: 'old', role: 'user', text: 'x', target: 'claude' }; } });
  hub.store.save(true);
  const before = reads;
  hub.thread(busy.id).messages.push(reply('streamed'));
  hub.store.save(true, busy.id);
  assert.strictEqual(reads, before, 'other threads are not serialized while one streams');
  hub.store.save(false, busy.id); hub.store.save(); hub.store.save(true);
  assert.ok(reads > before, 'a save without a thread checks everything');
  const fresh = open(dataDir);
  assert.deepStrictEqual(fresh.thread(busy.id).messages.map((m) => m.text), ['streamed']);
  assert.strictEqual(fresh.thread(other.id).messages.length, 1, 'skipped threads are kept, not deleted');
  for (const h of [hub, fresh]) h.store.close();
});

test('the save snapshot keeps a fingerprint per row, not a second copy of the history', () => {
  const dataDir = tmp(); const proj = tmp();
  const hub = open(dataDir);
  const t = hub.createThread(proj, 'Long');
  for (let i = 0; i < 20; i++) hub.thread(t.id).messages.push(reply('x'.repeat(5000)));
  hub.store.save(true);
  for (const v of hub.store.snap.values()) assert.ok(!('json' in v) && String(v.h).length <= 44, JSON.stringify(v).slice(0, 80));
  // Change detection still works on fingerprints: an edit is written, an unchanged row is not.
  hub.thread(t.id).messages[3].text = 'edited';
  hub.store.save(true);
  const fresh = open(dataDir);
  assert.strictEqual(fresh.thread(t.id).messages[3].text, 'edited');
  for (const h of [hub, fresh]) h.store.close();
});

test('messages load when a conversation is first used; the thread list does not need them', () => {
  const dataDir = tmp(); const proj = tmp();
  const writer = open(dataDir);
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const t = writer.createThread(proj, `Thread ${i}`); ids.push(t.id);
    t.messages.push({ id: `u${i}`, role: 'user', text: 'do it', target: 'claude' });
    t.messages.push({ ...reply('done'), ok: i !== 1, error: i === 1 ? 'boom' : null, files: i === 0 ? [{ rel: 'a.js', path: `${proj}/a.js` }] : [] });
  }
  writer.store.save(true);

  const hub = open(dataDir);
  const loaded = () => ids.filter((id) => hub.store.isLoaded(hub.store.data.threads.find((t) => t.id === id)));
  assert.deepStrictEqual(loaded(), [], 'nothing is parsed at startup');
  const list = Object.fromEntries(hub.threads(proj).map((t) => [t.title, [t.count, t.status]]));
  assert.deepStrictEqual(list, { 'Thread 0': [2, 'review'], 'Thread 1': [2, 'failed'], 'Thread 2': [2, 'done'] });
  assert.deepStrictEqual(loaded(), [], 'counts and badges come from the database');
  assert.strictEqual(hub.thread(ids[2]).messages[1].text, 'done');
  assert.deepStrictEqual(loaded(), [ids[2]]);

  // Another process adds to a thread this one has not loaded: the list updates, and loading shows it.
  writer.thread(ids[0]).messages.push(reply('more')); writer.store.save(true);
  hub.store.sync();
  assert.strictEqual(hub.threads(proj).find((t) => t.id === ids[0]).count, 3);
  assert.deepStrictEqual(hub.thread(ids[0]).messages.map((m) => m.text), ['do it', 'done', 'more']);

  // Edits to a loaded thread save; deleting a never-loaded thread removes its messages too.
  hub.thread(ids[2]).title = 'Renamed'; hub.deleteThread(ids[1]); hub.store.save(true);
  const fresh = open(dataDir);
  assert.deepStrictEqual(fresh.threads(proj).map((t) => t.title).sort(), ['Renamed', 'Thread 0']);
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(dataDir, 'tributary.db'));
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM records WHERE coll = ? AND data IS NOT NULL').get(`m:${ids[1]}`).n, 0);
  db.close();
  for (const h of [writer, hub, fresh]) h.store.close();
});
