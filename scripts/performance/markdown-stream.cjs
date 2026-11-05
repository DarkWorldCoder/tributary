'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..'), [baselineHost, output] = process.argv.slice(2);
assert.ok(baselineHost && output && path.isAbsolute(baselineHost) && path.isAbsolute(output), 'Pass absolute baseline host and output paths.');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-markdown-pairs-'));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const buildHash = host => { const dir = path.join(host, 'ui/dist'), hash = crypto.createHash('sha256'); for (const file of fs.readdirSync(dir, { recursive: true }).filter(file => fs.statSync(path.join(dir, file)).isFile()).sort()) hash.update(file + '\0').update(fs.readFileSync(path.join(dir, file))); return hash.digest('hex'); };
const sources = ['ui/src/components/markdown.tsx', 'ui/src/lib/markdown-stream.mjs', 'ui/src/lib/markdown-blocks.mjs', 'ui/src/lib/code-viewport.mjs', 'core/hub.js', 'core/message-patch.js', 'desktop/main.js', 'scripts/performance/native-markdown-stream.cjs', 'scripts/performance/markdown-stream.cjs'];
const hashes = () => Object.fromEntries(sources.map(file => [file, digest(path.join(repo, file))]));
const before = hashes(), uiHashes = { baseline: buildHash(baselineHost), incremental: buildHash(repo) };
const baselineManifest = JSON.parse(fs.readFileSync(path.join(baselineHost, 'baseline.json')));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const metrics = run => Object.fromEntries(['initial', 'final'].map(label => {
  const phase = run.phases.find(phase => phase.label === label);
  return [label, { heapBytes: median(phase.samples.map(s => s.heap.usedSize)), domNodes: median(phase.samples.map(s => s.dom.nodes)), pssKiB: median(phase.samples.map(s => s.processTree.totals.pssKiB)), privateKiB: median(phase.samples.map(s => s.processTree.totals.privateKiB)) }];
}));
const runs = []; let complete = false;
try {
  for (const workload of ['stream', 'cold', 'small']) for (let repeat = 0; repeat < 3; repeat++) {
    const pair = { workload, repeat };
    for (const mode of repeat % 2 ? ['incremental', 'baseline'] : ['baseline', 'incremental']) {
      const name = `${workload}-${repeat}-${mode}`, file = path.join(scratch, name + '.json'); console.log('Starting', name);
      try {
        const log = execFileSync('xvfb-run', ['-a', path.join(repo, 'node_modules/.bin/electron'), path.join(repo, 'scripts/performance/native-markdown-stream.cjs'), '--no-sandbox', '--ozone-platform=x11'], {
          cwd: repo, env: { ...process.env, TRIBUTARY_MARKDOWN_HOST: mode === 'baseline' ? baselineHost : repo, TRIBUTARY_MARKDOWN_WORKLOAD: workload, TRIBUTARY_MARKDOWN_OUTPUT: file, TRIBUTARY_MARKDOWN_VERIFY: '', TRIBUTARY_MARKDOWN_HEAP: '' }, timeout: 260000, maxBuffer: 2 * 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe'],
        }); fs.writeFileSync(path.join(scratch, name + '.log'), log);
      } catch (error) {
        const log = path.join(scratch, name + '.error.log');
        fs.writeFileSync(log, [error.stack, String(error.stdout || ''), String(error.stderr || '')].join('\n'));
        throw Error('Benchmark child failed; full stdout/stderr preserved in ' + log);
      }
      pair[mode] = JSON.parse(fs.readFileSync(file)); assert.equal(pair[mode].uiBuildSha256, uiHashes[mode], 'UI changed during measurement');
      assert.equal(pair[mode].checks.exactParagraphTextAndStableFirstNode, true);
      for (const phase of pair[mode].phases) for (const s of phase.samples) assert.equal(s.processTree.complete, true, 'Incomplete process accounting');
      console.log('Completed', name);
    }
    runs.push(pair);
  }
  assert.deepEqual(hashes(), before, 'Measured source changed'); assert.deepEqual({ baseline: buildHash(baselineHost), incremental: buildHash(repo) }, uiHashes);
  const summary = Object.fromEntries(['stream', 'cold', 'small'].map(workload => {
    const pairs = runs.filter(run => run.workload === workload).map(pair => ({ baseline: metrics(pair.baseline), incremental: metrics(pair.incremental) }));
    const aggregate = Object.fromEntries(['baseline', 'incremental'].map(mode => [mode, Object.fromEntries(['initial', 'final'].map(phase => [phase, Object.fromEntries(['heapBytes', 'domNodes', 'pssKiB', 'privateKiB'].map(key => [key, median(pairs.map(pair => pair[mode][phase][key]))]))]))]));
    const differences = pairs.map(pair => Object.fromEntries(['heapBytes', 'domNodes', 'pssKiB', 'privateKiB'].map(key => [key, pair.incremental.final[key] - pair.baseline.final[key]])));
    return [workload, { ...aggregate, pairedFinalDifferences: differences }];
  }));
  fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), baseline: baselineManifest, shared: 'Same current core/dependencies/config/search styles and fixture. Frozen selected sources and desktop from the recorded revision; only Markdown differs among those four restored UI sources.', method: 'Three fresh alternating Linux Electron pairs per workload, no concurrent tests/benchmarks. Every streamed update observed committed. Five post-diagnostic-renderer-GC samples per phase; medians within process then across three processes. Order reversed for middle pair; not randomized inference.', sourceHashes: before, uiHashes, summary, runs,
    scope: 'Retained renderer heap, DOM and accounted app-process-tree pages at settled boundaries. Forced GC is diagnostic only; not a production policy or claim about peak memory, natural GC timing, startup, overall transcript virtualization, or local-model RAM/VRAM. Delivery timings include fixture polling and IPC; no app-wide speed claim.' }, null, 2) + '\n');
  console.log(JSON.stringify(summary)); complete = true;
} finally { if (complete) fs.rmSync(scratch, { recursive: true, force: true }); else console.error('Failed-run evidence:', scratch); }
