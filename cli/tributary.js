#!/usr/bin/env node
'use strict';
// Tributary on the command line: the same hub the desktop app and VS Code extension use, driven from a terminal.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Hub } = require('../core');
const { detectAgents, describe, MODES } = require('../core/agents');
const { loadRegistry, addRegistryAgent, removeRegistryAgent } = require('../core/registry');
const pkg = require('../package.json');

const USAGE = `Usage: tributary <command> [options]

Work with agents
  ask [-a agent] "request"        Run one turn in this folder. Continues the latest thread here.
      -m read|edit|full           Permission mode (default: edit)
      --plan                      Plan only; nothing is changed
      --new                       Start a new thread
      -t <thread>                 Continue a specific thread (id or id prefix)
      -                           Read the request from stdin
  race -a a,b [--test cmd] "task" Several agents try the same task in separate git worktrees
  apply <agent>                   Apply that agent's result from the latest race
  agents                          List installed agents

Threads
  threads                         Threads for this folder, newest first
  show [-t thread]                Print a thread
  diff [-t thread]                What the last turn changed
  undo [-t thread]                Restore files to before the last turn
  export [-t thread] [-o file]    Save a thread as Markdown

Project
  memory [show|enable|remember "note"]   Shared memory every agent reads (.tributary/memory.md)
  mcp                             MCP servers configured in each agent
  skills                          Skills available to each agent
  registry [list|add <id>|remove <id>]   Agents from the ACP registry
  doctor                          Check git, agents and the data folder

Options
  -C <dir>        Run in another folder
  --json          Machine-readable output
  --data-dir <d>  Where threads are stored (default: the desktop app's folder, or TRIBUTARY_DATA_DIR)
  --no-color      Plain output (NO_COLOR is respected too)
  -q, --quiet     Print only the reply
  -h, --help      Show this help
  -v, --version   Show the version

Examples
  tributary ask -a claude "add input validation to the signup form"
  tributary ask -a codex "review what claude just changed"
  git diff | tributary ask -a gemini --plan -
  tributary race -a claude,codex --test "npm test" "fix the failing date parser test"
  tributary apply codex`;

class UsageError extends Error {}

// ---- arguments
const VALUE_FLAGS = { '-a': 'agent', '--agent': 'agent', '-m': 'mode', '--mode': 'mode', '-t': 'thread', '--thread': 'thread', '--test': 'test',
  '-o': 'output', '--output': 'output', '-C': 'dir', '--dir': 'dir', '--data-dir': 'dataDir', '--model': 'model', '--gateway': 'gateway' };
const BOOL_FLAGS = { '--json': 'json', '--plan': 'plan', '--new': 'new', '--no-color': 'noColor', '-h': 'help', '--help': 'help',
  '-v': 'version', '--version': 'version', '-q': 'quiet', '--quiet': 'quiet' };

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { o._.push(...argv.slice(i + 1)); break; }
    if (a === '-' || !a.startsWith('-')) { o._.push(a); continue; }
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    if (VALUE_FLAGS[flag]) {
      const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
      if (v === undefined) throw new UsageError(`${flag} needs a value`);
      o[VALUE_FLAGS[flag]] = v;
    } else if (BOOL_FLAGS[flag] && eq < 0) o[BOOL_FLAGS[flag]] = true;
    else throw new UsageError(`Unknown option ${a}`);
  }
  return o;
}

