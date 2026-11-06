'use strict';
const fs = require('node:fs'), http = require('node:http');
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const key = fs.readFileSync(arg('--api-key-file'), 'utf8').trim(), model = arg('--alias');
if (process.env.FAKE_ENGINE_MODE === 'fail') { console.error('Deliberate startup error ' + key); process.exit(1); }
if (process.env.FAKE_ENGINE_MODE === 'hang') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }
else {
  let active = Date.now(); const idle = Number(process.env.FAKE_ENGINE_IDLE_MS || Number(arg('--sleep-idle-seconds')) * 1000);
  const server = http.createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${key}`) { response.writeHead(401); response.end(); return; }
    if (request.url === '/models' || request.url === '/v1/models') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ data: [{ id: model }] })); return; }
    if (request.url === '/props') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ is_sleeping: Date.now() - active > idle })); return; }
    if (request.url === '/v1/chat/completions') {
      active = Date.now(); for await (const _chunk of request) { /* drain */ }
      if (process.env.FAKE_ENGINE_MODE === 'tool') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ choices: [{ message: { content: 'Waiting for command approval.', tool_calls: [{ id: 'owned-command', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command: 'echo should-not-run' }) } }] }, finish_reason: 'tool_calls' }] })); return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end('data: {"choices":[{"delta":{"content":"Connected"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'); return;
    }
    response.writeHead(404); response.end();
  });
  server.listen(Number(arg('--port')), arg('--host'));
}
