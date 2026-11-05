'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const { mkdtemp } = require('./helpers/tmp'); const { ExtensionCache, summary } = require('../core/extension-cache');
const deferred = () => { let resolve; const promise = new Promise((fn) => { resolve = fn; }); return { promise, resolve }; };
function pack(id = 'fixture.studio', version = '1.0.0') {
  return { id, name: 'Fixture Studio', publisher: id.split('.')[0], version, hasRuntime: false,
    themes: [0, 1].map((i) => ({ id: `${id}:theme:${i}`, label: `Theme ${i}`, dark: i === 0, colors: { 'editor.background': version === '1.0.0' ? '#112233' : '#334455' }, tokenColors: [{ scope: 'keyword', foreground: '#ff7766' }] })),
    iconThemes: [0, 1].map((i) => ({ id: `${id}:icons:${i}`, label: `Icons ${i}`, definitions: { js: { image: 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><text>${version}/${i}</text></svg>`).toString('base64') } }, fonts: [], associations: { fileExtensions: { js: 'js' } }, light: {}, highContrast: {} })) };
}
function fixture() { const dir = mkdtemp('appearance-cache'); return { dir, cache: new ExtensionCache(dir) }; }
function legacy(cache, value) { fs.mkdirSync(cache.dir, { recursive: true }); fs.writeFileSync(cache.filename(value.id), JSON.stringify(value)); }

test('catalog and selected-theme reads never parse unrelated icon or theme payloads', async () => {
  const { cache } = fixture(); const value = pack(); await cache.install(value);
  cache.withDatabase((db) => { db.prepare('UPDATE contributions SET data=? WHERE kind=?').run('{invalid icon json', 'iconThemes'); db.prepare('UPDATE contributions SET data=? WHERE id=?').run('{invalid other theme', value.themes[1].id); });
  assert.deepEqual(await cache.list(), [summary(value)]);
  assert.deepEqual(await cache.appearance(value.themes[0].id, ''), { theme: value.themes[0], icons: null });
  await assert.rejects(cache.appearance('', value.iconThemes[0].id), SyntaxError);
});

test('full explicit reads and selected contributions preserve exact theme/icon payloads and ordering', async () => {
  const { cache } = fixture(); const value = pack(); await cache.install(value);
  assert.deepEqual(await cache.read(value.id), value);
  assert.deepEqual(await cache.appearance(value.themes[1].id, value.iconThemes[0].id), { theme: value.themes[1], icons: value.iconThemes[0] });
  const another = pack('other.icons'); await cache.install(another);
  assert.deepEqual(await cache.appearance(value.themes[0].id, another.iconThemes[1].id), { theme: value.themes[0], icons: another.iconThemes[1] });
});

test('legacy migration is lossless, targeted for appearance, and keeps a recoverable backup', async () => {
  const { cache } = fixture(); const value = pack(); const unused = pack('unused.icons'); legacy(cache, value); legacy(cache, unused);
  const read = cache.legacyRead.bind(cache); const reads = []; cache.legacyRead = async (id) => { reads.push(id); return read(id); };
  assert.deepEqual(await cache.appearance(value.themes[0].id, value.iconThemes[1].id), { theme: value.themes[0], icons: value.iconThemes[1] });
  assert.deepEqual(reads, [value.id]); assert.equal(fs.existsSync(`${cache.filename(value.id)}.migrated`), true); assert.equal(fs.existsSync(cache.filename(unused.id)), true);
  assert.deepEqual(await cache.read(value.id), value); assert.equal((await cache.list()).length, 2);
  const hotReads = reads.length; assert.deepEqual(await new ExtensionCache(cache.dir).list(), [summary(value), summary(unused)].sort((a, b) => a.id.localeCompare(b.id))); await cache.list(); assert.equal(reads.length, hotReads);
});

test('failed cache upgrades keep legacy appearance available and retry without archiving unreadable sources', async () => {
  const { cache } = fixture(); const value = pack(); legacy(cache, value); const persist = cache.persist;
  cache.persist = () => { throw new Error('disk full'); };
  assert.deepEqual(await cache.list(), [summary(value)]); assert.deepEqual(await cache.appearance(value.themes[0].id, value.iconThemes[1].id), { theme: value.themes[0], icons: value.iconThemes[1] });
  assert.equal(fs.existsSync(cache.filename(value.id)), true); assert.equal(fs.existsSync(`${cache.filename(value.id)}.migrated`), false);
  cache.persist = persist; assert.deepEqual(await cache.read(value.id), value); assert.equal(fs.existsSync(`${cache.filename(value.id)}.migrated`), true);
  fs.writeFileSync(cache.filename('invalid.cache'), '{bad json'); assert.equal((await cache.list()).length, 1); assert.equal(fs.existsSync(cache.filename('invalid.cache')), true);
});

test('failed updates roll back metadata and all contributions, preserving the installed version', async () => {
  const { cache } = fixture(); const value = pack(); await cache.install(value); const update = pack(value.id, '2.0.0'); update.iconThemes[1].id = 'another.pack:icons:1';
  await assert.rejects(cache.install(update), /identity/); assert.deepEqual(await cache.read(value.id), value);
  const hugeHeader = pack(value.id, '2.0.0'); hugeHeader.name = 'x'.repeat(300000); await assert.rejects(cache.install(hugeHeader), /catalog entry/); assert.deepEqual(await cache.list(), [summary(value)]);
});

test('a read transaction sees a consistent generation while another connection replaces the pack', async () => {
  const { cache } = fixture(); const old = pack(); const update = pack(old.id, '2.0.0'); await cache.install(old);
  cache.withDatabase((db) => {
    const get = db.prepare('SELECT data FROM contributions WHERE pack=? AND id=?'); assert.deepEqual(JSON.parse(get.get(old.id, old.themes[0].id).data), old.themes[0]);
    cache.persist(update);
    assert.deepEqual(JSON.parse(get.get(old.id, old.iconThemes[0].id).data), old.iconThemes[0]);
  }, true);
  assert.deepEqual(await cache.appearance(update.themes[0].id, update.iconThemes[0].id), { theme: update.themes[0], icons: update.iconThemes[0] });
});

test('an in-flight legacy migration cannot resurrect a removed pack or overwrite a newer install', async () => {
  for (const action of ['remove', 'update']) {
    const { cache } = fixture(); const value = pack(); legacy(cache, value); const entered = deferred(); const finish = deferred(); const read = cache.legacyRead.bind(cache);
    cache.legacyRead = async (id) => { const pack = await read(id); entered.resolve(); await finish.promise; return pack; };
    const migration = cache.ensurePack(value.id); await entered.promise;
    if (action === 'remove') await cache.remove(value.id); else await cache.install(pack(value.id, '2.0.0'));
    finish.resolve(); await migration; assert.equal(cache.migrations.size, 0);
    if (action === 'remove') { assert.deepEqual(await new ExtensionCache(cache.dir).list(), []); await assert.rejects(cache.read(value.id), /not found/); }
    else assert.equal((await cache.read(value.id)).version, '2.0.0');
  }
});

test('removal drops contributions and backup, and an explicit reinstall replaces the tombstone', async () => {
  const { cache } = fixture(); const value = pack(); legacy(cache, value); await cache.list(); await cache.remove(value.id);
  assert.equal(fs.existsSync(`${cache.filename(value.id)}.migrated`), false); assert.deepEqual(await cache.list(), []); assert.deepEqual(await cache.appearance(value.themes[0].id, value.iconThemes[0].id), { theme: null, icons: null });
  assert.equal(cache.withDatabase((db) => db.prepare('SELECT COUNT(*) n FROM contributions').get().n), 0);
  await cache.install(value); assert.deepEqual(await cache.read(value.id), value);
});

test('no selection does not open storage; the older-Node fallback reads sequentially and loads a shared pack once', async () => {
  const dir = path.join(mkdtemp('appearance-empty'), 'not-created'); const empty = new ExtensionCache(dir); assert.deepEqual(await empty.appearance('', ''), { theme: null, icons: null }); assert.equal(fs.existsSync(dir), false);
  const cache = new ExtensionCache(mkdtemp('appearance-json'), { database: null }); const value = pack(); await cache.install(value); await cache.install(pack('other.icons'));
  const read = cache.legacyRead.bind(cache); let calls = 0, active = 0, peak = 0;
  cache.legacyRead = async (id) => { calls++; active++; peak = Math.max(peak, active); try { return await read(id); } finally { active--; } };
  assert.equal((await cache.list()).length, 2); assert.equal(peak, 1); calls = 0;
  assert.deepEqual(await cache.appearance(value.themes[0].id, value.iconThemes[0].id), { theme: value.themes[0], icons: value.iconThemes[0] }); assert.equal(calls, 1);
  await cache.remove(value.id); assert.equal((await cache.list()).length, 1);
});

test('concurrent legacy upgrades serialize payload reads and recover after a failed job', async () => {
  const { cache } = fixture(); const first = pack('fixture.one'); const second = pack('fixture.two'); legacy(cache, first); legacy(cache, second);
  const read = cache.legacyRead.bind(cache); let active = 0; let maximum = 0;
  cache.legacyRead = async (id) => { active++; maximum = Math.max(maximum, active); try { await new Promise((resolve) => setTimeout(resolve, 5)); return await read(id); } finally { active--; } };
  const [a, b] = await Promise.all([cache.read(first.id), cache.read(second.id)]);
  assert.equal(maximum, 1); assert.deepEqual(a, first); assert.deepEqual(b, second); assert.equal(cache.migrations.size, 0);
  fs.writeFileSync(cache.filename('fixture.bad'), '{broken'); await assert.rejects(cache.read('fixture.bad'));
  assert.deepEqual(await cache.read(first.id), first);
});
