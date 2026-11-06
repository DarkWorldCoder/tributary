'use strict';
// Run with Electron after building the UI. Uses an isolated profile and real
// temporary files; only provider discovery and response timing are controlled.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { app } = require('electron');
const repo = path.resolve(__dirname, '../..');
const output = process.env.TRIBUTARY_SEARCH_OUTPUT || path.join(os.tmpdir(), 'tributary-search-ui.json');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-search-ui-')), project = path.join(root, 'project'), profile = path.join(root, 'profile');
fs.mkdirSync(path.join(project, 'src'), { recursive: true });
fs.writeFileSync(path.join(project, 'main.ts'), 'export function greeting(name: string) {\n  return `Hello ${name}`;\n}\nconst message = greeting("world");\nconst again = greeting("Tributary");\n');
fs.writeFileSync(path.join(project, 'src/helper.ts'), 'export const greeting = "hello";\n');
process.env.TRIBUTARY_DATA_DIR = profile;
const core = require('../../core'), drafts = require('../../core/drafts');
const seed = new core.Hub({ dataDir: profile, home: root, secrets: new core.MemorySecrets() });
seed.createThread(project, 'Search UI verification'); seed.store.data.settings.formatOnSave = false; seed.store.save(true); seed.fileWatches.close(); seed.store.close();
drafts.save(profile, 'files:' + project, { active: 'main.ts', tabs: [{ rel: 'main.ts', mode: 'edit', pinned: true }] });
const calls = []; let held = null, running = 0, maxRunning = 0;
const Base = core.Hub;
const searchTheme = { id: 'fixture:search', dark: true, tokenColors: [], colors: {
  'editor.background': '#101820', 'editor.foreground': '#eeeeee',
  'editorWidget.background': '#182838', 'editorWidget.foreground': '#dddddd', 'editorWidget.border': '#334455',
  'quickInput.background': '#203040', 'quickInput.foreground': '#ffffff',
  'quickInputList.focusBackground': '#385078', 'quickInputList.focusForeground': '#ffffcc',
  'input.background': '#283848', 'input.foreground': '#f0f0f0', 'input.border': '#607080', 'input.placeholderForeground': '#aabbcc',
  'inputOption.activeBackground': '#405060', 'inputOption.activeForeground': '#ffaabb', 'inputOption.activeBorder': '#aa3344',
  'editor.findMatchHighlightBackground': '#aabbcc44', 'editor.findMatchHighlightBorder': '#ffee00',
} };
core.Hub = class extends Base {
  async init() { this.agents = []; this.scanningAgents = false; this.emit('state'); return this; }
  extensionAppearance(theme, icons) { return theme === searchTheme.id ? Promise.resolve({ theme: searchTheme, icons: null }) : super.extensionAppearance(theme, icons); }
  async searchProject(folder, query, options) {
    calls.push({ query, options }); maxRunning = Math.max(maxRunning, ++running);
    try {
      if (query === 'greet') await new Promise(resolve => { held = resolve; });
      return await super.searchProject(folder, query, options);
    } finally { --running; }
  }
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, label) => { const end = Date.now() + 15000; while (!await fn()) { if (Date.now() > end) throw Error('Timed out: ' + label); await delay(25); } };
const checks = [], check = name => checks.push(name); let started = false;
const deadline = setTimeout(() => { console.error('Search UI deadline'); app.exit(1); }, 120000);
app.on('browser-window-created', (_event, win) => {
  win.setSize(1280, 850); const web = win.webContents, run = code => web.executeJavaScript(code);
  const key = async (keyCode, modifiers = []) => {
    web.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Enter') web.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
    web.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await delay(50);
  };
  const text = (selector, value) => run(`{ const e = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', {bubbles:true})); };true`);
  const query = value => text('[aria-label="Search project text"]', value);
  const status = value => until(() => run(`document.querySelector('.search-summary')?.textContent === ${JSON.stringify(value)}`), value);
  const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click();true`);
  const shot = async suffix => {
    web.sendInputEvent({ type: 'mouseMove', x: 0, y: 200 });
    await run(`document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))`);
    await delay(150); fs.writeFileSync(output + suffix + '.png', (await web.capturePage()).toPNG());
  };
  web.once('did-finish-load', () => { if (started) return; started = true; (async () => {
    await run(`localStorage.setItem('tributary.project', ${JSON.stringify(JSON.stringify(project))}); localStorage.setItem('tributary.recentCommands.v1', JSON.stringify(['settings', 'memory'])); localStorage.setItem('tributary.workspaceViews.v1', JSON.stringify({[${JSON.stringify(project)}]:{layout:'editor',expanded:false,panel:{open:true,tab:'files'}}}));true`);
    const loaded = new Promise(resolve => web.once('did-finish-load', resolve)); web.reload(); await loaded;
    await until(() => run(`!!document.querySelector('.cm-content')`), 'editor');
    await run(`document.querySelector('[aria-label="Projects and chats"][aria-expanded="true"]')?.click();true`);
    await key('f', ['control', 'shift']);
    await until(() => run(`document.activeElement?.getAttribute('aria-label') === 'Search project text'`), 'Search shortcut');
    await query('greeting'); await status('4 results in 2 files'); check('Ctrl+Shift+F and search on type over real files');
    await shot('.sidebar');

    await query('greet'); await until(() => !!held, 'held search');
    const before = calls.length;
    await query('greeting'); await delay(400); await query('hello'); await delay(400);
    assert.equal(calls.length, before); held(); held = null;
    await status('2 results in 2 files'); assert.equal(calls.at(-1).query, 'hello'); assert.equal(calls.length, before + 1); assert.equal(maxRunning, 1);
    check('slow responses cannot overwrite newer queries; only latest waiting search runs');

    await run(`document.querySelector('[aria-label="Search project text"]').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));true`);
    const beforeIme = calls.length; await query('world'); await delay(400); assert.equal(calls.length, beforeIme);
    await run(`document.querySelector('[aria-label="Search project text"]').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));true`);
    await status('1 result in 1 file'); check('IME composition does not launch incomplete searches');

    const enterBefore = calls.length;
    await query('greeting'); await run(`document.querySelector('[aria-label="Search project text"]').focus();true`); await key('Enter');
    assert.equal(calls.length, enterBefore + 1); await status('4 results in 2 files');
    const afterEnter = calls.length; await delay(400); assert.equal(calls.length, afterEnter); check('Enter searches immediately without duplicate debounce request');
    await key('Down'); assert.equal(await run(`document.activeElement.classList.contains('search-result-file')`), true);
    await key('Left'); assert.equal(await run(`document.activeElement.getAttribute('aria-expanded')`), 'false');
    await key('Right'); await key('Down'); assert.equal(await run(`document.activeElement.classList.contains('search-result-line')`), true);
    await key('End'); assert.equal(await run(`document.activeElement.textContent.includes('export const greeting')`), true);
    await key('Enter'); await until(() => run(`!!document.querySelector('[aria-label="Edit src/helper.ts"]')`), 'open result');
    assert.equal(await run(`document.querySelector('.cm-content').cmTile.root.view.state.selection.main.head`), 13); check('arrow navigation, collapse, and exact file/column opening');

    await key('f', ['control', 'shift']); await click('[aria-label="Toggle search details"]');
    await text('[aria-label="files to include"]', 'main.ts'); await status('3 results in 1 file');
    await text('[aria-label="files to exclude"]', 'main.ts'); await status('0 results in 0 files');
    await text('[aria-label="files to include"]', ''); await text('[aria-label="files to exclude"]', ''); await status('4 results in 2 files');
    await query('HELLO'); await status('2 results in 2 files'); await click('.workspace-search [aria-label="Match Case"]'); await status('0 results in 0 files');
    await click('.workspace-search [aria-label="Match Case"]'); await click('.workspace-search [aria-label="Use Regular Expression"]'); await query('[');
    await until(() => run(`!!document.querySelector('.workspace-search [role="alert"]')`), 'regex error'); check('live filters, case option and visible regex errors');
    await query('greet'); await until(() => !!held, 'held unmount'); await click('[aria-label="Close search sidebar"]'); held(); held = null; await delay(400);
    assert.equal(await run(`!!document.querySelector('.workspace-search')`), false); check('late search reply is safe after sidebar close');

    await run(`document.querySelector('.cm-content').cmTile.root.view.focus();true`); await key('f', ['control']);
    await until(() => run(`!!document.querySelector('.cm-vscode-search')`), 'editor find');
    await text('.cm-vscode-search input[name="search"]', 'greeting'); await click('.cm-vscode-search button[name="next"]');
    assert.equal(await run(`document.querySelector('.cm-find-count').textContent`), '1 of 1');
    assert.equal(await run(`!!document.querySelector('.cm-ask-agent') && getComputedStyle(document.querySelector('.cm-ask-agent')).visibility === 'hidden'`), true);
    await click('.cm-vscode-search button[name="toggle-replace"]'); await text('.cm-vscode-search input[name="replace"]', 'welcome');
    await shot('.find');
    await click('.cm-vscode-search button[name="replaceAll"]'); assert.equal(await run(`document.querySelector('.cm-content').cmTile.root.view.state.doc.toString().includes('welcome')`), true);
    await key('Escape'); await key('z', ['control']); assert.equal(await run(`document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()`), 'export const greeting = "hello";\n');
    check('editor Find, match count, Replace All and undo use real CodeMirror history');
    // Native focus is required by EditorView.hasFocus. The desktop running this
    // fixture may have given focus to another app while the previous checks ran.
    win.focus(); web.focus(); await until(() => run(`document.hasFocus()`), 'native window focus');
    await run(`document.querySelector('.cm-content').cmTile.root.view.focus();[...document.querySelectorAll('[role="menubar"] [role="menuitem"]')].find(e=>e.textContent==='Edit').focus();true`);
    await key('Down'); await until(() => run(`!!document.querySelector('[role="menu"]')`), 'Edit menu');
    await run(`[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find(e=>e.textContent.startsWith('Find in file')).focus();true`); await key('Enter');
    await until(() => run(`!!document.querySelector('.cm-vscode-search')`), 'menu Find restores editor focus'); await key('Escape');
    check('Edit menu restores a connected editor through its weak focus hint');

    const layouts = [];
    // Exercise the responsive renderer below the normal native minimum width.
    win.setMinimumSize(300, 400);
    for (const width of [1280, 900, 390, 320]) {
      win.setSize(width, 850); await delay(200); await key('p', ['control', 'shift']);
      await until(() => run(`!!document.querySelector('.command-picker')`), 'command palette');
      const box = await run(`JSON.stringify((()=>{const e=document.querySelector('.command-picker'),r=e.getBoundingClientRect();return {width:innerWidth,picker:r.width,left:r.left,right:r.right,top:r.top};})())`);
      const rect = JSON.parse(box); assert.ok(rect.left >= 0 && rect.right <= rect.width);
      assert.equal(rect.width, width);
      assert.equal(Math.round(rect.picker), Math.round(rect.width < 640 ? rect.width - 32 : Math.min(600, rect.width * .62)));
      layouts.push(rect); await shot('.palette-' + width);
      if (width < 640) assert.equal(await run(`[...document.querySelectorAll('.command-picker .command-section-label')].every(e=>getComputedStyle(e).display==='none')`), true);
      assert.equal(await run(`[...document.querySelectorAll('[data-slot="tooltip-content"]')].some(e=>getComputedStyle(e).visibility!=='hidden'&&e.getBoundingClientRect().width>0)`), false);
      assert.equal(await run(`[...document.querySelectorAll('.cm-ask-agent')].some(e=>getComputedStyle(e).visibility!=='hidden'&&e.getBoundingClientRect().width>0)`), false);
      await key('Escape');
    }
    check('top command picker fits 1280, 900, 390 and 320 pixel windows');
    win.setSize(1280, 850); await key('p', ['control', 'shift']);
    await until(() => run(`!!document.querySelector('.command-picker')`), 'command label match');
    await text('[aria-label="Search commands and chats"][cmdk-input]', '> memory');
    await until(() => run(`[...document.querySelectorAll('.command-picker [cmdk-item]:not([hidden]) .search-label-match')].some(e=>e.textContent==='Memory')`), 'highlighted command');
    assert.equal(await run(`getComputedStyle(document.querySelector('[cmdk-group][aria-label="Recently used"] [cmdk-item] .command-section-label')).display`), 'block');
    await shot('.highlighted-command'); await key('Escape');
    win.setSize(1280, 850); await key('p', ['control']); await until(() => run(`!!document.querySelector('.file-picker')`), 'Quick Open');
    await text('[aria-label="Search project filenames"]', 'helper'); await until(() => run(`document.querySelector('.file-picker [cmdk-item]')?.textContent.includes('helper.ts')`), 'filename match');
    assert.equal(await run(`document.querySelector('.file-picker .search-label-match')?.textContent`), 'helper');
    assert.equal(await run(`document.querySelector('.file-picker [role="status"]')?.textContent`), '1 file');
    await shot('.highlighted-file');
    await text('[aria-label="Search project filenames"]', 'src/help');
    await until(() => run(`document.querySelector('.file-picker [cmdk-item]')?.textContent.includes('helper.ts')`), 'path match');
    assert.deepEqual(await run(`[...document.querySelectorAll('.file-picker [cmdk-item] .search-label-match')].map(e=>e.textContent)`), ['help', 'src']);
    await text('[aria-label="Search project filenames"]', 'main');
    await until(() => run(`document.querySelector('.file-picker [cmdk-item]')?.textContent.includes('main.ts')`), 'root filename match');
    assert.deepEqual(await run(`[...document.querySelectorAll('.file-picker [cmdk-item] .search-label-match')].map(e=>e.textContent)`), ['main']);
    check('command and filename labels highlight matches without changing their text or filtering');
    check('Ctrl+P Quick Open uses real filename search'); await key('Escape');
    await key('p', ['control']); await until(() => run(`!!document.querySelector('.file-picker')`), 'Quick Open location');
    await text('[aria-label="Search project filenames"]', 'main.ts:2:10');
    await until(() => run(`document.querySelector('.file-picker [cmdk-item]')?.textContent.includes('main.ts')`), 'filename with caret location');
    assert.equal(await run(`document.querySelector('.file-picker [role="status"]').textContent`), '1 fileLine 2:10');
    await shot('.file-location'); await key('Enter');
    await until(() => run(`!!document.querySelector('[aria-label="Edit main.ts"]')`), 'open file at location');
    assert.deepEqual(await run(`(()=>{const v=document.querySelector('.cm-content').cmTile.root.view,p=v.state.selection.main.head,l=v.state.doc.lineAt(p);return {line:l.number,column:p-l.from+1};})()`), { line: 2, column: 10 });
    await key('p', ['control', 'shift']); await until(() => run(`!!document.querySelector('.command-picker')`), 'filtered group labels');
    await text('[aria-label="Search commands and chats"][cmdk-input]', '> debug');
    await until(() => run(`!!document.querySelector('[cmdk-group][aria-label="Other commands"] [cmdk-item]')`), 'filtered debugger command');
    assert.equal(await run(`getComputedStyle(document.querySelector('[cmdk-group][aria-label="Other commands"] [cmdk-item] .command-section-label')).display`), 'block');
    check('filtered recent/other group labels stay visible; file:line:column opens the exact editor caret');
    await key('Escape');
    // Use the real appearance provider/settings bridge with a declarative test
    // theme; no extension runtime, registry download or user profile is touched.
    await run(`window.hub.call('setSettings', {extensionTheme:'fixture:search'})`);
    await until(() => run(`document.documentElement.dataset.extensionTheme === 'fixture:search'`), 'search theme applied');
    const color = (selector, property) => run(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue(${JSON.stringify(property)})`);
    await key('p', ['control', 'shift']); await until(() => run(`!!document.querySelector('.command-picker')`), 'themed palette');
    await text('[aria-label="Search commands and chats"][cmdk-input]', '> memory');
    await until(() => run(`!!document.querySelector('.command-picker [cmdk-item][data-selected="true"] [data-slot="kbd"]')`), 'selected command shortcut');
    assert.equal(await color('.command-picker [cmdk-root]', 'background-color'), 'rgb(32, 48, 64)');
    assert.equal(await color('.command-picker [cmdk-item][data-selected="true"]', 'background-color'), 'rgb(56, 80, 120)');
    assert.equal(await color('.command-picker [cmdk-item][data-selected="true"] [data-slot="kbd"]', 'color'), 'rgb(255, 255, 204)');
    assert.equal(await color('.command-picker [data-slot="input-group"]', 'background-color'), 'rgb(40, 56, 72)');
    await shot('.themed-palette'); await key('Escape');
    await key('f', ['control', 'shift']); await query('greeting'); await status('4 results in 2 files');
    assert.equal(await color('.search-query-box', 'background-color'), 'rgb(40, 56, 72)');
    assert.equal(await color('.search-query-box', 'border-top-color'), 'rgb(96, 112, 128)');
    assert.equal(await color('.search-result-line mark', 'background-color'), 'rgba(170, 187, 204, 0.267)');
    await click('.workspace-search [aria-label="Match Case"]'); await status('4 results in 2 files');
    assert.equal(await color('.search-query-box button[aria-pressed="true"]', 'color'), 'rgb(255, 170, 187)');
    await shot('.themed-sidebar'); await click('[aria-label="Close search sidebar"]');
    await run(`document.querySelector('.cm-content').cmTile.root.view.focus();true`); await key('f', ['control']);
    await until(() => run(`!!document.querySelector('.cm-vscode-search')`), 'themed editor find');
    assert.equal(await color('.cm-vscode-search', 'background-color'), 'rgb(24, 40, 56)');
    assert.equal(await color('.cm-vscode-search .cm-find-input', 'background-color'), 'rgb(40, 56, 72)');
    await shot('.themed-find'); await key('Escape');
    await run(`window.hub.call('setSettings', {extensionTheme:''})`);
    await until(() => run(`!document.documentElement.dataset.extensionTheme`), 'theme removal');
    assert.equal(await run(`document.documentElement.style.getPropertyValue('--finder-background')`), '');
    assert.equal(await run(`document.documentElement.style.getPropertyValue('--search-input-background')`), '');
    check('declarative theme colors reach palette, keyboard badges, Search and editor Find; removing the theme restores defaults');
    const sources = ['ui/src/components/project-search.tsx', 'ui/src/lib/editor-search.ts', 'ui/src/components/command-palette.tsx', 'ui/src/components/quick-open.tsx', 'ui/src/components/search-label.tsx', 'ui/src/lib/search-label.mjs', 'ui/src/lib/quick-open-query.mjs', 'ui/src/lib/extension-theme-variables.mjs', 'ui/src/index.css', 'test/e2e/search-ui.cjs'];
    const sourceHashes = Object.fromEntries(sources.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')]));
    fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), passed: true, checks, layouts, maxConcurrentSearches: maxRunning, requests: calls, sourceHashes, scope: 'Linux Electron source build; isolated real files and actual search worker. Agent discovery disabled; two search replies deliberately held to exercise races. Native minimum width reduced only in this fixture for 390/320 pixel renderer checks. No live provider or installer claim.' }, null, 2) + '\n');
    console.log(JSON.stringify({ passed: true, checks })); clearTimeout(deadline); app.quit();
  })().catch(async error => {
    console.error(error.stack);
    try { fs.writeFileSync(output + '.failure.png', (await web.capturePage()).toPNG()); } catch { /* window may have closed */ }
    app.exit(1);
  }); });
});
app.on('quit', () => fs.rmSync(root, { recursive: true, force: true }));
require('../../desktop/main.js');
