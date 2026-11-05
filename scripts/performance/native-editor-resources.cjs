'use strict';
// Disposable project switching through the real desktop. Never invokes agents.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const assert = require('node:assert/strict'); const { app } = require('electron');
const repo = path.resolve(__dirname, '../..'), host = process.env.TRIBUTARY_EDITOR_HOST || repo;
const output = process.env.TRIBUTARY_EDITOR_OUTPUT, mode = process.env.TRIBUTARY_EDITOR_MODE || 'suspended';
if (!output || !path.isAbsolute(output) || !path.isAbsolute(host)) throw Error('Set absolute editor host/output paths.');
if (!['baseline', 'suspended'].includes(mode)) throw Error('Unknown editor fixture mode.');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-editor-resources-')), profile = path.join(root, 'profile');
process.env.TRIBUTARY_DATA_DIR = profile;
const core = require(path.join(repo, 'core')), drafts = require(path.join(repo, 'core/drafts'));
const seed = new core.Hub({ dataDir: profile, home: root, secrets: new core.MemorySecrets() }); const projects = [], chats = [], sources = [];
for (let i = 0; i < 6; i++) {
  const project = path.join(root, 'project-' + i); fs.mkdirSync(project); projects.push(project);
  const source = Array.from({ length: 2500 }, (_, line) => `export function item_${line}() {\n  return { project: "${i}", value: ${line}, tag: "fixture_${line}" };\n}\n`).join('');
  sources.push(source); fs.writeFileSync(path.join(project, 'main.ts'), source); fs.writeFileSync(path.join(project, 'README.md'), '# Disposable editor fixture\n');
  chats.push(seed.createThread(project, 'Editor project ' + i));
  drafts.save(profile, 'files:' + project, { active: 'main.ts', tabs: [{ rel: 'main.ts', pinned: true, mode: 'edit', wrap: false }] });
}
seed.store.data.settings = { ...seed.store.data.settings, mode: 'edit', formatOnSave: false }; seed.store.save(true); seed.fileWatches.close(); seed.store.close();
const calls = [], phases = []; let hub, phase = 'setup', gitGeneration = 0, formatting;
const Base = core.Hub;
core.Hub = class extends Base {
  constructor(...args) { super(...args); hub = this; }
  async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; }
  async lineAuthors(project, rel) { calls.push({ phase, method: 'lineAuthors', project }); return { authors: Array.from({ length: sources[0].split('\n').length }, (_, i) => i % 24), turns: Array.from({ length: 24 }, (_, i) => ({ agent: 'fixture', threadId: chats[0].id, title: 'Synthetic attribution ' + i, messageId: 'turn-' + i, request: ('Fixture attribution request ' + i + ' ').repeat(80) })) }; }
  async fileDiff(project, rel) { calls.push({ phase, method: 'fileDiff', project }); return `diff --git a/main.ts b/main.ts\n--- a/main.ts\n+++ b/main.ts\n@@ -0,0 +1,2 @@\n+export const a = 1;\n+export const b = 2;\n`; }
  async gitInfo(project) { return { branch: 'fixture', changed: [], stat: project + ':' + gitGeneration }; }
  formatSource(project, rel, text) { calls.push({ phase, method: 'formatSource', project }); return new Promise(resolve => { formatting = { project, rel, text, resolve }; }); }
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const dirtySuffix = index => '// DIRTY_PROJECT_' + index + String.fromCharCode(10);
const formatSuffix = '// FORMAT_FINISHED_WHILE_HIDDEN' + String.fromCharCode(10);
const until = async (fn, label) => { const end = Date.now() + 20000; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + label); await delay(25); } };
let started = false; const deadline = setTimeout(() => { console.error('Editor fixture deadline exceeded'); app.exit(1); }, 180000);
app.on('browser-window-created', (_event, win) => {
  win.setSize(1280, 850); const web = win.webContents, run = code => web.executeJavaScript(code).catch(error => { throw Error(error.message + '; expression: ' + code.slice(0, 220)); });
  web.on('console-message', event => { if (event.level === 'error') console.error('RENDERER', event.message); });
  web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
    const views = Object.fromEntries(projects.map(project => [project, { layout: 'editor', expanded: false, panel: { open: true, tab: 'files' } }]));
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(projects[0]))});localStorage.setItem('tributary.workspaceViews.v1',${JSON.stringify(JSON.stringify(views))});true`);
    const loaded = new Promise(resolve => web.once('did-finish-load', resolve)); web.reload(); await loaded;
    await until(() => run(`!!window.hub && !!document.querySelector('[aria-label="Search commands and chats"]')`), 'app loaded');
    await run(`window.__editorViewFor=(project)=>{const root=[...document.querySelectorAll('[data-workspace-root]')].find(n=>n.dataset.workspaceRoot===project);return root?.querySelector('.cm-content')?.cmTile?.root?.view};window.__editorKept=new Map();window.__editorFlashCount=v=>{let count=0;for(const value of v.state.values)if(value&&typeof value.iter==='function'&&typeof value.size==='number'){const cursor=value.iter();while(cursor.value){if(cursor.value.spec?.class==='cm-agent-flash')count++;cursor.next()}}return count};window.__editorResources=()=>[...document.querySelectorAll('.cm-content')].map(n=>{const v=n.cmTile.root.view,b=v.state.values.find(x=>x&&x.markers&&Array.isArray(x.turns));return {project:n.closest('[data-workspace-root]')?.dataset.workspaceRoot,visible:!!n.getBoundingClientRect().width,treeLength:v.state.tree?.length||0,docLength:v.state.doc.length,blameMarkers:b?.markers.size||0,blameTurns:b?.turns.length||0,flashLines:window.__editorFlashCount(v)}});true`);
    const open = async index => {
      web.send('hub-event', 'open-thread', chats[index].id);
      await until(() => run(`document.querySelector('[aria-label="Switch conversation"]')?.textContent.includes(${JSON.stringify(chats[index].title)})`), 'selected chat ' + index);
      await selectTab('Files');
      await until(() => run(`!!window.__editorViewFor(${JSON.stringify(projects[index])})?.dom.getBoundingClientRect().width`), 'project editor ' + index);
      await until(() => run(`window.__editorViewFor(${JSON.stringify(projects[index])})?.state.tree?.length>0`), 'grammar ' + index);
      await delay(450);
    };
    const selectTab = async label => {
      await run(`{const e=document.querySelector('[role="tab"][aria-label="${label}"]');if(e.getAttribute('aria-selected')!=='true'){e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));}};true`);
      await until(() => run(`document.querySelector('[role="tab"][aria-label="${label}"]').getAttribute('aria-selected')==='true'`), 'selected tab ' + label); await delay(150);
    };
    const inspect = async () => JSON.parse(await run(`JSON.stringify(window.__editorResources())`));
    const sample = async label => {
      const samples = [];
      for (let i = 0; i < 5; i++) {
        web.debugger.attach('1.3');
        try { await web.debugger.sendCommand('Runtime.discardConsoleEntries'); await web.debugger.sendCommand('HeapProfiler.collectGarbage'); samples.push({ heap: await web.debugger.sendCommand('Runtime.getHeapUsage'), dom: await web.debugger.sendCommand('Memory.getDOMCounters') }); }
        finally { web.debugger.detach(); }
        await delay(100);
      }
      const resources = await inspect(); const entry = { label, resources, samples }; phases.push(entry); console.log('SAMPLED', label, JSON.stringify(resources.map(r => ({ visible: r.visible, tree: r.treeLength, blame: r.blameMarkers })))); return entry;
    };
    phase = 'warm';
    for (let i = 0; i < projects.length; i++) {
      await open(i);
      if (i === 0) {
        sources[0] = sources[0].replace('item_0', 'item_external_0'); fs.writeFileSync(path.join(projects[0], 'main.ts'), sources[0]);
        await until(() => run(`window.__editorViewFor(${JSON.stringify(projects[0])}).state.doc.toString().startsWith('export function item_external_0')`), 'external edit reflected');
        assert.ok(await run(`window.__editorFlashCount(window.__editorViewFor(${JSON.stringify(projects[0])}))`), 'active edit flash');
      }
      if (i === 1 && mode === 'suspended') assert.equal(await run(`window.__editorFlashCount(window.__editorViewFor(${JSON.stringify(projects[0])}))`), 0);
      await run(`{const p=${JSON.stringify(projects[i])},v=window.__editorViewFor(p);v.dispatch({selection:{anchor:v.state.doc.length},scrollIntoView:true});window.__editorKept.set(p,v);v.dispatch({changes:{from:v.state.doc.length,insert:${JSON.stringify(dirtySuffix(i))}},selection:{anchor:3}});};true`);
      await delay(300);
    }
    const warm = await sample('six-visited-one-visible'); assert.equal(warm.resources.length, 6);
    if (mode === 'suspended') { assert.equal(warm.resources.filter(r => r.treeLength).length, 1); assert.equal(warm.resources.filter(r => r.blameMarkers).length, 1); }
    else assert.equal(warm.resources.filter(r => r.treeLength).length, 6);
    phase = 'hidden'; await selectTab('Memory'); await delay(400); const hidden = await sample('all-editors-hidden');
    if (mode === 'suspended') assert.ok(hidden.resources.every(r => !r.treeLength && !r.blameMarkers));
    const callsBefore = calls.length; gitGeneration++; hub.emit('running', { threadId: chats.at(-1).id, running: false }); await delay(450);
    const hiddenRefreshCalls = calls.slice(callsBefore).filter(call => call.method === 'fileDiff');
    if (mode === 'suspended') assert.equal(hiddenRefreshCalls.length, 0);
    phase = 'correctness'; await open(0); // Its saved Files view remains selected.
    await run(`{const v=window.__editorViewFor(${JSON.stringify(projects[0])});if(v!==window.__editorKept.get(${JSON.stringify(projects[0])}))throw Error('Editor replaced');if(!v.state.doc.toString().endsWith(${JSON.stringify(dirtySuffix(0))}))throw Error('Dirty text lost');if(v.state.selection.main.head!==3)throw Error('Selection lost');v.focus();};true`);
    await run(`window.dispatchEvent(new CustomEvent('tributary:format-file',{detail:{project:${JSON.stringify(projects[0])},path:'main.ts'}}));true`);
    await until(() => !!formatting, 'format request started'); await selectTab('Memory');
    formatting.resolve(formatting.text + formatSuffix);
    await until(() => run(`window.__editorViewFor(${JSON.stringify(projects[0])}).state.doc.toString().endsWith(${JSON.stringify(formatSuffix)})`), 'hidden format completion');
    await selectTab('Files'); await delay(400);
    await run(`window.__editorViewFor(${JSON.stringify(projects[0])}).focus();window.dispatchEvent(new CustomEvent('tributary:editor-command',{detail:'undo'}));true`);
    assert.equal(await run(`window.__editorViewFor(${JSON.stringify(projects[0])}).state.doc.toString()`), sources[0] + dirtySuffix(0));
    await run(`window.dispatchEvent(new CustomEvent('tributary:editor-command',{detail:'undo'}));true`);
    assert.equal(await run(`window.__editorViewFor(${JSON.stringify(projects[0])}).state.doc.toString()`), sources[0]);
    await run(`window.dispatchEvent(new CustomEvent('tributary:editor-command',{detail:'redo'}));true`);
    assert.equal(await run(`window.__editorViewFor(${JSON.stringify(projects[0])}).state.doc.toString()`), sources[0] + dirtySuffix(0));
    for (let i = 1; i < 6; i++) { await open(i); assert.equal(await run(`window.__editorViewFor(${JSON.stringify(projects[i])}).state.doc.toString()`), sources[i] + dirtySuffix(i)); }
    for (let i = 0; i < 4; i++) { await selectTab('Memory'); await selectTab('Files'); }
    await delay(400); const repeated = await sample('after-repeated-resume');
    if (mode === 'suspended') assert.equal(repeated.resources.filter(r => r.treeLength).length, 1);
    for (let i = 0; i < 12; i++) { await selectTab('Memory'); await selectTab('Files'); }
    await delay(400); const extended = await sample('after-extended-resume');
    if (mode === 'suspended') assert.equal(extended.resources.filter(r => r.treeLength).length, 1);
    const report = { date: new Date().toISOString(), mode, baselineRevision: 'd7a97b7', hostUiSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(host, 'ui/dist/assets/app.js'))).digest('hex'), hardware: { platform: process.platform, arch: process.arch, cpuModel: os.cpus()[0]?.model, totalMemoryBytes: os.totalmem() }, phases, calls, hiddenRefreshCalls, retainedEditorCount: 6, sameViewsPreserved: true, dirtyDocumentsPreserved: true, selectionPreserved: true, externalEditFlashVerified: true, pendingFormatCompletedWhileHidden: true, undoRedoExact: true, runtime: process.versions, scope: 'Linux source desktop with six synthetic 7500-line TypeScript editors, synthetic attribution/diff and a controlled formatter over the actual bridge. CDP post-diagnostic-GC renderer heap, not PSS, RSS, GPU/model memory or general app speed. Private cmTile/debug tree getter and own blame-field shape are version-pinned diagnostics only.', sourceHashes: Object.fromEntries(['ui/src/components/code-editor.tsx', 'ui/src/lib/editor-grammar.mjs', 'ui/src/hooks/use-debugger.ts', 'ui/src/lib/agent-editor.ts', 'scripts/performance/native-editor-resources.cjs'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')])) };
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); clearTimeout(deadline); app.quit();
  })().catch(error => { console.error(error.stack); app.exit(1); }); });
});
app.on('quit', () => fs.rmSync(root, { recursive: true, force: true })); require(path.join(host, 'desktop/main.js'));
