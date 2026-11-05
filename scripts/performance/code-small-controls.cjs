'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..'), [baselineHost, output] = process.argv.slice(2);
if (!baselineHost || !output || !path.isAbsolute(baselineHost) || !path.isAbsolute(output)) throw Error('Pass absolute parent-host and output paths');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-small-controls-'));
const sources = ['ui/src/components/markdown.tsx', 'ui/src/components/desktop-titlebar.tsx', 'ui/src/hooks/use-highlighted-code.ts', 'ui/src/lib/code-viewport.mjs', 'scripts/performance/native-code-viewport.cjs', 'scripts/performance/code-small-controls.cjs'];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fingerprints = () => Object.fromEntries(sources.map(file => [file, hash(path.join(repo, file))]));
const before = fingerprints(), uiHashes = { current: hash(path.join(repo, 'ui/dist/assets/app.js')), parent: hash(path.join(baselineHost, 'ui/dist/assets/app.js')) };
const median = values => { const sorted = [...values].sort((a,b) => a-b), middle = Math.floor(sorted.length/2); return sorted.length % 2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2; };
const metrics = run => {
  const samples = run.phases[0].samples;
  if (samples.some(sample => !sample.processTree.complete)) throw Error('Incomplete process accounting');
  return { heapBytes: median(samples.map(sample => sample.heap.usedSize)), pssKiB: median(samples.map(sample => sample.processTree.totals.pssKiB)), privateKiB: median(samples.map(sample => sample.processTree.totals.privateKiB)), domNodes: median(samples.map(sample => sample.dom.nodes)) };
};
const pairs = []; let complete = false;
try {
  // Interleave controls and changed-build comparisons to expose run-to-run drift.
  for (let repeat = 0; repeat < 3; repeat++) for (const kind of repeat % 2 ? ['changed', 'same-build'] : ['same-build', 'changed']) {
    const pair = { kind, repeat };
    for (const side of repeat % 2 ? ['current', 'reference'] : ['reference', 'current']) {
      const host = side === 'reference' && kind === 'changed' ? baselineHost : repo;
      const name = `${repeat}-${kind}-${side}`, file = path.join(scratch, name+'.json'); console.log('Starting',name);
      try { execFileSync('xvfb-run', ['-a', path.join(repo,'node_modules/.bin/electron'), path.join(repo,'scripts/performance/native-code-viewport.cjs'),'--no-sandbox','--ozone-platform=x11'], { cwd: repo, env: {...process.env, TRIBUTARY_CODE_HOST: host, TRIBUTARY_CODE_MODE: side === 'current' ? 'viewport' : 'baseline', TRIBUTARY_CODE_OUTPUT: file, TRIBUTARY_CODE_LINES: '20', TRIBUTARY_CODE_BLOCKS: '3', TRIBUTARY_CODE_VERIFY: ''}, timeout: 240000, maxBuffer: 2*1024**2, stdio:['ignore','pipe','pipe'] }); }
      catch(error) { fs.writeFileSync(path.join(scratch,name+'.error.log'),String(error.stderr||error)); throw error; }
      pair[side] = JSON.parse(fs.readFileSync(file));
      if (pair[side].uiSha256 !== uiHashes[host === repo ? 'current' : 'parent']) throw Error('Measured UI changed');
      metrics(pair[side]); console.log('Completed',name);
    }
    pair.delta = Object.fromEntries(Object.keys(metrics(pair.current)).map(key => [key, metrics(pair.current)[key]-metrics(pair.reference)[key]])); pairs.push(pair);
  }
  if (JSON.stringify(before)!==JSON.stringify(fingerprints())) throw Error('Measured source changed');
  const summary = Object.fromEntries(['same-build','changed'].map(kind => { const selected = pairs.filter(pair => pair.kind===kind); return [kind, Object.fromEntries(Object.keys(selected[0].delta).map(key => [key,{ pairedDeltas:selected.map(pair=>pair.delta[key]), medianPairedDelta:median(selected.map(pair=>pair.delta[key])), differenceOfMedians:median(selected.map(pair=>metrics(pair.current)[key]))-median(selected.map(pair=>metrics(pair.reference)[key])) }]))]; }));
  fs.writeFileSync(output,JSON.stringify({date:new Date().toISOString(),parent:JSON.parse(fs.readFileSync(path.join(baselineHost,'baseline.json'))),uiHashes,sourceHashes:before,summary,pairs,scope:'Small 3x20-line TypeScript workload only. Three same-build A/A pairs interleaved with three parent/current pairs, alternating side order. Five post-diagnostic-renderer-GC samples in each fresh Linux Electron process. Same current core/dependencies. Signed paired differences and difference-of-medians are descriptive, not confidence intervals, significance tests, peak limits or proof of equivalence. No concurrent tests/benchmarks.'},null,2)+'\n');
  console.log(JSON.stringify(summary)); complete=true;
} finally { if(complete)fs.rmSync(scratch,{recursive:true,force:true});else console.error('Evidence:',scratch); }
