'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { app } = require('electron'), { sample } = require('./app-memory.cjs');
const repo = path.resolve(__dirname, '../..'), host = process.env.TRIBUTARY_TRANSCRIPT_HOST || repo, output = process.env.TRIBUTARY_TRANSCRIPT_OUTPUT;
const count = Number(process.env.TRIBUTARY_TRANSCRIPT_COUNT || 60), verify = process.env.TRIBUTARY_TRANSCRIPT_VERIFY === '1';
assert.ok(output && path.isAbsolute(output)); assert.ok([4, 60].includes(count));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-transcript-')), profile = path.join(root, 'profile'), project = path.join(root, 'project');
fs.mkdirSync(project); fs.writeFileSync(path.join(project, 'README.md'), '# Transcript memory fixture\n'); process.env.TRIBUTARY_DATA_DIR = profile;
const core = require('../../core'), seed = new core.Hub({ dataDir: profile, home: root, secrets: new core.MemorySecrets() });
const thread = seed.createThread(project, 'Historical reply lifetime'); const bodies = [];
for (let n = 0; n < count; n++) {
  const code = Array.from({ length: count === 4 ? 3 : n === 0 ? 1200 : n % 4 === 0 ? 120 : 12 }, (_, i) => `export const item_${n}_${i} = ${i};`).join('\n');
  const text = `## Reply ${n}\n\n` + Array.from({ length: count === 4 ? 2 : 30 }, (_, i) => `Paragraph ${n}:${i}. **Important text** and an [ordinary link](https://example.com/${n}/${i}) with \`inline_code\`. ` + 'Read the project and preserve its existing behavior. '.repeat(2)).join('\n\n') + `\n\n| Item | Status |\n| --- | --- |\n| ${n} | checked |\n\n\`\`\`typescript\n${code}\n\`\`\`\n\nTRANSCRIPT_END_${n}`;
  bodies.push(text); thread.messages.push({ id: 'user-' + n, role: 'user', target: 'claude', text: 'Explain fixture ' + n, ts: 1000 + n * 2 });
  thread.messages.push({ id: 'reply-' + n, role: 'assistant', agent: 'claude', mode: 'edit', text, tools: [], files: [], notices: [], permissions: [], trace: [], ok: true, ts: 1001 + n * 2 });
}
seed.store.save(true); seed.fileWatches.close(); seed.store.close(); let hub; const Base = core.Hub;
core.Hub = class extends Base { constructor(...args) { super(...args); hub = this; } async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; } };
const updates = require(path.join(host, 'desktop/updates')), BaseUpdates = updates.AppUpdates;
updates.AppUpdates = class extends BaseUpdates { async init() { await super.init(); clearTimeout(this.startTimer); clearInterval(this.interval); } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, label, timeout = 45000) => { const end = Date.now() + timeout; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + label); await delay(25); } };
const phases = [], checks = {}, rejectedSamples = []; let started = false;
const deadline = setTimeout(() => { console.error('Transcript fixture deadline'); app.exit(1); }, 180000);
app.on('browser-window-created', (_event, win) => {
  win.setSize(1280, 850); const web = win.webContents, run = code => web.executeJavaScript(code);
  const selector = n => `[data-message-id="reply-${n}"]`;
  const snapshot = async label => {
    const observations = [];
    for (let attempt = 0; observations.length < 5 && attempt < 20; attempt++) {
      const tree = sample(process.pid); if (!tree.complete) { rejectedSamples.push({label,stage:'before-collection',attempt,tree}); await delay(100); continue; }
      observations.push({ heap: await web.debugger.sendCommand('Runtime.getHeapUsage'), dom: await web.debugger.sendCommand('Memory.getDOMCounters'), tree }); await delay(100);
    }
    assert.equal(observations.length,5);
    // Retention diagnostic only. Never used for natural-heap/latency claims.
    await web.debugger.sendCommand('HeapProfiler.collectGarbage');
    await delay(50); let tree;
    for (let attempt=0;attempt<20;attempt++) { tree=sample(process.pid); if(tree.complete)break;rejectedSamples.push({label,stage:'after-collection',attempt,tree});await delay(100); }
    assert.equal(tree.complete,true);
    const retained = { heap: await web.debugger.sendCommand('Runtime.getHeapUsage'), dom: await web.debugger.sendCommand('Memory.getDOMCounters'), tree };
    phases.push({ label, observations, retained, mounted: await run(`document.querySelectorAll('[data-transcript-body="rich"]').length`), parked: await run(`document.querySelectorAll('[data-transcript-body="parked"]').length`) });
    console.log(JSON.stringify({ boundary: label, retainedHeapBytes: retained.heap.usedSize, nodes: retained.dom.nodes }));
  };
  const reveal = async n => {
    await run(`document.querySelector(${JSON.stringify(selector(n))}).scrollIntoView({block:'start'});true`);
    await until(() => run(`document.querySelector(${JSON.stringify(selector(n) + ' .prose-reply')})?.textContent.endsWith('TRANSCRIPT_END_${n}')`), 'full reply ' + n);
    await delay(150);
  };
  web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
    if (process.env.TRIBUTARY_TRANSCRIPT_FALLBACK==='1') { web.debugger.attach('1.3'); await web.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:"for(let p=HTMLElement.prototype;p;p=Object.getPrototypeOf(p))if(Object.prototype.hasOwnProperty.call(p,'onbeforematch'))delete p.onbeforematch;"}); web.debugger.detach(); }
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.thread',${JSON.stringify(JSON.stringify(thread.id))});localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'chat',expanded:false,panel:{open:false,tab:'files'}}}));true`);
    const loaded = new Promise(resolve => web.once('did-finish-load', resolve)); const began = performance.now(); web.reload(); await loaded;
    await until(() => run(`document.querySelector(${JSON.stringify(selector(count - 1) + ' .prose-reply')})?.textContent.endsWith('TRANSCRIPT_END_${count - 1}')`), 'latest reply');
    const readyMs = performance.now() - began;
    web.debugger.attach('1.3'); await delay(750); await snapshot('initial-bottom');
    await reveal(0); await snapshot('at-start');
    await reveal(Math.floor(count / 2)); await snapshot('at-middle');
    await reveal(count - 1); await snapshot('returned-bottom');
    checks.allSourcesKept = hub.thread(thread.id).messages.filter(m => m.role === 'assistant').every((m, n) => m.text === bodies[n]);
    assert.equal(checks.allSourcesKept, true);
    if (process.env.TRIBUTARY_TRANSCRIPT_FALLBACK==='1') { assert.equal(await run(`'onbeforematch' in HTMLElement.prototype`),false);assert.equal(await run(`document.querySelectorAll('[data-transcript-body="parked"]').length`),0);assert.equal(await run(`document.querySelectorAll('.prose-reply').length`),count);checks.unsupportedBrowserKeepsFullRichContent=true; }
    if (verify) {
      assert.ok(await run(`document.querySelectorAll('[data-transcript-body="parked"]').length > 0`));
      // Native browser Find must reveal the stable raw text node, not a stale estimate.
      const found = new Promise(resolve => { const receive = (_event, result) => { if (result.finalUpdate && result.matches > 0) { web.off('found-in-page', receive); resolve(result); } }; web.on('found-in-page', receive); });
      web.findInPage('TRANSCRIPT_END_2'); await found;
      await until(() => run(`document.querySelector('${selector(2)} [data-transcript-body="plain"]')?.textContent.includes('TRANSCRIPT_END_2')`), 'native Find reveals old source');
      web.stopFindInPage('keepSelection'); checks.nativeFindRevealsExactSource = true;
      assert.equal(await run(`document.querySelector('${selector(2)} [data-transcript-source]').textContent`), bodies[2]);
      await run(`[...document.querySelectorAll('${selector(2)} button')].find(e=>e.textContent==='Show formatted reply').click();true`);
      await until(() => run(`document.querySelector('${selector(2)} .prose-reply')?.textContent.endsWith('TRANSCRIPT_END_2')`), 'restore formatted match');
      await reveal(0);
      await run(`{const p=document.querySelector('${selector(0)} .prose-reply p');window.__selectedParagraph=new WeakRef(p);const range=document.createRange();range.selectNodeContents(p);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}true`);
      const selected = await run('getSelection().toString()'); await reveal(count - 1); await delay(200);
      assert.equal(await run('getSelection().toString()'), selected); assert.equal(await run(`window.__selectedParagraph.deref()===document.querySelector('${selector(0)} .prose-reply p')`), true);
      checks.offscreenNativeSelectionPreserved = true;
      await run('getSelection().removeAllRanges();true'); await delay(200);
      await until(() => run(`document.querySelector('${selector(0)} [data-transcript-body]')?.dataset.transcriptBody==='parked'`), 'selection release permits parking');
      checks.selectionReleaseParksBody = true;
      await reveal(0);
      await run(`document.querySelector('${selector(0)} .code-viewport').scrollIntoView({block:'center'});true`);
      await until(() => run(`!!document.querySelector('${selector(0)} .cm-content')`), 'historical code viewer');
      win.focus(); web.focus();
      await run(`document.querySelector('${selector(0)} .cm-content').cmTile.root.view.focus();true`);
      web.sendInputEvent({type:'keyDown',keyCode:'f',modifiers:['control']}); web.sendInputEvent({type:'keyUp',keyCode:'f',modifiers:['control']});
      await until(() => run(`!!document.querySelector('${selector(0)} .cm-search input[name="search"]')`), 'viewer Find');
      await run(`{const e=document.querySelector('${selector(0)} .cm-search input[name="search"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'item_0_1199');e.dispatchEvent(new Event('input',{bubbles:true}));}true`);
      await run(`document.querySelector('textarea[aria-label="Message"]').focus();true`); await reveal(count-1); await delay(200);
      assert.equal(await run(`document.querySelector('${selector(0)} [data-transcript-body]')?.dataset.transcriptBody`),'rich');
      await reveal(0); await run(`document.querySelector('${selector(0)} .code-viewport').scrollIntoView({block:'center'});true`);
      await until(() => run(`document.querySelector('${selector(0)} .cm-search input[name="search"]')?.value==='item_0_1199'`), 'viewer Find survives offscreen parking');
      checks.explicitCodeViewerStatePreserved = true;
      await run(`document.querySelector('textarea[aria-label="Message"]').focus();true`);
      // Copy/Select All spans parked items too; the selection listener hydrates the range.
      await run(`{const root=document.querySelector('[data-slot="message-scroller-content"]');const range=document.createRange();range.selectNodeContents(root);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}true`);
      await until(() => run(`document.querySelectorAll('[data-transcript-body="parked"]').length===0`), 'Select All restores intersected bodies');
      assert.ok(await run(`getSelection().toString().includes('TRANSCRIPT_END_1') && getSelection().toString().includes('TRANSCRIPT_END_${count - 1}')`));
      checks.selectAllIncludesOldReplyText = true; await run('getSelection().removeAllRanges();true'); await delay(300);
      win.setMinimumSize(300, 400); win.setSize(390, 850); await reveal(1);
      assert.equal(await run('document.documentElement.scrollWidth<=innerWidth'), true); checks.narrowView = true;
      fs.writeFileSync(output + '.narrow.png', (await web.capturePage()).toPNG()); win.setSize(1280, 850); await reveal(count - 1);
      await run(`window.dispatchEvent(new Event('beforeprint'));true`);
      assert.equal(await run(`document.querySelectorAll('[data-transcript-body="parked"]').length`), 0);
      await run(`window.dispatchEvent(new Event('afterprint'));true`);
      await until(() => run(`document.querySelectorAll('[data-transcript-body="parked"]').length>0`), 'release after print'); checks.printRestoresAllBodies = true;
      win.focus(); web.focus(); await until(() => run('document.hasFocus()'), 'native keyboard focus');
      const load = selector(5) + ' [data-transcript-body="parked"] button';
      await run(`document.querySelector(${JSON.stringify(load)}).focus();true`); await delay(100);
      assert.equal(await run(`document.activeElement===document.querySelector(${JSON.stringify(load)})`), true);
      web.sendInputEvent({type:'keyDown',keyCode:'Enter'}); web.sendInputEvent({type:'char',keyCode:'\r'}); web.sendInputEvent({type:'keyUp',keyCode:'Enter'});
      await until(() => run(`!!document.querySelector('${selector(5)} .prose-reply') && !!document.activeElement?.closest('${selector(5)} [data-transcript-body="rich"]')`), 'keyboard Show reply retains focus'); checks.keyboardRevealKeepsFocus = true;
      const toggleAll = async () => {
        await run(`document.querySelector('[aria-label="More options"]').focus();true`);
        web.sendInputEvent({type:'keyDown',keyCode:'Down'}); web.sendInputEvent({type:'keyUp',keyCode:'Down'});
        await until(() => run(`[...document.querySelectorAll('[role="menuitemcheckbox"]')].some(e=>e.textContent.includes('Show all reply content'))`), 'full transcript menu');
        await run(`[...document.querySelectorAll('[role="menuitemcheckbox"]')].find(e=>e.textContent.includes('Show all reply content')).focus();true`);
        web.sendInputEvent({type:'keyDown',keyCode:'Enter'}); web.sendInputEvent({type:'char',keyCode:'\r'}); web.sendInputEvent({type:'keyUp',keyCode:'Enter'}); await delay(150);
      };
      await toggleAll(); await until(() => run(`document.querySelectorAll('.prose-reply').length===${count}`), 'full transcript setting');
      assert.equal(await run(`localStorage.getItem('tributary.fullTranscript')`),'true');
      await toggleAll(); await until(() => run(`document.querySelectorAll('[data-transcript-body="parked"]').length>0`), 'windowed setting restored'); checks.fullTranscriptSettingWorksByKeyboard = true;
      web.stopFindInPage('clearSelection'); await run(`document.querySelector('textarea[aria-label="Message"]').focus();window.__oldBodyRoots=[...document.querySelectorAll('[data-transcript-body]')].map(e=>new WeakRef(e));true`);
      const empty = hub.createThread(project, 'Empty teardown fixture'); web.send('hub-event', 'open-thread', empty.id);
      await until(() => run(`document.querySelectorAll('[data-transcript-body]').length===0`), 'conversation unmounted'); await delay(300);
      await web.debugger.sendCommand('HeapProfiler.collectGarbage'); await delay(100);
      const retainedRoots = await run(`window.__oldBodyRoots.filter(ref=>ref.deref()).length`); assert.equal(retainedRoots,0);
      checks.closedConversationReleasesAllBodyRoots = true; web.send('hub-event','open-thread',thread.id);
      await until(() => run(`document.querySelector('${selector(count-1)} .prose-reply')?.textContent.endsWith('TRANSCRIPT_END_${count-1}')`),'conversation reopens from durable text');
      checks.reopenRestoresConversation = true; await reveal(count - 1);

    }
    fs.writeFileSync(output + '.png', (await web.capturePage()).toPNG()); web.debugger.detach();
    const ui = path.join(host, 'ui/dist'), fingerprint = crypto.createHash('sha256');
    for (const file of fs.readdirSync(ui, { recursive: true }).filter(f => fs.statSync(path.join(ui, f)).isFile()).sort()) fingerprint.update(file + '\0').update(fs.readFileSync(path.join(ui, file)));
    fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), count, sourceUtf16Units: bodies.reduce((n, text) => n + text.length, 0), readyMs, phases, checks, rejectedSamples, uiBuildSha256: fingerprint.digest('hex'), runtime: process.versions,
      scope: 'Real Linux source Electron conversation with saved synthetic rich history, actual core/bridge and disabled agent discovery/update polling. Pre-collection observations precede a separately labelled diagnostic renderer GC at each boundary; earlier phases have already requested GC, so this does not measure uninterrupted natural-GC behavior. No production forced GC. Cold-ready observation includes polling and IO, not paint completion or general throughput. PSS excludes Xvfb, detached helpers and driver allocations outside app descendants. No model/provider, installer, native Windows/macOS or leak-free claim.' }, null, 2) + '\n');
    console.log(JSON.stringify({ passed: true, count, checks })); clearTimeout(deadline); app.exit(0);
  })().catch(async error => { console.error(error.stack); try { fs.writeFileSync(output+'.failure.png',(await web.capturePage()).toPNG()); } catch {} app.exit(1); }); });
});
app.on('quit', () => fs.rmSync(root, { recursive: true, force: true })); require(path.join(host, 'desktop/main.js'));
