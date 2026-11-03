'use strict';
// Agent Client Protocol client (JSON-RPC 2.0 over stdio).
//
// Agents stay alive between turns: one process per agent, arguments, folder and environment,
// shared by every session in that folder (the pattern Zed, Goose and AionUi use). A process that
// sits idle is closed; one that crashes is respawned on the next turn and the session reloaded.
// The project's .mcp.json servers are passed into each session.
//
// Handles: initialize, session/new, session/load, session/prompt, session/cancel, session/update,
// and the agent requests session/request_permission, fs/read_text_file and fs/write_text_file.
// The folder check on fs writes is a courtesy, not a sandbox: agents can also write directly,
// which is why the hub fingerprints the git working tree around every turn.
//
// Permission requests: Full auto allows everything, Edit allows edits and Read-only declines them.
// Anything else is offered to whoever handles the turn's events as { kind: 'permission', request };
// a handler that will ask the person sets event.answer to a promise of 'once', 'always', 'reject',
// one of the agent's option ids, or null for cancelled. Nobody answering means declined, as before.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { start, lines } = require('./proc');
const { clip, EDIT_TOOLS } = require('./parsers');
const { localHost } = require('./host');

// pathMod: path.posix for a folder on an SSH host.
const inside = (root, p, pathMod = path) => { const r = pathMod.relative(root, pathMod.resolve(root, p)); return r === '' || (!r.startsWith('..') && !pathMod.isAbsolute(r)); };

// The agent option for a choice: 'once', 'always', 'reject' or the option's own id. null = cancelled.
function pickOption(options, choice) {
  if (choice == null) return null;
  const exact = options.find((o) => o.optionId === choice); if (exact) return exact;
  const kind = (k) => options.find((o) => o.kind === k);
  const like = (re) => options.find((o) => re.test(o.kind || ''));
  if (choice === 'always') return kind('allow_always') || kind('allow_once') || like(/allow/);
  if (choice === 'once') return kind('allow_once') || like(/allow/);
  return kind('reject_once') || like(/reject/);
}

// What the person needs to decide: the tool, the command or path, and the agent's options.
// call merges what earlier tool_call updates said about this tool call with the request itself.
function permissionRequest(call, options, sessionId) {
  const input = call.rawInput && typeof call.rawInput === 'object' ? call.rawInput : {};
  const cmd = input.command ?? input.cmd;
  const command = Array.isArray(cmd) ? cmd.join(' ') : typeof cmd === 'string' ? cmd : undefined;
  const diff = (call.content || []).find((c) => c && c.type === 'diff' && c.path);
  const p = input.file_path || input.filePath || input.path || input.abs_path || ((call.locations || [])[0] || {}).path || (diff && diff.path);
  return {
    sessionId, toolCallId: call.toolCallId, title: call.title || call.kind || 'Tool', kind: call.kind || 'other',
    command: command ? clip(command, 2000) : undefined, path: typeof p === 'string' ? p : undefined,
    options: options.map(({ optionId, name, kind }) => ({ optionId, name, kind })),
  };
}

// Project MCP servers (.mcp.json, the format Claude Code and others use) in ACP's shape.
function projectMcpServers(cwd, caps = {}) {
  let text; try { text = fs.readFileSync(path.join(cwd, '.mcp.json'), 'utf8'); } catch { return []; }
  return mcpServersFrom(text, caps);
}
async function projectMcpServersOn(host, cwd, caps = {}) {
  if (!host.remote) return projectMcpServers(cwd, caps);
  let text; try { text = (await host.readFile(host.path.join(cwd, '.mcp.json'))).toString('utf8'); } catch { return []; }
  return mcpServersFrom(text, caps);
}
function mcpServersFrom(text, caps) {
  let cfg; try { cfg = JSON.parse(text); } catch { return []; }
  const pairs = (o) => Object.entries(o || {}).map(([name, value]) => ({ name, value: String(value) }));
  const out = [];
  for (const [name, s] of Object.entries((cfg && cfg.mcpServers) || {})) {
    if (!s || typeof s !== 'object') continue;
    const type = s.type || (s.url ? 'http' : 'stdio');
    if (type === 'stdio' && s.command) out.push({ name, command: s.command, args: (s.args || []).map(String), env: pairs(s.env) });
    else if ((type === 'http' || type === 'sse') && s.url && caps[type]) out.push({ type, name, url: s.url, headers: pairs(s.headers) });
  }
  return out;
}

