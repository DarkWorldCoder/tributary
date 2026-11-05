import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import crypto from 'node:crypto';
import os from 'node:os';
import { terminalConsumer } from '../ui/src/lib/terminal-consumer.mjs';
const require = createRequire(import.meta.url);
const { terminalOutput, HIGH } = require('../core/terminal-output');
const { TerminalManager } = require('../core/terminal');
function fixture(overrides = {}, options = {}) {
  const sent = []; const transitions = []; let completed = 0;
  const output = terminalOutput({ send: (p) => sent.push(p), pause: () => transitions.push('pause'), resume: () => transitions.push('resume'), drained: () => completed++, ...overrides }, { high: 64, low: 16, frame: 16, delay: 8, ...options });
  return { output, sent, transitions, get completed() { return completed; } };
}

test('a terminal has no output consumer until attached and rejects invalid/future/stale ACKs', () => {
  const f = fixture(); f.output.push('initial prompt'); assert.equal(f.sent.length, 0); assert.equal(f.output.stats().paused, true);
  assert.equal(f.output.attach('bad owner\n'), false); f.output.attach('one'); assert.equal(f.sent[0].data, 'initial prompt');
  for (const [owner, seq] of [['old', 1], ['one', 2], ['one', -1], ['one', NaN], ['one', 1.5]]) assert.equal(f.output.ack(owner, seq), false);
  assert.equal(f.output.stats().outstanding, 14); assert.equal(f.output.ack('one', 1), true); assert.equal(f.output.ack('one', 1), false);
  assert.equal(f.output.stats().retained, 0); f.output.dispose();
});

test('high and low watermarks bound delivery and resume with hysteresis', () => {
  const f = fixture(); f.output.attach('one'); f.output.push('x'.repeat(64));
  assert.equal(f.output.stats().outstanding, 64); assert.equal(f.output.stats().paused, true); assert.equal(f.sent.length, 4);
  f.output.ack('one', 2); assert.equal(f.output.stats().paused, true); f.output.ack('one', 3); assert.equal(f.output.stats().paused, false);
  f.output.push('y'.repeat(64)); assert.equal(f.output.stats().outstanding, 64); assert.equal(f.output.stats().queued, 16);
  assert.equal(f.output.stats().retained, 80); // one already-delivered input chunk can overshoot
  f.output.ack('one', 7); assert.equal(f.output.stats().queued, 0); f.output.ack('one', f.sent.at(-1).seq);
  assert.equal(f.sent.map((p) => p.data).join(''), 'x'.repeat(64) + 'y'.repeat(64)); assert.equal(f.output.stats().retained, 0); f.output.dispose();
});

test('reattachment replays unparsed frames in order and old callbacks cannot release them', () => {
  let output; const packets = [];
  const f = fixture({ send: (p) => { packets.push(p); if (p.owner === 'new') output.ack('new', p.seq); } }); output = f.output;
  output.attach('old'); output.push('a'.repeat(80)); output.ack('old', 1); output.detach('old');
  const retained = output.stats().retained; assert.equal(output.ack('old', 4), false); assert.equal(output.stats().retained, retained);
  output.attach('new'); assert.equal(output.stats().retained, 0);
  const replay = packets.filter((p) => p.owner === 'new'); assert.deepEqual(replay.map((p) => p.seq), [2, 3, 4, 5]);
  assert.equal(replay.map((p) => p.data).join(''), 'a'.repeat(64)); output.end(); assert.equal(f.completed, 1);
});

test('a packet-count ceiling also bounds sparse outstanding callback metadata', () => {
  const f = fixture({}, { high: 1000, low: 100, frame: 1, maxFrames: 4 }); f.output.attach('one'); f.output.push('abcdefghij');
  assert.equal(f.output.stats().frames, 4); assert.equal(f.output.stats().outstanding, 4); assert.equal(f.output.stats().queued, 6); assert.equal(f.output.stats().paused, true);
  f.output.ack('one', 4); assert.equal(f.output.stats().frames, 4); f.output.ack('one', 8); assert.equal(f.output.stats().frames, 2);
  f.output.ack('one', 10); assert.equal(f.output.stats().retained, 0); assert.equal(f.output.stats().paused, false);
  assert.equal(f.sent.map((p) => p.data).join(''), 'abcdefghij'); f.output.dispose();
});

