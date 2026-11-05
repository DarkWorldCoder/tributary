'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { once, EventEmitter } = require('node:events');
const { lines, streamTail } = require('../core/proc');

test('line framing preserves fragmented UTF-8, CRLF, empty lines and a final partial frame', async () => {
  const stream = new PassThrough(); const received = [];
  lines(stream, (line) => received.push(line));
  const text = 'one\r\n\nनमस्ते 🙂\nfinal';
  for (const byte of Buffer.from(text)) stream.write(Buffer.from([byte]));
  stream.end(); await once(stream, 'end');
  assert.deepEqual(received, ['one\r', '', 'नमस्ते 🙂', 'final']);
  assert.equal(stream.listenerCount('data'), 0);
});

test('fragmented long protocol lines are complete and are never silently truncated', async () => {
  const stream = new PassThrough(); const received = [];
  lines(stream, (line) => received.push(line));
  const expected = JSON.stringify({ text: '🙂alpha'.repeat(120000) });
  const bytes = Buffer.from(expected + '\nnext\n');
  for (let i = 0; i < bytes.length; i += 73) stream.write(bytes.subarray(i, i + 73));
  stream.end(); await once(stream, 'end');
  assert.deepEqual(received, [expected, 'next']);
});

test('line framing and diagnostic tails explicitly release listeners on close and disposal', () => {
  for (let i = 0; i < 100; i++) {
    const stream = new PassThrough(); const received = [];
    const stop = lines(stream, (line) => received.push(line));
    stream.write('unfinished protocol data');
    if (i % 2) stream.emit('close'); else stop();
    stop(); stream.emit('end');
    assert.deepEqual(received, []);
    for (const event of ['data', 'end', 'close']) assert.equal(stream.listenerCount(event), 0);
    const stopTail = streamTail(stream, 8, () => {});
    stopTail(); stopTail();
    for (const event of ['data', 'end', 'close']) assert.equal(stream.listenerCount(event), 0);
    stream.destroy();
  }
});

test('disposing from a frame callback stops remaining frames in that transport chunk', () => {
  const stream = new PassThrough(); const received = [];
  const stop = lines(stream, (line) => { received.push(line); stop(); });
  stream.write('one\ntwo\nunfinished'); stream.end();
  assert.deepEqual(received, ['one']); assert.equal(stream.listenerCount('data'), 0);
});

test('newline-free diagnostics remain bounded during the stream, not only after end', async () => {
  const stream = new PassThrough(); let tail = ''; let updates = 0;
  streamTail(stream, 2000, (value) => { tail = value; updates++; assert.ok(value.length <= 2000); });
  for (let i = 0; i < 128; i++) stream.write('x'.repeat(65536));
  assert.equal(updates, 128);
  assert.equal(tail, 'x'.repeat(2000));
  stream.end('\nfinal error 🙂'); await once(stream, 'end');
  assert.ok(tail.endsWith('\nfinal error 🙂'));
  assert.equal(stream.listenerCount('data'), 0);
});

test('a connected port forward drops startup diagnostic and readiness listeners while continuing to drain logs', async (t) => {
  const net = require('node:net'); const { whenListening } = require('../core/ports');
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  for (let i = 0; i < 30; i++) {
    const child = new EventEmitter(); child.stderr = new PassThrough();
    const ready = whenListening(server.address().port, child);
    child.stderr.write('diagnostic'.repeat(50000)); await ready;
    assert.equal(child.listenerCount('exit'), 0);
    assert.equal(child.listenerCount('error'), 0);
    for (const event of ['data', 'end', 'close']) assert.equal(child.stderr.listenerCount(event), 0);
    assert.equal(child.stderr.readableFlowing, true);
    child.stderr.end('later logs'); child.stderr.destroy();
  }
});

test('port startup failures retain a bounded useful error and clean up readiness work', async () => {
  const { whenListening } = require('../core/ports');
  const child = new EventEmitter(); child.stderr = new PassThrough();
  const ready = whenListening(1, child);
  child.stderr.write('noise\n'.repeat(50000) + 'Connection refused\n'); child.emit('exit', 255);
  await assert.rejects(ready, /^Error: Connection refused$/);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.listenerCount('error'), 0);
  assert.equal(child.stderr.listenerCount('data'), 0); child.stderr.destroy();
});

test('port startup timeout terminates its child and releases the diagnostic collector', async (t) => {
  const { whenListening } = require('../core/ports'); const { start, killTree } = require('../core/proc');
  const child = start(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { env: process.env });
  t.after(() => killTree(child));
  await assert.rejects(whenListening(1, child, 30), /did not start/);
  if (child.exitCode == null && child.signalCode == null) await once(child, 'close');
  assert.equal(child.stderr.listenerCount('data'), 0);
  assert.equal(child.listenerCount('exit'), 0);
});
