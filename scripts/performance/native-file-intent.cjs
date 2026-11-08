'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const ui = process.env.TRIBUTARY_INTENT_UI, output = process.env.TRIBUTARY_INTENT_OUTPUT;
if (!ui || !output || !path.isAbsolute(ui) || !path.isAbsolute(output)) throw Error('Pass absolute diagnostic UI and output paths.');
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, ...args) { return loadFile.call(this, path.resolve(file) === path.resolve(__dirname, '../../ui/dist/index.html') ? path.join(ui, 'index.html') : file, ...args); };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-file-intent-session-')), project = path.join(root, 'project'), extra = path.join(root, 'extra'), profile = path.join(root, 'profile');
fs.mkdirSync(project); fs.mkdirSync(extra);
const files = { 'main.ts': 'export const main = 0;\n', 'one.ts': 'export const one = 1;\n', 'two.ts': 'export const two = 2;\n' };
for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(project, name), content);
fs.writeFileSync(path.join(extra, 'extra.ts'), 'export const extra = 3;\n');
process.env.TRIBUTARY_DATA_DIR = profile;
const core = require('../../core'), drafts = require('../../core/drafts'), crypto = require('node:crypto');
const Base = core.Hub, seed = new Base({ dataDir: profile, home: root, secrets: new core.MemorySecrets() });
seed.createThread(project, 'File opening ownership'); seed.project(project).folders = [extra]; seed.store.save(true); seed.fileWatches.close(); seed.store.close();
drafts.save(profile, 'files:' + project, { active: 'main.ts', tabs: [{ rel: 'main.ts', mode: 'edit', pinned: true }] });
let inFlight = 0; const fileReads = [], watchCalls = [];
core.Hub = class extends Base {
  async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; }
  watchFiles(project, files, id) { watchCalls.push({ project, files: [...files], id: id ?? null }); return super.watchFiles(project, files, id); }
  async readFile(dir, rel) {
    inFlight++;
    try { const file = await super.readFile(dir, rel); fileReads.push({ rel, characters: file.content?.length || 0, binaryBytes: file.bytes?.byteLength || 0 }); return file; }
    finally { inFlight--; }
  }
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, label) => { const end = Date.now() + 15000; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + label); await delay(10); } };
let started = false; const deadline = setTimeout(() => app.exit(1), 90000);
app.on('browser-window-created', (_event, win) => {
  const web = win.webContents, run = code => web.executeJavaScript(code);
  const frames = () => run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`);
  const snapshot = () => run(`({...window.__fileIntentProbe.counts})`);
  const delta = (a, b) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map(key => [key, (b[key] || 0) - (a[key] || 0)]));
  const open = async (rel, owner = project) => {
    await run(`window.__fileIntentProbe.openFile(${JSON.stringify(rel)},undefined,'pinned',undefined,true,${JSON.stringify(owner)});true`);
    await until(() => run(`Array.from(document.querySelectorAll('[data-workspace-root]')).some(root=>root.dataset.workspaceRoot===${JSON.stringify(owner)}&&root.getBoundingClientRect().width&&root.querySelector('[aria-label="Edit ${rel}"]'))`), 'target editor ' + rel);
    await frames();
  };
  web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.theme','"dark"');localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'editor',expanded:true,panel:{open:true,tab:'files'}}}));true`);
    const loaded = new Promise(resolve => web.once('did-finish-load', resolve)); web.reload(); await loaded;
    await until(() => run(`!!document.querySelector('.cm-content')&&!!window.__fileIntentProbe?.openFile`), 'source editor and diagnostic hook');
    await open('one.ts'); await open('two.ts'); await delay(200); await frames();
    const before = await snapshot(), perOpen = [];
    for (let i = 0; i < 20; i++) { const a = await snapshot(); await open(i % 2 ? 'two.ts' : 'one.ts'); perOpen.push(delta(a, await snapshot())); }
    const after = await snapshot();
    await open('extra.ts', extra); await open('main.ts');
    const trafficFiles = Array.from({ length: 12 }, (_, index) => 'traffic' + String(index).padStart(2, '0') + '.ts');
    for (const [index, rel] of trafficFiles.entries()) {
      files[rel] = `// file ${index}\n` + Array.from({ length: 1024 }, (_, row) => `// row ${row} ${'x'.repeat(40)}\n`).join('');
      fs.writeFileSync(path.join(project, rel), files[rel]);
    }
    await delay(200); await frames(); await until(() => inFlight === 0, 'initial reads settle');
    const trafficStart = fileReads.length, watchStart = watchCalls.length, perFileTraffic = [];
    for (const rel of trafficFiles) {
      const start = fileReads.length; await open(rel); await frames(); await until(() => inFlight === 0, 'reads settle for ' + rel);
      perFileTraffic.push({ rel, reads: fileReads.length - start });
    }
    const traffic = fileReads.slice(trafficStart);
    for (const [name, content] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(project, name), 'utf8'), content);
    assert.equal(fs.readFileSync(path.join(extra, 'extra.ts'), 'utf8'), 'export const extra = 3;\n');
    fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), passed: true, opens: 20, counts: delta(before, after), perOpen, runtime: process.versions,
      sources: JSON.parse(fs.readFileSync(path.join(ui, 'probe-sources.json'))), runtimeHostSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
      runtimeBackendHashes: Object.fromEntries(['core/file-watch.js', 'core/hub.js', 'core/files.js', 'desktop/main.js'].map(rel => [rel, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../..', rel))).digest('hex')])),
      traffic: { opens: trafficFiles.length, reads: traffic.length, characters: traffic.reduce((sum, file) => sum + file.characters, 0), perFile: perFileTraffic, calls: traffic },
      watchTraffic: watchCalls.slice(watchStart),
      checks: ['20 real file-open actions reached the selected editors', 'requests reach a previously unmounted secondary workspace folder and return to the main folder', '12 new source files opened; actual file-read responses counted separately', 'source bytes unchanged'],
      scope: 'Isolated native Electron, actual production store/actions/file panes plus test-build render counters. No providers. Not a paint, heap, whole-app RAM or cross-platform comparison.' }, null, 2) + '\n');
    clearTimeout(deadline); app.quit();
  })().catch(async error => { console.error(error.stack); fs.writeFileSync(output + '.failure.png', (await web.capturePage()).toPNG()); app.exit(1); }); });
});
app.on('quit', () => fs.rmSync(root, { recursive: true, force: true }));
require('../../desktop/main.js');