test('natural exit waits for attachment and parsing while explicit disposal releases everything', () => {
  const f = fixture(); f.output.push('last output'); f.output.end(); assert.equal(f.completed, 0);
  f.output.attach('one'); assert.equal(f.completed, 0); f.output.ack('one', 1); assert.equal(f.completed, 1);
  f.output.end(); assert.equal(f.completed, 1); assert.equal(f.output.stats().disposed, true);
  const idle = fixture(); idle.output.end(); assert.equal(idle.completed, 0); idle.output.attach('one'); assert.equal(idle.completed, 1);
  const closing = fixture(); closing.output.attach('one'); closing.output.push('x'); assert.equal(closing.output.stats().timer, true);
  closing.output.dispose(); closing.output.push('late'); closing.output.end(); assert.equal(closing.output.stats().retained, 0); assert.equal(closing.output.stats().timer, false); assert.equal(closing.completed, 0);
});

test('flushing output clears its timer and tiny batches preserve Unicode order', async () => {
  const f = fixture(); f.output.attach('one'); f.output.push('🙂'); assert.equal(f.output.stats().timer, true);
  f.output.push('नमस्ते'.repeat(3)); assert.equal(f.output.stats().timer, false);
  assert.equal(f.sent.map((p) => p.data).join(''), '🙂' + 'नमस्ते'.repeat(3));
  f.output.ack('one', f.sent.at(-1).seq); const count = f.sent.length;
  await new Promise((resolve) => setTimeout(resolve, 20)); assert.equal(f.sent.length, count); f.output.dispose();
});

test('consumer ACKs only parsed contiguous output and coalesces callbacks', () => {
  const writes = []; const acks = []; const c = terminalConsumer({ owner: 'one', write: (data, done) => writes.push({ data, done }), acknowledge: (...args) => acks.push(args) });
  c.receive({ owner: 'stale', seq: 1, data: 'ignored' });
  for (const seq of [1, 2, 2, 3]) c.receive({ owner: 'one', seq, data: String(seq) });
  assert.equal(writes.length, 3); writes[1].done(); c.flush(); assert.equal(acks.length, 0);
  writes[0].done(); c.flush(); assert.deepEqual(acks, [['one', 2]]); assert.equal(c.stats().queued, 1);
  writes[2].done(); c.dispose(); c.flush(); assert.deepEqual(acks, [['one', 2]]); assert.equal(c.stats().queued, 0); assert.equal(c.stats().timer, false);
});

test('repeated disposed transport and consumer pairs leave no pending data, records or timers', () => {
  for (let i = 0; i < 200; i++) {
    const f = fixture(); const callbacks = [];
    const c = terminalConsumer({ owner: 'one', write: (_, done) => callbacks.push(done), acknowledge: (owner, seq) => f.output.ack(owner, seq) });
    f.output.attach('one'); f.output.push('x'.repeat(80)); for (const p of f.sent) c.receive(p);
    c.dispose(); f.output.dispose(); for (const done of callbacks) done();
    assert.equal(c.stats().callbacks, 0); assert.equal(c.stats().timer, false); assert.equal(f.output.stats().frames, 0); assert.equal(f.output.stats().retained, 0);
  }
});

