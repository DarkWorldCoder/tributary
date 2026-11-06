'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..'), baseline = '7c49ca232c13ea1d8bf27da27b2841fa2519bc93';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const sources = ['core/filename-search.js', 'core/hub.js', 'desktop/main.js', 'ui/src/components/quick-open.tsx', 'ui/src/lib/file-search.mjs', 'scripts/performance/filename-native.cjs', 'scripts/performance/native-filename-latency.cjs'];
const hashes = () => Object.fromEntries(sources.map(file => [file, digest(fs.readFileSync(path.join(repo, file)))]));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const output = process.argv[2]; if (!output || !path.isAbsolute(output)) throw Error('Pass an absolute output report path.');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-native-filename-')), sourceHashes = hashes();
try {
  const project = path.join(scratch, 'project'), prefix = 'src/a/b/c/d/e/'; fs.mkdirSync(path.join(project, prefix), { recursive: true }); const paths = [];
  for (let at = 0; at < 40000; at++) { const name = prefix + `source-${String(at).padStart(6, '0')}.ts`; fs.closeSync(fs.openSync(path.join(project, name), 'w')); paths.push(name); }
  for (let at = 0; at < 8; at++) { const name = prefix + `target-${String(at).padStart(6, '0')}.ts`; fs.writeFileSync(path.join(project, name), `export const source = ${at};\n`); paths.push(name); }
  fs.writeFileSync(path.join(project, 'main.ts'), 'export const main = true;\n'); paths.push('main.ts');
  const fixture = ['target-000000.ts', 'target-000007.ts', 'src/a/b/c/d/e/', 'b', 'e/target-000003.ts', 'missing-needle'].map(query => { const found = paths.filter(name => name.toLowerCase().includes(query)).sort(); return { query, files: found.slice(0, 100), total: found.length }; });
  const cases = path.join(scratch, 'cases.json'); fs.writeFileSync(cases, JSON.stringify(fixture));
  const old = path.join(scratch, 'filename-search.js'); fs.writeFileSync(old, execFileSync('git', ['show', `${baseline}:core/filename-search.js`], { cwd: repo }));
  const built = fs.readdirSync(path.join(repo, 'ui/dist/assets')).filter(name => name.endsWith('.js')).sort();
  const uiHashes = Object.fromEntries(built.map(name => [name, digest(fs.readFileSync(path.join(repo, 'ui/dist/assets', name)))]));
  const runs = [];
  for (let repeat = 0; repeat < 3; repeat++) {
    const pair = { repeat };
    for (const mode of repeat % 2 ? ['optimized', 'baseline'] : ['baseline', 'optimized']) {
      assert.deepEqual(hashes(), sourceHashes, 'Source changed before native instance');
      const file = path.join(scratch, `${mode}-${repeat}.json`);
      const log = execFileSync('xvfb-run', ['-a', path.join(repo, 'node_modules/.bin/electron'), path.join(repo, 'scripts/performance/native-filename-latency.cjs'), '--ozone-platform=x11'], { cwd: repo, encoding: 'utf8', timeout: 180000, maxBuffer: 2 * 1024 ** 2, env: { ...process.env, TRIBUTARY_FILENAME_PROJECT: project, TRIBUTARY_FILENAME_REPORT: file, TRIBUTARY_FILENAME_SCANNER: mode === 'baseline' ? old : path.join(repo, 'core/filename-search.js'), TRIBUTARY_FILENAME_CASES: cases } });
      assert.deepEqual(hashes(), sourceHashes, 'Source changed during native instance'); pair[mode] = JSON.parse(fs.readFileSync(file, 'utf8')); pair[mode].sourceHashes = sourceHashes; pair[mode].stdout = log;
      console.log('Completed', mode, repeat);
    }
    runs.push(pair);
  }
  for (let at = 0; at < 8; at++) assert.equal(fs.readFileSync(path.join(project, prefix + `target-${String(at).padStart(6, '0')}.ts`), 'utf8'), `export const source = ${at};\n`);
  const medians = Object.fromEntries(fixture.map(({ query }) => [query, Object.fromEntries(['baseline', 'optimized'].map(mode => [mode, median(runs.map(pair => pair[mode].observations.find(row => row.query === query && !row.replacement).elapsedMs))]))]));
  fs.writeFileSync(output, JSON.stringify({ baseline, sourceHashes, uiHashes, fixture, medians, runs, scope: 'Three alternating fresh native Electron pairs, same compiled UI and nested files. Scanner module alone differs; manager/IPC/UI implementation remains identical. All source selections and result prefixes/totals must match; no source saves. Input-to-current-result-DOM includes the 150ms debounce and IPC; not hardware input-to-paint. Actual cancellation is observed, never forced with an injected wait. No cross-editor, startup, model or RAM claim.' }, null, 2) + '\n'); console.log(JSON.stringify(medians));
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
