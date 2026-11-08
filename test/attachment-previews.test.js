'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { mkdtemp } = require('./helpers/tmp');
const attachments = require('../core/attachments');
const { Hub, MemorySecrets } = require('../core');
function fixture(t) { const root = mkdtemp('attachment-previews'); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6mVQAAAAASUVORK5CYII=', 'base64');
function add(root, name, bytes) { return attachments.add(root, [{ name, base64: bytes.toString('base64') }])[0]; }
function stored(root, id) { const metadata = path.join(root, 'attachments', id + '.json'); return { metadata, file: path.join(root, 'attachments', JSON.parse(fs.readFileSync(metadata)).file) }; }

test('text previews read only a 256 KiB prefix asynchronously, without whole-file or base64 transport', async t => {
  const root = fixture(t), input = Buffer.from('日本語 Ω\n'.repeat(300000)), file = add(root, 'large.md', input), target = stored(root, file.id).file;
  const open = fs.promises.open, readSync = fs.readFileSync; let read = 0, closed = 0;
  t.after(() => { fs.promises.open = open; fs.readFileSync = readSync; });
  fs.readFileSync = function(filename, ...args) { assert.notEqual(filename, target, 'preview must not synchronously read the body'); return readSync.call(this, filename, ...args); };
  fs.promises.open = async function(filename, ...args) {
    const handle = await open.call(this, filename, ...args); if (filename !== target) return handle;
    return { stat: () => handle.stat(), async read(...args) { assert.ok(args[0].length <= 256 * 1024); const value = await handle.read(...args); read += value.bytesRead; return value; }, async close() { closed++; await handle.close(); } };
  };
  const preview = await attachments.preview(root, file.id, { preview: 'text' });
  assert.equal(read, 256 * 1024); assert.equal(closed, 1); assert.equal(preview.content, input.subarray(0, 256 * 1024).toString('utf8')); assert.equal(preview.truncated, true); assert.equal(preview.size, input.length);
  for (const key of ['base64', 'bytes', 'path', 'file']) assert.equal(preview[key], undefined);
});

test('image previews support exact binary desktop and base64 webview bodies independently of the upload name', async t => {
  const root = fixture(t), file = add(root, 'image.txt', png); assert.equal(file.mime, 'image/png');
  const binary = await attachments.preview(root, file.id, { preview: 'image', bytesOnly: true }); assert.ok(binary.bytes instanceof ArrayBuffer); assert.equal(binary.bytes.byteLength, png.length); assert.deepEqual(Buffer.from(binary.bytes), png); assert.equal(binary.base64, undefined);
  const encoded = await attachments.preview(root, file.id, { preview: 'image' }); assert.equal(encoded.base64, png.toString('base64')); assert.equal(encoded.bytes, undefined);
  assert.equal(binary.path, undefined); assert.equal(binary.file, undefined); assert.equal(attachments.read(root, file.id).base64, encoded.base64);
  await assert.rejects(attachments.preview(root, file.id, { preview: 'text' }), /supported preview/);
});

test('small and empty text previews keep exact content and short image reads never expose unwritten backing storage', async t => {
  const root = fixture(t), text = add(root, 'small.txt', Buffer.from('Exact 日本語\r\n'));
  assert.equal((await attachments.preview(root, text.id, { preview: 'text' })).content, 'Exact 日本語\r\n'); assert.equal((await attachments.preview(root, text.id, { preview: 'text' })).truncated, false);
  fs.writeFileSync(stored(root, text.id).file, ''); const empty = await attachments.preview(root, text.id, { preview: 'text' }); assert.equal(empty.content, ''); assert.equal(empty.truncated, false);
  const image = add(root, 'small.png', png), target = stored(root, image.id).file, open = fs.promises.open; let closed = 0;
  t.after(() => { fs.promises.open = open; });
  fs.promises.open = async function(filename, ...args) { const handle = await open.call(this, filename, ...args); if (filename !== target) return handle; return { async stat() { const stat = await handle.stat(); return { ...stat, size: 4000, isFile: () => true }; }, read: (...args) => handle.read(...args), async close() { closed++; await handle.close(); } }; };
  const preview = await attachments.preview(root, image.id, { preview: 'image', bytesOnly: true }); assert.equal(preview.bytes.byteLength, png.length); assert.deepEqual(Buffer.from(preview.bytes), png); assert.equal(closed, 1);
});

test('pending or failed preview IO leaves other reads responsive and closes its descriptor', async t => {
  const root = fixture(t), a = add(root, 'slow.txt', Buffer.from('slow')), b = add(root, 'fast.txt', Buffer.from('fast')), target = stored(root, a.id).file, open = fs.promises.open;
  let enter, release, closed = 0; const started = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  t.after(() => { fs.promises.open = open; release(); });
  fs.promises.open = async function(filename, ...args) { const handle = await open.call(this, filename, ...args); if (filename !== target) return handle; return { stat: () => handle.stat(), async read() { enter(); await gate; throw Error('fixture preview read failed'); }, async close() { closed++; await handle.close(); } }; };
  const slow = assert.rejects(attachments.preview(root, a.id, { preview: 'text' }), /fixture preview read failed/); await started;
  assert.equal((await attachments.preview(root, b.id, { preview: 'text' })).content, 'fast'); assert.equal(closed, 0); release(); await slow; assert.equal(closed, 1);
});

test('preview bounds reject malformed metadata, unsupported bodies, links, oversize files and invalid options', async t => {
  const root = fixture(t), image = add(root, 'image.png', png), text = add(root, 'note.txt', Buffer.from('notes')), opaque = add(root, 'data.bin', Buffer.from([0, 1, 2]));
  await assert.rejects(attachments.preview(root, '../private', { preview: 'image' }), /Invalid attachment/);
  await assert.rejects(attachments.preview(root, image.id, { preview: 'all' }), /Invalid attachment preview/);
  await assert.rejects(attachments.preview(root, text.id, { preview: 'image' }), /supported preview/); await assert.rejects(attachments.preview(root, opaque.id, { preview: 'text' }), /supported preview/);
  const target = stored(root, image.id); fs.writeFileSync(target.file, Buffer.alloc(16 * 1024 ** 2 + 1)); await assert.rejects(attachments.preview(root, image.id, { preview: 'image' }), /unavailable/);
  fs.rmSync(target.file); fs.symlinkSync(stored(root, text.id).file, target.file); await assert.rejects(attachments.preview(root, image.id, { preview: 'image' }), /unavailable/);
  fs.writeFileSync(target.metadata, ' '.repeat(4097)); await assert.rejects(attachments.preview(root, image.id, { preview: 'image' }), /metadata/);
});

test('Hub forwards bounded previews without paths while default provider reads preserve exact image bodies', async t => {
  const root = fixture(t), hub = new Hub({ dataDir: root, secrets: new MemorySecrets() }); t.after(() => { hub.fileWatches.close(); hub.store.close(); });
  const [file] = hub.addAttachments([{ name: 'image.png', base64: png.toString('base64') }]);
  const original = hub.readAttachment(file.id); assert.equal(original.base64, png.toString('base64')); assert.equal(original.path, undefined);
  const preview = await hub.readAttachment(file.id, { preview: 'image', bytesOnly: true }); assert.deepEqual(Buffer.from(preview.bytes), png); assert.equal(preview.path, undefined);
  await assert.rejects(hub.readAttachment(file.id, { preview: '' }), /Invalid attachment preview/);
});
