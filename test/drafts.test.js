'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const drafts = require('../core/drafts');
const { Hub, MemorySecrets } = require('../core');
const lib = import('../ui/src/lib/drafts.mjs');

test('drafts are private, replaced whole, separate per key and removed by saving nothing', (t) => {
  const data = mkTmp('drafts'); t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  assert.equal(drafts.read(data, 'composer'), null);
  drafts.save(data, 'composer', 'half a thought');
  drafts.save(data, 'files:/p', { active: 'a.js', tabs: [{ rel: 'a.js', text: 'x' }] });
  assert.equal(drafts.read(data, 'composer'), 'half a thought');
  assert.deepEqual(drafts.read(data, 'files:/p'), { active: 'a.js', tabs: [{ rel: 'a.js', text: 'x' }] });
  drafts.save(data, 'composer', 'a whole thought');
  assert.equal(drafts.read(data, 'composer'), 'a whole thought');
  const dir = path.join(data, 'drafts'); const files = fs.readdirSync(dir);
  assert.equal(files.length, 2); assert.ok(files.every((f) => /^[a-f0-9]{40}\.json$/.test(f)), 'no leftover temporary files');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    for (const f of files) assert.equal(fs.statSync(path.join(dir, f)).mode & 0o777, 0o600);
  }
  drafts.save(data, 'composer', null);
  assert.equal(drafts.read(data, 'composer'), null); assert.equal(fs.readdirSync(dir).length, 1);
  assert.throws(() => drafts.save(data, '', 'x'), /Invalid draft/); assert.throws(() => drafts.read(data, 'a\0b'), /Invalid draft/);
  assert.throws(() => drafts.save(data, 'big', 'x'.repeat(drafts.MAX_DRAFT)), /larger than 16 MB/);
  assert.equal(drafts.read(data, 'big'), null);
});

test('old drafts expire and the folder stays within its limits', (t) => {
  const data = mkTmp('drafts-prune'); t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  drafts.save(data, 'old', 'x', Date.now() - drafts.MAX_AGE - 1000);
  assert.equal(drafts.read(data, 'old'), null, 'an expired draft is not restored');
  assert.equal(fs.readdirSync(path.join(data, 'drafts')).length, 0, 'and is removed');
  const dir = drafts.directory(data); const base = Date.now() / 1000 - 3600;
  const fileOf = (key) => path.join(dir, crypto.createHash('sha256').update(key).digest('hex').slice(0, 40) + '.json');
  for (let i = 0; i < drafts.MAX_DRAFTS + 2; i++) { drafts.save(data, `k${i}`, i); fs.utimesSync(fileOf(`k${i}`), base + i, base + i); }
  fs.writeFileSync(path.join(dir, 'abc.json.1.ff.tmp'), '{'); fs.utimesSync(path.join(dir, 'abc.json.1.ff.tmp'), base, base);
  fs.writeFileSync(path.join(dir, 'fresh.tmp'), '{');
  assert.equal(drafts.prune(data), 2);
  assert.equal(drafts.read(data, 'k0'), null); assert.equal(drafts.read(data, 'k1'), null); assert.equal(drafts.read(data, `k${drafts.MAX_DRAFTS + 1}`), drafts.MAX_DRAFTS + 1);
  assert.ok(!fs.existsSync(path.join(dir, 'abc.json.1.ff.tmp')), 'a stale temporary file is removed');
  assert.ok(fs.existsSync(path.join(dir, 'fresh.tmp')), 'one another process may still be writing is kept');
});

test('a restarted host gets the drafts back, and a file changed meanwhile is compared, not overwritten', async (t) => {
  const root = mkTmp('drafts-hub'); const data = path.join(root, '.data');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'app.js'), 'const a = 1;\nconst b = 2;\n');
  const first = new Hub({ dataDir: data, secrets: new MemorySecrets() }); first.addProject(root);
  const opened = await first.readFile(root, 'app.js');
  first.saveDraft('composer', 'fix the login');
  first.saveDraft(`files:${root}`, { active: 'app.js', tabs: [{ rel: 'app.js', pinned: true, mode: 'edit', wrap: false, text: 'const a = 1;\nconst b = 3;\n', base: opened.content, mtime: opened.mtime }] });
  first.store.close();

  // An agent changes the file before the window comes back.
  fs.writeFileSync(path.join(root, 'app.js'), 'const a = 10;\nconst b = 2;\n'); fs.utimesSync(path.join(root, 'app.js'), new Date(), new Date(Date.now() + 5000));
  const second = new Hub({ dataDir: data, secrets: new MemorySecrets() }); t.after(() => second.store.close());
  assert.equal(second.draft('composer'), 'fix the login');
  const saved = second.draft(`files:${root}`); const tab = saved.tabs[0];
  assert.equal(tab.text, 'const a = 1;\nconst b = 3;\n');
  await assert.rejects(second.writeFile(root, 'app.js', tab.text, tab.mtime), /changed on disk/, 'the draft cannot silently replace the newer file');
  const diff = await second.compareDraft(root, 'app.js', tab.text);
  assert.match(diff, /^--- app\.js \(on disk\)\n\+\+\+ app\.js \(unsaved\)\n@@ /);
  assert.match(diff, /^-const a = 10;$/m); assert.match(diff, /^\+const a = 1;$/m); assert.match(diff, /^-const b = 2;$/m); assert.match(diff, /^\+const b = 3;$/m);
  assert.equal(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), 'const a = 10;\nconst b = 2;\n', 'comparing writes nothing');
  assert.equal(await second.compareDraft(root, 'app.js', 'const a = 10;\nconst b = 2;\n'), '');
  assert.match(await second.compareDraft(root, 'gone.js', 'new\n'), /^\+new$/m, 'a deleted file compares as empty');
  await assert.rejects(second.compareDraft(root, '../outside.js', 'x'), /outside project/i);
  await assert.rejects(second.compareDraft(path.join(root, 'nope'), 'app.js', 'x'), /Unknown project/);
  assert.deepEqual(fs.readdirSync(path.join(data, 'drafts')).filter((f) => f.startsWith('compare-')), [], 'comparison scratch files are removed');
});

