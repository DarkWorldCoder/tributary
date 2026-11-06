'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process'); const { PerformanceObserver } = require('node:perf_hooks'); const inspector = require('node:inspector');
const repo = path.resolve(__dirname, '../..'), baseline = '7c49ca232c13ea1d8bf27da27b2841fa2519bc93';
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const hashes = () => Object.fromEntries(['core/filename-search.js', 'scripts/performance/filename-tuning.cjs'].map(file => [file, digest(fs.readFileSync(path.join(repo, file)))]));
const tick = () => new Promise(setImmediate);
async function child(moduleFile, fixtureFile, name, phase) {
  const { scanFileNames } = require(moduleFile), fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8')).find(row => row.name === name);
  const scan = () => scanFileNames(fixture.root, fixture.query, { limit: 100 });
  await tick(); global.gc(); await tick();
  const before = process.memoryUsage(), events = [], times = []; let high = before.heapUsed, longest = 0, last = performance.now(), ticks = 0, session;
  const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, value) => error ? reject(error) : resolve(value)));
  const observer = new PerformanceObserver(list => { for (const event of list.getEntries()) events.push({ startTime: event.startTime, duration: event.duration, kind: event.detail.kind }); });
  if (phase === 'allocation') { session = new inspector.Session(); session.connect(); await post('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }); }
  else observer.observe({ entryTypes: ['gc'] });
  const sample = () => { const now = performance.now(); longest = Math.max(longest, now - last); last = now; ticks++; high = Math.max(high, process.memoryUsage().heapUsed); };
  const timer = phase === 'timing' ? setInterval(sample, 2) : null;
  const cpu = process.cpuUsage(), started = performance.now(); let result;
  const calls = phase === 'allocation' ? 20 : 7;
  try {
    for (let at = 0; at < calls; at++) { const start = performance.now(); result = await scan(); times.push(performance.now() - start); assert.deepEqual(result, fixture.expected); }
  } finally { if (timer) clearInterval(timer); }
  const ended = performance.now(); longest = Math.max(longest, ended - last); high = Math.max(high, process.memoryUsage().heapUsed); let allocation = null;
  if (phase === 'allocation') {
    const { profile } = await post('HeapProfiler.stopSampling'); session.disconnect(); let scannerBytes = 0, totalBytes = 0;
    const stack = [[profile.head, false]];
    while (stack.length) { const [node, parent] = stack.pop(), scanner = parent || /\/filename-search\.js$/.test(node.callFrame.url); totalBytes += node.selfSize; if (scanner) scannerBytes += node.selfSize; for (const child of node.children || []) stack.push([child, scanner]); }
    allocation = { samplingIntervalBytes: 16384, calls, scannerEstimatedBytes: scannerBytes, profileEstimatedBytes: totalBytes };
  }
  await tick(); await tick(); observer.disconnect();
  const natural = events.filter(row => row.startTime >= started && row.startTime < ended);
  return { phase, calls, coldMs: times[0], warmMedianMs: median(times.slice(2)), times, wallMs: ended - started, cpuMicroseconds: process.cpuUsage(cpu), before, observedHeapUsedHighWaterBytes: phase === 'timing' ? high : null, processPeakRssBytes: process.resourceUsage().maxRSS * 1024, longestTimerGapMs: phase === 'timing' ? longest : null, timerTicks: ticks, naturalGc: { count: natural.length, durationMs: natural.reduce((sum, row) => sum + row.duration, 0) }, allocation, exact: true, expected: fixture.expected, versions: process.versions };
}
(async () => {
  if (process.argv[2] === '--child') { console.log(JSON.stringify(await child(...process.argv.slice(3)))); return; }
  const output = process.argv[2]; if (!output || !path.isAbsolute(output)) throw Error('Pass an absolute report output path.');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-filename-tuning-')), sourceHashes = hashes();
  try {
    const baseText = execFileSync('git', ['show', `${baseline}:core/filename-search.js`], { cwd: repo }), currentText = fs.readFileSync(path.join(repo, 'core/filename-search.js'), 'utf8');
    assert.equal((currentText.match(/bufferSize: 256/g) || []).length, 1, 'Exploratory taper requires the unchanged 256-entry default.');
    const variants = { baseline: baseText, hotLoop: currentText, tapered: currentText.replace('bufferSize: 256', 'bufferSize: Math.max(32, 512 >> Math.floor(depth / 8))') };
    const moduleFiles = {};
    for (const [name, text] of Object.entries(variants)) { const dir = path.join(scratch, name); fs.mkdirSync(dir); moduleFiles[name] = path.join(dir, 'filename-search.js'); fs.writeFileSync(moduleFiles[name], text); }
    const roots = {}, allPaths = {};
    for (const name of ['flat', 'nested', 'deep']) { roots[name] = path.join(scratch, name); fs.mkdirSync(roots[name]); allPaths[name] = []; }
    const write = (kind, rel) => { fs.mkdirSync(path.dirname(path.join(roots[kind], rel)), { recursive: true }); fs.closeSync(fs.openSync(path.join(roots[kind], rel), 'w')); allPaths[kind].push(rel); };
    for (let at = 0; at < 40000; at++) write('flat', `source-${String(at).padStart(6, '0')}.ts`);
    const prefix = Array.from({ length: 6 }, (_, at) => `package-${at}`).join('/') + '/';
    for (let at = 0; at < 16000; at++) write('nested', prefix + `source-${String(at).padStart(6, '0')}.ts`);
    let deep = '';
    for (let depth = 0; depth < 48; depth++) { for (let at = 0; at < 512; at++) write('deep', deep + `source-${String(at).padStart(6, '0')}.ts`); deep += 'next/'; }
    const fixtures = [
      { name: 'flatSparse', kind: 'flat', query: 'source-039999.ts' },
      { name: 'flatDense', kind: 'flat', query: 'source-' },
      { name: 'nestedSparse', kind: 'nested', query: 'source-015999.ts' },
      { name: 'parentMatch', kind: 'nested', query: 'package-2' },
      { name: 'pathQuery', kind: 'nested', query: 'package-5/source-015999.ts' },
      { name: 'deepWideParents', kind: 'deep', query: 'source-' }
    ].map(row => {
      const paths = allPaths[row.kind], matches = paths.filter(name => name.toLowerCase().includes(row.query)).sort(), dirs = new Set();
      for (const rel of paths) { const parts = rel.split('/'); for (let at = 1; at < parts.length; at++) dirs.add(parts.slice(0, at).join('/')); }
      return { ...row, root: roots[row.kind], expected: { files: matches.slice(0, 100), total: matches.length, visited: paths.length + dirs.size, unreadable: 0, limited: matches.length > 100 } };
    });
    const fixtureFile = path.join(scratch, 'fixtures.json'); fs.writeFileSync(fixtureFile, JSON.stringify(fixtures));
    const runs = [], modes = Object.keys(variants);
    for (const phase of ['timing', 'allocation']) for (const fixture of phase === 'timing' ? fixtures : fixtures.filter(row => ['nestedSparse', 'parentMatch'].includes(row.name))) for (let repeat = 0; repeat < 3; repeat++) {
      const cohort = { phase, fixture: fixture.name, repeat };
      // Latin-square order rotates the three implementations through each slot.
      for (let slot = 0; slot < modes.length; slot++) {
        const mode = modes[(slot + repeat) % modes.length]; assert.deepEqual(hashes(), sourceHashes, 'Source changed before child');
        cohort[mode] = JSON.parse(execFileSync(process.execPath, ['--expose-gc', __filename, '--child', moduleFiles[mode], fixtureFile, fixture.name, phase], { cwd: repo, encoding: 'utf8', timeout: 90000, maxBuffer: 2 * 1024 ** 2 }));
        assert.deepEqual(hashes(), sourceHashes, 'Source changed during child'); cohort[mode].sourceHashes = sourceHashes;
      }
      runs.push(cohort); console.log('Completed', phase, fixture.name, repeat);
    }
    const medians = Object.fromEntries(fixtures.map(fixture => [fixture.name, Object.fromEntries(modes.map(mode => {
      const timing = runs.filter(row => row.phase === 'timing' && row.fixture === fixture.name).map(row => row[mode]);
      const allocation = runs.filter(row => row.phase === 'allocation' && row.fixture === fixture.name).map(row => row[mode]);
      return [mode, { ...Object.fromEntries(['coldMs', 'warmMedianMs', 'observedHeapUsedHighWaterBytes', 'processPeakRssBytes', 'longestTimerGapMs'].map(key => [key, median(timing.map(row => row[key]))])), sampledScannerAllocationBytes: allocation.length ? median(allocation.map(row => row.allocation.scannerEstimatedBytes)) : null }];
    }))]));
    fs.writeFileSync(output, JSON.stringify({ baseline, sourceHashes, variantHashes: Object.fromEntries(Object.entries(variants).map(([name, text]) => [name, digest(text)])), scope: 'Exploratory equal-output Node comparison: six real-file fixture/query combinations; three Latin-square subprocess cohorts. Cold and warm timings in seven-call runs; sampled allocation in separate twenty-call runs for two nested fixtures. Taper variant changes only opendir bufferSize by depth, not yield frequency or result coverage. No production GC or whole-app/cross-editor claim.', fixtures: fixtures.map(({ root, ...row }) => row), medians, runs }, null, 2) + '\n'); console.log(JSON.stringify(medians));
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
