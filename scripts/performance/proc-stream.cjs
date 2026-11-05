'use strict';
// Parser/diagnostic policies only: independent processes, identical decoded input,
// no model, network, user history, or production forced GC.
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const { EventEmitter } = require('node:events'); const { spawnSync } = require('node:child_process');
const { PerformanceObserver } = require('node:perf_hooks');
const { lines, streamTail } = require('../../core/proc');
class Input extends EventEmitter { setEncoding() {} }
function previousLines(stream, onLine) {
  let buf = '';
  stream.on('data', (chunk) => { buf += chunk; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); } });
  stream.on('end', () => { if (buf) onLine(buf); buf = ''; });
}
const round = (n) => Math.round(n * 1000) / 1000;
async function worker() {
  const [mode, workload] = process.argv.slice(3); const stream = new Input();
  let count = 0; let tail = ''; const hash = crypto.createHash('sha256');
  const parsed = (line) => { count++; hash.update(line); };
  const framing = workload !== 'tail';
  if (framing) (mode === 'previous' ? previousLines : lines)(stream, parsed);
  else if (mode === 'previous') previousLines(stream, (line) => { tail = `${tail}${line}\n`.slice(-4000); });
  else streamTail(stream, 4000, (value) => { tail = value; });
  const frame = JSON.stringify({ text: 'source context '.repeat(35000) });
  const input = workload === 'frames' ? frame + '\n' : workload === 'short-frames' ? (JSON.stringify({ type: 'delta', text: 'hello '.repeat(8) }) + '\n').repeat(128) : 'diagnostic '.repeat(1024);
  const chunkCharacters = workload === 'frames' ? 256 : workload === 'short-frames' ? 4096 : input.length;
  const pieces = Array.from({ length: Math.ceil(input.length / chunkCharacters) }, (_, i) => input.slice(i * chunkCharacters, (i + 1) * chunkCharacters));
  global.gc(); await new Promise(setImmediate);
  const gc = []; const observer = new PerformanceObserver((list) => gc.push(...list.getEntries().map((entry) => entry.duration)));
  observer.observe({ entryTypes: ['gc'] });
  const initial = process.memoryUsage(); let peakHeap = initial.heapUsed; let largestRetainedTail = 0;
  const samples = []; const repeats = workload === 'frames' ? 20 : 1600;
  for (let i = 0; i < repeats; i++) {
    const start = performance.now();
    for (const piece of pieces) stream.emit('data', piece);
    samples.push(performance.now() - start);
    if (workload === 'tail') largestRetainedTail = Math.max(largestRetainedTail, tail.length);
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    if (i % 16 === 0) await new Promise(setImmediate);
  }
  // Settle and collect while the unterminated diagnostic stream is still open.
  await new Promise(setImmediate); await new Promise(setImmediate); observer.disconnect();
  const beforeEnd = process.memoryUsage(); const gcTime = gc.reduce((sum, value) => sum + value, 0);
  global.gc(); await new Promise(setImmediate); const retained = process.memoryUsage();
  // Both diagnostic policies receive the same terminating delimiter after the
  // open-stream measurement, so the final tail is byte-for-byte comparable.
  if (workload === 'tail') stream.emit('data', '\n');
  stream.emit('end');
  const sorted = samples.sort((a, b) => a - b);
  const result = { mode, workload, inputBytes: Buffer.byteLength(input) * repeats + (framing ? 0 : 1), repeats, chunkCharacters,
    medianBatchMs: round((sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2), totalMeasuredMs: round(samples.reduce((sum, value) => sum + value, 0)),
    peakSampledHeapIncreaseMiB: round((peakHeap - initial.heapUsed) / 1024 ** 2), beforeEndHeapIncreaseMiB: round((beforeEnd.heapUsed - initial.heapUsed) / 1024 ** 2), postGcOpenStreamHeapIncreaseMiB: round((retained.heapUsed - initial.heapUsed) / 1024 ** 2),
    naturalGcEvents: gc.length, naturalGcDurationMs: round(gcTime), largestDiagnosticTailBeforeEnd: largestRetainedTail,
    frames: count, checksum: framing ? hash.digest('hex') : crypto.createHash('sha256').update(tail).digest('hex'), listenersAfterEnd: ['data','end','close'].reduce((sum,event)=>sum+stream.listenerCount(event),0) };
  process.stdout.write(JSON.stringify(result));
}
async function main() {
  if (process.argv[2] === '--worker') return worker();
  const cases = [];
  for (const workload of ['short-frames', 'frames', 'tail']) {
    const run = (mode) => {
      const child = spawnSync(process.execPath, ['--expose-gc', __filename, '--worker', mode, workload], { encoding: 'utf8', timeout: 120000 });
      if (child.status !== 0) throw new Error(child.stderr || 'Benchmark failed'); return JSON.parse(child.stdout);
    };
    const previous = run('previous'); const optimized = run('optimized');
    if (previous.checksum !== optimized.checksum || previous.frames !== optimized.frames) throw new Error('Output parity failed');
    cases.push({ workload, previous, optimized, outputParity: true, measuredTimeRatio: round(previous.totalMeasuredMs / optimized.totalMeasuredMs) });
  }
  const fingerprintFiles = ['core/proc.js', 'core/runner.js', 'core/acp.js', 'core/codex-server.js', 'core/host.js', 'core/ports.js', 'scripts/performance/proc-stream.cjs'];
  const fingerprint = crypto.createHash('sha256'); for (const file of fingerprintFiles) { fingerprint.update(file); fingerprint.update(fs.readFileSync(path.join(__dirname,'../..',file))); }
  const report = { checkedOn: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`, fingerprint: fingerprint.digest('hex'), fingerprintFiles,
    scope: 'Synthetic decoded-string line framing and newline-free diagnostic retention. Separate processes, explicit GC only at measurement boundaries. Natural GC excludes forced settling. Does not measure full agent parsing, child-process IO, SSH transport, total Electron RAM or generation latency. Previous diagnostic tails appear only when end flushes the frame; optimized tails update continuously.', cases };
  const outputIndex = process.argv.indexOf('--output'); const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
main().catch((error) => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