test('the Files tab keeps unsaved text with the version it was based on, and reads saved sessions defensively', async () => {
  const { fileSession, savedFileSession } = await lib;
  const doc = (rel, extra = {}) => ({ rel, pinned: true, mode: 'edit', wrap: false, dirty: false, binary: false, truncated: false, text: 'disk', content: 'disk', mtime: 5, ...extra });
  assert.equal(fileSession([], null), null);
  const session = fileSession([doc('a.js'), doc('b.md', { dirty: true, text: 'mine', mode: 'preview', wrap: true }), doc('big.log', { dirty: true, truncated: true, text: 'cut' })], 'b.md');
  assert.deepEqual(session, { active: 'b.md', tabs: [
    { rel: 'a.js', pinned: true, mode: 'edit', wrap: false },
    { rel: 'b.md', pinned: true, mode: 'preview', wrap: true, text: 'mine', base: 'disk', mtime: 5 },
    { rel: 'big.log', pinned: true, mode: 'edit', wrap: false },
  ] });
  assert.deepEqual(savedFileSession(JSON.parse(JSON.stringify(session))), session);
  const odd = savedFileSession({ active: '../x', tabs: [null, { rel: '/etc/passwd' }, { rel: 'a/../../b' }, { rel: 'C:\\x' }, { rel: 'ok.js', mode: 'weird', text: 'same', base: 'same', mtime: 1 }, { rel: 'ok.js' }, { rel: 'c.js', text: 'x', base: 'y' }] });
  assert.deepEqual(odd, { active: 'ok.js', tabs: [{ rel: 'ok.js', pinned: false, mode: 'edit', wrap: false }, { rel: 'c.js', pinned: false, mode: 'edit', wrap: false }] });
  assert.deepEqual(savedFileSession(null), { tabs: [], active: null }); assert.deepEqual(savedFileSession({ tabs: 'x' }), { tabs: [], active: null });
});

test('draft writes wait for a pause in typing, and anything pending is written on close', async () => {
  const { draftWriter } = await lib;
  const calls = []; const hub = { call: async (...args) => { calls.push(args); } };
  const writer = draftWriter(hub, 'composer', { delay: 20 });
  writer.set('h'); writer.set('he'); writer.set('hello');
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(calls, [['saveDraft', 'composer', 'hello']]);
  writer.flush(); await null; assert.equal(calls.length, 1, 'nothing pending, nothing written');
  writer.set(null); writer.dispose(); await null;
  assert.deepEqual(calls[1], ['saveDraft', 'composer', null], 'closing writes what was pending at once');
  const errors = []; const failing = draftWriter({ call: async () => { throw new Error('too large'); } }, 'files:/p', { delay: 1, onError: (e) => errors.push(e.message) });
  failing.set({ tabs: [] }); failing.flush(); await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(errors, ['too large']);
});

test('slow draft saves keep one active write and only the latest pending snapshot', async () => {
  const { draftWriter } = await lib; const calls = [], gates = [];
  const writer = draftWriter({ call: (...args) => { calls.push(args); return new Promise(resolve => gates.push(resolve)); } }, 'files:/p', { delay: 60000 });
  const first = { tabs: [{ rel: 'a.ts', text: 'first', base: 'disk' }] };
  writer.set(first); writer.flush(); await null;
  for (let i = 0; i < 400; i++) { writer.set({ tabs: [{ rel: 'a.ts', text: 'revision ' + i, base: 'disk' }] }); writer.flush(); }
  await null; assert.equal(calls.length, 1, 'typing does not create concurrent IPC snapshots');
  gates.shift()(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2); assert.equal(calls[1][2].tabs[0].text, 'revision 399');
  assert.equal(first.tabs[0].text, 'first');
  gates.shift()(); await new Promise(resolve => setImmediate(resolve));
  writer.flush(); assert.equal(calls.length, 2); writer.dispose();
});

