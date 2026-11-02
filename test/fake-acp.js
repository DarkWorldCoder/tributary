#!/usr/bin/env node
// Fake ACP agent: streams a reply, asks permission for an edit, writes a file through the client.
const rl = require('readline').createInterface({ input: process.stdin });
const send = (o) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
let id = 1000; const waits = new Map();
const ask = (method, params) => new Promise((r) => { const i = id++; waits.set(i, r); send({ id: i, method, params }); });
rl.on('line', async (l) => {
  const m = JSON.parse(l);
  if (m.id != null && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); return; }
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
  else if (m.method === 'session/new') send({ id: m.id, result: { sessionId: 'acp-1' } });
  else if (m.method === 'session/load') send({ id: m.id, result: null });
  else if (m.method === 'session/prompt') {
    const sid = m.params.sessionId; const text = m.params.prompt[0].text;
    const up = (update) => send({ method: 'session/update', params: { sessionId: sid, update } });
    up({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking…' } });
    up({ sessionUpdate: 'tool_call', toolCallId: 'tc1', title: 'Write notes.md', kind: 'edit', status: 'pending' });
    const perm = await ask('session/request_permission', { sessionId: sid, toolCall: { toolCallId: 'tc1', title: 'Write notes.md', kind: 'edit' },
      options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }, { optionId: 'no', name: 'Reject', kind: 'reject_once' }] });
    if (perm.result && perm.result.outcome.optionId === 'yes') {
      const w = await ask('fs/write_text_file', { sessionId: sid, path: process.cwd() + '/notes.md', content: 'from acp\n' });
      up({ sessionUpdate: 'tool_call_update', toolCallId: 'tc1', status: w.error ? 'failed' : 'completed' });
    } else up({ sessionUpdate: 'tool_call_update', toolCallId: 'tc1', status: 'failed' });
    const outside = await ask('fs/write_text_file', { sessionId: sid, path: '/etc/tributary-should-not-exist', content: 'x' });
    up({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `ECHO:${text}|outside:${outside.error ? 'blocked' : 'WRITTEN'}` } });
    send({ id: m.id, result: { stopReason: 'end_turn' } });
  }
});
