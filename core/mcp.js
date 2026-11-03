'use strict';
// MCP servers across agents. Listing reads each agent's own config (no network, no health checks).
// Changes go through each agent's official `mcp add` / `mcp remove` command so configs stay valid.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Mask anything secret-looking before it reaches the UI.
function redact(s) {
  return String(s || '')
    .replace(/(https?:\/\/)[^/\s@]+@/gi, '$1•••@')
    .replace(/(\b[\w-]*(?:token|secret|password|api[_-]?key)[\w-]*\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&,;]+)/gi, '$1•••')
    .replace(/(--(?:token|secret|password|api[_-]?key)\s+)("[^"]*"|'[^']*'|\S+)/gi, '$1•••')
    .replace(/((?:--header|-H)[ =])(\S+:?)\s+\S+/gi, '$1$2 •••')
    .replace(/(authorization:?\s*(?:bearer|basic)?\s*)\S+/gi, '$1•••')
    .replace(/(x-[\w-]*(?:key|token|secret)[\w-]*:?\s*)\S+/gi, '$1•••')
    .replace(/([?&](?:key|token|api[_-]?key|access[_-]?token|secret|sig)=)[^&\s]+/gi, '$1•••')
    .replace(/\b(sk|pk|rk|ghp|gho|ghs|glpat|xox[abpr]|AQ|AIza)[-_.]?[A-Za-z0-9_.-]{12,}/g, '•••');
}
const readJson = (p, warnings = []) => { try { if (fs.statSync(p).size > 1024 * 1024) throw new Error('too large'); return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') warnings.push(`A ${path.basename(p)} connector configuration could not be read. Check its JSON format, size and file permissions.`); return null; } };
const fromJson = (agent, scope, servers) => Object.entries(servers || {}).map(([name, c]) => ({
  agent, name, scope, enabled: !(c.disabled || c.enabled === false),
  transport: c.url || c.httpUrl || c.serverUrl ? (c.type || 'http') : 'stdio',
  target: redact(c.url || c.httpUrl || c.serverUrl || [c.command, ...(c.args || [])].filter(Boolean).join(' ')),
  envKeys: Object.keys(c.env || {}),
}));

function runCli(bin, args, { timeout = 20000, env } = {}) {
  return new Promise((resolve) => execFile(bin, args, { timeout, env: env || process.env, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
    resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') || (err ? err.message : '') })));
}

async function listMcp({ agents, home = os.homedir(), project, warnings = [] }) {
  const read = (p) => readJson(p, warnings);
  const out = []; const has = (id) => agents.find((a) => a.id === id && a.available);
  if (has('claude')) {
    const cj = read(path.join(home, '.claude.json')) || {};
    out.push(...fromJson('claude', 'user', cj.mcpServers));
    if (project) {
      out.push(...fromJson('claude', 'local', ((cj.projects || {})[project] || {}).mcpServers));
      out.push(...fromJson('claude', 'project', (read(path.join(project, '.mcp.json')) || {}).mcpServers));
    }
  }
  if (has('gemini')) {
    out.push(...fromJson('gemini', 'user', (read(path.join(home, '.gemini', 'settings.json')) || {}).mcpServers));
    if (project) out.push(...fromJson('gemini', 'project', (read(path.join(project, '.gemini', 'settings.json')) || {}).mcpServers));
  }
  if (has('antigravity')) {
    const f = [path.join(home, '.gemini', 'config', 'mcp_config.json'), path.join(home, '.gemini', 'antigravity', 'mcp_config.json')].find((p) => fs.existsSync(p));
    if (f) out.push(...fromJson('antigravity', 'user', (read(f) || {}).mcpServers));
  }
  const codex = has('codex');
  if (codex) {
    const r = await runCli(codex.path, ['mcp', 'list', '--json']);
    try {
      for (const s of JSON.parse(r.stdout)) {
        const t = s.transport || {};
        out.push({ agent: 'codex', name: s.name, scope: 'user', enabled: s.enabled !== false, transport: t.type === 'stdio' ? 'stdio' : 'http',
          target: redact(t.url || [t.command, ...(t.args || [])].filter(Boolean).join(' ')), envKeys: Object.keys(t.env || {}) });
      }
    } catch { warnings.push('Codex connector inventory could not be read. Check the installed CLI and its MCP configuration.'); }
  }
  return out;
}

const kv = (o) => Object.entries(o || {}).filter(([k]) => k);
// Build the official CLI arguments to add a server. server: { name, transport: 'stdio'|'http', command, args, url, env, headers }
function addArgs(agentId, s) {
  const http = s.transport === 'http';
  const env = kv(s.env); const headers = kv(s.headers);
  const target = http ? [s.url] : [s.command, ...(s.args || [])];
  switch (agentId) {
    case 'claude': return ['mcp', 'add', '-s', 'user', '-t', http ? 'http' : 'stdio', s.name,
      ...env.flatMap(([k, v]) => ['-e', `${k}=${v}`]), ...headers.flatMap(([k, v]) => ['-H', `${k}: ${v}`]), '--', ...target];
    case 'codex':
      if (http && headers.length) throw new Error('Codex only supports a bearer token variable for HTTP servers, not custom headers');
      return http ? ['mcp', 'add', s.name, '--url', s.url] : ['mcp', 'add', s.name, ...env.flatMap(([k, v]) => ['--env', `${k}=${v}`]), '--', ...target];
    case 'gemini': return ['mcp', 'add', '-s', 'user', '-t', http ? 'http' : 'stdio',
      ...env.map(([k, v]) => `--env=${k}=${v}`), ...headers.map(([k, v]) => `--header=${k}: ${v}`), s.name, ...(http ? target : [s.command, '--', ...(s.args || [])])];
    case 'antigravity': return ['mcp', 'add', ...env.flatMap(([k, v]) => ['--env', `${k}=${v}`]), ...headers.flatMap(([k, v]) => ['--header', `${k}: ${v}`]),
      ...(http ? ['--type', 'http'] : []), s.name, ...(http ? target : ['--', ...target])];
    default: throw new Error(`Adding MCP servers is not supported for ${agentId}`);
  }
}
function removeArgs(agentId, name) {
  switch (agentId) {
    case 'claude': return ['mcp', 'remove', '-s', 'user', name];
    case 'gemini': return ['mcp', 'remove', '-s', 'user', name];
    case 'codex': case 'antigravity': return ['mcp', 'remove', name];
    default: throw new Error(`Removing MCP servers is not supported for ${agentId}`);
  }
}
const MCP_AGENTS = ['claude', 'codex', 'gemini', 'antigravity'];

async function addMcp({ agents, server }) {
  if (!/^[\w.-]+$/.test(server.name || '')) throw new Error('Server name may only use letters, numbers, dot, dash and underscore');
  if (server.transport === 'http' ? !/^https?:\/\//.test(server.url || '') : !server.command) throw new Error(server.transport === 'http' ? 'URL must start with http:// or https://' : 'Command is required');
  const results = [];
  for (const a of agents) {
    try { const r = await runCli(a.path, addArgs(a.id, server)); results.push({ agent: a.id, ok: r.ok, message: redact((r.ok ? r.stdout : r.stderr).trim().split('\n').slice(-2).join(' ')) }); }
    catch (e) { results.push({ agent: a.id, ok: false, message: e.message }); }
  }
  return results;
}
async function removeMcp({ agent, name }) {
  const r = await runCli(agent.path, removeArgs(agent.id, name));
  return { agent: agent.id, ok: r.ok, message: redact((r.ok ? r.stdout : r.stderr).trim().split('\n').slice(-2).join(' ')) };
}

module.exports = { listMcp, addMcp, removeMcp, addArgs, removeArgs, redact, MCP_AGENTS };
