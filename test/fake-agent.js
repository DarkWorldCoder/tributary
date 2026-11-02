#!/usr/bin/env node
// Fake agent for tests. Usage: fake-agent.js <protocol> [--resume <id>] [--fail]
// Reads the prompt from stdin (or -p arg) and replies "ECHO:<prompt>" in that protocol's stream format.
const args = process.argv.slice(2);
const proto = args[0];
const resume = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : null;
const pIdx = args.indexOf('-p');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const go = (prompt) => {
  if (args.includes('--fail')) { process.stderr.write('Error: simulated failure\n'); process.exit(3); }
  if (args.includes('--hang')) { setInterval(() => {}, 1000); return; }
  const sid = resume || 'sess-' + Math.random().toString(36).slice(2, 8);
  if (proto === 'claude-stream') {
    out({ type: 'system', subtype: 'init', session_id: sid, model: 'fake' });
    out({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } }, session_id: sid });
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ECHO:' } } });
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: prompt } } });
    out({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'ECHO:' + prompt }, { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: process.cwd() + '/a.txt' } }] } });
    out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false }] } });
    out({ type: 'result', subtype: 'success', is_error: false, result: 'ECHO:' + prompt, session_id: sid, total_cost_usd: 0.01 });
  } else if (proto === 'codex-exec') {
    out({ type: 'thread.started', thread_id: sid });
    out({ type: 'turn.started' });
    out({ type: 'item.started', item: { id: 'c1', type: 'command_execution', command: 'ls', status: 'in_progress' } });
    out({ type: 'item.completed', item: { id: 'c1', type: 'command_execution', command: 'ls', aggregated_output: 'a.txt\n', exit_code: 0, status: 'completed' } });
    out({ type: 'item.completed', item: { id: 'f1', type: 'file_change', changes: [{ path: process.cwd() + '/b.txt', kind: 'add' }], status: 'completed' } });
    out({ type: 'item.completed', item: { id: 'i0', type: 'agent_message', text: 'ECHO:' + prompt } });
    out({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
  }
};
if (pIdx >= 0) go(args[pIdx + 1]);
else { let s = ''; process.stdin.on('data', (d) => (s += d)); process.stdin.on('end', () => go(s)); }
