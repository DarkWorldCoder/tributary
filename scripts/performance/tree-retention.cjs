'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..'),[baselineHost,output]=process.argv.slice(2);
if(!baselineHost||!output||!path.isAbsolute(baselineHost)||!path.isAbsolute(output))throw Error('Pass absolute frozen control-host and report paths.');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'tributary-tree-pairs-'));
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const hashes=()=>Object.fromEntries(['ui/src/components/directory-tree.tsx','ui/src/components/workspace-files.tsx','ui/src/hooks/use-tree-viewport.ts','ui/src/lib/directory-session.mjs','ui/src/lib/tree-viewport.mjs','scripts/performance/native-tree-retention.cjs','scripts/performance/tree-retention.cjs'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex')]));
const before=hashes(),runs=[];let complete=false;
try{
 for(let repeat=0;repeat<3;repeat++){
  const pair={repeat};
  for(const mode of repeat%2?['released','baseline']:['baseline','released']){
   const file=path.join(scratch,`${repeat}-${mode}.json`);console.log('Starting',repeat,mode);
   try{const stdout=execFileSync('xvfb-run',['-a',path.join(repo,'node_modules/.bin/electron'),path.join(repo,'scripts/performance/native-tree-retention.cjs'),'--no-sandbox','--ozone-platform=x11'],{cwd:repo,env:{...process.env,TRIBUTARY_TREE_MODE:mode,TRIBUTARY_TREE_HOST:mode==='baseline'?baselineHost:repo,TRIBUTARY_TREE_OUTPUT:file},timeout:270000,maxBuffer:2*1024**2,stdio:['ignore','pipe','pipe']});fs.writeFileSync(path.join(scratch,`${repeat}-${mode}.log`),stdout);}
   catch(error){fs.writeFileSync(path.join(scratch,`${repeat}-${mode}.error.log`),String(error.stderr||error));throw error;}
   pair[mode]=JSON.parse(fs.readFileSync(file,'utf8'));console.log('Completed',repeat,mode);
  }
  runs.push(pair);
 }
 if(JSON.stringify(hashes())!==JSON.stringify(before))throw Error('Measured sources changed during pairs.');
 const labels=runs[0].baseline.phases.map(phase=>phase.label);
 const medians=Object.fromEntries(labels.map(label=>[label,Object.fromEntries(['baseline','released'].map(mode=>[mode,{
  naturalRendererHeapBytes:median(runs.map(pair=>median(pair[mode].phases.find(p=>p.label===label).natural.map(s=>s.heap.usedSize)))),
  naturalProcessTreePssKiB:median(runs.map(pair=>median(pair[mode].phases.find(p=>p.label===label).natural.map(s=>{if(!s.processTree.complete)throw Error('Incomplete natural process accounting');return s.processTree.totals.pssKiB;})))),
  rendererHeapBytes:median(runs.map(pair=>median(pair[mode].phases.find(p=>p.label===label).samples.map(s=>s.heap.usedSize)))),
  domNodes:median(runs.map(pair=>median(pair[mode].phases.find(p=>p.label===label).samples.map(s=>s.dom.nodes)))),
  processTreePssKiB:median(runs.map(pair=>median(pair[mode].phases.find(p=>p.label===label).samples.map(s=>{if(!s.processTree.complete)throw Error('Incomplete process memory accounting');return s.processTree.totals.pssKiB;})))),
  processTreePrivateKiB:median(runs.map(pair=>median(pair[mode].phases.find(p=>p.label===label).samples.map(s=>s.processTree.totals.privateKiB)))),
  treeRows:median(runs.map(pair=>pair[mode].phases.find(p=>p.label===label).trees.reduce((n,t)=>n+t.rows,0))),
 }]))]));
 const navigation=Object.fromEntries(['baseline','released'].map(mode=>[mode,{rootVisibleMs:median(runs.map(pair=>median(pair[mode].timings.filter(t=>t.phase==='restore').map(t=>t.untilRootRowMs)))),restoreDirectoryReads:median(runs.map(pair=>pair[mode].calls.filter(c=>c.phase==='restore').length))}]));
 const report={date:new Date().toISOString(),baseline:'04807e2 with only tree-retention source changes removed; same current search UI/core and fixture',method:'Three alternating fresh desktop pairs. Three pre-diagnostic-GC snapshots and five post-diagnostic-renderer-GC samples per phase, medians within process then across three processes. No test suite/other benchmark run concurrently. Sources fingerprinted before/after.',scope:'Six actual temporary project trees with 520 source files and 40 nested files each. Linux source Electron, not installer/peak RAM, VRAM, provider latency, or a general speed claim. Dirty text/history owners remain. Same-context navigation keeps trees warm. Extra correctness cases follow measured phases.',medians,navigation,runs,sourceHashes:before};
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');complete=true;console.log(JSON.stringify({medians,navigation}));
}finally{if(complete)fs.rmSync(scratch,{recursive:true,force:true});else console.error('Failure evidence retained at',scratch);}
