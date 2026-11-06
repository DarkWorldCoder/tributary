'use strict';
// Actual source desktop, temporary profile/files, controlled slow recovery bridge.
// No forced GC, renderer debugger, real providers, or user profile reads.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { PerformanceObserver, performance } = require('node:perf_hooks');
const { app } = require('electron');
const { sample: sampleTree } = require('./app-memory.cjs');
const repo = path.resolve(__dirname, '../..'), host = process.env.TRIBUTARY_DRAFT_HOST || repo;
const output = process.env.TRIBUTARY_DRAFT_OUTPUT, count = Number(process.env.TRIBUTARY_DRAFT_FILES || 6), bytes = Number(process.env.TRIBUTARY_DRAFT_BYTES || 409600);
assert.ok(output && path.isAbsolute(output) && path.isAbsolute(host)); assert.ok(count >= 1 && count <= 6 && bytes >= 1024 && bytes <= 512000);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-draft-native-')), profile = path.join(root, 'profile'), project = path.join(root, 'project'), key = 'files:' + project;
fs.mkdirSync(project); process.env.TRIBUTARY_DATA_DIR = profile;
const core = require(path.join(repo,'core')), drafts = require(path.join(repo,'core/drafts'));
const files = Array.from({length:count},(_,i)=>`file-${i}.txt`);
for (const [i,file] of files.entries()) { const line = `fixture ${i} | ${'0123456789abcdef'.repeat(8)}\n`; fs.writeFileSync(path.join(project,file),line.repeat(Math.ceil(bytes/line.length)).slice(0,bytes)); }
const seed = new core.Hub({dataDir:profile,home:root,secrets:new core.MemorySecrets()});
seed.createThread(project,'Draft memory fixture'); seed.store.data.settings.formatOnSave=false; seed.store.save(true); seed.fileWatches.close(); seed.store.close();
drafts.save(profile,key,{active:files[0],tabs:files.map(rel=>({rel,pinned:true,mode:'edit',wrap:false}))});
const gc = [], samples = [], rejected = [], calls = [], phaseTimes = [];
const observer = new PerformanceObserver(list=>{for(const entry of list.getEntries())gc.push({startTime:entry.startTime,duration:entry.duration,detail:entry.detail});}); observer.observe({entryTypes:['gc']});
let hub, blocked=false, pending=[], maxPending=0, maxPendingUnits=0, phase='setup', sampling=false, sampleTimer;
const units = data => typeof data==='string'?data.length:(data?.tabs||[]).reduce((n,tab)=>n+(tab.text?.length||0)+(tab.base?.length||0),0);
const Base = core.Hub;
core.Hub=class extends Base {
  constructor(...args){super(...args);hub=this;}
  async init(){this.agents=[];this.scanningAgents=false;this.emit('state');return this;}
  saveDraft(draftKey,data){
    if(!blocked||draftKey!==key)return super.saveDraft(draftKey,data);
    return new Promise((resolve,reject)=>{pending.push({data,resolve,reject});calls.push({phase,units:units(data),at:performance.now()});maxPending=Math.max(maxPending,pending.length);maxPendingUnits=Math.max(maxPendingUnits,pending.reduce((n,item)=>n+units(item.data),0));});
  }
};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,label)=>{const end=Date.now()+15000;while(!await fn()){if(Date.now()>end)throw Error('Timed out: '+label);await delay(25);}};
function setPhase(label){phase=label;phaseTimes.push({label,at:performance.now()});}
function sample(){
  if(!sampling)return;
  const tree=sampleTree(process.pid), row={at:performance.now(),phase,main:process.memoryUsage(),pending:pending.length,pendingUnits:pending.reduce((n,item)=>n+units(item.data),0),tree};
  if(tree.complete)samples.push(row);else rejected.push(row);
  sampleTimer=setTimeout(sample,100);
}
const checksum=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function uiHash(){const dir=path.join(host,'ui/dist'),h=crypto.createHash('sha256');for(const file of fs.readdirSync(dir,{recursive:true}).filter(file=>fs.statSync(path.join(dir,file)).isFile()).sort())h.update(file+'\0').update(fs.readFileSync(path.join(dir,file)));return h.digest('hex');}
let started=false;const deadline=setTimeout(()=>{console.error('Draft fixture deadline');app.exit(1);},120000);
app.on('browser-window-created',(_event,win)=>{
  win.setSize(1360,900);const web=win.webContents,run=code=>web.executeJavaScript(code);
  const keyPress=async(keyCode,modifiers=[])=>{web.sendInputEvent({type:'keyDown',keyCode,modifiers});if(keyCode==='Enter')web.sendInputEvent({type:'char',keyCode:'\r',modifiers});web.sendInputEvent({type:'keyUp',keyCode,modifiers});await delay(30);};
  const text=()=>run(`document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()`);
  const select=async rel=>{await run(`document.querySelector('[data-file-path="${rel}"]').focus();true`);await keyPress('Enter');await until(()=>run(`!!document.querySelector('[aria-label="Edit ${rel}"]')`),'editor '+rel);};
  const append=async value=>run(`{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from:v.state.doc.length,insert:${JSON.stringify(value)}}});}true`);
  web.once('did-finish-load',()=>{if(started)return;started=true;(async()=>{
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'editor',expanded:true,panel:{open:true,tab:'files'}}}));true`);
    let loaded=new Promise(resolve=>web.once('did-finish-load',resolve));web.reload();await loaded;
    await until(()=>run(`document.querySelectorAll('[data-file-path]').length===${count} && !!document.querySelector('.cm-content')`),'restored file tabs');
    for(const [i,file]of files.entries()){await select(file);await append(`\n// PRIME_${i}\n`);}
    await delay(800);let warm=drafts.read(profile,key);assert.equal(warm.tabs.filter(tab=>typeof tab.text==='string').length,count);warm=null;
    setPhase('before-stall');sampling=true;sample();await delay(650);
    blocked=true;setPhase('stalled-bridge');const updateCount=12;
    for(let i=0;i<updateCount;i++){await append(`// REVISION_${i}\n`);await delay(450);}
    await delay(150);setPhase('stalled-settled');await delay(650);
    const stalled={pending:pending.length,maxPending,maxPendingUnits};assert.ok(pending.length>0);
    // Undo/redo use the live editor; persistence must not change its state owner.
    await run(`document.querySelector('.cm-content').cmTile.root.view.focus();true`);const beforeUndo=await text();await keyPress('z',['control']);assert.notEqual(await text(),beforeUndo);await keyPress('y',['control']);assert.equal(await text(),beforeUndo);
    await append('// FINAL_BEFORE_NAVIGATION\n');await delay(100);setPhase('pagehide-final');
    await web.loadURL('about:blank');
    await until(()=>pending.some(item=>item.data?.tabs?.some(tab=>tab.text?.includes('// FINAL_BEFORE_NAVIGATION'))),'pagehide transmitted final snapshot without awaiting the blocked call');
    const finalPending=pending.length;
    setPhase('draining-after-navigation');blocked=false;
    while(pending.length){const item=pending.shift();try{item.resolve(Base.prototype.saveDraft.call(hub,key,item.data));}catch(error){item.reject(error);throw error;}item.data=null;await delay(5);}
    await delay(800);setPhase('after-drain');await delay(650);sampling=false;clearTimeout(sampleTimer);
    const final=drafts.read(profile,key), last=files.at(-1);
    for(const [i,file]of files.entries()){
      const tab=final.tabs.find(tab=>tab.rel===file),base=fs.readFileSync(path.join(project,file),'utf8');
      let expected=base+`\n// PRIME_${i}\n`;
      if(file===last)expected+=Array.from({length:updateCount},(_,n)=>`// REVISION_${n}\n`).join('')+'// FINAL_BEFORE_NAVIGATION\n';
      assert.equal(tab.base,base);assert.equal(tab.text,expected);assert.equal(tab.pinned,true);
    }
    // Same real production window/profile after navigation restores all unsaved text.
    await web.loadFile(path.join(host,'ui/dist/index.html'));
    await until(()=>run(`document.querySelectorAll('[data-file-path]').length===${count} && !!document.querySelector('.cm-content')`),'reopened actual workspace');
    for(const file of files){await select(file);assert.equal(await text(),final.tabs.find(tab=>tab.rel===file).text);}
    await delay(100);fs.writeFileSync(output+'.png',(await web.capturePage()).toPNG());
    await web.loadURL('about:blank');await delay(100);
    observer.disconnect();clearTimeout(deadline);
    const sources=['ui/src/lib/drafts.mjs','ui/src/store.tsx','ui/src/components/workspace-files.tsx','core/drafts.js','core/hub.js','desktop/main.js','desktop/preload.js','scripts/performance/app-memory.cjs','scripts/performance/native-draft-admission.cjs'];
    const report={passed:true,date:new Date().toISOString(),count,bytes,updateCount,stalled,finalPending,calls,phaseTimes,samples,rejected,gc,runtime:process.versions,uiBuildSha256:uiHash(),sourceHashes:Object.fromEntries(sources.map(file=>[file,checksum(path.join(repo,file))])),checks:{finalSubmittedBeforeNavigationCompleted:true,allDirtyTextsAndBasesExact:true,undoRedoPreserved:true,reopenedActualEditorTextExact:true,actualPrivateDraftStoreUsed:true},scope:'Actual Linux source Electron UI, CodeMirror edits, renderer draftWriter, preload/IPC and real private recovery files. Receiver saveDraft acknowledgements/writes are deliberately gated during the stress phase, then released FIFO; this is a controlled slow bridge, not measured physical-disk latency. 100 ms requested procfs/main-heap observations, no debugger or forced GC; sampled peaks are not continuous peaks. perf_hooks GC entries describe only observed main-process GC events, not renderer or exact stop-the-world pauses. Navigation to blank tears down the old renderer document; final data must already have crossed IPC. No user profile, agents, GPU/model or native Windows/macOS/installer verification.'};
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,count,bytes,stalled,finalPending,samples:samples.length,rejected:rejected.length,checks:report.checks}));app.exit(0);
  })().catch(error=>{console.error(error.stack);sampling=false;clearTimeout(sampleTimer);observer.disconnect();fs.writeFileSync(output+'.failure.json',JSON.stringify({phase,calls,pending:pending.map(item=>({units:units(item.data)})),samples,rejected},null,2));app.exit(1);});});
});
app.on('quit',()=>fs.rmSync(root,{recursive:true,force:true}));require(path.join(host,'desktop/main.js'));
