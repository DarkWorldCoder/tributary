'use strict';
const { EventEmitter } = require('node:events'); const fs = require('node:fs'); const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url'); const { projectPath } = require('./files'); const { which, pathDirs } = require('./agents'); const { start, killTree } = require('./proc');
const OUTPUT_LIMIT = 100000;
function localEndpoint(url) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password) throw new Error('Debugger must use a local WebSocket address.');
  return endpoint;
}
const remoteValue = (v) => !v ? '' : typeof v.value === 'string' ? JSON.stringify(v.value) : v.value !== undefined ? String(v.value) : String(v.unserializableValue || v.description || v.type || '').slice(0, 500);
class Inspector extends EventEmitter {
  constructor(url) { super(); this.url = url; this.sequence = 0; this.pending = new Map(); }
  async connect() {
    const socket = this.socket = new WebSocket(this.url);
    socket.addEventListener('message', (event) => { let m; try { m = JSON.parse(String(event.data)); } catch { return; } if (m.id) { const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result || {}); } else if (m.method) this.emit('event', m.method, m.params || {}); });
    socket.addEventListener('close', () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Debugger disconnected.')); } this.pending.clear(); this.emit('closed'); });
    await new Promise((resolve, reject) => { const timer = setTimeout(() => { socket.close(); reject(new Error('Debugger connection timed out.')); }, 10000); socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true }); socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not connect to the debugger.')); }, { once: true }); });
  }
  call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++this.sequence; const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Debugger request timed out.')); }, 10000); this.pending.set(id, { resolve, reject, timer }); try { this.socket.send(JSON.stringify({ id, method, params })); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); } }); }
  close() { try { this.socket?.close(); } catch {} }
}
class DebugSession {
  constructor(project, emit) { this.project = project; this.root = fs.realpathSync(project); this.emit = emit; this.breakpoints = new Map(); this.generation = 0; this.status = 'idle'; this.frames = []; this.variables = []; this.output = ''; this.entry = ''; this.error = ''; this.scripts = new Map(); this.objectIds = new Set(); }
  state() { return { project: this.project, status: this.status, owned: !!this.child, entry: this.entry, error: this.error, output: this.output, reason: this.reason || '', pauseId: this.pauseId || 0, frames: this.frames.map(({ scopes, ...frame }) => frame), selectedFrame: this.selectedFrame || null, variables: this.variables, breakpoints: [...this.breakpoints.values()].map(({ rel, line, verified, actualLine }) => ({ rel, line, verified: !!verified, actualLine })) }; }
  changed() { this.emit(this.state()); }
  append(text) { this.output = (this.output + text).slice(-OUTPUT_LIMIT); if (!this.outputTimer) { this.outputTimer = setTimeout(() => { this.outputTimer = null; this.changed(); }, 80); this.outputTimer.unref(); } }
  relative(url) { try { const abs = url.startsWith('file:') ? fileURLToPath(url) : url; if (!path.isAbsolute(abs)) return null; const rel = path.relative(this.root, abs); return rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : null; } catch { return null; } }
  async connect(url, generation) {
    const endpoint = localEndpoint(url);
    const client = new Inspector(endpoint.href); this.client = client; this.ready = false;
    client.on('event', (method, params) => { if (generation !== this.generation) return; void this.event(method, params).catch((e) => { if (generation === this.generation) { this.error = e.message; this.changed(); } }); });
    client.on('closed', () => { if (generation !== this.generation || this.client !== client) return; this.client = null; if (!['stopped', 'error'].includes(this.status)) this.status = 'stopped'; this.frames = []; this.variables = []; this.changed(); });
    await client.connect(); if (generation !== this.generation) { client.close(); return; }
    await client.call('Runtime.enable'); await client.call('Debugger.enable'); await client.call('Debugger.setPauseOnExceptions', { state: 'uncaught' }); this.ready = true;
    for (const bp of this.breakpoints.values()) await this.install(bp);
    this.status = 'running'; this.changed(); await client.call('Runtime.runIfWaitingForDebugger');
  }
  async event(method, p) {
    if (method === 'Debugger.scriptParsed') this.scripts.set(p.scriptId, p.url || '');
    else if (method === 'Debugger.breakpointResolved') { const bp = [...this.breakpoints.values()].find((b) => b.id === p.breakpointId); if (bp) { bp.verified = true; bp.actualLine = p.location.lineNumber + 1; this.changed(); } }
    else if (method === 'Debugger.paused') {
      this.status = 'paused'; this.pauseId = (this.pauseId || 0) + 1; this.reason = p.reason; this.frames = (p.callFrames || []).slice(0, 50).map((f) => ({ id: f.callFrameId, name: f.functionName || '(anonymous)', url: this.scripts.get(f.location.scriptId) || f.url || '', rel: this.relative(this.scripts.get(f.location.scriptId) || f.url || ''), line: f.location.lineNumber + 1, column: f.location.columnNumber + 1, scopes: f.scopeChain }));
      this.changed(); if (this.frames.length) await this.selectFrame(this.frames[0].id);
    } else if (method === 'Debugger.resumed') { this.status = 'running'; this.frames = []; this.variables = []; this.objectIds.clear(); this.selectedFrame = null; this.changed(); }
    else if (method === 'Runtime.consoleAPICalled' && !this.child) this.append((p.args || []).map(remoteValue).join(' ') + '\n');
  }
  async launch(input) {
    const entry = await projectPath(this.project, input?.entry);
    if (!/\.(?:[cm]?js|[cm]?ts)$/i.test(entry) || !fs.statSync(entry).isFile()) throw new Error('Choose a JavaScript or TypeScript entry file. TSX needs a project build or loader.');
    const args = input.args || []; if (!Array.isArray(args) || args.length > 32 || args.some((a) => typeof a !== 'string' || a.length > 2000 || /[\0\r\n]/.test(a))) throw new Error('Use up to 32 arguments, one per line.');
    const env = { ...process.env, PATH: pathDirs(process.env).join(path.delimiter) }; const node = which('node', env); if (!node) throw new Error('Install Node.js to debug this project.');
    this.stop(); const generation = ++this.generation; this.status = 'starting'; this.entry = input.entry; this.output = ''; this.error = ''; this.reason = ''; this.finished = false; this.scripts.clear(); this.changed();
    const child = this.child = start(node, ['--inspect-brk=127.0.0.1:0', '--enable-source-maps', '--', entry, ...args], { cwd: this.project, env, keepOpen: true });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); let buffer = ''; let connecting = false;
    const timer = setTimeout(() => { if (generation === this.generation && this.status === 'starting') this.fail('Node did not start its debugger.'); }, 15000);
    child.stdout.on('data', (text) => { if (generation === this.generation) this.append(text); });
    child.stderr.on('data', (text) => { if (generation !== this.generation) return; buffer = (buffer + text).slice(-10000); this.append(text); const url = /ws:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/[\w-]+/.exec(buffer)?.[0]; if (url && !connecting && !this.finished) { connecting = true; clearTimeout(timer); this.connect(url, generation).catch((e) => { if (generation === this.generation && !this.finished) this.fail(e.message); }); } if (/Waiting for the debugger to disconnect/.test(buffer)) { this.finished = true; this.client?.close(); this.client = null; } });
    child.once('error', () => { clearTimeout(timer); if (generation === this.generation) this.fail('Could not start Node.js.'); });
    child.once('close', (code) => { clearTimeout(timer); if (generation !== this.generation) return; this.child = null; this.client?.close(); this.client = null; this.status = code === 0 ? 'stopped' : 'error'; if (code !== 0) this.error ||= `Node exited with code ${code}.`; this.frames = []; this.variables = []; this.changed(); });
    return this.state();
  }
  async attach(port) {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Enter a local debug port between 1 and 65535.');
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('No Node debugger found on that port.');
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 1024 * 1024) throw new Error('Debug discovery response is too large.'); chunks.push(Buffer.from(value)); } } finally { await reader.cancel().catch(() => {}); }
    const targets = JSON.parse(Buffer.concat(chunks).toString('utf8')); const target = Array.isArray(targets) && targets.find((x) => x.type === 'node' && typeof x.webSocketDebuggerUrl === 'string');
    if (!target || Number(localEndpoint(target.webSocketDebuggerUrl).port) !== port) throw new Error('No Node debugger found on that port.');
    this.stop(); const generation = ++this.generation; this.status = 'starting'; this.error = ''; this.output = ''; this.entry = target.title || 'Attached Node process'; this.changed();
    try { await this.connect(target.webSocketDebuggerUrl, generation); } catch (e) { this.fail(e.message); throw e; } return this.state();
  }
  fail(message) { this.stop(); this.status = 'error'; this.error = message; this.changed(); }
  stop() { clearTimeout(this.outputTimer); this.outputTimer = null; this.generation++; this.ready = false; const client = this.client; this.client = null; if (client) { if (!this.child) { void client.call('Debugger.resume').catch(() => {}); void client.call('Runtime.runIfWaitingForDebugger').catch(() => {}); } client.close(); } if (this.child) { killTree(this.child); this.child = null; } this.frames = []; this.variables = []; this.objectIds.clear(); this.selectedFrame = null; this.status = 'stopped'; for (const bp of this.breakpoints.values()) { delete bp.id; delete bp.installing; bp.verified = false; delete bp.actualLine; } this.changed(); return this.state(); }
  async action(action) {
    const methods = { resume: 'Debugger.resume', pause: 'Debugger.pause', over: 'Debugger.stepOver', into: 'Debugger.stepInto', out: 'Debugger.stepOut' };
    if (!methods[action]) throw new Error('Choose a debugger action.');
    if (!this.client || (action === 'pause' ? this.status !== 'running' : this.status !== 'paused')) throw new Error('Debugger is not ready for that action.');
    try { await this.client.call(methods[action]); } catch (e) { if (!this.finished) throw e; } return this.state();
  }
  async install(bp) {
    if (!this.client || !this.ready || bp.id) return;
    if (bp.installing) return bp.installing;
    const client = this.client;
    const pending = bp.installing = (async () => {
      const r = await client.call('Debugger.setBreakpointByUrl', { url: pathToFileURL(path.join(this.root, bp.rel)).href, lineNumber: bp.line - 1 });
      if (this.client !== client) return;
      bp.id = r.breakpointId; bp.verified = !!r.locations?.length; bp.actualLine = r.locations?.[0]?.lineNumber != null ? r.locations[0].lineNumber + 1 : undefined;
    })();
    try { await pending; } finally { if (bp.installing === pending) delete bp.installing; }
  }
  async breakpoint(rel, line, enabled) {
    const file = await projectPath(this.project, rel); if (!Number.isSafeInteger(line) || line < 1 || line > 100000) throw new Error('Choose a valid source line.');
    if (fs.statSync(file).size > 1024 * 1024) throw new Error('Breakpoints require a file under 1 MB.');
    if (line > fs.readFileSync(file, 'utf8').split('\n').length) throw new Error('That line is outside the file.');
    const key = `${rel}:${line}`; const previous = this.breakpoints.get(key);
    if (!enabled) { if (previous?.installing) await previous.installing; if (previous?.id && this.client) await this.client.call('Debugger.removeBreakpoint', { breakpointId: previous.id }); this.breakpoints.delete(key); }
    else if (!previous) { const bp = { rel, line, verified: false }; this.breakpoints.set(key, bp); try { await this.install(bp); } catch (e) { this.breakpoints.delete(key); throw e; } }
    this.changed(); return this.state();
  }
  async properties(objectId) {
    if (this.status !== 'paused' || !this.client || !this.objectIds.has(objectId)) throw new Error('Pause the debugger to inspect variables.');
    const r = await this.client.call('Runtime.getProperties', { objectId, ownProperties: true, generatePreview: true });
    return (r.result || []).filter((v) => v.name !== '__proto__').slice(0, 100).map((v) => { if (v.value?.objectId) this.objectIds.add(v.value.objectId); return { name: v.name, value: v.get && !v.value ? '(getter)' : remoteValue(v.value), objectId: v.value?.objectId }; });
  }
  async selectFrame(id) {
    const frame = this.frames.find((f) => f.id === id); if (!frame || !this.client || this.status !== 'paused') throw new Error('This call frame is no longer paused.');
    this.selectedFrame = id; this.variables = []; this.objectIds.clear();
    const generation = this.generation;
    for (const scope of frame.scopes.filter((s) => !['global', 'with'].includes(s.type)).slice(0, 4)) { if (!scope.object?.objectId) continue; this.objectIds.add(scope.object.objectId); const items = await this.properties(scope.object.objectId); if (generation !== this.generation || this.selectedFrame !== id || this.status !== 'paused') return this.state(); this.variables.push(...items.map((v) => ({ ...v, scope: scope.type }))); }
    this.changed(); return this.state();
  }
  async evaluate(expression) { if (typeof expression !== 'string' || !expression.trim() || expression.length > 2000) throw new Error('Enter a watch expression up to 2000 characters.'); if (this.status !== 'paused' || !this.client || !this.selectedFrame) throw new Error('Pause the debugger to evaluate an expression.'); const r = await this.client.call('Debugger.evaluateOnCallFrame', { callFrameId: this.selectedFrame, expression, throwOnSideEffect: true, generatePreview: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0]?.slice(0, 300) || r.exceptionDetails.text || 'Could not evaluate this expression.'); if (r.result.objectId) this.objectIds.add(r.result.objectId); return { value: remoteValue(r.result), objectId: r.result.objectId }; }
}
class DebuggerManager {
  constructor(emit) { this.sessions = new Map(); this.emit = emit; }
  session(project) { if (!this.sessions.has(project)) this.sessions.set(project, new DebugSession(project, this.emit)); return this.sessions.get(project); }
  stopAll() { for (const session of this.sessions.values()) session.stop(); }
}
module.exports = { DebuggerManager };
