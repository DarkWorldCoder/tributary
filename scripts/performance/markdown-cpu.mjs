import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { splitBlocks } from '../../ui/src/lib/markdown-blocks.mjs';
import { createMarkdownStream } from '../../ui/src/lib/markdown-stream.mjs';

const self = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(self), '../..');
const prefix = Array.from({ length: 300 }, (_, n) => `Paragraph ${n}: ` + 'steady plain text '.repeat(50)).join('\n\n');
const scenarios = ['tail', 'paragraphs', 'fence', 'references', 'edits', 'cold-large', 'cold-small'];
function inputsFor(name) {
  let text = name === 'fence' ? '```typescript\n' + 'export const n = 1;\n'.repeat(300) : name === 'references' ? '[ref]: https://example.test\n\n' + prefix : name === 'cold-small' ? 'A short unchanged reply.' : prefix;
  const inputs = [text];
  const count = name === 'cold-small' ? 10000 : name === 'cold-large' ? 100 : 200;
  for (let n = 1; n < count; n++) {
    if (name === 'tail' || name === 'references') text += ' tail';
    else if (name === 'paragraphs') text += `\n\nNew paragraph ${n}: ` + 'new text '.repeat(50);
    else if (name === 'fence') text += `export const value_${n} = ${n};\n`;
    else if (name === 'edits') text = text.replace(/Paragraph \d+:/, `Paragraph ${n}:`);
    inputs.push(text);
  }
  // Materialize equal ASCII input strings before timing both implementations.
  return inputs.map(text => Buffer.from(text).toString('utf8'));
}
if (process.argv[2] === '--child') {
  const [, , , mode, name] = process.argv; assert.ok(['baseline', 'incremental'].includes(mode) && scenarios.includes(name));
  const inputs = inputsFor(name), cold = name.startsWith('cold-');
  let stream = createMarkdownStream();
  // Exact differential validation is outside the timed region.
  for (const text of inputs) { if (cold) stream.reset(); assert.deepEqual(stream.groups(text).flat(), splitBlocks(text)); }
  const run = () => {
    stream = createMarkdownStream(); let checksum = 0;
    for (const text of inputs) {
      if (cold && mode === 'incremental') stream = createMarkdownStream();
      const result = mode === 'baseline' ? splitBlocks(text) : stream.groups(text), tail = result.at(-1);
      checksum = (checksum + (typeof tail === 'string' ? tail : tail.at(-1)).length) >>> 0;
    }
    return checksum;
  };
  const gc = [], observer = new PerformanceObserver(list => gc.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))); observer.observe({ entryTypes: ['gc'] });
  run(); await new Promise(resolve => setImmediate(resolve)); gc.length = 0;
  const samples = [];
  for (let n = 0; n < 3; n++) { const begin = performance.now(), checksum = run(), end = performance.now(); samples.push({ begin, end, ms: end - begin, checksum }); await new Promise(resolve => setImmediate(resolve)); }
  await new Promise(resolve => setImmediate(resolve)); observer.disconnect();
  const observedGc = gc.filter(e => samples.some(s => e.start >= s.begin && e.start < s.end));
  process.stdout.write(JSON.stringify({ mode, name, inputs: inputs.length, finalUtf16Units: inputs.at(-1).length, samples, gc: { count: observedGc.length, ms: observedGc.reduce((sum, e) => sum + e.duration, 0) }, runtime: process.versions }));
} else {
  const output = process.argv[2]; assert.ok(output && path.isAbsolute(output), 'Pass absolute output path.');
  const files = ['ui/src/lib/markdown-stream.mjs', 'ui/src/lib/markdown-blocks.mjs', 'ui/src/lib/code-viewport.mjs', 'scripts/performance/markdown-cpu.mjs'];
  const hashes = () => Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
  const before = hashes(), runs = [], median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  for (const name of scenarios) for (let repeat = 0; repeat < 3; repeat++) {
    const pair = { name, repeat };
    for (const mode of repeat % 2 ? ['incremental', 'baseline'] : ['baseline', 'incremental']) pair[mode] = JSON.parse(execFileSync(process.execPath, [self, '--child', mode, name], { cwd: root, maxBuffer: 1024 ** 2, timeout: 120000 }));
    assert.deepEqual(pair.baseline.samples.map(s => s.checksum), pair.incremental.samples.map(s => s.checksum)); runs.push(pair); console.log('Completed', name, repeat);
  }
  assert.deepEqual(hashes(), before);
  const summary = Object.fromEntries(scenarios.map(name => [name, Object.fromEntries(['baseline', 'incremental'].map(mode => [mode, { ms: median(runs.filter(r => r.name === name).map(r => median(r[mode].samples.map(s => s.ms)))), gcMsAcrossTimedSamples: runs.filter(r => r.name === name).reduce((sum, r) => sum + r[mode].gc.ms, 0) }]))]));
  fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), sourceHashes: before, method: 'Three alternating fresh Node pairs per scenario; one whole-workload warmup and three timed passes per child. Exact differential outputs checked before timing. Input construction/materialization excluded; output/cache/group creation included. No forced GC or parallel benchmarks.', scope: 'Standalone splitter/grouping microbenchmark, not React paint, IPC, app startup or whole-app throughput. Legacy flat splitting versus production incremental groups. Natural GC observations cover timed windows only and are descriptive, not a collector performance guarantee.', summary, runs }, null, 2) + '\n'); console.log(JSON.stringify(summary));
}