// ---- output
let color = false;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = paint('2'); const bold = paint('1'); const red = paint('31'); const green = paint('32'); const yellow = paint('33');
const out = (s = '') => process.stdout.write(`${s}\n`);
const json = (v) => out(JSON.stringify(v, null, 2));
const short = (id) => String(id || '').slice(0, 8);
function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - (ts || 0)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
const seconds = (ms) => (ms == null ? '' : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`);
function readStdin() {
  return new Promise((resolve, reject) => {
    let s = ''; process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { s += d; }).on('end', () => resolve(s)).on('error', reject);
  });
}

// ---- storage. The CLI shares the desktop app's data folder (Electron's userData); the SQLite store lets both write at once.
function appDataDir() {
  const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.platform === 'win32' ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
      : (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));
  return path.join(base, 'Tributary');
}
function defaultDataDir() { return process.env.TRIBUTARY_DATA_DIR || appDataDir(); }

// Earlier CLI versions kept their own folder (Tributary/cli). Bring its projects and threads over once.
function importOldCliFolder(hub) {
  const file = path.join(appDataDir(), 'cli', 'hub.json');
  let old; try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
  const d = hub.store.data;
  for (const p of old.projects || []) if (p && p.path && !hub.project(p.path)) d.projects.push(p);
  for (const t of old.threads || []) if (t && t.id && !hub.thread(t.id)) d.threads.push(t);
  hub.store.save(true);
  fs.renameSync(file, `${file}.migrated`);
}

// Gateway keys in a file only this user can read. The terminal has no keychain bridge like Electron's safeStorage,
// so it cannot read keys the desktop app encrypted, and it keeps its own file instead of rewriting the app's secrets.json.
class FileSecrets {
  constructor(file) { this.file = file; try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.data = {}; } }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data), { mode: 0o600 });
    fs.chmodSync(this.file, 0o600);
  }
  async get(k) { return this.data[k]; }
  async set(k, v) { this.data[k] = v; this.save(); }
  async delete(k) { delete this.data[k]; this.save(); }
}

async function openHub(o, { versions = false } = {}) {
  const dataDir = path.resolve(o.dataDir || defaultDataDir());
  const hub = new Hub({ dataDir, secrets: new FileSecrets(path.join(dataDir, 'cli-secrets.json')) });
  if (dataDir === path.resolve(appDataDir())) importOldCliFolder(hub);
  if (!fs.existsSync(hub.customAgentsFile)) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(hub.customAgentsFile, JSON.stringify({ agents: [],
      example: { id: 'my-agent', name: 'My Agent', command: '/path/to/agent', args: ['--print', '{prompt}'], protocol: 'text', note: 'protocol: text | acp | claude-stream | codex-exec | gemini-stream. {prompt} {cwd} {mode} are substituted.' } }, null, 2));
  }
  // Version probes start every agent once; only the listing commands need them.
  hub.agents = await detectAgents({ customFile: hub.customAgentsFile, probeVersions: versions });
  return hub;
}

// The project is a registered project that contains this folder, else the folder itself.
function projectDir(hub, o) {
  const dir = path.resolve(o.dir || process.cwd());
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`Not a folder: ${dir}`);
  const real = fs.realpathSync(dir);
  const inside = (root) => { const rel = path.relative(root, real); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
  const known = hub.store.data.projects.map((p) => p.path).filter(inside).sort((a, b) => b.length - a.length)[0];
  return known || real;
}

function findThread(hub, project, o, { create = false, required = true } = {}) {
  if (o.thread) {
    const t = hub.store.data.threads.find((x) => x.id === o.thread) || hub.store.data.threads.filter((x) => x.id.startsWith(o.thread))[0];
    if (!t) throw new Error(`No thread ${o.thread}. List them with: tributary threads`);
    return t;
  }
  if (o.new) return create ? hub.createThread(project) : null;
  const latest = hub.threads(project)[0];
  if (latest) return hub.thread(latest.id);
  if (create) return hub.createThread(project);
  if (!required) return null;
  throw new Error('No threads in this folder yet. Start one with: tributary ask "..."');
}

function lookupAgent(hub, id) {
  const all = hub.allAgents().filter((a) => !a.hidden);
  const a = all.find((x) => x.id === id) || all.find((x) => x.name.toLowerCase() === String(id).toLowerCase());
  const ready = all.filter((x) => x.available).map((x) => x.id);
  if (!a) throw new Error(`Unknown agent "${id}". Installed: ${ready.join(', ') || 'none (see tributary agents)'}`);
  if (!a.available) throw new Error(`${a.name} is not installed.${a.docs ? ` Install it: ${a.docs}` : ''}`);
  return a;
}

function chooseAgent(hub, o, thread) {
  if (o.agent) return lookupAgent(hub, o.agent);
  const ready = (id) => { const a = id && hub.agent(id); return a && a.available && a.headless ? a : null; };
  const a = ready(thread && thread.lastAgent) || ready(hub.store.data.settings.agent) || hub.allAgents().find((x) => !x.hidden && x.available && x.headless);
  if (!a) throw new Error('No coding agent is installed. Install Claude Code, Codex, Gemini CLI or another agent, then run tributary agents.');
  return a;
}

async function requestText(o, what) {
  let text = o._.join(' ').trim();
  if (text === '-') text = (await readStdin()).trim();
  if (!text) throw new UsageError(`${what} Put it in quotes, or pass - to read it from stdin.`);
  return text;
}

// Stop the running turn on Ctrl+C, save what arrived, exit 130. A second Ctrl+C exits at once.
function onInterrupt(hub) {
  let stopping = false;
  const handler = () => {
    if (stopping) { hub.store.save(true); process.exit(130); }
    stopping = true; process.exitCode = 130;
    process.stderr.write(`\n${dim('Stopping… (Ctrl+C again to quit now)')}\n`);
    for (const id of hub.running.keys()) hub.stop(id);
  };
  process.on('SIGINT', handler);
  return () => process.off('SIGINT', handler);
}

// ---- commands
const commands = {};

commands.agents = async (o) => {
  const hub = await openHub(o, { versions: true });
  const list = hub.allAgents().filter((a) => !a.hidden).map(describe);
  if (o.json) return json(list);
  const w = Math.max(...list.map((a) => a.name.length), 4);
  for (const a of list) {
    const state = a.available ? (a.headless ? green('ready') : yellow('installed, no headless mode')) : dim('not installed');
    out(`${a.name.padEnd(w)}  ${state}${a.version ? dim(`  ${a.version}`) : ''}${dim(`  ${a.id}`)}`);
  }
  out(dim(`\nCustom agents: ${hub.customAgentsFile}`));
};

commands.ask = async (o) => {
  const hub = await openHub(o);
  const project = projectDir(hub, o);
  const prior = findThread(hub, project, o, { required: false });
  const agent = chooseAgent(hub, o, prior);
  if (o.mode && !MODES.includes(o.mode)) throw new UsageError(`Mode must be one of ${MODES.join(', ')}`);
  const text = await requestText(o, 'What should the agent do?');
  const thread = prior || hub.createThread(project);

  let atLineStart = true; let streamed = false; const seenTools = new Set();
  const write = (s) => { if (!s) return; process.stdout.write(s); atLineStart = s.endsWith('\n'); };
  const line = (s) => { if (!atLineStart) write('\n'); write(`${s}\n`); };
  const live = !o.json;
  if (live && !o.quiet) line(dim(`${agent.name} · ${o.plan ? 'plan' : (o.mode || hub.store.data.settings.mode || 'edit')} · ${path.basename(project)}`));
  hub.on('event', ({ threadId, event: e }) => {
    if (!live || threadId !== thread.id) return;
    if (e.kind === 'text') { write(e.text); streamed = true; }
    else if (e.kind === 'tool' && !o.quiet) {
      const key = e.id || `${e.name}:${seenTools.size}`;
      const detail = e.input && (e.input.command || e.input.file_path || e.input.path || e.input.pattern);
      const label = `${e.name || 'tool'}${detail ? ` ${Array.isArray(detail) ? detail.join(' ') : String(detail).slice(0, 100)}` : ''}`;
      if (!seenTools.has(key) && e.name) { seenTools.add(key); line(dim(`  › ${label}`)); }
      if (e.status === 'error') line(red(`  ✗ ${label}`));
    } else if (e.kind === 'notice' && !o.quiet) line(yellow(`  ${e.text}`));
  });

  const release = onInterrupt(hub);
  let msg;
  try { msg = await hub.send({ threadId: thread.id, agentId: agent.id, text, mode: o.mode, plan: !!o.plan, model: o.model, gatewayId: o.gateway }); }
  finally { release(); hub.store.save(true); }

  if (o.json) return json({ thread: thread.id, message: msg });
  if (!streamed && msg.text) write(msg.text);
  if (!atLineStart) write('\n');
  if (msg.error) process.stderr.write(`${red(msg.error)}\n`);
  if (!o.quiet) {
    const files = (msg.files || []).filter((f) => !f.external).map((f) => f.rel);
    if (files.length) out(`\n${bold(`Changed ${files.length} file${files.length === 1 ? '' : 's'}:`)} ${files.join(', ')}`);
    const facts = [agent.name, seconds(msg.durationMs), msg.costUsd != null ? `$${msg.costUsd.toFixed(4)}` : '', `thread ${short(thread.id)}`].filter(Boolean);
    out(dim(facts.join(' · ')));
    if (o.plan && msg.ok) out(dim(`Run it: tributary ask -a ${agent.id} "Implement the plan above"`));
  }
  if (msg.ok === false && process.exitCode !== 130) process.exitCode = 1;
};

const testLabel = { passed: green('tests passed'), failed: red('tests failed'), skipped: dim('no tests'), running: dim('running tests'), pending: dim('waiting') };

commands.race = async (o) => {
  const hub = await openHub(o);
  const project = projectDir(hub, o);
  const ids = String(o.agent || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length < 2) throw new UsageError('Race needs at least two agents, for example: tributary race -a claude,codex "task"');
  const agents = ids.map((id) => lookupAgent(hub, id));
  if (o.mode && !MODES.includes(o.mode)) throw new UsageError(`Mode must be one of ${MODES.join(', ')}`);
  const task = await requestText(o, 'What should the agents do?');
  const thread = findThread(hub, project, o, { create: true });
  const name = (id) => (hub.agent(id) || {}).name || id;
  const w = Math.max(...agents.map((a) => a.name.length));

  if (!o.json) out(dim(`Racing ${agents.map((a) => a.name).join(', ')}${o.test ? ` · tests: ${o.test}` : ''} · each in its own worktree`));
  const last = new Map();
  hub.on('event', ({ threadId, message }) => {
    if (o.json || threadId !== thread.id || !message.race) return;
    for (const c of message.race.candidates) {
      const state = c.status === 'running' ? (c.activity ? 'working' : 'started') : (c.tests === 'running' ? 'testing' : 'done');
      if (last.get(c.agent) === state) continue;
      last.set(c.agent, state);
      if (state !== 'done') out(dim(`  ${name(c.agent).padEnd(w)}  ${state}`));
    }
  });

  const release = onInterrupt(hub);
  let result;
  try { result = await hub.runRace(thread.id, { task, agents: agents.map((a) => a.id), testCommand: o.test || '', mode: o.mode || 'edit' }); }
  finally { release(); hub.store.save(true); }

  if (o.json) return json({ thread: thread.id, race: result });
  out('');
  for (const c of result.candidates) {
    const files = c.files || [];
    const parts = [bold(name(c.agent).padEnd(w)), c.error ? red('failed to run') : (testLabel[c.tests] || dim(c.tests || '')),
      `${files.length} file${files.length === 1 ? '' : 's'}`, dim(seconds(c.durationMs))];
    out(parts.join('  '));
    if (files.length) out(dim(`  ${files.slice(0, 8).join(', ')}${files.length > 8 ? ` +${files.length - 8}` : ''}`));
    if (c.error) out(red(`  ${c.error.split('\n')[0]}`));
    if (c.branch) out(dim(`  branch ${c.branch}`));
  }
  const pick = result.candidates.find((c) => c.tests === 'passed') || result.candidates.find((c) => c.ok && (c.files || []).length);
  out(dim(`\nYour files are unchanged. Apply one: tributary apply ${pick ? pick.agent : '<agent>'}`));
};

commands.apply = async (o) => {
  const hub = await openHub(o);
  const project = projectDir(hub, o);
  const who = o._[0];
  if (!who) throw new UsageError('Which agent\'s result? For example: tributary apply codex');
  const threads = o.thread ? [findThread(hub, project, o)] : hub.threads(project).map((t) => hub.thread(t.id));
  const races = threads.flatMap((t) => t.messages.filter((m) => m.role === 'assistant' && m.kind === 'race' && m.race).map((m) => ({ t, m })));
  const latest = races.sort((a, b) => (b.m.ts || 0) - (a.m.ts || 0))[0];
  if (!latest) throw new Error('No race in this folder yet. Start one with: tributary race -a a,b "task"');
  const c = latest.m.race.candidates.find((x) => x.agent === who || (hub.agent(x.agent) || {}).name?.toLowerCase() === who.toLowerCase());
  if (!c) throw new Error(`${who} was not in the latest race. It had: ${latest.m.race.candidates.map((x) => x.agent).join(', ')}`);
  const r = await hub.applyRace(latest.t.id, latest.m.id, c.agent);
  hub.store.save(true);
  if (o.json) return json(r);
  out(`Applied ${(hub.agent(c.agent) || {}).name || c.agent}'s changes${r.files && r.files.length ? `: ${r.files.join(', ')}` : ''}`);
};

