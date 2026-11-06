'use strict';
// Descriptive post-processing of every accepted real-main-stall observation.
// Acquisition is unchanged: report both the blocked-only and full work window.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const [input,output]=process.argv.slice(2);assert.ok(input&&output&&path.isAbsolute(input)&&path.isAbsolute(output));
const data=JSON.parse(fs.readFileSync(input)),median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const summarize=run=>{
  const initial=run.observations.filter(row=>row.phase==='before'),work=run.observations.filter(row=>row.phase==='stall'||row.phase==='drain'),drain=run.observations.filter(row=>row.phase==='drain'),calls=run.calls.filter(call=>call.phase==='drain');
  assert.ok(initial.length&&work.length&&drain.length&&calls.length);assert.ok(work.every(row=>row.tree.complete));
  const byRole=(row,role)=>row.tree.processes.filter(process=>process.role===role).reduce((n,p)=>n+p.pssKiB,0);
  const initialPss=median(initial.map(row=>row.tree.totals.pssKiB)),peak=Math.max(...work.map(row=>row.tree.totals.pssKiB));
  return {initialTreePssKiB:initialPss,sampledWorkTreePssPeakKiB:peak,sampledWorkPssGrowthKiB:peak-initialPss,sampledDrainTreePssPeakKiB:Math.max(...drain.map(row=>row.tree.totals.pssKiB)),sampledWorkMainPssPeakKiB:Math.max(...work.map(row=>byRole(row,'main'))),sampledWorkRendererPssPeakKiB:Math.max(...work.map(row=>byRole(row,'renderer'))),drainSaves:calls.length,drainWrittenBytes:calls.reduce((n,call)=>n+call.fileBytes,0),drainSynchronousSaveMs:calls.reduce((n,call)=>n+call.synchronousSaveMs,0),firstToLastDrainWriteMs:Math.max(...calls.map(call=>call.finishedAt))-Math.min(...calls.map(call=>call.at)),workSamples:work.length,rejectedSamples:run.rejected.length};
};
const rows=data.runs.map(pair=>({workload:pair.workload,repeat:pair.repeat,baseline:summarize(pair.baseline),bounded:summarize(pair.bounded)}));
const summary=Object.fromEntries(['small','six-dirty-files'].map(workload=>[workload,Object.fromEntries(['baseline','bounded'].map(variant=>[variant,Object.fromEntries(Object.keys(rows[0].baseline).map(key=>[key,median(rows.filter(row=>row.workload===workload).map(row=>row[variant][key]))]))]))]));
const differences=rows.map(row=>({workload:row.workload,repeat:row.repeat,...Object.fromEntries(['sampledWorkTreePssPeakKiB','sampledWorkPssGrowthKiB','drainSynchronousSaveMs','drainWrittenBytes'].map(key=>[key,row.bounded[key]-row.baseline[key]]))}));
fs.writeFileSync(output,JSON.stringify({date:new Date().toISOString(),inputSha256:crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'),analysisSourceSha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),summary,differences,rows,scope:'Uses every accepted observation in both the stall and drain phases of all six pairs. Drain lasts through newest-snapshot persistence, a 600 ms wait and exit-flush navigation, until after stage publication; it is a completion boundary, not an equal-duration latency trial. Full input retains blocked-only peaks, all other observations and rejected attempts. Sampled maxima are lower bounds on continuous peaks; growth subtracts each run own before-phase median. No favorable repetition or phase is selected away. Save timing brackets actual synchronous core.saveDraft only; actual private-file sizes sum written bytes, not fsync/storage-device traffic. No startup/paint/general speed or STW-GC claim.'},null,2)+'\n');
console.log(JSON.stringify({summary,differences}));
