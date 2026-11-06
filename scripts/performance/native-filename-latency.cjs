'use strict';
// Owned Electron fixture. Native text input and actual picker/editor state.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { app } = require('electron');
const project = process.env.TRIBUTARY_FILENAME_PROJECT, output = process.env.TRIBUTARY_FILENAME_REPORT, moduleFile = process.env.TRIBUTARY_FILENAME_SCANNER;
for (const value of [project, output, moduleFile]) assert.ok(value && path.isAbsolute(value));
const fixture = JSON.parse(fs.readFileSync(process.env.TRIBUTARY_FILENAME_CASES, 'utf8'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-filename-latency-')); process.env.TRIBUTARY_DATA_DIR = profile;
const core = require('../../core'), { FileSearches } = require('../../core/filename-search'), { scanFileNames } = require(moduleFile);
const seed = new core.Hub({ dataDir: profile, home: profile, secrets: new core.MemorySecrets() }); seed.createThread(project, 'Filename responsiveness'); seed.fileWatches.close(); seed.store.close();
require('../../core/drafts').save(profile, 'files:' + project, { active: 'main.ts', tabs: [{ rel: 'main.ts', mode: 'edit', pinned: true }] });
let hub, initialIndexComplete = false; const scans = [];
core.Hub = class extends core.Hub {
  constructor(...args) { super(...args); hub = this; }
  async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; }
  async gitInfo() { return { branch: 'fixture', changed: [], stat: '' }; }
  async listFiles(...args) { const value = await super.listFiles(...args); initialIndexComplete = true; return value; }
  get fileSearches() {
    return this._fileSearches ||= new FileSearches(async (dir, query, options) => {
      const row = { query, started: performance.now(), cancelled: false }; scans.push(row);
      try { const result = await scanFileNames(dir, query, options); row.visited = result.visited; row.total = result.total; return result; }
      finally { row.durationMs = performance.now() - row.started; row.cancelled = options.signal.aborted; }
    });
  }
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { const end = Date.now() + 20000; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + label); await delay(10); } }
let started = false; const deadline = setTimeout(() => app.exit(1), 120000);
app.on('browser-window-created', (_event, win) => {
  win.setSize(1280, 850); const web = win.webContents, run = code => web.executeJavaScript(code);
  const key = (keyCode, modifiers = []) => { web.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); web.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); };
  const show = async () => { key('p', ['control']); await until(() => run(`document.activeElement === document.querySelector('.file-picker input')`), 'picker input focus'); };
  async function search(row) {
    // Install observation before native input; require the busy state so old
    // results with the same count cannot satisfy a newer query prematurely.
    await run(`window.__filenameMeasurement = new Promise((resolve,reject)=>{
      const query=${JSON.stringify(row.query)}, expected=${JSON.stringify(row.files)}, total=${row.total};
      const input=document.querySelector('.file-picker input'); let start=null,sawBusy=false;
      const clean=()=>{observer.disconnect();input.removeEventListener('input',typed);clearTimeout(timer);};
      const check=()=>{if(start===null||input.value!==query)return;const status=document.querySelector('.file-picker [role="status"]')?.textContent||'';
        if(status.includes('Searching files')){sawBusy=true;return;}if(!sawBusy)return;
        const items=[...document.querySelectorAll('.file-picker [cmdk-item]')];
        if(items.length!==expected.length||items.some((item,i)=>item.getAttribute('data-value')!==expected[i]))return;
        if(!status.startsWith(total>100?'100 of '+total+' files':total+' '+(total===1?'file':'files')))return;
        if(items.some(item=>!item.getBoundingClientRect().width))return;
        const elapsedMs=performance.now()-start;clean();resolve({query,elapsedMs,rows:items.length,total,sawBusy});};
      const typed=()=>{if(input.value===query&&start===null){start=performance.now();check();}};
      const observer=new MutationObserver(check);observer.observe(document.querySelector('.file-picker'),{subtree:true,childList:true,characterData:true,attributes:true});
      input.addEventListener('input',typed);const timer=setTimeout(()=>{clean();reject(Error('Missing exact current result: '+query));},20000);
    });true`);
    await web.insertText(row.query); const result = await run('window.__filenameMeasurement');
    assert.equal(await run(`document.activeElement===document.querySelector('.file-picker input')`), true);
    return result;
  }
  web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.theme','"dark"');localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'editor',expanded:true,panel:{open:true,tab:'files'}}}));true`);
    const loaded = new Promise(resolve => web.once('did-finish-load', resolve)); web.reload(); await loaded;
    await until(() => run(`!!document.querySelector('[aria-label="Edit main.ts"]')`), 'initial editor'); await until(() => initialIndexComplete, 'initial Explorer filename index');
    const observations = [];
    for (const row of fixture) {
      await show(); const measurement = await search(row); observations.push(measurement);
      if (row.files.length === 1) {
        key('Enter'); const rel = row.files[0]; await until(() => run(`!!document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify('Edit ' + rel))}+']') && !!document.activeElement?.closest('.cm-editor')`), 'selected editor focus');
        const text = await run(`document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify('Edit ' + rel))}+']').cmTile.root.view.state.doc.toString()`);
        assert.equal(text, fs.readFileSync(path.join(project, rel), 'utf8'));
      } else { key('Escape'); await until(() => run(`!document.querySelector('.file-picker[data-state="open"]')`), 'closed picker'); }
    }
    // Change a real query after its producer starts, without an injected delay.
    await show(); await web.insertText('source-'); await until(() => scans.some(row => row.query === 'source-'), 'real scan start');
    key('a', ['control']); key('Backspace'); await until(() => run(`document.querySelector('.file-picker input').value===''`), 'clear input');
    const replacement = fixture[1]; observations.push({ ...await search(replacement), replacement: true }); key('Escape');
    await until(() => hub._fileSearches.owners.size === 0 && hub._fileSearches.active === 0, 'released searches');
    const report = { observations, scans, exact: true, ownersAfterClose: hub._fileSearches.owners.size, activeAfterClose: hub._fileSearches.active, scope: 'Linux source Electron, same compiled UI and 40,008 nested searchable source files, native text input to exact current result DOM including debounce/IPC. Visible result DOM is not hardware input-to-paint. Initial Explorer index completes before measurement. No provider/model calls, diagnostic GC or whole-app RAM measurement.' };
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); clearTimeout(deadline); app.quit();
  })().catch(error => { console.error(error.stack); app.exit(1); }); });
});
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true })); require('../../desktop/main.js');
