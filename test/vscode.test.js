'use strict';
// Exercises the VS Code extension against a stand-in `vscode` module (no VS Code download needed).
const test = require('node:test');
const { mkdtemp: mkTmp } = require('./helpers/tmp');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

test('packaged shared core creates team keys outside the source checkout', () => {
  const isolated = mkTmp('vsc-runtime');
  for (const directory of ['core', 'node_modules']) fs.cpSync(path.join(__dirname, '..', 'vscode', 'dist', directory), path.join(isolated, directory), { recursive: true });
  const result = execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { TeamSecrets } = require('./core/team-secrets');
    const { MemorySecrets } = require('./core/store');
    const { SecretGuard } = require('./core/secret-guard');
    (async () => {
      const team = new TeamSecrets(new MemorySecrets(), new SecretGuard());
      const publicKey = await team.createKey();
      assert.match(publicKey, /^age1[02-9ac-hj-np-z]{58}$/);
      assert.equal(await team.key(), publicKey);
      const fs = require('node:fs'); const path = require('node:path');
      const project = path.resolve('format-project'); fs.mkdirSync(project);
      fs.writeFileSync(path.join(project, '.prettierrc.json'), JSON.stringify({ singleQuote: true, semi: false }));
      fs.writeFileSync(path.join(project, 'main.js'), 'const value=1;');
      const text = await require('./core/project-format').formatProjectSource(project, 'main.js', 'const value=2;', true);
      assert.equal(text, 'const value = 2' + String.fromCharCode(10));
      const workspace = require('./core/workspace-file'); const filename = path.resolve('saved.code-workspace');
      assert.deepEqual(workspace.parseWorkspace(filename, workspace.serializeWorkspace(filename, [project])), [project]);
      console.log('ok');
    })().catch(() => process.exit(1));
  `], { cwd: isolated, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } });
  assert.equal(result.trim(), 'ok');
});

function fakeVscode(workspace) {
  const commands = new Map(); const views = new Map(); const shown = [];
  const Uri = {
    file: (p) => ({ fsPath: p, path: p, scheme: 'file', toString: () => `file://${p}` }),
    joinPath: (u, ...parts) => Uri.file(path.join(u.fsPath, ...parts)),
    from: (o) => o, parse: (s) => ({ toString: () => s }),
  };
  const disposable = { dispose() {} };
  return {
    commands, views, shown,
    api: {
      Uri, ViewColumn: { One: 1, Beside: 2 }, StatusBarAlignment: { Left: 1 },
      Position: class {}, Range: class {}, Selection: class {},
      window: {
        registerWebviewViewProvider: (id, p) => { views.set(id, p); return disposable; },
        createStatusBarItem: () => ({ show() {}, dispose() {} }),
        showInformationMessage: async (m) => { shown.push(m); }, showWarningMessage: async (m) => { shown.push(m); },
        activeTextEditor: undefined, createTerminal: () => ({ show() {}, sendText() {} }),
      },
      workspace: {
        workspaceFolders: [{ uri: Uri.file(workspace) }],
        registerTextDocumentContentProvider: () => disposable, onDidChangeWorkspaceFolders: () => disposable,
        getWorkspaceFolder: () => ({ uri: Uri.file(workspace) }),
      },
      commands: { registerCommand: (id, fn) => { commands.set(id, fn); return disposable; }, executeCommand: async () => {} },
      env: { openExternal: async () => true },
    },
  };
}

