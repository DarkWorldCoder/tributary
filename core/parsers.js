'use strict';
// Turn each agent's line-delimited output into one normalized event stream:
//   { kind: 'session', sessionId, model }
//   { kind: 'text', text }                 streamed assistant text (append)
//   { kind: 'thinking', text }
//   { kind: 'tool', id, name, input, status: 'running'|'done'|'error', output }
//   { kind: 'file', path, change }         a file the agent created or edited
//   { kind: 'plan', items: [{ text, done }] }
//   { kind: 'usage', usage, costUsd }
//   { kind: 'notice', text }               rate limits and other info
//   { kind: 'error', message }
//   { kind: 'done', ok, result }

const MAX_OUT = 4000;
const clip = (s, n = MAX_OUT) => {
  if (s == null) return '';
  const t = typeof s === 'string' ? s : JSON.stringify(s);
  return t.length > n ? `${t.slice(0, n)}\n… (${t.length - n} more chars)` : t;
};
const EDIT_TOOLS = /^(edit|write|multiedit|notebookedit|write_file|replace|edit_file|create_file|apply_patch|str_replace.*)$/i;
const filePathOf = (input) => input && (input.file_path || input.filePath || input.path || input.Path || input.notebook_path);

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c.type === 'text' ? c.text : c.type === 'image' ? '[image]' : '')).join('\n');
  return clip(content);
}

function claudeStream() {
  const streamedMsgs = new Set();
  const toolNames = new Map();
  return (o) => {
    const out = [];
    switch (o.type) {
      case 'system':
        if (o.subtype === 'init') out.push({ kind: 'session', sessionId: o.session_id, model: o.model });
        else if (o.subtype === 'compact_boundary') out.push({ kind: 'notice', text: 'Context compacted by Claude Code' });
        break;
      case 'stream_event': {
        const e = o.event || {};
        if (e.type === 'message_start' && e.message) streamedMsgs.add(e.message.id);
        if (e.type === 'content_block_delta' && e.delta) {
          if (e.delta.type === 'text_delta' && e.delta.text) out.push({ kind: 'text', text: e.delta.text });
          if (e.delta.type === 'thinking_delta' && e.delta.thinking) out.push({ kind: 'thinking', text: e.delta.thinking });
        }
        break;
      }
      case 'assistant': {
        const m = o.message || {};
        for (const b of m.content || []) {
          if (b.type === 'text' && !streamedMsgs.has(m.id) && b.text) out.push({ kind: 'text', text: b.text });
          if (b.type === 'tool_use') {
            toolNames.set(b.id, b.name);
            out.push({ kind: 'tool', id: b.id, name: b.name, input: b.input, status: 'running' });
          }
        }
        break;
      }
      case 'user': {
        for (const b of (o.message && o.message.content) || []) {
          if (b.type !== 'tool_result') continue;
          const name = toolNames.get(b.tool_use_id) || 'tool';
          out.push({ kind: 'tool', id: b.tool_use_id, name, status: b.is_error ? 'error' : 'done', output: clip(toolResultText(b.content)) });
        }
        break;
      }
      case 'rate_limit_event': {
        const i = o.rate_limit_info || {};
        if (i.status && i.status !== 'allowed') out.push({ kind: 'notice', text: `Rate limit ${i.status} (${i.rateLimitType || 'window'})` });
        break;
      }
      case 'result':
        out.push({ kind: 'usage', usage: o.usage, costUsd: o.total_cost_usd, durationMs: o.duration_ms });
        if (o.session_id) out.push({ kind: 'session', sessionId: o.session_id });
        out.push({ kind: 'done', ok: !o.is_error, result: o.result, error: o.is_error ? (o.result || o.subtype) : undefined });
        break;
      default: break;
    }
    // Derive file events from edit tools.
    for (const e of [...out]) {
      if (e.kind === 'tool' && e.status === 'running' && EDIT_TOOLS.test(e.name || '')) {
        const p = filePathOf(e.input); if (p) out.push({ kind: 'file', path: p, change: e.name });
      }
    }
    return out;
  };
}

function codexExec() {
  let said = false; // codex sends progress notes and the final answer as separate agent messages
  return (o) => {
    const out = [];
    const it = o.item || {};
    switch (o.type) {
      case 'thread.started': out.push({ kind: 'session', sessionId: o.thread_id }); break;
      case 'item.started': case 'item.updated': case 'item.completed': {
        const doneish = o.type === 'item.completed';
        if (it.type === 'agent_message' && doneish && it.text) {
          const body = it.text.replace(/^\s+|\s+$/g, '');
          out.push({ kind: 'text', text: (said ? '\n\n' : '') + body }); said = true;
        }
        else if (it.type === 'reasoning' && doneish && it.text) out.push({ kind: 'thinking', text: it.text });
        else if (it.type === 'command_execution') {
          const status = !doneish ? 'running' : (it.exit_code === 0 || it.status === 'completed' ? 'done' : 'error');
          out.push({ kind: 'tool', id: it.id, name: 'shell', input: { command: it.command }, status,
            output: doneish ? clip(it.aggregated_output) : undefined });
        } else if (it.type === 'file_change') {
          out.push({ kind: 'tool', id: it.id, name: 'edit', input: { changes: it.changes }, status: doneish ? (it.status === 'failed' ? 'error' : 'done') : 'running' });
          if (doneish) for (const c of it.changes || []) out.push({ kind: 'file', path: c.path, change: c.kind });
        } else if (it.type === 'mcp_tool_call') {
          out.push({ kind: 'tool', id: it.id, name: `${it.server || 'mcp'}.${it.tool || 'call'}`, input: it.arguments,
            status: !doneish ? 'running' : (it.status === 'failed' ? 'error' : 'done'), output: doneish ? clip(it.result || it.error) : undefined });
        } else if (it.type === 'web_search') {
          out.push({ kind: 'tool', id: it.id, name: 'web_search', input: { query: it.query }, status: doneish ? 'done' : 'running' });
        } else if (it.type === 'todo_list') {
          out.push({ kind: 'plan', items: (it.items || []).map((x) => ({ text: x.text, done: !!x.completed })) });
        } else if (it.type === 'error') out.push({ kind: 'error', message: it.message });
        break;
      }
      case 'turn.completed': out.push({ kind: 'usage', usage: o.usage }); out.push({ kind: 'done', ok: true }); break;
      case 'turn.failed': out.push({ kind: 'error', message: (o.error && o.error.message) || 'Turn failed' }); out.push({ kind: 'done', ok: false }); break;
      case 'error': out.push({ kind: 'error', message: o.message || 'Error' }); break;
      default: break;
    }
    return out;
  };
}

