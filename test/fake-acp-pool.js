#!/usr/bin/env node
// Fake ACP agent for pooling tests. Logs process starts and what it receives to $FAKE_LOG.
const fs = require('fs');
const log = (o) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(o) + '\n');
log({ ev: 'spawn', pid: process.pid });
const rl = require('readline').createInterface({ input: process.stdin });
const send = (o) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
const sessions = new Map(); let n = 0;
rl.on('line', (l) => {
  const m = JSON.parse(l);
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, mcpCapabilities: { http: process.env.FAKE_HTTP === '1' } } } });
  else if (m.method === 'session/new') { const id = `s${++n}-${process.pid}`; sessions.set(id, 0); log({ ev: 'new', id, mcpServers: m.params.mcpServers }); send({ id: m.id, result: { sessionId: id } }); }
  else if (m.method === 'session/load') { sessions.set(m.params.sessionId, 100); log({ ev: 'load', id: m.params.sessionId }); send({ id: m.id, result: null }); }
  else if (m.method === 'session/prompt') {
    const sid = m.params.sessionId; const text = m.params.prompt[0].text;
    if (text === 'CRASH') process.exit(9);
    if (text === 'TOOL_PATTERNS') {
      const up = (update) => send({ method: 'session/update', params: { sessionId: sid, update } });
      up({ sessionUpdate: 'tool_call', toolCallId: 'command', name: 'shell', kind: 'execute', title: 'printf hello; $(do-not-execute)', status: 'pending', rawInput: { command: 'printf hello; $(do-not-execute)' }, locations: [{ path: process.cwd() }] });
      up({ sessionUpdate: 'tool_call_update', toolCallId: 'command', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'hello' } }] });
      up({ sessionUpdate: 'tool_call', toolCallId: 'file', name: 'edit', kind: 'edit', status: 'in_progress', rawInput: { filePath: process.cwd() + '/src/app.ts' }, locations: [{ path: process.cwd() + '/src/app.ts' }] });
      up({ sessionUpdate: 'tool_call_update', toolCallId: 'file', status: 'completed' });
    }
    const count = (sessions.get(sid) || 0) + 1; sessions.set(sid, count);
    send({ method: 'session/update', params: { sessionId: sid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `${text}#${count}@${process.pid}` } } } });
    send({ id: m.id, result: { stopReason: 'end_turn' } });
  }
});
