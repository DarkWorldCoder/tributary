'use strict';
// Synthetic, instrumented SQLite persistence comparison. No real user data or model requests.
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PerformanceObserver } = require('node:perf_hooks');
const { SqliteStore } = require('../../core/store');
const defaults = { version: 1, threads: [], projects: [], gateways: [], notifications: [], settings: {} };
const round = (number) => Math.round(number * 1000) / 1000;
const mib = (bytes) => round(bytes / 1024 ** 2);
const fingerprint = () => require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../../core/store.js'))).digest('hex');
async function worker() {
  const store = new SqliteStore(process.argv[3], defaults); const mode = process.argv[4];
  const thread = store.data.threads[0]; const active = thread.messages.at(-1);
  let serializedBytes = 0; let serializedRows = 0;
  const collect = store.collect.bind(store);
  store.collect = (...args) => {
    const rows = collect(...args);
    for (const row of rows.values()) if (row.coll.startsWith('m:')) { serializedBytes += row.json.length; serializedRows++; }
    return rows;
  };
  global.gc(); await new Promise(setImmediate);
  const gc = []; const observer = new PerformanceObserver((list) => gc.push(...list.getEntries().map((entry) => ({ kind: entry.detail.kind, durationMs: entry.duration }))));
  observer.observe({ entryTypes: ['gc'] });
  const before = process.memoryUsage(); const samples = [];
  const step = (index) => { active.text += ` token-${index}`; store.save(true, thread.id, mode === 'message' ? active.id : undefined); };
  for (let index = 0; index < 8; index++) step(`warm-${index}`);
  serializedBytes = 0; serializedRows = 0; gc.length = 0;
  for (let index = 0; index < 40; index++) { const started = performance.now(); step(index); samples.push(performance.now() - started); await new Promise(setImmediate); }
  // Let GC performance entries arrive before disconnecting. No forced GC in measured samples.
  await new Promise(setImmediate); await new Promise(setImmediate); observer.disconnect();
  const after = process.memoryUsage(); const sorted = [...samples].sort((a, b) => a - b);
  const saved = JSON.parse(store.q.row.get(`m:${thread.id}`, active.id).data);
  if (saved.text !== active.text || store.q.messageCount.get(`m:${thread.id}`).count !== thread.messages.length) throw new Error('Persistence parity failed');
  const result = { mode, messages: thread.messages.length, samples: samples.length, medianMs: round((sorted[19] + sorted[20]) / 2), sampleP95Ms: round(sorted[Math.ceil(sorted.length * .95) - 1]), serializedMessageRows: serializedRows, serializedMessageJsonBytes: serializedBytes, gcEvents: gc.length, observedGcDurationMs: round(gc.reduce((sum, entry) => sum + entry.durationMs, 0)), beforeHeapMB: mib(before.heapUsed), afterHeapMB: mib(after.heapUsed), rssMB: mib(after.rss), parity: true };
  store.close(); process.stdout.write(JSON.stringify(result));
}
async function main() {
  if (process.argv[2] === '--worker') return worker();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-stream-store-'));
  try {
    const cases = [];
    for (const count of [500, 2500, 10000]) {
      const dir = path.join(root, String(count)); const store = new SqliteStore(dir, defaults);
      store.data.threads.push({ id: 'history', project: root, createdAt: 1, title: 'Synthetic history', messages: Array.from({ length: count }, (_, index) => ({ id: `m-${index}`, role: 'assistant', text: index === count - 1 ? 'Current reply' : 'source context '.repeat(150), tools: [{ output: 'tool result '.repeat(30) }], ok: index === count - 1 ? null : true })) });
      store.save(true); store.close();
      // Each method gets its own isolated process with identical history.
      const run = (mode) => {
        const child = spawnSync(process.execPath, ['--expose-gc', '--no-warnings', __filename, '--worker', dir, mode], { encoding: 'utf8', timeout: 120000 });
        if (child.status !== 0) throw new Error(child.stderr || `Benchmark failed: ${mode}`);
        return JSON.parse(child.stdout);
      };
      const previous = run('thread');
      // Reset the active reply before the second process so the inputs are equal.
      const reset = new SqliteStore(dir, defaults); reset.data.threads[0].messages.at(-1).text = 'Current reply'; reset.save(true); reset.close();
      const optimized = run('message'); cases.push({ messages: count, previous, optimized, medianSpeedup: round(previous.medianMs / optimized.medianMs), serializedBytesReductionPercent: round((1 - optimized.serializedMessageJsonBytes / previous.serializedMessageJsonBytes) * 100) });
    }
    const report = { fixture: 'ASCII histories, 40 persisted token batches after 8 warmups; before=thread-wide v0.1.3 API, after=changed-message API; instrumentation counts serialized message JSON in both paths', runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, logicalCpus: os.availableParallelism(), memoryGB: round(os.totalmem() / 1024 ** 3) }, sourceSha256: fingerprint(), cases, scope: 'Backend synchronous save latency, serialized-message allocation proxy and naturally observed GC in isolated workers. Not total Electron RAM, cold startup, typing latency, model throughput or production p95. GC varies with heap policy. Production does not force GC.' };
    const output = process.argv.indexOf('--output'); if (output >= 0) fs.writeFileSync(process.argv[output + 1], JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
