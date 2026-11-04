'use strict';
// Import execution evidence, never infer a passing run from generated text.
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const { projectPath } = require('./files'); const { start, killTree } = require('./proc');
const MAX_REPORT = 16 * 1024 * 1024; const MAX_SAVED = 8 * 1024 * 1024; const MAX_ARTIFACT = 16 * 1024 * 1024; const MAX_EVIDENCE = 32 * 1024 * 1024;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const text = (value, limit = 2000) => typeof value === 'string' ? value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').slice(0, limit) : '';
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
const relative = (value) => typeof value === 'string' && value && !path.isAbsolute(value) && !/^[a-z]:[\\/]/i.test(value) && !value.includes('\0') && !value.replaceAll('\\', '/').split('/').includes('..') ? value.replaceAll('\\', '/') : null;
const message = (error) => text(typeof error === 'string' ? error : error?.message || error?.value || error?.stack, 16000);
const STATUS = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
const counts = (tests) => { const result = { passed: 0, failed: 0, flaky: 0, skipped: 0, blocked: 0, 'not-run': 0, 'expected-failure': 0 }; for (const test of tests) result[test.status]++; return result; };
function outcome(test, attempts) {
  const last = attempts.at(-1); if (!last) return test.status === 'skipped' ? 'skipped' : 'not-run';
  if (last.status === 'interrupted') return 'blocked';
  if (last.status === 'skipped') return 'skipped';
  if (test.status === 'unexpected' || last.status !== test.expectedStatus) return 'failed';
  if (test.status === 'flaky' || attempts.slice(0, -1).some((attempt) => attempt.status !== test.expectedStatus && attempt.status !== 'skipped')) return 'flaky';
  return test.expectedStatus === 'failed' ? 'expected-failure' : 'passed';
}
function sourceRel(root, file, base = '') {
  if (typeof file !== 'string') return null;
  if (path.isAbsolute(file)) { const rel = path.relative(root, file); return relative(rel); }
  const rel = relative(file); return rel ? relative(path.posix.join(base, rel)) : null;
}
function normalizeReport(root, raw, options = {}) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_REPORT) throw new Error('Choose a Playwright JSON report smaller than 16 MB.');
  let report; try { report = JSON.parse(raw); } catch { throw new Error('This file is not valid JSON. Choose a Playwright JSON report.'); }
  if (!report || !report.config || typeof report.config !== 'object' || !Array.isArray(report.suites) || !report.stats || !Array.isArray(report.errors)) throw new Error('This is not a Playwright JSON report. Use the JSON reporter.');
  const source = text(options.source || 'Imported report', 160); const environment = text(options.environment, 160); const build = text(options.build, 200);
  const rootRel = typeof report.config.rootDir === 'string' && path.isAbsolute(report.config.rootDir) ? path.relative(root, report.config.rootDir) : '';
  const base = options.testRoot ? relative(options.testRoot) : rootRel ? relative(rootRel) || '' : '';
  if (options.testRoot && !base) throw new Error('Test folder must be relative to this project.');
  const tests = []; let nodes = 0;
  const stepsOf = (input, depth = 0) => {
    if (!Array.isArray(input)) return []; if (input.length > 200 || depth > 8) throw new Error('This report contains too many nested test steps.');
    return input.map((step) => ({ title: text(step.title), error: message(step.error), durationMs: finite(step.duration), steps: stepsOf(step.steps, depth + 1) }));
  };
  const visit = (suites, names = [], depth = 0) => {
    if (depth > 30) throw new Error('This report has too many nested suites.');
    for (const suite of suites) {
      if (!suite || ++nodes > 10000) throw new Error('This report is too large to import. Split it into smaller runs.');
      for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
        if (!spec || !Array.isArray(spec.tests)) throw new Error('A test entry is malformed. Export the report again.');
        for (const test of spec.tests) {
          if (!test || !Array.isArray(test.results) || !STATUS.has(test.expectedStatus) || test.results.length > 20 || tests.length >= 2000) throw new Error('Invalid or oversized test results. Import at most 2,000 cases and 20 attempts per case.');
          const id = hash(`${text(spec.id)}:${text(test.projectId)}:${tests.length}`).slice(0, 24);
          const attempts = test.results.map((result, index) => {
            if (!result || !STATUS.has(result.status) || (result.attachments?.length || 0) > 30) throw new Error('A test attempt is malformed or has too many attachments.');
            return { index, retry: finite(result.retry), status: result.status, durationMs: finite(result.duration), startedAt: text(result.startTime, 80), errors: (result.errors?.length ? result.errors : result.error ? [result.error] : []).slice(0, 10).map(message), output: [...(Array.isArray(result.stdout) ? result.stdout : []), ...(Array.isArray(result.stderr) ? result.stderr : [])].map((item) => text(item?.text, 8000)).join('').slice(0, 16000), steps: stepsOf(result.steps), artifacts: (Array.isArray(result.attachments) ? result.attachments : []).map((artifact, n) => ({ id: `${id}-${index}-${n}`, name: text(artifact.name || 'Attachment', 160), contentType: text(artifact.contentType, 160), originalPath: text(artifact.path, 4096), body: typeof artifact.body === 'string' ? artifact.body : '', available: false, kind: 'file', note: '' })) };
          });
          tests.push({ id, title: text(spec.title), suite: names.filter(Boolean).join(' › '), projectName: text(test.projectName || test.projectId, 160), file: sourceRel(root, spec.file || suite.file, base), line: Math.max(1, finite(spec.line) || 1), expectedStatus: test.expectedStatus, status: outcome(test, attempts), attempts, durationMs: attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0) });
        }
      }
      if (Array.isArray(suite.suites)) visit(suite.suites, [...names, text(suite.title, 200)], depth + 1);
    }
  };
  visit(report.suites);
  const errors = report.errors.slice(0, 30).map(message); const summary = counts(tests);
  return { version: 1, id: hash(JSON.stringify(report) + JSON.stringify({ environment, build, base })).slice(0, 40), project: root, source, environment, build, importedAt: Date.now(), startedAt: text(report.stats.startTime, 80), durationMs: finite(report.stats.duration), tests, counts: summary, errors, status: errors.length || summary.failed ? 'failed' : summary.blocked ? 'blocked' : !tests.length || summary['not-run'] ? 'incomplete' : summary.flaky ? 'flaky' : summary.passed && !summary.skipped && !summary['expected-failure'] ? 'passed' : 'review' };
}
function mimeOf(buffer, artifact) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { contentType: 'image/png', kind: 'image' };
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return { contentType: 'image/jpeg', kind: 'image' };
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return { contentType: 'image/webp', kind: 'image' };
  if (buffer[0] === 80 && buffer[1] === 75 && /trace/i.test(artifact.name)) return { contentType: 'application/zip', kind: 'trace' };
  return null;
}
function atomic(file, value) {
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, value, { mode: 0o600 }); fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
}
class QaResults {
  constructor(dataDir) { this.dir = path.join(dataDir, 'qa-results'); this.viewers = new Map(); this.importing = new Set(); }
  directory(root) { const dir = path.join(this.dir, hash(root).slice(0, 32)); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir; }
  filename(root, id) { if (typeof id !== 'string' || !/^[a-f0-9]{40}$/.test(id)) throw new Error('Invalid test run.'); return path.join(this.directory(root), `${id}.json`); }
  get(root, id) { const file = this.filename(root, id); if (!fs.existsSync(file)) throw new Error('Test run not found in this project.'); const run = JSON.parse(fs.readFileSync(file, 'utf8')); if (run.project !== root) throw new Error('Test run belongs to another project.'); return run; }
  list(root) { return fs.readdirSync(this.directory(root)).filter((name) => /^[a-f0-9]{40}\.meta\.json$/.test(name)).map((name) => { try { const value = JSON.parse(fs.readFileSync(path.join(this.directory(root), name), 'utf8')); return value.project === root ? value : null; } catch { return null; } }).filter(Boolean).sort((a, b) => b.importedAt - a.importedAt); }
  async import(root, input) {
    if (this.importing.has(root)) throw new Error('A report is already importing for this project.');
    this.importing.add(root);
    try { return await this.importReport(root, input); } finally { this.importing.delete(root); }
  }
  async importReport(root, input) {
    if (!input || typeof input !== 'object') throw new Error('Choose a report to import.');
    let raw = input.text;
    if (input.rel) { const file = await projectPath(root, input.rel); const stat = fs.statSync(file); if (!stat.isFile() || stat.size > MAX_REPORT) throw new Error('Choose a JSON report smaller than 16 MB.'); raw = fs.readFileSync(file, 'utf8'); }
    const run = normalizeReport(root, raw, { ...input, source: input.rel || input.source });
    const file = this.filename(root, run.id); if (fs.existsSync(file)) return this.get(root, run.id);
    if (this.list(root).length >= 20) throw new Error('This project has 20 saved runs. Remove an old run before importing another.');
    const folder = path.join(this.directory(root), run.id); fs.mkdirSync(folder, { mode: 0o700 }); let total = 0;
    try {
      for (const test of run.tests) for (const attempt of test.attempts) for (const artifact of attempt.artifacts) {
        try {
          let buffer;
          if (artifact.body) { if (artifact.body.length > MAX_ARTIFACT * 1.4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(artifact.body)) throw new Error('Attachment exceeds the limit or has invalid encoding.'); buffer = Buffer.from(artifact.body, 'base64'); }
          else { const rel = sourceRel(root, artifact.originalPath); if (!rel) throw new Error('Attachment is outside this project. Import from a local run.'); const source = await projectPath(root, rel); const stat = fs.statSync(source); if (!stat.isFile() || stat.size > MAX_ARTIFACT) throw new Error('Attachment is missing or larger than 16 MB.'); buffer = fs.readFileSync(source); }
          if (buffer.length > MAX_ARTIFACT || total + buffer.length > MAX_EVIDENCE) throw new Error('Evidence limit reached (16 MB per attachment, 32 MB per run).');
          const kind = mimeOf(buffer, artifact); if (!kind) throw new Error('This attachment type is not supported yet.');
          artifact.sha256 = hash(buffer); artifact.size = buffer.length; Object.assign(artifact, kind, { available: true }); total += buffer.length;
          fs.writeFileSync(path.join(folder, artifact.id), buffer, { mode: 0o600 });
        } catch (error) { artifact.note = error.code === 'ENOENT' ? 'Attachment not found. Restore it, remove this saved run, then import again.' : text(error.message, 200); }
        delete artifact.body; delete artifact.originalPath;
      }
      const json = JSON.stringify(run); if (Buffer.byteLength(json) > MAX_SAVED) throw new Error('The normalized report exceeds 8 MB. Split it into smaller runs.');
      atomic(file, json); const { tests, ...summary } = run; atomic(file.replace(/\.json$/, '.meta.json'), JSON.stringify({ ...summary, total: tests.length, artifactBytes: total })); return run;
    } catch (error) { fs.rmSync(folder, { recursive: true, force: true }); fs.rmSync(file, { force: true }); throw error; }
  }
  remove(root, id) { const run = this.get(root, id); fs.rmSync(this.filename(root, id), { force: true }); fs.rmSync(this.filename(root, id).replace(/\.json$/, '.meta.json'), { force: true }); fs.rmSync(path.join(this.directory(root), run.id), { recursive: true, force: true }); return this.list(root); }
  artifact(root, runId, artifactId) { const run = this.get(root, runId); const artifact = run.tests.flatMap((test) => test.attempts.flatMap((attempt) => attempt.artifacts)).find((item) => item.id === artifactId); if (!artifact?.available) throw new Error('Evidence is unavailable.'); const file = path.join(this.directory(root), runId, artifact.id); const buffer = fs.readFileSync(file); if (buffer.length > MAX_ARTIFACT || hash(buffer) !== artifact.sha256) throw new Error('Evidence changed on disk. Import the original report again.'); return { artifact, file, buffer }; }
  image(root, run, artifactId) { const evidence = this.artifact(root, run, artifactId); if (evidence.artifact.kind !== 'image') throw new Error('Choose a screenshot.'); return { base64: evidence.buffer.toString('base64'), contentType: evidence.artifact.contentType, name: evidence.artifact.name, size: evidence.buffer.length }; }
  async traceTool(root) { for (const rel of ['node_modules/playwright/cli.js', 'node_modules/@playwright/test/cli.js']) try { return await projectPath(root, rel); } catch {} return null; }
  async openTrace(root, run, artifactId) {
    const evidence = this.artifact(root, run, artifactId); if (evidence.artifact.kind !== 'trace') throw new Error('Choose a Playwright trace.');
    const cli = await this.traceTool(root); if (!cli) throw new Error('Install Playwright in this project to open its trace viewer.');
    const key = `${root}:${run}:${artifactId}`; if (this.viewers.has(key)) return { opened: true };
    const child = start(process.execPath, [cli, 'show-trace', evidence.file, '--host', '127.0.0.1', '--port', '0'], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }); this.viewers.set(key, child); let output = '';
    child.stderr.on('data', (data) => { output = (output + data.toString()).slice(-1000); }); child.stdout.resume(); child.once('close', () => this.viewers.delete(key));
    return new Promise((resolve, reject) => { let settled = false; const timer = setTimeout(() => { settled = true; resolve({ opened: true }); }, 500); child.once('error', (error) => { this.viewers.delete(key); clearTimeout(timer); if (!settled) { settled = true; reject(error); } }); child.once('close', (code) => { clearTimeout(timer); if (!settled) { settled = true; code ? reject(new Error(text(output, 300) || `Trace viewer exited with code ${code}.`)) : resolve({ opened: true }); } }); });
  }
  bug(root, runId, testId, input = {}) {
    const run = this.get(root, runId); const test = run.tests.find((test) => test.id === testId); if (!test) throw new Error('Test case not found in this run.');
    const last = test.attempts.at(-1); const failing = test.attempts.find((attempt) => attempt.status !== test.expectedStatus && !['skipped', 'interrupted'].includes(attempt.status));
    const details = { title: text(input.title, 300) || test.title, expected: text(input.expected, 8000) || `Expected test status: ${test.expectedStatus}. Business expectation not supplied.`, steps: text(input.steps, 12000), notes: text(input.notes, 8000) };
    const fence = (value) => { const marker = '`'.repeat(Math.max(3, ...[...String(value).matchAll(/`+/g)].map((match) => match[0].length + 1))); return `${marker}\n${value}\n${marker}`; };
    return `# ${details.title}\n\n## Run\n\n- Run: ${run.id}\n- Source: ${run.source}\n- Environment: ${run.environment || 'Not supplied'}\n- Build / commit: ${run.build || 'Not supplied'}\n- Started: ${run.startedAt || 'Not supplied'}\n- Browser project: ${test.projectName || 'Not supplied'}\n- Test: ${test.file || 'Source not mapped'}:${test.line}\n- Outcome: ${test.status}\n- Last attempt: ${last?.status || 'Not run'}\n\n## Expected\n\n${details.expected}\n\n## Steps to reproduce\n\n${details.steps || 'Not supplied. Add the actions needed to reproduce this failure.'}\n\n## Actual evidence\n\n${fence((failing || last)?.errors.join('\n\n') || 'No assertion error was recorded.')}\n\n## Attempts\n\n${test.attempts.map((attempt) => `- Attempt ${attempt.index + 1}: ${attempt.status} (${attempt.durationMs} ms)`).join('\n') || '- Not run'}\n\n## Attachments\n\n${test.attempts.flatMap((attempt) => attempt.artifacts.map((artifact) => `- Attempt ${attempt.index + 1}: ${artifact.name} — ${artifact.available ? `retained locally; SHA-256 ${artifact.sha256}` : artifact.note || 'unavailable'}`)).join('\n') || '- No attachments'}\n\nAttachments remain local and are not bundled in this Markdown export.\n\n## Notes\n\n${details.notes || 'Not supplied.'}\n`;
  }
  stopAll() { for (const child of this.viewers.values()) killTree(child); this.viewers.clear(); }
}
module.exports = { QaResults, normalizeReport, MAX_REPORT };
