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
// Secrets never go into an agent's config. Each env and header value is kept in Tributary's secret store as
// mcp:<server>:<VAR>; the config gets a placeholder in the agent's own syntax, and the hub puts VAR in the agent's
// environment when it starts a turn (Hub.mcpEnv). VAR is named for the server, so two servers never share one and
// the agent's own tools don't pick up, say, a GITHUB_TOKEN meant for a connector.
const PLACEHOLDER = {
  claude: (v) => `\${${v}}`, // code.claude.com/docs/en/mcp: env and headers, user scope included
  gemini: (v) => `$${v}`, // geminicli.com/docs/tools/mcp-server: settings are expanded from the environment on load
  'cursor-agent': (v) => `\${env:${v}}`, // cursor.com/docs/context/mcp (its CLI has no `mcp add`, so nothing is written yet)
};
// Codex has no placeholders: a stdio server lists the variables it may read (env_vars, by their own name), and an
// HTTP server names bearer_token_env_var or env_http_headers. Antigravity documents no way to read the environment.
function placeholder(agentId, name) {
  if (!PLACEHOLDER[agentId]) throw new Error(`${agentId} has no placeholder syntax for MCP secrets`);
  return PLACEHOLDER[agentId](name);
}
const varName = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
/** Where a server's secrets go: [{ name, value, env | header, bearer }]. For "Authorization: Bearer x" only x is kept. */
function mcpSecrets(s) {
  const prefix = `MCP_${varName(s.name)}_`; const out = [];
  for (const [k, v] of kv(s.env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`"${k}" is not a valid environment variable name`);
    out.push({ name: prefix + varName(k), env: k, value: String(v ?? '') });
  }
  for (const [k, v] of kv(s.headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k)) throw new Error(`"${k}" is not a valid header name`);
    const bearer = /^authorization$/i.test(k) && /^Bearer\s+(\S.*)$/i.exec(String(v ?? ''));
    out.push({ name: prefix + varName(k), header: k, bearer: !!bearer, value: bearer ? bearer[1] : String(v ?? '') });
  }
  const names = out.map((x) => x.name);
  const twice = names.find((n, i) => names.indexOf(n) !== i);
  if (twice) throw new Error(`Two values of ${s.name} would share the variable ${twice}. Rename one.`);
  return out;
}
/** The variable an agent reads a secret from: Codex's env_vars forward a variable by its own name. */
const turnVar = (agentId, x) => (agentId === 'codex' && x.env ? x.env : x.name);

