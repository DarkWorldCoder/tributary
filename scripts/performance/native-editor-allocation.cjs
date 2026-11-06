'use strict';
// Diagnostic allocation/CPU attribution and tracing are separate modes. Reading
// a CDP allocation profile forces GC in this pinned V8; trace mode never does it.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {app,contentTracing}=require('electron');const {execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..'),host=process.env.TRIBUTARY_EDIT_HOST||repo,output=process.env.TRIBUTARY_EDIT_OUTPUT;
const status=process.env.TRIBUTARY_EDIT_STATUS;
const mode=process.env.TRIBUTARY_EDIT_MODE||'allocation',kind=process.env.TRIBUTARY_EDIT_KIND||'remote',lines=Number(process.env.TRIBUTARY_EDIT_LINES||40000);
assert.ok(output&&path.isAbsolute(output)&&path.isAbsolute(host));assert.ok(['allocation','trace','plain'].includes(mode));assert.ok(['local','remote'].includes(kind));assert.ok(lines>=40&&lines<=40000);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tributary-editor-profile-')),profile=path.join(root,'profile'),project=path.join(root,'project'),file=path.join(project,'main.ts');fs.mkdirSync(project);
let expected=Array.from({length:lines},(_,i)=>`let v${String(i).padStart(5,'0')}=0;\n`).join('')+'// typing: ';fs.writeFileSync(file,expected);const tracked=process.env.TRIBUTARY_EDIT_GIT!=='0';if(tracked){for(const args of [['init','-q'],['add','main.ts'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Fixture source']])execFileSync('git',args,{cwd:project,stdio:'pipe'});}process.env.TRIBUTARY_DATA_DIR=profile;
const core=require(path.join(repo,'core')),drafts=require(path.join(repo,'core/drafts'));
const seed=new core.Hub({dataDir:profile,home:root,secrets:new core.MemorySecrets()});seed.createThread(project,'Editor allocation fixture');seed.store.data.settings.formatOnSave=false;seed.store.save(true);seed.fileWatches.close();seed.store.close();
drafts.save(profile,'files:'+project,{active:'main.ts',tabs:[{rel:'main.ts',pinned:true,mode:'edit',wrap:false}]});
core.Hub=class extends core.Hub{constructor(options){super({...options,home:root});}async init(){this.agents=[];this.scanningAgents=false;this.emit('state');return this;}};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),until=async(fn,label)=>{const end=Date.now()+20000;while(!await fn()){if(Date.now()>end)throw Error('Timed out: '+label);await delay(25);}};
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const stage=name=>{if(status)fs.writeFileSync(status,JSON.stringify({pid:process.pid,stage:name,at:Date.now()}));};
function buildHash(){const dir=path.join(host,'ui/dist'),hash=crypto.createHash('sha256');for(const file of fs.readdirSync(dir,{recursive:true}).filter(file=>fs.statSync(path.join(dir,file)).isFile()).sort())hash.update(file+'\0').update(fs.readFileSync(path.join(dir,file)));return hash.digest('hex');}
let started=false,tracing=false;const deadline=setTimeout(()=>{console.error('Editor profiling deadline');app.exit(1);},180000);
app.on('browser-window-created',(_event,win)=>{
  win.setSize(1280,850);const web=win.webContents,run=code=>web.executeJavaScript(code);
  web.once('did-finish-load',()=>{if(started)return;started=true;(async()=>{
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'editor',expanded:true,panel:{open:true,tab:'files'}}}));true`);
    const loaded=new Promise(resolve=>web.once('did-finish-load',resolve));web.reload();await loaded;
    await until(()=>run(`!!document.querySelector('[aria-label="Edit main.ts"]') && document.querySelector('.cm-content').cmTile.root.view.state.doc.length===${expected.length}`),'loaded exact file');
    await until(()=>run(`document.querySelector('.cm-content').cmTile.root.view.state.tree?.length>0`),'grammar available');await delay(1200);
    await run(`{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:v.state.doc.length},scrollIntoView:true});v.focus();window.__editProbe={times:[],phase:'idle'};}true`);
    await until(()=>run(`(()=>{const s=document.querySelector('.cm-content').cmTile.root.view.state;const c=s.values.find(v=>v?.context&&typeof v.context.isDone==='function')?.context;return !!c?.isDone(s.doc.length);})()`),'parser complete through document end');await delay(400);
    stage('before');await delay(mode==='plain'?800:100);
    let traceConfig,allocation,cpu,usage,categories;
    if(mode==='allocation'){
      web.debugger.attach('1.3');await web.debugger.sendCommand('Profiler.enable');await web.debugger.sendCommand('HeapProfiler.enable');await web.debugger.sendCommand('Profiler.setSamplingInterval',{interval:1000});await web.debugger.sendCommand('Profiler.start');
      await web.debugger.sendCommand('HeapProfiler.startSampling',{samplingInterval:32768,stackDepth:64,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
    }else if(mode==='trace'){
      categories=await contentTracing.getCategories();traceConfig={included_categories:['v8','disabled-by-default-v8.gc','devtools.timeline','blink.user_timing'],recording_mode:'record-until-full',trace_buffer_size_in_kb:65536};
      await contentTracing.startRecording(traceConfig);tracing=true;
    }
    const startName=`tributary:edit:${kind}:start`,endName=`tributary:edit:${kind}:end`;
    await run(`performance.mark(${JSON.stringify(startName)});console.timeStamp(${JSON.stringify(startName)});window.__editProbe.phase=${JSON.stringify(kind)};true`);
    stage('work');const began=Date.now(),count=kind==='local'?60:32;
    for(let i=0;i<count;i++){
      const insert=kind==='local'?'x':`\n// REMOTE_${i}`;expected+=insert;
      if(kind==='local'){
        await run(`{const v=document.querySelector('.cm-content').cmTile.root.view;const start=performance.now();v.dispatch({changes:{from:v.state.doc.length,insert:${JSON.stringify(insert)}}});window.__editProbe.times.push(performance.now()-start);}true`);await delay(80);
      }else{
        fs.writeFileSync(file,expected);
        await until(()=>run(`(()=>{const v=document.querySelector('.cm-content')?.cmTile.root.view;return v?.state.doc.length===${expected.length} && v.state.doc.sliceString(v.state.doc.length-${insert.length})===${JSON.stringify(insert)};})()`),'real external edit '+i);await delay(80);
      }
    }
    await delay(100);await run(`performance.mark(${JSON.stringify(endName)});console.timeStamp(${JSON.stringify(endName)});window.__editProbe.phase='ended';true`);
    stage('after');const elapsedMs=Date.now()-began,dispatch=await run('window.__editProbe.times');
    if(mode==='plain')await delay(2000);
    if(mode==='allocation'){
      // Both work markers precede this diagnostic collection. There is no
      // natural-pause or uninstrumented-RAM claim for allocation mode.
      allocation=await web.debugger.sendCommand('HeapProfiler.stopSampling');cpu=await web.debugger.sendCommand('Profiler.stop');web.debugger.detach();
      fs.writeFileSync(output+'.allocation.json',JSON.stringify(allocation));fs.writeFileSync(output+'.cpu.json',JSON.stringify(cpu));
    }else if(mode==='trace'){
      usage=await contentTracing.getTraceBufferUsage();await contentTracing.stopRecording(output+'.trace.json');tracing=false;
    }
    stage('checks');
    assert.equal(await run(`document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()`),expected);
    assert.equal(await run(`document.querySelector('.cm-content').cmTile.root.view.state.selection.main.head>=0`),true);
    // Undo/redo of a real external update and local edits are checked outside
    // the work/profile markers, using native keys in the same editor instance.
    await run(`document.querySelector('.cm-content').cmTile.root.view.focus();true`);
    web.sendInputEvent({type:'keyDown',keyCode:'z',modifiers:['control']});web.sendInputEvent({type:'keyUp',keyCode:'z',modifiers:['control']});await delay(60);
    assert.notEqual(await run(`document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()`),expected);
    web.sendInputEvent({type:'keyDown',keyCode:'y',modifiers:['control']});web.sendInputEvent({type:'keyUp',keyCode:'y',modifiers:['control']});await delay(60);
    assert.equal(await run(`document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()`),expected);
    fs.writeFileSync(output+'.png',(await web.capturePage()).toPNG());
    const report={passed:true,date:new Date().toISOString(),mode,kind,lines,tracked,parserFullyWarm:true,sourceLength:expected.length,count,elapsedMs,dispatchMs:dispatch,rendererPid:web.getOSProcessId(),mainPid:process.pid,startName,endName,traceConfig,traceBufferUsage:usage,categories:categories?.filter(c=>/v8|user_timing|devtools.timeline/.test(c)),runtime:process.versions,uiBuildSha256:buildHash(),sourceHashes:Object.fromEntries(['ui/src/lib/editor-spacing.mjs','ui/src/lib/format-document.mjs','ui/src/lib/text-change.mjs','ui/src/lib/agent-editor.ts','ui/src/components/code-editor.tsx','ui/src/components/workspace-files.tsx','scripts/performance/native-editor-allocation.cjs'].map(file=>[file,sha(path.join(file.startsWith('ui/')?host:repo,file))])),hostSourceCommit:fs.existsSync(path.join(host,'baseline.json'))?JSON.parse(fs.readFileSync(path.join(host,'baseline.json'))).commit:null,checks:{realDiskWatcher:kind==='remote',finalTextExact:true,undoRedoExact:true},scope:mode==='allocation'?'Instrumented actual renderer CPU/allocation attribution, 32 KiB statistical sampling including objects collected by minor/major GC. Pinned V8 forces diagnostic GC when stopSampling reads the result, after the work markers. Not natural-GC or uninstrumented timing/RAM evidence.':'Actual renderer edits/disk watcher; trace mode uses only contentTracing, no debugger/HeapProfiler/CPU profiler or explicit GC. Trace buffers add instrumentation overhead; times are fixture completion observations, not paint or universal speed. Source Linux Electron, temporary app/profile/home; no providers or native installed Windows/macOS certification.'};
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,mode,kind,elapsedMs,usage,checks:report.checks}));clearTimeout(deadline);await web.loadURL('about:blank');await delay(100);app.exit(0);
  })().catch(async error=>{console.error(error.stack);if(tracing)try{await contentTracing.stopRecording(output+'.failed-trace.json');}catch{}app.exit(1);});});
});
app.on('quit',()=>fs.rmSync(root,{recursive:true,force:true}));require(path.join(host,'desktop/main.js'));
