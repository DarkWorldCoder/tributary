'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { app } = require('electron'), { sample } = require('./app-memory.cjs');
const config = JSON.parse(fs.readFileSync(process.env.TRIBUTARY_ATTACHMENT_CASE, 'utf8'));
process.env.TRIBUTARY_DATA_DIR = config.profile; fs.mkdirSync(config.profile, { recursive: true });
const core = require(path.join(config.repo, 'core')), Base = core.Hub;
const seed = new Base({ dataDir: config.profile, home: path.dirname(config.profile), secrets: new core.MemorySecrets() });
const thread = seed.createThread(config.project, 'Attachment fixture'), originals = [], metadata = [];
for (let offset = 0; offset < config.images.length; offset += 4) {
  const rows = config.images.slice(offset, offset + 4), files = rows.map(row => ({ name: row.rel, base64: fs.readFileSync(path.join(config.imagesRoot, row.rel)).toString('base64') }));
  metadata.push(...seed.addAttachments(files)); originals.push(...rows);
}
let textBytes = Buffer.from('TEXT_PREVIEW_START\n' + ((config.verify || config.textOnly) ? 'Reference 日本語 Ω\n'.repeat(300000) : 'Small text reference.'));
const expectedText = config.verify ? textBytes.subarray(0,256*1024).toString('utf8') + '\n\n… Preview limited to 256 KB.' : null;
const [text] = seed.addAttachments([{ name: 'large-notes.md', base64: textBytes.toString('base64') }]);
textBytes = null; // The fixture must not keep the full upload buffer alive.
const addMessage = (attachments, index, content = 'Reference files ' + index) => thread.messages.push({ id: 'user-' + index, role: 'user', target: 'claude', text: content, attachments, ts: 1000 + index });
addMessage([metadata[0]], 0); addMessage([metadata[0]], 1);
for (let at = 1; at < metadata.length; at += 2) addMessage(metadata.slice(at, at + 2), at + 1, 'REFERENCE ' + at + '\n\n' + 'A paragraph between reference groups.\n\n'.repeat(4));
addMessage([text], 999);
thread.messages.push({ id: 'reply', role: 'assistant', agent: 'claude', mode: 'read', text: 'ATTACHMENTS_END', tools: [], files: [], notices: [], permissions: [], trace: [], ok: true, ts: 2999 });
seed.store.save(true); seed.fileWatches.close(); seed.store.close();
let hub, active = 0, maximum = 0, gate; const reads = [], requests = [];
core.Hub = class extends Base {
  constructor(...args) { super(...args); hub = this; }
  async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; }
  async gitInfo() { return { branch: 'fixture', changed: [], stat: '' }; }
  async readAttachment(id, options) {
    const isImage = id !== text.id; if (isImage) maximum = Math.max(maximum, ++active);
    requests.push({ id, kind: options?.preview || 'legacy', binary: !!options?.bytesOnly });
    try { if (gate?.id === id) await gate.promise; const result = await super.readAttachment(id, options); reads.push({ id, kind: options?.preview || 'legacy', base64Chars: result.base64?.length || 0, binaryBytes: result.bytes?.byteLength || 0, contentChars: result.content?.length || 0, truncated: result.truncated }); return result; }
    finally { if (isImage) active--; }
  }
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, name) => { const end = Date.now() + 25000; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + name); await delay(25); } };
let started = false; const timeout = setTimeout(() => { console.error('Attachment fixture deadline'); app.exit(1); }, 240000);
app.on('browser-window-created', (_event, win) => {
  win.setSize(1280, 850); const web = win.webContents;
  const run = code => web.executeJavaScript(code), viewport = '[data-slot="message-scroller-viewport"]';
  const selector = (name, index = 0) => `document.querySelectorAll(${JSON.stringify('[aria-label="Preview ' + name + '"]')})[${index}]`;
  const card = (name, index = 0) => run(`(()=>{const b=${selector(name,index)},i=b?.querySelector('img,canvas');if(!i||(i.tagName==='IMG'?!i.complete||!i.naturalWidth:!i.width)||b.getAttribute('aria-busy')==='true')return null;const r=i.getBoundingClientRect();return {width:i.naturalWidth||i.width,height:i.naturalHeight||i.height,w:r.width,h:r.height,src:i.src||null,canvas:i.tagName==='CANVAS',bitmap:i.__attachmentBitmap??null};})()`);
  const reveal = async (name, index = 0) => {
    await run(`document.querySelector(${JSON.stringify(viewport)}).dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-1}));${selector(name,index)}.scrollIntoView({block:'center'});true`);
    const start = performance.now(); await until(() => card(name,index), 'attachment card ' + name); const value = await card(name,index);
    assert.equal(value.w,48); assert.equal(value.h,48);
    if (config.optimized && !config.noBitmap && originals.find(row=>row.rel===name)?.owned !== false) { assert.equal(value.canvas,true);assert.equal(value.width,96);assert.equal(value.height,96); }
    await delay(120); return { decodedMs:performance.now()-start, value };
  };
  const state = () => run(`(()=>{const root=document.querySelector(${JSON.stringify(viewport)}),key=Object.keys(root).find(k=>k.startsWith('__reactFiber$'));let f=root[key];while(f.return)f=f.return;f=f.stateNode?.current||f;const stack=[f],seen=new Set(),bodies=new Set();while(stack.length){const node=stack.pop();if(!node||seen.has(node))continue;seen.add(node);stack.push(node.child,node.sibling,node.alternate);let h=node.memoizedState,count=0;while(h&&count++<1000){for(const v of [h.memoizedState,h.memoizedState?.current,h.memoizedState?.[0]]){if(typeof v==='string'&&v.startsWith('TEXT_PREVIEW_START'))bodies.add(v);if(v?.body?.content?.startsWith?.('TEXT_PREVIEW_START'))bodies.add(v.body.content);}h=h.next;}}return {urls:window.__attachmentUrls.live.size,created:window.__attachmentUrls.created,revoked:window.__attachmentUrls.revoked,canvases:root.querySelectorAll('[aria-label^="Preview "] canvas').length,images:root.querySelectorAll('[aria-label^="Preview "] img').length,cards:root.querySelectorAll('[aria-label^="Preview "]').length,textPreviewChars:[...bodies].reduce((n,s)=>n+s.length,0),bitmaps:window.__attachmentPixels?.live.size??null};})()`);
  const phases = [], checks = [], visits = [];
  const snapshot = async label => { await delay(600); const natural = {heap:await web.debugger.sendCommand('Runtime.getHeapUsage'),processTree:sample(process.pid),state:await state()};let retained=null;if(config.diagnostic){await web.debugger.sendCommand('HeapProfiler.collectGarbage');await delay(200);retained={heap:await web.debugger.sendCommand('Runtime.getHeapUsage'),processTree:sample(process.pid),state:await state()};}phases.push({label,natural,retained});console.log('Attachment checkpoint',label); };
  const closeDialog = async () => { await run(`document.querySelector('[aria-label="Close attachment preview"]').click();true`);await until(()=>run(`!document.querySelector('[aria-label="Close attachment preview"]')`),'closed attachment dialog'); };
  web.once('did-finish-load',()=>{if(started)return;started=true;(async()=>{
    web.debugger.attach('1.3');await web.debugger.sendCommand('Page.enable');
    await web.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.__attachmentUrls={live:new Set(),hashes:new Map(),created:0,revoked:0};URL.createObjectURL=b=>{const u=create(b);window.__attachmentUrls.live.add(u);window.__attachmentUrls.created++;${config.verify?`b.arrayBuffer().then(bytes=>crypto.subtle.digest('SHA-256',bytes)).then(hash=>{if(window.__attachmentUrls.live.has(u))window.__attachmentUrls.hashes.set(u,[...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join(''));});`:''}return u;};URL.revokeObjectURL=u=>{window.__attachmentUrls.live.delete(u);window.__attachmentUrls.hashes.delete(u);window.__attachmentUrls.revoked++;revoke(u);};${config.verify?`const ids=new WeakMap(),live=new Set();let next=0;window.__attachmentPixels={live,zeroed:true};const track=b=>{ids.set(b,++next);live.add(next);return b;},createBitmap=createImageBitmap;window.createImageBitmap=async(...args)=>track(await createBitmap(...args));const transfer=OffscreenCanvas.prototype.transferToImageBitmap;OffscreenCanvas.prototype.transferToImageBitmap=function(...args){return track(transfer.apply(this,args));};const close=ImageBitmap.prototype.close;ImageBitmap.prototype.close=function(){const result=close.call(this);if(live.delete(ids.get(this)))window.__attachmentPixels.zeroed&&=this.width===0&&this.height===0;return result;};const draw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(input,...args){const result=draw.call(this,input,...args);if(ids.has(input))this.canvas.__attachmentBitmap=ids.get(input);return result;};`:''}${config.noObserver?'delete window.IntersectionObserver;':''}${config.noBitmap?'delete window.createImageBitmap;delete window.OffscreenCanvas;':''}})()`});
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(config.project))});localStorage.setItem('tributary.thread',${JSON.stringify(JSON.stringify(thread.id))});localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(config.project)}]:{layout:'chat',expanded:false,panel:{open:false,tab:'files'}}}));true`);
    const loaded=new Promise(resolve=>web.once('did-finish-load',resolve));web.reload();await loaded;
    await until(()=>run(`document.querySelectorAll('[aria-label^="Preview "]').length===${metadata.length+2}`),'attachment cards');await snapshot('initial');
    for(const direction of ['forward','reverse']){const rows=direction==='forward'?originals:[...originals].reverse();for(const row of rows){const result=await reveal(row.rel);visits.push({walk:direction,rel:row.rel,decodedMs:result.decodedMs});}await snapshot(direction);}
    checks.push('Every attachment card decodes with a stable 48-by-48 display footprint.');
    if(config.verify){
      await reveal(originals[0].rel);if(config.evidence)fs.writeFileSync(config.evidence,(await web.capturePage()).toPNG());
      await until(()=>card(originals[0].rel,1),'duplicate card');const a=await card(originals[0].rel),b=await card(originals[0].rel,1);assert.equal(a.bitmap||a.src,b.bitmap||b.src);checks.push('Duplicate attachments share a thumbnail resource across separate messages.');
      for(const row of originals){
        await reveal(row.rel);const c=await card(row.rel);
        if(c.canvas&&row.centerPixel){const pixel=await run(`[...${selector(row.rel)}.querySelector('canvas').getContext('2d').getImageData(48,48,1,1).data]`);for(let at=0;at<4;at++)assert.ok(Math.abs(pixel[at]-row.centerPixel[at])<=2,'center crop channel '+at+' '+row.rel);}
        if(row.animated){const colors=new Set();for(let i=0;i<12;i++){const point=await run(`(()=>{const r=${selector(row.rel)}.querySelector('img').getBoundingClientRect();return {x:Math.floor(r.x+r.width/2),y:Math.floor(r.y+r.height/2),width:1,height:1};})()`);colors.add([...(await web.capturePage(point)).toBitmap()].join(','));await delay(90);}assert.ok(colors.size>=2,'animation '+row.rel);}
        await run(`${selector(row.rel)}.click();true`);await until(()=>run(`(()=>{const i=document.querySelector('[role="dialog"] img');return !!i?.complete&&!!i.naturalWidth;})()`),'full image '+row.rel);await run(`document.querySelector('[role="dialog"] img').decode().then(()=>true)`);
        await until(()=>run(`window.__attachmentUrls.hashes.has(document.querySelector('[role="dialog"] img').src)`),'full image hash');
        const full=await run(`(()=>{const i=document.querySelector('[role="dialog"] img');return {width:i.naturalWidth,height:i.naturalHeight,src:i.src,hash:window.__attachmentUrls.hashes.get(i.src)};})()`);assert.equal(full.width,row.width);assert.equal(full.height,row.height);assert.equal(full.hash,crypto.createHash('sha256').update(fs.readFileSync(path.join(config.imagesRoot,row.rel))).digest('hex'));
        await run(`document.querySelector('[role="dialog"] [aria-label="Actual size (1)"]').click();true`);await until(()=>run(`document.querySelector('[role="dialog"] img').style.width===${JSON.stringify(row.width+'px')}`),'actual image size');await run(`document.querySelector(${JSON.stringify(viewport)}).scrollTop=100000;document.activeElement?.blur();true`);await delay(250);
        assert.equal(await run(`document.querySelector('[role="dialog"] img').src`),full.src,'offscreen dialog stays pinned');assert.equal(await run(`window.__attachmentUrls.live.has(${JSON.stringify(full.src)})`),true);
        await closeDialog();await until(()=>run(`document.activeElement===${selector(row.rel)}`),'attachment focus return');await until(()=>run(`!window.__attachmentUrls.live.has(${JSON.stringify(full.src)})`),'original resource release');await run('document.activeElement.blur();true');
      }
      checks.push('Cropped static thumbnails preserve center pixels; originals retain exact source hashes/dimensions, 1:1 controls, offscreen dialog pinning and focus return.');
      checks.push('Animated cards still animate through their original containers.');
      await reveal(originals[0].rel);await run(`${selector(originals[0].rel)}.click();true`);await until(()=>run(`!!document.querySelector('[role="dialog"] img')?.naturalWidth`),'source-change original');
      const replacedSource=await run(`document.querySelector('[role="dialog"] img').src`),changed=hub.thread(thread.id).messages.find(m=>m.id==='user-0');changed.attachments=[metadata[1]];hub.emit('message',{threadId:thread.id,message:changed});
      await until(()=>run(`!document.querySelector('[aria-label="Close attachment preview"]')`),'source change closes old dialog');await until(()=>run(`!window.__attachmentUrls.live.has(${JSON.stringify(replacedSource)})`),'source change releases old original');checks.push('Replacing the attachment closes its old dialog and releases its original source independently of remaining thumbnail duplicates.');
      await run(`${selector(text.name)}.scrollIntoView({block:'center'});${selector(text.name)}.click();true`);await until(()=>run(`document.querySelector('pre[aria-label="Contents of large-notes.md"]')?.textContent.startsWith('TEXT_PREVIEW_START')`),'bounded text preview');
      const value=await run(`document.querySelector('pre[aria-label="Contents of large-notes.md"]').textContent`);assert.equal(value,expectedText);assert.ok(reads.some(r=>r.id===text.id&&r.kind==='text'&&r.base64Chars===0&&r.contentChars<=256*1024));
      await run(`(()=>{const p=document.querySelector('pre[aria-label="Contents of large-notes.md"]'),key=Object.keys(p).find(k=>k.startsWith('__reactFiber$'));let f=p[key],body;while(f){if(f.memoizedProps?.body){body=f.memoizedProps.body;break;}f=f.return;}if(!body)throw Error('No text resource');window.__attachmentText={body:new WeakRef(body),element:new WeakRef(p)};return true;})()`);
      await closeDialog();await until(()=>run(`(!window.__attachmentText.body.deref()||window.__attachmentText.body.deref().content===null)&&(!window.__attachmentText.element.deref()||window.__attachmentText.element.deref().textContent==='')`),'closed text resource cleared');assert.equal((await state()).textPreviewChars,0);checks.push('Text preview matches its exact bounded prefix; close clears its resource and DOM even if an old Fiber remains.');
      const slow=hub.addAttachments([{name:'slow.png',base64:fs.readFileSync(path.join(config.imagesRoot,originals[0].rel)).toString('base64')}])[0];let release;gate={id:slow.id,promise:new Promise(resolve=>{release=resolve;})};const last=hub.thread(thread.id).messages.find(m=>m.id==='user-999');last.attachments=[text,slow];hub.emit('message',{threadId:thread.id,message:last});
      await until(()=>run(`!!${selector(slow.name)}`),'slow attachment');await run(`${selector(slow.name)}.scrollIntoView({block:'center'});${selector(slow.name)}.click();true`);await until(()=>run(`!!document.querySelector('[aria-label="Close attachment preview"]')`),'pending attachment dialog');await closeDialog();last.attachments=[];hub.emit('message',{threadId:thread.id,message:last});release();gate=null;await until(()=>active===0,'late reads settled');checks.push('Closing/removing a pending attachment discards its late body.');
    }else if(config.textOnly){
      for(let cycle=0;cycle<=config.cycles;cycle++){
        await run(`${selector(text.name)}.scrollIntoView({block:'center'});${selector(text.name)}.click();true`);
        await until(()=>run(`document.querySelector('pre[aria-label="Contents of large-notes.md"]')?.textContent.startsWith('TEXT_PREVIEW_START')`),'text memory preview');await snapshot('text-open-'+cycle);
        await closeDialog();await run('document.activeElement.blur();true');await snapshot('text-closed-'+cycle);if(config.optimized)assert.equal((await state()).textPreviewChars,0);
      }
    }else{
      for(let cycle=1;cycle<=config.cycles;cycle++){for(const row of originals)await reveal(row.rel);for(const row of [...originals].reverse())await reveal(row.rel);await snapshot('cycle-'+cycle);}
    }
    for(const message of hub.thread(thread.id).messages)if(message.attachments?.length){message.attachments=[];hub.emit('message',{threadId:thread.id,message});}
    await until(()=>run(`document.querySelectorAll('[aria-label^="Preview "]').length===0`),'cleared attachment cards');await snapshot('cleared');await delay(2500);await snapshot('cleared-settled');
    if(config.optimized){const last=await state();assert.equal(last.urls,0);assert.equal(last.canvases,0);assert.equal(last.textPreviewChars,0);if(config.verify){assert.equal(last.bitmaps,0);assert.equal(await run('window.__attachmentPixels.zeroed'),true);}assert.ok(maximum<=2,'shared image read admission');checks.push('Removing all cards releases URLs, pixel surfaces and preview bodies with at most two concurrent image reads.');}
    fs.writeFileSync(config.output,JSON.stringify({config,versions:process.versions,phases,checks,visits,requests,reads,maximumImageReads:maximum,scope:'Private Linux source Electron/Xvfb. Native correctness and ordinary/diagnostic memory are separate. No forced GC outside diagnostic cases; no pixel/hash/full-dialog work in memory cases. Checkpoints are not continuous peaks, input-to-paint or model VRAM.'},null,2)+'\n');clearTimeout(timeout);web.debugger.detach();app.quit();
  })().catch(async error=>{console.error(error.stack);fs.writeFileSync(config.failureOutput,JSON.stringify({error:error.stack,config,phases,state:await state().catch(()=>null),dom:await run(`Array.from(document.querySelectorAll('[aria-label^="Preview "]')).map(b=>({name:b.getAttribute('aria-label'),busy:b.getAttribute('aria-busy'),disabled:b.disabled,rect:b.getBoundingClientRect().toJSON(),media:[...b.querySelectorAll('img,canvas')].map(i=>({tag:i.tagName,width:i.width,natural:i.naturalWidth,complete:i.complete}))}))`).catch(()=>null)},null,2));fs.writeFileSync(config.failureOutput+'.png',(await web.capturePage()).toPNG());app.exit(1);});});
});
require(path.join(config.repo,'desktop/main.js'));
