'use strict';
// Real desktop IPC, directory watches and CodeMirror; no provider or read stub.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { app } = require('electron');
const { openWorkbench } = require('../../core/workbench');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-watch-editor-')), project = path.join(root, 'project'), profile = path.join(root, 'profile');
fs.mkdirSync(project); fs.writeFileSync(path.join(project, 'main.ts'), 'export const main = 1;\n'); fs.writeFileSync(path.join(project, 'other.ts'), 'export const other = 1;\n');
process.env.TRIBUTARY_DATA_DIR = profile;
const core = require('../../core'), drafts = require('../../core/drafts'), Base = core.Hub;
const seed = new Base({ dataDir: profile, home: root, secrets: new core.MemorySecrets() });
const threadId = seed.createThread(project, 'Incremental watch lifecycle').id; seed.fileWatches.close(); seed.store.close();
drafts.save(profile, 'files:' + project, { active: 'main.ts', tabs: [{ rel: 'main.ts', mode: 'edit', pinned: true }] });
let live; const calls = [];
core.Hub = class extends Base {
  constructor(options) { super({ ...options, home: root }); live = this; }
  async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; }
  watchFiles(dir, files, id) { calls.push({ dir, files: [...files], id }); return super.watchFiles(dir, files, id); }
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, label) => { const end = Date.now() + 15000; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + label); await delay(10); } };
let started = false; const deadline = setTimeout(() => app.exit(1), 90000);
app.on('browser-window-created', (_event, win) => {
  win.setSize(1280, 850); const web = win.webContents, run = code => web.executeJavaScript(code);
  const text = rel => run(`document.querySelector('[aria-label="Edit ${rel}"]')?.cmTile.root.view.state.doc.toString()`);
  const click = async selector => {
    const point = await run(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)};})()`);
    web.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 }); web.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  };
  const entry = () => [...live.fileWatches.watches.values()].find(view => view.project === project);
  web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.thread',${JSON.stringify(JSON.stringify(threadId))});localStorage.setItem('tributary.theme','"dark"');localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'editor',expanded:false,panel:{open:true,tab:'files'}}}));true`);
    const loaded = new Promise(resolve => web.once('did-finish-load', resolve)); web.reload(); await loaded;
    await until(() => text('main.ts'), 'restored editor'); await until(() => entry()?.targets.has('main.ts'), 'initial watch');
    const id = entry().id, starts = calls.filter(call => call.id === undefined).length;
    const bridge = await openWorkbench(live, live.thread(threadId), { id: 'watch-fixture', agent: 'fixture', text: '' }, { mode: 'read' });
    try {
      await bridge.call('open_file', { path: 'other.ts' }); await until(() => entry()?.targets.has('other.ts'), 'added path watch');
      assert.equal(entry().id, id); assert.equal(live.fileWatches.watches.size, 1); assert.equal(calls.filter(call => call.id === undefined).length, starts);
      const other = 'export const other = 2;\n', main = 'export const main = 2;\n';
      fs.writeFileSync(path.join(project, 'other.ts'), other); fs.writeFileSync(path.join(project, 'main.ts'), main);
      await until(async () => await text('other.ts') === other, 'active file live update');
      await bridge.call('open_file', { path: 'main.ts' }); await until(async () => await text('main.ts') === main, 'inactive file live update');
      // A user draft remains authoritative while an agent edits the disk file.
      await run(`{const v=document.querySelector('[aria-label="Edit main.ts"]').cmTile.root.view;v.dispatch({changes:{from:v.state.doc.length,insert:'// unsaved user draft\\n'}})};true`);
      const draft = main + '// unsaved user draft\n'; await until(async () => await text('main.ts') === draft, 'local draft');
      fs.writeFileSync(path.join(project, 'main.ts'), 'export const main = 3;\n');
      await until(() => run(`document.body.textContent.includes('Changed on disk. Draft kept.')`), 'disk conflict notification'); assert.equal(await text('main.ts'), draft);
      await click('[aria-label="Close other.ts"]'); await until(() => !entry()?.targets.has('other.ts'), 'closed file stops watching'); assert.equal(entry().id, id);
      await click('[aria-label="Workspace tools"] [aria-label="Memory"]'); await until(() => live.fileWatches.watches.size === 0, 'hidden pane releases watch');
      fs.writeFileSync(path.join(project, 'main.ts'), 'export const main = 4;\n');
      await click('[aria-label="Workspace tools"] [aria-label="Files"]'); await until(() => entry()?.targets.has('main.ts'), 'reactivated pane watch');
      assert.notEqual(entry().id, id); assert.equal(await text('main.ts'), draft); assert.equal(fs.readFileSync(path.join(project, 'main.ts'), 'utf8'), 'export const main = 4;\n');
      console.log(JSON.stringify({ passed: true, checks: ['new tabs update one live watch identity through real desktop IPC', 'active and inactive clean buffers receive real writes', 'dirty draft and disk conflict are preserved', 'closing a file removes its watch target', 'hiding the pane closes its native watch', 'showing the pane reconnects without overwriting the dirty draft'], scope: 'Isolated Linux source Electron; real core/IPC/file watches/CodeMirror, no provider or cross-platform claim.' }));
    } finally { bridge.close(); }
    clearTimeout(deadline); app.quit();
  })().catch(async error => { console.error(error.stack); try { fs.writeFileSync('/tmp/tributary-watch-editor-failure.png', (await web.capturePage()).toPNG()); } catch {} app.exit(1); }); });
});
app.on('quit', () => fs.rmSync(root, { recursive: true, force: true })); require('../../desktop/main.js');
