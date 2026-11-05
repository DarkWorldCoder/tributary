'use strict';
// Synthetic prompts and a deliberately stalled async transport. No providers,
// user profiles, Electron IPC or VS Code processes are used in this experiment.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { performance } = require('node:perf_hooks');
const { spawnSync, execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
const tick = () => new Promise(setImmediate);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const collect = async () => { await tick(); global.gc(); await tick(); global.gc(); };
const prompt = index => ({ id: `user-${index}`, role: 'user', text: Buffer.alloc(24 * 1024, 65 + index % 26).toString('base64') + `-${index}`, ts: index });

async function snapshots(mode, modules) {
  const { createPatcher } = require(path.join(modules, 'message-patch.js'));
  await collect(); const before = process.memoryUsage(); let patcher = createPatcher();
  const count = 800; let promptCharacters = 0; const start = performance.now();
  for (let index = 0; index < count; index++) { const message = prompt(index); promptCharacters += message.text.length; patcher.full(message); }
  const populateMs = performance.now() - start;
  await collect(); const retained = process.memoryUsage();
  // Query after the memory sample; generating these new objects cannot account
  // for the measured retention. A null patch means there is no tracked base.
  let tracked = 0;
  for (let index = 0; index < count; index++) if (patcher.patch(prompt(index)) !== null) tracked++;
  patcher = null; await collect(); const released = process.memoryUsage();
  return { workload: 'non-streaming-prompts', mode, count, promptCharacters, populateMs, trackedAfterFull: tracked, before, retainedAfterDiagnosticGc: retained, releasedAfterDiagnosticGc: released, retainedHeapDeltaBytes: retained.heapUsed - before.heapUsed, releasedHeapDeltaBytes: released.heapUsed - before.heapUsed };
}

async function delivery(mode, modules) {
  const { bindMessageDelivery } = require(path.join(modules, 'message-delivery.js'));
  const { applyPatch } = await import(path.join(repo, 'ui/src/lib/message-patch.mjs'));
  const hub = new EventEmitter(); const queue = [];
  let held = 0, peakHeld = 0, peakQueue = 0, queuedBytes = 0, peakQueuedBytes = 0, posts = 0;
  hub.holdHistory = () => { held++; peakHeld = Math.max(peakHeld, held); let owned = true; return () => { if (owned) { held--; owned = false; } }; };
  const dispose = bindMessageDelivery(hub, (name, data) => {
    const wire = JSON.stringify({ name, data }); const bytes = Buffer.byteLength(wire); queuedBytes += bytes; peakQueuedBytes = Math.max(peakQueuedBytes, queuedBytes); posts++;
    return new Promise(resolve => { queue.push({ wire, bytes, resolve }); peakQueue = Math.max(peakQueue, queue.length); });
  }, 0);
  const message = { id: 'reply', role: 'assistant', text: '', tools: [{ id: 'tool', status: 'running', output: '' }], trace: [], permissions: [], ok: null };
  const emit = name => hub.emit(name, { threadId: 'synthetic-chat', message });
  await collect(); const before = process.memoryUsage(); const started = performance.now();
  emit('message');
  for (let index = 0; index < 240; index++) {
    message.text += `${index}:` + 'synthetic-stream-content '.repeat(170);
    message.tools[0].output = `${index}:` + 'synthetic-tool-output '.repeat(700);
    if (index % 40 === 0) { message.trace.push({ kind: 'tool', toolIndex: 0, textOffset: message.text.length }); message.permissions.push({ id: `permission-${index}`, state: 'allowed' }); }
    emit('event'); await wait(1);
  }
  message.ok = true; message.tools[0].status = 'done'; emit('message');
  const blockedElapsedMs = performance.now() - started;
  await collect(); const blocked = process.memoryUsage();
  const atBlocked = { held, posts, queued: queue.length, queuedBytes };
  let received = null;
  const deadline = Date.now() + 10000;
  while (queue.length || held) {
    if (Date.now() > deadline) throw Error('Transport did not drain');
    const packet = queue.shift();
    if (packet) {
      queuedBytes -= packet.bytes; const { name, data } = JSON.parse(packet.wire);
      received = name === 'message' ? data.message : applyPatch(received, data.patch);
      if (!received) throw Error('Patch base was lost'); packet.resolve(true);
    }
    await tick();
  }
  if (hash(received) !== hash(message)) throw Error('Final message differs');
  dispose(); await collect();
  return { workload: 'blocked-async-delivery', mode, emittedStreamUpdates: 240, blockedElapsedMs, before, blockedAfterDiagnosticGc: blocked, blockedHeapDeltaBytes: blocked.heapUsed - before.heapUsed, atBlocked, peakHeld, peakQueue, peakQueuedBytes, totalPosts: posts, finalQueuedBytes: queuedBytes, finalHeld: held, finalTextCharacters: message.text.length, finalChecksum: hash(received), finalMatches: true, listenersAfterDispose: hub.listenerCount('event') + hub.listenerCount('message') };
}

async function main() {
  if (process.argv[2] === '--worker') {
    const [, , , mode, workload, modules] = process.argv;
    process.stdout.write(JSON.stringify(await (workload === 'prompts' ? snapshots(mode, modules) : delivery(mode, modules)))); return;
  }
  const output = process.argv[2]; if (!output || !path.isAbsolute(output)) throw Error('Usage: node scripts/performance/message-delivery.cjs /absolute/report.json');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-message-delivery-')); const baselineRevision = 'b3289ae';
  try {
    const baseline = path.join(root, 'baseline'); fs.mkdirSync(baseline);
    const previousHashes = {};
    for (const file of ['message-delivery.js', 'message-patch.js']) {
      const source = execFileSync('git', ['show', `${baselineRevision}:core/${file}`], { cwd: repo, encoding: 'utf8' });
      fs.writeFileSync(path.join(baseline, file), source); previousHashes[file] = crypto.createHash('sha256').update(source).digest('hex');
    }
    const results = [];
    for (let round = 0; round < 3; round++) {
      for (const workload of ['prompts', 'delivery']) {
        for (const mode of round % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
          const child = spawnSync(process.execPath, ['--expose-gc', __filename, '--worker', mode, workload, mode === 'baseline' ? baseline : path.join(repo, 'core')], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
          if (child.status !== 0) throw Error(child.stderr || 'Message-delivery benchmark failed');
          const row = { round, ...JSON.parse(child.stdout) }; results.push(row);
          console.log(JSON.stringify({ round, mode, workload, retainedHeapDeltaBytes: row.retainedHeapDeltaBytes, tracked: row.trackedAfterFull, peakQueue: row.peakQueue, peakHeld: row.peakHeld, peakQueuedBytes: row.peakQueuedBytes, matches: row.finalMatches }));
        }
      }
    }
    if (new Set(results.filter(row => row.workload === 'blocked-async-delivery').map(row => row.finalChecksum)).size !== 1) throw Error('Cross-policy final output differs');
    const files = ['core/message-patch.js', 'core/message-delivery.js', 'test/message-patch.test.js', 'test/message-delivery.test.js', 'scripts/performance/message-delivery.cjs'];
    const report = { date: new Date().toISOString(), runtime: process.versions, platform: process.platform, arch: process.arch, baselineRevision, previousHashes, sourceHashes: Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')])), results, limitations: ['Isolated Node fixtures, not actual VS Code webview or Electron IPC throughput/total application RAM.', 'Memory samples use forced diagnostic GC only; production delivery does not invoke GC.', 'Blocked wire bytes count explicitly retained JSON in the fixture transport, not physical IPC/native memory. History leases are owner counts, not separate history copies.', 'The bounded queue is per message and applies when deliver returns an unresolved Promise. Desktop webContents.send returns synchronously and needs a separate acknowledgement protocol to bound its downstream IPC queue.', 'Coalescing retains the latest complete message state and computes the next patch only when sending. Intermediate UI snapshots can be skipped; final text/tools/trace/permission state are checked exactly.'] };
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
