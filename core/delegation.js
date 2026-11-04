'use strict';
// A turn-scoped local command bridge. Agents can delegate without changing global MCP configuration.
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { digest } = require('./handoff');

const children = (hub, parent) => hub.store.data.threads.filter((t) => t.delegation?.parentThreadId === parent.id && t.project === parent.project);
const snapshot = (hub, t) => {
  const last = [...t.messages].reverse().find((m) => m.role === 'assistant');
  return { id: t.id, title: t.title, agentId: t.lastAgent || t.delegation.agentId, status: hub.running.has(t.id) ? 'running' : hub.copyChanges.has(t.id) ? 'starting' : ['starting', 'running'].includes(t.delegation.state) ? 'interrupted' : t.delegation.state,
    gatewayId: t.delegation.gatewayId || null, model: last?.model || t.delegation.model || '',
    result: String(last?.text || '').slice(-8000), error: String(last?.error || t.delegation.error || '').slice(0, 1000),
    files: (last?.files || []).slice(0, 64).map((f) => f.rel), branch: t.worktree?.branch, workingCopy: t.worktree?.cwd };
};

async function openDelegation(hub, parent, message, { mode, signal } = {}) {
  if (mode === 'read' || parent.task || parent.delegation || hub.project(parent.project)?.trusted === false) throw new Error('Delegation requires a trusted coding chat with Edit files enabled.');
  const token = crypto.randomBytes(32).toString('hex');
  const agents = hub.allAgents().filter((a) => a.available && a.headless !== false && a.protocol !== 'direct-chat');
  const workerLimit = () => [1, 2, 4].includes(hub.store.data.settings.delegationConcurrency) ? hub.store.data.settings.delegationConcurrency : 2;
  let closed = false;
  const publish = (child) => {
    if (!hub.thread(parent.id)) return;
    const details = snapshot(hub, child);
    const item = { id: child.id, agentId: child.delegation.agentId, title: child.title, state: child.delegation.state, branch: details.branch, model: details.model, error: details.error, files: details.files.slice(0, 8), fileCount: [...child.messages].reverse().find((m) => m.role === 'assistant')?.files?.length || 0 };
    message.delegations = (message.delegations || []).some((entry) => entry.id === child.id) ? message.delegations.map((entry) => entry.id === child.id ? item : entry) : [...(message.delegations || []), item];
    hub.store.save(false, parent.id); hub.emit('message', { threadId: parent.id, message });
  };
  const owned = (id) => { const t = children(hub, parent).find((t) => t.id === id); if (!t) throw new Error('Worker chat not found in this chat.'); return t; };
  const call = async (action, input = {}) => {
    if (closed || signal?.aborted) throw new Error('The parent turn has ended.');
    if (action === 'agents') return agents.map((a) => ({ id: a.id, name: a.name, gateways: a.gateways || [] }));
    if (action === 'sources') return hub.store.data.gateways.filter((g) => !g.direct || g.localAgent).map(({ id, name, protocol, model }) => ({ id, name, protocol, model }));
    if (action === 'list') return children(hub, parent).slice(-20).map((t) => snapshot(hub, t));
    if (action === 'status') return snapshot(hub, owned(input.id));
    if (action === 'stop') { const t = owned(input.id); t.delegation.cancelled = true; hub.stop(t.id); hub.store.save(true); return { id: t.id, stopped: true }; }
    if (action !== 'start') throw new Error('Unknown delegation action.');
    if (hub.store.data.settings.agentDelegation === false || hub.project(parent.project)?.trusted === false) throw new Error('Agent delegation is disabled for this chat.');
    if (typeof input.task !== 'string' || !input.task.trim() || input.task.length > 12000) throw new Error('Provide a task of 1–12,000 characters.');
    const selected = agents.find((a) => a.id === input.agentId);
    if (!selected) throw new Error('Choose an available coding agent from agents.');
    const defaultSource = hub.store.data.settings.delegationSource || 'inherit';
    const chosenSource = input.gatewayId || defaultSource;
    const gatewayId = selected.connectionId || (chosenSource === 'inherit' ? message.gatewayId || null : chosenSource === 'native' ? null : chosenSource);
    if (selected.connectionId && input.gatewayId && !['inherit', selected.connectionId].includes(input.gatewayId)) throw new Error('This local worker uses its attached connection.');
    const source = gatewayId ? hub.store.data.gateways.find((g) => g.id === gatewayId && (!g.direct || selected.connectionId === g.id && g.localAgent)) : null;
    if (gatewayId && (!source || !(selected.gateways || []).includes(source.protocol))) throw new Error('This worker cannot use the selected model source. Choose a compatible coding agent or configured source.');
    const models = require('./models');
    const model = models.validateModel(input.model || (models.selectable(selected) && gatewayId === (message.gatewayId || null) && (gatewayId || selected.id === message.agent) ? message.model : null));
    if (model && !models.selectable(selected)) throw new Error('This worker integration cannot select a model. Use its configured default.');
    const limit = workerLimit();
    const own = children(hub, parent);
    if (own.filter((t) => t.delegation.parentMessageId === message.id).length >= 4) throw new Error('Up to four worker chats per parent turn.');
    if (own.filter((t) => hub.running.has(t.id) || hub.copyChanges.has(t.id)).length >= limit) throw new Error(limit === 2 ? 'Two background workers are already active. Check results before starting more.' : `Up to ${limit} background workers may run at once. Check results before starting more.`);
    let child;
    try {
      child = hub.createThread(parent.project, input.task.trim().split('\n')[0].slice(0, 80));
      child.delegation = { parentThreadId: parent.id, parentMessageId: message.id, agentId: input.agentId, gatewayId, model, state: 'starting', createdAt: Date.now() };
      hub.store.save(true); publish(child);
      await hub.createWorktree(child.id);
      if (closed || signal?.aborted || child.delegation.cancelled) throw new Error('Stopped before worker startup.');
      const context = digest(parent.messages.filter((m) => m.id !== message.id), hub.names(), 6000);
      const prompt = `${input.task.trim()}\n\n## Parent chat context (reference)\n${context}\n\nWork only on this task in your separate working copy. It starts from the project’s last commit; uncommitted parent edits are not included. Other agents may work independently. Do not delegate further. Summarize your changes and checks for the parent. The user reviews and merges your copy.`;
      child.delegation.state = 'running'; publish(child);
      // A normal parent completion leaves workers running; an explicit Stop cancels them.
      hub.send({ threadId: child.id, agentId: input.agentId, text: prompt, displayText: input.task.trim(), mode, gatewayId, model })
        .then((result) => { child.delegation.state = child.delegation.cancelled ? 'stopped' : result.ok ? 'done' : 'failed'; })
        .catch((error) => { child.delegation.state = child.delegation.cancelled ? 'stopped' : 'failed'; child.delegation.error = error.message; })
        .finally(() => { publish(child); hub.store.save(true); hub.emit('threads', child.project); });
      return snapshot(hub, child);
    } catch (error) {
      if (child) { child.delegation.state = child.delegation.cancelled || signal?.aborted ? 'stopped' : 'failed'; child.delegation.error = error.message; publish(child); hub.store.save(true); hub.emit('threads', child.project); }
      throw error;
    }
  };
  const server = http.createServer(async (req, res) => {
    const respond = (code, data) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
    if (req.headers.authorization !== `Bearer ${token}` || req.headers.origin || req.headers.host !== `127.0.0.1:${server.address()?.port}`) return respond(403, { error: 'Access denied' });
    if (req.method !== 'POST' || req.url !== '/delegate') return respond(404, { error: 'Not found' });
    try {
      let body = ''; for await (const data of req) { body += data; if (Buffer.byteLength(body) > 16384) throw new Error('Request too large'); }
      const input = JSON.parse(body); const result = await call(input.action, input);
      respond(200, { result });
    } catch (error) { respond(400, { error: error.message }); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  server.unref();
  const quote = (s) => process.platform === 'win32' ? `"${s.replaceAll('"', '""')}"` : `'${s.replaceAll("'", "'\\''")}'`;
  const command = `${process.versions.electron ? process.platform === 'win32' ? 'set ELECTRON_RUN_AS_NODE=1&& ' : 'ELECTRON_RUN_AS_NODE=1 ' : ''}${quote(process.execPath)} ${quote(path.join(__dirname, 'delegate-cli.js'))}`;
  return { call, env: { TRIBUTARY_DELEGATE_URL: `http://127.0.0.1:${server.address().port}/delegate`, TRIBUTARY_DELEGATE_TOKEN: token },
    prompt: `## Background coding workers\nYou may delegate independent pieces when useful to complete the user’s task. Use your shell tool to run:\n${command} agents\n${command} sources\n${command} start --agent AGENT_ID --task "specific task and checks"\n${command} list\n${command} status --id CHAT_ID\n${command} stop --id CHAT_ID\nThese create real background chats visible in the sidebar and Live activity. At most ${workerLimit()} run at once and four may be created per turn. The default worker source is ${hub.store.data.settings.delegationSource || 'inherit'}. Inherit keeps this chat’s source; native uses the worker’s own account; use optional --source SOURCE_ID (or native) and --model MODEL_ID for an explicit configured choice. Do not switch providers to evade a failed or incompatible source. Workers cannot delegate recursively. Workers start from the project’s last commit, not your uncommitted files; give complete instructions. Check results before claiming completion. Review/merge remains explicit. Never print bridge environment credentials.`,
    close: () => { closed = true; server.close(); server.closeIdleConnections(); } };
}

module.exports = { openDelegation };