commands.threads = async (o) => {
  const hub = await openHub(o);
  const project = projectDir(hub, o);
  const rows = hub.threads(project);
  if (o.json) return json(rows);
  if (!rows.length) return out(dim('No threads in this folder yet. Start one with: tributary ask "..."'));
  const names = hub.names();
  rows.forEach((t, i) => out(`${i === 0 ? '*' : ' '} ${short(t.id)}  ${t.title}  ${dim(`${(t.agents.length ? t.agents : [t.lastAgent].filter(Boolean)).map((a) => names[a] || a).join(', ') || '-'} · ${t.count} messages · ${ago(t.updatedAt)}`)}`));
};

commands.show = async (o) => {
  const hub = await openHub(o);
  const t = findThread(hub, projectDir(hub, o), o);
  if (o.json) return json(t);
  const names = hub.names();
  out(bold(t.title)); out(dim(`${t.project} · thread ${short(t.id)}`));
  for (const m of t.messages) {
    out('');
    if (m.role === 'user') { out(bold(`You → ${String(m.target || '').split(',').map((x) => names[x] || x).join(', ')}`)); out(m.text); continue; }
    if (m.kind === 'race' && m.race) {
      out(bold('Race'));
      for (const c of m.race.candidates) out(`  ${names[c.agent] || c.agent}: ${testLabel[c.tests] || c.tests || c.status}, ${(c.files || []).length} files${m.race.applied === c.agent ? green(' (applied)') : ''}`);
      continue;
    }
    out(bold(names[m.agent] || m.agent) + (m.team ? dim(` (${m.team.role})`) : ''));
    if (m.text) out(m.text.replace(/\s+$/, ''));
    const files = (m.files || []).filter((f) => !f.external).map((f) => f.rel);
    if (files.length) out(dim(`Changed: ${files.join(', ')}`));
    if (m.error) out(red(m.error));
  }
};

