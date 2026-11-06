'use strict';
// Tributary desktop app (Electron main process).
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu, nativeImage, Notification, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { Hub } = require('../core');
const { inside } = require('../core/acp');
const { TerminalManager } = require('../core/terminal');
const { PreviewServers } = require('../core/preview-server');
const { detectEditors, openInEditor } = require('../core/editors');

app.setName('Tributary');
const SMOKE = process.argv.includes('--smoke-test');
// Smoke screenshots come from a hidden window; keep it painting and its timers running.
if (SMOKE) { app.commandLine.appendSwitch('disable-backgrounding-occluded-windows'); app.commandLine.appendSwitch('disable-renderer-backgrounding'); app.commandLine.appendSwitch('disable-background-timer-throttling'); }
if (process.env.TRIBUTARY_DATA_DIR) app.setPath('userData', path.resolve(process.env.TRIBUTARY_DATA_DIR));

// API keys: encrypted with the OS keychain; see desktop/secrets.js.
const { shouldNotify, keepAwake } = require('../core/attention');
const { DesktopSecrets, storageKind } = require('./secrets');

let win = null;
let hub = null;
let updates = null;
let lanHost = null;
let messageTransport = null;
const { createMessageTransport, ownsMessageFrame, MAX_REPLY_PACKETS } = require('./message-transport');
const getLanHost = () => lanHost ||= require('../server/lan-host').createLanHost({ dir: path.join(app.getPath('userData'), 'project-room') });

function send(name, data) { if (win && !win.isDestroyed()) win.webContents.send('hub-event', name, data); }

// Streaming delivery owns histories while its coalescing timer is pending.
let disposeMessages;
function wireEvents() {
  disposeMessages = require('../core/message-delivery').bindMessageDelivery(hub, (name, data) => messageTransport?.deliver(name, data) ?? false, 80, { maxInFlight: MAX_REPLY_PACKETS });
  for (const n of ['state', 'threads', 'running', 'notification', 'collaboration', 'language-diagnostics', 'files-changed', 'debugger']) hub.on(n, (d) => send(n, d));
  hub.on('activity', (d) => send('activity', d)); // the live view
  // System notification when something finishes while the window is in the background.
  hub.on('notification', (n) => {
    // System notifications only when an agent needs you (core/attention.js); everything still goes to the bell.
    if (SMOKE || !Notification.isSupported() || (win && !win.isDestroyed() && win.isFocused()) || !shouldNotify(n, hub.store.data.settings)) return;
    const note = new Notification({ title: n.title, body: n.body || '', silent: false });
    note.on('click', () => { if (win) { win.show(); win.focus(); send('open-thread', n.threadId); } });
    note.show();
  });
  terminals.on('data', (d) => send('term-data', d));
  terminals.on('exit', (d) => send('term-exit', d));
}

const terminals = new TerminalManager();
const previewServers = new PreviewServers();
previewServers.on('state', (state) => send('preview-server', state));
let stoppingPreviews = false;
app.on('before-quit', (event) => {
  if (!stoppingPreviews && (previewServers.pending.size || [...previewServers.jobs.values()].some((job) => job.child))) {
    event.preventDefault(); stoppingPreviews = true;
    void previewServers.stopAll().finally(() => app.quit());
  }
});
let editors = [];
const knownProject = (p) => { if (!hub.isWorkspace(p)) throw new Error('Unknown project'); return p; };

