'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { app } = require('electron'), { sample } = require('./app-memory.cjs');
const config = JSON.parse(fs.readFileSync(process.env.TRIBUTARY_GALLERY_CASE, 'utf8'));
const repo = config.repo, project = config.project, profile = config.profile; fs.mkdirSync(profile, { recursive: true });
process.env.TRIBUTARY_DATA_DIR = profile;
const core = require(path.join(repo, 'core')), seed = new core.Hub({ dataDir: profile, home: path.dirname(profile), secrets: new core.MemorySecrets() });
const thread = seed.createThread(project, 'Gallery fixture');
const body = config.images.map((image, index) => `![gallery-${index}](${image.rel})\n\n`).join('') + 'GALLERY_END';
fs.writeFileSync(path.join(project, 'README.md'), body);
thread.messages.push({ id: 'request', role: 'user', target: 'claude', text: 'Show the local gallery.', ts: 1000 }, { id: 'reply', role: 'assistant', agent: 'claude', mode: 'edit', text: config.surface === 'file' ? 'Open README.md.' : body, tools: [], files: [], notices: [], permissions: [], trace: [], ok: true, ts: 1001 });
seed.store.save(true); seed.fileWatches.close(); seed.store.close();
if (config.surface === 'file') require(path.join(repo, 'core/drafts')).save(profile, 'files:' + project, { active: 'README.md', tabs: [{ rel: 'README.md', mode: 'preview', pinned: true }] });
let hub, active = 0, maximum = 0, slowGate = null; const reads = [], requests = [], Base = core.Hub;
core.Hub = class extends Base {
  constructor(...args) { super(...args); hub = this; }
  async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; }
  async gitInfo() { return { branch: 'fixture', changed: [], stat: '' }; }
  async readFile(dir, rel, options) {
    requests.push({ rel, metadata: !!options?.metadataOnly });
    const raster = /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i.test(rel) && !options?.metadataOnly;
    if (raster) maximum = Math.max(maximum, ++active);
    if (rel === 'slow.png' && slowGate) await slowGate.promise;
    try { const result = await super.readFile(dir, rel, options); reads.push({ rel, chars: result.base64?.length || 0 }); return result; }
    finally { if (raster) active--; }
  }
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, label) => { const end = Date.now() + 25000; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + label); await delay(25); } };
let started = false; const deadline = setTimeout(() => { console.error('Gallery deadline'); app.exit(1); }, 240000);
app.on('browser-window-created', (_event, win) => {
  win.setSize(1280, 850); const web = win.webContents;
  const run = async code => { try { return await web.executeJavaScript(code); } catch (error) { throw Error(error.message + ' in fixture: ' + code.slice(0, 150)); } };
  const viewport = config.surface === 'file' ? '[aria-label="File preview"]' : '[data-slot="message-scroller-viewport"]';
  const button = index => `[aria-label="Expand image: gallery-${index}"]`;
  let walk = 'initial'; const visits = [];
  const pixels = index => run(`(()=>{const b=document.querySelector(${JSON.stringify(button(index))}),i=b?.querySelector('img');if(!i?.complete||!i.naturalWidth||b.disabled||b.getAttribute('aria-busy')==='true')return null;const c=document.createElement('canvas');c.width=c.height=1;c.getContext('2d').drawImage(i,0,0);return {width:i.naturalWidth,height:i.naturalHeight,pixel:[...c.getContext('2d').getImageData(0,0,1,1).data],blob:i.src.startsWith('blob:')};})()`);
  const reveal = async index => {
    const start = performance.now();
    await run(`document.querySelector(${JSON.stringify(button(index))}).scrollIntoView({block:'center'});true`);
    await until(() => pixels(index), 'gallery image ' + index); const value = await pixels(index), fixture = config.images[index];
    assert.equal(value.width, fixture.width); assert.equal(value.height, fixture.height); assert.deepEqual(value.pixel, fixture.pixel);
    if (config.optimized) assert.equal(value.blob, true); visits.push({ walk, index, decodedMs: performance.now() - start }); await delay(120);
  };
  const state = () => run(`(()=>{const root=document.querySelector(${JSON.stringify(viewport)});const p=Object.keys(root).find(k=>k.startsWith('__reactFiber$'));let f=root[p];while(f.return)f=f.return;f=f.stateNode?.current||f;const stack=[f],seen=new Set(),files=new Set(),urls=new Set();while(stack.length){const node=stack.pop();if(!node||seen.has(node))continue;seen.add(node);stack.push(node.child,node.sibling,node.alternate);let h=node.memoizedState,n=0;while(h&&n++<1000){for(const v of [h.memoizedState,h.memoizedState?.current,h.memoizedState?.[0]]){if(v&&typeof v==='object'&&typeof v.base64==='string')files.add(v);if(typeof v==='string'&&v.startsWith('data:image/'))urls.add(v);}h=h.next;}}return {fileObjects:files.size,base64Chars:[...files].reduce((n,f)=>n+f.base64.length,0),dataUrlChars:[...urls].reduce((n,s)=>n+s.length,0),liveUrls:window.__galleryUrls.live.size,createdUrls:window.__galleryUrls.created,revokedUrls:window.__galleryUrls.revoked,imageElements:root.querySelectorAll('button[aria-label^="Expand image: gallery-"] img').length,tiles:root.querySelectorAll('button[aria-label^="Expand image: gallery-"]').length};})()`);
  const geometry = () => run(`(()=>{const v=document.querySelector(${JSON.stringify(viewport)});return {top:v.scrollTop,height:v.scrollHeight,tiles:[...v.querySelectorAll('button[aria-label^="Expand image: gallery-"]')].map(b=>{const r=b.getBoundingClientRect();return {label:b.getAttribute('aria-label'),width:r.width,height:r.height,top:r.y+v.scrollTop};})};})()`);
  const phases = [], checks = [];
  const snapshot = async label => {
    await delay(600); const natural = { heap: await web.debugger.sendCommand('Runtime.getHeapUsage'), processTree: sample(process.pid), state: await state(), geometry: await geometry() };
    let retained = null;
    if (config.diagnostic) { await web.debugger.sendCommand('HeapProfiler.collectGarbage'); await delay(200); retained = { heap: await web.debugger.sendCommand('Runtime.getHeapUsage'), processTree: sample(process.pid), state: await state(), geometry: await geometry() }; }
    phases.push({ label, natural, retained }); console.log('Gallery checkpoint', label);
  };
  web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
    web.debugger.attach('1.3'); await web.debugger.sendCommand('Page.enable');
    await web.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.__galleryUrls={live:new Set(),created:0,revoked:0};URL.createObjectURL=b=>{const u=create(b);window.__galleryUrls.live.add(u);window.__galleryUrls.created++;return u;};URL.revokeObjectURL=u=>{if(window.__galleryUrls.live.delete(u))window.__galleryUrls.revoked++;revoke(u);};${config.noObserver ? 'delete window.IntersectionObserver;' : ''}})()` });
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.thread',${JSON.stringify(JSON.stringify(thread.id))});localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:${JSON.stringify(config.surface === 'file' ? 'editor' : 'chat')},expanded:${config.surface === 'file'},panel:{open:${config.surface === 'file'},tab:'files'}}}));true`);
    const loaded = new Promise(resolve => web.once('did-finish-load', resolve)); web.reload(); await loaded;
    await until(() => run(`document.querySelectorAll(${JSON.stringify(viewport + ' button[aria-label^="Expand image: gallery-"]')}).length===${config.images.length}`), 'gallery tiles');
    await snapshot('initial');
    walk = 'forward'; for (let index = 0; index < config.images.length; index++) await reveal(index);
    await snapshot('walked-forward'); const known = await geometry();
    walk = 'reverse'; for (let index = config.images.length - 1; index >= 0; index--) await reveal(index);
    await snapshot('returned-start');
    const returned = await geometry(); assert.ok(Math.abs(returned.height - known.height) < 0.2, 'stable gallery scroll height');
    for (const tile of returned.tiles) { const before = known.tiles.find(t => t.label === tile.label); assert.ok(Math.abs(tile.width - before.width) < 0.2 && Math.abs(tile.height - before.height) < 0.2 && Math.abs(tile.top - before.top) < 0.2, 'stable known tile ' + tile.label); }
    walk = 'return'; await reveal(config.images.length - 1); await snapshot('returned-bottom');
    checks.push('Every real PNG decodes with exact reference pixel/dimensions on forward and reverse gallery walks; known tile geometry stays stable.');
    if (config.optimized && !config.noObserver) { const last = await state(); assert.equal(last.base64Chars, 0); assert.equal(last.dataUrlChars, 0); assert.ok(last.liveUrls < config.images.length || config.images.length === 1); assert.equal(last.tiles, config.images.length); checks.push('Offscreen image payloads/URLs release while every gallery tile remains.'); }
    if (config.verify) {
      walk = 'verification';
      await reveal(0); if (config.evidence) fs.writeFileSync(config.evidence, (await web.capturePage()).toPNG());
      if (config.images.length > 1) {
        await run(`document.querySelector(${JSON.stringify(button(0))}).focus();true`);
        web.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' }); web.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
        await until(() => run(`document.activeElement===document.querySelector(${JSON.stringify(button(1))})`), 'keyboard next image');
        await until(() => pixels(1), 'keyboard image decoded'); await run(`document.activeElement.blur();true`); await reveal(0);
        checks.push('Native Tab reaches the next image and restores its decoded content.');
      }
      const original = await run(`document.querySelector(${JSON.stringify(button(0))}).querySelector('img').src`);
      await run(`document.querySelector(${JSON.stringify(button(0))}).click();true`); await until(() => run(`!!document.querySelector('[aria-label="Close image viewer"]')`), 'image dialog');
      await run(`document.querySelector(${JSON.stringify(viewport)}).scrollTop=100000;true`); await delay(250);
      assert.equal(await run(`window.__galleryUrls.live.has(${JSON.stringify(original)})`), true);
      await run(`document.querySelector('[aria-label="Close image viewer"]').click();true`);
      await until(() => run(`document.activeElement===document.querySelector(${JSON.stringify(button(0))})`), 'dialog return focus');
      assert.equal(await run(`window.__galleryUrls.live.has(${JSON.stringify(original)})`), true);
      await run(`(()=>{document.activeElement?.blur();const next=${config.surface === 'file' ? `document.querySelector(${JSON.stringify(viewport)})` : `[...document.querySelectorAll('textarea[aria-label="Message"]')].find(e=>e.getBoundingClientRect().height>0)`};next?.focus();return document.activeElement?.getAttribute('aria-label');})()`);
      if (!config.noObserver) await until(() => run(`!window.__galleryUrls.live.has(${JSON.stringify(original)})`), 'blur releases offscreen image');
      checks.push('Open dialog and returned keyboard focus keep the shared image alive offscreen; blur permits release.');
      if (config.surface === 'chat' && !config.noObserver) {
        const reply = hub.thread(thread.id).messages.find(message => message.id === 'reply');
        const update = text => { reply.text = text; hub.emit('message', { threadId: thread.id, message: reply }); };
        const alias = label => `[aria-label="Expand image: ${label}"]`;
        const aliasReady = label => run(`(()=>{const b=document.querySelector(${JSON.stringify(alias(label))}),i=b?.querySelector('img');return !!i?.complete&&!!i.naturalWidth&&b.getAttribute('aria-busy')!=='true';})()`);
        for (const width of [500, 1280]) {
          win.setSize(width, 850); await delay(250);
          const before = await geometry();
          for (const index of [0, 1, 2, 3]) await reveal(index);
          const after = await geometry();
          for (const tile of after.tiles) { const saved = before.tiles.find(t => t.label === tile.label); assert.ok(Math.abs(tile.width - saved.width) < 0.2 && Math.abs(tile.height - saved.height) < 0.2, 'responsive placeholder ' + tile.label); }
        }
        checks.push('Known placeholders match decoded image geometry at narrow and wide native window sizes.');
        const tiny = config.images[3], duplicate = `\n\n![duplicate-a](${tiny.rel}) ![duplicate-b](${tiny.rel})\n\nDUPLICATE_END`;
        update(body + duplicate); await until(() => run(`!!document.querySelector(${JSON.stringify(alias('duplicate-b'))})`), 'duplicate tiles');
        await run(`document.querySelector(${JSON.stringify(alias('duplicate-b'))}).scrollIntoView({block:'center'});true`);
        await until(() => aliasReady('duplicate-a'), 'first shared image'); await until(() => aliasReady('duplicate-b'), 'second shared image');
        const shared = await run(`document.querySelector(${JSON.stringify(alias('duplicate-a'))}).querySelector('img').src`);
        assert.equal(await run(`document.querySelector(${JSON.stringify(alias('duplicate-b'))}).querySelector('img').src`), shared);
        update(body + `\n\n![duplicate-a](${tiny.rel})\n\nSINGLE_END`); await until(() => run(`!document.querySelector(${JSON.stringify(alias('duplicate-b'))})`), 'one owner removed');
        assert.equal(await run(`window.__galleryUrls.live.has(${JSON.stringify(shared)})`), true);
        checks.push('Duplicate local references share one Blob; removing one reference preserves the other.');
        await run(`document.querySelector(${JSON.stringify(alias('duplicate-a'))}).click();true`); await until(() => run(`!!document.querySelector('[aria-label="Close image viewer"]')`), 'source-change dialog');
        update(body + `\n\n![duplicate-a](${config.images[0].rel})\n\nSOURCE_CHANGED`);
        await until(() => run(`!document.querySelector('[aria-label="Close image viewer"]')`), 'source change closes old dialog');
        await until(() => aliasReady('duplicate-a'), 'new source decoded');
        assert.equal(await run(`document.querySelector(${JSON.stringify(alias('duplicate-a'))}).querySelector('img').naturalWidth`), config.images[0].width);
        assert.equal(await run(`window.__galleryUrls.live.has(${JSON.stringify(shared)})`), false);
        checks.push('Changing the source closes the old dialog, releases its resource and decodes the new source.');
        update(body + '\n\n![repair](repair.png)\n\nREPAIR_END');
        await until(() => run(`document.querySelector('.prose-reply')?.textContent.includes('REPAIR_END')`), 'missing image source');
        await run(`document.querySelector('.prose-reply').lastElementChild.scrollIntoView({block:'center'});true`);
        await until(() => run(`[...document.querySelectorAll('.prose-reply [role="status"]')].some(e=>e.textContent.includes('Image unavailable'))`), 'missing file error');
        fs.copyFileSync(path.join(project, tiny.rel), path.join(project, 'repair.png'));
        await run(`[...document.querySelectorAll('.prose-reply [role="status"] button')].find(e=>e.textContent==='Retry').click();true`);
        await until(() => aliasReady('repair'), 'repaired file retry');
        checks.push('A missing file reports a local error; Retry reads the repaired file and renders it.');
        update(body + '\n\n![failed-a](duplicate-missing.png) ![failed-b](duplicate-missing.png)\n\nTWO_ERRORS_END');
        await until(() => run(`[...document.querySelectorAll('.prose-reply [role="status"] button')].filter(e=>e.textContent==='Retry').length===2`), 'two shared errors');
        const requested = requests.filter(item => item.rel === 'duplicate-missing.png').length;
        await run(`[...document.querySelectorAll('.prose-reply [role="status"] button')].filter(e=>e.textContent==='Retry')[0].click();true`);
        await until(() => requests.filter(item => item.rel === 'duplicate-missing.png').length > requested, 'first failed retry');
        await until(() => run(`[...document.querySelectorAll('.prose-reply [role="status"] button')].filter(e=>e.textContent==='Retry').length===2`), 'first retry settled');
        fs.copyFileSync(path.join(project, tiny.rel), path.join(project, 'duplicate-missing.png'));
        await run(`[...document.querySelectorAll('.prose-reply [role="status"] button')].filter(e=>e.textContent==='Retry')[1].click();true`);
        await until(() => aliasReady('failed-b'), 'second owner retry reads fresh content');
        checks.push('Each explicit Retry is fresh even while another duplicate reference holds a failed attempt.');
        fs.copyFileSync(path.join(project, tiny.rel), path.join(project, 'slow.png'));
        let release; slowGate = { promise: new Promise(resolve => { release = resolve; }) };
        update(body + '\n\n![slow](slow.png)\n\nSLOW_END');
        await until(() => run(`!!document.querySelector(${JSON.stringify(alias('slow'))})`), 'slow tile');
        await run(`document.querySelector(${JSON.stringify(alias('slow'))}).scrollIntoView({block:'center'});document.querySelector(${JSON.stringify(alias('slow'))}).click();true`);
        await until(() => run(`!!document.querySelector('[aria-label="Close image viewer"]')`), 'pending dialog');
        await run(`document.querySelector('[aria-label="Close image viewer"]').click();true`);
        await until(() => run(`document.activeElement===document.querySelector(${JSON.stringify(alias('slow'))})`), 'pending dialog return focus');
        update(body + '\n\n![slow](slow.png)\n\n' + Array.from({ length: 40 }, (_, n) => 'Plain tail ' + n + '.').join('\n\n'));
        await until(() => run(`document.querySelector('.prose-reply')?.textContent.endsWith('Plain tail 39.')`), 'tail text');
        await run(`document.activeElement?.blur();document.querySelector(${JSON.stringify(viewport)}).scrollTop=100000;true`);
        await until(() => run(`window.__galleryUrls.live.size===0`), 'no visible image owner');
        release(); slowGate = null; await delay(300); assert.equal(await run(`window.__galleryUrls.live.size`), 0); assert.equal((await state()).base64Chars, 0);
        checks.push('Closing a pending preview and leaving its tile discards the late file response without recreating a Blob.');
        update(body + '\n\n![Remote](https://example.invalid/never-fetch.png)\n\nREMOTE_END');
        await until(() => run(`[...document.querySelectorAll('.prose-reply button')].some(b=>b.textContent==='Remote')`), 'explicit remote button');
        assert.equal(await run(`document.querySelectorAll('img[src^="https://example.invalid"]').length`), 0);
        checks.push('Remote image references remain explicit external-open buttons and create no remote image element.');
        fs.writeFileSync(path.join(project, 'vector.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="blue"/></svg>');
        update(body + '\n\n![vector](vector.svg)\n\nVECTOR_END');
        await until(() => run(`!!document.querySelector(${JSON.stringify(alias('vector'))})`), 'SVG tile');
        await run(`document.querySelector(${JSON.stringify(alias('vector'))}).scrollIntoView({block:'center'});true`); await until(() => aliasReady('vector'), 'native SVG decoded');
        assert.equal(await run(`document.querySelector(${JSON.stringify(alias('vector'))}).querySelector('img').naturalWidth`), 32);
        assert.equal(await run(`document.querySelector(${JSON.stringify(alias('vector'))}).querySelector('img').src.startsWith('blob:')`), true);
        checks.push('Local SVG references decode through an owned Blob URL rather than a retained text/data URL.');
      }
      if (config.surface === 'file') {
        await run(`[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent.trim()==='Memory').focus();true`);
        web.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); web.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
        if (!config.noObserver) await until(() => run(`window.__galleryUrls.live.size===0`), 'hidden Markdown releases image URLs');
        checks.push('Hidden Markdown file preview releases all its image resources.');
      }
    }
    const report = { config, versions: process.versions, phases, checks, visits, reads, requests, maximumReads: maximum, scope: 'Private Linux source Electron. Scroll request to decoded/pixel-checked DOM includes IPC/polling/canvas verification; not physical input-to-paint. Fixed settling waits are outside visit times. Natural and explicit diagnostic cohorts are separate processes. Complete app-tree PSS only; no model/GPU-driver memory claim.' };
    fs.writeFileSync(config.output, JSON.stringify(report, null, 2) + '\n'); clearTimeout(deadline); web.debugger.detach(); app.quit();
  })().catch(async error => { console.error(error.stack); if (config.failureOutput) fs.writeFileSync(config.failureOutput, JSON.stringify({ error: error.stack, config, phases, state: await state().catch(() => null), geometry: await geometry().catch(() => null), focus: await run(`({label:document.activeElement?.getAttribute('aria-label'),tag:document.activeElement?.tagName})`).catch(() => null) }, null, 2)); app.exit(1); }); });
});
require(path.join(repo, 'desktop/main.js'));