test('closing submits the final draft immediately behind an active save, and is idempotent', async () => {
  const { draftWriter } = await lib; const calls = [], gates = [];
  const writer = draftWriter({ call: (...args) => { calls.push(args); return new Promise(resolve => gates.push(resolve)); } }, 'composer', { delay: 60000 });
  writer.set('old'); writer.flush(); writer.set('new'); writer.flush(); writer.set(null);
  writer.dispose(); writer.dispose(); writer.set('must not resurrect'); writer.flush();
  assert.deepEqual(calls, [['saveDraft', 'composer', 'old'], ['saveDraft', 'composer', null]]);
  for (const release of gates) release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2, 'late acknowledgements cannot submit old pending text');
});

test('draft failures release admission and report errors while a newer ready snapshot still saves', async () => {
  const { draftWriter } = await lib; const calls = [], errors = []; let reject;
  const writer = draftWriter({ call: (...args) => { calls.push(args); if (calls.length === 1) return new Promise((_, fail) => { reject = fail; }); if (calls.length === 2) throw Error('sync failure'); } }, 'composer', { delay: 60000, onError: error => errors.push(error.message) });
  writer.set('one'); writer.flush(); writer.set('two'); writer.flush(); await null;
  reject(Error('async failure')); await new Promise(resolve => setImmediate(resolve));
  writer.set('three'); writer.flush(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.map(call => call[2]), ['one', 'two', 'three']);
  assert.deepEqual(errors, ['async failure', 'sync failure']); writer.dispose();
});

test('active acknowledgement does not bypass the newest typing debounce', async () => {
  const { draftWriter } = await lib; const calls = []; let release;
  const writer = draftWriter({ call: (...args) => { calls.push(args); return calls.length === 1 ? new Promise(resolve => { release = resolve; }) : undefined; } }, 'composer', { delay: 40 });
  writer.set('one'); writer.flush(); await null; writer.set('two'); release();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls.length, 1);
  await new Promise(resolve => setTimeout(resolve, 65)); assert.equal(calls.length, 2); assert.equal(calls[1][2], 'two'); writer.dispose();
});

test('reentrant draft updates are serialized and writers for different keys remain independent', async () => {
  const { draftWriter } = await lib; const calls = []; let one, two, release;
  const hub = { call(method, key, data) { calls.push([key, data]); if (data === 'first') { one.set('reentrant'); one.flush(); two.set('other'); two.flush(); return new Promise(resolve => { release = resolve; }); } } };
  one = draftWriter(hub, 'one', { delay: 60000 }); two = draftWriter(hub, 'two', { delay: 60000 });
  one.set('first'); one.flush(); await null;
  assert.deepEqual(calls, [['one', 'first'], ['two', 'other']]);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [['one', 'first'], ['two', 'other'], ['one', 'reentrant']]); one.dispose(); two.dispose();
});

test('pagehide submits the final snapshot before returning; explicit disposal removes the owner', async (t) => {
  const { draftWriter } = await lib; const target = new EventTarget(); const calls = [], gates = [];
  const oldAdd = globalThis.addEventListener, oldRemove = globalThis.removeEventListener;
  globalThis.addEventListener = target.addEventListener.bind(target); globalThis.removeEventListener = target.removeEventListener.bind(target);
  t.after(() => { if (oldAdd) globalThis.addEventListener = oldAdd; else delete globalThis.addEventListener; if (oldRemove) globalThis.removeEventListener = oldRemove; else delete globalThis.removeEventListener; });
  const writer = draftWriter({ call: (...args) => { calls.push(args); return new Promise(resolve => gates.push(resolve)); } }, 'composer', { delay: 60000 });
  writer.set('old'); writer.flush(); writer.set('last before reload'); target.dispatchEvent(new Event('pagehide'));
  assert.deepEqual(calls.map(call => call[2]), ['old', 'last before reload']);
  writer.dispose(); target.dispatchEvent(new Event('pagehide')); for (const release of gates) release();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls.length, 2);
});


test('a cached document can keep saving after pagehide while waiting for both earlier acknowledgements', async (t) => {
  const { draftWriter } = await lib; const target = new EventTarget(), calls = [], gates = [];
  const oldAdd = globalThis.addEventListener, oldRemove = globalThis.removeEventListener;
  globalThis.addEventListener = target.addEventListener.bind(target); globalThis.removeEventListener = target.removeEventListener.bind(target);
  t.after(() => { if (oldAdd) globalThis.addEventListener = oldAdd; else delete globalThis.addEventListener; if (oldRemove) globalThis.removeEventListener = oldRemove; else delete globalThis.removeEventListener; });
  const writer = draftWriter({ call: (...args) => { calls.push(args); return new Promise(resolve => gates.push(resolve)); } }, 'composer', { delay: 60000 });
  writer.set('one'); writer.flush(); writer.set('before cached'); target.dispatchEvent(new Event('pagehide'));
  writer.set('after return'); writer.flush(); assert.equal(calls.length, 2);
  gates.shift()(); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls.length, 2);
  gates.shift()(); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(calls.map(call => call[2]), ['one', 'before cached', 'after return']);
  gates.shift()(); await new Promise(resolve => setImmediate(resolve)); writer.dispose();
  target.dispatchEvent(new Event('pagehide')); assert.equal(calls.length, 3);
});
