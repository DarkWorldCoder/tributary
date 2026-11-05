'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
const [baselineHost, output] = process.argv.slice(2);
if (!baselineHost || !output || !path.isAbsolute(baselineHost) || !path.isAbsolute(output)) throw Error('Pass absolute frozen baseline-host and output paths.');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-editor-pairs-'));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
try {
  const runs = [];
  for (let repeat = 0; repeat < 3; repeat++) {
    const pair = { repeat };
    for (const mode of repeat % 2 ? ['suspended', 'baseline'] : ['baseline', 'suspended']) {
      const file = path.join(scratch, `${repeat}-${mode}.json`);
      console.log('Starting', repeat, mode);
      execFileSync('xvfb-run', ['-a', path.join(repo, 'node_modules/.bin/electron'), path.join(repo, 'scripts/performance/native-editor-resources.cjs'), '--no-sandbox', '--ozone-platform=x11'], { cwd: repo, env: { ...process.env, TRIBUTARY_EDITOR_MODE: mode, TRIBUTARY_EDITOR_HOST: mode === 'baseline' ? baselineHost : repo, TRIBUTARY_EDITOR_OUTPUT: file }, timeout: 240000, maxBuffer: 2 * 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe'] });
      pair[mode] = JSON.parse(fs.readFileSync(file, 'utf8')); console.log('Completed', repeat, mode);
    }
    runs.push(pair);
  }
  const labels = runs[0].baseline.phases.map(phase => phase.label);
  const medians = Object.fromEntries(labels.map(label => [label, Object.fromEntries(['baseline', 'suspended'].map(mode => [mode, {
    rendererHeapBytes: median(runs.map(pair => median(pair[mode].phases.find(phase => phase.label === label).samples.map(sample => sample.heap.usedSize)))),
    domNodes: median(runs.map(pair => median(pair[mode].phases.find(phase => phase.label === label).samples.map(sample => sample.dom.nodes)))),
    parserTrees: median(runs.map(pair => pair[mode].phases.find(phase => phase.label === label).resources.filter(item => item.treeLength > 0).length)),
    blameMarkers: median(runs.map(pair => pair[mode].phases.find(phase => phase.label === label).resources.reduce((sum, item) => sum + item.blameMarkers, 0))),
  }]))]));
  const sourceHashes = Object.fromEntries(['ui/src/components/code-editor.tsx', 'ui/src/lib/editor-grammar.mjs', 'ui/src/hooks/use-debugger.ts', 'ui/src/lib/agent-editor.ts', 'scripts/performance/native-editor-resources.cjs', 'scripts/performance/editor-resources.cjs'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')]));
  const report = { date: new Date().toISOString(), baseline: 'd7a97b7 UI frozen before edits; same current core/native fixture in both variants', method: 'Three alternating fresh desktop pairs, five detached CDP post-diagnostic-GC samples per phase; medians within processes, then across three processes. No regression tests or other benchmarks run concurrently.', scope: 'Renderer isolate retained heap and DOM counters for six synthetic 7500-line dirty TypeScript files. Not total app RAM, PSS/RSS, GPU/model memory, startup or general interaction speed. Syntax trees and blame are visibility-owned; EditorViews and document/undo state deliberately remain.', medians, runs, sourceHashes };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(medians));
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
