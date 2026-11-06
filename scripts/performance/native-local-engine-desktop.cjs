'use strict';
// Actual desktop main, renderer, bridge, IPC guardian and pinned native CPU model.
// An isolated profile is used; installed-agent discovery and update polling are off.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { app } = require('electron'), { sample } = require('./app-memory.cjs');
const output = process.env.TRIBUTARY_ENGINE_DESKTOP_OUTPUT, binary = process.env.TRIBUTARY_ENGINE_DESKTOP_BINARY, model = process.env.TRIBUTARY_ENGINE_DESKTOP_MODEL;
const idleSeconds = Number(process.env.TRIBUTARY_ENGINE_DESKTOP_IDLE);
for (const file of [output, binary, model]) assert.ok(file && path.isAbsolute(file));
assert.ok([2, 3600].includes(idleSeconds));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-desktop-model-')), profile = path.join(root, 'profile'), project = path.join(root, 'project');
fs.mkdirSync(project); fs.writeFileSync(path.join(project, 'README.md'), '# Real local CPU model memory fixture\n'); process.env.TRIBUTARY_DATA_DIR = profile;
const core = require('../../core'), seed = new core.Hub({ dataDir: profile, home: root, secrets: new core.MemorySecrets() });
const thread = seed.createThread(project, 'CPU model memory fixture'); seed.fileWatches.close(); seed.store.close();
let hub; const Base = core.Hub;
core.Hub = class extends Base { constructor(...args) { super(...args); hub = this; } async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; } };
const updates = require('../../desktop/updates'), BaseUpdates = updates.AppUpdates;
updates.AppUpdates = class extends BaseUpdates { async init() { await super.init(); clearTimeout(this.startTimer); clearInterval(this.interval); } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, label, timeout = 45000) => { const end = Date.now() + timeout; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + label); await delay(25); } };
const phases = [], turns = [], rejectedSamples = []; let started = false, nativePid, guardianPid, finished = false;
const checks = {}, deadline = setTimeout(() => { console.error('Desktop CPU model deadline'); hub?._localEngine?.killNow(); app.exit(1); }, 180000);
app.on('browser-window-created', (_event, win) => {
  win.setSize(1280, 850); const web = win.webContents, run = code => web.executeJavaScript(code);
  const call = (method, ...args) => run(`window.hub.call(${JSON.stringify(method)}, ...${JSON.stringify(args)})`);
  const snapshot = async label => {
    const samples = [];
    for (let attempt = 0; samples.length < 5 && attempt < 20; attempt++) {
      const tree = sample(process.pid);
      if (!tree.complete) { rejectedSamples.push({ label, attempt, tree }); await delay(100); continue; }
      assert.ok(tree.processes.some(process => process.role === 'renderer'));
      const nativeMemory = nativePid && fs.existsSync('/proc/' + nativePid) ? Object.fromEntries([...fs.readFileSync('/proc/' + nativePid + '/smaps_rollup', 'utf8').matchAll(/^(Pss_Anon|Pss_File|Pss_Shmem):\s+(\d+) kB$/gm)].map(match => [match[1], Number(match[2])])) : { Pss_Anon: 0, Pss_File: 0, Pss_Shmem: 0 };
      samples.push({ tree, nativeMemory }); await delay(100);
    }
    assert.equal(samples.length, 5, 'Could not obtain five complete samples within twenty attempts');
    // Observer reads only: no collectGarbage, heap snapshot or production GC flag.
    let heap, dom; web.debugger.attach('1.3');
    try { heap = await web.debugger.sendCommand('Runtime.getHeapUsage'); dom = await web.debugger.sendCommand('Memory.getDOMCounters'); }
    finally { web.debugger.detach(); }
    phases.push({ label, samples, heap, dom, engineState: await call('localEngineState') });
    console.log(JSON.stringify({ boundary: label, pssKiB: samples[2].tree.totals.pssKiB }));
  };
  const loadChat = async agent => {
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.thread',${JSON.stringify(JSON.stringify(thread.id))});${agent ? `localStorage.setItem('tributary.agent',${JSON.stringify(JSON.stringify(agent))});` : ''}localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'chat',expanded:false,panel:{open:false,tab:'files'}}}));true`);
    const loaded = new Promise(resolve => web.once('did-finish-load', resolve)); web.reload(); await loaded;
    await until(() => run(`!!document.querySelector('textarea[aria-label="Message"]')`), 'chat composer');
  };
  const turn = async text => {
    const began = performance.now(), previous = hub.thread(thread.id).messages.length;
    await run(`{const e=document.querySelector('textarea[aria-label="Message"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));e.focus();}true`);
    await until(() => run(`!!document.querySelector('button[aria-label="Send"]:not(:disabled)')`), 'send enabled');
    await run(`document.querySelector('button[aria-label="Send"]:not(:disabled)').click();true`);
    await until(() => hub.thread(thread.id).messages.length > previous && !hub.running.has(thread.id) && hub.thread(thread.id).messages.at(-1)?.role === 'assistant' && hub.thread(thread.id).messages.at(-1)?.ok !== undefined, 'real CPU response', 60000);
    const reply = hub.thread(thread.id).messages.at(-1); assert.equal(reply.ok, true); assert.ok(reply.text.trim());
    await until(() => run(`!!document.querySelector(${JSON.stringify('[data-message-id="' + reply.id + '"] .prose-reply')})?.textContent.trim()`), 'real response rendered');
    turns.push({ characters: reply.text.length, sha256: crypto.createHash('sha256').update(reply.text).digest('hex'), elapsedMs: performance.now() - began });
  };
  const persist = (passed, error) => fs.writeFileSync(output, JSON.stringify({ passed, date: new Date().toISOString(), idleSeconds, nativePid, guardianPid, mainPid: process.pid, checks, phases, turns, rejectedSamples, runtime: process.versions, error, scope: 'Actual Linux Electron desktop main/renderer/utility processes, actual bridge/Hub and Electron Node-mode guardian, real pinned llama.cpp/Qwen CPU model. Fresh temporary profile. No forced GC. Agent discovery and automatic update polling disabled; Xvfb, detached crash helpers, OS page cache and driver allocations outside the app tree excluded. One small CPU model; no GPU, Windows/macOS, installer, coding-quality or throughput claim.' }, null, 2) + '\n');
  web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
    await loadChat(); win.focus(); web.focus(); await delay(750); await snapshot('desktop-baseline');
    const engine = await call('startLocalEngine', { serverPath: binary, modelPath: model, context: 4096, threads: 2, idleSeconds });
    nativePid = hub.localEngine.child.runtimePid; guardianPid = hub.localEngine.child.pid; assert.ok(Number.isSafeInteger(nativePid));
    const id = await call('connectLocalModel', { service: 'llamacpp', baseUrl: engine.baseUrl, model: engine.model });
    await call('saveGateway', { ...hub.store.data.gateways.find(gateway => gateway.id === id), maxOutputTokens: 16 });
    await loadChat('direct:' + id); win.focus(); web.focus();
    await turn('Reply with plain text only: one two three four five.'); await snapshot('after-first-generation'); checks.actualUiGeneration = true;
    await delay(6000); assert.equal((await call('localEngineState')).status, idleSeconds === 2 ? 'sleeping' : 'ready'); await snapshot('after-idle');
    // This exercises the actual composer model picker, not just setup discovery.
    await run(`document.querySelector('.composer-model-trigger').click();true`);
    await until(() => run(`!!document.querySelector('[aria-label="Refresh models"]') && !document.querySelector('[aria-label="Refresh models"]').disabled`), 'model picker catalog');
    const pickerText = await run(`document.querySelector('[data-radix-popper-content-wrapper]')?.textContent || ''`);
    assert.ok(pickerText.includes(engine.model), 'The picker must show the actual runtime model');
    for (let n = 0; n < 10; n++) { const catalog = await call('modelCatalog', 'direct:' + id, id); assert.ok(catalog.models.some(row => row.id === engine.model)); }
    const afterCatalog = await call('localEngineState'); checks.modelPickerStatus = afterCatalog.status;
    assert.equal(afterCatalog.status, idleSeconds === 2 ? 'sleeping' : 'ready', 'Catalog reads must not reload idle weights');
    web.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); web.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await until(() => run(`!document.querySelector('[aria-label="Refresh models"]')`), 'model picker closed');
    checks.modelPickerAndTenCatalogReadsPreserveSleep = true; await snapshot('after-catalog');
    await turn('Reply with plain text only: five four three two one.'); assert.equal((await call('localEngineState')).status, 'ready'); await snapshot('after-second-generation'); checks.automaticWake = true;
    fs.writeFileSync(output + '.png', (await web.capturePage()).toPNG());
    await call('stopLocalEngine'); for (const pid of [nativePid, guardianPid]) assert.equal(fs.existsSync('/proc/' + pid), false);
    checks.nativeAndGuardianReaped = true; await delay(750); await snapshot('after-stop');
    persist(true); finished = true; clearTimeout(deadline); app.quit();
  })().catch(async error => {
    console.error(error.stack); persist(false, error.message);
    try { fs.writeFileSync(output + '.failure.png', (await web.capturePage()).toPNG()); await hub?._localEngine?.dispose(); } catch {}
    clearTimeout(deadline); app.exit(1);
  }); });
});
app.on('quit', () => { if (finished) fs.rmSync(root, { recursive: true, force: true }); });
require('../../desktop/main.js');
