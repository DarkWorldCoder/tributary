'use strict';
// Real temporary files + desktop; only fixture metadata/agent discovery is stubbed.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { app } = require('electron'); const { sample: processMemory } = require('./app-memory.cjs');
const repo = path.resolve(__dirname, '../..'), host = process.env.TRIBUTARY_TREE_HOST || repo;
const mode = process.env.TRIBUTARY_TREE_MODE || 'released', output = process.env.TRIBUTARY_TREE_OUTPUT;
if (!['baseline', 'released'].includes(mode) || !output || !path.isAbsolute(output) || !path.isAbsolute(host)) throw Error('Set tree mode and absolute host/output paths.');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-tree-retention-')), profile = path.join(root, 'profile');
process.env.TRIBUTARY_DATA_DIR = profile;
const core = require(path.join(repo, 'core')), drafts = require(path.join(repo, 'core/drafts'));
const seed = new core.Hub({ dataDir: profile, home: root, secrets: new core.MemorySecrets() });
const projects = [], threads = [], sources = [];
for (let i = 0; i < 6; i++) {
  const project = path.join(root, 'project-' + i); fs.mkdirSync(path.join(project, 'src', 'deep'), { recursive: true }); projects.push(project);
  const source = `export const project = ${i};\n`; sources.push(source);
  fs.writeFileSync(path.join(project, 'main.ts'), source);
  for (let n = 0; n < 520; n++) fs.writeFileSync(path.join(project, 'src', `file-${String(n).padStart(3, '0')}.ts`), `export const item = ${n};\n`);
  for (let n = 0; n < 40; n++) fs.writeFileSync(path.join(project, 'src', 'deep', `nested-${n}.ts`), 'export {};\n');
  threads.push(seed.createThread(project, 'Tree project ' + i));
  drafts.save(profile, 'files:' + project, { active: 'main.ts', tabs: [{ rel: 'main.ts', pinned: true, mode: 'edit' }] });
}
seed.store.data.settings.formatOnSave = false; seed.store.save(true); seed.fileWatches.close(); seed.store.close();
let phase = 'setup', gate = null, creationGate = null, hub; const calls = [], timings = [], phases = [];
const Base = core.Hub;
core.Hub = class extends Base {
  constructor(...args) { super(...args); hub = this; }
  async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; }
  async gitInfo() { return { branch: 'fixture', changed: [], stat: '' }; }
  createEntry(...args) {
    if (creationGate && !creationGate.started) { creationGate.started = true; return new Promise((resolve, reject) => { creationGate.release = () => super.createEntry(...args).then(resolve, reject); }); }
    return super.createEntry(...args);
  }
  readDirectory(project, rel, options) {
    calls.push({ phase, project, rel, offset: options?.offset || 0, limit: options?.limit });
    if (gate && !gate.started && project === projects[1] && rel === 'src' && options?.offset === 200) {
      gate.started = true; return new Promise((resolve, reject) => { gate.release = () => super.readDirectory(project, rel, options).then(resolve, reject); });
    }
    return super.readDirectory(project, rel, options);
  }
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, label) => { const end = Date.now() + 30000; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + label); await delay(25); } };
const arg = value => JSON.stringify(value); let started = false;
const deadline = setTimeout(() => { console.error('Tree fixture deadline'); app.exit(1); }, 240000);
app.on('browser-window-created', (_event, win) => {
 win.setSize(1280,850); const web = win.webContents, run = code => web.executeJavaScript(code).catch(error => { throw Error(error.message + '; ' + code.slice(0,180)); });
 web.on('console-message', event => { if (event.level === 'error') console.error('RENDERER', event.message); });
 web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
  const layouts = Object.fromEntries(projects.map(p => [p, { layout:'editor', expanded:false, panel:{open:true,tab:'files'} }]));
  await run(`localStorage.setItem('tributary.project',${arg(arg(projects[0]))});localStorage.setItem('tributary.workspaceViews.v1',${arg(arg(layouts))});localStorage.setItem('tributary.compactFolders','false');true`);
  const loaded = new Promise(resolve => web.once('did-finish-load',resolve)); web.reload(); await loaded;
  await until(() => run(`!!window.hub && !!document.querySelector('[aria-label="Search commands and chats"]')`),'app loaded');
  await run(`window.__treeRoot=p=>[...document.querySelectorAll('[data-workspace-root]')].find(e=>e.dataset.workspaceRoot===p);window.__treeRow=(p,rel)=>[...(window.__treeRoot(p)?.querySelectorAll('[data-tree-path]')||[])].find(e=>e.dataset.treePath===rel);window.__treeRows=(p,parent)=>[...(window.__treeRoot(p)?.querySelectorAll('[data-tree-path]')||[])].filter(e=>e.dataset.treeParent===parent).length;window.__treeData=p=>{const root=window.__treeRoot(p),box=root.querySelector('[aria-label="Project files"]');return {rows:root.querySelectorAll('[role="treeitem"]').length,top:box.scrollTop,src:window.__treeRows(p,'src'),deep:window.__treeRows(p,'src/deep'),srcExpanded:window.__treeRow(p,'src')?.getAttribute('aria-expanded'),deepExpanded:window.__treeRow(p,'src/deep')?.getAttribute('aria-expanded')}};window.__treeIds=new WeakMap();window.__treeSerial=0;window.__treeId=p=>{const n=window.__treeRoot(p)?.querySelector('nav[aria-label="Folder contents"]');if(!n)return null;if(!window.__treeIds.has(n))window.__treeIds.set(n,++window.__treeSerial);return window.__treeIds.get(n)};true`);
  const tab = async label => { await run(`{const e=document.querySelector('[role="tab"][aria-label=${arg(label)}]');if(e.getAttribute('aria-selected')!=='true'){e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));}};true`); await until(()=>run(`document.querySelector('[role="tab"][aria-label=${arg(label)}]').getAttribute('aria-selected')==='true'`),label+' selected'); await delay(150); };
  const open = async index => { const began=performance.now(); web.send('hub-event','open-thread',threads[index].id); await until(()=>run(`document.querySelector('[aria-label="Switch conversation"]')?.textContent.includes(${arg(threads[index].title)})`),'thread '+index); await tab('Files'); await until(()=>run(`!!window.__treeRow(${arg(projects[index])},'src')`),'root rows '+index); timings.push({phase,index,untilRootRowMs:performance.now()-began}); };
  const directCount = (index, parent) => run(`window.__treeRows(${arg(projects[index])},${arg(parent)})`);
  const full = async index => { await until(async()=>await directCount(index,'src')===521 && await directCount(index,'src/deep')===40,'full tree '+index); await delay(200); };
  const snapshot = async label => {
    const samples=[],natural=[];
    for(let i=0;i<3;i++){web.debugger.attach('1.3');try{natural.push({heap:await web.debugger.sendCommand('Runtime.getHeapUsage'),dom:await web.debugger.sendCommand('Memory.getDOMCounters')});}finally{web.debugger.detach();}natural.at(-1).processTree=processMemory(process.pid);await delay(100);}
    for(let i=0;i<5;i++) { web.debugger.attach('1.3'); try { await web.debugger.sendCommand('Runtime.discardConsoleEntries'); await web.debugger.sendCommand('HeapProfiler.collectGarbage'); samples.push({heap:await web.debugger.sendCommand('Runtime.getHeapUsage'),dom:await web.debugger.sendCommand('Memory.getDOMCounters')}); } finally {web.debugger.detach();} samples.at(-1).processTree=processMemory(process.pid); await delay(100); }
    const trees=JSON.parse(await run(`JSON.stringify([...document.querySelectorAll('nav[aria-label="Folder contents"]')].map(e=>({project:e.closest('[data-workspace-root]')?.dataset.workspaceRoot,rows:e.querySelectorAll('[role="treeitem"]').length})))`));
    phases.push({label,trees,natural,samples});console.log('SAMPLED',label,JSON.stringify(trees.map(t=>t.rows)));
    assert.equal(trees.length,mode==='baseline'?6:1);
  };
  const anchors=[]; phase='warm';
  for(let i=0;i<6;i++) {
    await open(i); await run(`window.__treeRow(${arg(projects[i])},'src').click();true`); await until(async()=>await directCount(i,'src')===200,'first page');
    for(const count of [400,521]) { await run(`{const root=window.__treeRoot(${arg(projects[i])});[...root.querySelectorAll('button')].find(e=>e.textContent.startsWith('Show more')).click();};true`); await until(async()=>await directCount(i,'src')===count,'page '+count); }
    await run(`window.__treeRow(${arg(projects[i])},'src/deep').click();true`); await full(i);
    await run(`{const root=window.__treeRoot(${arg(projects[i])}),v=root.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from:v.state.doc.length,insert:${arg('// DIRTY_'+i+'\n')}}});const row=window.__treeRow(${arg(projects[i])},'src/file-450.ts');row.focus({preventScroll:true});const box=root.querySelector('[aria-label="Project files"]');box.scrollTop=10000;};true`); await delay(180);
    anchors.push(JSON.parse(await run(`JSON.stringify({data:window.__treeData(${arg(projects[i])}),id:window.__treeId(${arg(projects[i])}),anchorOffset:window.__treeRow(${arg(projects[i])},'src/file-450.ts').getBoundingClientRect().top-window.__treeRoot(${arg(projects[i])}).querySelector('[aria-label="Project files"]').getBoundingClientRect().top})`)));
  }
  await snapshot('six-expanded-projects');
  phase='same-context';const currentId=await run(`window.__treeId(${arg(projects[5])})`);await tab('Memory');await tab('Files');assert.equal(await run(`window.__treeId(${arg(projects[5])})`),currentId);await full(5);
  phase='restore';await open(0);await full(0);
  const restored=JSON.parse(await run(`JSON.stringify({data:window.__treeData(${arg(projects[0])}),id:window.__treeId(${arg(projects[0])}),anchorOffset:window.__treeRow(${arg(projects[0])},'src/file-450.ts').getBoundingClientRect().top-window.__treeRoot(${arg(projects[0])}).querySelector('[aria-label="Project files"]').getBoundingClientRect().top})`));
  assert.equal(restored.data.srcExpanded,'true');assert.equal(restored.data.deepExpanded,'true');assert.ok(Math.abs(restored.anchorOffset-anchors[0].anchorOffset)<=1,JSON.stringify({restored,original:anchors[0]}));
  assert.equal(restored.id===anchors[0].id,mode==='baseline');
  await run(`window.__treeRoot(${arg(projects[0])}).querySelector('[role="tree"]').focus();true`);assert.equal(await run(`document.activeElement.dataset.treePath`),'src/file-450.ts');
  for(let i=0;i<6;i++){await open(i);await full(i);assert.equal(await run(`window.__treeRoot(${arg(projects[i])}).querySelector('.cm-content').cmTile.root.view.state.doc.toString()`),sources[i]+'// DIRTY_'+i+'\n');}
  await snapshot('after-one-return-pass');
  for(let cycle=0;cycle<2;cycle++)for(let i=0;i<6;i++){await open(i);await full(i);}await snapshot('after-three-return-passes');
  // A page request completing after unmount must not continue reading pages in
  // the old context. The next open must still honor its loaded-page intent.
  phase='late-page';gate={started:false};web.send('hub-event','open-thread',threads[1].id);await until(()=>!!gate.started,'held second page');await open(0);const before=calls.length;await gate.release();gate=null;await delay(300);
  const latePages=calls.slice(before).filter(c=>c.project===projects[1]&&c.rel==='src'&&c.offset>=400);if(mode==='released')assert.equal(latePages.length,0);
  await open(1);await full(1);
  const extra = {};
  if (mode === 'released') {
    phase='creation-ownership';
    await run(`window.__treeRoot(${arg(projects[1])}).querySelector('[aria-label="New file"]').click();true`);
    await until(()=>run(`!!document.querySelector('[aria-label="File or folder name"]')`),'creation dialog');
    await run(`{const e=document.querySelector('[aria-label="File or folder name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'created-after-switch.txt');e.dispatchEvent(new Event('input',{bubbles:true}));};true`);
    await open(0);await open(1);assert.equal(await run(`document.querySelector('[aria-label="File or folder name"]').value`),'created-after-switch.txt');
    creationGate={started:false};await run(`document.querySelector('[aria-label="File or folder name"]').closest('form').requestSubmit();true`);await until(()=>!!creationGate.started,'held file creation');await open(0);await creationGate.release();creationGate=null;
    await until(()=>fs.existsSync(path.join(projects[1],'created-after-switch.txt')),'actual created file');await open(1);await until(()=>run(`window.__treeRoot(${arg(projects[1])}).querySelector('[role="tab"][data-file-path="created-after-switch.txt"]')?.getAttribute('aria-selected')==='true'`),'created file tab');assert.equal(fs.readFileSync(path.join(projects[1],'created-after-switch.txt'),'utf8'),'');extra.creationDraftAndPendingOperationPreserved=true;
    phase='multi-root';hub.setProjectFolders(projects[0],[projects[1]]);await open(0);
    await until(()=>run(`!!window.__treeRoot(${arg(projects[0])}).querySelector('[aria-label='+${arg(JSON.stringify('Folder '+projects[1]))}+']')`),'additional workspace root');
    await run(`{const root=window.__treeRoot(${arg(projects[0])}),section=[...root.querySelectorAll('section')].find(e=>e.getAttribute('aria-label')===${arg('Folder '+projects[1])});section.querySelector('button').click();};true`);
    const multiRow=(project,rel)=>`[...window.__treeRoot(${arg(projects[0])}).querySelectorAll('nav[data-tree-project]')].find(e=>e.dataset.treeProject===${arg(project)}).querySelector('[data-tree-path='+${arg(JSON.stringify(rel))}+']')`;
    for(const project of [projects[0],projects[1]]){await until(()=>run(`!!(${multiRow(project,'src')})`),'multi root rows');await run(`${multiRow(project,'src')}.click();true`);await until(()=>run(`${multiRow(project,'src')}.getAttribute('aria-expanded')==='true'`),'multi root expanded');}
    const anchor=multiRow(projects[1],'src/file-090.ts');await until(()=>run(`!!(${anchor})`),'duplicate relative paths');
    await run(`{const row=${anchor},box=window.__treeRoot(${arg(projects[0])}).querySelector('[aria-label="Project files"]');row.focus({preventScroll:true});box.scrollTop+=row.getBoundingClientRect().top-box.getBoundingClientRect().top-80;};true`);await delay(200);
    const offset=await run(`(${anchor}).getBoundingClientRect().top-window.__treeRoot(${arg(projects[0])}).querySelector('[aria-label="Project files"]').getBoundingClientRect().top`);
    await open(2);await open(0);await until(()=>run(`!!(${anchor})`),'multi root restored');await delay(250);
    assert.ok(Math.abs(await run(`(${anchor}).getBoundingClientRect().top-window.__treeRoot(${arg(projects[0])}).querySelector('[aria-label="Project files"]').getBoundingClientRect().top`)-offset)<=1,'root-qualified scroll restored');
    for(const project of [projects[0],projects[1]])assert.equal(await run(`${multiRow(project,'src')}.getAttribute('aria-expanded')`),'true');extra.multiRootExpansionAndScrollPreserved=true;
    fs.writeFileSync(path.join(projects[1],'src','added-while-hidden.ts'),'export const external = true;\n');await open(2);await open(0);await until(()=>run(`!!(${multiRow(projects[1],'src/added-while-hidden.ts')})`),'external addition after release');extra.externalFileAdditionVisible=true;
  }
  const report={date:new Date().toISOString(),mode,baselineRevision:process.env.TRIBUTARY_TREE_BASELINE || '04807e2',hostUiSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(host,'ui/dist/assets/app.js'))).digest('hex'),phases,calls,timings,anchors,restored,latePages,
    correctness:{pagesAndExpandedFoldersPreserved:true,scrollAnchorPreserved:true,keyboardFocusPreserved:true,currentContextTreeStayedWarm:true,dirtyEditorTextPreserved:true,latePageCompletionSafe:true,...extra},runtime:process.versions,
    scope:'Linux source desktop, six real temporary trees with 520 src files and 40 nested files each; no providers/models. Renderer heap after diagnostic GC plus non-atomic process-tree PSS, not normal peak/VRAM or general speed. WeakMap identities do not pin released trees.',
    sourceHashes:Object.fromEntries(['ui/src/components/directory-tree.tsx','ui/src/components/workspace-files.tsx','ui/src/hooks/use-tree-viewport.ts','ui/src/lib/directory-session.mjs','ui/src/lib/tree-viewport.mjs','scripts/performance/native-tree-retention.cjs'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,f))).digest('hex')]))};
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');clearTimeout(deadline);app.quit();
 })().catch(error=>{console.error(error.stack);app.exit(1)}); });
});
app.on('quit',()=>fs.rmSync(root,{recursive:true,force:true}));require(path.join(host,'desktop/main.js'));
