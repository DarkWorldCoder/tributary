'use strict';
// Tributary desktop app (Electron main process).
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu, nativeImage, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const { Hub } = require('../core');
const { inside } = require('../core/acp');
const { TerminalManager } = require('../core/terminal');
const { detectEditors, openInEditor } = require('../core/editors');

app.setName('Tributary');
const SMOKE = process.argv.includes('--smoke-test');
// Smoke screenshots come from a hidden window; keep it painting and its timers running.
if (SMOKE) { app.commandLine.appendSwitch('disable-backgrounding-occluded-windows'); app.commandLine.appendSwitch('disable-renderer-backgrounding'); app.commandLine.appendSwitch('disable-background-timer-throttling'); }
if (process.env.TRIBUTARY_DATA_DIR) app.setPath('userData', path.resolve(process.env.TRIBUTARY_DATA_DIR));

// API keys: encrypted with the OS keychain (Keychain, DPAPI, libsecret/kwallet) when available.
class DesktopSecrets {
  constructor(file) { this.file = file; this.session = new Map(); try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.data = {}; } }
  save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data), { mode: 0o600 }); }
  async get(k) {
    if (this.session.has(k)) return this.session.get(k);
    const v = this.data[k]; if (!v) return undefined;
    return v.enc ? safeStorage.decryptString(Buffer.from(v.enc, 'base64')) : v.plain;
  }
  async set(k, value) {
    if (safeStorage.isEncryptionAvailable()) { this.data[k] = { enc: safeStorage.encryptString(value).toString('base64') }; this.session.delete(k); }
    else { this.session.set(k, value); delete this.data[k]; }
    this.save();
  }
  async delete(k) { delete this.data[k]; this.session.delete(k); this.save(); }
}

let win = null;
let hub = null;

function send(name, data) { if (win && !win.isDestroyed()) win.webContents.send('hub-event', name, data); }

function wireEvents() {
  const pending = new Map();
  // Streaming events update a message many times a second; coalesce to ~12 updates/s per message.
  hub.on('event', ({ threadId, message }) => {
    if (pending.has(message.id)) return;
    pending.set(message.id, setTimeout(() => { pending.delete(message.id); send('message', { threadId, message }); }, 80));
  });
  hub.on('message', (d) => { const t = pending.get(d.message.id); if (t) { clearTimeout(t); pending.delete(d.message.id); } send('message', d); });
  for (const n of ['state', 'threads', 'running', 'notification', 'collaboration']) hub.on(n, (d) => send(n, d));
  // System notification when something finishes while the window is in the background.
  hub.on('notification', (n) => {
    if (SMOKE || !Notification.isSupported() || (win && !win.isDestroyed() && win.isFocused())) return;
    const note = new Notification({ title: n.title, body: n.body || '', silent: false });
    note.on('click', () => { if (win) { win.show(); win.focus(); send('open-thread', n.threadId); } });
    note.show();
  });
  terminals.on('data', (d) => send('term-data', d));
  terminals.on('exit', (d) => send('term-exit', d));
}

const terminals = new TerminalManager();
let editors = [];
const knownProject = (p) => { if (!hub.project(p)) throw new Error('Unknown project'); return p; };

