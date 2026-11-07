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
    requests.push({ rel, metadata: !!options?.metadataOnly, bytesOnly: options?.bytesOnly === true });
    const raster = /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i.test(rel) && !options?.metadataOnly;
    if (raster) maximum = Math.max(maximum, ++active);
    if (rel === 'slow.png' && slowGate) await slowGate.promise;
    try { const result = await super.readFile(dir, rel, options); reads.push({ rel, chars: result.base64?.length || 0, bytes: result.bytes?.byteLength || 0 }); return result; }
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
  const pixels = index => run(`(()=>{const b=document.querySelector(${JSON.stringify(button(index))}),i=b?.querySelector('img,canvas[role=img]');if(!i||(i.tagName==='IMG'?!i.complete||!i.naturalWidth:!i.width)||b.disabled||b.getAttribute('aria-busy')==='true')return null;const r=i.getBoundingClientRect(),parent=b.parentElement.parentElement.getBoundingClientRect();return {width:i.naturalWidth||i.width,height:i.naturalHeight||i.height,renderWidth:r.width,renderHeight:r.height,availableWidth:parent.width,blob:!!i.src?.startsWith('blob:'),canvas:i.tagName==='CANVAS'};})()`);
  const reveal = async index => {
    await run(`document.querySelector(${JSON.stringify(viewport)}).dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-1}));true`);
    const start = performance.now();
    await run(`document.querySelector(${JSON.stringify(button(index))}).scrollIntoView({block:'center'});true`);
    await until(() => pixels(index), 'gallery image ' + index); const value = await pixels(index), fixture = config.images[index];

    const displayScale=Math.min(1,256/fixture.height,value.availableWidth/fixture.width);assert.ok(Math.abs(value.renderWidth-fixture.width*displayScale)<0.2 && Math.abs(value.renderHeight-fixture.height*displayScale)<0.2,'original card geometry '+index);
    if (config.optimized && !config.noBitmap) { const scale=Math.min(1,2048/fixture.width,512/fixture.height);assert.equal(value.width,Math.max(1,Math.round(fixture.width*scale)));assert.equal(value.height,Math.max(1,Math.round(fixture.height*scale))); } else { assert.equal(value.width,fixture.width);assert.equal(value.height,fixture.height); }
    if (config.optimized) assert.ok(value.blob || value.canvas); visits.push({ walk, index, decodedMs: performance.now() - start }); await delay(120);
  };
  const state = () => run(`(()=>{const root=document.querySelector(${JSON.stringify(viewport)});const p=Object.keys(root).find(k=>k.startsWith('__reactFiber$'));let f=root[p];while(f.return)f=f.return;f=f.stateNode?.current||f;const stack=[f],seen=new Set(),files=new Set(),urls=new Set();while(stack.length){const node=stack.pop();if(!node||seen.has(node))continue;seen.add(node);stack.push(node.child,node.sibling,node.alternate);let h=node.memoizedState,n=0;while(h&&n++<1000){for(const v of [h.memoizedState,h.memoizedState?.current,h.memoizedState?.[0]]){if(v&&typeof v==='object'&&(typeof v.base64==='string'||v.bytes instanceof ArrayBuffer))files.add(v);if(typeof v==='string'&&v.startsWith('data:image/'))urls.add(v);}h=h.next;}}return {fileObjects:files.size,binaryBytes:[...files].reduce((n,f)=>n+(f.bytes?.byteLength||0),0),base64Chars:[...files].reduce((n,f)=>n+(f.base64?.length||0),0),dataUrlChars:[...urls].reduce((n,s)=>n+s.length,0),liveUrls:window.__galleryUrls.live.size,createdUrls:window.__galleryUrls.created,revokedUrls:window.__galleryUrls.revoked,canvasElements:root.querySelectorAll('canvas[role=img]').length,liveBitmaps:window.__galleryPixels?.live.size??null,imageElements:root.querySelectorAll('button[aria-label^="Expand image: gallery-"] img').length,tiles:root.querySelectorAll('button[aria-label^="Expand image: gallery-"]').length};})()`);
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
    await web.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.__galleryUrls={live:new Set(),created:0,revoked:0,hashes:new Map()};URL.createObjectURL=b=>{const u=create(b);window.__galleryUrls.live.add(u);window.__galleryUrls.created++;${config.verify ? `b.arrayBuffer().then(bytes=>crypto.subtle.digest('SHA-256',bytes)).then(hash=>{if(window.__galleryUrls.live.has(u))window.__galleryUrls.hashes.set(u,[...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join(''));});` : ''}return u;};URL.revokeObjectURL=u=>{if(window.__galleryUrls.live.delete(u))window.__galleryUrls.revoked++;window.__galleryUrls.hashes.delete(u);revoke(u);};${config.verify ? 'const ids=new WeakMap(),live=new Set();let next=0;window.__galleryPixels={live,closed:0,zeroed:true};const track=b=>{ids.set(b,++next);live.add(next);return b;};const bitmap=createImageBitmap;window.createImageBitmap=async(...args)=>track(await bitmap(...args));const transfer=OffscreenCanvas.prototype.transferToImageBitmap;OffscreenCanvas.prototype.transferToImageBitmap=function(...args){return track(transfer.apply(this,args));};const close=ImageBitmap.prototype.close;ImageBitmap.prototype.close=function(){const id=ids.get(this);const value=close.call(this);if(live.delete(id)){window.__galleryPixels.closed++;window.__galleryPixels.zeroed&&=this.width===0&&this.height===0;}return value;};const draw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(input,...args){const value=draw.call(this,input,...args);if(ids.has(input))this.canvas.__galleryBitmap=ids.get(input);return value;};' : ''}${config.noObserver ? 'delete window.IntersectionObserver;' : ''}${config.noBitmap ? 'delete window.createImageBitmap;delete window.OffscreenCanvas;' : ''}})()` });
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
    checks.push('Every PNG card has exact original layout dimensions and expected rendition dimensions on forward/reverse walks; known tile geometry stays stable.');
    if (config.optimized && !config.noObserver) { const last = await state(); assert.equal(last.base64Chars, 0); assert.equal(last.binaryBytes, 0); assert.equal(last.dataUrlChars, 0); assert.ok(last.liveUrls < config.images.length || config.images.length === 1); assert.equal(last.tiles, config.images.length); checks.push('Offscreen image payloads/URLs release while every gallery tile remains.'); }
    if (!config.verify) {
      for(let cycle=1;cycle<=3;cycle++){walk='cycle-'+cycle;for(let index=0;index<config.images.length;index++)await reveal(index);for(let index=config.images.length-1;index>=0;index--)await reveal(index);await snapshot('cycle-'+cycle);}
      const reply=hub.thread(thread.id).messages.find(message=>message.id==='reply');reply.text='Gallery cleared.';hub.emit('message',{threadId:thread.id,message:reply});
      if(config.surface==='chat'){await until(()=>run(`document.querySelectorAll('button[aria-label^="Expand image: gallery-"]').length===0`),'cleared gallery');await snapshot('cleared');await delay(2500);await snapshot('cleared-settled');}
    }
    if (config.verify) {
      const first=config.images[0],sourceHash=require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(project,first.rel))).digest('hex');
      const bridged=await run(`(async()=>{const f=await window.hub.call('readFile',${JSON.stringify(project)},${JSON.stringify(first.rel)},{bytesOnly:true});return {binary:f.bytes instanceof ArrayBuffer,bytes:f.bytes?.byteLength,base64:f.base64??null,hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',f.bytes))].map(v=>v.toString(16).padStart(2,'0')).join('')};})()`);
      assert.equal(bridged.binary,true);assert.equal(bridged.bytes,fs.statSync(path.join(project,first.rel)).size);assert.equal(bridged.base64,null);assert.equal(bridged.hash,sourceHash);
      assert.ok(reads.some(r=>r.bytes>0&&r.chars===0),'real desktop reads deliver raw bytes');
      checks.push('Exact-size ArrayBuffer crosses real isolated desktop IPC with original SHA-256 and no base64 payload.');
      walk = 'verification';
      await reveal(0); if (config.evidence) fs.writeFileSync(config.evidence, (await web.capturePage()).toPNG());
      for(let index=0;index<config.images.length;index++){
        await reveal(index);await run(`document.querySelector(${JSON.stringify(button(index))}).click();true`);
        await until(()=>run(`(()=>{const i=document.querySelector('[role="dialog"] img');return !!i?.complete&&!!i.naturalWidth&&i.getBoundingClientRect().width>0;})()`),'full viewer '+index);await run(`document.querySelector('[role="dialog"] img').decode().then(()=>true)`);
        const exact=await run(`(()=>{const i=document.querySelector('[role="dialog"] img');const c=document.createElement('canvas');c.width=c.height=1;c.getContext('2d').drawImage(i,0,0);return {width:i.naturalWidth,height:i.naturalHeight,pixel:[...c.getContext('2d').getImageData(0,0,1,1).data],src:i.src};})()`);
        const fixture=config.images[index];assert.equal(exact.width,fixture.width);assert.equal(exact.height,fixture.height);assert.deepEqual(exact.pixel,fixture.pixel);
        await run(`document.querySelector('[role="dialog"] [aria-label="Actual size (1)"]').click();true`);
        await until(()=>run(`document.querySelector('[role="dialog"] img').style.width===${JSON.stringify(fixture.width+'px')}`),'actual-size original '+index);
        await run(`document.querySelector('[aria-label="Close image viewer"]').click();true`);
        await until(()=>run(`document.activeElement===document.querySelector(${JSON.stringify(button(index))})`),'full viewer focus return '+index);
        await until(()=>run(`!window.__galleryUrls.live.has(${JSON.stringify(exact.src)})`),'full viewer release '+index);
        await run('document.activeElement.blur();true');
      }
      checks.push('Every original full viewer has exact PNG dimensions/pixel, 1:1 zoom, focus return and last-owner release; card renditions are never used as originals.');
      await reveal(0);
      if (config.images.length > 1) {
        await run(`document.querySelector(${JSON.stringify(button(0))}).focus();true`);
        web.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' }); web.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
        await until(() => run(`document.activeElement===document.querySelector(${JSON.stringify(button(1))})`), 'keyboard next image');
        await until(() => pixels(1), 'keyboard image decoded'); await run(`document.activeElement.blur();true`); await reveal(0);
        checks.push('Native Tab reaches the next image and restores its decoded content.');
      }
      const original = await run(`(()=>{const i=document.querySelector(${JSON.stringify(button(0))}).querySelector('img,canvas[role=img]');return i.__galleryBitmap||i.src;})()`);
      await run(`document.querySelector(${JSON.stringify(button(0))}).click();true`); await until(() => run(`!!document.querySelector('[aria-label="Close image viewer"]')`), 'image dialog');
      await run(`document.querySelector(${JSON.stringify(viewport)}).scrollTop=100000;true`); await delay(250);
      assert.equal(await run(`(typeof ${JSON.stringify(original)}==='number'?window.__galleryPixels.live:window.__galleryUrls.live).has(${JSON.stringify(original)})`), true);
      await run(`document.querySelector('[aria-label="Close image viewer"]').click();true`);
      await until(() => run(`document.activeElement===document.querySelector(${JSON.stringify(button(0))})`), 'dialog return focus');
      assert.equal(await run(`(typeof ${JSON.stringify(original)}==='number'?window.__galleryPixels.live:window.__galleryUrls.live).has(${JSON.stringify(original)})`), true);
      await run(`(()=>{document.activeElement?.blur();const next=${config.surface === 'file' ? `document.querySelector(${JSON.stringify(viewport)})` : `[...document.querySelectorAll('textarea[aria-label="Message"]')].find(e=>e.getBoundingClientRect().height>0)`};next?.focus();return document.activeElement?.getAttribute('aria-label');})()`);
      if (!config.noObserver) await until(() => run(`!(typeof ${JSON.stringify(original)}==='number'?window.__galleryPixels.live:window.__galleryUrls.live).has(${JSON.stringify(original)})`), 'blur releases offscreen image');
      checks.push('Open dialog and returned keyboard focus keep the shared image alive offscreen; blur permits release.');
      if (config.surface === 'chat' && !config.noObserver) {
        const reply = hub.thread(thread.id).messages.find(message => message.id === 'reply');
        const update = text => { reply.text = text; hub.emit('message', { threadId: thread.id, message: reply }); };
        const alias = label => `[aria-label="Expand image: ${label}"]`;
        const aliasReady = label => run(`(()=>{const b=document.querySelector(${JSON.stringify(alias(label))}),i=b?.querySelector('img,canvas[role=img]');return !!i&&(i.tagName==='IMG'?i.complete&&!!i.naturalWidth:!!i.width)&&b.getAttribute('aria-busy')!=='true';})()`);
        for (const width of [500, 1280]) {
          win.setSize(width, 850); await delay(250);
          const before = await geometry();
          for (const index of [0, 1, 2, 3]) await reveal(index);
          const after = await geometry();
          for (const tile of after.tiles) { const saved = before.tiles.find(t => t.label === tile.label); assert.ok(Math.abs(tile.width - saved.width) < 0.2 && Math.abs(tile.height - saved.height) < 0.2, 'responsive placeholder ' + tile.label); }
        }
        checks.push('Known placeholders match decoded image geometry at narrow and wide native window sizes.');
        const tiny = config.images[3], duplicateSource = config.noBitmap ? tiny : config.images[0], duplicate = `\n\n![duplicate-a](${duplicateSource.rel}) ![duplicate-b](${duplicateSource.rel})\n\nDUPLICATE_END`;
        update(body + duplicate); await until(() => run(`!!document.querySelector(${JSON.stringify(alias('duplicate-b'))})`), 'duplicate tiles');
        await run(`document.querySelector(${JSON.stringify(alias('duplicate-b'))}).scrollIntoView({block:'center'});true`);
        await until(() => aliasReady('duplicate-a'), 'first shared image'); await until(() => aliasReady('duplicate-b'), 'second shared image');
        const shared = await run(`(()=>{const i=document.querySelector(${JSON.stringify(alias('duplicate-a'))}).querySelector('img,canvas[role=img]');return i.__galleryBitmap||i.src;})()`);
        assert.equal(await run(`(()=>{const i=document.querySelector(${JSON.stringify(alias('duplicate-b'))}).querySelector('img,canvas[role=img]');return i.__galleryBitmap||i.src;})()`), shared);
        update(body + `\n\n![duplicate-a](${duplicateSource.rel})\n\nSINGLE_END`); await until(() => run(`!document.querySelector(${JSON.stringify(alias('duplicate-b'))})`), 'one owner removed');
        assert.equal(await run(`(typeof ${JSON.stringify(shared)}==='number'?window.__galleryPixels.live:window.__galleryUrls.live).has(${JSON.stringify(shared)})`), true);
        checks.push('Duplicate local references share one owned pixel surface (or fallback Blob); removing one reference preserves the other.');
        await run(`document.querySelector(${JSON.stringify(alias('duplicate-a'))}).click();true`); await until(() => run(`!!document.querySelector('[aria-label="Close image viewer"]')`), 'source-change dialog');
        update(body + `\n\n![duplicate-a](${config.images[1].rel})\n\nSOURCE_CHANGED`);
        await until(() => run(`!document.querySelector('[aria-label="Close image viewer"]')`), 'source change closes old dialog');
        await until(() => aliasReady('duplicate-a'), 'new source decoded');
        assert.equal(await run(`(()=>{const i=document.querySelector(${JSON.stringify(alias('duplicate-a'))}).querySelector('img,canvas[role=img]');return i.naturalWidth||i.width;})()`), config.images[1].width);
        assert.equal(await run(`(typeof ${JSON.stringify(shared)}==='number'?window.__galleryPixels.live:window.__galleryUrls.live).has(${JSON.stringify(shared)})`), await run(`[...document.querySelectorAll('img,canvas[role=img]')].some(i=>(i.__galleryBitmap||i.src)===${JSON.stringify(shared)})`), 'remaining duplicate owners keep their card resource');
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
        await until(() => run(`window.__galleryUrls.live.size===0&&window.__galleryPixels.live.size===0`), 'no visible image owner');
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
        if(!config.noBitmap){
          const {execFileSync}=require('node:child_process'),crypto=require('node:crypto');
          const codecs=JSON.parse(execFileSync('/usr/bin/python3',['-c',`from PIL import Image,ImageOps
import os,sys,json
root=sys.argv[1];a=Image.new('RGB',(900,700),'red');b=Image.new('RGB',(900,700),'lime');rows=[]
for name,fmt in [('animated.png','PNG'),('animated.gif','GIF'),('animated.webp','WEBP')]:
 a.save(os.path.join(root,name),format=fmt,save_all=True,append_images=[b],duration=180,loop=0,lossless=True);rows.append(dict(rel=name,width=900,height=700,animated=True,original=True))
exif=Image.Exif();exif[274]=6;a.save(os.path.join(root,'oriented.jpg'),exif=exif,quality=95);rows.append(dict(rel='oriented.jpg',width=700,height=900,original=False))
h=Image.new('I;16',(900,700),40000);h.save(os.path.join(root,'precision.png'));rows.append(dict(rel='precision.png',width=900,height=700,original=True))
a=Image.new('RGBA',(900,900),(12,100,240,127));a.save(os.path.join(root,'alpha.png'));rows.append(dict(rel='alpha.png',width=900,height=900,original=False))
print(json.dumps(rows))`,project],{encoding:'utf8'}));
          for(const codec of codecs){
            update(body+'\n\n![codec]('+codec.rel+')\n\nCODEC_END');
            await until(()=>run(`!!document.querySelector(${JSON.stringify(alias('codec'))})`),'codec tile');
            await run(`document.querySelector(${JSON.stringify(alias('codec'))}).scrollIntoView({block:'center'});true`);await until(()=>aliasReady('codec'),'codec card '+codec.rel);
            const sourceHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(project,codec.rel))).digest('hex');
            if(codec.original){
              await until(()=>run(`!!window.__galleryUrls.hashes.get(document.querySelector(${JSON.stringify(alias('codec'))}).querySelector('img').src)`),'codec card hash');
              const hash=await run(`(async()=>{const i=document.querySelector(${JSON.stringify(alias('codec'))}).querySelector('img');return window.__galleryUrls.hashes.get(i.src);})()`);
              assert.equal(hash,sourceHash,'card preserves container '+codec.rel);
            }
            if(!codec.original){
              assert.equal(await run(`document.querySelector(${JSON.stringify(alias('codec'))}).querySelector('canvas[role=img]')!==null`),true,'static codec uses owned pixels '+codec.rel);
              const pixel=await run(`[...document.querySelector(${JSON.stringify(alias('codec'))}).querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data]`);
              if(codec.rel==='alpha.png')for(let i=0;i<4;i++)assert.ok(Math.abs(pixel[i]-[12,100,240,127][i])<=1,'alpha pixel channel '+i);
              else {assert.ok(pixel[0]>250);assert.ok(pixel[1]<5&&pixel[2]<5);}
            }
            if(codec.animated){
              const colors=new Set();
              for(let i=0;i<12;i++){const point=await run(`(()=>{const r=document.querySelector(${JSON.stringify(alias('codec'))}).querySelector('img').getBoundingClientRect();return {x:Math.floor(r.x+r.width/2),y:Math.floor(r.y+r.height/2),width:1,height:1};})()`);colors.add([...(await web.capturePage(point)).toBitmap()].join(','));await delay(90);}
              assert.ok(colors.size>=2,'card still animates '+codec.rel);
            }
            await run(`document.querySelector(${JSON.stringify(alias('codec'))}).click();true`);await until(()=>run(`(()=>{const i=document.querySelector('[role="dialog"] img');return !!i?.complete&&!!i.naturalWidth;})()`),'codec full viewer');await run(`document.querySelector('[role="dialog"] img').decode().then(()=>true)`);await until(()=>run(`!!window.__galleryUrls.hashes.get(document.querySelector('[role="dialog"] img').src)`),'codec full hash');
            const full=await run(`(async()=>{const i=document.querySelector('[role="dialog"] img');return {width:i.naturalWidth,height:i.naturalHeight,hash:window.__galleryUrls.hashes.get(i.src)};})()`);
            assert.equal(full.width,codec.width);assert.equal(full.height,codec.height);assert.equal(full.hash,sourceHash,'full original bytes '+codec.rel);
            await run(`document.querySelector('[aria-label="Close image viewer"]').click();true`);await until(()=>run(`document.activeElement===document.querySelector(${JSON.stringify(alias('codec'))})`),'codec focus return');await run('document.activeElement.blur();true');
          }
          checks.push('APNG, GIF and WebP cards retain exact source bytes and animate; 16-bit PNG bypasses flattening; oriented JPEG and alpha PNG originals retain exact bytes/dimensions.');
        }

      }
      if (config.surface === 'file') {
        await run(`[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent.trim()==='Memory').focus();true`);
        web.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); web.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
        if (!config.noObserver) await until(() => run(`window.__galleryUrls.live.size===0&&window.__galleryPixels.live.size===0`), 'hidden Markdown releases image URLs');
        checks.push('Hidden Markdown file preview releases all its image resources.');
      }
      assert.equal(await run('window.__galleryPixels.zeroed'),true,'every closed bitmap releases its dimensions');
      checks.push('Transferred/decoded ImageBitmaps close to zero dimensions; no strong diagnostic references retain their pixels.');
    }
    const report = { config, versions: process.versions, phases, checks, visits, reads, requests, maximumReads: maximum, scope: 'Private Linux source Electron. Scroll request to decoded DOM includes IPC/polling; no canvas pixel checks in memory cohorts. Exact full-source pixels only in functional checks, outside timing samples; not physical input-to-paint. Fixed settling waits are outside visit times. Natural and explicit diagnostic cohorts are separate processes. Complete app-tree PSS only; no model/GPU-driver memory claim.' };
    fs.writeFileSync(config.output, JSON.stringify(report, null, 2) + '\n'); clearTimeout(deadline); web.debugger.detach(); app.quit();
  })().catch(async error => { console.error(error.stack); if (config.failureOutput) fs.writeFileSync(config.failureOutput, JSON.stringify({ error: error.stack, config, phases, state: await state().catch(() => null), geometry: await geometry().catch(() => null), focus: await run(`({label:document.activeElement?.getAttribute('aria-label'),tag:document.activeElement?.tagName})`).catch(() => null), dom: await run(`Array.from(document.querySelectorAll('button[aria-label^=\"Expand image:\"]')).map(b=>({label:b.getAttribute('aria-label'),busy:b.getAttribute('aria-busy'),rect:b.getBoundingClientRect().toJSON(),images:[...b.querySelectorAll('img,canvas[role=img]')].map(i=>({tag:i.tagName,complete:i.complete,width:i.naturalWidth,height:i.naturalHeight,rect:i.getBoundingClientRect().toJSON(),src:i.src,loading:i.loading}))}))`).catch(() => null) }, null, 2)); if(config.failureOutput)fs.writeFileSync(config.failureOutput+'.png',(await web.capturePage()).toPNG()); app.exit(1); }); });
});
require(path.join(repo, 'desktop/main.js'));
