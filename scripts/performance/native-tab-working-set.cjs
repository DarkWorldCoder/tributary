'use strict';
// Ordinary frozen UI, actual read-only agent/editor bridge, synthetic files.
// Fixture text is streamed in small batches, not retained by the test host.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { app, BrowserWindow } = require('electron');
const { openWorkbench } = require('../../core/workbench');
const ui = process.env.TRIBUTARY_TAB_UI, output = process.env.TRIBUTARY_TAB_OUTPUT, workload = process.env.TRIBUTARY_TAB_WORKLOAD;
assert.ok(ui && output && path.isAbsolute(ui) && path.isAbsolute(output)); assert.ok(['small', 'large'].includes(workload));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-tab-working-set-')), project = path.join(root, 'project'), profile = path.join(root, 'profile'); fs.mkdirSync(project);
const line = (file, row) => `// file ${String(file).padStart(2, '0')} row ${String(row).padStart(6, '0')} ${'x'.repeat(72)}\n`;
const lineCount = workload === 'large' ? 4096 : 16, files = [], corpus = crypto.createHash('sha256');
for (let index = 0; index < 24; index++) {
  const rel = 'file' + String(index).padStart(2, '0') + '.ts', fd = fs.openSync(path.join(project, rel), 'wx'), hash = crypto.createHash('sha256'); let bytes = 0;
  corpus.update(rel + '\0');
  try { for (let from = 0; from < lineCount; from += 64) { const chunk = Array.from({ length: Math.min(64, lineCount - from) }, (_, offset) => line(index, from + offset)).join(''); fs.writeSync(fd, chunk); hash.update(chunk); corpus.update(chunk); bytes += Buffer.byteLength(chunk); } }
  finally { fs.closeSync(fd); }
  files.push({ rel, bytes, lines: lineCount + 1, first: line(index, 0).trimEnd(), last: line(index, lineCount - 1).trimEnd(), sha256: hash.digest('hex') });
}
const fixture = { files, bytes: files.reduce((sum, file) => sum + file.bytes, 0), sha256: corpus.digest('hex'), note: '24 comment-only TypeScript files; initial file restored before measurement; 23 new pinned tabs, then six already-open-file navigation controls. Corpus generation uses at most 64 lines per text batch.' };
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, ...args) { return loadFile.call(this, path.resolve(file) === path.resolve(__dirname, '../../ui/dist/index.html') ? path.join(ui, 'index.html') : file, ...args); };
process.env.TRIBUTARY_DATA_DIR = profile;
const core = require('../../core'), drafts = require('../../core/drafts'), Base = core.Hub;
const seed = new Base({ dataDir: profile, home: root, secrets: new core.MemorySecrets() });
const threadId = seed.createThread(project, 'Read-only large file working set').id; seed.fileWatches.close(); seed.store.close();
drafts.save(profile, 'files:' + project, { active: files[0].rel, tabs: [{ rel: files[0].rel, mode: 'edit', pinned: true }] });
let live; core.Hub = class extends Base { constructor(options) { super({ ...options, home: root }); live = this; } async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, label) => { const end = Date.now() + 20000; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + label); await delay(10); } };
const report = { complete: false, createdAt: new Date().toISOString(), timeOrigin: performance.timeOrigin, root, workload, fixture, ui, runtime: process.versions, opens: [], controls: [], memory: [], rejected: [],
  hostSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
  scope: 'Linux source Electron, ordinary frozen UI, actual read-only agent/editor bridge and CodeMirror. No renderer counters, read overrides, profiler or forced GC. Bridge call times include actual IPC/editor readiness; a separate two-frame readiness time is recorded, not exact input-to-paint or provider CLI/HTTP round-trip. PSS is collected outside the app at explicit checkpoints, not a continuous peak. Main process includes this bounded fixture/verification host. No provider, VS Code, cold startup, real-model or cross-platform claim.' };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); save();
