'use strict';
require('./helpers/tmp').useCheckpointDir();
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const { mkdtemp } = require('./helpers/tmp'); const { QaResults, normalizeReport } = require('../core/qa-results'); const { Hub } = require('../core/hub'); const { MemorySecrets } = require('../core/store');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=', 'base64');
function report(root) { return { config: { rootDir: path.join(root, 'tests') }, errors: [], stats: { startTime: '2026-11-03T09:00:00Z', duration: 900 }, suites: [{ title: 'checkout.spec.ts', file: 'checkout.spec.ts', specs: [] }] }; }
function add(report, title, attempts, expectedStatus = 'passed', outcome = 'expected') { report.suites[0].specs.push({ id: title, title, file: 'checkout.spec.ts', line: 12, tests: [{ projectId: 'chromium', projectName: 'Desktop Chromium', expectedStatus, status: outcome, results: attempts.map((status, index) => ({ status, retry: index, duration: 120, startTime: '2026-11-03T09:00:00Z', errors: status === 'failed' ? [{ message: 'Expected total 100, received 0' }] : [], attachments: [] })) }] }); return report.suites[0].specs.at(-1).tests[0]; }
function fixture(t) { const root = mkdtemp('qa-project'); const data = mkdtemp('qa-data'); const qa = new QaResults(data); t.after(() => qa.stopAll()); return { root, data, qa, report: report(root) }; }

test('QA import preserves attempts, flaky status, skipped/not-run and expected failures', (t) => {
  const { root, report } = fixture(t);
  add(report, 'Success', ['passed']); add(report, 'Failure', ['failed'], 'passed', 'unexpected'); add(report, 'Retry', ['failed', 'passed'], 'passed', 'flaky'); add(report, 'Skip', ['skipped'], 'skipped', 'skipped'); add(report, 'Pending', []); add(report, 'Blocked', ['interrupted']); add(report, 'Known defect', ['failed'], 'failed'); add(report, 'Unexpected pass', ['passed'], 'failed', 'unexpected');
  const run = normalizeReport(root, JSON.stringify(report), { environment: 'staging', build: 'abc123' });
  assert.deepEqual(run.counts, { passed: 1, failed: 2, flaky: 1, skipped: 1, blocked: 1, 'not-run': 1, 'expected-failure': 1 });
  assert.equal(run.tests[2].attempts[0].errors[0], 'Expected total 100, received 0'); assert.equal(run.tests[0].file, 'tests/checkout.spec.ts'); assert.equal(run.status, 'failed');
  assert.equal(run.build, 'abc123'); assert.equal(run.environment, 'staging');
});

test('empty or globally failing reports cannot become a pass, and malformed reports are rejected', (t) => {
  const { root, report } = fixture(t); assert.equal(normalizeReport(root, JSON.stringify(report)).status, 'incomplete');
  add(report, 'Good case', ['passed']); report.errors.push({ message: 'Global teardown failed' });
  const run = normalizeReport(root, JSON.stringify(report)); assert.equal(run.status, 'failed'); assert.match(run.errors[0], /teardown/);
  for (const raw of ['{}', 'not json', JSON.stringify({ ...report, suites: [{ specs: [{ tests: [{ expectedStatus: 'passed', results: [{ status: 'invented' }] }] }] }] })]) assert.throws(() => normalizeReport(root, raw));
  assert.throws(() => normalizeReport(root, JSON.stringify(report), { testRoot: '../outside' }), /relative/);
});

test('import retains screenshot/trace snapshots, deduplicates and survives a new store instance', async (t) => {
  const { root, data, qa, report } = fixture(t); fs.mkdirSync(path.join(root, 'results')); fs.writeFileSync(path.join(root, 'results/failure.png'), png); fs.writeFileSync(path.join(root, 'results/trace.zip'), Buffer.from('PK\x03\x04fixture'));
  const item = add(report, 'Checkout fails', ['failed'], 'passed', 'unexpected'); item.results[0].attachments = [{ name: 'Screenshot', contentType: 'image/png', path: path.join(root, 'results/failure.png') }, { name: 'trace', contentType: 'application/zip', path: path.join(root, 'results/trace.zip') }];
  const input = { text: JSON.stringify(report), source: 'run.json', environment: 'staging', build: 'abc123' }; const run = await qa.import(root, input); const artifacts = run.tests[0].attempts[0].artifacts;
  assert.ok(artifacts.every((artifact) => artifact.available)); assert.equal(artifacts[1].kind, 'trace'); fs.rmSync(path.join(root, 'results'), { recursive: true });
  const fresh = new QaResults(data); assert.equal(fresh.list(root).length, 1); assert.equal((await fresh.import(root, input)).id, run.id); assert.equal(fresh.list(root).length, 1);
  assert.deepEqual(Buffer.from(fresh.image(root, run.id, artifacts[0].id).base64, 'base64'), png); assert.equal(fresh.get(root, run.id).tests[0].title, 'Checkout fails');
  const secondRoot = mkdtemp('qa-other'); assert.throws(() => fresh.get(secondRoot, run.id), /not found/); assert.throws(() => fresh.artifact(root, run.id, '../escape'), /unavailable/);
  assert.equal(fresh.remove(root, run.id).length, 0); assert.throws(() => fresh.get(root, run.id), /not found/);
});

