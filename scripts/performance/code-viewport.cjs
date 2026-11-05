'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..'), [baselineHost, output] = process.argv.slice(2);
if (!baselineHost || !output || !path.isAbsolute(baselineHost) || !path.isAbsolute(output)) throw Error('Pass absolute frozen baseline-host and output paths.');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-code-pairs-'));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sources = ['ui/src/components/code-editor.tsx', 'ui/src/components/markdown.tsx', 'ui/src/components/code-viewport.tsx', 'ui/src/components/desktop-titlebar.tsx', 'ui/src/lib/code-viewport.mjs', 'ui/src/lib/editor-appearance.ts', 'ui/src/lib/editor-search.ts', 'ui/src/lib/editor-grammar.mjs', 'scripts/performance/native-code-viewport.cjs', 'scripts/performance/code-viewport.cjs'];
const hashes = () => Object.fromEntries(sources.map(file => [file, digest(path.join(repo, file))]));
const before = hashes(), uiHashes = Object.fromEntries(['baseline', 'viewport'].map(mode => [mode, digest(path.join(mode === 'baseline' ? baselineHost : repo, 'ui/dist/assets/app.js'))]));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const runs = []; let complete = false;
try {
  for (const workload of [{ name: 'large', lines: 2000, blocks: 3 }, { name: 'small', lines: 20, blocks: 3 }]) {
    for (let repeat = 0; repeat < 3; repeat++) {
      const pair = { workload, repeat };
      for (const mode of repeat % 2 ? ['viewport', 'baseline'] : ['baseline', 'viewport']) {
        const name = `${workload.name}-${repeat}-${mode}`, file = path.join(scratch, name + '.json');
        console.log('Starting', name);
        try {
          const log = execFileSync('xvfb-run', ['-a', path.join(repo, 'node_modules/.bin/electron'), path.join(repo, 'scripts/performance/native-code-viewport.cjs'), '--no-sandbox', '--ozone-platform=x11'], {
            cwd: repo, env: { ...process.env, TRIBUTARY_CODE_MODE: mode, TRIBUTARY_CODE_HOST: mode === 'baseline' ? baselineHost : repo, TRIBUTARY_CODE_OUTPUT: file, TRIBUTARY_CODE_LINES: String(workload.lines), TRIBUTARY_CODE_BLOCKS: String(workload.blocks), TRIBUTARY_CODE_VERIFY: '' },
            timeout: 240000, maxBuffer: 2 * 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe'],
          });
          fs.writeFileSync(path.join(scratch, name + '.log'), log);
        } catch (error) { fs.writeFileSync(path.join(scratch, name + '.error.log'), String(error.stderr || error)); throw error; }
        pair[mode] = JSON.parse(fs.readFileSync(file));
        if (pair[mode].uiSha256 !== uiHashes[mode]) throw Error('UI changed during measurement');
        for (const phase of pair[mode].phases) for (const sample of phase.samples) if (!sample.processTree.complete) throw Error('Incomplete process accounting');
        console.log('Completed', name);
      }
      runs.push(pair);
    }
  }
  if (JSON.stringify(before) !== JSON.stringify(hashes())) throw Error('Measured source changed.');
  const summary = Object.fromEntries(['large', 'small'].map(workload => [workload, Object.fromEntries(['baseline', 'viewport'].map(mode => {
    const selected = runs.filter(run => run.workload.name === workload).map(run => run[mode].phases[0]);
    return [mode, {
      rendererHeapBytes: median(selected.map(phase => median(phase.samples.map(sample => sample.heap.usedSize)))),
      domNodes: median(selected.map(phase => median(phase.samples.map(sample => sample.dom.nodes)))),
      processTreePssKiB: median(selected.map(phase => median(phase.samples.map(sample => sample.processTree.totals.pssKiB)))),
      processTreePrivateKiB: median(selected.map(phase => median(phase.samples.map(sample => sample.processTree.totals.privateKiB)))),
      renderedCodeLines: median(selected.map(phase => phase.rows.lines + phase.rows.viewLines)),
    }];
  }))]));
  fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), baseline: 'Frozen c40ea95 UI and desktop; same current core, dependencies and synthetic replies in both modes', method: 'Three alternating fresh Linux Electron pairs for each of large and small workloads. Five post-diagnostic-renderer-GC samples per process; medians within processes then across three processes. No tests or benchmarks run concurrently.', sourceHashes: before, uiHashes, summary, runs, scope: 'Retained memory and DOM at a settled chat position, not natural GC timing, peak memory, app startup latency, total user workload or model RAM/VRAM. All full reply text remains available. Xvfb/display-server and external helpers outside the app process tree are excluded. Small workloads retain the original renderer.' }, null, 2) + '\n');
  console.log(JSON.stringify(summary)); complete = true;
} finally { if (complete) fs.rmSync(scratch, { recursive: true, force: true }); else console.error('Failed-run evidence:', scratch); }
