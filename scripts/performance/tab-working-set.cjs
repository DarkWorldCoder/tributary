'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { sample } = require('./app-memory.cjs');
const repo = path.resolve(__dirname, '../..'), [baseline, candidate, output] = process.argv.slice(2), flags = process.argv.slice(5);
for (const value of [baseline, candidate, output]) assert.ok(value && path.isAbsolute(value), 'Use absolute baseline/candidate snapshot directories and report path.');
const resume = flags.includes('--resume'), limitAt = flags.indexOf('--case-limit'), limit = limitAt < 0 ? 4 : Number(flags[limitAt + 1]); assert.ok(Number.isInteger(limit) && limit > 0 && limit <= 12);
const workloadAt = flags.indexOf('--workload'), selection = workloadAt < 0 ? 'all' : flags[workloadAt + 1]; assert.ok(['all', 'small', 'large'].includes(selection));
const workloads = selection === 'all' ? ['small', 'large'] : [selection];
assert.equal(fs.existsSync(output), resume, 'Use --resume only for an existing incomplete report.');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex'), roots = { baseline, candidate };
const manifests = Object.fromEntries(Object.entries(roots).map(([mode, dir]) => [mode, JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')))]));
function fingerprint() {
  const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repo }).toString().split('\0').filter(name => name && (name.startsWith('core/') || name.startsWith('desktop/') || ['package.json', 'package-lock.json', 'scripts/performance/native-tab-working-set.cjs', 'scripts/performance/app-memory.cjs', 'scripts/performance/tab-working-set.cjs'].includes(name)));
  const engine = 'native/tributary-engine/target/release/tributary-engine'; if (fs.existsSync(path.join(repo, engine))) names.push(engine);
  return Object.fromEntries([...new Set(names)].sort().map(name => [name, digest(fs.readFileSync(path.join(repo, name)))]));
}
const sourceHashes = fingerprint();
const report = resume ? JSON.parse(fs.readFileSync(output)) : { complete: false, createdAt: new Date().toISOString(), roots, manifests, sourceHashes, workloads, runs: [], batches: [],
  collectionProtocol: 'External collector outside app process tree. Every checkpoint requires a complete process-tree sample; choose the first complete attempt from at most three, 50 ms apart. All incomplete attempts are retained. Compact checkpoint totals alone return to the app; detailed observations stay outside it.',
  scope: 'Three alternating fresh native pairs per selected workload (' + workloads.join(', ') + '): 24 synthetic TypeScript files via the actual read-only agent/editor bridge. Ordinary frozen UI, no renderer/read counters, debugger or forced GC. Times are editor API calls and two-frame readiness, not provider CLI/HTTP round trips; externally collected process-tree PSS checkpoints are observations, not continuous peaks. Not the Quick Open workflow, VS Code, cold-start or real-model RAM. Local tests/builds/other performance cohorts do not overlap.' };
assert.deepEqual(report.roots, roots); assert.deepEqual(report.manifests, manifests); assert.deepEqual(report.sourceHashes, sourceHashes); assert.equal(report.complete, false);
assert.deepEqual(report.workloads || ['small', 'large'], workloads);
const verify = () => { assert.deepEqual(fingerprint(), report.sourceHashes, 'Host/source changed'); for (const [mode, dir] of Object.entries(roots)) for (const [rel, hash] of Object.entries(manifests[mode])) assert.equal(digest(fs.readFileSync(path.join(dir, rel))), hash, 'Snapshot changed: ' + mode + '/' + rel); };
if (resume) for (const row of report.runs.filter(row => !row.passed && !row.excluded)) {
  if (Number.isInteger(row.pid)) try { process.kill(row.pid, 0); throw Error('Previous child may still be live: ' + row.pid); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  row.excluded = 'Interrupted/failed earlier case; process confirmed absent, raw evidence retained. Not admitted.';
}
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); report.batches.push({ at: new Date().toISOString(), limit, resume }); verify(); save();
async function run(mode, workload, repeat) {
  verify(); const attempt = report.runs.filter(row => row.mode === mode && row.workload === workload && row.repeat === repeat).length;
  const file = `${output}.${mode}-${workload}-${repeat}${attempt ? '.attempt-' + attempt : ''}.json`, log = file + '.log'; assert.ok(!fs.existsSync(file));
  const fd = fs.openSync(log, 'wx'), child = spawn('xvfb-run', ['-a', path.join(repo, 'node_modules/.bin/electron'), path.join(repo, 'scripts/performance/native-tab-working-set.cjs'), '--no-sandbox', '--ozone-platform=x11'], {
    cwd: repo, detached: true, stdio: ['ignore', 'pipe', fd], env: { ...process.env, TRIBUTARY_TAB_UI: path.join(roots[mode], 'ui'), TRIBUTARY_TAB_OUTPUT: file, TRIBUTARY_TAB_WORKLOAD: workload, LIBGL_ALWAYS_SOFTWARE: '1' },
  });
  const row = { mode, workload, repeat, pid: child.pid, file, log, passed: false, samples: [] }; report.runs.push(row); save();
  let closed = false, logClosed = false, busy = false, partial = '';
  const closeLog = () => { if (!logClosed) { logClosed = true; fs.closeSync(fd); } };
  const protocolFailure = error => { if (row.protocolError) return; row.protocolError = String(error.stack || error); save(); try { process.kill(-child.pid, 'SIGTERM'); } catch {} };
  const collect = async request => {
    assert.ok(!busy && Number.isInteger(request.id) && request.id === row.samples.length + 1 && request.id <= 32);
    assert.ok(Number.isInteger(request.pid) && request.pid > 1 && ['initial', 'opening', 'post-open', 'post-controls'].includes(request.phase));
    assert.equal(path.basename(fs.readlinkSync('/proc/' + request.pid + '/exe')), 'electron');
    assert.ok(fs.readFileSync('/proc/' + request.pid + '/cmdline', 'utf8').includes(path.join(repo, 'scripts/performance/native-tab-working-set.cjs')));
    let ancestor = request.pid;
    for (let depth = 0; depth < 16 && ancestor !== child.pid; depth++) { const stat = fs.readFileSync('/proc/' + ancestor + '/stat', 'utf8'); ancestor = Number(stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)[1]); }
    assert.equal(ancestor, child.pid, 'Sample target is outside the owned test process tree.');
    if (row.appPid !== undefined) assert.equal(request.pid, row.appPid); else row.appPid = request.pid;
    busy = true;
    try {
      const checkpoint = { request, attempts: [], acceptedIndex: null }; row.samples.push(checkpoint);
      for (let attempt = 0; attempt < 3 && !closed; attempt++) {
        const result = sample(request.pid); checkpoint.attempts.push(result); save();
        if (result.complete) { checkpoint.acceptedIndex = attempt; break; }
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (closed) return;
      const result = checkpoint.acceptedIndex === null ? null : checkpoint.attempts[checkpoint.acceptedIndex];
      const response = result ? { id: request.id, result: { complete: true, rootPid: result.rootPid, startedAt: result.startedAt, finishedAt: result.finishedAt, totals: result.totals, processCount: result.processes.length } }
        : { id: request.id, error: 'No complete external process-tree sample within three attempts.' };
      fs.writeFileSync(file + '.sample-' + request.id + '.raw.json', JSON.stringify(checkpoint, null, 2) + '\n');
      const responsePath = file + '.sample-' + request.id + '.json'; fs.writeFileSync(responsePath + '.tmp', JSON.stringify(response)); fs.renameSync(responsePath + '.tmp', responsePath); save();
    } finally { busy = false; }
  };
  child.stdout.on('data', chunk => {
    fs.writeSync(fd, chunk); if (row.protocolError) return; partial += chunk.toString('utf8');
    let at;
    while ((at = partial.indexOf('\n')) >= 0) {
      const line = partial.slice(0, at); partial = partial.slice(at + 1);
      if (line.startsWith('TRIBUTARY_TAB_SAMPLE ')) { try { void collect(JSON.parse(line.slice('TRIBUTARY_TAB_SAMPLE '.length))).catch(protocolFailure); } catch (error) { protocolFailure(error); } }
    }
    if (partial.length > 8192) { partial = ''; protocolFailure(Error('Oversized sample control line.')); }
  });
  const code = await new Promise((resolve, reject) => {
    let hard; const timer = setTimeout(() => { row.deadlineExceeded = true; save(); try { process.kill(-child.pid, 'SIGTERM'); } catch {} hard = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5000); }, 240000);
    child.once('error', error => { closed = true; row.spawnError = error.message; closeLog(); clearTimeout(timer); save(); reject(error); }); child.once('close', code => { closed = true; closeLog(); clearTimeout(timer); clearTimeout(hard); resolve(code); });
  });
  row.exitCode = code; save(); assert.equal(code, 0, 'Incomplete case: ' + log); verify(); const result = JSON.parse(fs.readFileSync(file));
  assert.ok(result.complete && result.opens.length === 23 && result.controls.length === 6 && !result.rejected.length && result.memory.every(entry => entry.result.complete));
  assert.equal(row.samples.length, result.memory.length);
  for (const [index, checkpoint] of row.samples.entries()) { assert.ok(checkpoint.acceptedIndex !== null); assert.deepEqual(checkpoint.attempts[checkpoint.acceptedIndex].totals, result.memory[index].result.totals); }
  const earlier = report.runs.find(entry => entry.passed && !entry.excluded && entry.workload === workload); if (earlier) assert.equal(result.fixture.sha256, earlier.result.fixture.sha256, 'Fixture bytes differ');
  assert.equal(result.hostSha256, report.sourceHashes['scripts/performance/native-tab-working-set.cjs']); row.result = result; row.passed = true; save(); console.log('Completed', mode, workload, repeat);
}
(async () => {
  let count = 0;
  for (let repeat = 0; repeat < 3; repeat++) for (const workload of workloads) for (const mode of repeat % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
    if (report.runs.some(row => row.mode === mode && row.workload === workload && row.repeat === repeat && row.passed && !row.excluded)) continue;
    if (count >= limit) { verify(); save(); console.log('Batch complete; resume remaining cases.'); return; }
    await run(mode, workload, repeat); count++;
  }
  verify(); report.complete = true; save(); console.log('All ' + (workloads.length * 6) + ' cases complete.');
})().catch(error => { report.error = error.stack; save(); console.error(error.stack); process.exitCode = 1; });
