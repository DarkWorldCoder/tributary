'use strict';
// Tributary for VS Code: the same core and UI as the desktop app, inside a webview.
// Workspace folders become projects. Diffs, terminals and file opening use VS Code itself.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DIST = path.join(__dirname, 'dist');
const { Hub } = require(path.join(DIST, 'core'));
const { bindMessageDelivery } = require(path.join(DIST, 'core', 'message-delivery'));
// Streaming updates send only what changed (core/message-patch.js).
let disposeMessages;
const { inside } = require(path.join(DIST, 'core', 'acp'));

let hub = null;
const webviews = new Set();
const HEAD_SCHEME = 'tributary-head';

class Secrets {
  constructor(store) { this.store = store; }
  async get(k) { return this.store.get(`tributary:${k}`); }
  async set(k, v) { await this.store.store(`tributary:${k}`, v); }
  async delete(k) { await this.store.delete(`tributary:${k}`); }
}

function post(name, data) { return Promise.allSettled([...webviews].map((w) => w.postMessage({ type: 'event', name, data }))).then(results => results.every(result => result.status === 'fulfilled' && result.value !== false)); }

function syncWorkspaceProjects() {
  for (const f of vscode.workspace.workspaceFolders || []) { try { hub.addProject(f.uri.fsPath); } catch { /* not a folder */ } }
}
const knownProject = (p) => { if (!hub.isWorkspace(p)) throw new Error('Unknown project'); return p; };
const fileUri = (p, rel) => { const abs = path.resolve(knownProject(p), rel); if (!inside(p, abs)) throw new Error('Path outside project'); return vscode.Uri.file(abs); };

