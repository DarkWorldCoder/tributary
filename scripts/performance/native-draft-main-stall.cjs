'use strict';
// Deliberately block the real Electron main event loop while renderer typing
// continues. An external parent samples process memory; the draft API is real.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {app}=require('electron');const {performance}=require('node:perf_hooks');
const repo=path.resolve(__dirname,'../..'),host=process.env.TRIBUTARY_DRAFT_HOST||repo,output=process.env.TRIBUTARY_DRAFT_OUTPUT,statusFile=process.env.TRIBUTARY_DRAFT_STATUS;
const count=Number(process.env.TRIBUTARY_DRAFT_FILES||6),bytes=Number(process.env.TRIBUTARY_DRAFT_BYTES||409600);
assert.ok(output&&statusFile&&path.isAbsolute(output)&&path.isAbsolute(statusFile)&&path.isAbsolute(host));assert.ok(count>=1&&count<=6&&bytes>=1024&&bytes<=512000);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tributary-main-stall-')),profile=path.join(root,'profile'),project=path.join(root,'project'),key='files:'+project;
fs.mkdirSync(project);process.env.TRIBUTARY_DATA_DIR=profile;
const core=require(path.join(repo,'core')),drafts=require(path.join(repo,'core/drafts'));
const files=Array.from({length:count},(_,i)=>`file-${i}.txt`);
for(const [i,file]of files.entries()){const line=`fixture ${i} | ${'0123456789abcdef'.repeat(8)}\n`;fs.writeFileSync(path.join(project,file),line.repeat(Math.ceil(bytes/line.length)).slice(0,bytes));}
const seed=new core.Hub({dataDir:profile,home:root,secrets:new core.MemorySecrets()});seed.createThread(project,'Real main-stall recovery');seed.store.data.settings.formatOnSave=false;seed.store.save(true);seed.fileWatches.close();seed.store.close();
drafts.save(profile,key,{active:files[0],tabs:files.map(rel=>({rel,pinned:true,mode:'edit',wrap:false}))});
let hub,phase='setup',started=false;const calls=[];
const Base=core.Hub;
core.Hub=class extends Base{
  constructor(...args){super(...args);hub=this;}
  async init(){this.agents=[];this.scanningAgents=false;this.emit('state');return this;}
  saveDraft(draftKey,data){
    const record=phase!=='setup'&&draftKey===key?{at:Date.now(),phase,units:(data?.tabs||[]).reduce((n,tab)=>n+(tab.text?.length||0)+(tab.base?.length||0),0)}:null;
    const began=performance.now(),result=super.saveDraft(draftKey,data);
    if(record){record.synchronousSaveMs=performance.now()-began;record.finishedAt=Date.now();record.fileBytes=fs.statSync(path.join(profile,'drafts',crypto.createHash('sha256').update(key).digest('hex').slice(0,40)+'.json')).size;calls.push(record);}
    return result;
  }
};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,label)=>{const end=Date.now()+20000;while(!await fn()){if(Date.now()>end)throw Error('Timed out: '+label);await delay(25);}};
function publish(stage,extra={}){const data={stage,pid:process.pid,at:Date.now(),...extra};fs.writeFileSync(statusFile+'.tmp',JSON.stringify(data));fs.renameSync(statusFile+'.tmp',statusFile);return data;}
function uiHash(){const dir=path.join(host,'ui/dist'),h=crypto.createHash('sha256');for(const file of fs.readdirSync(dir,{recursive:true}).filter(file=>fs.statSync(path.join(dir,file)).isFile()).sort())h.update(file+'\0').update(fs.readFileSync(path.join(dir,file)));return h.digest('hex');}
const deadline=setTimeout(()=>{console.error('Main-stall fixture deadline');app.exit(1);},120000);
app.on('browser-window-created',(_event,win)=>{
  win.setSize(1360,900);const web=win.webContents,run=code=>web.executeJavaScript(code);
  const keyPress=async(keyCode,modifiers=[])=>{web.sendInputEvent({type:'keyDown',keyCode,modifiers});if(keyCode==='Enter')web.sendInputEvent({type:'char',keyCode:'\r',modifiers});web.sendInputEvent({type:'keyUp',keyCode,modifiers});await delay(30);};
  const select=async rel=>{await run(`document.querySelector('[data-file-path="${rel}"]').focus();true`);await keyPress('Enter');await until(()=>run(`!!document.querySelector('[aria-label="Edit ${rel}"]')`),'editor '+rel);};
  const append=async value=>run(`{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from:v.state.doc.length,insert:${JSON.stringify(value)}}});}true`);
  web.once('did-finish-load',()=>{if(started)return;started=true;(async()=>{
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'editor',expanded:true,panel:{open:true,tab:'files'}}}));true`);
    let loaded=new Promise(resolve=>web.once('did-finish-load',resolve));web.reload();await loaded;
    await until(()=>run(`document.querySelectorAll('[data-file-path]').length===${count} && !!document.querySelector('.cm-content')`),'restored tabs');
    for(const [i,file]of files.entries()){await select(file);await append(`\n// PRIME_${i}\n`);}
    await delay(800);assert.equal(drafts.read(profile,key).tabs.filter(tab=>typeof tab.text==='string').length,count);
    phase='before';const before=publish('before',{heap:process.memoryUsage()});await delay(650);
    // The producer is scheduled in the renderer, which remains runnable while
    // main sleeps. No replacement, queue or delayed implementation of saveDraft.
    await run(`window.__draftStall={done:false,edits:[]};setTimeout(()=>{void(async()=>{for(let i=0;i<12;i++){const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from:v.state.doc.length,insert:'// REVISION_'+i+'\\n'}});window.__draftStall.edits.push(Date.now());await new Promise(r=>setTimeout(r,450));}window.__draftStall.done=true;})();},150);true`);
    phase='blocked';const stall=publish('stall',{heap:process.memoryUsage()});
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,6500);
    phase='drain';const drain=publish('drain',{heap:process.memoryUsage()});
    await until(()=>run('window.__draftStall.done'),'independent renderer producer finished');
    const edits=await run('window.__draftStall.edits');assert.equal(edits.length,12);assert.ok(edits.every(at=>at>=stall.at&&at<drain.at),'all typing occurred during main stall');
    await until(()=>drafts.read(profile,key)?.tabs.find(tab=>tab.rel===files.at(-1))?.text?.includes('// REVISION_11'),'real host recovery reaches newest completed revision');
    await delay(600);const beforeExitCalls=calls.length;
    await append('// FINAL_BEFORE_NAVIGATION\n');await delay(100);phase='exit';await web.loadURL('about:blank');
    await until(()=>drafts.read(profile,key)?.tabs.find(tab=>tab.rel===files.at(-1))?.text?.includes('// FINAL_BEFORE_NAVIGATION'),'final pagehide snapshot persisted');
    phase='after';const after=publish('after',{heap:process.memoryUsage()});await delay(650);
    const final=drafts.read(profile,key),last=files.at(-1);
    for(const [i,file]of files.entries()){
      const tab=final.tabs.find(tab=>tab.rel===file),base=fs.readFileSync(path.join(project,file),'utf8');
      let expected=base+`\n// PRIME_${i}\n`;if(file===last)expected+=Array.from({length:12},(_,n)=>`// REVISION_${n}\n`).join('')+'// FINAL_BEFORE_NAVIGATION\n';
      assert.equal(tab.base,base);assert.equal(tab.text,expected);
    }
    publish('verification');await web.loadFile(path.join(host,'ui/dist/index.html'));
    await until(()=>run(`document.querySelectorAll('[data-file-path]').length===${count} && !!document.querySelector('.cm-content')`),'reopened workspace');
    for(const file of files){await select(file);assert.equal(await run(`document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()`),final.tabs.find(tab=>tab.rel===file).text);}
    fs.writeFileSync(output+'.png',(await web.capturePage()).toPNG());await web.loadURL('about:blank');await delay(100);
    const report={passed:true,date:new Date().toISOString(),count,bytes,pid:process.pid,before,stall,drain,after,edits,calls,beforeExitCalls,uiBuildSha256:uiHash(),runtime:process.versions,checks:{allTwelveRendererEditsOccurredDuringRealMainBlock:true,actualSynchronousSaveDraftUnchanged:true,finalPrivateRecoveryDataExact:true,reopenedActualEditorTextExact:true},scope:'Actual Linux Electron main sleeps 6.5 seconds with Atomics.wait while its renderer types 12 revisions independently. saveDraft remains the real synchronous private-file implementation; override only counts calls. External parent samples OS process-tree memory while main cannot process IPC. No forced GC, debugger, providers or real physical-disk benchmark. All queued renderer changes and exit snapshot are checked in actual recovery files and reopened editors.'};
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');publish('done');clearTimeout(deadline);console.log(JSON.stringify({passed:true,count,bytes,beforeExitCalls,checks:report.checks}));app.exit(0);
  })().catch(error=>{console.error(error.stack);publish('failed');app.exit(1);});});
});
app.on('quit',()=>fs.rmSync(root,{recursive:true,force:true}));require(path.join(host,'desktop/main.js'));
