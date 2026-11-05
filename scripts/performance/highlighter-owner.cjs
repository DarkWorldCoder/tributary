'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');const repo=path.resolve(__dirname,'../..'),[baselineHost,output]=process.argv.slice(2);
if(!baselineHost||!output||!path.isAbsolute(baselineHost)||!path.isAbsolute(output))throw Error('Pass absolute frozen ff26dfc-host and report paths.');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'tributary-highlighter-pair-'));
const sources=['ui/src/hooks/use-highlighted-code.ts','ui/src/lib/highlighter-subscription.mjs','scripts/performance/native-highlighter-owner.cjs','scripts/performance/highlighter-owner.cjs'];
const hashes=()=>Object.fromEntries(sources.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex')]));const before=hashes(),runs={};let complete=false;
try{
 for(const mode of ['baseline','released']){
  const file=path.join(scratch,mode+'.json'),heap=process.env.TRIBUTARY_HIGHLIGHT_HEAP_PREFIX?process.env.TRIBUTARY_HIGHLIGHT_HEAP_PREFIX+'.'+mode+'.heapsnapshot':'';
  try{execFileSync('xvfb-run',['-a',path.join(repo,'node_modules/.bin/electron'),path.join(repo,'scripts/performance/native-highlighter-owner.cjs'),'--no-sandbox','--ozone-platform=x11'],{cwd:repo,env:{...process.env,TRIBUTARY_HIGHLIGHT_HOST:mode==='baseline'?baselineHost:repo,TRIBUTARY_HIGHLIGHT_MODE:mode,TRIBUTARY_HIGHLIGHT_OUTPUT:file,TRIBUTARY_HIGHLIGHT_HEAP:heap},timeout:120000,maxBuffer:2*1024**2,stdio:['ignore','pipe','pipe']});}catch(error){fs.writeFileSync(path.join(scratch,mode+'.error.log'),String(error.stderr||error));throw error;}
  runs[mode]=JSON.parse(fs.readFileSync(file));
 }
 assert.equal(runs.baseline.ownerReleased,false);assert.equal(runs.released.ownerReleased,true);assert.equal(runs.baseline.runtime.electron,runs.released.runtime.electron);
 assert.deepEqual(before,hashes());
 fs.writeFileSync(output,JSON.stringify({date:new Date().toISOString(),baseline:'ff26dfc frozen UI/desktop; same current core and dependencies',runs,sourceHashes:before,scope:'Actual native cancelled-component reachability with an intentionally stalled grammar import, not retained bytes, ordinary import latency, whole-app RAM or collector speed. Shared loader completion is preserved. No production finalizer or forced GC.'},null,2)+'\n');console.log(JSON.stringify({before:runs.baseline.ownerReleased,after:runs.released.ownerReleased}));complete=true;
}finally{if(complete)fs.rmSync(scratch,{recursive:true,force:true});else console.error('Evidence:',scratch);}
