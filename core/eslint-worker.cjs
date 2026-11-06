'use strict';
// One project-owned process. ESLint returns edits; this worker never saves files.
const readline = require('node:readline'); const { pathToFileURL } = require('node:url');
let busy = false;
async function lint(job) {
  if (typeof job.text !== 'string' || Buffer.byteLength(job.text) > 1024 * 1024 || job.text.includes('\0')) throw Error('Lint text files up to 1 MB.');
  const config = job.config; process.chdir(config.changeProcessCwd ? config.cwd : job.root);
  const imported = await import(pathToFileURL(config.library).href); const library = imported.default || imported;
  if (Number(config.version?.split('.')[0]) >= 10 && config.useFlatConfig === false) throw Error('ESLint 10 requires flat config. Migrate .eslintrc or use the project’s compatible ESLint version.');
  const Constructor = typeof library.loadESLint === 'function' ? await library.loadESLint({ useFlatConfig: config.useFlatConfig }) : library.ESLint;
  if (typeof Constructor !== 'function') throw Error('Use a project ESLint version with the ESLint class API (7 or newer).');
  const engine = new Constructor({ cwd: config.cwd, fix: job.fix === true });
  if (await engine.isPathIgnored(job.filename)) return { status: 'ignored', diagnostics: [] };
  const results = await engine.lintText(job.text, { filePath: job.filename });
  const result = results[0]; const output = result?.output;
  if (output != null && (typeof output !== 'string' || Buffer.byteLength(output) > 2 * 1024 * 1024)) throw Error('ESLint edits exceed the document limit.');
  const diagnostics = (result?.messages || []).filter(item => item.severity > 0 && (!config.quiet || item.severity > 1)).slice(0, 500).map(item => ({
    rel: job.rel, line: Math.max(1, Number(item.line) || 1), column: Math.max(1, Number(item.column) || 1),
    endLine: Number.isSafeInteger(item.endLine) ? item.endLine : undefined, endColumn: Number.isSafeInteger(item.endColumn) ? item.endColumn : undefined,
    severity: item.severity === 1 ? 'warning' : 'error', message: String(item.message || '').slice(0, 4000), source: item.ruleId ? `ESLint (${String(item.ruleId).slice(0, 120)})` : 'ESLint',
  }));
  return { status: 'ready', diagnostics, ...(job.fix && output != null ? { output } : {}) };
}
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  let job;
  try { if (busy || Buffer.byteLength(line) > 3 * 1024 * 1024) throw Error('Invalid lint request.'); job = JSON.parse(line); } catch { process.exitCode = 1; input.close(); process.stdin.destroy(); return; }
  busy = true; const id = job.id;
  void lint(job).then(result => ({ id, result }), error => ({ id, error: String(error.message || error).slice(0, 600) })).then(result => {
    busy = false; process.stdout.write('\nTRIBUTARY_ESLINT_RESULT:' + JSON.stringify(result) + '\n');
  });
});
