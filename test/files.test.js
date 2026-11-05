'use strict';
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readDirectory } = require('../core/files');
const { Hub, MemorySecrets } = require('../core');

test('folder browser includes empty, ignored and deeply nested directories without Git', async (t) => {
  const root = mkTmp('files'); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'empty')); fs.mkdirSync(path.join(root, 'dist')); fs.writeFileSync(path.join(root, 'dist', 'page.html'), '<h1>Preview</h1>');
  fs.writeFileSync(path.join(root, '.notes'), 'hidden'); fs.writeFileSync(path.join(root, '.gitignore'), 'dist/\n');
  const deep = Array.from({ length: 10 }, (_, i) => `level${i}`).join('/'); fs.mkdirSync(path.join(root, deep), { recursive: true }); fs.writeFileSync(path.join(root, deep, 'note.md'), '# Deep note');
  const page = await readDirectory(root);
  assert.ok(page.entries.some((e) => e.name === 'empty' && e.directory)); assert.ok(page.entries.some((e) => e.name === 'dist'));
  assert.ok(!page.entries.some((e) => e.name.startsWith('.')));
  assert.ok((await readDirectory(root, '', { showHidden: true })).entries.some((e) => e.name === '.notes'));
  assert.deepEqual((await readDirectory(root, 'empty')).entries, []);
  assert.equal((await readDirectory(root, deep)).entries[0].rel, `${deep}/note.md`);
});

test('folder listing paginates deterministically and rejects invalid pages and escapes', async (t) => {
  const root = mkTmp('pages'); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let i = 0; i < 405; i++) fs.writeFileSync(path.join(root, `file-${String(i).padStart(3, '0')}.txt`), '');
  const first = await readDirectory(root); const second = await readDirectory(root, '', { offset: first.next }); const last = await readDirectory(root, '', { offset: second.next });
  assert.equal(first.next, 200); assert.equal(second.next, 400); assert.equal(last.next, null);
  assert.equal(new Set([...first.entries, ...second.entries, ...last.entries].map((e) => e.rel)).size, 405);
  await assert.rejects(readDirectory(root, '..'), /outside project/i);
  await assert.rejects(readDirectory(root, '', { limit: 999999 }), /Invalid folder page/);
  await assert.rejects(readDirectory(root, '', { offset: -1 }), /Invalid folder page/);
});

test('host file APIs refuse symlink escapes for directory reads, file reads and saves', async (t) => {
  const base = mkTmp('links'); const root = path.join(base, 'project'); const outside = path.join(base, 'outside');
  fs.mkdirSync(root); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'secret.txt'), 'private');
  fs.symlinkSync(outside, path.join(root, 'escape'), 'dir');
  const hub = new Hub({ dataDir: path.join(base, 'data'), secrets: new MemorySecrets() }); hub.addProject(root);
  t.after(() => { hub.store.save(true); fs.rmSync(base, { recursive: true, force: true }); });
  await assert.rejects(hub.readDirectory(root, 'escape'), /outside project/i);
  await assert.rejects(hub.readFile(root, 'escape/secret.txt'), /outside project/i);
  await assert.rejects(hub.writeFile(root, 'escape/secret.txt', 'overwrite'), /outside project/i);
  await assert.rejects(hub.writeFile(root, 'escape/new.txt', 'new content'), /outside project/i);
  assert.equal(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'private');
  assert.equal(fs.existsSync(path.join(outside, 'new.txt')), false);
});

test('image reads keep complete bounded payloads separate from text and binary fallbacks', async (t) => {
  const root = mkTmp('images');
  const hub = new Hub({ dataDir: path.join(root, 'data'), secrets: new MemorySecrets() }); hub.addProject(root);
  t.after(() => { hub.store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const large = Buffer.alloc(2 * 1024 * 1024, 127); large.set([137, 80, 78, 71, 13, 10, 26, 10]);
  fs.writeFileSync(path.join(root, 'photo.PNG'), large);
  const image = await hub.readFile(root, 'photo.PNG');
  assert.equal(image.binary, true); assert.equal(image.truncated, false); assert.equal(image.content, '');
  assert.deepEqual(Buffer.from(image.base64, 'base64'), large);
  fs.writeFileSync(path.join(root, 'oversized.webp'), Buffer.alloc(16 * 1024 * 1024 + 1));
  const oversized = await hub.readFile(root, 'oversized.webp');
  assert.equal(oversized.truncated, true); assert.equal(oversized.base64, undefined); assert.equal(oversized.content, '');
  fs.writeFileSync(path.join(root, 'large.txt'), 'x'.repeat(2 * 1024 * 1024));
  const text = await hub.readFile(root, 'large.txt');
  assert.equal(text.content.length, 1024 * 1024); assert.equal(text.truncated, true); assert.equal(text.base64, undefined);
  fs.writeFileSync(path.join(root, 'vector.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"/>');
  const vector = await hub.readFile(root, 'vector.svg'); assert.equal(vector.binary, false); assert.match(vector.content, /<svg/);
});

test('explorer creates files and folders without overwrites or symlink escapes', async (t) => {
  const base = mkTmp('create-entry'); const root = path.join(base, 'project'); const outside = path.join(base, 'outside'); fs.mkdirSync(root); fs.mkdirSync(outside);
  const hub = new Hub({ dataDir: path.join(base, 'data'), secrets: new MemorySecrets() }); hub.addProject(root);
  t.after(() => { hub.store.close(); fs.rmSync(base, { recursive: true, force: true }); });
  assert.deepEqual(await hub.createEntry(root, 'src', 'folder'), { rel: 'src', kind: 'folder' });
  assert.equal((await hub.createEntry(root, 'src/.env', 'file')).rel, 'src/.env');
  fs.writeFileSync(path.join(root, 'src/.env'), 'PRIVATE=value');
  await assert.rejects(hub.createEntry(root, 'src/.env', 'file'), /EEXIST/);
  assert.equal(fs.readFileSync(path.join(root, 'src/.env'), 'utf8'), 'PRIVATE=value');
  await assert.rejects(hub.createEntry(root, 'src', 'folder'), /EEXIST/);
  for (const name of ['../escape', '.git/config', '', 'src/../escape']) await assert.rejects(hub.createEntry(root, name, 'file'));
  await assert.rejects(hub.createEntry(outside, 'file', 'file'), /Unknown project/);
  fs.symlinkSync(outside, path.join(root, 'escape'), 'dir');
  await assert.rejects(hub.createEntry(root, 'escape/new', 'file'), /outside project/i);
  await assert.rejects(hub.createEntry(root, 'escape/new', 'folder'), /outside project/i);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('project file search finds ignored env files without reading contents or following links', async (t) => {
  const root = mkTmp('search-files'); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { findFiles } = require('../core/files');
  fs.writeFileSync(path.join(root, '.env'), 'PRIVATE=value'); fs.mkdirSync(path.join(root, '.config')); fs.writeFileSync(path.join(root, '.config/env.json'), '{}');
  fs.mkdirSync(path.join(root, 'node_modules')); fs.writeFileSync(path.join(root, 'node_modules/env.js'), '');
  fs.symlinkSync(root, path.join(root, 'loop'), 'dir');
  assert.deepEqual(await findFiles(root, 'env'), ['.config/env.json', '.env']);
  assert.deepEqual(await findFiles(root, 'env', { showHidden: false }), []);
  assert.deepEqual(await findFiles(root, ''), []);
});
