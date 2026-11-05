'use strict';
// Current-policy working set, not a claimed optimization. Disposable SQLite only.
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process'); const { SqliteStore } = require('../../core/store');
const v8 = require('node:v8');
const defaults = { version: 1, threads: [], projects: [], gateways: [], notifications: [], settings: {} };
const tick = () => new Promise(setImmediate);
async function collect() { global.gc(); await tick(); global.gc(); await tick(); }
function pss() { try { return Number(/^Pss:\s+(\d+) kB$/m.exec(fs.readFileSync('/proc/self/smaps_rollup', 'utf8'))[1]); } catch { return null; } }
async function visit(store, count, mode) {
  let checksum = 0;
  for (const thread of store.data.threads.slice(0, count)) {
    const value = mode === 'writer' ? thread : store.readThread(thread);
    checksum += value.messages.length + value.messages[0].text.length;
    if (mode === 'writer') {
      const message = { id: `saved-${thread.id}`, role: 'assistant', text: 'Saved synthetic completed writer turn.', ok: true };
      value.messages.push(message); store.save(true, thread.id, message.id);
    }
    if (mode === 'view-yielded') await tick();
  }
  return checksum;
}
async function worker(seed, mode, count) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-writer-worker-'));
  fs.copyFileSync(seed, path.join(dir, 'tributary.db')); let store;
  try {
    store = new SqliteStore(dir, defaults); await collect(); const baseline = process.memoryUsage(); const baselinePss = pss(); const baselineV8 = v8.getHeapStatistics();
    const start = performance.now(); const checksum = await visit(store, count, mode); const elapsedMs = performance.now() - start;
    await collect(); const held = process.memoryUsage(); const heldPss = pss(); const heldV8 = v8.getHeapStatistics();
    const heldSpaces = Object.fromEntries(v8.getHeapSpaceStatistics().map((space) => [space.space_name, { usedBytes: space.space_used_size, physicalBytes: space.physical_space_size, sizeBytes: space.space_size }]));
    // Diagnostic attribution only: before serializing result rows. This asks
    // SQLite to release memory, but never evicts/changes writer objects in JS.
    store.db.exec('PRAGMA shrink_memory'); await collect(); const shrunkPss = pss(); const shrunkV8 = v8.getHeapStatistics();
    let idle = null;
    if (count === 32) { await new Promise((resolve) => setTimeout(resolve, 1500)); const stats = v8.getHeapStatistics(); idle = { waitedMs: 1500, pssKiB: pss(), usedHeapBytes: stats.used_heap_size, physicalHeapBytes: stats.total_physical_size, forcedGcDuringWait: false }; }
    const loaded = store.data.threads.filter((thread) => store.isLoaded(thread));
    let retainedJsonBytes = 0; let savedTurns = 0;
    for (const thread of loaded) { retainedJsonBytes += Buffer.byteLength(JSON.stringify(thread.messages)); savedTurns += thread.messages.filter((message) => message.id === `saved-${thread.id}`).length; }
    if (loaded.length !== (mode === 'writer' ? count : 0) || savedTurns !== (mode === 'writer' ? count : 0)) throw new Error('Working-set ownership parity failed');
    if (checksum !== count * (64 + 2 + 'source context '.length * 2200)) throw new Error('History payload parity failed');
    store.close(); store = null;
    const reopened = new SqliteStore(dir, defaults);
    try { for (const thread of reopened.data.threads.slice(0, count)) {
      const messages = reopened.readThread(thread).messages;
      if (messages.length !== 64 + (mode === 'writer' ? 1 : 0)) throw new Error('Persisted message count mismatch');
      if (mode === 'writer' && messages.at(-1).id !== `saved-${thread.id}`) throw new Error('Completed writer did not persist');
    } } finally { reopened.close(); }
    process.stdout.write(JSON.stringify({ mode, visited: count, loadedConversations: loaded.length, savedTurns, checksum, elapsedMs: Math.round(elapsedMs * 1000) / 1000,
      baselineHeapBytes: baseline.heapUsed, retainedHeapBytes: held.heapUsed, postGcHeapDeltaBytes: held.heapUsed - baseline.heapUsed,
      baselinePssKiB: baselinePss, retainedPssKiB: heldPss, pssDeltaKiB: baselinePss != null && heldPss != null ? heldPss - baselinePss : null,
      v8TotalHeapBytes: { baseline: baselineV8.total_heap_size, held: heldV8.total_heap_size, afterSqliteShrink: shrunkV8.total_heap_size },
      v8PhysicalHeapBytes: { baseline: baselineV8.total_physical_size, held: heldV8.total_physical_size, afterSqliteShrink: shrunkV8.total_physical_size },
      diagnosticAfterSqliteShrinkPssKiB: shrunkPss,
      heldHeapSpaces: heldSpaces, idle,
      retainedMessageJsonBytes: retainedJsonBytes, persistenceParity: true }));
  } finally { store?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
async function main() {
  if (process.argv[2] === '--worker') return worker(process.argv[3], process.argv[4], Number(process.argv[5]));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-writer-baseline-'));
  try {
    const store = new SqliteStore(scratch, defaults);
    for (let index = 0; index < 32; index++) store.data.threads.push({ id: `chat-${index}`, project: scratch, title: `Synthetic ${index}`, createdAt: index,
      messages: Array.from({ length: 64 }, (_, message) => ({ id: `${index}-${message}`, role: 'assistant', text: `${message % 10}:` + 'source context '.repeat(2200), tools: [{ output: `${index}/${message}:` + 'tool log '.repeat(400) }], ok: true })) });
    store.save(true); store.close();
    const cases = [];
    const matrix = [0, 4, 16, 32].flatMap((count) => ['view','writer'].map((mode) => ({ count, mode })));
    matrix.push({ count: 32, mode: 'view-yielded' });
    for (const { count, mode } of matrix) {
      const child = spawnSync(process.execPath, ['--expose-gc','--no-warnings',__filename,'--worker',path.join(scratch,'tributary.db'),mode,String(count)], { encoding: 'utf8', timeout: 120000 });
      if (child.status !== 0) throw new Error(child.stderr || 'Writer baseline failed'); cases.push(JSON.parse(child.stdout));
    }
    const files = ['core/store.js','core/hub.js','scripts/performance/writer-working-set.cjs'];
    const report = { checkedOn: new Date().toISOString(), runtime: { node: process.version, platform: process.platform, arch: process.arch },
      fixture: '32 saved chats, each with 64 long replies and tool logs; each case copies the seed SQLite database into its own disposable directory. Writer mode hydrates and persists one completed synthetic turn per visited chat. View mode reads transport snapshots only.',
      scope: 'Current-policy working-set baseline, not an old/new improvement. Isolated Node processes: view/writer cases run a tight burst rather than realistic UI pacing; view-yielded additionally yields to the event loop between each snapshot. Explicit diagnostic GC before/after visits, original payload and persisted-turn checks. Heap/PSS sampled before result serialization and reopened parity validation. Diagnostic PRAGMA shrink_memory runs only after the ordinary held sample, with writer objects unchanged, to explore SQLite attribution; it is not a production setting or a precise decomposition of PSS. The 32-chat cases then wait 1500 ms without forced GC before an idle sample. PSS is this standalone process, not Electron or local-model RAM. No claim that these synthetic Store operations reproduce full real-agent lifetimes, and no automatic eviction is implemented by this benchmark.',
      sourceSha256: Object.fromEntries(files.map((file) => [file,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../..',file))).digest('hex')])), cases };
    const at = process.argv.indexOf('--output'); if (at >= 0) { if (!process.argv[at + 1]) throw new Error('Missing output path'); fs.writeFileSync(process.argv[at + 1], JSON.stringify(report,null,2)+'\n'); }
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
  } finally { fs.rmSync(scratch,{recursive:true,force:true}); }
}
main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
