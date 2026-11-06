'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {allocation,traceEvents,memoryMetrics}=require('../scripts/performance/editor-working-set.cjs');
test('allocation attribution sums exclusive node weights rather than double-counting stacks',()=>{
  const frame=name=>({functionName:name,url:'fixture.js',lineNumber:0,columnNumber:0});
  const result=allocation({head:{selfSize:10,callFrame:frame('root'),children:[{selfSize:20,callFrame:frame('parent'),children:[{selfSize:30,callFrame:frame('leaf')}]}]},samples:[{},{}]});
  assert.equal(result.sampledAllocationEstimateBytes,60);assert.equal(result.sampleCount,2);assert.equal(result.topExclusiveFrames[0].estimatedBytes,30);assert.deepEqual(result.topExclusiveFrames[0].stack.map(frame=>frame.name),['root','parent','leaf']);
});
test('GC analysis uses renderer main-thread work markers and rejects missing or incomplete traces',()=>{
  const event=(name,ts,extra={})=>({name,pid:10,tid:11,ts,ph:'X',...extra});
  const events=[event('thread_name',0,{ph:'M',args:{name:'CrRendererMain'}}),event('start',1000,{ph:'I'}),event('MinorGC',2000,{dur:2000}),event('MajorGC',5000,{dur:3000}),event('MinorGC',500,{dur:100}),event('MajorGC',3000,{tid:12,dur:9000}),event('ObservablePause',2001,{ph:'b',id2:{local:'phase'}}),event('ObservablePause',3999,{ph:'e',id2:{local:'phase'}}),event('end',10000,{ph:'I'})];
  const report={rendererPid:10,startName:'start',endName:'end',traceBufferUsage:{percentage:.1}};
  const metrics=traceEvents({traceEvents:events},report);
  assert.equal(metrics.gcEventCount,2);assert.equal(metrics.gcEventDurationTotalMs,5);assert.equal(metrics.gcEventDurationP95Ms,3);assert.equal(metrics.v8ObservablePauseCount,1);assert.equal(metrics.v8ObservablePauseTotalMs,1.998);assert.equal(metrics.workWindowMs,9);
  assert.throws(()=>traceEvents({traceEvents:events.filter(event=>event.name!=='end')},report));
  assert.throws(()=>traceEvents({traceEvents:events.filter(event=>!(event.name==='ObservablePause'&&event.ph==='e'))},report));
  assert.throws(()=>traceEvents({traceEvents:events},{...report,traceBufferUsage:{percentage:.9}}));
});
test('PSS summaries keep work peaks separate from settling and exclude correctness-check samples',()=>{
  const row=(phase,pss)=>({phase,tree:{totals:{pssKiB:pss},processes:[{role:'renderer',pssKiB:pss-10},{role:'main',pssKiB:10}]}});
  const rows=[...Array.from({length:3},()=>row('before',100)),...Array.from({length:15},(_,i)=>row('work',150+i)),...Array.from({length:4},()=>row('after',180)),row('checks',9999)];
  const metrics=memoryMetrics(rows,[{}]);assert.equal(metrics.beforeTreePssKiB,100);assert.equal(metrics.workTreePssPeakKiB,164);assert.equal(metrics.workAndSettleTreePssPeakKiB,180);assert.equal(metrics.afterRendererPssKiB,170);assert.equal(metrics.rejectedSamples,1);
  assert.throws(()=>memoryMetrics([row('work',100)],[]));
});