const API = {
  state: () => ({ ...hub.state(), credentialStorage: 'encrypted' }),
  discoverPeers: () => require('../core/collaboration/peers').discover(),
  collaborationState: () => hub.collaborationState(),
  collaborationConnect: (input) => hub.collaborationConnect(input),
  collaborationDisconnect: () => hub.collaborationDisconnect(),
  collaborationWatch: (id) => hub.collaborationWatch(id),
  collaborationCommand: (action, input, commandId) => hub.collaborationCommand(action, input, commandId),
  resumeTurn: (thread, message) => hub.resumeTurn(thread, message),
  createTask: (input) => hub.createTask(input),
  personalWorkspace: () => hub.personalWorkspace(),
  testConnection: (id) => hub.testConnection(id),
  localModelServices: () => hub.localModelServices(),
  inspectLocalModels: (input) => hub.inspectLocalModels(input),
  connectLocalModel: (input) => hub.connectLocalModel(input),
  modelCatalog: (agent, gateway) => hub.modelCatalog(agent, gateway),
  createDocument: (t, m) => hub.createDocument(t, m),
  document: (t, d) => hub.document(t, d),
  saveDocument: (t, d, patch) => hub.saveDocument(t, d, patch),
  async exportQaBug(p, id, test, input) {
    const content = hub.qaBugReport(p, id, test, input);
    const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(p, 'bug-report.md')), filters: { Markdown: ['md'] } });
    if (!uri) return null; fs.writeFileSync(uri.fsPath, content, { mode: 0o600 }); return uri.fsPath;
  },
  async exportDocument(t, d, format = 'md') {
    if (!['md', 'txt'].includes(format)) throw new Error('Choose Markdown or plain text.');
    const doc = hub.document(t, d);
    const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(hub.thread(t).project, `${doc.title.replace(/[^\w.-]+/g, '-').slice(0, 70) || 'document'}.${format}`)), filters: { [format === 'md' ? 'Markdown' : 'Plain text']: [format] } });
    if (!uri) return null; await fs.promises.writeFile(uri.fsPath, doc.content, 'utf8'); return uri.fsPath;
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
  createWorktree: (id) => hub.createWorktree(id), worktreeStatus: (id) => hub.worktreeStatus(id), mergeWorktree: (id, opts) => hub.mergeWorktree(id, { allowSecrets: !!opts?.allowSecrets }), discardWorktree: (id) => hub.discardWorktree(id),
  conversationDiff: (id, messageId, rel) => hub.conversationDiff(id, messageId, rel), reviewChanges: (id, agentId) => hub.reviewChanges(id, agentId),
  resolveCopyConflicts: (id, agentId) => hub.resolveCopyConflicts(id, agentId), abortCopyMerge: (id) => hub.abortCopyMerge(id), runVerify: (id, messageId) => hub.runVerify(id, messageId), attention: () => hub.attention(),
  runSetup: (id) => hub.runSetup(id), trustScript: (p, hash) => hub.trustScript(knownProject(p), hash),
  createPullRequest: (id, agentId, opts) => hub.createPullRequest(id, agentId, { allowSecrets: !!opts?.allowSecrets }), pushPullRequest: (id, opts) => hub.pushPullRequest(id, { allowSecrets: !!opts?.allowSecrets }),
  pullRequestStatus: (id) => hub.pullRequestStatus(id), fixFailingChecks: (id, agentId) => hub.fixFailingChecks(id, agentId),
  removeProject: () => false,
  async pickProject() { const r = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Open folder in Tributary' }); if (!r?.[0]) return null; hub.addProject(r[0].fsPath); return r[0].fsPath; },
  send: (o) => hub.send(o).then((m) => ({ id: m.id, ok: m.ok })),
  stop: (id) => hub.stop(id),
  permissions: (threadId) => hub.permissions(threadId),
  answerPermission: (id, choice) => hub.answerPermission(id, choice),
  saveGateway: (g) => hub.saveGateway(g),
  deleteGateway: (id) => hub.deleteGateway(id),
  setSettings: (s) => hub.setSettings(s),
  gitInfo: (p) => hub.gitInfo(p),
  fileDiff: (p, rel) => hub.fileDiff(p, rel),
  async revealFile(p, rel) { const abs = await require('../core/files').projectPath(knownProject(p), rel); await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(abs)); return true; },
  syncInstructions: (p) => hub.syncInstructions(p),
  teamSecrets: (p) => hub.teamSecrets.status(knownProject(p)),
  createTeamKey: () => hub.teamSecrets.createKey(),
  startTeamSecrets: (p, name) => hub.teamSecrets.start(knownProject(p), name),
  setTeamSecret: (p, name, value) => hub.teamSecrets.setValue(knownProject(p), name, value),
  addTeamMember: (p, member) => hub.teamSecrets.addMember(knownProject(p), member),
  removeTeamMember: (p, recipient) => hub.teamSecrets.removeMember(knownProject(p), recipient),
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
  projectEditorTools: (p) => hub.projectEditorTools(p),
  editorFileSettings: (p, rel) => hub.editorFileSettings(p, rel),
  prepareEditorSave: (p, rel, text, skipFormat) => hub.prepareEditorSave(p, rel, text, skipFormat),
  eslintAcquire: (p, rel) => hub.eslintAcquire(p, rel),
  eslintDocument: (p, rel, text, owner, reason) => hub.eslintDocument(p, rel, text, owner, reason),
  eslintClose: (p, rel, owner) => hub.eslintClose(p, rel, owner),
  eslintFix: (p, rel, text) => hub.eslintFix(p, rel, text),
  restartEslint: (p) => hub.restartEslint(p),
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
  readAttachment: (id, options) => hub.readAttachment(id, options),
  readFile: (p, rel, options) => hub.readFile(p, rel, options),
  createEntry: (p, rel, kind) => hub.createEntry(p, rel, kind),
  fileSearchAcquire: (p) => hub.fileSearchAcquire(p),
  fileSearch: (owner, query, options) => hub.fileSearch(owner, query, options),
  fileSearchClose: (owner) => hub.fileSearchClose(owner),
  findFiles: (p, query, options) => hub.findFiles(p, query, options),
  searchProject: (p, query, options) => hub.searchProject(p, query, options),
  readDirectory: (p, rel, options) => hub.readDirectory(p, rel, options),
  writeFile: (p, rel, c, m) => hub.writeFile(p, rel, c, m),
  draft: (key) => hub.draft(key), saveDraft: (key, data) => hub.saveDraft(key, data), compareDraft: (p, rel, text) => hub.compareDraft(p, rel, text),
  commit: (p, msg, opts) => hub.commit(p, msg, { allowSecrets: !!opts?.allowSecrets }),
  setProjectFolders: (p, f) => hub.setProjectFolders(p, f),
  renameProject: (p, name) => hub.renameProject(p, name),
  async openWorkspace() { const result = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFiles: true, canSelectFolders: false, filters: { Workspace: ['code-workspace'] } }); return result?.[0] ? hub.importWorkspace(result[0].fsPath) : null; },
  async saveWorkspace(p) { const project = hub.project(p); if (!project) throw new Error('Unknown project'); const file = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(project.path, project.name.replace(/[^a-z0-9_-]/gi, '-') + '.code-workspace')), filters: { Workspace: ['code-workspace'] } }); return file ? hub.exportWorkspace(p, file.fsPath.endsWith('.code-workspace') ? file.fsPath : file.fsPath + '.code-workspace') : null; },
  async pickFolders() { const r = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: true, openLabel: 'Add folders' }); return (r || []).map((entry) => entry.fsPath); },
  async pickFolder() { const r = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Add folder' }); return r && r[0] ? r[0].fsPath : null; },
  restoreCheckpoint: (t, m) => hub.restoreCheckpoint(t, m),
  turnDiff: (t, m, rel) => hub.turnDiff(t, m, rel),
  threadChanges: (t) => hub.threadChanges(t),
  runTeam: (t, team) => hub.runTeam(t, team).then((r) => r, (e) => ({ error: e.message })),
  runRace: (t, o) => hub.runRace(t, o).then(() => ({ ok: true }), (e) => ({ error: e.message })),
  applyRace: (t, m, a) => hub.applyRace(t, m, a),
  judgeRace: (t, m, a) => hub.judgeRace(t, m, a),
  async exportThread(id) {
    const t = hub.thread(id); if (!t) throw new Error('Thread not found');
    const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(t.project, `${t.title.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'thread'}.md`)), filters: { Markdown: ['md'] } });
    if (!uri) return null; fs.writeFileSync(uri.fsPath, hub.exportMarkdown(id)); return uri.fsPath;
  },
  memory: (p) => hub.memory(p), enableMemory: (p) => hub.enableMemory(p), saveMemory: (p, t, revision) => hub.saveMemory(p, t, revision), remember: (p, n) => hub.remember(p, n),
  notifications: () => hub.notifications(), markRead: (id) => hub.markRead(id), clearNotifications: () => hub.clearNotifications(),
  skills: (p) => hub.skills(p), shareSkill: (n, p) => hub.shareSkill(n, p),
  configureMemory: (p, input) => hub.configureMemory(p, input),
  searchMemory: (p, query) => hub.searchMemory(p, query),
  memoryHistory: (p) => hub.memoryHistory(p),
  memoryVersion: (p, id) => hub.memoryVersion(p, id),
  teamRuns: (id) => hub.teamRuns(id),
  watchFiles: (p, files, id) => hub.watchFiles(p, files, id),
  unwatchFiles: (id) => hub.unwatchFiles(id),
  connectorReport: (p) => hub.connectorReport(p),
  uiSkills: () => hub.uiSkills(), uiSkill: (id) => hub.uiSkill(id),
  mcp: (p) => hub.mcp(p), addMcp: (s, ids) => hub.addMcp(s, ids), removeMcp: (id, n) => hub.removeMcp(id, n),
  registry: (o) => hub.registry(o), installRegistryAgent: (id) => hub.installRegistryAgent(id), removeRegistryAgent: (id) => hub.removeRegistryAgent(id),
  // VS Code does these natively.
  async openFile(p, rel, line) {
    const doc = await vscode.workspace.openTextDocument(fileUri(p, rel));
    const ed = await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
    if (line) { const pos = new vscode.Position(Math.max(0, line - 1), 0); ed.selection = new vscode.Selection(pos, pos); ed.revealRange(new vscode.Range(pos, pos)); }
    return true;
  },
  async openDiff(p, rel) {
    const right = fileUri(p, rel);
    const left = vscode.Uri.from({ scheme: HEAD_SCHEME, path: right.path, query: JSON.stringify({ project: p, rel }) });
    await vscode.commands.executeCommand('vscode.diff', left, right, `${rel} (last commit ↔ now)`, { preview: true, viewColumn: vscode.ViewColumn.One });
    return true;
  },
  openInEditor: (_id, p, rel, line) => (rel ? API.openFile(p, rel, line) : true),
  editors: () => [],
  openExternal: (url) => (/^https?:\/\//.test(url) ? vscode.env.openExternal(vscode.Uri.parse(url)) : null),
  openAgentsFile: async () => { const doc = await vscode.workspace.openTextDocument(hub.customAgentsFile); await vscode.window.showTextDocument(doc); },
  async createTerminal({ cwd, command } = {}) {
    const term = vscode.window.createTerminal({ name: command ? `Tributary: ${command.split(' ')[0].split('/').pop()}` : 'Tributary', cwd: cwd && fs.existsSync(cwd) ? cwd : undefined, env: { ...await hub.teamEnvFor(cwd), ...hub.workspaceEnvFor(cwd) } });
    term.show(); if (command) term.sendText(command, true); return 'vscode';
  },
  termWrite: () => false, termResize: () => false, termKill: () => false,
};

