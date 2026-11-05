'use strict';
// Run with Electron under a disposable display. This is a measurement harness,
// not an app startup option: it replaces discovery with a deterministic local CLI.
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto'); const v8 = require('node:v8');
const { app } = require('electron'); const { sample } = require('./app-memory.cjs'); const core = require('../../core');
const mode = process.env.TRIBUTARY_HISTORY_MODE; const output = process.env.TRIBUTARY_HISTORY_OUTPUT; const node = process.env.TRIBUTARY_NODE_BINARY;
if (!['compatibility', 'managed'].includes(mode) || !output || !node || (!path.isAbsolute(node) || !fs.existsSync(node))) throw new Error('Set TRIBUTARY_HISTORY_MODE, TRIBUTARY_HISTORY_OUTPUT and an absolute TRIBUTARY_NODE_BINARY.');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-native-history-')); const profile = path.join(root, 'profile'); const project = path.join(root, 'project'); fs.mkdirSync(project); fs.writeFileSync(path.join(project, 'README.md'), '# Disposable history fixture\n');
process.env.TRIBUTARY_DATA_DIR = profile;
const defaults = { version: 1, projects: [{ path: project, name: 'History fixture', trusted: true }], threads: [], gateways: [], notifications: [], settings: { mode: 'read', agent: 'fixture' } };
const seed = new core.SqliteStore(profile, defaults);
for (let i = 0; i < 32; i++) seed.data.threads.push({ id: `chat-${i}`, title: `Saved chat ${i}`, project, createdAt: i, updatedAt: i, agentSessions: {}, messages: Array.from({ length: 64 }, (_, j) => ({ id: `${i}-${j}`, role: 'assistant', agent: 'previous', text: `${j % 10}:` + 'source context '.repeat(2200), tools: [{ name: 'Bash', output: 'tool log '.repeat(400) }], files: [], notices: [], ok: true })) });
seed.save(true); seed.close();
const FixtureAgent = { id: 'fixture', name: 'Fixture CLI', color: '#55aa88', glyph: 'Fi', protocol: 'codex-exec', available: true, headless: true, path: node, stdinPrompt: true, args: () => ['-e', `process.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-session'}));console.log(JSON.stringify({type:'item.completed',item:{id:'reply',type:'agent_message',text:'Fixture completed the requested read-only task.'}}));console.log(JSON.stringify({type:'turn.completed'}));});`] };
let hub;
const OriginalHub = core.Hub;
core.Hub = class extends OriginalHub {
  constructor(options) { super({ ...options, home: root, historyCache: mode === 'managed' }); hub = this; }
  async init() { this.agents = [FixtureAgent]; this.scanningAgents = false; this.emit('state'); return this; }
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item)).digest('hex');
async function collect() { if (typeof global.gc !== 'function') throw new Error('Launch the diagnostic harness with --js-flags=--expose-gc.'); global.gc(); await wait(0); global.gc(); await wait(0); }
function metrics() { return { main: { ...process.memoryUsage(), physicalHeapBytes: v8.getHeapStatistics().total_physical_size }, tree: sample(process.pid) }; }
let started = false;
app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', () => {
  if (started) return; started = true;
  void (async () => {
    const timeout = Date.now() + 30000;
    while (!await window.webContents.executeJavaScript("!!document.querySelector('[aria-label=\"Chat\"]')")) { if (Date.now() > timeout) throw new Error('Fixture UI did not load'); await wait(100); }
    await wait(1000); await collect(); const baseline = metrics(); const expected = new Map(); const begin = performance.now();
    for (const thread of hub.store.data.threads) {
      const reply = await hub.send({ threadId: thread.id, agentId: 'fixture', text: 'Read this saved chat and respond.', mode: 'read' });
      if (reply.ok !== true || reply.text !== 'Fixture completed the requested read-only task.') throw new Error(`Fixture CLI turn failed: ${JSON.stringify({ok:reply.ok,error:reply.error,text:reply.text?.slice(0,160),notices:reply.notices})}`);
      hub.withHistoryOperation(() => { const live = hub.thread(thread.id); expected.set(thread.id, digest({ messages: live.messages, sessions: live.agentSessions })); });
    }
    const elapsedMs = performance.now() - begin; const idleStarted = Date.now(); await wait(1900);
    if (mode === 'managed') while (hub.histories.pins.size || hub.store.data.threads.some((thread) => hub.store.isLoaded(thread))) { if (Date.now() - idleStarted > 10000) throw new Error('Native writer owners did not settle'); await wait(100); }
    const naturalIdle = metrics(); await collect(); const retainedAfterDiagnosticGc = metrics();
    const loaded = hub.store.data.threads.filter((thread) => hub.store.isLoaded(thread)).length;
    if (loaded !== (mode === 'managed' ? 0 : 32) || hub.histories?.unmanaged.size) throw new Error('Unexpected native history owner');
    hub.store.save(true);
    const reopened = new core.SqliteStore(profile, defaults);
    try { for (const thread of reopened.data.threads) { const full = reopened.readThread(thread); if (full.messages.length !== 66 || digest({ messages: full.messages, sessions: full.agentSessions }) !== expected.get(thread.id)) throw new Error('Native durable history parity failed'); } }
    finally { reopened.close(); }
    const ui = await window.webContents.executeJavaScript("JSON.stringify({ready:!!document.querySelector('[aria-label=\"Chat\"]'),overflow:document.documentElement.scrollWidth>innerWidth})");
    const sourceFiles = ['core/history-cache.js','core/store.js','core/hub.js','core/message-delivery.js','desktop/main.js','scripts/performance/native-history-cache.cjs'];
    const report = { date: new Date().toISOString(), mode, runtime: { electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: process.arch }, mainPid: process.pid,
      fixture: 'Actual desktop window, 32 chats with 64 long saved replies/tool logs each, 32 real Hub turns through a deterministic local CLI. No external providers or inference.',
      diagnostic: { forcedMainGcAtSampleBoundaries: true, forcedRendererGc: false, productionGcChanged: false }, sourceHashes: Object.fromEntries(sourceFiles.map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../..', file))).digest('hex')])),
      baseline, naturalIdle, retainedAfterDiagnosticGc, loadedWriterHistories: loaded, exactDurableParity: true, ui: JSON.parse(ui), elapsedMs, idleWaitMs: Date.now() - idleStarted,
      limitations: ['One native run per mode; no distribution or hardware-GPU claim', 'Diagnostic main GC differs from natural application collection', 'PSS and committed heap can remain higher than live JavaScript objects'] };
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.log(`HISTORY_NATIVE ${JSON.stringify({ mode, loaded, usedHeapBytes: retainedAfterDiagnosticGc.main.heapUsed, treePssKiB: retainedAfterDiagnosticGc.tree.totals?.pssKiB, treeComplete: retainedAfterDiagnosticGc.tree.complete })}`);
    app.quit();
  })().catch((error) => { console.error(error.stack || error); process.exitCode = 1; app.quit(); });
}));
app.on('quit', () => { fs.rmSync(root, { recursive: true, force: true }); });
require('../../desktop/main');