test('attachments cannot read external paths, symlinks, URLs or active SVG content', async (t) => {
  const { root, qa, report } = fixture(t); const outside = mkdtemp('qa-outside'); fs.writeFileSync(path.join(outside, 'private.png'), png); fs.symlinkSync(path.join(outside, 'private.png'), path.join(root, 'escape.png'));
  const item = add(report, 'Unsafe attachments', ['failed'], 'passed', 'unexpected'); item.results[0].attachments = [
    { name: 'secret', path: path.join(outside, 'private.png') }, { name: 'link', path: 'escape.png' }, { name: 'remote', path: 'https://example.com/private.png' }, { name: 'svg', contentType: 'image/svg+xml', body: Buffer.from('<svg onload="alert(1)"></svg>').toString('base64') }, { name: 'inline screenshot', body: png.toString('base64') },
  ];
  const run = await qa.import(root, { text: JSON.stringify(report) }); const artifacts = run.tests[0].attempts[0].artifacts; assert.deepEqual(artifacts.map((artifact) => artifact.available), [false, false, false, false, true]);
  assert.ok(artifacts.every((artifact) => !('originalPath' in artifact) && !('body' in artifact)));
  const stored = path.join(qa.directory(root), run.id, artifacts[4].id); fs.writeFileSync(stored, 'changed'); assert.throws(() => qa.image(root, run.id, artifacts[4].id), /changed on disk/);
});

test('bug export includes original failure after a passing retry and never invents reproduction steps', async (t) => {
  const { root, qa, report } = fixture(t); add(report, 'Flaky checkout', ['failed', 'passed'], 'passed', 'flaky'); const run = await qa.import(root, { text: JSON.stringify(report), environment: 'staging', build: 'abc123' });
  let bug = qa.bug(root, run.id, run.tests[0].id); assert.match(bug, /Expected total 100/); assert.match(bug, /Outcome: flaky/); assert.match(bug, /Attempt 1: failed/); assert.match(bug, /Attempt 2: passed/); assert.match(bug, /Not supplied. Add the actions/);
  bug = qa.bug(root, run.id, run.tests[0].id, { expected: 'Total is 100', steps: '1. Add a product\n2. Open checkout', notes: 'Observed twice' }); assert.match(bug, /Total is 100/); assert.match(bug, /Open checkout/); assert.match(bug, /abc123/);
  assert.throws(() => qa.bug(root, run.id, 'other'), /not found/);
});

test('hub exposes project-scoped QA evidence and only launches trusted installed trace tools', async (t) => {
  const { root, report } = fixture(t); const dataDir = mkdtemp('qa-hub'); const hub = new Hub({ dataDir, home: root, secrets: new MemorySecrets() }); hub.addProject(root); t.after(() => { hub._qaResults?.stopAll(); hub.store.close(); });
  await assert.rejects(async () => hub.qaRuns('/unknown'), /Unknown project/); add(report, 'Case', ['failed'], 'passed', 'unexpected');
  report.suites[0].specs[0].tests[0].results[0].attachments = [{ name: 'trace', body: Buffer.from('PK\x03\x04fixture').toString('base64') }];
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(report)); const run = await hub.importQaReport(root, { rel: 'results.json' });
  assert.equal(hub.qaRuns(root).length, 1); assert.equal((await hub.qaCapabilities(root)).traceViewer, false);
  const artifact = run.tests[0].attempts[0].artifacts[0]; await assert.rejects(hub.openQaTrace(root, run.id, artifact.id), /Install Playwright/);
  fs.mkdirSync(path.join(root, 'node_modules/playwright'), { recursive: true }); fs.writeFileSync(path.join(root, 'node_modules/playwright/cli.js'), "if(process.argv[2]!=='show-trace'||!require('fs').existsSync(process.argv[3]))process.exit(2);setTimeout(()=>{},2000)");
  assert.equal((await hub.qaCapabilities(root)).traceViewer, true); assert.deepEqual(await hub.openQaTrace(root, run.id, artifact.id), { opened: true });
  hub.project(root).trusted = false; assert.equal((await hub.qaCapabilities(root)).traceViewer, false); assert.throws(() => hub.openQaTrace(root, run.id, artifact.id), /Trust this project/);
});
