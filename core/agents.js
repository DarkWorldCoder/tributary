'use strict';
// Registry of coding agents Tributary knows how to drive, plus detection.
// protocol: how we talk to the agent and parse its output (see parsers.js / acp.js).
// verified: true when the flags and event format were checked against a real install.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const MODES = ['read', 'edit', 'full']; // read-only, edit files, full auto

const BUILTIN = [
  {
    id: 'claude', docs: 'https://code.claude.com/docs', login: 'claude', glyph: 'Cl', name: 'Claude Code', vendor: 'Anthropic', bins: ['claude'],
    protocol: 'claude-stream', gateways: ['anthropic'], verified: true, color: '#d97757',
    stdinPrompt: true, controlProtocol: 'claude-stdio',
    args({ mode, resumeId, model, extraDirs = [], images = [], control = false }) {
      const a = ['-p', ...(control || images.length ? ['--input-format', 'stream-json'] : []), ...(control ? ['--permission-prompt-tool', 'stdio'] : []), '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
        '--permission-mode', { read: 'plan', edit: 'acceptEdits', full: 'bypassPermissions' }[mode]];
      if (extraDirs.length) a.push('--add-dir', ...extraDirs);
      if (resumeId) a.push('--resume', resumeId);
      if (model) a.push('--model', model);
      return a;
    },
  },
  {
    id: 'codex', docs: 'https://developers.openai.com/codex', login: 'codex login', glyph: 'Cx', name: 'Codex', vendor: 'OpenAI', bins: ['codex'],
    extraPaths: ['/usr/lib/chatgpt/resources/codex', '/Applications/ChatGPT.app/Contents/Resources/codex',
      '/Applications/Codex.app/Contents/Resources/codex'],
    protocol: 'codex-exec', controlProtocol: 'codex-app-server', gateways: ['openai', 'ollama', 'lmstudio'], verified: true, color: '#10a37f',
    stdinPrompt: true,
    args({ mode, resumeId, cwd, model, gatewayArgs = [], extraDirs = [], images = [] }) {
      const policy = mode === 'full'
        ? ['--dangerously-bypass-approvals-and-sandbox']
        : ['-s', mode === 'read' ? 'read-only' : 'workspace-write'];
      const common = ['--json', '--skip-git-repo-check', ...policy, ...gatewayArgs, ...extraDirs.flatMap((d) => ['--add-dir', d])];
      if (model) common.push('-m', model);
      // `-` makes codex read the prompt from stdin.
      return resumeId ? ['exec', ...common, '-C', cwd, 'resume', ...images.flatMap((file) => ['-i', file.path]), resumeId, '-'] : ['exec', ...common, '-C', cwd, ...images.flatMap((file) => ['-i', file.path]), '-'];
    },
  },
  {
    id: 'gemini', docs: 'https://geminicli.com', login: 'gemini', glyph: 'Ge', name: 'Gemini CLI', vendor: 'Google', bins: ['gemini'],
    protocol: 'gemini-stream', controlProtocol: 'gemini-acp', gateways: ['gemini'], verified: true, color: '#4285f4',
    stdinPrompt: false,
    trustEnv: { GEMINI_CLI_TRUST_WORKSPACE: 'true' },
    note: 'Personal Google sign-in was retired for Gemini CLI. Use a Gemini API key gateway or Antigravity.',
    args({ mode, resumeId, prompt, model, extraDirs = [] }) {
      const a = ['-p', prompt, '-o', 'stream-json', '--approval-mode', { read: 'plan', edit: 'auto_edit', full: 'yolo' }[mode]];
      if (extraDirs.length) a.push('--include-directories', extraDirs.join(','));
      if (resumeId) a.push('--resume', resumeId);
      if (model) a.push('-m', model);
      return a;
    },
  },
  {
    id: 'antigravity', docs: 'https://antigravity.google', login: 'agy', glyph: 'Ag', name: 'Antigravity CLI', vendor: 'Google', bins: ['agy'],
    protocol: 'agy-stream', gateways: ['gemini'], verified: true, color: '#7c4dff',
    stdinPrompt: false,
    args({ mode, resumeId, prompt, model, extraDirs = [] }) {
      const a = ['-p', prompt, '--output-format', 'stream-json', ...extraDirs.flatMap((d) => ['--add-dir', d])];
      if (mode === 'full') a.push('--dangerously-skip-permissions');
      else a.push('--mode', mode === 'read' ? 'plan' : 'accept-edits');
      if (resumeId) a.push('--conversation', resumeId);
      if (model) a.push('--model', model);
      return a;
    },
  },
  // Agents that speak the open Agent Client Protocol. Flags come from each project's docs and
  // were not run on this machine, so they are marked unverified until detected and tested.
  { id: 'opencode', docs: 'https://opencode.ai', login: 'opencode auth login', glyph: 'Oc', name: 'OpenCode', vendor: 'SST', bins: ['opencode'], protocol: 'acp', acpArgs: ['acp'], gateways: ['openai', 'anthropic', 'ollama'], color: '#f5a623' },
  { id: 'goose', docs: 'https://goose-docs.ai', login: 'goose configure', glyph: 'Go', name: 'Goose', vendor: 'Block', bins: ['goose'], protocol: 'acp', acpArgs: ['acp'], gateways: ['openai', 'anthropic', 'ollama'], color: '#3a3a3a' },
  { id: 'qwen', docs: 'https://github.com/QwenLM/qwen-code', login: 'qwen', glyph: 'Qw', name: 'Qwen Code', vendor: 'Alibaba', bins: ['qwen'], protocol: 'acp', acpArgs: ['--acp'], gateways: ['openai'], color: '#615ced' },
  { id: 'kimi', glyph: 'Ki', name: 'Kimi CLI', vendor: 'Moonshot', bins: ['kimi'], protocol: 'acp', acpArgs: ['acp'], gateways: ['openai'], color: '#111111' },
  { id: 'gemini-acp', glyph: 'Ge', name: 'Gemini CLI (ACP)', vendor: 'Google', bins: ['gemini'], protocol: 'acp', acpArgs: ['--acp'], gateways: ['gemini'], color: '#4285f4', hidden: true },
  // DeepSeek has no official agent CLI. These are the main community ones; they run as plain
  // terminal agents until their headless flags are configured in agents.json.
  { id: 'deepseek-tui', glyph: 'Ds', name: 'DeepSeek TUI', vendor: 'Community', bins: ['deepseek-tui', 'deepseek'], protocol: 'text', textArgs: null, color: '#4d6bfe' },
  { id: 'reasonix', glyph: 'Rx', name: 'Reasonix (DeepSeek)', vendor: 'Community', bins: ['reasonix'], protocol: 'text', textArgs: null, color: '#4d6bfe' },
  { id: 'aider', docs: 'https://aider.chat', glyph: 'Ai', name: 'Aider', vendor: 'Community', bins: ['aider'], protocol: 'text', gateways: ['openai', 'anthropic', 'ollama'], color: '#14b014',
    textArgs: ({ mode, prompt }) => ['--message', prompt, '--no-pretty', '--no-stream', ...(mode === 'read' ? ['--dry-run'] : ['--yes-always'])] },
  { id: 'cursor-agent', glyph: 'Cu', name: 'Cursor Agent', vendor: 'Cursor', bins: ['cursor-agent'], protocol: 'text', color: '#000000',
    textArgs: ({ prompt, mode }) => ['-p', prompt, ...(mode === 'full' ? ['--force'] : [])] },
  { id: 'copilot', glyph: 'Gh', name: 'GitHub Copilot CLI', vendor: 'GitHub', bins: ['copilot'], protocol: 'text', color: '#6e40c9',
    textArgs: ({ prompt, mode }) => ['-p', prompt, ...(mode === 'full' ? ['--allow-all-tools'] : [])] },
];