// Build the official CLI arguments to add a server. server: { name, transport: 'stdio'|'http', command, args, url, env, headers }
// No value goes into the arguments: each one is a placeholder (see mcpSecrets).
function addArgs(agentId, s) {
  const http = s.transport === 'http';
  const secrets = mcpSecrets(s);
  const env = secrets.filter((x) => x.env); const headers = secrets.filter((x) => x.header);
  const header = (x) => `${x.header}: ${x.bearer ? 'Bearer ' : ''}${placeholder(agentId, x.name)}`;
  const target = http ? [s.url] : [s.command, ...(s.args || [])];
  switch (agentId) {
    case 'claude': return ['mcp', 'add', '-s', 'user', '-t', http ? 'http' : 'stdio', s.name,
      ...env.flatMap((x) => ['-e', `${x.env}=${placeholder('claude', x.name)}`]), ...headers.flatMap((x) => ['-H', header(x)]), '--', ...target];
    case 'codex': { // env_vars and env_http_headers have no flag: addMcp writes them with codexLines
      const bearer = headers.find((x) => x.bearer);
      return http ? ['mcp', 'add', s.name, '--url', s.url, ...(bearer ? ['--bearer-token-env-var', bearer.name] : [])] : ['mcp', 'add', s.name, '--', ...target];
    }
    case 'gemini': return ['mcp', 'add', '-s', 'user', '-t', http ? 'http' : 'stdio',
      ...env.map((x) => `--env=${x.env}=${placeholder('gemini', x.name)}`), ...headers.map((x) => `--header=${header(x)}`), s.name, ...(http ? target : [s.command, '--', ...(s.args || [])])];
    case 'antigravity':
      if (secrets.length) throw new Error('Antigravity has no documented way to read a value from the environment, so Tributary won\'t write it into Antigravity\'s config. Add this server in Antigravity yourself.');
      return ['mcp', 'add', ...(http ? ['--type', 'http'] : []), s.name, ...(http ? target : ['--', ...target])];
    default: throw new Error(`Adding MCP servers is not supported for ${agentId}`);
  }
}
/** What `codex mcp add` can't set, as lines for the server's [mcp_servers.<name>] table. */
function codexLines(s) {
  const secrets = mcpSecrets(s);
  const env = secrets.filter((x) => x.env); const headers = secrets.filter((x) => x.header && !x.bearer);
  return [
    ...(env.length ? [`env_vars = [${env.map((x) => JSON.stringify(x.env)).join(', ')}]`] : []),
    ...(headers.length ? [`env_http_headers = { ${headers.map((x) => `${JSON.stringify(x.header)} = ${JSON.stringify(x.name)}`).join(', ')} }`] : []),
  ];
}
/** config.toml text with those lines right under the server's table header (replacing earlier ones), or null. */
function codexConfig(text, name, lines) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rows = String(text).split('\n'); const header = new RegExp(`^\\s*\\[\\s*mcp_servers\\.(?:${esc}|"${esc}")\\s*\\]\\s*(?:#.*)?$`);
  const at = rows.findIndex((r) => header.test(r)); if (at < 0) return null;
  let end = rows.findIndex((r, i) => i > at && /^\s*\[/.test(r)); if (end < 0) end = rows.length;
  const keys = lines.map((l) => l.split(' ')[0]);
  const kept = rows.slice(at + 1, end).filter((r) => !keys.some((k) => new RegExp(`^\\s*${k}\\s*=`).test(r)));
  return [...rows.slice(0, at + 1), ...lines, ...kept, ...rows.slice(end)].join('\n');
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

// Gemini's settings.json is JSON with comments (Gemini saves it with comment-json). This reads it and keeps where each
// value sits in the text, so one string can be swapped without touching another byte: { type, value | keys, start, end }.
const STRING = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
const LITERAL = /true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
function jsonc(text) {
  let i = 0;
  const fail = () => { throw new SyntaxError(`Unexpected ${i < text.length ? 'character' : 'end'} at offset ${i}`); };
  const gap = () => {
    for (;;) {
      if (/[\s﻿]/.test(text[i] || '')) i++;
      else if (text.startsWith('//', i)) { const n = text.indexOf('\n', i); i = n < 0 ? text.length : n; }
      else if (text.startsWith('/*', i)) { const n = text.indexOf('*/', i + 2); if (n < 0) fail(); i = n + 2; }
      else return;
    }
  };
  const token = (re) => { re.lastIndex = i; const m = re.exec(text); if (!m) fail(); i = re.lastIndex; return m[0]; };
  const value = () => {
    gap(); const start = i;
    if (text[i] === '"') return { type: 'string', value: JSON.parse(token(STRING)), start, end: i };
    if (text[i] !== '{' && text[i] !== '[') { token(LITERAL); return { type: 'literal', start, end: i }; }
    const object = text[i++] === '{'; const close = object ? '}' : ']'; const keys = new Map();
    for (gap(); text[i] !== close; gap()) {
      const key = object ? value() : null;
      if (object) { if (key.type !== 'string') fail(); gap(); if (text[i] !== ':') fail(); i++; }
      const v = value(); if (object) keys.set(key.value, v);
      gap(); if (text[i] === ',') i++; else if (text[i] !== close) fail();
    }
    i++; return { type: object ? 'object' : 'array', keys, start, end: i };
  };
  const root = value(); gap(); if (i < text.length) fail();
  return root;
}
/**
 * Gemini expands $VAR in its settings when it loads them, and saving mcpServers (`gemini mcp add` or `remove`) writes the
 * expanded values back. This puts the placeholders back in one settings file: wherever mcpServers.<server>.env or .headers
 * holds a value from env (the turn's environment) for a server Gemini has in index (store.data.mcpSecrets), that string
 * becomes $VAR again, "Bearer " kept. Nothing else in the file changes, and it is written only if something did.
 * Returns how many were put back. Throws when the file can't be read, parsed or written; the message names the file only.
 */
function restoreGeminiPlaceholders(file, index, env = {}) {
  const servers = Object.entries(index || {}).filter(([, e]) => e.agents.includes('gemini') && e.vars.some((v) => env[v.name]));
  if (!servers.length) return 0;
  const check = 'check it for MCP secrets Gemini may have saved in it as plain text';
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return 0; throw new Error(`Tributary couldn't read ${file} to ${check}.`); }
  let root; try { root = text.trim() ? jsonc(text) : null; } catch { throw new Error(`${file} isn't valid JSON, so Tributary couldn't ${check}.`); }
  const at = (node, key) => (node?.type === 'object' ? node.keys.get(key) : undefined);
  const edits = [];
  for (const [name, entry] of servers) {
    const server = at(at(root, 'mcpServers'), name); const headers = at(server, 'headers');
    for (const v of entry.vars) {
      const value = env[v.name]; if (!value) continue;
      const found = v.env ? [at(at(server, 'env'), v.env)] : headers?.type === 'object' ? [...headers.keys].filter(([k]) => k.toLowerCase() === v.header.toLowerCase()).map(([, s]) => s) : [];
      for (const s of found.filter((x) => x?.type === 'string')) {
        const bearer = v.header && /^(Bearer\s+)(.*)$/is.exec(s.value);
        if (s.value === value) edits.push({ ...s, text: JSON.stringify(placeholder('gemini', v.name)) });
        else if (bearer && bearer[2] === value) edits.push({ ...s, text: JSON.stringify(bearer[1] + placeholder('gemini', v.name)) });
      }
    }
  }
  if (!edits.length) return 0;
  for (const e of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  try { fs.writeFileSync(file, text); } catch { throw new Error(`Gemini saved MCP secrets in ${file} as plain text, and Tributary couldn't put the placeholders back. Remove the server from Gemini and add it again in Tributary.`); }
  return edits.length;
}

/** Checks a server before anything is stored or run, and returns its secrets (see mcpSecrets). */
function validServer(server) {
  if (!/^[\w.-]+$/.test(server.name || '')) throw new Error('Server name may only use letters, numbers, dot, dash and underscore');
  if (server.transport === 'http' ? !/^https?:\/\//.test(server.url || '') : !server.command) throw new Error(server.transport === 'http' ? 'URL must start with http:// or https://' : 'Command is required');
  return mcpSecrets(server);
}
async function addMcp({ agents, server, home = os.homedir() }) {
  validServer(server);
  const results = [];
  for (const a of agents) {
    try {
      const r = await runCli(a.path, addArgs(a.id, server));
      let ok = r.ok; let message = redact((r.ok ? r.stdout : r.stderr).trim().split('\n').slice(-2).join(' '));
      const lines = ok && a.id === 'codex' ? codexLines(server) : [];
      if (lines.length) {
        const file = path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'config.toml');
        let next = null; try { next = codexConfig(fs.readFileSync(file, 'utf8'), server.name, lines); } catch { /* unreadable */ }
        if (next == null) { ok = false; message = `Added, but ${lines.map((l) => l.split(' ')[0]).join(' and ')} could not be set. Add them under [mcp_servers.${server.name}] in ${file}.`; }
        else fs.writeFileSync(file, next);
      }
      results.push({ agent: a.id, ok, message });
    } catch (e) { results.push({ agent: a.id, ok: false, message: e.message }); }
  }
  return results;
}
async function removeMcp({ agent, name }) {
  const r = await runCli(agent.path, removeArgs(agent.id, name));
  return { agent: agent.id, ok: r.ok, message: redact((r.ok ? r.stdout : r.stderr).trim().split('\n').slice(-2).join(' ')) };
}

module.exports = { listMcp, addMcp, removeMcp, addArgs, removeArgs, redact, MCP_AGENTS, mcpSecrets, validServer, placeholder, turnVar, codexLines, codexConfig, restoreGeminiPlaceholders };