test('VS Code extension: activates, serves the UI with the bridge, and answers hub calls', async () => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'vscode', 'dist', 'ui', 'index.html')), 'run node vscode/build.js first');
  const ws = mkTmp('vsc-ws');
  const fake = fakeVscode(ws);
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) { return req === 'vscode' ? 'vscode' : orig.call(this, req, ...rest); };
  require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: fake.api };
  try {
    const ext = require('../vscode/extension.js');
    const storage = mkTmp('vsc-data');
    const secrets = new Map();
    const context = {
      extensionUri: fake.api.Uri.file(path.join(__dirname, '..', 'vscode')), globalStorageUri: fake.api.Uri.file(storage), subscriptions: [],
      secrets: { get: async (k) => secrets.get(k), store: async (k, v) => { secrets.set(k, v); }, delete: async (k) => { secrets.delete(k); } },
    };
    await ext.activate(context);
    for (const c of ['tributary.open', 'tributary.askSelection', 'tributary.addFile', 'tributary.reviewChanges', 'tributary.newThread', 'tributary.focus']) assert.ok(fake.commands.has(c), c);
    const provider = fake.views.get('tributary.chat'); assert.ok(provider);

    const posted = []; let onMsg = null;
    const webview = {
      options: null, html: '', cspSource: 'vscode-resource:', asWebviewUri: (u) => ({ toString: () => `vscode-resource:${u.fsPath}` }),
      postMessage: (m) => { posted.push(m); return Promise.resolve(true); }, onDidReceiveMessage: (fn) => { onMsg = fn; return { dispose() {} }; },
    };
    provider.resolveWebviewView({ webview, onDidDispose: () => {} });
    assert.ok(webview.options.enableScripts);
    const html = webview.html;
    assert.ok(html.indexOf('vscode-bridge.js') > -1 && html.indexOf('vscode-bridge.js') < html.indexOf('type="module"'), 'bridge loads before the app');
    assert.match(html, /src="vscode-resource:[^"]+assets\/app\.js"/);
    assert.match(html, /script-src vscode-resource:;/);
    assert.doesNotMatch(html, /src="\.\//);

    await onMsg({ type: 'call', id: 7, method: 'state', args: [] });
    const res = posted.find((m) => m.type === 'result' && m.id === 7);
    assert.ok(res && !res.error, JSON.stringify(res));
    assert.ok(res.result.projects.some((p) => p.path === ws), 'workspace folder became a project');
    assert.equal(res.result.credentialStorage, 'encrypted');
    await onMsg({ type: 'call', id: 9, method: 'collaborationState', args: [] });
    assert.equal(posted.find((m) => m.id === 9).result.status, 'disconnected');
    await onMsg({ type: 'call', id: 10, method: 'readDirectory', args: [ws, '', {}] });
    assert.deepEqual(posted.find((m) => m.id === 10).result.entries, []);
    await onMsg({ type: 'call', id: 11, method: 'createTask', args: [{ templateId: 'write', goal: 'Draft a project note' }] });
    assert.ok(posted.find((m) => m.id === 11).result.thread.task);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'acp-registry.json'), 'utf8')) });
    try { await onMsg({ type: 'call', id: 101, method: 'registry', args: [] }); } finally { globalThis.fetch = realFetch; }
    const reg = posted.find((m) => m.id === 101);
    assert.ok(reg && !reg.error && reg.result.agents.some((a) => a.id === 'qwen-code' && a.installed === false), JSON.stringify(reg));
    await onMsg({ type: 'call', id: 102, method: 'removeRegistryAgent', args: ['qwen-code'] });
    assert.strictEqual(posted.find((m) => m.id === 102).result, false);
    await onMsg({ type: 'call', id: 8, method: 'nope', args: [] });
    assert.match(posted.find((m) => m.id === 8).error, /Unknown method/);
    ext.deactivate();
  } finally {
    Module._resolveFilename = orig; delete require.cache.vscode;
  }
});

test('the desktop app allows the same registry, thread status, separate copy and permission calls as the extension', () => {
  const block = (file) => { const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8'); return src.slice(src.indexOf('const API = {'), src.indexOf('\n};', src.indexOf('const API = {'))); };
  for (const file of ['desktop/main.js', 'vscode/extension.js']) {
    for (const m of ['registry', 'installRegistryAgent', 'removeRegistryAgent', 'markThreadSeen', 'activity', 'judgeRace', 'lineAuthors', 'revertTurnHunk', 'createWorktree', 'worktreeStatus', 'mergeWorktree', 'discardWorktree', 'runSetup', 'trustScript', 'conversationDiff', 'reviewChanges', 'resolveCopyConflicts', 'abortCopyMerge', 'runVerify', 'attention', 'permissions', 'answerPermission', 'createPullRequest', 'pushPullRequest', 'pullRequestStatus', 'fixFailingChecks', 'draft', 'saveDraft', 'compareDraft']) assert.match(block(file), new RegExp(`\\b${m}: \\(`), `${file} exposes ${m}`);
    // Files in a conversation's separate copy open like files in the project.
    assert.match(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), /const knownProject = \(p\) => \{ if \(!hub\.isWorkspace\(p\)\)/, `${file} accepts separate copies`);
  }
});
