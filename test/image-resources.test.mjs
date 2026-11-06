import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageResources, imageBlobUrl } from '../ui/src/lib/image-resources.mjs';
const tick = () => new Promise(setImmediate);
const flush = async () => { for (let at = 0; at < 4; at++) await tick(); };
const file = { rel: 'image.png', content: '', base64: 'YWJj', size: 3, mtime: 1, binary: true, truncated: false };

test('shared preview ownership reads once and revokes only after its last visible owner', async () => {
  let reads = 0, notices = 0; const revoked = [];
  const resources = createImageResources(async () => { reads++; return file; }, async () => 'blob:one', url => revoked.push(url));
  const first = resources.acquire('/project', 'image.png', 1), second = resources.acquire('/project', 'image.png', 1);
  first.subscribe(() => notices++); first.release(); await flush();
  assert.equal(reads, 1); assert.equal(second.snapshot().src, 'blob:one'); assert.equal(notices, 0, 'released subscriptions cannot retain or notify closed consumers'); assert.deepEqual(revoked, []);
  second.release(); second.release(); assert.deepEqual(revoked, ['blob:one']); assert.deepEqual(resources.state(), { entries: 0, owners: 0, active: 0, queued: 0, urls: 0 });
});
test('closing a queued preview avoids reading it; read/decode admission remains bounded', async () => {
  const reads = [], gates = [];
  const resources = createImageResources((project, rel) => new Promise(resolve => { reads.push(rel); gates.push(() => resolve(file)); }), async (_file, rel) => 'blob:' + rel, () => {});
  const first = resources.acquire('/project', 'a.png', 1), second = resources.acquire('/project', 'b.png', 1), queued = resources.acquire('/project', 'c.png', 1);
  await tick(); assert.deepEqual(reads, ['a.png', 'b.png']); assert.equal(resources.state().active, 2); assert.equal(resources.state().queued, 1);
  queued.release(); first.release(); gates[0](); gates[1](); await flush(); second.release();
  assert.deepEqual(reads, ['a.png', 'b.png']); assert.equal(resources.state().entries, 0); assert.equal(resources.state().active, 0);
});
test('a late read cannot recreate released payloads or overwrite a new owner with the same key', async () => {
  const gates = [], created = [], revoked = [];
  const resources = createImageResources(() => new Promise(resolve => gates.push(resolve)), async data => { created.push(data.mtime); return 'blob:' + data.mtime; }, url => revoked.push(url));
  const old = resources.acquire('/project', 'image.png', 1); await tick(); old.release();
  const current = resources.acquire('/project', 'image.png', 1); await tick(); gates[0]({ ...file, mtime: 1 }); gates[1]({ ...file, mtime: 2 }); await flush();
  assert.deepEqual(created, [2]); assert.equal(current.snapshot().src, 'blob:2'); assert.equal(old.snapshot().src, null); current.release(); assert.deepEqual(revoked, ['blob:2']);
});
test('closing during asynchronous Blob creation revokes the late URL exactly once', async () => {
  let finish; const revoked = [];
  const resources = createImageResources(async () => file, () => new Promise(resolve => finish = resolve), url => revoked.push(url));
  const owner = resources.acquire('/project', 'image.png', 1); await tick(); owner.release(); finish('blob:late'); await flush();
  assert.deepEqual(revoked, ['blob:late']); assert.equal(resources.state().urls, 0); assert.equal(resources.state().active, 0);
});
test('failures can be retried and different revisions do not share stale bytes', async () => {
  let reads = 0; const revoked = [];
  const resources = createImageResources(async () => { if (++reads === 1) throw Error('Image disappeared'); return file; }, async () => 'blob:revision-' + reads, url => revoked.push(url));
  const failed = resources.acquire('/project', 'image.png', 1); await flush(); assert.equal(failed.snapshot().error, 'Image disappeared'); failed.release();
  const current = resources.acquire('/project', 'image.png', 2); await flush(); assert.equal(current.snapshot().src, 'blob:revision-2'); current.release(); assert.deepEqual(revoked, ['blob:revision-2']);
});
test('Blob decoding preserves bytes and MIME without creating a data URL', async t => {
  const bytes = Buffer.alloc(600000); for (let at = 0; at < bytes.length; at++) bytes[at] = at % 251;
  const original = Uint8Array.fromBase64; Uint8Array.fromBase64 = undefined; t.after(() => { Uint8Array.fromBase64 = original; });
  const url = await imageBlobUrl({ ...file, base64: bytes.toString('base64') }, 'image.png'); t.after(() => URL.revokeObjectURL(url)); assert.match(url, /^blob:/);
  const response = await fetch(url); assert.equal(response.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  let checks = 0; assert.equal(await imageBlobUrl({ ...file, base64: bytes.toString('base64') }, 'image.png', () => ++checks < 3), null);
  await assert.rejects(imageBlobUrl({ ...file, truncated: true }, 'image.png'), /limit/); await assert.rejects(imageBlobUrl({ ...file, base64: '????' }, 'image.png'));
  assert.equal(await imageBlobUrl(file, 'image.png', () => false), null);
});
test('SVG Blob resources preserve UTF-8 source while unsupported types fail explicitly', async t => {
  const content = '<svg xmlns="http://www.w3.org/2000/svg"><text>日本語 Ω</text></svg>';
  const url = await imageBlobUrl({ ...file, content }, 'vector.svg'); t.after(() => URL.revokeObjectURL(url)); assert.equal(await (await fetch(url)).text(), content);
  await assert.rejects(imageBlobUrl(file, 'main.ts'), /Unsupported/);
  await assert.rejects(imageBlobUrl({ ...file, content: 'é'.repeat(524289) }, 'large.svg'), /limit/, 'SVG size is UTF-8 bytes, not character count');
});

test('admission failure does not retain excess owners and queued disposal drains to zero', async () => {
  const gates = [], revoked = [];
  const manager = createImageResources(() => new Promise(resolve => gates.push(resolve)), async () => 'blob:owned', url => revoked.push(url));
  const owners = Array.from({ length: 128 }, (_, index) => manager.acquire('/project', `image-${index}.png`, 1));
  assert.throws(() => manager.acquire('/project', 'excess.png', 1), /Too many/); await tick();
  assert.equal(gates.length, 2); for (const owner of owners) owner.release();
  for (const resolve of gates) resolve(file); await flush();
  assert.deepEqual(manager.state(), { entries: 0, owners: 0, active: 0, queued: 0, urls: 0 }); assert.deepEqual(revoked, []);
});
