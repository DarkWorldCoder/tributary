'use strict';
// Serial fresh desktop pairs. No builds/tests/other benchmarks during this run.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const repo=path.resolve(__dirname,'../..'),[baselineHost,output]=process.argv.slice(2);
assert.ok(baselineHost&&output&&path.isAbsolute(baselineHost)&&path.isAbsolute(output));
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function uiHash(host){const dir=path.join(host,'ui/dist'),hash=crypto.createHash('sha256');for(const file of fs.readdirSync(dir,{recursive:true}).filter(file=>fs.statSync(path.join(dir,file)).isFile()).sort())hash.update(file+'\0').update(fs.readFileSync(path.join(dir,file)));return hash.digest('hex');}
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const quantile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)]??0;
async function main(){
  const sources=['ui/src/lib/drafts.mjs','ui/src/store.tsx','ui/src/components/workspace-files.tsx','core/drafts.js','core/hub.js','desktop/main.js','desktop/preload.js','scripts/performance/app-memory.cjs','scripts/performance/native-draft-admission.cjs','scripts/performance/draft-admission.cjs'];
  const hashes=()=>Object.fromEntries(sources.map(file=>[file,digest(path.join(repo,file))]));
  const before=hashes(),builds={baseline:uiHash(baselineHost),bounded:uiHash(repo)},root=fs.mkdtempSync(path.join(os.tmpdir(),'tributary-draft-pairs-')),runs=[];let complete=false;
  try{
    for(const workload of [{name:'small',count:1,bytes:2048},{name:'six-dirty-files',count:6,bytes:409600}])for(let repeat=0;repeat<3;repeat++){
      const pair={workload:workload.name,repeat};
      for(const variant of repeat%2?['bounded','baseline']:['baseline','bounded']){
        const name=`${workload.name}-${repeat}-${variant}`,file=path.join(root,name+'.json');console.log('Starting',name);
        const child=spawn('xvfb-run',['-a',path.join(repo,'node_modules/.bin/electron'),path.join(repo,'scripts/performance/native-draft-admission.cjs'),'--no-sandbox','--ozone-platform=x11'],{cwd:repo,stdio:['ignore','pipe','pipe'],env:{...process.env,TRIBUTARY_DRAFT_HOST:variant==='baseline'?baselineHost:repo,TRIBUTARY_DRAFT_OUTPUT:file,TRIBUTARY_DRAFT_FILES:String(workload.count),TRIBUTARY_DRAFT_BYTES:String(workload.bytes)}});
        const log=fs.openSync(path.join(root,name+'.log'),'w');child.stdout.on('data',chunk=>fs.writeSync(log,chunk));child.stderr.on('data',chunk=>fs.writeSync(log,chunk));
        const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});fs.closeSync(log);assert.equal(code,0,'See '+root);
        const result=JSON.parse(fs.readFileSync(file));assert.equal(result.passed,true);assert.equal(result.uiBuildSha256,builds[variant]);assert.ok(result.samples.length>=40);assert.ok(result.samples.every(sample=>sample.tree.complete));assert.ok(Object.values(result.checks).every(Boolean));
        if(variant==='bounded'){assert.equal(result.stalled.maxPending,1);assert.equal(result.finalPending,2);}else assert.ok(result.stalled.pending>=10);
        pair[variant]=result;assert.deepEqual(hashes(),before);assert.deepEqual({baseline:uiHash(baselineHost),bounded:uiHash(repo)},builds);console.log('Completed',name);
        if(workload.name==='six-dirty-files'&&repeat===2&&variant==='bounded')fs.copyFileSync(file+'.png',output+'.png');
      }
      runs.push(pair);
    }
    const metrics=run=>{
      const stalled=run.samples.filter(sample=>sample.phase==='stalled-bridge'||sample.phase==='stalled-settled'),initial=run.samples.filter(sample=>sample.phase==='before-stall');
      const start=run.phaseTimes.find(item=>item.label==='stalled-bridge').at,end=run.phaseTimes.find(item=>item.label==='pagehide-final').at,events=run.gc.filter(entry=>entry.startTime>=start&&entry.startTime<end);
      return {maxPendingCalls:run.stalled.maxPending,maxPendingUnits:run.stalled.maxPendingUnits,exitPendingCalls:run.finalPending,initialMainHeapBytes:median(initial.map(sample=>sample.main.heapUsed)),sampledStalledMainHeapPeakBytes:Math.max(...stalled.map(sample=>sample.main.heapUsed)),sampledStalledTreePssPeakKiB:Math.max(...stalled.map(sample=>sample.tree.totals.pssKiB)),settledStalledTreePssKiB:median(stalled.filter(sample=>sample.phase==='stalled-settled').map(sample=>sample.tree.totals.pssKiB)),mainGcEvents:events.length,mainGcDurationTotalMs:events.reduce((n,event)=>n+event.duration,0),mainGcDurationP95Ms:quantile(events.map(event=>event.duration),.95),completeSamples:run.samples.length,rejectedSamples:run.rejected.length};
    };
    const summary=Object.fromEntries(['small','six-dirty-files'].map(workload=>[workload,Object.fromEntries(['baseline','bounded'].map(variant=>[variant,Object.fromEntries(Object.keys(metrics(runs[0].baseline)).map(key=>[key,median(runs.filter(run=>run.workload===workload).map(run=>metrics(run[variant])[key]))]))]))]));
    const differences=runs.map(pair=>({workload:pair.workload,repeat:pair.repeat,...Object.fromEntries(['sampledStalledMainHeapPeakBytes','sampledStalledTreePssPeakKiB','settledStalledTreePssKiB','mainGcDurationTotalMs'].map(key=>[key,metrics(pair.bounded)[key]-metrics(pair.baseline)[key]]))}));
    fs.writeFileSync(output,JSON.stringify({date:new Date().toISOString(),baseline:JSON.parse(fs.readFileSync(path.join(baselineHost,'baseline.json'))),sourceHashes:before,uiHashes:builds,summary,differences,runs,method:'Three fresh serial Linux Electron pairs per workload, middle pair order reversed. Actual editor changes pause 450 ms between revisions against a controlled stalled saveDraft bridge. Requested 100 ms main-heap/procfs observations and main perf_hooks GC entries; no renderer debugger, forced GC, builds, tests or other agent-run benchmarks during the twelve cases. All accepted process-tree samples are complete; rejected attempts are retained. Sampled maxima and descriptive medians are not continuous peaks, randomization or general latency inference.',scope:'Bound is per renderer draft writer, not a global byte/app/project cap. Typing permits one active call plus the latest pending source; pagehide/disposal urgently sends the last full snapshot behind that call so document destruction cannot strand it. Host recovery saves are synchronous full replacements; fixture releases gated calls FIFO before validating actual persisted/reopened data. Natural main GC event durations are not exact STW pauses or renderer GC. No GPU, real model, physical disk latency, installed Windows/macOS, general speedup or overall bounded-memory claim.'},null,2)+'\n');complete=true;console.log(JSON.stringify({summary,differences}));
  }finally{if(complete)fs.rmSync(root,{recursive:true,force:true});else console.error('Diagnostics retained:',root);}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
