'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { app } = require('electron'); const { sample } = require('./app-memory.cjs');
const repo = path.resolve(__dirname, '../..'), host = process.env.TRIBUTARY_CODE_HOST || repo;
const mode = process.env.TRIBUTARY_CODE_MODE || 'baseline', output = process.env.TRIBUTARY_CODE_OUTPUT;
assert.ok(['baseline', 'viewport'].includes(mode) && output && path.isAbsolute(output));
const lineCount = Number(process.env.TRIBUTARY_CODE_LINES || 2000), blockCount = Number(process.env.TRIBUTARY_CODE_BLOCKS || 3);
assert.ok(Number.isSafeInteger(lineCount) && lineCount > 0 && Number.isSafeInteger(blockCount) && blockCount > 0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-code-viewport-')), profile = path.join(root, 'profile'), project = path.join(root, 'project');
fs.mkdirSync(project); fs.writeFileSync(path.join(project, 'README.md'), '# Code viewport fixture\n'); process.env.TRIBUTARY_DATA_DIR = profile;
const core = require('../../core'); const seed = new core.Hub({ dataDir: profile, home: root, secrets: new core.MemorySecrets() });
const thread = seed.createThread(project, 'Large code reply verification'), sources = [];
for (let i = 0; i < blockCount; i++) {
  const source = Array.from({ length: lineCount }, (_, n) => `export const item_${i}_${n} = { id: ${n}, label: "Value ${n}" };`).join('\n'); sources.push(source);
  thread.messages.push({ id: 'user-' + i, role: 'user', target: 'claude', text: `Show fixture code ${i}.`, ts: 1000 + i * 2 });
  thread.messages.push({ id: 'reply-' + i, role: 'assistant', agent: 'claude', mode: 'edit', text: 'Complete synthetic code block ' + i + ':\n\n```typescript\n' + source + '\n```', tools: [], files: [], notices: [], permissions: [], trace: [], ok: true, ts: 1001 + i * 2 });
}
seed.store.save(true); seed.fileWatches.close(); seed.store.close();
let hub;
const Base = core.Hub; core.Hub = class extends Base { constructor(...args) { super(...args); hub = this; } async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, label) => { const end = Date.now() + 45000; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + label); await delay(25); } };
const phases = [], checks = {}; let started = false;
const deadline = setTimeout(() => { console.error('Code viewport deadline'); app.exit(1); }, 180000);
app.on('browser-window-created', (_event, win) => {
  win.setSize(1280, 850); const web = win.webContents, run = code => web.executeJavaScript(code);
  const snapshot = async label => {
    const samples = [];
    for (let i = 0; i < 5; i++) {
      web.debugger.attach('1.3'); try { await web.debugger.sendCommand('Runtime.discardConsoleEntries'); await web.debugger.sendCommand('HeapProfiler.collectGarbage'); samples.push({ heap: await web.debugger.sendCommand('Runtime.getHeapUsage'), dom: await web.debugger.sendCommand('Memory.getDOMCounters') }); } finally { web.debugger.detach(); }
      samples.at(-1).processTree = sample(process.pid); await delay(100);
    }
    const rows = await run(`JSON.stringify({lines:document.querySelectorAll('[data-slot="code-block-line"]').length,viewLines:document.querySelectorAll('.code-viewport .cm-line').length,views:document.querySelectorAll('.code-viewport .cm-editor').length})`);
    phases.push({ label, rows: JSON.parse(rows), samples }); console.log('CODE_SAMPLED', label, rows);
  };
  web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.thread',${JSON.stringify(JSON.stringify(thread.id))});localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'chat',expanded:false,panel:{open:false,tab:'files'}}}));true`);
    const loaded = new Promise(resolve => web.once('did-finish-load', resolve)); web.reload(); await loaded;
    await until(() => run(`document.querySelectorAll('[data-slot="code-block"]').length===${blockCount}`), 'all code blocks');
    if (mode === 'baseline' || lineCount < 1000) await until(() => run(`document.querySelectorAll('[data-slot="code-block-line-content"] span[style]').length>${lineCount * blockCount * 5}`), 'highlighted original code');
    else await until(() => run(`document.querySelectorAll('.code-viewport .cm-line span[class]').length>10`), 'viewport syntax');
    await delay(500); await snapshot('large-code-replies');
    if (mode === 'viewport' && process.env.TRIBUTARY_CODE_VERIFY) {
      assert.equal(lineCount, 2000); assert.equal(blockCount, 3);
      const target = '[data-message-id="reply-2"]', content = target + ' .cm-content';
      const view = `document.querySelector(${JSON.stringify(content)}).cmTile.root.view`;
      const key = async keyCode => { web.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['control'] }); web.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['control'] }); await delay(75); };
      const setText = (selector, text) => run(`{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));}true`);
      const scrollChat = async position => { await run(`{const e=document.querySelector('[data-slot="message-scroller-viewport"]');e.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:1}));e.scrollTop=${position === 'end' ? 'e.scrollHeight' : '0'};e.dispatchEvent(new Event('scroll',{bubbles:true}));}true`); await delay(250); };
      assert.equal(await run(`${view}.state.doc.toString()`), sources[2]);
      await run(`${view}.focus();true`); const original = await run(`${view}.state.doc.toString()`);
      web.sendInputEvent({ type: 'char', keyCode: 'x' }); await delay(100); assert.equal(await run(`${view}.state.doc.toString()`), original);
      await key('f'); await until(() => run(`!!document.querySelector(${JSON.stringify(target + ' .cm-search')})`), 'viewer Find');
      await setText(target + ' .cm-search input[name="search"]', 'item_2_1999');
      await run(`document.querySelector(${JSON.stringify(target + ' .cm-search [name="next"]')}).click();true`); await delay(100);
      assert.equal(await run(`${view}.state.sliceDoc(${view}.state.selection.main.from,${view}.state.selection.main.to)`), 'item_2_1999');
      await run(`{const v=${view},p=v.state.doc.line(1500).from;v.dispatch({selection:{anchor:p+13,head:p+20},scrollIntoView:true});document.querySelector(${JSON.stringify(target + ' .cm-search input[name="search"]')}).setSelectionRange(2,6);}true`); await delay(200);
      const before = JSON.parse(await run(`JSON.stringify({selection:${view}.state.selection.toJSON(),scroll:${view}.scrollDOM.scrollTop,query:document.querySelector(${JSON.stringify(target + ' .cm-search input[name="search"]')}).value})`));
      // Focused or selected viewers stay alive even outside the conversation viewport.
      await scrollChat('start'); assert.equal(await run(`!!document.querySelector(${JSON.stringify(content)})`), true);
      await run(`{document.activeElement.blur();const walker=document.createTreeWalker(document.querySelector(${JSON.stringify(content)}),NodeFilter.SHOW_TEXT),node=walker.nextNode(),range=document.createRange();range.setStart(node,0);range.setEnd(node,1);window.getSelection().removeAllRanges();window.getSelection().addRange(range);}true`); await delay(200);
      assert.equal(await run(`!!document.querySelector(${JSON.stringify(content)})`), true);
      before.selection = JSON.parse(await run(`JSON.stringify(${view}.state.selection.toJSON())`));
      await run(`window.__parkedCodeView=new WeakRef(${view});${view}.__retentionProbe='CODE_VIEWER_TO_RELEASE';window.getSelection().removeAllRanges();true`);
      await until(() => run(`!document.querySelector(${JSON.stringify(content)})`), 'offscreen viewer released');
      let released = false;
      for (let n = 0; n < 10 && !released; n++) {
        await delay(100); web.debugger.attach('1.3');
        try { await web.debugger.sendCommand('Runtime.discardConsoleEntries'); await web.debugger.sendCommand('HeapProfiler.collectGarbage'); } finally { web.debugger.detach(); }
        released = await run(`window.__parkedCodeView.deref()===undefined`);
      }
      if (!released && process.env.TRIBUTARY_CODE_HEAP) {
        const fd = fs.openSync(process.env.TRIBUTARY_CODE_HEAP, 'w');
        const listener = (_event, method, params) => { if (method === 'HeapProfiler.addHeapSnapshotChunk') fs.writeSync(fd, params.chunk); };
        web.debugger.attach('1.3'); web.debugger.on('message', listener);
        try { await web.debugger.sendCommand('HeapProfiler.takeHeapSnapshot', { reportProgress: false }); } finally { web.debugger.off('message', listener); web.debugger.detach(); fs.closeSync(fd); }
      }
      assert.equal(released, true, 'Parked viewer must be unreachable, not merely absent from DOM');
      checks.fullTextReadOnlyAndFind = true; checks.focusAndNativeSelectionPinOffscreenViewer = true; checks.parkedViewBecomesUnreachable = true;
      console.log('CODE_CHECKED', 'readonly-find-and-park');

      const updated = sources[2] + '\n// streamed Unicode 😀\n' + 'x'.repeat(3000);
      const reply = hub.thread(thread.id).messages.find(m => m.id === 'reply-2');
      for (let n = 1; n <= 5; n++) { reply.text = 'Complete synthetic code block 2:\n\n```typescript\n' + updated + '\n// append ' + n + '\n```'; hub.emit('message', { threadId: thread.id, message: reply }); await delay(100); }
      let finalCode = updated + '\n// append 5';
      assert.equal(await run(`!!document.querySelector(${JSON.stringify(content)})`), false); await scrollChat('end');
      await until(() => run(`!!document.querySelector(${JSON.stringify(content)})`), 'viewer recreated'); await delay(200);
      assert.equal(await run(`${view}.state.doc.toString()`), finalCode);
      assert.deepEqual(JSON.parse(await run(`JSON.stringify(${view}.state.selection.toJSON())`)), before.selection);
      assert.equal(await run(`${view}.scrollDOM.scrollTop`), before.scroll);
      assert.equal(await run(`document.querySelector(${JSON.stringify(target + ' .cm-search input[name="search"]')}).value`), before.query);
      assert.deepEqual(JSON.parse(await run(`JSON.stringify((e=>[e.selectionStart,e.selectionEnd])(document.querySelector(${JSON.stringify(target + ' .cm-search input[name="search"]')})))`)), [2, 6]);
      checks.streamingOffscreenAndViewStateRestored = true;
      console.log('CODE_CHECKED', 'hidden-stream-and-restore');
      await run(`window.__activeCodeView=new WeakRef(${view});true`);
      finalCode += '\n// visible append 😀'; reply.text = 'Complete synthetic code block 2:\n\n```typescript\n' + finalCode + '\n```'; hub.emit('message', { threadId: thread.id, message: reply });
      await until(() => run(`${view}.state.doc.toString()===${JSON.stringify(finalCode)}`), 'active streamed append');
      assert.equal(await run(`window.__activeCodeView.deref()===${view}`), true);
      assert.deepEqual(JSON.parse(await run(`JSON.stringify(${view}.state.selection.toJSON())`)), before.selection);
      checks.activeStreamingKeepsViewAndSelection = true;
      await run(`navigator.clipboard.writeText=async value=>{window.__codeCopied=value};document.querySelector(${JSON.stringify(target + ' [data-slot="code-block-copy-button"]')}).click();true`); await delay(100);
      assert.equal(await run(`window.__codeCopied`), finalCode); checks.fullCopyPayload = true;
      console.log('CODE_CHECKED', 'full-copy');
      const toggle = `${target} [data-slot="code-block-header"] button[aria-pressed]`;
      await run(`document.querySelector(${JSON.stringify(toggle)}).click();true`);
      await until(() => run(`!!document.querySelector(${JSON.stringify(target + ' [aria-label="Full code text"]')})`), 'plain text');
      assert.equal(await run(`document.querySelector(${JSON.stringify(target + ' [aria-label="Full code text"]')}).textContent`), finalCode);
      // Electron's host found-in-page event does not arrive even on a minimal
      // data: page in this runtime. Exercise Chromium's renderer-native text
      // search directly; do not count an unobserved host API as passing.
      assert.equal(await run(`window.find('item_2_1999',false,false,true)`), true);
      assert.equal(await run(`window.getSelection().toString()`), 'item_2_1999');
      console.log('CODE_CHECKED', 'plain-text');
      await run(`window.getSelection().removeAllRanges();true`);
      await run(`document.querySelector(${JSON.stringify(toggle)}).click();true`); await until(() => run(`!!document.querySelector(${JSON.stringify(content)})`), 'syntax return');
      assert.deepEqual(JSON.parse(await run(`JSON.stringify(${view}.state.selection.toJSON())`)), before.selection);
      assert.equal(await run(`document.querySelector(${JSON.stringify(target + ' .cm-search input[name="search"]')}).value`), before.query);
      checks.plainTextAndBrowserFind = true;
      assert.ok(await run(`document.querySelectorAll('.code-viewport .cm-line').length`) < 300);
      checks.viewportRowsRemainBounded = true;
      const smallSource = sources[0].split('\n').slice(0, 20).join('\n');
      const small = { id: 'reply-small', role: 'assistant', agent: 'claude', text: '```typescript\n' + smallSource + '\n```', tools: [], files: [], notices: [], permissions: [], trace: [], ok: true, ts: 2000 };
      hub.thread(thread.id).messages.push(small); hub.emit('message', { threadId: thread.id, message: small }); await scrollChat('end');
      const smallTarget = '[data-message-id="reply-small"]';
      await until(() => run(`!!document.querySelector(${JSON.stringify(smallTarget + ' [data-slot="code-block-line-content"] span[style]')})`), 'small highlighted code');
      const selectedText = await run(`(()=>{const node=document.createTreeWalker(document.querySelector(${JSON.stringify(smallTarget + ' [data-slot="code-block-content"]')}),NodeFilter.SHOW_TEXT).nextNode(),range=document.createRange();range.selectNodeContents(node);window.getSelection().removeAllRanges();window.getSelection().addRange(range);return window.getSelection().toString()})()`);
      small.text = '```typescript\n' + sources[0] + '\n```'; hub.emit('message', { threadId: thread.id, message: small }); await delay(300);
      assert.equal(await run(`!!document.querySelector(${JSON.stringify(smallTarget + ' .code-viewport')})`), false);
      assert.equal(await run(`window.getSelection().toString()`), selectedText);
      await run(`window.getSelection().removeAllRanges();true`);
      await until(() => run(`!!document.querySelector(${JSON.stringify(smallTarget + ' .code-viewport .cm-content')})`), 'safe threshold upgrade');
      await until(() => run(`!!document.querySelector(${JSON.stringify(smallTarget + ' .code-viewport .cm-line')})`), 'upgraded code drawn'); await delay(100);
      checks.thresholdUpgradePreservesNativeSelection = true;
      fs.writeFileSync(output + '.desktop.png', (await web.capturePage()).toPNG());
      win.setMinimumSize(300, 400); win.setSize(390, 850); await delay(250);
      assert.equal(await run(`document.documentElement.scrollWidth<=innerWidth`), true);
      fs.writeFileSync(output + '.narrow.png', (await web.capturePage()).toPNG()); checks.narrow390NoPageOverflow = true;
      // Expanded non-command tool output uses the same component with wrapping.
      win.setSize(1280, 850);
      const wrappedCode = 'word '.repeat(800) + '\n' + Array.from({ length: 1100 }, (_, n) => 'plain tool line ' + n).join('\n');
      const wrapped = { ...small, id: 'reply-wrapped', text: 'Wrapped tool fixture.', tools: [{ name: 'read_file', input: { path: 'README.md' }, status: 'done', output: wrappedCode }], trace: [{ kind: 'tool', textOffset: 0, toolIndex: 0 }] };
      hub.thread(thread.id).messages.push(wrapped); hub.emit('message', { threadId: thread.id, message: wrapped }); await scrollChat('end');
      const wrappedTarget = '[data-message-id="reply-wrapped"]';
      await until(() => run(`!!document.querySelector(${JSON.stringify(wrappedTarget + ' .reply-activity button')})`), 'wrapped activity');
      await run(`document.querySelector(${JSON.stringify(wrappedTarget + ' .reply-activity button')}).click();true`);
      await until(() => run(`!!document.querySelector(${JSON.stringify(wrappedTarget + ' button[aria-label^="Show details:"]')})`), 'wrapped details');
      await run(`document.querySelector(${JSON.stringify(wrappedTarget + ' button[aria-label^="Show details:"]')}).click();true`); await scrollChat('end');
      await until(() => run(`!!document.querySelector(${JSON.stringify(wrappedTarget + ' .code-viewport .cm-line')})`), 'wrapped code viewport');
      assert.equal(await run(`document.querySelector(${JSON.stringify(wrappedTarget + ' .cm-content')}).cmTile.root.view.state.doc.toString()`), wrappedCode);
      assert.equal(await run(`document.querySelector(${JSON.stringify(wrappedTarget + ' .cm-content')}).classList.contains('cm-lineWrapping')`), true);
      checks.wrappedPlainToolOutputKeepsFullText = true;
      const ansi = '\x1b[31mred\x1b[0m\n'.repeat(1100).trimEnd();
      small.text = '```ansi\n' + ansi + '\n```'; hub.emit('message', { threadId: thread.id, message: small });
      await until(() => run(`!document.querySelector(${JSON.stringify(smallTarget + ' .code-viewport')})&&document.querySelectorAll(${JSON.stringify(smallTarget + ' [data-slot="code-block-line-content"] span[style]')}).length>1000`), 'changed language keeps ANSI parser');
      assert.equal(await run(`document.querySelector(${JSON.stringify(smallTarget + ' [data-slot="code-block-content"]')}).textContent.includes('\\x1b')`), false);
      checks.changingLanguageRestoresAnsiRenderer = true;
    }
    fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), mode, workload: { blockCount, lineCount }, phases, checks, runtime: process.versions, uiSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(host, 'ui/dist/assets/app.js'))).digest('hex'), scope: 'Linux Electron source app; saved synthetic TypeScript replies. Actual Markdown/code rendering. Agent discovery disabled. Five samples after renderer diagnostic GC; not normal peaks, provider latency or model/VRAM memory. Copy verification captures the writeText payload; it does not overwrite the system clipboard.' }, null, 2) + '\n');
    clearTimeout(deadline); app.quit();
  })().catch(error => { console.error(error.stack); app.exit(1); }); });
});
app.on('quit', () => fs.rmSync(root, { recursive: true, force: true })); require(path.join(host, 'desktop/main.js'));
