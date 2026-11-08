'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { engineRequest } = require('./transport.cjs');
assert.notEqual(process.platform, 'win32', 'This process-lifecycle probe uses an executable shebang on Unix.');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-shared-transport-')), binary = path.join(root, 'worker.cjs');
const controllers = [], pending = [], checks = [];
let disposed = 0;
fs.writeFileSync(binary, `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
if(process.argv[4]==='stubborn')process.on('SIGTERM',()=>{});
fs.writeFileSync(path.join(process.argv[3],process.argv[4]+'-pid'),String(process.pid));
process.stdout.write(JSON.stringify({protocol:1})+String.fromCharCode(10));setInterval(()=>{},1000);
`, { mode: 0o700 });
function start(label) {
  const controller = new AbortController(); controllers.push(controller);
  const value = engineRequest(binary, ['scan-files', root, label, '1', 'true'], {
    signal: controller.signal,
    record(record) { assert.equal(record.protocol, 1); },
    finish() { throw Error('The fixture must stay live until cancellation.'); },
    dispose() { disposed++; },
  }).then(() => 'unexpected-result', error => error.name === 'AbortError' ? 'cancelled' : error.message);
  pending.push(value); return { controller, value, marker: path.join(root, label + '-pid') };
}
async function started(item) {
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(item.marker)) { assert.ok(Date.now() < deadline, 'worker must start'); await new Promise(resolve => setTimeout(resolve, 10)); }
  return Number(fs.readFileSync(item.marker, 'utf8'));
}
function gone(pid) { assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH'); }
async function main() {
  const a = start('a'), b = start('b'), c = start('c');
  const [ap, bp] = await Promise.all([started(a), started(b)]);
  assert.equal(fs.existsSync(c.marker), false);
  checks.push('Only two workers start across concurrent operation owners.');
  c.controller.abort(); assert.equal(await c.value, 'cancelled'); assert.equal(fs.existsSync(c.marker), false);
  checks.push('Cancelling a queued owner removes it without starting a worker.');
  const d = start('d'); a.controller.abort(); assert.equal(await a.value, 'cancelled'); gone(ap);
  const dp = await started(d); assert.equal(fs.existsSync(c.marker), false);
  b.controller.abort(); d.controller.abort(); assert.deepEqual(await Promise.all([b.value, d.value]), ['cancelled', 'cancelled']); gone(bp); gone(dp);
  assert.equal(disposed, 4);
  checks.push('A closed worker releases its slot; all owners dispose once and confirmed workers are reaped.');
  const stubborn = start('stubborn'), stubbornPid = await started(stubborn);
  stubborn.controller.abort(); assert.equal(await stubborn.value, 'cancelled'); gone(stubbornPid);
  checks.push('Cancellation forcibly reaps a worker that ignores the initial termination request.');
  const empty = { record() {}, finish() { throw Error(); }, dispose() {} };
  assert.equal(await engineRequest(binary, ['x'.repeat(65537)], empty), null);
  assert.equal(await engineRequest(binary, Array(17).fill('x'), empty), null);
  assert.equal(await engineRequest(binary, ['bad\0argument'], empty), null);
  checks.push('Oversized argument bytes/counts and NUL arguments never launch work.');
  const first = start('capacity-a'), second = start('capacity-b');
  const firstPid = await started(first), secondPid = await started(second);
  const queued = Array.from({ length: 64 }, (_, at) => start('waiting-' + at));
  assert.match(await start('overflow').value, /Too many searches/);
  for (const item of queued) item.controller.abort();
  assert.ok((await Promise.all(queued.map(item => item.value))).every(value => value === 'cancelled'));
  assert.ok(queued.every(item => !fs.existsSync(item.marker)));
  checks.push('The shared queue rejects its 65th waiter and cancels all 64 admitted waiters without subprocesses.');
  first.controller.abort(); second.controller.abort();
  assert.deepEqual(await Promise.all([first.value, second.value]), ['cancelled', 'cancelled']); gone(firstPid); gone(secondPid);
  checks.push('Capacity failure and queued cancellation leave active-worker cleanup intact.');
  const report = { complete: true, checks, platform: process.platform, scope: 'Real Unix fixture subprocesses prove shared transport admission, argument bounds, queued/running cancellation and reaping. This is not app integration or a Rust performance measurement.' };
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ complete: true, checks: checks.length }));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  for (const controller of controllers) controller.abort();
  await Promise.allSettled(pending); fs.rmSync(root, { recursive: true, force: true });
});
