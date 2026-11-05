'use strict';
// Isolated retention experiments. Forced GC is a measurement boundary, not app behavior.
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const crypto = require('node:crypto'); const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url'); const { SqliteStore } = require('../../core/store');
const root = path.resolve(__dirname, '../..');
const defaults = { version: 1, threads: [], projects: [], gateways: [], notifications: [], settings: {} };
const mb = (bytes) => Math.round(bytes / 1024 ** 2 * 1000) / 1000;
const rounded = (value) => Math.round(value * 1000) / 1000;
const size = (value) => Buffer.byteLength(JSON.stringify(value));
const sourceFiles = ['core/store.js', 'core/hub.js', 'desktop/main.js', 'vscode/extension.js', 'ui/src/lib/document-cache.mjs', 'ui/src/components/document-panel.tsx', 'scripts/performance/retention.cjs'];
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); const n = sorted.length; return rounded(n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2); };

async function worker(kind, dir, mode) {
  const { retainDocumentDrafts } = await import(pathToFileURL(path.join(root, 'ui/src/lib/document-cache.mjs')).href);
  const store = kind === 'histories' ? new SqliteStore(dir, defaults) : null;
  global.gc(); const before = process.memoryUsage();
  let cache = {}; let checksum = 0; const firstReads = []; const repeatReads = [];
  if (store) {
    for (let cycle = 0; cycle < 2; cycle++) for (const thread of store.data.threads) {
      const start = performance.now();
      const view = mode === 'previous' ? thread : store.readThread(thread);
      checksum += view.messages.length + view.messages[0].text.length;
      (cycle ? repeatReads : firstReads).push(performance.now() - start);
    }
  } else {
    for (let index = 0; index < 40; index++) {
      // JSON round-trip flattens strings like a real transport response rather than
      // measuring shared repeat() ropes. Saved content stays within the document limit.
      const saved = JSON.parse(JSON.stringify({ title: `Document ${index}`, content: `${index}:` + 'current text '.repeat(16000), revision: 6,
        history: Array.from({ length: 5 }, (_, version) => ({ title: `Document ${index}`, revision: version + 1, content: `${index}/${version}:` + 'previous text '.repeat(14000) })) }));
      const entry = { saved, title: saved.title, content: saved.content + (index < 2 ? 'unsaved' : '') };
      cache[`document-${index}`] = entry;
      if (mode === 'optimized') cache = retainDocumentDrafts(cache, `document-${index}`);
      checksum += saved.content.length;
    }
  }
  // Drop loop-local transport responses before collecting. No polling/window/model involved.
  await new Promise(setImmediate); global.gc(); const after = process.memoryUsage();
  const loaded = store ? store.data.threads.filter((thread) => store.isLoaded(thread)) : [];
  const retainedBytes = store ? loaded.reduce((sum, thread) => sum + size(thread.messages), 0) : size(cache);
  if (store && checksum !== 2 * 32 * (48 + (String(0).length + 1 + 'reply text '.length * 1100))) throw new Error('History parity failed');
  if (!store && (cache['document-0'].content === cache['document-0'].saved.content || cache['document-1'].content === cache['document-1'].saved.content || !cache['document-39'])) throw new Error('Dirty/current document retention failed');
  const result = { mode, checksum, beforeHeapMB: mb(before.heapUsed), afterHeapMB: mb(after.heapUsed), heapDeltaMB: mb(after.heapUsed - before.heapUsed), rssMB: mb(after.rss), retainedJsonBytes: retainedBytes,
    ...(store ? { loadedConversations: loaded.length, retainedMessageFingerprints: [...store.snap.keys()].filter((key) => key.startsWith('m:')).length, firstReadMedianMs: median(firstReads), repeatReadMedianMs: median(repeatReads) } : { retainedDocuments: Object.keys(cache).length, dirtyDocumentsRetained: 2 }), parity: true };
  store?.close(); process.stdout.write(JSON.stringify(result));
}

async function main() {
  if (process.argv[2] === '--worker') return worker(process.argv[3], process.argv[4], process.argv[5]);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-retention-benchmark-'));
  try {
    const store = new SqliteStore(scratch, defaults);
    for (let index = 0; index < 32; index++) store.data.threads.push({ id: `chat-${index}`, title: `History ${index}`, project: scratch, createdAt: index,
      messages: Array.from({ length: 48 }, (_, message) => ({ id: `${index}-${message}`, role: 'assistant', text: `${message % 10}:` + 'reply text '.repeat(1100), tools: [{ output: `${index}/${message}:` + 'tool output '.repeat(300) }], ok: true, ts: message })) });
    store.save(true); store.close();
    const run = (kind, mode) => {
      const child = spawnSync(process.execPath, ['--expose-gc', '--no-warnings', __filename, '--worker', kind, scratch, mode], { encoding: 'utf8', timeout: 120000 });
      if (child.status !== 0) throw new Error(child.stderr || `${kind}/${mode} failed`);
      return JSON.parse(child.stdout);
    };
    const cases = ['histories', 'documents'].map((kind) => {
      const previous = run(kind, 'previous'); const optimized = run(kind, 'optimized');
      if (previous.checksum !== optimized.checksum) throw new Error(`${kind} checksum mismatch`);
      return { kind, previous, optimized, retainedJsonReductionPercent: rounded((1 - optimized.retainedJsonBytes / previous.retainedJsonBytes) * 100) };
    });
    const report = { node: process.version, platform: process.platform, arch: process.arch, sourceFiles,
      sourceSha256: crypto.createHash('sha256').update(sourceFiles.map((file) => `${file}\n${fs.readFileSync(path.join(root, file), 'utf8')}`).join('\n')).digest('hex'),
      fixtures: { histories: '32 persisted chats, 48 long replies each, two complete view cycles; each mode has its own process', documents: '40 saved documents, 5 old versions each, 2 dirty drafts and 1 current document; each mode has its own process' }, cases,
      scope: 'Retention of SQLite writer history induced by read-only views, and the saved-document panel cache only. Post-GC heap/RSS are noisy process samples. Not total Electron RAM, renderer retention, native page-cache size, UI latency, installer or model/VRAM performance. The previous document policy is simulated unbounded retention; the previous history path hydrates each thread.messages. Reopening histories trades a fresh SQLite parse for avoiding permanent writer retention.' };
    const at = process.argv.indexOf('--output'); if (at >= 0) fs.writeFileSync(path.resolve(process.argv[at + 1]), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
