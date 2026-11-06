'use strict';
// Real repository screenshots. Only provider discovery is disabled. No fake replies.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { app } = require('electron');
const repo = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-readme-'));
process.env.TRIBUTARY_DATA_DIR = profile;
const core = require('../core'), drafts = require('../core/drafts');
const seed = new core.Hub({ dataDir: profile, home: profile, secrets: new core.MemorySecrets() });
const thread = seed.createThread(repo, 'Explore Tributary');
seed.fileWatches.close(); seed.store.close();
drafts.save(profile, 'files:' + repo, { active: 'desktop/updates.js', tabs: [{ rel: 'desktop/updates.js', pinned: true, mode: 'edit' }, { rel: 'core/shortcuts.mjs', pinned: true, mode: 'edit' }] });
core.Hub = class extends core.Hub { async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { const end = Date.now() + 20000; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + label); await delay(50); } }
let started = false; const deadline = setTimeout(() => app.exit(1), 90000);
app.on('browser-window-created', (_event, win) => {
  win.setSize(1680, 1050); const web = win.webContents, run = code => web.executeJavaScript(code);
  const tab = async selector => { await run(`document.querySelector(${JSON.stringify(selector)}).focus();true`); web.sendInputEvent({type:'keyDown',keyCode:'Enter'});web.sendInputEvent({type:'char',keyCode:'\r'});web.sendInputEvent({type:'keyUp',keyCode:'Enter'});await delay(100); };
  web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
    await run(`localStorage.setItem('tributary.project', ${JSON.stringify(JSON.stringify(repo))}); localStorage.setItem('tributary.thread', ${JSON.stringify(JSON.stringify(thread.id))}); localStorage.setItem('tributary.theme','"dark"'); localStorage.setItem('tributary.workspaceViews.v1', JSON.stringify({[${JSON.stringify(repo)}]:{layout:'editor',expanded:false,panel:{open:true,tab:'files'}}}));true`);
    const loaded = new Promise(resolve => web.once('did-finish-load', resolve)); web.reload(); await loaded;
    await until(() => run(`!!document.querySelector('.cm-content') && !!document.querySelector('.workspace-explorer')?.offsetWidth`), 'source and file sidebar');
    // Collapse the separate projects/chats flyout; the actual file explorer stays open.
    await run(`document.querySelector('[aria-label="Toggle project list"]')?.click();true`); await delay(200);
    await run(`window.dispatchEvent(new Event('tributary:explorer'));true`);
    await until(() => run(`!!document.querySelector('[aria-label="Project files"] button[title="desktop"]')`), 'repository folder');
    await run(`document.querySelector('[aria-label="Project files"] button[title="desktop"]').click();true`);
    await until(() => run(`document.querySelector('[aria-label="Project files"]')?.textContent.includes('updates.js')`), 'actual repository files');
    await delay(1000);
    fs.mkdirSync(path.join(repo, 'docs/media'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs/media/workbench.png'), (await web.capturePage()).toPNG());
    await tab('[data-editor-group="editor-1"] [data-file-path="core/shortcuts.mjs"]');
    await until(() => run(`!!document.querySelector('[data-editor-group="editor-1"] [aria-label="Edit core/shortcuts.mjs"]')`), 'exact repository source');
    await run(`window.dispatchEvent(new Event('tributary:split-editor'));true`);
    await until(() => run(`document.querySelectorAll('[data-editor-group] .cm-content').length===2`), 'split editors');
    await tab('[data-editor-group="editor-1"] [data-file-path="desktop/updates.js"]');
    await until(() => run(`!!document.querySelector('[data-editor-group="editor-2"] [aria-label="Edit core/shortcuts.mjs"]')`), 'second source file');
    await delay(500);
    fs.writeFileSync(path.join(repo, 'docs/media/split-editors.png'), (await web.capturePage()).toPNG());
    if (process.argv.includes('--verify-docs')) {
      await run(`window.dispatchEvent(new Event('tributary:quick-open'));true`);
      await until(() => run(`!!document.querySelector('.file-picker input')`), 'README picker');
      await run(`{const e=document.querySelector('.file-picker input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'README.md');e.dispatchEvent(new Event('input',{bubbles:true}));};true`);
      await until(() => run(`!!document.querySelector('.file-picker [cmdk-item][data-value="README.md"]')`), 'exact README');
      await run(`document.querySelector('.file-picker [cmdk-item][data-value="README.md"]').click();true`);
      await until(() => run(`document.querySelector('[aria-label="File preview"]')?.textContent.includes('Your agents.')`), 'README preview');
      const selector = '[aria-label="File preview"] button[aria-label^="Expand image:"]';
      const count = await run(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
      if (count < 4) throw Error('README local images missing');
      const images=[];
      for (let i=0;i<count;i++) {
        await run(`document.querySelectorAll(${JSON.stringify(selector)})[${i}].scrollIntoView({block:'center'});true`);
        await until(() => run(`{const img=document.querySelectorAll(${JSON.stringify(selector)})[${i}].querySelector('img');!!img?.complete && img.naturalWidth>0}`), 'README image '+i);
        images.push(await run(`{const img=document.querySelectorAll(${JSON.stringify(selector)})[${i}].querySelector('img');({alt:img.alt,width:img.naturalWidth,height:img.naturalHeight})}`));
      }
      if (images[0].width !== 1200 || images[0].height !== 280) throw Error('Brand banner intrinsic size is incorrect');
      await run(`document.querySelectorAll(${JSON.stringify(selector)})[${count-1}].click();true`);
      await until(() => run(`{const dialog=document.querySelector('.image-dialog[data-state="open"]');!!dialog?.querySelector('img')?.naturalWidth && dialog.getBoundingClientRect().width>0 && Number(getComputedStyle(dialog).opacity)>.99}`), 'expanded benchmark figure');
      await delay(250);
      fs.writeFileSync('/tmp/tributary-readme-expanded.png',(await web.capturePage()).toPNG());
      fs.writeFileSync(path.join(repo,'docs/performance/readme-images.json'),JSON.stringify({passed:true,date:new Date().toISOString(),images,expanded:true,scope:'Real repository README in Tributary Markdown preview; local SVG/PNG figures loaded and image dialog opened. Remote badge images are external links in this viewer. GitHub rendering and network badges are separate.'},null,2)+'\n');
    }
    console.log(JSON.stringify({ passed: true, project: repo, files: ['desktop/updates.js','core/shortcuts.mjs'], sidebarVisible: await run(`!!document.querySelector('.workspace-explorer')?.offsetWidth`), scope: 'Actual source UI and repository; isolated temporary profile, no providers or generated assistant messages.' }));
    clearTimeout(deadline); app.quit();
  })().catch(async error => { console.error(error.stack); console.error(await run(`JSON.stringify({active:document.activeElement?.outerHTML.slice(0,200),groups:[...document.querySelectorAll('[data-editor-group]')].map(e=>({id:e.dataset.editorGroup,text:e.textContent.slice(0,150),labels:[...e.querySelectorAll('[aria-label]')].map(x=>x.getAttribute('aria-label'))}))})`)); fs.writeFileSync('/tmp/tributary-readme-failure.png',(await web.capturePage()).toPNG());app.exit(1); }); });
});
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
require('../desktop/main.js');