function lastTurn(t) {
  const m = [...t.messages].reverse().find((x) => x.role === 'assistant' && x.checkpoint);
  if (!m) throw new Error('No turn with a checkpoint in this thread');
  return m;
}

commands.diff = async (o) => {
  const hub = await openHub(o);
  const t = findThread(hub, projectDir(hub, o), o);
  const m = lastTurn(t);
  const d = await hub.turnDiff(t.id, m.id, o._[0]);
  if (o.json) return json({ messageId: m.id, diff: d });
  const text = typeof d === 'string' ? d : (d && (d.diff || d.patch)) || '';
  out(text.replace(/\s+$/, '') || dim('No changes'));
};

commands.undo = async (o) => {
  const hub = await openHub(o);
  const t = findThread(hub, projectDir(hub, o), o);
  const m = lastTurn(t);
  const r = await hub.restoreCheckpoint(t.id, m.id);
  hub.store.save(true);
  if (o.json) return json(r);
  out(`Restored files to before ${(hub.agent(m.agent) || {}).name || m.agent}'s last turn (${r.restored} restored, ${r.removed} removed)`);
};
commands.restore = commands.undo;

commands.export = async (o) => {
  const hub = await openHub(o);
  const t = findThread(hub, projectDir(hub, o), o);
  const md = hub.exportMarkdown(t.id);
  if (!o.output) return out(md);
  fs.writeFileSync(path.resolve(o.output), md);
  out(`Saved ${path.resolve(o.output)}`);
};

