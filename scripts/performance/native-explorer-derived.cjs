'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');const {app}=require('electron'),{sample:processMemory}=require('./app-memory.cjs');
const repo=path.resolve(__dirname,'../..'),host=process.env.TRIBUTARY_DERIVED_HOST||repo,mode=process.env.TRIBUTARY_DERIVED_MODE||'released',output=process.env.TRIBUTARY_DERIVED_OUTPUT;
assert.ok(['baseline','released'].includes(mode)&&path.isAbsolute(host)&&output&&path.isAbsolute(output));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tributary-derived-')),profile=path.join(root,'profile');process.env.TRIBUTARY_DATA_DIR=profile;
const core=require(path.join(repo,'core')),drafts=require(path.join(repo,'core/drafts')),seed=new core.Hub({dataDir:profile,home:root,secrets:new core.MemorySecrets()});
const projects=[],threads=[],sources=[];const execute=(project,args,input)=>execFileSync('git',args,{cwd:project,input,encoding:'utf8',stdio:['pipe','pipe','pipe']});
for(let i=0;i<6;i++){
 const p=path.join(root,'project-'+i);fs.mkdirSync(path.join(p,'src'),{recursive:true});projects.push(p);
 const source=Array.from({length:300},(_,n)=>`export function task${n}(value: number) { return value + ${n}; }`).join('\n')+'\n';sources.push(source);fs.writeFileSync(path.join(p,'src/main.ts'),source);
 execute(p,['init','-q']);const hash=execute(p,['hash-object','-w','--stdin'],'').trim(),mainHash=execute(p,['hash-object','-w','src/main.ts']).trim();
 const entries=Array.from({length:19999},(_,n)=>`100644 ${hash}\tpackages/ghost${String(n).padStart(5,'0')}/src/feature${n}/module.ts\n`).join('')+`100644 ${mainHash}\tsrc/main.ts\n`;execute(p,['update-index','--index-info'],entries);
 threads.push(seed.createThread(p,'Derived project '+i));drafts.save(profile,'files:'+p,{active:'src/main.ts',tabs:[{rel:'src/main.ts',pinned:true,mode:'edit'}]});
}
seed.store.data.settings.formatOnSave=false;seed.store.save(true);seed.fileWatches.close();seed.store.close();
let hub,phase='setup',gate=null,started=false;const calls=[],phases=[],timings=[];const Base=core.Hub;
core.Hub=class extends Base{
 constructor(...args){super(...args);hub=this;}
 async init(){this.agents=[];this.scanningAgents=false;this.emit('state');return this;}
 async gitInfo(){return{branch:'fixture',changed:[],stat:''};}
 async listFiles(project){const call={phase,project,method:'listFiles',done:false};calls.push(call);const result=await super.listFiles(project);if(gate&&!gate.started&&project===gate.project){gate.started=true;await new Promise(resolve=>{gate.release=resolve;});}call.done=true;call.count=result.length;return result;}
 async fileSearch(owner,query,options){calls.push({phase,project:this._fileSearches?.owners.get(owner)?.root,method:'findFiles',query});return super.fileSearch(owner,query,options);}
 async findFiles(...args){calls.push({phase,project:args[0],method:'findFiles',query:args[1]});return super.findFiles(...args);}
};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));const until=async(fn,label)=>{const end=Date.now()+30000;while(!await fn()){if(Date.now()>end)throw Error('Timed out: '+label);await delay(25);}};const arg=JSON.stringify;
const deadline=setTimeout(()=>{console.error('Derived fixture deadline');app.exit(1);},240000);
app.on('browser-window-created',(_event,win)=>{win.setSize(1280,850);const web=win.webContents,run=code=>web.executeJavaScript(code);web.on('console-message',e=>{if(e.level==='error')console.error('RENDERER',e.message);});web.once('did-finish-load',()=>{if(started)return;started=true;(async()=>{
 const layouts=Object.fromEntries(projects.map(p=>[p,{layout:'editor',expanded:false,panel:{open:true,tab:'files'}}]));
 await run(`localStorage.setItem('tributary.project',${arg(arg(projects[0]))});localStorage.setItem('tributary.workspaceViews.v1',${arg(arg(layouts))});true`);const loaded=new Promise(resolve=>web.once('did-finish-load',resolve));web.reload();await loaded;
 await until(()=>run(`!!window.hub&&!!document.querySelector('[aria-label="Switch conversation"]')`),'app loaded');
 await run(`window.__derivedRoot=p=>[...document.querySelectorAll('[data-workspace-root]')].find(e=>e.dataset.workspaceRoot===p);window.__derivedContent=p=>window.__derivedRoot(p)?.querySelector('.cm-content');window.__derivedOutline=p=>window.__derivedRoot(p)?.querySelector('.explorer-outline');window.__derivedRows=p=>window.__derivedOutline(p)?.querySelectorAll('[aria-label="File symbols"] li').length||0;true`);
 const open=async index=>{const start=performance.now();web.send('hub-event','open-thread',threads[index].id);await until(()=>run(`document.querySelector('[aria-label="Switch conversation"]')?.textContent.includes(${arg(threads[index].title)})&&!!window.__derivedContent(${arg(projects[index])})`),'open '+index);await delay(150);timings.push({phase,index,editorVisibleMs:performance.now()-start});};
 const snapshot=async label=>{const samples=[];for(let i=0;i<5;i++){web.debugger.attach('1.3');try{await web.debugger.sendCommand('Runtime.discardConsoleEntries');await web.debugger.sendCommand('HeapProfiler.collectGarbage');samples.push({heap:await web.debugger.sendCommand('Runtime.getHeapUsage'),dom:await web.debugger.sendCommand('Memory.getDOMCounters')});}finally{web.debugger.detach();}samples.at(-1).processTree=processMemory(process.pid);await delay(100);}const rows=JSON.parse(await run(`JSON.stringify(${arg(projects)}.map(p=>window.__derivedRows(p)))`));phases.push({label,rows,samples});console.log('SAMPLED',label,JSON.stringify(rows));assert.equal(rows.filter(Boolean).length,mode==='baseline'?6:1);};
 phase='warm';const outlineOffsets=[];
 for(let i=0;i<6;i++){
  await open(i);await until(()=>calls.some(c=>c.project===projects[i]&&c.done&&c.count===20000),'real git index');
  await run(`window.__derivedOutline(${arg(projects[i])}).querySelector('[aria-label="Code outline"]').click();true`);await until(()=>run(`window.__derivedRows(${arg(projects[i])})===300`),'300 actual symbols');
  await run(`{const root=window.__derivedRoot(${arg(projects[i])}),v=root.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from:v.state.doc.length,insert:${arg('// DIRTY\n')}}});root.querySelector('.explorer-outline [data-slot="collapsible-content"]').scrollTop=1000;};true`);await delay(250);
  outlineOffsets.push(await run(`window.__derivedOutline(${arg(projects[i])}).querySelector('[data-slot="collapsible-content"]').scrollTop`));
 }
 await snapshot('six-indexes-and-outlines');phase='restore';
 for(let cycle=0;cycle<3;cycle++){for(let i=0;i<6;i++){await open(i);await until(()=>run(`window.__derivedRows(${arg(projects[i])})===300`),'outline restored');await delay(200);assert.equal(await run(`window.__derivedContent(${arg(projects[i])}).cmTile.root.view.state.doc.toString()`),sources[i]+'// DIRTY\n');assert.equal(await run(`window.__derivedOutline(${arg(projects[i])}).querySelector('[data-slot="collapsible-content"]').scrollTop`),outlineOffsets[i]);}if(cycle===0||cycle===2)await snapshot(cycle?'after-three-return-passes':'after-one-return-pass');}
 const extra={};
 if(mode==='released'){
  phase='filter-lifetime';await open(1);await run(`window.dispatchEvent(new Event('tributary:find-file'));true`);await until(()=>run(`!!window.__derivedRoot(${arg(projects[1])}).querySelector('input[aria-label="Find a file"]')`),'filter input');
  const setFilter=value=>run(`{const e=window.__derivedRoot(${arg(projects[1])}).querySelector('input[aria-label="Find a file"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${arg(value)});e.dispatchEvent(new Event('input',{bubbles:true}));};true`);
  const beforeSearch=calls.filter(c=>c.method==='findFiles'&&c.project===projects[1]).length;await setFilter('ghost00000');web.send('hub-event','open-thread',threads[0].id);await until(()=>run(`!!window.__derivedContent(${arg(projects[0])})`),'hidden query');await delay(350);assert.equal(calls.filter(c=>c.method==='findFiles'&&c.project===projects[1]).length,beforeSearch);
  await open(1);assert.equal(await run(`window.__derivedRoot(${arg(projects[1])}).querySelector('input[aria-label="Find a file"]').value`),'ghost00000');await until(()=>run(`!!window.__derivedRoot(${arg(projects[1])}).querySelector('[title="packages/ghost00000/src/feature0/module.ts"]')`),'filter restored');
  await open(0);gate={project:projects[1],started:false};await open(1);await until(()=>!!gate.started,'held old index');await open(0);
  execute(projects[1],['update-index','--force-remove','packages/ghost00000/src/feature0/module.ts']);const beforeNew=calls.filter(c=>c.method==='listFiles'&&c.project===projects[1]&&c.done).length;await open(1);await until(()=>calls.filter(c=>c.method==='listFiles'&&c.project===projects[1]&&c.done).length>beforeNew,'new index');await until(()=>run(`window.__derivedRoot(${arg(projects[1])}).textContent.includes('No matching files.')`),'new index reflected in filter');gate.release();gate=null;await delay(300);
  assert.equal(await run(`!!window.__derivedRoot(${arg(projects[1])}).querySelector('[title="packages/ghost00000/src/feature0/module.ts"]')`),false);extra.filterPreservedAndHiddenSearchCancelled=true;extra.lateIndexReplyCannotReplaceNewerIndex=true;
  phase='outline-lifetime';await open(0);await until(()=>run(`window.__derivedRows(${arg(projects[0])})===300`),'outline before gate');
  await run(`{const post=Worker.prototype.postMessage;window.__outlineHeld=false;Worker.prototype.postMessage=function(data,...args){if(data?.method==='outline'&&!window.__outlineHeld){window.__outlineHeld=true;let owner=this;window.__releaseOutline=()=>{try{post.call(owner,data,...args);}finally{owner=null;data=null;window.__releaseOutline=null;}};return;}return post.call(this,data,...args);};const v=window.__derivedContent(${arg(projects[0])}).cmTile.root.view;v.dispatch({changes:{from:v.state.doc.length,insert:${arg('// pending outline\n')}}});};true`);
  await until(()=>run(`window.__outlineHeld`),'held outline request');await open(1);await run(`window.__releaseOutline();true`);await delay(250);assert.equal(await run(`window.__derivedRows(${arg(projects[0])})`),0);await open(0);await until(()=>run(`window.__derivedRows(${arg(projects[0])})===300`),'fresh outline after cancelled reply');extra.lateHiddenOutlineReplySafe=true;
 }
 if(process.env.TRIBUTARY_DERIVED_HEAP){const file=process.env.TRIBUTARY_DERIVED_HEAP;assert.ok(path.isAbsolute(file));const fd=fs.openSync(file,'w');const listener=(_event,method,params)=>{if(method==='HeapProfiler.addHeapSnapshotChunk')fs.writeSync(fd,params.chunk);};web.debugger.attach('1.3');web.debugger.on('message',listener);try{await web.debugger.sendCommand('HeapProfiler.takeHeapSnapshot',{reportProgress:false});}finally{web.debugger.off('message',listener);web.debugger.detach();fs.closeSync(fd);}}
 const report={date:new Date().toISOString(),mode,baselineRevision:'2f636de',phases,calls,timings,correctness:{realGitIndexesHave20000Entries:true,outlineExpansionAndScrollPreserved:true,dirtyTextPreserved:true,...extra},runtime:process.versions,hostUiSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(host,'ui/dist/assets/app.js'))).digest('hex'),scope:'Linux source desktop; 6 actual Git indexes with 19,999 tracked absent worktree paths and one real 300-function source file each. Index traversal is real Git, outline uses actual language worker. Agent discovery/git-status presentation stubbed. Post-diagnostic-GC retained memory, not normal peaks/model VRAM or general speed.'};fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');clearTimeout(deadline);app.quit();
 })().catch(e=>{console.error(e.stack);app.exit(1);});});});
app.on('quit',()=>fs.rmSync(root,{recursive:true,force:true}));require(path.join(host,'desktop/main.js'));
