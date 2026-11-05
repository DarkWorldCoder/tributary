'use strict';
// Run one turn of any agent and stream normalized events.
const { createParser } = require('./parsers');
const { runAcp } = require('./acp');
const { start, killTree, lines, streamTail } = require('./proc');
const { gatewayLaunch } = require('./gateways');
const { pathDirs } = require('./agents');
const { mergeEnv } = require('./host');
const path = require('path');

// env: the full environment for a local agent. changes: only what Tributary adds or removes
// (null = unset), which is what a remote host receives on top of its own environment.
function buildEnv(agent, { gateway, trusted, extraEnv }) {
  const changes = { NO_COLOR: '1', FORCE_COLOR: '0', TRIBUTARY_DELEGATE_URL: null, TRIBUTARY_DELEGATE_TOKEN: null };
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
  if (opts.agent.protocol === 'local-agent') return require('./local-agent').runLocalAgent(opts);
  if (opts.agent.protocol === 'direct-chat') return require('./direct').runDirectTurn(opts);
  const { agent, cwd, prompt, mode = 'edit', resumeId, gateway, trusted = true, onEvent, signal } = opts;
  const host = opts.host && opts.host.remote ? opts.host : null;
  let sessionId = resumeId || null; let text = ''; let sawDone = false; let ok = false;
  const emit = (e) => {
    if (e.kind === 'session' && e.sessionId) sessionId = e.sessionId;
    if (e.kind === 'text') text += e.text;
    if (e.kind === 'done') { if (sawDone) return; sawDone = true; e.ok = e.ok && !signal?.aborted; ok = e.ok; }
    onEvent(e);
  };
  if (signal?.aborted) { emit({ kind: 'done', ok: false }); return { ok: false, sessionId, text }; }
  if (!agent.available && !host) { emit({ kind: 'error', message: `${agent.name} is not installed` }); emit({ kind: 'done', ok: false }); return { ok: false, sessionId, text }; }
  const selectedGateway = opts.model && gateway ? { ...gateway, model: opts.model } : gateway;
  const { env, changes, gatewayArgs, gatewayModel } = buildEnv(agent, { gateway: selectedGateway, trusted, extraEnv: opts.env });
  const model = opts.model || gatewayModel || undefined;
  const control = agent.controlProtocol === 'claude-stdio' && !host;

  if (agent.controlProtocol === 'codex-app-server' && !host) {
    // Local providers use the same built-in provider IDs as Codex's --oss launcher.
    const configArgs = gateway && ['ollama', 'lmstudio'].includes(gateway.protocol) ? ['-c', `model_provider=${JSON.stringify(gateway.protocol)}`] : gatewayArgs;
    const r = await require('./codex-server').runCodexServer({ command: agent.path, args: agent.serverArgs || ['app-server', '--listen', 'stdio://', ...configArgs], cwd, env, prompt, mode, research: !!opts.research && (!gateway || gateway.protocol === 'openai'), resumeId, model, images: opts.images, extraDirs: opts.extraDirs, onEvent: emit, signal });
    return { ok: r.ok, sessionId: r.sessionId || sessionId, text };
  }

  if (agent.protocol === 'acp' || agent.controlProtocol === 'gemini-acp' && !host) {
    const r = await runAcp({ command: host ? remoteCommand(agent) : agent.path, args: [...(agent.controlProtocol === 'gemini-acp' ? ['--experimental-acp', ...(model ? ['--model', model] : []), ...(opts.extraDirs?.length ? ['--include-directories', opts.extraDirs.join(',')] : [])] : agent.acpArgs || []), ...(agent.extraArgs || [])], cwd, env: host ? changes : env, prompt, fallbackPrompt: opts.fallbackPrompt, images: opts.images, mode, resumeId, onEvent: emit, signal, host });
    return { ok: r.ok, sessionId: r.sessionId || sessionId, text };
  }

  let args;
  if (agent.protocol === 'text') {
    if (agent.custom && Array.isArray(agent.args)) args = agent.args.map((a) => a.replace(/\{prompt\}/g, prompt).replace(/\{cwd\}/g, cwd).replace(/\{mode\}/g, mode));
    else if (agent.textArgs) args = agent.textArgs({ mode, prompt, cwd, model });
    else { emit({ kind: 'error', message: `${agent.name} has no headless mode configured. Add it to agents.json.` }); emit({ kind: 'done', ok: false }); return { ok: false, sessionId, text }; }
  } else args = agent.args({ mode, resumeId, cwd, prompt, model, gatewayArgs, extraDirs: opts.extraDirs || [], images: opts.images || [], control });

  return new Promise((resolve) => {
    const userMessage = () => ({ type: 'user', message: { role: 'user', content: [...(opts.images || []).map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mime, data: image.base64 } })), { type: 'text', text: prompt }] } });
    const stdin = agent.stdinPrompt && !control ? agent.id === 'claude' && opts.images?.length ? JSON.stringify(userMessage()) + '\n' : prompt : null;
    const child = host ? host.spawn(remoteCommand(agent), args, { cwd, env: changes, stdin }) : start(agent.path, args, { cwd, env, stdin, keepOpen: control });
    const write = (value) => { if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.write(JSON.stringify(value) + '\n'); };
    const controls = control ? require('./claude-control').createClaudeControl({ write, mode, emit, sessionId: () => sessionId }) : null;
    if (control) write(userMessage());
    const parser = createParser(agent.protocol);
    let stderrTail = '';
    let stopTimer;
    const onAbort = () => {
      emit({ kind: 'notice', text: 'Stopped by user' });
      if (control) {
        write({ type: 'control_request', request_id: require('node:crypto').randomUUID(), request: { subtype: 'interrupt' } }); controls.close();
        stopTimer = setTimeout(() => killTree(child), 2000); stopTimer.unref();
      } else if (host) host.kill(child); else killTree(child);
    };
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    lines(child.stdout, (l) => { for (const e of parser.line(l)) {
      if (e.kind === 'control-request') { if (controls) void controls.request(e); continue; }
      if (e.kind === 'control-withdrawn') { controls?.withdraw(e.requestId); continue; }
      emit(e);
      if (control && e.kind === 'done') { controls.close(); child.stdin.end(); }
    } });
    streamTail(child.stderr, 4000, (tail) => { stderrTail = tail; });
    child.on('error', (e) => { emit({ kind: 'error', message: `Could not start ${agent.name}: ${e.message}` }); });
    child.on('close', (code) => {
      clearTimeout(stopTimer); controls?.close();
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
