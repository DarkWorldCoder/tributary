'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process'); const { app } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-diff-ui-')), project = path.join(root, 'project'), profile = path.join(root, 'profile'); fs.mkdirSync(project);
const git = (...args) => execFileSync('git', args, { cwd: project, encoding: 'utf8' }); const count = 4000, filename = path.join(project, 'main.ts');
const source = prefix => Array.from({ length: count }, (_, i) => `const ${prefix}_${i} = ${i};\n`).join('');
git('init', '-q'); git('config', 'user.name', 'Diff UI'); git('config', 'user.email', 'diff-ui@localhost'); fs.writeFileSync(filename, source('old')); git('add', '.'); git('commit', '-qm', 'base'); fs.writeFileSync(filename, source('new'));
process.env.TRIBUTARY_DATA_DIR = profile; const core = require('../../core'), drafts = require('../../core/drafts');
const seed = new core.Hub({ dataDir: profile, home: root, secrets: new core.MemorySecrets() }); seed.createThread(project, 'Full change markers'); seed.fileWatches.close(); seed.store.close();
drafts.save(profile, 'files:' + project, { active: 'main.ts', tabs: [{ rel: 'main.ts', mode: 'edit', pinned: true }] });
core.Hub = class extends core.Hub { async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms)); async function until(fn, label) { const end = Date.now() + 20000; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + label); await delay(35); } }
let started = false; const deadline = setTimeout(() => app.exit(1), 90000);
app.on('browser-window-created', (_event, win) => {
  const web = win.webContents, run = code => web.executeJavaScript(code); const text = () => run(`document.querySelector('.cm-content')?.cmTile.root.view.state.doc.toString() || ''`);
  const footer = () => run(`document.querySelector('.workspace-file-footer')?.textContent || ''`);
  const key = async (keyCode, modifiers = []) => { web.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); web.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await delay(80); };
  const mark = line => run(`(()=>{const v=document.querySelector('.cm-content')?.cmTile.root.view;if(!v)return null;const at=v.coordsAtPos(v.state.doc.line(${line}).from);if(!at)return null;return [...document.querySelectorAll('.cm-file-change-gutter .cm-file-change')].find(e=>Math.abs(e.getBoundingClientRect().top-at.top)<4)?.title || null})()`);
  web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
    await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.blame','off');localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'editor',expanded:true,panel:{open:true,tab:'files'}}}));true`);
    const loaded = new Promise(resolve => web.once('did-finish-load', resolve)); web.reload(); await loaded;
    await until(() => run(`!!document.querySelector('.cm-content')`), 'editor'); await run(`document.querySelector('[aria-label="Projects and chats"][aria-expanded="true"]')?.click();true`);
    await until(async () => (await footer()).includes('+4000'), 'complete added count'); assert.ok((await footer()).includes('4000')); assert.equal(await text(), source('new'));
    await until(async () => (await mark(1))?.startsWith('1 lines added, 4000 lines removed'), 'first change marker');
    await run(`document.querySelector('.cm-content').cmTile.root.view.focus();true`); await key('End', ['control']); await key('Up'); await key('Home');
    await until(async () => (await mark(count))?.startsWith('1 lines added, 0 lines removed'), 'last-line marker beyond old preview limit');
    fs.writeFileSync('/tmp/tributary-editor-diff-full.png', (await web.capturePage()).toPNG());
    await web.insertText('// newer '); await until(async () => (await text()).includes('// newer const new_3999'), 'local edit'); await key('z', ['control']); await until(async () => await text() === source('new'), 'native undo preserves complete source');
    const sparse = source('old').replace('const old_3999 = 3999;', 'const final_line = 3999;'); fs.writeFileSync(filename, sparse);
    await until(async () => await text() === sparse, 'actual watched file change'); await until(async () => (await footer()).includes('+1') && !(await footer()).includes('+4000'), 'refreshed complete counters');
    await run(`document.querySelector('.cm-content').cmTile.root.view.focus();true`); await key('End', ['control']); await key('Up'); await key('Home');
    await until(async () => (await mark(count))?.startsWith('1 lines added, 1 lines removed'), 'sparse last-line marker');
    console.log(JSON.stringify({ passed: true, lines: count, checks: ['Exact source and full replacement counts', 'First-line addition/deletion marker', 'Final source-line marker after more than 8000 supplied diff rows', 'Native local edit and undo retain the entire file', 'Real disk writes refresh the buffer, counters and final marker without reopening'], scope: 'Linux source Electron/CodeMirror with real Git and file watches. Functional coverage, not a process-memory or latency benchmark.' })); clearTimeout(deadline); app.quit();
  })().catch(async error => { console.error(error.stack); fs.writeFileSync('/tmp/tributary-editor-diff-failure.png', (await web.capturePage()).toPNG()); app.exit(1); }); });
});
app.on('quit', () => fs.rmSync(root, { recursive: true, force: true })); require('../../desktop/main.js');
