'use strict';
// Local language tools use stdio LSP, not a VS Code extension host. Commands are
// explicit settings, never shell strings or executables discovered in a VSIX.
const fs = require('node:fs'); const path = require('node:path'); const { pathToFileURL, fileURLToPath } = require('node:url');
const { start, killTree } = require('./proc'); const { which } = require('./agents'); const { projectPath } = require('./files');
const { createLspFramer } = require('./lsp-framing');
const LIMIT = 1024 * 1024;
const SERVERS = [
  { id: 'typescript', name: 'TypeScript / JavaScript', command: 'typescript-language-server', args: ['--stdio'], extensions: ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'], install: 'npm install -g typescript-language-server typescript' },
  { id: 'go', name: 'Go', command: 'gopls', args: ['serve'], extensions: ['go'], install: 'go install golang.org/x/tools/gopls@latest' },
  { id: 'rust', name: 'Rust', command: 'rust-analyzer', args: [], extensions: ['rs'], install: 'rustup component add rust-analyzer rustfmt' },
  { id: 'python', name: 'Python', command: 'pyright-langserver', args: ['--stdio'], extensions: ['py', 'pyi'], install: 'npm install -g pyright' },
  { id: 'clang', name: 'C / C++', command: 'clangd', args: [], extensions: ['c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh'] },
  { id: 'vue', name: 'Vue', command: 'vue-language-server', args: ['--stdio'], extensions: ['vue'], install: 'npm install -g @vue/language-server' },
];
function executable(command) {
  if (!path.isAbsolute(command)) return which(command, process.env);
  try { fs.accessSync(command, fs.constants.X_OK); return fs.statSync(command).isFile() ? command : null; } catch { return null; }
}
const { FORMATTERS } = require('./format-source');
function configurations(input) {
  if (!Array.isArray(input) || input.length > 20) throw new Error('Configure up to 20 language servers.');
  return input.map((entry) => {
    const base = SERVERS.find((item) => item.id === entry.id);
    if (!base || typeof entry.command !== 'string' || !entry.command.trim() || entry.command.length > 2048 || /[\0\r\n]/.test(entry.command) || !Array.isArray(entry.args) || entry.args.length > 40 || entry.args.some((arg) => typeof arg !== 'string' || arg.length > 4096 || arg.includes('\0'))) throw new Error('Choose a language server executable and a JSON array of arguments.');
    return { id: base.id, command: entry.command.trim(), args: entry.args, enabled: entry.enabled === true };
  });
}
const languageId = (file) => ({ ts: 'typescript', tsx: 'typescriptreact', mts: 'typescript', cts: 'typescript', js: 'javascript', jsx: 'javascriptreact', mjs: 'javascript', cjs: 'javascript', rs: 'rust', go: 'go', py: 'python', pyi: 'python', vue: 'vue', h: 'c', cc: 'cpp', hpp: 'cpp', hh: 'cpp', cxx: 'cpp' })[path.extname(file).slice(1)] || path.extname(file).slice(1);
class LspSession {
  constructor(root, config, publish) {
    this.root = root; this.config = config; this.publish = publish; this.pending = new Map(); this.documents = new Map(); this.next = 0; this.capabilities = {}; this.closed = false;
    this.reader = createLspFramer((body) => this.receive(body), (error) => { this.fail(error); killTree(this.child); });
    this.child = start(config.bin, config.args, { cwd: root, env: process.env, keepOpen: true });
    this.readChunk = (chunk) => this.reader.push(chunk);
    this.readEnd = () => {
      this.reader.end();
      if (!this.closed) { this.fail(new Error(`${config.command} closed its protocol output.`)); killTree(this.child); }
    };
    this.child.stdout.on('data', this.readChunk); this.child.stdout.once('end', this.readEnd);
    this.child.stderr.on('data', () => {}); // never mix server logs into protocol frames
    this.child.on('error', () => this.fail(new Error(`Could not start ${config.command}.`)));
    this.child.on('close', () => this.fail(new Error(`${config.command} stopped.`)));
    this.ready = this.request('initialize', { processId: process.pid, rootUri: pathToFileURL(root).href, workspaceFolders: [{ uri: pathToFileURL(root).href, name: path.basename(root) }], clientInfo: { name: 'Tributary', version: '0.1.0' }, capabilities: { general: { positionEncodings: ['utf-16'] }, textDocument: { publishDiagnostics: { versionSupport: true }, completion: { completionItem: { snippetSupport: false } } }, workspace: { applyEdit: false, workspaceFolders: true, configuration: true } } }).then((result) => { this.capabilities = result.capabilities || {}; if (this.capabilities.positionEncoding && this.capabilities.positionEncoding !== 'utf-16') throw new Error('This language server must support UTF-16 positions.'); this.notify('initialized', {}); }).catch((error) => { this.close(); throw error; });
    this.ready.catch(() => {});
  }
  send(message) { if (this.closed) return; const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message })); this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`); this.child.stdin.write(body); }
  notify(method, params) { this.send({ method, params }); }
  request(method, params) {
    if (this.closed) return Promise.reject(new Error('Language server is stopped.'));
    if (this.pending.size >= 50) return Promise.reject(new Error('Language server is busy.'));
    const id = ++this.next;
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Language server timed out.')); }, 10000); this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params }); });
  }
  receive(body) {
    let message; try { message = JSON.parse(body.toString('utf8')); } catch { this.fail(new Error('Invalid language server response.')); killTree(this.child); return; }
    if (!message || typeof message !== 'object' || Array.isArray(message)) { this.fail(new Error('Invalid language server response.')); killTree(this.child); return; }
    if (message.method) this.message(message);
    else { const pending = this.pending.get(message.id); if (pending) { clearTimeout(pending.timer); this.pending.delete(message.id); message.error ? pending.reject(new Error(String(message.error.message || 'Language server request failed.').slice(0, 300))) : pending.resolve(message.result); } }
  }
  message(message) {
    if (message.method === 'textDocument/publishDiagnostics') {
      const document = this.documents.get(message.params?.uri); if (!document || message.params.version != null && message.params.version !== document.version) return;
      const diagnostics = (Array.isArray(message.params.diagnostics) ? message.params.diagnostics : []).slice(0, 300).flatMap((item) => item.range?.start && Number.isSafeInteger(item.range.start.line) && item.range.start.line >= 0 && Number.isSafeInteger(item.range.start.character) && item.range.start.character >= 0 && typeof item.message === 'string' ? [{ rel: document.rel, line: item.range.start.line + 1, column: item.range.start.character + 1, severity: item.severity === 1 ? 'error' : item.severity === 2 ? 'warning' : 'info', message: item.message.slice(0, 4000), source: String(item.source || this.config.id).slice(0, 80) }] : []);
      document.diagnostics = diagnostics; this.publish({ project: this.root, rel: document.rel, version: document.version, text: document.text, diagnostics });
    }
    if (message.id == null) return;
    const result = message.method === 'workspace/configuration' ? (message.params?.items || []).map(() => null) : message.method === 'workspace/workspaceFolders' ? [{ uri: pathToFileURL(this.root).href, name: path.basename(this.root) }] : message.method === 'workspace/applyEdit' ? { applied: false, failureReason: 'Apply edits explicitly in the editor.' } : null;
    this.send({ id: message.id, result });
  }
  async update(filename, rel, text, valid) {
    await this.ready;
    if (this.closed || !valid()) throw new Error('Document closed.');
    const uri = pathToFileURL(filename).href; let document = this.documents.get(uri);
    if (!document) { document = { uri, rel, text, version: 1, diagnostics: [] }; this.documents.set(uri, document); this.notify('textDocument/didOpen', { textDocument: { uri, languageId: languageId(rel), version: 1, text } }); }
    else if (document.text !== text) { document.text = text; document.version++; document.diagnostics = []; this.notify('textDocument/didChange', { textDocument: { uri, version: document.version }, contentChanges: [{ text }] }); }
    return document;
  }
  fail(error) { if (this.closed) return; this.closed = true; this.reader.dispose(); this.child.stdout.off('data', this.readChunk); this.child.stdout.off('end', this.readEnd); this.child.stdout.resume(); for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear(); this.documents.clear(); }
  close() { if (this.closed) { killTree(this.child); return; } this.notify('exit', {}); this.fail(new Error('Language server stopped.')); killTree(this.child); }
}
class LanguageTools {
  constructor({ getConfig, trusted, publish }) { this.getConfig = getConfig; this.trusted = trusted; this.publish = publish; this.sessions = new Map(); this.documents = new Map(); this.owners = new Map(); }
  // A pane owns a lease, not the server document. Pending operations retain
  // their state until settlement; released tokens never acquire ownership again.
  acquire(root, rel) {
    if (typeof root !== 'string' || typeof rel !== 'string' || rel.length > 4096 || rel.includes('\0')) throw new Error('Invalid language document.');
    if (this.owners.size >= 512) throw new Error('Too many language document owners.');
    const key = `${root}\0${rel}`; let state = this.documents.get(key);
    if (!state) { state = { key, root, rel, owners: new Set(), operations: 0, session: null, legacy: null }; this.documents.set(key, state); }
    const owner = require('node:crypto').randomUUID(); const lease = { owner, state };
    state.owners.add(owner); this.owners.set(owner, lease); return owner;
  }
  lease(root, rel, owner) {
    let fresh = false;
    if (owner == null) {
      const state = this.documents.get(`${root}\0${rel}`);
      owner = state?.legacy;
      if (!owner) { owner = this.acquire(root, rel); this.owners.get(owner).state.legacy = owner; fresh = true; }
    }
    const lease = this.owners.get(owner);
    if (!lease || lease.state.root !== root || lease.state.rel !== rel) throw new Error('Document closed.');
    return { ...lease, fresh };
  }
  collect(state) {
    if (state.owners.size || state.operations) return;
    if (this.documents.get(state.key) === state) this.documents.delete(state.key);
    const session = state.session; state.session = null; if (!session) return;
    // Different project-relative paths (including in-project symlinks) can
    // resolve to the same LSP URI. Retain that registration for every owner.
    const retained = [...this.documents.values()].filter((other) => other.session === session && (other.owners.size || other.operations));
    const uris = new Set(retained.map((other) => other.uri));
    for (const uri of session.documents.keys()) if (!uris.has(uri)) { session.notify('textDocument/didClose', { textDocument: { uri } }); session.documents.delete(uri); }
    // Other documents may still be initializing or serving an explicit request.
    if (!retained.length) {
      session.close(); const key = `${session.root}\0${session.config.id}`;
      if (this.sessions.get(key) === session) this.sessions.delete(key);
    }
  }
  release(owner) {
    const lease = this.owners.get(owner); if (!lease) return;
    this.owners.delete(owner); lease.state.owners.delete(owner);
    if (lease.state.legacy === owner) lease.state.legacy = null;
    this.collect(lease.state);
  }
  catalog() { const saved = this.getConfig() || []; return { servers: SERVERS.map((base) => { const configured = saved.find((entry) => entry.id === base.id); const config = { ...base, ...configured, enabled: configured?.enabled === true }; return { ...config, available: !!executable(config.command), running: [...this.sessions.values()].some((session) => session.config.id === base.id && !session.closed) }; }), formatters: [{ id: 'prettier', name: 'JavaScript / TypeScript / JSON / CSS / HTML / Vue / Markdown / YAML / GraphQL', available: true, bundled: true, docs: 'https://prettier.io/docs/' }, ...FORMATTERS.map((tool) => ({ ...tool, available: !!executable(tool.command) }))] }; }
  async useDocument(root, rel, text, owner, action) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > LIMIT || text.includes('\0')) throw new Error('Language tools support text files up to 1 MB.');
    const lease = this.lease(root, rel, owner); const state = lease.state; state.operations++;
    const valid = () => this.owners.get(lease.owner)?.state === state;
    let opened = false;
    try {
      const filename = await projectPath(root, rel); const ext = path.extname(rel).slice(1).toLowerCase();
      if (!valid()) throw new Error('Document closed.');
      const saved = this.getConfig() || []; const base = SERVERS.find((server) => server.extensions.includes(ext) && saved.some((entry) => entry.id === server.id && entry.enabled));
      const entry = base && saved.find((entry) => entry.id === base.id);
      const config = base ? { ...base, command: entry.command || base.command, args: Array.isArray(entry.args) ? entry.args : base.args } : null;
      if (!config) return await action(null);
      if (!this.trusted(root)) throw new Error('Trust this project before starting language tools.');
      const key = `${root}\0${config.id}`; let session = this.sessions.get(key);
      if (session?.closed) { this.sessions.delete(key); session = null; }
      if (!session) { const bin = executable(config.command); if (!bin || /\.(cmd|bat)$/i.test(bin)) throw new Error(`Install ${config.command}, or choose its executable in Settings.`); if (this.sessions.size >= 8) throw new Error('Close an unused language server first.'); session = new LspSession(root, { ...config, bin }, this.publish); this.sessions.set(key, session); }
      state.session = session;
      state.uri = pathToFileURL(filename).href;
      const document = await session.update(filename, rel, text, valid);
      if (!valid()) throw new Error('Document closed.'); opened = true;
      return await action({ session, document });
    } finally {
      state.operations--;
      if (!opened && lease.fresh) this.release(lease.owner);
      this.collect(state);
    }
  }
  async open(root, rel, text, owner) { return this.useDocument(root, rel, text, owner, (value) => value ? { active: true, version: value.document.version, diagnostics: value.document.diagnostics } : { active: false, diagnostics: [] }); }
  async complete(root, rel, text, position, owner) {
    if (!Number.isInteger(position?.line) || !Number.isInteger(position?.character) || position.line < 0 || position.character < 0) throw new Error('Invalid completion position.');
    return this.useDocument(root, rel, text, owner, async (value) => {
      if (!value || !value.session.capabilities.completionProvider) return [];
      const result = await value.session.request('textDocument/completion', { textDocument: { uri: value.document.uri }, position, context: { triggerKind: 1 } });
      return (Array.isArray(result) ? result : result?.items || []).slice(0, 200).map((item) => ({ label: String(item.label || '').slice(0, 200), detail: typeof item.detail === 'string' ? item.detail.slice(0, 400) : '', insertText: item.textEdit?.newText ?? item.insertText ?? item.label, range: item.textEdit?.range, kind: item.kind }));
    });
  }
  async format(root, rel, text, options, owner) { return this.useDocument(root, rel, text, owner, (value) => !value || !value.session.capabilities.documentFormattingProvider ? null : value.session.request('textDocument/formatting', { textDocument: { uri: value.document.uri }, options: { tabSize: options?.tabSize === 4 ? 4 : 2, insertSpaces: options?.insertSpaces !== false } })); }
  async locations(root, rel, text, position, kind, owner) {
    const providers = { definition: 'definitionProvider', typeDefinition: 'typeDefinitionProvider', implementation: 'implementationProvider', references: 'referencesProvider' };
    if (!Object.hasOwn(providers, kind) || !Number.isSafeInteger(position?.line) || !Number.isSafeInteger(position?.character) || position.line < 0 || position.character < 0) throw new Error('Invalid navigation request.');
    return this.useDocument(root, rel, text, owner, async (value) => {
      if (!value || !value.session.capabilities[providers[kind]]) return { supported: false, locations: [], omitted: 0 };
      const result = await value.session.request(`textDocument/${kind}`, { textDocument: { uri: value.document.uri }, position, ...(kind === 'references' ? { context: { includeDeclaration: true } } : {}) });
      const raw = result ? Array.isArray(result) ? result : [result] : []; const locations = []; const seen = new Set(); const base = fs.realpathSync(root); let omitted = Math.max(0, raw.length - 200);
      for (const item of raw.slice(0, 200)) {
        try {
          const target = fs.realpathSync(fileURLToPath(item.targetUri || item.uri)); const targetRel = path.relative(base, target);
          const file = await projectPath(root, targetRel); if (!fs.statSync(file).isFile()) throw new Error('Not a file');
          const start = (item.targetSelectionRange || item.range || item.targetRange)?.start;
          if (!Number.isSafeInteger(start?.line) || !Number.isSafeInteger(start?.character) || start.line < 0 || start.character < 0) throw new Error('Invalid location');
          const key = `${targetRel}:${start.line}:${start.character}`; if (seen.has(key)) continue; seen.add(key);
          locations.push({ rel: targetRel.split(path.sep).join('/'), line: start.line + 1, column: start.character + 1 });
        } catch { omitted++; }
      }
      return { supported: true, locations, omitted };
    });
  }
  closeDocument(root, rel, owner) {
    const token = owner ?? this.documents.get(`${root}\0${rel}`)?.legacy;
    const lease = this.owners.get(token);
    if (lease?.state.root === root && lease.state.rel === rel) this.release(token);
  }
  stopAll() { for (const session of this.sessions.values()) session.close(); this.sessions.clear(); for (const state of this.documents.values()) { state.owners.clear(); state.session = null; } this.documents.clear(); this.owners.clear(); }
}
module.exports = { LanguageTools, configurations, SERVERS };
