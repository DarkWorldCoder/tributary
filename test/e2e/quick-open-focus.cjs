'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { app } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-picker-focus-')), project = path.join(root, 'project'), profile = path.join(root, 'profile'); fs.mkdirSync(project);
const contents = Object.fromEntries(['main.ts','bench0001.ts','bench0002.ts','bench0003.ts','slow.ts','deferred.ts','cancelled.ts'].map((name,index) => [name, `export const value${index} = ${index};\n`]));
contents['deferred.ts']=Array.from({length:300},(_,index)=>`export const deferred${index} = ${index};\n`).join('');
for (const [file,text] of Object.entries(contents)) fs.writeFileSync(path.join(project,file),text);
process.env.TRIBUTARY_DATA_DIR = profile;
const core = require('../../core'), drafts = require('../../core/drafts');
const seed = new core.Hub({ dataDir: profile, home: root, secrets: new core.MemorySecrets() }); seed.createThread(project,'Quick Open focus'); seed.fileWatches.close(); seed.store.close();
drafts.save(profile,'files:'+project,{active:'main.ts',tabs:[{rel:'main.ts',mode:'edit',pinned:true}]});
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
core.Hub = class extends core.Hub { async init() { this.agents=[];this.scanningAgents=false;this.emit('state');return this; } async readFile(dir,rel) { if(rel==='slow.ts') await delay(600); return super.readFile(dir,rel); } async fileSearch(owner,query,options) { if(['deferred.ts','cancelled.ts','missing.ts'].includes(query))await delay(500);return super.fileSearch(owner,query,options); } };
async function until(fn,label) {const end=Date.now()+15000;while(!await fn()){if(Date.now()>end)throw Error('Timed out: '+label);await delay(10);}}
let started=false;const deadline=setTimeout(()=>app.exit(1),90000);
app.on('browser-window-created',(_event,win)=>{
 const web=win.webContents,run=code=>web.executeJavaScript(code);
 const key=(keyCode,modifiers=[])=>{web.sendInputEvent({type:'keyDown',keyCode,modifiers});web.sendInputEvent({type:'keyUp',keyCode,modifiers});};
 const focus=()=>run(`document.querySelector('[data-editor-group][data-focused="true"] .cm-content').cmTile.root.view.focus();true`);
 const show=async()=>{
   const visible=run(`new Promise(resolve=>{const end=performance.now()+10000;function check(){const input=document.querySelector('.file-picker[data-state="open"] input');if(input?.getBoundingClientRect().width)resolve(document.activeElement===input);else if(performance.now()>end)resolve(false);else requestAnimationFrame(check);}requestAnimationFrame(check);})`);
   key('p',['control']);assert.equal(await visible,true,'the first visible picker frame must own focus');
 };
 const query=async name=>{await web.insertText(name);await until(()=>run(`!!document.querySelector('.file-picker [cmdk-item][data-value="${name}"]')`),'filename result');};
 web.once('did-finish-load',()=>{if(started)return;started=true;(async()=>{
   await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.theme','"dark"');localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'editor',expanded:true,panel:{open:true,tab:'files'}}}));true`);
   const loaded=new Promise(resolve=>web.once('did-finish-load',resolve));web.reload();await loaded;await until(()=>run(`!!document.querySelector('.cm-content')`),'editor');await focus();
   const initial=await run(`document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()`);
   // No frame, active-element polling or IPC round trip between shortcut and
   // first character: a fast native input burst must not edit the source.
   key('p',['control']);web.sendInputEvent({type:'keyDown',keyCode:'b'});web.sendInputEvent({type:'char',keyCode:'b'});web.sendInputEvent({type:'keyUp',keyCode:'b'});
   await until(()=>run(`!!document.querySelector('.file-picker[data-state="open"] input')`),'immediate picker');
   assert.deepEqual(await run(`({query:document.querySelector('.file-picker input').value,source:document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()})`),{query:'b',source:initial},'immediate native typing belongs to Quick Open and must not edit source');
   key('Escape');await until(()=>run(`!!document.activeElement?.closest('.cm-editor')`),'immediate cancel restores focus');
   await show();await web.insertText('deferred.ts');key('Enter');
   await until(()=>run(`!!document.querySelector('[aria-label="Edit deferred.ts"]') && !!document.activeElement?.closest('.cm-editor')`),'early Enter waits for its current filename results');
   assert.equal(await run(`document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()`),contents['deferred.ts']);
   await until(()=>run(`!document.querySelector('.file-picker')`),'deferred picker exit completes');await delay(30);
   assert.equal(await run(`!!document.activeElement?.closest('.cm-editor')`),true,'early Enter leaves stable keyboard focus after exit');
   await show();await web.insertText('cancelled.ts');key('Enter');key('Escape');await delay(750);
   assert.equal(await run(`!!document.querySelector('.file-picker[data-state="open"]') || !!document.querySelector('[aria-label="Edit cancelled.ts"]')`),false,'closing cancels a queued selection');
   await show();await web.insertText('cancelled.ts');key('Enter');key('a',['control']);await web.insertText('bench0001.ts');await delay(750);
   assert.equal(await run(`document.activeElement===document.querySelector('.file-picker input') && document.querySelector('.file-picker input').value==='bench0001.ts' && !document.querySelector('[aria-label="Edit cancelled.ts"]')`),true,'a new query cancels the old queued selection');key('Escape');
   await show();await web.insertText('missing.ts');key('Enter');await delay(750);
   assert.equal(await run(`!!document.querySelector('.file-picker[data-state="open"]') && document.querySelector('.file-picker [role="status"]').textContent.includes('0 files')`),true,'no match never opens an old recent file');key('Escape');
   for(let round=0;round<18;round++){
     const before=await run(`document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()`);
     await show();await web.insertText('b');
     assert.equal(await run(`document.querySelector('.file-picker input').value`),'b');
     assert.equal(await run(`document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()`),before,'typing must not enter the source');
     const name=`bench000${round%3+1}.ts`;await web.insertText(name.slice(1));await until(()=>run(`!!document.querySelector('.file-picker [cmdk-item][data-value="${name}"]')`),'file result');
     await run(`document.querySelector('.file-picker [cmdk-item][data-value="${name}"]').click();true`);
     await until(()=>run(`!!document.querySelector('[aria-label="Edit ${name}"]') && !!document.activeElement?.closest('.cm-editor')`),'selected editor keyboard focus');
     assert.equal(await run(`document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()`),contents[name]);
     if(round%2===0){await until(()=>run(`!document.querySelector('.file-picker')`),'picker exit completes');await delay(30);assert.equal(await run(`!!document.activeElement?.closest('.cm-editor')`),true,'editor focus survives picker unmount');}
     // Reopen as soon as the editor receives focus, while an exit may be pending.
   }
   await show();await web.insertText('cancelled');key('Escape');await until(()=>run(`!!document.activeElement?.closest('.cm-editor')`),'cancel restores source focus');
   await show();await query('slow.ts');await run(`document.querySelector('.file-picker [cmdk-item][data-value="slow.ts"]').click();true`);
   await until(()=>run(`!document.querySelector('.file-picker[data-state="open"]')`),'slow selection closes picker');
   await show();await web.insertText('bench');await delay(900);
   assert.equal(await run(`document.activeElement===document.querySelector('.file-picker input')`),true,'late file loading cannot steal a new picker focus');
   assert.equal(await run(`document.querySelector('.file-picker input').value`),'bench');key('Escape');
   await until(()=>run(`!!document.activeElement?.closest('.cm-editor')`),'cancel restores replacement editor focus');
   await show();await query('bench0001.ts');
   await run(`(()=>{const d=document.querySelector('.file-picker');d.close();d.showModal();d.querySelector('input').focus();})()`);await delay(40);
   assert.equal(await run(`!!document.querySelector('.file-picker:modal')`),true,'a queued close event cannot dismiss an already reopened native modal');
   assert.equal(await run(`document.querySelector('.file-picker').matches(':modal')`),true,'the browser owns modal inertness');
   await run(`document.querySelector('[data-editor-group][data-focused="true"] .cm-content').focus();true`);
   assert.equal(await run(`document.activeElement===document.querySelector('.file-picker input')`),true,'background source cannot receive focus while modal');
   for(let round=0;round<12;round++){key('Tab',round<6?[]:['shift']);await delay(15);assert.equal(await run(`!!document.activeElement?.closest('.file-picker')`),true,'Tab wraps at both ends inside the modal');}
   web.debugger.attach('1.3');
   const {root:dom}=await web.debugger.sendCommand('DOM.getDocument',{depth:0});
   const node=async selector=>(await web.debugger.sendCommand('DOM.querySelector',{nodeId:dom.nodeId,selector})).nodeId;
   const modalAX=await web.debugger.sendCommand('Accessibility.getPartialAXTree',{nodeId:await node('.file-picker'),fetchRelatives:false});
   assert.ok(modalAX.nodes.some(item=>item.role?.value==='dialog'&&item.name?.value==='Quick Open'&&item.properties?.some(property=>property.name==='modal'&&property.value.value===true)),'accessibility tree exposes a named modal');
   const backgroundAX=await web.debugger.sendCommand('Accessibility.getPartialAXTree',{nodeId:await node('[data-editor-group][data-focused="true"] .cm-content'),fetchRelatives:false});
   assert.equal(backgroundAX.nodes[0].ignored,true,'background editor is excluded from the modal accessibility tree');web.debugger.detach();
   fs.writeFileSync('/tmp/tributary-native-picker-desktop.png',(await web.capturePage()).toPNG());
   web.sendInputEvent({type:'mouseDown',x:4,y:300,button:'left',clickCount:1,modifiers:['control']});web.sendInputEvent({type:'mouseUp',x:4,y:300,button:'left',clickCount:1,modifiers:['control']});await delay(30);
   assert.equal(await run(`!!document.querySelector('.file-picker')`),true,'Control-click backdrop preserves context-menu behavior');
   // Dragging out from inside must not count as a backdrop press.
   const box=await run(`(()=>{const b=document.querySelector('.file-picker input').getBoundingClientRect();return{x:b.x+20,y:b.y+10};})()`);
   web.sendInputEvent({type:'mouseDown',...box,button:'left',clickCount:1});web.sendInputEvent({type:'mouseMove',x:4,y:300});web.sendInputEvent({type:'mouseUp',x:4,y:300,button:'left',clickCount:1});await delay(30);
   assert.equal(await run(`!!document.querySelector('.file-picker')`),true,'dragging outside does not dismiss');
   win.setSize(440,760);await delay(150);
   const narrow=await run(`(()=>{const b=document.querySelector('.file-picker').getBoundingClientRect();return{left:b.left,right:b.right,width:b.width,viewport:innerWidth};})()`);
   assert.ok(narrow.left>=0&&narrow.right<=narrow.viewport&&narrow.width<=600,'picker remains within a narrow viewport');
   fs.writeFileSync('/tmp/tributary-native-picker-narrow.png',(await web.capturePage()).toPNG());
   web.sendInputEvent({type:'mouseDown',x:4,y:300,button:'left',clickCount:1});web.sendInputEvent({type:'mouseUp',x:4,y:300,button:'left',clickCount:1});
   await until(()=>run(`!document.querySelector('.file-picker')&&!!document.activeElement?.closest('.cm-editor')`),'backdrop press closes and restores focus');
   win.setSize(1280,840);await delay(150);await show();
   // Simulate a new application dialog arriving while a picker is open.
   await run(`document.querySelector('button[aria-label="Settings"]').click();true`);
   await until(()=>run(`!!document.querySelector('[aria-label="Find a settings section"]')`),'newer settings dialog mounts');
   await run(`document.querySelector('[aria-label="Close Quick Open"]').click();true`);
   await until(()=>run(`document.activeElement?.closest('[role="dialog"]')?.querySelector('[aria-label="Find a settings section"]')`),'newer modal owns focus after picker closes');
   await delay(50);assert.equal(await run(`!!document.activeElement?.closest('[role="dialog"]')?.querySelector('[aria-label="Find a settings section"]')`),true,'picker cleanup cannot steal newer modal focus');
   await run(`document.querySelector('[aria-label="Close settings"]').click();true`);
   for(const [file,text] of Object.entries(contents))assert.equal(fs.readFileSync(path.join(project,file),'utf8'),text);
   console.log(JSON.stringify({passed:true,reopenCycles:18,checks:['Immediate shortcut/character burst stays in Quick Open without waiting for a frame','Early Enter waits for current results rather than opening an old recent file','Closing, changing the query and no matches cannot consume a stale queued selection','First visible Quick Open frame owns input focus','Fast reopen never sends the first character into source','Selected files receive keyboard focus','Cancellation restores editor focus','Late file reads cannot steal an open picker focus','Queued native close cannot dismiss an already reopened modal','Browser modal inertness and Tab containment','Named modal and ignored background in Chromium accessibility tree','Desktop and narrow geometry captured','Drag-out preserves picker; backdrop press closes it','Backdrop Control-click preserves context-menu behavior','Newer application modal keeps focus','No fixture file changes'],scope:'Linux source Electron, native keyboard/mouse input, Chromium accessibility tree, actual CodeMirror, isolated real files and delayed search/read; no provider, screen-reader or installer claim.'}));
   clearTimeout(deadline);app.quit();
 })().catch(async error=>{console.error(error.stack);fs.writeFileSync('/tmp/tributary-picker-focus-failure.png',(await web.capturePage()).toPNG());app.exit(1);});});
});
app.on('quit',()=>fs.rmSync(root,{recursive:true,force:true}));require('../../desktop/main.js');
