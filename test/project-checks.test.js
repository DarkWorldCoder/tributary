'use strict';
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { ProjectChecks, discoverChecks, parseDiagnostics } = require('../core/project-checks');
const roots = [];
const tmp = () => { const root = mkTmp('checks'); roots.push(root); return root; };
test.after(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });
test('checks discover configured scripts and local languages without running or installing tools', () => {
  const root = tmp(); fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .', typecheck: 'tsc', 'format:check': 'prettier --check .', test: 'node --test', 'lint:fix': 'eslint --fix .' } })); fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), '');
  fs.writeFileSync(path.join(root, 'Cargo.toml'), ''); fs.writeFileSync(path.join(root, 'go.mod'), ''); fs.writeFileSync(path.join(root, 'pyproject.toml'), '');
  const tools = discoverChecks(root); assert.equal(tools.find((t) => t.id === 'script:lint').command, 'pnpm run lint');
  assert.ok(!tools.some((t) => t.id.includes('fix'))); assert.ok(tools.some((t) => t.id === 'clippy')); assert.ok(tools.some((t) => t.id === 'vet')); assert.ok(tools.some((t) => t.id === 'ruff'));
  assert.ok(tools.find((t) => t.id === 'rustfmt').command.endsWith('--check'));
});
test('diagnostics parse ESLint, Ruff, Cargo, TypeScript, Go and stylish locations', () => {
  const root = tmp(); const eslint = [{ filePath: path.join(root, 'src/a.ts'), messages: [{ line: 2, column: 4, severity: 1, message: 'Unused value', ruleId: 'no-unused-vars' }] }];
  assert.deepEqual(parseDiagnostics(root, `> lint\n${JSON.stringify(eslint)}`)[0], { rel: 'src/a.ts', line: 2, column: 4, severity: 'warning', message: 'Unused value', source: 'no-unused-vars' });
  assert.equal(parseDiagnostics(root, JSON.stringify([{ filename: path.join(root, 'main.py'), location: { row: 3, column: 1 }, message: 'Unused import', code: 'F401' }]))[0].source, 'F401');
  const rust = { reason: 'compiler-message', message: { level: 'error', message: 'Wrong type', code: { code: 'E0308' }, spans: [{ is_primary: true, file_name: 'src/main.rs', line_start: 4, column_start: 2 }] } };
  assert.equal(parseDiagnostics(root, JSON.stringify(rust))[0].line, 4);
  const list = parseDiagnostics(root, `src/a.ts(5,8): error TS2322: Wrong type\n./main.go:3:2: missing argument\n${path.join(root, 'file.js')}\n  4:7  warning  Unused  no-unused-vars\n../outside.ts:1:2: error: private\n`);
  assert.equal(list.length, 3); assert.equal(list[0].source, 'TS2322'); assert.equal(list[1].rel, 'main.go'); assert.equal(list[2].severity, 'warning');
});
test('diagnostics reject outside paths, symlinks and bound large result sets', () => {
  const root = tmp(); const outside = tmp(); fs.writeFileSync(path.join(outside, 'file.js'), '');
  if (process.platform !== 'win32') { fs.symlinkSync(outside, path.join(root, 'link')); assert.equal(parseDiagnostics(root, 'link/file.js:1:1: error: outside').length, 0); }
  assert.equal(parseDiagnostics(root, `${path.join(outside, 'file.js')}:1:1: error: outside`).length, 0);
  assert.equal(parseDiagnostics(root, Array.from({ length: 700 }, (_, i) => `src/file.js:${i + 1}:1: error: message`).join('\n')).length, 500);
});
test('checks discover configured linters and prefer local package and virtual-environment binaries', () => {
  const root = tmp();
  for (const file of ['biome.json', '.oxlintrc.json', '.stylelintrc.json', '.markdownlint.json', 'pyrightconfig.json', '.pylintrc', '.flake8', 'mypy.ini', '.sqlfluff', 'go.mod', '.golangci.yml', 'main.tf']) fs.writeFileSync(path.join(root, file), '{}');
  const bin = path.join(root, 'node_modules/oxlint/bin'); fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'oxlint.js'), ''); fs.writeFileSync(path.join(bin, '../package.json'), JSON.stringify({ bin: { oxlint: 'bin/oxlint.js' } }));
  const venv = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin'); fs.mkdirSync(venv, { recursive: true });
  fs.writeFileSync(path.join(venv, process.platform === 'win32' ? 'ruff.exe' : 'ruff'), '');
  const tools = discoverChecks(root);
  for (const id of ['biome', 'oxlint', 'stylelint', 'markdownlint-cli2', 'pyright', 'mypy', 'pylint', 'flake8', 'sqlfluff', 'staticcheck', 'golangci-lint', 'tflint']) assert.ok(tools.some((t) => t.id === id), id);
  assert.equal(tools.find((t) => t.id === 'oxlint').bin, process.execPath);
  assert.equal(tools.find((t) => t.id === 'ruff').bin, path.join(venv, process.platform === 'win32' ? 'ruff.exe' : 'ruff'));
  assert.ok(tools.every((t) => !t.args.includes('--fix') && !t.args.includes('--write')));
});
test('structured language reporters preserve locations, severities and rule names', () => {
  const root = tmp();
  const fixtures = [
    [[{ source: 'a.css', warnings: [{ line: 2, column: 5, severity: 'warning', text: 'Unknown property', rule: 'property-no-unknown' }] }], 'a.css', 2, 5, 'warning'],
    [{ generalDiagnostics: [{ file: path.join(root, 'a.py'), range: { start: { line: 1, character: 4 } }, severity: 'error', message: 'Wrong type', rule: 'reportArgumentType' }] }, 'a.py', 2, 5, 'error'],
    [[{ path: 'b.py', line: 2, column: 4, type: 'convention', message: 'Missing docstring', symbol: 'missing-docstring' }], 'b.py', 2, 5, 'warning'],
    [[{ filepath: 'a.sql', violations: [{ start_line_no: 2, start_line_pos: 5, description: 'Indent', code: 'LT02' }] }], 'a.sql', 2, 5, 'error'],
    [{ Issues: [{ Pos: { Filename: 'a.go', Line: 2, Column: 5 }, Text: 'Unused', FromLinter: 'unused' }] }, 'a.go', 2, 5, 'error'],
    [{ issues: [{ range: { filename: 'main.tf', start: { line: 2, column: 5 } }, message: 'Deprecated', rule: { name: 'deprecated', severity: 'warning' } }] }, 'main.tf', 2, 5, 'warning'],
    [{ diagnostics: [{ filename: 'a.ts', labels: [{ span: { line: 2, column: 5 } }], message: 'Unused', code: 'no-unused-vars', severity: 'warning' }] }, 'a.ts', 2, 5, 'warning'],
    [{ diagnostics: [{ location: { path: 'a.js', range: { start: { line: 2, column: 5 } } }, message: 'Unused', code: { value: 'lint/correctness/noUnusedVariables' }, severity: 'ERROR' }] }, 'a.js', 2, 5, 'error'],
    [{ code: 'SA1000', message: 'Invalid regex', location: { file: 'a.go', line: 2, column: 5 } }, 'a.go', 2, 5, 'warning'],
  ];
  for (const [value, rel, line, column, severity] of fixtures) {
    const result = parseDiagnostics(root, `> check\n${JSON.stringify(value, null, 2)}`);
    assert.equal(result.length, 1, rel); assert.deepEqual([result[0].rel, result[0].line, result[0].column, result[0].severity], [rel, line, column, severity]);
  }
  const records = [{ code: 'SA1000', message: 'First', location: { file: 'a.go', line: 2, column: 5 } }, { code: 'SA1001', message: 'Second', location: { file: 'a.go', line: 3, column: 2 } }];
  assert.equal(parseDiagnostics(root, records.map(JSON.stringify).join('\n')).length, 2);
});
const fixture = (args) => [{ id: 'fixture', label: 'Fixture', command: 'fixture check', available: true, bin: process.execPath, args }];
test('checks execute a fixed catalog action, retain its result and reject arbitrary commands', async () => {
  const root = tmp(); const checks = new ProjectChecks({ discover: () => fixture(['-e', 'console.log("file.js:2:3: error: Broken");process.exitCode=1']) });
  assert.throws(() => checks.run(root, 'echo private'), /Unknown/);
  const result = await checks.run(root, 'fixture'); assert.equal(result.code, 1); assert.equal(result.diagnostics[0].line, 2); assert.equal(checks.state(root).running, false); assert.equal(checks.state(root).result, result);
});
test('running checks can be stopped and duplicate starts are rejected', async () => {
  const root = tmp(); const checks = new ProjectChecks({ discover: () => fixture(['-e', 'setInterval(()=>{},1000)']) });
  const running = checks.run(root, 'fixture'); assert.equal(checks.state(root).running, true); assert.throws(() => checks.run(root, 'fixture'), /already running/);
  checks.stop(root); const result = await running; assert.equal(result.stopped, true); assert.match(result.output, /stopped/); assert.equal(checks.state(root).running, false);
});
test('checks bound output and terminate on timeout', async () => {
  const root = tmp(); const checks = new ProjectChecks({ timeout: 30, discover: () => fixture(['-e', 'setInterval(()=>{},1000)']) });
  const timeout = await checks.run(root, 'fixture'); assert.equal(timeout.code, 1); assert.match(timeout.output, /timed out/);
  const loud = new ProjectChecks({ discover: () => fixture(['-e', 'process.stdout.write("x".repeat(3*1024*1024));setInterval(()=>{},1000)']) });
  const bounded = await loud.run(root, 'fixture'); assert.ok(bounded.output.length < 2 * 1024 * 1024 + 100); assert.match(bounded.output, /limit reached/);
});
test('hub exposes checks only for registered workspaces', async () => {
  const { Hub } = require('../core/hub'); const { MemorySecrets } = require('../core/store');
  const hub = new Hub({ dataDir: tmp(), secrets: new MemorySecrets() }); const root = tmp();
  try { assert.throws(() => hub.projectCheckTools(root), /Unknown project/); assert.throws(() => hub.runProjectCheck(root, 'script:lint'), /Unknown project/); hub.addProject(root); assert.deepEqual(hub.projectCheckTools(root).tools, []); }
  finally { hub.projectChecks.stopAll(); hub.fileWatches.close(); hub.store.close(); }
});
