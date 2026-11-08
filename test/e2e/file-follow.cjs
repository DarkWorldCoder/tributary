'use strict';
// Isolated real desktop/file watcher; synthetic agent tool announcements, no provider.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { app } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-file-follow-')), project = path.join(root, 'project'), profile = path.join(root, 'profile');
fs.mkdirSync(project); const original = 'export const main = 1;\n'; fs.writeFileSync(path.join(project, 'main.ts'), original);
process.env.TRIBUTARY_DATA_DIR = profile;
const core = require('../../core'), drafts = require('../../core/drafts'), Base = core.Hub;
const seed = new Base({ dataDir: profile, home: root, secrets: new core.MemorySecrets() });
const threadId = seed.createThread(project, 'Follow real file writes').id; seed.fileWatches.close(); seed.store.close();
drafts.save(profile, 'files:' + project, { active: 'main.ts', tabs: [{ rel: 'main.ts', mode: 'edit', pinned: true }] });
let live, failWatches = false; const reads = new Map();
core.Hub = class extends Base {
  constructor(options) { super({ ...options, home: root }); live = this; }
  async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; }
  async readFile(dir, rel) { reads.set(rel, (reads.get(rel) || 0) + 1); return super.readFile(dir, rel); }
  watchFiles(...args) { if (failWatches) throw Error('Synthetic watcher registration failure'); return super.watchFiles(...args); }
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, label) => { const end = Date.now() + 15000; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + label); await delay(10); } };
const announce = (rel, n) => {
  const message = { id: 'follow-' + n, role: 'assistant', agent: 'fixture', text: 'Agent announcement ' + n, thinking: '', tools: [{ id: 'write-' + n, name: 'Write', input: { file_path: rel }, status: 'running' }], files: [], notices: [], ok: null, mode: 'edit' };
  live.emit('message', { threadId, message });
};
let started = false; const deadline = setTimeout(() => app.exit(1), 90000);
app.on('browser-window-created', (_event, win) => {
  win.setSize(1280, 850); const web = win.webContents, run = code => web.executeJavaScript(code);
  const key = (keyCode, modifiers = []) => { web.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); web.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); };
  const click = async selector => {
    const point = await run(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)};})()`);
    web.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 }); web.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  };
  const main = async () => {
    key('p', ['control']); await until(() => run(`!!document.querySelector('.file-picker input')`), 'Quick Open'); await web.insertText('main.ts');
    await until(() => run(`!!document.querySelector('.file-picker [cmdk-item][data-value="main.ts"]')`), 'main file result'); key('Enter');
    await until(() => run(`!!document.querySelector('[aria-label="Edit main.ts"]')&&document.querySelector('[aria-label="Follow agent"]').getAttribute('aria-pressed')==='false'&&!document.querySelector('.file-picker')`), 'manual navigation pauses following');
  };
  web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.thread',${JSON.stringify(JSON.stringify(threadId))});localStorage.setItem('tributary.theme','"dark"');localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'editor',expanded:false,panel:{open:true,tab:'files'}}}));true`);
    const loaded = new Promise(resolve => web.once('did-finish-load', resolve)); web.reload(); await loaded;
    await until(() => run(`!!document.querySelector('[aria-label="Edit main.ts"]')&&!!document.querySelector('[aria-label="Follow agent"]')`), 'initial file and follow control');
    await click('[aria-label="Follow agent"]');
    await until(() => run(`document.querySelector('[aria-label="Follow agent"]').getAttribute('aria-pressed')==='true'`), 'following enabled');
    announce('later.ts', 1); await until(() => (reads.get('later.ts') || 0) > 0, 'announced path read before creation');
    const later = 'export const later = 2;\n'; fs.writeFileSync(path.join(project, 'later.ts'), later);
    await until(() => run(`document.querySelector('[aria-label="Edit later.ts"]')?.cmTile.root.view.state.doc.toString()===${JSON.stringify(later)}`), 'write-before-create retry reaches the real editor');
    const changed = later + '// written on disk while following\n'; fs.writeFileSync(path.join(project, 'later.ts'), changed);
    await until(() => run(`document.querySelector('[aria-label="Edit later.ts"]')?.cmTile.root.view.state.doc.toString()===${JSON.stringify(changed)}`), 'live file write reaches the editor');
    await main(); announce('cancelled.ts', 2);
    await until(() => run(`document.body.textContent.includes('Agent announcement 2')`), 'new announcement delivered after manual navigation');
    assert.equal(reads.get('cancelled.ts') || 0, 0, 'paused following must not read the newly announced path');
    await click('[aria-label="Follow agent"]'); await until(() => (reads.get('cancelled.ts') || 0) > 0, 'following resumes the latest announcement');
    await main(); const attempts = reads.get('cancelled.ts'); fs.writeFileSync(path.join(project, 'cancelled.ts'), 'export const cancelled = 3;\n');
    await delay(650); assert.equal(reads.get('cancelled.ts'), attempts, 'manual navigation cancels the pending missing-file retry');
    assert.equal(await run(`!!document.querySelector('[aria-label="Edit main.ts"]')&&!document.querySelector('[aria-label="Edit cancelled.ts"]')`), true);
    assert.equal(fs.readFileSync(path.join(project, 'main.ts'), 'utf8'), original);
    await click('[aria-label="Workspace tools"] [aria-label="Memory"]');
    await until(() => run(`document.querySelector('[aria-label="Workspace tools"] [aria-label="Memory"]').getAttribute('aria-selected')==='true'`), 'hide file pane');
    await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`);
    const catchup = original + '// changed while inactive\n'; fs.writeFileSync(path.join(project, 'main.ts'), catchup); failWatches = true;
    await click('[aria-label="Workspace tools"] [aria-label="Files"]');
    await until(() => run(`document.querySelector('[aria-label="Edit main.ts"]')?.cmTile.root.view.state.doc.toString()===${JSON.stringify(catchup)}`), 'catch up despite failed watcher registration');
    await click('[aria-label="Document information"]');
    await until(() => run(`document.body.textContent.includes('Live updates unavailable')`), 'watch failure is shown in file information');
    console.log(JSON.stringify({ passed: true, checks: ['follow requests reach the file pane through real message delivery', 'a path announced before creation opens after the real file is written', 'subsequent disk writes update the editor', 'manual navigation pauses following and resumes from the latest announcement', 'superseding a missing-file intent cancels its retry and preserves the selected file', 'a failed watcher registration still catches up files changed while inactive'], scope: 'Linux source Electron, native input and actual core reads/file watchers; synthetic agent announcements and watcher failure, no provider or cross-platform claim.' }));
    clearTimeout(deadline); app.quit();
  })().catch(async error => { console.error(error.stack); try { fs.writeFileSync('/tmp/tributary-file-follow-failure.png', (await web.capturePage()).toPNG()); } catch {} app.exit(1); }); });
});
app.on('quit', () => fs.rmSync(root, { recursive: true, force: true })); require('../../desktop/main.js');
