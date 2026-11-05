'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { app } = require('electron'), { sample } = require('./app-memory.cjs');
const repo = path.resolve(__dirname, '../..'), host = process.env.TRIBUTARY_MARKDOWN_HOST || repo;
const output = process.env.TRIBUTARY_MARKDOWN_OUTPUT, workload = process.env.TRIBUTARY_MARKDOWN_WORKLOAD || 'stream';
assert.ok(output && path.isAbsolute(output)); assert.ok(['stream', 'cold', 'small'].includes(workload));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-markdown-stream-')), profile = path.join(root, 'profile'), project = path.join(root, 'project');
fs.mkdirSync(project); fs.writeFileSync(path.join(project, 'README.md'), '# Markdown streaming fixture\n'); process.env.TRIBUTARY_DATA_DIR = profile;
const core = require('../../core'), seed = new core.Hub({ dataDir: profile, home: root, secrets: new core.MemorySecrets() });
const thread = seed.createThread(project, 'Markdown streaming fixture');
const count = workload === 'small' ? 12 : 300, start = workload === 'cold' ? count : workload === 'small' ? 1 : 20;
const paragraphs = Array.from({ length: count }, (_, n) => `Paragraph ${n}: ` + (workload === 'small' ? 'short text ' : 'steady plain text ').repeat(workload === 'small' ? 4 : 50) + ` END_${n}`);
const content = n => paragraphs.slice(0, n).join('\n\n');
thread.messages.push({ id: 'request', role: 'user', target: 'claude', text: 'Show the fixture paragraphs.', ts: 1000 });
thread.messages.push({ id: 'reply', role: 'assistant', agent: 'claude', mode: 'edit', text: content(start), tools: [], files: [], notices: [], permissions: [], trace: [], ok: true, ts: 1001 });
seed.store.save(true); seed.fileWatches.close(); seed.store.close();
let hub; const Base = core.Hub;
core.Hub = class extends Base { constructor(...args) { super(...args); hub = this; } async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, label) => { const end = Date.now() + 45000; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + label); await delay(10); } };
const phases = [], checks = {}, deliveries = []; let started = false;
const deadline = setTimeout(() => { console.error('Markdown fixture deadline'); app.exit(1); }, 240000);
app.on('browser-window-created', (_event, win) => {
  win.setSize(1280, 850); const web = win.webContents, run = code => web.executeJavaScript(code);
  const snapshot = async label => {
    const samples = [];
    for (let n = 0; n < 5; n++) {
      web.debugger.attach('1.3');
      try { await web.debugger.sendCommand('Runtime.discardConsoleEntries'); await web.debugger.sendCommand('HeapProfiler.collectGarbage'); samples.push({ heap: await web.debugger.sendCommand('Runtime.getHeapUsage'), dom: await web.debugger.sendCommand('Memory.getDOMCounters') }); }
      finally { web.debugger.detach(); }
      samples.at(-1).processTree = sample(process.pid); await delay(100);
    }
    phases.push({ label, samples });
  };
  web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.thread',${JSON.stringify(JSON.stringify(thread.id))});localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'chat',expanded:false,panel:{open:false,tab:'files'}}}));true`);
    const loaded = new Promise(resolve => web.once('did-finish-load', resolve)); web.reload(); await loaded;
    const selector = '[data-message-id="reply"] .prose-reply';
    await until(() => run(`document.querySelector(${JSON.stringify(selector)})?.textContent.endsWith('END_${start - 1}')`), 'initial Markdown');
    // Hold only a WeakRef, not the source string or React tree, in the renderer.
    await run(`window.__firstParagraph=new WeakRef(document.querySelector(${JSON.stringify(selector + ' p')}));true`);
    await delay(300); await snapshot('initial');
    const reply = hub.thread(thread.id).messages.find(message => message.id === 'reply');
    for (let n = start + 1; n <= count; n++) {
      const began = performance.now(); reply.text = content(n); hub.emit('message', { threadId: thread.id, message: reply });
      // Observe every committed input; transport coalescing must not turn the
      // history-retention workload into a single cold final render.
      await until(() => run(`document.querySelector(${JSON.stringify(selector)})?.textContent.endsWith('END_${n - 1}')`), 'committed paragraph ' + n);
      deliveries.push(performance.now() - began);
    }
    // A single ReactMarkdown tree inserts inter-paragraph newline text nodes;
    // separate legacy blocks do not. Compare every paragraph and its order,
    // preserving its full text without mistaking that DOM whitespace for data.
    const rendered = await run(`[...document.querySelectorAll(${JSON.stringify(selector + ' p')})].map(p=>p.textContent)`);
    assert.deepEqual(rendered, paragraphs);
    assert.equal(await run(`window.__firstParagraph.deref()===document.querySelector(${JSON.stringify(selector + ' p')})`), true);
    checks.exactParagraphTextAndStableFirstNode = true;
    await delay(500); await snapshot('final');
    if (process.env.TRIBUTARY_MARKDOWN_HEAP) {
      const fd = fs.openSync(process.env.TRIBUTARY_MARKDOWN_HEAP, 'w');
      const listener = (_event, method, params) => { if (method === 'HeapProfiler.addHeapSnapshotChunk') fs.writeSync(fd, params.chunk); };
      web.debugger.attach('1.3'); web.debugger.on('message', listener);
      try { await web.debugger.sendCommand('HeapProfiler.takeHeapSnapshot', { reportProgress: false }); }
      finally { web.debugger.off('message', listener); web.debugger.detach(); fs.closeSync(fd); }
    }
    if (process.env.TRIBUTARY_MARKDOWN_VERIFY) {
      const code = Array.from({ length: 1100 }, (_, n) => `export const value_${n} = ${n};`).join('\n');
      const prefix = Array.from({ length: 63 }, (_, n) => `Stable paragraph ${n}.\n\n`).join('');
      const groupReply = { ...reply, id: 'group-reply', text: prefix + '```typescript\n' + code + '\n```' };
      hub.thread(thread.id).messages.push(groupReply); hub.emit('message', { threadId: thread.id, message: groupReply });
      const target = '[data-message-id="group-reply"]', codeSelector = target + ' .cm-content';
      await until(() => run(`!!document.querySelector(${JSON.stringify(target)})`), 'group reply');
      await run(`document.querySelector(${JSON.stringify(target)}).scrollIntoView({block:'end'});true`);
      await until(() => run(`!!document.querySelector(${JSON.stringify(codeSelector)})`), 'group code viewer');
      const view = `document.querySelector(${JSON.stringify(codeSelector)}).cmTile.root.view`;
      win.focus(); web.focus(); await until(() => run(`document.hasFocus()`), 'native focus');
      await run(`${view}.focus();window.__groupView=new WeakRef(${view});true`);
      web.sendInputEvent({ type: 'keyDown', keyCode: 'f', modifiers: ['control'] }); web.sendInputEvent({ type: 'keyUp', keyCode: 'f', modifiers: ['control'] });
      await until(() => run(`!!document.querySelector(${JSON.stringify(target + ' .cm-search input[name="search"]')})`), 'group Find');
      await run(`{const e=document.querySelector(${JSON.stringify(target + ' .cm-search input[name="search"]')});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'value_1099');e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector(${JSON.stringify(target + ' .cm-search [name="next"]')}).click();e.focus();e.setSelectionRange(2,7);}true`);
      const selection = await run(`JSON.stringify(${view}.state.selection.toJSON())`);
      // Code at block 63 first completes a 64-block group, then the reply
      // crosses the next group boundary while the viewer remains interactive.
      for (const extra of [1, 2, 64, 65, 130]) {
        groupReply.text = prefix + '```typescript\n' + code + '\n```\n\n' + Array.from({ length: extra }, (_, n) => `Appended paragraph ${n}.`).join('\n\n');
        hub.emit('message', { threadId: thread.id, message: groupReply });
        await until(() => run(`document.querySelector(${JSON.stringify(target + ' .prose-reply')})?.textContent.endsWith('Appended paragraph ${extra - 1}.')`), 'group append ' + extra);
        assert.equal(await run(`window.__groupView.deref()===${view}`), true);
        assert.equal(await run(`JSON.stringify(${view}.state.selection.toJSON())`), selection);
        assert.equal(await run(`document.querySelector(${JSON.stringify(target + ' .cm-search input[name="search"]')}).value`), 'value_1099');
        assert.deepEqual(await run(`(e=>[e.selectionStart,e.selectionEnd])(document.querySelector(${JSON.stringify(target + ' .cm-search input[name="search"]')}))`), [2, 7]);
      }
      assert.equal(await run(`${view}.state.doc.toString()`), code);
      checks.codeViewFindAndSelectionSurviveGroupBoundaries = true;
      fs.writeFileSync(output + '.png', (await web.capturePage()).toPNG());
    }
    const uiRoot = path.join(host, 'ui/dist'), fingerprint = crypto.createHash('sha256');
    for (const file of fs.readdirSync(uiRoot, { recursive: true }).filter(file => fs.statSync(path.join(uiRoot, file)).isFile()).sort()) fingerprint.update(file + '\0').update(fs.readFileSync(path.join(uiRoot, file)));
    fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), workload: { name: workload, paragraphs: count, initial: start, utf16Units: content(count).length, deliveredUpdates: deliveries.length }, phases, deliveries, checks, uiBuildSha256: fingerprint.digest('hex'),
      runtime: process.versions, uiSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(host, 'ui/dist/assets/app.js'))).digest('hex'),
      scope: 'Actual Linux Electron chat/Markdown rendering with temporary project and saved synthetic paragraphs; every update observed committed. Providers disabled. Five post-diagnostic-renderer-GC samples per phase; retention, not normal peaks/GC pauses. Delivery observations include polling/IPC and are not isolated rendering latency. Model RAM/VRAM and external display server excluded. Fixture exits explicitly after writing all results; ordinary application shutdown is not tested.' }, null, 2) + '\n');
    console.log(JSON.stringify({ passed: true, workload, checks })); clearTimeout(deadline);
    // A headless native quit occasionally waits after every measurement and
    // assertion has completed. Shutdown is not this fixture's measurement;
    // force only the disposable process to exit after its results are durable.
    app.exit(0);
  })().catch(error => { console.error(error.stack); app.exit(1); }); });
});
app.on('quit', () => fs.rmSync(root, { recursive: true, force: true })); require(path.join(host, 'desktop/main.js'));
