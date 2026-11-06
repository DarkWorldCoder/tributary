'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { app } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-file-search-ui-')), project = path.join(root, 'project'), profile = path.join(root, 'profile');
fs.mkdirSync(project); fs.mkdirSync(path.join(project, 'src')); fs.writeFileSync(path.join(project, 'main.ts'), 'export const source = 1;\n');
for (let at = 0; at < 21001; at++) fs.writeFileSync(path.join(project, 'src', `source-${String(at).padStart(6, '0')}.ts`), `export const value = ${at};\n`);
const target = 'src/' + fs.readdirSync(path.join(project, 'src')).at(-1), original = fs.readFileSync(path.join(project, target), 'utf8');
process.env.TRIBUTARY_DATA_DIR = profile;
const core = require('../../core'), { FileSearches, scanFileNames } = require('../../core/filename-search');
const seed = new core.Hub({ dataDir: profile, home: root, secrets: new core.MemorySecrets() }); seed.createThread(project, 'Complete file search'); seed.fileWatches.close(); seed.store.close();
let hub, held = 0, cancelled = 0;
core.Hub = class extends core.Hub {
  constructor(...args) { super(...args); hub = this; }
  async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; }
  get fileSearches() {
    return this._fileSearches ||= new FileSearches(async (dir, query, options) => {
      if (query === 'hold') {
        held++; await new Promise((_resolve, reject) => {
          const abort = () => { cancelled++; reject(Object.assign(Error('cancelled fixture'), { name: 'AbortError' })); };
          if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true });
        });
      }
      return scanFileNames(dir, query, options);
    });
  }
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { const end = Date.now() + 20000; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + label); await delay(20); } }
let started = false; const checks = [], deadline = setTimeout(() => app.exit(1), 90000);
app.on('browser-window-created', (_event, win) => {
  win.setSize(1280, 850); const web = win.webContents, run = code => web.executeJavaScript(code);
  const key = (keyCode, modifiers = []) => { web.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); web.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); };
  const show = async () => { key('p', ['control']); await until(() => run(`document.activeElement === document.querySelector('.file-picker input')`), 'picker focus'); };
  const clear = async () => { key('a', ['control']); key('Backspace'); await delay(30); };
  web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.theme','"dark"');localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'editor',expanded:true,panel:{open:true,tab:'files'}}}));true`);
    const loaded = new Promise(resolve => web.once('did-finish-load', resolve)); web.reload(); await loaded;
    await until(() => run(`!!document.querySelector('[aria-label="Edit main.ts"]')`), 'workbench');
    await show(); await web.insertText('source-');
    await until(() => run(`document.querySelector('.file-picker [role="status"]')?.textContent.includes('100 of 21001 files')`), 'complete count');
    assert.equal(await run(`document.querySelectorAll('.file-picker [cmdk-item]').length`), 100); checks.push('21,001 real files counted; only 100 result rows retained in the picker');
    fs.writeFileSync('/tmp/tributary-filename-search-ui.png', (await web.capturePage()).toPNG());
    await clear(); await web.insertText(path.basename(target));
    await until(() => run(`!!document.querySelector('.file-picker [cmdk-item][data-value="${target}"]')`), 'target past old cutoff'); key('Enter');
    await until(() => run(`!!document.querySelector('[aria-label="Edit ${target}"]') && !!document.activeElement?.closest('.cm-editor')`), 'real target editor');
    assert.equal(await run(`document.querySelector('[aria-label="Edit ${target}"]').cmTile.root.view.state.doc.toString()`), original); checks.push('File beyond historical 20,000-entry cutoff opens with exact source and editor focus');
    await show(); await web.insertText('hold'); await until(() => held === 1, 'first active search'); await clear(); await web.insertText('main.ts');
    await until(() => cancelled === 1, 'query cancellation'); await until(() => run(`!!document.querySelector('.file-picker [cmdk-item][data-value="main.ts"]')`), 'latest result'); checks.push('Typing a newer query cancels the producer and only its result appears');
    await clear(); await web.insertText('hold'); await until(() => held === 2, 'second active search'); key('Escape');
    await until(() => cancelled === 2 && hub._fileSearches.owners.size === 0 && hub._fileSearches.active === 0, 'closed picker releases work'); checks.push('Closing the picker releases all leases and active directory work');
    await show(); await web.insertText('hold'); await until(() => held === 3, 'third active search'); const reloaded = new Promise(resolve => web.once('did-finish-load', resolve)); web.reload(); await reloaded;
    await until(() => cancelled === 3 && hub._fileSearches.owners.size === 0 && hub._fileSearches.active === 0, 'navigation cleanup'); checks.push('Renderer reload cancels producer and releases its owners');
    await until(() => run(`!!document.querySelector('[data-editor-group]')`), 'restored workbench');
    await run(`document.querySelector('button[aria-label="Find a file"]').click();true`);
    await until(() => run(`!!document.querySelector('input[aria-label="Find a file"]')`), 'Explorer filename input');
    await run(`document.querySelector('input[aria-label="Find a file"]').focus();true`); await web.insertText('hold'); await until(() => held === 4, 'Explorer producer');
    await run(`document.querySelector('button[aria-label="Hide file explorer"]').click();true`);
    await until(() => cancelled === 4 && hub._fileSearches.owners.size === 0 && hub._fileSearches.active === 0, 'hidden Explorer cleanup'); checks.push('Hiding the Explorer cancels its own filename producer');
    assert.equal(fs.readFileSync(path.join(project, target), 'utf8'), original); checks.push('Search and cancellation never modify source files');
    const report = { passed: true, checks, fixtureFiles: 21002, target, cancelled, scope: 'Linux source Electron, real local files, real CodeMirror and IPC; held scans inject a cancellable wait to exercise lifecycle. No installer or cross-editor performance claim.' };
    fs.writeFileSync('/tmp/tributary-filename-search-ui.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report)); clearTimeout(deadline); app.quit();
  })().catch(error => { console.error(error.stack); app.exit(1); }); });
});
app.on('quit', () => fs.rmSync(root, { recursive: true, force: true })); require('../../desktop/main.js');
