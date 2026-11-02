'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readDirectory } = require('../core/files');
const { Hub, MemorySecrets } = require('../core');

test('folder browser includes empty, ignored and deeply nested directories without Git', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-files-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-pages-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let i = 0; i < 405; i++) fs.writeFileSync(path.join(root, `file-${String(i).padStart(3, '0')}.txt`), '');
  const first = await readDirectory(root); const second = await readDirectory(root, '', { offset: first.next }); const last = await readDirectory(root, '', { offset: second.next });
  assert.equal(first.next, 200); assert.equal(second.next, 400); assert.equal(last.next, null);
  assert.equal(new Set([...first.entries, ...second.entries, ...last.entries].map((e) => e.rel)).size, 405);
  await assert.rejects(readDirectory(root, '..'), /outside project/i);
  await assert.rejects(readDirectory(root, '', { limit: 999999 }), /Invalid folder page/);
  await assert.rejects(readDirectory(root, '', { offset: -1 }), /Invalid folder page/);
});

test('host file APIs refuse symlink escapes for directory reads, file reads and saves', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-links-')); const root = path.join(base, 'project'); const outside = path.join(base, 'outside');
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
