'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
const [baseline, output] = process.argv.slice(2);
if (!/^[0-9a-f]{7,40}$/.test(baseline || '') || !output || !path.isAbsolute(output)) throw Error('Pass a baseline commit SHA and absolute output path.');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-grammar-owner-'));
try {
  const old = path.join(root, 'baseline.mjs'), current = path.join(repo, 'ui/src/lib/editor-grammar.mjs'), probe = path.join(__dirname, 'grammar-owner-probe.mjs');
  fs.writeFileSync(old, execFileSync('git', ['show', `${baseline}:ui/src/lib/editor-grammar.mjs`], { cwd: repo }));
  const measure = module => JSON.parse(execFileSync(process.execPath, ['--expose-gc', probe, module], { encoding: 'utf8', timeout: 15000 }));
  const before = measure(old), after = measure(current);
  assert.deepEqual(before.cases.map(entry => entry.ownerReleased), [false, false, true]);
  assert.deepEqual(after.cases.map(entry => entry.ownerReleased), [true, true, true]);
  assert.deepEqual(after.cases.map(entry => entry.loads), [1, 0, 0]);
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const report = { date: new Date().toISOString(), baseline, before, after,
    method: 'Separate Node subprocesses; explicit diagnostic GC after event-loop turns; unresolved load promises and current inactive-effect cleanups deliberately remain rooted. WeakRef is read only after the collection loop.',
    scope: 'Reachability of synthetic owner objects, not exact bytes, real EditorView/app RAM, natural GC latency or model memory. No product forced GC or finalizer dependency.',
    sourceHashes: { baseline: hash(old), current: hash(current), probe: hash(probe), runner: hash(__filename) } };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
