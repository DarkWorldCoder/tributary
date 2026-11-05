'use strict';
// Real Git index traversal in fresh Node processes. Index construction stays in
// the parent, outside the measured process tree. No provider/model is invoked.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { execFileSync, fork } = require('node:child_process');
const { PerformanceObserver, performance } = require('node:perf_hooks');
const { sample } = require('./app-memory.cjs');
const repo = path.resolve(__dirname, '../..');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function worker() {
  const [modulePath, project, mode, rawLimit] = process.argv.slice(3), limit = Number(rawLimit);
  const { localHost } = require('../../core/host'); const { listFiles } = require(modulePath);
  let bytes = 0, launches = 0;
  const host = { ...localHost,
    async exec(...args) { launches++; const result = await localHost.exec(...args); bytes += Buffer.byteLength(result.stdout); return result; },
    spawn(...args) { launches++; const child = localHost.spawn(...args); child.stdout.on('data', data => { bytes += data.length; }); return child; },
  };
  const settle = async () => { for (let n = 0; n < 3; n++) { global.gc(); await new Promise(setImmediate); } };
  await settle(); const before = process.memoryUsage();
  const gc = [], observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) gc.push({ start: entry.startTime, duration: entry.duration, kind: entry.detail.kind }); });
  observer.observe({ entryTypes: ['gc'] });
  process.send({ type: 'ready', before });
  await new Promise(resolve => process.once('message', resolve));
  const began = performance.now(), cpuStart = process.cpuUsage();
  const files = await listFiles(project, limit, { host });
  const elapsedMs = performance.now() - began, cpu = process.cpuUsage(cpuStart), ended = performance.now();
  const after = process.memoryUsage(), maxRssKiB = process.resourceUsage().maxRSS;
  await new Promise(setImmediate); await delay(20); observer.disconnect();
  const naturalGc = gc.filter(entry => entry.start >= began && entry.start <= ended);
  const fingerprint = sha(files.join('\0'));
  await settle(); const retained = process.memoryUsage();
  assert.equal(sha(files.join('\0')), fingerprint); // Keep the returned array live through diagnostic GC.
  process.send({ type: 'result', mode, before, after, retained, elapsedMs, cpu, maxRssKiB,
    naturalGc, naturalGcMs: naturalGc.reduce((sum, e) => sum + e.duration, 0), outputBytes: bytes, launches, count: files.length, fingerprint });
  await new Promise(resolve => process.once('message', resolve)); process.disconnect();
}
function seed(parent, name, count) {
  const dir = path.join(parent, name); fs.mkdirSync(dir);
  const git = (args, input) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', input, maxBuffer: 128 * 1024 * 1024 });
  git(['init', '-q']); const blob = git(['hash-object', '-w', '--stdin'], '').trim();
  const entries = []; let outputBytes = 0;
  for (let n = 0; n < count; n++) {
    const id = String(n).padStart(8, '0');
    const file = `packages/group${id}/src/${'subcomponent-'.repeat(8)}/feature${id}.module.ts`;
    entries.push(`100644 ${blob}\t${file}\n`); outputBytes += Buffer.byteLength(file) + 1;
  }
  git(['update-index', '--index-info'], entries.join(''));
  return { name, dir, indexEntries: count, outputBytes, requestedLimit: 20000, realWorktreeFiles: 0 };
}
async function measure(modulePath, fixture, mode) {
  const samples = []; let timer, busy = false;
  const child = fork(__filename, ['--worker', modulePath, fixture.dir, mode, String(fixture.requestedLimit)], { execArgv: ['--expose-gc'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stderr = ''; child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-12000); });
  child.stdout.resume();
  const read = () => { if (busy) return; busy = true; try { samples.push(sample(child.pid)); } catch (error) { samples.push({ complete: false, error: error.message }); } finally { busy = false; } };
  const result = await new Promise((resolve, reject) => {
    let received = false;
    const timeout = setTimeout(() => { child.kill(); reject(Error('Benchmark deadline: ' + mode)); }, 60000);
    child.on('error', reject);
    child.on('message', message => {
      if (message.type === 'ready') { read(); timer = setInterval(read, 25); child.send('run'); }
      if (message.type === 'result') { received = true; clearInterval(timer); clearTimeout(timeout); read(); resolve(message); }
    });
    child.on('exit', code => { clearInterval(timer); clearTimeout(timeout); if (code || !received) reject(Error(`Worker exited without a successful result (${code}): ${stderr}`)); });
  });
  child.send('exit'); await new Promise(resolve => child.once('exit', resolve));
  const complete = samples.filter(s => s.complete), timed = complete.filter(s => s.processes.length > 1);
  return { ...result, stderr, processTreeSamples: samples,
    sampledPeakTreePssKiB: complete.length ? Math.max(...complete.map(s => s.totals.pssKiB)) : null,
    sampledPeakWithGitPssKiB: timed.length ? Math.max(...timed.map(s => s.totals.pssKiB)) : null,
    incompleteSamples: samples.length - complete.length };
}
async function main() {
  if (process.argv[2] === '--worker') return worker();
  if (process.platform !== 'linux') throw Error('Process-tree measurement requires Linux procfs');
  const output = process.argv[2]; if (!output || !path.isAbsolute(output)) throw Error('Pass an absolute report JSON path');
  const baselineRevision = '84b1f64', root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-path-bench-'));
  const files = ['core/git.js', 'core/path-command.js', 'core/path-prefix.js', 'core/host.js', 'core/proc.js', 'scripts/performance/path-discovery.cjs'];
  const fingerprints = () => Object.fromEntries(files.map(file => [file, sha(fs.readFileSync(path.join(repo, file)))]));
  const before = fingerprints(), baselineDir = path.join(root, 'baseline'); fs.mkdirSync(baselineDir);
  const baseline = execFileSync('git', ['show', `${baselineRevision}:core/git.js`], { cwd: repo }); fs.writeFileSync(path.join(baselineDir, 'git.js'), baseline);
  for (const file of ['host.js', 'change-stats.js']) fs.symlinkSync(path.join(repo, 'core', file), path.join(baselineDir, file));
  try {
    const fixtures = [seed(root, 'under-limit', 1000), seed(root, 'large-prefix', 400000)]; const cases = [];
    for (const fixture of fixtures) {
      const runs = [];
      for (let pair = 0; pair < 3; pair++) {
        for (const mode of pair % 2 ? ['streamed', 'buffered'] : ['buffered', 'streamed']) {
          const result = await measure(mode === 'buffered' ? path.join(baselineDir, 'git.js') : path.join(repo, 'core/git.js'), fixture, mode);
          assert.equal(result.outputBytes, fixture.outputBytes); assert.equal(result.launches, 1); assert.equal(result.count, Math.min(fixture.indexEntries, fixture.requestedLimit));
          runs.push({ pair, ...result }); console.log(fixture.name, pair, mode, JSON.stringify({ ms: result.elapsedMs, maxRssMiB: result.maxRssKiB / 1024, heapRetainedMiB: result.retained.heapUsed / 1048576 }));
        }
      }
      assert.equal(new Set(runs.map(run => run.fingerprint)).size, 1);
      const summaries = Object.fromEntries(['buffered', 'streamed'].map(mode => {
        const subset = runs.filter(r => r.mode === mode);
        return [mode, Object.fromEntries(['elapsedMs', 'maxRssKiB', 'naturalGcMs', 'sampledPeakTreePssKiB'].map(key => [key, median(subset.map(r => r[key]))]).concat([
          ['cpuMs', median(subset.map(r => (r.cpu.user + r.cpu.system) / 1000))],
          ['retainedHeapDeltaBytes', median(subset.map(r => r.retained.heapUsed - r.before.heapUsed))],
          ['heapAfterBytes', median(subset.map(r => r.after.heapUsed))],
        ]))];
      }));
      const { dir, ...description } = fixture; cases.push({ fixture: description, summaries, runs });
    }
    assert.deepEqual(fingerprints(), before);
    fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), baselineRevision, baselineGitSha256: sha(baseline), sourceHashes: before, runtime: process.versions, cases,
      scope: 'Linux source Node; three alternating fresh process pairs per actual Git index. Index construction is outside measured children. Paths are tracked index entries absent from the worktree. Both modes drain all bytes; this does not reduce Git work or network traffic. Worker maxRSS is an OS high-water mark; process-tree PSS samples include live descendants when observed but are non-atomic and may miss short-lived peaks. Diagnostic GC only before/after timed work; natural GC events within the timed interval are recorded separately. No Electron renderer, model/VRAM, physical cold-cache, native Windows/macOS or live SSH-network performance claim.' }, null, 2) + '\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
