'use strict';
// Codex app-server over private stdio: native threads, streaming items and host approvals.
const { start, killTree, lines } = require('./proc');
const { clip } = require('./parsers');
const OPTIONS = [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'always', name: 'Allow for this session', kind: 'allow_always' }, { optionId: 'reject', name: 'Deny', kind: 'reject_once' }];
function runCodexServer({ command, args = [], cwd, env, prompt, mode, resumeId, model, images = [], extraDirs = [], onEvent, signal }) {
  return new Promise((resolve) => {
    if (signal?.aborted) { onEvent({ kind: 'done', ok: false }); resolve({ ok: false, sessionId: resumeId }); return; }
    const child = start(command, args, { cwd, env, keepOpen: true });
    const calls = new Map(); const approvals = new Map(); const streamed = new Set(); const output = new Map();
    let next = 1; let threadId = resumeId; let turnId = null; let finished = false; let said = false; let tail = ''; let stopTimer;
    const write = (message) => { if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.write(JSON.stringify(message) + '\n'); };
    const request = (method, params) => new Promise((done, fail) => {
      if (finished) return fail(new Error('The agent session has ended.'));
      const id = next++; const timer = setTimeout(() => { calls.delete(id); fail(new Error(`Codex did not answer ${method}.`)); }, 30000); timer.unref();
      calls.set(id, { done, fail, timer }); write({ id, method, params });
    });
    const finish = (ok, error) => {
      if (finished) return; finished = true; clearTimeout(stopTimer); signal?.removeEventListener('abort', abort);
      for (const ask of approvals.values()) ask.withdraw?.(); approvals.clear();
      for (const call of calls.values()) { clearTimeout(call.timer); call.fail(new Error('The agent session has ended.')); } calls.clear();
      if (error && !signal?.aborted) onEvent({ kind: 'error', message: error });
      onEvent({ kind: 'done', ok: !!ok && !signal?.aborted });
      child.stdin.end(); const timer = setTimeout(() => killTree(child), 1000); timer.unref(); child.once('close', () => clearTimeout(timer));
      resolve({ ok: !!ok && !signal?.aborted, sessionId: threadId });
    };
    const abort = () => {
      onEvent({ kind: 'notice', text: 'Stopped by user' });
      for (const ask of approvals.values()) ask.withdraw?.(); approvals.clear();
      if (threadId && turnId) void request('turn/interrupt', { threadId, turnId }).catch(() => {});
      else { killTree(child); finish(false); return; }
      stopTimer = setTimeout(() => { killTree(child); finish(false); }, 2000); stopTimer.unref();
    };
    const text = (id, value, delta) => {
      if (!value || !delta && streamed.has(id)) return;
      if (!streamed.has(id)) { if (said) onEvent({ kind: 'text', text: '\n\n' }); said = true; streamed.add(id); }
      onEvent({ kind: 'text', text: value });
    };
    const item = (value, done) => {
      if (!value?.id) return;
      const status = !done ? 'running' : ['failed', 'declined'].includes(value.status) ? 'error' : 'done';
      if (value.type === 'agentMessage') { if (done) text(value.id, value.text, false); }
      else if (value.type === 'commandExecution') onEvent({ kind: 'tool', id: value.id, name: 'shell', input: { command: value.command }, status, output: done ? clip(value.aggregatedOutput || output.get(value.id)) : undefined });
      else if (value.type === 'fileChange') {
        onEvent({ kind: 'tool', id: value.id, name: 'edit', input: { changes: value.changes }, status });
        if (done && status === 'done') for (const change of value.changes || []) onEvent({ kind: 'file', path: change.path, change: typeof change.kind === 'object' ? change.kind.type : change.kind });
      } else if (value.type === 'mcpToolCall') onEvent({ kind: 'tool', id: value.id, name: `${value.server || 'mcp'}.${value.tool || 'call'}`, input: value.arguments, status, output: done ? clip(value.result || value.error) : undefined });
      else if (value.type === 'webSearch') onEvent({ kind: 'tool', id: value.id, name: 'web_search', input: { query: value.query }, status });
      else if (value.type === 'collabAgentToolCall') onEvent({ kind: 'tool', id: value.id, name: `agent.${value.tool || 'background'}`, input: { prompt: value.prompt, agents: value.receiverThreadIds }, status, output: done ? clip(value.agentsStates) : undefined });
      if (done) output.delete(value.id);
    };
    const serverRequest = async (message) => {
      const p = message.params || {}; const id = message.id;
      const commandApproval = message.method === 'item/commandExecution/requestApproval';
      const fileApproval = message.method === 'item/fileChange/requestApproval';
      const question = message.method === 'item/tool/requestUserInput';
      const permissions = message.method === 'item/permissions/requestApproval';
      if (message.method === 'mcpServer/elicitation/request') { write({ id, result: { action: 'decline', content: null } }); return; }
      if (!commandApproval && !fileApproval && !question && !permissions) { write({ id, error: { code: -32601, message: 'This host request is not supported.' } }); return; }
      if (fileApproval && mode === 'read') { write({ id, result: { decision: 'decline' } }); onEvent({ kind: 'notice', text: 'File changes are disabled in Read-only mode.' }); return; }
      if (permissions && mode === 'read' && p.permissions?.fileSystem?.write?.length) { write({ id, result: { permissions: {}, scope: 'turn' } }); onEvent({ kind: 'notice', text: 'Additional write access is disabled in Read-only mode.' }); return; }
      let questions;
      if (question) {
        if (!Array.isArray(p.questions) || !p.questions.length || p.questions.length > 4 || p.questions.some((q) => q.isSecret || typeof q.question !== 'string' || q.question.length > 1000 || typeof q.id !== 'string' || (q.options?.length || 0) > 8) || new Set(p.questions.map((q) => q.question)).size !== p.questions.length) { write({ id, result: { answers: {} } }); return; }
        questions = p.questions.map((q) => ({ question: q.question, multiSelect: false, options: (q.options || []).map((o) => ({ label: String(o.label).slice(0, 200), description: String(o.description || '').slice(0, 1000) })) }));
      }
      const ask = { kind: 'permission', request: { sessionId: threadId, toolCallId: p.itemId, title: question ? 'Answer questions' : p.reason || (commandApproval ? 'Run a command' : 'Edit files'), kind: commandApproval ? 'execute' : fileApproval ? 'edit' : permissions ? 'permissions' : 'other', ...(permissions ? { detail: JSON.stringify(p.permissions || {}, null, 2) } : {}), command: p.command || undefined, options: question ? OPTIONS.filter((o) => o.optionId === 'reject') : OPTIONS.map((o) => ({ ...o })), ...(questions ? { questions } : {}) } };
      approvals.set(id, ask);
      try {
        onEvent(ask); const choice = ask.answer ? await ask.answer : 'reject';
        if (finished || !approvals.delete(id)) return;
        if (question) write({ id, result: { answers: choice?.answers ? Object.fromEntries(p.questions.map((q) => [q.id, { answers: [choice.answers[q.question]] }])) : {} } });
        else if (permissions) write({ id, result: { permissions: choice === 'once' || choice === 'always' ? p.permissions || {} : {}, scope: 'turn' } });
        else write({ id, result: { decision: choice === 'once' || choice === 'always' ? 'accept' : choice == null ? 'cancel' : 'decline' } });
      } catch { approvals.delete(id); write({ id, result: question ? { answers: {} } : permissions ? { permissions: {}, scope: 'turn' } : { decision: 'decline' } }); }
    };
    const notification = ({ method, params: p = {} }) => {
      if (p.threadId && threadId && p.threadId !== threadId) return;
      if (method === 'turn/started') turnId = p.turn?.id;
      else if (method === 'item/started' || method === 'item/completed') item(p.item, method === 'item/completed');
      else if (method === 'item/agentMessage/delta') text(p.itemId, p.delta, true);
      else if (method === 'item/commandExecution/outputDelta') { const value = (output.get(p.itemId) || '') + (p.delta || ''); output.set(p.itemId, value.slice(-8000)); onEvent({ kind: 'tool', id: p.itemId, status: 'running', output: clip(value) }); }
      else if (method === 'item/reasoning/summaryTextDelta') onEvent({ kind: 'thinking', text: p.delta || '' });
      else if (method === 'turn/plan/updated') onEvent({ kind: 'plan', items: (p.plan || []).slice(0, 100).map((step) => ({ text: step.step, done: step.status === 'completed' })) });
      else if (method === 'thread/tokenUsage/updated') { const u = p.tokenUsage?.last || p.tokenUsage?.total; if (u) onEvent({ kind: 'usage', usage: { input_tokens: u.inputTokens, output_tokens: u.outputTokens, cached_input_tokens: u.cachedInputTokens } }); }
      else if (method === 'serverRequest/resolved') { approvals.get(p.requestId)?.withdraw?.(); approvals.delete(p.requestId); }
      else if (method === 'error') onEvent({ kind: p.willRetry ? 'notice' : 'error', ...(p.willRetry ? { text: p.error?.message || 'Codex is retrying.' } : { message: p.error?.message || 'Codex error' }) });
      else if (method === 'turn/completed') finish(p.turn?.status === 'completed', p.turn?.error?.message);
    };
    lines(child.stdout, (line) => {
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.method) { if (message.id != null) void serverRequest(message); else notification(message); }
      else if (message.id != null && calls.has(message.id)) { const call = calls.get(message.id); calls.delete(message.id); clearTimeout(call.timer); message.error ? call.fail(new Error(message.error.message || 'Codex request failed')) : call.done(message.result); }
    });
    lines(child.stderr, (line) => { tail = `${tail}${line}\n`.slice(-2000); });
    child.on('error', (error) => finish(false, error.message));
    child.on('close', (code) => { if (!finished) finish(false, tail.trim() || `Codex app-server exited (${code}).`); });
    signal?.addEventListener('abort', abort, { once: true });
    (async () => {
      await request('initialize', { clientInfo: { name: 'tributary', title: 'Tributary', version: '0.1.0' }, capabilities: { experimentalApi: false } }); write({ method: 'initialized', params: {} });
      const config = { cwd, model: model || undefined, approvalPolicy: mode === 'full' ? 'never' : 'on-request', approvalsReviewer: 'user', sandbox: mode === 'full' ? 'danger-full-access' : mode === 'read' ? 'read-only' : 'workspace-write' };
      const result = await request(resumeId ? 'thread/resume' : 'thread/start', { ...config, ...(resumeId ? { threadId: resumeId } : {}) });
      threadId = result.thread.id; onEvent({ kind: 'session', sessionId: threadId, model: result.model, resumed: !!resumeId });
      if (signal?.aborted || finished) { abort(); return; }
      const sandboxPolicy = mode === 'full' ? { type: 'dangerFullAccess' } : mode === 'read' ? { type: 'readOnly' } : { type: 'workspaceWrite', writableRoots: [cwd, ...extraDirs], networkAccess: false };
      const turn = await request('turn/start', { threadId, input: [{ type: 'text', text: prompt }, ...images.map((image) => ({ type: 'localImage', path: image.path }))], cwd, sandboxPolicy, approvalPolicy: config.approvalPolicy, approvalsReviewer: 'user', model: model || undefined });
      turnId = turn.turn?.id || turnId;
    })().catch((error) => finish(false, error.message));
  });
}
module.exports = { runCodexServer };
