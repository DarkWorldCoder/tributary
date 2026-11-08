'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const scanner = require('../../core/filename-search');
const scanFileNames = scanner.scanFileNamesJS || scanner.scanFileNames;
const { nativeScan } = require('./bridge.cjs');
const { sample } = require('../../scripts/performance/app-memory.cjs');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function worker() {
  const [mode, configFile, binary, rounds] = process.argv.slice(3);
  const config = JSON.parse(fs.readFileSync(configFile));
  process.send({ kind: 'ready' });
  await new Promise(resolve => process.once('message', resolve));
  const before = process.memoryUsage(), observations = [];
  for (let repeat = 0; repeat < Number(rounds); repeat++) {
    for (const query of config.queries) {
      const start = performance.now();
      const result = mode === 'native' ? await nativeScan(binary, config.root, query.query, { limit: 100 }) : await scanFileNames(config.root, query.query, { limit: 100 });
      const elapsedMs = performance.now() - start;
      assert.ok(result, 'ASCII fixture must use the native engine, not silently fall back');
      assert.equal(hash(JSON.stringify(result)), query.expectedHash, 'complete results and counters');
      observations.push({ repeat, query: query.query, elapsedMs });
    }
  }
  process.send({ kind: 'result', before, after: process.memoryUsage(), observations, versions: process.versions });
  process.disconnect();
}

function fresh(mode, configFile, binary, memory) {
  return new Promise((resolve, reject) => {
    const child = fork(__filename, ['--worker', mode, configFile, binary, memory ? '6' : '1'], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let timer, result, stderr = ''; const samples = [], rejected = [];
    child.stderr.setEncoding('utf8'); child.stderr.on('data', text => { stderr = (stderr + text).slice(-4096); });
    child.on('error', reject);
    child.on('message', message => {
      if (message.kind === 'ready') {
        if (memory) timer = setInterval(() => {
          try { const value = sample(child.pid); if (value.complete) samples.push(value); else rejected.push(value); }
          catch (error) { rejected.push({ reason: error.message }); }
        }, 5);
        child.send('go');
      } else if (message.kind === 'result') result = message;
    });
    child.on('close', code => {
      clearInterval(timer);
      if (code !== 0 || !result) { reject(Error(stderr || 'Missing benchmark result')); return; }
      resolve({ ...result, samples, rejected });
    });
  });
}

async function benchmark() {
  const binary = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]);
  if (fs.existsSync(output)) throw Error('Choose a new report path.');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-native-engine-bench-'));
  const sourceFiles = ['Cargo.toml', 'Cargo.lock', 'src/main.rs', 'bridge.cjs', 'benchmark.cjs'].map(file => path.join(__dirname, file));
  sourceFiles.push(path.resolve(__dirname, '../../core/filename-search.js'), path.resolve(__dirname, '../../scripts/performance/app-memory.cjs'), binary);
  for (const file of ['native-engine.js', 'native-engine/discovery.cjs', 'native-engine/transport.cjs']) sourceFiles.push(path.resolve(__dirname, '../../core', file));
  const hashes = () => Object.fromEntries(sourceFiles.map(file => [file, hash(fs.readFileSync(file))]));
  const identity = hashes(), report = { complete: false, sourceHashes: identity, runs: [], scope: 'Fresh serial Node callers compare the same complete directory traversal, lexical result prefix and counts. Rust launch, pipe transport and record parsing are inside API timings. Caller startup and result hashing are outside. Timing and external Linux app-tree PSS sampling use separate cohorts; no forced collection. ASCII synthetic projects only, not VS Code or whole-workbench performance. Sampled peaks can miss short-lived allocations and native workers; rejected process samples are retained.' };
  const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  try {
    const fixtures = [];
    for (const [name, count, prefix] of [['tiny', 40, ''], ['flat', 20000, ''], ['nested', 40000, 'src/a/b/c/d/e/']]) {
      const root = path.join(base, name); fs.mkdirSync(path.join(root, prefix), { recursive: true });
      const paths = [];
      for (let at = 0; at < count; at++) {
        const rel = prefix + 'source-' + String(at).padStart(6, '0') + '.ts';
        fs.closeSync(fs.openSync(path.join(root, rel), 'w')); paths.push(rel);
      }
      const queries = ['missing-needle', 'source-' + String(count - 1).padStart(6, '0') + '.ts', 'source-', prefix || '.ts'].map(query => {
        const found = paths.filter(rel => rel.toLowerCase().includes(query)).sort();
        const expected = { files: found.slice(0, 100), total: found.length, visited: count + (prefix ? prefix.split('/').filter(Boolean).length : 0), unreadable: 0, limited: found.length > 100 };
        return { query, expectedHash: hash(JSON.stringify(expected)) };
      });
      const file = path.join(base, name + '.json'); fs.writeFileSync(file, JSON.stringify({ root, count, queries }));
      fixtures.push({ name, count, file, queries });
    }
    report.fixtures = fixtures.map(({ file, ...fixture }) => fixture);
    save();
    for (const cohort of ['timing', 'memory']) {
      for (const fixture of cohort === 'timing' ? fixtures : [fixtures.at(-1)]) {
        for (let repeat = 0; repeat < 3; repeat++) {
          const pair = { cohort, fixture: fixture.name, repeat };
          for (const mode of repeat % 2 ? ['native', 'js'] : ['js', 'native']) {
            assert.deepEqual(hashes(), identity);
            pair[mode] = await fresh(mode, fixture.file, binary, cohort === 'memory');
            assert.deepEqual(hashes(), identity);
            console.log('Completed', cohort, fixture.name, repeat, mode);
          }
          report.runs.push(pair); save();
        }
      }
    }
    report.timingMedians = Object.fromEntries(fixtures.map(fixture => [fixture.name, Object.fromEntries(['js', 'native'].map(mode => [mode, median(report.runs.filter(run => run.cohort === 'timing' && run.fixture === fixture.name).flatMap(run => run[mode].observations.map(row => row.elapsedMs)))]))]));
    report.memory = Object.fromEntries(['js', 'native'].map(mode => {
      const rows = report.runs.filter(run => run.cohort === 'memory').map(run => run[mode]);
      assert.ok(rows.every(row => row.samples.length), 'No complete process samples');
      return [mode, {
        medianObservedPeakPssMiB: median(rows.map(row => Math.max(...row.samples.map(s => s.totals.pssKiB)) / 1024)),
        completeSamples: rows.reduce((n, row) => n + row.samples.length, 0),
        rejectedSamples: rows.reduce((n, row) => n + row.rejected.length, 0),
        acceptedSamplesWithNativeChild: rows.reduce((n, row) => n + row.samples.filter(s => s.processes.some(p => p.role === 'child:tributary-engine' || p.role === 'child:tributary-engine.exe')).length, 0),
      }];
    }));
    report.complete = true; save();
    console.log(JSON.stringify({ complete: true, timingMedians: report.timingMedians, memory: report.memory }));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
}
(process.argv[2] === '--worker' ? worker() : benchmark()).catch(error => { console.error(error.stack); process.exitCode = 1; });
