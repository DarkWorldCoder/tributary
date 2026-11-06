'use strict';
// Isolated parser work, not a whole-app or hardware cache-miss benchmark.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process'); const { pathToFileURL } = require('node:url'); const { PerformanceObserver } = require('node:perf_hooks'); const inspector = require('node:inspector');
const repo = path.resolve(__dirname, '../..'), baseline = 'fdcf3b18f7b4acefaa5784a80554d7ed35d15657';
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const tick = () => new Promise(setImmediate);
async function collect() { await tick(); global.gc(); await tick(); global.gc(); await tick(); }
function fixture(name) {
  const header = 'diff --git a/source.ts b/source.ts\n--- a/source.ts\n+++ b/source.ts\n'; let diff, expected, iterations;
  if (name === 'dense' || name === 'largeStats') {
    const count = name === 'dense' ? 700 : 20000; iterations = name === 'dense' ? 800 : 100;
    diff = header + `@@ -1,${count} +1,${count} @@\n` + Array.from({ length: count }, (_, i) => `-const old_${i} = ${i};\n`).join('') + Array.from({ length: count }, (_, i) => `+const new_${i} = ${i};\n`).join('');
    expected = { stats: { added: count, removed: count }, ...(name === 'largeStats' ? {} : { markers: Array.from({ length: count }, (_, i) => ({ line: i + 1, added: 1, removed: i ? 0 : count })) }) };
  } else {
    const count = name === 'tiny' ? 1 : 64, padding = name === 'longLines' ? 'x'.repeat(4096) : 'value'; iterations = name === 'tiny' ? 5000 : name === 'longLines' ? 400 : 1500;
    diff = header + Array.from({ length: count }, (_, i) => { const at = i * 20 + 1; return `@@ -${at},3 +${at},3 @@\n before ${padding}\n-old ${padding}\n+new ${padding}\n after ${padding}\n`; }).join('');
    expected = { markers: Array.from({ length: count }, (_, i) => ({ line: i * 20 + 2, added: 1, removed: 1 })), stats: { added: count, removed: count } };
  }
  // A materialized input is shared by all measured calls in this process.
  return { diff: Buffer.from(diff, 'utf16le').toString('utf16le'), expected, iterations };
}
async function child(moduleFile, mode, name, phase) {
  const lib = await import(pathToFileURL(moduleFile).href), { diff, expected, iterations } = fixture(name);
  const parse = name === 'largeStats' ? () => ({ stats: lib.editorDiffStats(diff) }) : mode === 'baseline' ? () => ({ markers: lib.editorDiffMarkers(diff), stats: lib.editorDiffStats(diff) }) : () => lib.editorDiff(diff);
  for (let i = 0; i < 30; i++) assert.deepEqual(parse(), expected); await collect();
  const before = process.memoryUsage(), samples = [], events = []; let current, sink = 0, session;
  const post = (name, args = {}) => new Promise((resolve, reject) => session.post(name, args, (error, result) => error ? reject(error) : resolve(result)));
  const observer = new PerformanceObserver(list => { for (const event of list.getEntries()) if (events.length < 4096) events.push({ startTime: event.startTime, duration: event.duration, kind: event.detail.kind }); });
  if (phase === 'allocation') { session = new inspector.Session(); session.connect(); await post('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }); }
  else observer.observe({ entryTypes: ['gc'] });
  const cpu = process.cpuUsage(), started = performance.now(); let observedHeapUsedHighWater = before.heapUsed;
  for (let i = 0; i < iterations; i++) {
    const start = phase === 'timing' ? performance.now() : 0; current = parse(); if (phase === 'timing') samples.push(performance.now() - start);
    sink = (sink + current.stats.added + current.stats.removed + (current.markers?.length || 0)) >>> 0;
    if (phase === 'timing' && i % 20 === 19) { observedHeapUsedHighWater = Math.max(observedHeapUsedHighWater, process.memoryUsage().heapUsed); await tick(); }
  }
  const ended = performance.now(), usedCpu = process.cpuUsage(cpu); let allocated = null;
  if (phase === 'allocation') {
    const { profile } = await post('HeapProfiler.stopSampling'); session.disconnect(); let total = 0, scanner = 0;
    const stack = [[profile.head, false]];
    while (stack.length) { const [node, parent] = stack.pop(); const target = parent || /(?:editor-diff\.mjs|core\/diff-view\.mjs)$/.test(node.callFrame.url); total += node.selfSize; if (target) scanner += node.selfSize; for (const next of node.children || []) stack.push([next, target]); }
    allocated = { intervalBytes: 16384, profileEstimatedBytes: total, scannerSubtreeEstimatedBytes: scanner };
  }
  await tick(); await tick(); observer.disconnect(); assert.deepEqual(current, expected);
  const natural = events.filter(event => event.startTime >= started && event.startTime < ended); await collect(); const retained = process.memoryUsage();
  return { mode, name, phase, inputBytes: Buffer.byteLength(diff), inputLines: diff.split('\n').length, iterations, exact: true, sink, wallMs: ended - started, cpuMicroseconds: usedCpu, callMedianMs: samples.length ? median(samples) : null, callP95Ms: samples.length ? [...samples].sort((a, b) => a - b)[Math.floor(samples.length * .95)] : null, sampledAllocation: allocated, naturalGc: { count: natural.length, durationMs: natural.reduce((sum, event) => sum + event.duration, 0), events: natural }, observedHeapUsedHighWaterBytes: phase === 'timing' ? observedHeapUsedHighWater : null, retainedHeapDeltaBytes: retained.heapUsed - before.heapUsed, outputMarkers: current.markers?.length ?? null, runtime: process.versions };
}
(async () => {
  if (process.argv[2] === '--child') { console.log(JSON.stringify(await child(...process.argv.slice(3)))); return; }
  const output = process.argv[2]; if (!output || !path.isAbsolute(output)) throw Error('Pass an absolute report output path.');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-editor-diff-bench-')); const files = ['ui/src/lib/editor-diff.mjs', 'core/diff-view.mjs'];
  try {
    for (const file of files) { const full = path.join(scratch, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, execFileSync('git', ['show', `${baseline}:${file}`], { cwd: repo })); }
    const runs = [];
    for (const phase of ['timing', 'allocation']) for (const name of ['tiny', 'sparse', 'dense', 'longLines', 'largeStats']) for (let repeat = 0; repeat < 3; repeat++) {
      const pair = { phase, name, repeat };
      for (const mode of repeat % 2 ? ['scan', 'baseline'] : ['baseline', 'scan']) pair[mode] = JSON.parse(execFileSync(process.execPath, ['--expose-gc', __filename, '--child', mode === 'baseline' ? path.join(scratch, files[0]) : path.join(repo, files[0]), mode, name, phase], { cwd: repo, encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 ** 2 }));
      runs.push(pair); console.log('Completed', phase, name, repeat);
    }
    const medians = Object.fromEntries(['tiny', 'sparse', 'dense', 'longLines', 'largeStats'].map(name => [name, Object.fromEntries(['baseline', 'scan'].map(mode => {
      const timing = runs.filter(pair => pair.phase === 'timing' && pair.name === name).map(pair => pair[mode]), allocation = runs.filter(pair => pair.phase === 'allocation' && pair.name === name).map(pair => pair[mode]);
      return [mode, { callMedianMs: median(timing.map(row => row.callMedianMs)), callP95Ms: median(timing.map(row => row.callP95Ms)), loopWallMs: median(timing.map(row => row.wallMs)), naturalGcCount: median(timing.map(row => row.naturalGc.count)), naturalGcDurationMs: median(timing.map(row => row.naturalGc.durationMs)), sampledScannerAllocationBytes: median(allocation.map(row => row.sampledAllocation.scannerSubtreeEstimatedBytes)) }];
    }))]));
    const big = fixture('largeStats'), current = await import(pathToFileURL(path.join(repo, files[0])).href), old = await import(pathToFileURL(path.join(scratch, files[0])).href);
    const coverage = { suppliedChangedLines: 20000, baselineMarkers: old.editorDiffMarkers(big.diff).length, candidateMarkers: current.editorDiffMarkers(big.diff).length, lastCandidateLine: current.editorDiffMarkers(big.diff).at(-1).line, performanceComparisonExcluded: true };
    const sourceHashes = Object.fromEntries([...files, 'ui/src/lib/editor-diff.d.mts', 'ui/src/components/code-editor.tsx', 'scripts/performance/editor-diff.cjs'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')]));
    fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), baseline, scope: 'Five isolated Node parser workloads, three alternating fresh subprocess pairs per workload and phase. Timing/natural GC and allocation sampling run separately; all compared results are exactly equal. Large-diff marker coverage differs and is excluded from the like-for-like performance comparison: largeStats measures only exact full statistics. No Electron process RAM, GPU/model memory, hardware cache misses or end-to-end interaction claims.', medians, coverage, runs, sourceHashes }, null, 2) + '\n'); console.log(JSON.stringify(medians));
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