commands.memory = async (o) => {
  const hub = await openHub(o);
  const project = hub.addProject(projectDir(hub, o));
  const [sub = 'show', ...rest] = o._;
  if (sub === 'enable' || sub === 'on') {
    const created = hub.enableMemory(project); hub.store.save(true);
    return out(created.length ? `Memory is on. Created ${created.join(', ')}` : 'Memory is already on');
  }
  if (sub === 'remember' || sub === 'add') {
    const note = rest.join(' ').trim();
    if (!note) throw new UsageError('What should agents remember? For example: tributary memory remember "Use pnpm, not npm"');
    const line = hub.remember(project, note); hub.store.save(true);
    return out(`Remembered: ${line}`);
  }
  if (sub !== 'show') throw new UsageError(`Unknown memory command "${sub}". Use show, enable or remember.`);
  const m = hub.memory(project);
  if (o.json) return json(m);
  if (!m.enabled) return out(`Memory is off for this project. Turn it on: tributary memory enable`);
  out((m.memory || '').replace(/\s+$/, ''));
  if (m.worklog.length) { out(`\n${bold('Recent work')}`); for (const l of m.worklog.slice(-10)) out(dim(l)); }
};

commands.mcp = async (o) => {
  const hub = await openHub(o);
  const list = await hub.mcp(projectDir(hub, o));
  if (o.json) return json(list);
  if (!list.length) return out(dim('No MCP servers found in your installed agents.'));
  const names = hub.names();
  for (const s of list) out(`${s.name}  ${dim(`${names[s.agent] || s.agent} · ${s.scope} · ${s.transport}${s.enabled === false ? ' · disabled' : ''}`)}  ${dim(s.target || '')}`);
};