function pathDirs(env = process.env) {
  const extra = [path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), 'bin'),
    '/usr/local/bin', '/opt/homebrew/bin', '/home/linuxbrew/.linuxbrew/bin', path.join(os.homedir(), '.cargo', 'bin')];
  // nvm installs are not on PATH for GUI apps; include every node version's bin dir.
  const nvm = path.join(os.homedir(), '.nvm', 'versions', 'node');
  try { for (const v of fs.readdirSync(nvm)) extra.push(path.join(nvm, v, 'bin')); } catch {}
  return [...new Set([...(env.PATH || '').split(path.delimiter), ...extra].filter(Boolean))];
}

function which(bin, env) {
  const exts = process.platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of pathDirs(env)) {
    for (const ext of exts) {
      const p = path.join(dir, bin + ext);
      try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch {}
    }
  }
  return null;
}

function version(bin, env) {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: 8000, env }, (err, stdout, stderr) => {
      const line = `${stdout || ''}\n${stderr || ''}`.split('\n').map((s) => s.trim())
        .find((s) => /\d+\.\d+/.test(s));
      resolve(err && !line ? null : (line || '').slice(0, 80));
    });
  });
}

function loadCustom(file) {
  if (!file) return [];
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (Array.isArray(list) ? list : list.agents || []).filter((a) => a && a.id && a.command)
      .map((a) => {
        const def = { protocol: 'text', gateways: [], color: '#888888', ...a, bins: [a.command], custom: true };
        // The runner calls args() for streaming protocols; a list from agents.json gets {prompt}, {cwd} and {mode}.
        if (def.protocol !== 'text' && def.protocol !== 'acp' && Array.isArray(a.args)) {
          const list = a.args.map(String);
          def.args = (o = {}) => list.map((x) => x.replace(/\{prompt\}/g, o.prompt ?? '').replace(/\{cwd\}/g, o.cwd ?? '').replace(/\{mode\}/g, o.mode ?? ''));
        }
        return def;
      });
  } catch { return []; }
}

