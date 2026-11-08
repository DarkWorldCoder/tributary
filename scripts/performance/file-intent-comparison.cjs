'use strict';
// Compare frozen ordinary UI builds. Counter-instrumented builds are separate.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const repo = path.resolve(__dirname, '../..'), [baseline, candidate, output] = process.argv.slice(2);
for (const file of [baseline, candidate, output]) assert.ok(file && path.isAbsolute(file), 'Pass absolute baseline/candidate snapshot directories and output file.');
const flags = process.argv.slice(5), resume = flags.includes('--resume'), limitAt = flags.indexOf('--case-limit');
const caseLimit = limitAt === -1 ? 6 : Number(flags[limitAt + 1]); assert.ok(Number.isInteger(caseLimit) && caseLimit > 0 && caseLimit <= 6);
assert.equal(fs.existsSync(output), resume, resume ? 'No cohort to resume.' : 'Use --resume rather than overwriting an earlier cohort.');
const roots = { baseline, candidate }, digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const manifests = Object.fromEntries(Object.entries(roots).map(([mode, root]) => [mode, JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')))]));
const verify = () => { for (const [mode, root] of Object.entries(roots)) for (const [rel, hash] of Object.entries(manifests[mode])) assert.equal(digest(fs.readFileSync(path.join(root, rel))), hash, 'Snapshot changed: ' + mode + '/' + rel); };
const report = resume ? JSON.parse(fs.readFileSync(output)) : { complete: false, scope: 'Three alternating fresh source Electron pairs: pre-change UI versus file-pane-scoped request UI. Same host/core/Rust engine and generated fixture bytes, fresh physical paths per instance. 20,008 files, two million background source lines, 40,001-line large document. Native X11 keyboard workflows include screenshot settling/clipboard verification, not exact input-to-paint. Process-tree PSS sampled separately after work. No render instrumentation, profiler, forced GC, overlapping local tests/builds/other performance cohorts, VS Code run or universal speed/RAM claim.',
  roots, manifests, controllerSha256: digest(fs.readFileSync(__filename)), runs: [] };
if (resume) {
  assert.equal(report.complete, false, 'Cohort is already complete.'); assert.deepEqual(report.roots, roots); assert.deepEqual(report.manifests, manifests); verify();
  for (const row of report.runs.filter(row => !row.passed && !row.excluded)) {
    try { process.kill(row.pid, 0); throw Error('Existing child may still be live: ' + row.pid); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    row.excluded = 'Interrupted controller; child exit was not observed. The original report/log remain intact and are not admitted.';
  }
}
(report.continuations ??= []).push({ startedAt: new Date().toISOString(), controllerSha256: digest(fs.readFileSync(__filename)), caseLimit, resume });
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); save();
async function run(mode, repeat) {
  verify(); const attempt = report.runs.filter(row => row.mode === mode && row.repeat === repeat).length;
  const file = output + '.' + mode + '-' + repeat + (attempt ? '.attempt-' + attempt : '') + '.json', log = file + '.log'; assert.ok(!fs.existsSync(file));
  const fd = fs.openSync(log, 'wx');
  const child = spawn('xvfb-run', ['-a', '/usr/bin/python3', path.join(repo, 'scripts/performance/editor-comparison.py'), '--apps', 'tributary', '--runs', '1', '--files', '20000', '--tributary-ui-root', path.join(roots[mode], 'ui'), '--output', file], { cwd: repo, stdio: ['ignore', fd, fd], detached: true }); fs.closeSync(fd);
  const row = { mode, repeat, pid: child.pid, file, log, passed: false }; report.runs.push(row); save();
  const code = await new Promise((resolve, reject) => {
    let hard; const timer = setTimeout(() => { row.deadlineExceeded = true; save(); try { process.kill(-child.pid, 'SIGTERM'); } catch {} hard = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5000); }, 300000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); clearTimeout(hard); resolve(code); });
  });
  row.exitCode = code; save(); assert.equal(code, 0, 'Incomplete child: ' + log); verify();
  const result = JSON.parse(fs.readFileSync(file)); assert.ok(result.complete && result.runs.length === 1 && result.runs[0].passed);
  assert.ok(!result.rejected.length && result.runs[0].processSamples.every(sample => sample.complete));
  if (report.runs.length > 1) { const first = report.runs[0].result; assert.equal(result.fixture.sha256, first.fixture.sha256, 'Fixture bytes changed'); assert.deepEqual(result.sources, first.sources, 'Host or working sources changed'); }
  row.result = result; row.passed = true; save(); console.log('Completed', mode, repeat);
}
(async () => {
  let completed = 0;
  for (let repeat = 0; repeat < 3; repeat++) for (const mode of repeat % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
    if (report.runs.some(row => row.mode === mode && row.repeat === repeat && row.passed && !row.excluded)) continue;
    if (completed >= caseLimit) { verify(); save(); console.log('Batch complete; resume the remaining cases.'); return; }
    await run(mode, repeat); completed++;
  }
  verify(); report.complete = true; save(); console.log('All six cases complete.');
})().catch(error => { report.error = error.stack; save(); console.error(error.stack); process.exitCode = 1; });
