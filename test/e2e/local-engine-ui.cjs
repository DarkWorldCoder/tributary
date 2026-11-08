'use strict';
// Source Electron UI, actual Hub/guardian, synthetic authenticated model API.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { app, dialog } = require('electron'), core = require('../../core'), { discover } = require('../../core/local-models');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-engine-ui-')), project = path.join(root, 'project'), profile = path.join(root, 'profile'), binary = path.join(root, 'fake-llama-server'), model = path.join(root, 'model.gguf');
const output = process.env.TRIBUTARY_ENGINE_UI_OUTPUT || '/tmp/tributary-engine-ui.json';
fs.mkdirSync(project); fs.writeFileSync(path.join(project, 'README.md'), '# Engine UI fixture\n'); fs.writeFileSync(model, 'GGUF\x03\0\0\0');
fs.writeFileSync(binary, '#!' + process.execPath + '\nprocess.env.FAKE_ENGINE_IDLE_MS="1000";process.env.FAKE_ENGINE_MODE=require("node:fs").existsSync(' + JSON.stringify(path.join(root, 'hang')) + ')?"hang":"";require(' + JSON.stringify(path.resolve(__dirname, '../fake-local-engine.cjs')) + ');\n', { mode: 0o755 });
process.env.TRIBUTARY_DATA_DIR = profile;
const seed = new core.Hub({ dataDir: profile, home: root, secrets: new core.MemorySecrets() }); seed.createThread(project, 'Local engine UI'); seed.fileWatches.close(); seed.store.close();
dialog.showOpenDialog = async (...args) => ({ canceled: false, filePaths: [args.at(-1).title.includes('GGUF') ? model : binary] });
let hub; const Base = core.Hub;
core.Hub = class extends Base {
  constructor(...args) { super(...args); hub = this; }
  async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; }
  async localModelServices() {
    const result = await discover({ fetchImpl: async () => { throw Error('Isolated external services'); } }); result.engine = await this.localEngineState();
    if (this._localEngine?.child) result.services = await Promise.all(result.services.map(row => row.id === 'llamacpp' ? this.inspectLocalModels({ service: 'llamacpp', baseUrl: this._localEngine.baseUrl }) : row)); return result;
  }
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, name) => { const end = Date.now() + 20000; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + name); await delay(25); } };
let started = false, finalPids, web; const checks = [], deadline = setTimeout(() => { console.error('Engine UI deadline'); hub?._localEngine?.killNow(); app.exit(1); }, 120000);
app.on('browser-window-created', (_event, win) => {
  win.setSize(1280, 850); web = win.webContents; const run = code => web.executeJavaScript(code);
  const click = async text => { await run(`{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Missing '+${JSON.stringify(text)});e.scrollIntoView({block:'center'});e.click();}true`); };
  const setup = async () => {
    await run(`{const e=[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')==='Settings'||e.textContent.trim().startsWith('Settings'));e.click();}true`);
    await until(() => run(`!![...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Connections')`), 'settings'); await click('Connections');
    await until(() => run(`!![...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Set up local models')`), 'local setup'); await click('Set up local models');
    await until(() => run(`!!document.querySelector('[aria-label="Local model service"]')`), 'service list');
    await run(`[...document.querySelectorAll('[aria-label="Local model service"] button')].find(e=>e.textContent.startsWith('llama.cpp')).click();true`);
    await until(() => run(`!!document.querySelector('[aria-label="App-managed CPU engine"]')`), 'engine controls');
  };
  const shot = async name => { await run(`document.querySelector('[aria-label="App-managed CPU engine"]').scrollIntoView({block:'center'});true`); await delay(150); fs.writeFileSync(output + '.' + name + '.png', (await web.capturePage()).toPNG()); };
  web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
    await until(() => run(`!!document.querySelector('button')`), 'app'); await setup();
    assert.equal(await run(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Start engine').disabled`), true);
    await run(`document.querySelector('[aria-label="Choose llama-server executable"]').click();true`); await until(() => run(`document.querySelector('#engine-server').value===${JSON.stringify(binary)}`), 'chosen executable');
    await run(`document.querySelector('[aria-label="Choose GGUF model file"]').click();true`); await until(() => run(`document.querySelector('#engine-model').value===${JSON.stringify(model)}`), 'chosen model');
    await shot('stopped'); await click('Start engine');
    await until(() => run(`!![...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Stop engine'&&!e.disabled)`), 'engine running');
    assert.equal(hub.localEngine.child.backend, 'native', 'This gate must use the built native owner, not silently fall back.');
    assert.equal(await run(`document.querySelector('#local-model-key').disabled && document.querySelector('#local-model-key').value===''`), true);
    assert.equal(await run(`document.querySelector('#local-parallel-requests').disabled && document.querySelector('#local-parallel-requests').value==='1'`), true);
    await until(() => run(`document.querySelector('[aria-label="App-managed CPU engine"]').textContent.includes('Sleeping')`), 'idle status'); await shot('sleeping');
    checks.push('File chooser results, checked native ownership, private managed credentials and metadata-only sleep status use the real desktop bridge');
    win.setMinimumSize(300, 400); win.setSize(390, 850); await delay(200); assert.equal(await run(`document.documentElement.scrollWidth<=innerWidth`), true); await shot('narrow'); win.setSize(1280, 850);
    await click('Start local chat'); await until(() => run(`!!document.querySelector('textarea[aria-label="Message"]')`), 'chat composer');
    win.focus(); web.focus(); await run(`{const e=document.querySelector('textarea[aria-label="Message"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Hello owned local model');e.dispatchEvent(new Event('input',{bubbles:true}));e.focus();}true`);
    await until(() => run(`!!document.querySelector('button[aria-label="Send"]:not(:disabled)')`), 'send enabled after input');
    await run(`document.querySelector('button[aria-label="Send"]:not(:disabled)').click();true`);
    await until(() => run(`[...document.querySelectorAll('.prose-reply')].some(e=>e.textContent.includes('Connected'))`), 'streamed local response');
    const id = hub.store.data.gateways.find(g => g.managedLocal).id, firstPids = [hub.localEngine.child.pid, hub.localEngine.child.runtimePid];
    checks.push('Start local chat creates the owned profile and a real streamed authenticated response renders');
    await setup(); await click('Stop engine'); await until(() => !hub.localEngine.child, 'engine stopped');
    for (const pid of firstPids) assert.throws(() => process.kill(pid, 0));
    await until(() => run(`!![...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Start engine'&&!e.disabled)`), 'restart enabled');
    fs.writeFileSync(path.join(root, 'hang'), '1'); await click('Start engine');
    await until(() => hub.localEngine.status === 'starting' && hub.localEngine.child?.runtimePid, 'hung startup is owned');
    const cancelledPids = [hub.localEngine.child.pid, hub.localEngine.child.runtimePid]; await click('Cancel startup');
    await until(() => !hub.localEngine.child && hub.localEngine.status === 'stopped', 'startup cancelled');
    await until(() => run(`!![...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Start engine'&&!e.disabled)`), 'cancelled UI settles');
    for (const pid of cancelledPids) assert.throws(() => process.kill(pid, 0)); fs.unlinkSync(path.join(root, 'hang'));
    checks.push('Cancel startup wins the pending UI request and reaps a deliberately hung native child');
    await click('Start engine');
    await until(() => hub.localEngine.child?.runtimePid && hub.localEngine.status === 'ready', 'restarted runtime');
    await until(() => run(`!![...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Stop engine'&&!e.disabled)`), 'restart bridge completed');
    assert.equal(hub.store.data.gateways.filter(g => g.managedLocal).length, 1); assert.equal(hub.store.data.gateways.find(g => g.managedLocal).id, id);
    checks.push('Stop reaps both processes; restart rebinds the existing profile without duplicates');
    finalPids = [hub.localEngine.child.pid, hub.localEngine.child.runtimePid]; app.quit();
  })().catch(async error => { console.error(error.stack); try { fs.writeFileSync(output + '.failure.png', (await web.capturePage()).toPNG()); } catch {} hub?._localEngine?.killNow(); app.exit(1); }); });
});
app.on('quit', () => {
  if (finalPids) { for (const pid of finalPids) assert.throws(() => process.kill(pid, 0)); checks.push('Ordinary app quit waits for the owned runtime and guardian to exit'); fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), passed: true, checks, scope: 'Linux source Electron; actual Hub, local HTTP streaming and IPC guardian, synthetic model runtime with accelerated idle clock. Native file chooser return values controlled. Native CPU weights/memory tested separately; no provider, installer or Windows/macOS UI claim.' }, null, 2) + '\n'); console.log(JSON.stringify({ passed: true, checks })); }
  clearTimeout(deadline); fs.rmSync(root, { recursive: true, force: true });
});
require('../../desktop/main.js');
