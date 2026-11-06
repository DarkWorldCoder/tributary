'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const repo = path.resolve(__dirname, '../..'), [baselineHost, output] = process.argv.slice(2);
assert.ok(baselineHost && output && path.isAbsolute(baselineHost) && path.isAbsolute(output));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function uiHash(host) { const dir = path.join(host, 'ui/dist'), h = crypto.createHash('sha256'); for (const file of fs.readdirSync(dir, { recursive: true }).filter(file => fs.statSync(path.join(dir, file)).isFile()).sort()) h.update(file + '\0').update(fs.readFileSync(path.join(dir, file))); return h.digest('hex'); }
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function main() {
  const sources = ['ui/src/components/conversation.tsx','ui/src/components/transcript-body.tsx','ui/src/components/ui/message-scroller.tsx','ui/src/components/thread-header.tsx','ui/src/store.tsx','ui/src/components/markdown.tsx','ui/src/components/code-viewport.tsx','core/hub.js','desktop/main.js','scripts/performance/native-transcript-retention.cjs','scripts/performance/transcript-retention.cjs'];
  const hashes = () => Object.fromEntries(sources.map(file => [file, digest(path.join(repo, file))]));
  const before = hashes(), builds = { baseline: uiHash(baselineHost), windowed: uiHash(repo) }, root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-transcript-pairs-'));
  const runs = []; let complete = false;
  try {
    for (const count of [4, 60]) for (let repeat = 0; repeat < 3; repeat++) {
      const pair = { count, repeat };
      for (const variant of repeat % 2 ? ['windowed','baseline'] : ['baseline','windowed']) {
        const name = `${count}-${repeat}-${variant}`, file = path.join(root, name + '.json'); console.log('Starting', name);
        const child = spawn('xvfb-run', ['-a', path.join(repo,'node_modules/.bin/electron'), path.join(repo,'scripts/performance/native-transcript-retention.cjs'), '--no-sandbox','--ozone-platform=x11'], { cwd: repo, stdio: ['ignore','pipe','pipe'], env: { ...process.env, TRIBUTARY_TRANSCRIPT_HOST: variant === 'baseline' ? baselineHost : repo, TRIBUTARY_TRANSCRIPT_COUNT: String(count), TRIBUTARY_TRANSCRIPT_OUTPUT: file, TRIBUTARY_TRANSCRIPT_VERIFY: '', TRIBUTARY_TRANSCRIPT_FALLBACK: '' } });
        const log = fs.openSync(path.join(root,name+'.log'),'w'); child.stdout.on('data',chunk=>fs.writeSync(log,chunk)); child.stderr.on('data',chunk=>fs.writeSync(log,chunk));
        const code = await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);}); fs.closeSync(log); assert.equal(code,0,'See '+root);
        const result = JSON.parse(fs.readFileSync(file)); assert.equal(result.checks.allSourcesKept,true); assert.equal(result.uiBuildSha256,builds[variant]);
        for (const phase of result.phases) { assert.equal(phase.retained.tree.complete,true); for (const sample of phase.observations) assert.equal(sample.tree.complete,true); }
        pair[variant]=result; assert.deepEqual(hashes(),before); assert.deepEqual({baseline:uiHash(baselineHost),windowed:uiHash(repo)},builds); console.log('Completed',name);
      }
      runs.push(pair);
    }
    const labels = runs[0].baseline.phases.map(phase=>phase.label);
    const metrics = (run,label) => { const phase=run.phases.find(phase=>phase.label===label); return { retainedHeapBytes:phase.retained.heap.usedSize, retainedDomNodes:phase.retained.dom.nodes, retainedTreePssKiB:phase.retained.tree.totals.pssKiB, retainedTreePrivateKiB:phase.retained.tree.totals.privateKiB, richBodies:phase.mounted, parkedBodies:phase.parked }; };
    const summary=Object.fromEntries([4,60].map(count=>[count,Object.fromEntries(['baseline','windowed'].map(variant=>[variant,Object.fromEntries(labels.map(label=>[label,Object.fromEntries(Object.keys(metrics(runs[0].baseline,label)).map(key=>[key,median(runs.filter(run=>run.count===count).map(run=>metrics(run[variant],label)[key]))]))]))]))]));
    const pairedFinalDifferences=runs.map(pair=>({count:pair.count,repeat:pair.repeat,...Object.fromEntries(['retainedHeapBytes','retainedDomNodes','retainedTreePssKiB'].map(key=>[key,metrics(pair.windowed,'returned-bottom')[key]-metrics(pair.baseline,'returned-bottom')[key]]))}));
    fs.copyFileSync(path.join(root,'60-2-windowed.json.png'),output+'.png');
    fs.writeFileSync(output,JSON.stringify({date:new Date().toISOString(),baseline:JSON.parse(fs.readFileSync(path.join(baselineHost,'baseline.json'))),sourceHashes:before,uiHashes:builds,summary,pairedFinalDifferences,runs,
      method:'Three serial fresh Linux Electron pairs for four small replies and sixty rich replies. Middle pair order reversed. Four settled positions per app. Five pre-collection observations plus one separately labelled post-diagnostic-renderer-GC observation at each boundary; summary uses post-GC retained values and complete process-tree accounting. Incomplete attempts preserved and excluded. No concurrent tests/builds/benchmarks; selected sources and full UI builds hashed before/after. Descriptive medians within each workload, not randomized inference.',
      scope:'Actual source desktop conversation/renderer over durable synthetic Markdown, tables, links, snippets and one large viewer. Renderer diagnostic GC is a measurement intervention only; no production GC change and no uninterrupted natural peak/GC-pause claim. Ready-time observations include fixture polling/IO and are not paint or universal throughput measurements. PSS excludes Xvfb, detached helpers, external model and driver allocations outside descendants. No native Windows/macOS, installer, provider, universal leak-free or arbitrary long-thread bounded-memory claim.'},null,2)+'\n'); complete=true; console.log(JSON.stringify({summary,pairedFinalDifferences}));
  } finally { if(complete)fs.rmSync(root,{recursive:true,force:true});else console.error('Diagnostic evidence:',root); }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
