'use strict';
// Real Hub turns through a local stand-in CLI, not model inference. Each process
// gets its own identical SQLite seed. Diagnostic GC is never enabled in the app.
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const v8 = require('node:v8'); const { spawnSync } = require('node:child_process');
const { Hub } = require('../../core/hub'); const { SqliteStore, MemorySecrets } = require('../../core/store'); const { bindMessageDelivery } = require('../../core/message-delivery');
const defaults = { version: 1, projects: [], threads: [], gateways: [], notifications: [], settings: {} };
const tick = () => new Promise(setImmediate); const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item)).digest('hex');
const pss = () => { try { return Number(/^Pss:\s+(\d+) kB$/m.exec(fs.readFileSync('/proc/self/smaps_rollup', 'utf8'))[1]); } catch { return null; } };
async function collect() { global.gc(); await tick(); global.gc(); await tick(); }
function sample() { return { ...process.memoryUsage(), pssKiB: pss(), physicalHeapBytes: v8.getHeapStatistics().total_physical_size }; }
const agent = { id: 'fixture', name: 'Fixture CLI', protocol: 'codex-exec', available: true, headless: true, path: process.execPath, stdinPrompt: true, args: () => ['-e', `process.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-session'}));console.log(JSON.stringify({type:'item.completed',item:{id:'reply',type:'agent_message',text:'Fixture completed the requested read-only task.'}}));console.log(JSON.stringify({type:'turn.completed'}));});`] };
async function worker(seed, mode, count) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-history-worker-')); const profile = path.join(root, 'profile'); fs.mkdirSync(profile); fs.copyFileSync(seed, path.join(profile, 'tributary.db'));
  const hub = new Hub({ dataDir: profile, home: root, secrets: new MemorySecrets(), historyCache: mode === 'managed' }); hub.agents = [agent]; let deliveries = 0;
  const dispose = bindMessageDelivery(hub, (_name, data) => { deliveries++; JSON.stringify(data); });
  try {
    // Metadata changes are common to both cases. Their cost is outside the timed visits.
    for (const thread of hub.store.data.threads) thread.project = root;
    hub.store.data.projects = [{ path: root, name: 'Synthetic project', trusted: true }]; hub.store.save(true);
    await collect(); const baseline = sample(); const expected = new Map(); const turns = [];
    const started = performance.now();
    for (const thread of hub.store.data.threads.slice(0, count)) {
      const start = performance.now(); const reply = await hub.send({ threadId: thread.id, agentId: 'fixture', text: 'Read this saved chat and respond.', mode: 'read' });
      if (reply.ok !== true || reply.text !== 'Fixture completed the requested read-only task.') throw new Error('Stand-in CLI turn failed');
      turns.push(performance.now() - start);
      hub.withHistoryOperation(() => { const live = hub.thread(thread.id); if (live.messages.length !== 66 || !live.agentSessions.fixture) throw new Error('Turn/session persistence shape failed'); expected.set(thread.id, digest(live)); });
    }
    const elapsedMs = performance.now() - started;
    await wait(1900); const naturalIdle = sample(); await collect(); const retained = sample();
    const loaded = hub.store.data.threads.filter((thread) => hub.store.isLoaded(thread)).length;
    if (loaded !== (mode === 'managed' ? 0 : count) || hub.histories?.pins.size || hub.histories?.unmanaged.size) throw new Error('Writer ownership did not settle');
    const coldReads = [];
    for (const thread of hub.store.data.threads.slice(0, count)) {
      const start = performance.now(); const same = hub.withHistoryOperation(() => digest(hub.readThread(thread.id)) === expected.get(thread.id));
      coldReads.push(performance.now() - start); if (!same) throw new Error('Exact reopened history parity failed');
    }
    // Full unscoped saves after release must not delete the unloaded histories.
    hub.store.save(true);
    const reloaded = new SqliteStore(profile, defaults);
    try { for (const thread of reloaded.data.threads.slice(0, count)) if (digest(reloaded.readThread(thread)) !== expected.get(thread.id)) throw new Error('Durable history parity failed'); }
    finally { reloaded.close(); }
    const percentile = (values, p) => values.toSorted((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
    return { mode, chats: count, realHubTurns: count, loadedWriterHistories: loaded, deliveries, baseline, naturalIdle, retainedAfterDiagnosticGc: retained,
      heapDeltaBytes: retained.heapUsed - baseline.heapUsed, pssDeltaKiB: retained.pssKiB - baseline.pssKiB, elapsedMs,
      turnLatencyMs: { median: percentile(turns, .5), p95: percentile(turns, .95) }, transportReadLatencyMs: { median: percentile(coldReads, .5), p95: percentile(coldReads, .95) },
      exactReopenParity: true, fullSaveAfterReleaseParity: true, productionForcedGc: false };
  } finally { dispose(); hub.fileWatches.close(); hub.store.close(); fs.rmSync(root, { recursive: true, force: true }); }
}
async function main() {
  if (process.argv[2] === '--worker') { process.stdout.write(JSON.stringify(await worker(process.argv[3], process.argv[4], Number(process.argv[5])))); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-history-cache-bench-'));
  try {
    const store = new SqliteStore(root, defaults);
    for (let i = 0; i < 32; i++) store.data.threads.push({ id: `chat-${i}`, title: `Saved chat ${i}`, project: root, createdAt: i, updatedAt: i, agentSessions: {}, messages: Array.from({ length: 64 }, (_, j) => ({ id: `${i}-${j}`, role: 'assistant', agent: 'previous', text: `${j % 10}:` + 'source context '.repeat(2200), tools: [{ name: 'Bash', output: 'tool log '.repeat(400) }], files: [], notices: [], ok: true })) });
    store.save(true); store.close(); const cases = [];
    for (let round = 0; round < 3; round++) for (const mode of round % 2 ? ['managed', 'compatibility'] : ['compatibility', 'managed']) {
      const result = spawnSync(process.execPath, ['--expose-gc', '--no-warnings', __filename, '--worker', path.join(root, 'tributary.db'), mode, '32'], { encoding: 'utf8', timeout: 240000 });
      if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'History benchmark failed');
      cases.push({ round, ...JSON.parse(result.stdout) });
    }
    const files = ['core/history-cache.js','core/store.js','core/hub.js','core/activity.js','core/message-delivery.js','scripts/performance/history-cache.cjs'];
    const report = { date: new Date().toISOString(), runtime: { node: process.version, platform: process.platform, arch: process.arch },
      fixture: '32 saved chats, 64 long replies and tool logs each; one actual read-only Hub turn per chat through a deterministic local stand-in CLI; coalesced delivery and 1.9 s idle settlement; three alternating process pairs.',
      boundaries: ['No external providers or model inference', 'Main Node process only, not the full Electron tree or GPU', 'Forced GC only at explicit diagnostic sample boundaries', 'Compatibility mode keeps mutable histories; managed mode uses the desktop ownership policy', 'Read latency includes JSON hashing in both cases; not an isolated SQLite or UI-render latency'],
      sourceHashes: Object.fromEntries(files.map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../..', file))).digest('hex')])), cases };
    const index = process.argv.indexOf('--output'); if (index !== -1) fs.writeFileSync(process.argv[index + 1], JSON.stringify(report, null, 2) + '\n');
    for (const mode of ['compatibility','managed']) { const rows = cases.filter((row) => row.mode === mode); const median = (key) => rows.map((row) => row[key]).sort((a,b) => a-b)[1]; console.log(JSON.stringify({ mode, runs: rows.length, medianHeapDeltaBytes: median('heapDeltaBytes'), medianPssDeltaKiB: median('pssDeltaKiB'), medianElapsedMs: median('elapsedMs'), loadedWriterHistories: rows.map((row) => row.loadedWriterHistories) })); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