test('a real PTY honors slow parser ACKs without losing output or the exit marker', { skip: process.platform === 'win32', timeout: 30000 }, async (t) => {
  const tm = new TerminalManager(); t.after(() => tm.killAll()); const chunk = '0123456789abcdef'.repeat(1024); const repeats = 256;
  const expected = crypto.createHash('sha256'); for (let i = 0; i < repeats; i++) expected.update(chunk);
  const actual = crypto.createHash('sha256'); let received = 0; let maximum = 0; let maximumRead = 0; let maximumRetained = 0;
  let id; const consumer = terminalConsumer({ owner: 'parser', write: (data, done) => { actual.update(data); received += data.length; setTimeout(done, 2); }, acknowledge: (owner, seq) => tm.acknowledge(id, owner, seq) }); t.after(() => consumer.dispose());
  tm.on('data', (packet) => { maximum = Math.max(maximum, tm.get(packet.id).output.stats().outstanding); consumer.receive(packet); });
  const done = once(tm, 'exit');
  id = tm.create({ cwd: os.tmpdir(), shell: process.execPath, args: ['-e', `const fs=require('fs');const b=Buffer.from(${JSON.stringify(chunk)});for(let i=0;i<${repeats};i++)for(let n=0;n<b.length;)n+=fs.writeSync(1,b,n,b.length-n);`], flowControl: true });
  const native = tm.get(id).p;
  const monitor = native.onData((data) => { maximumRead = Math.max(maximumRead, data.length); const term = tm.terms.get(id); if (term) maximumRetained = Math.max(maximumRetained, term.output.stats().retained); }); t.after(() => monitor.dispose());
  await new Promise((resolve) => setTimeout(resolve, 25)); assert.equal(received, 0, 'initial output waits for a sink');
  tm.attach(id, 'parser'); const [exit] = await done; assert.equal(exit.code, 0);
  assert.equal(received, chunk.length * repeats); assert.equal(actual.digest('hex'), expected.digest('hex'));
  assert.ok(maximum <= HIGH); assert.ok(maximumRetained <= HIGH + maximumRead, `${maximumRetained} exceeds window + observed read ${maximumRead}`);
  assert.equal(tm.terms.size, 0); assert.equal(consumer.stats().queued, 0); assert.equal(tm.acknowledge(id, 'parser', 1), false);
});

test('explicit close disposes an exited-but-unparsed terminal and a paused fast producer', { skip: process.platform === 'win32', timeout: 15000 }, async (t) => {
  for (const flooding of [false, true]) {
    const tm = new TerminalManager(); t.after(() => tm.killAll());
    const script = flooding ? "const fs=require('fs'),b=Buffer.alloc(4096,120);while(true)fs.writeSync(1,b);" : "require('fs').writeSync(1,'last output');";
    const id = tm.create({ cwd: os.tmpdir(), shell: process.execPath, args: ['-e', script], flowControl: true }); const term = tm.get(id); tm.attach(id, 'one');
    const deadline = Date.now() + 5000;
    while (flooding ? term.output.stats().retained < HIGH : term.exitCode == null) { assert.ok(Date.now() < deadline, 'PTY did not reach the test condition'); await new Promise((resolve) => setTimeout(resolve, 5)); }
    assert.ok(term.output.stats().outstanding > 0); const done = once(tm, 'exit'); tm.kill(id); await done;
    assert.equal(term.output.stats().disposed, true); assert.equal(term.output.stats().retained, 0); assert.equal(term.finish, null); assert.equal(tm.terms.size, 0);
  }
});

test('terminal adoption metadata preserves an explicitly folderless session', { skip: process.platform === 'win32' }, async (t) => {
  const tm = new TerminalManager(); t.after(() => tm.killAll()); const done = once(tm, 'exit');
  const id = tm.create({ cwd: os.tmpdir(), project: null, shell: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], flowControl: true });
  assert.equal(tm.list()[0].project, null); assert.equal(tm.list()[0].cwd, os.tmpdir());
  tm.kill(id); await done; assert.deepEqual(tm.list(), []);
});

test('renderer replacement and shutdown cancel terminal environment preparation before spawning', async () => {
  for (const action of ['detachAll', 'killAll']) {
    const tm = new TerminalManager(); let resolve;
    const env = new Promise((yes) => { resolve = yes; });
    const opening = tm.createPrepared({ shell: 'never-spawn-this-terminal' }, () => env);
    tm[action](); resolve({}); await assert.rejects(opening, /Terminal creation cancelled/); assert.equal(tm.terms.size, 0);
  }
});