const API = {
  collaborationState: () => hub.collaborationState(),
  collaborationConnect: (input) => hub.collaborationConnect(input),
  collaborationDisconnect: () => hub.collaborationDisconnect(),
  collaborationWatch: (id) => hub.collaborationWatch(id),
  collaborationCommand: (action, input, commandId) => hub.collaborationCommand(action, input, commandId),
  state: () => ({ ...hub.state(), credentialStorage: safeStorage.isEncryptionAvailable() ? 'encrypted' : 'session' }),
  createTask: (input) => hub.createTask(input),
  personalWorkspace: () => hub.personalWorkspace(),
  testConnection: (id) => hub.testConnection(id),
  createDocument: (t, m) => hub.createDocument(t, m),
  document: (t, d) => hub.document(t, d),
  saveDocument: (t, d, patch) => hub.saveDocument(t, d, patch),
  async exportDocument(t, d, format = 'md') {
    if (!['md', 'txt'].includes(format)) throw new Error('Choose Markdown or plain text.');
    const doc = hub.document(t, d);
    const result = await dialog.showSaveDialog(win, { title: 'Export document', defaultPath: `${doc.title.replace(/[^\w.-]+/g, '-').slice(0, 70) || 'document'}.${format}`,
      filters: [{ name: format === 'md' ? 'Markdown' : 'Plain text', extensions: [format] }] });
    if (result.canceled || !result.filePath) return null;
    await fs.promises.writeFile(result.filePath, doc.content, 'utf8');
    return result.filePath;
  },
  rescan: () => hub.rescan(),
  threads: (p) => hub.threads(p),
  thread: (id) => hub.thread(id),
  createThread: (p) => hub.createThread(p),
  renameThread: (id, t) => hub.renameThread(id, t),
  deleteThread: (id) => hub.deleteThread(id),
  markThreadSeen: (id) => hub.markThreadSeen(id),
  removeProject: (p) => hub.removeProject(p),
  send: (o) => hub.send(o).then((m) => ({ id: m.id, ok: m.ok })),
  stop: (id) => hub.stop(id),
  saveGateway: (g) => hub.saveGateway(g),
  deleteGateway: (id) => hub.deleteGateway(id),
  setSettings: (s) => hub.setSettings(s),
  gitInfo: (p) => hub.gitInfo(p),
  fileDiff: (p, rel) => hub.fileDiff(p, rel),
  syncInstructions: (p) => hub.syncInstructions(p),
  async pickProject() {
    const r = await dialog.showOpenDialog(win, { title: 'Add project folder', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return hub.addProject(r.filePaths[0]);
  },
  openFile(p, rel) {
    if (!hub.project(p)) throw new Error('Unknown project');
    const abs = path.resolve(p, rel);
    if (!inside(p, abs)) throw new Error('Path outside project');
    return shell.openPath(abs);
  },
  openDiff: () => false,
  openAgentsFile: () => shell.openPath(hub.customAgentsFile),
  openExternal(url) { if (/^https?:\/\//.test(url)) return shell.openExternal(url); return null; },
  // Projects and files
  listFiles: (p) => hub.listFiles(p),
  readFile: (p, rel) => hub.readFile(p, rel),
  readDirectory: (p, rel, options) => hub.readDirectory(p, rel, options),
  writeFile: (p, rel, content, mtime) => hub.writeFile(p, rel, content, mtime),
  commit: (p, msg) => hub.commit(p, msg),
  setProjectFolders: (p, folders) => hub.setProjectFolders(p, folders),
  async pickFolder() {
    const r = await dialog.showOpenDialog(win, { title: 'Add a folder to this project', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0] || null;
  },
  // Turns, teams, race
  restoreCheckpoint: (t, m) => hub.restoreCheckpoint(t, m),
  turnDiff: (t, m, rel) => hub.turnDiff(t, m, rel),
  threadChanges: (t) => hub.threadChanges(t),
  runTeam: (t, team) => hub.runTeam(t, team).then((r) => r, (e) => ({ error: e.message })),
  runRace: (t, opts) => hub.runRace(t, opts).then(() => ({ ok: true }), (e) => ({ error: e.message })),
  applyRace: (t, m, a) => hub.applyRace(t, m, a),
  async exportThread(id) {
    const t = hub.thread(id); if (!t) throw new Error('Thread not found');
    const r = await dialog.showSaveDialog(win, { title: 'Export thread', defaultPath: `${t.title.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'thread'}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, hub.exportMarkdown(id)); return r.filePath;
  },
  // Memory
  memory: (p) => hub.memory(p),
  enableMemory: (p) => hub.enableMemory(p),
  saveMemory: (p, text) => hub.saveMemory(p, text),
  remember: (p, note) => hub.remember(p, note),
  // Notifications
  notifications: () => hub.notifications(),
  markRead: (id) => hub.markRead(id),
  clearNotifications: () => hub.clearNotifications(),
  // Skills and MCP
  skills: (p) => hub.skills(p),
  shareSkill: (name, p) => hub.shareSkill(name, p),
  mcp: (p) => hub.mcp(p),
  addMcp: (server, ids) => hub.addMcp(server, ids),
  removeMcp: (id, name) => hub.removeMcp(id, name),
  // ACP registry
  registry: (opts) => hub.registry(opts),
  installRegistryAgent: (id) => hub.installRegistryAgent(id),
  removeRegistryAgent: (id) => hub.removeRegistryAgent(id),
  // Editors and terminals
  editors: () => (editors = detectEditors()).map(({ id, name }) => ({ id, name })),
  openInEditor(editorId, p, rel, line) {
    const e = (editors.length ? editors : (editors = detectEditors())).find((x) => x.id === editorId); if (!e) throw new Error('Editor not found');
    const target = rel ? path.resolve(knownProject(p), rel) : knownProject(p);
    if (!inside(p, target)) throw new Error('Path outside project');
    openInEditor(e, { path: target, line }); return true;
  },
  createTerminal({ cwd, cols, rows, command } = {}) {
    const dir = cwd && hub.project(cwd) ? cwd : (cwd && fs.existsSync(cwd) ? cwd : app.getPath('home'));
    const id = terminals.create({ cwd: dir, cols, rows });
    // Type the command once the shell has printed its prompt (or after 2 s), not after a fixed guess.
    if (command) {
      let sent = false; let timer = null;
      const go = () => { if (sent) return; sent = true; clearTimeout(timer); terminals.off('data', first); try { terminals.write(id, `${command}\r`); } catch {} };
      const first = (d) => { if (d.id === id) { clearTimeout(timer); timer = setTimeout(go, 50); } };
      terminals.on('data', first); timer = setTimeout(go, 2000);
    }
    return id;
  },
  termWrite: (id, data) => terminals.write(id, data),
  termResize: (id, cols, rows) => terminals.resize(id, cols, rows),
  termKill: (id) => terminals.kill(id),
};

ipcMain.handle('hub', async (e, method, args) => {
  if (!win || e.sender !== win.webContents) throw new Error('Unknown sender');
  if (!Object.prototype.hasOwnProperty.call(API, method)) throw new Error(`Unknown method ${method}`);
  return API[method](...(Array.isArray(args) ? args : []));
});

function createWindow() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon-512.png'));
  win = new BrowserWindow({
    width: 1280, height: 840, minWidth: 420, minHeight: 480, title: 'Tributary', icon, show: false,
    backgroundColor: '#1c1b1a', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (ev) => ev.preventDefault());
  // Smoke runs stay hidden so they never take keyboard focus from whatever you are typing in.
  win.once('ready-to-show', () => { if (!SMOKE) win.show(); });
  win.loadFile(path.join(__dirname, '..', 'ui', 'dist', 'index.html'));
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]) : null);
  const dataDir = app.getPath('userData');
  hub = new Hub({ dataDir, secrets: new DesktopSecrets(path.join(dataDir, 'secrets.json')) });
  // Projects passed on the command line: `tributary /path/to/project`
  for (const a of process.argv.slice(app.isPackaged ? 1 : 2)) { if (!a.startsWith('-')) { try { hub.addProject(a); } catch {} } }
  wireEvents();
  createWindow();
  // Show the app while agent discovery runs. Register smoke listeners before awaiting it.
  const initialized = hub.init();
  initialized.catch((e) => { console.error('Agent discovery failed:', e.message); });
  if (SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      const loadedMs = Math.round(process.uptime() * 1000); // process start to page loaded
      await initialized;
      await new Promise((r) => setTimeout(r, 1500));
      const prompt = process.env.TRIBUTARY_SMOKE_PROMPT;
      if (prompt) {
        // Drive a real turn through the UI exactly as a user would: pick agent, mode, type, send.
        await win.webContents.executeJavaScript(`(async () => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const agentName = ${JSON.stringify(process.env.TRIBUTARY_SMOKE_AGENT_NAME || 'Codex')};
          const chip = [...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent.trim().endsWith(agentName));
          if (!chip) throw new Error('missing agent chip ' + agentName);
          chip.click(); await wait(300);
          const ta = document.querySelector('textarea[aria-label="Message"]');
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(ta, ${JSON.stringify(prompt)}); ta.dispatchEvent(new Event('input', { bubbles: true }));
          await wait(200);
          document.querySelector('button[aria-label="Send"]').click();
        })()`);
        const t0 = Date.now();
        while (Date.now() - t0 < 240000) {
          await new Promise((r) => setTimeout(r, 1000));
          const st = hub.state(); const done = !st.running.length && hub.store.data.threads.some((t) => t.messages.some((m) => m.role === 'assistant' && m.ok != null));
          if (done) break;
        }
        await new Promise((r) => setTimeout(r, 800));
      }
      // TRIBUTARY_SMOKE_CLICKS="Settings|Agents|Browse agents|3000" clicks those buttons (label or text) before the
      // screenshot; a number waits that many milliseconds, "type:text" types and "key:control+f" presses keys.
      // Animations are switched off: a background window may never advance them, leaving dialogs invisible.
      const clicks = (process.env.TRIBUTARY_SMOKE_CLICKS || '').split('|').filter(Boolean);
      if (clicks.length) await win.webContents.insertCSS('*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }');
      for (const label of clicks) {
        if (/^\d+$/.test(label)) { await new Promise((r) => setTimeout(r, Number(label))); continue; }
        // "type:some text" types into the focused element; "key:control+f" presses a key with modifiers.
        if (label.startsWith('type:')) { for (const ch of label.slice(5)) win.webContents.sendInputEvent({ type: 'char', keyCode: ch }); await new Promise((r) => setTimeout(r, 300)); continue; }
        if (label.startsWith('key:')) {
          const [keyCode, ...modifiers] = label.slice(4).split('+').reverse();
          for (const type of ['keyDown', 'char', 'keyUp']) if (type !== 'char' || keyCode.length > 1) win.webContents.sendInputEvent({ type, keyCode, modifiers });
          await new Promise((r) => setTimeout(r, 500)); continue;
        }
        await win.webContents.executeJavaScript(`(() => {
          const want = ${JSON.stringify(label)}.toLowerCase();
          const name = (b) => (b.getAttribute('aria-label') || b.textContent || '').trim().toLowerCase();
          const all = [...document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="tab"], [role="radio"], [role="option"]')];
          const el = all.find((b) => name(b) === want) || all.find((b) => name(b).startsWith(want));
          if (!el) throw new Error('smoke: no button ' + want);
          // Menus open on pointerdown, so send the whole sequence a mouse would.
          const at = { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', isPrimary: true };
          el.dispatchEvent(new PointerEvent('pointerdown', at)); el.dispatchEvent(new MouseEvent('mousedown', at));
          el.dispatchEvent(new PointerEvent('pointerup', at)); el.dispatchEvent(new MouseEvent('mouseup', at));
          el.click();
          return name(el);
        })()`).then((hit) => console.log(`SMOKE clicked ${JSON.stringify(hit)}`), () => console.log(`SMOKE no button ${JSON.stringify(label)}`));
        await new Promise((r) => setTimeout(r, 1500));
      }
      const report = await win.webContents.executeJavaScript(`({ platform: window.hub && window.hub.platform, title: document.title,
        agents: ([...document.querySelectorAll('*')].find((e) => /agents? ready$/.test(e.textContent.trim()) && e.children.length === 0) || {}).textContent || null,
        error: (document.body.innerText.match(/failed to start[\\s\\S]{0,300}/)||[])[0] || null,
        dialogs: [...document.querySelectorAll('[role="dialog"] h2')].map((h) => h.textContent) })`);
      // A window behind others may not repaint on its own; ask for a fresh frame before capturing it.
      win.webContents.invalidate(); await new Promise((r) => setTimeout(r, 300));
      const img = await win.webContents.capturePage();
      const out = process.env.TRIBUTARY_SMOKE_SHOT; if (out) fs.writeFileSync(out, img.toPNG());
      const last = hub.store.data.threads.flatMap((t) => t.messages).filter((m) => m.role === 'assistant').pop();
      if (last) report.turn = { agent: last.agent, ok: last.ok, text: (last.text || '').slice(0, 160), uiText: await win.webContents.executeJavaScript(`([...document.querySelectorAll('.prose-reply')].pop()||{}).innerText || ''`) };
      // Startup and memory, so speed and memory work can be measured: resident memory per process type, in MB.
      const memoryMB = {};
      for (const m of app.getAppMetrics()) memoryMB[m.type] = (memoryMB[m.type] || 0) + Math.round(m.memory.workingSetSize / 1024);
      const mu = process.memoryUsage(); memoryMB.mainHeap = Math.round(mu.heapUsed / 1048576); memoryMB.mainExternal = Math.round(mu.external / 1048576);
      memoryMB.processes = app.getAppMetrics().map((m) => m.type + (m.serviceName ? `:${m.serviceName}` : '')).join(',');
      memoryMB.rendererHeap = await win.webContents.executeJavaScript(`Math.round((performance.memory || {}).usedJSHeapSize / 1048576 || 0)`);
      memoryMB.domNodes = await win.webContents.executeJavaScript('document.getElementsByTagName("*").length');
      const paint = await win.webContents.executeJavaScript(`Math.round((performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0)`);
      console.log(`SMOKE ${JSON.stringify({ ...report, encryption: safeStorage.isEncryptionAvailable(), ready: hub.state().agents.filter((x) => x.available && x.headless).map((x) => x.id), loadedMs, firstPaintMs: paint, memoryMB })}`);
      app.quit();
    });
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
// Write anything still waiting in the store before the process ends.
app.on('will-quit', () => { try { hub?.store.close(); } catch (e) { console.error(`Could not save on quit: ${e.message}`); } });
app.on('window-all-closed', () => { if (hub) { for (const id of hub.running.keys()) hub.stop(id); hub.collaborationClient?.disconnect(); } terminals.killAll(); if (process.platform !== 'darwin' || SMOKE) app.quit(); });
