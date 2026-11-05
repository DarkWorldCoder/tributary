'use strict';
// Stable-output streaming through the actual patcher. No production GC flags.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { PerformanceObserver } = require('node:perf_hooks');
const repo = path.resolve(__dirname, '../..'), baseline = 'fd33cac';
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(setImmediate);
const collect = async () => { await tick(); global.gc(); await tick(); global.gc(); };
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function measure(mode, moduleFile, scenario) {
  const { createPatcher } = require(moduleFile);
  const { applyPatch } = await import(path.join(repo, 'ui/src/lib/message-patch.mjs'));
  const count = 32, rounds = 12, targetCodeUnits = 524288;
  const payload = () => {
    const ascii = crypto.randomBytes(393216).toString('base64');
    if (scenario === 'ascii') return ascii;
    if (scenario === 'lateUnicode') return Buffer.from(ascii + '😀', 'utf16le').toString('utf16le');
    const unit = scenario === 'latin1' ? 'café déjà vu ' : 'नमस्ते 世界 😀 e\u0301 \ud800 \udc01\n';
    // Materialize source storage before measuring comparison-cache allocation.
    return Buffer.from(unit.repeat(Math.ceil(targetCodeUnits / unit.length)), 'utf16le').toString('utf16le');
  };
  const messages = Array.from({ length: count }, (_, i) => ({ id: 'hash-' + i, role: 'assistant', text: 'stream', tools: [{ id: 'tool-' + i, status: 'done', output: payload() }], trace: [], ok: null }));
  const patcher = createPatcher(); patcher.full({ id: 'warm', role: 'assistant', text: 'warm' }); patcher.forget('warm');
  await collect(); const before = process.memoryUsage(), cacheStart = performance.now();
  for (const m of messages) patcher.full(m);
  const cacheCreationMs = performance.now() - cacheStart;
  await collect(); const retained = process.memoryUsage(), cache = patcher.stats();
  for (let round = 0; round < 2; round++) for (const m of messages) { m.text += ' warm'; assert.ok(patcher.patch(m)); }
  const received = new Map(messages.map(m => [m.id, clone(m)]));
  await collect();
  const gcEntries = []; const observer = new PerformanceObserver(list => { for (const e of list.getEntries()) if (gcEntries.length < 1024) gcEntries.push({ startTime: e.startTime, duration: e.duration, kind: e.detail.kind }); }); observer.observe({ entryTypes: ['gc'] });
  const samples = []; let serializedPatchBytes = 0; const cpuBefore = process.cpuUsage(), started = performance.now();
  for (let round = 0; round < rounds; round++) for (const m of messages) {
    m.text += ` ${round}`; const start = performance.now(), patch = patcher.patch(m); samples.push(performance.now() - start);
    assert.ok(patch); assert.deepEqual(Object.keys(patch), ['text'], 'stable tool output must not be retransmitted');
    serializedPatchBytes += Buffer.byteLength(JSON.stringify(patch)); received.set(m.id, applyPatch(received.get(m.id), patch));
  }
  const ended = performance.now(), cpu = process.cpuUsage(cpuBefore); await tick(); await tick(); observer.disconnect();
  const measuredGc = gcEntries.filter(e => e.startTime >= started && e.startTime < ended);
  for (const m of messages) { assert.deepEqual(received.get(m.id), clone(m)); m.tools[0].output += ' changed 🌍'; const patch = patcher.patch(m); assert.ok(patch.tools); received.set(m.id, applyPatch(received.get(m.id), clone(patch))); assert.deepEqual(received.get(m.id), clone(m)); m.ok = true; patcher.full(m); }
  assert.equal(patcher.stats().entries, 0); assert.equal(patcher.stats().accountedBytes, 0);
  return { mode, scenario, count, rounds, outputCodeUnitsPerReply: messages[0].tools[0].output.length, cache, retainedHeapDeltaBytes: retained.heapUsed - before.heapUsed, cacheCreationMs, measuredPatchCalls: samples.length, patchCallWallMs: samples.reduce((a, b) => a + b, 0), patchCallMedianMs: median(samples), patchCallP95Ms: [...samples].sort((a, b) => a - b)[Math.floor(samples.length * .95)], measuredLoopWallMs: ended - started, loopCpuMicroseconds: cpu, serializedPatchBytes, naturalGc: { count: measuredGc.length, totalDurationMs: measuredGc.reduce((a, b) => a + b.duration, 0), entries: measuredGc }, allUpdatesExact: true, stableToolsNotRetransmitted: true, finalBasesReleased: true, runtime: process.versions };
}
(async () => {
  if (process.argv[2] === '--child') { console.log(JSON.stringify(await measure(process.argv[3], process.argv[4], process.argv[5]))); return; }
  const output = process.argv[2]; if (!output || !path.isAbsolute(output)) throw Error('Pass an absolute output path.');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-patch-hashing-'));
  try {
    const old = path.join(scratch, 'message-patch.js'); fs.writeFileSync(old, execFileSync('git', ['show', baseline + ':core/message-patch.js'], { cwd: repo }));
    const runs = [];
    for (const scenario of ['ascii', 'unicode', 'lateUnicode', 'latin1']) for (let repeat = 0; repeat < 3; repeat++) {
      const pair = { scenario, repeat }; for (const mode of repeat % 2 ? ['rawOutput', 'baseline'] : ['baseline', 'rawOutput']) pair[mode] = JSON.parse(execFileSync(process.execPath, ['--expose-gc', __filename, '--child', mode, mode === 'baseline' ? old : path.join(repo, 'core/message-patch.js'), scenario], { cwd: repo, encoding: 'utf8', maxBuffer: 2 * 1024 ** 2 }));
      runs.push(pair); console.log('Completed', scenario, repeat);
    }
    const medians = Object.fromEntries(['ascii', 'unicode', 'lateUnicode', 'latin1'].map(scenario => [scenario, Object.fromEntries(['baseline', 'rawOutput'].map(mode => [mode, Object.fromEntries(['patchCallWallMs', 'patchCallMedianMs', 'patchCallP95Ms', 'cacheCreationMs', 'retainedHeapDeltaBytes', 'serializedPatchBytes'].map(key => [key, median(runs.filter(r => r.scenario === scenario).map(r => r[mode][key]))]))]))]));
    fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), baseline, scope: 'Actual patcher CPU work on 32 stable large outputs and 384 tiny text updates per process. Three fresh alternating subprocess pairs per character scenario. Timing excludes final exact-content verification; natural GC can occur during measured work. Diagnostic GC is outside timing. This is not whole-app latency/RAM or a model-generation benchmark.', medians, runs, sourceHashes: Object.fromEntries(['core/message-patch.js', 'scripts/performance/patch-hashing.cjs'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')])) }, null, 2) + '\n'); console.log(JSON.stringify(medians));
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
