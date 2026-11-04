'use strict';
// Reproduce the old and new sidebar cache in separate processes, against identical history.
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SqliteStore } = require('../core/store');
const defaults = { version: 1, threads: [], projects: [], gateways: [], notifications: [], settings: {} };
const mb = (bytes) => Math.round(bytes / 1024 ** 2 * 100) / 100;
if (process.argv[2] === '--worker') {
  const store = new SqliteStore(process.argv[3], defaults);
  global.gc(); const before = process.memoryUsage(); const started = performance.now();
  if (process.argv[4] === 'previous') {
    const ids = store.db.prepare('SELECT id FROM records WHERE coll = ? AND data IS NOT NULL ORDER BY pos DESC, rev DESC');
    for (const thread of store.data.threads) {
      const coll = `m:${thread.id}`; const rows = ids.all(coll); let last = null;
      for (const { id } of rows) { const message = JSON.parse(store.q.row.get(coll, id).data); if (message.role === 'assistant') { last = message; break; } }
      store.summaries.set(thread.id, { count: rows.length, last });
    }
  } else for (const thread of store.data.threads) store.summary(thread);
  const durationMs = Math.round((performance.now() - started) * 100) / 100;
  global.gc(); const after = process.memoryUsage();
  const result = { retainedSummaryBytes: Buffer.byteLength(JSON.stringify([...store.summaries])), heapDeltaMB: mb(after.heapUsed - before.heapUsed), rssMB: mb(after.rss), durationMs, loadedConversations: store.data.threads.filter((thread) => store.isLoaded(thread)).length };
  store.close(); console.log(JSON.stringify(result));
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-memory-benchmark-'));
  try {
    const store = new SqliteStore(dir, defaults);
    for (let i = 0; i < 32; i++) store.data.threads.push({ id: `conversation-${i}`, project: dir, title: `Long conversation ${i}`, createdAt: i, messages: [{ id: `reply-${i}`, role: 'assistant', text: 'A long reply. '.repeat(16000), tools: [{ name: 'shell', output: 'A long tool log. '.repeat(16000) }], files: [{ rel: 'app.js', diff: '+ changed line\n'.repeat(8000) }], ok: true, ts: i }] });
    store.save(true); store.close();
    const run = (mode) => {
      const child = spawnSync(process.execPath, ['--expose-gc', '--no-warnings', __filename, '--worker', dir, mode], { encoding: 'utf8', timeout: 30000 });
      if (child.status !== 0) throw new Error(child.stderr || `Benchmark ${mode} failed`);
      return JSON.parse(child.stdout);
    };
    const previous = run('previous'); const optimized = run('optimized');
    const report = { fixture: '32 saved conversations with large replies, tool logs and diffs; no model loaded', node: process.version, platform: process.platform, arch: process.arch, previous, optimized, summaryCacheReductionPercent: Math.round((1 - optimized.retainedSummaryBytes / previous.retainedSummaryBytes) * 10000) / 100, scope: 'Sidebar summary cache only. This does not measure total app RAM, model weights, or GPU VRAM.' };
    const output = process.argv.indexOf('--output'); if (output >= 0) fs.writeFileSync(process.argv[output + 1], JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
