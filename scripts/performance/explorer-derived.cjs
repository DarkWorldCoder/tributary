'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');const {execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..'),[baselineHost,output]=process.argv.slice(2);if(!baselineHost||!output||!path.isAbsolute(baselineHost)||!path.isAbsolute(output))throw Error('Pass absolute frozen baseline-host and output paths.');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'tributary-derived-pairs-')),median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const hashes=()=>Object.fromEntries(['ui/src/components/workspace-files.tsx','ui/src/components/explorer-outline.tsx','ui/src/lib/explorer-index.mjs','scripts/performance/native-explorer-derived.cjs','scripts/performance/explorer-derived.cjs'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,f))).digest('hex')]));
const before=hashes(),runs=[];let complete=false;
try{
 for(let repeat=0;repeat<3;repeat++){
  const pair={repeat};for(const mode of repeat%2?['released','baseline']:['baseline','released']){
   const file=path.join(scratch,`${repeat}-${mode}.json`);console.log('Starting',repeat,mode);
   try{const log=execFileSync('xvfb-run',['-a',path.join(repo,'node_modules/.bin/electron'),path.join(repo,'scripts/performance/native-explorer-derived.cjs'),'--no-sandbox','--ozone-platform=x11'],{cwd:repo,env:{...process.env,TRIBUTARY_DERIVED_MODE:mode,TRIBUTARY_DERIVED_HOST:mode==='baseline'?baselineHost:repo,TRIBUTARY_DERIVED_OUTPUT:file,TRIBUTARY_DERIVED_HEAP:''},timeout:270000,maxBuffer:2*1024**2,stdio:['ignore','pipe','pipe']});fs.writeFileSync(path.join(scratch,`${repeat}-${mode}.log`),log);}
   catch(e){fs.writeFileSync(path.join(scratch,`${repeat}-${mode}.error.log`),String(e.stderr||e));throw e;}
   pair[mode]=JSON.parse(fs.readFileSync(file));console.log('Completed',repeat,mode);
  }runs.push(pair);
 }
 if(JSON.stringify(before)!==JSON.stringify(hashes()))throw Error('Measured source changed.');
 const medians=Object.fromEntries(runs[0].baseline.phases.map(p=>[p.label,Object.fromEntries(['baseline','released'].map(mode=>[mode,{
  rendererHeapBytes:median(runs.map(r=>median(r[mode].phases.find(x=>x.label===p.label).samples.map(s=>s.heap.usedSize)))),
  domNodes:median(runs.map(r=>median(r[mode].phases.find(x=>x.label===p.label).samples.map(s=>s.dom.nodes)))),
  processTreePssKiB:median(runs.map(r=>median(r[mode].phases.find(x=>x.label===p.label).samples.map(s=>{if(!s.processTree.complete)throw Error('Incomplete process accounting');return s.processTree.totals.pssKiB;})))),
  processTreePrivateKiB:median(runs.map(r=>median(r[mode].phases.find(x=>x.label===p.label).samples.map(s=>s.processTree.totals.privateKiB)))),
  outlineRows:median(runs.map(r=>r[mode].phases.find(x=>x.label===p.label).rows.reduce((a,b)=>a+b,0))),
 }]))]));
 const navigation=Object.fromEntries(['baseline','released'].map(mode=>[mode,{editorVisibleMs:median(runs.map(r=>median(r[mode].timings.filter(t=>t.phase==='restore').map(t=>t.editorVisibleMs)))),restoreListCalls:median(runs.map(r=>r[mode].calls.filter(c=>c.phase==='restore'&&c.method==='listFiles').length))}]));
 fs.writeFileSync(output,JSON.stringify({date:new Date().toISOString(),baseline:'2f636de frozen UI/desktop; same current core and fixture in both variants',method:'Three alternating fresh desktop pairs. Five post-diagnostic-renderer-GC samples per phase, medians within then across processes. No other tests or benchmarks run concurrently. Fingerprints checked before/after. Optional heap snapshot disabled in measured runs.',scope:'Six actual Git indexes of 20,000 paths: 19,999 tracked paths absent from worktree plus a real 300-function TypeScript file. This profiles the filename/derived graph and outline workload, not rendering 20,000 physical files. Post-GC retained heap and non-atomic Linux process-tree PSS/private pages, not normal peak RAM, VRAM or general speed.',medians,navigation,runs,sourceHashes:before},null,2)+'\n');complete=true;console.log(JSON.stringify({medians,navigation}));
}finally{if(complete)fs.rmSync(scratch,{recursive:true,force:true});else console.error('Failure evidence retained at',scratch);}
