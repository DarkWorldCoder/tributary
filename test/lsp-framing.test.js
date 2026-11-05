'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { createLspFramer, MAX_BODY_BYTES, MAX_HEADER_BYTES } = require('../core/lsp-framing');
const frame = (body, extra = '') => { body = Buffer.isBuffer(body) ? body : Buffer.from(body); return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n${extra}\r\n`), body]); };
function fixture(options) {
  const frames = []; const errors = []; const reader = createLspFramer((body) => frames.push(body.toString('utf8')), (error) => errors.push(error), options);
  return { reader, frames, errors };
}

test('LSP bytes preserve UTF-8 content across every header, delimiter and character boundary', () => {
  const bodies = [JSON.stringify({ text: 'नमस्ते 🙂 café' }), JSON.stringify({ id: 3, result: ['Go', 'Rust'] })];
  const bytes = Buffer.concat([frame(bodies[0], 'Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n'), frame(bodies[1])]);
  for (const size of [1, 2, 3, 7, 29, bytes.length]) {
    const { reader, frames, errors } = fixture();
    for (let offset = 0; offset < bytes.length; offset += size) reader.push(bytes.subarray(offset, offset + size));
    reader.end(); assert.deepEqual(frames, bodies); assert.equal(errors.length, 0); assert.equal(reader.stats().disposed, true);
  }
});

test('coalesced valid frames are limited individually, including an exact-limit body', () => {
  const { reader, frames, errors } = fixture({ maxBodyBytes: 64 });
  const bodies = ['x'.repeat(64), ...Array.from({ length: 40 }, (_, index) => `frame ${index}`)];
  reader.push(Buffer.concat(bodies.map((body) => frame(body)))); reader.end();
  assert.deepEqual(frames, bodies); assert.equal(errors.length, 0);
});

test('a declared maximum-size response allocates only when its bytes actually arrive', () => {
  const { reader, errors } = fixture(); reader.push(Buffer.from(`Content-Length: ${MAX_BODY_BYTES}\r\n\r\n`));
  assert.equal(reader.stats().bodyCapacity, 0); assert.equal(reader.stats().expectedBodyBytes, MAX_BODY_BYTES);
  reader.push(Buffer.from('x')); assert.equal(reader.stats().bodyBytes, 1); assert.equal(reader.stats().bodyCapacity, 4096);
  reader.dispose(); assert.equal(reader.stats().bodyBackingBytes, 0); assert.equal(errors.length, 0);
});

test('small configured limits retain only dedicated header and body allocations', () => {
  const { reader } = fixture({ maxHeaderBytes: 64, maxBodyBytes: 128 });
  reader.push(Buffer.from('Content-L'));
  assert.equal(reader.stats().headerBackingBytes, 64);
  reader.push(Buffer.from('ength: 128\r\n\r\nx'));
  assert.equal(reader.stats().bodyBackingBytes, 128);
  reader.dispose(); assert.equal(reader.stats().headerBackingBytes, 0); assert.equal(reader.stats().bodyBackingBytes, 0);
});

test('fragmented large bodies grow within their limit and preserve their complete contents', () => {
  const body = JSON.stringify({ text: '🙂reference'.repeat(30000) }); const bytes = frame(body); const { reader, frames, errors } = fixture();
  for (let offset = 0; offset < bytes.length; offset += 113) {
    reader.push(bytes.subarray(offset, offset + 113)); const state = reader.stats();
    if (state.bodyBytes) { assert.ok(state.bodyCapacity >= state.bodyBytes); assert.ok(state.bodyCapacity <= Math.max(4096, state.bodyBytes * 2)); assert.ok(state.bodyCapacity <= Buffer.byteLength(body)); }
  }
  reader.end(); assert.deepEqual(frames, [body]); assert.equal(errors.length, 0);
});

test('invalid or oversized length declarations fail once and release retained input', () => {
  for (const header of ['Other: 1', 'Content-Length:', 'Content-Length: -1', 'Content-Length: 1.5', 'Content-Length: 1junk', 'Content-Length: NaN', 'Content-Length: 1\r\nContent-Length: 2', 'Content-Length: 1\r\nContent-Length: -2', 'Content-Length: 1\r\ncontent-length:', 'Content-Length: 99999999999999999999', `Content-Length: ${MAX_BODY_BYTES + 1}`]) {
    const { reader, frames, errors } = fixture(); reader.push(Buffer.from(header + '\r\n\r\n'));
    reader.push(frame('ignored')); reader.end(); reader.dispose(); assert.equal(errors.length, 1, header); assert.deepEqual(frames, []);
    assert.equal(reader.stats().bodyBackingBytes, 0); assert.equal(reader.stats().headerBackingBytes, 0);
  }
  const { reader, errors } = fixture(); reader.push(Buffer.from([0x43,0x6f,0x6e,0x74,0x65,0x6e,0x74,0x2d,0x4c,0x65,0x6e,0x67,0x74,0x68,0x3a,0x20,0xb1,0x0d,0x0a,0x0d,0x0a]));
  assert.equal(errors.length, 1, 'non-ASCII header bytes must not be masked into valid digits');
});

test('header limits apply to a complete header and to an unfinished stream', () => {
  for (const fragmented of [false, true]) {
    const { reader, errors } = fixture({ maxHeaderBytes: 64 });
    const input = Buffer.from('x'.repeat(65) + '\r\n\r\n');
    if (fragmented) for (const byte of input) reader.push(Buffer.from([byte])); else reader.push(input);
    assert.equal(errors.length, 1); assert.equal(reader.stats().headerBackingBytes, 0);
  }
  const { reader, frames, errors } = fixture({ maxHeaderBytes: MAX_HEADER_BYTES });
  const prefix = 'Content-Length: 1\r\nX: '; const bytes = Buffer.from(prefix + 'x'.repeat(MAX_HEADER_BYTES - prefix.length - 4) + '\r\n\r\ny');
  reader.push(bytes); reader.end(); assert.deepEqual(frames, ['y']); assert.equal(errors.length, 0);
});

test('end distinguishes an idle stream from truncated header/body and disposal ignores late chunks', () => {
  for (const prefix of ['Content-Len', 'Content-Length: 20\r\n\r\npartial']) {
    const { reader, frames, errors } = fixture(); reader.push(Buffer.from(prefix)); reader.end(); reader.push(frame('late'));
    assert.equal(errors.length, 1); assert.deepEqual(frames, []); assert.equal(reader.stats().bodyBackingBytes, 0); assert.equal(reader.stats().headerBackingBytes, 0);
  }
  const { reader, frames, errors } = fixture(); reader.push(frame('')); reader.end(); reader.end();
  assert.deepEqual(frames, ['']); assert.equal(errors.length, 0);
});

test('a tiny incomplete tail does not pin the backing allocation of a large completed batch', () => {
  let received = 0; const reader = createLspFramer(() => received++, assert.fail);
  const completed = frame('x'.repeat(1024 * 1024)); const pending = Buffer.from(`Content-Length: ${MAX_BODY_BYTES}\r\n\r\nx`);
  const transport = Buffer.concat([completed, pending]); reader.push(transport);
  assert.equal(received, 1); assert.equal(reader.stats().bodyBytes, 1); assert.equal(reader.stats().bodyBackingBytes, 4096);
  reader.dispose(); assert.equal(reader.stats().bodyBackingBytes, 0);
});

test('callback disposal or failure stops later frames and releases the reader', () => {
  const frames = []; let reader; reader = createLspFramer((body) => { frames.push(body.toString()); reader.dispose(); }, assert.fail);
  reader.push(Buffer.concat([frame('one'), frame('two')])); assert.deepEqual(frames, ['one']);
  const failure = new Error('Consumer failed'); const broken = createLspFramer(() => { throw failure; }, assert.fail);
  assert.throws(() => broken.push(frame('one')), (error) => error === failure); assert.equal(broken.stats().disposed, true);
});

test('many partial-reader disposal cycles release both header and body buffers', () => {
  for (let index = 0; index < 100; index++) {
    const { reader, errors } = fixture(); reader.push(Buffer.from('Content-L')); reader.push(Buffer.from('ength: 9000\r\n\r\npartial'));
    reader.dispose(); reader.dispose(); reader.push(frame('late')); reader.end();
    assert.equal(reader.stats().headerBackingBytes, 0); assert.equal(reader.stats().bodyBackingBytes, 0); assert.equal(errors.length, 0);
  }
});