commands.skills = async (o) => {
  const hub = await openHub(o);
  const list = hub.skills(projectDir(hub, o));
  if (o.json) return json(list);
  if (!list.length) return out(dim('No skills found.'));
  for (const s of list) out(`${s.name}  ${dim(s.agents.join(', '))}${s.description ? `\n  ${dim(s.description.slice(0, 140))}` : ''}`);
};

commands.registry = async (o) => {
  const hub = await openHub(o);
  const [sub = 'list', id] = o._;
  if (sub === 'remove') {
    if (!id) throw new UsageError('Which agent? For example: tributary registry remove acp:qwen-code');
    const full = id.startsWith('acp:') ? id : `acp:${id}`;
    removeRegistryAgent(hub.customAgentsFile, full);
    return out(`Removed ${full}`);
  }
  const reg = await loadRegistry({ cacheFile: path.join(hub.dataDir, 'acp-registry.json') });
  if (sub === 'add') {
    if (!id) throw new UsageError('Which agent? For example: tributary registry add qwen-code');
    const a = reg.agents.find((x) => x.id === id || `acp:${x.id}` === id);
    if (!a) throw new Error(`${id} is not in the ACP registry. List them with: tributary registry`);
    const entry = addRegistryAgent(hub.customAgentsFile, a);
    return out(`Added ${a.name} as ${(entry && entry.id) || `acp:${a.id}`}. It runs with ${a.install.command} the first time you use it.`);
  }
  if (sub !== 'list') throw new UsageError(`Unknown registry command "${sub}". Use list, add or remove.`);
  if (o.json) return json(reg.agents);
  for (const a of reg.agents) out(`${a.id}  ${a.name}${a.version ? dim(` ${a.version}`) : ''}  ${a.install.runnable ? dim(a.install.kind) : dim('download only')}`);
  if (reg.source === 'cache') out(dim('\nOffline: showing the saved copy of the registry.'));
};

commands.doctor = async (o) => {
  const { execFileSync } = require('child_process');
  const hub = await openHub(o, { versions: true });
  const checks = [];
  const add = (ok, label, detail) => checks.push({ ok, label, detail });
  add(Number(process.versions.node.split('.')[0]) >= 20, 'Node.js', process.versions.node);
  try { add(true, 'git', execFileSync('git', ['--version'], { encoding: 'utf8' }).trim()); } catch { add(false, 'git', 'not found. Checkpoints and race need git.'); }
  const ready = hub.allAgents().filter((a) => !a.hidden && a.available && a.headless);
  add(ready.length > 0, 'Agents', ready.length ? ready.map((a) => `${a.name}${a.version ? ` ${a.version}` : ''}`).join(', ') : 'none installed');
  add(true, 'Data folder', hub.dataDir);
  add(true, 'Gateways', String(hub.store.data.gateways.length));
  if (o.json) return json(checks);
  for (const c of checks) out(`${c.ok ? green('✓') : red('✗')} ${c.label.padEnd(12)} ${c.detail}`);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
};

const ALIASES = { a: 'ask', ls: 'threads', log: 'show', agent: 'agents', '?': 'help' };

async function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { return fail(e); }
  color = !!process.stdout.isTTY && !o.noColor && !('NO_COLOR' in process.env);
  if (o.version) return out(pkg.version);
  const name = ALIASES[o._[0]] || o._[0];
  if (o.help || !name || name === 'help') { out(USAGE); return; }
  const run = commands[name];
  if (!run) return fail(new UsageError(`Unknown command "${o._[0]}". Try: tributary ask "..." or tributary --help`));
  o._ = o._.slice(1);
  try { await run(o); } catch (e) { fail(e); }
}

function fail(e) {
  process.stderr.write(`tributary: ${e.message}\n`);
  if (e instanceof UsageError) process.stderr.write('Run tributary --help for usage.\n');
  process.exitCode = e instanceof UsageError ? 2 : 1;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(() => {
    // Pooled ACP agents and timers would keep the process alive after the work is done.
    process.stdout.write('', () => process.exit(process.exitCode || 0));
  });
}

module.exports = { main, parseArgs };
