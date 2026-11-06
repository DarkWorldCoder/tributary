'use strict';
// Turn-scoped, acknowledged editor commands. Never evaluates agent-supplied JS.
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { projectPath } = require('./files');
const ACTIONS = ['status', 'open_file', 'read_editor', 'edit_editor', 'save_editor', 'undo', 'redo', 'format', 'split_editor', 'focus_group', 'show_panel'];
const WRITES = new Set(['edit_editor', 'save_editor', 'undo', 'redo', 'format']);
const pending = new WeakMap();
function replyWorkbench(hub, id, result, error) {
  const settle = pending.get(hub)?.get(id);
  if (!settle) return false;
  if (typeof error === 'string') settle(new Error(error.slice(0, 1000)));
  else if (Buffer.byteLength(JSON.stringify(result ?? null)) > 32000) settle(new Error('Editor response exceeds the limit.'));
  else settle(null, result);
  return true;
}
async function openWorkbench(hub, thread, message, { mode, signal } = {}) {
  if (thread.host || hub.project(thread.project)?.trusted === false || !hub.listenerCount('workbench')) return null;
  const cwd = hub.workdir(thread), token = crypto.randomBytes(32).toString('hex');
  const requests = new Set(); let closed = false, busy = false;
  const call = async (action, input = {}) => {
    if (closed || signal?.aborted) throw new Error('This agent turn has ended.');
    if (!ACTIONS.includes(action)) throw new Error('Unknown editor action.');
    if (busy) throw new Error('Wait for the previous editor command to finish.');
    busy = true;
    try {
      if (input.path !== undefined) {
        if (typeof input.path !== 'string' || !input.path || input.path.length > 4096) throw new Error('Provide a project-relative file path.');
        await projectPath(cwd, input.path);
        if (path.isAbsolute(input.path) || input.path.split(/[\\/]/).includes('..')) throw new Error('Provide a project-relative file path.');
      }
      if (action === 'open_file' && !input.path) throw new Error('Provide a file path.');
      for (const key of ['line', 'column', 'group', 'start_line', 'count']) if (input[key] !== undefined && (!Number.isInteger(input[key]) || input[key] < 1 || input[key] > (key === 'count' ? 200 : key === 'group' ? 16 : 1000000))) throw new Error(`Invalid ${key}.`);
      if (action === 'focus_group' && input.group === undefined) throw new Error('Choose an editor group.');
      if (action === 'split_editor' && !['right', 'down'].includes(input.direction)) throw new Error('Choose right or down.');
      if (action === 'show_panel' && !['files', 'review', 'memory', 'preview', 'tests', 'terminal', 'debugger'].includes(input.panel)) throw new Error('Unknown workspace panel.');
      if (WRITES.has(action)) {
        if (!input.path) throw new Error('Supply the open editor path with this change.');
        if (hub.project(thread.project)?.trusted === false) throw new Error('This project is no longer trusted.');
        if (mode === 'read') throw new Error('Editor changes are disabled in read-only mode.');
        if (typeof input.revision !== 'string' || !input.revision || input.revision.length > 100) throw new Error('Read the editor and supply its current revision first.');
        if (action === 'edit_editor' && !input.old_text) throw new Error('old_text cannot be empty.');
        if (action === 'edit_editor' && [input.old_text, input.new_text].some(value => typeof value !== 'string' || value.length > 120000 || value.includes('\0'))) throw new Error('Provide old_text and new_text, each at most 120,000 characters.');
        if (mode !== 'full') {
          if (!hub.approvals) throw new Error('This host cannot approve editor changes.');
          const title = { edit_editor: `Edit ${input.path}`, save_editor: `Save ${input.path}`, undo: `Undo a change in ${input.path}`, redo: `Redo a change in ${input.path}`, format: `Format ${input.path}` }[action];
          const request = { sessionId: `workbench:${message.id}`, kind: 'edit', title, path: input.path, ...(action === 'edit_editor' ? { detail: `Replace:\n${input.old_text.slice(0, 1500)}\nWith:\n${input.new_text.slice(0, 1500)}` } : {}), options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject', name: 'Deny', kind: 'reject_once' }] };
          hub.secretGuard?.redactEvent(request);
          const choice = await hub.askPermission(thread, message, hub.agent(message.agent), request, signal);
          if (!['once', 'always'].includes(choice)) throw new Error('The user denied this editor action. Do not bypass this decision.');
        }
      }
      if (closed || signal?.aborted || hub.project(thread.project)?.trusted === false) throw new Error('This agent turn ended or its project is no longer trusted.');
      return await new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        let table = pending.get(hub); if (!table) pending.set(hub, table = new Map());
        let settled = false;
        const settle = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); table.delete(id); requests.delete(settle); if (error) hub.emit('workbench', { id, threadId: thread.id, project: cwd, action: 'cancel', input: {} }); error ? reject(error) : resolve(result); };
        const abort = () => settle(new Error('Editor command cancelled.'));
        const timer = setTimeout(() => settle(new Error('Editor unavailable. Open this chat and its workspace, then retry.')), ['format', 'save_editor'].includes(action) ? 60000 : 10000);
        table.set(id, settle); requests.add(settle); signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) return abort();
        hub.emit('workbench', { id, threadId: thread.id, project: cwd, action, input });
      });
    } finally { busy = false; }
  };
  const server = http.createServer(async (req, res) => {
    const respond = (status, data) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
    if (req.headers.authorization !== `Bearer ${token}` || req.headers.origin || req.headers.host !== `127.0.0.1:${server.address()?.port}`) return respond(403, { error: 'Access denied' });
    if (req.method !== 'POST' || req.url !== '/editor') return respond(404, { error: 'Not found' });
    try { const chunks = []; let bytes = 0; for await (const chunk of req) { bytes += chunk.length; if (bytes > 512000) throw new Error('Request too large'); chunks.push(chunk); } const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes))); respond(200, { result: await call(input.action, input) }); }
    catch (error) { respond(400, { error: error.message }); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); server.unref();
  const quote = s => process.platform === 'win32' ? `"${s.replaceAll('"', '""')}"` : `'${s.replaceAll("'", "'\\''")}'`;
  const command = `${process.versions.electron ? process.platform === 'win32' ? 'set ELECTRON_RUN_AS_NODE=1&& ' : 'ELECTRON_RUN_AS_NODE=1 ' : ''}${quote(process.execPath)} ${quote(path.join(__dirname, 'workbench-cli.js'))}`;
  return { call, env: { TRIBUTARY_EDITOR_URL: `http://127.0.0.1:${server.address().port}/editor`, TRIBUTARY_EDITOR_TOKEN: token },
    prompt: `## Tributary editor\nYou can control the currently visible workspace using your shell tool:\n${command} status\n${command} open_file --path "src/main.ts" --line 10\nFor other actions pass --path, --revision, --old-text, --new-text, --direction, --group, --panel, --start-line or --count as needed. For multiline/large arguments pipe a JSON request to the same command with --stdin. ${mode === 'read' ? 'This turn is read-only; only inspection and navigation are available. ' : ''}Other actions: read_editor (optional start_line/count), edit_editor (one exact old_text occurrence and new_text), save_editor, undo, redo, format, split_editor (direction right/down), focus_group (group 1–16), show_panel (panel files/review/memory/preview/tests/terminal/debugger). Read the editor first and pass its path and revision with every change. Revisions protect unsaved user edits; never retry a stale edit blindly. Edits enter normal undo history; saving is explicit. Results are acknowledged by the real editor. Background chats cannot take over another visible chat. Use your normal file and command tools for disk files, tests, terminal commands and debugger execution. Never print editor bridge credentials.`,
    close() { closed = true; for (const settle of [...requests]) settle(new Error('This agent turn has ended.')); server.close(); server.closeIdleConnections(); } };
}
module.exports = { ACTIONS, READ_ACTIONS: ACTIONS.filter(action => !WRITES.has(action)), openWorkbench, replyWorkbench };
