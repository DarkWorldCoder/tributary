'use strict';
// Run with Electron against a built source checkout; all files/profile are temporary.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { app } = require('electron');
const repo = path.resolve(process.env.TRIBUTARY_PREVIEW_REPO || path.join(__dirname, '../..'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-preview-ui-')), project = path.join(root, 'project'), profile = path.join(root, 'profile');
const marker = 'PREVIEW_OWNERSHIP_FIXTURE_', original = `export function greet(){const name="${marker}${'x'.repeat(65536)}";return name;}\n`;
fs.mkdirSync(project); fs.writeFileSync(path.join(project, 'main.ts'), original);
fs.writeFileSync(path.join(project, '.prettierrc.json'), JSON.stringify({ singleQuote: true, semi: false }));
process.env.TRIBUTARY_DATA_DIR = profile;
const core = require(path.join(repo, 'core')), drafts = require(path.join(repo, 'core/drafts'));
const seed = new core.Hub({ dataDir: profile, home: root, secrets: new core.MemorySecrets() });
seed.createThread(project, 'Formatting preview ownership'); seed.fileWatches.close(); seed.store.close();
drafts.save(profile, 'files:' + project, { active: 'main.ts', tabs: [{ rel: 'main.ts', mode: 'edit', pinned: true }] });
const calls = [], checks = []; let gate = null, gitReads = 0;
core.Hub = class extends core.Hub {
  async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; }
  async gitInfo() { gitReads++; return { branch: 'fixture', changed: [], stat: '' }; }
  async previewFormat(...args) { return this.hold('preview', await super.previewFormat(...args)); }
  async formatDiff(...args) { return this.hold('diff', await super.formatDiff(...args)); }
  async applyFormat(...args) { return this.hold('apply', await super.applyFormat(...args)); }
  async hold(method, result) {
    calls.push({ method, token: result?.token });
    const current = gate;
    if (current?.method === method && !current.entered) {
      current.entered = true;
      await new Promise(resolve => { current.release = resolve; });
      if (current.error) throw Error(current.error);
      if (method === 'diff') return result + '\n+STALE_DIFF_SHOULD_NOT_RETURN\n';
    }
    return result;
  }
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 15000) { const end = Date.now() + timeout; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + label); await delay(30); } }
const deadline = setTimeout(() => { console.error('Formatting preview fixture deadline'); app.exit(1); }, 120000);
let started = false;
app.on('browser-window-created', (_event, win) => {
  win.setSize(1280, 850); const web = win.webContents, run = code => web.executeJavaScript(code);
  const key = keyCode => { web.sendInputEvent({ type: 'keyDown', keyCode }); web.sendInputEvent({ type: 'keyUp', keyCode }); };
  const button = text => run(`(()=>{const e=[...document.querySelectorAll('[role="dialog"] button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e||e.disabled)throw Error('Missing enabled button');e.click();return true;})()`);
  const retained = () => run(`(()=>{const node=document.querySelector('[data-workspace-root]');if(!node)throw Error('Missing workspace');let f=node[Object.keys(node).find(k=>k.startsWith('__reactFiber$'))];while(f.return)f=f.return;const stack=[f.stateNode.current],seen=new Set(),previews=new Set(),diffs=new Set();while(stack.length){const f=stack.pop();if(!f||seen.has(f))continue;seen.add(f);stack.push(f.child,f.sibling,f.alternate);let h=f.memoizedState,n=0;while(h&&n++<100){const v=h.memoizedState;if(v&&typeof v.token==='string'&&Array.isArray(v.rows)&&typeof v.scanned==='number'){previews.add(v.token);if(window.__capturePreview)window.__previewOwnerRef=new WeakRef(v);}if(typeof v==='string'&&v.includes(${JSON.stringify(marker)})&&v.startsWith('--- main.ts'))diffs.add(v);h=h.next;}}return {tokens:[...previews],diffs:diffs.size,diffChars:[...diffs].reduce((n,s)=>n+s.length,0)};})()`);
  const open = async () => {
    await run(`document.querySelector('[aria-label="Open files menu"]').focus();true`); key('Enter');
    await until(() => run(`!![...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent==='Format all files…')`), 'format menu');
    await run(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent==='Format all files…').click();true`);
    await until(() => run(`!!document.querySelector('[role="dialog"]')`), 'dialog open');
  };
  const loaded = () => until(() => run(`!!document.querySelector('[aria-label="Formatting diff"] [aria-label="File comparison"]')`), 'real diff loaded');
  const close = async () => {
    key('Escape'); await until(() => run(`!document.querySelector('[role="dialog"]')`), 'close animation completes');
    await until(async () => { const value = await retained(); return !value.tokens.length && !value.diffs; }, 'closed preview state released', 2500);
  };
  web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'editor',expanded:true,panel:{open:true,tab:'files'}}}));true`);
    const reloaded = new Promise(resolve => web.once('did-finish-load', resolve)); web.reload(); await reloaded;
    await until(() => run(`!!document.querySelector('[aria-label="Edit main.ts"]')`), 'initial editor');
    assert.deepEqual(await retained(), { tokens: [], diffs: 0, diffChars: 0 });
    await open(); await loaded(); await run('window.__capturePreview=true'); const beforeClose = await retained(); await run('window.__capturePreview=false');
    assert.equal(beforeClose.tokens.length, 1); assert.ok(beforeClose.diffChars > 65536);
    await close(); web.debugger.attach('1.3'); await web.debugger.sendCommand('HeapProfiler.collectGarbage');
    assert.equal(await run('window.__previewOwnerRef.deref() === undefined'), true); web.debugger.detach(); await run('delete window.__previewOwnerRef;true');
    checks.push({ check: 'Closed preview object is collectible after diagnostic GC; portal releases preview tokens and large diff from current/alternate React hook owners', beforeClose, afterClose: await retained() });
    await open(); await loaded(); assert.ok(!(await retained()).tokens.includes(beforeClose.tokens[0]));
    await button('Apply to 1 files'); await until(() => run(`!![...document.querySelectorAll('[role="dialog"] button')].find(e=>e.textContent==='Undo formatting'&&!e.disabled)`), 'apply complete');
    assert.notEqual(fs.readFileSync(path.join(project, 'main.ts'), 'utf8'), original);
    await button('Undo formatting'); await until(() => fs.readFileSync(path.join(project, 'main.ts'), 'utf8') === original, 'undo restores exact original');
    await until(() => run(`![...document.querySelectorAll('[role="dialog"] button')].find(e=>e.textContent==='Rescan').disabled`), 'undo settled');
    await close(); checks.push({ check: 'Reopen scans fresh; actual formatter writes and undo restores original bytes' });
    for (const method of ['preview', 'diff']) {
      gate = { method }; await open(); await until(() => !!gate.release, 'old ' + method + ' pending');
      await close(); await open(); await loaded(); const fresh = await retained();
      const pending = gate; gate = null; pending.release(); await delay(250);
      assert.deepEqual((await retained()).tokens.sort(), fresh.tokens.sort());
      assert.equal(await run(`document.querySelector('[role="dialog"]').textContent.includes('STALE_DIFF_SHOULD_NOT_RETURN')`), false);
      await close(); checks.push({ check: 'Late ' + method + ' completion cannot repopulate a reopened preview' });
    }
    gate = { method: 'apply' }; await open(); await loaded(); await button('Apply to 1 files');
    await until(() => !!gate.release, 'actual apply completed, response pending');
    assert.notEqual(fs.readFileSync(path.join(project, 'main.ts'), 'utf8'), original);
    await close(); await open(); await until(() => run(`document.querySelector('[role="dialog"]').textContent.includes('Files already match their formatting rules.')`), 'fresh formatted project');
    const beforeReply = gitReads, pending = gate; gate = null; pending.release();
    await until(() => gitReads > beforeReply, 'admitted apply still refreshes project after close'); await delay(200);
    assert.equal(await run(`!![...document.querySelectorAll('[role="dialog"] button')].find(e=>e.textContent==='Undo formatting')`), false);
    assert.equal(await run(`document.querySelector('[role="dialog"]').textContent.includes('1 formatted')`), false);
    await close(); checks.push({ check: 'Closing does not cancel admitted writes; completion refreshes project without contaminating new dialog' });
    fs.writeFileSync(path.join(project, 'main.ts'), original);
    gate = { method: 'preview', error: 'STALE_ERROR_SHOULD_NOT_RETURN' }; await open(); await until(() => !!gate.release, 'old failing scan pending');
    await close(); await open(); await loaded(); const failed = gate; gate = null; failed.release(); await delay(200);
    assert.equal(await run(`document.querySelector('[role="dialog"]').textContent.includes('STALE_ERROR_SHOULD_NOT_RETURN')`), false);
    await close(); checks.push({ check: 'Late scan failure stays out of the new dialog' });
    const result = { passed: true, checks, scope: 'Linux source app; real formatter/IPC/Radix/React. Controlled response delays only; hook ownership and one diagnostic renderer GC check, no production GC or RAM/speed ranking.' };
    if (process.env.TRIBUTARY_PREVIEW_RESULT) fs.writeFileSync(process.env.TRIBUTARY_PREVIEW_RESULT, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result)); clearTimeout(deadline); app.quit();
  })().catch(async error => {
    console.error(error.stack); console.error('Retained state', await retained().catch(() => null));
    if (process.env.TRIBUTARY_PREVIEW_RESULT) fs.writeFileSync(process.env.TRIBUTARY_PREVIEW_RESULT, JSON.stringify({ passed: false, error: error.message, checks, retained: await retained().catch(() => null) }, null, 2) + '\n');
    clearTimeout(deadline); app.exit(1);
  }); });
});
app.on('quit', () => fs.rmSync(root, { recursive: true, force: true }));
require(path.join(repo, 'desktop/main.js'));