class HeadContent {
  provideTextDocumentContent(uri) {
    const { project, rel } = JSON.parse(uri.query);
    return new Promise((resolve) => execFile('git', ['show', `HEAD:${rel.replace(/\\/g, '/')}`], { cwd: project, maxBuffer: 20 * 1024 * 1024 }, (e, out) => resolve(e ? '' : out)));
  }
}

function html(webview, extUri) {
  const root = vscode.Uri.joinPath(extUri, 'dist', 'ui');
  let page = fs.readFileSync(path.join(DIST, 'ui', 'index.html'), 'utf8');
  const asset = (p) => webview.asWebviewUri(vscode.Uri.joinPath(root, p)).toString();
  page = page.replace(/(src|href)="\.\/([^"]+)"/g, (_, a, p) => `${a}="${asset(p)}"`);
  const csp = `default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; font-src ${webview.cspSource} data:; frame-src blob:; worker-src blob:; connect-src ${webview.cspSource};`;
  page = page.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, `<meta http-equiv="Content-Security-Policy" content="${csp}">`);
  // The bridge must define window.hub before the app module runs.
  page = page.replace('<script type="module"', `<script src="${asset('vscode-bridge.js')}"></script>\n    <script type="module"`);
  return page;
}

function attach(webview, extUri) {
  const fileWatches = new Set(); const languageOwners = new Set(); const eslintOwners = new Set(); const searchOwners = new Set(); let disposed = false;
  webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extUri, 'dist')] };
  webview.html = html(webview, extUri);
  webviews.add(webview);
  webview.onDidReceiveMessage(async (msg) => {
    if (disposed || !msg || msg.type !== 'call') return;
    try {
      await hub.withHistoryOperation(async () => {
      if (!Object.prototype.hasOwnProperty.call(API, msg.method)) throw new Error(`Unknown method ${msg.method}`);
      if (['fileSearch', 'fileSearchClose'].includes(msg.method) && !searchOwners.has(msg.args?.[0])) throw new Error('Unknown file search owner');
      if (msg.method === 'watchFiles' && msg.args?.[2] !== undefined && !fileWatches.has(msg.args[2])) throw new Error('Unknown live file view');
      const result = await API[msg.method](...(msg.args || []));
      if (msg.method === 'fileSearchAcquire') { if (disposed) hub.fileSearchClose(result); else searchOwners.add(result); }
      if (msg.method === 'fileSearchClose') searchOwners.delete(msg.args?.[0]);
      if (msg.method === 'watchFiles') { if (disposed) hub.unwatchFiles(result); else fileWatches.add(result); }
      if (msg.method === 'unwatchFiles') fileWatches.delete(msg.args?.[0]);
      if (msg.method === 'languageAcquire') { if (disposed) hub._languageTools?.release(result); else languageOwners.add(result); }
      if (msg.method === 'languageClose') languageOwners.delete(msg.args?.[2]);
      if (msg.method === 'eslintAcquire') { if (disposed) hub._eslintTools?.releaseOwner(result); else eslintOwners.add(result); }
      if (msg.method === 'eslintClose') eslintOwners.delete(msg.args?.[2]);
      await webview.postMessage({ type: 'result', id: msg.id, result: result === undefined ? null : result });
      });
    } catch (e) { webview.postMessage({ type: 'result', id: msg.id, error: e.message || String(e) }); }
  });
  return () => { disposed = true; webviews.delete(webview); for (const owner of searchOwners) hub.fileSearchClose(owner); searchOwners.clear(); for (const id of fileWatches) hub.unwatchFiles(id); fileWatches.clear(); for (const owner of languageOwners) hub._languageTools?.release(owner); languageOwners.clear(); for (const owner of eslintOwners) hub._eslintTools?.releaseOwner(owner); eslintOwners.clear(); };
}

