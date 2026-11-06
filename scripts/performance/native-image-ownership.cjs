'use strict';
// Isolated source app: no user profile, agent, remote image or production GC.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), { app } = require('electron');
const config = JSON.parse(fs.readFileSync(process.env.TRIBUTARY_IMAGE_CASE, 'utf8'));
console.log('Native image fixture starting');
const repo = path.resolve(config.repo), root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-image-app-'));
const project = config.project, profile = path.join(root, 'profile');
process.env.TRIBUTARY_DATA_DIR = profile;
const core = require(path.join(repo, 'core'));
const { sample } = require(path.join(__dirname, 'app-memory.cjs'));
const reads = []; let active = 0, maximum = 0;
const Original = core.Hub;
const seed = new Original({ dataDir: profile, home: root, secrets: new core.MemorySecrets() });
seed.createThread(project, 'Owned image fixture'); seed.fileWatches.close(); seed.store.close();
require(path.join(repo, 'core/drafts')).save(profile, 'files:' + project, { active: 'main.ts', tabs: [{ rel: 'main.ts', mode: 'edit', pinned: true }] });
core.Hub = class extends Original {
  async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; }
  async gitInfo() { return { branch: 'fixture', changed: [], stat: '' }; }
  async readFile(dir, rel, options) {
    const raster = /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i.test(rel), full = raster && !options?.metadataOnly;
    if (full) maximum = Math.max(maximum, ++active);
    try { const file = await super.readFile(dir, rel, options); reads.push({ rel, metadata: !!options?.metadataOnly, chars: file.base64?.length || 0 }); return file; }
    finally { if (full) active--; }
  }
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { const end = Date.now() + 25000; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + label); await delay(25); } }
let started = false;
const deadline = setTimeout(() => { console.error('Native image deadline'); app.exit(1); }, 180000);
process.on('uncaughtException', error => { console.error(error.stack); app.exit(1); });
app.on('browser-window-created', (_event, win) => {
  win.setSize(1280, 850); const web = win.webContents, run = async code => { try { return await web.executeJavaScript(code); } catch (error) { throw Error(error.message + ' in owned-fixture expression: ' + code.slice(0, 180)); } };
  const key = (keyCode, modifiers = []) => { web.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); web.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); };
  const clickElement = async expression => {
    const tab = await run(`(()=>{const e=${expression};if(!e)throw Error('Missing fixture control');if(e.isContentEditable||e.getAttribute('role')==='tab')e.focus({preventScroll:true});else e.click();return e.getAttribute('role')==='tab';})()`);
    if (tab) key('Enter');
    await delay(25);
  };
  const click = selector => clickElement(`document.querySelector(${JSON.stringify(selector)})`);
  const panel = label => clickElement(`[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent.trim()===${JSON.stringify(label)})`);
  const docs = () => run(`(()=>{const element=document.querySelector('[data-workspace-root]');const prop=Object.keys(element).find(key=>key.startsWith('__reactFiber$'));if(!prop)throw Error('No owned fixture fiber');let fiber=element[prop];while(fiber.return)fiber=fiber.return;fiber=fiber.stateNode?.current||fiber;const stack=[fiber],seen=new Set(),arrays=new Set(),matches=[];while(stack.length){const item=stack.pop();if(!item||seen.has(item))continue;seen.add(item);stack.push(item.child,item.sibling);let hook=item.memoizedState,guard=0;while(hook&&guard++<1000){for(const value of [hook.memoizedState,hook.memoizedState?.current])if(Array.isArray(value)&&!arrays.has(value)&&value.length&&value.every(doc=>typeof doc?.rel==='string'&&typeof doc?.text==='string'&&typeof doc?.dirty==='boolean')){arrays.add(value);matches.push({docs:value.length,encodedChars:value.reduce((n,doc)=>n+(doc.base64?.length||0),0),dirty:value.filter(doc=>doc.dirty).length,paths:value.map(doc=>doc.rel)});}hook=hook.next;}}return matches.sort((a,b)=>b.docs-a.docs)[0]||{docs:0,encodedChars:0};})()`);
  const image = rel => run(`(()=>{const i=[...document.querySelectorAll('img.image-preview-content')].find(i=>i.alt===${JSON.stringify(rel)});if(!i?.complete||!i.naturalWidth)return null;const c=document.createElement('canvas');c.width=c.height=1;c.getContext('2d').drawImage(i,0,0);return {width:i.naturalWidth,height:i.naturalHeight,pixel:[...c.getContext('2d').getImageData(0,0,1,1).data],blob:i.src.startsWith('blob:')};})()`);
  const open = async rel => {
    key('p', ['control']); await until(() => run(`document.activeElement===document.querySelector('.file-picker input')`), 'picker focus');
    await web.insertText(rel); await until(() => run(`!!document.querySelector('.file-picker [cmdk-item][data-value="${rel}"]')`), 'picker result'); key('Enter');
  };
  const decoded = async rel => { await until(() => image(rel), 'decode ' + rel); const value = await image(rel); if (config.optimized) assert.equal(value.blob, true); return value; };
  const urls = () => run(`({live:window.__imageUrls.live.size,created:window.__imageUrls.created,revoked:window.__imageUrls.revoked})`);
  const snapshots = [], checks = [];
  const snapshot = async phase => {
    await delay(700);
    const observe = async () => ({ heap: await web.debugger.sendCommand('Runtime.getHeapUsage'), processTree: sample(process.pid), docs: await docs(), urls: await urls() });
    const natural = await observe(); let afterDiagnosticGc = null;
    if (config.diagnostic) { await web.debugger.sendCommand('HeapProfiler.collectGarbage'); await delay(250); afterDiagnosticGc = await observe(); }
    snapshots.push({ phase, natural, afterDiagnosticGc });
  };
  web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
    console.log('Initial page loaded');
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'editor',expanded:true,panel:{open:true,tab:'files'}}}));true`);
    const loaded = new Promise(resolve => web.once('did-finish-load', resolve)); web.reload(); await loaded;
    await until(() => run(`!!document.querySelector('[aria-label="Edit main.ts"]')`), 'initial editor');
    await run(`(()=>{const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.__imageUrls={live:new Set(),created:0,revoked:0};URL.createObjectURL=b=>{const u=create(b);window.__imageUrls.live.add(u);window.__imageUrls.created++;return u;};URL.revokeObjectURL=u=>{if(window.__imageUrls.live.delete(u))window.__imageUrls.revoked++;revoke(u);};return true;})()`);
    web.debugger.attach('1.3'); await snapshot('initial');
    for (const fixture of config.images) { await open(fixture.rel); const value = await decoded(fixture.rel); assert.equal(value.width, fixture.width); assert.equal(value.height, fixture.height); if (fixture.pixel) assert.deepEqual(value.pixel, fixture.pixel); console.log('Decoded', fixture.rel); }
    await snapshot('sixPinnedImagesOneVisible');
    assert.equal((await docs()).docs, config.images.length + 1);
    if (config.optimized) { assert.equal((await docs()).encodedChars, 0); assert.equal((await urls()).live, 1); }
    checks.push('Every real image decodes with expected dimensions and reference pixel; all pinned tabs remain.');
    if (config.verify) {
      const rel = config.images[0].rel;
      await click(`[role="tab"][data-file-path="${rel}"]`); await decoded(rel);
      const beforeSplit = await urls(); await click('[aria-label="Split editor right"]');
      await until(() => run(`document.querySelectorAll('img.image-preview-content').length===2`), 'split images');
      await until(() => run(`[...document.querySelectorAll('img.image-preview-content')].every(i=>i.complete&&i.naturalWidth)`), 'split decode');
      assert.equal((await urls()).live, 1); assert.equal((await urls()).created, beforeSplit.created);
      await click('[data-editor-group][data-focused="true"] [aria-label="Close editor group"]');
      await until(() => run(`document.querySelectorAll('[data-editor-group]').length===1`), 'join group'); await decoded(rel); assert.equal((await urls()).live, 1);
      await click('[aria-label="Expand image"]'); await until(() => run(`!!document.querySelector('[aria-label="Close image viewer"]')`), 'image dialog');
      assert.equal((await urls()).live, 1); await click('[aria-label="Close image viewer"]');
      checks.push('Split groups and expanded dialog share one resource; closing one consumer preserves the image.');
      // Equal file size and restored mtime must still refresh on a real fs event.
      const full = path.join(project, rel), stat = fs.statSync(full), original = fs.readFileSync(full);
      fs.writeFileSync(full, fs.readFileSync(path.join(project, 'replacement.png'))); fs.utimesSync(full, stat.atime, stat.mtime);
      assert.equal(fs.statSync(full).size, stat.size);
      await until(async () => (await image(rel))?.pixel?.join() === '23,87,191,255', 'same-mtime watch pixel');
      fs.writeFileSync(full, original); await until(async () => (await image(rel))?.pixel?.join() === config.images[0].pixel.join(), 'restored watch pixel');
      checks.push('Actual same-size/restored-mtime write and restoration update decoded pixels.');
      await panel('Memory');
      await until(async () => (await urls()).live === 0, 'hidden resources released');
      assert.equal((await docs()).docs, config.images.length + 1);
      await panel('Files'); await decoded(rel);
      assert.equal((await urls()).live, 1); checks.push('Hiding files releases the URL, keeps all tab metadata, and returning decodes again.');
      fs.writeFileSync(full, 'invalid image bytes');
      await until(() => run(`document.querySelector('.image-preview [role="status"]')?.textContent.includes('could not be displayed')`), 'corrupt image fallback');
      const retryBefore = reads.filter(r => r.rel === rel && !r.metadata).length;
      await clickElement(`[...document.querySelectorAll('.image-preview button')].find(e=>e.textContent==='Retry')`);
      await until(() => reads.filter(r => r.rel === rel && !r.metadata).length > retryBefore, 'retry performs a new read');
      fs.writeFileSync(full, original); await decoded(rel);
      checks.push('Corrupt images show a local error; Retry reads again and a later real write recovers.');
      for (const fixture of config.formats) {
        await open(fixture.rel); const value = await decoded(fixture.rel); assert.equal(value.width, fixture.width); assert.equal(value.height, fixture.height);
        if (fixture.rel.endsWith('.svg')) {
          await click('[aria-label="Edit file"]');
          await until(() => run(`!!document.querySelector('[aria-label="Edit vector.svg"]')`), 'SVG source editor');
          await click('[aria-label="Edit vector.svg"]'); key('a', ['control']); await web.insertText('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="24"><rect width="40" height="24" fill="red"/></svg>');
          await until(async () => (await docs()).dirty === 1, 'dirty SVG source');
          const editorState = () => run(`(()=>{const v=document.querySelector('[aria-label="Edit vector.svg"]').cmTile.root.view;const ids=window.__imageViewIds||=( {next:0,views:new WeakMap()} );if(!ids.views.has(v))ids.views.set(v,++ids.next);return {view:ids.views.get(v),length:v.state.doc.length,history:v.state.values.filter(v=>Array.isArray(v?.done)&&Array.isArray(v?.undone)).map(v=>({done:v.done.length,undone:v.undone.length})),redo:document.querySelector('[aria-label="Redo edit"]')?.disabled};})()`);
          console.log('SVG before undo', await editorState());
          key('z', ['control']); await until(async () => (await docs()).dirty === 0, 'source undo');
          console.log('SVG after undo', await editorState());
          await until(() => run(`document.querySelector('[aria-label="Redo edit"]')?.disabled===false`), 'redo enabled');
          await click('[aria-label="Redo edit"]'); await until(async () => (await docs()).dirty === 1, 'source redo');
          await click('[aria-label="Preview file"]'); await until(async () => (await image('vector.svg'))?.width === 40, 'dirty SVG preview');
          await click('[aria-label="Edit file"]'); await until(() => run(`!!document.querySelector('[aria-label="Edit vector.svg"]')`), 'returned SVG source');
          assert.match(await run(`document.querySelector('[aria-label="Edit vector.svg"]').cmTile.root.view.state.doc.toString()`), /width="40" height="24"/);
          await click('[aria-label="Edit vector.svg"]'); key('a', ['control']); await web.insertText(fs.readFileSync(path.join(project, fixture.rel), 'utf8'));
          await until(async () => (await docs()).dirty === 0, 'restored exact SVG source');
        }
        await click(`button[aria-label="Close ${fixture.rel}"]`);
        await until(async () => !(await docs()).paths.includes(fixture.rel), 'closed format tab');
      }
      checks.push('JPEG, GIF, WebP, BMP, ICO, AVIF and SVG decode; SVG source-mode undo/redo and unsaved text across preview are verified. History across editor unmount is outside this check.');
      await open('too-large.png'); await until(() => run(`document.querySelector('.image-preview [role="status"]')?.textContent.includes('16 MB')`), 'oversized image limit');
      assert.equal(reads.filter(r => r.rel === 'too-large.png' && !r.metadata).length, 0); await click('button[aria-label="Close too-large.png"]');
      checks.push('Oversized raster shows the limit and never requests its body.');
      await click(`[role="tab"][data-file-path="${rel}"]`); await decoded(rel);
      const drafts = require(path.join(repo, 'core/drafts'));
      await until(() => drafts.read(profile, 'files:' + project)?.tabs.length === config.images.length + 1, 'recovery tab snapshot');
      const readAt = reads.length;
      await web.debugger.sendCommand('Page.enable');
      await web.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.__imageUrls={live:new Set(),created:0,revoked:0};URL.createObjectURL=b=>{const u=create(b);window.__imageUrls.live.add(u);window.__imageUrls.created++;return u;};URL.revokeObjectURL=u=>{if(window.__imageUrls.live.delete(u))window.__imageUrls.revoked++;revoke(u);};})()` });
      const reloaded = new Promise(resolve => web.once('did-finish-load', resolve)); web.reload(); await reloaded; await decoded(rel);
      await until(() => run(`!!window.__imageUrls`), 'new-document URL instrumentation');
      await until(async () => (await docs()).docs === config.images.length + 1, 'restored pinned tabs');
      assert.equal((await docs()).encodedChars, 0); assert.equal((await urls()).live, 1);
      assert.ok(reads.slice(readAt).filter(r => /\.png$/.test(r.rel) && !r.metadata).every(r => r.rel === rel));
      checks.push('Real renderer reload restores every pinned tab but loads only the visible raster payload.');
      if (config.evidence) fs.writeFileSync(config.evidence, (await web.capturePage()).toPNG());
    }
    const keep = config.verify ? config.images[0].rel : config.images.at(-1).rel;
    for (const fixture of config.images.filter(f => f.rel !== keep)) await click(`button[aria-label="Close ${fixture.rel}"]`);
    await until(async () => (await docs()).docs === 2, 'closed image docs'); await snapshot('closedFiveImagesOneVisible');
    const report = { config, versions: process.versions, nativeBase64: await run(`typeof Uint8Array.fromBase64==='function'`), snapshots, checks, reads, maximumFullReads: maximum, scope: 'Linux source Electron, private profile and real local images. DOM-ready and decoded pixels, not paint timing. Diagnostic GC only when explicitly configured; later natural snapshots in that cohort follow earlier diagnostic collections. Complete process-tree PSS only; native browser caches remain included. No external model or GPU-driver memory claim.' };
    fs.writeFileSync(config.output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ output: config.output, checks: checks.length, snapshots: snapshots.length }));
    web.debugger.detach(); clearTimeout(deadline); app.quit();
  })().catch(async error => { console.error(error.stack); if (config.evidence) fs.writeFileSync(config.evidence, (await web.capturePage()).toPNG()); app.exit(1); }); });
});
app.on('quit', () => fs.rmSync(root, { recursive: true, force: true }));
require(path.join(repo, 'desktop/main.js'));
