'use strict';
// Explicit project checks. No dependency installation and no commands supplied by the renderer.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { which } = require('./agents');
const { start, killTree } = require('./proc');
const LIMIT = 2 * 1024 * 1024;
const exists = (root, file) => fs.existsSync(path.join(root, file));
const text = (root, file) => { try { const p = path.join(root, file); return fs.statSync(p).size <= LIMIT ? fs.readFileSync(p, 'utf8') : ''; } catch { return ''; } };

function executable(name, root) {
  const packages = { biome: '@biomejs/biome', oxlint: 'oxlint', stylelint: 'stylelint', pyright: 'pyright', 'markdownlint-cli2': 'markdownlint-cli2' };
  if (packages[name]) try {
    const dir = path.join(root, 'node_modules', packages[name]); const pkg = JSON.parse(text(dir, 'package.json'));
    const entry = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[name];
    if (entry && exists(dir, entry)) return { bin: process.execPath, prefix: [path.resolve(dir, entry)] };
  } catch { /* Fall back to the user's PATH. */ }
  const local = ['ruff', 'pylint', 'mypy', 'flake8', 'sqlfluff', 'pyright'].includes(name) ? path.join(root, '.venv', process.platform === 'win32' ? `Scripts/${name}.exe` : `bin/${name}`) : null;
  const bin = local && fs.existsSync(local) ? local : which(name, process.env);
  if (!bin) return null;
  // Execute package-manager JS entrypoints directly on Windows, rather than interpolating a shell command.
  if (/\.(cmd|bat)$/i.test(bin)) {
    const entries = { npm: 'npm/bin/npm-cli.js', pnpm: 'pnpm/bin/pnpm.cjs', yarn: 'yarn/bin/yarn.js' };
    const script = entries[name] && path.join(path.dirname(bin), 'node_modules', entries[name]);
    return script && fs.existsSync(script) ? { bin: process.execPath, prefix: [script] } : null;
  }
  return { bin, prefix: [] };
}
function discoverChecks(root) {
  const tools = [];
  const add = (id, label, command, args, launch = executable(command, root)) => tools.push({ id, label, command: [command, ...args].join(' '), available: !!launch, bin: launch?.bin, args: [...(launch?.prefix || []), ...args] });
  let pkg = {}; try { pkg = JSON.parse(text(root, 'package.json')); } catch {}
  const scripts = pkg.scripts || {};
  const manager = exists(root, 'pnpm-lock.yaml') ? 'pnpm' : exists(root, 'yarn.lock') ? 'yarn' : exists(root, 'bun.lock') || exists(root, 'bun.lockb') ? 'bun' : 'npm';
  for (const name of ['lint', 'typecheck', 'type-check', 'check', 'format:check', 'test']) if (typeof scripts[name] === 'string' && scripts[name].trim()) add(`script:${name}`, { lint: 'Lint', typecheck: 'Type check', 'type-check': 'Type check', check: 'Check', 'format:check': 'Check formatting', test: 'Test' }[name], manager, ['run', name]);
  if (!scripts.lint && exists(root, 'node_modules/eslint/bin/eslint.js')) add('eslint', 'ESLint', 'eslint', ['.', '--format', 'json'], { bin: process.execPath, prefix: [path.join(root, 'node_modules/eslint/bin/eslint.js')] });
  if (!scripts.typecheck && !scripts['type-check'] && exists(root, 'tsconfig.json') && exists(root, 'node_modules/typescript/bin/tsc')) add('tsc', 'TypeScript', 'tsc', ['--noEmit', '--pretty', 'false'], { bin: process.execPath, prefix: [path.join(root, 'node_modules/typescript/bin/tsc')] });
  const configured = (files) => files.some((file) => exists(root, file));
  const nodeTool = (id, label, files, args, packageName = id) => { if (configured(files) || exists(root, `node_modules/${packageName}/package.json`)) add(id, label, id, args); };
  nodeTool('biome', 'Biome', ['biome.json', 'biome.jsonc'], ['check', '.', '--reporter=rdjson'], '@biomejs/biome');
  nodeTool('oxlint', 'Oxlint', ['.oxlintrc.json', 'oxlint.config.ts'], ['.', '--format', 'json', '--ignore-pattern=**/node_modules/**']);
  nodeTool('stylelint', 'Stylelint', ['.stylelintrc', '.stylelintrc.json', '.stylelintrc.yml', 'stylelint.config.js', 'stylelint.config.cjs', 'stylelint.config.mjs'], ['**/*.{css,scss,less}', '--formatter', 'json']);
  nodeTool('markdownlint-cli2', 'Markdownlint', ['.markdownlint.json', '.markdownlint.jsonc', '.markdownlint.yaml', '.markdownlint-cli2.jsonc', '.markdownlint-cli2.yaml'], ['**/*.md', '#node_modules', '#.git']);
  if (exists(root, 'Cargo.toml')) { add('clippy', 'Clippy', 'cargo', ['clippy', '--message-format=json']); add('rustfmt', 'Check Rust formatting', 'cargo', ['fmt', '--all', '--', '--check']); }
  if (exists(root, 'go.mod') || exists(root, 'go.work')) {
    add('vet', 'Go vet', 'go', ['vet', './...']); add('staticcheck', 'Staticcheck', 'staticcheck', ['-f', 'json', './...']);
    if (configured(['.golangci.yml', '.golangci.yaml', '.golangci.toml', '.golangci.json'])) add('golangci-lint', 'Golangci-lint (v2)', 'golangci-lint', ['run', '--output.json.path=stdout']);
  }
  if (configured(['pyproject.toml', 'ruff.toml', '.ruff.toml', 'requirements.txt', 'setup.py', 'pyrightconfig.json'])) {
    add('ruff', 'Ruff', 'ruff', ['check', '.', '--output-format', 'json']);
    const pyproject = text(root, 'pyproject.toml');
    if (exists(root, 'pyrightconfig.json') || pyproject.includes('[tool.pyright]') || executable('pyright', root)) add('pyright', 'Pyright', 'pyright', ['--outputjson']);
    if (configured(['mypy.ini', '.mypy.ini']) || /\[mypy\]/.test(text(root, 'setup.cfg')) || pyproject.includes('[tool.mypy]')) add('mypy', 'Mypy', 'mypy', ['.', '--show-column-numbers', '--no-error-summary']);
    if (configured(['.pylintrc', 'pylintrc']) || pyproject.includes('[tool.pylint')) add('pylint', 'Pylint', 'pylint', ['.', '--recursive=y', '--output-format=json']);
    if (exists(root, '.flake8') || /\[flake8\]/.test(text(root, 'setup.cfg'))) add('flake8', 'Flake8', 'flake8', ['.']);
  }
  if (configured(['.sqlfluff', '.sqlfluffignore']) || text(root, 'pyproject.toml').includes('[tool.sqlfluff')) add('sqlfluff', 'SQLFluff', 'sqlfluff', ['lint', '.', '--format', 'json']);
  if (exists(root, '.tflint.hcl') || (() => { try { return fs.readdirSync(root).some((f) => f.endsWith('.tf')); } catch { return false; } })()) add('tflint', 'TFLint', 'tflint', ['--recursive', '--format=json']);
  return tools;
}
function diagnosticPath(root, file) {
  if (typeof file === 'string' && file.startsWith('file://')) try { file = fileURLToPath(file); } catch { return null; }
  if (typeof file !== 'string' || !file || file.includes('\0') || (/^[A-Za-z]:[\\/]/.test(file) && !path.isAbsolute(file))) return null;
  const abs = path.resolve(root, file); const rel = path.relative(root, abs);
  if (!rel || rel.startsWith(`..${path.sep}`) || rel === '..' || path.isAbsolute(rel)) return null;
  try { const real = path.relative(fs.realpathSync(root), fs.realpathSync(abs)); if (real === '..' || real.startsWith(`..${path.sep}`) || path.isAbsolute(real)) return null; } catch { /* A deleted file can still have a diagnostic. */ }
  return rel.split(path.sep).join('/');
}
function parseDiagnostics(root, raw) {
  const output = raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''); const result = []; const seen = new Set();
  const add = (file, line, column, severity, message, source = '') => {
    const rel = diagnosticPath(root, file); if (!rel || !message || result.length >= 500) return;
    const item = { rel, line: Math.min(10000000, Math.max(1, Number(line) || 1)), column: Math.min(10000000, Math.max(1, Number(column) || 1)), severity: severity === 'warning' ? 'warning' : severity === 'info' ? 'info' : 'error', message: String(message).slice(0, 4000), source: String(source || '').slice(0, 120) };
    const key = JSON.stringify(item); if (!seen.has(key)) { seen.add(key); result.push(item); }
  };
  const structured = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) for (const item of value) {
      if (item.filePath && Array.isArray(item.messages)) for (const m of item.messages) add(item.filePath, m.line, m.column, m.severity === 1 ? 'warning' : 'error', m.message, m.ruleId || 'ESLint');
      if (item.filename && item.location) add(item.filename, item.location.row, item.location.column, 'error', item.message, item.code || 'Ruff');
      if (item.source && Array.isArray(item.warnings)) for (const m of item.warnings) add(item.source, m.line, m.column, m.severity, m.text, m.rule || 'Stylelint');
      if (item.path && item.type && item.message) add(item.path, item.line, Number(item.column || 0) + 1, ['warning', 'convention', 'refactor'].includes(item.type) ? 'warning' : 'error', item.message, item.symbol || item['message-id'] || 'Pylint');
      if (item.filepath && Array.isArray(item.violations)) for (const m of item.violations) add(item.filepath, m.start_line_no ?? m.line_no, m.start_line_pos ?? m.line_pos, m.warning ? 'warning' : 'error', m.description, m.code || 'SQLFluff');
    }
    for (const m of value.generalDiagnostics || []) add(m.file, (m.range?.start?.line ?? 0) + 1, (m.range?.start?.character ?? 0) + 1, m.severity, m.message, m.rule || 'Pyright');
    for (const m of value.Issues || []) add(m.Pos?.Filename, m.Pos?.Line, m.Pos?.Column, m.Severity, m.Text, m.FromLinter || 'Go');
    for (const m of value.issues || []) if (m.range?.filename) add(m.range.filename, m.range.start?.line, m.range.start?.column, m.rule?.severity, m.message, m.rule?.name || 'TFLint');
    for (const m of value.diagnostics || []) {
      // Oxlint JSON and the Reviewdog JSON emitted by Biome.
      const position = m.labels?.[0]?.span || m.location?.range?.start;
      add(m.filename || m.location?.path, position?.line, position?.column, String(m.severity || value.severity || '').toLowerCase(), m.message, m.code?.value || m.code || '');
    }
    if (value.location?.file && value.code && value.message) add(value.location.file, value.location.line, value.location.column, 'warning', value.message, value.code);
    const m = value.reason === 'compiler-message' && value.message;
    if (m) { const span = m.spans?.find((s) => s.is_primary) || m.spans?.[0]; if (span) add(span.file_name, span.line_start, span.column_start, m.level, m.message, m.code?.code || 'Rust'); }
  };
  // Structured reporters may follow package-manager banners; NDJSON is handled line by line below.
  const first = output.search(/(?:^|\n)\s*[\[{]/);
  if (first >= 0) { const start = first + output.slice(first).search(/[\[{]/); const close = output[start] === '[' ? ']' : '}'; try { structured(JSON.parse(output.slice(start, output.lastIndexOf(close) + 1))); } catch { /* NDJSON or human-readable output. */ } }
  let file = '';
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('{')) try {
      structured(JSON.parse(line));
      continue;
    } catch { /* Not JSON. */ }
    let match = line.match(/^\s*(.+?)\((\d+),(\d+)\):\s*(error|warning)\s*([^:]*):\s*(.*)$/);
    if (match) { add(match[1], match[2], match[3], match[4], match[6], match[5]); continue; }
    match = line.match(/^\s*(.+?):(\d+)(?::(\d+))?:\s*(?:(error|warning|info)(?:\s*\[[^\]]+\])?:?\s*)?(.*)$/);
    if (match) { add(match[1], match[2], match[3], match[4], match[5]); continue; }
    match = line.match(/^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}(\S+)\s*$/);
    if (match && file) { add(file, match[1], match[2], match[3], match[4], match[5]); continue; }
    const candidate = line.trim(); if (/\.[A-Za-z0-9]+$/.test(candidate) && diagnosticPath(root, candidate)) file = candidate;
  }
  return result;
}
class ProjectChecks {
  constructor({ timeout = 120000, discover = discoverChecks } = {}) { this.jobs = new Map(); this.timeout = timeout; this.discover = discover; }
  state(root) { const job = this.jobs.get(root); return { running: !!job?.child, toolId: job?.toolId || null, result: job?.result || null }; }
  catalog(root) { return { tools: this.discover(root).map(({ bin, args, ...tool }) => tool), ...this.state(root) }; }
  run(root, id) {
    if (!fs.existsSync(root)) throw new Error('Project folder unavailable.');
    if (this.jobs.get(root)?.child) throw new Error('A project check is already running.');
    const tool = this.discover(root).find((t) => t.id === id); if (!tool) throw new Error('Unknown project check.'); if (!tool.available) throw new Error('Tool not installed.');
    const startedAt = Date.now(); const child = start(tool.bin, tool.args, { cwd: root, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1', ELECTRON_RUN_AS_NODE: '1' } });
    const job = { child, toolId: id, result: null, stopped: false }; this.jobs.set(root, job);
    return new Promise((resolve) => {
      let output = ''; let bytes = 0; let reason = ''; let finished = false;
      const stop = (message) => { reason = message; killTree(child); };
      const timer = setTimeout(() => stop('Check timed out after two minutes.'), this.timeout); timer.unref();
      const append = (chunk) => { const data = Buffer.from(chunk); const remaining = LIMIT - bytes; if (remaining > 0) output += data.subarray(0, remaining).toString('utf8'); bytes += data.length; if (bytes > LIMIT && !reason) stop('Output limit reached.'); };
      child.stdout.on('data', append); child.stderr.on('data', append);
      const finish = (code, error) => {
        if (finished) return; finished = true; clearTimeout(timer);
        if (error) reason = error.code === 'ENOENT' ? 'Tool not installed.' : error.message;
        if (job.stopped) reason = 'Check stopped.';
        if (reason) output += `\n${reason}`;
        job.result = { toolId: id, label: tool.label, command: tool.command, code: reason ? 1 : code ?? 1, stopped: job.stopped, startedAt, finishedAt: Date.now(), output, diagnostics: parseDiagnostics(root, output) }; job.child = null; resolve(job.result);
      };
      child.on('error', (error) => finish(1, error)); child.on('close', (code) => finish(code));
    });
  }
  stop(root) { const job = this.jobs.get(root); if (job?.child) { job.stopped = true; killTree(job.child); } return this.state(root); }
  stopAll() { for (const root of this.jobs.keys()) this.stop(root); }
}
module.exports = { ProjectChecks, discoverChecks, parseDiagnostics };