const API = {
  updateState: () => updates.state(),
  checkForUpdates: () => updates.check(),
  downloadUpdate: () => updates.download(),
  cancelUpdate: () => updates.cancel(),
  installUpdate: () => updates.install(),
  configureUpdates: (input) => updates.configure(input),
  openUpdateDownloads: () => updates.openReleases(),
  windowState: () => ({ maximized: win.isMaximized(), fullscreen: win.isFullScreen(), platform: process.platform }),
  windowAction(action) {
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'fullscreen') {
      const current = win; const target = !current.isFullScreen();
      return new Promise((resolve) => {
        const event = target ? 'enter-full-screen' : 'leave-full-screen';
        const finish = () => { clearTimeout(timer); current.removeListener(event, finish); current.removeListener('closed', finish); resolve({ fullscreen: !current.isDestroyed() && current.isFullScreen() }); };
        const timer = setTimeout(finish, 1500); current.once(event, finish); current.once('closed', finish); current.setFullScreen(target);
      });
    }
    else if (action === 'close') win.close();
    else throw new Error('Unknown window action');
  },
  editAction(action) {
    if (!['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].includes(action)) throw new Error('Unknown edit action');
    win.webContents[action]();
  },
  async revealFile(p, rel) { const abs = await require('../core/files').projectPath(knownProject(p), rel); shell.showItemInFolder(abs); return true; },
  discoverPeers: () => require('../core/collaboration/peers').discover(),
  lanHostState: () => getLanHost().state(),
  async startLanHost(options) {
    await getLanHost().start(options);
    await lanHost.connectOwner((input) => hub.collaborationConnect(input));
    return lanHost.state();
  },
  async stopLanHost() {
    if (lanHost && (await hub.collaborationState()).endpoint === lanHost.state().endpoint) await hub.collaborationDisconnect();
    return getLanHost().stop();
  },
  collaborationState: () => hub.collaborationState(),
  collaborationConnect: (input) => hub.collaborationConnect(input),
  collaborationDisconnect: () => hub.collaborationDisconnect(),
  collaborationWatch: (id) => hub.collaborationWatch(id),
  collaborationCommand: (action, input, commandId) => hub.collaborationCommand(action, input, commandId),
  state: () => ({ ...hub.state(), credentialStorage: storageKind(safeStorage) }),
  extensionPacks: () => hub.listExtensionPacks(),
  searchExtensionPacks: (query) => hub.searchExtensionPacks(query),
  installExtensionPack: (id) => hub.installExtensionPack(id),
  extensionAppearance: (theme, icons) => hub.extensionAppearance(theme, icons),
  removeExtensionPack: (id) => hub.removeExtensionPack(id),
  async importExtensionPack() { const result = await dialog.showOpenDialog(win, { title: 'Import theme or file-icon pack', filters: [{ name: 'VS Code extension', extensions: ['vsix'] }], properties: ['openFile'] }); if (result.canceled || !result.filePaths[0]) return null; return hub.importExtensionPack(result.filePaths[0]); },
  resumeTurn: (thread, message) => hub.resumeTurn(thread, message),
  createTask: (input) => hub.createTask(input),
  personalWorkspace: () => hub.personalWorkspace(),
  testConnection: (id) => hub.testConnection(id),
  localModelServices: () => hub.localModelServices(),
  localEngineState: () => hub.localEngineState(),
  startLocalEngine: (input) => hub.startLocalEngine(input),
  stopLocalEngine: () => hub.stopLocalEngine(),
  async pickLocalEngineFile(kind) {
    if (!['server', 'model'].includes(kind)) throw Error('Choose an engine executable or GGUF model.');
    const result = await dialog.showOpenDialog(win, { title: kind === 'model' ? 'Choose a GGUF model' : 'Choose the llama-server executable', properties: ['openFile'], ...(kind === 'model' ? { filters: [{ name: 'GGUF model', extensions: ['gguf'] }] } : process.platform === 'win32' ? { filters: [{ name: 'Executable', extensions: ['exe'] }] } : {}) });
    return result.canceled ? null : result.filePaths[0] || null;
  },
  inspectLocalModels: (input) => hub.inspectLocalModels(input),
  connectLocalModel: (input) => hub.connectLocalModel(input),
  modelCatalog: (agent, gateway) => hub.modelCatalog(agent, gateway),
  createDocument: (t, m) => hub.createDocument(t, m),
  document: (t, d) => hub.document(t, d),
  saveDocument: (t, d, patch) => hub.saveDocument(t, d, patch),
  async exportQaBug(p, id, test, input) {
    const content = hub.qaBugReport(p, id, test, input);
    const result = await dialog.showSaveDialog(win, { title: 'Save bug report', defaultPath: 'bug-report.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, content, { mode: 0o600 }); return result.filePath;
  },
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
  thread: (id) => hub.readThread(id),
  createThread: (p) => hub.createThread(p),
  renameThread: (id, t) => hub.renameThread(id, t),
  deleteThread: (id) => hub.deleteThread(id),
  markThreadSeen: (id) => hub.markThreadSeen(id),
  activity: () => hub.activity(),
  lineAuthors: (p, rel) => hub.lineAuthors(p, rel),
  revertTurnHunk: (p, rel, messageId, line) => hub.revertTurnHunk(p, rel, messageId, line),
  // A conversation's separate working copy (its own git worktree and branch)
  createWorktree: (id) => hub.createWorktree(id),
  worktreeStatus: (id) => hub.worktreeStatus(id),
  mergeWorktree: (id, opts) => hub.mergeWorktree(id, { allowSecrets: !!opts?.allowSecrets }),
  discardWorktree: (id) => hub.discardWorktree(id),
  conversationDiff: (id, messageId, rel) => hub.conversationDiff(id, messageId, rel),
  reviewChanges: (id, agentId) => hub.reviewChanges(id, agentId),
  resolveCopyConflicts: (id, agentId) => hub.resolveCopyConflicts(id, agentId),
  abortCopyMerge: (id) => hub.abortCopyMerge(id),
  // Its GitHub pull request, through the gh CLI
  createPullRequest: (id, agentId, opts) => hub.createPullRequest(id, agentId, { allowSecrets: !!opts?.allowSecrets }),
  pushPullRequest: (id, opts) => hub.pushPullRequest(id, { allowSecrets: !!opts?.allowSecrets }),
  pullRequestStatus: (id) => hub.pullRequestStatus(id),
  fixFailingChecks: (id, agentId) => hub.fixFailingChecks(id, agentId),
  runVerify: (id, messageId) => hub.runVerify(id, messageId),
  attention: () => hub.attention(),
  runSetup: (id) => hub.runSetup(id),
  trustScript: (p, hash) => hub.trustScript(knownProject(p), hash),
  removeProject: (p) => hub.removeProject(p),
  send: (o) => hub.send(o).then((m) => ({ id: m.id, ok: m.ok })),
  stop: (id) => hub.stop(id),
  permissions: (threadId) => hub.permissions(threadId),
  answerPermission: (id, choice) => hub.answerPermission(id, choice),
  saveGateway: (g) => hub.saveGateway(g),
  deleteGateway: (id) => hub.deleteGateway(id),
  setSettings: (s) => hub.setSettings(s),
  gitInfo: (p) => hub.gitInfo(p),
  fileDiff: (p, rel) => hub.fileDiff(p, rel),
  syncInstructions: (p) => hub.syncInstructions(p),
  // Team secrets: names, members and keys only; decrypted values never come back to the window.
  teamSecrets: (p) => hub.teamSecrets.status(knownProject(p)),
  createTeamKey: () => hub.teamSecrets.createKey(),
  startTeamSecrets: (p, name) => hub.teamSecrets.start(knownProject(p), name),
  setTeamSecret: (p, name, value) => hub.teamSecrets.setValue(knownProject(p), name, value),
  addTeamMember: (p, member) => hub.teamSecrets.addMember(knownProject(p), member),
  removeTeamMember: (p, recipient) => hub.teamSecrets.removeMember(knownProject(p), recipient),
  async pickProject() {
    const r = await dialog.showOpenDialog(win, { title: 'Add project folder', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return hub.addProject(r.filePaths[0]);
  },
  openFile(p, rel) {
    const abs = path.resolve(knownProject(p), rel);
    if (!inside(p, abs)) throw new Error('Path outside project');
    return shell.openPath(abs);
  },
  openDiff: () => false,
  openAgentsFile: () => shell.openPath(hub.customAgentsFile),
  openExternal(url) { if (/^https?:\/\//.test(url)) return shell.openExternal(url); return null; },
  // Projects and files
  listFiles: (p) => hub.listFiles(p),
  qaRuns: (p) => hub.qaRuns(p),
  qaRun: (p, id) => hub.qaRun(p, id),
  importQaReport: (p, input) => hub.importQaReport(p, input),
  removeQaRun: (p, id) => hub.removeQaRun(p, id),
  qaImage: (p, id, artifact) => hub.qaImage(p, id, artifact),
  qaCapabilities: (p) => hub.qaCapabilities(p),
  openQaTrace: (p, id, artifact) => hub.openQaTrace(p, id, artifact),
  qaBugReport: (p, id, test, input) => hub.qaBugReport(p, id, test, input),
  projectCheckTools: (p) => hub.projectCheckTools(p),
  projectCheckState: (p) => hub.projectCheckState(p),
  runProjectCheck: (p, id) => hub.runProjectCheck(p, id),
  languageToolCatalog: () => hub.languageToolCatalog(),
  configureLanguageTools: (input) => hub.configureLanguageTools(input),
  languageAcquire: (p, rel) => hub.languageAcquire(p, rel),
  languageDocument: (p, rel, text, owner) => hub.languageDocument(p, rel, text, owner),
  languageComplete: (p, rel, text, position, owner) => hub.languageComplete(p, rel, text, position, owner),
  languageFormat: (p, rel, text, options, owner) => hub.languageFormat(p, rel, text, options, owner),
  languageLocations: (p, rel, text, position, kind, owner) => hub.languageLocations(p, rel, text, position, kind, owner),
  languageClose: (p, rel, owner) => hub.languageClose(p, rel, owner),
  formatSource: (p, rel, text, automatic) => hub.formatSource(p, rel, text, automatic),
  previewFormat: (p, exclude) => hub.previewFormat(p, exclude),
  formatDiff: (p, token, rel) => hub.formatDiff(p, token, rel),
  applyFormat: (p, token, selected, exclude, undo) => hub.applyFormat(p, token, selected, exclude, undo),
  debugState: (p) => hub.debugState(p),
  debugStart: (p, input) => hub.debugStart(p, input),
  debugAttach: (p, port) => hub.debugAttach(p, port),
  debugStop: (p) => hub.debugStop(p),
  debugAction: (p, action) => hub.debugAction(p, action),
  debugBreakpoint: (p, rel, line, enabled) => hub.debugBreakpoint(p, rel, line, enabled),
  debugFrame: (p, id) => hub.debugFrame(p, id),
  debugProperties: (p, id) => hub.debugProperties(p, id),
  debugEvaluate: (p, expression) => hub.debugEvaluate(p, expression),
  stopProjectCheck: (p) => hub.stopProjectCheck(p),
  addAttachments: (files) => hub.addAttachments(files),
  readAttachment: (id) => hub.readAttachment(id),
  readFile: (p, rel) => hub.readFile(p, rel),
  createEntry: (p, rel, kind) => hub.createEntry(p, rel, kind),
  findFiles: (p, query, options) => hub.findFiles(p, query, options),
  searchProject: (p, query, options) => hub.searchProject(p, query, options),
  readDirectory: (p, rel, options) => hub.readDirectory(p, rel, options),
  writeFile: (p, rel, content, mtime) => hub.writeFile(p, rel, content, mtime),
  // Unsaved text kept across a crash or restart
  draft: (key) => hub.draft(key),
  saveDraft: (key, data) => hub.saveDraft(key, data),
  compareDraft: (p, rel, text) => hub.compareDraft(p, rel, text),
  commit: (p, msg, opts) => hub.commit(p, msg, { allowSecrets: !!opts?.allowSecrets }),
  setProjectFolders: (p, folders) => hub.setProjectFolders(p, folders),
  renameProject: (p, name) => hub.renameProject(p, name),
  async openWorkspace() {
    const result = await dialog.showOpenDialog(win, { title: 'Open workspace', properties: ['openFile'], filters: [{ name: 'VS Code workspace', extensions: ['code-workspace'] }] });
    return result.canceled || !result.filePaths[0] ? null : hub.importWorkspace(result.filePaths[0]);
  },
  async saveWorkspace(p) {
    const project = hub.project(p); if (!project) throw new Error('Unknown project');
    const result = await dialog.showSaveDialog(win, { title: 'Save workspace as', defaultPath: path.join(project.path, project.name.replace(/[^a-z0-9_-]/gi, '-') + '.code-workspace'), filters: [{ name: 'VS Code workspace', extensions: ['code-workspace'] }] });
    if (result.canceled || !result.filePath) return null;
    return hub.exportWorkspace(p, result.filePath.endsWith('.code-workspace') ? result.filePath : result.filePath + '.code-workspace');
  },
  async pickFolders() {
    const r = await dialog.showOpenDialog(win, { title: 'Add folders to this workspace', properties: ['openDirectory', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  },
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
  judgeRace: (t, m, a) => hub.judgeRace(t, m, a),
  async exportThread(id) {
    const t = hub.thread(id); if (!t) throw new Error('Thread not found');
    const r = await dialog.showSaveDialog(win, { title: 'Export thread', defaultPath: `${t.title.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'thread'}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, hub.exportMarkdown(id)); return r.filePath;
  },
  // Memory
  memory: (p) => hub.memory(p),
  enableMemory: (p) => hub.enableMemory(p),
  saveMemory: (p, text, revision) => hub.saveMemory(p, text, revision),
  remember: (p, note) => hub.remember(p, note),
  // Notifications
  notifications: () => hub.notifications(),
  markRead: (id) => hub.markRead(id),
  clearNotifications: () => hub.clearNotifications(),
  // Skills and MCP
  skills: (p) => hub.skills(p),
  configureMemory: (p, input) => hub.configureMemory(p, input),
  searchMemory: (p, query) => hub.searchMemory(p, query),
  memoryHistory: (p) => hub.memoryHistory(p),
  memoryVersion: (p, id) => hub.memoryVersion(p, id),
  teamRuns: (id) => hub.teamRuns(id),
  watchFiles: (p, files) => hub.watchFiles(p, files),
  unwatchFiles: (id) => hub.unwatchFiles(id),
  connectorReport: (p) => hub.connectorReport(p),
  uiSkills: () => hub.uiSkills(),
  uiSkill: (id) => hub.uiSkill(id),
  shareSkill: (name, p) => hub.shareSkill(name, p),
  mcp: (p) => hub.mcp(p),
  addMcp: (server, ids) => hub.addMcp(server, ids),
  removeMcp: (id, name) => hub.removeMcp(id, name),
  // ACP registry
  registry: (opts) => hub.registry(opts),
  installRegistryAgent: (id) => hub.installRegistryAgent(id),
  removeRegistryAgent: (id) => hub.removeRegistryAgent(id),
  // Editors and terminals
  previewServerState: (p) => previewServers.state(knownProject(p)),
  startPreviewServer(p) { const root = knownProject(p); return previewServers.launch(root, async () => ({ ...await hub.teamEnvFor(root), ...hub.workspaceEnvFor(root) })); },
  stopPreviewServer: (p) => previewServers.stop(knownProject(p)),
  restartPreviewServer(p) { const root = knownProject(p); return previewServers.restart(root, async () => ({ ...await hub.teamEnvFor(root), ...hub.workspaceEnvFor(root) })); },
  editors: () => (editors = detectEditors()).map(({ id, name }) => ({ id, name })),
  openInEditor(editorId, p, rel, line) {
    const e = (editors.length ? editors : (editors = detectEditors())).find((x) => x.id === editorId); if (!e) throw new Error('Editor not found');
    const target = rel ? path.resolve(knownProject(p), rel) : knownProject(p);
    if (!inside(p, target)) throw new Error('Path outside project');
    openInEditor(e, { path: target, line }); return true;
  },
  async createTerminal({ cwd, project, cols, rows, command } = {}) {
    const dir = cwd && hub.project(cwd) ? cwd : (cwd && fs.existsSync(cwd) ? cwd : app.getPath('home'));
    const id = await terminals.createPrepared({ cwd: dir, project, cols, rows, flowControl: true }, async () => ({ ...await hub.teamEnvFor(dir), ...hub.workspaceEnvFor(dir) })); // team secrets, a copy's own ports
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
  termList: () => terminals.list(),
  termAttach: (id, owner) => terminals.attach(id, owner),
  termDetach: (id, owner) => terminals.detach(id, owner),
  termAck: (id, owner, seq) => terminals.acknowledge(id, owner, seq),
};

ipcMain.handle('hub', async (e, method, args) => {
  if (!win || e.sender !== win.webContents) throw new Error('Unknown sender');
  if (!Object.prototype.hasOwnProperty.call(API, method)) throw new Error(`Unknown method ${method}`);
  return hub.withHistoryOperation(() => API[method](...(Array.isArray(args) ? args : [])));
});

ipcMain.on('hub-message-ready', (event, epoch, listening) => {
  if (win && !win.isDestroyed() && ownsMessageFrame(event, win.webContents) && typeof listening === 'boolean') messageTransport?.ready(epoch, listening);
});
ipcMain.on('hub-message-ack', (event, token, consumed) => {
  if (win && !win.isDestroyed() && ownsMessageFrame(event, win.webContents)) messageTransport?.ack(token, consumed);
});

function createWindow() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon-512.png'));
  win = new BrowserWindow({
    width: 1280, height: 840, minWidth: 420, minHeight: 480, title: 'Tributary', icon, show: false,
    backgroundColor: '#1c1b1a', autoHideMenuBar: true, frame: process.platform === 'darwin',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  messageTransport?.close();
  const contents = win.webContents;
  const transport = createMessageTransport({
    send: (...args) => { if (contents.isDestroyed()) throw new Error('Reply window closed'); contents.send(...args); },
    onReady: () => disposeMessages?.reset(),
  });
  messageTransport = transport;
  contents.on('did-finish-load', () => transport.handshake());
  for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(event, () => send('window-state', { maximized: win.isMaximized(), fullscreen: win.isFullScreen(), platform: process.platform }));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (ev) => ev.preventDefault());
  // A replaced/crashed renderer cannot release its pane leases itself. The
  // desktop's single application renderer owns all of this host's LSP leases.
  win.webContents.on('did-start-navigation', (details) => { if (details.isMainFrame && !details.isSameDocument) { transport.reset(); hub?._languageTools?.stopAll(); terminals.detachAll(); } });
  contents.on('render-process-gone', () => transport.reset());
  contents.on('destroyed', () => transport.close());
  for (const event of ['render-process-gone', 'destroyed']) win.webContents.on(event, () => { hub?._languageTools?.stopAll(); terminals.detachAll(); });
  // Smoke runs stay hidden so they never take keyboard focus from whatever you are typing in.
  win.once('ready-to-show', () => { if (!SMOKE) win.show(); });
  win.loadFile(path.join(__dirname, '..', 'ui', 'dist', 'index.html'));
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu', submenu: [{ role: 'about' }, { label: 'Check for Updates…', click: () => send('show-updates') }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]) : null);
  const dataDir = app.getPath('userData');
  hub = new Hub({ dataDir, secrets: new DesktopSecrets(path.join(dataDir, 'secrets.json'), safeStorage), approvals: true, historyCache: true });
  updates = new (require('./updates').AppUpdates)({ app, secrets: hub.secrets, fetch: net.fetch.bind(net), shell,
    beforeInstall: () => {
      if (hub.running.size || [...hub.projectChecks.jobs.values()].some((job) => job.child) || [...(hub.debugger?.sessions?.values() || [])].some((session) => ['starting', 'running', 'paused'].includes(session.status)) || [...previewServers.jobs.values()].some((job) => job.child)) throw new Error('Stop agents, checks, debugging and preview servers before opening the installer.');
      if (lanHost?.state().running) throw new Error('Stop hosting the project room before opening the installer.');
    },
  });
  updates.on('state', (state) => send('app-update', state));
  await updates.init();
  keepAwake(require('electron').powerSaveBlocker, hub); // while agents run
  hub.probeDelayMs = 1500; // agent version probes wait until the window has painted
  // Projects passed on the command line: `tributary /path/to/project`
  for (const a of process.argv.slice(app.isPackaged ? 1 : 2)) { if (!a.startsWith('-')) { try { hub.addProject(a); } catch {} } }
  wireEvents();
  createWindow();
  // Show the app while agent discovery runs. Register smoke listeners before awaiting it.
  const initialized = hub.init();
  initialized.catch((e) => { console.error('Agent discovery failed:', e.message); });
  if (SMOKE) {
    // Renderer errors in the report, so a blank or broken screen explains itself.
    win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log(`SMOKE renderer error: ${String(e.message).slice(0, 400)}`); });
    win.webContents.on('render-process-gone', (_e, d) => console.log(`SMOKE renderer gone: ${d.reason}`));
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
          // Streaming progress: how much of the reply the window shows, against what the hub has.
          const live = hub.store.data.threads.flatMap((t) => t.messages).filter((m) => m.role === 'assistant').pop();
          if (live && !done) console.log(`SMOKE streaming hub=${(live.text || '').length} window=${await win.webContents.executeJavaScript(`([...document.querySelectorAll('.prose-reply')].pop() || {}).textContent?.length || 0`)}`);
          if (done || hub.permissions().length) break; // a turn waiting for permission: the clicks can answer it
        }
        await new Promise((r) => setTimeout(r, 800));
      }
      // TRIBUTARY_SMOKE_SEND='[{"agent":"id","text":"go"}]' (or {"team": {...}}, {"race": {...}}) starts a turn, team or race in each of the first threads, from here
      // rather than through the composer, so a check can watch agents work without typing into the app.
      for (const [i, r] of JSON.parse(process.env.TRIBUTARY_SMOKE_SEND || '[]').entries()) {
        const t = hub.store.data.threads[i];
        if (t && r.race) hub.runRace(t.id, r.race).catch((e) => console.log(`SMOKE race failed: ${e.message}`));
        else if (t && r.team) hub.runTeam(t.id, r.team).catch((e) => console.log(`SMOKE team failed: ${e.message}`));
        else if (t && r.agent) hub.send({ threadId: t.id, agentId: r.agent, text: r.text || 'go', mode: 'edit' }).catch((e) => console.log(`SMOKE send failed: ${e.message}`));
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
          // The accessible name: aria-label, or the text without decorative (aria-hidden) parts such as avatars.
          const name = (b) => { if (b.getAttribute('aria-label')) return b.getAttribute('aria-label').trim().toLowerCase(); const c = b.cloneNode(true); c.querySelectorAll('[aria-hidden="true"]').forEach((x) => x.remove()); return (c.textContent || '').trim().toLowerCase(); };
          // Look in the topmost open dialog first: clicking behind it would close it.
          const pick = (root) => { const all = [...root.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="tab"], [role="radio"], [role="option"]')]; return all.find((b) => name(b) === want) || all.find((b) => name(b).startsWith(want)); };
          const top = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].pop();
          const el = (top && pick(top)) || pick(document);
          if (!el) throw new Error('smoke: no button ' + want);
          // Menus open on pointerdown, so send the whole sequence a mouse would.
          const at = { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', isPrimary: true };
          el.dispatchEvent(new PointerEvent('pointerdown', at)); el.dispatchEvent(new MouseEvent('mousedown', at));
          el.dispatchEvent(new PointerEvent('pointerup', at)); el.dispatchEvent(new MouseEvent('mouseup', at));
          el.click();
          // In the hidden window synthetic pointer events don't open Radix dropdown menus; Enter on the trigger does.
          if (el.getAttribute('aria-haspopup') === 'menu' && el.getAttribute('data-state') === 'closed') { el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); }
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
let stoppedHostingForQuit = false;
let stoppingLocalEngine = false;
app.on('before-quit', (event) => {
  const engine = hub?._localEngine;
  if (!engine?.child && !engine?.starting) return;
  event.preventDefault();
  if (stoppingLocalEngine) return;
  stoppingLocalEngine = true;
  void engine.stop().catch(error => console.error('Could not stop the local engine:', error.message)).finally(() => { stoppingLocalEngine = false; app.quit(); });
});
app.on('before-quit', (event) => {
  if (!lanHost || stoppedHostingForQuit) return;
  event.preventDefault();
  lanHost.stop().catch((e) => console.error(`Could not stop hosting: ${e.message}`)).finally(() => { stoppedHostingForQuit = true; app.quit(); });
});
app.on('will-quit', () => { disposeMessages?.(); messageTransport?.close(); updates?.dispose(); hub?._qaResults?.stopAll(); hub?._languageTools?.stopAll(); hub?.debugger?.stopAll(); hub?.projectChecks.stopAll(); try { hub?.store.close(); } catch (e) { console.error(`Could not save on quit: ${e.message}`); } });
app.on('window-all-closed', () => { if (hub) { hub._qaResults?.stopAll(); hub._languageTools?.stopAll(); hub.debugger?.stopAll(); hub.projectChecks.stopAll(); for (const id of hub.running.keys()) hub.stop(id); hub.collaborationClient?.disconnect(); hub.fileWatches.close(); } previewServers.stopAll(); terminals.killAll(); if (process.platform !== 'darwin' || SMOKE) app.quit(); });