let sampleId = 0;
const memory = async (phase, index) => {
  const id = ++sampleId, atMs = performance.now(), responsePath = output + '.sample-' + id + '.json';
  process.stdout.write('TRIBUTARY_TAB_SAMPLE ' + JSON.stringify({ id, pid: process.pid, phase, index, atMs }) + '\n');
  await until(() => fs.existsSync(responsePath), 'external sample ' + id);
  const response = JSON.parse(await fs.promises.readFile(responsePath, 'utf8')); assert.equal(response.id, id);
  if (response.error) throw Error(response.error);
  const result = response.result; assert.equal(result.rootPid, process.pid);
  const row = { phase, index, atMs, sinceLastNewOpenMs: report.lastNewOpenAtMs === undefined ? null : atMs - report.lastNewOpenAtMs,
    collectedSinceLastNewOpenMs: report.lastNewOpenAtMs === undefined ? null : result.startedAt - (performance.timeOrigin + report.lastNewOpenAtMs), result };
  report.memory.push(row); if (!result.complete) report.rejected.push(row); save();
};
let started = false, passed = false; const deadline = setTimeout(() => { report.error = 'Host deadline exceeded'; save(); app.exit(1); }, 180000);
app.on('browser-window-created', (_event, win) => {
  win.setSize(1280, 900); const web = win.webContents, run = code => web.executeJavaScript(code);
  const frames = () => run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`);
  const verify = async file => {
    const actual = await run(`(()=>{const v=document.querySelector('[aria-label="Edit ${file.rel}"]')?.cmTile.root.view;return v?{length:v.state.doc.length,lines:v.state.doc.lines,first:v.state.doc.line(1).text,last:v.state.doc.line(v.state.doc.lines-1).text}:null;})()`);
    assert.deepEqual(actual, { length: file.bytes, lines: file.lines, first: file.first, last: file.last });
  };
  web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.thread',${JSON.stringify(JSON.stringify(threadId))});localStorage.setItem('tributary.theme','"dark"');localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'editor',expanded:true,panel:{open:true,tab:'files'}}}));true`);
    const loaded = new Promise(resolve => web.once('did-finish-load', resolve)); web.reload(); await loaded;
    await until(() => run(`!!document.querySelector('[aria-label="Edit file00.ts"]')`), 'restored editor'); await verify(files[0]);
    const bridge = await openWorkbench(live, live.thread(threadId), { id: 'working-set-fixture', agent: 'fixture', text: '' }, { mode: 'read' }); assert.ok(bridge);
    const open = async file => {
      const start = performance.now(); const response = await bridge.call('open_file', { path: file.rel }); const apiMs = performance.now() - start;
      assert.equal(response.path, file.rel); assert.equal(response.totalLines, file.lines); assert.ok(response.content.startsWith(file.first));
      await frames(); const twoFrameReadyMs = performance.now() - start; await verify(file);
      return { rel: file.rel, apiMs, twoFrameReadyMs, verified: true };
    };
    try {
      await delay(3000); for (let index = 0; index < 3; index++) { await memory('initial', index); await delay(100); }
      for (let index = 1; index < files.length; index++) {
        report.opens.push(await open(files[index])); save();
        if (index % 4 === 0) await memory('opening', index);
      }
      report.lastNewOpenAtMs = performance.now(); let elapsed = 0;
      for (const target of [0, 500, 1500, 3000, 5000]) { if (target > elapsed) await delay(target - elapsed); await memory('post-open', target); elapsed = target; }
      for (let index = 0; index < 6; index++) { report.controls.push(await open(files[index % 2 ? 23 : 0])); save(); }
      await delay(500); await memory('post-controls', 0);
      // Integrity verification follows all timings/memory observations. Only a
      // single 64 KiB byte buffer is reused; whole source strings are not read.
      const buffer = Buffer.alloc(64 * 1024);
      for (const file of files) { const fd = fs.openSync(path.join(project, file.rel), 'r'), hash = crypto.createHash('sha256'); try { let count; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count)); } finally { fs.closeSync(fd); } assert.equal(hash.digest('hex'), file.sha256); }
      assert.equal(report.opens.length, 23); assert.equal(report.controls.length, 6); assert.equal(report.rejected.length, 0, 'Incomplete memory samples prevent admission.');
      report.complete = true; report.checks = ['23 new pinned tabs reached exact document length/line count and first/last source lines', 'six already-open-file control actions reached the correct editor', 'all source bytes retain their original streaming hashes', 'all observed process-tree samples complete']; save(); passed = true;
    } finally { bridge.close(); }
    clearTimeout(deadline); app.quit();
  })().catch(async error => { report.error = error.stack; save(); console.error(error.stack); try { fs.writeFileSync(output + '.failure.png', (await web.capturePage()).toPNG()); } catch {} app.exit(1); }); });
});
app.on('quit', () => { if (passed) fs.rmSync(root, { recursive: true, force: true }); }); require('../../desktop/main.js');
