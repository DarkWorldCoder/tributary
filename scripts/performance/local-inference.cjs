'use strict';
// Real CPU inference in a private Linux namespace. Never installs a service or
// changes a user model profile. Artifact download is an explicit separate step.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const repo=path.resolve(__dirname,'../..');
async function fileHash(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex')}
function memory(pid){
 const fields={};for(const line of fs.readFileSync(`/proc/${pid}/smaps_rollup`,'utf8').split('\n')){const match=/^(\w+):\s+(\d+) kB$/.exec(line);if(match)fields[match[1]]=Number(match[2])*1024}
 return fields;
}
async function inner(){
 const {runDirectTurn}=require('/app/core/direct');const {localRequests}=require('/app/core/local-requests');
 const rows=[];let serial=0;
 async function experiment(config){
  const id=++serial,key=crypto.randomBytes(16).toString('hex');const log=`/report/server-${id}.log`;
  const fd=fs.openSync(log,'w');const args=['--model','/model.gguf','--alias','tributary-memory-fixture','--offline','--host','127.0.0.1','--port','18421','--api-key',key,'--no-webui','--threads','2','--threads-batch','2','--n-gpu-layers','0','--ctx-size',String(config.context),'--parallel',String(config.slots),'--batch-size','128','--ubatch-size','64','--cache-ram','0','--metrics'];
  let spawnError;const child=spawn(process.env.RUNTIME_BIN,args,{stdio:['ignore',fd,fd],env:process.env});fs.closeSync(fd);
  const exited=new Promise(resolve=>{child.once('error',error=>{spawnError=error;resolve({error:error.message})});child.once('exit',(code,signal)=>resolve({code,signal}))});let sampleTimer;let exit;
  const base='http://127.0.0.1:18421',headers={Authorization:`Bearer ${key}`};
  const read=async route=>{const response=await fetch(base+route,{headers,signal:AbortSignal.timeout(2000)});if(!response.ok)throw Error(`HTTP ${response.status} for ${route}`);return response.json()};
  const gateway={protocol:'openai',baseUrl:base+'/v1',model:'tributary-memory-fixture',apiKey:key,maxOutputTokens:16,localRuntime:'ollama',localConcurrency:config.admission};
  // 'ollama' selects Tributary's existing local-client admission policy only.
  // The actual service is pinned llama.cpp, not an Ollama installation.
  const turn=async index=>{
   const events=[];const prompt=`Task ${index}. Count from one to twenty, one number after another. Keep counting until stopped.`;
   const started=performance.now();const value=await runDirectTurn({gateway,prompt,messages:[{role:'system',content:'Follow the counting request. Do not explain.'},{role:'user',content:prompt}],timeoutMs:60000,onEvent:event=>{if(event.kind==='model-phase')peakClientActive=Math.max(peakClientActive,localRequests.counts().active);if(event.kind==='usage')events.push(event.usage)}});
   if(!value.ok||!value.text.trim())throw Error('Incomplete native inference response');
   return {ok:value.ok,textCharacters:value.text.length,textSha256:crypto.createHash('sha256').update(value.text).digest('hex'),usage:events,elapsedMs:performance.now()-started};
  };
  let peakClientActive=0;
  try{
   const deadline=Date.now()+60000;
   while(true){if(spawnError)throw spawnError;if(child.exitCode!==null||child.signalCode)throw Error('Runtime exited during startup');try{await read('/health');break}catch{}if(Date.now()>deadline)throw Error('Runtime did not become healthy');await delay(100)}
   const properties=await read('/props'),initialSlots=await read('/slots');
   if(properties.total_slots!==config.slots||initialSlots.some(slot=>slot.n_ctx!==config.context/config.slots))throw Error('Runtime did not honor context/slot configuration');
   const afterLoad=memory(child.pid);await turn('warm-'+id);await delay(150);const before=memory(child.pid);peakClientActive=0;
   const peaks={...before};const samples=[];let missed=0;const sample=()=>{try{const value=memory(child.pid);for(const [key,n]of Object.entries(value))peaks[key]=Math.max(peaks[key]||0,n);if(samples.length<4096)samples.push({elapsedMs:performance.now()-started,...value});else missed++}catch{missed++}};
   let maxRuntimeActiveSlots=0,polling=false;const started=performance.now();
   sampleTimer=setInterval(()=>{sample();if(!polling){polling=true;void read('/slots').then(slots=>{maxRuntimeActiveSlots=Math.max(maxRuntimeActiveSlots,slots.filter(slot=>slot.is_processing).length)}).catch(()=>{}).finally(()=>{polling=false})}},100);
   const turns=await Promise.all(Array.from({length:4},(_,i)=>turn(`${id}-${i}`)));sample();clearInterval(sampleTimer);sampleTimer=null;
   await delay(300);const after=memory(child.pid),slotsAfter=await read('/slots');
   if(localRequests.counts().active||localRequests.counts().waiting||slotsAfter.some(slot=>slot.is_processing))throw Error('Generation ownership did not settle');
   if(peakClientActive!==config.admission||maxRuntimeActiveSlots<1||maxRuntimeActiveSlots>config.admission)throw Error('Unexpected request admission or runtime activity');
   const stderr=fs.readFileSync(log,'utf8');
   return {id,config,afterLoad,before,peak:peaks,after,peakClientActive,maxRuntimeActiveSlots,turns,elapsedMs:performance.now()-started,sampleIntervalMs:100,samples,sampleOverflowOrReadFailures:missed,slotContexts:initialSlots.map(slot=>slot.n_ctx),properties:{total_slots:properties.total_slots,model_alias:properties.model_alias,model_ftype:properties.model_ftype,build_info:properties.build_info,ui:properties.ui,cors_proxy_enabled:properties.cors_proxy_enabled},runtimeLog:stderr.replaceAll(key,'[ephemeral key]')};
  }finally{
   if(sampleTimer)clearInterval(sampleTimer);if(child.pid&&child.exitCode===null&&!child.signalCode)child.kill('SIGTERM');
   let stopTimer;try{exit=await Promise.race([exited,new Promise(resolve=>{stopTimer=setTimeout(()=>resolve(null),3000)})])}finally{clearTimeout(stopTimer)}
   if(!exit){child.kill('SIGKILL');exit=await exited}
   if(child.pid&&fs.existsSync(`/proc/${child.pid}`))throw Error('Owned runtime process was not reaped');
  }
 }
 // Fresh runtime process for every case; pairs alternate to expose ordering noise.
 const plan=[];for(let repeat=0;repeat<3;repeat++){
  for(const context of repeat%2?[4096,1024]:[1024,4096])plan.push({group:'context',repeat,context,slots:1,admission:1});
 }
 for(let repeat=0;repeat<3;repeat++)for(const admission of repeat%2?[4,1]:[1,4])plan.push({group:'admission',repeat,context:4096,slots:4,admission});
 for(const config of plan){console.log('Measuring',JSON.stringify(config));const row=await experiment(config);row.runtimeReaped=true;rows.push(row);fs.writeFileSync('/report/partial.json',JSON.stringify({rows},null,2));console.log('Completed',JSON.stringify({id:row.id,context:config.context,slots:config.slots,admission:config.admission,peakPss:row.peak.Pss,activeSlots:row.maxRuntimeActiveSlots}))}
 const report={date:new Date().toISOString(),runtime:process.versions,hardware:{platform:process.platform,arch:process.arch,totalMemoryBytes:os.totalmem(),cpuModel:os.cpus()[0]?.model,logicalCpus:os.cpus().length},scope:'Pinned CPU llama.cpp with an official Qwen 0.5B Q4_K_M model, two compute threads, fixed batch/ubatch and disabled runtime prompt-copy cache. Native process smaps_rollup and actual Tributary direct/local admission. This is not Unsloth/Ollama/LM Studio, GPU, Electron or whole-app memory evidence.',rows};fs.writeFileSync('/report/result.json',JSON.stringify(report,null,2));
}
async function outer(){
 const [manifestFile,output]=process.argv.slice(2);if(!manifestFile||!output||!path.isAbsolute(manifestFile)||!path.isAbsolute(output))throw Error('Pass absolute manifest and output paths');
 if(process.platform!=='linux')throw Error('This fixture requires Linux bwrap and smaps_rollup');
 const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));const model=manifest.files.find(file=>file.path.endsWith('.gguf')),archive=manifest.files.find(file=>file.path.endsWith('.tar.gz'));
 if(!model||!archive)throw Error('A verified model and runtime archive are required');
 for(const file of [model,archive])if(fs.statSync(file.path).size!==file.bytes||await fileHash(file.path)!==file.sha256)throw Error('Artifact length/checksum mismatch');
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'tributary-local-measure-')),runtime=path.join(scratch,'runtime'),reportDir=path.join(scratch,'report');fs.mkdirSync(runtime);fs.mkdirSync(reportDir);let success=false;
 try{
  execFileSync('python3',['-c',"import tarfile,sys; tarfile.open(sys.argv[1]).extractall(sys.argv[2],filter='data')",archive.path,runtime],{stdio:'inherit'});
  const files=fs.readdirSync(runtime,{recursive:true,withFileTypes:true});const server=files.find(file=>file.isFile()&&file.name==='llama-server');if(!server)throw Error('Runtime archive has no llama-server');const binary=path.join(server.parentPath,server.name),rel=path.relative(runtime,binary);
  const args=['--unshare-all','--die-with-parent','--new-session','--cap-drop','ALL','--clearenv','--setenv','PATH','/usr/bin:/bin','--setenv','HOME','/tmp','--setenv','RUNTIME_BIN','/runtime/'+rel,'--setenv','LD_LIBRARY_PATH','/runtime/'+path.dirname(rel),'--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--ro-bind',runtime,'/runtime','--ro-bind',process.execPath,'/node','--ro-bind',model.path,'/model.gguf','--ro-bind',path.join(repo,'core'),'/app/core','--ro-bind',__filename,'/bench.cjs','--bind',reportDir,'/report','/node','/bench.cjs','--inner'];
  const child=spawn('bwrap',args,{stdio:'inherit'});let timer;const stop=()=>child.kill('SIGTERM');process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{const code=await new Promise((resolve,reject)=>{timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('Isolated experiment deadline exceeded'))},900000);child.once('error',reject);child.once('exit',code=>resolve(code))});if(code!==0)throw Error('Isolated inference exited '+code)}finally{clearTimeout(timer);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)}
  const report=JSON.parse(fs.readFileSync(path.join(reportDir,'result.json'),'utf8'));report.artifacts={runtimeTag:manifest.runtimeTag,runtimeCommit:manifest.runtimeCommit,modelRevision:manifest.modelRevision,files:[archive,model].map(({url,bytes,sha256})=>({url,bytes,sha256}))};report.isolation={privateFilesystem:true,privateNetworkNamespace:true,homeHidden:true,readOnlyCore:true,productSettingsChanged:false};report.sourceHashes=Object.fromEntries(['core/direct.js','core/local-requests.js','scripts/performance/local-inference.cjs'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex')]));fs.writeFileSync(output,JSON.stringify(report,null,2));success=true;console.log('Saved',output);
 }finally{if(success)fs.rmSync(scratch,{recursive:true,force:true});else console.error('Diagnostic files retained in',scratch)}
}
(process.argv[2]==='--inner'?inner():outer()).catch(error=>{console.error(error.stack);process.exitCode=1});
