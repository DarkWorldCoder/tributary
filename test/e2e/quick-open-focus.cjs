'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { app } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-picker-focus-')), project = path.join(root, 'project'), profile = path.join(root, 'profile'); fs.mkdirSync(project);
const contents = Object.fromEntries(['main.ts','bench0001.ts','bench0002.ts','bench0003.ts','slow.ts'].map((name,index) => [name, `export const value${index} = ${index};\n`]));
for (const [file,text] of Object.entries(contents)) fs.writeFileSync(path.join(project,file),text);
process.env.TRIBUTARY_DATA_DIR = profile;
const core = require('../../core'), drafts = require('../../core/drafts');
const seed = new core.Hub({ dataDir: profile, home: root, secrets: new core.MemorySecrets() }); seed.createThread(project,'Quick Open focus'); seed.fileWatches.close(); seed.store.close();
drafts.save(profile,'files:'+project,{active:'main.ts',tabs:[{rel:'main.ts',mode:'edit',pinned:true}]});
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
core.Hub = class extends core.Hub { async init() { this.agents=[];this.scanningAgents=false;this.emit('state');return this; } async readFile(dir,rel) { if(rel==='slow.ts') await delay(600); return super.readFile(dir,rel); } };
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
   for(let round=0;round<18;round++){
     const before=await run(`document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()`);
     await show();await web.insertText('b');
     assert.equal(await run(`document.querySelector('.file-picker input').value`),'b');
     assert.equal(await run(`document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()`),before,'typing must not enter the source');
     const name=`bench000${round%3+1}.ts`;await web.insertText(name.slice(1));await until(()=>run(`!!document.querySelector('.file-picker [cmdk-item][data-value="${name}"]')`),'file result');
     await run(`document.querySelector('.file-picker [cmdk-item][data-value="${name}"]').click();true`);
     await until(()=>run(`!!document.querySelector('[aria-label="Edit ${name}"]') && !!document.activeElement?.closest('.cm-editor')`),'selected editor keyboard focus');
     assert.equal(await run(`document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()`),contents[name]);
     // Reopen as soon as the editor receives focus, while an exit may be pending.
   }
   await show();await web.insertText('cancelled');key('Escape');await until(()=>run(`!!document.activeElement?.closest('.cm-editor')`),'cancel restores source focus');
   await show();await query('slow.ts');await run(`document.querySelector('.file-picker [cmdk-item][data-value="slow.ts"]').click();true`);
   await until(()=>run(`!document.querySelector('.file-picker[data-state="open"]')`),'slow selection closes picker');
   await show();await web.insertText('bench');await delay(900);
   assert.equal(await run(`document.activeElement===document.querySelector('.file-picker input')`),true,'late file loading cannot steal a new picker focus');
   assert.equal(await run(`document.querySelector('.file-picker input').value`),'bench');key('Escape');
   await until(()=>run(`!!document.activeElement?.closest('.cm-editor')`),'cancel restores replacement editor focus');
   for(const [file,text] of Object.entries(contents))assert.equal(fs.readFileSync(path.join(project,file),'utf8'),text);
   console.log(JSON.stringify({passed:true,reopenCycles:18,checks:['First visible Quick Open frame owns input focus','Fast reopen never sends the first character into source','Selected files receive keyboard focus','Cancellation restores editor focus','Late file reads cannot steal an open picker focus','No fixture file changes'],scope:'Linux source Electron, native input insertion, actual CodeMirror, isolated real files and delayed read; no provider or installer claim.'}));
   clearTimeout(deadline);app.quit();
 })().catch(async error=>{console.error(error.stack);fs.writeFileSync('/tmp/tributary-picker-focus-failure.png',(await web.capturePage()).toPNG());app.exit(1);});});
});
app.on('quit',()=>fs.rmSync(root,{recursive:true,force:true}));require('../../desktop/main.js');