class AcpConnection {
  constructor(key, { command, args, cwd, env, host = localHost }, pool) {
    this.key = key; this.cwd = cwd; this.pool = pool; this.host = host;
    // A local agent gets the complete environment as built (gateways may have removed variables);
    // a remote one gets only Tributary's changes on top of the host's own environment.
    this.child = host.remote ? host.spawn(command, args, { cwd, env, keepOpen: true }) : start(command, args, { cwd, env, stdin: null, keepOpen: true });
    this.nextId = 1; this.pending = new Map(); this.handlers = new Map(); this.sessions = new Set();
    this.alive = true; this.busy = 0; this.stderrTail = ''; this.caps = {};
    lines(this.child.stdout, (l) => this.onLine(l));
    lines(this.child.stderr, (l) => { this.stderrTail = `${this.stderrTail}${l}\n`.slice(-2000); });
    this.child.on('error', (e) => this.onExit(`Could not start the agent: ${e.message}`));
    this.child.on('exit', (code) => this.onExit(`Agent exited (${code}). ${this.stderrTail.trim().split('\n').slice(-3).join(' ')}`.trim()));
    this.ready = this.request('initialize', {
      protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false }, clientInfo: { name: 'tributary', version: '0.1.0' },
    }).then((init) => { this.caps = (init && init.agentCapabilities) || {}; return init; });
  }

  send(msg) { try { this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`); } catch { /* process gone */ } }
  request(method, params) {
    if (!this.alive) return Promise.reject(new Error('Agent is not running'));
    return new Promise((res, rej) => { const id = this.nextId++; this.pending.set(id, { res, rej }); this.send({ id, method, params }); });
  }

  onExit(reason) {
    if (!this.alive) return;
    this.alive = false; this.pool.forget(this);
    for (const p of this.pending.values()) p.rej(new Error(reason));
    this.pending.clear();
    for (const h of this.handlers.values()) h.fail(reason);
    this.handlers.clear();
  }

  handlerFor(params) {
    const sid = params && params.sessionId;
    if (sid && this.handlers.has(sid)) return this.handlers.get(sid);
    return this.handlers.size === 1 ? [...this.handlers.values()][0] : null;
  }

  onLine(l) {
    let msg; try { msg = JSON.parse(l); } catch { return; }
    if (msg.id != null && (msg.result !== undefined || msg.error) && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id); this.pending.delete(msg.id);
      if (msg.error) p.rej(new Error(msg.error.message || 'ACP error')); else p.res(msg.result);
    } else if (msg.method === 'session/update') {
      const h = this.handlerFor(msg.params); if (h) h.update((msg.params && msg.params.update) || {});
    } else if (msg.method && msg.id != null) this.onRequest(msg);
  }

  async onRequest(msg) {
    const p = msg.params || {}; const h = this.handlerFor(p); const hp = this.host.path;
    const reply = (result) => this.send({ id: msg.id, result });
    const fail = (code, message) => this.send({ id: msg.id, error: { code, message } });
    if (!h) { fail(-32000, 'No active prompt for this session'); return; }
    try {
      if (msg.method === 'session/request_permission') {
        const pick = pickOption(p.options || [], await h.permission(p));
        reply(pick ? { outcome: { outcome: 'selected', optionId: pick.optionId } } : { outcome: { outcome: 'cancelled' } });
      } else if (msg.method === 'fs/read_text_file') {
        if (!inside(h.cwd, p.path, hp)) throw new Error('Path outside project');
        let text = (await this.host.readFile(hp.resolve(h.cwd, p.path))).toString('utf8');
        if (p.line || p.limit) { const ls = text.split('\n'); const s = Math.max(0, (p.line || 1) - 1); text = ls.slice(s, p.limit ? s + p.limit : undefined).join('\n'); }
        reply({ content: text });
      } else if (msg.method === 'fs/write_text_file') {
        if (h.mode === 'read') throw new Error('Read-only mode');
        if (!inside(h.cwd, p.path, hp)) throw new Error('Path outside project');
        const abs = hp.resolve(h.cwd, p.path); await this.host.writeFile(abs, p.content);
        h.onEvent({ kind: 'file', path: abs, change: 'write' });
        reply(null);
      } else fail(-32601, `Unsupported: ${msg.method}`);
    } catch (e) { fail(-32000, e.message); }
  }

  // Reuse a session this process already has, reload one it does not, or start a new one.
  async session(resumeId) {
    await this.ready;
    if (resumeId && this.sessions.has(resumeId)) return { sessionId: resumeId, resumed: true };
    const mcpServers = await projectMcpServersOn(this.host, this.cwd, this.caps.mcpCapabilities || {});
    if (resumeId && this.caps.loadSession) {
      await this.request('session/load', { sessionId: resumeId, cwd: this.cwd, mcpServers });
      this.sessions.add(resumeId); return { sessionId: resumeId, resumed: true };
    }
    const s = await this.request('session/new', { cwd: this.cwd, mcpServers });
    this.sessions.add(s.sessionId); return { sessionId: s.sessionId, resumed: false };
  }

  cancel(sessionId) { this.send({ method: 'session/cancel', params: { sessionId } }); }
  kill() { this.alive = false; this.host.kill(this.child); }
  // An idle agent must not keep the app (or a test run) from exiting.
  hold(on) {
    const m = on ? 'ref' : 'unref';
    for (const h of [this.child, this.child.stdin, this.child.stdout, this.child.stderr]) { try { if (h && typeof h[m] === 'function') h[m](); } catch { /* closed */ } }
  }
}

const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

const envKey = (env) => {
  const diff = Object.entries(env || {}).filter(([k, v]) => process.env[k] !== v).sort(([a], [b]) => a.localeCompare(b));
  return crypto.createHash('sha1').update(JSON.stringify(diff)).digest('hex');
};

const acpPool = {
  conns: new Map(), timers: new Map(), idleMs: 10 * 60 * 1000,
  acquire(spec) {
    const key = [spec.host && spec.host.remote ? `ssh:${spec.host.label}` : '', spec.command, ...(spec.args || []), spec.cwd, envKey(spec.env)].join('\0');
    let c = this.conns.get(key);
    if (!c || !c.alive) { c = new AcpConnection(key, spec, this); this.conns.set(key, c); }
    const t = this.timers.get(key); if (t) { clearTimeout(t); this.timers.delete(key); }
    c.busy++; c.hold(true);
    return c;
  },
  release(c) {
    c.busy = Math.max(0, c.busy - 1);
    if (c.busy || !c.alive) return;
    c.hold(false);
    const t = setTimeout(() => { this.timers.delete(c.key); if (!c.busy) { this.forget(c); c.kill(); } }, this.idleMs);
    t.unref(); this.timers.set(c.key, t);
  },
  forget(c) { if (this.conns.get(c.key) === c) this.conns.delete(c.key); const t = this.timers.get(c.key); if (t) { clearTimeout(t); this.timers.delete(c.key); } },
  size() { return this.conns.size; },
  closeAll() { for (const c of [...this.conns.values()]) { this.forget(c); c.kill(); } },
};

// host: a remote host from core/host.js runs the agent there (cwd is a path on that host).
function runAcp({ command, args, cwd, env, prompt, mode, resumeId, onEvent, signal, host }) {
  return new Promise((resolve) => {
    const conn = acpPool.acquire({ command, args, cwd, env, host: host || localHost });
    let sessionId = null; let finished = false;
    const finish = (ok, error) => {
      if (finished) return; finished = true;
      if (sessionId) conn.handlers.delete(sessionId);
      if (error) onEvent({ kind: 'error', message: error });
      onEvent({ kind: 'done', ok });
      acpPool.release(conn); resolve({ ok, sessionId });
    };
    const calls = new Map(); // toolCallId -> what the agent has said about it so far
    const handler = {
      mode, cwd, onEvent, fail: (reason) => finish(false, reason),
      async permission(p) {
        const call = { ...calls.get(p.toolCall && p.toolCall.toolCallId), ...defined(p.toolCall || {}) };
        const isEdit = call.kind === 'edit' || EDIT_TOOLS.test(call.title || '');
        if (mode === 'full' || (mode === 'edit' && isEdit)) return 'once';
        if (mode !== 'read' || !isEdit) {
          const ask = { kind: 'permission', request: permissionRequest(call, p.options || [], sessionId) };
          onEvent(ask);
          if (ask.answer) return ask.answer;
        }
        onEvent({ kind: 'notice', text: `Declined: ${call.title || 'tool'} (mode: ${mode})` });
        return 'reject';
      },
      update(u) {
        if ((u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') && u.toolCallId) {
          calls.set(u.toolCallId, { ...calls.get(u.toolCallId), ...defined({ toolCallId: u.toolCallId, title: u.title, kind: u.kind, rawInput: u.rawInput, locations: u.locations, content: u.content }) });
        }
        switch (u.sessionUpdate) {
          case 'agent_message_chunk': if (u.content && u.content.type === 'text') onEvent({ kind: 'text', text: u.content.text }); break;
          case 'agent_thought_chunk': if (u.content && u.content.type === 'text') onEvent({ kind: 'thinking', text: u.content.text }); break;
          case 'tool_call': case 'tool_call_update': {
            const status = u.status === 'completed' ? 'done' : u.status === 'failed' ? 'error' : 'running';
            const output = Array.isArray(u.content) ? u.content.map((c) => (c.content && c.content.text) || (c.type === 'diff' ? `diff ${c.path}` : '')).filter(Boolean).join('\n') : undefined;
            onEvent({ kind: 'tool', id: u.toolCallId, name: u.title || u.kind || 'tool', input: u.rawInput, status, output: output ? clip(output) : undefined });
            for (const c of u.content || []) if (c.type === 'diff' && c.path) onEvent({ kind: 'file', path: c.path, change: 'edit' });
            for (const l of u.locations || []) if (u.kind === 'edit' && l.path) onEvent({ kind: 'file', path: l.path, change: 'edit' });
            break;
          }
          case 'plan': onEvent({ kind: 'plan', items: (u.entries || []).map((e) => ({ text: e.content, done: e.status === 'completed' })) }); break;
          default: break;
        }
      },
    };
    if (signal) signal.addEventListener('abort', () => {
      if (sessionId) conn.cancel(sessionId);
      // An agent that ignores the cancel is stopped for good; the next turn respawns it.
      setTimeout(() => { if (!finished) { conn.kill(); acpPool.forget(conn); finish(false, 'Stopped'); } }, 3000).unref();
    }, { once: true });

    (async () => {
      const s = await conn.session(resumeId);
      sessionId = s.sessionId; conn.handlers.set(sessionId, handler);
      onEvent({ kind: 'session', sessionId, resumed: s.resumed });
      const r = await conn.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: prompt }] });
      const stop = r && r.stopReason;
      finish(stop !== 'refusal' && stop !== 'cancelled', stop === 'refusal' ? 'Agent refused the request' : stop === 'cancelled' ? 'Stopped' : undefined);
    })().catch((e) => finish(false, e.message));
  });
}

// Agents run in their own process group, so stop them when Tributary exits.
process.once('exit', () => acpPool.closeAll());

module.exports = { runAcp, inside, acpPool, projectMcpServers, pickOption };
