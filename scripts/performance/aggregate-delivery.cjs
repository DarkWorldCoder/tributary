'use strict';
// Synthetic multi-reply delivery. Diagnostic GC is confined to child measurements.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events');const {execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..');
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const tick=()=>new Promise(setImmediate);
const collect=async()=>{await tick();global.gc();await tick();global.gc()};
async function measure(mode,modules){
 const {bindMessageDelivery}=require(path.join(modules,'message-delivery.js'));
 const messages=Array.from({length:256},(_,i)=>({id:'reply-'+i,role:'assistant',text:Buffer.alloc(12288,65+i%26).toString('base64'),thinking:'',tools:[{id:'tool-'+i,status:'running',output:Buffer.alloc(12288,97+i%26).toString('base64')}],trace:[],permissions:[],ok:null}));
 const hub=new EventEmitter(),queue=[];let owners=0,peakOwners=0,bytes=0,peakBytes=0,peakPackets=0,posts=0;
 hub.holdHistory=()=>{owners++;peakOwners=Math.max(peakOwners,owners);let held=true;return()=>{if(held){held=false;owners--}}};
 const dispose=bindMessageDelivery(hub,(name,data)=>{
  const wire=JSON.stringify({name,data}),size=Buffer.byteLength(wire);posts++;bytes+=size;peakBytes=Math.max(peakBytes,bytes);
  return new Promise(resolve=>{queue.push({wire,size,resolve});peakPackets=Math.max(peakPackets,queue.length)});
 },0,mode==='bounded'?{maxInFlight:8}:undefined);
 await collect();const before=process.memoryUsage();
 for(const message of messages)hub.emit('message',{threadId:message.id,message});
 await collect();const blocked=process.memoryUsage();
 const atBlock={packets:queue.length,serializedBytes:bytes,historyOwnerLeases:owners,retainedHeapDeltaBytes:blocked.heapUsed-before.heapUsed};
 for(const message of messages){message.text+=' FINAL';message.tools[0].status='done';message.ok=true;hub.emit('message',{threadId:message.id,message})}
 const received=new Map();let drained=0;
 while(owners){
  while(queue.length){const packet=queue.shift(),value=JSON.parse(packet.wire);bytes-=packet.size;received.set(value.data.message.id,value.data.message);packet.resolve(true);drained++}
  await tick();if(drained>messages.length*3)throw Error('Unexpected delivery loop');
 }
 const expected=digest(messages),actual=digest(messages.map(m=>received.get(m.id)));if(expected!==actual)throw Error('Final state differs');
 dispose();await collect();
 return{mode,replyCount:messages.length,limit:mode==='bounded'?8:null,before,blocked,atBlock,peakPackets,peakSerializedQueueBytes:peakBytes,peakHistoryOwnerLeases:peakOwners,totalPosts:posts,finalExact:true,finalDigest:actual,remainingOwners:owners,remainingQueuedBytes:bytes,runtime:process.versions};
}
(async()=>{
 if(process.argv[2]==='--child'){const result=await measure(process.argv[3],process.argv[4]);console.log(JSON.stringify(result));return}
 const output=process.argv[2];if(!output||!path.isAbsolute(output))throw Error('Pass an absolute report path');
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'tributary-aggregate-benchmark-'));
 try{
  for(const file of ['message-delivery.js','message-patch.js'])fs.writeFileSync(path.join(scratch,file),execFileSync('git',['show','219b848:core/'+file],{cwd:repo}));
  const runs=[];for(let i=0;i<3;i++){
   const pair={};for(const mode of i%2?['bounded','baseline']:['baseline','bounded']){
    pair[mode]=JSON.parse(execFileSync(process.execPath,['--expose-gc',__filename,'--child',mode,mode==='baseline'?scratch:path.join(repo,'core')],{cwd:repo,maxBuffer:4*1024**2,encoding:'utf8'}));
   }runs.push(pair);
  }
  const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const metrics=['packets','serializedBytes','retainedHeapDeltaBytes'];
  const medians=Object.fromEntries(['baseline','bounded'].map(mode=>[mode,Object.fromEntries(metrics.map(key=>[key,median(runs.map(run=>run[mode].atBlock[key]))]))]));
  const report={date:new Date().toISOString(),baseline:'219b848',scope:'256 distinct synthetic replies with preallocated source payloads. Explicitly retained fixture JSON and diagnostic post-GC heap, not native IPC bytes or total app RAM. All replies are preserved; the pending live-source queue is not capped.',medians,runs,sourceHashes:Object.fromEntries(['core/message-delivery.js','core/message-patch.js','scripts/performance/aggregate-delivery.cjs'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex')]))};
  fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(medians));
 }finally{fs.rmSync(scratch,{recursive:true,force:true})}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
