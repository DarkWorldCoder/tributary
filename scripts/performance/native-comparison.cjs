'use strict';
// Comparison host: real Tributary app, clean profile, real shared benchmark files.
const fs = require('node:fs'), path = require('node:path'); const { app } = require('electron');
const project = process.env.TRIBUTARY_COMPARE_PROJECT, profile = process.env.TRIBUTARY_COMPARE_PROFILE;
if (!project || !profile || !path.isAbsolute(project) || !path.isAbsolute(profile)) throw Error('Use the comparison driver.');
process.env.TRIBUTARY_DATA_DIR = profile;
const core = require('../../core'), drafts = require('../../core/drafts');
const seed = new core.Hub({ dataDir: profile, home: profile, secrets: new core.MemorySecrets() }); seed.createThread(project, 'Large project navigation'); seed.fileWatches.close(); seed.store.close();
drafts.save(profile, 'files:' + project, { active: 'bench0000.ts', tabs: [{ rel: 'bench0000.ts', mode: 'edit', pinned: true }] });
core.Hub = class extends core.Hub { async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; } };
let seeded = false;
app.on('browser-window-created', (_event, win) => { win.setSize(1280, 900);
  // Explicit diagnostic cohort only. Never enable this for timing/RAM results.
  const trace = process.env.TRIBUTARY_COMPARE_FOCUS_TRACE;
  if (trace) {
    const web = win.webContents;
    web.on('did-finish-load', () => void web.executeJavaScript(`(() => {
      const rows = []; window.__comparisonFocus = rows;
      const describe = e => e ? { tag: e.tagName, label: e.getAttribute?.('aria-label'), role: e.getAttribute?.('role'), class: typeof e.className === 'string' ? e.className.slice(0,160) : '', connected: e.isConnected } : null;
      window.__comparisonDescribeFocus = describe;
      const add = row => { if(rows.length < 2000) rows.push({time:performance.now(),origin:performance.timeOrigin,...row}); };
      const focus = HTMLElement.prototype.focus;
      HTMLElement.prototype.focus = function(...args) { add({kind:'call',target:describe(this),stack:new Error().stack.slice(0,1600)}); return focus.apply(this,args); };
      for(const kind of ['focusin','focusout']) document.addEventListener(kind,e=>add({kind,target:describe(e.target),related:describe(e.relatedTarget)}),true);
      document.addEventListener('keydown',e=>{if(e.key==='Enter'||e.ctrlKey)add({kind:'key',key:e.key,target:describe(e.target)});},true);
      return true;
    })()`).catch(() => {}));
    let pending = false;
    const timer = setInterval(() => {
      if (pending || web.isDestroyed()) return; pending = true;
      void web.executeJavaScript(`({active:window.__comparisonDescribeFocus?.(document.activeElement),rows:window.__comparisonFocus?.splice(0) || []})`).then(value => {
        fs.appendFileSync(trace, JSON.stringify({at:Date.now(),...value})+'\n');
      }).catch(() => {}).finally(() => { pending = false; });
    }, 100);
    win.once('closed', () => clearInterval(timer));
  }
  win.webContents.once('did-finish-load', async () => {
  if (seeded) return; seeded = true;
  await win.webContents.executeJavaScript(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.theme','\"dark\"');localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'editor',expanded:true,panel:{open:true,tab:'files'}}}));true`);
  win.webContents.reload();
}); });
require('../../desktop/main.js');
