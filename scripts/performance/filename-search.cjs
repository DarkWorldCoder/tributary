'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..'), baseline = '7b3c95fa2bda87d33bc592ada0e3ed190b175f1f';
const sources = ['core/filename-search.js', 'core/files.js', 'core/hub.js', 'desktop/main.js', 'vscode/extension.js', 'ui/src/lib/file-search.mjs', 'ui/src/components/quick-open.tsx', 'ui/src/components/workspace-files.tsx', 'scripts/performance/filename-search.cjs'];
const hashes = () => Object.fromEntries(sources.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')]));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function child(moduleFile, root, query, mode) {
  const search = mode === 'baseline' ? require(moduleFile).findFiles : require(moduleFile).scanFileNames;
  await new Promise(setImmediate); global.gc(); await new Promise(setImmediate);
  const before = process.memoryUsage(), samples = []; let high = before.heapUsed, ticks = 0, last = performance.now(), longest = 0;
  const timer = setInterval(() => { const now = performance.now(); longest = Math.max(longest, now - last); last = now; ticks++; const sample = process.memoryUsage(); high = Math.max(high, sample.heapUsed); if (samples.length < 2048) samples.push(sample); }, 2);
  const cpu = process.cpuUsage(), start = performance.now();
  const result = await search(root, query); const ended = performance.now(); longest = Math.max(longest, ended - last); clearInterval(timer);
  const after = process.memoryUsage(); high = Math.max(high, after.heapUsed); const files = mode === 'baseline' ? result : result.files;
  const report = { mode, wallMs: ended - start, cpuMicroseconds: process.cpuUsage(cpu), before, after, observedHeapUsedHighWaterBytes: high, processPeakRssBytes: process.resourceUsage().maxRSS * 1024, timer: { intervalMs: 2, ticks, longestObservedGapMs: longest }, files, ...(mode === 'stream' ? { total: result.total, visited: result.visited, limited: result.limited, unreadable: result.unreadable } : {}), versions: process.versions };
  // Diagnostic GC is outside the timed operation, never used by production.
  global.gc(); await new Promise(setImmediate); report.retained = process.memoryUsage(); return report;
}
(async () => {
  if (process.argv[2] === '--child') { console.log(JSON.stringify(await child(...process.argv.slice(3)))); return; }
  const output = process.argv[2]; if (!output || !path.isAbsolute(output)) throw Error('Pass an absolute report output path.');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-filename-bench-')), source = hashes();
  try {
    const old = path.join(scratch, 'baseline'); fs.mkdirSync(old);
    for (const file of ['files.js', 'directory-page.js']) fs.writeFileSync(path.join(old, file), execFileSync('git', ['show', `${baseline}:core/${file}`], { cwd: repo }));
    const fixtures = [];
    for (const [name, count] of [['equalCoverage', 16000], ['largeCoverage', 60000]]) {
      const root = path.join(scratch, name); fs.mkdirSync(root);
      for (let at = 0; at < count; at++) fs.closeSync(fs.openSync(path.join(root, `source-${String(at).padStart(6, '0')}.ts`), 'w'));
      const native = fs.readdirSync(root); const rare = native[Math.min(40000, count - 1)];
      fixtures.push({ name, root, count, query: rare, expected: [rare], equalTraversal: count < 20000 });
    }
    const runs = [];
    for (const fixture of fixtures) for (let repeat = 0; repeat < 3; repeat++) {
      const pair = { name: fixture.name, count: fixture.count, query: fixture.query, repeat, equalTraversal: fixture.equalTraversal };
      for (const mode of repeat % 2 ? ['stream', 'baseline'] : ['baseline', 'stream']) {
        const before = hashes(); assert.deepEqual(before, source, 'Sources changed before child');
        pair[mode] = JSON.parse(execFileSync(process.execPath, ['--expose-gc', __filename, '--child', mode === 'baseline' ? path.join(old, 'files.js') : path.join(repo, 'core/filename-search.js'), fixture.root, fixture.query, mode], { encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 ** 2 }));
        assert.deepEqual(hashes(), source, 'Sources changed during child'); pair[mode].sourceHashes = before;
      }
      assert.deepEqual(pair.stream.files, fixture.expected); assert.equal(pair.stream.visited, fixture.count);
      if (fixture.equalTraversal) assert.deepEqual(pair.baseline.files, pair.stream.files);
      else assert.deepEqual(pair.baseline.files, [], 'Rare target must be past the historical visit cutoff');
      runs.push(pair); console.log('Completed', fixture.name, repeat);
    }
    const medians = Object.fromEntries(fixtures.map(fixture => [fixture.name, Object.fromEntries(['baseline', 'stream'].map(mode => {
      const rows = runs.filter(pair => pair.name === fixture.name).map(pair => pair[mode]);
      return [mode, Object.fromEntries(['wallMs', 'observedHeapUsedHighWaterBytes', 'processPeakRssBytes'].map(key => [key, median(rows.map(row => row[key]))]))];
    }))]));
    fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), baseline, scope: 'Three alternating fresh Node subprocess pairs per fixture, real local files, no concurrent builds/tests. The 16,000-entry fixture compares equal complete results/traversal. The 60,000-entry fixture fixes missing results: old scans only 20,000 entries and is not equal work. Timer sampling can miss short heap peaks; peak RSS includes runtime and native memory. No whole-app, cross-editor or model-memory claim. Initial/final diagnostic GC only, outside timed searches.', sourceHashes: source, medians, runs }, null, 2) + '\n'); console.log(JSON.stringify(medians));
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