function geminiStream() {
  const names = new Map();
  return (o) => {
    const out = [];
    switch (o.type) {
      case 'init': out.push({ kind: 'session', sessionId: o.session_id, model: o.model }); break;
      case 'message':
        if (o.role === 'assistant' && o.content) out.push({ kind: 'text', text: o.content });
        break;
      case 'tool_use':
        names.set(o.tool_id, o.tool_name);
        out.push({ kind: 'tool', id: o.tool_id, name: o.tool_name, input: o.parameters, status: 'running' });
        if (EDIT_TOOLS.test(o.tool_name || '')) { const p = filePathOf(o.parameters); if (p) out.push({ kind: 'file', path: p, change: o.tool_name }); }
        break;
      case 'tool_result':
        out.push({ kind: 'tool', id: o.tool_id, name: names.get(o.tool_id) || 'tool', status: o.status === 'error' ? 'error' : 'done',
          output: clip(o.output || (o.error && o.error.message)) });
        break;
      case 'error': out.push({ kind: 'error', message: o.message || (o.error && o.error.message) || 'Error' }); break;
      case 'result':
        out.push({ kind: 'usage', usage: o.stats });
        if (o.status !== 'success' && o.error) out.push({ kind: 'error', message: o.error.message });
        out.push({ kind: 'done', ok: o.status === 'success' });
        break;
      default: break;
    }
    return out;
  };
}

function agyStream() {
  const seen = new Map(); // step_index -> state already reported for tools
  return (o) => {
    const out = [];
    if (o.event === 'init') out.push({ kind: 'session', sessionId: o.conversation_id });
    else if (o.event === 'step_update') {
      const s = o.step_update || {};
      if (s.step_type === 'agent_response') {
        if (s.thinking_delta) out.push({ kind: 'thinking', text: s.thinking_delta });
        if (s.text_delta) out.push({ kind: 'text', text: s.text_delta });
      } else if (s.step_type === 'tool') {
        const id = `step-${s.step_index}`;
        const state = String(s.state || '').toUpperCase();
        const status = state === 'DONE' ? 'done' : (state === 'ERROR' || state === 'FAILED' || state === 'CANCELED') ? 'error' : 'running';
        if (seen.get(id) !== status) {
          seen.set(id, status);
          const info = s.tool_info || {};
          out.push({ kind: 'tool', id, name: s.tool_name || info.name || 'tool', input: info.parameters, status, output: clip(s.tool_output || s.error) || undefined });
          if (status === 'running' && EDIT_TOOLS.test(s.tool_name || '')) { const p = filePathOf(info.parameters); if (p) out.push({ kind: 'file', path: p, change: s.tool_name }); }
        }
      }
    } else if (o.event === 'result') {
      const r = o.result || {};
      out.push({ kind: 'usage', usage: r.usage, durationMs: r.duration_seconds ? r.duration_seconds * 1000 : undefined });
      const ok = String(r.status || '').toUpperCase() === 'SUCCESS';
      if (!ok && r.error) out.push({ kind: 'error', message: typeof r.error === 'string' ? r.error : r.error.message });
      out.push({ kind: 'done', ok, result: r.response });
    } else if (o.event === 'error') out.push({ kind: 'error', message: (o.error && (o.error.message || o.error)) || 'Error' });
    return out;
  };
}

const JSON_PARSERS = { 'claude-stream': claudeStream, 'codex-exec': codexExec, 'gemini-stream': geminiStream, 'agy-stream': agyStream };

// Returns { line(str) -> events[], end() -> events[] } for a protocol.
function createParser(protocol) {
  if (protocol === 'text') {
    return { line: (l) => [{ kind: 'text', text: `${l}\n` }], end: () => [] };
  }
  const make = JSON_PARSERS[protocol];
  if (!make) throw new Error(`Unknown protocol ${protocol}`);
  const handle = make();
  return {
    line(l) {
      const s = l.trim();
      if (!s) return [];
      if (s[0] !== '{') return []; // ignore banners and log noise on stdout
      let o; try { o = JSON.parse(s); } catch { return []; }
      return handle(o);
    },
    end: () => [],
  };
}

module.exports = { createParser, clip, EDIT_TOOLS };