// Returns every known and custom agent with detection info: { ...def, path, version, available }.
async function detectAgents({ customFile, env = process.env, probeVersions = true } = {}) {
  const defs = [...BUILTIN, ...loadCustom(customFile)];
  return Promise.all(defs.map(async (def) => {
    let found = null;
    for (const b of def.bins) { found = path.isAbsolute(b) ? (fs.existsSync(b) ? b : null) : which(b, env); if (found) break; }
    if (!found) for (const p of def.extraPaths || []) if (fs.existsSync(p)) { found = p; break; }
    const headless = def.protocol !== 'text' || !!def.textArgs || !!def.args;
    return { ...def, path: found, version: null, available: !!found, headless };
  })).then((agents) => (probeVersions ? probeAgentVersions(agents, { env }) : agents));
}

// `--version` for each installed binary: once per binary (two agents can share one), a few at a time, so starting
// the app does not launch every agent at once.
async function probeAgentVersions(agents, { env = process.env, concurrency = 2 } = {}) {
  const versions = new Map();
  for (const a of agents) if (a.available && a.path) versions.set(a.path, null);
  const paths = [...versions.keys()]; let next = 0;
  const worker = async () => { while (next < paths.length) { const p = paths[next++]; versions.set(p, await version(p, env)); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
  return agents.map((a) => (a.available && a.path ? { ...a, version: versions.get(a.path) } : a));
}

// Plain JSON view of an agent for UIs (drops functions).
function describe(a) {
  const { args, textArgs, ...rest } = a;
  const acp = a.protocol === 'acp' || a.controlProtocol === 'gemini-acp';
  const native = ['claude-stdio', 'codex-app-server'].includes(a.controlProtocol);
  return JSON.parse(JSON.stringify({ ...rest, capabilities: { tools: acp || native || ['claude-stream', 'codex-exec', 'gemini-stream', 'agy-stream'].includes(a.protocol), plans: acp || native || ['claude-stream', 'codex-exec'].includes(a.protocol), approvals: acp || native, questions: native, resume: acp || ['claude-stream', 'codex-exec', 'gemini-stream', 'agy-stream'].includes(a.protocol) } }));
}

module.exports = { BUILTIN, MODES, detectAgents, probeVersions: probeAgentVersions, describe, which, pathDirs };
