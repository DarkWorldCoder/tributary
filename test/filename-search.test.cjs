'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { scanFileNames, FileSearches } = require('../core/filename-search');
const tick = () => new Promise(setImmediate);
const entry = (name, kind = 'file') => ({ name, isDirectory: () => kind === 'dir', isFile: () => kind === 'file', isSymbolicLink: () => kind === 'link' });
function fake(count, override) {
  let reads = 0, closed = 0;
  const io = { realpath: async p => p, opendir: async (_p, options) => {
    assert.equal(options.bufferSize, 256);
    return { read(callback) { const at = reads++; setImmediate(() => callback(null, at < count ? override?.(at) || entry(`file-${String(count - at).padStart(6, '0')}.ts`) : null)); }, async close() { closed++; } };
  } };
  return { io, reads: () => reads, closed: () => closed };
}
test('filename discovery visits past 20,000 entries and retains the exact sorted prefix', async () => {
  const source = fake(21001);
  const result = await scanFileNames('/project', 'file-', { limit: 7 }, source.io);
  assert.equal(result.visited, 21001); assert.equal(result.total, 21001); assert.equal(result.limited, true);
  assert.deepEqual(result.files, Array.from({ length: 7 }, (_, i) => `file-${String(i + 1).padStart(6, '0')}.ts`));
  assert.equal(source.closed(), 1);
  const rare = fake(21001, at => entry(at === 21000 ? 'rare-final.ts' : `item-${at}.ts`));
  assert.deepEqual((await scanFileNames('/project', 'rare', {}, rare.io)).files, ['rare-final.ts']);
});
test('cancellation releases the directory without walking the rest of a wide folder', async () => {
  const controller = new AbortController(), source = fake(100000, at => { if (at === 300) controller.abort(); return entry(`item-${at}.ts`); });
  await assert.rejects(scanFileNames('/project', 'item', { signal: controller.signal }, source.io), { name: 'AbortError' });
  assert.ok(source.reads() < 303); assert.equal(source.closed(), 1);
  const before = fake(1); controller.abort(); await assert.rejects(scanFileNames('/project', 'item', { signal: controller.signal }, before.io)); assert.equal(before.reads(), 0);
});
test('read failure and cancellation during open close each acquired directory exactly once', async () => {
  let closed = 0;
  const io = { realpath: async p => p, opendir: async () => ({ read() { throw Error('read failure'); }, async close() { closed++; } }) };
  await assert.rejects(scanFileNames('/project', 'x', {}, io), /read failure/); assert.equal(closed, 1);
  const controller = new AbortController(); closed = 0;
  io.opendir = async () => { controller.abort(); return { read() { assert.fail('No read after cancellation'); }, async close() { closed++; } }; };
  await assert.rejects(scanFileNames('/project', 'x', { signal: controller.signal }, io), { name: 'AbortError' }); assert.equal(closed, 1);
});
test('real nested and hidden files remain searchable without contents or symlink traversal', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tributary-file-scan-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const deep = Array(25).fill('nested').join('/'); await fs.mkdir(path.join(root, deep), { recursive: true });
  await fs.writeFile(path.join(root, deep, 'needle.ts'), ''); await fs.writeFile(path.join(root, '.needle'), '');
  await fs.mkdir(path.join(root, 'node_modules')); await fs.writeFile(path.join(root, 'node_modules/needle.ts'), '');
  await fs.symlink(root, path.join(root, 'loop'), 'dir');
  const expected = ['.needle', deep + '/needle.ts']; assert.deepEqual((await scanFileNames(root, 'needle')).files, expected);
  assert.deepEqual((await scanFileNames(root, 'needle', { showHidden: false })).files, expected.slice(1));
  assert.deepEqual((await scanFileNames(root, ' ')).files, []);
});
test('name-only optimization preserves full-path, parent-name and Unicode lowercase matches', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tributary-file-matching-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const names = ['Nested/Source.ts', 'Nested/other.GO', 'Nested/ΩΣ/ΟΣ.txt', 'Nested/İndex/TİTLE.rs', 'Nested/.env', 'alpha/𝄞-😀.zig', 'alpha/\uE000.rs', 'alpha/名前.ts', 'alpha/name[1].ts', 'alpha/space name.py', 'Nested/endsΣ/ΓΣ.txt'];
  for (const name of names) { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), ''); }
  // Use the filesystem's returned spelling (including any normalization), then
  // compare against the simple full-path predicate independently of the walker.
  const actual = (await fs.readdir(root, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
  for (const query of ['source', 'Nested', 'nested/', 'ED/SO', 'other.go', 'ος', 'οσ', 'Σ/Γ', 'i\u0307', 'i\u0307ndex/ti\u0307', '名前', '😀', '\uE000', '.env', '[1]', 'space name', '  SOURCE  ', 'does-not-exist']) {
    const expected = actual.filter(name => name.toLowerCase().includes(query.trim().toLowerCase())).sort();
    const result = await scanFileNames(root, query, { limit: 3 });
    assert.deepEqual(result.files, expected.slice(0, 3), query); assert.equal(result.total, expected.length, query); assert.equal(result.limited, expected.length > 3, query);
  }
});
test('missing nested directories are reported; root errors and excessive depth are explicit', async () => {
  let closed = 0;
  const io = { realpath: async p => p, opendir: async p => {
    if (p !== '/root') throw Object.assign(Error('denied'), { code: 'EACCES' });
    let sent = false; return { read(cb) { setImmediate(() => { cb(null, sent ? null : (sent = true, entry('private', 'dir'))); }); }, async close() { closed++; } };
  } };
  const result = await scanFileNames('/root', 'x', {}, io); assert.equal(result.unreadable, 1); assert.equal(closed, 1);
  await assert.rejects(scanFileNames('/missing', 'x', {}, io), /denied/);
  closed = 0; io.opendir = async () => { let sent = false; return { read(cb) { setImmediate(() => cb(null, sent ? null : (sent = true, entry('next', 'dir')))); }, async close() { closed++; } }; };
  await assert.rejects(scanFileNames('/root', 'x', {}, io), /128 folder levels/); assert.equal(closed, 129);
});
test('search admission bounds running work and discards superseded queued tasks', async () => {
  const started = [], gates = [];
  const manager = new FileSearches((root, query, { signal }) => new Promise((resolve, reject) => {
    started.push(query); gates.push(() => resolve({ files: [query] })); signal.addEventListener('abort', () => reject(Object.assign(Error('cancelled'), { name: 'AbortError' })), { once: true });
  }));
  const a = manager.acquire('/a'), b = manager.acquire('/b'), c = manager.acquire('/c');
  const first = manager.search(a, 'first').catch(error => error.name), second = manager.search(b, 'second').catch(error => error.name);
  await tick(); const queued = manager.search(c, 'obsolete').catch(error => error.name), latest = manager.search(c, 'latest');
  assert.equal(await queued, 'AbortError'); assert.equal(manager.active, 2); assert.equal(manager.queue.length, 1);
  manager.close(a); assert.equal(await first, 'AbortError'); await tick(); assert.deepEqual(started, ['first', 'second', 'latest']);
  gates[2](); assert.deepEqual(await latest, { files: ['latest'] });
  manager.stopAll(); assert.equal(await second, 'AbortError'); await tick(); assert.equal(manager.owners.size, 0); assert.equal(manager.queue.length, 0); assert.equal(manager.active, 0);
  await assert.rejects(manager.search(a, 'closed'), /closed/);
});
test('closing one owner never cancels another; late results cannot revive released owners', async () => {
  const gates = [];
  const manager = new FileSearches((_root, _query, { signal }) => new Promise(resolve => gates.push({ signal, resolve })));
  const a = manager.acquire('/same'), b = manager.acquire('/same');
  const first = manager.search(a, 'a').catch(error => error.name), second = manager.search(b, 'b'); await tick();
  manager.close(a); assert.equal(gates[0].signal.aborted, true); assert.equal(gates[1].signal.aborted, false);
  gates[0].resolve({ files: ['late'] }); gates[1].resolve({ files: ['current'] });
  assert.equal(await first, 'AbortError'); assert.deepEqual(await second, { files: ['current'] }); manager.stopAll(); await tick(); assert.equal(manager.active, 0);
  const owners = Array.from({ length: 128 }, () => manager.acquire('/x')); assert.throws(() => manager.acquire('/x'), /Too many/); manager.stopAll(); assert.equal(manager.owners.size, 0); assert.equal(owners.length, 128);
});
test('UI helper releases late acquisition and cancels active work without leaking leases', async () => {
  const { fileSearch } = await import('../ui/src/lib/file-search.mjs');
  let acquired, finish; const calls = [];
  const hub = { call(method, ...args) { calls.push([method, ...args]); if (method === 'fileSearchAcquire') return new Promise(resolve => acquired = resolve); if (method === 'fileSearch') return new Promise(resolve => finish = resolve); return Promise.resolve(); } };
  const late = fileSearch(hub, '/x', 'old'); late.cancel(); acquired('old-owner'); await assert.rejects(late.result, /cancelled/);
  assert.deepEqual(calls.map(call => call[0]), ['fileSearchAcquire', 'fileSearchClose']);
  calls.length = 0; const current = fileSearch(hub, '/x', 'new'); acquired('new-owner'); await tick(); current.cancel(); finish({ files: [] }); await current.result;
  assert.deepEqual(calls.map(call => call[0]), ['fileSearchAcquire', 'fileSearch', 'fileSearchClose']);
});
test('removing a workspace folder cancels its producer while preserving a different project', async t => {
  const { Hub, MemorySecrets } = require('../core');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tributary-file-owner-'));
  const project = path.join(root, 'project'), folder = path.join(root, 'folder'); await fs.mkdir(project); await fs.mkdir(folder);
  const hub = new Hub({ dataDir: path.join(root, 'data'), secrets: new MemorySecrets() }); hub.addProject(project); hub.setProjectFolders(project, [folder]);
  t.after(() => { hub._fileSearches?.stopAll(); hub.fileWatches.close(); hub.store.close(); return fs.rm(root, { recursive: true, force: true }); });
  await fs.writeFile(path.join(project, 'source.ts'), '');
  assert.deepEqual(await hub.findFiles(project, 'source'), ['source.ts']);
  assert.equal(hub._fileSearches.owners.size, 0, 'compatibility calls release their transient lease');
  await assert.rejects(hub.findFiles(project, 'source', { limit: 0 }), /Invalid/); assert.equal(hub._fileSearches.owners.size, 0);
  hub._fileSearches = new FileSearches((_dir, _query, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(Error('cancelled'), { name: 'AbortError' })), { once: true })));
  const a = hub.fileSearchAcquire(project), b = hub.fileSearchAcquire(folder);
  const pending = hub.fileSearch(b, 'source'); await tick(); hub.setProjectFolders(project, []);
  assert.deepEqual(await pending, { cancelled: true }); assert.equal(hub._fileSearches.owners.has(b), false); assert.equal(hub._fileSearches.owners.has(a), true);
  assert.throws(() => hub.fileSearchAcquire(folder), /Unknown project/);
  const main = hub.fileSearch(a, 'source'); await tick(); hub.removeProject(project); assert.deepEqual(await main, { cancelled: true }); assert.equal(hub._fileSearches.owners.size, 0);
});
