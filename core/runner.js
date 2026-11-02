'use strict';
// Run one turn of any agent and stream normalized events.
const { createParser } = require('./parsers');
const { runAcp } = require('./acp');
const { start, killTree, lines } = require('./proc');
const { gatewayLaunch } = require('./gateways');
const { pathDirs } = require('./agents');
const { mergeEnv } = require('./host');
const path = require('path');

// env: the full environment for a local agent. changes: only what Tributary adds or removes
// (null = unset), which is what a remote host receives on top of its own environment.
function buildEnv(agent, { gateway, trusted, extraEnv }) {
  const changes = { NO_COLOR: '1', FORCE_COLOR: '0' };
  if (trusted && agent.trustEnv) Object.assign(changes, agent.trustEnv);
  Object.assign(changes, agent.env || {}, extraEnv || {});
  const g = gateway ? gatewayLaunch(agent, gateway) : { env: {}, args: [], model: null };
  Object.assign(changes, g.env);
  const env = mergeEnv({ ...process.env, PATH: pathDirs(process.env).join(path.delimiter) }, changes);
  return { env, changes, gatewayArgs: g.args, gatewayModel: g.model };
}

// The command to run on a remote host: the agent's own binary name, found on the host's PATH.
const remoteCommand = (agent) => agent.remoteCommand || (agent.custom ? agent.command : (agent.bins && agent.bins[0])) || agent.path;

/**
 * runTurn({ agent, cwd, prompt, mode, resumeId, gateway, model, trusted, onEvent, signal, host })
 * host: a remote host from core/host.js to run the agent there (cwd is then a path on that host).
 * Resolves { ok, sessionId, text }.
 */
async function runTurn(opts) {
  if (opts.agent.protocol === 'direct-chat') return require('./direct').runDirectTurn(opts);
  const { agent, cwd, prompt, mode = 'edit', resumeId, gateway, trusted = true, onEvent, signal } = opts;
  const host = opts.host && opts.host.remote ? opts.host : null;
  let sessionId = resumeId || null; let text = ''; let sawDone = false; let ok = false;
  const emit = (e) => {
    if (e.kind === 'session' && e.sessionId) sessionId = e.sessionId;
    if (e.kind === 'text') text += e.text;
    if (e.kind === 'done') { if (sawDone) return; sawDone = true; ok = e.ok; }
    onEvent(e);
  };
  if (!agent.available && !host) { emit({ kind: 'error', message: `${agent.name} is not installed` }); emit({ kind: 'done', ok: false }); return { ok: false, sessionId, text }; }
  const { env, changes, gatewayArgs, gatewayModel } = buildEnv(agent, { gateway, trusted, extraEnv: opts.env });
  const model = opts.model || gatewayModel || undefined;

  if (agent.protocol === 'acp') {
    const r = await runAcp({ command: host ? remoteCommand(agent) : agent.path, args: [...(agent.acpArgs || []), ...(agent.extraArgs || [])], cwd, env: host ? changes : env, prompt, mode, resumeId, onEvent: emit, signal, host });
    return { ok: r.ok, sessionId: r.sessionId || sessionId, text };
  }

  let args;
  if (agent.protocol === 'text') {
    if (agent.custom && Array.isArray(agent.args)) args = agent.args.map((a) => a.replace(/\{prompt\}/g, prompt).replace(/\{cwd\}/g, cwd).replace(/\{mode\}/g, mode));
    else if (agent.textArgs) args = agent.textArgs({ mode, prompt, cwd, model });
    else { emit({ kind: 'error', message: `${agent.name} has no headless mode configured. Add it to agents.json.` }); emit({ kind: 'done', ok: false }); return { ok: false, sessionId, text }; }
  } else args = agent.args({ mode, resumeId, cwd, prompt, model, gatewayArgs, extraDirs: opts.extraDirs || [] });

  return new Promise((resolve) => {
    const stdin = agent.stdinPrompt ? prompt : null;
    const child = host ? host.spawn(remoteCommand(agent), args, { cwd, env: changes, stdin }) : start(agent.path, args, { cwd, env, stdin });
    const parser = createParser(agent.protocol);
    let stderrTail = '';
    const onAbort = () => { emit({ kind: 'notice', text: 'Stopped by user' }); if (host) host.kill(child); else killTree(child); };
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    lines(child.stdout, (l) => { for (const e of parser.line(l)) emit(e); });
    lines(child.stderr, (l) => { stderrTail = `${stderrTail}${l}\n`.slice(-4000); });
    child.on('error', (e) => { emit({ kind: 'error', message: `Could not start ${agent.name}: ${e.message}` }); });
    child.on('close', (code) => {
      for (const e of parser.end()) emit(e);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (!sawDone) {
        const stopped = signal && signal.aborted;
        if (code !== 0 && !stopped) {
          const missing = host && code === 127 && /not found/i.test(stderrTail) ? `${agent.name} is not installed on ${host.label} (${remoteCommand(agent)} is not on its PATH)` : '';
          const msg = missing || stderrTail.split('\n').map((s) => s.trim()).filter((s) => s && !/^at\s/.test(s) && !/256-color|Reading additional input/.test(s)).slice(-6).join('\n');
          emit({ kind: 'error', message: msg || `${agent.name} exited with code ${code}` });
        }
        emit({ kind: 'done', ok: code === 0 && !stopped });
      }
      resolve({ ok, sessionId, text });
    });
  });
}

module.exports = { runTurn, buildEnv, remoteCommand };
