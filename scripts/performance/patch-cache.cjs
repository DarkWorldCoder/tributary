'use strict';
// Compare retained delta bases in fresh subprocesses. GC is diagnostic only.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '../..');
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(setImmediate);
const collect = async () => { await tick(); global.gc(); await tick(); global.gc(); };
const cases = { count: { count: 256, bytes: 3072 }, size: { count: 32, bytes: 393216 }, stable: { count: 32, bytes: 393216, stableTools: true }, largeTool: { count: 1, bytes: 4718592, stableTools: true } };
async function measure(mode, moduleFile, scenario) {
  const { createPatcher } = require(moduleFile);
  const { applyPatch } = await import(path.join(repo, 'ui/src/lib/message-patch.mjs'));
  const config = cases[scenario];
  const messages = Array.from({ length: config.count }, (_, i) => ({ id: `reply-${i}`, role: 'assistant', text: `Reply ${i}`, thinking: '', tools: [{ id: `tool-${i}`, status: 'running', output: crypto.randomBytes(config.bytes).toString('base64') }], trace: [], permissions: [], ok: null }));
  const patcher = createPatcher(); patcher.full({ id: 'warm', role: 'assistant', text: 'warm' }); patcher.forget('warm');
  await collect(); const before = process.memoryUsage();
  const cacheStart = performance.now(); for (const m of messages) patcher.full(m); const cacheCreationMs = performance.now() - cacheStart;
  await collect(); const retained = process.memoryUsage();
  const cache = patcher.stats?.() || { entries: messages.length, accountedBytes: null };
  if (mode === 'bounded') { assert.ok(cache.entries <= cache.maxEntries); assert.ok(cache.accountedBytes <= cache.maxBytes); }
  const received = new Map(messages.map(m => [m.id, clone(m)]));
  let fullFallbacks = 0, patches = 0, serializedUpdateBytes = 0;
  const updateStart = performance.now();
  for (let round = 0; round < 2; round++) for (const m of [...messages].reverse()) {
    m.text += ` update-${round}`; if (!config.stableTools) { m.tools[0].status = 'done'; m.tools[0].output += ` result-${round}`; }
    m.permissions = round ? [] : [{ id: 'permission', state: 'allowed' }];
    const patch = patcher.patch(m);
    if (patch === null) { patcher.full(m); received.set(m.id, clone(m)); fullFallbacks++; serializedUpdateBytes += Buffer.byteLength(JSON.stringify(m)); }
    else { received.set(m.id, applyPatch(received.get(m.id), clone(patch))); patches++; serializedUpdateBytes += Buffer.byteLength(JSON.stringify(patch)); }
    assert.deepEqual(received.get(m.id), clone(m));
  }
  const updatesAndVerificationMs = performance.now() - updateStart;
  for (const m of messages) { m.ok = true; patcher.full(m); assert.equal(patcher.patch(m), null); }
  if (patcher.stats) { assert.equal(patcher.stats().entries, 0); assert.equal(patcher.stats().accountedBytes, 0); }
  return { mode, scenario, config, before, retained, retainedHeapDeltaBytes: retained.heapUsed - before.heapUsed, cache, cacheCreationMs, updatesAndVerificationMs, processLifetimeMaxRssKiB: process.resourceUsage().maxRSS, fullFallbacks, patches, serializedUpdateBytes, everyUpdateExact: true, allFinalBasesReleased: true, runtime: process.versions };
}
(async () => {
  if (process.argv[2] === '--child') { console.log(JSON.stringify(await measure(process.argv[3], process.argv[4], process.argv[5]))); return; }
  const output = process.argv[2]; if (!output || !path.isAbsolute(output)) throw Error('Pass an absolute report path');
  const baseline = '5140e16', scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-patch-cache-'));
  try {
    const old = path.join(scratch, 'message-patch.js'); fs.writeFileSync(old, execFileSync('git', ['show', baseline + ':core/message-patch.js'], { cwd: repo }));
    const runs = [];
    for (const scenario of Object.keys(cases)) for (let repeat = 0; repeat < 3; repeat++) {
      const pair = { scenario, repeat };
      for (const mode of repeat % 2 ? ['bounded', 'baseline'] : ['baseline', 'bounded']) pair[mode] = JSON.parse(execFileSync(process.execPath, ['--expose-gc', __filename, '--child', mode, mode === 'baseline' ? old : path.join(repo, 'core/message-patch.js'), scenario], { cwd: repo, encoding: 'utf8', maxBuffer: 2 * 1024 ** 2 }));
      runs.push(pair);
    }
    const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const medians = Object.fromEntries(Object.keys(cases).map(scenario => [scenario, Object.fromEntries(['baseline', 'bounded'].map(mode => [mode, Object.fromEntries(['retainedHeapDeltaBytes', 'fullFallbacks', 'patches', 'serializedUpdateBytes'].map(metric => [metric, median(runs.filter(r => r.scenario === scenario).map(r => r[mode][metric]))]))]))]));
    const report = { date: new Date().toISOString(), baseline, scope: 'Retained comparison bases only; preallocated live sources excluded from heap deltas. Diagnostic post-GC heap is not a total app RAM ceiling. Cache accounting is a policy weight, not actual heap bytes. Full fallback can increase wire work under pressure.', medians, runs, sourceHashes: Object.fromEntries(['core/message-patch.js', 'scripts/performance/patch-cache.cjs'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')])) };
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(medians));
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
