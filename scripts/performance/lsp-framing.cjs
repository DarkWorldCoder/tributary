'use strict';
// Byte-framing policy benchmark. Fixtures and copy instrumentation stay outside
// timed runs. No providers, servers, user files, or production GC changes.
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const crypto = require('node:crypto'); const { spawnSync } = require('node:child_process');
const { PerformanceObserver } = require('node:perf_hooks');
const { createLspFramer, MAX_BODY_BYTES } = require('../../core/lsp-framing');
const round = (value) => Math.round(value * 1000) / 1000;
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2; };
const frame = (body) => Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);

// Framing copied from base 3532a17, stopping at its synchronous JSON consumer.
// The benchmark callback replaces JSON parsing for BOTH policies.
function previous(onFrame) {
  let buffer = Buffer.alloc(0);
  return {
    push(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_BODY_BYTES) throw new Error('Language server response is too large.');
      while (true) {
        const split = buffer.indexOf('\r\n\r\n'); if (split < 0) return;
        const match = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, split).toString());
        if (!match || Number(match[1]) > MAX_BODY_BYTES) throw new Error('Invalid language server frame.');
        const length = Number(match[1]); if (buffer.length < split + 4 + length) return;
        const body = buffer.subarray(split + 4, split + 4 + length); buffer = buffer.subarray(split + 4 + length);
        onFrame(body);
      }
    },
    stats: () => ({ headerBackingBytes: 0, bodyBackingBytes: buffer.length ? buffer.buffer.byteLength : 0, retainedBytes: buffer.length }),
    dispose() { buffer = Buffer.alloc(0); },
  };
}
const makeReader = (mode, onFrame) => mode === 'previous' ? previous(onFrame) : createLspFramer(onFrame, (error) => { throw error; });
function fixture(workload) {
  let bytes; let batchFrames; let repeats; let chunkBytes;
  if (workload === 'small-coalesced') {
    bytes = Buffer.concat(Array.from({ length: 128 }, (_, id) => frame(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, result: [{ label: `entry_${id}`, detail: 'नमस्ते 🙂' }] })))));
    batchFrames = 128; repeats = 800; chunkBytes = 16384;
  } else if (workload === 'small-header-body-writes') {
    bytes = frame(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: [{ label: 'completion', detail: 'नमस्ते 🙂' }] })));
    batchFrames = 1; repeats = 25000; chunkBytes = null;
  } else if (workload === 'large-fragmented') {
    bytes = frame(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { text: '🙂'.repeat(250000) } })));
    batchFrames = 1; repeats = 8; chunkBytes = 256;
  } else if (workload === 'large-normal-chunks') {
    bytes = frame(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { text: 'x'.repeat(4 * 1024 * 1024) } })));
    batchFrames = 1; repeats = 8; chunkBytes = 65536;
  } else throw new Error('Unknown workload');
  const chunks = [];
  if (chunkBytes == null) { const split = bytes.indexOf('\r\n\r\n') + 4; chunks.push(bytes.subarray(0, split), bytes.subarray(split)); }
  else for (let i = 0; i < bytes.length; i += chunkBytes) chunks.push(bytes.subarray(i, i + chunkBytes));
  return { chunks, batchBytes: bytes.length, batchFrames, repeats, chunkBytes };
}
function audit(mode, input) {
  let frames = 0; const hash = crypto.createHash('sha256');
  const reader = makeReader(mode, (body) => { frames++; hash.update(String(body.length)); hash.update(':'); hash.update(body); });
  const savedConcat = Buffer.concat; const savedCopy = Buffer.prototype.copy;
  let inConcat = false; let bulkCopyBytes = 0; let bulkCopyCalls = 0;
  // A separate untimed pass counts explicit bulk copies. Scalar header writes,
  // strings, JSON parsing and allocator bookkeeping are outside this metric.
  Buffer.concat = function(...args) {
    const before = inConcat; inConcat = true;
    try { const result = savedConcat.apply(this, args); bulkCopyBytes += result.length; bulkCopyCalls++; return result; }
    finally { inConcat = before; }
  };
  Buffer.prototype.copy = function(...args) {
    const copied = savedCopy.apply(this, args); if (!inConcat) { bulkCopyBytes += copied; bulkCopyCalls++; } return copied;
  };
  try { for (const chunk of input.chunks) reader.push(chunk); }
  finally { Buffer.concat = savedConcat; Buffer.prototype.copy = savedCopy; reader.dispose(); }
  if (frames !== input.batchFrames) throw new Error('Audit lost frames');
  return { checksum: hash.digest('hex'), auditFrames: frames, bulkCopyBytesPerBatch: bulkCopyBytes, bulkCopyCallsPerBatch: bulkCopyCalls };
}
const tick = () => new Promise(setImmediate);
async function collect() { global.gc(); await tick(); global.gc(); await tick(); }
function tailInput(reader) {
  const completed = frame(Buffer.alloc(4 * 1024 * 1024, 'x'));
  reader.push(Buffer.concat([completed, Buffer.from(`Content-Length: ${MAX_BODY_BYTES}\r\n\r\nx`)]));
}
async function retention(mode) {
  let frames = 0; const reader = makeReader(mode, () => frames++);
  await collect(); const baseline = process.memoryUsage();
  tailInput(reader); await collect(); const held = process.memoryUsage(); const state = reader.stats();
  if (frames !== 1) throw new Error('Tail fixture lost its completed frame');
  reader.dispose(); await collect(); const released = process.memoryUsage();
  return { completedFrames: frames, unfinishedBodyBytes: mode === 'previous' ? 1 : state.bodyBytes,
    retainedReaderBackingBytes: state.headerBackingBytes + state.bodyBackingBytes,
    postGcArrayBufferDeltaBytes: held.arrayBuffers - baseline.arrayBuffers,
    postDisposeArrayBufferDeltaBytes: released.arrayBuffers - baseline.arrayBuffers,
    inputTransportReferencesDroppedBeforeCollection: true };
}
async function worker(mode, workload) {
  if (workload === 'tail') { process.stdout.write(JSON.stringify(await retention(mode))); return; }
  const input = fixture(workload); const parity = audit(mode, input); let count = 0;
  const reader = makeReader(mode, () => count++);
  // Warm the same parser and fixture, then settle BEFORE observing natural GC.
  for (let i = 0; i < 8; i++) for (const chunk of input.chunks) reader.push(chunk);
  count = 0; await collect();
  const measuredStart = performance.now();
  const events = []; const observer = new PerformanceObserver((list) => events.push(...list.getEntries().filter((entry) => entry.startTime >= measuredStart).map((entry) => entry.duration)));
  observer.observe({ entryTypes: ['gc'] }); const baseline = process.memoryUsage(); const timings = [];
  let highestHeap = baseline.heapUsed; let highestExternal = baseline.external;
  for (let i = 0; i < input.repeats; i++) {
    const start = performance.now(); for (const chunk of input.chunks) reader.push(chunk); timings.push(performance.now() - start);
    const usage = process.memoryUsage(); highestHeap = Math.max(highestHeap, usage.heapUsed); highestExternal = Math.max(highestExternal, usage.external);
    if (i % 8 === 0) await tick();
  }
  await tick(); await tick(); observer.disconnect(); reader.dispose();
  if (count !== input.batchFrames * input.repeats) throw new Error('Timed pass lost frames');
  process.stdout.write(JSON.stringify({ mode, workload, batchBytes: input.batchBytes, chunkBytes: input.chunkBytes, frames: count, repeats: input.repeats,
    totalMeasuredMs: round(timings.reduce((sum, ms) => sum + ms, 0)), medianBatchMs: round(median(timings)),
    naturalGcEvents: events.length, naturalGcDurationMs: round(events.reduce((sum, ms) => sum + ms, 0)),
    highestBatchSampleHeapIncreaseBytes: highestHeap - baseline.heapUsed, highestBatchSampleExternalIncreaseBytes: highestExternal - baseline.external, ...parity }));
}
async function main() {
  if (process.argv[2] === '--worker') return worker(process.argv[3], process.argv[4]);
  const cases = [];
  const run = (mode, workload) => {
    const child = spawnSync(process.execPath, ['--expose-gc', __filename, '--worker', mode, workload], { encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
    if (child.status !== 0) throw new Error(child.stderr || `Benchmark failed: ${mode}/${workload}`); return JSON.parse(child.stdout);
  };
  for (const workload of ['small-coalesced', 'small-header-body-writes', 'large-fragmented', 'large-normal-chunks']) {
    const rounds = [];
    for (let index = 0; index < 3; index++) {
      const pair = {};
      for (const mode of index % 2 ? ['optimized', 'previous'] : ['previous', 'optimized']) pair[mode] = run(mode, workload);
      if (pair.previous.checksum !== pair.optimized.checksum || pair.previous.frames !== pair.optimized.frames) throw new Error('Output parity failed');
      rounds.push(pair);
    }
    cases.push({ workload, outputParity: true, previousMedianMeasuredMs: median(rounds.map((row) => row.previous.totalMeasuredMs)), optimizedMedianMeasuredMs: median(rounds.map((row) => row.optimized.totalMeasuredMs)), rounds });
  }
  const retentionRuns = ['previous','optimized'].map((mode) => ({ mode, ...run(mode, 'tail') }));
  const sources = ['core/lsp-framing.js','core/language-tools.js','scripts/performance/lsp-framing.cjs'];
  const sourceSha256 = Object.fromEntries(sources.map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../..', file))).digest('hex')]));
  const report = { checkedOn: new Date().toISOString(), runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, bufferPoolBytes: Buffer.poolSize },
    previousReference: '3532a17ee670062f2df9f1e3b34c44d7123ee035:core/language-tools.js receive byte framing, before JSON parsing', sourceSha256,
    scope: 'Synthetic LSP byte framing in isolated Node processes; three alternating-order rounds per workload. Checksum/copy audit is separate from uninstrumented timing. Fixture construction and JSON parsing are excluded; an untimed batch checks complete-output checksums and copy counts, while timed runs check frame counts. Natural GC excludes explicit boundary collections. Batch memory samples can miss transient peaks. Tail retention drops input references and measures reader-owned backing buffers plus post-GC arrayBuffers. This is not complete language-server IO, total Electron RAM, startup, reindexing, real provider or model performance.', cases, retentionRuns };
  const at = process.argv.indexOf('--output'); if (at >= 0) { if (!process.argv[at + 1]) throw new Error('Missing output path'); fs.writeFileSync(process.argv[at + 1], JSON.stringify(report, null, 2) + '\n'); }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
