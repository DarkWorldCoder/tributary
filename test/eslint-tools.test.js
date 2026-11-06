'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { EslintTools } = require('../core/eslint-tools'); const { eslintFixture, delay, until } = require('./helpers/eslint-fixture');
function tools(t, trusted = true) { const service = new EslintTools({ trusted: () => trusted }); t.after(() => service.stopAll()); return service; }
test('lint documents share a project process, return exact ranges and undoable edits without writing files', async t => {
  const { root } = eslintFixture(t); const service = tools(t); const owner = service.acquire(root, 'sample.js'), other = service.acquire(root, 'other.ts');
  const original = fs.readFileSync(path.join(root, 'sample.js'), 'utf8');
  const result = await service.document(root, 'sample.js', original, owner, 'open'); const child = service.lanes.get(root).child;
  assert.equal(result.diagnostics[0].endColumn, 4); assert.equal(result.diagnostics[0].message, original);
  await service.document(root, 'other.ts', 'const answer: number = 1;', other, 'open'); assert.equal(service.lanes.get(root).child, child);
  assert.equal((await service.fix(root, 'sample.js', original)).output, 'let answer = missing;\n');
  assert.equal(fs.readFileSync(path.join(root, 'sample.js'), 'utf8'), original);
  service.release(root, 'sample.js', owner); assert.equal(service.lanes.get(root).child, child);
  const exited = new Promise(resolve => child.once('close', resolve)); service.release(root, 'other.ts', other); await exited;
  assert.equal(service.lanes.size, 0); assert.equal(service.owners.size, 0); assert.notEqual(child.exitCode, undefined);
});
test('closed lint owners cannot submit work or receive replies; queued typing checks are bounded and coalesced', async t => {
  const { root } = eslintFixture(t); const service = tools(t); const owner = service.acquire(root, 'sample.js');
  const first = service.document(root, 'sample.js', 'SLOW first', owner); await until(() => service.lanes.get(root)?.current);
  const queued = Array.from({ length: 8 }, (_, i) => service.document(root, 'sample.js', `value ${i}`, owner));
  const results = await Promise.all([first, ...queued]); assert.ok(results.filter(result => result.status === 'cancelled').length >= 6);
  assert.ok(results.some(result => result.diagnostics[0]?.message === 'value 7'));
  const pending = assert.rejects(service.document(root, 'sample.js', 'SLOW closed', owner), /closed/);
  await until(() => service.lanes.get(root)?.current); service.release(root, 'sample.js', owner); await pending;
  await assert.rejects(service.document(root, 'sample.js', 'late', owner), /closed/);
  const replacement = service.acquire(root, 'sample.js'); assert.notEqual(owner, replacement);
  assert.equal((await service.document(root, 'sample.js', 'replacement', replacement)).diagnostics[0].message, 'replacement');
});
test('changed config restarts ESLint, while on-save, ignored, disabled and untrusted files do not run checks', async t => {
  const { root, put } = eslintFixture(t); const service = tools(t); const owner = service.acquire(root, 'sample.js');
  await service.document(root, 'sample.js', 'initial', owner); const child = service.lanes.get(root).child;
  put('eslint.config.cjs', '// new-rule\nmodule.exports = [];');
  assert.match((await service.document(root, 'sample.js', 'new', owner)).diagnostics[0].source, /new-rule/); assert.notEqual(service.lanes.get(root).child, child);
  put('.vscode/settings.json', '{"eslint.run":"onSave"}'); assert.equal((await service.document(root, 'sample.js', 'typed', owner)).status, 'on-save');
  assert.equal((await service.document(root, 'sample.js', 'saved', owner, 'save')).diagnostics[0].message, 'saved');
  put('ignored.js', 'var ignored;'); const ignored = service.acquire(root, 'ignored.js'); assert.equal((await service.document(root, 'ignored.js', 'ignore', ignored, 'open')).status, 'ignored');
  put('.vscode/settings.json', '{"eslint.validate":[]}'); assert.equal((await service.document(root, 'sample.js', 'disabled', owner)).status, 'disabled');
  put('.vscode/settings.json', '{}'); const untrusted = tools(t, false), token = untrusted.acquire(root, 'sample.js');
  await assert.rejects(untrusted.document(root, 'sample.js', 'private', token), /Trust/); assert.equal(untrusted.lanes.size, 0);
});
test('project worker capacity and hostile output fail explicitly and final release leaves no process', async t => {
  const service = tools(t); const projects = Array.from({ length: 3 }, () => eslintFixture(t)); const owners = projects.map(({ root }) => service.acquire(root, 'sample.js'));
  for (let i = 0; i < 2; i++) await service.document(projects[i].root, 'sample.js', 'ready', owners[i]);
  await assert.rejects(service.document(projects[2].root, 'sample.js', 'third', owners[2]), /Close an unused project/);
  service.release(projects[0].root, 'sample.js', owners[0]); await service.document(projects[2].root, 'sample.js', 'third', owners[2]);
  await assert.rejects(service.document(projects[1].root, 'sample.js', 'FLOOD', owners[1]), /output exceeded/);
  assert.equal(service.lanes.get(projects[1].root).child, null);
  const root = projects[2].root; const hanging = assert.rejects(service.document(root, 'sample.js', 'HANG', owners[2]), /closed/);
  await until(() => service.lanes.get(root)?.current); const child = service.lanes.get(root).child; const exit = new Promise(resolve => child.once('close', resolve));
  service.stopAll(); await hanging; await exit; assert.equal(service.owners.size, 0); assert.equal(service.lanes.size, 0);
});
