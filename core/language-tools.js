'use strict';
// Local language tools use stdio LSP, not a VS Code extension host. Commands are
// explicit settings, never shell strings or executables discovered in a VSIX.
const fs = require('node:fs'); const path = require('node:path'); const { pathToFileURL, fileURLToPath } = require('node:url');
const { start, killTree } = require('./proc'); const { which } = require('./agents'); const { projectPath } = require('./files');
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
    this.root = root; this.config = config; this.publish = publish; this.pending = new Map(); this.documents = new Map(); this.next = 0; this.buffer = Buffer.alloc(0); this.capabilities = {}; this.closed = false;
    this.child = start(config.bin, config.args, { cwd: root, env: process.env, keepOpen: true });
    this.child.stdout.on('data', (chunk) => this.receive(chunk));
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
  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > 8 * LIMIT) { this.fail(new Error('Language server response is too large.')); killTree(this.child); return; }
    while (!this.closed) {
      const split = this.buffer.indexOf('\r\n\r\n'); if (split < 0) return;
      const match = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, split).toString());
      if (!match || Number(match[1]) > 8 * LIMIT) { this.fail(new Error('Invalid language server frame.')); killTree(this.child); return; }
      const length = Number(match[1]); if (this.buffer.length < split + 4 + length) return;
      const body = this.buffer.subarray(split + 4, split + 4 + length); this.buffer = this.buffer.subarray(split + 4 + length);
      let message; try { message = JSON.parse(body.toString('utf8')); } catch { this.fail(new Error('Invalid language server response.')); killTree(this.child); return; }
      if (message.method) this.message(message);
      else { const pending = this.pending.get(message.id); if (pending) { clearTimeout(pending.timer); this.pending.delete(message.id); message.error ? pending.reject(new Error(String(message.error.message || 'Language server request failed.').slice(0, 300))) : pending.resolve(message.result); } }
    }
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
  async update(filename, rel, text) {
    await this.ready; const uri = pathToFileURL(filename).href; let document = this.documents.get(uri);
    if (!document) { document = { uri, rel, text, version: 1, diagnostics: [] }; this.documents.set(uri, document); this.notify('textDocument/didOpen', { textDocument: { uri, languageId: languageId(rel), version: 1, text } }); }
    else if (document.text !== text) { document.text = text; document.version++; document.diagnostics = []; this.notify('textDocument/didChange', { textDocument: { uri, version: document.version }, contentChanges: [{ text }] }); }
    return document;
  }
  fail(error) { if (this.closed) return; this.closed = true; for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear(); }
  close() { if (this.closed) { killTree(this.child); return; } this.notify('exit', {}); this.fail(new Error('Language server stopped.')); killTree(this.child); }
}
class LanguageTools {
  constructor({ getConfig, trusted, publish }) { this.getConfig = getConfig; this.trusted = trusted; this.publish = publish; this.sessions = new Map(); this.generations = new Map(); }
  catalog() { const saved = this.getConfig() || []; return { servers: SERVERS.map((base) => { const configured = saved.find((entry) => entry.id === base.id); const config = { ...base, ...configured, enabled: configured?.enabled === true }; return { ...config, available: !!executable(config.command), running: [...this.sessions.values()].some((session) => session.config.id === base.id && !session.closed) }; }), formatters: [{ id: 'prettier', name: 'JavaScript / TypeScript / JSON / CSS / HTML / Vue / Markdown / YAML / GraphQL', available: true, bundled: true, docs: 'https://prettier.io/docs/' }, ...FORMATTERS.map((tool) => ({ ...tool, available: !!executable(tool.command) }))] }; }
  async document(root, rel, text) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > LIMIT || text.includes('\0')) throw new Error('Language tools support text files up to 1 MB.');
    const documentKey = `${root}\0${rel}`; const generation = this.generations.get(documentKey) || 0;
    const filename = await projectPath(root, rel); const ext = path.extname(rel).slice(1).toLowerCase();
    const saved = this.getConfig() || []; const base = SERVERS.find((server) => server.extensions.includes(ext) && saved.some((entry) => entry.id === server.id && entry.enabled));
    const entry = base && saved.find((entry) => entry.id === base.id);
    const config = base ? { ...base, command: entry.command || base.command, args: Array.isArray(entry.args) ? entry.args : base.args } : null;
    if (!config) return null;
    if (!this.trusted(root)) throw new Error('Trust this project before starting language tools.');
    const key = `${root}\0${config.id}`; let session = this.sessions.get(key);
    if (session?.closed) { this.sessions.delete(key); session = null; }
    if (!session) { const bin = executable(config.command); if (!bin || /\.(cmd|bat)$/i.test(bin)) throw new Error(`Install ${config.command}, or choose its executable in Settings.`); if (this.sessions.size >= 8) throw new Error('Close an unused language server first.'); session = new LspSession(root, { ...config, bin }, this.publish); this.sessions.set(key, session); }
    const document = await session.update(filename, rel, text); if ((this.generations.get(documentKey) || 0) !== generation) { this.closeDocument(root, rel); throw new Error('Document closed.'); } return { session, document };
  }
  async open(root, rel, text) { const value = await this.document(root, rel, text); return value ? { active: true, version: value.document.version, diagnostics: value.document.diagnostics } : { active: false, diagnostics: [] }; }
  async complete(root, rel, text, position) {
    if (!Number.isInteger(position?.line) || !Number.isInteger(position?.character) || position.line < 0 || position.character < 0) throw new Error('Invalid completion position.');
    const value = await this.document(root, rel, text); if (!value || !value.session.capabilities.completionProvider) return [];
    const result = await value.session.request('textDocument/completion', { textDocument: { uri: value.document.uri }, position, context: { triggerKind: 1 } });
    return (Array.isArray(result) ? result : result?.items || []).slice(0, 200).map((item) => ({ label: String(item.label || '').slice(0, 200), detail: typeof item.detail === 'string' ? item.detail.slice(0, 400) : '', insertText: item.textEdit?.newText ?? item.insertText ?? item.label, range: item.textEdit?.range, kind: item.kind }));
  }
  async format(root, rel, text, options) { const value = await this.document(root, rel, text); if (!value || !value.session.capabilities.documentFormattingProvider) return null; return value.session.request('textDocument/formatting', { textDocument: { uri: value.document.uri }, options: { tabSize: options?.tabSize === 4 ? 4 : 2, insertSpaces: options?.insertSpaces !== false } }); }
  async locations(root, rel, text, position, kind) {
    const providers = { definition: 'definitionProvider', typeDefinition: 'typeDefinitionProvider', implementation: 'implementationProvider', references: 'referencesProvider' };
    if (!Object.hasOwn(providers, kind) || !Number.isSafeInteger(position?.line) || !Number.isSafeInteger(position?.character) || position.line < 0 || position.character < 0) throw new Error('Invalid navigation request.');
    const value = await this.document(root, rel, text);
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
  }
  closeDocument(root, rel) {
    const key = `${root}\0${rel}`; this.generations.set(key, (this.generations.get(key) || 0) + 1);
    for (const session of this.sessions.values()) if (session.root === root) {
      for (const [uri, doc] of session.documents) if (doc.rel === rel) { session.notify('textDocument/didClose', { textDocument: { uri } }); session.documents.delete(uri); }
      if (!session.documents.size) { session.close(); this.sessions.delete(`${root}\0${session.config.id}`); }
    }
  }
  stopAll() { for (const session of this.sessions.values()) session.close(); this.sessions.clear(); }
}
module.exports = { LanguageTools, configurations, SERVERS };