class ChatView {
  constructor(ctx) { this.ctx = ctx; this.view = null; }
  resolveWebviewView(view) { this.view = view; const off = attach(view.webview, this.ctx.extensionUri); view.onDidDispose(off); }
}

function currentProject() {
  const ed = vscode.window.activeTextEditor;
  const f = ed ? vscode.workspace.getWorkspaceFolder(ed.document.uri) : (vscode.workspace.workspaceFolders || [])[0];
  return f ? f.uri.fsPath : null;
}

async function activate(context) {
  const dataDir = context.globalStorageUri.fsPath;
  fs.mkdirSync(dataDir, { recursive: true });
  hub = new Hub({ dataDir, secrets: new Secrets(context.secrets), approvals: true, historyCache: true });
  hub.init().catch((e) => vscode.window.showWarningMessage(`Tributary could not finish finding agents: ${e.message}`));
  syncWorkspaceProjects();

  // Stream updates to the UI, coalesced so long replies do not flood the webview.
  disposeMessages = bindMessageDelivery(hub, post);
  for (const n of ['state', 'threads', 'running', 'notification', 'collaboration', 'language-diagnostics', 'eslint-revalidate', 'files-changed', 'debugger']) hub.on(n, (d) => post(n, d));
  hub.on('activity', (d) => post('activity', d)); // the live view

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'tributary.focus';
  const refreshStatus = () => {
    const n = hub.running.size;
    status.text = n ? `$(loading~spin) Tributary: ${n} running` : '$(hubot) Tributary';
    status.tooltip = n ? 'Agents are working. Click to open Tributary.' : 'Open Tributary';
    status.show();
  };
  hub.on('running', refreshStatus); refreshStatus();

  hub.on('notification', async (n) => {
    if (!require('../core/attention').shouldNotify(n, hub.store.data.settings)) return; // the rest stays in the bell
    const show = n.kind === 'failed' || n.kind === 'permission' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    const pick = await show(`${n.title}${n.body ? `: ${n.body}` : ''}`, 'Open');
    if (pick === 'Open') { await vscode.commands.executeCommand('tributary.chat.focus'); if (n.threadId) post('open-thread', n.threadId); }
  });

  const view = new ChatView(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('tributary.chat', view, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.workspace.registerTextDocumentContentProvider(HEAD_SCHEME, new HeadContent()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { syncWorkspaceProjects(); post('state'); }),
    status,
    vscode.commands.registerCommand('tributary.focus', () => vscode.commands.executeCommand('tributary.chat.focus')),
    vscode.commands.registerCommand('tributary.open', () => {
      const panel = vscode.window.createWebviewPanel('tributary.panel', 'Tributary', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')] });
      panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
      const off = attach(panel.webview, context.extensionUri); panel.onDidDispose(off);
    }),
    vscode.commands.registerCommand('tributary.newThread', async () => { await vscode.commands.executeCommand('tributary.chat.focus'); const p = currentProject(); if (p) post('focus-project', p); }),
    vscode.commands.registerCommand('tributary.askSelection', async () => {
      const ed = vscode.window.activeTextEditor; if (!ed) return;
      const p = currentProject(); const rel = p ? path.relative(p, ed.document.uri.fsPath) : ed.document.uri.fsPath;
      const sel = ed.selection; const text = ed.document.getText(sel);
      const range = sel.isEmpty ? '' : `:${sel.start.line + 1}-${sel.end.line + 1}`;
      await vscode.commands.executeCommand('tributary.chat.focus');
      if (p) post('focus-project', p);
      post('insert', `In @${rel}${range}:\n\`\`\`${ed.document.languageId}\n${text}\n\`\`\`\n`);
    }),
    vscode.commands.registerCommand('tributary.addFile', async (uri) => {
      const target = uri && uri.fsPath ? uri : vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri; if (!target) return;
      const folder = vscode.workspace.getWorkspaceFolder(target);
      await vscode.commands.executeCommand('tributary.chat.focus');
      post('insert', `@${folder ? path.relative(folder.uri.fsPath, target.fsPath) : target.fsPath} `);
    }),
    vscode.commands.registerCommand('tributary.reviewChanges', async () => {
      const p = currentProject(); if (!p) return;
      const g = await hub.gitInfo(p); if (!g || !g.changed.length) { vscode.window.showInformationMessage('No uncommitted changes.'); return; }
      const pick = await vscode.window.showQuickPick(g.changed.map((c) => ({ label: c.path, description: c.code })), { placeHolder: 'Pick a changed file to see its diff' });
      if (pick) await API.openDiff(p, path.relative(p, path.join(g.root, pick.label)));
    }),
    { dispose: () => { hub._qaResults?.stopAll(); hub._languageTools?.stopAll(); hub._eslintTools?.stopAll(); hub._fileSearches?.stopAll(); hub.debugger?.stopAll(); hub.projectChecks.stopAll(); for (const id of hub.running.keys()) hub.stop(id); } },
  );
}

function deactivate() { disposeMessages?.(); if (hub) { hub._qaResults?.stopAll(); hub._languageTools?.stopAll(); hub._eslintTools?.stopAll(); hub._fileSearches?.stopAll(); hub.debugger?.stopAll(); hub.projectChecks.stopAll(); for (const id of hub.running.keys()) hub.stop(id); hub.collaborationClient?.disconnect(); hub.fileWatches.close(); try { hub.store.close(); } catch {} } }

module.exports = { activate, deactivate };
