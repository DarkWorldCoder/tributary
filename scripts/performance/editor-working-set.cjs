'use strict';
// Serial fresh apps, separate allocation/trace/ordinary-memory runs. Never
// builds or changes production sources while a measurement cohort is running.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{gzipSync}=require('node:zlib'),{sample:sampleTree}=require('./app-memory.cjs');
const repo=path.resolve(__dirname,'../..'),[baselineHost,output]=process.argv.slice(2);
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sources=['ui/src/components/code-editor.tsx','ui/src/components/workspace-files.tsx','ui/src/lib/agent-editor.ts','ui/src/lib/editor-spacing.mjs','ui/src/lib/format-document.mjs','ui/src/lib/text-change.mjs','core/hub.js','desktop/main.js','desktop/preload.js','scripts/performance/native-editor-allocation.cjs','scripts/performance/editor-working-set.cjs','scripts/performance/app-memory.cjs'];
const sourceHashes=()=>Object.fromEntries(sources.map(file=>[file,sha(path.join(repo,file))]));
function buildHash(host){const dir=path.join(host,'ui/dist'),h=crypto.createHash('sha256');for(const file of fs.readdirSync(dir,{recursive:true}).filter(file=>fs.statSync(path.join(dir,file)).isFile()).sort())h.update(file+'\0').update(fs.readFileSync(path.join(dir,file)));return h.digest('hex');}
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)],quantile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)]??0;
function allocation(profile){const rows=[];function walk(node,stack){const frame=node.callFrame,next=[...stack,{name:frame.functionName,url:frame.url,line:frame.lineNumber,column:frame.columnNumber}];if(node.selfSize)rows.push({estimatedBytes:node.selfSize,stack:next});for(const child of node.children||[])walk(child,next);}walk(profile.head,[]);return {sampledAllocationEstimateBytes:rows.reduce((n,row)=>n+row.estimatedBytes,0),sampleCount:profile.samples.length,topExclusiveFrames:rows.sort((a,b)=>b.estimatedBytes-a.estimatedBytes).slice(0,16).map(row=>({...row,stack:row.stack.slice(-5)}))};}
function traceEvents(trace,report){
  const events=trace.traceEvents.filter(event=>event.pid===report.rendererPid),main=events.find(event=>event.ph==='M'&&event.name==='thread_name'&&event.args?.name==='CrRendererMain');assert.ok(main,'renderer main-thread metadata');
  const marks=name=>events.filter(event=>event.name===name&&event.tid===main.tid);assert.equal(marks(report.startName).length,1);assert.equal(marks(report.endName).length,1);
  const start=marks(report.startName)[0].ts,end=marks(report.endName)[0].ts;assert.ok(end>start);
  const windowed=events.filter(event=>event.tid===main.tid&&event.ts>=start&&event.ts<=end),gc=windowed.filter(event=>event.ph==='X'&&['MinorGC','MajorGC'].includes(event.name)).map(event=>({name:event.name,ts:event.ts,durationUs:Math.min(event.dur,end-event.ts),complete:event.ts+event.dur<=end,args:event.args}));
  const active=new Map(),pauses=[];
  for(const event of windowed.filter(event=>event.name==='ObservablePause')){const id=JSON.stringify(event.id2||event.id);if(event.ph==='b'){assert.ok(!active.has(id));active.set(id,event.ts);}else if(event.ph==='e'){assert.ok(active.has(id),'complete V8 observable-pause start');pauses.push({startUs:active.get(id),durationUs:event.ts-active.get(id)});active.delete(id);}}
  assert.equal(active.size,0,'complete V8 observable-pause end');
  assert.ok(report.traceBufferUsage.percentage<0.8,'trace buffer below 80 percent');
  const durations=gc.map(event=>event.durationUs/1000),observed=pauses.map(event=>event.durationUs/1000);
  return {workWindowMs:(end-start)/1000,mainThreadId:main.tid,gcEventCount:gc.length,minorGcCount:gc.filter(event=>event.name==='MinorGC').length,majorGcCount:gc.filter(event=>event.name==='MajorGC').length,gcEventDurationTotalMs:durations.reduce((n,value)=>n+value,0),gcEventDurationP95Ms:quantile(durations,.95),gcEventDurationMaxMs:Math.max(0,...durations),v8ObservablePauseCount:pauses.length,v8ObservablePauseTotalMs:observed.reduce((n,value)=>n+value,0),v8ObservablePauseP95Ms:quantile(observed,.95),gc,pauses};
}
function memoryMetrics(samples,rejected){
  const work=samples.filter(row=>row.phase==='work'),before=samples.filter(row=>row.phase==='before'),after=samples.filter(row=>row.phase==='after'),full=[...work,...after];
  assert.ok(before.length>=3&&work.length>=15&&after.length>=4,'enough complete process samples');
  const role=(row,kind)=>row.tree.processes.filter(process=>process.role===kind).reduce((n,process)=>n+process.pssKiB,0);
  return {beforeTreePssKiB:median(before.map(row=>row.tree.totals.pssKiB)),workTreePssPeakKiB:Math.max(...work.map(row=>row.tree.totals.pssKiB)),workAndSettleTreePssPeakKiB:Math.max(...full.map(row=>row.tree.totals.pssKiB)),workRendererPssPeakKiB:Math.max(...work.map(row=>role(row,'renderer'))),afterTreePssKiB:median(after.map(row=>row.tree.totals.pssKiB)),afterRendererPssKiB:median(after.map(row=>role(row,'renderer'))),acceptedSamples:samples.length,rejectedSamples:rejected.length};
}
async function main(){
  assert.ok(baselineHost&&output&&path.isAbsolute(baselineHost)&&path.isAbsolute(output));
  const original=sourceHashes(),builds={baseline:buildHash(baselineHost),optimized:buildHash(repo)},baseline=JSON.parse(fs.readFileSync(path.join(baselineHost,'baseline.json'))),root=fs.mkdtempSync(path.join(os.tmpdir(),'tributary-editor-pairs-')),runs=[],raw={profiles:{},traces:{},memory:{}};let complete=false;
  try{
    for(const mode of ['allocation','trace','plain'])for(const lines of mode==='plain'?[40,40000]:[40000])for(const kind of ['local','remote'])for(let repeat=0;repeat<3;repeat++){
      const pair={mode,lines,kind,repeat};
      for(const variant of repeat%2?['optimized','baseline']:['baseline','optimized']){
        const name=`${mode}-${lines}-${kind}-${repeat}-${variant}`,file=path.join(root,name+'.json'),status=path.join(root,name+'.status.json'),samples=[],rejected=[];console.log('Starting',name);
        const launched={at:new Date().toISOString(),loadAverage:os.loadavg(),freeMemoryBytes:os.freemem()};
        const child=spawn('xvfb-run',['-a','-s','-screen 0 1280x850x24',path.join(repo,'node_modules/.bin/electron'),path.join(repo,'scripts/performance/native-editor-allocation.cjs'),'--ozone-platform=x11'],{cwd:repo,stdio:['ignore','pipe','pipe'],env:{...process.env,TRIBUTARY_EDIT_HOST:variant==='baseline'?baselineHost:repo,TRIBUTARY_EDIT_OUTPUT:file,TRIBUTARY_EDIT_STATUS:status,TRIBUTARY_EDIT_LINES:String(lines),TRIBUTARY_EDIT_MODE:mode,TRIBUTARY_EDIT_KIND:kind}});
        const log=fs.openSync(path.join(root,name+'.log'),'w');child.stdout.on('data',chunk=>fs.writeSync(log,chunk));child.stderr.on('data',chunk=>fs.writeSync(log,chunk));let stopped=false,timer;
        const sample=()=>{if(stopped)return;let state;try{state=JSON.parse(fs.readFileSync(status));}catch{}if(mode==='plain'&&state&&['before','work','after'].includes(state.stage)){try{const tree=sampleTree(state.pid),row={at:Date.now(),phase:state.stage,tree};if(tree.complete)samples.push(row);else rejected.push(row);}catch(error){rejected.push({at:Date.now(),phase:state.stage,error:error.message});}}timer=setTimeout(sample,100);};if(mode==='plain')sample();
        const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});stopped=true;clearTimeout(timer);fs.closeSync(log);assert.equal(code,0,'Inspect '+root);
        const report=JSON.parse(fs.readFileSync(file));assert.equal(report.passed,true);assert.equal(report.uiBuildSha256,builds[variant]);assert.equal(report.parserFullyWarm,true);assert.equal(report.checks.finalTextExact,true);assert.equal(report.checks.undoRedoExact,true);assert.equal(report.tracked,true);assert.ok(!fs.existsSync('/proc/'+report.mainPid),'native main exited');
        let metrics={elapsedMs:report.elapsedMs,dispatchP50Ms:quantile(report.dispatchMs,.5),dispatchP95Ms:quantile(report.dispatchMs,.95)};
        if(mode==='allocation'){const heap=JSON.parse(fs.readFileSync(file+'.allocation.json')),cpu=JSON.parse(fs.readFileSync(file+'.cpu.json'));Object.assign(metrics,allocation(heap.profile));raw.profiles[name]={allocation:heap,cpu};}
        if(mode==='trace'){const trace=JSON.parse(fs.readFileSync(file+'.trace.json'));Object.assign(metrics,traceEvents(trace,report));raw.traces[name]=trace;}
        if(mode==='plain'){Object.assign(metrics,memoryMetrics(samples,rejected));raw.memory[name]={samples,rejected};}
        pair[variant]={...report,launched,metrics};assert.deepEqual(sourceHashes(),original,'sources frozen');assert.deepEqual({baseline:buildHash(baselineHost),optimized:buildHash(repo)},builds,'builds frozen');console.log('Completed',name,JSON.stringify(Object.fromEntries(Object.entries(metrics).filter(([,value])=>typeof value==='number'))));
        if(mode==='plain'&&lines===40000&&kind==='remote'&&repeat===2&&variant==='optimized')fs.copyFileSync(file+'.png',output+'.png');
      }
      runs.push(pair);
    }
    const keys=['elapsedMs','dispatchP50Ms','dispatchP95Ms','sampledAllocationEstimateBytes','gcEventCount','minorGcCount','majorGcCount','gcEventDurationTotalMs','gcEventDurationP95Ms','gcEventDurationMaxMs','v8ObservablePauseCount','v8ObservablePauseTotalMs','v8ObservablePauseP95Ms','beforeTreePssKiB','workTreePssPeakKiB','workAndSettleTreePssPeakKiB','workRendererPssPeakKiB','afterTreePssKiB','afterRendererPssKiB','acceptedSamples','rejectedSamples'];
    const groups=[...new Set(runs.map(pair=>`${pair.mode}-${pair.lines}-${pair.kind}`))];
    const summary=Object.fromEntries(groups.map(group=>{const pairs=runs.filter(pair=>`${pair.mode}-${pair.lines}-${pair.kind}`===group),available=keys.filter(key=>typeof pairs[0].baseline.metrics[key]==='number');return [group,Object.fromEntries(['baseline','optimized'].map(variant=>[variant,Object.fromEntries(available.map(key=>[key,median(pairs.map(pair=>pair[variant].metrics[key]))]))]))];}));
    const differences=runs.map(pair=>({mode:pair.mode,lines:pair.lines,kind:pair.kind,repeat:pair.repeat,...Object.fromEntries(keys.filter(key=>typeof pair.baseline.metrics[key]==='number').map(key=>[key,pair.optimized.metrics[key]-pair.baseline.metrics[key]]))}));
    const archive=gzipSync(JSON.stringify(raw));fs.writeFileSync(output+'.diagnostics.json.gz',archive);
    const report={date:new Date().toISOString(),baseline,sourceHashes:original,uiHashes:builds,hardware:{platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem()},summary,differences,runs,diagnostics:{file:path.basename(output)+'.diagnostics.json.gz',bytes:archive.length,sha256:crypto.createHash('sha256').update(archive).digest('hex')},method:'Three serial fresh-app pairs for every mode/workload; middle pair order reversed. Allocation/CPU sampling, natural renderer tracing, and ordinary external 100 ms procfs sampling use separate apps. Grammar is fully parsed through EOF before work. Files are tracked in a temporary Git repository. Source/build hashes are checked after each case; no builds, tests, other agent-launched benchmarks or forced production GC during cases. Exact final text and undo/redo verified for every run. All measured app main PIDs are absent after teardown. Raw diagnostic profiles/traces and every accepted/rejected process sample are in the companion gzip archive.',scope:'Descriptive medians and all paired differences, not randomized trials or general performance inference. Allocation numbers are 32 KiB sampled weighted estimates including minor/major-collected objects; retrieving a profile forces diagnostic GC after the work markers. Trace numbers are main-thread DevTools GC and V8 ObservablePause event durations in the work window, not an exact universal STW metric. Trace buffers add overhead. Plain mode uses no debugger/profiler/tracer/explicit GC and includes work plus two seconds of settling in separately reported process PSS. Sampled maxima are not continuous peaks; PSS excludes sampler, Xvfb, external services and driver allocations outside app descendants. Synchronous dispatch timings exclude later React commits and paint. No installed Windows/macOS, GPU/VRAM, provider or globally bounded-app-memory claim.'};
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');complete=true;console.log(JSON.stringify({summary,differences}));
  }finally{if(complete)fs.rmSync(root,{recursive:true,force:true});else console.error('Diagnostics retained:',root);}
}
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
module.exports={allocation,traceEvents,memoryMetrics};
