'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {app}=require('electron');
const repo=path.resolve(__dirname,'../..'),host=process.env.TRIBUTARY_HIGHLIGHT_HOST||repo,output=process.env.TRIBUTARY_HIGHLIGHT_OUTPUT,mode=process.env.TRIBUTARY_HIGHLIGHT_MODE||'released';
assert.ok(output&&path.isAbsolute(output)&&['baseline','released'].includes(mode));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tributary-highlight-owner-')),profile=path.join(root,'profile'),project=path.join(root,'project');fs.mkdirSync(project);fs.writeFileSync(path.join(project,'README.md'),'# Disposable highlight fixture\n');process.env.TRIBUTARY_DATA_DIR=profile;
const core=require('../../core'),seed=new core.Hub({dataDir:profile,home:root,secrets:new core.MemorySecrets()});
const source=Array.from({length:500},(_,n)=>`export const initial_${n} = ${n};`).join('\n'),large=Array.from({length:1100},(_,n)=>`export const larger_${n} = ${n};`).join('\n');
const thread=seed.createThread(project,'Delayed highlight owner'),reply={id:'delayed-reply',role:'assistant',agent:'claude',text:'```typescript\n'+source+'\n```',tools:[],files:[],notices:[],permissions:[],trace:[],ok:true,ts:2};
thread.messages.push({id:'user',role:'user',text:'Show the complete source.',target:'claude',ts:1},reply);seed.store.save(true);seed.fileWatches.close();seed.store.close();
let hub;const Base=core.Hub;core.Hub=class extends Base{constructor(...args){super(...args);hub=this;}async init(){this.agents=[];this.scanningAgents=false;this.emit('state');return this;}};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));const until=async(fn,label)=>{const end=Date.now()+20000;while(!await fn()){if(Date.now()>end)throw Error('Timed out: '+label);await delay(25);}};
let started=false;const deadline=setTimeout(()=>{console.error('Highlight fixture deadline');app.exit(1);},90000);
app.on('browser-window-created',(_event,win)=>{
  win.setSize(1280,850);const web=win.webContents,run=code=>web.executeJavaScript(code),held=[],requests=[];let pause=true;
  web.session.webRequest.onBeforeRequest((details,callback)=>{
    if(/\/typescript-[^/]+\.js(?:[?#]|$)/.test(details.url)){requests.push(details.url);if(pause){held.push(callback);return;}}
    callback({cancel:false});
  });
  web.once('did-finish-load',()=>{if(started)return;started=true;(async()=>{
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.thread',${JSON.stringify(JSON.stringify(thread.id))});localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'chat',expanded:false,panel:{open:false,tab:'files'}}}));true`);
    const loaded=new Promise(resolve=>web.once('did-finish-load',resolve));web.reload();await loaded;
    await until(()=>held.length>0,'paused actual TypeScript grammar request');
    const target='[data-message-id="delayed-reply"]';
    await until(()=>run(`!!document.querySelector(${JSON.stringify(target+' [data-slot="code-block"]')})`),'unhighlighted code block');
    const marked=await run(`(()=>{const node=document.querySelector(${JSON.stringify(target+' [data-slot="code-block"]')}),key=Object.keys(node).find(k=>k.startsWith('__reactFiber$'));let fiber=node[key];while(fiber&&fiber.memoizedProps?.code!==${JSON.stringify(source)})fiber=fiber.return;if(!fiber)throw Error('Missing source component Fiber');fiber.__retentionProbe='HIGHLIGHT_FIBER_TO_RELEASE';window.__highlightOwner=new WeakRef(fiber);return {type:fiber.type?.name,tag:fiber.tag}})()`);
    const live=hub.thread(thread.id).messages.find(message=>message.id===reply.id);
    live.text='```typescript\n'+large+'\n```';hub.emit('message',{threadId:thread.id,message:live});
    await until(()=>run(`!!document.querySelector(${JSON.stringify(target+' .code-viewport .cm-line')})`),'larger viewport after small component unmount');
    for(let n=1;n<=4;n++){live.text='```typescript\n'+large+'\n// current '+n+'\n```';hub.emit('message',{threadId:thread.id,message:live});await delay(100);}
    const active={...reply,id:'active-highlight',text:'```typescript\nexport const activeConsumer = 42;\n```',ts:3};hub.thread(thread.id).messages.push(active);hub.emit('message',{threadId:thread.id,message:active});await delay(250);
    for(let n=0;n<8;n++){await delay(75);web.debugger.attach('1.3');try{await web.debugger.sendCommand('Runtime.discardConsoleEntries');await web.debugger.sendCommand('HeapProfiler.collectGarbage');}finally{web.debugger.detach();}}
    const ownerReleased=await run(`window.__highlightOwner.deref()===undefined`);console.log('HIGHLIGHT_OWNER',JSON.stringify({mode,ownerReleased,held:held.length,marked}));
    if(process.env.TRIBUTARY_HIGHLIGHT_HEAP){const fd=fs.openSync(process.env.TRIBUTARY_HIGHLIGHT_HEAP,'w'),listener=(_e,method,params)=>{if(method==='HeapProfiler.addHeapSnapshotChunk')fs.writeSync(fd,params.chunk);};web.debugger.attach('1.3');web.debugger.on('message',listener);try{await web.debugger.sendCommand('HeapProfiler.takeHeapSnapshot',{reportProgress:false});}finally{web.debugger.off('message',listener);web.debugger.detach();fs.closeSync(fd);}}
    assert.equal(ownerReleased,mode==='released');
    pause=false;for(const callback of held.splice(0))callback({cancel:false});
    await until(()=>run(`document.querySelectorAll('[data-message-id="active-highlight"] [data-slot="code-block-line-content"] span[style]').length>3`),'independent live consumer receives shared grammar');
    assert.equal(await run(`document.querySelector(${JSON.stringify(target+' .cm-content')}).cmTile.root.view.state.doc.toString()`),large+'\n// current 4');
    fs.writeFileSync(output,JSON.stringify({date:new Date().toISOString(),mode,ownerReleased,marked,requests,liveConsumerHighlighted:true,currentTextUnchanged:true,runtime:process.versions,fixtureSha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),uiSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(host,'ui/dist/assets/app.js'))).digest('hex'),scope:'Linux Electron source UI; actual file grammar import paused through the isolated session webRequest hook. React Fiber reached via version-pinned diagnostics, weakly observed after unmount/extra commits and diagnostic GC. Shared import then completes for a live consumer. No provider invoked, no production forced GC, no exact byte/RAM or latency claim.'},null,2)+'\n');clearTimeout(deadline);web.session.webRequest.onBeforeRequest(null);app.quit();
  })().catch(error=>{console.error(error.stack);app.exit(1);});});
});
app.on('quit',()=>fs.rmSync(root,{recursive:true,force:true}));require(path.join(host,'desktop/main.js'));
