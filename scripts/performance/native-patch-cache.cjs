'use strict';
// Cache pressure through the real desktop, using only a disposable profile.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { app } = require('electron');
const repo = path.resolve(__dirname, '../..'), output = process.env.TRIBUTARY_PATCH_CACHE_OUTPUT;
if (!output || !path.isAbsolute(output)) throw Error('Set an absolute TRIBUTARY_PATCH_CACHE_OUTPUT path.');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-patch-native-')), profile = path.join(root, 'profile'), project = path.join(root, 'project');
fs.mkdirSync(project); fs.writeFileSync(path.join(project, 'README.md'), '# Cache verification\n');
process.env.TRIBUTARY_DATA_DIR = profile;
const core = require(path.join(repo, 'core'));
const seed = new core.SqliteStore(profile, { version: 1, projects: [{ path: project, name: 'Cache verification', trusted: true }], threads: [], gateways: [], notifications: [], settings: { mode: 'read' } });
seed.data.projects = [{ path: project, name: 'Cache verification', trusted: true }]; seed.save(true); seed.close();
const patchModule = require(path.join(repo, 'core/message-patch')), create = patchModule.createPatcher, patchers = [];
patchModule.createPatcher = (...args) => { const value = create(...args); patchers.push(value); return value; };
const Base = core.Hub; let hub;
core.Hub = class extends Base { constructor(...args) { super(...args); hub = this; } async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; } };
let transport; const controller = require(path.join(repo, 'desktop/message-transport')), createTransport = controller.createMessageTransport;
controller.createMessageTransport = options => (transport = createTransport(options));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, label) => { for (let i = 0; i < 600; i++) { if (await fn()) return; await delay(20); } throw Error('Timed out: ' + label); };
let started = false, phase = 'setup'; const packets = [];
const deadline = setTimeout(() => { console.error('Native cache fixture deadline exceeded'); app.exit(1); }, 60000);
app.on('browser-window-created', (_event, win) => {
  const web = win.webContents, send = web.send.bind(web);
  web.send = (channel, ...args) => { if (channel === 'hub-message') packets.push({ phase, name: args[0], id: args[1].id || args[1].message?.id, bytes: Buffer.byteLength(JSON.stringify(args[1])) }); return send(channel, ...args); };
  web.on('console-message', event => { if (event.level === 'error') console.error('RENDERER', event.message); });
  web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
    const run = code => web.executeJavaScript(code);
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});true`);
    const loaded = new Promise(resolve => web.once('did-finish-load', resolve)); web.reload(); await loaded;
    await until(() => run(`!!window.hub && !!document.querySelector('[aria-label="Search commands and chats"]')`), 'app ready');
    const thread = hub.withHistoryOperation(() => hub.createThread(project, 'Cache fixture'));
    await until(() => run(`!!document.querySelector('[title="Cache fixture"]')`), 'thread listed');
    await run(`document.querySelector('[title="Cache fixture"]').click()`); await delay(200);
    await run(`(async()=>{window.__cacheReceived=new Map();const {applyPatch}=await import(${JSON.stringify(pathToFileURL(path.join(repo, 'ui/src/lib/message-patch.mjs')).href)});window.hub.on('message',d=>window.__cacheReceived.set(d.message.id,d.message));window.hub.on('message-patch',d=>window.__cacheReceived.set(d.id,applyPatch(window.__cacheReceived.get(d.id),d.patch)));return true})()`);
    await until(() => transport.state().ready, 'transport ready');
    const count = 80, messages = Array.from({ length: count }, (_, i) => ({ id: 'cache-' + i, role: 'assistant', agent: 'fixture', mode: 'read', kind: 'chat', text: 'Initial ' + i, thinking: '', tools: [{ id: 'tool-' + i, name: 'Read', input: { file_path: project + '/README.md' }, status: 'done', output: crypto.randomBytes(49152).toString('base64') + (i % 4 === 0 ? '\0\ud800🌍नमस्ते\n' : '') }], files: [], trace: [], permissions: [], notices: [], ok: null, ts: Date.now() }));
    const emit = name => hub.withHistoryOperation(() => { const t = hub.thread(thread.id); for (const message of messages) hub.emit(name, { threadId: t.id, message }); });
    const drained = () => hub.histories.pins.size === 0 && transport.state().active === 0;
    const exact = async () => {
      const actual = await run(`JSON.stringify(Array.from({length:${count}},(_,i)=>window.__cacheReceived.get('cache-'+i)))`);
      assert.equal(actual, JSON.stringify(messages)); return crypto.createHash('sha256').update(actual).digest('hex');
    };
    hub.withHistoryOperation(() => { hub.thread(thread.id).messages.push(...messages); hub.store.save(true); });
    phase = 'initial'; emit('message'); await until(drained, 'initial delivery'); await exact();
    const initialCache = patchers.at(-1).stats(); assert.equal(initialCache.entries, 64); assert.ok(initialCache.accountedBytes <= initialCache.maxBytes);
    phase = 'pressure'; for (const m of messages) { m.text += ' latest'; m.permissions = [{ id: 'p', state: 'allowed' }]; }
    emit('event'); await delay(100); await until(drained, 'pressure delivery'); await exact();
    assert.ok(packets.some(p => p.phase === 'pressure' && p.name === 'message'), 'evicted bases must fall back to full');
    phase = 'hot'; const hot = messages.at(-1); hot.text += ' HOT_PATCH'; hot.tools[0].output += ' LIVE_OUTPUT_🌍\n'; hub.emit('event', { threadId: thread.id, message: hot }); await delay(100); await until(drained, 'hot delta'); await exact();
    assert.ok(packets.some(p => p.phase === 'hot' && p.name === 'message-patch'));
    phase = 'final'; for (const m of messages) { m.ok = true; m.text += ' CACHE_FINAL_' + m.id; }
    emit('message'); hub.store.save(true); await until(drained, 'final delivery'); const finalDigest = await exact();
    await until(() => run(`document.body.textContent.includes('CACHE_FINAL_cache-79')`), 'rendered final');
    const finalCache = patchers.at(-1).stats(); assert.equal(finalCache.entries, 0); assert.equal(finalCache.accountedBytes, 0);
    const report = { date: new Date().toISOString(), replyCount: count, initialCache, finalCache, everyPhaseExact: true, hotDeltaUsed: true, finalDigest, historyPins: hub.histories.pins.size, transportActive: transport.state().active, packets, runtime: process.versions, scope: 'Synthetic 80-reply cache pressure through actual desktop/preload/renderer. Exact live/final reconstruction, full fallback and hot deltas; no provider requests or app-RAM measurement.', sourceHashes: Object.fromEntries(['core/message-patch.js', 'core/message-delivery.js', 'desktop/main.js', 'desktop/preload.js', 'ui/dist/assets/app.js', 'scripts/performance/native-patch-cache.cjs'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')])) };
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ initialCache, finalCache, finalDigest, packets: packets.length })); clearTimeout(deadline); app.quit();
  })().catch(error => { console.error(error.stack); app.exit(1); }); });
});
app.on('quit', () => fs.rmSync(root, { recursive: true, force: true })); require(path.join(repo, 'desktop/main.js'));
